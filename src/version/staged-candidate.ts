/**
 * TASK-009/010/011; REQ-019/020/021; TEST-019/020/021.
 *
 * Stage an independently audited, single-selector candidate next to its
 * VERIFIED backup. Never modify the original or install anything in a
 * userscript manager. This is a native-only intermediate artifact, NOT a
 * transaction, real user consent, runtime attestation, or auto-apply authority.
 * Do not expose arbitrary filesystem paths to renderer IPC.
 */
import {randomUUID} from 'node:crypto';
import {types as utilTypes} from 'node:util';
import {lstat,link,open} from 'node:fs/promises';
import {basename,isAbsolute,join} from 'node:path';
import {
  proposeLiteralSelectorPatch,type LiteralPatchRequest
} from '../repair/patch-planner';
import {prepareReviewedLocalBackupOnly} from '../acceptance/local-backup-preflight';
import {verifyApprovedSourceFingerprint} from './source-snapshot';
import {verifyBackupRecoverySource} from './recovery-source';
import {backupPrefix} from './verified-backup';
import {NativeSourceLockError,withNativeSourceLock} from './native-source-lock';
import {MAX_SCRIPT_BYTES} from '../import/import-service';
import {hasUnsafePathLink} from './path-boundary';
import {verifyExactCandidateBytesReadOnly} from './candidate-bytes';
import type {BigIntStats} from 'node:fs';
import {removeOwnedStagingPending} from './staging-pending-ownership';

type Failure='INVALID_REQUEST'|'NOT_AUTHORIZED'|'CANDIDATE_REJECTED'|
  'BACKUP_NOT_PREPARED'|'SOURCE_UNVERIFIED'|'BACKUP_UNVERIFIED'|
  'UNSAFE_DESTINATION'|'STAGING_FAILED'|'SOURCE_LOCKED';
const noAuthority={
  automaticPatchAllowed:false as const,
  automaticRollbackAllowed:false as const,
  tampermonkeyVerified:false as const,
  businessVerified:false as const
};
export type StagedCandidateResult=
  |Readonly<{status:'BLOCKED';reason:Failure}&typeof noAuthority>
  |Readonly<{
    status:'CANDIDATE_STAGED_RUNTIME_UNVERIFIED';
    backupFileName:string;candidateFileName:string;
    originalSha256:string;candidateSha256:string;
    candidateByteLength:number;
  }&typeof noAuthority>;
const block=(reason:Failure):StagedCandidateResult=>
  Object.freeze({status:'BLOCKED' as const,reason,...noAuthority});
type Options={sourcePath:string;backupDirectory:string;userApproved:boolean};
function parseOptions(input:unknown):Options|null{
  if(!input||typeof input!=='object'||utilTypes.isProxy(input)||
    Array.isArray(input))return null;
  const proto=Object.getPrototypeOf(input);
  if(proto!==Object.prototype&&proto!==null)return null;
  const desc=Object.getOwnPropertyDescriptors(input);
  const allowed=['sourcePath','backupDirectory','userApproved'];
  if(Reflect.ownKeys(desc).length!==allowed.length||
    Reflect.ownKeys(desc).some(key=>typeof key!=='string')||
    allowed.some(key=>!Object.prototype.hasOwnProperty.call(desc,key)||
      !Object.prototype.hasOwnProperty.call(desc[key],'value')))return null;
  const sourcePath:unknown=desc.sourcePath.value;
  const backupDirectory:unknown=desc.backupDirectory.value;
  const userApproved:unknown=desc.userApproved.value;
  if(typeof userApproved!=='boolean'||typeof sourcePath!=='string'||
    typeof backupDirectory!=='string'||sourcePath.length>4096||
    backupDirectory.length>4096||sourcePath.includes('\0')||
    backupDirectory.includes('\0')||!isAbsolute(sourcePath)||
    !isAbsolute(backupDirectory)||
    !/^[^\\/\u0000-\u001f]+\.user\.js$/i.test(basename(sourcePath)))
    return null;
  return {sourcePath,backupDirectory,userApproved};
}
function sameDir(a:{dev:bigint;ino:bigint},b:{dev:bigint;ino:bigint}){
  return a.dev===b.dev&&a.ino===b.ino;
}
function candidatePrefix(path:string):string{
  const suffix='.'+randomUUID()+'.candidate.user.js';
  const maximum=255-suffix.length;
  let out='';
  for(const c of backupPrefix(path)){
    if(out.length+c.length>maximum)break;
    out+=c;
  }
  return out+suffix;
}
/** Staged files remain on disk for explicit native review. An interrupted
 * publication can leave an untrusted unique candidate: never delete a
 * possible recovery source, and never infer auto-apply permission from it.
 */
