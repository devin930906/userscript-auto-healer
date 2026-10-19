/** TASK-007 / REQ-017/018 / TEST-017: manually exported, UNVERIFIED
 * fixture report. Native-only; NEVER include script source, URL, tokens,
 * Chrome/Profile paths, identity claims or real GM/business verification.
 * This is a diagnostic handoff, not a verified Tampermonkey product result.
 */
import {createHash} from 'node:crypto';
import {lstat,open} from 'node:fs/promises';
import {basename,dirname,isAbsolute,resolve} from 'node:path';
import {verifyExactCandidateBytesReadOnly} from '../version/candidate-bytes';
import {hasUnsafePathLink} from '../version/path-boundary';
import {isSupportedGmProbeRunAt} from './tampermonkey-gm-probe';
import type {ManualTampermonkeyDiagnosticSession} from './tampermonkey-diagnostic';

const flags=Object.freeze({
  extensionAuthenticityVerified:false as const,
  scriptInstallationVerified:false as const,
  gmApiVerified:false as const,
  businessVerified:false as const,
  automaticPatchAllowed:false as const,
  automaticRollbackAllowed:false as const
});
type Input=Pick<ManualTampermonkeyDiagnosticSession,
 'runAt'|'expiresAt'|'snapshot'|'consistencySnapshot'|'domSnapshot'>;
type Status=ReturnType<Input['snapshot']>['status'];
type Consistency=ReturnType<Input['consistencySnapshot']>['status'];
const statuses=new Set<Status>([
 'AWAITING_BROWSER_VISITS','AWAITING_REPORTS',
 'SELF_REPORTED_EXPECTATIONS_MATCH','REPORTED_MISMATCH'
]);
const consistencyStatuses=new Set<Consistency>([
 'AWAITING_BROWSER_VISITS','AWAITING_REPORTS','REPORTED_MISMATCH',
 'AWAITING_DOM_OBSERVATIONS','INVALID_DOM_EVIDENCE','DOM_REPORT_CONFLICT',
 'CONSISTENT_UNVERIFIED_FIXTURE_ONLY'
]);
type LimitedDom={observedAt:string;actionCount:0|1;
 fixtureDomMatchesExpected:boolean};
export type LimitedGmReport=Readonly<{
 schema:'uah-manual-gm-fixture-v1';verdict:'NOT_VERIFIED';
 collectedAt:string;expiresAt:string;
 runAt:'document-start'|'document-body'|'document-end'|'document-idle';
 assessment:Readonly<{
   status:Status;observedModes:number;reportedGmDefaultMatched:boolean;
   reportedBrokenFailed:boolean;reportedFixedRecovered:boolean
 }>;
 consistency:Readonly<{status:Consistency;comparedModes:0|1|2}>;
 dom:Readonly<{broken:Readonly<LimitedDom>|null;fixed:Readonly<LimitedDom>|null}>;
}&typeof flags>;
export type LimitedGmReportResult=
 |Readonly<{status:'BLOCKED';code:'INVALID_EVIDENCE'}>
 |Readonly<{status:'UNVERIFIED_REPORT_READY';report:LimitedGmReport}>;
const invalid=():LimitedGmReportResult=>
 Object.freeze({status:'BLOCKED' as const,code:'INVALID_EVIDENCE' as const});
function iso(t:unknown):t is number{
 return typeof t==='number'&&Number.isSafeInteger(t)&&t>=0&&
  t<=8.64e15;
}
function validObservedAt(s:unknown):s is string{
 if(typeof s!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(s))return false;
 const d=Date.parse(s);
 return Number.isFinite(d)&&new Date(d).toISOString()===s;
}
/** Collect only explicitly listed primitive fields: never JSON.stringify
 * the original session, its URLs, its runtime hint or untrusted objects.
 */
