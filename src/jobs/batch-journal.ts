/** TASK-013 / REQ-022 / TEST-022: native-only durable read-only scheduling hints.
 * The caller supplies a trusted, batch-dedicated, pre-existing app data
 * directory. This does NOT authenticate checkpoints or grant script authority.
 * No source, URL, script path, credentials or contents are persisted.
 * A temp-file fsync + same-directory rename protects against partial writes;
 * full power-loss guarantees and durable multi-process scheduling are not
 * claimed, especially where Windows cannot fsync the parent directory.
 */
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {link,lstat,mkdir,open,rename,rm,rmdir,unlink} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import {hasUnsafePathLink} from '../version/path-boundary';
import {ReadOnlyBatchCoordinator,type ReadOnlyWorker,type ReadOnlyBatchSnapshot} from './batch-coordinator';

export type BatchJournalFailure='INVALID_INPUT'|'UNSAFE_PATH'|'BUSY'|'NOT_FOUND'|'INVALID_CHECKPOINT'|'IO_FAILURE';
export type BatchJournalSaveResult=
 |Readonly<{status:'CHECKPOINT_SAVED_UNVERIFIED';sha256:string}>
 |Readonly<{status:'BLOCKED';reason:BatchJournalFailure}>;
export type BatchJournalLoadResult=
 |Readonly<{status:'CHECKPOINT_RESTORED_SCHEDULING_ONLY';coordinator:ReadOnlyBatchCoordinator}>
 |Readonly<{status:'BLOCKED';reason:BatchJournalFailure}>;
export const BATCH_JOURNAL_FILENAME='uah-readonly-batch-v2.json';
const BATCH_JOURNAL_LOCK_FILENAME='.uah-readonly-batch-v2.lock';
async function writerLockExists(directory:string):Promise<boolean>{
 try{await lstat(join(directory,BATCH_JOURNAL_LOCK_FILENAME));return true;}
 catch(e){
  if((e as NodeJS.ErrnoException).code==='ENOENT')return false;
  throw e;
 }
}
const MAX_JOURNAL_BYTES=160000;
const deny=(reason:BatchJournalFailure)=>Object.freeze({status:'BLOCKED' as const,reason});
type Identity={dev:bigint;ino:bigint;size:bigint;mtimeNs:bigint;ctimeNs:bigint};
const sameDir=(a:Identity,b:Identity)=>a.dev===b.dev&&a.ino===b.ino;
const sameFile=(a:Identity,b:Identity)=>sameDir(a,b)&&a.size===b.size&&
 a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
/** Identity snapshots guard against replacing this operation's staging file
 * or cooperative lock. A final check is not an atomic handle-based guarantee.
 */
async function stillOwnWriterLock(directory:string,parent:Identity,lock:Identity):Promise<boolean>{
 try{
  const currentParent=await checkedDirectory(directory);
  if(!currentParent||!sameDir(parent,currentParent))return false;
  const current=await lstat(join(directory,BATCH_JOURNAL_LOCK_FILENAME),{bigint:true});
  return current.isDirectory()&&!current.isSymbolicLink()&&sameDir(lock,current);
 }catch{return false;}
}
async function stillOwnStagingFile(
 directory:string,path:string,parent:Identity,staged:Identity
):Promise<boolean>{
 try{
  if(await hasUnsafePathLink(path))return false;
  const currentParent=await checkedDirectory(directory);
  if(!currentParent||!sameDir(parent,currentParent))return false;
  const current=await lstat(path,{bigint:true});
  return current.isFile()&&!current.isSymbolicLink()&&
   current.nlink===1n&&sameFile(staged,current);
 }catch{return false;}
}
function validPath(directory:unknown):directory is string{
 return typeof directory==='string'&&directory.length>0&&directory.length<=4096&&
  !directory.includes('\0')&&isAbsolute(directory)&&directory===resolve(directory);
}
async function checkedDirectory(directory:string){
 if(await hasUnsafePathLink(directory))return null;
 const stat=await lstat(directory,{bigint:true});
 return stat.isDirectory()&&!stat.isSymbolicLink()?stat:null;
}
/** Never read unbounded untrusted JSON, even if another native process grows
 * the file while it is open. Caller checks inode and timestamps afterward.
 */
