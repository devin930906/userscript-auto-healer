/** TASK-013 -> TASK-009: bounded review-only candidate for an imported batch.
 * This planner must be called only after native batch-DOM consent. It writes
 * nothing, executes no userscript, never attests manager/GM/business behavior,
 * and returns candidateSource only to trusted main-process code.
 */
import {createHash} from 'node:crypto';
import {types as nodeTypes} from 'node:util';
import {MAX_ANALYSIS_BYTES} from '../analyze/import-preview';
import {analyzeSelectors} from '../analyze/selector-analyzer';
import type {DynamicObservation} from '../observe/dom-observer';
import type {ScenarioInput} from '../scenarios/scenario-registry';
import {captureReadOnlyDynamicObservation,proposeFromReadOnlyDomDiagnostic}
 from './scenario-candidate';
import type {LiteralPatchRequest} from './patch-planner';

const HASH=/^[a-f0-9]{64}$/;
export type ImportedDomCandidateBlockCode=
 'INVALID_INPUT'|'NOT_AUTHORIZED'|'SOURCE_IDENTITY_MISMATCH'|
 'SOURCE_TOO_LARGE'|'INVALID_UTF8_SOURCE'|'UNSUPPORTED_AST'|'AMBIGUOUS_SELECTOR_SET'|
 'NO_UNIQUE_SELECTOR_FAILURE'|'DOM_EVIDENCE_UNSTABLE'|
 'DOM_COVERAGE_INCOMPLETE'|'CANDIDATE_RULES_REJECTED';
export interface ImportedDomCandidateManualExportContext{
 readonly scenario:ScenarioInput;
 readonly domSamples:Extract<DynamicObservation,{readonly ok:true}>;
 readonly originalSha256:string;
 readonly candidateSha256:string;
}
export type ImportedDomCandidateResult=
 |Readonly<{status:'BLOCKED';reason:ImportedDomCandidateBlockCode;
   automaticPatchAllowed:false;tampermonkeyVerified:false;businessVerified:false}>
 |Readonly<{status:'CANDIDATE_ONLY';originalSha256:string;candidateSha256:string;
   faultEvidenceId:'scenario_assertion_1';
   change:Readonly<{start:number;end:number;before:string;after:string}>;
   /** Main-process-only source; callers must strip this before IPC/logging. */
   candidateSource:string;
   /** Main-only context for a separately consented, rechecked manual export. */
   manualExportContext:ImportedDomCandidateManualExportContext;
   automaticPatchAllowed:false;
   tampermonkeyVerified:false;businessVerified:false}>;

const blocked=(reason:ImportedDomCandidateBlockCode):ImportedDomCandidateResult=>
 Object.freeze({status:'BLOCKED' as const,reason,automaticPatchAllowed:false as const,
  tampermonkeyVerified:false as const,businessVerified:false as const});

function ownData(input:unknown,fields:readonly string[]):Record<string,unknown>|null{
 try{
  if(!input||typeof input!=='object'||nodeTypes.isProxy(input)||Array.isArray(input))
   return null;
  const prototype=Object.getPrototypeOf(input);
  if(prototype!==Object.prototype&&prototype!==null)return null;
  const descriptors=Object.getOwnPropertyDescriptors(input);
  const keys=Reflect.ownKeys(descriptors);
  if(keys.length!==fields.length||keys.some(key=>typeof key!=='string')||
     fields.some(field=>!Object.prototype.hasOwnProperty.call(descriptors,field)||
       !Object.prototype.hasOwnProperty.call(descriptors[field],'value')))return null;
  const result:Record<string,unknown>=Object.create(null);
  for(const field of fields)result[field]=descriptors[field].value;
  return result;
 }catch{return null;}
}

/** Propose a one-token selector swap only when an imported UTF-8 source has
 * exactly two unique literal DOM selector sites and stable authorized DOM
 * observations distinguish one missing site from one present alternative.
 * The existing TASK-009 planner remains the final gate for metadata, target,
 * exact AST offset, selector syntax, and DOM coverage.
 */
