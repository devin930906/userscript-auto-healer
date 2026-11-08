/**
 * TASK-011 / REQ-020 / TEST-020: preflight for an original .user.js that
 * has already changed since a separately verified backup was created.
 *
 * This is a bounded READ-ONLY observation, NOT a restore, undo transaction,
 * authenticated native consent, manager attestation, or automatic-write gate.
 * The source/backup may change immediately after the final check; an actual
 * restore must hold its own transaction lock and revalidate every byte.
 * Native-only: no arbitrary filesystem path IPC is provided to the renderer.
 */
import {createHash} from 'node:crypto';
import type {BigIntStats} from 'node:fs';
import {types as utilTypes} from 'node:util';
import {lstat} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join} from 'node:path';
import {MAX_SCRIPT_BYTES} from '../import/import-service';
import {verifyApprovedSourceFingerprint} from './source-snapshot';
import {verifyBackupRecoverySource} from './recovery-source';
import {hasUnsafePathLink} from './path-boundary';
import {hasInterruptedRestoreStaging} from './restore-staging-residue';
import {hasPriorPublishedRestoreIntentForSource} from './restore-intent-inspection';

/** A cooperating restore may hold this path mutex without leaving any
 * .pending residue. A stranded mutex is deliberate manual-review evidence.
 * This observational check is not an exclusive OS reservation.
 */
async function nativeRestorePathMutexPresent(sourcePath:string):Promise<boolean>{
 const identity=process.platform==='win32'?sourcePath.toLowerCase():sourcePath;
 const path=join(dirname(sourcePath),'.uah-restore-path-'+
  createHash('sha256').update(identity,'utf8').digest('hex'));
 try{await lstat(path);return true;}
 catch(error){return (error as NodeJS.ErrnoException).code!=='ENOENT';}
}

/** Native backup and staging transactions use a DIFFERENT cooperative
 * .uah-source-lock-* mutex, keyed by the selected source's dev/ino.
 * Do not claim a clean restore preflight while that inode is owned by
 * another operation. An abandoned lock requires manual reconciliation.
 */
async function nativeSourceInodeMutexPresent(sourcePath:string):Promise<boolean>{
 const parent=dirname(sourcePath);
 try{
  const current=await lstat(sourcePath,{bigint:true});
  if(!current.isFile()||current.isSymbolicLink()||current.nlink!==1n)
   return true;
  const key=createHash('sha256').update(
   current.dev.toString()+':'+current.ino.toString()).digest('hex');
  const path=join(parent,'.uah-source-lock-'+key);
  try{await lstat(path);return true;}
  catch(error){return (error as NodeJS.ErrnoException).code!=='ENOENT';}
 }catch{return true;}
}

type Reason='INVALID_REQUEST'|'NOT_AUTHORIZED'|'SOURCE_UNCHANGED'|
 'SOURCE_UNVERIFIED'|'BACKUP_UNVERIFIED'|'UNSAFE_PATH'|'RECOVERY_REVIEW_REQUIRED'|'IO_FAILURE';
const flags={
 automaticPatchAllowed:false as const,
 automaticRollbackAllowed:false as const,
 tampermonkeyVerified:false as const,
 businessVerified:false as const
};
export type ChangedSourceRestorePreflightResult=
 |Readonly<{status:'BLOCKED';reason:Reason}&typeof flags>
 |Readonly<{status:'RESTORE_PREFLIGHT_READ_ONLY';
   currentSha256:string;originalSha256:string;originalByteLength:number;
 }&typeof flags>;
const deny=(reason:Reason):ChangedSourceRestorePreflightResult=>
 Object.freeze({status:'BLOCKED' as const,reason,...flags});
const SHA256=/^[0-9a-f]{64}$/;
// Hash equality alone cannot detect a same-byte inode or directory swap
// between independently valid read-only checks.
const sameSource=(a:BigIntStats,b:BigIntStats)=>
 a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&
 a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
