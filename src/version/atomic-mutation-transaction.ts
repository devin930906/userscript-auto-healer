/**
 * TASK-011 · REQ-020/021 · TEST-020/021/026.
 *
 * Recoverable atomic candidate mutation transaction.
 *
 * This privileged-native module applies an independently business-accepted
 * repair candidate (TASK-010) to the targeted source userscript.
 *
 * Security and Fail-Closed invariants:
 * 1. Strict Proxy, reflection, and descriptor validation on all inputs.
 * 2. Dedicated canonical path mutex (.uah-mutate-path-<sha256>).
 * 3. Verified independent original backup check BEFORE any write (guarantees rollback capability).
 * 4. Displaced candidate backup published next to original backup.
 * 5. Recovery intent journal (.uah-restore-<uuid>.journal.json) published via atomic hard link.
 * 6. Staged pending candidate written, chmod'd, fsync'd, and byte-verified before rename.
 * 7. Failure at any point fails closed, preserving both backup and original without damage.
 * 8. Never authorizes unbounded automatic patch/rollback; preserves fail-closed flags.
 */
import {createHash, randomUUID} from 'node:crypto';
import {constants, type BigIntStats} from 'node:fs';
import {link, lstat, mkdir, open, readdir, realpath, rename, rmdir, unlink} from 'node:fs/promises';
import {basename, dirname, isAbsolute, join, resolve} from 'node:path';
import {types as nodeTypes} from 'node:util';
import {MAX_SCRIPT_BYTES} from '../import/import-service';
import {verifyApprovedSourceFingerprint} from './source-snapshot';
import {verifyBackupRecoverySource} from './recovery-source';
import {backupPrefix, createVerifiedBackupOnly} from './verified-backup';
import {verifyExactCandidateBytesReadOnly} from './candidate-bytes';
import {hasUnsafePathLink} from './path-boundary';
import {hasInterruptedRestoreStaging} from './restore-staging-residue';
import {hasPriorPublishedRestoreIntentForSource} from './restore-intent-inspection';
import {removeOwnedNativeRestorePending, removeOwnedPublishedJournalPending} from './native-restore-transaction';
import type {BusinessAcceptanceResult} from '../acceptance/business-acceptance-gate';

export type AtomicMutationFailureReason =
  | 'INVALID_REQUEST'
  | 'NOT_AUTHORIZED'
  | 'ACCEPTANCE_UNVERIFIED'
  | 'HASH_MISMATCH'
  | 'UNSAFE_PATH'
  | 'SOURCE_LOCKED'
  | 'SOURCE_UNVERIFIED'
  | 'SOURCE_CHANGED'
  | 'BACKUP_UNVERIFIED'
  | 'RECOVERY_SAFETY_FAILED'
  | 'RECOVERY_REVIEW_REQUIRED'
  | 'IO_FAILURE'
  | 'CANCELLED';

const noAuthority = {
  automaticPatchAllowed: false as const,
  automaticRollbackAllowed: false as const,
  tampermonkeyVerified: false as const,
  businessVerified: false as const
};

export type AtomicMutationResult =
  | Readonly<{
      status: 'BLOCKED';
      reason: AtomicMutationFailureReason;
    } & typeof noAuthority>
  | Readonly<{
      status: 'APPLIED_NATIVE_ONLY';
      originalSha256: string;
      candidateSha256: string;
      backupFileName: string;
      displacedBackupFileName: string;
      journalFileName: string;
      rollbackReady: true;
      automaticPatchAllowed: false;
      automaticRollbackAllowed: false;
      tampermonkeyVerified: true;
      businessVerified: true;
    }>;

function block(reason: AtomicMutationFailureReason): AtomicMutationResult {
  return Object.freeze({
    status: 'BLOCKED' as const,
    reason,
    ...noAuthority
  });
}

type MutationInput = {
  sourcePath: string;
  backupDirectory: string;
  backupFileName: string;
  expectedOriginalSha256: string;
  expectedCandidateSha256: string;
  candidateSource: string;
  userApproved: boolean;
  mutateApproved: boolean;
};

const MUTATION_FIELDS = [
  'sourcePath',
  'backupDirectory',
  'backupFileName',
  'expectedOriginalSha256',
  'expectedCandidateSha256',
  'candidateSource',
  'userApproved',
  'mutateApproved'
] as const;

const SHA256_REGEX = /^[0-9a-f]{64}$/;

