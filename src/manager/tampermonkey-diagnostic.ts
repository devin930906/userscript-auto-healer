/** TASK-007 / REQ-017/018: manual Tampermonkey diagnostic orchestration.
 * Only an actual application-owned, still-running Chrome instance with a
 * Tampermonkey runtime TARGET HINT may host the consented, disposable fixture.
 * The operator must separately and explicitly install a temporary test script.
 * Neither HTTP self-reports nor CDP page metadata attest extension provenance,
 * GM calls or business success. No existing scripts/profiles are ever edited.
 */
import type {ManagedLaunchResult} from '../browser/owned-chrome';
import {isLiveApprovedChromeSession} from '../browser/owned-chrome';
import {openApprovedTarget,type OpenTargetResult} from '../browser/cdp-target';
import {
 inspectApprovedTampermonkeyRuntime,type ManagerPresenceResult
} from './tampermonkey-adapter';
import {
 startIsolatedTampermonkeyGmProbe,type GmProbeReceipt,type GmProbeMode
} from './tampermonkey-gm-probe';

export interface ManualDiagnosticAssessment {
 readonly status:'AWAITING_BROWSER_VISITS'|'AWAITING_REPORTS'|
   'SELF_REPORTED_EXPECTATIONS_MATCH'|'REPORTED_MISMATCH';
 readonly observedModes:number;
 readonly reportedGmDefaultMatched:boolean;
 readonly reportedBrokenFailed:boolean;
 readonly reportedFixedRecovered:boolean;
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
   'SESSION_NOT_ACTIVE'|'MODE_ALREADY_OPENED'|
   Extract<OpenTargetResult,{ok:false}>['code']};
