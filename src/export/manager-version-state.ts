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
import type {ManagedLaunchResult} from '../browser/owned-chrome';
import {isLiveApprovedChromeSession} from '../browser/owned-chrome';
import {
  validBrowserWebSocket,
  connectBrowserWebSocket,
  sendCdpCommand,
  isNativeAbortSignal,
  awaitListenerProofOrRevocation
} from '../manager/tampermonkey-installation';

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

/** Snapshot only own-data array slots before inspecting manager/import evidence.
 * Array iteration itself can invoke indexed getters, inherited iterators or
 * Proxy traps. Never run those when reconciling untrusted manager identities.
 */
function snapshotOwnDataArray(input: unknown, maxLength: number): unknown[] | null {
  try {
    if (nodeTypes.isProxy(input) || !Array.isArray(input) ||
        Object.getPrototypeOf(input) !== Array.prototype ||
        input.length > maxLength) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Reflect.ownKeys(descriptors).length !== input.length + 1) return null;
    const snapshot: unknown[] = [];
    for (let i = 0; i < input.length; i++) {
      const slot = descriptors[String(i)];
      if (!slot || !Object.prototype.hasOwnProperty.call(slot, 'value'))
        return null;
      snapshot.push(slot.value);
    }
    return snapshot;
  } catch {
    return null;
  }
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

export type ImportedScriptDescriptor = Readonly<{
  scriptId: string;
  name: string;
  version: string;
  sha256: string;
  installUrl?: string;
  exportFileName?: string;
}>;

export type InstalledScriptObservation = Readonly<{
  scriptId?: string;
  name: string;
  version: string;
  activeScriptSha256: string;
  injected: boolean;
  gmApiVerified: boolean;
}>;

export type ScriptReconciliationStatus =
  | 'INSTALLED_MATCH'
  | 'INSTALLED_VERSION_DIVERGED'
  | 'INSTALLED_HASH_DIVERGED'
  | 'MISSING_NOT_INSTALLED'
  | 'INVALID_DESCRIPTOR';

export type SingleScriptReconciliationResult = Readonly<{
  scriptId: string;
  name: string;
  expectedVersion: string;
  expectedSha256: string;
  installUrl?: string;
  exportFileName?: string;
  status: ScriptReconciliationStatus;
  installedVersion?: string;
  installedSha256?: string;
  managerVerified: boolean;
}>;

export type BatchReconciliationResult = Readonly<{
  status: 'COMPLETED' | 'BLOCKED';
  reason?: ManagerVersionBlockReason;
  totalCount: number;
  matchedCount: number;
  divergedCount: number;
  missingCount: number;
  invalidCount: number;
  items: readonly SingleScriptReconciliationResult[];
  missingScriptIds: readonly string[];
} & typeof noAuthority>;

