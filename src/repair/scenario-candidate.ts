/** TASK-008 -> TASK-009 / REQ-013/014/019 / TEST-013/014/019.
 * Strict, read-only correlation of a user-approved scenario, a *limited*
 * multi-sample DOM observation and one statically anchored candidate.
 *
 * WARNING: Serialized DOM samples are untrusted and NEVER authenticate
 * Tampermonkey, userscript execution, GM APIs or business recovery. This
 * bridge issues only reviewable local CANDIDATE_ONLY data, never writes.
 */
import {types as nodeTypes} from 'node:util';
import type {DynamicObservation,ObservationResult,DomSummary} from '../observe/dom-observer';
import {parseUserscriptMetadata} from '../analyze/metadata-parser';
import {matchingExactOriginPattern} from '../manager/tampermonkey-preflight';
import {preflightScenario,type ScenarioInput} from '../scenarios/scenario-registry';
import {summarizeReadOnlyScenarioDomSeries} from '../diagnostics/scenario-dom-diagnostic';
import {
  proposeLiteralSelectorPatch,
  type LiteralPatchRequest,type ProposedLiteralPatch
} from './patch-planner';

export type DiagnosticCandidateBlockCode =
  'NOT_AUTHORIZED'|'INVALID_SCENARIO_LINK'|
  'UNVERIFIED_OR_UNSTABLE_DOM'|'INCOMPLETE_DOM_COVERAGE'|
  'NO_EXACT_SELECTOR_FAILURE'|
  'UNVERIFIED_REPLACEMENT'|'PATCH_BLOCKED';
export type DiagnosticCandidateResult =
  | Readonly<{
    status:'BLOCKED';
    reason:DiagnosticCandidateBlockCode;
    automaticPatchAllowed:false;
    tampermonkeyVerified:false;
    businessRecoveredVerified:false;
  }>
  | (ProposedLiteralPatch & Readonly<{
    diagnosticLevel:'LIMITED_READ_ONLY_DOM_ONLY';
    scenarioId:string;
  }>);

const blocked=(reason:DiagnosticCandidateBlockCode):DiagnosticCandidateResult=>Object.freeze({
  status:'BLOCKED' as const,reason,automaticPatchAllowed:false as const,
  tampermonkeyVerified:false as const,businessRecoveredVerified:false as const
});
const SHA=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9_-]{1,64}$/;
// An isolated DOM selector count cannot attest manager permissions or effects.
// Requiring one EXPLICIT, minimal grant prevents writable, networked, unknown
// or future GM privileges from silently evading a finite denylist. This is
// only offline candidate eligibility; it does not prove manager execution.
const DOM_ONLY_REVIEW_GRANTS=new Set(['none','GM_getValue']);

/** Candidate approval must not re-read mutable caller-owned DOM data after
 * triage. Take a bounded, own-data-only copy once, rejecting Proxy traps,
 * accessors, sparse arrays, excess fields and untrusted iterators BEFORE
 * either the diagnostic or patch candidate uses the sample.
 * This is only data consistency, not Chrome/manager provenance.
 */
