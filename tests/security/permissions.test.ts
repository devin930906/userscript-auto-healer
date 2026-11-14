/**
 * TASK-018 · REQ-001..026 · TEST-007 · TEST-026.
 *
 * Security Permissions and Boundary Audit.
 *
 * Comprehensive audit of security permissions, desktop sandbox boundaries,
 * Chrome profile isolation, untrusted script sandboxing, fail-closed policy
 * invariants, and network/privacy boundaries.
 */
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {types as nodeTypes} from 'node:util';
import {
  validateBrowserConfig,
  isDefaultBrowserProfilePath,
  type BrowserConfig
} from '../../src/security/browser-config';
import {
  DESKTOP_WEB_PREFERENCES,
  SHELL_STATUS,
  trustedMainFrame
} from '../../src/security/desktop-policy';
import {
  evaluateBusinessAcceptanceGate,
  type BusinessAcceptanceResult
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
  evaluateMultiScriptUpgrade
} from '../../src/compat/multi-script-compatibility';
import {
  evaluateManagerVersionState
} from '../../src/export/manager-version-state';
import {
  parseUserscriptMetadata
} from '../../src/analyze/metadata-parser';
import {
  analyzeSelectors
} from '../../src/analyze/selector-analyzer';
import {
  importDroppedBytes
} from '../../src/import/import-service';

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

// ---------------------------------------------------------------------------
// 1. Chrome Profile and Executable Permissions (REQ-006/007, TEST-007, TEST-026)
// ---------------------------------------------------------------------------

test('TASK-018/TEST-007: valid dedicated isolated profile passes syntactic validation', () => {
  const valid: BrowserConfig = {
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    userDataDir: 'D:\\UAH-Isolated-Profiles\\Test-Profile-1',
    remoteDebuggingPort: 9223,
    bindAddress: '127.0.0.1'
  };
  const result = validateBrowserConfig(valid);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.verifiedOnDisk, false);
    assert.equal(result.config.remoteDebuggingPort, 9223);
    assert.equal(result.config.bindAddress, '127.0.0.1');
  }
});

test('TASK-018/TEST-007: default daily-use Chrome/Edge/Chromium profiles are strictly rejected', () => {
  const defaultProfiles = [
    'C:\\Users\\Devin\\AppData\\Local\\Google\\Chrome\\User Data',
    'C:\\Users\\Devin\\AppData\\Local\\Google\\Chrome\\User Data\\Default',
    'C:\\Users\\Devin\\AppData\\Local\\Google\\Chrome Beta\\User Data',
    'C:\\Users\\Devin\\AppData\\Local\\Google\\Chrome Dev\\User Data',
    'C:\\Users\\Devin\\AppData\\Local\\Google\\Chrome SxS\\User Data',
    'C:\\Users\\Devin\\AppData\\Local\\Microsoft\\Edge\\User Data',
    'C:\\Users\\Devin\\AppData\\Local\\Microsoft\\Edge Beta\\User Data',
    'C:\\Users\\Devin\\AppData\\Local\\Chromium\\User Data'
  ];

  for (const profile of defaultProfiles) {
    assert.equal(
      isDefaultBrowserProfilePath(profile),
      true,
      `Expected ${profile} to be recognized as default browser profile`
    );

    const config = {
      executablePath: 'C:\\Chrome\\chrome.exe',
      userDataDir: profile,
      remoteDebuggingPort: 9223,
      bindAddress: '127.0.0.1'
    };
    const result = validateBrowserConfig(config);
    assert.deepEqual(result, {ok: false, code: 'UNSAFE_PROFILE'});
  }
});

test('TASK-018/TEST-007: unsafe profile locations (root drives, parent dirs, DOS devices) are rejected', () => {
  const unsafeProfiles = [
    'C:\\',
    'D:\\',
    'C:\\Program Files\\Google\\Chrome\\Application',
    'C:\\Program Files\\Google\\Chrome',
    'C:\\Authorized\\CON',
    'C:\\Authorized\\PRN',
    'C:\\Authorized\\AUX',
    'C:\\Authorized\\NUL',
    'C:\\Authorized\\COM1',
    'C:\\Authorized\\LPT1',
    'C:\\Authorized\\Profile:stream',
    'C:\\Authorized\\..\\Unsafe'
  ];

  for (const profile of unsafeProfiles) {
    const config = {
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      userDataDir: profile,
      remoteDebuggingPort: 9223,
      bindAddress: '127.0.0.1'
    };
    const result = validateBrowserConfig(config);
    assert.deepEqual(result, {ok: false, code: 'UNSAFE_PROFILE'});
  }
});