export function reconcileBatchImportedScriptsVersionState(
  untrustedImportedScripts: unknown,
  untrustedInstalledObservations: unknown | null | undefined,
  untrustedOptions: unknown
): BatchReconciliationResult {
  try {
    const opts = extractPlain(untrustedOptions, OPTION_KEYS);
    if (!opts || typeof opts.userApproved !== 'boolean') {
      return Object.freeze({
        status: 'BLOCKED' as const,
        reason: 'INVALID_OPTIONS' as const,
        totalCount: 0,
        matchedCount: 0,
        divergedCount: 0,
        missingCount: 0,
        invalidCount: 0,
        items: Object.freeze([]),
        missingScriptIds: Object.freeze([]),
        ...noAuthority
      });
    }
    if (opts.userApproved !== true) {
      return Object.freeze({
        status: 'BLOCKED' as const,
        reason: 'NOT_AUTHORIZED' as const,
        totalCount: 0,
        matchedCount: 0,
        divergedCount: 0,
        missingCount: 0,
        invalidCount: 0,
        items: Object.freeze([]),
        missingScriptIds: Object.freeze([]),
        ...noAuthority
      });
    }

    const importedRows = snapshotOwnDataArray(untrustedImportedScripts, 500);
    if (!importedRows) {
      return Object.freeze({
        status: 'BLOCKED' as const,
        reason: 'UNTRUSTED_INPUT' as const,
        totalCount: 0,
        matchedCount: 0,
        divergedCount: 0,
        missingCount: 0,
        invalidCount: 0,
        items: Object.freeze([]),
        missingScriptIds: Object.freeze([]),
        ...noAuthority
      });
    }

    const observationMap = new Map<string, InstalledScriptObservation>();
    const ambiguousScriptIds = new Set<string>();
    const observationByName = new Map<string, InstalledScriptObservation>();
    const ambiguousLegacyNames = new Set<string>();

    if (untrustedInstalledObservations !== null && untrustedInstalledObservations !== undefined) {
      const observationRows = snapshotOwnDataArray(untrustedInstalledObservations, 500);
      if (!observationRows) {
        return Object.freeze({
          status: 'BLOCKED' as const,
          reason: 'PROBE_EVIDENCE_INVALID' as const,
          totalCount: 0,
          matchedCount: 0,
          divergedCount: 0,
          missingCount: 0,
          invalidCount: 0,
          items: Object.freeze([]),
          missingScriptIds: Object.freeze([]),
          ...noAuthority
        });
      }

      for (const obs of observationRows) {
        if (!obs || typeof obs !== 'object' || Array.isArray(obs) || nodeTypes.isProxy(obs)) {
          return Object.freeze({
            status: 'BLOCKED' as const,
            reason: 'PROBE_EVIDENCE_INVALID' as const,
            totalCount: 0,
            matchedCount: 0,
            divergedCount: 0,
            missingCount: 0,
            invalidCount: 0,
            items: Object.freeze([]),
            missingScriptIds: Object.freeze([]),
            ...noAuthority
          });
        }
        const desc = Object.getOwnPropertyDescriptors(obs);
        const nameVal = desc.name?.value;
        const verVal = desc.version?.value;
        const shaVal = desc.activeScriptSha256?.value;
        const injVal = desc.injected?.value;
        const gmVal = desc.gmApiVerified?.value;
        const idVal = desc.scriptId?.value;

        if (
          typeof nameVal !== 'string' || nameVal.length === 0 ||
          typeof verVal !== 'string' ||
          typeof shaVal !== 'string' || !SHA256_RE.test(shaVal) ||
          typeof injVal !== 'boolean' ||
          typeof gmVal !== 'boolean'
        ) {
          return Object.freeze({
            status: 'BLOCKED' as const,
            reason: 'PROBE_EVIDENCE_INVALID' as const,
            totalCount: 0,
            matchedCount: 0,
            divergedCount: 0,
            missingCount: 0,
            invalidCount: 0,
            items: Object.freeze([]),
            missingScriptIds: Object.freeze([]),
            ...noAuthority
          });
        }

        const validObs: InstalledScriptObservation = Object.freeze({
          scriptId: typeof idVal === 'string' ? idVal : undefined,
          name: nameVal,
          version: verVal,
          activeScriptSha256: shaVal,
          injected: injVal,
          gmApiVerified: gmVal
        });

        if (validObs.scriptId) {
          // Multiple observations for the same manager identity are ambiguous,
          // regardless of their order. Never let the final record win.
          if (ambiguousScriptIds.has(validObs.scriptId) || observationMap.has(validObs.scriptId)) {
            ambiguousScriptIds.add(validObs.scriptId);
            observationMap.delete(validObs.scriptId);
          } else {
            observationMap.set(validObs.scriptId, validObs);
          }
        } else {
          // ID-less legacy identities must be unambiguous. A repeated
          // normalized name cannot be authenticated by last-write-wins.
          const legacyName = validObs.name.trim().toLowerCase();
          if (ambiguousLegacyNames.has(legacyName) || observationByName.has(legacyName)) {
            ambiguousLegacyNames.add(legacyName);
            observationByName.delete(legacyName);
          } else {
            observationByName.set(legacyName, validObs);
          }
        }
      }
    }

    // A legacy name-only manager observation cannot authenticate two imports.
    // Exact-ID evidence remains authoritative for each distinct script ID.
    const importedNameCounts = new Map<string, number>();
    for (const raw of importedRows) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || nodeTypes.isProxy(raw)) continue;
      const descriptor = Object.getOwnPropertyDescriptors(raw);
      const importedName = descriptor.name?.value;
      if (typeof importedName !== 'string' || importedName.length === 0 || importedName.length > 256) continue;
      const key = importedName.trim().toLowerCase();
      importedNameCounts.set(key, (importedNameCounts.get(key) ?? 0) + 1);
    }

    const items: SingleScriptReconciliationResult[] = [];
    const missingScriptIds: string[] = [];
    let matchedCount = 0;
    let divergedCount = 0;
    let missingCount = 0;
    let invalidCount = 0;

    for (const raw of importedRows) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || nodeTypes.isProxy(raw)) {
        invalidCount++;
        items.push(Object.freeze({
          scriptId: 'unknown',
          name: 'unknown',
          expectedVersion: '',
          expectedSha256: '',
          status: 'INVALID_DESCRIPTOR' as const,
          managerVerified: false
        }));
        continue;
      }
      const desc = Object.getOwnPropertyDescriptors(raw);
      const idVal = desc.scriptId?.value;
      const nameVal = desc.name?.value;
      const verVal = desc.version?.value;
      const shaVal = desc.sha256?.value;
      const urlVal = desc.installUrl?.value;
      const fileVal = desc.exportFileName?.value;

      if (
        typeof idVal !== 'string' || idVal.length === 0 || idVal.length > 128 ||
        typeof nameVal !== 'string' || nameVal.length === 0 || nameVal.length > 256 ||
        typeof verVal !== 'string' || verVal.length > 64 ||
        typeof shaVal !== 'string' || !SHA256_RE.test(shaVal)
      ) {
        invalidCount++;
        items.push(Object.freeze({
          scriptId: typeof idVal === 'string' ? idVal : 'unknown',
          name: typeof nameVal === 'string' ? nameVal : 'unknown',
          expectedVersion: typeof verVal === 'string' ? verVal : '',
          expectedSha256: typeof shaVal === 'string' ? shaVal : '',
          status: 'INVALID_DESCRIPTOR' as const,
          managerVerified: false
        }));
        continue;
      }

      const scriptId = idVal;
      const name = nameVal;
      const expectedVersion = verVal;
      const expectedSha256 = shaVal;
      const installUrl = typeof urlVal === 'string' ? urlVal : undefined;
      const exportFileName = typeof fileVal === 'string' ? fileVal : undefined;

      const normalizedName = name.trim().toLowerCase();
      const matchedObs = ambiguousScriptIds.has(scriptId)
        ? undefined
        : observationMap.get(scriptId) || (ambiguousLegacyNames.has(normalizedName) ||
          importedNameCounts.get(normalizedName) !== 1
          ? undefined : observationByName.get(normalizedName));

      if (!matchedObs) {
        missingCount++;
        missingScriptIds.push(scriptId);
        items.push(Object.freeze({
          scriptId,
          name,
          expectedVersion,
          expectedSha256,
          installUrl,
          exportFileName,
          status: 'MISSING_NOT_INSTALLED' as const,
          managerVerified: false
        }));
      } else if (
        matchedObs.activeScriptSha256 === expectedSha256 &&
        matchedObs.injected === true &&
        matchedObs.gmApiVerified === true
      ) {
        matchedCount++;
        items.push(Object.freeze({
          scriptId,
          name,
          expectedVersion,
          expectedSha256,
          installUrl,
          exportFileName,
          status: 'INSTALLED_MATCH' as const,
          installedVersion: matchedObs.version,
          installedSha256: matchedObs.activeScriptSha256,
          managerVerified: true
        }));
      } else {
        divergedCount++;
        const status = (matchedObs.version !== expectedVersion)
          ? ('INSTALLED_VERSION_DIVERGED' as const)
          : ('INSTALLED_HASH_DIVERGED' as const);
        items.push(Object.freeze({
          scriptId,
          name,
          expectedVersion,
          expectedSha256,
          installUrl,
          exportFileName,
          status,
          installedVersion: matchedObs.version,
          installedSha256: matchedObs.activeScriptSha256,
          managerVerified: false
        }));
      }
    }

    return Object.freeze({
      status: 'COMPLETED' as const,
      totalCount: items.length,
      matchedCount,
      divergedCount,
      missingCount,
      invalidCount,
      items: Object.freeze(items),
      missingScriptIds: Object.freeze(missingScriptIds),
      ...noAuthority
    });
  } catch {
    return Object.freeze({
      status: 'BLOCKED' as const,
      reason: 'UNTRUSTED_INPUT' as const,
      totalCount: 0,
      matchedCount: 0,
      divergedCount: 0,
      missingCount: 0,
      invalidCount: 0,
      items: Object.freeze([]),
      missingScriptIds: Object.freeze([]),
      ...noAuthority
    });
  }
}