const sameDirectory=(a:BigIntStats,b:BigIntStats)=>
 a.dev===b.dev&&a.ino===b.ino;
const fields=[
 'sourcePath','backupDirectory','backupFileName',
 'expectedCurrentSha256','expectedOriginalSha256',
 'expectedOriginalByteLength','userApproved'
] as const;
type Data={
 sourcePath:string;backupDirectory:string;backupFileName:string;
 expectedCurrentSha256:string;expectedOriginalSha256:string;
 expectedOriginalByteLength:number;userApproved:boolean
};
function parse(input:unknown):Data|null {
 try{
  if(!input||typeof input!=='object'||utilTypes.isProxy(input)||
     Array.isArray(input))return null;
  const proto=Object.getPrototypeOf(input);
  if(proto!==Object.prototype&&proto!==null)return null;
  const descriptors=Object.getOwnPropertyDescriptors(input);
  const names=Reflect.ownKeys(descriptors);
  if(names.length!==fields.length||names.some(n=>typeof n!=='string')||
     fields.some(n=>!Object.prototype.hasOwnProperty.call(descriptors,n)||
       !Object.prototype.hasOwnProperty.call(descriptors[n],'value')))return null;
  const sourcePath:unknown=descriptors.sourcePath.value;
  const backupDirectory:unknown=descriptors.backupDirectory.value;
  const backupFileName:unknown=descriptors.backupFileName.value;
  const expectedCurrentSha256:unknown=descriptors.expectedCurrentSha256.value;
  const expectedOriginalSha256:unknown=descriptors.expectedOriginalSha256.value;
  const expectedOriginalByteLength:unknown=descriptors.expectedOriginalByteLength.value;
  const userApproved:unknown=descriptors.userApproved.value;
  if(typeof sourcePath!=='string'||typeof backupDirectory!=='string'||
     typeof backupFileName!=='string'||typeof userApproved!=='boolean'||
     sourcePath.length===0||sourcePath.length>4096||
     backupDirectory.length===0||backupDirectory.length>4096||
     sourcePath.includes('\0')||backupDirectory.includes('\0')||
     !isAbsolute(sourcePath)||!isAbsolute(backupDirectory)||
     !/^[^\\/\u0000-\u001f]+\.user\.js$/i.test(basename(sourcePath))||
     backupFileName.length===0||backupFileName.length>255||
     // The backup name must be one lexical filename, not a relative path.
     // The deeper recovery verifier checks the UUID/provenance later, but
     // this preflight lstat's the joined path BEFORE invoking that verifier.
     // Reject both separators on every platform before any filesystem I/O.
     backupFileName.includes('/')||backupFileName.includes('\\\\')||
     typeof expectedCurrentSha256!=='string'||!SHA256.test(expectedCurrentSha256)||
     typeof expectedOriginalSha256!=='string'||!SHA256.test(expectedOriginalSha256)||
     typeof expectedOriginalByteLength!=='number'||
     !Number.isSafeInteger(expectedOriginalByteLength)||
     expectedOriginalByteLength<1||expectedOriginalByteLength>MAX_SCRIPT_BYTES)
    return null;
  return {sourcePath,backupDirectory,backupFileName,expectedCurrentSha256,
   expectedOriginalSha256,expectedOriginalByteLength,userApproved};
 }catch{return null;}
}

/** This explicitly does NOT infer that a patch was applied or validated.
 * It checks only the selected current file and a separate original backup.
 * The caller must obtain fresh native consent before any future restore.
 */
