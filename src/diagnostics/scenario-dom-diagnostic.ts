/** TASK-008 / REQ-013 / TEST-013: bounded, read-only scenario DOM triage.
 * This adapter connects registered scenario assertions to the already owned
 * Chrome/CDP observer. It never clicks, executes a script, installs a manager,
 * modifies a file or treats a DOM match as business/GM/API verification.
 */
import type {ManagedLaunchResult} from '../browser/owned-chrome';
import type {OpenTargetResult} from '../browser/cdp-target';
import {observeApprovedDom,observeApprovedDomSeries,type DynamicObservation,type ObservationResult} from '../observe/dom-observer';
import {preflightScenario,type ScenarioInput} from '../scenarios/scenario-registry';
import {classifyFaultSignals,type FaultTriage,type FaultSignal} from './fault-classifier';

export type ScenarioDomTriageCode =
 'NONE'|'NOT_AUTHORIZED'|'INVALID_SCENARIO'|'UNSUPPORTED_SCENARIO'|
 'ROUTE_CHANGED'|'INVALID_OBSERVATION'|'UNSTABLE_OBSERVATION'|
 Extract<ObservationResult,{ok:false}>['code'];

export interface ScenarioDomTriage {
 readonly status:'BLOCKED'|'LIMITED_DOM_SIGNAL_ONLY';
 readonly code:ScenarioDomTriageCode;
 readonly checkedAssertions:number;
 readonly triage:FaultTriage;
 readonly tampermonkeyVerified:false;
 readonly businessVerified:false;
 readonly automaticPatchAllowed:false;
}
const unknownSignals=()=>classifyFaultSignals([
 {id:'cdp_evidence_unknown',code:'UNVERIFIED_OBSERVATION'}
]);
function response(
 status:ScenarioDomTriage['status'],code:ScenarioDomTriageCode,
 checkedAssertions:number,triage:FaultTriage
):ScenarioDomTriage {
 return Object.freeze({
   status,code,checkedAssertions,triage,
   tampermonkeyVerified:false as const,
   businessVerified:false as const,
   automaticPatchAllowed:false as const
 });
}
const blocked=(code:ScenarioDomTriageCode)=>
 response('BLOCKED',code,0,unknownSignals());
const knownObserverFailures=new Set<ScenarioDomTriageCode>([
 'NOT_AUTHORIZED','UNVERIFIED_BROWSER','UNVERIFIED_TARGET',
 'INVALID_OPTIONS','CDP_FAILED','DOM_TOO_COMPLEX','CANCELLED'
]);
// Runtime samples can come from serialized or external callers: a truthy
// non-boolean "ok" or fabricated error code is not a valid CDP receipt.
function failedObservation(value:ObservationResult|DynamicObservation):ScenarioDomTriage{
 if(value.ok===false&&knownObserverFailures.has(value.code))
   return blocked(value.code);
 return blocked('INVALID_OBSERVATION');
}

// DOM.querySelectorAll only inspects a bounded subset of the page. Do not
// treat an incomplete or changing iframe/shadow-root inventory as stable
// selector evidence; its shape is part of the observation contract.
const knownBlindSpots=new Set([
 'IFRAME_CONTENT_UNVERIFIED','CLOSED_SHADOW_ROOT_UNKNOWN',
 'CROSS_ORIGIN_FRAME_UNVERIFIED'
]);
function validDomSummary(summary:unknown):boolean{
 if(!summary||typeof summary!=='object'||Array.isArray(summary))return false;
 const value=summary as Record<string,unknown>;
 const elements=value.elementCount;
 const frames=value.iframeCount;
 const shadows=value.visibleShadowRoots;
 if(typeof elements!=='number'||typeof frames!=='number'||
    typeof shadows!=='number'||
    !Number.isSafeInteger(elements)||!Number.isSafeInteger(frames)||
    !Number.isSafeInteger(shadows)||
    (elements as number)<0||(frames as number)<0||(shadows as number)<0||
    (frames as number)>(elements as number)||
    (shadows as number)>(elements as number))
   return false;
 if(!Array.isArray(value.blindSpots)||value.blindSpots.length>knownBlindSpots.size||
    !value.blindSpots.every(v=>typeof v==='string'&&knownBlindSpots.has(v))||
    new Set(value.blindSpots).size!==value.blindSpots.length)return false;
 const iframeBlind=value.blindSpots.includes('IFRAME_CONTENT_UNVERIFIED');
 const crossOrigin=value.blindSpots.includes('CROSS_ORIGIN_FRAME_UNVERIFIED');
 if(iframeBlind!==((frames as number)>0)||crossOrigin&&(frames as number)===0)
   return false;
 return true;
}

/** Only actual observer-style UTC instants are accepted. Date.parse alone
 * normalizes impossible calendar days and accepts local/offset timestamps.
 * The timestamp is metadata for correlation, never proof of provenance.
 */
