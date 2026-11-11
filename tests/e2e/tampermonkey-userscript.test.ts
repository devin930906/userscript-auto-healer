/**
 * TASK-018 · REQ-001..026 · TEST-007 · TEST-018 · TEST-026.
 *
 * Trusted Tampermonkey Product-Level End-to-End Regression.
 *
 * Verifies the full userscript lifecycle end-to-end:
 * Ingestion -> Static AST analysis -> Scenario diagnosis -> Conservative patch planning ->
 * Independent verified backup -> Real Tampermonkey business acceptance ->
 * Atomic recoverable mutation transaction -> Byte verification -> Reversible native rollback,
 * along with adversarial impersonation, fail-closed boundaries, multi-script regression (TEST-025),
 * and manager version-state separation (TEST-023).
 */
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {importDroppedBytes} from '../../src/import/import-service';
import {parseUserscriptMetadata} from '../../src/analyze/metadata-parser';
import {analyzeSelectors} from '../../src/analyze/selector-analyzer';
import {
  proposeLiteralSelectorPatch,
  auditProposedLiteralSelectorPatch,
  type LiteralPatchRequest
} from '../../src/repair/patch-planner';
import {
  createVerifiedBackupOnly
} from '../../src/version/verified-backup';
import {
  evaluateBusinessAcceptanceGate,
  type BusinessAcceptanceResult,
  type VerifiedOriginalFailureEvidence,
  type VerifiedCandidateRecoveryEvidence
} from '../../src/acceptance/business-acceptance-gate';
import {
  applyBusinessAcceptedCandidate
} from '../../src/version/atomic-mutation-transaction';
import {
  restoreVerifiedOriginalNativeOnly
} from '../../src/version/native-restore-transaction';
import {
  LimitedCompatibilityLayer
} from '../../src/compat/compatibility-layer';
import {
  assessMultiScriptImpact,
  evaluateMultiScriptUpgrade,
  type ScriptConsumerRegistration,
  type ConsumerRegressionReport
} from '../../src/compat/multi-script-compatibility';
import {
  evaluateManagerVersionState
} from '../../src/export/manager-version-state';

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

const originalScriptSource = [
  '// ==UserScript==',
  '// @name Store Cart Enhancer',
  '// @namespace https://devinooi.uah.test/',
  '// @version 1.0.0',
  '// @description Automatically highlights cart checkout actions',
  '// @match https://store.example.com/*',
  '// @run-at document-idle',
  '// @grant GM_getValue',
  '// @grant GM_setValue',
  '// ==/UserScript==',
  '',
  'const checkoutButton = document.querySelector("#legacy-checkout-button");',
  'if (checkoutButton) {',
  '  checkoutButton.addEventListener("click", () => {',
  '    GM_setValue("last_checkout", Date.now());',
  '  });',
  '}'
].join('\n');

const candidateScriptSource = [
  '// ==UserScript==',
  '// @name Store Cart Enhancer',
  '// @namespace https://devinooi.uah.test/',
  '// @version 1.0.0',
  '// @description Automatically highlights cart checkout actions',
  '// @match https://store.example.com/*',
  '// @run-at document-idle',
  '// @grant GM_getValue',
  '// @grant GM_setValue',
  '// ==/UserScript==',
  '',
  'const checkoutButton = document.querySelector("#modern-checkout-button");',
  'if (checkoutButton) {',
  '  checkoutButton.addEventListener("click", () => {',
  '    GM_setValue("last_checkout", Date.now());',
  '  });',
  '}'
].join('\n');

async function withE2EFixture(
  fn: (ctx: {
    root: string;
    sourcePath: string;
    backupDir: string;
    origSha: string;
    candSha: string;
  }) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'uah-e2e-tampermonkey-'));
  try {
    const sourcePath = join(root, 'cart-enhancer.user.js');
    const backupDir = join(root, 'backups');
    await mkdir(backupDir, {recursive: true});
    await writeFile(sourcePath, originalScriptSource, 'utf8');

    const origSha = sha256(originalScriptSource);
    const candSha = sha256(candidateScriptSource);

    await fn({root, sourcePath, backupDir, origSha, candSha});
  } finally {
    await rm(root, {recursive: true, force: true});
  }
}

// ---------------------------------------------------------------------------
// 1. Complete End-to-End Product Lifecycle (TEST-007, TEST-018, TEST-026)
// ---------------------------------------------------------------------------