function ownData(value:unknown,names:readonly string[]):Record<string,unknown>|null{
 if(!value||typeof value!=='object'||Array.isArray(value)||
    nodeTypes.isProxy(value))return null;
 const prototype=Object.getPrototypeOf(value);
 if(prototype!==Object.prototype&&prototype!==null)return null;
 const descriptors=Object.getOwnPropertyDescriptors(value);
 const fields=Reflect.ownKeys(descriptors);
 if(fields.length!==names.length||fields.some(k=>typeof k!=='string')||
    names.some(n=>!Object.prototype.hasOwnProperty.call(descriptors,n)||
      !Object.prototype.hasOwnProperty.call(descriptors[n],'value')))return null;
 const result:Record<string,unknown>=Object.create(null);
 for(const name of names)result[name]=descriptors[name].value;
 return result;
}
function ownArray(value:unknown,min:number,max:number):unknown[]|null{
 if(!Array.isArray(value)||nodeTypes.isProxy(value)||
    Object.getPrototypeOf(value)!==Array.prototype)return null;
 const descriptors=Object.getOwnPropertyDescriptors(value);
 const count=Object.getOwnPropertyDescriptor(value,'length')?.value;
 if(!Number.isSafeInteger(count)||count<min||count>max||
    Reflect.ownKeys(descriptors).length!==count+1)return null;
 const copied:unknown[]=[];
 for(let i=0;i<count;i++){
  const slot=descriptors[String(i)];
  if(!slot||!Object.prototype.hasOwnProperty.call(slot,'value'))return null;
  copied.push(slot.value);
 }
 return copied;
}
function captureCandidateDomEvidence(input:unknown):
 Extract<DynamicObservation,{ok:true}>|null{
 try{
  const o=ownData(input,['ok','status','samples','routeChangeDetected',
    'selectorCountChanged','domCountChanged','userscriptVerified']);
  if(!o||o.ok!==true||o.status!=='LIMITED_DYNAMIC_OBSERVATION'||
     o.userscriptVerified!==false||
     typeof o.routeChangeDetected!=='boolean'||
     typeof o.selectorCountChanged!=='boolean'||
     typeof o.domCountChanged!=='boolean')return null;
  const rawSamples=ownArray(o.samples,2,8);
  if(!rawSamples)return null;
  const samples:Extract<ObservationResult,{ok:true}>[]=[];
  for(const item of rawSamples){
   const sample=ownData(item,['ok','status','observedAt',
     'originMatchesApproved','routeChanged','summary','selectorCounts',
     'fullPageVerified','userscriptVerified']);
   if(!sample||sample.ok!==true||sample.status!=='LIMITED_DOM_OBSERVATION'||
      typeof sample.observedAt!=='string'||
      sample.originMatchesApproved!==true||
      typeof sample.routeChanged!=='boolean'||
      sample.fullPageVerified!==false||sample.userscriptVerified!==false)
    return null;
   const summary=ownData(sample.summary,['elementCount','iframeCount',
     'visibleShadowRoots','blindSpots']);
   if(!summary||typeof summary.elementCount!=='number'||
      typeof summary.iframeCount!=='number'||
      typeof summary.visibleShadowRoots!=='number')return null;
   const rawSpots=ownArray(summary.blindSpots,0,3);
   if(!rawSpots)return null;
   const spots:DomSummary['blindSpots'][number][]=[];
   for(const entry of rawSpots){
    if(entry!=='IFRAME_CONTENT_UNVERIFIED'&&
       entry!=='CLOSED_SHADOW_ROOT_UNKNOWN'&&
       entry!=='CROSS_ORIGIN_FRAME_UNVERIFIED')return null;
    spots.push(entry);
   }
   // CDP selectorCounts is a plain map, often with a null prototype.
   // Never read its dynamic values or enumerate through an iterator.
   if(!sample.selectorCounts||typeof sample.selectorCounts!=='object'||
      Array.isArray(sample.selectorCounts)||
      nodeTypes.isProxy(sample.selectorCounts))return null;
   const proto=Object.getPrototypeOf(sample.selectorCounts);
   if(proto!==Object.prototype&&proto!==null)return null;
   const counts=Object.getOwnPropertyDescriptors(sample.selectorCounts);
   const selectorKeys=Reflect.ownKeys(counts);
   if(selectorKeys.length>8||selectorKeys.some(k=>typeof k!=='string'))
    return null;
   const selectors:Record<string,number>=Object.create(null);
   for(const key of selectorKeys as string[]){
    const slot=counts[key];
    if(!Object.prototype.hasOwnProperty.call(slot,'value')||
       typeof slot.value!=='number')return null;
    selectors[key]=slot.value;
   }
   samples.push({
    ok:true,status:'LIMITED_DOM_OBSERVATION',
    observedAt:sample.observedAt,originMatchesApproved:true,
    routeChanged:sample.routeChanged,fullPageVerified:false,
    userscriptVerified:false,
    summary:{
     elementCount:summary.elementCount,
     iframeCount:summary.iframeCount,
     visibleShadowRoots:summary.visibleShadowRoots,
     blindSpots:spots
    },selectorCounts:selectors
   });
  }
  return {
   ok:true,status:'LIMITED_DYNAMIC_OBSERVATION',samples,
   routeChangeDetected:o.routeChangeDetected,
   selectorCountChanged:o.selectorCountChanged,
   domCountChanged:o.domCountChanged,userscriptVerified:false
  };
 }catch{return null;}
}
/** Static @match eligibility is necessary, not proof that Tampermonkey
 * injected this source. Unreviewed include/exclusion precedence fails closed.
 * Reuse the manager preflight's narrow URL matcher to avoid drift. */