export async function inspectChangedSourceRestorePreflightReadOnly(
 untrustedOptions:unknown
):Promise<ChangedSourceRestorePreflightResult>{
 try{
  const options=parse(untrustedOptions);
  if(!options)return deny('INVALID_REQUEST');
  if(!options.userApproved)return deny('NOT_AUTHORIZED');
  if(options.expectedCurrentSha256===options.expectedOriginalSha256)
   return deny('SOURCE_UNCHANGED');
  const sourceInput={sourcePath:options.sourcePath,
   expectedSha256:options.expectedCurrentSha256,userApproved:true};
  const backupInput={sourcePath:options.sourcePath,
   backupDirectory:options.backupDirectory,
   backupFileName:options.backupFileName,
   expectedSha256:options.expectedOriginalSha256,
   expectedByteLength:options.expectedOriginalByteLength,userApproved:true};

  if(await hasUnsafePathLink(options.sourcePath)||
     await hasUnsafePathLink(options.backupDirectory))
   return deny('UNSAFE_PATH');
  // Crash residue is not an independently reviewed restore source. Never
  // describe the selected pair as ready while an earlier native transaction
  // may have left staging evidence in either filesystem namespace.
  if(await hasInterruptedRestoreStaging(dirname(options.sourcePath),
       undefined,undefined,'source-parent')||
     await hasInterruptedRestoreStaging(options.backupDirectory))
   return deny('RECOVERY_REVIEW_REQUIRED');
  // A valid published intent or an outstanding same-source native mutex
  // requires manual reconciliation even when both source and backup match.
  if(await nativeRestorePathMutexPresent(options.sourcePath)||
     await nativeSourceInodeMutexPresent(options.sourcePath)||
     await hasPriorPublishedRestoreIntentForSource(
      options.sourcePath,options.backupDirectory))
   return deny('RECOVERY_REVIEW_REQUIRED');
  const sourceBefore=await lstat(options.sourcePath,{bigint:true});
  const sourceParentBefore=await lstat(dirname(options.sourcePath),{bigint:true});
  const directoryBefore=await lstat(options.backupDirectory,{bigint:true});
  const backupBefore=await lstat(join(options.backupDirectory,options.backupFileName),{bigint:true});
  // The native restore transaction rejects write-protected originals before
  // any backup or intent publication. A read-only preflight must not report
  // recovery readiness for a source the actual native restore will refuse.
  if(!sourceBefore.isFile()||sourceBefore.isSymbolicLink()||
     sourceBefore.nlink!==1n||(sourceBefore.mode&0o222n)===0n||
     !sourceParentBefore.isDirectory()||
     sourceParentBefore.isSymbolicLink()||!directoryBefore.isDirectory()||
     directoryBefore.isSymbolicLink())return deny('UNSAFE_PATH');
  if(!backupBefore.isFile()||backupBefore.isSymbolicLink()||backupBefore.nlink!==1n)
   return deny('BACKUP_UNVERIFIED');
  const before=await verifyApprovedSourceFingerprint(sourceInput);
  if(before.status!=='MATCHED_READ_ONLY')return deny('SOURCE_UNVERIFIED');
  const verifiedBackup=await verifyBackupRecoverySource(backupInput);
  if(verifiedBackup.status!=='RECOVERY_SOURCE_VERIFIED_READ_ONLY')
   return deny('BACKUP_UNVERIFIED');
  // Recheck both independent files, not just their first snapshots. This
  // still does NOT create a durable lock or pre-authorize later filesystem IO.
  const currentAgain=await verifyApprovedSourceFingerprint(sourceInput);
  if(currentAgain.status!=='MATCHED_READ_ONLY'||currentAgain.sha256!==before.sha256||
     currentAgain.byteLength!==before.byteLength)
   return deny('SOURCE_UNVERIFIED');
  const backupAgain=await verifyBackupRecoverySource(backupInput);
  if(backupAgain.status!=='RECOVERY_SOURCE_VERIFIED_READ_ONLY')
   return deny('BACKUP_UNVERIFIED');
  if(await hasUnsafePathLink(options.sourcePath)||
     await hasUnsafePathLink(options.backupDirectory))
   return deny('UNSAFE_PATH');
  const sourceAfter=await lstat(options.sourcePath,{bigint:true});
  const sourceParentAfter=await lstat(dirname(options.sourcePath),{bigint:true});
  const directoryAfter=await lstat(options.backupDirectory,{bigint:true});
  const backupAfter=await lstat(join(options.backupDirectory,options.backupFileName),{bigint:true});
  if(!sourceAfter.isFile()||sourceAfter.isSymbolicLink()||
     sourceAfter.nlink!==1n||!sameSource(sourceBefore,sourceAfter))
   return deny('SOURCE_UNVERIFIED');
  if(!sourceParentAfter.isDirectory()||sourceParentAfter.isSymbolicLink()||
     !sameDirectory(sourceParentBefore,sourceParentAfter))
   return deny('UNSAFE_PATH');
  if(!directoryAfter.isDirectory()||directoryAfter.isSymbolicLink()||
     !sameDirectory(directoryBefore,directoryAfter))
   return deny('UNSAFE_PATH');
  // Identical backup bytes on a DIFFERENT inode are not the selected
  // independently verified recovery source. Hash-only checks can miss a
  // same-content rename/recreate during two awaited verification reads.
  if(!backupAfter.isFile()||backupAfter.isSymbolicLink()||
     backupAfter.nlink!==1n||!sameSource(backupBefore,backupAfter))
   return deny('BACKUP_UNVERIFIED');
  // A different restore may stage a crash artifact while the independent
  // source and backup rechecks await I/O. Revalidate before a clean receipt;
  // this remains observational and never permits automated writes.
  if(await hasInterruptedRestoreStaging(dirname(options.sourcePath),
       undefined,undefined,'source-parent')||
     await hasInterruptedRestoreStaging(options.backupDirectory))
   return deny('RECOVERY_REVIEW_REQUIRED');
  // Earlier backup/source awaits can overlap a new native restore that
  // acquires the mutex or publishes a journal without leaving .pending.
  // Never issue a stale clean observation in that case.
  if(await nativeRestorePathMutexPresent(options.sourcePath)||
     await nativeSourceInodeMutexPresent(options.sourcePath)||
     await hasPriorPublishedRestoreIntentForSource(
      options.sourcePath,options.backupDirectory))
   return deny('RECOVERY_REVIEW_REQUIRED');
  // The final path-lock/journal scans above await native I/O. An external
  // editor may replace either version (or its parent) AFTER earlier hashes
  // and inode checks but BEFORE this ready receipt. Pin a final read-only
  // identity snapshot to the approved source, source parent and backup.
  // This is not an atomic OS lock and does not authorize a future restore.
  if(await hasUnsafePathLink(options.sourcePath)||
     await hasUnsafePathLink(options.backupDirectory))
   return deny('UNSAFE_PATH');
  const sourceFinal=await lstat(options.sourcePath,{bigint:true});
  const sourceParentFinal=await lstat(dirname(options.sourcePath),{bigint:true});
  const directoryFinal=await lstat(options.backupDirectory,{bigint:true});
  const backupFinal=await lstat(join(options.backupDirectory,options.backupFileName),
   {bigint:true});
  if(!sourceFinal.isFile()||sourceFinal.isSymbolicLink()||
     sourceFinal.nlink!==1n||!sameSource(sourceBefore,sourceFinal))
   return deny('SOURCE_UNVERIFIED');
  if(!sourceParentFinal.isDirectory()||sourceParentFinal.isSymbolicLink()||
     !sameDirectory(sourceParentBefore,sourceParentFinal)||
     !directoryFinal.isDirectory()||directoryFinal.isSymbolicLink()||
     !sameDirectory(directoryBefore,directoryFinal))
   return deny('UNSAFE_PATH');
  if(!backupFinal.isFile()||backupFinal.isSymbolicLink()||
     backupFinal.nlink!==1n||!sameSource(backupBefore,backupFinal))
   return deny('BACKUP_UNVERIFIED');
  return Object.freeze({
   status:'RESTORE_PREFLIGHT_READ_ONLY' as const,
   currentSha256:before.sha256,originalSha256:verifiedBackup.sha256,
   originalByteLength:verifiedBackup.byteLength,
   ...flags
  });
 }catch{return deny('IO_FAILURE');}
}