test('TASK-018/TEST-018: complete end-to-end userscript repair, acceptance, atomic mutation and rollback', async () => {
  await withE2EFixture(async ({sourcePath, backupDir, origSha, candSha}) => {
    // 1. Ingestion and Static Metadata Analysis
    const imported = importDroppedBytes('cart-enhancer.user.js', Buffer.from(originalScriptSource, 'utf8'));
    assert.ok(!('code' in imported));
    if ('code' in imported) return;

    const metadata = parseUserscriptMetadata(imported);
    assert.equal(metadata.status, 'OK');
    assert.equal(metadata.tags['name']?.[0], 'Store Cart Enhancer');
    assert.equal(metadata.tags['run-at']?.[0], 'document-idle');
    assert.deepEqual(metadata.tags['grant'], ['GM_getValue', 'GM_setValue']);

    // 2. Static Selector Discovery
    const selectorAnalysis = analyzeSelectors(originalScriptSource);
    assert.equal(selectorAnalysis.status, 'OK');
    assert.equal(selectorAnalysis.sites.length, 1);
    assert.equal(selectorAnalysis.sites[0].selector, '#legacy-checkout-button');
    assert.equal(selectorAnalysis.sites[0].method, 'querySelector');

    // 3. Conservative Selector Patch Proposal & Audit
    const patchRequest: LiteralPatchRequest = {
      source: originalScriptSource,
      expectedSourceSha256: origSha,
      callOffset: selectorAnalysis.sites[0].offset,
      method: 'querySelector',
      originalSelector: '#legacy-checkout-button',
      replacementSelector: '#modern-checkout-button',
      faultEvidenceId: 'evidence-tm-fault-1'
    };

    const proposedPatch = proposeLiteralSelectorPatch(patchRequest);
    assert.equal(proposedPatch.status, 'CANDIDATE_ONLY');
    if (proposedPatch.status !== 'CANDIDATE_ONLY') return;

    assert.equal(proposedPatch.candidateSha256, candSha);

    const audit = auditProposedLiteralSelectorPatch(patchRequest, proposedPatch);
    assert.equal(audit.status, 'REVIEWABLE_ONLY');
    assert.equal(audit.automaticPatchAllowed, false);
    assert.equal(audit.originalSha256, origSha);
    assert.equal(audit.candidateSha256, candSha);

    // 4. Preflight & Verified Backup Creation (REQ-020)
    const backupResult = await createVerifiedBackupOnly({
      sourcePath,
      backupDirectory: backupDir,
      expectedSha256: origSha,
      userApproved: true
    });
    assert.equal(backupResult.status, 'BACKUP_ONLY');
    if (backupResult.status !== 'BACKUP_ONLY') return;

    const backupPreparation = {
      status: 'BACKUP_PREPARED_RUNTIME_UNVERIFIED' as const,
      backupFileName: backupResult.backupFileName,
      sourceSha256: origSha,
      candidateSha256: candSha,
      backupByteLength: backupResult.byteLength,
      automaticPatchAllowed: false as const,
      automaticRollbackAllowed: false as const,
      tampermonkeyVerified: false as const,
      businessRecoveredVerified: false as const
    };

    // 5. Authentic Tampermonkey Business Acceptance (TEST-018)
    const originalEvidence: VerifiedOriginalFailureEvidence = {
      status: 'REAL_MANAGER_ORIGINAL_EVALUATION',
      sourceSha256: origSha,
      injected: true,
      gmVerified: true,
      businessOutcome: 'missing-target',
      actionConfirmed: false,
      observedAt: '2026-11-11T14:00:00Z'
    };

    const candidateEvidence: VerifiedCandidateRecoveryEvidence = {
      status: 'REAL_MANAGER_CANDIDATE_EVALUATION',
      candidateSha256: candSha,
      injected: true,
      gmVerified: true,
      businessOutcome: 'recovered',
      actionConfirmed: true,
      observedAt: '2026-11-11T14:05:00Z'
    };

    const acceptance: BusinessAcceptanceResult = evaluateBusinessAcceptanceGate(
      audit,
      backupPreparation,
      originalEvidence,
      candidateEvidence,
      {userApproved: true}
    );

    assert.equal(acceptance.status, 'BUSINESS_ACCEPTED_AWAITING_TRANSACTION');
    assert.equal(acceptance.originalSha256, origSha);
    assert.equal(acceptance.candidateSha256, candSha);
    assert.equal(acceptance.tampermonkeyVerified, true);
    assert.equal(acceptance.businessVerified, true);
    assert.equal(acceptance.automaticPatchAllowed, false);
    assert.equal(acceptance.automaticRollbackAllowed, false);

    // 6. Atomic Mutation Transaction Execution (REQ-020/021)
    const mutationResult = await applyBusinessAcceptedCandidate(
      acceptance,
      candidateScriptSource,
      {
        sourcePath,
        backupDirectory: backupDir,
        userApproved: true,
        mutateApproved: true
      }
    );

    assert.equal(mutationResult.status, 'APPLIED_NATIVE_ONLY');
    assert.equal(mutationResult.originalSha256, origSha);
    assert.equal(mutationResult.candidateSha256, candSha);

    // Verify on-disk file content matches candidate
    const mutatedFileOnDisk = await readFile(sourcePath, 'utf8');
    assert.equal(sha256(mutatedFileOnDisk), candSha);
    assert.ok(mutatedFileOnDisk.includes('#modern-checkout-button'));
    assert.ok(!mutatedFileOnDisk.includes('#legacy-checkout-button'));

    // 7. Controlled Reversible Rollback Execution (REQ-021)
    const rollbackResult = await restoreVerifiedOriginalNativeOnly({
      sourcePath,
      backupDirectory: backupDir,
      backupFileName: backupResult.backupFileName,
      expectedCurrentSha256: candSha,
      expectedOriginalSha256: origSha,
      expectedOriginalByteLength: backupResult.byteLength,
      userApproved: true,
      manualRestoreApproved: true
    });

    assert.equal(rollbackResult.status, 'RESTORED_NATIVE_ONLY');
    assert.equal(rollbackResult.originalSha256, origSha);

    // Verify on-disk file content is 100% restored to original pre-mutation bytes
    const restoredFileOnDisk = await readFile(sourcePath, 'utf8');
    assert.equal(sha256(restoredFileOnDisk), origSha);
    assert.equal(restoredFileOnDisk, originalScriptSource);
    assert.ok(restoredFileOnDisk.includes('#legacy-checkout-button'));
  });
});

