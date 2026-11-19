/**
 * TASK-012 · REQ-023 · TEST-023.
 *
 * Verification tests for userscript export and manager version-state separation.
 */
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {
  evaluateManagerVersionState,
  reconcileBatchImportedScriptsVersionState,
  launchBatchUserscriptInstallation
} from '../../src/export/manager-version-state';

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

test('TASK-012/TEST-023: reconcileBatchImportedScriptsVersionState identifies matched, diverged, and missing scripts', () => {
  const shaA = 'a'.repeat(64);
  const shaB = 'b'.repeat(64);
  const shaC = 'c'.repeat(64);
  const shaD = 'd'.repeat(64);

  const importedScripts = [
    {
      scriptId: 'script-1',
      name: 'Alpha Script',
      version: '1.0.0',
      sha256: shaA,
      installUrl: 'https://example.com/alpha.user.js',
      exportFileName: 'alpha.user.js'
    },
    {
      scriptId: 'script-2',
      name: 'Beta Script',
      version: '2.0.0',
      sha256: shaB,
      installUrl: 'https://example.com/beta.user.js'
    },
    {
      scriptId: 'script-3',
      name: 'Gamma Script',
      version: '1.5.0',
      sha256: shaC,
      installUrl: 'https://example.com/gamma.user.js'
    },
    {
      scriptId: 'script-4',
      name: 'Delta Script',
      version: '3.0.0',
      sha256: shaD,
      installUrl: 'https://example.com/delta.user.js'
    }
  ];

  const observations = [
    {
      scriptId: 'script-1',
      name: 'Alpha Script',
      version: '1.0.0',
      activeScriptSha256: shaA,
      injected: true,
      gmApiVerified: true
    },
    {
      scriptId: 'script-2',
      name: 'Beta Script',
      version: '1.9.0', // version diverged
      activeScriptSha256: 'e'.repeat(64),
      injected: true,
      gmApiVerified: true
    },
    {
      scriptId: 'script-3',
      name: 'Gamma Script',
      version: '1.5.0', // same version, hash diverged
      activeScriptSha256: 'f'.repeat(64),
      injected: true,
      gmApiVerified: true
    }
    // script-4 is missing in manager
  ];

  const result = reconcileBatchImportedScriptsVersionState(
    importedScripts,
    observations,
    {userApproved: true}
  );

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.totalCount, 4);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.divergedCount, 2);
  assert.equal(result.missingCount, 1);
  assert.equal(result.invalidCount, 0);

  // script-1 matched
  assert.equal(result.items[0].status, 'INSTALLED_MATCH');
  assert.equal(result.items[0].managerVerified, true);
  assert.equal(result.items[0].installedVersion, '1.0.0');

  // script-2 version diverged
  assert.equal(result.items[1].status, 'INSTALLED_VERSION_DIVERGED');
  assert.equal(result.items[1].managerVerified, false);
  assert.equal(result.items[1].installedVersion, '1.9.0');

  // script-3 hash diverged
  assert.equal(result.items[2].status, 'INSTALLED_HASH_DIVERGED');
  assert.equal(result.items[2].managerVerified, false);

  // script-4 missing
  assert.equal(result.items[3].status, 'MISSING_NOT_INSTALLED');
  assert.equal(result.items[3].managerVerified, false);
  assert.deepEqual(result.missingScriptIds, ['script-4']);

  // fail-closed authority flags
  assert.equal(result.automaticInstallAllowed, false);
  assert.equal(result.automaticPatchAllowed, false);
  assert.equal(result.automaticRollbackAllowed, false);
});

test('TASK-012/TEST-023: batch reconciliation without observations reports all missing', () => {
  const shaA = 'a'.repeat(64);
  const importedScripts = [
    {
      scriptId: 'script-1',
      name: 'Alpha Script',
      version: '1.0.0',
      sha256: shaA
    }
  ];

  const result = reconcileBatchImportedScriptsVersionState(
    importedScripts,
    null,
    {userApproved: true}
  );

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.totalCount, 1);
  assert.equal(result.missingCount, 1);
  assert.equal(result.items[0].status, 'MISSING_NOT_INSTALLED');
  assert.deepEqual(result.missingScriptIds, ['script-1']);
});