function validObservationTimestamp(value:unknown):value is string{
 if(typeof value!=='string'||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))
   return false;
 const time=Date.parse(value);
 if(!Number.isFinite(time))return false;
 const canonical=new Date(time).toISOString();
 return value===canonical||value===canonical.replace('.000Z','Z');
}

/** A static READY_TO_TEST signal does not authorize a browser action.
 * Only top-level selector-present assertions without login or active steps
 * can be handled; business, text and click assertions require another gate.
 */
function preflightReadOnlyScenario(
 input:unknown,userApproved:boolean
):{ok:true;url:string;selectors:string[]}|{ok:false;code:ScenarioDomTriageCode}{
 if(userApproved!==true)return {ok:false,code:'NOT_AUTHORIZED'};
 if(!input||typeof input!=='object'||Array.isArray(input))
   return {ok:false,code:'INVALID_SCENARIO'};
 const value=input as ScenarioInput;
 if(value.userApproved!==true)return {ok:false,code:'NOT_AUTHORIZED'};
 // Missing login intent must not silently become "no login needed".
 if(typeof value.requiresLogin!=='boolean'||
    !Array.isArray(value.steps)||!Array.isArray(value.assertions))
   return {ok:false,code:'INVALID_SCENARIO'};
 const preflight=preflightScenario(value);
 if(preflight.state!=='READY_TO_TEST'||!preflight.input.targetUrl)
   return {ok:false,code:'INVALID_SCENARIO'};
 const normalized=preflight.input;
 const approvedUrl=normalized.targetUrl;
 if(typeof approvedUrl!=='string')return {ok:false,code:'INVALID_SCENARIO'};
 // No login, navigation, clicks, text reads, JS evaluation or user script code.
 if(normalized.requiresLogin||normalized.steps.length!==0||
   normalized.assertions.length===0||normalized.assertions.length>8||
   normalized.assertions.some(x=>x.kind!=='selector-present'||
     typeof x.selector!=='string'||x.selector.length>256||
     x.selector.trim()!==x.selector||/[\u0000-\u001f]/.test(x.selector)||
     x.expectedText!==undefined))
   return {ok:false,code:'UNSUPPORTED_SCENARIO'};
 const selectors=normalized.assertions.map(x=>x.selector);
 if(new Set(selectors).size!==selectors.length)
   return {ok:false,code:'UNSUPPORTED_SCENARIO'};
 try{
   const url=new URL(approvedUrl);
   if(url.hash)return {ok:false,code:'UNSUPPORTED_SCENARIO'};
 }catch{return {ok:false,code:'INVALID_SCENARIO'};}
 return {ok:true,url:approvedUrl,selectors};
}
/** Pure mapping for regression tests. Synthetic samples are NEVER evidence of
 * real Chrome/Tampermonkey execution; the live API below obtains its own CDP
 * sample and makes the same limited, explicitly non-attesting classification.
 */
export function summarizeReadOnlyScenarioDom(
 scenario:unknown,observed:ObservationResult,userApproved:boolean
):ScenarioDomTriage {
 const checked=preflightReadOnlyScenario(scenario,userApproved);
 if(!checked.ok)return blocked(checked.code);
 if(!observed||typeof observed!=='object'||Array.isArray(observed))
   return blocked('INVALID_OBSERVATION');
 if(observed.ok!==true)return failedObservation(observed);
 if(!validObservationTimestamp(observed.observedAt)||
   observed.status!=='LIMITED_DOM_OBSERVATION'||
   observed.originMatchesApproved!==true||
   observed.fullPageVerified!==false||observed.userscriptVerified!==false)
   return blocked('INVALID_OBSERVATION');
 if(observed.routeChanged===true)return blocked('ROUTE_CHANGED');
 if(observed.routeChanged!==false)return blocked('INVALID_OBSERVATION');
 if(!observed.selectorCounts||typeof observed.selectorCounts!=='object'||
   Array.isArray(observed.selectorCounts)||
   !validDomSummary(observed.summary))
   return blocked('INVALID_OBSERVATION');
 // A snapshot of unapproved selectors cannot be treated as the requested
 // scenario's observation, even if it contains all expected keys.
 const actualSelectors=Object.keys(observed.selectorCounts);
 if(actualSelectors.length!==checked.selectors.length||
   actualSelectors.some(key=>!checked.selectors.includes(key)))
   return blocked('INVALID_OBSERVATION');
 const signals:FaultSignal[]=[];
 for(let i=0;i<checked.selectors.length;i++){
   const selector=checked.selectors[i];
   if(!Object.prototype.hasOwnProperty.call(observed.selectorCounts,selector))
     return blocked('INVALID_OBSERVATION');
   const count=observed.selectorCounts[selector];
   if(!Number.isSafeInteger(count)||count<0||
     count>observed.summary.elementCount)
     return blocked('INVALID_OBSERVATION');
   if(count===0)signals.push({
     id:'scenario_assertion_'+(i+1),code:'SELECTOR_NOT_FOUND'
   });
 }
 if(signals.length===0)signals.push({
   id:'scenario_dom_sample',code:'NO_FAILURE_OBSERVED'
 });
 return response('LIMITED_DOM_SIGNAL_ONLY','NONE',checked.selectors.length,
   classifyFaultSignals(signals));
}
/** Real, owned, user-authorized browser observation; any CDP or routing error
 * fails closed. Caller must separately verify actual manager/script business.
 */