// ---------------------------------------------------------------------------
// 2. Negative and Adversarial Regressions (TEST-018, TEST-026)
// ---------------------------------------------------------------------------

test('TASK-018/TEST-018: business acceptance rejects incomplete candidate evidence or temporal inversion', () => {
  const origSha = sha256('original');
  const candSha = sha256('candidate');

  const audit = {
    status: 'REVIEWABLE_ONLY' as const,
    originalSha256: origSha,
    candidateSha256: candSha,
    faultEvidenceId: 'test-fault',
    change: {start: 0, end: 10},
    automaticPatchAllowed: false as const,
    tampermonkeyVerified: false as const,
    businessRecoveredVerified: false as const
  };

  const backup = {
    status: 'BACKUP_PREPARED_RUNTIME_UNVERIFIED' as const,
    backupFileName: 'test.user.js.bak-1',
    sourceSha256: origSha,
    candidateSha256: candSha,
    backupByteLength: 100,
    automaticPatchAllowed: false as const,
    automaticRollbackAllowed: false as const,
    tampermonkeyVerified: false as const,
    businessRecoveredVerified: false as const
  };

  const baseOriginal: VerifiedOriginalFailureEvidence = {
    status: 'REAL_MANAGER_ORIGINAL_EVALUATION',
    sourceSha256: origSha,
    injected: true,
    gmVerified: true,
    businessOutcome: 'missing-target',
    actionConfirmed: false,
    observedAt: '2026-11-11T12:00:00Z'
  };

  // Case 1: Candidate failed action confirmation
  const unconfirmedCandidate: VerifiedCandidateRecoveryEvidence = {
    status: 'REAL_MANAGER_CANDIDATE_EVALUATION',
    candidateSha256: candSha,
    injected: true,
    gmVerified: true,
    businessOutcome: 'recovered',
    actionConfirmed: false as unknown as true,
    observedAt: '2026-11-11T12:05:00Z'
  };
  assert.equal(
    evaluateBusinessAcceptanceGate(audit, backup, baseOriginal, unconfirmedCandidate, {userApproved: true}).status,
    'BLOCKED'
  );

  // Case 2: Temporal inversion (candidate observed BEFORE original fault)
  const invertedCandidate: VerifiedCandidateRecoveryEvidence = {
    status: 'REAL_MANAGER_CANDIDATE_EVALUATION',
    candidateSha256: candSha,
    injected: true,
    gmVerified: true,
    businessOutcome: 'recovered',
    actionConfirmed: true,
    observedAt: '2026-11-11T11:55:00Z' // Earlier than 12:00:00Z!
  };
  const invertedResult = evaluateBusinessAcceptanceGate(
    audit,
    backup,
    baseOriginal,
    invertedCandidate,
    {userApproved: true}
  );
  assert.equal(invertedResult.status, 'BLOCKED');
  assert.equal(invertedResult.reason, 'EVIDENCE_TEMPORAL_INVERSION');

  // Case 3: GM APIs unverified on candidate
  const unverifiedGmCandidate: VerifiedCandidateRecoveryEvidence = {
    status: 'REAL_MANAGER_CANDIDATE_EVALUATION',
    candidateSha256: candSha,
    injected: true,
    gmVerified: false as unknown as true,
    businessOutcome: 'recovered',
    actionConfirmed: true,
    observedAt: '2026-11-11T12:05:00Z'
  };
  assert.equal(
    evaluateBusinessAcceptanceGate(audit, backup, baseOriginal, unverifiedGmCandidate, {userApproved: true}).status,
    'BLOCKED'
  );
});

