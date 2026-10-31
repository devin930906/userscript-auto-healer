/** TASK-010 (offline preflight only) / REQ-019/021 / TEST-019/021.
 *
 * Fail-closed boundary between a review-only local patch and future runtime
 * acceptance. This code NEVER authenticates Tampermonkey, GM APIs, browser
 * provenance, business recovery, disk state or verified backups, and NEVER
 * gives permission to write. A caller-provided hash/consent flag is only a
 * preliminary claim. A real trusted E2E + atomic backup gate is still needed.
 */
import {types as utilTypes} from 'node:util';
import {
  auditProposedLiteralSelectorPatch,
  type LiteralPatchRequest
} from '../repair/patch-planner';

type PreflightBlockReason=
  'INVALID_OPTIONS'|'NOT_AUTHORIZED'|'SOURCE_IDENTITY_UNCONFIRMED'|
  'UNTRUSTED_RUNTIME_EVIDENCE'|'PATCH_REVIEW_FAILED';

export type LocalAcceptancePreflightResult=
  |Readonly<{
    status:'BLOCKED';reason:PreflightBlockReason;
    automaticPatchAllowed:false;tampermonkeyVerified:false;
    businessRecoveredVerified:false;
  }>
  |Readonly<{
    status:'AWAITING_TRUSTED_RUNTIME_AND_BACKUP';
    reason:'REAL_TAMPERMONKEY_BUSINESS_AND_BACKUP_EVIDENCE_REQUIRED';
    originalSha256:string;candidateSha256:string;faultEvidenceId:string;
    change:Readonly<{start:number;end:number}>;
    automaticPatchAllowed:false;tampermonkeyVerified:false;
    businessRecoveredVerified:false;
  }>;

const SHA256=/^[a-f0-9]{64}$/;
const REQUEST_FIELDS=[
  'source','expectedSourceSha256','callOffset','method',
  'originalSelector','replacementSelector','faultEvidenceId'
] as const;

function blocked(reason:PreflightBlockReason):LocalAcceptancePreflightResult{
  return Object.freeze({
    status:'BLOCKED' as const,reason,
    automaticPatchAllowed:false as const,
    tampermonkeyVerified:false as const,
    businessRecoveredVerified:false as const
  });
}

/** Only two primitive caller claims are accepted at the offline boundary.
 * In particular, a serialized object claiming manager/GM/business success,
 * an automatic-apply approval, or a backup must NEVER elevate this decision.
 * Runtime provenance and disk ownership must be established in a separate,
 * independently trusted step (not yet implemented).
 */
export function assessLocalAcceptancePreflight(
  request:LiteralPatchRequest,
  untrustedCandidate:unknown,
  options:unknown
):LocalAcceptancePreflightResult{
  try{
    if(!options||typeof options!=='object'||utilTypes.isProxy(options)||
       Array.isArray(options))
      return blocked('INVALID_OPTIONS');
    const proto=Object.getPrototypeOf(options);
    if(proto!==Object.prototype&&proto!==null)
      return blocked('INVALID_OPTIONS');
    const fields=Object.getOwnPropertyDescriptors(options);
    const keys=Reflect.ownKeys(fields);
    if(keys.includes('runtimeEvidence'))
      return blocked('UNTRUSTED_RUNTIME_EVIDENCE');
    if(keys.length!==2||keys.some(k=>typeof k!=='string')||
       !Object.prototype.hasOwnProperty.call(fields,'userApproved')||
       !Object.prototype.hasOwnProperty.call(fields,'diskSourceSha256')||
       !Object.prototype.hasOwnProperty.call(fields.userApproved,'value')||
       !Object.prototype.hasOwnProperty.call(fields.diskSourceSha256,'value'))
      return blocked('INVALID_OPTIONS');
    if(fields.userApproved.value!==true)return blocked('NOT_AUTHORIZED');
    const diskSourceSha256:unknown=fields.diskSourceSha256.value;
    if(typeof diskSourceSha256!=='string'||!SHA256.test(diskSourceSha256)||
       !request||typeof request!=='object'||utilTypes.isProxy(request)||
       Array.isArray(request))
      return blocked('SOURCE_IDENTITY_UNCONFIRMED');
    // Never read requester-supplied fields before confirming that all seven
    // are own data properties. Getters/inherited fields may execute arbitrary
    // script code or supply a forged source identity to this preflight.
    const requestProto=Object.getPrototypeOf(request);
    if(requestProto!==Object.prototype&&requestProto!==null)
      return blocked('SOURCE_IDENTITY_UNCONFIRMED');
    const requestDescriptors=Object.getOwnPropertyDescriptors(request);
    const requestKeys=Reflect.ownKeys(requestDescriptors);
    if(requestKeys.length!==REQUEST_FIELDS.length||
       requestKeys.some(k=>typeof k!=='string'||
         !REQUEST_FIELDS.includes(k as typeof REQUEST_FIELDS[number]))||
       REQUEST_FIELDS.some(k=>!Object.prototype.hasOwnProperty.call(requestDescriptors,k)||
         !Object.prototype.hasOwnProperty.call(requestDescriptors[k],'value'))||
       requestDescriptors.expectedSourceSha256.value!==diskSourceSha256||
       // RegExp.test in the downstream candidate planner would coerce an
       // object-valued evidence ID and invoke caller-controlled JavaScript.
       typeof requestDescriptors.faultEvidenceId.value!=='string')
      return blocked('SOURCE_IDENTITY_UNCONFIRMED');

    // Regenerate the AST-anchored diff and exact candidate schema, including
    // source and candidate SHA-256; no candidate-provided success flag is read.
    const audit=auditProposedLiteralSelectorPatch(request,untrustedCandidate);
    if(audit.status!=='REVIEWABLE_ONLY')
      return blocked('PATCH_REVIEW_FAILED');

    // A successful local audit is not runtime/manager attestation and cannot
    // authorize a write. Never return the userscript source or full diff.
    return Object.freeze({
      status:'AWAITING_TRUSTED_RUNTIME_AND_BACKUP' as const,
      reason:'REAL_TAMPERMONKEY_BUSINESS_AND_BACKUP_EVIDENCE_REQUIRED' as const,
      originalSha256:audit.originalSha256,
      candidateSha256:audit.candidateSha256,
      faultEvidenceId:audit.faultEvidenceId,
      change:Object.freeze({...audit.change}),
      automaticPatchAllowed:false as const,
      tampermonkeyVerified:false as const,
      businessRecoveredVerified:false as const
    });
  }catch{
    // Malicious getters/proxies and parser faults never escape the boundary.
    return blocked('INVALID_OPTIONS');
  }
}