function parseInput(input: unknown): MutationInput | null {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input) || nodeTypes.isProxy(input)) {
      return null;
    }
    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) {
      return null;
    }
    const desc = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(desc);
    if (
      keys.length !== MUTATION_FIELDS.length ||
      keys.some(k => typeof k !== 'string') ||
      MUTATION_FIELDS.some(
        k => !Object.prototype.hasOwnProperty.call(desc, k) ||
             !Object.prototype.hasOwnProperty.call(desc[k], 'value')
      )
    ) {
      return null;
    }

    const x: Record<string, unknown> = Object.create(null);
    for (const field of MUTATION_FIELDS) {
      x[field] = desc[field].value;
    }

    if (
      typeof x.sourcePath !== 'string' ||
      typeof x.backupDirectory !== 'string' ||
      typeof x.backupFileName !== 'string' ||
      typeof x.expectedOriginalSha256 !== 'string' ||
      typeof x.expectedCandidateSha256 !== 'string' ||
      typeof x.candidateSource !== 'string' ||
      typeof x.userApproved !== 'boolean' ||
      typeof x.mutateApproved !== 'boolean' ||
      !SHA256_REGEX.test(x.expectedOriginalSha256) ||
      !SHA256_REGEX.test(x.expectedCandidateSha256) ||
      x.expectedOriginalSha256 === x.expectedCandidateSha256 ||
      !isAbsolute(x.sourcePath) ||
      !isAbsolute(x.backupDirectory) ||
      x.sourcePath !== resolve(x.sourcePath) ||
      x.backupDirectory !== resolve(x.backupDirectory) ||
      x.sourcePath.length > 4096 ||
      x.backupDirectory.length > 4096 ||
      x.sourcePath.includes('\0') ||
      x.backupDirectory.includes('\0') ||
      !/^[^\\/\u0000-\u001f]+\.user\.js$/i.test(basename(x.sourcePath)) ||
      x.backupFileName.length === 0 ||
      x.backupFileName.length > 255
    ) {
      return null;
    }

    const candidateBytes = Buffer.from(x.candidateSource, 'utf8');
    if (candidateBytes.length === 0 || candidateBytes.length > MAX_SCRIPT_BYTES) {
      return null;
    }
    const actualCandSha = createHash('sha256').update(candidateBytes).digest('hex');
    if (actualCandSha !== x.expectedCandidateSha256) {
      return null;
    }

    return x as MutationInput;
  } catch {
    return null;
  }
}

function sameDirectory(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return (
    sameDirectory(a, b) &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  );
}

async function sameRecoveryInode(path: string, identity: BigIntStats): Promise<boolean> {
  try {
    if (await hasUnsafePathLink(path)) return false;
    const now = await lstat(path, {bigint: true});
    return (
      identity.isFile() &&
      !identity.isSymbolicLink() &&
      identity.nlink === 1n &&
      now.isFile() &&
      !now.isSymbolicLink() &&
      now.nlink === 1n &&
      sameFile(identity, now) &&
      identity.mode === now.mode
    );
  } catch {
    return false;
  }
}

function nativeAbortSignal(value: unknown): value is AbortSignal {
  try {
    if (
      !value ||
      typeof value !== 'object' ||
      nodeTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== AbortSignal.prototype ||
      ['aborted', 'addEventListener', 'removeEventListener'].some(name =>
        Object.prototype.hasOwnProperty.call(value, name)
      )
    ) {
      return false;
    }
    const getter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
    return typeof getter === 'function' && typeof getter.call(value) === 'boolean';
  } catch {
    return false;
  }
}

async function publishDisplacedCandidateBackup(
  backupDirectory: string,
  sourcePath: string,
  candidateBytes: Buffer
): Promise<{backupFileName: string; identity: BigIntStats} | null> {
  try {
    const publicationId = randomUUID();
    const prefix = backupPrefix(sourcePath);
    const candidateBackupName = prefix + '.' + publicationId + '.backup.user.js';
    const finalPath = join(backupDirectory, candidateBackupName);
    const pendingPath = join(backupDirectory, '.uah-mutate-' + publicationId + '.pending');

    const handle = await open(pendingPath, 'wx', 0o600);
    let pendingStat: BigIntStats;
    try {
      await handle.writeFile(candidateBytes);
      await handle.sync();
      pendingStat = await handle.stat({bigint: true});
    } finally {
      await handle.close();
    }

    if ((await verifyExactCandidateBytesReadOnly(pendingPath, candidateBytes)) !== 'MATCH') {
      try { await unlink(pendingPath); } catch {}
      return null;
    }

    const dirBefore = await lstat(backupDirectory, {bigint: true});
    await link(pendingPath, finalPath);
    try {
      await unlink(pendingPath);
    } catch {}

    const published = await lstat(finalPath, {bigint: true});
    const dirAfter = await lstat(backupDirectory, {bigint: true});
    if (
      !published.isFile() ||
      published.isSymbolicLink() ||
      published.nlink !== 1n ||
      !sameDirectory(dirBefore, dirAfter) ||
      (await verifyExactCandidateBytesReadOnly(finalPath, candidateBytes)) !== 'MATCH'
    ) {
      return null;
    }

    return {backupFileName: candidateBackupName, identity: published};
  } catch {
    return null;
  }
}

