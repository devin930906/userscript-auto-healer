/**
 * TASK-011 / REQ-020/021 / TEST-020/021/026.
 * Privileged-native, explicitly MANUAL original-file restoration only.
 *
 * This operation is NOT available through renderer IPC and is not permission
 * for automatic patch application, manager updates or business attestation.
 * Callers must independently authenticate the native selection and user's
 * explicit restore instruction. Boolean inputs are only boundary claims.
 *
 * A verified backup of the displaced version and an fsynced intent record are
 * retained BEFORE replacement. This is not a power-loss-proof recovery journal
 * on all Windows filesystems, and no independent editor is locked by mkdir.
 * Future product integration must add trusted consent and recovery UI.
 */
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import type {BigIntStats} from 'node:fs';
import {types as nodeTypes} from 'node:util';
import {link,lstat,mkdir,open,readdir,realpath,rename,rmdir,unlink} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
import {MAX_SCRIPT_BYTES} from '../import/import-service';
import {verifyApprovedSourceFingerprint} from './source-snapshot';
import {verifyBackupRecoverySource} from './recovery-source';
import {createVerifiedBackupOnly} from './verified-backup';
import {verifyExactCandidateBytesReadOnly} from './candidate-bytes';
import {hasUnsafePathLink} from './path-boundary';
import {hasInterruptedRestoreStaging} from './restore-staging-residue';
import {hasPriorPublishedRestoreIntentForSource} from './restore-intent-inspection';

type Reason='INVALID_REQUEST'|'NOT_AUTHORIZED'|'SOURCE_UNCHANGED'|
 'SOURCE_UNVERIFIED'|'BACKUP_UNVERIFIED'|'SOURCE_LOCKED'|
 'UNSAFE_PATH'|'RECOVERY_SAFETY_FAILED'|'RECOVERY_REVIEW_REQUIRED'|'IO_FAILURE'|'CANCELLED';
const noAuthority={
 automaticPatchAllowed:false as const,automaticRollbackAllowed:false as const,
 tampermonkeyVerified:false as const,businessVerified:false as const
};
export type NativeOriginalRestoreResult=
 |Readonly<{status:'BLOCKED';reason:Reason}&typeof noAuthority>
 |Readonly<{status:'RESTORED_NATIVE_ONLY';
    originalSha256:string;displacedSha256:string;
    displacedBackupFileName:string;journalFileName:string;
  }&typeof noAuthority>;
const block=(reason:Reason):NativeOriginalRestoreResult=>
 Object.freeze({status:'BLOCKED' as const,reason,...noAuthority});
type Input={
 sourcePath:string;backupDirectory:string;backupFileName:string;
 expectedCurrentSha256:string;expectedOriginalSha256:string;
 expectedOriginalByteLength:number;userApproved:boolean;manualRestoreApproved:boolean
};
const fields=[
 'sourcePath','backupDirectory','backupFileName',
 'expectedCurrentSha256','expectedOriginalSha256',
 'expectedOriginalByteLength','userApproved','manualRestoreApproved'
] as const;
const SHA=/^[0-9a-f]{64}$/;
function parse(input:unknown):Input|null{
 try{
  if(!input||typeof input!=='object'||Array.isArray(input)||
     nodeTypes.isProxy(input))return null;
  const proto=Object.getPrototypeOf(input);
  if(proto!==Object.prototype&&proto!==null)return null;
  const desc=Object.getOwnPropertyDescriptors(input);
  const keys=Reflect.ownKeys(desc);
  if(keys.length!==fields.length||keys.some(k=>typeof k!=='string')||
     fields.some(k=>!Object.prototype.hasOwnProperty.call(desc,k)||
       !Object.prototype.hasOwnProperty.call(desc[k],'value')))return null;
  const x:Record<string,unknown>=Object.create(null);
  for(const field of fields)x[field]=desc[field].value;
  if(typeof x.sourcePath!=='string'||typeof x.backupDirectory!=='string'||
     typeof x.backupFileName!=='string'||typeof x.userApproved!=='boolean'||
     typeof x.manualRestoreApproved!=='boolean'||
     typeof x.expectedCurrentSha256!=='string'||
     typeof x.expectedOriginalSha256!=='string'||
     !SHA.test(x.expectedCurrentSha256)||!SHA.test(x.expectedOriginalSha256)||
     !Number.isSafeInteger(x.expectedOriginalByteLength)||
     (x.expectedOriginalByteLength as number)<=0||
     (x.expectedOriginalByteLength as number)>MAX_SCRIPT_BYTES||
     !isAbsolute(x.sourcePath)||!isAbsolute(x.backupDirectory)||
     x.sourcePath!==resolve(x.sourcePath)||
     x.backupDirectory!==resolve(x.backupDirectory)||
     x.sourcePath.length>4096||x.backupDirectory.length>4096||
     x.sourcePath.includes('\0')||x.backupDirectory.includes('\0')||
     !/^[^\\/\u0000-\u001f]+\.user\.js$/i.test(basename(x.sourcePath))||
     x.backupFileName.length===0||x.backupFileName.length>255)
    return null;
  return x as Input;
 }catch{return null;}
}
function sameDirectory(a:BigIntStats,b:BigIntStats):boolean{
 return a.dev===b.dev&&a.ino===b.ino;
}
function sameFile(a:BigIntStats,b:BigIntStats):boolean{
 return sameDirectory(a,b)&&a.size===b.size&&
  a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
}
/**
 * A cooperative path mutex cannot protect against an external process that
 * removes or replaces its directory. Before touching the selected original,
 * verify that the lock still names the SAME directory obtained by this
 * transaction. This is a snapshot check, not an OS-enforced exclusive lock
 * or proof of resistance to a final-check/rename race.
 */