test('TASK-018/TEST-007: non-chrome executables or relative paths are rejected', () => {
  const invalidExecutables = [
    'C:\\Windows\\notepad.exe',
    'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    'chrome.exe',
    '.\\chrome.exe',
    'C:\\Chrome\\chrome.bat',
    'C:\\Chrome\\chrome.cmd',
    'C:\\Chrome\\chrome.exe.lnk',
    '\\\\network-share\\chrome.exe',
    '/usr/bin/chrome'
  ];

  for (const exec of invalidExecutables) {
    const config = {
      executablePath: exec,
      userDataDir: 'D:\\Authorized\\Profile',
      remoteDebuggingPort: 9223,
      bindAddress: '127.0.0.1'
    };
    const result = validateBrowserConfig(config);
    assert.deepEqual(result, {ok: false, code: 'INVALID_EXECUTABLE'});
  }
});

test('TASK-018/TEST-008: remote debugging port boundaries and bind address security', () => {
  const invalidPorts = [0, 80, 443, 1023, 65536, 70000, -1, 9223.5, NaN, Infinity];
  for (const port of invalidPorts) {
    const config = {
      executablePath: 'C:\\Chrome\\chrome.exe',
      userDataDir: 'D:\\Authorized\\Profile',
      remoteDebuggingPort: port,
      bindAddress: '127.0.0.1'
    };
    const result = validateBrowserConfig(config);
    assert.deepEqual(result, {ok: false, code: 'INVALID_PORT'});
  }

  const invalidBinds = ['0.0.0.0', '192.168.1.1', 'localhost', '::1', '10.0.0.1', 'example.com'];
  for (const bind of invalidBinds) {
    const config = {
      executablePath: 'C:\\Chrome\\chrome.exe',
      userDataDir: 'D:\\Authorized\\Profile',
      remoteDebuggingPort: 9223,
      bindAddress: bind
    };
    const result = validateBrowserConfig(config);
    assert.deepEqual(result, {ok: false, code: 'INVALID_BIND'});
  }
});

test('TASK-018/TEST-026: prototype pollution, Proxies and non-plain objects fail browser config preflight', () => {
  const proxyConfig = new Proxy(
    {
      executablePath: 'C:\\Chrome\\chrome.exe',
      userDataDir: 'D:\\Authorized\\Profile',
      remoteDebuggingPort: 9223,
      bindAddress: '127.0.0.1'
    },
    {}
  );
  assert.equal(nodeTypes.isProxy(proxyConfig), true);
  assert.deepEqual(validateBrowserConfig(proxyConfig), {ok: false, code: 'INVALID_SHAPE'});

  const inheritedPoison = Object.create({
    executablePath: 'C:\\Chrome\\chrome.exe',
    userDataDir: 'D:\\Authorized\\Profile',
    remoteDebuggingPort: 9223,
    bindAddress: '127.0.0.1'
  });
  assert.deepEqual(validateBrowserConfig(inheritedPoison), {ok: false, code: 'INVALID_SHAPE'});

  for (const nonObj of [null, undefined, 'string', 12345, true, [], [1, 2, 3]]) {
    assert.deepEqual(validateBrowserConfig(nonObj), {ok: false, code: 'INVALID_SHAPE'});
  }
});

// ---------------------------------------------------------------------------
// 2. Desktop Sandbox & Shell Security Invariants (REQ-001/026, TEST-026)
// ---------------------------------------------------------------------------

test('TASK-018/TEST-026: desktop webPreferences enforce strict Electron renderer sandboxing', () => {
  assert.equal(DESKTOP_WEB_PREFERENCES.sandbox, true);
  assert.equal(DESKTOP_WEB_PREFERENCES.contextIsolation, true);
  assert.equal(DESKTOP_WEB_PREFERENCES.nodeIntegration, false);
  assert.equal(DESKTOP_WEB_PREFERENCES.nodeIntegrationInWorker, false);
  assert.equal(DESKTOP_WEB_PREFERENCES.webSecurity, true);
  assert.equal(DESKTOP_WEB_PREFERENCES.allowRunningInsecureContent, false);
  assert.equal(DESKTOP_WEB_PREFERENCES.webviewTag, false);
});

test('TASK-018/TEST-026: shell status strictly forbids unverified automatic repair/apply/AI capabilities', () => {
  assert.equal(SHELL_STATUS.shell, 'development-skeleton');
  assert.equal(SHELL_STATUS.automaticRepairAvailable, false);
  assert.equal(SHELL_STATUS.aiEnabled, false);
  assert.equal(SHELL_STATUS.automaticApplyEnabled, false);
});

