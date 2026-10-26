/** TASK-007 / REQ-017/018: manual Tampermonkey diagnostic orchestration.
 * Only an actual application-owned, still-running Chrome instance with a
 * Tampermonkey runtime TARGET HINT may host the consented, disposable fixture.
 * The operator must separately and explicitly install a temporary test script.
 * Neither HTTP self-reports nor CDP page metadata attest extension provenance,
 * GM calls or business success. No existing scripts/profiles are ever edited.
 */
import {isProxy} from 'node:util/types';
import type {ManagedLaunchResult} from '../browser/owned-chrome';
import {isLiveApprovedChromeSession} from '../browser/owned-chrome';
import {openApprovedTarget,type OpenTargetResult} from '../browser/cdp-target';
import {observeApprovedDom,type ObservationResult} from '../observe/dom-observer';
import {
 inspectApprovedTampermonkeyRuntime,type ManagerPresenceResult
} from './tampermonkey-adapter';
import {
 startIsolatedTampermonkeyGmProbe,type GmProbeReceipt,type GmProbeMode,
 type GmProbeRunAt,isSupportedGmProbeRunAt,MAX_GM_PROBE_TTL_MS
} from './tampermonkey-gm-probe';

export interface ManualDiagnosticAssessment {
 readonly status:'AWAITING_BROWSER_VISITS'|'AWAITING_REPORTS'|
   'SELF_REPORTED_EXPECTATIONS_MATCH'|'REPORTED_MISMATCH';
 readonly observedModes:number;
 readonly reportedGmDefaultMatched:boolean;
 readonly reportedGmStorageRoundtripMatched:boolean;
 readonly reportedBrokenFailed:boolean;
 readonly reportedFixedRecovered:boolean;
 readonly extensionAuthenticityVerified:false;
 readonly scriptInstallationVerified:false;
 readonly gmApiVerified:false;
 readonly businessVerified:false;
}
/** Observation made by the application's read-only CDP DOM inspector, not a
 * Tampermonkey provenance or GM API attestation. A matched fixture could
 * still be modified by an unrelated extension or page code.
 */
export interface FixtureDomEvidence {
 readonly status:'LIMITED_FIXTURE_DOM_ONLY';
 readonly mode:GmProbeMode;
 readonly observedAt:string;
 readonly targetCount:1;
 readonly actionCount:0|1;
 readonly fixtureDomMatchesExpected:boolean;
 readonly extensionAuthenticityVerified:false;
 readonly scriptInstallationVerified:false;
 readonly gmApiVerified:false;
 readonly businessVerified:false;
}
export type FixtureDomEvidenceResult =
 |{readonly ok:true;readonly evidence:FixtureDomEvidence}
 |{readonly ok:false;readonly code:
    'NOT_AUTHORIZED'|'INVALID_MODE'|'SESSION_NOT_ACTIVE'|
    'MODE_NOT_VISITED'|'OBSERVATION_IN_PROGRESS'|'INVALID_FIXTURE_OBSERVATION'|
    Extract<ObservationResult,{ok:false}>['code']};
const FIXTURE_SELECTORS=[
 '#current-target','#obsolete-target','[data-uah-probe-action="done"]',
 '#current-target[data-uah-probe-action="done"]'
] as const;

/** Current read-only observer always lists the generic closed-shadow unknown.
 * Additional/forged blind spots invalidate expected fixture DOM coverage.
 * Read descriptors, never execute untrusted array getters or proxy traps.
 */
function validFixtureBlindSpots(value:unknown):boolean{
 try{
  if(!Array.isArray(value)||isProxy(value)||
     Object.getPrototypeOf(value)!==Array.prototype)return false;
  const entries=Object.getOwnPropertyDescriptors(value);
  const names=Reflect.ownKeys(entries);
  const len=Object.getOwnPropertyDescriptor(value,'length')?.value;
  // No blind spots is a valid stronger fixture sample; the observer may also
  // report its one unconditional generic closed-shadow limitation.
  if(len===0)return names.length===1&&names[0]==='length';
  return len===1&&names.length===2&&names.includes('0')&&
    names.includes('length')&&
    Object.prototype.hasOwnProperty.call(entries['0'],'value')&&
    entries['0'].value==='CLOSED_SHADOW_ROOT_UNKNOWN';
 }catch{return false;}
}
/** Pure, conservative mapping of a limited DOM sample into a diagnostic
 * observation. Require the action attribute on the one approved target,
 * not merely anywhere else in the page. Even a perfect result can NEVER set businessVerified=true.
 */
