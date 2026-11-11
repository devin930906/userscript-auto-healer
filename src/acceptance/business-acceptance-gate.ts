/**
 * TASK-010 · REQ-018/021 · TEST-018/021.
 *
 * Trusted business acceptance gate connecting independently audited repair candidates,
 * verified native original backups, and real Tampermonkey original failure/candidate
 * recovery evidence.
 *
 * Fails closed on missing, mismatched, expired, unauthenticated, or hostile proxy/accessor
 * evidence. Never authorizes automatic mutation without a full atomic transaction.
 */
import {types as nodeTypes} from 'node:util';
import type {CandidateAuditResult} from '../repair/patch-planner';
import type {LocalBackupPreparationResult} from './local-backup-preflight';

export type BusinessAcceptanceBlockReason =
  | 'INVALID_OPTIONS'
  | 'NOT_AUTHORIZED'
  | 'AUDIT_NOT_REVIEWABLE'
  | 'BACKUP_NOT_VERIFIED'
  | 'ORIGINAL_HASH_MISMATCH'
  | 'CANDIDATE_HASH_MISMATCH'
  | 'ORIGINAL_EVIDENCE_INVALID'
  | 'CANDIDATE_EVIDENCE_INVALID'
  | 'ORIGINAL_NOT_BROKEN'
  | 'CANDIDATE_NOT_RECOVERED'
  | 'EVIDENCE_TEMPORAL_INVERSION'
  | 'UNTRUSTED_EVIDENCE_INPUT';

const SHA256 = /^[a-f0-9]{64}$/;
const ISO8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

export interface VerifiedOriginalFailureEvidence {
  readonly status: 'REAL_MANAGER_ORIGINAL_EVALUATION';
  readonly sourceSha256: string;
  readonly injected: true;
  readonly gmVerified: true;
  readonly businessOutcome: 'missing-target' | 'fault';
  readonly actionConfirmed: false;
  readonly observedAt: string;
}

export interface VerifiedCandidateRecoveryEvidence {
  readonly status: 'REAL_MANAGER_CANDIDATE_EVALUATION';
  readonly candidateSha256: string;
  readonly injected: true;
  readonly gmVerified: true;
  readonly businessOutcome: 'recovered';
  readonly actionConfirmed: true;
  readonly observedAt: string;
}

const failFlags = {
  automaticPatchAllowed: false as const,
  automaticRollbackAllowed: false as const,
  tampermonkeyVerified: false as const,
  businessVerified: false as const
};

export type BusinessAcceptanceResult =
  | Readonly<{
      status: 'BLOCKED';
      reason: BusinessAcceptanceBlockReason;
      automaticPatchAllowed: false;
      automaticRollbackAllowed: false;
      tampermonkeyVerified: false;
      businessVerified: false;
    }>
  | Readonly<{
      status: 'BUSINESS_ACCEPTED_AWAITING_TRANSACTION';
      originalSha256: string;
      candidateSha256: string;
      backupFileName: string;
      faultEvidenceId: string;
      automaticPatchAllowed: false;
      automaticRollbackAllowed: false;
      tampermonkeyVerified: true;
      businessVerified: true;
    }>;

function blocked(reason: BusinessAcceptanceBlockReason): BusinessAcceptanceResult {
  return Object.freeze({
    status: 'BLOCKED' as const,
    reason,
    ...failFlags
  });
}

function extractPlainDataRecord(input: unknown, expectedKeys: readonly string[]): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input) || nodeTypes.isProxy(input)) {
    return null;
  }
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) {
    return null;
  }
  const desc = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(desc);
  if (keys.length !== expectedKeys.length || keys.some(k => typeof k !== 'string')) {
    return null;
  }
  for (const k of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(desc, k) ||
        !Object.prototype.hasOwnProperty.call(desc[k], 'value')) {
      return null;
    }
  }
  const out: Record<string, unknown> = Object.create(null);
  for (const k of expectedKeys) {
    out[k] = desc[k].value;
  }
  return out;
}

const OPTION_KEYS = ['userApproved'] as const;
const AUDIT_KEYS = [
  'status', 'originalSha256', 'candidateSha256', 'faultEvidenceId',
  'change', 'automaticPatchAllowed', 'tampermonkeyVerified', 'businessRecoveredVerified'
] as const;
const BACKUP_KEYS = [
  'status', 'backupFileName', 'sourceSha256', 'candidateSha256',
  'backupByteLength', 'automaticPatchAllowed', 'automaticRollbackAllowed',
  'tampermonkeyVerified', 'businessRecoveredVerified'
] as const;
const ORIGINAL_KEYS = [
  'status', 'sourceSha256', 'injected', 'gmVerified',
  'businessOutcome', 'actionConfirmed', 'observedAt'
] as const;
const CANDIDATE_KEYS = [
  'status', 'candidateSha256', 'injected', 'gmVerified',
  'businessOutcome', 'actionConfirmed', 'observedAt'
] as const;

