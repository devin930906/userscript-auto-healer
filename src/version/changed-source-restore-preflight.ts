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
import type {BigIntStats} from 'node:fs';
import {lstat} from 'node:fs/promises';
import {basename,isAbsolute} from 'node:path';
import {MAX_SCRIPT_BYTES} from '../import/import-service';
import {verifyApprovedSourceFingerprint} from './source-snapshot';
import {verifyBackupRecoverySource} from './recovery-source';
import {hasUnsafePathLink} from './path-boundary';

type Reason='INVALID_REQUEST'|'NOT_AUTHORIZED'|'SOURCE_UNCHANGED'|
 'SOURCE_UNVERIFIED'|'BACKUP_UNVERIFIED'|'UNSAFE_PATH'|'IO_FAILURE';
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
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
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
  const sourceBefore=await lstat(options.sourcePath,{bigint:true});
  const directoryBefore=await lstat(options.backupDirectory,{bigint:true});
  if(!sourceBefore.isFile()||sourceBefore.isSymbolicLink()||
     sourceBefore.nlink!==1n||!directoryBefore.isDirectory()||
     directoryBefore.isSymbolicLink())return deny('UNSAFE_PATH');
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
  const directoryAfter=await lstat(options.backupDirectory,{bigint:true});
  if(!sourceAfter.isFile()||sourceAfter.isSymbolicLink()||
     sourceAfter.nlink!==1n||!sameSource(sourceBefore,sourceAfter))
   return deny('SOURCE_UNVERIFIED');
  if(!directoryAfter.isDirectory()||directoryAfter.isSymbolicLink()||
     !sameDirectory(directoryBefore,directoryAfter))
   return deny('UNSAFE_PATH');
  return Object.freeze({
   status:'RESTORE_PREFLIGHT_READ_ONLY' as const,
   currentSha256:before.sha256,originalSha256:verifiedBackup.sha256,
   originalByteLength:verifiedBackup.byteLength,
   ...flags
  });
 }catch{return deny('IO_FAILURE');}
}