export function summarizeFixtureDomEvidence(
 mode:GmProbeMode,observed:ObservationResult
):FixtureDomEvidenceResult{
 const invalid=():FixtureDomEvidenceResult=>({ok:false,code:'INVALID_FIXTURE_OBSERVATION'});
 if(mode!=='broken'&&mode!=='fixed')return {ok:false,code:'INVALID_MODE'};
 // Check data descriptors, not property reads. A CDP or deserialized result
 // may contain a Proxy, getter, symbol or unexpected field.
 const failed=descriptorFields(observed,['ok','code'],true);
 if(failed&&failed.ok===false){
   const errors:readonly string[]=[
     'NOT_AUTHORIZED','UNVERIFIED_BROWSER','UNVERIFIED_TARGET',
     'INVALID_OPTIONS','CDP_FAILED','DOM_TOO_COMPLEX','CANCELLED'
   ];
   return typeof failed.code==='string'&&errors.includes(failed.code)
     ?{ok:false,code:failed.code as Extract<ObservationResult,{ok:false}>['code']}
     :invalid();
 }
 const sample=descriptorFields(observed,[
   'ok','status','observedAt','originMatchesApproved','routeChanged',
   'summary','selectorCounts','fullPageVerified','userscriptVerified'
 ],true);
 if(!sample||sample.ok!==true)return invalid();
 const counts=descriptorFields(sample.selectorCounts,FIXTURE_SELECTORS,true);
 const summary=descriptorFields(sample.summary,[
   'elementCount','iframeCount','visibleShadowRoots','blindSpots'
 ],true);
 if(!counts||!summary||
    !Number.isSafeInteger(summary.elementCount)||
    (summary.elementCount as number)<1||
    !Number.isSafeInteger(summary.iframeCount)||
    (summary.iframeCount as number)<0||
    (summary.iframeCount as number)>(summary.elementCount as number)||
    !Number.isSafeInteger(summary.visibleShadowRoots)||
    (summary.visibleShadowRoots as number)<0||
    (summary.visibleShadowRoots as number)>(summary.elementCount as number)||
    !validFixtureBlindSpots(summary.blindSpots))return invalid();
 const current=counts[FIXTURE_SELECTORS[0]];
 const obsolete=counts[FIXTURE_SELECTORS[1]];
 const acted=counts[FIXTURE_SELECTORS[2]];
 const actedOnTarget=counts[FIXTURE_SELECTORS[3]];
 // The controlled top-frame fixture has no child documents or visible shadow
 // subtrees. Selector counts from a limited top-level CDP sample cannot
 // establish behavior inside such uninspected DOM regions.
 if(summary.iframeCount!==0||summary.visibleShadowRoots!==0||
    sample.routeChanged!==false||sample.originMatchesApproved!==true||
    sample.status!=='LIMITED_DOM_OBSERVATION'||
    sample.fullPageVerified!==false||sample.userscriptVerified!==false||
    !Number.isSafeInteger(current)||current!==1||
    !Number.isSafeInteger(obsolete)||obsolete!==0||
    !Number.isSafeInteger(acted)||(acted!==0&&acted!==1)||
    !Number.isSafeInteger(actedOnTarget)||actedOnTarget!==acted||
    (acted as number)>(summary.elementCount as number)||
    typeof sample.observedAt!=='string'||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(sample.observedAt)||
    !Number.isFinite(Date.parse(sample.observedAt))||
    new Date(sample.observedAt).toISOString()!==sample.observedAt)
   return invalid();
 return {ok:true,evidence:Object.freeze({
   status:'LIMITED_FIXTURE_DOM_ONLY',mode,observedAt:sample.observedAt,
   targetCount:1,actionCount:acted as 0|1,
   fixtureDomMatchesExpected:acted===(mode==='broken'?0:1),
   ...emptyFlags
 })};
}

/** Two independently limited observations can contradict each other, but even
 * matching reports and DOM never authenticate Tampermonkey, GM or a repair.
 */