function sourceMatchesScenarioTarget(source:string,targetUrl:unknown):boolean{
  if(typeof targetUrl!=='string'||targetUrl.length>4096)return false;
  let target:URL;
  try{target=new URL(targetUrl);}catch{return false;}
  if(!['http:','https:'].includes(target.protocol)||!target.hostname||
     target.username||target.password||target.hash)return false;
  const metadata=parseUserscriptMetadata({
    bytes:Buffer.from(source,'utf8'),textEncoding:'utf-8'
  });
  // @match alone does not describe manager execution/update behavior.
  // A read-only DOM receipt cannot attest externally loaded code/assets,
  // network privileges, self-update sources, or unknown manager directives.
  // Hold those scripts for explicit inspection rather than issue a candidate
  // from the narrow DOM-only diagnostic path.
  if(metadata.status!=='OK'||
     metadata.unknownNames.length!==0||
     metadata.tags.include!==undefined||
     metadata.tags.exclude!==undefined||
     metadata.tags['exclude-match']!==undefined||
     metadata.tags.require!==undefined||
     metadata.tags.resource!==undefined||
     metadata.tags.connect!==undefined||
     // A DOM-only receipt cannot attest manager execution wrappers or
     // remote icons loaded during manager installation/display.
     metadata.tags.unwrap!==undefined||
     metadata.tags.icon!==undefined||
     metadata.tags.icon64!==undefined||
     metadata.tags.updateurl!==undefined||
     metadata.tags.downloadurl!==undefined||
     (!Array.isArray(metadata.tags.grant)||
      metadata.tags.grant.length!==1||
      !DOM_ONLY_REVIEW_GRANTS.has(metadata.tags.grant[0]))||
     !Array.isArray(metadata.tags.match)||
     metadata.tags.match.length===0)return false;
  // A single page proves nothing about a userscript's OTHER @match
  // destinations or paths. The entire declared execution scope must be
  // eligible for this exact read-only scenario before proposing even a
  // manual-review candidate; unknown/wildcard patterns fail closed.
  return metadata.tags.match.every(pattern=>
    matchingExactOriginPattern(pattern,target));
}

/** A pair of explicit, distinct selector-present assertions is needed:
 * first the known broken selector; second an alternative observed in the
 * same stable sample window. No inference from arbitrary page text/actions.
 */