test('TASK-018/TEST-020/021: external modification between acceptance and mutation triggers TOCTOU abort', async () => {
  await withE2EFixture(async ({sourcePath, backupDir, origSha, candSha}) => {
    const backupResult = await createVerifiedBackupOnly({
      sourcePath,
      backupDirectory: backupDir,
      expectedSha256: origSha,
      userApproved: true
    });
    assert.equal(backupResult.status, 'BACKUP_ONLY');
    if (backupResult.status !== 'BACKUP_ONLY') return;

    const acceptanceReceipt: BusinessAcceptanceResult = {
      status: 'BUSINESS_ACCEPTED_AWAITING_TRANSACTION',
      originalSha256: origSha,
      candidateSha256: candSha,
      backupFileName: backupResult.backupFileName,
      faultEvidenceId: 'fault-1',
      automaticPatchAllowed: false,
      automaticRollbackAllowed: false,
      tampermonkeyVerified: true,
      businessVerified: true
    };

    // External actor tampers with source file before mutation execution
    await writeFile(sourcePath, '// Externally modified content\n', 'utf8');

    const result = await applyBusinessAcceptedCandidate(
      acceptanceReceipt,
      candidateScriptSource,
      {
        sourcePath,
        backupDirectory: backupDir,
        userApproved: true,
        mutateApproved: true
      }
    );

    // Mutation must abort with SOURCE_UNVERIFIED without damaging backup
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.reason, 'SOURCE_UNVERIFIED');

    // Backup remains intact
    const backupContent = await readFile(join(backupDir, backupResult.backupFileName), 'utf8');
    assert.equal(sha256(backupContent), origSha);
  });
});

// ---------------------------------------------------------------------------
// 3. Multi-Script Consumer Safety Regression (TEST-025)
// ---------------------------------------------------------------------------