export interface ManualFixtureConsistency {
 readonly status:'AWAITING_BROWSER_VISITS'|'AWAITING_REPORTS'|'REPORTED_MISMATCH'|
  'AWAITING_DOM_OBSERVATIONS'|'INVALID_DOM_EVIDENCE'|'DOM_REPORT_CONFLICT'|
  'CONSISTENT_UNVERIFIED_FIXTURE_ONLY';
 readonly comparedModes:0|1|2;
 readonly extensionAuthenticityVerified:false;
 readonly scriptInstallationVerified:false;
 readonly gmApiVerified:false;
 readonly businessVerified:false;
}
type VisitStatus=
 |{readonly ok:true;readonly status:'TARGET_ID_AND_URL_MATCH_ONLY';
   readonly targetId:string;readonly mode:GmProbeMode;
   readonly gmApiVerified:false;readonly businessVerified:false}
 |{readonly ok:false;readonly code:'NOT_AUTHORIZED'|'INVALID_MODE'|
   'SESSION_NOT_ACTIVE'|'MODE_ALREADY_OPENED'|'MODE_VISIT_IN_PROGRESS'|
   Extract<OpenTargetResult,{ok:false}>['code']};
export interface ManualTampermonkeyDiagnosticSession {
 readonly status:'MANUAL_TEST_READY_NOT_VERIFIED';
 readonly runAt:GmProbeRunAt;
 /** Version from the independently verified application-owned Chrome binary;
  * this never establishes Tampermonkey extension identity or script execution. */
 readonly browserVersion:string;
 /** Contains a single-run token. Never log or put this in arbitrary renderer content. */
 readonly source:string;
 /** Sensitive, temporary URL; native diagnostic tester must import explicitly. */
 readonly installUrl:string;
 readonly origin:string;
 readonly expiresAt:number;
 readonly runtimeHint:Extract<ManagerPresenceResult,{ok:true}>;
 /** Only navigates a new tab in the already-owned isolated Chrome. */
 readonly visit:(mode:GmProbeMode,explicitUserApproved:boolean)=>Promise<VisitStatus>;
 /** Browser-verified tab and actual DOM counts only; does NOT prove GM calls. */
 readonly observe:(mode:GmProbeMode,explicitUserApproved:boolean,
   signal?:AbortSignal)=>Promise<FixtureDomEvidenceResult>;
 /** Snapshot of limited, non-attesting DOM observations, no script token. */
 readonly domSnapshot:()=>Readonly<Partial<Record<GmProbeMode,FixtureDomEvidence>>>;
 /** Cross-check independent, non-attesting HTTP and DOM evidence. */
 readonly consistencySnapshot:()=>ManualFixtureConsistency;
 /** Always marks authenticity, installation, GM and business verification false. */
 readonly snapshot:()=>ManualDiagnosticAssessment;
 /** Closes only the disposable fixture, NOT the separately owned Chrome. */
 readonly stop:()=>Promise<void>;
}
export type StartDiagnosticResult=
 |{readonly ok:true;readonly session:ManualTampermonkeyDiagnosticSession}
 |{readonly ok:false;readonly code:
   'NOT_AUTHORIZED'|'CANCELLED'|'UNVERIFIED_BROWSER'|
   'INVALID_OPTIONS'|'BIND_FAILED'|
   Extract<ManagerPresenceResult,{ok:false}>['code']};

const emptyFlags={
 extensionAuthenticityVerified:false as const,scriptInstallationVerified:false as const,
 gmApiVerified:false as const,businessVerified:false as const
};
/** A read-only, closed-schema copy of a potentially hostile browser or
 * fixture report. Never invoke untrusted accessors/Proxy get traps. */
