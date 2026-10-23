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
import {link,lstat,mkdir,open,rename,rmdir,unlink} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
import {MAX_SCRIPT_BYTES} from '../import/import-service';
import {verifyApprovedSourceFingerprint} from './source-snapshot';
import {verifyBackupRecoverySource} from './recovery-source';
import {createVerifiedBackupOnly} from './verified-backup';
import {verifyExactCandidateBytesReadOnly} from './candidate-bytes';
import {hasUnsafePathLink} from './path-boundary';

type Reason='INVALID_REQUEST'|'NOT_AUTHORIZED'|'SOURCE_UNCHANGED'|
 'SOURCE_UNVERIFIED'|'BACKUP_UNVERIFIED'|'SOURCE_LOCKED'|
 'UNSAFE_PATH'|'RECOVERY_SAFETY_FAILED'|'IO_FAILURE';
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
  const current=await lstat(lockPath,{bigint:true});
  return current.isDirectory()&&!current.isSymbolicLink()&&
    sameDirectory(originalLock,current);
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
export async function restoreVerifiedOriginalNativeOnly(
 untrustedOptions:unknown
):Promise<NativeOriginalRestoreResult>{
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
 let pending:string|undefined;
 let journalPending:string|undefined;
 let pendingIdentity:BigIntStats|undefined;
 let journalPendingIdentity:BigIntStats|undefined;
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
     !sourceStart.isFile()||sourceStart.isSymbolicLink()||
     sourceStart.nlink!==1n||sourceStart.size<=0n||
     sourceStart.size>BigInt(MAX_SCRIPT_BYTES)||
     // Never replace a deliberately read-only source, even if the current
     // process has elevated rights. Refuse BEFORE creating any backup/journal.
     (sourceStart.mode&0o222n)===0n)return block('UNSAFE_PATH');
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
  if(!owner.isDirectory()||owner.isSymbolicLink())
   return block('SOURCE_LOCKED');
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
  if(await verifyExactCandidateBytesReadOnly(journalPath,journal)!=='MATCH')
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
     await verifyExactCandidateBytesReadOnly(journalPath,journal)!=='MATCH')
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
 // Never acknowledge restoration if our path lock did not release. The
 // original MAY already contain restored bytes: preserve all backups and
 // the intent journal for explicit privileged native reconciliation.
 return completedRestore&&lockReleased?
  completedRestore:block('RECOVERY_SAFETY_FAILED');
}
