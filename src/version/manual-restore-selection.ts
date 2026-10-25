/** TASK-011 / TEST-020/021/026: prepare a MANUAL native file restoration.
 * Paths are supplied only by two independent privileged OS file pickers.
 * This stage reads, hashes and rechecks files but NEVER writes. Its receipt
 * is not an authorization: the actual transaction must obtain fresh native
 * consent and revalidate every source/backup identity under its path lock.
 */
import {basename,dirname,resolve} from 'node:path';
import {importApprovedPaths} from '../import/import-service';
import {verifyApprovedSourceFingerprint} from './source-snapshot';
import {verifyBackupRecoverySource} from './recovery-source';

export type ManualRestoreSelection=
 |Readonly<{status:'BLOCKED';reason:'INVALID_SELECTION'|'SOURCE_UNVERIFIED'|'BACKUP_UNVERIFIED'|'SOURCE_UNCHANGED'}>
 |Readonly<{status:'AWAITING_NATIVE_RESTORE_CONSENT';
    sourcePath:string;backupDirectory:string;backupFileName:string;
    expectedCurrentSha256:string;expectedOriginalSha256:string;
    expectedOriginalByteLength:number}>;

const deny=(reason:'INVALID_SELECTION'|'SOURCE_UNVERIFIED'|'BACKUP_UNVERIFIED'|'SOURCE_UNCHANGED'):ManualRestoreSelection=>
 Object.freeze({status:'BLOCKED' as const,reason});

export async function prepareManualOriginalRestoreSelection(
 selectedSource:unknown,selectedBackup:unknown
):Promise<ManualRestoreSelection>{
 try{
  if(typeof selectedSource!=='string'||typeof selectedBackup!=='string'||
     !selectedSource||!selectedBackup||selectedSource!==resolve(selectedSource)||
     selectedBackup!==resolve(selectedBackup)||selectedSource===selectedBackup)
   return deny('INVALID_SELECTION');
  const name=basename(selectedBackup);
  // A backup is only eligible when this project's native source-bound
  // backup verifier recognizes the name and independently verifies bytes.
  if(!name.endsWith('.backup.user.js'))return deny('INVALID_SELECTION');
  const current=await importApprovedPaths([selectedSource]);
  if(current.errors.length||current.scripts.length!==1||
     current.scripts[0].sourcePath!==selectedSource)
   return deny('SOURCE_UNVERIFIED');
  const backup=await importApprovedPaths([selectedBackup]);
  if(backup.errors.length||backup.scripts.length!==1||
     backup.scripts[0].sourcePath!==selectedBackup)
   return deny('BACKUP_UNVERIFIED');
  const sourceSha=current.scripts[0].sha256;
  const originalSha=backup.scripts[0].sha256;
  if(sourceSha===originalSha)return deny('SOURCE_UNCHANGED');
  if((await verifyApprovedSourceFingerprint({
   sourcePath:selectedSource,expectedSha256:sourceSha,userApproved:true
  })).status!=='MATCHED_READ_ONLY')return deny('SOURCE_UNVERIFIED');
  const backupDirectory=dirname(selectedBackup);
  if((await verifyBackupRecoverySource({
   sourcePath:selectedSource,backupDirectory,backupFileName:name,
   expectedSha256:originalSha,expectedByteLength:backup.scripts[0].byteLength,
   userApproved:true
  })).status!=='RECOVERY_SOURCE_VERIFIED_READ_ONLY')
   return deny('BACKUP_UNVERIFIED');
  // A different native process can replace or edit the selected script
  // while independent backup verification awaits filesystem I/O. The hash
  // obtained before that await is not a current manual-restore selection.
  // Still read-only: a later restore must independently revalidate under
  // its own native transaction lock before touching the selected file.
  if((await verifyApprovedSourceFingerprint({
   sourcePath:selectedSource,expectedSha256:sourceSha,userApproved:true
  })).status!=='MATCHED_READ_ONLY')return deny('SOURCE_UNVERIFIED');
  return Object.freeze({
   status:'AWAITING_NATIVE_RESTORE_CONSENT' as const,
   sourcePath:selectedSource,backupDirectory,backupFileName:name,
   expectedCurrentSha256:sourceSha,
   expectedOriginalSha256:originalSha,
   expectedOriginalByteLength:backup.scripts[0].byteLength
  });
 }catch{return deny('INVALID_SELECTION');}
}