export function proposeImportedDomCandidate(input:unknown):ImportedDomCandidateResult{
 try{
  const data=ownData(input,['source','expectedSourceSha256','targetUrl',
   'observation','nativeConsent']);
  if(!data||typeof data.source!=='string'||
     typeof data.expectedSourceSha256!=='string'||!HASH.test(data.expectedSourceSha256)||
     typeof data.targetUrl!=='string'||data.targetUrl.length>4096||
     typeof data.nativeConsent!=='boolean')return blocked('INVALID_INPUT');
  if(data.nativeConsent!==true)return blocked('NOT_AUTHORIZED');
  const source=data.source;
  const byteLength=Buffer.byteLength(source,'utf8');
  if(byteLength>MAX_ANALYSIS_BYTES)return blocked('SOURCE_TOO_LARGE');
  if(byteLength===0||source.charCodeAt(0)===0xfeff)
   return blocked('INVALID_UTF8_SOURCE');
  const sourceBytes=Buffer.from(source,'utf8');
  try{
   if(new TextDecoder('utf-8',{fatal:true}).decode(sourceBytes)!==source)
    return blocked('INVALID_UTF8_SOURCE');
  }catch{return blocked('INVALID_UTF8_SOURCE');}
  const sourceSha256=createHash('sha256').update(sourceBytes).digest('hex');
  if(sourceSha256!==data.expectedSourceSha256)
   return blocked('SOURCE_IDENTITY_MISMATCH');
  const analysis=analyzeSelectors(source);
  if(analysis.status!=='OK')return blocked('UNSUPPORTED_AST');
  if(analysis.sites.length!==2||analysis.sites.some(site=>
      site.kind!=='literal'||site.fallbackGroup!==null||
      !site.topLevel||site.owner!=='<top-level>'||site.scope!=='<top-level>'||
      !site.nativeDocumentReceiver||site.argumentCount!==1||
      (site.method!=='querySelector'&&site.method!=='querySelectorAll')||
      typeof site.selector!=='string')||
     analysis.sites[0].selector===analysis.sites[1].selector)
   return blocked(analysis.sites.length<2?'NO_UNIQUE_SELECTOR_FAILURE':
    'AMBIGUOUS_SELECTOR_SET');
  const domSamples=captureReadOnlyDynamicObservation(data.observation);
  if(!domSamples)return blocked('DOM_EVIDENCE_UNSTABLE');

  const first=analysis.sites[0];
  const second=analysis.sites[1];
  const directions=[
   {missing:first,alternative:second},
   {missing:second,alternative:first}
  ];
  let sawUnstable=false;
  let sawIncomplete=false;
  let sawExactFailure=false;
  for(const direction of directions){
   const oldSelector=direction.missing.selector;
   const replacementSelector=direction.alternative.selector;
   const method=direction.missing.method;
   if(typeof oldSelector!=='string'||typeof replacementSelector!=='string'||
      (method!=='querySelector'&&method!=='querySelectorAll'))
    return blocked('AMBIGUOUS_SELECTOR_SET');
   const patch:LiteralPatchRequest={
    source,expectedSourceSha256:sourceSha256,
    callOffset:direction.missing.offset,
    method,
    originalSelector:oldSelector,
    replacementSelector,
    faultEvidenceId:'scenario_assertion_1'
   };
   const scenario:ScenarioInput=Object.freeze({
    id:'imported_'+sourceSha256.slice(0,48),
    scriptSha256:sourceSha256,targetUrl:data.targetUrl,
    userApproved:true,requiresLogin:false,loginReady:false,
    steps:Object.freeze([]),assertions:Object.freeze([
     Object.freeze({kind:'selector-present' as const,selector:oldSelector}),
     Object.freeze({kind:'selector-present' as const,selector:replacementSelector})
    ])
   });
   const candidate=proposeFromReadOnlyDomDiagnostic(
    patch,scenario,domSamples,true);
   if(candidate.status==='CANDIDATE_ONLY'){
    return Object.freeze({status:'CANDIDATE_ONLY' as const,
     originalSha256:candidate.originalSha256,
     candidateSha256:candidate.candidateSha256,
     faultEvidenceId:'scenario_assertion_1' as const,
     change:candidate.change,candidateSource:candidate.candidateSource,
     manualExportContext:Object.freeze({scenario,domSamples,
      originalSha256:candidate.originalSha256,
      candidateSha256:candidate.candidateSha256}),
     automaticPatchAllowed:false as const,tampermonkeyVerified:false as const,
     businessVerified:false as const});
   }
   if(candidate.reason==='UNVERIFIED_OR_UNSTABLE_DOM')sawUnstable=true;
   if(candidate.reason==='INCOMPLETE_DOM_COVERAGE')sawIncomplete=true;
   if(candidate.reason==='NO_EXACT_SELECTOR_FAILURE')sawExactFailure=true;
  }
  if(sawUnstable)return blocked('DOM_EVIDENCE_UNSTABLE');
  if(sawIncomplete)return blocked('DOM_COVERAGE_INCOMPLETE');
  if(sawExactFailure)return blocked('NO_UNIQUE_SELECTOR_FAILURE');
  return blocked('CANDIDATE_RULES_REJECTED');
 }catch{return blocked('INVALID_INPUT');}
}
