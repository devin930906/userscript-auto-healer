/** TASK-008 -> TASK-009 / REQ-013/014/019 / TEST-013/014/019.
 * Strict, read-only correlation of a user-approved scenario, a *limited*
 * multi-sample DOM observation and one statically anchored candidate.
 *
 * WARNING: Serialized DOM samples are untrusted and NEVER authenticate
 * Tampermonkey, userscript execution, GM APIs or business recovery. This
 * bridge issues only reviewable local CANDIDATE_ONLY data, never writes.
 */
import type {DynamicObservation} from '../observe/dom-observer';
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
     metadata.tags.updateurl!==undefined||
     metadata.tags.downloadurl!==undefined||
     !Array.isArray(metadata.tags.match)||
     metadata.tags.match.length===0)return false;
  return metadata.tags.match.some(pattern=>
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
    if(!patch||typeof patch!=='object')
      return blocked('INVALID_SCENARIO_LINK');
    // The canonical registry copies own data descriptors and array entries.
    // Never read a caller's scenario getters or infer authority from extras.
    const checked=preflightScenario(scenario as ScenarioInput);
    if(checked.state!=='READY_TO_TEST')
      return blocked('INVALID_SCENARIO_LINK');
    const s=checked.input;
    if(s.userApproved!==true||s.requiresLogin!==false||
       !ID.test(s.id)||
       !SHA.test(s.scriptSha256)||
       s.scriptSha256!==patch.expectedSourceSha256||
       !Array.isArray(s.steps)||s.steps.length!==0||
       !Array.isArray(s.assertions)||s.assertions.length!==2)
      return blocked('INVALID_SCENARIO_LINK');
    const old=s.assertions[0];
    const replacement=s.assertions[1];
    if(!old||!replacement||
       old.kind!=='selector-present'||replacement.kind!=='selector-present'||
       old.expectedText!==undefined||replacement.expectedText!==undefined||
       old.selector!==patch.originalSelector||
       replacement.selector!==patch.replacementSelector||
       old.selector===replacement.selector)
      return blocked('INVALID_SCENARIO_LINK');

    // This existing validator enforces authorization, target URL, route
    // stability, multiple increasing timestamps, exact selector inventory,
    // unchanged DOM counts, bounded samples and no fabricated success flags.
    const diagnosis=summarizeReadOnlyScenarioDomSeries(
      s,observation as DynamicObservation,true);
    if(diagnosis.status!=='LIMITED_DOM_SIGNAL_ONLY'||diagnosis.code!=='NONE')
      return blocked('UNVERIFIED_OR_UNSTABLE_DOM');
    // A stable selector count from CDP's top document does not establish
    // selector absence within an iframe or an observed shadow-root subtree.
    // The diagnostic remains useful, but it must not promote that partial
    // coverage into a repair candidate. We intentionally DO NOT reject
    // CLOSED_SHADOW_ROOT_UNKNOWN alone: the DOM observer always reports it,
    // even when no shadow root is detected; doing so would disable the
    // existing, explicitly review-only flow on every ordinary page.
    const samples=(observation as Extract<DynamicObservation,{ok:true}>).samples;
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
    if(patch.faultEvidenceId!=='scenario_assertion_1')
      return blocked('INVALID_SCENARIO_LINK');

    const candidate=proposeLiteralSelectorPatch(patch);
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