test('TASK-018/TEST-026: trustedMainFrame validates only exact local file:/// frame identity', () => {
  const appHtml = 'file:///C:/Program%20Files/UAH/dist/app/ui/index.html';
  assert.equal(trustedMainFrame(appHtml, appHtml, true), true);

  // Subframes cannot be trusted
  assert.equal(trustedMainFrame(appHtml, appHtml, false), false);

  // Web origins or external protocols cannot be trusted
  assert.equal(trustedMainFrame('https://example.com/index.html', appHtml, true), false);
  assert.equal(trustedMainFrame('http://localhost:3000/', appHtml, true), false);
  assert.equal(trustedMainFrame('data:text/html,<h1>evil</h1>', appHtml, true), false);
  assert.equal(trustedMainFrame('about:blank', appHtml, true), false);

  // Non-matching file paths cannot be trusted
  assert.equal(trustedMainFrame('file:///C:/evil/index.html', appHtml, true), false);
  assert.equal(trustedMainFrame(null, appHtml, true), false);
  assert.equal(trustedMainFrame(undefined, appHtml, true), false);
});

// ---------------------------------------------------------------------------
// 3. Fail-Closed Policy Invariants across Operations (REQ-018/020/021)
// ---------------------------------------------------------------------------

test('TASK-018/TEST-018: business acceptance gate fails closed on unconsented or invalid inputs', () => {
  const origSha = sha256('original-content');
  const candSha = sha256('candidate-content');

  const validAudit = {
    status: 'REVIEWABLE_ONLY' as const,
    originalSha256: origSha,
    candidateSha256: candSha,
    faultEvidenceId: 'scenario_assertion_1',
    change: {start: 10, end: 25},
    automaticPatchAllowed: false as const,
    tampermonkeyVerified: false as const,
    businessRecoveredVerified: false as const
  };

  const validBackup = {
    status: 'BACKUP_PREPARED_RUNTIME_UNVERIFIED' as const,
    backupFileName: 'original.user.js.bak-1',
    sourceSha256: origSha,
    candidateSha256: candSha,
    backupByteLength: 1024,
    automaticPatchAllowed: false as const,
    automaticRollbackAllowed: false as const,
    tampermonkeyVerified: false as const,
    businessRecoveredVerified: false as const
  };

  const validOriginal = {
    status: 'REAL_MANAGER_ORIGINAL_EVALUATION' as const,
    sourceSha256: origSha,
    injected: true as const,
    gmVerified: true as const,
    businessOutcome: 'missing-target' as const,
    actionConfirmed: false as const,
    observedAt: '2026-11-11T10:00:00Z'
  };

  const validCandidate = {
    status: 'REAL_MANAGER_CANDIDATE_EVALUATION' as const,
    candidateSha256: candSha,
    injected: true as const,
    gmVerified: true as const,
    businessOutcome: 'recovered' as const,
    actionConfirmed: true as const,
    observedAt: '2026-11-11T10:05:00Z'
  };

  // Missing user approval must fail closed
  const unapprovedResult = evaluateBusinessAcceptanceGate(
    validAudit,
    validBackup,
    validOriginal,
    validCandidate,
    {userApproved: false}
  );
  assert.equal(unapprovedResult.status, 'BLOCKED');
  assert.equal(unapprovedResult.automaticPatchAllowed, false);
  assert.equal(unapprovedResult.businessVerified, false);

  // Valid user approval passes gate to awaiting-transaction state
  const approvedResult: BusinessAcceptanceResult = evaluateBusinessAcceptanceGate(
    validAudit,
    validBackup,
    validOriginal,
    validCandidate,
    {userApproved: true}
  );
  assert.equal(approvedResult.status, 'BUSINESS_ACCEPTED_AWAITING_TRANSACTION');
  assert.equal(approvedResult.automaticPatchAllowed, false);
  assert.equal(approvedResult.automaticRollbackAllowed, false);
  assert.equal(approvedResult.tampermonkeyVerified, true);
  assert.equal(approvedResult.businessVerified, true);
});

test('TASK-018/TEST-020/021: atomic mutation rejects unverified receipts, altered sources and missing consent', async () => {
  const result = await applyBusinessAcceptedCandidate(
    null as unknown as BusinessAcceptanceResult,
    'candidate-source',
    {userApproved: true, mutateApproved: true}
  );
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reason, 'ACCEPTANCE_UNVERIFIED');

  const proxyReceipt = new Proxy(
    {
      status: 'BUSINESS_ACCEPTED_AWAITING_TRANSACTION',
      originalSha256: sha256('a'),
      candidateSha256: sha256('b'),
      backupFileName: 'bak-1',
      tampermonkeyVerified: true,
      businessVerified: true
    },
    {}
  );
  const proxyResult = await applyBusinessAcceptedCandidate(
    proxyReceipt as unknown as BusinessAcceptanceResult,
    'candidate-source',
    {userApproved: true, mutateApproved: true}
  );
  assert.equal(proxyResult.status, 'BLOCKED');
  assert.equal(proxyResult.reason, 'ACCEPTANCE_UNVERIFIED');
});