export async function stageReviewedCandidateOnly(
 request:LiteralPatchRequest,untrustedCandidate:unknown,untrustedOptions:unknown
):Promise<StagedCandidateResult>{
 try{
  const options=parseOptions(untrustedOptions);
  if(!options)return block('INVALID_REQUEST');
  if(!options.userApproved)return block('NOT_AUTHORIZED');
  // Recompute all bytes from the audited AST-anchored source, never write
  // any bytes supplied by an untrusted planner-shaped candidate.
  const rebuilt=proposeLiteralSelectorPatch(request);
  if(rebuilt.status!=='CANDIDATE_ONLY')return block('CANDIDATE_REJECTED');
  const bytes=Buffer.from(rebuilt.candidateSource,'utf8');
  if(bytes.length===0||bytes.length>MAX_SCRIPT_BYTES)
    return block('CANDIDATE_REJECTED');

  // Existing preflight checks the independently provided candidate against
  // a fresh planner run, fingerprints the disk source and publishes a separate
  // backup. On partial failure the backup may remain for reconciliation.
  const backup=await prepareReviewedLocalBackupOnly(request,untrustedCandidate,options);
  if(backup.status!=='BACKUP_PREPARED_RUNTIME_UNVERIFIED'||
     backup.sourceSha256!==rebuilt.originalSha256||
     backup.candidateSha256!==rebuilt.candidateSha256)
    return block('BACKUP_NOT_PREPARED');

  return await withNativeSourceLock(options.sourcePath,async()=>{
    const current=await verifyApprovedSourceFingerprint({
      sourcePath:options.sourcePath,expectedSha256:backup.sourceSha256,userApproved:true
    });
    if(current.status!=='MATCHED_READ_ONLY')
      return block('SOURCE_UNVERIFIED');
    const validBackup=await verifyBackupRecoverySource({
      sourcePath:options.sourcePath,backupDirectory:options.backupDirectory,
      backupFileName:backup.backupFileName,expectedSha256:backup.sourceSha256,
      expectedByteLength:backup.backupByteLength,userApproved:true
    });
    if(validBackup.status!=='RECOVERY_SOURCE_VERIFIED_READ_ONLY')
      return block('BACKUP_UNVERIFIED');
    // Reject intermediate junctions too: lstat on the final directory alone
    // follows them. The earlier backup preflight is not a lasting capability.
    if(await hasUnsafePathLink(options.backupDirectory))
      return block('UNSAFE_DESTINATION');
    const dirBefore=await lstat(options.backupDirectory,{bigint:true});
    if(!dirBefore.isDirectory()||dirBefore.isSymbolicLink())
      return block('UNSAFE_DESTINATION');

    const candidateFileName=candidatePrefix(options.sourcePath);
    const final=join(options.backupDirectory,candidateFileName);
    const pending=join(options.backupDirectory,'.'+randomUUID()+'.pending');
    let tempCreated=false;
    let pendingIdentity:BigIntStats|undefined;
    try{
      const handle=await open(pending,'wx',0o600);
      tempCreated=true;
      try{
       await handle.writeFile(bytes);
       await handle.sync();
       pendingIdentity=await handle.stat({bigint:true});
      }
      finally{await handle.close();}
      // Temporary files can be externally replaced/grown; never read
      // unbounded bytes or trust pathname metadata without a descriptor.
      if(await verifyExactCandidateBytesReadOnly(pending,bytes)!=='MATCH')
        return block('STAGING_FAILED');

      const sourceAgain=await verifyApprovedSourceFingerprint({
        sourcePath:options.sourcePath,expectedSha256:backup.sourceSha256,userApproved:true
      });
      if(await hasUnsafePathLink(options.backupDirectory))
        return block('UNSAFE_DESTINATION');
      const dirAfter=await lstat(options.backupDirectory,{bigint:true});
      if(sourceAgain.status!=='MATCHED_READ_ONLY')
        return block('SOURCE_UNVERIFIED');
      if(!dirAfter.isDirectory()||dirAfter.isSymbolicLink()||
         !sameDir(dirBefore,dirAfter))
        return block('UNSAFE_DESTINATION');
      // Never replace an existing file; refuse filesystems without hard links.
      await link(pending,final);
      if(!pendingIdentity||!await removeOwnedStagingPending(
        pending,pendingIdentity,dirBefore,final))return block('STAGING_FAILED');
      tempCreated=false;

      if(await verifyExactCandidateBytesReadOnly(final,bytes)!=='MATCH')
        return block('STAGING_FAILED');
      // A redirect after publication must never produce a successful receipt.
      if(await hasUnsafePathLink(options.backupDirectory))
        return block('UNSAFE_DESTINATION');
      const dirPublished=await lstat(options.backupDirectory,{bigint:true});
      if(!dirPublished.isDirectory()||dirPublished.isSymbolicLink()||
         !sameDir(dirBefore,dirPublished))
        return block('UNSAFE_DESTINATION');
      const finalSource=await verifyApprovedSourceFingerprint({
        sourcePath:options.sourcePath,expectedSha256:backup.sourceSha256,userApproved:true
      });
      if(finalSource.status!=='MATCHED_READ_ONLY')
        return block('SOURCE_UNVERIFIED');
      // The independent backup was checked before writing the candidate.
      // An external editor may alter that copy during staging, despite our
      // cooperative source lock. Recheck the recovery bytes before reporting
      // a successful pair; never imply that a stale copy can be restored.
      const finalBackup=await verifyBackupRecoverySource({
        sourcePath:options.sourcePath,backupDirectory:options.backupDirectory,
        backupFileName:backup.backupFileName,expectedSha256:backup.sourceSha256,
        expectedByteLength:backup.backupByteLength,userApproved:true
      });
      if(finalBackup.status!=='RECOVERY_SOURCE_VERIFIED_READ_ONLY')
        return block('BACKUP_UNVERIFIED');
      // The candidate's first post-publication check preceded asynchronous
      // source and backup reads. A separate editor can replace its bytes
      // during those reads; never return a stale staged-pair receipt.
      // This last check is only a snapshot, never authority to apply.
      if(await verifyExactCandidateBytesReadOnly(final,bytes)!=='MATCH')
        return block('STAGING_FAILED');
      return Object.freeze({
        status:'CANDIDATE_STAGED_RUNTIME_UNVERIFIED' as const,
        backupFileName:backup.backupFileName,candidateFileName,
        originalSha256:backup.sourceSha256,
        candidateSha256:rebuilt.candidateSha256,
        candidateByteLength:bytes.length,...noAuthority
      });
    }catch{return block('STAGING_FAILED');}
    finally{
      if(tempCreated&&pendingIdentity)
       await removeOwnedStagingPending(pending,pendingIdentity,dirBefore);
    }
  });
 }catch(e){
  if(e instanceof NativeSourceLockError&&e.code==='SOURCE_LOCKED')
    return block('SOURCE_LOCKED');
  // Never expose source bytes, full absolute paths or OS error text.
  return block('STAGING_FAILED');
 }
}
