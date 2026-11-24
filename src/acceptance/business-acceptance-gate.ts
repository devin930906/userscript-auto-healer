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
  | 'EVIDENCE_EXPIRED'
  | 'EVIDENCE_FUTURE_DATED'
  | 'UNTRUSTED_EVIDENCE_INPUT';

const SHA256 = /^[a-f0-9]{64}$/;
const ISO8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
// A short-lived read-only receipt is not reusable authorization after a
// browser/profile or userscript changes. Time bounds are necessary, not proof
// of a trustworthy Tampermonkey evidence producer.
const MAX_EVIDENCE_AGE_MS = 30 * 60_000;

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
const TASK009_CANDIDATE_KEYS = [
  'status', 'originalSha256', 'candidateSha256', 'faultEvidenceId',
  'callOffset', 'method', 'originalSelector', 'replacementSelector',
  'diffSummary', 'candidateSource', 'metadataPreserved',
  'permissionExpansionPrevented', 'automaticPatchAllowed',
  'automaticRollbackAllowed', 'tampermonkeyVerified', 'businessVerified',
  'nextPermittedAction'
] as const;
const NATIVE_RESTORE_RECEIPT_KEYS = [
  'status', 'originalSha256', 'displacedSha256',
  'displacedBackupFileName', 'journalFileName',
  'automaticPatchAllowed', 'automaticRollbackAllowed',
  'tampermonkeyVerified', 'businessVerified'
] as const;