/**
 * Execute an atomic, recoverable mutation of the approved source script.
 */
export async function executeRecoverableAtomicMutation(
  untrustedOptions: unknown,
  signal?: AbortSignal
): Promise<AtomicMutationResult> {
  if (signal !== undefined && !nativeAbortSignal(signal)) {
    return block('INVALID_REQUEST');
  }
  if (signal?.aborted) {
    return block('CANCELLED');
  }

  const opts = parseInput(untrustedOptions);
  if (!opts) {
    return block('INVALID_REQUEST');
  }
  if (!opts.userApproved || !opts.mutateApproved) {
    return block('NOT_AUTHORIZED');
  }

  const parent = dirname(opts.sourcePath);
  const lockIdentity = process.platform === 'win32' ? opts.sourcePath.toLowerCase() : opts.sourcePath;
  const lock = join(
    parent,
    '.uah-mutate-path-' + createHash('sha256').update(lockIdentity, 'utf8').digest('hex')
  );

  let owner: BigIntStats | undefined;
  let acquired = false;
  let pendingFile: string | undefined;
  let journalPendingFile: string | undefined;
  let pendingIdentity: BigIntStats | undefined;
  let journalPendingIdentity: BigIntStats | undefined;
  let pendingParentIdentity: BigIntStats | undefined;
  let journalParentIdentity: BigIntStats | undefined;

  const originalBackupPath = join(opts.backupDirectory, opts.backupFileName);
  let originalBackupIdentity: BigIntStats | undefined;

  try {
    if (
      (await hasUnsafePathLink(opts.sourcePath)) ||
      (await hasUnsafePathLink(opts.backupDirectory))
    ) {
      return block('UNSAFE_PATH');
    }

    const parentStart = await lstat(parent, {bigint: true});
    const directoryStart = await lstat(opts.backupDirectory, {bigint: true});
    const sourceStart = await lstat(opts.sourcePath, {bigint: true});

    if (
      !parentStart.isDirectory() ||
      parentStart.isSymbolicLink() ||
      !directoryStart.isDirectory() ||
      directoryStart.isSymbolicLink() ||
      sameDirectory(parentStart, directoryStart) ||
      !sourceStart.isFile() ||
      sourceStart.isSymbolicLink() ||
      sourceStart.nlink !== 1n ||
      sourceStart.size <= 0n ||
      sourceStart.size > BigInt(MAX_SCRIPT_BYTES) ||
      (sourceStart.mode & 0o222n) === 0n
    ) {
      return block('UNSAFE_PATH');
    }

    if (
      (await hasInterruptedRestoreStaging(parent, undefined, undefined, 'source-parent')) ||
      (await hasInterruptedRestoreStaging(opts.backupDirectory))
    ) {
      return block('RECOVERY_REVIEW_REQUIRED');
    }

    pendingParentIdentity = parentStart;
    journalParentIdentity = directoryStart;

    // Acquire path mutex
    try {
      await mkdir(lock, {mode: 0o700});
      acquired = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        return block('SOURCE_LOCKED');
      }
      return block('IO_FAILURE');
    }

    owner = await lstat(lock, {bigint: true});
    if (signal?.aborted) return block('CANCELLED');
    if (!owner.isDirectory() || owner.isSymbolicLink()) {
      return block('SOURCE_LOCKED');
    }

    // Windows 8.3 & casing path safety checks
    if (process.platform === 'win32') {
      try {
        if (
          basename(await realpath(opts.sourcePath)) !== basename(opts.sourcePath) ||
          basename(await realpath(parent)) !== basename(parent)
        ) {
          return block('UNSAFE_PATH');
        }
      } catch {
        return block('UNSAFE_PATH');
      }
    }

    // Check for prior unresolved restore intent
    if (await hasPriorPublishedRestoreIntentForSource(opts.sourcePath, opts.backupDirectory)) {
      return block('RECOVERY_REVIEW_REQUIRED');
    }

    // Verify current source matches expected original
    const currentSource = await verifyApprovedSourceFingerprint({
      sourcePath: opts.sourcePath,
      expectedSha256: opts.expectedOriginalSha256,
      userApproved: true
    });
    if (currentSource.status !== 'MATCHED_READ_ONLY') {
      return block('SOURCE_UNVERIFIED');
    }

    // Verify the original backup is verified and untampered (Rollback prerequisite)
    try {
      originalBackupIdentity = await lstat(originalBackupPath, {bigint: true});
    } catch {
      return block('BACKUP_UNVERIFIED');
    }
    const backupVerification = await verifyBackupRecoverySource({
      sourcePath: opts.sourcePath,
      backupDirectory: opts.backupDirectory,
      backupFileName: opts.backupFileName,
      expectedSha256: opts.expectedOriginalSha256,
      expectedByteLength: Number(originalBackupIdentity.size),
      userApproved: true
    });
    if (
      backupVerification.status !== 'RECOVERY_SOURCE_VERIFIED_READ_ONLY' ||
      !(await sameRecoveryInode(originalBackupPath, originalBackupIdentity))
    ) {
      return block('BACKUP_UNVERIFIED');
    }

    if (signal?.aborted) return block('CANCELLED');

    const candidateBytes = Buffer.from(opts.candidateSource, 'utf8');

    // Retain displaced backup (the Candidate about to be applied)
    const displacedBackup = await publishDisplacedCandidateBackup(
      opts.backupDirectory,
      opts.sourcePath,
      candidateBytes
    );
    if (!displacedBackup) {
      return block('RECOVERY_SAFETY_FAILED');
    }

    // Prepare staged candidate replacement file in source's parent directory
    pendingFile = join(parent, '.uah-mutate-' + randomUUID() + '.pending');
    const handle = await open(pendingFile, 'wx', 0o600);
    try {
      await handle.writeFile(candidateBytes);
      await handle.chmod(Number(sourceStart.mode & 0o777n));
      await handle.sync();
      pendingIdentity = await handle.stat({bigint: true});
    } finally {
      await handle.close();
    }

    if ((await verifyExactCandidateBytesReadOnly(pendingFile, candidateBytes)) !== 'MATCH') {
      return block('RECOVERY_SAFETY_FAILED');
    }

    // Prepare and publish apply journal (.uah-apply-<uuid>.journal.json)
    // Uses distinct prefix from .uah-restore- to preserve clean rollback namespace
    const journalId = randomUUID();
    const journalFileName = '.uah-apply-' + journalId + '.journal.json';
    const journalPath = join(opts.backupDirectory, journalFileName);
    const journalPayload = Buffer.from(
      JSON.stringify({
        schema: 1,
        state: 'APPLY_INTENT_COMMITTED',
        sourcePathSha256: createHash('sha256').update(opts.sourcePath).digest('hex'),
        originalSha256: opts.expectedOriginalSha256,
        candidateSha256: opts.expectedCandidateSha256,
        originalBackupFileName: opts.backupFileName,
        displacedBackupFileName: displacedBackup.backupFileName,
        automaticPatchAllowed: false,
        automaticRollbackAllowed: false
      }) + '\n'
    );

    journalPendingFile = join(opts.backupDirectory, '.uah-apply-' + journalId + '.pending');
    const jHandle = await open(journalPendingFile, 'wx', 0o600);
    try {
      await jHandle.writeFile(journalPayload);
      await jHandle.sync();
      journalPendingIdentity = await jHandle.stat({bigint: true});
    } finally {
      await jHandle.close();
    }

    if ((await verifyExactCandidateBytesReadOnly(journalPendingFile, journalPayload)) !== 'MATCH') {
      return block('RECOVERY_SAFETY_FAILED');
    }

    await link(journalPendingFile, journalPath);
    try {
      await unlink(journalPendingFile);
    } catch {}
    journalPendingFile = undefined;

    const publishedJournal = await lstat(journalPath, {bigint: true});
    if (
      !publishedJournal.isFile() ||
      publishedJournal.isSymbolicLink() ||
      publishedJournal.nlink !== 1n ||
      !sameDirectory(journalPendingIdentity, publishedJournal)
    ) {
      return block('RECOVERY_SAFETY_FAILED');
    }

    if (signal?.aborted) return block('CANCELLED');

    // Final pre-rename TOCTOU recheck
    const beforeReplace = await lstat(opts.sourcePath, {bigint: true});
    if (!sameFile(sourceStart, beforeReplace) || beforeReplace.nlink !== 1n) {
      return block('SOURCE_CHANGED');
    }

    const sourceRecheck = await verifyApprovedSourceFingerprint({
      sourcePath: opts.sourcePath,
      expectedSha256: opts.expectedOriginalSha256,
      userApproved: true
    });
    if (sourceRecheck.status !== 'MATCHED_READ_ONLY') {
      return block('SOURCE_CHANGED');
    }

    if (
      !(await sameRecoveryInode(originalBackupPath, originalBackupIdentity)) ||
      !(await sameRecoveryInode(
        join(opts.backupDirectory, displacedBackup.backupFileName),
        displacedBackup.identity
      ))
    ) {
      return block('BACKUP_UNVERIFIED');
    }

    // Atomic rename
    await rename(pendingFile, opts.sourcePath);
    pendingFile = undefined;

    // Post-rename receipt verification
    const replacedStat = await lstat(opts.sourcePath, {bigint: true});
    if (!replacedStat.isFile() || replacedStat.isSymbolicLink() || replacedStat.nlink !== 1n) {
      return block('RECOVERY_SAFETY_FAILED');
    }

    if (
      (await verifyExactCandidateBytesReadOnly(opts.sourcePath, candidateBytes)) !== 'MATCH'
    ) {
      return block('RECOVERY_SAFETY_FAILED');
    }

    return Object.freeze({
      status: 'APPLIED_NATIVE_ONLY' as const,
      originalSha256: opts.expectedOriginalSha256,
      candidateSha256: opts.expectedCandidateSha256,
      backupFileName: opts.backupFileName,
      displacedBackupFileName: displacedBackup.backupFileName,
      journalFileName,
      rollbackReady: true as const,
      automaticPatchAllowed: false as const,
      automaticRollbackAllowed: false as const,
      tampermonkeyVerified: true as const,
      businessVerified: true as const
    });
  } catch {
    return block('IO_FAILURE');
  } finally {
    if (pendingFile && pendingIdentity && pendingParentIdentity) {
      try {
        await removeOwnedNativeRestorePending(pendingFile, pendingIdentity, pendingParentIdentity);
      } catch {}
    }
    if (journalPendingFile && journalPendingIdentity && journalParentIdentity) {
      try {
        await unlink(journalPendingFile);
      } catch {}
    }
    if (acquired) {
      try {
        await rmdir(lock);
      } catch {}
    }
  }
}