function descriptorFields(
 value:unknown,allowed:readonly string[],exact=false
):Record<string,unknown>|null{
 try{
   if(value===null||typeof value!=='object'||isProxy(value)||Array.isArray(value))return null;
   const proto=Object.getPrototypeOf(value);
   if(proto!==Object.prototype&&proto!==null)return null;
   const descriptors=Object.getOwnPropertyDescriptors(value);
   const keys=Reflect.ownKeys(descriptors);
   if((exact&&keys.length!==allowed.length)||
      keys.some(k=>typeof k!=='string'||!allowed.includes(k)))return null;
   const data:Record<string,unknown>=Object.create(null);
   for(const key of keys){
     const d=descriptors[key as string];
     if(!Object.prototype.hasOwnProperty.call(d,'value'))return null;
     data[key as string]=d.value;
   }
   return data;
 }catch{return null;}
}
const receiptFields=[
  'status','mode','reportedGmDefaultMatched',
  'reportedGmStorageRoundtripMatched','reportedBusinessAction',
  'extensionAuthenticityVerified','scriptInstallationVerified',
  'gmApiVerified','businessVerified'
] as const;
function cleanReceipt(value:unknown,mode:GmProbeMode):GmProbeReceipt|null{
 const x=descriptorFields(value,receiptFields,true);
 if(!x||x.status!=='SELF_REPORTED_FIXTURE_ONLY'||x.mode!==mode||
   typeof x.reportedGmDefaultMatched!=='boolean'||
   typeof x.reportedGmStorageRoundtripMatched!=='boolean'||
   typeof x.reportedBusinessAction!=='boolean'||
   x.extensionAuthenticityVerified!==false||
   x.scriptInstallationVerified!==false||
   x.gmApiVerified!==false||x.businessVerified!==false)
   return null;
 return Object.freeze({
   status:'SELF_REPORTED_FIXTURE_ONLY',mode,
   reportedGmDefaultMatched:x.reportedGmDefaultMatched,
   reportedGmStorageRoundtripMatched:x.reportedGmStorageRoundtripMatched,
   reportedBusinessAction:x.reportedBusinessAction,
   ...emptyFlags
 });
}
/** Pure evaluation of UNTRUSTED observations: matching reports remain unverified. */
export function assessManualProbeObservations(
 receipts:unknown,visits:unknown
):ManualDiagnosticAssessment{
 const r=descriptorFields(receipts,['broken','fixed'])??Object.create(null);
 const v=descriptorFields(visits,['broken','fixed'])??Object.create(null);
 const a=cleanReceipt(r.broken,'broken');
 const b=cleanReceipt(r.fixed,'fixed');
 const observedModes=Number(a!==null)+Number(b!==null);
 const reportedGmDefaultMatched=a!==null&&b!==null&&
   a.reportedGmDefaultMatched&&b.reportedGmDefaultMatched;
 const reportedGmStorageRoundtripMatched=a!==null&&b!==null&&
   a.reportedGmStorageRoundtripMatched&&b.reportedGmStorageRoundtripMatched;
 const reportedBrokenFailed=a!==null&&a.reportedBusinessAction===false;
 const reportedFixedRecovered=b!==null&&b.reportedBusinessAction===true;
 const exactVisits=Object.keys(v).sort().join(',')==='broken,fixed'&&
   v.broken===true&&v.fixed===true;
 const status:ManualDiagnosticAssessment['status']=
   !exactVisits?'AWAITING_BROWSER_VISITS':
   !('broken' in r)||!('fixed' in r)?'AWAITING_REPORTS':
   a&&b&&reportedGmDefaultMatched&&reportedGmStorageRoundtripMatched&&
   reportedBrokenFailed&&reportedFixedRecovered?
     'SELF_REPORTED_EXPECTATIONS_MATCH':'REPORTED_MISMATCH';
 return {status,observedModes,
   reportedGmDefaultMatched,reportedGmStorageRoundtripMatched,
   reportedBrokenFailed,reportedFixedRecovered,
   ...emptyFlags};
}

/** Reject a plausible self-report when the independently observed fixture DOM
 * disagrees. Never turn consistency into manager, GM, or business verification.
 * Missing evidence stays pending; malformed evidence fails closed.
 */