export interface ManualTampermonkeyDiagnosticSession {
 readonly status:'MANUAL_TEST_READY_NOT_VERIFIED';
 /** Contains a single-run token. Never log or put this in arbitrary renderer content. */
 readonly source:string;
 readonly origin:string;
 readonly expiresAt:number;
 readonly runtimeHint:Extract<ManagerPresenceResult,{ok:true}>;
 /** Only navigates a new tab in the already-owned isolated Chrome. */
 readonly visit:(mode:GmProbeMode,explicitUserApproved:boolean)=>Promise<VisitStatus>;
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
function object(value:unknown):value is Record<string,unknown>{
 return value!==null&&typeof value==='object'&&!Array.isArray(value);
}
function cleanReceipt(value:unknown,mode:GmProbeMode):value is GmProbeReceipt{
 if(!object(value))return false;
 const keys=Object.keys(value).sort().join(',');
 if(keys!==[
  'businessVerified','extensionAuthenticityVerified','gmApiVerified',
  'mode','reportedBusinessAction','reportedGmDefaultMatched',
  'scriptInstallationVerified','status'
 ].sort().join(','))return false;
 return value.status==='SELF_REPORTED_FIXTURE_ONLY'&&value.mode===mode&&
   typeof value.reportedGmDefaultMatched==='boolean'&&
   typeof value.reportedBusinessAction==='boolean'&&
   value.extensionAuthenticityVerified===false&&
   value.scriptInstallationVerified===false&&
   value.gmApiVerified===false&&value.businessVerified===false;
}
/** Pure evaluation of UNTRUSTED observations: matching reports remain unverified. */
export function assessManualProbeObservations(
 receipts:unknown,visits:unknown
):ManualDiagnosticAssessment{
 const r=object(receipts)?receipts:{};
 const v=object(visits)?visits:{};
 const a=cleanReceipt(r.broken,'broken');
 const b=cleanReceipt(r.fixed,'fixed');
 const observedModes=Number(a)+Number(b);
 const reportedGmDefaultMatched=a&&b&&
   (r.broken as GmProbeReceipt).reportedGmDefaultMatched&&
   (r.fixed as GmProbeReceipt).reportedGmDefaultMatched;
 const reportedBrokenFailed=a&&(r.broken as GmProbeReceipt).reportedBusinessAction===false;
 const reportedFixedRecovered=b&&(r.fixed as GmProbeReceipt).reportedBusinessAction===true;
 const exactVisits=Object.keys(v).sort().join(',')==='broken,fixed'&&
   v.broken===true&&v.fixed===true;
 const status:ManualDiagnosticAssessment['status']=
   !exactVisits?'AWAITING_BROWSER_VISITS':
   !('broken' in r)||!('fixed' in r)?'AWAITING_REPORTS':
   a&&b&&reportedGmDefaultMatched&&reportedBrokenFailed&&reportedFixedRecovered?
     'SELF_REPORTED_EXPECTATIONS_MATCH':'REPORTED_MISMATCH';
 return {status,observedModes,
   reportedGmDefaultMatched:Boolean(reportedGmDefaultMatched),
   reportedBrokenFailed:Boolean(reportedBrokenFailed),
   reportedFixedRecovered:Boolean(reportedFixedRecovered),
   ...emptyFlags};
}

/** Requires a live owned Chrome and a real CDP runtime hint before listening.
 * This API cannot be used to attach a preexisting Chrome, spoof a manager,
 * or install a userscript without the tester's separate manual action.
 */
export async function startApprovedTampermonkeyDiagnostic(
 browser:ManagedLaunchResult,userApproved:boolean,
 options:{readonly ttlMs?:number;readonly signal?:AbortSignal}={}
):Promise<StartDiagnosticResult>{
 if(userApproved!==true)return {ok:false,code:'NOT_AUTHORIZED'};
 if(options.signal?.aborted)return {ok:false,code:'CANCELLED'};
 const ttlMs=options.ttlMs??60000;
 if(!Number.isInteger(ttlMs)||ttlMs<1000||ttlMs>300000)
   return {ok:false,code:'INVALID_OPTIONS'};
 if(!browser?.ok||!isLiveApprovedChromeSession(browser))
   return {ok:false,code:'UNVERIFIED_BROWSER'};
 const hint=await inspectApprovedTampermonkeyRuntime(browser,true,options.signal);
 if(!hint.ok)return {ok:false,code:hint.code};
 if(options.signal?.aborted)return {ok:false,code:'CANCELLED'};
 if(!isLiveApprovedChromeSession(browser))
   return {ok:false,code:'UNVERIFIED_BROWSER'};
 const fixture=await startIsolatedTampermonkeyGmProbe(true,ttlMs);
 if(!fixture.ok)return {ok:false,code:fixture.code};
 if(options.signal?.aborted||!isLiveApprovedChromeSession(browser)){
   await fixture.session.stop();
   return options.signal?.aborted?{ok:false,code:'CANCELLED'}:
     {ok:false,code:'UNVERIFIED_BROWSER'};
 }
 const probe=fixture.session;
 let stopped=false;
 const visits:Record<GmProbeMode,boolean>={broken:false,fixed:false};
 const ready=()=>!stopped&&Date.now()<probe.expiresAt&&
   !options.signal?.aborted&&isLiveApprovedChromeSession(browser);
 const stop=async()=>{stopped=true;await probe.stop();};
 const visit:ManualTampermonkeyDiagnosticSession['visit']=async(mode,explicitUserApproved)=>{
   if(explicitUserApproved!==true)return {ok:false,code:'NOT_AUTHORIZED'};
   if(mode!=='broken'&&mode!=='fixed')return {ok:false,code:'INVALID_MODE'};
   if(!ready())return {ok:false,code:'SESSION_NOT_ACTIVE'};
   if(visits[mode])return {ok:false,code:'MODE_ALREADY_OPENED'};
   const result=await openApprovedTarget(browser,probe.origin+'/?mode='+mode,true);
   if(!result.ok)return {ok:false,code:result.code};
   if(!ready())return {ok:false,code:'SESSION_NOT_ACTIVE'};
   visits[mode]=true;
   return {ok:true,status:'TARGET_ID_AND_URL_MATCH_ONLY',
     targetId:result.targetId,mode,gmApiVerified:false,businessVerified:false};
 };
 const snapshot=():ManualDiagnosticAssessment=>{
   if(!ready())return assessManualProbeObservations({}, {broken:false,fixed:false});
   return assessManualProbeObservations(probe.receiptSnapshot(),visits);
 };
 return {ok:true,session:Object.freeze({
   status:'MANUAL_TEST_READY_NOT_VERIFIED',source:probe.source,
   origin:probe.origin,expiresAt:probe.expiresAt,runtimeHint:hint,
   visit,snapshot,stop
 })};
}
