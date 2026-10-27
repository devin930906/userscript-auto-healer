/** TASK-007 / REQ-017/018 / TEST-017: manually exported, UNVERIFIED
 * fixture report. Native-only; NEVER include script source, URL, tokens,
 * Chrome/Profile paths, identity claims or real GM/business verification.
 * This is a diagnostic handoff, not a verified Tampermonkey product result.
 */
import {createHash} from 'node:crypto';
import {isProxy} from 'node:util/types';
import {lstat,open} from 'node:fs/promises';
import {basename,dirname,isAbsolute,resolve} from 'node:path';
import {verifyExactCandidateBytesReadOnly} from '../version/candidate-bytes';
import {hasUnsafePathLink} from '../version/path-boundary';
import {isSupportedGmProbeRunAt,MAX_GM_PROBE_TTL_MS} from './tampermonkey-gm-probe';
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
 'runAt'|'browserVersion'|'expiresAt'|'snapshot'|'consistencySnapshot'|'domSnapshot'>;
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
 schema:'uah-manual-gm-fixture-v3';verdict:'NOT_VERIFIED';
 browserVersion:string;
 collectedAt:string;expiresAt:string;
 runAt:'document-start'|'document-body'|'document-end'|'document-idle';
 assessment:Readonly<{
   status:Status;observedModes:number;reportedGmDefaultMatched:boolean;
   reportedGmStorageRoundtripMatched:boolean;
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

/** Capture only inert own-data fields. A native report boundary must not
 * invoke a caller-controlled accessor or Proxy trap when reading a fixture
 * session or one of its snapshots. No secrets/unknown extra fields are copied.
 */
function captureFields(
 value:unknown,allowed:readonly string[],required:readonly string[]=allowed
):Record<string,unknown>|null{
 try{
  if(!value||typeof value!=='object'||isProxy(value)||Array.isArray(value))
   return null;
  const proto=Object.getPrototypeOf(value);
  if(proto!==Object.prototype&&proto!==null)return null;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  const keys=Reflect.ownKeys(descriptors);
  if(keys.some(k=>typeof k!=='string'||!allowed.includes(k))||
     required.some(k=>!Object.prototype.hasOwnProperty.call(descriptors,k)))
   return null;
  const out:Record<string,unknown>=Object.create(null);
  for(const key of keys as string[]){
   const d=descriptors[key];
   if(!Object.prototype.hasOwnProperty.call(d,'value'))return null;
   out[key]=d.value;
  }
  return out;
 }catch{return null;}
}

function iso(t:unknown):t is number{
 return typeof t==='number'&&Number.isSafeInteger(t)&&t>=0&&
  t<=8.64e15;
}
function validObservedAt(s:unknown):s is string{
 if(typeof s!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(s))return false;
 const d=Date.parse(s);
 return Number.isFinite(d)&&new Date(d).toISOString()===s;
}
/** Chrome's four-part binary version is obtained from the signed, owned
 * Chrome process via the diagnostic session, never from an HTTP receipt.
 * Preserve only the numeric version; never export executable/Profile paths. */
function validChromeVersion(value:unknown):value is string{
 return typeof value==='string'&&
   /^\d{1,4}(?:\.\d{1,8}){3}$/.test(value);
}
/** Check *relationships*, not merely schemas. A diagnostic JSON remains
 * explicitly unverified, but cannot falsely claim that two distinct DOM
 * samples agree with both reports when the evidence says otherwise.
 *
 * This is not runtime authentication: callers may still supply self-reports.
 */
function coherentLimitedEvidence(
 assessment:LimitedGmReport['assessment'],
 consistency:LimitedGmReport['consistency'],
 dom:LimitedGmReport['dom']
):boolean{
 // These are aggregate HTTP receipt claims, NOT GM attestation. The
 // collector derives both GM checks only when BOTH mode receipts exist,
 // and no per-mode business claim can exist without its own receipt.
 // Preserve partial legitimate reports but reject impossible combinations,
 // including hand-edited reports submitted through native Save.
 const n=assessment.observedModes;
 if((n<2&&(assessment.reportedGmDefaultMatched||
            assessment.reportedGmStorageRoundtripMatched))||
    (n===0&&(assessment.reportedBrokenFailed||
             assessment.reportedFixedRecovered))||
    (n===1&&assessment.reportedBrokenFailed&&
            assessment.reportedFixedRecovered))return false;
 const matchingReports=assessment.observedModes===2&&
   assessment.reportedGmDefaultMatched&&assessment.reportedGmStorageRoundtripMatched&&
   assessment.reportedBrokenFailed&&
   assessment.reportedFixedRecovered;
 if(assessment.status==='SELF_REPORTED_EXPECTATIONS_MATCH'){
   if(!matchingReports)return false;
 }else if(
   (assessment.status==='AWAITING_REPORTS'&&assessment.observedModes===2)||
   (assessment.status==='REPORTED_MISMATCH'&&matchingReports)
 )return false;
 if(assessment.status!=='SELF_REPORTED_EXPECTATIONS_MATCH'){
   return consistency.status===assessment.status&&consistency.comparedModes===0;
 }
 if(consistency.status==='AWAITING_BROWSER_VISITS'||
    consistency.status==='AWAITING_REPORTS'||
    consistency.status==='REPORTED_MISMATCH')return false;
 if(consistency.status==='CONSISTENT_UNVERIFIED_FIXTURE_ONLY'){
   const broken=dom.broken,fixed=dom.fixed;
   return consistency.comparedModes===2&&broken!==null&&fixed!==null&&
     broken.actionCount===0&&broken.fixtureDomMatchesExpected===true&&
     fixed.actionCount===1&&fixed.fixtureDomMatchesExpected===true&&
     broken.observedAt!==fixed.observedAt;
 }
 // The consistency evaluator visits 'broken' first, then 'fixed', and
 // exits before incrementing when it encounters a missing/invalid mode.
 if(consistency.comparedModes===2)return false;
 if(consistency.comparedModes===1){
   return dom.broken!==null&&dom.broken.actionCount===0&&
     dom.broken.fixtureDomMatchesExpected===true;
 }
 return true;
}

/** Refuse impossible diagnostic timelines even for explicitly UNVERIFIED
 * evidence. Fixture DOM samples must precede the exported snapshot and the
 * bounded fixture expiry. Do not infer a required broken/fixed visit order:
 * the human tester may visit either mode first.
 */
function chronologicalLimitedEvidence(
 report:LimitedGmReport
):boolean{
 const collected=Date.parse(report.collectedAt);
 const expires=Date.parse(report.expiresAt);
 // The isolated probe always expires within MAX_GM_PROBE_TTL_MS of its
 // creation. Even an otherwise plausible, still UNVERIFIED snapshot cannot
 // precede the earliest possible consented session start.
 const earliestPossibleStart=expires-MAX_GM_PROBE_TTL_MS;
 if(collected>=expires||collected<earliestPossibleStart)return false;
 for(const sample of [report.dom.broken,report.dom.fixed]){
  if(sample===null)continue;
  const observed=Date.parse(sample.observedAt);
  if(observed<earliestPossibleStart||
     observed>collected||observed>=expires)return false;
 }
 return true;
}

/** Collect only explicitly listed primitive fields: never JSON.stringify
 * the original session, its URLs, its runtime hint or untrusted objects.
 */
export function createLimitedGmReport(
 session:Input,collectedAt:number=Date.now()
):LimitedGmReportResult{
 try{
  const meta=captureFields(session,[
   'runAt','browserVersion','expiresAt','snapshot','consistencySnapshot',
   'domSnapshot','status','source','installUrl','origin','runtimeHint',
   'visit','observe','stop','domSnapshot','consistencySnapshot','modeReportSnapshot'
  ],['runAt','browserVersion','expiresAt','snapshot',
     'consistencySnapshot','domSnapshot']);
  if(!meta||!iso(collectedAt)||!iso(meta.expiresAt)||
     !isSupportedGmProbeRunAt(meta.runAt)||
     !validChromeVersion(meta.browserVersion)||
     typeof meta.snapshot!=='function'||isProxy(meta.snapshot)||
     typeof meta.consistencySnapshot!=='function'||isProxy(meta.consistencySnapshot)||
     typeof meta.domSnapshot!=='function'||isProxy(meta.domSnapshot))return invalid();
  const s=captureFields((meta.snapshot as Input['snapshot'])(),[
   'status','observedModes','reportedGmDefaultMatched',
   'reportedGmStorageRoundtripMatched','reportedBrokenFailed',
   'reportedFixedRecovered','extensionAuthenticityVerified',
   'scriptInstallationVerified','gmApiVerified','businessVerified'
  ]);
  const c=captureFields((meta.consistencySnapshot as Input['consistencySnapshot'])(),[
   'status','comparedModes','extensionAuthenticityVerified',
   'scriptInstallationVerified','gmApiVerified','businessVerified'
  ]);
  const dom=captureFields((meta.domSnapshot as Input['domSnapshot'])(),[
   'broken','fixed'
  ],[]);
  if(!s||!c||!dom||!statuses.has(s.status as Status)||
     !consistencyStatuses.has(c.status as Consistency)||
     !Number.isInteger(s.observedModes)||(s.observedModes as number)<0||
     (s.observedModes as number)>2||
     !Number.isInteger(c.comparedModes)||(c.comparedModes as number)<0||
     (c.comparedModes as number)>2||
     typeof s.reportedGmDefaultMatched!=='boolean'||
     typeof s.reportedGmStorageRoundtripMatched!=='boolean'||
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
    const raw=dom[mode];
    if(raw===undefined)continue;
    const d=captureFields(raw,[
     'status','mode','observedAt','targetCount','actionCount',
     'fixtureDomMatchesExpected','extensionAuthenticityVerified',
     'scriptInstallationVerified','gmApiVerified','businessVerified'
    ]);
    if(!d||d.status!=='LIMITED_FIXTURE_DOM_ONLY'||d.mode!==mode||
       !validObservedAt(d.observedAt)||d.targetCount!==1||
       (d.actionCount!==0&&d.actionCount!==1)||
       typeof d.fixtureDomMatchesExpected!=='boolean'||
       d.extensionAuthenticityVerified!==false||
       d.scriptInstallationVerified!==false||
       d.gmApiVerified!==false||d.businessVerified!==false)return invalid();
    picked[mode]=Object.freeze({observedAt:d.observedAt as string,
      actionCount:d.actionCount as 0|1,
      fixtureDomMatchesExpected:d.fixtureDomMatchesExpected as boolean});
  }
  const report:LimitedGmReport=Object.freeze({
   schema:'uah-manual-gm-fixture-v3' as const,
   verdict:'NOT_VERIFIED' as const,
   browserVersion:meta.browserVersion,
   collectedAt:new Date(collectedAt).toISOString(),
   expiresAt:new Date(meta.expiresAt as number).toISOString(),
   runAt:meta.runAt,
   assessment:Object.freeze({
    status:s.status as Status,observedModes:s.observedModes as number,
    reportedGmDefaultMatched:s.reportedGmDefaultMatched as boolean,
    reportedGmStorageRoundtripMatched:s.reportedGmStorageRoundtripMatched as boolean,
    reportedBrokenFailed:s.reportedBrokenFailed as boolean,
    reportedFixedRecovered:s.reportedFixedRecovered as boolean
   }),
   consistency:Object.freeze({status:c.status as Consistency,comparedModes:c.comparedModes as 0|1|2}),
   dom:Object.freeze(picked),...flags
  });
  if(!coherentLimitedEvidence(report.assessment,report.consistency,report.dom)||
      !chronologicalLimitedEvidence(report))
    return invalid();
  if(Buffer.byteLength(JSON.stringify(report),'utf8')>4096)return invalid();
  return Object.freeze({status:'UNVERIFIED_REPORT_READY' as const,report});
 }catch{return invalid();}
}

const savedReportKeys=[
 'schema','verdict','browserVersion','collectedAt','expiresAt','runAt','assessment',
 'consistency','dom','extensionAuthenticityVerified',
 'scriptInstallationVerified','gmApiVerified','businessVerified',
 'automaticPatchAllowed','automaticRollbackAllowed'
];
/** Inspect own data descriptors, including nested objects: getters, symbols,
 * extra fields and non-plain prototypes are not safe export data.
 */
function exactData(input:unknown,fields:readonly string[]):Record<string,unknown>|null{
 // Node's intrinsic Proxy detection does not execute user-defined traps,
 // including for revoked proxies. Do this before any descriptor reflection.
 if(!input||typeof input!=='object'||isProxy(input)||Array.isArray(input))return null;
 const prototype=Object.getPrototypeOf(input);
 if(prototype!==Object.prototype&&prototype!==null)return null;
 const descriptors=Object.getOwnPropertyDescriptors(input);
 const ownKeys=Reflect.ownKeys(descriptors);
 if(ownKeys.length!==fields.length||
    ownKeys.some(key=>typeof key!=='string')||
    fields.some(key=>!Object.prototype.hasOwnProperty.call(descriptors,key)||
      !Object.prototype.hasOwnProperty.call(descriptors[key],'value')))return null;
 const picked:Record<string,unknown>=Object.create(null);
 for(const key of fields)picked[key]=descriptors[key].value;
 return picked;
}
/** A caller can pass a forged runtime object despite the TypeScript type.
 * Only a newly constructed, closed-schema snapshot may be serialized.
 */
function sanitizeReportForSave(input:unknown):LimitedGmReport|null{
 const root=exactData(input,savedReportKeys);
 if(!root)return null;
 const assessment=exactData(root.assessment,[
  'status','observedModes','reportedGmDefaultMatched',
  'reportedGmStorageRoundtripMatched',
  'reportedBrokenFailed','reportedFixedRecovered'
 ]);
 const consistency=exactData(root.consistency,['status','comparedModes']);
 const dom=exactData(root.dom,['broken','fixed']);
 if(!assessment||!consistency||!dom||
    root.schema!=='uah-manual-gm-fixture-v3'||root.verdict!=='NOT_VERIFIED'||
    !validChromeVersion(root.browserVersion)||
    !validObservedAt(root.collectedAt)||!validObservedAt(root.expiresAt)||
    !isSupportedGmProbeRunAt(root.runAt)||
    root.extensionAuthenticityVerified!==false||
    root.scriptInstallationVerified!==false||root.gmApiVerified!==false||
    root.businessVerified!==false||root.automaticPatchAllowed!==false||
    root.automaticRollbackAllowed!==false||
    !statuses.has(assessment.status as Status)||
    !Number.isInteger(assessment.observedModes)||
    (assessment.observedModes as number)<0||
    (assessment.observedModes as number)>2||
    typeof assessment.reportedGmDefaultMatched!=='boolean'||
    typeof assessment.reportedGmStorageRoundtripMatched!=='boolean'||
    typeof assessment.reportedBrokenFailed!=='boolean'||
    typeof assessment.reportedFixedRecovered!=='boolean'||
    !consistencyStatuses.has(consistency.status as Consistency)||
    !Number.isInteger(consistency.comparedModes)||
    (consistency.comparedModes as number)<0||
    (consistency.comparedModes as number)>2)return null;
 function safeDom(mode:'broken'|'fixed'):Readonly<LimitedDom>|null|undefined{
  if(dom![mode]===null)return null;
  const value=exactData(dom![mode],[
   'observedAt','actionCount','fixtureDomMatchesExpected'
  ]);
  if(!value||!validObservedAt(value.observedAt)||
     (value.actionCount!==0&&value.actionCount!==1)||
     typeof value.fixtureDomMatchesExpected!=='boolean')return undefined;
  return Object.freeze({
   observedAt:value.observedAt,actionCount:value.actionCount,
   fixtureDomMatchesExpected:value.fixtureDomMatchesExpected
  });
 }
 const broken=safeDom('broken'),fixed=safeDom('fixed');
 if(broken===undefined||fixed===undefined)return null;
 const checkedAssessment={
   status:assessment.status as Status,
   observedModes:assessment.observedModes as number,
   reportedGmDefaultMatched:assessment.reportedGmDefaultMatched as boolean,
   reportedGmStorageRoundtripMatched:assessment.reportedGmStorageRoundtripMatched as boolean,
   reportedBrokenFailed:assessment.reportedBrokenFailed as boolean,
   reportedFixedRecovered:assessment.reportedFixedRecovered as boolean
 };
 const checkedConsistency={
   status:consistency.status as Consistency,
   comparedModes:consistency.comparedModes as 0|1|2
 };
 const checkedDom={broken,fixed};
 const checkedReport={
  schema:'uah-manual-gm-fixture-v3' as const,
  verdict:'NOT_VERIFIED' as const,
  browserVersion:root.browserVersion,
  collectedAt:root.collectedAt,expiresAt:root.expiresAt,runAt:root.runAt,
  assessment:checkedAssessment,consistency:checkedConsistency,dom:checkedDom,
  ...flags
 };
 if(!coherentLimitedEvidence(checkedAssessment,checkedConsistency,checkedDom)||
    !chronologicalLimitedEvidence(checkedReport))
   return null;
 return Object.freeze({
  schema:'uah-manual-gm-fixture-v3',verdict:'NOT_VERIFIED',
  browserVersion:root.browserVersion,
  collectedAt:root.collectedAt,expiresAt:root.expiresAt,runAt:root.runAt,
  assessment:Object.freeze(checkedAssessment),
  consistency:Object.freeze(checkedConsistency),
  dom:Object.freeze(checkedDom),...flags
 });
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
 // Only standalone files are valid native export destinations. A colon
 // in the leaf can designate an NTFS alternate data stream; Win32 device
 // aliases such as NUL.json do not denote ordinary independent files.
 // Refuse both before open('wx'), which alone cannot enforce this boundary.
 const leaf=basename(outputPath);
 if(leaf.includes(':')||
    (process.platform==='win32'&&
     /^(?:CON|CONIN\$|CONOUT\$|PRN|AUX|NUL|(?:COM|LPT)[1-9\u00B9\u00B2\u00B3])(?:\.|$)/i.test(leaf)))
   return block('INVALID_REQUEST');
 try{
  const sanitized=sanitizeReportForSave(report);
  if(!sanitized)return block('INVALID_REQUEST');
  const bytes=Buffer.from(JSON.stringify(sanitized,null,2)+'\n','utf8');
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