export async function inspectApprovedScenarioDom(
 browser:ManagedLaunchResult,target:OpenTargetResult,
 scenario:unknown,userApproved:boolean,signal?:AbortSignal
):Promise<ScenarioDomTriage>{
 const checked=preflightReadOnlyScenario(scenario,userApproved);
 if(!checked.ok)return blocked(checked.code);
 if(signal?.aborted)return blocked('CANCELLED');
 const observed=await observeApprovedDom(browser,target,checked.url,true,
   checked.selectors,signal);
 if(signal?.aborted)return blocked('CANCELLED');
 return summarizeReadOnlyScenarioDom(scenario,observed,true);
}

/** TASK-008 / TEST-013: time-bounded read-only sampling. A transient missing
 * selector or changed DOM must NEVER be labelled as a stable fault.
 * All snapshots are independently checked: the aggregated flags alone are
 * not trusted, and matching samples still prove no userscript/GM/business.
 */
export function summarizeReadOnlyScenarioDomSeries(
 scenario:unknown,observed:DynamicObservation,userApproved:boolean
):ScenarioDomTriage{
 const checked=preflightReadOnlyScenario(scenario,userApproved);
 if(!checked.ok)return blocked(checked.code);
 if(!observed||typeof observed!=='object'||Array.isArray(observed))
   return blocked('INVALID_OBSERVATION');
 if(observed.ok!==true)return failedObservation(observed);
 if(observed.status!=='LIMITED_DYNAMIC_OBSERVATION'||
    observed.userscriptVerified!==false||
    !Array.isArray(observed.samples)||observed.samples.length<2||
    observed.samples.length>8||
    typeof observed.routeChangeDetected!=='boolean'||
    typeof observed.selectorCountChanged!=='boolean'||
    typeof observed.domCountChanged!=='boolean')
   return blocked('INVALID_OBSERVATION');
 if(observed.routeChangeDetected||observed.selectorCountChanged||observed.domCountChanged)
   return blocked('UNSTABLE_OBSERVATION');
 let first:Extract<ObservationResult,{ok:true}>|undefined;
 let lastTime=-Infinity;
 let firstTriage:FaultTriage|undefined;
 for(const sample of observed.samples){
   const result=summarizeReadOnlyScenarioDom(scenario,sample,true);
   if(result.status!=='LIMITED_DOM_SIGNAL_ONLY')
     return blocked(result.code);
   if(sample.ok!==true)return blocked('INVALID_OBSERVATION');
   if(!validObservationTimestamp(sample.observedAt))
     return blocked('INVALID_OBSERVATION');
   const time=Date.parse(sample.observedAt);
   // Equal timestamps can be the same replayed snapshot, not two samples.
   if(time<=lastTime)return blocked('UNSTABLE_OBSERVATION');
   lastTime=time;
   if(first){
     if(sample.summary.elementCount!==first.summary.elementCount||
        sample.summary.iframeCount!==first.summary.iframeCount||
        sample.summary.visibleShadowRoots!==first.summary.visibleShadowRoots||
        sample.summary.blindSpots.join('|')!==first.summary.blindSpots.join('|')||
        checked.selectors.some(s=>sample.selectorCounts[s]!==first!.selectorCounts[s]))
       return blocked('UNSTABLE_OBSERVATION');
   }else{
     first=sample;
     firstTriage=result.triage;
   }
 }
 return response('LIMITED_DOM_SIGNAL_ONLY','NONE',checked.selectors.length,firstTriage!);
}

/** Actually sample the application-owned, authorized Chrome page multiple
 * times. Requires no extension, clicks or script execution; real manager
 * and business acceptance remain separate tasks.
 */
export async function inspectApprovedScenarioDomSeries(
 browser:ManagedLaunchResult,target:OpenTargetResult,scenario:unknown,
 userApproved:boolean,sampleCount=3,intervalMs=250,signal?:AbortSignal
):Promise<ScenarioDomTriage>{
 const checked=preflightReadOnlyScenario(scenario,userApproved);
 if(!checked.ok)return blocked(checked.code);
 if(signal?.aborted)return blocked('CANCELLED');
 const observed=await observeApprovedDomSeries(browser,target,checked.url,true,
   checked.selectors,sampleCount,intervalMs,signal);
 if(signal?.aborted)return blocked('CANCELLED');
 return summarizeReadOnlyScenarioDomSeries(scenario,observed,true);
}
