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
import {basename,dirname,isAbsolute,relative} from 'node:path';
import {types as nodeTypes} from 'node:util';
import {proposeFromReadOnlyDomDiagnostic} from './scenario-candidate';
import {proposeLiteralSelectorPatch,type LiteralPatchRequest} from './patch-planner';
import {stageReviewedCandidateOnly} from '../version/staged-candidate';
import {hasUnsafePathLink} from '../version/path-boundary';
import {exportReviewedCandidateForManualInstall,insideProtectedBackup} from '../export/manual-candidate-export';

type Reason='INVALID_REQUEST'|'NOT_AUTHORIZED'|'DOM_CANDIDATE_BLOCKED'|
 'PATCH_REVIEW_BLOCKED'|'STAGE_BLOCKED'|'EXPORT_BLOCKED';
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
   recoveryExportFileName:string;
   sourceSha256:string;candidateSha256:string;candidateByteLength:number
  }&typeof noAuthority>;
const block=(reason:Reason):ManualRepairFlowResult=>
 Object.freeze({status:'BLOCKED' as const,reason,...noAuthority});
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
  const exported=await exportReviewedCandidateForManualInstall(
    patch,staged,{...files,exportDirectory:o.exportDirectory});
  if(exported.status!=='EXPORTED_RUNTIME_UNVERIFIED'||
     exported.candidateSha256!==staged.candidateSha256)
    return block('EXPORT_BLOCKED');
  return Object.freeze({
    status:'MANUAL_EXPORT_READY_RUNTIME_UNVERIFIED' as const,
    backupFileName:staged.backupFileName,
    candidateFileName:staged.candidateFileName,
    exportFileName:exported.exportFileName,
    recoveryExportFileName:exported.recoveryExportFileName,
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