const LEGACY_RESTORE_RECEIPT_KEYS = [
  'status', 'originalSha256', 'displacedSha256',
  'displacedBackupFileName', 'journalFileName',
  'automaticPatchAllowed', 'automaticRollbackAllowed',
  'tampermonkeyVerified', 'businessRecoveredVerified'
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
  untrustedOptions: unknown,
  signal?: AbortSignal
): BusinessAcceptanceResult {
  try {
    if (signal?.aborted) {
      return blocked('NOT_AUTHORIZED');
    }

    const opts = extractPlainDataRecord(untrustedOptions, OPTION_KEYS);
    if (!opts || typeof opts.userApproved !== 'boolean') {
      return blocked('INVALID_OPTIONS');
    }
    if (opts.userApproved !== true) {
      return blocked('NOT_AUTHORIZED');
    }

    let origSha = '';
    let candSha = '';
    let faultEvidenceId = '';

    const audit = extractPlainDataRecord(auditReceipt, AUDIT_KEYS);
    if (audit) {
      if (
        audit.status !== 'REVIEWABLE_ONLY' ||
        audit.automaticPatchAllowed !== false ||
        audit.tampermonkeyVerified !== false ||
        audit.businessRecoveredVerified !== false
      ) {
        return blocked('AUDIT_NOT_REVIEWABLE');
      }
      origSha = audit.originalSha256 as string;
      candSha = audit.candidateSha256 as string;
      faultEvidenceId = audit.faultEvidenceId as string;
    } else {
      const task009Audit = extractPlainDataRecord(auditReceipt, TASK009_CANDIDATE_KEYS);
      if (
        !task009Audit ||
        task009Audit.status !== 'CANDIDATE_READY_FOR_REVIEW' ||
        task009Audit.automaticPatchAllowed !== false ||
        task009Audit.automaticRollbackAllowed !== false ||
        task009Audit.tampermonkeyVerified !== false ||
        task009Audit.businessVerified !== false ||
        task009Audit.nextPermittedAction !== 'USER_REVIEW_AND_STAGE_BACKUP_REQUIRED'
      ) {
        return blocked('AUDIT_NOT_REVIEWABLE');
      }
      origSha = task009Audit.originalSha256 as string;
      candSha = task009Audit.candidateSha256 as string;
      faultEvidenceId = task009Audit.faultEvidenceId as string;
    }

    const backup = extractPlainDataRecord(backupReceipt, BACKUP_KEYS);
    if (!backup || backup.status !== 'BACKUP_PREPARED_RUNTIME_UNVERIFIED' ||
        backup.automaticPatchAllowed !== false ||
        backup.automaticRollbackAllowed !== false ||
        backup.tampermonkeyVerified !== false ||
        backup.businessRecoveredVerified !== false ||
        typeof backup.backupByteLength !== 'number' ||
        !Number.isSafeInteger(backup.backupByteLength) ||
        backup.backupByteLength < 1) {
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
    if (!Number.isFinite(origTime) || !Number.isFinite(candTime)) {
      return blocked('UNTRUSTED_EVIDENCE_INPUT');
    }
    const now = Date.now();
    if (origTime > now || candTime > now) {
      return blocked('EVIDENCE_FUTURE_DATED');
    }
    if (now - origTime > MAX_EVIDENCE_AGE_MS ||
        now - candTime > MAX_EVIDENCE_AGE_MS) {
      return blocked('EVIDENCE_EXPIRED');
    }
    // The candidate must be observed only AFTER the original is shown broken.
    if (candTime <= origTime) {
      return blocked('EVIDENCE_TEMPORAL_INVERSION');
    }

    const backupFileName = backup.backupFileName;
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

export type RollbackAcceptanceBlockReason =
  | 'INVALID_OPTIONS'
  | 'NOT_AUTHORIZED'
  | 'ROLLBACK_RECEIPT_INVALID'
  | 'ORIGINAL_HASH_MISMATCH'
  | 'DISPLACED_HASH_MISMATCH'
  | 'UNTRUSTED_INPUT';

export type RollbackAcceptanceResult =
  | Readonly<{
      status: 'BLOCKED';
      reason: RollbackAcceptanceBlockReason;
      automaticPatchAllowed: false;
      automaticRollbackAllowed: false;
      tampermonkeyVerified: false;
      businessVerified: false;
    }>
  | Readonly<{
      status: 'ROLLBACK_ACCEPTED_ORIGINAL_RESTORED';
      originalSha256: string;
      displacedSha256: string;
      displacedBackupFileName: string;
      journalFileName: string;
      automaticPatchAllowed: false;
      automaticRollbackAllowed: false;
      tampermonkeyVerified: false;
      businessVerified: false;
    }>;

export function evaluateRollbackAcceptanceGate(
  untrustedRollbackReceipt: unknown,
  expectedOriginalSha256: unknown,
  expectedDisplacedSha256: unknown,
  untrustedOptions: unknown,
  signal?: AbortSignal
): RollbackAcceptanceResult {
  const fail = (reason: RollbackAcceptanceBlockReason): RollbackAcceptanceResult =>
    Object.freeze({
      status: 'BLOCKED' as const,
      reason,
      ...failFlags
    });

  try {
    if (signal?.aborted) {
      return fail('NOT_AUTHORIZED');
    }

    const opts = extractPlainDataRecord(untrustedOptions, OPTION_KEYS);
    if (!opts || typeof opts.userApproved !== 'boolean') {
      return fail('INVALID_OPTIONS');
    }
    if (opts.userApproved !== true) {
      return fail('NOT_AUTHORIZED');
    }

    if (
      typeof expectedOriginalSha256 !== 'string' ||
      !SHA256.test(expectedOriginalSha256) ||
      typeof expectedDisplacedSha256 !== 'string' ||
      !SHA256.test(expectedDisplacedSha256)
    ) {
      return fail('UNTRUSTED_INPUT');
    }

    const nativeReceipt = extractPlainDataRecord(untrustedRollbackReceipt, NATIVE_RESTORE_RECEIPT_KEYS);
    const legacyReceipt = extractPlainDataRecord(untrustedRollbackReceipt, LEGACY_RESTORE_RECEIPT_KEYS);
    const receipt = nativeReceipt ?? legacyReceipt;
    if (
      !receipt ||
      receipt.status !== 'RESTORED_NATIVE_ONLY' ||
      receipt.automaticPatchAllowed !== false ||
      receipt.automaticRollbackAllowed !== false ||
      receipt.tampermonkeyVerified !== false
    ) {
      return fail('ROLLBACK_RECEIPT_INVALID');
    }
    if (nativeReceipt && nativeReceipt.businessVerified !== false) {
      return fail('ROLLBACK_RECEIPT_INVALID');
    }
    if (legacyReceipt && legacyReceipt.businessRecoveredVerified !== false) {
      return fail('ROLLBACK_RECEIPT_INVALID');
    }

    if (receipt.originalSha256 !== expectedOriginalSha256) {
      return fail('ORIGINAL_HASH_MISMATCH');
    }

    if (receipt.displacedSha256 !== expectedDisplacedSha256) {
      return fail('DISPLACED_HASH_MISMATCH');
    }

    if (
      typeof receipt.displacedBackupFileName !== 'string' ||
      receipt.displacedBackupFileName.length === 0 ||
      typeof receipt.journalFileName !== 'string' ||
      receipt.journalFileName.length === 0
    ) {
      return fail('ROLLBACK_RECEIPT_INVALID');
    }

    return Object.freeze({
      status: 'ROLLBACK_ACCEPTED_ORIGINAL_RESTORED' as const,
      originalSha256: receipt.originalSha256 as string,
      displacedSha256: receipt.displacedSha256 as string,
      displacedBackupFileName: receipt.displacedBackupFileName as string,
      journalFileName: receipt.journalFileName as string,
      automaticPatchAllowed: false as const,
      automaticRollbackAllowed: false as const,
      // Native restoration does not attest manager execution or business recovery.
      tampermonkeyVerified: false as const,
      businessVerified: false as const
    });
  } catch {
    return fail('UNTRUSTED_INPUT');
  }
}