export function correlateManualFixtureEvidence(
 receipts:unknown,visits:unknown,domEvidence:unknown
):ManualFixtureConsistency{
 // Snapshot before assessment: a getter or Proxy must not silently change
 // the receipt between the status decision and the DOM comparison.
 const r=descriptorFields(receipts,['broken','fixed']);
 const v=descriptorFields(visits,['broken','fixed']);
 const assessment=assessManualProbeObservations(r,v);
 const result=(status:ManualFixtureConsistency['status'],comparedModes:0|1|2):
   ManualFixtureConsistency=>Object.freeze({status,comparedModes,...emptyFlags});
 if(assessment.status!=='SELF_REPORTED_EXPECTATIONS_MATCH')
   return result(assessment.status,0);
 const dom=descriptorFields(domEvidence,['broken','fixed']);
 if(!dom)return result('INVALID_DOM_EVIDENCE',0);
 let compared:0|1|2=0;
 const observedTimes=new Set<string>();
 const evidenceFields=[
   'status','mode','observedAt','targetCount','actionCount',
   'fixtureDomMatchesExpected','extensionAuthenticityVerified',
   'scriptInstallationVerified','gmApiVerified','businessVerified'
 ] as const;
 for(const mode of ['broken','fixed'] as const){
   if(!Object.prototype.hasOwnProperty.call(dom,mode))
     return result('AWAITING_DOM_OBSERVATIONS',compared);
   const e=descriptorFields(dom[mode],evidenceFields,true);
   const expected=mode==='fixed'?1:0;
   if(!e||e.status!=='LIMITED_FIXTURE_DOM_ONLY'||e.mode!==mode||
      typeof e.observedAt!=='string'||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(e.observedAt)||
      !Number.isFinite(Date.parse(e.observedAt))||
      new Date(e.observedAt).toISOString()!==e.observedAt||
      observedTimes.has(e.observedAt)||
      e.targetCount!==1||(e.actionCount!==0&&e.actionCount!==1)||
      typeof e.fixtureDomMatchesExpected!=='boolean'||
      e.extensionAuthenticityVerified!==false||
      e.scriptInstallationVerified!==false||
      e.gmApiVerified!==false||e.businessVerified!==false)
     return result('INVALID_DOM_EVIDENCE',compared);
   observedTimes.add(e.observedAt);
   const report=cleanReceipt(r?.[mode],mode);
   if(!report)return result('INVALID_DOM_EVIDENCE',compared);
   if(e.actionCount!==Number(report.reportedBusinessAction)||
      e.fixtureDomMatchesExpected!==(e.actionCount===expected))
     return result('DOM_REPORT_CONFLICT',compared);
   compared=(compared+1) as 1|2;
 }
 return result('CONSISTENT_UNVERIFIED_FIXTURE_ONLY',compared);
}

/** Reserve browser visits synchronously before the first asynchronous CDP call.
 * A second click must never create duplicate tabs, and two different test
 * modes must not overlap. Failed navigation remains retryable, successful
 * navigation is recorded only AFTER the owned target was confirmed.
 */
export function createManualModeVisitLatch() {
 const visited:Record<GmProbeMode,boolean>=Object.assign(Object.create(null),{broken:false,fixed:false});
 let pending:GmProbeMode|null=null;
 return Object.freeze({
   reserve(mode:GmProbeMode):'RESERVED'|'IN_PROGRESS'|'ALREADY_VISITED'|'INVALID_MODE'{
     // Runtime inputs can bypass TypeScript; never reserve arbitrary keys.
     if(mode!=='broken'&&mode!=='fixed')return 'INVALID_MODE';
     if(visited[mode])return 'ALREADY_VISITED';
     if(pending!==null)return 'IN_PROGRESS';
     pending=mode;
     return 'RESERVED';
   },
   finish(mode:GmProbeMode,confirmed:boolean):void{
     if(mode!=='broken'&&mode!=='fixed'||pending!==mode)return;
     pending=null;
     if(confirmed)visited[mode]=true;
   },
   snapshot():Readonly<Record<GmProbeMode,boolean>>{
     return Object.freeze({...visited});
   }
 });
}

/** A per-observation cancellation token is a second untrusted entry point.
 * Validate its native AbortSignal brand before reading .aborted or using
 * AbortSignal.any(), so a forged signal cannot execute caller-owned traps.
 */
export function isNativeDiagnosticSignal(value:unknown):value is AbortSignal {
 try{
  if(!value||typeof value!=='object'||isProxy(value)||
     Object.getPrototypeOf(value)!==AbortSignal.prototype||
     ['aborted','addEventListener','removeEventListener'].some(
      field=>Object.prototype.hasOwnProperty.call(value,field)))
    return false;
  const nativeAbortedGetter=Object.getOwnPropertyDescriptor(
    AbortSignal.prototype,'aborted')?.get;
  return typeof nativeAbortedGetter==='function'&&
    typeof nativeAbortedGetter.call(value)==='boolean';
 }catch{return false;}
}

/** A native diagnostic accepts only inert, own-data option fields.
 * Never invoke an untrusted getter, Proxy trap or fake AbortSignal method.
 */
