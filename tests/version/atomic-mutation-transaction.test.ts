/**
 * TASK-011 · REQ-020/021 · TEST-020/021/026.
 *
 * Comprehensive tests for recoverable atomic candidate mutation transaction
 * and end-to-end rollback loop.
 */
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash, randomUUID} from 'node:crypto';
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join} from 'node:path';
import {
  executeRecoverableAtomicMutation,
  applyBusinessAcceptedCandidate
} from '../../src/version/atomic-mutation-transaction';
import {createVerifiedBackupOnly} from '../../src/version/verified-backup';
import {restoreVerifiedOriginalNativeOnly} from '../../src/version/native-restore-transaction';
import {inspectNativeRestoreIntentReadOnly} from '../../src/version/restore-intent-inspection';

const originalSource = Buffer.from(
  '// ==UserScript==\n// @name FaultyScript\n// @match *://*/*\n// ==/UserScript==\nconst el = document.querySelector("#broken");\n'
);

const candidateSource = Buffer.from(
  '// ==UserScript==\n// @name FaultyScript\n// @match *://*/*\n// ==/UserScript==\nconst el = document.querySelector("#healed");\n'
);

function sha256(b: Buffer | string): string {
  return createHash('sha256').update(b).digest('hex');
}

async function withFixture(
  fn: (ctx: {
    root: string;
    sourcePath: string;
    backupDir: string;
    backupFileName: string;
    origSha: string;
    candSha: string;
  }) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'uah-mutate-test-'));
  try {
    const sourcePath = join(root, 'test-target.user.js');
    const backupDir = join(root, 'backups');
    await mkdir(backupDir, {recursive: true});
    await writeFile(sourcePath, originalSource);

    const origSha = sha256(originalSource);
    const candSha = sha256(candidateSource);

    const backupResult = await createVerifiedBackupOnly({
      sourcePath,
      backupDirectory: backupDir,
      expectedSha256: origSha,
      userApproved: true
    });
    assert.equal(backupResult.status, 'BACKUP_ONLY');
    if (backupResult.status !== 'BACKUP_ONLY') return;

    await fn({
      root,
      sourcePath,
      backupDir,
      backupFileName: backupResult.backupFileName,
      origSha,
      candSha
    });
  } finally {
    await rm(root, {recursive: true, force: true});
  }
}

test('TASK-011/TEST-020/021: end-to-end atomic candidate mutation and subsequent full rollback', async () => {
  await withFixture(async ({sourcePath, backupDir, backupFileName, origSha, candSha}) => {
    // 1. Simulate verified acceptance receipt from TASK-010
    const acceptanceReceipt = Object.freeze({
      status: 'BUSINESS_ACCEPTED_AWAITING_TRANSACTION' as const,
      originalSha256: origSha,
      candidateSha256: candSha,
      backupFileName,
      faultEvidenceId: 'fault-evt-12345',
      automaticPatchAllowed: false as const,
      automaticRollbackAllowed: false as const,
      tampermonkeyVerified: true as const,
      businessVerified: true as const
    });

    // 2. Apply business-accepted candidate
    const applyResult = await applyBusinessAcceptedCandidate(
      acceptanceReceipt,
      candidateSource.toString('utf8'),
      {
        sourcePath,
        backupDirectory: backupDir,
        userApproved: true,
        mutateApproved: true
      }
    );

    assert.equal(applyResult.status, 'APPLIED_NATIVE_ONLY');
    if (applyResult.status !== 'APPLIED_NATIVE_ONLY') return;

    assert.equal(applyResult.rollbackReady, true);
    assert.equal(applyResult.originalSha256, origSha);
    assert.equal(applyResult.candidateSha256, candSha);
    assert.equal(applyResult.automaticPatchAllowed, false);
    assert.equal(applyResult.automaticRollbackAllowed, false);
    assert.equal(applyResult.tampermonkeyVerified, true);
    assert.equal(applyResult.businessVerified, true);

    // Verify source on disk now contains candidate bytes
    const onDiskAfterApply = await readFile(sourcePath);
    assert.equal(sha256(onDiskAfterApply), candSha);

    // 3. Perform full rollback to original using restoreVerifiedOriginalNativeOnly
    const rollbackResult = await restoreVerifiedOriginalNativeOnly({
      sourcePath,
      backupDirectory: backupDir,
      backupFileName,
      expectedCurrentSha256: candSha,
      expectedOriginalSha256: origSha,
      expectedOriginalByteLength: originalSource.length,
      userApproved: true,
      manualRestoreApproved: true
    });

    assert.equal(rollbackResult.status, 'RESTORED_NATIVE_ONLY');
    if (rollbackResult.status !== 'RESTORED_NATIVE_ONLY') return;

    // Verify source on disk is restored to exact original bytes
    const onDiskAfterRollback = await readFile(sourcePath);
    assert.equal(sha256(onDiskAfterRollback), origSha);
    assert.deepEqual(onDiskAfterRollback, originalSource);

    // 4. Inspect rollback's restore intent journal; must observe ORIGINAL_PRESENT
    const intentObsAfter = await inspectNativeRestoreIntentReadOnly({
      sourcePath,
      backupDirectory: backupDir,
      journalFileName: rollbackResult.journalFileName,
      userApproved: true
    });
    assert.equal(intentObsAfter.status, 'RESTORE_INTENT_OBSERVED_READ_ONLY');
    if (intentObsAfter.status === 'RESTORE_INTENT_OBSERVED_READ_ONLY') {
      assert.equal(intentObsAfter.sourceState, 'ORIGINAL_PRESENT');
    }
  });
});