async function boundedRead(path:string):Promise<{bytes:Buffer;file:Identity}|null>{
 const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{
  const before=await handle.stat({bigint:true});
  if(!before.isFile()||before.nlink!==1n||
     before.size<=0n||before.size>BigInt(MAX_JOURNAL_BYTES))return null;
  const pieces:Buffer[]=[];
  let total=0;
  const chunk=Buffer.alloc(8192);
  while(true){
   const {bytesRead}=await handle.read(chunk,0,chunk.length,null);
   if(bytesRead===0)break;
   total+=bytesRead;
   if(total>MAX_JOURNAL_BYTES)return null;
   pieces.push(Buffer.from(chunk.subarray(0,bytesRead)));
  }
  const after=await handle.stat({bigint:true});
  if(!sameFile(before,after)||total!==Number(after.size))return null;
  return {bytes:Buffer.concat(pieces,total),file:after};
 }finally{await handle.close();}
}
/** Persist only a real, native coordinator's bounded identity-bound hint.
 * A fixed filename scoped to a trusted directory avoids arbitrary target
 * filenames. Existing unusual files and unfinished lock directories refuse
 * overwrite; no cleanup of unknown crash locks occurs.
 */
export async function saveReadOnlyBatchJournal(directory:string,coordinator:ReadOnlyBatchCoordinator):Promise<BatchJournalSaveResult>{
 // A matching prototype alone is forgeable; Proxy reflection and shadowed
 // instance methods must never become an authority or an escaping exception.
 if(!ReadOnlyBatchCoordinator.isNativeInstance(coordinator))
  return deny('INVALID_INPUT');
 let snapshot:ReturnType<ReadOnlyBatchCoordinator['snapshot']>;
 try{snapshot=ReadOnlyBatchCoordinator.prototype.snapshot.call(coordinator);}
 catch{return deny('INVALID_INPUT');}
 if(!snapshot.batchFingerprint||!(/^[0-9a-f]{64}$/).test(snapshot.batchFingerprint))
  return deny('INVALID_INPUT');
 if(!validPath(directory))return deny('UNSAFE_PATH');
 let start:Identity|null;
 try{start=await checkedDirectory(directory);}catch{return deny('UNSAFE_PATH');}
 if(!start)return deny('UNSAFE_PATH');
 const bytes=Buffer.from(JSON.stringify(snapshot),'utf8');
 if(bytes.length===0||bytes.length>MAX_JOURNAL_BYTES)return deny('INVALID_INPUT');
 const target=join(directory,BATCH_JOURNAL_FILENAME);
 const lock=join(directory,BATCH_JOURNAL_LOCK_FILENAME);
 let acquired=false,staging:string|undefined;
 // A committed journal cannot be acknowledged while its writer mutex
 // is stranded: future checkpoint saves and loads would remain BUSY.
 let releasedOwnedLock=false;
 let ownedLock:Identity|undefined,ownedStaging:Identity|undefined;
 let previousTarget:Identity|undefined;
 let publishedIdentity:Identity|undefined;
 try{
  try{await mkdir(lock,{mode:0o700});acquired=true;}
  catch(error){
   if((error as NodeJS.ErrnoException).code==='EEXIST')return deny('BUSY');
   return deny('IO_FAILURE');
  }
  const acquiredLock=await lstat(lock,{bigint:true});
  if(!acquiredLock.isDirectory()||acquiredLock.isSymbolicLink())return deny('BUSY');
  ownedLock=acquiredLock;
  const lockedDir=await checkedDirectory(directory);
  if(!lockedDir||!sameDir(start,lockedDir))return deny('UNSAFE_PATH');
  try{
   const existing=await lstat(target,{bigint:true});
   previousTarget=existing;
   if(!existing.isFile()||existing.isSymbolicLink()||existing.nlink!==1n)
    return deny('INVALID_CHECKPOINT');
   // An existing checkpoint is untrusted. Never clobber another batch or
   // rewind completed jobs: verify exact schema/identity and monotonicity
   // while holding the native single-writer lock.
   const prior=await boundedRead(target);
   const now=await lstat(target,{bigint:true});
   if(!prior||!sameFile(existing,prior.file)||!sameFile(prior.file,now))
    return deny('INVALID_CHECKPOINT');
   let parsed:unknown;
   try{parsed=JSON.parse(prior.bytes.toString('utf8'));}
   catch{return deny('INVALID_CHECKPOINT');}
   if(!ReadOnlyBatchCoordinator.prototype.mayPersistOver.call(coordinator,parsed))
    return deny('INVALID_CHECKPOINT');
  }catch(error){
   if((error as NodeJS.ErrnoException).code!=='ENOENT')return deny('IO_FAILURE');
  }
  staging=join(directory,'.uah-readonly-batch-'+randomUUID()+'.tmp');
  const handle=await open(staging,'wx',0o600);
  try{
   await handle.writeFile(bytes);
   await handle.sync();
   ownedStaging=await handle.stat({bigint:true});
  }finally{await handle.close();}
  const current=await checkedDirectory(directory);
  if(!current||!sameDir(start,current))return deny('UNSAFE_PATH');
  // The coordinator is live while disk I/O awaits. Never publish bytes
  // captured when its job states/attempt counts were different from the
  // current native scheduling state (e.g. QUEUED/0 -> RUNNING/1). Otherwise
  // mayPersistOver() could approve current progress while rename() writes
  // an obsolete snapshot and loses the only durable retry evidence.
  // Recheck the native prototype method, not a shadowed instance method.
  let latest:Buffer;
  try{latest=Buffer.from(JSON.stringify(
    ReadOnlyBatchCoordinator.prototype.snapshot.call(coordinator)),'utf8');}
  catch{return deny('INVALID_CHECKPOINT');}
  if(!latest.equals(bytes))return deny('INVALID_CHECKPOINT');
  if(!ownedLock||!await stillOwnWriterLock(directory,start,ownedLock))
   return deny('BUSY');
  if(!ownedStaging||!await stillOwnStagingFile(directory,staging,start,ownedStaging))
   return deny('INVALID_CHECKPOINT');
  const prepared=await boundedRead(staging);
  if(!prepared||!sameFile(ownedStaging,prepared.file)||
     !prepared.bytes.equals(bytes))return deny('INVALID_CHECKPOINT');
  // Refuse a newly inserted target or a changed prior checkpoint. These are
  // fail-closed snapshots rather than an atomic multi-process CAS.
  try{
   const targetNow=await lstat(target,{bigint:true});
   if(!previousTarget||!sameFile(previousTarget,targetNow)||
      !targetNow.isFile()||targetNow.nlink!==1n)
    return deny('INVALID_CHECKPOINT');
  }catch(e){
   if((e as NodeJS.ErrnoException).code!=='ENOENT'||previousTarget)
    return deny('INVALID_CHECKPOINT');
  }
  if(!await stillOwnStagingFile(directory,staging,start,ownedStaging))
   return deny('INVALID_CHECKPOINT');
  if(!await stillOwnWriterLock(directory,start,ownedLock))
   return deny('BUSY');
  if(previousTarget){
   // Existing same-batch journals follow the checked single-writer update.
   await rename(staging,target);
  }else{
   // Initial creation must be NO-CLOBBER. A competing process can install
   // a new target between the last lstat() and publication; rename() would
   // silently overwrite it despite the native cooperative writer mutex.
   // A same-directory hard link fails with EEXIST instead of replacing it.
   await link(staging,target);
   const targetLink=await lstat(target,{bigint:true});
   const pendingLink=await lstat(staging,{bigint:true});
   if(!ownedStaging||!targetLink.isFile()||targetLink.isSymbolicLink()||
      !pendingLink.isFile()||pendingLink.isSymbolicLink()||
      targetLink.nlink!==2n||pendingLink.nlink!==2n||
      !sameDir(ownedStaging,targetLink)||
      !sameDir(ownedStaging,pendingLink)||
      targetLink.size!==ownedStaging.size||
      pendingLink.size!==ownedStaging.size)
    return deny('INVALID_CHECKPOINT');
   await unlink(staging);
  }
  staging=undefined;
  const stored=await boundedRead(target);
  const finalDir=await checkedDirectory(directory);
  // Rename and byte parity alone do not attest publication: another process
  // may replace the pathname with an identical JSON file immediately after
  // rename(). Preserve the staged inode identity across that boundary, and
  // verify that the pathname still points to the file just read. This is a
  // bounded snapshot check, NOT an atomic handle-enforced transaction.
  const published=await lstat(target,{bigint:true});
  if(!stored||!finalDir||!sameDir(start,finalDir)||
     !sameDir(ownedStaging,stored.file)||
     !published.isFile()||published.isSymbolicLink()||published.nlink!==1n||
     !sameFile(stored.file,published)||
     !stored.bytes.equals(bytes)||
     !await stillOwnWriterLock(directory,start,ownedLock))
    return deny('IO_FAILURE');
  publishedIdentity=published;
  // The coordinator is mutable while the last filesystem awaits run.
  // Its state can change even AFTER the earlier pre-publish check (for
  // example a user cancellation as the atomic rename completes). Refuse a
  // success receipt for an already-stale persisted snapshot. The previous
  // journal is left intact for explicit, safe retry; never rewrite it here
  // or grant repair authority. This is a final snapshot, not a claim of
  // an inter-process transaction/lock or power-loss atomicity.
  // Await the final ownership check FIRST. User cancellation can change
  // state while the filesystem operation is pending: a snapshot captured
  // before that await could incorrectly claim the stale checkpoint is saved.
  if(!await stillOwnWriterLock(directory,start,ownedLock))
   return deny('BUSY');
  // Synchronously re-sample the native coordinator after the last check.
  // This is only a same-process snapshot, NOT a cross-process transaction.
  let publishedState:Buffer;
  try{
   publishedState=Buffer.from(JSON.stringify(
    ReadOnlyBatchCoordinator.prototype.snapshot.call(coordinator)),'utf8');
  }catch{return deny('INVALID_CHECKPOINT');}
  if(!publishedState.equals(bytes))return deny('INVALID_CHECKPOINT');
  // Do NOT return success from inside the try: the finally block below
  // still awaits filesystem cleanup, during which a legitimate cancellation
  // can turn a saved QUEUED snapshot into a stale success receipt.
 }catch{return deny('IO_FAILURE');}
 finally{
  if(staging&&ownedStaging&&
     await stillOwnStagingFile(directory,staging,start,ownedStaging))
   await rm(staging,{force:true}).catch(()=>undefined);
  if(acquired&&ownedLock&&await stillOwnWriterLock(directory,start,ownedLock)){
   try{await rmdir(lock);releasedOwnedLock=true;}
   catch{/* Retain unknown or busy lock evidence; never steal/delete it. */}
  }
 }
 // An unresolved owned lock blocks all subsequent saves/restarts. Even if
 // rmdir returned, refuse success when a new competing lock appeared.
 // Neither failure changes the already-published journal; recovery is manual.
 if(!releasedOwnedLock)return deny('BUSY');
 try{
  if(await writerLockExists(directory))return deny('BUSY');
  // Releasing the writer mutex awaits filesystem I/O. An external editor
  // can rewrite or replace the already-published checkpoint during release.
  // Refuse an apparently durable receipt unless the SAME published inode
  // and exact bytes remain after mutex cleanup. This is a bounded snapshot,
  // not an atomic external-process lock or permission to overwrite evidence.
  const finalRead=await boundedRead(target);
  const finalPath=await lstat(target,{bigint:true});
  const finalDirectory=await checkedDirectory(directory);
  if(!publishedIdentity||!finalRead||!finalDirectory||
     !sameDir(start,finalDirectory)||
     !sameFile(publishedIdentity,finalRead.file)||
     !sameFile(finalRead.file,finalPath)||
     !finalRead.bytes.equals(bytes))return deny('INVALID_CHECKPOINT');
  if(await writerLockExists(directory))return deny('BUSY');
 }catch{return deny('IO_FAILURE');}
 // No further asynchronous suspension after this last native snapshot.
 // Cancellation during any awaited cleanup must invalidate the receipt.
 // This is a same-process check, not an atomic cross-process journal.
 let afterCleanup:Buffer;
 try{
  afterCleanup=Buffer.from(JSON.stringify(
   ReadOnlyBatchCoordinator.prototype.snapshot.call(coordinator)),'utf8');
 }catch{return deny('INVALID_CHECKPOINT');}
 if(!afterCleanup.equals(bytes))return deny('INVALID_CHECKPOINT');
 return Object.freeze({status:'CHECKPOINT_SAVED_UNVERIFIED' as const,
  sha256:createHash('sha256').update(bytes).digest('hex')});
}
/** Load only through the existing exact schema, SHA identity and timeout
 * validator. The returned coordinator remains unverified scheduling state.
 */