export function proposeFromReadOnlyDomDiagnostic(
  patch:LiteralPatchRequest,
  scenario:unknown,
  observation:unknown,
  userApproved:boolean
):DiagnosticCandidateResult{
  try{
    if(userApproved!==true)return blocked('NOT_AUTHORIZED');
    if(!patch||typeof patch!=='object'||nodeTypes.isProxy(patch)||
       Array.isArray(patch))
      return blocked('INVALID_SCENARIO_LINK');
    // Do not touch request properties before verifying they are own DATA
    // descriptors. A getter could mutate state or run arbitrary code even
    // when the outer catch subsequently returns a blocked decision.
    const patchProto=Object.getPrototypeOf(patch);
    if(patchProto!==Object.prototype&&patchProto!==null)
      return blocked('INVALID_SCENARIO_LINK');
    const patchDescriptors=Object.getOwnPropertyDescriptors(patch);
    const patchFields=[
      'source','expectedSourceSha256','callOffset','method',
      'originalSelector','replacementSelector','faultEvidenceId'
    ];
    const patchKeys=Reflect.ownKeys(patchDescriptors);
    if(patchKeys.length!==patchFields.length||
       patchKeys.some(key=>typeof key!=='string'||!patchFields.includes(key))||
       patchFields.some(field=>
         !Object.prototype.hasOwnProperty.call(patchDescriptors,field)||
         !Object.prototype.hasOwnProperty.call(patchDescriptors[field],'value')))
      return blocked('INVALID_SCENARIO_LINK');
    // The same exact snapshot must be used for scenario linkage and AST
    // planning. No later reads of mutable or privileged caller properties.
    const requestFields:Record<string,unknown>=Object.create(null);
    for(const field of patchFields)requestFields[field]=patchDescriptors[field].value;
    const request=requestFields as unknown as LiteralPatchRequest;
    // The canonical registry copies own data descriptors and array entries.
    // Never read a caller's scenario getters or infer authority from extras.
    const checked=preflightScenario(scenario as ScenarioInput);
    if(checked.state!=='READY_TO_TEST')
      return blocked('INVALID_SCENARIO_LINK');
    const s=checked.input;
    if(s.userApproved!==true||s.requiresLogin!==false||
       !ID.test(s.id)||
       !SHA.test(s.scriptSha256)||
       s.scriptSha256!==request.expectedSourceSha256||
       !Array.isArray(s.steps)||s.steps.length!==0||
       !Array.isArray(s.assertions)||s.assertions.length!==2)
      return blocked('INVALID_SCENARIO_LINK');
    const old=s.assertions[0];
    const replacement=s.assertions[1];
    if(!old||!replacement||
       old.kind!=='selector-present'||replacement.kind!=='selector-present'||
       old.expectedText!==undefined||replacement.expectedText!==undefined||
       old.selector!==request.originalSelector||
       replacement.selector!==request.replacementSelector||
       old.selector===replacement.selector)
      return blocked('INVALID_SCENARIO_LINK');

    // This existing validator enforces authorization, target URL, route
    // stability, multiple increasing timestamps, exact selector inventory,
    // unchanged DOM counts, bounded samples and no fabricated success flags.
    const captured=captureCandidateDomEvidence(observation);
    if(!captured)return blocked('UNVERIFIED_OR_UNSTABLE_DOM');
    const diagnosis=summarizeReadOnlyScenarioDomSeries(s,captured,true);
    if(diagnosis.status!=='LIMITED_DOM_SIGNAL_ONLY'||diagnosis.code!=='NONE')
      return blocked('UNVERIFIED_OR_UNSTABLE_DOM');
    // A stable selector count from CDP's top document does not establish
    // selector absence within an iframe or an observed shadow-root subtree.
    // The diagnostic remains useful, but it must not promote that partial
    // coverage into a repair candidate. We intentionally DO NOT reject
    // CLOSED_SHADOW_ROOT_UNKNOWN alone: the DOM observer always reports it,
    // even when no shadow root is detected; doing so would disable the
    // existing, explicitly review-only flow on every ordinary page.
    const samples=captured.samples;
    if(samples.some(sample=>sample.ok===true&&
       (sample.summary.iframeCount!==0||
        sample.summary.visibleShadowRoots!==0)))
      return blocked('INCOMPLETE_DOM_COVERAGE');
    if(diagnosis.checkedAssertions!==2||
       diagnosis.triage.status!=='SINGLE_CAUSE_SIGNAL_ONLY'||
       diagnosis.triage.category!=='SELECTOR_ASSERTION'||
       diagnosis.triage.evidenceIds.length!==1||
       diagnosis.triage.evidenceIds[0]!=='scenario_assertion_1')
      return blocked('NO_EXACT_SELECTOR_FAILURE');
    if(request.faultEvidenceId!=='scenario_assertion_1')
      return blocked('INVALID_SCENARIO_LINK');

    const candidate=proposeLiteralSelectorPatch(request);
    if(candidate.status!=='CANDIDATE_ONLY')return blocked('PATCH_BLOCKED');
    // Use the immutable planner output, not caller-controlled patch getters
    // read a second time after SHA validation.
    if(candidate.originalSha256!==s.scriptSha256||
       !sourceMatchesScenarioTarget(candidate.candidateSource,s.targetUrl))
      return blocked('INVALID_SCENARIO_LINK');
    return Object.freeze({
      ...candidate,
      diagnosticLevel:'LIMITED_READ_ONLY_DOM_ONLY' as const,
      scenarioId:s.id
    });
  }catch{
    // No raw selector, script or URL appears in rejection results.
    return blocked('UNVERIFIED_OR_UNSTABLE_DOM');
  }
}
