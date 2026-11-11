/**
 * TASK-012 · REQ-023 · TEST-023.
 *
 * Verification tests for userscript export and manager version-state separation.
 */
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {evaluateManagerVersionState} from '../../src/export/manager-version-state';

const origSha = '1'.repeat(64);
const candSha = '2'.repeat(64);

const validExportReceipt = Object.freeze({
  status: 'EXPORTED_RUNTIME_UNVERIFIED' as const,
  exportFileName: 'candidate.user.js',
  recoveryExportFileName: 'original.user.js',
  candidateSha256: candSha,
  byteLength: 1024,
  automaticPatchAllowed: false as const,
  automaticRollbackAllowed: false as const,
  tampermonkeyVerified: false as const,
  managerInstalled: false as const,
  businessVerified: false as const
});

test('TASK-012/TEST-023: distinct on-disk export without manager probe reports uninstalled', () => {
  const result = evaluateManagerVersionState(
    validExportReceipt,
    null,
    {userApproved: true}
  );

  assert.equal(result.status, 'DISK_EXPORT_ONLY_NOT_INSTALLED');
  assert.equal(result.managerInstalled, false);
  assert.equal(result.tampermonkeyVerified, false);
  assert.equal(result.automaticInstallAllowed, false);
  assert.equal(result.automaticPatchAllowed, false);
  assert.equal(result.automaticRollbackAllowed, false);
});

test('TASK-012/TEST-023: manager probe with original script confirms original still active', () => {
  const probeEvidence = Object.freeze({
    status: 'REAL_MANAGER_RUNTIME_OBSERVATION' as const,
    activeScriptSha256: origSha,
    injected: true,
    gmApiVerified: true,
    observedAt: '2026-11-11T20:00:00Z'
  });

  const result = evaluateManagerVersionState(
    validExportReceipt,
    probeEvidence,
    {userApproved: true}
  );

  assert.equal(result.status, 'ORIGINAL_STILL_ACTIVE');
  if (result.status === 'ORIGINAL_STILL_ACTIVE') {
    assert.equal(result.activeVersionSha256, origSha);
    assert.equal(result.candidateSha256, candSha);
    assert.equal(result.managerInstalled, false);
    assert.equal(result.tampermonkeyVerified, true);
  }
});

test('TASK-012/TEST-023: manager probe with candidate script confirms candidate installed and verified', () => {
  const probeEvidence = Object.freeze({
    status: 'REAL_MANAGER_RUNTIME_OBSERVATION' as const,
    activeScriptSha256: candSha,
    injected: true,
    gmApiVerified: true,
    observedAt: '2026-11-11T20:05:00Z'
  });

  const result = evaluateManagerVersionState(
    validExportReceipt,
    probeEvidence,
    {userApproved: true}
  );

  assert.equal(result.status, 'CANDIDATE_INSTALLED_AND_VERIFIED');
  if (result.status === 'CANDIDATE_INSTALLED_AND_VERIFIED') {
    assert.equal(result.installedVersionSha256, candSha);
    assert.equal(result.managerInstalled, true);
    assert.equal(result.tampermonkeyVerified, true);
  }
});

test('TASK-012/TEST-023: unconsented request is blocked', () => {
  const result = evaluateManagerVersionState(
    validExportReceipt,
    null,
    {userApproved: false}
  );

  assert.equal(result.status, 'BLOCKED');
  if (result.status === 'BLOCKED') {
    assert.equal(result.reason, 'NOT_AUTHORIZED');
  }
});

test('TASK-012/TEST-023: Proxy inputs are blocked without invoking traps', () => {
  let trapTriggered = false;
  const proxiedReceipt = new Proxy(validExportReceipt, {
    get(target, prop, receiver) {
      trapTriggered = true;
      return Reflect.get(target, prop, receiver);
    }
  });

  const result = evaluateManagerVersionState(
    proxiedReceipt,
    null,
    {userApproved: true}
  );

  assert.equal(result.status, 'BLOCKED');
  if (result.status === 'BLOCKED') {
    assert.equal(result.reason, 'EXPORT_RECEIPT_INVALID');
  }
  assert.equal(trapTriggered, false, 'Proxy trap must never execute');
});

test('TASK-012/TEST-023: invalid probe evidence fails closed', () => {
  const malformedProbe = {
    status: 'REAL_MANAGER_RUNTIME_OBSERVATION',
    activeScriptSha256: 'invalid-sha',
    injected: false,
    gmApiVerified: false,
    observedAt: 'bad-date'
  };

  const result = evaluateManagerVersionState(
    validExportReceipt,
    malformedProbe,
    {userApproved: true}
  );

  assert.equal(result.status, 'BLOCKED');
  if (result.status === 'BLOCKED') {
    assert.equal(result.reason, 'PROBE_EVIDENCE_INVALID');
  }
});
