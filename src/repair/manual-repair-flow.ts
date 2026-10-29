/**
 * TASK-009..012 / REQ-014/019/020/021/023.
 * Limited native-only journey: stable, read-only DOM diagnosis -> AST-reviewed
 * candidate -> separately verified backup and stage -> manual .user.js export.
 *
 * This is NOT Tampermonkey runtime acceptance, automated application or
 * rollback, and it must never be exposed as arbitrary filesystem IPC.
 * A boolean from a caller is NOT independent user authentication.
 */
import {lstat} from 'node:fs/promises';
import type {BigIntStats} from 'node:fs';
import {basename,dirname,isAbsolute,join,relative} from 'node:path';
import {types as nodeTypes} from 'node:util';
import {proposeFromReadOnlyDomDiagnostic} from './scenario-candidate';
import {proposeLiteralSelectorPatch,type LiteralPatchRequest} from './patch-planner';
import {stageReviewedCandidateOnly} from '../version/staged-candidate';
import {stageRecoveryCheckpointOnly,inspectRecoveryCheckpointReadOnly} from '../version/recovery-checkpoint';
import {hasUnsafePathLink} from '../version/path-boundary';
import {verifyExactCandidateBytesReadOnly} from '../version/candidate-bytes';
import {verifyApprovedSourceFingerprint} from '../version/source-snapshot';
import {exportReviewedCandidateForManualInstall,insideProtectedBackup} from '../export/manual-candidate-export';

type Reason='INVALID_REQUEST'|'NOT_AUTHORIZED'|'DOM_CANDIDATE_BLOCKED'|
 'PATCH_REVIEW_BLOCKED'|'STAGE_BLOCKED'|'CHECKPOINT_BLOCKED'|'EXPORT_BLOCKED'|
 'SOURCE_CHANGED';
const noAuthority={
  automaticPatchAllowed:false as const,
  automaticRollbackAllowed:false as const,
  tampermonkeyVerified:false as const,
  managerInstalled:false as const,
  businessVerified:false as const
};
export type ManualRepairFlowResult=
 |Readonly<{status:'BLOCKED';reason:Reason}&typeof noAuthority>
 |Readonly<{status:'MANUAL_EXPORT_READY_RUNTIME_UNVERIFIED';
   backupFileName:string;candidateFileName:string;exportFileName:string;
   recoveryExportFileName:string;checkpointFileName:string;
   checkpointSha256:string;
   sourceSha256:string;candidateSha256:string;candidateByteLength:number
  }&typeof noAuthority>;
const block=(reason:Reason):ManualRepairFlowResult=>
 Object.freeze({status:'BLOCKED' as const,reason,...noAuthority});
/** Post-checkpoint success must still name the same two exported files.
 * A same-byte external replacement is not the publication audited by the
 * native exporter. These are bounded snapshots, not durable OS locks. */
const sameExport=(a:BigIntStats,b:BigIntStats):boolean=>
 a.isFile()&&b.isFile()&&!a.isSymbolicLink()&&!b.isSymbolicLink()&&
 a.nlink===1n&&b.nlink===1n&&
 a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&
 a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs&&a.mode===b.mode;
const sameExportDirectory=(a:BigIntStats,b:BigIntStats):boolean=>
 a.isDirectory()&&b.isDirectory()&&
 !a.isSymbolicLink()&&!b.isSymbolicLink()&&
 a.dev===b.dev&&a.ino===b.ino;
function plain(input:unknown,names:readonly string[]):Record<string,unknown>|null{
 // An untrusted Proxy can run code through getPrototypeOf/ownKeys traps.
 if(!input||typeof input!=='object'||nodeTypes.isProxy(input)||
    Array.isArray(input))return null;
 const p=Object.getPrototypeOf(input);
 if(p!==Object.prototype&&p!==null)return null;
 const d=Object.getOwnPropertyDescriptors(input);
 const fields=Reflect.ownKeys(d);
 if(fields.length!==names.length||fields.some(k=>typeof k!=='string')||
    names.some(k=>!Object.prototype.hasOwnProperty.call(d,k)||
      !Object.prototype.hasOwnProperty.call(d[k],'value')))return null;
 const out:Record<string,unknown>=Object.create(null);
 for(const n of names)out[n]=d[n].value;
 return out;
}
const requestNames=[
 'source','expectedSourceSha256','callOffset','method','originalSelector',
 'replacementSelector','faultEvidenceId'
];
const optionNames=['sourcePath','backupDirectory','exportDirectory','userApproved'];
const absolute=(v:unknown):v is string=>
 typeof v==='string'&&v.length>0&&v.length<=4096&&
 !v.includes('\0')&&isAbsolute(v);