export function createLimitedGmReport(
 session:Input,collectedAt:number=Date.now()
):LimitedGmReportResult{
 try{
  if(!session||!iso(collectedAt)||!iso(session.expiresAt)||
     !isSupportedGmProbeRunAt(session.runAt))return invalid();
  const s=session.snapshot(),c=session.consistencySnapshot(),dom=session.domSnapshot();
  if(!s||!c||!dom||!statuses.has(s.status)||
     !consistencyStatuses.has(c.status)||
     !Number.isInteger(s.observedModes)||s.observedModes<0||s.observedModes>2||
     !Number.isInteger(c.comparedModes)||c.comparedModes<0||c.comparedModes>2||
     typeof s.reportedGmDefaultMatched!=='boolean'||
     typeof s.reportedBrokenFailed!=='boolean'||
     typeof s.reportedFixedRecovered!=='boolean'||
     s.extensionAuthenticityVerified!==false||
     s.scriptInstallationVerified!==false||
     s.gmApiVerified!==false||s.businessVerified!==false||
     c.extensionAuthenticityVerified!==false||
     c.scriptInstallationVerified!==false||
     c.gmApiVerified!==false||c.businessVerified!==false)return invalid();
  const picked:{broken:LimitedDom|null;fixed:LimitedDom|null}={broken:null,fixed:null};
  for(const mode of ['broken','fixed'] as const){
    const d=dom[mode];
    if(d===undefined)continue;
    if(d.status!=='LIMITED_FIXTURE_DOM_ONLY'||d.mode!==mode||
       !validObservedAt(d.observedAt)||d.targetCount!==1||
       (d.actionCount!==0&&d.actionCount!==1)||
       typeof d.fixtureDomMatchesExpected!=='boolean'||
       d.extensionAuthenticityVerified!==false||
       d.scriptInstallationVerified!==false||
       d.gmApiVerified!==false||d.businessVerified!==false)return invalid();
    picked[mode]=Object.freeze({observedAt:d.observedAt,
      actionCount:d.actionCount,fixtureDomMatchesExpected:d.fixtureDomMatchesExpected});
  }
  const report:LimitedGmReport=Object.freeze({
   schema:'uah-manual-gm-fixture-v1' as const,
   verdict:'NOT_VERIFIED' as const,
   collectedAt:new Date(collectedAt).toISOString(),
   expiresAt:new Date(session.expiresAt).toISOString(),
   runAt:session.runAt,
   assessment:Object.freeze({
    status:s.status,observedModes:s.observedModes,
    reportedGmDefaultMatched:s.reportedGmDefaultMatched,
    reportedBrokenFailed:s.reportedBrokenFailed,
    reportedFixedRecovered:s.reportedFixedRecovered
   }),
   consistency:Object.freeze({status:c.status,comparedModes:c.comparedModes}),
   dom:Object.freeze(picked),...flags
  });
  if(Buffer.byteLength(JSON.stringify(report),'utf8')>4096)return invalid();
  return Object.freeze({status:'UNVERIFIED_REPORT_READY' as const,report});
 }catch{return invalid();}
}
type SaveFail='INVALID_REQUEST'|'NOT_AUTHORIZED'|'UNSAFE_DESTINATION'|'SAVE_FAILED';
export type SavedGmReportResult=
 |Readonly<{status:'BLOCKED';code:SaveFail}&typeof flags>
 |Readonly<{status:'REPORT_SAVED_UNVERIFIED_ONLY';fileName:string;
   sha256:string;byteLength:number}&typeof flags>;
const block=(code:SaveFail):SavedGmReportResult=>
 Object.freeze({status:'BLOCKED' as const,code,...flags});
/** The path must come from an explicit native Save dialog; the caller alone
 * checks ownership and independent user approval. Exclusive create refuses
 * existing files, and a mismatch remains on disk for manual reconciliation.
 */
export async function saveLimitedGmReportOnly(
 report:LimitedGmReport,outputPath:unknown,userApproved:boolean
):Promise<SavedGmReportResult>{
 if(userApproved!==true)return block('NOT_AUTHORIZED');
 if(typeof outputPath!=='string'||outputPath.length===0||
    outputPath.length>4096||outputPath.includes('\0')||
    !isAbsolute(outputPath)||outputPath!==resolve(outputPath)||
    !/^[^\\/\u0000-\u001f]+\.json$/i.test(basename(outputPath)))
   return block('INVALID_REQUEST');
 try{
  if(!report||report.schema!=='uah-manual-gm-fixture-v1'||
     report.verdict!=='NOT_VERIFIED'||report.automaticPatchAllowed!==false||
     report.automaticRollbackAllowed!==false||
     report.extensionAuthenticityVerified!==false||
     report.scriptInstallationVerified!==false||
     report.gmApiVerified!==false||report.businessVerified!==false)
    return block('INVALID_REQUEST');
  // Reject unexpected extra fields that might leak paths, user scripts or
  // fixture capability URLs when a native caller changes in the future.
  const exact=[
   'schema','verdict','collectedAt','expiresAt','runAt','assessment',
   'consistency','dom','extensionAuthenticityVerified',
   'scriptInstallationVerified','gmApiVerified','businessVerified',
   'automaticPatchAllowed','automaticRollbackAllowed'
  ].sort().join(',');
  if(Object.keys(report).sort().join(',')!==exact)return block('INVALID_REQUEST');
  const bytes=Buffer.from(JSON.stringify(report,null,2)+'\n','utf8');
  if(bytes.length>4096)return block('INVALID_REQUEST');
  const parent=dirname(outputPath);
  if(await hasUnsafePathLink(parent))return block('UNSAFE_DESTINATION');
  const dirBefore=await lstat(parent,{bigint:true});
  if(!dirBefore.isDirectory()||dirBefore.isSymbolicLink())
    return block('UNSAFE_DESTINATION');
  // No overwrite, no symlink target, restrictive creation mode.
  const h=await open(outputPath,'wx',0o600);
  try{await h.writeFile(bytes);await h.sync();}
  finally{await h.close();}
  if(await hasUnsafePathLink(parent))return block('UNSAFE_DESTINATION');
  const dirAfter=await lstat(parent,{bigint:true});
  if(dirAfter.dev!==dirBefore.dev||dirAfter.ino!==dirBefore.ino||
     dirAfter.isSymbolicLink()||!dirAfter.isDirectory())
    return block('UNSAFE_DESTINATION');
  if(await verifyExactCandidateBytesReadOnly(outputPath,bytes)!=='MATCH')
    return block('SAVE_FAILED');
  return Object.freeze({status:'REPORT_SAVED_UNVERIFIED_ONLY' as const,
    fileName:basename(outputPath),
    sha256:createHash('sha256').update(bytes).digest('hex'),
    byteLength:bytes.length,...flags});
 }catch{return block('SAVE_FAILED');}
}