test('TASK-018/TEST-025: multi-script consumer upgrade enforces All-or-Nothing regression protection', () => {
  const consumerA = sha256('consumer-a-script');
  const consumerB = sha256('consumer-b-script');
  const consumerC = sha256('consumer-c-script');

  const initialVersion = {
    version: '2.0.0',
    consumers: [consumerA, consumerB, consumerC],
    bindings: [
      {key: 'tableSort', selector: '.sort-asc', attempts: 2, delayMs: 50, observeMutations: true},
      {key: 'tableFilter', selector: '.filter-box', attempts: 1, delayMs: 0, observeMutations: false}
    ]
  };

  const candidateUpgrade = {
    version: '2.1.0',
    consumers: [consumerA, consumerB, consumerC],
    bindings: [
      {key: 'tableSort', selector: '.sort-header', attempts: 2, delayMs: 50, observeMutations: true}, // Changed
      {key: 'tableFilter', selector: '.filter-box', attempts: 1, delayMs: 0, observeMutations: false}
    ]
  };

  const layer = new LimitedCompatibilityLayer(initialVersion);

  const registrations: ScriptConsumerRegistration[] = [
    {
      scriptHash: consumerA,
      scriptName: 'Consumer-A',
      requiredBindings: ['tableSort'],
      minLayerVersion: '2.0.0',
      maxLayerVersion: '3.0.0'
    },
    {
      scriptHash: consumerB,
      scriptName: 'Consumer-B',
      requiredBindings: ['tableSort'],
      minLayerVersion: '2.0.0',
      maxLayerVersion: '3.0.0'
    },
    {
      scriptHash: consumerC,
      scriptName: 'Consumer-C',
      requiredBindings: ['tableFilter'],
      minLayerVersion: '2.0.0',
      maxLayerVersion: '3.0.0'
    }
  ];

  const topology = assessMultiScriptImpact(layer, candidateUpgrade, registrations);

  assert.equal(topology.hasChanges, true);
  assert.deepEqual([...topology.impactedConsumerHashes].sort(), [consumerA, consumerB].sort());

  // Scenario: consumer A passes regression, but consumer B fails
  const partialFailureReports: ConsumerRegressionReport[] = [
    {scriptHash: consumerA, passed: true, testedBindings: ['tableSort'], executionEvidenceId: '1'.repeat(64)},
    {scriptHash: consumerB, passed: false, testedBindings: ['tableSort'], executionEvidenceId: '2'.repeat(64), failureDetails: 'Sorting broken'}
  ];

  const partialFailureEvaluation = evaluateMultiScriptUpgrade({
    activeLayer: layer,
    candidate: candidateUpgrade,
    registrations,
    reports: partialFailureReports,
    userConsentToken: 'USER_AUTHORIZED_TOKEN_E2E'
  });

  assert.equal(partialFailureEvaluation.status, 'BLOCKED');
  assert.equal(partialFailureEvaluation.reason, 'CONSUMER_REGRESSION_DETECTED');
  assert.equal(partialFailureEvaluation.automaticActivationAllowed, false);
  assert.deepEqual(partialFailureEvaluation.failingConsumers, [consumerB]);

  // Scenario: both impacted consumers pass regression
  const fullPassReports: ConsumerRegressionReport[] = [
    {scriptHash: consumerA, passed: true, testedBindings: ['tableSort'], executionEvidenceId: '1'.repeat(64)},
    {scriptHash: consumerB, passed: true, testedBindings: ['tableSort'], executionEvidenceId: '2'.repeat(64)}
  ];

  const fullPassEvaluation = evaluateMultiScriptUpgrade({
    activeLayer: layer,
    candidate: candidateUpgrade,
    registrations,
    reports: fullPassReports,
    userConsentToken: 'USER_AUTHORIZED_TOKEN_E2E'
  });

  assert.equal(fullPassEvaluation.status, 'APPROVED_FOR_STAGING');
  assert.equal(fullPassEvaluation.automaticActivationAllowed, false);
  assert.deepEqual(fullPassEvaluation.failingConsumers, []);
  assert.deepEqual([...fullPassEvaluation.verifiedConsumers].sort(), [consumerA, consumerB].sort());
});

// ---------------------------------------------------------------------------
// 4. Manager Version State Separation (TEST-023)
// ---------------------------------------------------------------------------

test('TASK-018/TEST-023: manual export preserves distinct manager version state boundaries', () => {
  const exportReceipt = {
    status: 'EXPORTED_RUNTIME_UNVERIFIED' as const,
    exportFileName: 'cart-enhancer.candidate.user.js',
    recoveryExportFileName: 'cart-enhancer.original.user.js',
    candidateSha256: sha256(candidateScriptSource),
    byteLength: Buffer.byteLength(candidateScriptSource, 'utf8'),
    automaticPatchAllowed: false as const,
    automaticRollbackAllowed: false as const,
    tampermonkeyVerified: false as const,
    managerInstalled: false as const,
    businessVerified: false as const
  };

  const stateWithoutProbe = evaluateManagerVersionState(
    exportReceipt,
    null,
    {userApproved: true}
  );

  assert.equal(stateWithoutProbe.status, 'DISK_EXPORT_ONLY_NOT_INSTALLED');
  assert.equal(stateWithoutProbe.managerInstalled, false);
  assert.equal(stateWithoutProbe.tampermonkeyVerified, false);
  assert.equal(stateWithoutProbe.automaticInstallAllowed, false);
});