export async function loadReadOnlyBatchJournal(
 directory:string,options:ConstructorParameters<typeof ReadOnlyBatchCoordinator>[0],
 worker:ReadOnlyWorker
):Promise<BatchJournalLoadResult>{
 if(!validPath(directory))return deny('UNSAFE_PATH');
 let parent:Identity|null;
 try{parent=await checkedDirectory(directory);}catch{return deny('UNSAFE_PATH');}
 if(!parent)return deny('UNSAFE_PATH');
 const target=join(directory,BATCH_JOURNAL_FILENAME);
 try{
  // Do not consume an old snapshot while a different native process holds
  // the writer lock; a previous fully valid version could be superseded.
  if(await writerLockExists(directory))return deny('BUSY');
  const before=await lstat(target,{bigint:true});
  if(before.isSymbolicLink()||!before.isFile()||before.nlink!==1n)
   return deny('INVALID_CHECKPOINT');
  const loaded=await boundedRead(target);
  const after=await lstat(target,{bigint:true});
  const parentAfter=await checkedDirectory(directory);
  if(!parentAfter||!sameDir(parent,parentAfter))return deny('UNSAFE_PATH');
  if(await writerLockExists(directory))return deny('BUSY');
  if(!loaded||!sameFile(before,loaded.file)||!sameFile(loaded.file,after))
   return deny('INVALID_CHECKPOINT');
  let parsed:unknown;
  try{parsed=JSON.parse(loaded.bytes.toString('utf8'));}
  catch{return deny('INVALID_CHECKPOINT');}
  try{
   const coordinator=new ReadOnlyBatchCoordinator(options,worker,parsed);
   return Object.freeze({status:'CHECKPOINT_RESTORED_SCHEDULING_ONLY' as const,
    coordinator});
  }catch{return deny('INVALID_CHECKPOINT');}
 }catch(error){
  if((error as NodeJS.ErrnoException).code==='ENOENT')return deny('NOT_FOUND');
  return deny('IO_FAILURE');
 }
}

