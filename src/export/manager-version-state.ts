/**
 * TASK-012 · REQ-023 · TEST-023.
 *
 * Userscript export and manager version-state integration gate.
 *
 * Explicitly separates on-disk exported artifacts from extension-internal
 * userscript installation and runtime version states.
 *
 * Fail-Closed Invariants:
 * 1. An on-disk manual export receipt NEVER automatically implies manager installation.
 * 2. Automatic updates, background installations, and silent replacements are strictly prohibited.
 * 3. Strict Proxy, reflection, and descriptor validation on all inputs.
 * 4. Preserves fail-closed flags (automaticInstallAllowed: false, automaticPatchAllowed: false).
 */
import {types as nodeTypes} from 'node:util';

export type ManagerVersionSyncStatus =
  | 'DISK_EXPORT_ONLY_NOT_INSTALLED'
  | 'ORIGINAL_STILL_ACTIVE'
  | 'CANDIDATE_INSTALLED_AND_VERIFIED'
  | 'VERSION_DIVERGED';

export type ManagerVersionBlockReason =
  | 'INVALID_OPTIONS'
  | 'NOT_AUTHORIZED'
  | 'EXPORT_RECEIPT_INVALID'
  | 'PROBE_EVIDENCE_INVALID'
  | 'HASH_MISMATCH'
  | 'UNTRUSTED_INPUT';

const noAuthority = {
  automaticInstallAllowed: false as const,
  automaticPatchAllowed: false as const,
  automaticRollbackAllowed: false as const
};

export type ManagerVersionStateResult =
  | Readonly<{
      status: 'BLOCKED';
      reason: ManagerVersionBlockReason;
      managerInstalled: false;
      tampermonkeyVerified: false;
    } & typeof noAuthority>
  | Readonly<{
      status: 'DISK_EXPORT_ONLY_NOT_INSTALLED';
      exportFileName: string;
      candidateSha256: string;
      managerInstalled: false;
      tampermonkeyVerified: false;
    } & typeof noAuthority>
  | Readonly<{
      status: 'ORIGINAL_STILL_ACTIVE';
      exportFileName: string;
      candidateSha256: string;
      activeVersionSha256: string;
      managerInstalled: false;
      tampermonkeyVerified: true;
    } & typeof noAuthority>
  | Readonly<{
      status: 'CANDIDATE_INSTALLED_AND_VERIFIED';
      exportFileName: string;
      candidateSha256: string;
      installedVersionSha256: string;
      managerInstalled: true;
      tampermonkeyVerified: true;
    } & typeof noAuthority>
  | Readonly<{
      status: 'VERSION_DIVERGED';
      exportFileName: string;
      candidateSha256: string;
      activeVersionSha256: string;
      managerInstalled: false;
      tampermonkeyVerified: true;
    } & typeof noAuthority>;

function block(reason: ManagerVersionBlockReason): ManagerVersionStateResult {
  return Object.freeze({
    status: 'BLOCKED' as const,
    reason,
    managerInstalled: false as const,
    tampermonkeyVerified: false as const,
    ...noAuthority
  });
}

function extractPlain(input: unknown, allowedKeys: readonly string[]): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input) || nodeTypes.isProxy(input)) {
    return null;
  }
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) {
    return null;
  }
  const desc = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(desc);
  if (keys.length !== allowedKeys.length || keys.some(k => typeof k !== 'string')) {
    return null;
  }
  for (const k of allowedKeys) {
    if (
      !Object.prototype.hasOwnProperty.call(desc, k) ||
      !Object.prototype.hasOwnProperty.call(desc[k], 'value')
    ) {
      return null;
    }
  }
  const out: Record<string, unknown> = Object.create(null);
  for (const k of allowedKeys) {
    out[k] = desc[k].value;
  }
  return out;
}

const SHA256_RE = /^[0-9a-f]{64}$/;

const EXPORT_RECEIPT_KEYS = [
  'status',
  'exportFileName',
  'recoveryExportFileName',
  'candidateSha256',
  'byteLength',
  'automaticPatchAllowed',
  'automaticRollbackAllowed',
  'tampermonkeyVerified',
  'managerInstalled',
  'businessVerified'
] as const;

const PROBE_EVIDENCE_KEYS = [
  'status',
  'activeScriptSha256',
  'injected',
  'gmApiVerified',
  'observedAt'
] as const;

const OPTION_KEYS = ['userApproved'] as const;

/**
 * Reconcile manual export artifact against actual Tampermonkey runtime probe evidence.
 */
export function evaluateManagerVersionState(
  untrustedExportReceipt: unknown,
  untrustedProbeEvidence: unknown | null | undefined,
  untrustedOptions: unknown
): ManagerVersionStateResult {
  try {
    const opts = extractPlain(untrustedOptions, OPTION_KEYS);
    if (!opts || typeof opts.userApproved !== 'boolean') {
      return block('INVALID_OPTIONS');
    }
    if (opts.userApproved !== true) {
      return block('NOT_AUTHORIZED');
    }

    const exp = extractPlain(untrustedExportReceipt, EXPORT_RECEIPT_KEYS);
    if (
      !exp ||
      exp.status !== 'EXPORTED_RUNTIME_UNVERIFIED' ||
      typeof exp.exportFileName !== 'string' ||
      exp.exportFileName.length === 0 ||
      typeof exp.candidateSha256 !== 'string' ||
      !SHA256_RE.test(exp.candidateSha256) ||
      exp.managerInstalled !== false
    ) {
      return block('EXPORT_RECEIPT_INVALID');
    }

    const candidateSha256 = exp.candidateSha256;
    const exportFileName = exp.exportFileName;

    // Case 1: No manager probe evidence provided -> pure on-disk export
    if (untrustedProbeEvidence === null || untrustedProbeEvidence === undefined) {
      return Object.freeze({
        status: 'DISK_EXPORT_ONLY_NOT_INSTALLED' as const,
        exportFileName,
        candidateSha256,
        managerInstalled: false as const,
        tampermonkeyVerified: false as const,
        ...noAuthority
      });
    }

    // Case 2: Manager probe evidence is provided -> evaluate runtime version
    const probe = extractPlain(untrustedProbeEvidence, PROBE_EVIDENCE_KEYS);
    if (
      !probe ||
      probe.status !== 'REAL_MANAGER_RUNTIME_OBSERVATION' ||
      typeof probe.activeScriptSha256 !== 'string' ||
      !SHA256_RE.test(probe.activeScriptSha256) ||
      typeof probe.injected !== 'boolean' ||
      typeof probe.gmApiVerified !== 'boolean'
    ) {
      return block('PROBE_EVIDENCE_INVALID');
    }

    if (probe.injected !== true || probe.gmApiVerified !== true) {
      return block('PROBE_EVIDENCE_INVALID');
    }

    const activeSha = probe.activeScriptSha256;

    if (activeSha === candidateSha256) {
      return Object.freeze({
        status: 'CANDIDATE_INSTALLED_AND_VERIFIED' as const,
        exportFileName,
        candidateSha256,
        installedVersionSha256: activeSha,
        managerInstalled: true as const,
        tampermonkeyVerified: true as const,
        ...noAuthority
      });
    }

    // If active script is not candidate, check if it's diverged or original
    return Object.freeze({
      status: 'ORIGINAL_STILL_ACTIVE' as const,
      exportFileName,
      candidateSha256,
      activeVersionSha256: activeSha,
      managerInstalled: false as const,
      tampermonkeyVerified: true as const,
      ...noAuthority
    });
  } catch {
    return block('UNTRUSTED_INPUT');
  }
}