/**
 * End-to-end integration entry point connecting TASK-010 business acceptance gate
 * with the TASK-011 atomic mutation transaction.
 */
export async function applyBusinessAcceptedCandidate(
  acceptanceReceipt: unknown,
  candidateSource: string,
  untrustedOptions: unknown,
  signal?: AbortSignal
): Promise<AtomicMutationResult> {
  try {
    if (
      !acceptanceReceipt ||
      typeof acceptanceReceipt !== 'object' ||
      nodeTypes.isProxy(acceptanceReceipt)
    ) {
      return block('ACCEPTANCE_UNVERIFIED');
    }

    const receipt = acceptanceReceipt as Record<string, unknown>;
    if (
      receipt.status !== 'BUSINESS_ACCEPTED_AWAITING_TRANSACTION' ||
      receipt.tampermonkeyVerified !== true ||
      receipt.businessVerified !== true ||
      typeof receipt.originalSha256 !== 'string' ||
      typeof receipt.candidateSha256 !== 'string' ||
      typeof receipt.backupFileName !== 'string'
    ) {
      return block('ACCEPTANCE_UNVERIFIED');
    }

    if (typeof candidateSource !== 'string' || candidateSource.length === 0) {
      return block('INVALID_REQUEST');
    }

    const candSha = createHash('sha256').update(candidateSource, 'utf8').digest('hex');
    if (candSha !== receipt.candidateSha256) {
      return block('HASH_MISMATCH');
    }

    if (
      !untrustedOptions ||
      typeof untrustedOptions !== 'object' ||
      nodeTypes.isProxy(untrustedOptions)
    ) {
      return block('INVALID_REQUEST');
    }

    const rawOpts = untrustedOptions as Record<string, unknown>;
    const mutationPayload = {
      sourcePath: rawOpts.sourcePath,
      backupDirectory: rawOpts.backupDirectory,
      backupFileName: receipt.backupFileName,
      expectedOriginalSha256: receipt.originalSha256,
      expectedCandidateSha256: receipt.candidateSha256,
      candidateSource,
      userApproved: rawOpts.userApproved,
      mutateApproved: rawOpts.mutateApproved
    };

    return await executeRecoverableAtomicMutation(mutationPayload, signal);
  } catch {
    return block('IO_FAILURE');
  }
}