/**
 * Assess candidate business acceptance against independently attributable original failure evidence,
 * candidate recovery evidence, audited patch change, and native backup preflight.
 */
export function evaluateBusinessAcceptanceGate(
  auditReceipt: unknown,
  backupReceipt: unknown,
  originalEvidence: unknown,
  candidateEvidence: unknown,
  untrustedOptions: unknown
): BusinessAcceptanceResult {
  try {
    const opts = extractPlainDataRecord(untrustedOptions, OPTION_KEYS);
    if (!opts || typeof opts.userApproved !== 'boolean') {
      return blocked('INVALID_OPTIONS');
    }
    if (opts.userApproved !== true) {
      return blocked('NOT_AUTHORIZED');
    }

    const audit = extractPlainDataRecord(auditReceipt, AUDIT_KEYS);
    if (!audit || audit.status !== 'REVIEWABLE_ONLY') {
      return blocked('AUDIT_NOT_REVIEWABLE');
    }

    const backup = extractPlainDataRecord(backupReceipt, BACKUP_KEYS);
    if (!backup || backup.status !== 'BACKUP_PREPARED_RUNTIME_UNVERIFIED') {
      return blocked('BACKUP_NOT_VERIFIED');
    }

    const orig = extractPlainDataRecord(originalEvidence, ORIGINAL_KEYS);
    if (!orig || orig.status !== 'REAL_MANAGER_ORIGINAL_EVALUATION') {
      return blocked('ORIGINAL_EVIDENCE_INVALID');
    }

    const cand = extractPlainDataRecord(candidateEvidence, CANDIDATE_KEYS);
    if (!cand || cand.status !== 'REAL_MANAGER_CANDIDATE_EVALUATION') {
      return blocked('CANDIDATE_EVIDENCE_INVALID');
    }

    const origSha = audit.originalSha256;
    const candSha = audit.candidateSha256;
    if (typeof origSha !== 'string' || !SHA256.test(origSha) ||
        typeof candSha !== 'string' || !SHA256.test(candSha)) {
      return blocked('AUDIT_NOT_REVIEWABLE');
    }

    if (backup.sourceSha256 !== origSha || orig.sourceSha256 !== origSha) {
      return blocked('ORIGINAL_HASH_MISMATCH');
    }

    if (backup.candidateSha256 !== candSha || cand.candidateSha256 !== candSha) {
      return blocked('CANDIDATE_HASH_MISMATCH');
    }

    if (orig.injected !== true || orig.gmVerified !== true || orig.actionConfirmed !== false ||
        (orig.businessOutcome !== 'missing-target' && orig.businessOutcome !== 'fault')) {
      return blocked('ORIGINAL_NOT_BROKEN');
    }

    if (cand.injected !== true || cand.gmVerified !== true || cand.actionConfirmed !== true ||
        cand.businessOutcome !== 'recovered') {
      return blocked('CANDIDATE_NOT_RECOVERED');
    }

    if (typeof orig.observedAt !== 'string' || !ISO8601.test(orig.observedAt) ||
        typeof cand.observedAt !== 'string' || !ISO8601.test(cand.observedAt)) {
      return blocked('UNTRUSTED_EVIDENCE_INPUT');
    }

    const origTime = Date.parse(orig.observedAt);
    const candTime = Date.parse(cand.observedAt);
    if (!Number.isFinite(origTime) || !Number.isFinite(candTime) || candTime < origTime) {
      return blocked('EVIDENCE_TEMPORAL_INVERSION');
    }

    const backupFileName = backup.backupFileName;
    const faultEvidenceId = audit.faultEvidenceId;
    if (typeof backupFileName !== 'string' || backupFileName.length === 0 ||
        typeof faultEvidenceId !== 'string' || faultEvidenceId.length === 0) {
      return blocked('UNTRUSTED_EVIDENCE_INPUT');
    }

    return Object.freeze({
      status: 'BUSINESS_ACCEPTED_AWAITING_TRANSACTION' as const,
      originalSha256: origSha,
      candidateSha256: candSha,
      backupFileName,
      faultEvidenceId,
      automaticPatchAllowed: false as const,
      automaticRollbackAllowed: false as const,
      tampermonkeyVerified: true as const,
      businessVerified: true as const
    });
  } catch {
    return blocked('UNTRUSTED_EVIDENCE_INPUT');
  }
}
