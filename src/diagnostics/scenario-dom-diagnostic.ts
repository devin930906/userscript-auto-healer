/** TASK-008 / REQ-013 / TEST-013: bounded, read-only scenario DOM triage.
 * This adapter connects registered scenario assertions to the already owned
 * Chrome/CDP observer. It never clicks, executes a script, installs a manager,
 * modifies a file or treats a DOM match as business/GM/API verification.
 */
import {types as nodeTypes} from 'node:util';

import type {ManagedLaunchResult} from '../browser/owned-chrome';
import type {OpenTargetResult} from '../browser/cdp-target';
import {observeApprovedDom,observeApprovedDomSeries,type DynamicObservation,type ObservationResult} from '../observe/dom-observer';
import {preflightScenario,type ScenarioInput} from '../scenarios/scenario-registry';
import {classifyFaultSignals,BoundedFaultLog,type FaultTriage,type FaultSignal} from './fault-classifier';

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
function preflightReadOnlyScenarioUnchecked(
 input:unknown,userApproved:boolean
):{ok:true;url:string;selectors:string[]}|{ok:false;code:ScenarioDomTriageCode}{
 if(userApproved!==true)return {ok:false,code:'NOT_AUTHORIZED'};
 if(!input||typeof input!=='object'||Array.isArray(input))
   return {ok:false,code:'INVALID_SCENARIO'};
 // The registry captures only own, non-accessor data and rejects Proxies.
 // Never read caller getters for authorization or login before preflight.
 const preflight=preflightScenario(input as ScenarioInput);
 if(preflight.state==='INVALID')return {ok:false,code:'INVALID_SCENARIO'};
 const normalized=preflight.input;
 if(normalized.userApproved!==true)return {ok:false,code:'NOT_AUTHORIZED'};
 if(preflight.state!=='READY_TO_TEST'||!normalized.targetUrl)
   return {ok:false,code:'INVALID_SCENARIO'};
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
/** Runtime scenario input can be a hostile object with throwing accessors or
 * proxy traps. Reject it before it reaches the browser observation pipeline;
 * no caller should need to catch an exception to maintain the consent gate.
 */
function preflightReadOnlyScenario(
 input:unknown,userApproved:boolean
):{ok:true;url:string;selectors:string[]}|{ok:false;code:ScenarioDomTriageCode}{
 try{return preflightReadOnlyScenarioUnchecked(input,userApproved);}
 catch{return {ok:false,code:'INVALID_SCENARIO'};}
}
/** Copy only own data descriptors before inspecting untrusted, serialized CDP
 * results. Catching a thrown getter after invoking it is not a safe input
 * boundary: it has already run caller code. Null-prototype snapshots also
 * prevent inherited getters from supplying fabricated observation fields.
 */
function ownObservationData(input:unknown):Record<string,unknown>|null{
 if(!input||typeof input!=='object'||nodeTypes.isProxy(input)||
    Array.isArray(input))return null;
 const proto=Object.getPrototypeOf(input);
 if(proto!==Object.prototype&&proto!==null)return null;
 const descriptors=Object.getOwnPropertyDescriptors(input);
 const snapshot:Record<string,unknown>=Object.create(null);
 for(const key of Reflect.ownKeys(descriptors)){
  if(typeof key!=='string'||
     !Object.prototype.hasOwnProperty.call(descriptors[key],'value'))
    return null;
  snapshot[key]=descriptors[key].value;
 }
 return snapshot;
}
/** Accept no sparse, accessor-backed, subclassed or Proxy arrays. */
function ownObservationArray(input:unknown,max:number):unknown[]|null{
 if(nodeTypes.isProxy(input)||!Array.isArray(input)||
    Object.getPrototypeOf(input)!==Array.prototype)return null;
 const descriptors=Object.getOwnPropertyDescriptors(input);
 const length:unknown=descriptors.length?.value;
 if(typeof length!=='number'||!Number.isSafeInteger(length)||
    length<0||length>max||Reflect.ownKeys(descriptors).length!==length+1)
   return null;
 const result:unknown[]=[];
 for(let i=0;i<length;i++){
  const slot=descriptors[String(i)];
  if(!slot||!Object.prototype.hasOwnProperty.call(slot,'value'))
    return null;
  result.push(slot.value);
 }
 return result;
}
function snapshotObservation(input:unknown):ObservationResult|null{
 const row=ownObservationData(input);
 if(!row)return null;
 if(row.ok!==true)return row as unknown as ObservationResult;
 const counts=ownObservationData(row.selectorCounts);
 const summary=ownObservationData(row.summary);
 if(!counts||!summary)return null;
 const blindSpots=ownObservationArray(summary.blindSpots,3);
 if(!blindSpots)return null;
 return {...row,selectorCounts:counts,summary:{...summary,blindSpots}} as unknown as ObservationResult;
}
function snapshotObservationSeries(input:unknown):DynamicObservation|null{
 const row=ownObservationData(input);
 if(!row)return null;
 if(row.ok!==true)return row as unknown as DynamicObservation;
 const source=ownObservationArray(row.samples,8);
 if(!source)return null;
 const samples=source.map(snapshotObservation);
 if(samples.some(s=>s===null))return null;
 return {...row,samples} as unknown as DynamicObservation;
}

/** Pure mapping for regression tests. Synthetic samples are NEVER evidence of
 * real Chrome/Tampermonkey execution; the live API below obtains its own CDP
 * sample and makes the same limited, explicitly non-attesting classification.
 */
export function summarizeReadOnlyScenarioDom(
 scenario:unknown,observed:ObservationResult,userApproved:boolean
):ScenarioDomTriage {
 try{
 const checked=preflightReadOnlyScenario(scenario,userApproved);
 if(!checked.ok)return blocked(checked.code);
 const safe=snapshotObservation(observed);
 if(!safe)return blocked('INVALID_OBSERVATION');
 observed=safe;
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
 }catch{return blocked('INVALID_OBSERVATION');}
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
 try{
 const checked=preflightReadOnlyScenario(scenario,userApproved);
 if(!checked.ok)return blocked(checked.code);
 const safe=snapshotObservationSeries(observed);
 if(!safe)return blocked('INVALID_OBSERVATION');
 observed=safe;
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
 }catch{return blocked('INVALID_OBSERVATION');}
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

/** TASK-008 / TEST-013: bridge real authorized read-only CDP diagnostics to
 * the existing bounded, local-only, strictly minimized fault journal.
 * The journal receives opaque evidence IDs and signal codes only; no URLs,
 * selectors, script hashes, DOM content, extension data, or error messages.
 * This is NOT provenance, Tampermonkey, GM or business attestation.
 */
export async function inspectAndLogApprovedScenarioDomSeries(
 browser:ManagedLaunchResult,target:OpenTargetResult,scenario:unknown,
 userApproved:boolean,journal:BoundedFaultLog,
 sampleCount=3,intervalMs=250,signal?:AbortSignal
):Promise<ScenarioDomTriage>{
 const result=await inspectApprovedScenarioDomSeries(
   browser,target,scenario,userApproved,sampleCount,intervalMs,signal);
 let safeSignals:FaultSignal[]=[{
   id:'scenario_observation_unverified',code:'UNVERIFIED_OBSERVATION'
 }];
 if(result.status==='LIMITED_DOM_SIGNAL_ONLY'&&result.code==='NONE'){
   if(result.triage.status==='SINGLE_CAUSE_SIGNAL_ONLY'&&
      result.triage.category==='SELECTOR_ASSERTION'&&
      result.triage.evidenceIds.length>0){
     safeSignals=result.triage.evidenceIds.map(id=>({
       id,code:'SELECTOR_NOT_FOUND' as const
     }));
   }else if(result.triage.status==='NO_FAULT_SIGNAL'){
     safeSignals=[{id:'scenario_dom_checked',code:'NO_FAILURE_OBSERVED'}];
   }
 }
 journal.record(safeSignals);
 return result;
}