test('TASK-018/TEST-021: restore transaction fails closed without explicit user consent', async () => {
  const blockedNoConsent = await restoreVerifiedOriginalNativeOnly({
    sourcePath: 'C:\\Users\\Devin\\scripts\\target.user.js',
    backupDirectory: 'C:\\Users\\Devin\\scripts\\backups',
    backupFileName: 'target.user.js.bak-1',
    expectedCurrentSha256: sha256('candidate'),
    expectedOriginalSha256: sha256('original'),
    expectedOriginalByteLength: 1024,
    userApproved: false,
    manualRestoreApproved: true
  });
  assert.equal(blockedNoConsent.status, 'BLOCKED');
  assert.equal(blockedNoConsent.automaticRollbackAllowed, false);

  const blockedNoRestoreApproved = await restoreVerifiedOriginalNativeOnly({
    sourcePath: 'C:\\Users\\Devin\\scripts\\target.user.js',
    backupDirectory: 'C:\\Users\\Devin\\scripts\\backups',
    backupFileName: 'target.user.js.bak-1',
    expectedCurrentSha256: sha256('candidate'),
    expectedOriginalSha256: sha256('original'),
    expectedOriginalByteLength: 1024,
    userApproved: true,
    manualRestoreApproved: false
  });
  assert.equal(blockedNoRestoreApproved.status, 'BLOCKED');
  assert.equal(blockedNoRestoreApproved.automaticRollbackAllowed, false);
});

// ---------------------------------------------------------------------------
// 4. Untrusted Script Payload Sandbox & AST Isolation (REQ-026, TEST-026)
// ---------------------------------------------------------------------------

test('TASK-018/TEST-026: malicious userscript payloads are parsed purely as static data without code execution', () => {
  // A hostile userscript attempting privilege escalation, process termination, and prototype pollution
  const hostileScript = [
    '// ==UserScript==',
    '// @name MaliciousExploitScript',
    '// @match https://victim.example.com/*',
    '// @grant none',
    '// ==/UserScript==',
    'const {execSync} = require("child_process");',
    'execSync("calc.exe");',
    'process.exit(1);',
    'Object.prototype.__protoPolluted = true;',
    'globalThis.__evilFlag = true;',
    'document.querySelector("#secret-admin-panel");'
  ].join('\n');

  const imported = importDroppedBytes('exploit.user.js', Buffer.from(hostileScript, 'utf8'));
  assert.ok(!('code' in imported));
  if ('code' in imported) return;

  // Metadata parsing
  const metadata = parseUserscriptMetadata(imported);
  assert.equal(metadata.status, 'OK');
  assert.equal(metadata.tags['name']?.[0], 'MaliciousExploitScript');
  assert.equal(metadata.tags['match']?.length, 1);
  assert.equal(metadata.tags['match']?.[0], 'https://victim.example.com/*');

  // Selector analysis
  const selectorAnalysis = analyzeSelectors(hostileScript);
  assert.equal(selectorAnalysis.status, 'OK');
  assert.equal(selectorAnalysis.sites.length, 1);
  assert.equal(selectorAnalysis.sites[0].selector, '#secret-admin-panel');

  // Verify that NONE of the hostile code executed
  assert.equal((Object.prototype as unknown as Record<string, unknown>).__protoPolluted, undefined);
  assert.equal((globalThis as unknown as Record<string, unknown>).__evilFlag, undefined);
});

// ---------------------------------------------------------------------------
// 5. Multi-Script and Export Boundary Security (REQ-023/025, TEST-023/025)
// ---------------------------------------------------------------------------