test('TASK-011/TEST-020: rejects mutation when user consent is absent', async () => {
  await withFixture(async ({sourcePath, backupDir, backupFileName, origSha, candSha}) => {
    const result = await executeRecoverableAtomicMutation({
      sourcePath,
      backupDirectory: backupDir,
      backupFileName,
      expectedOriginalSha256: origSha,
      expectedCandidateSha256: candSha,
      candidateSource: candidateSource.toString('utf8'),
      userApproved: false,
      mutateApproved: true
    });
    assert.equal(result.status, 'BLOCKED');
    if (result.status === 'BLOCKED') {
      assert.equal(result.reason, 'NOT_AUTHORIZED');
    }
  });
});

test('TASK-011/TEST-020: rejects hostile Proxy and accessor inputs', async () => {
  await withFixture(async ({sourcePath, backupDir, backupFileName, origSha, candSha}) => {
    let trapTriggered = false;
    const proxiedInput = new Proxy(
      {
        sourcePath,
        backupDirectory: backupDir,
        backupFileName,
        expectedOriginalSha256: origSha,
        expectedCandidateSha256: candSha,
        candidateSource: candidateSource.toString('utf8'),
        userApproved: true,
        mutateApproved: true
      },
      {
        get(target, prop, receiver) {
          trapTriggered = true;
          return Reflect.get(target, prop, receiver);
        }
      }
    );

    const result = await executeRecoverableAtomicMutation(proxiedInput);
    assert.equal(result.status, 'BLOCKED');
    if (result.status === 'BLOCKED') {
      assert.equal(result.reason, 'INVALID_REQUEST');
    }
    assert.equal(trapTriggered, false, 'Proxy trap must never execute');
  });
});

test('TASK-011/TEST-020: fails closed when current source is modified externally (TOCTOU protection)', async () => {
  await withFixture(async ({sourcePath, backupDir, backupFileName, origSha, candSha}) => {
    // External editor modifies the source before mutation transaction
    await writeFile(sourcePath, '// externally changed content\n');

    const result = await executeRecoverableAtomicMutation({
      sourcePath,
      backupDirectory: backupDir,
      backupFileName,
      expectedOriginalSha256: origSha,
      expectedCandidateSha256: candSha,
      candidateSource: candidateSource.toString('utf8'),
      userApproved: true,
      mutateApproved: true
    });

    assert.equal(result.status, 'BLOCKED');
    if (result.status === 'BLOCKED') {
      assert.equal(result.reason, 'SOURCE_UNVERIFIED');
    }

    // Verify source was not corrupted
    const content = await readFile(sourcePath, 'utf8');
    assert.equal(content, '// externally changed content\n');
  });
});

test('TASK-011/TEST-020: fails closed when backup is missing or corrupted', async () => {
  await withFixture(async ({sourcePath, backupDir, origSha, candSha}) => {
    const result = await executeRecoverableAtomicMutation({
      sourcePath,
      backupDirectory: backupDir,
      backupFileName: 'non-existent.backup.user.js',
      expectedOriginalSha256: origSha,
      expectedCandidateSha256: candSha,
      candidateSource: candidateSource.toString('utf8'),
      userApproved: true,
      mutateApproved: true
    });

    assert.equal(result.status, 'BLOCKED');
    if (result.status === 'BLOCKED') {
      assert.equal(result.reason, 'BACKUP_UNVERIFIED');
    }

    // Verify original source remains intact
    const content = await readFile(sourcePath);
    assert.deepEqual(content, originalSource);
  });
});

test('TASK-011/TEST-020: candidate hash mismatch rejects mutation', async () => {
  await withFixture(async ({sourcePath, backupDir, backupFileName, origSha}) => {
    const result = await executeRecoverableAtomicMutation({
      sourcePath,
      backupDirectory: backupDir,
      backupFileName,
      expectedOriginalSha256: origSha,
      expectedCandidateSha256: 'a'.repeat(64), // deliberately wrong SHA
      candidateSource: candidateSource.toString('utf8'),
      userApproved: true,
      mutateApproved: true
    });

    assert.equal(result.status, 'BLOCKED');
    if (result.status === 'BLOCKED') {
      assert.equal(result.reason, 'INVALID_REQUEST');
    }
  });
});

test('TASK-011/TEST-020: abort signal cancels transaction cleanly', async () => {
  await withFixture(async ({sourcePath, backupDir, backupFileName, origSha, candSha}) => {
    const controller = new AbortController();
    controller.abort();

    const result = await executeRecoverableAtomicMutation(
      {
        sourcePath,
        backupDirectory: backupDir,
        backupFileName,
        expectedOriginalSha256: origSha,
        expectedCandidateSha256: candSha,
        candidateSource: candidateSource.toString('utf8'),
        userApproved: true,
        mutateApproved: true
      },
      controller.signal
    );

    assert.equal(result.status, 'BLOCKED');
    if (result.status === 'BLOCKED') {
      assert.equal(result.reason, 'CANCELLED');
    }

    // Verify original source untouched
    const content = await readFile(sourcePath);
    assert.deepEqual(content, originalSource);
  });
});