export async function stillOwnNativeRestorePathLock(
 lockPath:string,originalLock:BigIntStats
):Promise<boolean>{
 try{
  // A redirected ancestor can still reach the SAME lock inode. Reject
  // lexical aliases, symlinks and junctions before trusting its identity.
  if(await hasUnsafePathLink(lockPath))return false;
  const current=await lstat(lockPath,{bigint:true});
  return current.isDirectory()&&!current.isSymbolicLink()&&
    sameDirectory(originalLock,current);
 }catch{return false;}
}
/** A successful mutex release does not guarantee the canonical path
 * stays unlocked. Another independent restore can acquire it during the
 * asynchronous post-release evidence checks; reject a stale success receipt.
 * This remains a read-only snapshot, not a new OS-enforced reservation.
 */
async function restorePathUnclaimed(lockPath:string):Promise<boolean>{
 try{
  await lstat(lockPath);
  return false;
 }catch(error){
  return (error as NodeJS.ErrnoException).code==='ENOENT';
 }
}
/** Check that the published restore-intent pathname STILL refers to the
 * single-link file actually published by this transaction, in the same
 * original recovery store. Identical JSON bytes are not proof of ownership:
 * an external process may replace the inode without changing any digest.
 * This is a bounded snapshot, not an OS-exclusive cross-process file lock.
 */
async function stillOwnPublishedRestoreIntent(
 path:string,published:BigIntStats,ownedDirectory:BigIntStats
):Promise<boolean>{
 try{
  if(await hasUnsafePathLink(path))return false;
  const dir=await lstat(dirname(path),{bigint:true});
  const file=await lstat(path,{bigint:true});
  return dir.isDirectory()&&!dir.isSymbolicLink()&&
   sameDirectory(dir,ownedDirectory)&&
   file.isFile()&&!file.isSymbolicLink()&&file.nlink===1n&&
   sameFile(published,file);
 }catch{return false;}
}
/**
 * TASK-011 / TEST-020/026: best-effort cleanup of ONLY the staging inode
 * created by this restore. A malicious/accidental rename at the .pending
 * pathname must not turn error cleanup into deletion of somebody else's
 * replacement file. No user-supplied paths are exposed through renderer IPC.
 *
 * This is a filesystem identity snapshot, not a handle-based guarantee
 * against a swap between the final lstat and unlink.
 */
export async function removeOwnedNativeRestorePending(
 pendingPath:string,owned:BigIntStats,parentOwned:BigIntStats
):Promise<boolean>{
 try{
  if(!isAbsolute(pendingPath)||pendingPath!==resolve(pendingPath)||
     !/^\.uah-restore-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pending$/.test(
      basename(pendingPath))||await hasUnsafePathLink(pendingPath))return false;
  const parent=await lstat(dirname(pendingPath),{bigint:true});
  if(!parent.isDirectory()||parent.isSymbolicLink()||
     !sameDirectory(parent,parentOwned))return false;
  const file=await lstat(pendingPath,{bigint:true});
  if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1n||
     !sameFile(file,owned))return false;
  await unlink(pendingPath);
  return true;
 }catch{return false;}
}
/**
 * TASK-011 / TEST-020/026: published journal links temporarily share one
 * inode. Retire its staging name only while BOTH paths still identify that
 * inode inside the original recovery directory. link() changes ctime,
 * so compare pre-link inode, size and mtime instead of pre-link ctime.
 * This is a fail-closed snapshot, not an atomic OS filesystem handle.
 */
export async function removeOwnedPublishedJournalPending(
 pendingPath:string,publishedPath:string,staged:BigIntStats,
 parentOwned:BigIntStats
):Promise<boolean>{
 try{
  const id='[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  // A matching inode is not enough: the hard links must name one journal ID.
  const pendingName=basename(pendingPath).match(
    new RegExp('^\\.uah-restore-('+id+')\\.pending$'));
  const publishedName=basename(publishedPath).match(
    new RegExp('^\\.uah-restore-('+id+')\\.journal\\.json$'));
  if(!isAbsolute(pendingPath)||pendingPath!==resolve(pendingPath)||
     !isAbsolute(publishedPath)||publishedPath!==resolve(publishedPath)||
     dirname(pendingPath)!==dirname(publishedPath)||
     !pendingName||!publishedName||pendingName[1]!==publishedName[1]||
     staged.nlink!==1n||
     await hasUnsafePathLink(pendingPath)||
     await hasUnsafePathLink(publishedPath))return false;
  const parent=await lstat(dirname(pendingPath),{bigint:true});
  if(!parent.isDirectory()||parent.isSymbolicLink()||
     !sameDirectory(parent,parentOwned))return false;
  const pending=await lstat(pendingPath,{bigint:true});
  const published=await lstat(publishedPath,{bigint:true});
  if(!pending.isFile()||pending.isSymbolicLink()||
     !published.isFile()||published.isSymbolicLink()||
     pending.nlink!==2n||published.nlink!==2n||
     !sameDirectory(pending,staged)||!sameDirectory(pending,published)||
     pending.size!==staged.size||pending.size!==published.size||
     pending.mtimeNs!==staged.mtimeNs||
     pending.mtimeNs!==published.mtimeNs)return false;
  await unlink(pendingPath);
  return true;
 }catch{return false;}
}
/** Snapshot the independently published backup with descriptor + path
 * identity and a bounded SHA-256 check, not an unbounded readFile().
 */