/**
 * The caller must have separately approved the scenario and selected all
 * disk destinations via a trusted native UI. Nothing here takes a file write
 * capability for the original .user.js. A completed result means the user
 * still has to import/update and test the candidate inside real Tampermonkey.
 */
export async function prepareManualRepairExportOnly(
  untrustedPatch:unknown,scenario:unknown,domSamples:unknown,
  untrustedOptions:unknown
):Promise<ManualRepairFlowResult>{
 try{
  const p=plain(untrustedPatch,requestNames);
  const o=plain(untrustedOptions,optionNames);
  if(!p||!o||!absolute(o.sourcePath)||
     !/^[^\\/\u0000-\u001f]+\.user\.js$/i.test(basename(o.sourcePath))||
     !absolute(o.backupDirectory)||!absolute(o.exportDirectory)||
     typeof o.userApproved!=='boolean')return block('INVALID_REQUEST');
  if(!o.userApproved)return block('NOT_AUTHORIZED');
  // Reject protected-store destination conflicts before staging a candidate
  // or writing an independent backup that cannot be exported.
  if(insideProtectedBackup(o.backupDirectory as string,o.exportDirectory as string))
    return block('EXPORT_BLOCKED');
  // A rejected export into the original script folder must not create
  // separate backups or staged candidates before the exporter's own check.
  if(relative(dirname(o.sourcePath as string),o.exportDirectory as string)==='')
    return block('EXPORT_BLOCKED');
  // Refuse unusable export folders BEFORE publishing a backup or candidate.
  // The exporter's independent check remains necessary after staging because
  // third-party filesystem modifications can occur during awaited I/O.
  try{
    const exportPath=o.exportDirectory as string;
    const backupPath=o.backupDirectory as string;
    const sourceDir=dirname(o.sourcePath as string);
    if(await hasUnsafePathLink(exportPath)||
       await hasUnsafePathLink(backupPath)||
       await hasUnsafePathLink(sourceDir))
      return block('EXPORT_BLOCKED');
    const [destination,backupDir,originalDir]=await Promise.all([
      lstat(exportPath,{bigint:true}),lstat(backupPath,{bigint:true}),
      lstat(sourceDir,{bigint:true})
    ]);
    if(!destination.isDirectory()||destination.isSymbolicLink()||
       !backupDir.isDirectory()||backupDir.isSymbolicLink()||
       !originalDir.isDirectory()||originalDir.isSymbolicLink()||
       (destination.dev===backupDir.dev&&destination.ino===backupDir.ino)||
       (destination.dev===originalDir.dev&&destination.ino===originalDir.ino))
      return block('EXPORT_BLOCKED');
  }catch{return block('EXPORT_BLOCKED');}
  const patch=p as unknown as LiteralPatchRequest;
  const linked=proposeFromReadOnlyDomDiagnostic(patch,scenario,domSamples,true);
  if(linked.status!=='CANDIDATE_ONLY')
    return block('DOM_CANDIDATE_BLOCKED');
  // The DOM bridge returns a decorated candidate. The authoritative staging
  // audit expects the *exact* planner schema; regenerate it from the frozen
  // field snapshot instead of trusting external or decorated object fields.
  const candidate=proposeLiteralSelectorPatch(patch);
  if(candidate.status!=='CANDIDATE_ONLY'||
     candidate.originalSha256!==linked.originalSha256||
     candidate.candidateSha256!==linked.candidateSha256)
    return block('PATCH_REVIEW_BLOCKED');
  const files={sourcePath:o.sourcePath,
    backupDirectory:o.backupDirectory,userApproved:true};
  const staged=await stageReviewedCandidateOnly(patch,candidate,files);
  if(staged.status!=='CANDIDATE_STAGED_RUNTIME_UNVERIFIED')
    return block('STAGE_BLOCKED');
  // A byte-verified, non-authoritative recovery checkpoint is a prerequisite
  // of this manual export. Failure preserves staged files for native review.
  const checkpoint=await stageRecoveryCheckpointOnly(patch,staged,files);
  if(checkpoint.status!=='CHECKPOINT_STAGED_UNVERIFIED'||
     checkpoint.originalSha256!==staged.originalSha256||
     checkpoint.candidateSha256!==staged.candidateSha256)
    return block('CHECKPOINT_BLOCKED');
  // TEST-020/021/023: independently reread the persisted checkpoint and
  // verify the selected source, staged backup and exact candidate bytes.
  // A successful stage receipt is not a trusted authorization.
  const checkpointBefore=await inspectRecoveryCheckpointReadOnly(
    patch,checkpoint.checkpointFileName,files);
  if(checkpointBefore.status!=='CHECKPOINT_RECHECKED_READ_ONLY'||
     checkpointBefore.checkpointSha256!==checkpoint.checkpointSha256||
     checkpointBefore.originalSha256!==staged.originalSha256||
     checkpointBefore.candidateSha256!==staged.candidateSha256)
    return block('CHECKPOINT_BLOCKED');
  const exported=await exportReviewedCandidateForManualInstall(
    patch,staged,{...files,exportDirectory:o.exportDirectory});
  if(exported.status!=='EXPORTED_RUNTIME_UNVERIFIED'||
     exported.candidateSha256!==staged.candidateSha256)
    return block('EXPORT_BLOCKED');
  // Retain snapshots of the actual published exports before awaiting another
  // checkpoint disk scan. That scan can yield to an independent editor.
  const directory=o.exportDirectory as string;
  const exportedCandidatePath=join(directory,exported.exportFileName);
  const exportedOriginalPath=join(directory,exported.recoveryExportFileName);
  let beforeExport:BigIntStats[];
  try{
    beforeExport=await Promise.all([
      lstat(directory,{bigint:true}),lstat(exportedCandidatePath,{bigint:true}),
      lstat(exportedOriginalPath,{bigint:true})
    ]);
    if(!beforeExport[0].isDirectory()||beforeExport[0].isSymbolicLink()||
       !sameExport(beforeExport[1],beforeExport[1])||
       !sameExport(beforeExport[2],beforeExport[2]))
      return block('EXPORT_BLOCKED');
  }catch{return block('EXPORT_BLOCKED');}
  // The export performs more filesystem I/O. Recheck again instead of
  // issuing a success receipt for a checkpoint replaced in the interim.
  // On failure preserve potential recovery files for native reconciliation;
  // never silently delete them or grant automatic patch/rollback authority.
  const checkpointAfter=await inspectRecoveryCheckpointReadOnly(
    patch,checkpoint.checkpointFileName,files);
  if(checkpointAfter.status!=='CHECKPOINT_RECHECKED_READ_ONLY'||
     checkpointAfter.checkpointSha256!==checkpoint.checkpointSha256||
     checkpointAfter.originalSha256!==staged.originalSha256||
     checkpointAfter.candidateSha256!==staged.candidateSha256)
    return block('CHECKPOINT_BLOCKED');
  // A valid checkpoint cannot attest the TWO separate user-facing exports.
  // Re-read both exact byte sequences after the checkpoint's asynchronous
  // verification and reject even a same-byte pathname/inode replacement.
  // This only issues a bounded, non-authoritative receipt, never install.
  if(await verifyExactCandidateBytesReadOnly(
       exportedCandidatePath,Buffer.from(candidate.candidateSource,'utf8'))!=='MATCH'||
     await verifyExactCandidateBytesReadOnly(
       exportedOriginalPath,Buffer.from(p.source as string,'utf8'))!=='MATCH')
    return block('EXPORT_BLOCKED');
  try{
    const afterExport=await Promise.all([
      lstat(directory,{bigint:true}),lstat(exportedCandidatePath,{bigint:true}),
      lstat(exportedOriginalPath,{bigint:true})
    ]);
    if(!sameExportDirectory(beforeExport[0],afterExport[0])||
       !sameExport(beforeExport[1],afterExport[1])||
       !sameExport(beforeExport[2],afterExport[2])||
       await hasUnsafePathLink(directory))
      return block('EXPORT_BLOCKED');
  }catch{return block('EXPORT_BLOCKED');}
  // The second checkpoint inspection and both published export verifications
  // await I/O. An independent editor may change the original selected script
  // after those checks, leaving the candidate/recovery pair tied to stale
  // source bytes. Observe the live original once more before issuing the
  // final manual-export receipt. This is read-only and non-authoritative:
  // a future write still needs a transaction lock and trusted consent.
  const finalSource=await verifyApprovedSourceFingerprint({
    sourcePath:o.sourcePath as string,
    expectedSha256:staged.originalSha256,userApproved:true
  });
  if(finalSource.status!=='MATCHED_READ_ONLY'||
     finalSource.sha256!==staged.originalSha256)
    return block('SOURCE_CHANGED');
  return Object.freeze({
    status:'MANUAL_EXPORT_READY_RUNTIME_UNVERIFIED' as const,
    backupFileName:staged.backupFileName,
    candidateFileName:staged.candidateFileName,
    exportFileName:exported.exportFileName,
    recoveryExportFileName:exported.recoveryExportFileName,
    checkpointFileName:checkpoint.checkpointFileName,
    checkpointSha256:checkpoint.checkpointSha256,
    sourceSha256:staged.originalSha256,
    candidateSha256:staged.candidateSha256,
    candidateByteLength:exported.byteLength,
    ...noAuthority
  });
 }catch{
  // A partial stage may leave an independent backup/candidate for review.
  // Never blindly clean up possible recovery files on failure.
  return block('INVALID_REQUEST');
 }
}
