/**
 * TASK-010/011 · REQ-019/020/021 · TEST-019/020/021.
 *
 * Native-only, backup-only preparation for a reviewed literal patch. This
 * joins independent checks which previously ran in isolation. It NEVER
 * writes the original, installs a userscript, or authorizes auto-apply or
 * rollback. DO NOT expose caller-controlled filesystem paths over IPC.
 *
 * userApproved is a preliminary caller claim, NOT authenticated consent.
 * A trusted native file-selection capability and runtime attestation remain
 * prerequisites for any future mutating transaction. The observations below
 * are NOT held under a durable filesystem lock.
 */
import {assessLocalAcceptancePreflight} from './acceptance-gate';
import type {LiteralPatchRequest} from '../repair/patch-planner';
import {verifyApprovedSourceFingerprint} from '../version/source-snapshot';
import {createVerifiedBackupOnly} from '../version/verified-backup';
import {verifyBackupRecoverySource} from '../version/recovery-source';

type PreparationBlockReason=
 'INVALID_REQUEST'|'NOT_AUTHORIZED'|'PATCH_REVIEW_FAILED'|
 'DISK_SOURCE_UNVERIFIED'|'BACKUP_FAILED'|'BACKUP_UNVERIFIED'|
 'SOURCE_CHANGED';
const failFlags={
 automaticPatchAllowed:false as const,
 automaticRollbackAllowed:false as const,
 tampermonkeyVerified:false as const,
 businessRecoveredVerified:false as const
};
export type LocalBackupPreparationResult=
 |Readonly<{status:'BLOCKED';reason:PreparationBlockReason}&typeof failFlags>
 |Readonly<{
  status:'BACKUP_PREPARED_RUNTIME_UNVERIFIED';
  backupFileName:string;sourceSha256:string;candidateSha256:string;
  backupByteLength:number;
 }&typeof failFlags>;

function blocked(reason:PreparationBlockReason):LocalBackupPreparationResult{
 return Object.freeze({status:'BLOCKED' as const,reason,...failFlags});
}
/** Do not evaluate getters, symbols, inherited input, or extra approval claims. */
function parseOptions(input:unknown):{
 sourcePath:string;backupDirectory:string;userApproved:boolean
}|null{
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 const proto=Object.getPrototypeOf(input);
 if(proto!==Object.prototype&&proto!==null)return null;
 const desc=Object.getOwnPropertyDescriptors(input);
 const keys=Reflect.ownKeys(desc);
 const names=['sourcePath','backupDirectory','userApproved'];
 if(keys.length!==names.length||keys.some(k=>typeof k!=='string')||
    names.some(k=>!Object.prototype.hasOwnProperty.call(desc,k)||
      !Object.prototype.hasOwnProperty.call(desc[k],'value')))
   return null;
 const sourcePath:unknown=desc.sourcePath.value;
 const backupDirectory:unknown=desc.backupDirectory.value;
 const userApproved:unknown=desc.userApproved.value;
 if(typeof sourcePath!=='string'||typeof backupDirectory!=='string'||
    typeof userApproved!=='boolean')return null;
 return {sourcePath,backupDirectory,userApproved};
}

/**
 * A successful result means an independently checked backup exists at the
 * time of these reads. A future write MUST separately authenticate the user,
 * re-verify the latest disk state, hold a transaction lock, maintain a
 * crash-recovery journal and pass actual Tampermonkey/business acceptance.
 *
 * A failed post-copy check may leave a uniquely named recovery copy for
 * privileged reconciliation. Never delete a potential recovery source.
 */
export async function prepareReviewedLocalBackupOnly(
 request:LiteralPatchRequest,
 candidate:unknown,
 untrustedOptions:unknown
):Promise<LocalBackupPreparationResult>{
 try{
  const options=parseOptions(untrustedOptions);
  if(!options)return blocked('INVALID_REQUEST');
  if(!options.userApproved)return blocked('NOT_AUTHORIZED');
  // Validate AST patch and its exact proposed bytes before touching disk.
  const sourceHash:unknown=request?.expectedSourceSha256;
  const review=assessLocalAcceptancePreflight(request,candidate,{
   userApproved:true,diskSourceSha256:sourceHash
  });
  if(review.status!=='AWAITING_TRUSTED_RUNTIME_AND_BACKUP')
    return blocked('PATCH_REVIEW_FAILED');
  const readInput={
   sourcePath:options.sourcePath,expectedSha256:review.originalSha256,
   userApproved:true
  };
  const before=await verifyApprovedSourceFingerprint(readInput);
  if(before.status!=='MATCHED_READ_ONLY')
    return blocked('DISK_SOURCE_UNVERIFIED');
  const copy=await createVerifiedBackupOnly({
   ...readInput,backupDirectory:options.backupDirectory
  });
  if(copy.status!=='BACKUP_ONLY')return blocked('BACKUP_FAILED');
  const recovery=await verifyBackupRecoverySource({
   sourcePath:options.sourcePath,backupDirectory:options.backupDirectory,
   backupFileName:copy.backupFileName,expectedSha256:copy.sha256,
   expectedByteLength:copy.byteLength,userApproved:true
  });
  if(recovery.status!=='RECOVERY_SOURCE_VERIFIED_READ_ONLY'||
     recovery.sha256!==review.originalSha256||
     recovery.byteLength!==before.byteLength)
    return blocked('BACKUP_UNVERIFIED');
  // Catch a source replaced while the separate backup was being published.
  const after=await verifyApprovedSourceFingerprint(readInput);
  if(after.status!=='MATCHED_READ_ONLY'||
     after.sha256!==before.sha256||after.byteLength!==before.byteLength)
    return blocked('SOURCE_CHANGED');
  return Object.freeze({
   status:'BACKUP_PREPARED_RUNTIME_UNVERIFIED' as const,
   backupFileName:copy.backupFileName,sourceSha256:review.originalSha256,
   candidateSha256:review.candidateSha256,backupByteLength:copy.byteLength,
   ...failFlags
  });
 }catch{
  // No filesystem path, userscript contents or native error details leak.
  return blocked('INVALID_REQUEST');
 }
}