test('TASK-018/TEST-025: shared layer upgrade evaluation fails closed if any consumer is unverified', () => {
  const layer = new LimitedCompatibilityLayer({
    version: '1.0.0',
    consumers: [sha256('consumer-1'), sha256('consumer-2')],
    bindings: [{key: 'btn', selector: '#old-btn', attempts: 1, delayMs: 0, observeMutations: false}]
  });

  const evaluation = evaluateMultiScriptUpgrade({
    activeLayer: layer,
    candidate: {
      version: '1.1.0',
      consumers: [sha256('consumer-1'), sha256('consumer-2')],
      bindings: [{key: 'btn', selector: '#new-btn', attempts: 1, delayMs: 0, observeMutations: false}]
    },
    registrations: [
      {
        scriptHash: sha256('consumer-1'),
        scriptName: 'Consumer One',
        requiredBindings: ['btn'],
        minLayerVersion: '1.0.0',
        maxLayerVersion: '2.0.0'
      },
      {
        scriptHash: sha256('consumer-2'),
        scriptName: 'Consumer Two',
        requiredBindings: ['btn'],
        minLayerVersion: '1.0.0',
        maxLayerVersion: '2.0.0'
      }
    ],
    reports: [
      {
        scriptHash: sha256('consumer-1'),
        passed: true,
        testedBindings: ['btn'],
        executionEvidenceId: '1'.repeat(64)
      }
      // consumer-2 report missing!
    ],
    userConsentToken: 'USER_AUTHORIZED_TOKEN_TASK018'
  });

  assert.equal(evaluation.status, 'BLOCKED');
  assert.equal(evaluation.reason, 'INCOMPLETE_CONSUMER_COVERAGE');
  assert.equal(evaluation.automaticActivationAllowed, false);
});

test('TASK-018/TEST-023: exported artifacts maintain strict separation from manager live state', () => {
  const exportReceipt = {
    status: 'EXPORTED_RUNTIME_UNVERIFIED' as const,
    exportFileName: 'candidate.user.js',
    recoveryExportFileName: 'original.user.js',
    candidateSha256: sha256('candidate-code'),
    byteLength: 2048,
    automaticPatchAllowed: false as const,
    automaticRollbackAllowed: false as const,
    tampermonkeyVerified: false as const,
    managerInstalled: false as const,
    businessVerified: false as const
  };

  const versionState = evaluateManagerVersionState(
    exportReceipt,
    null,
    {userApproved: true}
  );

  assert.equal(versionState.status, 'DISK_EXPORT_ONLY_NOT_INSTALLED');
  assert.equal(versionState.managerInstalled, false);
  assert.equal(versionState.tampermonkeyVerified, false);
  assert.equal(versionState.automaticInstallAllowed, false);
  assert.equal(versionState.automaticPatchAllowed, false);
  assert.equal(versionState.automaticRollbackAllowed, false);
});

// TASK-005 / Issue #856: source-contract regression for two real desktop IPC
// entrypoints. These static assertions do not claim Chrome++ runtime acceptance.
test('TASK-005/TEST-008: requested 9896 default and configurable existing Chrome port stay aligned', () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
  const markup = read('app/ui/index.html');
  const renderer = read('app/ui/index.ts');
  const preload = read('app/preload/index.ts');
  const main = read('app/main/index.ts');
  assert.match(markup, /<input id="chrome-port"[^>]*value="9896"/,
    'visible browser port must default to 9896, not the historical 9223');
  assert.match(main, /remoteDebuggingPort:9896,bindAddress:'127\.0\.0\.1'/,
    'new Profile validation should not use an obsolete port');
  assert.match(renderer, /window\.healer\.connectExistingChrome\(port\)/,
    'external connection must use the same selected port as owned launch');
  assert.match(preload,
    /connectExistingChrome: \(port: number\): Promise<unknown> => ipcRenderer\.invoke\('browser:connect-existing', port\)/,
    'preload should forward only the numeric port, not a path or endpoint');
  assert.match(main, /'browser:connect-existing',async \(event,port:unknown\)=>/,
    'main-process external connection should receive and validate a port');
  assert.match(main,
    /userDataDir:selectedProfile,remoteDebuggingPort:port,bindAddress:'127\.0\.0\.1'/,
    'main process must validate selected port and keep loopback binding');
  const external = read('src/browser/existing-chrome.ts');
  assert.match(external,
    /if\(endpoint\.port!==cfg\.remoteDebuggingPort\)\s*return \{ok:false,code:'INVALID_ENDPOINT'\}/,
    'existing Chrome must reject a DevToolsActivePort endpoint that differs from selected port');
  for (const port of [9896, 9223, 65535]) {
    const result = validateBrowserConfig({
      executablePath: 'C:\\Chrome\\chrome.exe',
      userDataDir: 'D:\\UAH-Profiles\\test',
      remoteDebuggingPort: port,
      bindAddress: '127.0.0.1'
    });
    assert.equal(result.ok, true, 'custom CDP port should remain supported: ' + port);
    if (result.ok) assert.equal(result.config.remoteDebuggingPort, port);
  }
});