test('TASK-012/TEST-023: batch reconciliation requires explicit authorization', () => {
  const result = reconcileBatchImportedScriptsVersionState(
    [],
    null,
    {userApproved: false}
  );

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reason, 'NOT_AUTHORIZED');
});

test('TASK-012/TEST-023: batch reconciliation protects against Proxy traps', () => {
  let trapTriggered = false;
  const hostileArray = new Proxy([], {
    get(target, prop, receiver) {
      trapTriggered = true;
      return Reflect.get(target, prop, receiver);
    }
  });

  const result = reconcileBatchImportedScriptsVersionState(
    hostileArray,
    null,
    {userApproved: true}
  );

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reason, 'UNTRUSTED_INPUT');
  assert.equal(trapTriggered, false, 'Proxy trap on script array must not be triggered');
});

test('TASK-012/TEST-023: individual proxy script descriptor fails closed as INVALID_DESCRIPTOR', () => {
  let itemTrap = false;
  const proxiedItem = new Proxy({
    scriptId: 's-1',
    name: 'Proxy Script',
    version: '1.0.0',
    sha256: 'a'.repeat(64)
  }, {
    get(target, prop, receiver) {
      itemTrap = true;
      return Reflect.get(target, prop, receiver);
    }
  });

  const result = reconcileBatchImportedScriptsVersionState(
    [proxiedItem],
    null,
    {userApproved: true}
  );

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.invalidCount, 1);
  assert.equal(result.items[0].status, 'INVALID_DESCRIPTOR');
  assert.equal(itemTrap, false, 'Proxy trap on item must not be triggered');
});

test('TASK-012/TEST-023: launchBatchUserscriptInstallation blocks unconsented or invalid execution', async () => {
  const fakeSession: any = {
    ok: true,
    pid: 1234,
    browserWebsocket: 'ws://127.0.0.1:9222/devtools/browser/12345678-1234-1234-1234-123456789abc',
    chromeVersion: '138.0.0.0',
    userDataDir: 'C:\\fakepath'
  };

  const scripts = [
    {
      scriptId: 's-1',
      name: 'Script One',
      installUrl: 'https://example.com/one.user.js'
    }
  ];

  // 1. Unapproved
  const unapproved = await launchBatchUserscriptInstallation(
    fakeSession,
    scripts,
    {userApproved: false}
  );
  assert.equal(unapproved.status, 'BLOCKED');
  assert.equal(unapproved.code, 'NOT_AUTHORIZED');
  assert.equal(unapproved.automaticSilentInstallForbidden, true);
  assert.equal(unapproved.automaticInstallAllowed, false);

  // 2. Aborted signal
  const controller = new AbortController();
  controller.abort();
  const aborted = await launchBatchUserscriptInstallation(
    fakeSession,
    scripts,
    {userApproved: true},
    controller.signal
  );
  assert.equal(aborted.status, 'CANCELLED');
  assert.equal(aborted.code, 'CANCELLED');

  // 3. Hostile fake AbortSignal
  const hostileSignal: any = {aborted: false};
  const hostile = await launchBatchUserscriptInstallation(
    fakeSession,
    scripts,
    {userApproved: true},
    hostileSignal
  );
  assert.equal(hostile.status, 'BLOCKED');
  assert.equal(hostile.code, 'INVALID_OPTIONS');

  // 4. Unverified browser session
  const unverified = await launchBatchUserscriptInstallation(
    {} as any,
    scripts,
    {userApproved: true}
  );
  assert.equal(unverified.status, 'BLOCKED');
  assert.equal(unverified.code, 'UNVERIFIED_BROWSER');
});

test('TASK-012/TEST-023: launchBatchUserscriptInstallation handles empty list safely', async () => {
  const result = await launchBatchUserscriptInstallation(
    {} as any,
    [],
    {userApproved: true}
  );
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.totalCount, 0);
  assert.equal(result.launchedCount, 0);
  assert.equal(result.automaticSilentInstallForbidden, true);
  assert.equal(result.automaticInstallAllowed, false);
});