export type BatchInstallItem = Readonly<{
  scriptId: string;
  name: string;
  installUrl: string;
  sha256?: string;
}>;

export type SingleInstallOutcomeStatus =
  | 'LAUNCHED_PENDING_USER_CONFIRMATION'
  | 'REFUSED'
  | 'CANCELLED'
  | 'FAILED';

export type SingleInstallOutcome = Readonly<{
  scriptId: string;
  name: string;
  installUrl: string;
  status: SingleInstallOutcomeStatus;
  targetId?: string;
  code?: string;
  nativeConfirmationRequired: true;
}>;

export type BatchInstallLaunchResult = Readonly<{
  status: 'COMPLETED' | 'PARTIAL' | 'BLOCKED' | 'CANCELLED';
  code?: 'NOT_AUTHORIZED' | 'INVALID_OPTIONS' | 'UNVERIFIED_BROWSER' | 'UNOWNED_LISTENER' | 'CDP_FAILED' | 'CANCELLED';
  totalCount: number;
  launchedCount: number;
  refusedCount: number;
  cancelledCount: number;
  failedCount: number;
  items: readonly SingleInstallOutcome[];
  automaticSilentInstallForbidden: true;
  automaticInstallAllowed: false;
}>;

export async function launchBatchUserscriptInstallation(
  untrustedSession: unknown,
  untrustedScripts: unknown,
  untrustedOptions: unknown,
  signal?: AbortSignal
): Promise<BatchInstallLaunchResult> {
  const failResult = (
    status: 'BLOCKED' | 'CANCELLED',
    code: 'NOT_AUTHORIZED' | 'INVALID_OPTIONS' | 'UNVERIFIED_BROWSER' | 'UNOWNED_LISTENER' | 'CDP_FAILED' | 'CANCELLED',
    total = 0,
    items: SingleInstallOutcome[] = []
  ): BatchInstallLaunchResult =>
    Object.freeze({
      status,
      code,
      totalCount: total,
      launchedCount: 0,
      refusedCount: 0,
      cancelledCount: status === 'CANCELLED' ? total : 0,
      failedCount: 0,
      items: Object.freeze(items),
      automaticSilentInstallForbidden: true as const,
      automaticInstallAllowed: false as const
    });

  if (signal !== undefined && !isNativeAbortSignal(signal)) {
    return failResult('BLOCKED', 'INVALID_OPTIONS');
  }
  if (signal?.aborted) {
    return failResult('CANCELLED', 'CANCELLED');
  }

  const opts = extractPlain(untrustedOptions, OPTION_KEYS);
  if (!opts || typeof opts.userApproved !== 'boolean') {
    return failResult('BLOCKED', 'INVALID_OPTIONS');
  }
  if (opts.userApproved !== true) {
    return failResult('BLOCKED', 'NOT_AUTHORIZED');
  }

  const scriptRows = snapshotOwnDataArray(untrustedScripts, 500);
  if (!scriptRows) {
    return failResult('BLOCKED', 'INVALID_OPTIONS');
  }

  // Snapshot descriptors before any browser work. The cancellation path must
  // never dereference an untrusted script object or inherited getter.
  const safeRows: unknown[] = [];
  for (const raw of scriptRows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || nodeTypes.isProxy(raw)) {
      safeRows.push(null);
      continue;
    }
    const proto = Object.getPrototypeOf(raw);
    if (proto !== Object.prototype && proto !== null) {
      return failResult('BLOCKED', 'INVALID_OPTIONS');
    }
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    const fields = ['scriptId', 'name', 'installUrl'] as const;
    if (fields.some(field => descriptors[field] &&
        !Object.prototype.hasOwnProperty.call(descriptors[field], 'value'))) {
      return failResult('BLOCKED', 'INVALID_OPTIONS');
    }
    safeRows.push(Object.freeze({
      scriptId: descriptors.scriptId?.value,
      name: descriptors.name?.value,
      installUrl: descriptors.installUrl?.value
    }));
  }

  if (scriptRows.length === 0) {
    return Object.freeze({
      status: 'COMPLETED' as const,
      totalCount: 0,
      launchedCount: 0,
      refusedCount: 0,
      cancelledCount: 0,
      failedCount: 0,
      items: Object.freeze([]),
      automaticSilentInstallForbidden: true as const,
      automaticInstallAllowed: false as const
    });
  }

  const session = untrustedSession as ManagedLaunchResult;
  if (!isLiveApprovedChromeSession(session)) {
    return failResult('BLOCKED', 'UNVERIFIED_BROWSER', scriptRows.length);
  }

  const endpoint = validBrowserWebSocket(session.browserWebsocket);
  if (!endpoint) {
    return failResult('BLOCKED', 'UNVERIFIED_BROWSER', scriptRows.length);
  }

  const ownership = await awaitListenerProofOrRevocation(endpoint.port, session.pid, signal);
  if (signal?.aborted || ownership.cancelled) {
    return failResult('CANCELLED', 'CANCELLED', scriptRows.length);
  }
  if (!ownership.ok || !isLiveApprovedChromeSession(session)) {
    return failResult('BLOCKED', 'UNOWNED_LISTENER', scriptRows.length);
  }

  const socket = await connectBrowserWebSocket(endpoint.url);
  if (!socket) {
    return failResult('BLOCKED', 'CDP_FAILED', scriptRows.length);
  }

  const items: SingleInstallOutcome[] = [];
  let launchedCount = 0;
  let refusedCount = 0;
  let cancelledCount = 0;
  let failedCount = 0;
  let commandId = 1;

  try {
    for (const raw of safeRows) {
      if (signal?.aborted) {
        items.push(Object.freeze({
          scriptId: (raw && typeof (raw as any).scriptId === 'string') ? (raw as any).scriptId : 'unknown',
          name: (raw && typeof (raw as any).name === 'string') ? (raw as any).name : 'unknown',
          installUrl: (raw && typeof (raw as any).installUrl === 'string') ? (raw as any).installUrl : '',
          status: 'CANCELLED' as const,
          code: 'CANCELLED',
          nativeConfirmationRequired: true as const
        }));
        cancelledCount++;
        continue;
      }

      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || nodeTypes.isProxy(raw)) {
        items.push(Object.freeze({
          scriptId: 'unknown',
          name: 'unknown',
          installUrl: '',
          status: 'REFUSED' as const,
          code: 'INVALID_DESCRIPTOR',
          nativeConfirmationRequired: true as const
        }));
        refusedCount++;
        continue;
      }

      const desc = Object.getOwnPropertyDescriptors(raw);
      const idVal = desc.scriptId?.value;
      const nameVal = desc.name?.value;
      const urlVal = desc.installUrl?.value;

      if (
        typeof idVal !== 'string' || idVal.length === 0 ||
        typeof nameVal !== 'string' || nameVal.length === 0 ||
        typeof urlVal !== 'string' || urlVal.length === 0
      ) {
        items.push(Object.freeze({
          scriptId: typeof idVal === 'string' ? idVal : 'unknown',
          name: typeof nameVal === 'string' ? nameVal : 'unknown',
          installUrl: typeof urlVal === 'string' ? urlVal : '',
          status: 'REFUSED' as const,
          code: 'INVALID_DESCRIPTOR',
          nativeConfirmationRequired: true as const
        }));
        refusedCount++;
        continue;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(urlVal);
        if (
          parsedUrl.protocol !== 'http:' &&
          parsedUrl.protocol !== 'https:' &&
          parsedUrl.protocol !== 'file:'
        ) {
          items.push(Object.freeze({
            scriptId: idVal,
            name: nameVal,
            installUrl: urlVal,
            status: 'REFUSED' as const,
            code: 'DISALLOWED_OR_INVALID_URL',
            nativeConfirmationRequired: true as const
          }));
          refusedCount++;
          continue;
        }
      } catch {
        items.push(Object.freeze({
          scriptId: idVal,
          name: nameVal,
          installUrl: urlVal,
          status: 'REFUSED' as const,
          code: 'DISALLOWED_OR_INVALID_URL',
          nativeConfirmationRequired: true as const
        }));
        refusedCount++;
        continue;
      }

      try {
        const created = await sendCdpCommand(
          socket,
          commandId++,
          'Target.createTarget',
          {url: parsedUrl.href, background: false}
        );
        const targetId = created && typeof created.targetId === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(created.targetId)
          ? (created.targetId as string)
          : undefined;

        if (targetId) {
          items.push(Object.freeze({
            scriptId: idVal,
            name: nameVal,
            installUrl: parsedUrl.href,
            status: 'LAUNCHED_PENDING_USER_CONFIRMATION' as const,
            targetId,
            nativeConfirmationRequired: true as const
          }));
          launchedCount++;
        } else {
          items.push(Object.freeze({
            scriptId: idVal,
            name: nameVal,
            installUrl: parsedUrl.href,
            status: 'FAILED' as const,
            code: 'CDP_FAILED',
            nativeConfirmationRequired: true as const
          }));
          failedCount++;
        }
      } catch {
        items.push(Object.freeze({
          scriptId: idVal,
          name: nameVal,
          installUrl: parsedUrl.href,
          status: 'FAILED' as const,
          code: 'CDP_FAILED',
          nativeConfirmationRequired: true as const
        }));
        failedCount++;
      }
    }
  } finally {
    try {
      socket.close();
    } catch {}
  }

  if (!isLiveApprovedChromeSession(session)) {
    return failResult('BLOCKED', 'UNVERIFIED_BROWSER', items.length, items);
  }

  let finalStatus: 'COMPLETED' | 'PARTIAL' | 'CANCELLED';
  if (cancelledCount > 0 && launchedCount === 0 && failedCount === 0) {
    finalStatus = 'CANCELLED';
  } else if (failedCount === 0 && refusedCount === 0 && cancelledCount === 0) {
    finalStatus = 'COMPLETED';
  } else {
    finalStatus = 'PARTIAL';
  }

  return Object.freeze({
    status: finalStatus,
    totalCount: items.length,
    launchedCount,
    refusedCount,
    cancelledCount,
    failedCount,
    items: Object.freeze(items),
    automaticSilentInstallForbidden: true as const,
    automaticInstallAllowed: false as const
  });
}