async function recoveryBytes(path:string,length:number,sha:string):Promise<Buffer|null>{
 try{
  if(await hasUnsafePathLink(path))return null;
  const before=await lstat(path,{bigint:true});
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||
     before.size!==BigInt(length))return null;
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
   const opened=await handle.stat({bigint:true});
   if(!opened.isFile()||opened.nlink!==1n||!sameFile(before,opened))return null;
   const chunks:Buffer[]=[];
   let lengthRead=0;
   const chunk=Buffer.allocUnsafe(65536);
   while(true){
    const {bytesRead}=await handle.read(chunk,0,
      Math.min(chunk.length,length-lengthRead+1),null);
    if(bytesRead===0)break;
    lengthRead+=bytesRead;
    if(lengthRead>length)return null;
    chunks.push(Buffer.from(chunk.subarray(0,bytesRead)));
   }
   const after=await handle.stat({bigint:true});
   const byPath=await lstat(path,{bigint:true});
   if(lengthRead!==length||!sameFile(before,after)||!sameFile(after,byPath)||
      byPath.isSymbolicLink()||byPath.nlink!==1n||
      await hasUnsafePathLink(path))return null;
   const bytes=Buffer.concat(chunks,length);
   return createHash('sha256').update(bytes).digest('hex')===sha?bytes:null;
  }finally{await handle.close();}
 }catch{return null;}
}
/**
 * Restores only an independently preserved original to the native-selected
 * source, never a newly proposed candidate. If a post-rename check fails,
 * retain BOTH backups and the intent journal; do not auto-repeat/overwrite.
 * A successful native restore does not verify Tampermonkey or its GM/behavior.
 */
/** Internal native-only revocation. No renderer-provided signal can
 * authorize or cancel a write; only genuine native AbortSignal slots pass.
 * Cancellation cannot undo a rename once the OS operation has started.
 */
