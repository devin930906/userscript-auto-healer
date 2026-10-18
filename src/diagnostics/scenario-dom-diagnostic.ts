/** TASK-008 / REQ-013 / TEST-013: bounded, read-only scenario DOM triage.
 * This adapter connects registered scenario assertions to the already owned
 * Chrome/CDP observer. It never clicks, executes a script, installs a manager,
 * modifies a file or treats a DOM match as business/GM/API verification.
 */
import type {ManagedLaunchResult} from '../browser/owned-chrome';
import type {OpenTargetResult} from '../browser/cdp-target';
import {observeApprovedDom,type ObservationResult} from '../observe/dom-observer';
import {preflightScenario,type ScenarioInput} from '../scenarios/scenario-registry';
import {classifyFaultSignals,type FaultTriage,type FaultSignal} from './fault-classifier';

export type ScenarioDomTriageCode =
 'NONE'|'NOT_AUTHORIZED'|'INVALID_SCENARIO'|'UNSUPPORTED_SCENARIO'|
 'ROUTE_CHANGED'|'INVALID_OBSERVATION'|
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
 if(!Array.isArray(value.steps)||!Array.isArray(value.assertions))
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
 if(!observed||typeof observed!=='object')return blocked('INVALID_OBSERVATION');
 if(!observed.ok)return blocked(observed.code);
 if(observed.status!=='LIMITED_DOM_OBSERVATION'||
   observed.originMatchesApproved!==true||
   observed.fullPageVerified!==false||observed.userscriptVerified!==false)
   return blocked('INVALID_OBSERVATION');
 if(observed.routeChanged===true)return blocked('ROUTE_CHANGED');
 if(observed.routeChanged!==false)return blocked('INVALID_OBSERVATION');
 if(!observed.selectorCounts||typeof observed.selectorCounts!=='object'||
   Array.isArray(observed.selectorCounts)||
   !observed.summary||!Number.isSafeInteger(observed.summary.elementCount)||
   observed.summary.elementCount<0)
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