/** TASK-013 / REQ-022 / TEST-022: opt-in durable scheduling of an already
 * trusted, read-only native batch. Persist the RUNNING attempt before calling
 * its worker and each settlement before dispatching the next item.
 *
 * The existing checkpoint is an unauthenticated scheduling hint. This helper
 * therefore deliberately supports only one concurrent read-only worker;
 * it is NOT durable transaction execution, exactly-once side effects, user
 * consent, Tampermonkey attestation, script modification or auto-rollback.
 * If a journal write fails, no further work is dispatched. A crash can
 * replay the last RUNNING read-only operation within its bounded retry limit.
 */
export type CheckpointedReadOnlyBatchResult=
 |Readonly<{status:'BATCH_SETTLED_CHECKPOINTED_UNVERIFIED';
    snapshot:ReadOnlyBatchSnapshot}>
 |Readonly<{status:'BLOCKED';reason:BatchJournalFailure}>;

export async function runCheckpointedReadOnlyBatch(
 directory:string,coordinator:ReadOnlyBatchCoordinator,
 onDurableTransition?:(snapshot:ReadOnlyBatchSnapshot)=>void
):Promise<CheckpointedReadOnlyBatchResult>{
 if(!ReadOnlyBatchCoordinator.isNativeInstance(coordinator))
  return deny('INVALID_INPUT');
 let current:ReadOnlyBatchSnapshot;
 try{current=ReadOnlyBatchCoordinator.prototype.snapshot.call(coordinator);}
 catch{return deny('INVALID_INPUT');}
 // Do not silently fall back to a non-durable run or race two writers.
 if(current.concurrency!==1||!current.batchFingerprint||
    !/^[0-9a-f]{64}$/.test(current.batchFingerprint))
  return deny('INVALID_INPUT');
 // Claim the coordinator BEFORE the initial asynchronous save. Otherwise an
 // ordinary run() can start a worker while the first checkpoint is pending.
 const ticket=ReadOnlyBatchCoordinator.prototype.reserveCheckpointedRun.call(coordinator);
 if(ticket===null)return deny('BUSY');
 try{
  const initial=await saveReadOnlyBatchJournal(directory,coordinator);
  if(initial.status==='BLOCKED')return initial;
  let saveFailure:BatchJournalFailure='IO_FAILURE';
  try{
   const final=await ReadOnlyBatchCoordinator.prototype.run.call(
    coordinator,async()=>{
     const saved=await saveReadOnlyBatchJournal(directory,coordinator);
     if(saved.status==='BLOCKED'){
      saveFailure=saved.reason;
      throw Error('BATCH_CHECKPOINT_WRITE_FAILED');
     }
     // Advisory UI progress belongs only to an actually saved checkpoint.
     // No status callback can authorize repair or invalidate the batch.
     try{onDurableTransition?.(
      ReadOnlyBatchCoordinator.prototype.snapshot.call(coordinator));}
     catch{/* Native progress observers cannot change the journal result. */}
    },ticket
   );
   return Object.freeze({
    status:'BATCH_SETTLED_CHECKPOINTED_UNVERIFIED' as const,
    snapshot:final
   });
  }catch{
   // The run loop has already stopped further dispatch on a failed write.
   // Never report its in-memory outcome as a durable success receipt.
   return deny(saveFailure);
  }
 }finally{
  // A rejected initial save must not strand the coordinator in BUSY state.
  // This is a same-process reservation, not an OS lock or transaction.
  ReadOnlyBatchCoordinator.prototype.releaseCheckpointedRun.call(coordinator,ticket);
 }
}