function nativeRestoreAbortSignal(value:unknown):value is AbortSignal{
 try{
  if(!value||typeof value!=='object'||nodeTypes.isProxy(value)||
     Object.getPrototypeOf(value)!==AbortSignal.prototype||
     ['aborted','addEventListener','removeEventListener'].some(name=>
       Object.prototype.hasOwnProperty.call(value,name)))return false;
  const getter=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted')?.get;
  return typeof getter==='function'&&typeof getter.call(value)==='boolean';
 }catch{return false;}
}
export async function restoreVerifiedOriginalNativeOnly(
 untrustedOptions:unknown,signal?:AbortSignal
):Promise<NativeOriginalRestoreResult>{
 if(signal!==undefined&&!nativeRestoreAbortSignal(signal))
  return block('INVALID_REQUEST');
 if(signal?.aborted)return block('CANCELLED');
 const opts=parse(untrustedOptions);
 if(!opts)return block('INVALID_REQUEST');
 if(!opts.userApproved||!opts.manualRestoreApproved)return block('NOT_AUTHORIZED');
 if(opts.expectedCurrentSha256===opts.expectedOriginalSha256)
  return block('SOURCE_UNCHANGED');
 const parent=dirname(opts.sourcePath);
 // Windows default file lookup is case-insensitive. Hashing the raw spelling
 // would let two aliases to one .user.js acquire DISTINCT mutex directories.
 // Coalesce case aliases conservatively; this is not an OS file handle lock
 // and does not authenticate other aliases (8.3 names or file hard links).
 const lockIdentity=process.platform==='win32'?
  opts.sourcePath.toLowerCase():opts.sourcePath;
 const lock=join(parent,'.uah-restore-path-'+createHash('sha256')
  .update(lockIdentity,'utf8').digest('hex'));
 let owner:BigIntStats|undefined;
 let acquired=false;
 // A renamed original is not a clean receipt until the restore path mutex
 // itself has been released. A stranded mutex blocks subsequent recovery.
 let completedRestore:NativeOriginalRestoreResult|undefined;
 let lockReleased=false;
 // Release of the cooperative mutex is asynchronous. Keep independent
 // receipt evidence so a late external write cannot be acknowledged as good.
 let receiptSource:BigIntStats|undefined;
 let receiptJournal:Readonly<{path:string;bytes:Buffer}>|undefined;
 let receiptDisplaced:Readonly<{fileName:string;byteLength:number}>|undefined;
 let pending:string|undefined;
 let journalPending:string|undefined;
 let pendingIdentity:BigIntStats|undefined;
 let journalPendingIdentity:BigIntStats|undefined;
 // Capture AFTER the staging hard link is retired: link/unlink change ctime.
 let publishedJournalIdentity:BigIntStats|undefined;
 let pendingParentIdentity:BigIntStats|undefined;
 let journalParentIdentity:BigIntStats|undefined;
 try{
  if(await hasUnsafePathLink(opts.sourcePath)||
     await hasUnsafePathLink(opts.backupDirectory))return block('UNSAFE_PATH');
  const parentStart=await lstat(parent,{bigint:true});
  const directoryStart=await lstat(opts.backupDirectory,{bigint:true});
  const sourceStart=await lstat(opts.sourcePath,{bigint:true});
  if(!parentStart.isDirectory()||parentStart.isSymbolicLink()||
     !directoryStart.isDirectory()||directoryStart.isSymbolicLink()||
     // A manual restore cannot use its own source folder as the separate
     // backup/recovery store: a same-inode alias must fail BEFORE
     // acquiring a lock or publishing a displaced version or intent.
     sameDirectory(parentStart,directoryStart)||
     !sourceStart.isFile()||sourceStart.isSymbolicLink()||
     sourceStart.nlink!==1n||sourceStart.size<=0n||
     sourceStart.size>BigInt(MAX_SCRIPT_BYTES)||
     // Never replace a deliberately read-only source, even if the current
     // process has elevated rights. Refuse BEFORE creating any backup/journal.
     (sourceStart.mode&0o222n)===0n)return block('UNSAFE_PATH');
  // Prior interrupted restorations may leave unpublished staging bytes in
  // the source parent or a recovery-intent pending file in the backup store.
  // These files require independent manual reconciliation, not another write.
  // Check both BEFORE acquiring this transaction's lock or creating backups.
  if(await hasInterruptedRestoreStaging(parent)||
     await hasInterruptedRestoreStaging(opts.backupDirectory))
   return block('RECOVERY_REVIEW_REQUIRED');
  // Capture the actual directories, not only names used during cleanup.
  pendingParentIdentity=parentStart;
  journalParentIdentity=directoryStart;

  // Lock the CANONICAL PATH, not the inode: a successful atomic rename
  // necessarily changes the inode and must not change the lock identity.
  try{await mkdir(lock,{mode:0o700});acquired=true;}
  catch(e){
   if((e as NodeJS.ErrnoException).code==='EEXIST')
    return block('SOURCE_LOCKED');
   return block('IO_FAILURE');
  }
  owner=await lstat(lock,{bigint:true});
  if(signal?.aborted)return block('CANCELLED');
  if(!owner.isDirectory()||owner.isSymbolicLink())
   return block('SOURCE_LOCKED');
  // Recovery journals bind the exact original source-path bytes. Windows
  // resolves differently cased parent directory names to the same native
  // source, so the old journal can be bypassed even with a canonical script
  // filename. Check the source AND its directly selected parent before any
  // backups, intent publication or overwrite.
  //
  // Do NOT demand that the entire realpath string match: Windows can rewrite
  // older temp/environment ancestors and drive prefix for otherwise valid
  // native selections. More distant ancestor aliases remain a separately
  // unresolved provenance risk requiring a compatible identity design.
  if(process.platform==='win32'){
   try{
    if(basename(await realpath(opts.sourcePath))!==basename(opts.sourcePath)||
       basename(await realpath(parent))!==basename(parent))
     return block('UNSAFE_PATH');
    // On Windows a direct parent spelled as an 8.3 alias can resolve while
    // realpath() retains that short spelling. A recovery intent indexed by
    // raw source-path bytes would then use a different key for the same file.
    // Reject an UNLISTED short-shaped parent before publishing a journal;
    // keep genuinely named FOO~1 directories eligible when listed exactly.
    const selectedParentName=basename(parent);
    const shortStem=selectedParentName.split('.')[0];
    const shortParentShaped=shortStem.length<=8&&
      /^[^~.\\/]{1,6}~[1-9][0-9]*$/.test(shortStem)&&
      (selectedParentName===shortStem||
       (selectedParentName[shortStem.length]==='.'&&
        /^[^.\\/]{1,3}$/.test(
          selectedParentName.slice(shortStem.length+1))));
    if(shortParentShaped&&
       !(await readdir(dirname(parent))).includes(selectedParentName))
      return block('UNSAFE_PATH');
    // The script and direct parent may match their exact names while a
    // grandparent differs ONLY in letter case. A published journal hashes the
    // original path string, so that alternate spelling would evade an
    // unresolved restore intent. Compare higher ancestor names with their
    // native directory entries. Reject established case-only mismatches
    // at every ancestor; also reject an unlisted short 8.3 spelling at the
    // selected source's immediate grandparent only. Higher Windows runner
    // temp/virtual aliases remain unresolved rather than breaking valid
    // native restore operations across unrelated environment ancestors.
    for(let ancestor=dirname(parent);dirname(ancestor)!==ancestor;
        ancestor=dirname(ancestor)){
     const expectedName=basename(ancestor);
     const names=await readdir(dirname(ancestor));
     // A short 8.3 alias may resolve to an existing long-name directory
     // while hashing to a different raw-path restore intent and mutex.
     // Only reject an UNLISTED short-name shape; a literal FOO~1 directory
     // stays eligible when the actual parent enumeration lists FOO~1.
     const stem=expectedName.split('.')[0];
     // Limit this new check to the directly selected source's grandparent.
     // Hosted Windows temporary roots can themselves use unlisted 8.3
     // spellings; rewriting that established environment-wide authority is
     // outside this bounded, source-local guard.
     const shortAliasShaped=ancestor===dirname(parent)&&stem.length<=8&&
       /^[^~.\\/]{1,6}~[1-9][0-9]*$/.test(stem)&&
       (expectedName===stem||
        (expectedName[stem.length]==='.'&&
         /^[^.\\/]{1,3}$/.test(expectedName.slice(stem.length+1))));
     if(!names.includes(expectedName)&&
        (shortAliasShaped||
         names.some(name=>name.toLowerCase()===expectedName.toLowerCase())))
      return block('UNSAFE_PATH');
    }
   }catch{return block('UNSAFE_PATH');}
  }
  // A published intent from an earlier attempt remains unreconciled even
  // when its JSON is structurally sound. The source-path lock is held, so
  // another cooperating restore cannot publish a conflicting journal
  // while we check this exact source's recovery namespace.
  if(await hasPriorPublishedRestoreIntentForSource(
    opts.sourcePath,opts.backupDirectory))
   return block('RECOVERY_REVIEW_REQUIRED');
  const sourceInput={
   sourcePath:opts.sourcePath,
   expectedSha256:opts.expectedCurrentSha256,userApproved:true
  };
  const originalInput={
   sourcePath:opts.sourcePath,backupDirectory:opts.backupDirectory,
   backupFileName:opts.backupFileName,
   expectedSha256:opts.expectedOriginalSha256,
   expectedByteLength:opts.expectedOriginalByteLength,userApproved:true
  };
  const current=await verifyApprovedSourceFingerprint(sourceInput);
  if(current.status!=='MATCHED_READ_ONLY')return block('SOURCE_UNVERIFIED');
  const backup=await verifyBackupRecoverySource(originalInput);
  if(backup.status!=='RECOVERY_SOURCE_VERIFIED_READ_ONLY')
   return block('BACKUP_UNVERIFIED');

  if(signal?.aborted)return block('CANCELLED');
  // Preserve the version that is about to be displaced. This itself uses
  // a separate source-inode mutex; the path-based restore lock remains held.
  const displaced=await createVerifiedBackupOnly({
   sourcePath:opts.sourcePath,backupDirectory:opts.backupDirectory,
   expectedSha256:opts.expectedCurrentSha256,userApproved:true
  });
  if(displaced.status!=='BACKUP_ONLY')
   return block('RECOVERY_SAFETY_FAILED');
  const displacedInput={
   sourcePath:opts.sourcePath,backupDirectory:opts.backupDirectory,
   backupFileName:displaced.backupFileName,
   expectedSha256:opts.expectedCurrentSha256,
   expectedByteLength:displaced.byteLength,userApproved:true
  };
  if((await verifyBackupRecoverySource(displacedInput)).status!==
      'RECOVERY_SOURCE_VERIFIED_READ_ONLY')
   return block('RECOVERY_SAFETY_FAILED');
  const bytes=await recoveryBytes(join(opts.backupDirectory,opts.backupFileName),
   opts.expectedOriginalByteLength,opts.expectedOriginalSha256);
  if(!bytes)return block('BACKUP_UNVERIFIED');

  pending=join(parent,'.uah-restore-'+randomUUID()+'.pending');
  const handle=await open(pending,'wx',0o600);
  try{
   await handle.writeFile(bytes);
   // A 0600 temp could silently strip the selected script's permission
   // mode after rename. Preserve the original source mode on the staged
   // inode, before fsync and verification. This does not assert NTFS ACL
   // parity, which still requires independent Windows security review.
   await handle.chmod(Number(sourceStart.mode&0o777n));
   await handle.sync();
   pendingIdentity=await handle.stat({bigint:true});
  }finally{await handle.close();}
  if(await verifyExactCandidateBytesReadOnly(pending,bytes)!=='MATCH')
   return block('RECOVERY_SAFETY_FAILED');

  // An intent record is persisted BEFORE touching the source name.
  // It contains no absolute paths, source text, URL or claimed verification.
  // Same ID for the staging hard link and its published journal path.
  const journalId=randomUUID();
  const journalFileName='.uah-restore-'+journalId+'.journal.json';
  const journalPath=join(opts.backupDirectory,journalFileName);
  const journal=Buffer.from(JSON.stringify({
   schema:1,state:'RESTORE_INTENT_UNVERIFIED',
   sourcePathSha256:createHash('sha256').update(opts.sourcePath).digest('hex'),
   originalSha256:opts.expectedOriginalSha256,
   displacedSha256:opts.expectedCurrentSha256,
   originalBackupFileName:opts.backupFileName,
   displacedBackupFileName:displaced.backupFileName,
   automaticPatchAllowed:false,automaticRollbackAllowed:false
  })+'\n');
  // Never expose a partial journal under the final recovery name. A crash
  // while writing leaves at most a clearly uncommitted .pending file; only a
  // completely fsynced and byte-verified record is published by a no-clobber
  // same-directory hard link. This is NOT a full power-loss fsync guarantee.
  journalPending=join(opts.backupDirectory,'.uah-restore-'+journalId+'.pending');
  const j=await open(journalPending,'wx',0o600);
  try{
   await j.writeFile(journal);
   await j.sync();
   journalPendingIdentity=await j.stat({bigint:true});
  }finally{await j.close();}
  if(await verifyExactCandidateBytesReadOnly(journalPending,journal)!=='MATCH')
   return block('RECOVERY_SAFETY_FAILED');
  if(await hasUnsafePathLink(opts.backupDirectory))return block('UNSAFE_PATH');
  const journalDirectory=await lstat(opts.backupDirectory,{bigint:true});
  if(!journalDirectory.isDirectory()||journalDirectory.isSymbolicLink()||
     !sameDirectory(directoryStart,journalDirectory))
   return block('UNSAFE_PATH');
  await link(journalPending,journalPath);
  // Do not delete an unknown replacement at the staging pathname.
  if(!journalPendingIdentity||!journalParentIdentity||
     !await removeOwnedPublishedJournalPending(
       journalPending,journalPath,journalPendingIdentity,journalParentIdentity))
    return block('RECOVERY_SAFETY_FAILED');
  journalPending=undefined;
  // Bind future acceptance to the actual fsynced file published by our
  // no-clobber hard link. The pre-link staging ctime cannot be reused here.
  const publishedJournal=await lstat(journalPath,{bigint:true});
  if(!journalPendingIdentity||!publishedJournal.isFile()||
     publishedJournal.isSymbolicLink()||publishedJournal.nlink!==1n||
     !sameDirectory(journalPendingIdentity,publishedJournal))
   return block('RECOVERY_SAFETY_FAILED');
  publishedJournalIdentity=publishedJournal;
  if(signal?.aborted)return block('CANCELLED');
  if(await verifyExactCandidateBytesReadOnly(journalPath,journal)!=='MATCH'||
     !await stillOwnPublishedRestoreIntent(
      journalPath,publishedJournalIdentity,directoryStart))
   return block('RECOVERY_SAFETY_FAILED');

  // Recheck after all filesystem I/O. A cooperative mutex does not
  // control external editors, so full inter-process write certainty and
  // power-loss durability still require future native product integration.
  if(await hasUnsafePathLink(opts.sourcePath)||
     await hasUnsafePathLink(opts.backupDirectory))return block('UNSAFE_PATH');
  const parentEnd=await lstat(parent,{bigint:true});
  const directoryEnd=await lstat(opts.backupDirectory,{bigint:true});
  const beforeReplace=await lstat(opts.sourcePath,{bigint:true});
  if(!sameDirectory(parentStart,parentEnd)||
     !sameDirectory(directoryStart,directoryEnd)||
     !sameFile(sourceStart,beforeReplace)||beforeReplace.nlink!==1n)
   return block('SOURCE_UNVERIFIED');
  if((await verifyApprovedSourceFingerprint(sourceInput)).status!==
      'MATCHED_READ_ONLY')
   return block('SOURCE_UNVERIFIED');
  if((await verifyBackupRecoverySource(originalInput)).status!==
      'RECOVERY_SOURCE_VERIFIED_READ_ONLY'||
     (await verifyBackupRecoverySource(displacedInput)).status!==
      'RECOVERY_SOURCE_VERIFIED_READ_ONLY')
   return block('BACKUP_UNVERIFIED');
  if(await verifyExactCandidateBytesReadOnly(pending,bytes)!=='MATCH')
   return block('RECOVERY_SAFETY_FAILED');
  const lastSource=await lstat(opts.sourcePath,{bigint:true});
  if(!sameFile(sourceStart,lastSource))return block('SOURCE_UNVERIFIED');
  // The acquired path mutex might have been removed or replaced during
  // asynchronous backup/journal I/O. Never rename while its identity is lost.
  if(!owner||!await stillOwnNativeRestorePathLock(lock,owner))
   return block('SOURCE_LOCKED');
  // The last byte digest is asynchronous: another process can replace
  // the staged pathname before rename. Require the SAME previously-owned
  // inode, single link and approved mode at the final replacement boundary.
  // This is a bounded snapshot, not an OS-exclusive file lock.
  if(!pendingIdentity||await hasUnsafePathLink(pending))
   return block('RECOVERY_SAFETY_FAILED');
  const finalPending=await lstat(pending,{bigint:true});
  if(!finalPending.isFile()||finalPending.isSymbolicLink()||
     finalPending.nlink!==1n||!sameFile(pendingIdentity,finalPending)||
     (finalPending.mode&0o777n)!==(sourceStart.mode&0o777n))
   return block('RECOVERY_SAFETY_FAILED');

  // Crash evidence can appear AFTER the initial preflight while we await
  // backup and intent publication. Before the irreversible rename, scan
  // both namespaces again. Exempt ONLY the staged pathname whose inode,
  // content and mode were just independently verified above; never ignore
  // another process's pending restoration or unpublished journal.
  // These bounded snapshots are not an OS-exclusive cross-process lock.
  if(await hasInterruptedRestoreStaging(parent,basename(pending),finalPending)||
     await hasInterruptedRestoreStaging(opts.backupDirectory))
   return block('RECOVERY_REVIEW_REQUIRED');
  // The first scan ran before our own intent was published. An external
  // process can publish another valid same-source journal during awaited I/O.
  // Exempt ONLY this transaction's captured published inode; never approve
  // an unreviewed competing intent before the irreversible source rename.
  if(!publishedJournalIdentity||
     await hasPriorPublishedRestoreIntentForSource(
      opts.sourcePath,opts.backupDirectory,
      {fileName:journalFileName,identity:publishedJournalIdentity}))
   return block('RECOVERY_REVIEW_REQUIRED');
  // Even a same-byte external journal inode replacement cannot authorize
  // the irreversible source rename.
  if(!publishedJournalIdentity||
     !await stillOwnPublishedRestoreIntent(
      journalPath,publishedJournalIdentity,directoryStart))
   return block('RECOVERY_SAFETY_FAILED');
  // Final cooperative cancellation boundary before the irreversible source
  // rename. This cannot cancel an OS rename already in progress.
  if(signal?.aborted)return block('CANCELLED');
  await rename(pending,opts.sourcePath);
  pending=undefined;
  const restored=await verifyApprovedSourceFingerprint({
   sourcePath:opts.sourcePath,expectedSha256:opts.expectedOriginalSha256,
   userApproved:true
  });
  const restoredMode=await lstat(opts.sourcePath,{bigint:true});
  // TASK-011/TEST-020/026: the source rename does not freeze the
  // separately published intent or either original/displaced backup.
  // An independent editor could invalidate these AFTER the last pre-rename
  // inspection. Refuse the success receipt unless all recovery evidence is
  // still byte-verified at the post-rename acceptance boundary. This is a
  // cooperative, bounded check, not an exclusive Windows handle guarantee.
  // If it fails the source MAY already contain original bytes: leave both
  // recovery backups and the journal for explicit native reconciliation.
  if(restored.status!=='MATCHED_READ_ONLY'||
     restoredMode.isSymbolicLink()||!restoredMode.isFile()||
     (restoredMode.mode&0o777n)!==(sourceStart.mode&0o777n)||
     (await verifyBackupRecoverySource(originalInput)).status!==
       'RECOVERY_SOURCE_VERIFIED_READ_ONLY'||
     (await verifyBackupRecoverySource({
       ...displacedInput,sourcePath:opts.sourcePath
     })).status!=='RECOVERY_SOURCE_VERIFIED_READ_ONLY'||
     await verifyExactCandidateBytesReadOnly(journalPath,journal)!=='MATCH'||
     !publishedJournalIdentity||
     !await stillOwnPublishedRestoreIntent(
      journalPath,publishedJournalIdentity,directoryStart))
   return block('RECOVERY_SAFETY_FAILED');
  // A lost lock after replacement must not yield a clean restore receipt.
  // Keep backups and the intent journal for independent native inspection.
  if(!owner||!await stillOwnNativeRestorePathLock(lock,owner))
   return block('RECOVERY_SAFETY_FAILED');
  // The backup and journal post-rename checks themselves await filesystem IO.
  // An uncooperative writer may modify or replace the already-restored
  // source while those checks are running, AFTER our first source digest.
  // Do not acknowledge a restore without observing the ORIGINAL bytes and
  // the SAME inode/mode again at this final receipt boundary. Failure must
  // retain both recovery copies and the journal: never auto-overwrite edits.
  // This still cannot lock out writes after the last observation.
  const finalRestored=await verifyApprovedSourceFingerprint({
   sourcePath:opts.sourcePath,expectedSha256:opts.expectedOriginalSha256,
   userApproved:true
  });
  if(finalRestored.status!=='MATCHED_READ_ONLY')
   return block('RECOVERY_SAFETY_FAILED');
  const finalRestoredStat=await lstat(opts.sourcePath,{bigint:true});
  if(!finalRestoredStat.isFile()||finalRestoredStat.isSymbolicLink()||
     finalRestoredStat.nlink!==1n||
     !sameFile(restoredMode,finalRestoredStat)||
     (finalRestoredStat.mode&0o777n)!==(sourceStart.mode&0o777n)||
     await hasUnsafePathLink(opts.sourcePath))
   return block('RECOVERY_SAFETY_FAILED');
  // Do not return before finally; lock cleanup determines success.
  // Recheck this same inode and both retained recovery copies AFTER rmdir.
  receiptSource=finalRestoredStat;
  receiptJournal={path:journalPath,bytes:journal};
  receiptDisplaced={fileName:displaced.backupFileName,byteLength:displaced.byteLength};
  completedRestore=Object.freeze({
   status:'RESTORED_NATIVE_ONLY' as const,
   originalSha256:opts.expectedOriginalSha256,
   displacedSha256:opts.expectedCurrentSha256,
   displacedBackupFileName:displaced.backupFileName,
   journalFileName,...noAuthority
  });
 }catch{return block('IO_FAILURE');}
 finally{
  // If staging did not reach a verified post-sync inode, preserve it for
  // manual inspection. Never unlink a replacement just because names match.
  if(pending&&pendingIdentity&&pendingParentIdentity)
   await removeOwnedNativeRestorePending(pending,pendingIdentity,pendingParentIdentity);
  if(journalPending&&journalPendingIdentity&&journalParentIdentity)
   await removeOwnedNativeRestorePending(
    journalPending,journalPendingIdentity,journalParentIdentity);
  if(acquired){
   // Never remove somebody else's replacement lock object or any
   // nonempty crash evidence; manual recovery may be required.
   try{
    const now=await lstat(lock,{bigint:true});
    if(owner&&now.isDirectory()&&!now.isSymbolicLink()&&
       sameDirectory(owner,now)){
     await rmdir(lock);
     lockReleased=true;
    }
   }catch{/* Preserve unknown or busy lock evidence. */}
  }
 }
 // Never acknowledge restoration if the path lock failed to release. The
 // original MAY already contain restored bytes: keep backups and journal.
 if(!completedRestore||!lockReleased||!receiptSource||
    !receiptJournal||!receiptDisplaced)
  return block('RECOVERY_SAFETY_FAILED');
 // Once rmdir frees our owned mutex, a competing native restore may claim
 // the same source path before this asynchronous verification starts.
 // Never delete that foreign lock, and never return a stale success receipt.
 if(!await restorePathUnclaimed(lock)||!publishedJournalIdentity||
    !journalParentIdentity||
    !await stillOwnPublishedRestoreIntent(
     receiptJournal.path,publishedJournalIdentity,journalParentIdentity))
  return block('RECOVERY_SAFETY_FAILED');
 // Releasing our mutex awaits the filesystem. A third-party edit during
 // that await can invalidate an earlier success receipt. Recheck the same
 // restored inode, the original/displaced backups and the published intent
 // after release. This remains a bounded snapshot, NOT an exclusive handle
 // lock or a guarantee against changes after the final observation.
 try{
  if(await hasUnsafePathLink(opts.sourcePath)||
     await hasUnsafePathLink(opts.backupDirectory))
   return block('RECOVERY_SAFETY_FAILED');
  const again=await verifyApprovedSourceFingerprint({
   sourcePath:opts.sourcePath,expectedSha256:opts.expectedOriginalSha256,
   userApproved:true
  });
  const current=await lstat(opts.sourcePath,{bigint:true});
  if(again.status!=='MATCHED_READ_ONLY'||
     !current.isFile()||current.isSymbolicLink()||current.nlink!==1n||
     !sameFile(receiptSource,current)||
     (current.mode&0o777n)!==(receiptSource.mode&0o777n))
   return block('RECOVERY_SAFETY_FAILED');
  if((await verifyBackupRecoverySource({
    sourcePath:opts.sourcePath,backupDirectory:opts.backupDirectory,
    backupFileName:opts.backupFileName,
    expectedSha256:opts.expectedOriginalSha256,
    expectedByteLength:opts.expectedOriginalByteLength,userApproved:true
   })).status!=='RECOVERY_SOURCE_VERIFIED_READ_ONLY'||
   (await verifyBackupRecoverySource({
    sourcePath:opts.sourcePath,backupDirectory:opts.backupDirectory,
    backupFileName:receiptDisplaced.fileName,
    expectedSha256:opts.expectedCurrentSha256,
    expectedByteLength:receiptDisplaced.byteLength,userApproved:true
   })).status!=='RECOVERY_SOURCE_VERIFIED_READ_ONLY'||
   await verifyExactCandidateBytesReadOnly(
    receiptJournal.path,receiptJournal.bytes)!=='MATCH')
   return block('RECOVERY_SAFETY_FAILED');
  // The extra recovery checks can also await external disk operations.
  // Finish by rechecking the original source to avoid stale success after
  // the evidence verification. Never undo somebody else's latest edit.
  if((await verifyApprovedSourceFingerprint({
    sourcePath:opts.sourcePath,expectedSha256:opts.expectedOriginalSha256,
    userApproved:true
   })).status!=='MATCHED_READ_ONLY')
   return block('RECOVERY_SAFETY_FAILED');
  const last=await lstat(opts.sourcePath,{bigint:true});
  if(!sameFile(receiptSource,last)||last.nlink!==1n||
     await hasUnsafePathLink(opts.sourcePath)||
     !await stillOwnPublishedRestoreIntent(
      receiptJournal.path,publishedJournalIdentity,journalParentIdentity)||
     // The final source and recovery evidence checks await disk I/O.
     // Another restore might have claimed the mutex during that interval
     // without changing source bytes yet.
     !await restorePathUnclaimed(lock))
   return block('RECOVERY_SAFETY_FAILED');
  // TEST-020/021: The last source check above also awaits filesystem I/O.
  // An independent writer can invalidate either recovery copy AFTER its
  // previous audit while leaving the restored source and journal untouched.
  // Do not report a safely recoverable restore without rechecking BOTH
  // independently retained versions at the final receipt boundary.
  if((await verifyBackupRecoverySource({
    sourcePath:opts.sourcePath,backupDirectory:opts.backupDirectory,
    backupFileName:opts.backupFileName,
    expectedSha256:opts.expectedOriginalSha256,
    expectedByteLength:opts.expectedOriginalByteLength,userApproved:true
   })).status!=='RECOVERY_SOURCE_VERIFIED_READ_ONLY'||
   (await verifyBackupRecoverySource({
    sourcePath:opts.sourcePath,backupDirectory:opts.backupDirectory,
    backupFileName:receiptDisplaced.fileName,
    expectedSha256:opts.expectedCurrentSha256,
    expectedByteLength:receiptDisplaced.byteLength,userApproved:true
   })).status!=='RECOVERY_SOURCE_VERIFIED_READ_ONLY')
   return block('RECOVERY_SAFETY_FAILED');
  // These additional read-only checks yield too. Confirm the source,
  // published intent and same-source mutex again before issuing a receipt.
  // Snapshots cannot prevent an editor from changing files AFTER return.
  if((await verifyApprovedSourceFingerprint({
    sourcePath:opts.sourcePath,expectedSha256:opts.expectedOriginalSha256,
    userApproved:true
   })).status!=='MATCHED_READ_ONLY')
   return block('RECOVERY_SAFETY_FAILED');
  const receiptEnd=await lstat(opts.sourcePath,{bigint:true});
  if(!sameFile(receiptSource,receiptEnd)||receiptEnd.nlink!==1n||
     await hasUnsafePathLink(opts.sourcePath)||
     !await stillOwnPublishedRestoreIntent(
      receiptJournal.path,publishedJournalIdentity,journalParentIdentity)||
     !await restorePathUnclaimed(lock))
   return block('RECOVERY_SAFETY_FAILED');
  // Revocation can arrive after an irreversible source rename while
  // post-rename evidence is still being checked. Retain both backups and
  // the published intent, but never issue a clean success receipt after
  // native consent has been withdrawn. No automatic rollback is attempted.
  if(signal?.aborted)return block('CANCELLED');
  return completedRestore;
 }catch{return block('RECOVERY_SAFETY_FAILED');}
}