function snapshotDiagnosticOptions(value:unknown):{
 ttlMs?:number;signal?:AbortSignal;runAt?:GmProbeRunAt
}|null{
 try{
  if(!value||typeof value!=='object'||Array.isArray(value)||isProxy(value))
   return null;
  const proto=Object.getPrototypeOf(value);
  if(proto!==Object.prototype&&proto!==null)return null;
  const fields=Object.getOwnPropertyDescriptors(value);
  const names=Reflect.ownKeys(fields);
  if(names.length>3||names.some(key=>typeof key!=='string'||
      !['ttlMs','signal','runAt'].includes(key)))return null;
  const checked:Record<string,unknown>=Object.create(null);
  for(const name of names){
   const d=fields[name as string];
   if(!d||!Object.prototype.hasOwnProperty.call(d,'value'))return null;
   checked[name as string]=d.value;
  }
  const signal=checked.signal;
  if(signal!==undefined&&!isNativeDiagnosticSignal(signal))return null;
  return {ttlMs:checked.ttlMs as number|undefined,
   signal:signal as AbortSignal|undefined,
   runAt:checked.runAt as GmProbeRunAt|undefined};
 }catch{return null;}
}

/** Requires a live owned Chrome and a real CDP runtime hint before listening.
 * This API cannot be used to attach a preexisting Chrome, spoof a manager,
 * or install a userscript without the tester's separate manual action.
 */
