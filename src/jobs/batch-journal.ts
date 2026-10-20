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
import {lstat,mkdir,open,rename,rm,rmdir} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import {hasUnsafePathLink} from '../version/path-boundary';
import {ReadOnlyBatchCoordinator,type ReadOnlyWorker} from './batch-coordinator';

export type BatchJournalFailure='INVALID_INPUT'|'UNSAFE_PATH'|'BUSY'|'NOT_FOUND'|'INVALID_CHECKPOINT'|'IO_FAILURE';
export type BatchJournalSaveResult=
 |Readonly<{status:'CHECKPOINT_SAVED_UNVERIFIED';sha256:string}>
 |Readonly<{status:'BLOCKED';reason:BatchJournalFailure}>;
export type BatchJournalLoadResult=
 |Readonly<{status:'CHECKPOINT_RESTORED_SCHEDULING_ONLY';coordinator:ReadOnlyBatchCoordinator}>
 |Readonly<{status:'BLOCKED';reason:BatchJournalFailure}>;
export const BATCH_JOURNAL_FILENAME='uah-readonly-batch-v2.json';
const MAX_JOURNAL_BYTES=160000;
const deny=(reason:BatchJournalFailure)=>Object.freeze({status:'BLOCKED' as const,reason});
type Identity={dev:bigint;ino:bigint;size:bigint;mtimeNs:bigint;ctimeNs:bigint};
const sameDir=(a:Identity,b:Identity)=>a.dev===b.dev&&a.ino===b.ino;
const sameFile=(a:Identity,b:Identity)=>sameDir(a,b)&&a.size===b.size&&
 a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
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
 if(!coordinator||Object.getPrototypeOf(coordinator)!==ReadOnlyBatchCoordinator.prototype)
  return deny('INVALID_INPUT');
 const snapshot=coordinator.snapshot();
 if(!snapshot.batchFingerprint||!(/^[0-9a-f]{64}$/).test(snapshot.batchFingerprint))
  return deny('INVALID_INPUT');
 if(!validPath(directory))return deny('UNSAFE_PATH');
 let start:Identity|null;
 try{start=await checkedDirectory(directory);}catch{return deny('UNSAFE_PATH');}
 if(!start)return deny('UNSAFE_PATH');
 const bytes=Buffer.from(JSON.stringify(snapshot),'utf8');
 if(bytes.length===0||bytes.length>MAX_JOURNAL_BYTES)return deny('INVALID_INPUT');
 const target=join(directory,BATCH_JOURNAL_FILENAME);
 const lock=join(directory,'.uah-readonly-batch-v2.lock');
 let acquired=false,staging:string|undefined;
 try{
  try{await mkdir(lock,{mode:0o700});acquired=true;}
  catch(error){
   if((error as NodeJS.ErrnoException).code==='EEXIST')return deny('BUSY');
   return deny('IO_FAILURE');
  }
  if(!sameDir(start,await checkedDirectory(directory) as Identity))
   return deny('UNSAFE_PATH');
  try{
   const existing=await lstat(target,{bigint:true});
   if(!existing.isFile()||existing.isSymbolicLink()||existing.nlink!==1n)
    return deny('INVALID_CHECKPOINT');
  }catch(error){
   if((error as NodeJS.ErrnoException).code!=='ENOENT')return deny('IO_FAILURE');
  }
  staging=join(directory,'.uah-readonly-batch-'+randomUUID()+'.tmp');
  const handle=await open(staging,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  const current=await checkedDirectory(directory);
  if(!current||!sameDir(start,current))return deny('UNSAFE_PATH');
  await rename(staging,target);
  staging=undefined;
  const stored=await boundedRead(target);
  const finalDir=await checkedDirectory(directory);
  if(!stored||!finalDir||!sameDir(start,finalDir)||
     !stored.bytes.equals(bytes))return deny('IO_FAILURE');
  return Object.freeze({status:'CHECKPOINT_SAVED_UNVERIFIED' as const,
   sha256:createHash('sha256').update(bytes).digest('hex')});
 }catch{return deny('IO_FAILURE');}
 finally{
  if(staging)await rm(staging,{force:true}).catch(()=>undefined);
  if(acquired)await rmdir(lock).catch(()=>undefined);
 }
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
  const before=await lstat(target,{bigint:true});
  if(before.isSymbolicLink()||!before.isFile()||before.nlink!==1n)
   return deny('INVALID_CHECKPOINT');
  const loaded=await boundedRead(target);
  const after=await lstat(target,{bigint:true});
  const parentAfter=await checkedDirectory(directory);
  if(!parentAfter||!sameDir(parent,parentAfter))return deny('UNSAFE_PATH');
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