export async function startApprovedTampermonkeyDiagnostic(
 browser:ManagedLaunchResult,userApproved:boolean,
 options:{readonly ttlMs?:number;readonly signal?:AbortSignal;
   readonly runAt?:GmProbeRunAt}={}
):Promise<StartDiagnosticResult>{
 if(userApproved!==true)return {ok:false,code:'NOT_AUTHORIZED'};
 const safeOptions=snapshotDiagnosticOptions(options);
 if(!safeOptions)return {ok:false,code:'INVALID_OPTIONS'};
 const signal=safeOptions.signal;
 if(signal?.aborted)return {ok:false,code:'CANCELLED'};
 const ttlMs=safeOptions.ttlMs??60000;
 if(!Number.isInteger(ttlMs)||ttlMs<1000||ttlMs>MAX_GM_PROBE_TTL_MS||
    (safeOptions.runAt!==undefined&&!isSupportedGmProbeRunAt(safeOptions.runAt)))
   return {ok:false,code:'INVALID_OPTIONS'};
 // Refuse unregistered browser objects before reading untrusted properties.
 if(!isLiveApprovedChromeSession(browser))
   return {ok:false,code:'UNVERIFIED_BROWSER'};
 const hint=await inspectApprovedTampermonkeyRuntime(browser,true,signal);
 if(!hint.ok)return {ok:false,code:hint.code};
 if(signal?.aborted)return {ok:false,code:'CANCELLED'};
 if(!isLiveApprovedChromeSession(browser))
   return {ok:false,code:'UNVERIFIED_BROWSER'};
 const fixture=await startIsolatedTampermonkeyGmProbe(
   true,ttlMs,safeOptions.runAt??'document-idle');
 if(!fixture.ok)return {ok:false,code:fixture.code};
 if(signal?.aborted||!isLiveApprovedChromeSession(browser)){
   await fixture.session.stop();
   return signal?.aborted?{ok:false,code:'CANCELLED'}:
     {ok:false,code:'UNVERIFIED_BROWSER'};
 }
 const probe=fixture.session;
 let stopped=false;
 const visits=createManualModeVisitLatch();
 const modeTargets:Partial<Record<GmProbeMode,Extract<OpenTargetResult,{ok:true}>>>={};
 const domEvidence:Partial<Record<GmProbeMode,FixtureDomEvidence>>={};
 let observationInProgress=false;
 // Stopping a manual diagnostic must cancel pending owned-CDP tab navigation
 // and DOM reads, not merely reject their results after they finish.
 const sessionCancelled=new AbortController();
 const sessionSignal=signal?
   AbortSignal.any([sessionCancelled.signal,signal]):
   sessionCancelled.signal;
 const ready=()=>!stopped&&!sessionSignal.aborted&&
   Date.now()<probe.expiresAt&&isLiveApprovedChromeSession(browser);
 let stopping:Promise<void>|undefined;
 const stop=():Promise<void>=>{
   if(stopping)return stopping;
   stopped=true;
   sessionCancelled.abort();
   signal?.removeEventListener('abort',onCallerAbort);
   stopping=probe.stop();
   return stopping;
 };
 // Revoking session consent must also close the disposable HTTP listener,
 // not just suppress a future positive diagnostic assessment.
 const onCallerAbort=()=>{void stop().catch(()=>undefined);};
 signal?.addEventListener('abort',onCallerAbort,{once:true});
 if(signal?.aborted){
   await stop();
   return {ok:false,code:'CANCELLED'};
 }
 const visit:ManualTampermonkeyDiagnosticSession['visit']=async(mode,explicitUserApproved)=>{
   if(explicitUserApproved!==true)return {ok:false,code:'NOT_AUTHORIZED'};
   if(mode!=='broken'&&mode!=='fixed')return {ok:false,code:'INVALID_MODE'};
   if(!ready())return {ok:false,code:'SESSION_NOT_ACTIVE'};
   const reservation=visits.reserve(mode);
   if(reservation==='INVALID_MODE')return {ok:false,code:'INVALID_MODE'};
   if(reservation!=='RESERVED')return {ok:false,
     code:reservation==='IN_PROGRESS'?'MODE_VISIT_IN_PROGRESS':'MODE_ALREADY_OPENED'};
   let confirmed=false;
   try{
     const result=await openApprovedTarget(browser,probe.origin+'/?mode='+mode,
       true,sessionSignal);
     if(!result.ok)return {ok:false,code:result.code};
     if(!ready())return {ok:false,code:'SESSION_NOT_ACTIVE'};
     confirmed=true;
     modeTargets[mode]=result;
     return {ok:true,status:'TARGET_ID_AND_URL_MATCH_ONLY',
       targetId:result.targetId,mode,gmApiVerified:false,businessVerified:false};
   }finally{
     visits.finish(mode,confirmed);
   }
 };
 const observe:ManualTampermonkeyDiagnosticSession['observe']=
   async(mode,explicitUserApproved,signal)=>{
     if(explicitUserApproved!==true)return {ok:false,code:'NOT_AUTHORIZED'};
     if(mode!=='broken'&&mode!=='fixed')return {ok:false,code:'INVALID_MODE'};
     if(signal!==undefined&&!isNativeDiagnosticSignal(signal))
       return {ok:false,code:'INVALID_OPTIONS'};
     if(!ready()||signal?.aborted)return {ok:false,code:'SESSION_NOT_ACTIVE'};
     const target=modeTargets[mode];
     if(!target)return {ok:false,code:'MODE_NOT_VISITED'};
     if(observationInProgress)return {ok:false,code:'OBSERVATION_IN_PROGRESS'};
     observationInProgress=true;
     // A failed recheck must never leave a previous matching DOM snapshot active.
     delete domEvidence[mode];
     try{
       const observeSignal=signal?
         AbortSignal.any([sessionSignal,signal]):sessionSignal;
       const sample=await observeApprovedDom(browser,target,
         probe.origin+'/?mode='+mode,true,[...FIXTURE_SELECTORS],observeSignal);
       if(!ready()||signal?.aborted)return {ok:false,code:'SESSION_NOT_ACTIVE'};
       const result=summarizeFixtureDomEvidence(mode,sample);
       if(result.ok)domEvidence[mode]=result.evidence;
       return result;
     }finally{observationInProgress=false;}
   };
 const domSnapshot=()=>Object.freeze(ready()?{...domEvidence}:{});
 const snapshot=():ManualDiagnosticAssessment=>{
   if(!ready())return assessManualProbeObservations({}, {broken:false,fixed:false});
   return assessManualProbeObservations(probe.receiptSnapshot(),visits.snapshot());
 };
 return {ok:true,session:Object.freeze({
   status:'MANUAL_TEST_READY_NOT_VERIFIED',runAt:probe.runAt,
    browserVersion:browser.chromeVersion,source:probe.source,
   installUrl:probe.installUrl,
   origin:probe.origin,expiresAt:probe.expiresAt,runtimeHint:hint,
   visit,observe,domSnapshot,
   consistencySnapshot:()=>correlateManualFixtureEvidence(
     ready()?probe.receiptSnapshot():{},visits.snapshot(),
     ready()?domEvidence:{}),snapshot,stop
 })};
}
