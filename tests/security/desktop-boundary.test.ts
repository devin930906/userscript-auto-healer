import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateBrowserConfig } from '../../src/security/browser-config';
import { DESKTOP_WEB_PREFERENCES, SHELL_STATUS, trustedMainFrame } from '../../src/security/desktop-policy';

const allowed = {
  executablePath: String.raw`C:\Portable Apps\Chrome\chrome.exe`,
  userDataDir: String.raw`D:\Authorized\UAH-Test-Profile`,
  remoteDebuggingPort: 9223,
  bindAddress: '127.0.0.1'
};


/** Exact IPC inventory: cancel-only drag/drop analysis expands the native
 * contract by precisely one channel, not by an arbitrary renderer gateway. */
const approvedIpcChannels=[
 'ai:discover-native','ai:review-native','app:status','browser:choose-chrome','browser:choose-profile',
 'browser:create-profile','browser:start','browser:stop',
 'browser:tampermonkey-hint','config:validate','gm-probe:observe',
 'gm-probe:save-report','gm-probe:start','gm-probe:status','gm-probe:stop',
 'gm-probe:visit','import:cancel-dropped','import:cancel-native',
 'import:dropped','import:files','import:folder','import:get-progress',
 'restore:inspect-intent','restore:inspect-inventory','restore:manual-original','scenario:cancel',
 'scenario:export-manual','scenario:history','scenario:inspect','scenario:register'
] as const;


test('TASK-001/TEST-026: security-critical renderer flags are fixed', () => {
  assert.equal(DESKTOP_WEB_PREFERENCES.sandbox, true);
  assert.equal(DESKTOP_WEB_PREFERENCES.contextIsolation, true);
  assert.equal(DESKTOP_WEB_PREFERENCES.nodeIntegration, false);
  assert.equal(DESKTOP_WEB_PREFERENCES.nodeIntegrationInWorker, false);
  assert.equal(DESKTOP_WEB_PREFERENCES.webSecurity, true);
  assert.equal(DESKTOP_WEB_PREFERENCES.webviewTag, false);
});

test('TASK-001: shell cannot claim repair, AI, or automatic application', () => {
  assert.deepEqual(SHELL_STATUS, {
    shell: 'development-skeleton',
    automaticRepairAvailable: false,
    aiEnabled: false,
    automaticApplyEnabled: false
  });
});

test('TASK-001/TEST-026: only the exact local application main frame is trusted', () => {
  const trusted = 'file:///C:/Program%20Files/UAH/dist/app/ui/index.html';
  assert.equal(trustedMainFrame(trusted, trusted, true), true);
  for (const value of ['https://evil.example/', 'file:///C:/other.html',
    trusted + '?injected=true', trusted + '#other', 'about:blank', undefined]) {
    assert.equal(trustedMainFrame(value, trusted, true), false);
  }
  assert.equal(trustedMainFrame(trusted, trusted, false), false);
});

test('TASK-001: syntactically valid, isolated Windows Chrome config is NOT disk-verified', () => {
  assert.deepEqual(validateBrowserConfig(allowed), {
    ok: true, config: allowed, verifiedOnDisk: false
  });
});

test('TASK-001: reject invalid input shape and unrecognized options', () => {
  for (const value of [null, [], 'x', {}, {...allowed, unsafeFlag: true}]) {
    assert.equal(validateBrowserConfig(value).ok, false);
  }
});

test('TASK-001/TEST-026: config preflight ignores accessors and rejects hidden properties and hostile Proxies', () => {
  let accessed = 0;
  for (const field of ['executablePath', 'userDataDir', 'remoteDebuggingPort', 'bindAddress']) {
    const hostile = {...allowed};
    Object.defineProperty(hostile, field, {
      enumerable: true,
      get() { accessed++; throw Error('PRIVATE_BROWSER_CONFIG_GETTER'); }
    });
    assert.deepEqual(validateBrowserConfig(hostile), {ok:false, code:'INVALID_SHAPE'});
  }
  assert.equal(accessed, 0, 'configuration accessors must never run');

  const invisible = {...allowed};
  Object.defineProperty(invisible, 'hiddenPermission', {value:true});
  assert.deepEqual(validateBrowserConfig(invisible), {ok:false, code:'INVALID_SHAPE'});
  assert.deepEqual(validateBrowserConfig({...allowed, [Symbol('secret')]:true}),
    {ok:false, code:'INVALID_SHAPE'});
  const inherited = Object.assign(Object.create({danger:true}), allowed);
  assert.deepEqual(validateBrowserConfig(inherited), {ok:false, code:'INVALID_SHAPE'});

  for (const trap of [
    {getPrototypeOf() {throw Error('PRIVATE_CONFIG_PROXY');}},
    {ownKeys() {throw Error('PRIVATE_CONFIG_PROXY');}},
    {getOwnPropertyDescriptor() {throw Error('PRIVATE_CONFIG_PROXY');}}
  ]) {
    const hostile = new Proxy({...allowed}, trap);
    assert.deepEqual(validateBrowserConfig(hostile), {ok:false, code:'INVALID_SHAPE'});
  }
  const plainNullPrototype = Object.assign(Object.create(null), allowed);
  assert.deepEqual(validateBrowserConfig(plainNullPrototype),
    {ok:true, config:allowed, verifiedOnDisk:false});
});

test('TASK-005/TEST-026: browser preflight never executes live or revoked Proxy traps', () => {
  let traps = 0;
  const hostile = new Proxy({...allowed}, {
    getPrototypeOf() { traps++; return Object.prototype; },
    ownKeys(target) { traps++; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) {
      traps++; return Reflect.getOwnPropertyDescriptor(target, key);
    }
  });
  assert.deepEqual(validateBrowserConfig(hostile), {ok:false, code:'INVALID_SHAPE'});
  assert.equal(traps, 0, 'no untrusted Proxy trap may run during validation');
  const revoked = Proxy.revocable({...allowed}, {});
  revoked.revoke();
  assert.deepEqual(validateBrowserConfig(revoked.proxy), {ok:false, code:'INVALID_SHAPE'});
  assert.deepEqual(validateBrowserConfig(allowed), {
    ok:true, config:allowed, verifiedOnDisk:false
  });
});

test('TASK-001: reject executable path injection and non-Chrome binaries', () => {
  for (const path of ['chrome.exe', String.raw`\\server\share\chrome.exe`,
    String.raw`C:\Apps\firefox.exe`, String.raw`C:\Apps\..\chrome.exe`,
    'C:\\Chrome\\chrome.exe\n--bad', String.raw`C:\Apps\chrome.exe.`]) {
    assert.equal(validateBrowserConfig({...allowed, executablePath: path}).ok, false);
  }
});

test('TASK-005/TEST-026: reject NTFS alternate data stream path aliases', () => {
  for (const path of [String.raw`C:\Portable Apps:sidecar\Chrome\chrome.exe`,
    String.raw`C:\Portable Apps\Chrome:sidecar\chrome.exe`]) {
    assert.deepEqual(validateBrowserConfig({...allowed, executablePath: path}),
      {ok:false, code:'INVALID_EXECUTABLE'});
  }
  for (const path of [String.raw`D:\Authorized\UAH-Test-Profile:sidecar`,
    String.raw`D:\Authorized:sidecar\UAH-Test-Profile`]) {
    assert.deepEqual(validateBrowserConfig({...allowed, userDataDir: path}),
      {ok:false, code:'UNSAFE_PROFILE'});
  }
});

test('TASK-005/TEST-007/026: reject Windows DOS device aliases in Chrome and profile paths', () => {
  // Win32 reserves these component names even with filename extensions.
  for (const path of [String.raw`C:\CON\Chrome\chrome.exe`, String.raw`C:\Portable Apps\PRN.txt\chrome.exe`,
    String.raw`C:\AUX.log\Chrome\chrome.exe`, String.raw`C:\COM²\Chrome\chrome.exe`]) {
    assert.deepEqual(validateBrowserConfig({...allowed, executablePath: path}),
      {ok:false, code:'INVALID_EXECUTABLE'});
  }
  for (const path of [String.raw`D:\Authorized\NUL\UAH-Test-Profile`,
    String.raw`D:\Authorized\COM1\UAH-Test-Profile`,
    String.raw`D:\Authorized\lpt9.txt`]) {
    assert.deepEqual(validateBrowserConfig({...allowed, userDataDir: path}),
      {ok:false, code:'UNSAFE_PROFILE'});
  }
  assert.deepEqual(validateBrowserConfig({
    ...allowed, userDataDir:String.raw`D:\Authorized\COM10\UAH-Test-Profile`
  }).ok, true, 'non-reserved multi-digit components remain allowed');
});

test('TASK-005/TEST-007/026: reject reserved console device names without disk access', () => {
  // Windows CONIN$/CONOUT$ resolve to console devices, not ordinary folders.
  for (const path of ["C:\\CONIN$\\Chrome\\chrome.exe", "C:\\Portable Apps\\CONOUT$.txt\\chrome.exe"]) {
    assert.deepEqual(validateBrowserConfig({...allowed, executablePath: path}),
      {ok:false, code:'INVALID_EXECUTABLE'});
  }
  for (const path of ["D:\\Authorized\\CONOUT$\\UAH-Test-Profile", "D:\\Authorized\\conin$.log"]) {
    assert.deepEqual(validateBrowserConfig({...allowed, userDataDir: path}),
      {ok:false, code:'UNSAFE_PROFILE'});
  }
  assert.equal(validateBrowserConfig(allowed).ok, true);
});

test('TASK-001: reject daily Chrome User Data, drive roots and traversal', () => {
  for (const path of [String.raw`C:\Users\Person\AppData\Local\Google\Chrome\User Data`,
    String.raw`C:\Users\Person\AppData\Local\Google\Chrome\User Data\Default`,
    'D:\\', String.raw`D:\Authorized\..\Unsafe`,
    String.raw`C:\Portable Apps\Chrome`, String.raw`C:\Portable Apps`]) {
    assert.equal(validateBrowserConfig({...allowed, userDataDir: path}).ok, false);
  }
});

test('TASK-005/TEST-007/026: reject default profiles of Chrome channels and other Chromium browsers', () => {
  for (const profile of [
    String.raw`C:\Users\Person\AppData\Local\Google\Chrome Beta\User Data`,
    String.raw`C:\Users\Person\AppData\Local\Google\Chrome Dev\User Data\Default`,
    String.raw`C:\Users\Person\AppData\Local\Google\Chrome SxS\User Data`,
    String.raw`C:\Users\Person\AppData\Local\Microsoft\Edge\User Data`,
    String.raw`C:\Users\Person\AppData\Local\Microsoft\Edge Beta\User Data`,
    String.raw`C:\Users\Person\AppData\Local\Microsoft\Edge Dev\User Data`,
    String.raw`C:\Users\Person\AppData\Local\Chromium\User Data`
  ]) {
    assert.deepEqual(validateBrowserConfig({...allowed, userDataDir: profile}),
      {ok:false, code:'UNSAFE_PROFILE'}, 'daily-use browser Profile is not isolated: '+profile);
  }
});

test('TASK-001: reject privileged, out-of-range and fractional CDP ports', () => {
  for (const port of [0, 80, 1023, 65536, 9223.5, '9223', NaN]) {
    assert.equal(validateBrowserConfig({...allowed, remoteDebuggingPort: port}).ok, false);
  }
});

test('TASK-001: reject debug binds outside IPv4 loopback', () => {
  for (const bind of ['0.0.0.0', '::1', 'localhost', '127.0.0.2']) {
    assert.equal(validateBrowserConfig({...allowed, bindAddress: bind}).ok, false);
  }
});

test('TASK-001: main process restricts exposed IPC and unsafe navigation', () => {
  const main = readFileSync(join(process.cwd(), 'app/main/index.ts'), 'utf-8');
  assert.match(main, /authorizeSender\(event\)/);
  assert.match(main, /frame !== win\.webContents\.mainFrame/);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(main, /on\('will-navigate', \(event\) => event\.preventDefault\(\)\)/);
  assert.match(main, /setPermissionRequestHandler/);
  const handles=[...main.matchAll(/ipcMain\.handle\('([^']+)'/g)].map(m=>m[1]).sort();
  assert.deepEqual(handles,approvedIpcChannels);
  assert.match(main, /ipcMain\.handle\('import:cancel-dropped',event=>/);
  assert.match(main, /authorizeSender\(event\);\s*if\(!droppedImportController\)/);
  assert.match(main, /ipcMain\.handle\('import:cancel-native', event=>/);
  assert.match(main, /ipcMain\.handle\('import:get-progress',event=>/);
  assert.match(main, /authorizeSender\(event\);\s*\/\/ No user data/);
  assert.match(main, /authorizeSender\(event\);\s*if\(!nativeImportController\)return/);
  // New potentially file-writing manual restore is exact and main-frame-only.
  assert.match(main, /ipcMain\.handle\('restore:manual-original',async\(event,\.\.\.args:unknown\[\]\)=>/);
  assert.match(main, /authorizeSender\(event\);\s*if\(args\.length\)return \{ok:false,code:'INVALID_REQUEST'/);
  assert.match(main, /prepareManualOriginalRestoreSelection\(/);
  assert.match(main, /if\(approved\.response!==0\|\|revoked\(\)\)/);
  assert.match(main, /restoreVerifiedOriginalNativeOnly\(/);
  assert.doesNotMatch(main, /ipcMain\.handle\('restore:manual-original',async\(event,(?:path|sourcePath|backupPath|options)/);
  assert.match(main, /ipcMain\.handle\('browser:start'/);
  assert.match(main, /dialog\.showMessageBox/);
  assert.match(main, /stopOnlyOwnedBrowser\(\)/);
  assert.match(main, /prepareApprovedIsolatedProfile\(config\.config,true\)/);
  assert.match(main, /randomUUID\(\)/);
  assert.match(main, /ipcMain\.handle\('gm-probe:start'/);
  assert.match(main, /isSupportedGmProbeRunAt\(runAt\)/);
  assert.match(main, /ipcMain\.handle\('gm-probe:status'/);
  assert.match(main, /ipcMain\.handle\('gm-probe:save-report'/);
  assert.match(main, /dialog\.showSaveDialog/);
  assert.match(main, /saveLimitedGmReportOnly/);
  assert.match(main, /ipcMain\.handle\('gm-probe:stop'/);
  assert.match(main, /startApprovedTampermonkeyDiagnostic\(owned,true/);
  assert.match(main, /ipcMain\.handle\('gm-probe:visit'/);
  assert.match(main, /ipcMain\.handle\('gm-probe:observe'/);
  assert.match(main, /ipcMain\.handle\('scenario:register'/);
  assert.match(main, /ipcMain\.handle\('scenario:inspect'/);
  assert.match(main, /ipcMain\.handle\('scenario:cancel'/);
  assert.match(main, /ipcMain\.handle\('scenario:export-manual'/);
  assert.match(main, /nativeImportedPaths\.set\(script\.sha256,script\.sourcePath\)/);
  assert.match(main, /importApprovedPaths\(\[sourcePath\],controller\.signal\)/);
  assert.match(main, /observeApprovedDomSeries\(owned,opened/);
  assert.match(main, /exportReviewedImportedSelectorOnly\(/);
  assert.match(main, /scenarioSession\.resolveReadOnlyDom\(id\)/);
  assert.match(main, /openApprovedTarget\(owned,selected\.targetUrl,true,controller\.signal\)/);
  assert.match(main, /inspectApprovedScenarioDomSeries\(/);
  assert.match(main, /cancelScenarioObservation\(\)/);
  assert.match(main, /consistencySnapshot\(\)/);
  assert.match(main, /domSnapshot\(\)/);
  assert.match(main, /stopOnlyGmProbe\(\)/);
  assert.match(main, /onUnexpectedExit:\(\)=>/);
  assert.match(main, /ownedBrowser=null;\s*cancelScenarioObservation\(\);stopOnlyGmProbe\(\)/);
});

test('TASK-014/TEST-015/016/026: AI model discovery uses native picker and distinct consent, never renderer credentials',()=>{
  const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
  const preload=readFileSync(join(process.cwd(),'app/preload/index.ts'),'utf8');
  const renderer=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
  const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
  assert.match(main,/ipcMain\.handle\('ai:discover-native',async\(event,\.\.\.args:unknown\[\]\)=>/);
  assert.match(main,/readNativeSelectedAiConfig\(choice\.filePaths\[0\]\)/);
  assert.match(main,/discoverModelsFromNativeConfig\(config,async origin=>/);
  assert.match(main,/dialog\.showMessageBox\(win,/);
  assert.match(main,/nativeAiDiscoveryController\?\.abort\(\)/);
  assert.match(preload,/discoverNativeAiModels: \(\): Promise<unknown> => ipcRenderer\.invoke\('ai:discover-native'\)/);
  assert.match(renderer,/window\.healer\.discoverNativeAiModels\(\)/);
  assert.match(html,/id="ai-model-discover"/);
  assert.doesNotMatch(preload,/apiKey|baseUrl|manualModel|selectedConfigPath/);
  assert.doesNotMatch(main,/ipcMain\.handle\('ai:discover-native',async\(event,(?:path|url|key|config|consent)/);
});

test('TASK-014/TEST-015/016/026: native AI review only accepts a staged scenario ID and distinct OS approval',()=>{
  const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
  const preload=readFileSync(join(process.cwd(),'app/preload/index.ts'),'utf8');
  const renderer=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
  const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
  assert.ok(main.includes("ipcMain.handle('ai:review-native',async(event,id:unknown,...args:unknown[])"));
  assert.ok(main.includes('nativeAiReviewEvidence.resolve(id)'));
  assert.ok(main.includes('readNativeSelectedAiConfig(choice.filePaths[0])'));
  assert.ok(main.includes('requestNativeReviewedAiSuggestion(config,evidence,async(origin,review)=>'));
  assert.ok(main.includes("nativeAiReviewEvidence.record(selected.scenario.id,selected.scenario.scriptSha256,"));
  assert.ok(main.includes('nativeAiReviewEvidence.clear()'));
  assert.ok(preload.includes("requestNativeAiReview: (id: string): Promise<unknown> => ipcRenderer.invoke('ai:review-native',id)"));
  assert.ok(renderer.includes('window.healer.requestNativeAiReview(id)'));
  assert.ok(renderer.includes("aiReviewResult.textContent='未经验证的 AI 文字建议"));
  assert.ok(html.includes('id="ai-reviewed-suggest"'));
  assert.doesNotMatch(preload,/apiKey|baseUrl|manualModel|scriptSource|selectorHash|scenarioHash/);
  assert.doesNotMatch(main,/ipcMain\.handle\('ai:review-native',async\(event,(?:url|source|hash|consent|config|prompt)/);
});

test('TASK-011/TEST-020/026: desktop reconciles restore intent only after native picks, without write authority',()=>{
  const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
  const preload=readFileSync(join(process.cwd(),'app/preload/index.ts'),'utf8');
  const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
  const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
  assert.match(main,/ipcMain\.handle\('restore:inspect-intent',async\(event,\.\.\.args:unknown\[\]\)=>/);
  assert.match(main,/inspectNativeRestoreIntentReadOnly\(/);
  assert.match(main,/if\(args\.length\)return \{ok:false,code:'INVALID_REQUEST'/);
  assert.match(main,/backupDirectory:dirname\(journalSelection\.filePaths\[0\]\)/);
  assert.match(main,/journalFileName:basename\(journalSelection\.filePaths\[0\]\)/);
  assert.match(preload,/inspectRestoreIntent: \(\): Promise<unknown> => ipcRenderer\.invoke\('restore:inspect-intent'\)/);
  assert.doesNotMatch(preload,/ipcRenderer\.invoke\('restore:inspect-intent',\s*[^)]/);
  assert.match(ui,/window\.healer\.inspectRestoreIntent\(\)/);
  assert.match(ui,/sourceState==='ORIGINAL_PRESENT'/);
  assert.match(html,/id="restore-inspect-intent"/);
  assert.match(html,/只读/);
  // The UI cannot send arbitrary source/journal names or request retry.
  assert.doesNotMatch(main,/ipcMain\.handle\('restore:inspect-intent',async\(event,(?:source|journal|path)/);
  assert.doesNotMatch(preload,/ipcRenderer\.invoke\('restore:inspect-intent',\s*[^)]/);
});

test('TASK-011/TEST-020/026: restore inventory IPC allows no untrusted renderer paths or approval flags',()=>{
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const preload=readFileSync(join(process.cwd(),'app/preload/index.ts'),'utf8');
 assert.match(main,/ipcMain\.handle\('restore:inspect-inventory',async\(event,\.\.\.args:unknown\[\]\)=>/);
 assert.match(preload,/inspectRestoreInventory: \(\): Promise<unknown> => ipcRenderer\.invoke\('restore:inspect-inventory'\)/);
 assert.doesNotMatch(preload,/ipcRenderer\.invoke\('restore:inspect-inventory',\s*[^)]/);
 assert.doesNotMatch(main,/ipcMain\.handle\('restore:inspect-inventory',async\(event,(?:path|source|backup|options)/);
 assert.match(main,/inspectNativeRestoreIntentInventoryReadOnly\(\{/);
 assert.match(main,/backupDirectory:backupDirectory\.filePaths\[0\],userApproved:true/);
});

test('TASK-001: preload does not expose raw IPC, shell or filesystem to renderer', () => {
  const preload = readFileSync(join(process.cwd(), 'app/preload/index.ts'), 'utf-8');
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.doesNotMatch(preload, /ipcRenderer\.(send|on|sendSync)\b/);
  assert.doesNotMatch(preload, /require\(['"]node:(fs|child_process)/);
  const invokes=[...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(m=>m[1]).sort();
  assert.deepEqual(invokes,approvedIpcChannels);
  assert.match(preload, /cancelDroppedImport: \(\): Promise<unknown> => ipcRenderer\.invoke\('import:cancel-dropped'\)/);
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\('import:cancel-dropped',\s*[^)]/);
  assert.match(preload, /cancelNativeImport: \(\): Promise<unknown> => ipcRenderer\.invoke\('import:cancel-native'\)/);
  assert.match(preload, /getNativeImportProgress: \(\): Promise<unknown> => ipcRenderer\.invoke\('import:get-progress'\)/);
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\('import:get-progress',\s*[^)]/);
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\('import:cancel-native',\s*[^)]/);
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\('browser:start',\s*(?:config|path)/);
  assert.match(preload, /startGmProbe: \(runAt\?: 'document-start' \| 'document-body' \| 'document-end' \| 'document-idle'\)/);
  assert.match(preload, /ipcRenderer\.invoke\('gm-probe:start',runAt\)/);
  assert.match(preload, /ipcRenderer\.invoke\('gm-probe:status'\)/);
  assert.match(preload, /ipcRenderer\.invoke\('gm-probe:save-report'\)/);
  assert.match(preload, /ipcRenderer\.invoke\('gm-probe:stop'\)/);
  assert.match(preload, /ipcRenderer\.invoke\('gm-probe:visit',mode\)/);
  assert.match(preload, /ipcRenderer\.invoke\('gm-probe:observe',mode\)/);
  assert.match(preload, /ipcRenderer\.invoke\('scenario:register',input\)/);
  assert.match(preload, /ipcRenderer\.invoke\('scenario:inspect',id\)/);
  assert.match(preload, /ipcRenderer\.invoke\('scenario:cancel'\)/);
  assert.match(preload, /ipcRenderer\.invoke\('scenario:export-manual',id\)/);
  assert.match(preload, /restoreManualOriginal: \(\): Promise<unknown> => ipcRenderer\.invoke\('restore:manual-original'\)/);
  assert.doesNotMatch(preload,/ipcRenderer\.invoke\('restore:manual-original',\s*[^)]/);

  assert.doesNotMatch(preload,/ipcRenderer\.invoke\('scenario:export-manual',\s*\{/);
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\('scenario:inspect',\s*\{/);
});

test('TASK-008/017 / TEST-013: desktop scenario exposes only bounded, non-attesting page exception signals',()=>{
  const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
  const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
  const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
  // No new renderer IPC capability: reuse the existing consented, owned tab.
  assert.match(main,/inspectApprovedPageExceptions\(/);
  assert.match(main,/owned,opened,selected\.targetUrl,true,1200,controller\.signal/);
  assert.match(main,/pageRuntimeStatus:page\.status/);
  assert.match(main,/pageExceptionCount:page\.observedCount/);
  // Failure to monitor an unstable page cannot be promoted to DOM success.
  assert.match(main,/if\(page\.status==='BLOCKED'\)/);
  assert.match(main,/page\.code,\.\.\.unverified/);
  assert.match(ui,/pageRuntimeStatus\?:'PAGE_EXCEPTION_SIGNAL_ONLY'\|'NO_EXCEPTION_IN_WINDOW_ONLY'/);
  assert.match(ui,/pageExceptionCount\?:number/);
  assert.match(ui,/页面 JavaScript 异常/);
  assert.match(html,/页面 JavaScript 异常/);
  assert.doesNotMatch(main,/pageExceptionMessage|pageExceptionStack|pageExceptionSource/);
});


test('TASK-008/009/017 TEST-013/019/026: desktop comparison is bounded, consented and review-only',()=>{
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
 const session=readFileSync(join(process.cwd(),'src/scenarios/desktop-session.ts'),'utf8');
 assert.match(html,/id="scenario-replacement" maxlength="256"/);
 assert.match(html,/人工审核线索/);
 assert.match(ui,/replacementSelector\?:string/);
 assert.match(ui,/replacementSelector:scenarioReplacement\.value\.trim\(\)/);
 assert.match(ui,/OLD_SELECTOR_MISSING_ALTERNATIVE_PRESENT/);
 assert.match(main,/selected\.scenario\.assertions\.length!==2/);
 assert.match(main,/result\.triage\.evidenceIds\[0\]==='scenario_assertion_1'/);
 assert.match(main,/inspectApprovedScenarioDomSeries\(/);
 assert.match(main,/dialog\.showMessageBox\(win/);
 assert.match(session,/scenario\.assertions\.length!==2/);
 assert.match(session,/new Set\(scenario\.assertions\.map/);
 // Purely read-only: existing channels remain exact and no candidate bytes,
 // file paths or arbitrary CDP operations enter the response to renderer.
 assert.doesNotMatch(main,/selectorComparisonStatus:[\s\S]*candidateSource:/);
 assert.doesNotMatch(ui,/window\.healer\.(applyPatch|installScript|exportPatch)\(/);
});

test('TASK-009/012/017 TEST-019/020/023/026: manual export requires true live ownership and native consent',()=>{
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const preload=readFileSync(join(process.cwd(),'app/preload/index.ts'),'utf8');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
 assert.match(main,/const sourcePath=nativeImportedPaths\.get\(selected\.scenario\.scriptSha256\)/);
 assert.match(main,/if\(!sourcePath\)return \{ok:false,code:'NO_NATIVE_SOURCE'/);
 assert.match(main,/if\(selected\.scenario\.assertions\.length!==2\)/);
 assert.match(main,/summarizeReadOnlyScenarioDomSeries\(selected\.scenario,evidence,true\)/);
 assert.match(main,/triage\.triage\.evidenceIds\[0\]!=='scenario_assertion_1'/);
 assert.match(main,/const current=await importApprovedPaths\(\[sourcePath\],controller\.signal\)/);
 assert.match(main,/current\.scripts\[0\]\.sha256!==selected\.scenario\.scriptSha256/);
 assert.match(main,/const approved=await dialog\.showMessageBox\(win/);
 assert.match(main,/if\(approved\.response!==0\|\|revoked\(\)\)/);
 assert.match(main,/exportReviewedImportedSelectorOnly\(/);
 assert.match(main,/nativeImportedPaths\.clear\(\)/);
 assert.doesNotMatch(main,/ipcMain\.handle\('scenario:export-manual',async\(event,(?:path|source|selector)/);
 assert.doesNotMatch(preload,/ipcRenderer\.invoke\('scenario:export-manual',\s*[^i]/);
 assert.match(html,/id="scenario-export-manual"/);
 assert.match(html,/不提供自动安装和回滚/);
 assert.match(ui,/MANUAL_EXPORT_READY_RUNTIME_UNVERIFIED/);
});

test('TASK-015/017 TEST-024/026: native-only archive has no arbitrary renderer path authority',()=>{
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const preload=readFileSync(join(process.cwd(),'app/preload/index.ts'),'utf8');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 assert.match(main,/ipcMain\.handle\('scenario:history',async\(event,id:unknown\)=>/);
 assert.match(main,/readLimitedHealthArchive\(app\.getPath\('userData'\),key\)/);
 assert.match(main,/saveLimitedHealthArchive\(app\.getPath\('userData'\),snapshot\)/);
 assert.match(main,/mergeLimitedSessionArchive\(current,stored\)/);
 const history=readFileSync(join(process.cwd(),'src/health/session-history.ts'),'utf8');
 assert.match(history,/archiveRetained:true/);
 assert.match(main,/重新启动后历史不会成为当前健康认证/);
 assert.match(ui,/本机持久的未验证历史/);
 assert.match(preload,/readScenarioHistory: \(id: string\): Promise<unknown> => ipcRenderer\.invoke\('scenario:history',id\)/);
 assert.doesNotMatch(main,/ipcMain\.handle\('scenario:history',async\(event,(?:path|sourcePath|fileName|scriptHash)/);
});

test('TASK-011/TEST-020/026: native restore ties pre-rename revocation to window close and application exit',()=>{
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const restore=main.slice(main.indexOf("ipcMain.handle('restore:manual-original'"),
  main.indexOf('// Every path MUST come from the native OS picker'));
 assert.match(restore,/const restoreController=new AbortController\(\)/);
 assert.match(restore,/win\.once\('closed',abortOnWindowClose\)/);
 assert.match(restore,/restoreVerifiedOriginalNativeOnly\([\s\S]*?restoreController\.signal\)/);
 assert.match(restore,/win\.removeListener\('closed',abortOnWindowClose\)/);
 assert.match(main,/app\.on\('before-quit',\(\)=>\{\s*nativeRestoreController\?\.abort\(\)/);
 // Renderer must not supply abort signals, file paths or restore authority.
 const preload=readFileSync(join(process.cwd(),'app/preload/index.ts'),'utf8');
 assert.match(preload,/restoreManualOriginal: \(\): Promise<unknown> => ipcRenderer\.invoke\('restore:manual-original'\)/);
});

// TASK-011 / TEST-020/023/026: real manual UI must persist a strictly
// non-authoritative checkpoint before reporting an exportable candidate.
test('TASK-011: native manual export displays a persisted unverified checkpoint without giving write authority',()=>{
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const preload=readFileSync(join(process.cwd(),'app/preload/index.ts'),'utf8');
 const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const flow=readFileSync(join(process.cwd(),'src/repair/manual-repair-flow.ts'),'utf8');
 assert.match(flow,/stageRecoveryCheckpointOnly\(patch,staged,files\)/);
 assert.match(flow,/if\(checkpoint\.status!=='CHECKPOINT_STAGED_UNVERIFIED'/);
 assert.match(flow,/checkpoint\.originalSha256!==staged\.originalSha256/);
 assert.match(flow,/checkpoint\.candidateSha256!==staged\.candidateSha256/);
 assert.match(main,/checkpointFileName:result\.checkpointFileName/);
 assert.match(ui,/checkpointFileName/);
 assert.match(html,/恢复检查点/);
 assert.doesNotMatch(preload,/ipcRenderer\.invoke\('restore:checkpoint-apply'/);
 assert.doesNotMatch(main,/ipcMain\.handle\('restore:checkpoint-apply'/);
});


test('TASK-007/011 / TEST-017/018/020/023: real isolated manager handoff requires verified native recovery checkpoint',()=>{
 const poc=readFileSync(join(process.cwd(),'poc/windows-tampermonkey-cloud.cjs'),'utf8');
 const start=poc.indexOf('async function prepareNativeManualExportForManager(');
 const end=poc.indexOf('const sleep=',start);
 assert.ok(start>=0&&end>start,'Inspect the actual native-to-manager preparation function');
 const handoff=poc.slice(start,end);
 assert.match(handoff,/inspectRecoveryCheckpointReadOnly/);
 assert.match(handoff,/checkpointFileName/);
 assert.match(handoff,/checkpointSha256/);
 assert.match(handoff,/checkpointInspection\.status,'CHECKPOINT_RECHECKED_READ_ONLY'/);
 assert.match(handoff,/checkpointInspection\.originalSha256/);
 assert.match(handoff,/checkpointInspection\.candidateSha256/);
 assert.match(handoff,/checkpointInspection\.automaticPatchAllowed,false/);
 assert.match(handoff,/checkpointInspection\.automaticRollbackAllowed,false/);
 // Do not silently treat a checkpoint as a browser extension or user
 // authorization, and do not add a new renderer or filesystem IPC ability.
 assert.doesNotMatch(handoff,/checkpointInspection\.(?:managerInstalled|businessVerified),true/);
 const preload=readFileSync(join(process.cwd(),'app/preload/index.ts'),'utf8');
 assert.doesNotMatch(preload,/ipcRenderer\.invoke\('restore:checkpoint-apply'/);
});

test('TASK-015/017 TEST-024/026: bounded scheduled read-only rechecks preserve native consent and opt-in UI',()=>{
 const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const preload=readFileSync(join(process.cwd(),'app/preload/index.ts'),'utf8');
 assert.match(html,/<button id="scenario-recheck-start" type="button" disabled>/);
 assert.match(html,/<button id="scenario-recheck-stop" type="button" disabled>/);
 assert.match(html,/id="scenario-recheck-status" role="status" aria-live="polite"/);
 assert.match(html,/每轮重新授权/);
 assert.match(ui,/const RECHECK_MAX_ROUNDS=3/);
 assert.match(ui,/const RECHECK_INTERVAL_MS=60_000/);
 assert.match(ui,/for\(let round=1;round<=RECHECK_MAX_ROUNDS;round\+\+\)/);
 assert.match(ui,/result=await window\.healer\.inspectScenario\(id\)/);
 assert.match(ui,/if\(!result\.ok\|\|result\.status!=='LIMITED_DOM_SIGNAL_ONLY'\)/);
 assert.match(ui,/if\(round<RECHECK_MAX_ROUNDS\)await waitRecheckInterval\(\)/);
 assert.match(ui,/revokeBoundedRechecks\(\)/);
 assert.match(ui,/window\.healer\.cancelScenarioInspection\(\)/);
 assert.match(main,/ipcMain\.handle\('scenario:inspect',async\(event,id:unknown\)=>/);
 assert.match(main,/const consent=await dialog\.showMessageBox\(win,/);
 assert.match(main,/consent\.response!==0\|\|controller\.signal\.aborted/);
 assert.match(preload,/inspectScenario: \(id: string\): Promise<unknown> => ipcRenderer\.invoke\('scenario:inspect',id\)/);
 assert.doesNotMatch(preload,/scenario:recheck|recheckPlan/);
 assert.doesNotMatch(ui,/automaticPatchAllowed\s*:\s*true|businessVerified\s*:\s*true/);
});

test('TASK-015/017 TEST-024/026: stopping owned Chrome revokes pending scheduled rechecks immediately',()=>{
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const start=ui.indexOf("stopButton?.addEventListener('click',()=>{");
 assert.notEqual(start,-1,'native Chrome stop control must remain registered');
 const end=ui.indexOf("chooseChromeButton?.addEventListener",start);
 const handler=ui.slice(start,end>start?end:start+1500);
 assert.match(handler,/revokeBoundedRechecks\(\)/,
  'stopping Chrome must interrupt the 60-second recheck wait even when native stop fails');
 assert.ok(handler.indexOf('revokeBoundedRechecks()')<
  handler.indexOf('window.healer.stopBrowser()'),
  'recheck schedule must be revoked before awaiting a native browser stop result');
});

test('TASK-015/017 TEST-024/026: pending Chrome stop cannot re-enable a new native observation',()=>{
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const controls=ui.slice(ui.indexOf('function browserControls():void{'),
  ui.indexOf('async function browserAction('));
 assert.match(controls,/const controlsBusy=browserBusy\|\|stopInProgress;/,
  'pending browser shutdown must keep all new browser action controls disabled');
 for(const name of ['launchButton','inspectButton','scenarioInspectButton',
  'scenarioRecheckStartButton','gmStartButton']){
  const section=controls.slice(controls.indexOf('if('+name+')'),controls.indexOf('if('+name+')')+180);
  assert.match(section,/controlsBusy/,
   name+' must stay disabled when recheck finally clears browserBusy before native stop returns');
 }
 const browserAction=ui.slice(ui.indexOf('async function browserAction('),
  ui.indexOf("scenarioHistoryButton?.addEventListener"));
 assert.match(browserAction,/if\(browserBusy\|\|stopInProgress\)return;/,
  'event delivery must not bypass disabled DOM controls during pending stop');
 const recheckStart=ui.slice(ui.indexOf("scenarioRecheckStartButton?.addEventListener('click'"),
  ui.indexOf("scenarioRecheckStopButton?.addEventListener"));
 assert.match(recheckStart,/if\(recheckRunning\|\|browserBusy\|\|stopInProgress\|\|!browserConnected\)return;/,
  'a recheck cannot be restarted while browser stop IPC has not settled');
});


test('TASK-017/TEST-022: destructive restore control exposes its local risk explanation', () => {
  const html = readFileSync(join(__dirname, '..', '..', '..', 'app', 'ui', 'index.html'), 'utf8');
  assert.match(html, /<p\s+id="manual-restore-risk"[^>]*>[^<]*将严格比对两者身份与字节/);
  assert.match(html, /<button\s+id="restore-manual-original"\s+type="button"\s+aria-describedby="manual-restore-risk"/);
});


test('TASK-017/TEST-022: manual candidate export control exposes its consent and write-risk explanation', () => {
  const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
  assert.match(html,/<button\s+id="scenario-export-manual"\s+type="button"\s+disabled\s+aria-describedby="scenario-export-risk"/);
  assert.match(html,/<p\s+id="scenario-export-risk"[^>]*>[^<]*独立备份目录持久保存恢复检查点/);
});


test('TASK-017/TEST-022: native import progress ignores stale batches and out-of-order phase receipts',()=>{
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 // Each native batch owns a generation; old in-flight IPC replies must not
 // alter the next batch when its busy flags become true again.
 assert.match(ui,/let nativeImportGeneration=0;/);
 assert.match(ui,/const generation=\+\+nativeImportGeneration;/);
 assert.match(ui,/if\(!activeImport\|\|!nativeImportMode\|\|generation!==nativeImportGeneration\)return;/);
 assert.match(ui,/finally\s*\{\s*nativeImportGeneration\+\+;\s*window\.clearInterval\(poll\)/);
 // Import counters restart at 0 on ANALYZING; compare only within the
 // same phase, and reject late IMPORTING responses after analysis begins.
 assert.match(ui,/const phaseRank:Record<NonNullable<NativeImportProgress\['phase'\]>,number>/);
 assert.match(ui,/if\(incomingRank<currentRank\)return false;/);
 assert.match(ui,/if\(incomingRank===currentRank&&/);
 assert.match(ui,/next\.processed!<current\.processed!/);
 assert.match(ui,/shouldAcceptNativeImportProgress\(liveNativeImportProgress,result\)/);
});

test('TASK-014/017 TEST-015/022: AI review stays disabled until a real read-only scenario observation',()=>{
 const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 assert.match(html,/<button id="ai-reviewed-suggest" type="button" disabled>/,
  'uninspected scenarios must not offer an AI network action on first render');
 assert.match(ui,/const observedScenarioIds=new Set<string>\(\)/);
 assert.match(ui,/result\.ok&&result\.status==='LIMITED_DOM_SIGNAL_ONLY'/);
 assert.match(ui,/observedScenarioIds\.add\(id\)/);
 assert.match(ui,/scenarioInspectId\?\.addEventListener\('change',\(\)=>browserControls\(\)\)/);
 const controls=ui.slice(ui.indexOf('function browserControls():void{'),
  ui.indexOf('async function browserAction('));
 assert.match(controls,/aiReviewButton\.disabled=aiReviewPending\|\|/);
 assert.match(controls,/!observedScenarioIds\.has\(scenarioInspectId\?\.value\?\?''\)/);
 const handler=ui.slice(ui.indexOf("aiReviewButton?.addEventListener('click'"));
 assert.match(handler,/!observedScenarioIds\.has\(id\)/,
  'the disabled property alone is not an authority barrier');
 assert.match(handler,/aiReviewPending=false;browserControls\(\)/);
});

test('TASK-017/TEST-002/026: keyboard navigation keeps the exact trusted IPC frame URL', () => {
  const html = readFileSync(join(process.cwd(), 'app', 'ui', 'index.html'), 'utf8');
  const ui = readFileSync(join(process.cwd(), 'app', 'ui', 'index.ts'), 'utf8');
  const targets = [
    ['import-workspace', '导入脚本'],
    ['scenario-workspace', '测试场景'],
    ['restore-workspace', '手动恢复'],
    ['ai-workspace', 'AI 模型'],
    ['browser-workspace', 'Chrome 诊断']
  ] as const;
  assert.match(html, /<nav\b[^>]*aria-label="工作区导航"[^>]*>/);
  for (const [id, label] of targets) {
    assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) ?? []).length, 1,
      'each focus target must be unique: ' + id);
    assert.ok(html.includes('data-workspace-target="' + id + '">' + label + '</button>'),
      'navigation must use a button instead of a fragment link: ' + label);
    assert.match(html, new RegExp('id="' + id + '"[^>]*tabindex="-1"'),
      'each work area needs a programmatic keyboard focus destination');
    assert.ok(!html.includes('href="#' + id + '"'),
      'fragment navigation would change trustedMainFrame sender URL');
    assert.ok(ui.includes("'" + id + "'"),
      'renderer must recognize each approved work-area ID');
  }
  assert.match(ui, /scrollIntoView\(/);
  assert.match(ui, /\.focus\(\{preventScroll:true\}\)/);
  assert.ok(html.indexOf('aria-label="工作区导航"') < html.indexOf('id="drop-area"'),
    'navigation must precede the long first workflow');
});

test('TASK-017/TEST-002/022: work-area navigation indicates the latest keyboard focus destination without changing the trusted URL',()=>{
 const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const css=readFileSync(join(process.cwd(),'app/ui/index.css'),'utf8');
 for(const id of ['import-workspace','scenario-workspace','restore-workspace',
   'ai-workspace','browser-workspace']){
  assert.match(html,new RegExp('aria-controls="'+id+'" data-workspace-target="'+id+'"'),
   'each navigation control must identify its existing destination for assistive technology');
 }
 assert.ok(ui.includes("button.setAttribute('aria-current','location')"),
  'the active work-area jump must expose a current location to assistive technology');
 assert.ok(ui.includes("otherButton.removeAttribute('aria-current')"),
  'a later jump must remove stale location announcements from other buttons');
 assert.ok(css.includes('nav[aria-label="工作区导航"] button[aria-current="location"]'),
  'the location currently selected with a navigation button needs a visible cue');
 assert.ok(ui.includes('area.focus({preventScroll:true})'),
  'a navigation state indicator cannot replace actual keyboard focus transfer');
 assert.ok(!ui.includes('location.hash=')&&!ui.includes('history.pushState(')&&
   !ui.includes('history.replaceState('),
  'the navigation indication must not mutate the exact trusted Electron file URL');
});

test('TASK-017/TEST-002/022: packaged desktop workspace styling preserves focus and narrow windows',()=>{
 const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
 const css=readFileSync(join(process.cwd(),'app/ui/index.css'),'utf8');
 const assets=readFileSync(join(process.cwd(),'scripts/copy-assets.cjs'),'utf8');
 assert.match(html,/<link rel="stylesheet" href="\.\/index\.css">/,
  'CSP-safe styles must load from the local packaged renderer');
 assert.match(assets,/copyFileSync\(join\(__dirname, '\.\.', 'app', 'ui', 'index\.css'\), join\(target, 'index\.css'\)\)/,
  'the packaged Electron renderer must include its stylesheet');
 assert.match(css,/:focus-visible\s*\{/,
  'keyboard focus must be visually apparent');
 assert.match(css,/:disabled\b/,
  'disabled operations must remain distinguishable from active actions');
 assert.match(css, /@media\s*\(max-width:\s*640px\)/,
  'narrow desktop windows must preserve reachable controls');
 assert.match(css,/overflow-wrap:\s*anywhere/,
  'opaque evidence and long text must not create horizontal overflow');
 assert.doesNotMatch(html,/<style\b|\sstyle=/,
  'keep the renderer CSP free from inline styling');
});

test('TASK-017/TEST-002/022: imported workspace has an accessible heading without decorative navigation text', () => {
  const html = readFileSync(join(process.cwd(), 'app/ui/index.html'), 'utf-8');
  // This structural check does not claim a rendered Electron or screen-reader test.
  assert.match(html, /<section id="import-workspace" tabindex="-1" aria-labelledby="import-heading">\s*<h2 id="import-heading">导入油猴脚本（只读）<\/h2>/);
  const navigation = html.match(/<nav aria-label="工作区导航">([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(navigation, 'existing workspace navigation remains present');
  const targets = [...navigation.matchAll(/data-workspace-target="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(targets, [
    'import-workspace', 'scenario-workspace', 'restore-workspace',
    'ai-workspace', 'browser-workspace'
  ]);
  assert.doesNotMatch(navigation, /<\/button>\s*·/, 'flex navigation uses spacing, not extra spoken separators');
});

test('TASK-017/TEST-002/022: second drag/drop batch is rejected visibly without reading files', () => {
  const ui = readFileSync(join(process.cwd(), 'app/ui/index.ts'), 'utf8');
  const start = ui.indexOf("dropZone?.addEventListener('drop', event => {");
  const end = ui.indexOf("void locked(async () => {", start);
  assert.ok(start >= 0 && end > start, 'drop handler and the exclusive import lock exist');
  const preLock = ui.slice(start, end);
  assert.match(preLock, /event\.preventDefault\(\)/,
    'a busy drop must not cause Chromium to navigate to the dropped file');
  assert.match(preLock, /if \(busy\)\s*\{[\s\S]*?logLine\('当前仍在导入；本次拖放未接收，请等待完成后重新拖放。'\);\s*return;\s*\}/,
    'a second batch must be explicitly refused before any transfer enumeration');
  assert.doesNotMatch(preLock, /filesFromDrop\(/,
    'a rejected batch must never read a file or traverse a directory');
});

test('TASK-017/TEST-002/022: bounded dropped-folder scan retains discovered files and reports unknown remainder',()=>{
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const start=ui.indexOf('async function filesFromDrop(');
 const end=ui.indexOf("cancelImport?.addEventListener('click'",start);
 assert.ok(start>=0&&end>start,'the bounded dropped-directory enumerator is present');
 const scan=ui.slice(start,end);
 assert.match(scan,/let scanLimitReached=false;/,
  'the directory cap needs explicit state rather than throwing away the collected batch');
 assert.match(scan,/if\s*\([^)]*scanLimitReached\)\s*break;/,
  'scan must stop enumerating new roots or entries after reaching a cap');
 assert.match(scan,/scanLimitReached=true;/,
  'both file-count and visited-entry limits must end the scan');
 assert.doesNotMatch(scan,/throw new Error\('SCAN_LIMIT'\)/,
  'a bounded scan is expected partial input, not a total import error');
 assert.match(scan,/logLine\('拖放扫描达到上限；已发现 '/,
  'the user must see that a partial batch was accepted');
 assert.match(scan,/其余未扫描文件数量未知/,
  'never invent the number of unenumerated entries');
 assert.match(scan,/return found;/,
  'safe already-discovered files must remain eligible for native validation');
});


test('TASK-017/TEST-022: isolated Chrome profile warnings are tied to profile and launch controls',()=>{
 const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
 assert.match(html,/<p id="chrome-profile-safety">[^<]*不允许使用日常 Chrome Profile/,
  'the existing warning must be identifiable without replacing its approved safety copy');
 for(const id of ['choose-profile','create-profile','launch-chrome']){
  assert.match(html,new RegExp('<button id="'+id+'" type="button" aria-describedby="chrome-profile-safety">'),
   'the Chrome safety warning must be available from the '+id+' control');
 }
});


/** TASK-017 / TEST-002/022: evaluate the REAL renderer history event
 * handlers against out-of-order native IPC replies. This isolated harness
 * cannot confer native browser, manager or script-write authority.
 */
test('TASK-017/TEST-002/022: switching history scenarios ignores stale IPC replies and permits a fresh query',async()=>{
 const {runInNewContext}=await import('node:vm');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const start=ui.indexOf("scenarioHistoryButton?.addEventListener('click'");
 const end=ui.indexOf('// Explicitly user-started bounded monitoring',start);
 assert.ok(start>=0&&end>start,'real read-only history handler must be present');
 const handlers=new Map<string,()=>void>();
 const selectHandlers=new Map<string,()=>void>();
 const button={addEventListener:(name:string,fn:()=>void)=>handlers.set(name,fn)};
 const selector={value:'scenario-A',
  addEventListener:(name:string,fn:()=>void)=>selectHandlers.set(name,fn)};
 const summary={textContent:''};
 const rows:{textContent:string}[]=[];
 const entries={
  replaceChildren:()=>{rows.length=0;},
  append:(node:{textContent:string})=>{rows.push(node);}
 };
 const pending=new Map<string,(value:unknown)=>void>();
 const requested:string[]=[];
 runInNewContext(ui.slice(start,end),{
  scenarioHistoryButton:button,scenarioInspectId:selector,
  scenarioHistoryBusy:false,scenarioHistoryGeneration:0,
  scenarioHistorySummary:summary,scenarioHistoryEntries:entries,
  browserControls:()=>undefined,
  window:{healer:{readScenarioHistory:(id:string)=>{
   requested.push(id);
   return new Promise(resolve=>{pending.set(id,resolve);});
  }}},
  document:{createElement:()=>({textContent:''})}
 });
 const flush=async()=>new Promise<void>(resolve=>setImmediate(resolve));
 handlers.get('click')?.();
 assert.deepEqual(requested,['scenario-A']);
 selector.value='scenario-B';
 selectHandlers.get('change')?.();
 assert.equal(rows.length,0,'old results must be cleared when the scenario changes');
 handlers.get('click')?.();
 assert.deepEqual(requested,['scenario-A','scenario-B'],
  'selection change must retire the old read lock, without waiting for stale IPC');
 const view=(status:'ELEMENT_FOUND_ONLY'|'INDETERMINATE')=>({
  ok:true,status:'UNVERIFIED_SESSION_HISTORY_ONLY',
  currentStatus:status,archiveRetained:false,
  events:[{observedAtMs:2000,status}]
 });
 pending.get('scenario-B')?.(view('ELEMENT_FOUND_ONLY'));
 await flush();
 assert.match(summary.textContent,/仅观察到元素存在/);
 assert.equal(rows.length,1);
 pending.get('scenario-A')?.(view('INDETERMINATE'));
 await flush();
 assert.match(summary.textContent,/仅观察到元素存在/,
  'late A response must never overwrite selected B current-health label');
 assert.equal(rows.length,1,'late A response must never append B-panel history');
 assert.match(rows[0].textContent,/DOM 元素存在/);
});

/** TASK-017/014 / TEST-022/016: execute the real renderer handler with
 * deferred, native IPC replies. Switching A -> B -> A must NOT allow the
 * first A response to be mistaken for a fresh recommendation.
 * This tests renderer presentation, not permission to call a model.
 */
test('TASK-017/014 TEST-022/016: stale AI replies after selection ABA cannot repaint a later scenario view',async()=>{
 const {runInNewContext}=await import('node:vm');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const start=ui.indexOf("aiReviewButton?.addEventListener('click'");
 const end=ui.indexOf('/** Work-area buttons',start);
 assert.ok(start>=0&&end>start,'real reviewed-AI renderer handler must be present');
 const buttonHandlers=new Map<string,()=>void>();
 const selectHandlers=new Map<string,()=>void>();
 const button={disabled:false,addEventListener:(name:string,fn:()=>void)=>buttonHandlers.set(name,fn)};
 const selector={value:'scenario-A',
  addEventListener:(name:string,fn:()=>void)=>selectHandlers.set(name,fn)};
 const result={textContent:''};
 const calls:{id:string;resolve:(value:unknown)=>void}[]=[];
 runInNewContext(ui.slice(start,end),{
  aiReviewButton:button,aiReviewPending:false,aiReviewGeneration:0,
  browserBusy:false,stopInProgress:false,scenarioInspectionBusy:false,
  scenarioInspectId:selector,observedScenarioIds:new Set(['scenario-A','scenario-B']),
  aiReviewResult:result,browserControls:()=>undefined,
  window:{healer:{requestNativeAiReview:(id:string)=>new Promise(resolve=>{
   calls.push({id,resolve});
  })}}
 });
 const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
 buttonHandlers.get('click')?.();
 assert.equal(calls.length,1);
 assert.equal(calls[0].id,'scenario-A');
 selector.value='scenario-B';selectHandlers.get('change')?.();
 selector.value='scenario-A';selectHandlers.get('change')?.();
 calls[0].resolve({ok:true,model:'prior-model',candidateText:'STALE_PRIVATE_ADVICE'});
 await flush();
 assert.doesNotMatch(result.textContent,/STALE_PRIVATE_ADVICE/,
  'a superseded AI request must never repaint the new selection, even after A-B-A');
 buttonHandlers.get('click')?.();
 assert.equal(calls.length,2,'the current scenario can request a fresh, separately authorized review');
 assert.equal(calls[1].id,'scenario-A');
 calls[1].resolve({ok:true,model:'current-model',candidateText:'FRESH_REVIEW_ADVICE'});
 await flush();
 assert.match(result.textContent,/FRESH_REVIEW_ADVICE/,
  'the freshly requested result may appear for the unchanged selected scenario');
});

test('TASK-017/TEST-022: scenario registration consent exposes scope to assistive technology', () => {
  const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
  assert.match(html, /<p id="scenario-consent-scope">[^<]*不会访问目标网站、执行脚本、保存凭据或验证 Tampermonkey/);
  assert.match(html, /<input id="scenario-approve" type="checkbox" aria-describedby="scenario-consent-scope">/);
});

test('TASK-017/TEST-002/022: scenario consent gates enabled registration and native dispatch',()=>{
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const start=ui.indexOf('function updateScenarioControls():void{');
 const end=ui.indexOf('\nlet busy = false;',start);
 assert.ok(start>=0&&end>start,'the existing scenario control updater must remain');
 const controls=ui.slice(start,end);
 assert.match(controls,/scenarioRegister\.disabled\s*=\s*[^;]*scenarioApprove\?\.checked\s*!==\s*true/,
  'a loaded script alone must not enable registration without explicit consent');
 assert.match(ui,/scenarioApprove\?\.addEventListener\('change',\s*updateScenarioControls\)/,
  'checking or revoking consent must refresh the disabled state immediately');
 const click=ui.indexOf("scenarioRegister?.addEventListener('click'");
 assert.ok(click>=0,'native registration click handler must remain');
 const handlerStart=ui.slice(click,click+240);
 assert.match(handlerStart,/if\([^\n]*scenarioApprove\?\.checked\s*!==\s*true\)return;/,
  'a forged click event cannot dispatch native registration without current consent');
});

/** TASK-017 / TEST-002/022: the real renderer must not display an old
 * scenario's asynchronous inspection reply after the user selects another.
 * UI presentation only: native browser authorization stays untouched.
 */
test('TASK-017/TEST-022: switching inspected scenarios retires stale DOM results',async()=>{
 const {runInNewContext}=await import('node:vm');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const handlerStart=ui.indexOf("scenarioInspectButton?.addEventListener('click'");
 const generationStart=ui.indexOf('let scenarioInspectionGeneration=0;');
 const start=generationStart>=0?generationStart:handlerStart;
 const end=ui.indexOf("manualRestoreButton?.addEventListener('click'",start);
 assert.ok(handlerStart>=0&&end>handlerStart,
  'real DOM inspection event handler is present');
 const clicks=new Map<string,()=>void>();
 const changes=new Map<string,()=>void>();
 const button={addEventListener:(event:string,handler:()=>void)=>clicks.set(event,handler)};
 const selection={value:'scenario-A',
  addEventListener:(event:string,handler:()=>void)=>changes.set(event,handler)};
 const status={textContent:''};
 const pending:{id:string;resolve:(reply:unknown)=>void}[]=[];
 const observed=new Set<string>();
 let busy=false;
 runInNewContext(ui.slice(start,end),{
  scenarioInspectButton:button,scenarioInspectId:selection,scenarioStatus:status,
  scenarioInspectionBusy:false,scenarioInspectionGeneration:0,
  browserControls:()=>undefined,browserConnected:true,observedScenarioIds:observed,
  browserAction:async(fn:()=>Promise<void>)=>{if(busy)return;busy=true;
   try{await fn();}finally{busy=false;}},
  window:{healer:{inspectScenario:(id:string)=>new Promise(resolve=>{
   pending.push({id,resolve});
  })}}
 });
 const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
 const inspected=(id:string)=>({
  ok:true,status:'LIMITED_DOM_SIGNAL_ONLY',checkedAssertions:1,
  faultCategory:'UNKNOWN',triageStatus:'INCONCLUSIVE',evidenceCount:1,
  sessionHealthStatus:'INDETERMINATE',
  localArchiveStatus:'UNAVAILABLE',tampermonkeyVerified:false,
  businessVerified:false,automaticPatchAllowed:false,code:id
 });
 clicks.get('click')?.();
 assert.equal(pending.length,1);
 assert.equal(pending[0].id,'scenario-A');
 selection.value='scenario-B';
 assert.ok(changes.has('change'),'changing the selection must invalidate the pending reply');
 changes.get('change')?.();
 assert.match(status.textContent,/已切换场景/);
 pending[0].resolve(inspected('scenario-A'));
 await flush();
 assert.doesNotMatch(status.textContent,/场景 scenario-A：/);
 assert.equal(observed.has('scenario-A'),true,
  'a completed native inspection may retain its own scoped receipt');
 assert.match(status.textContent,/已切换场景/,
  'a stale response must not repaint the newly selected scenario');
 clicks.get('click')?.();
 assert.equal(pending.length,2);
 assert.equal(pending[1].id,'scenario-B');
 pending[1].resolve(inspected('scenario-B'));
 await flush();
 assert.match(status.textContent,/场景 scenario-B：/);
});

/** TASK-017 / TEST-002/022: registration consent is per dispatch, never a
 * persistent toggle authorizing a later registration without a new gesture.
 * Exercise the real renderer handler, not a duplicate example implementation.
 */
test('TASK-017/TEST-022: registration consumes consent before native IPC and requires fresh approval',async()=>{
 const {runInNewContext}=await import('node:vm');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const start=ui.indexOf("scenarioRegister?.addEventListener('click'");
 const end=ui.indexOf("// Native browser actions never expose",start);
 assert.ok(start>=0&&end>start,'real registration event handler remains available');
 const callbacks=new Map<string,()=>void>();
 const register={disabled:false,addEventListener:(name:string,fn:()=>void)=>callbacks.set(name,fn)};
 const approve={checked:true};
 const script={value:'a'.repeat(64)};
 const status={textContent:''};
 const pending:{input:{userApproved:boolean};resolve:(value:unknown)=>void}[]=[];
 const items:{textContent:string}[]=[];
 const document={createElement:()=>({textContent:''})};
 const context={
  scenarioRegister:register,scenarioBusy:false,scenarioApprove:approve,
  scenarioScript:script,scenarioId:{value:'approved-scene'},
  scenarioUrl:{value:'https://example.com'},scenarioSelector:{value:'#approved'},
  scenarioReplacement:null,scenarioNeedsLogin:null,scenarioLoginReady:null,
  scenarioStatus:status,scenarioInspectId:null,scenarioList:{append:(v:{textContent:string})=>items.push(v)},
  updateScenarioControls:()=>{register.disabled=!approve.checked;},
  browserControls:()=>undefined,document,
  window:{healer:{registerScenario:(input:{userApproved:boolean})=>new Promise(resolve=>{
   pending.push({input,resolve});
  })}}
 };
 runInNewContext(ui.slice(start,end),context);
 const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
 callbacks.get('click')?.();
 assert.equal(pending.length,1);
 assert.equal(pending[0].input.userApproved,true,
  'the explicit approval must reach only the dispatched native registration');
 assert.equal(approve.checked,false,
  'one-shot approval must be cleared synchronously before the pending IPC reply');
 pending[0].resolve({ok:true,status:'STAGED_RUNTIME_UNVERIFIED',
  state:'REGISTERED_UNVERIFIED',id:'approved-scene',readOnlyDomEligible:false});
 await flush();
 callbacks.get('click')?.();
 assert.equal(pending.length,1,
  'a second registration must not inherit consent from the previous successful request');
 approve.checked=true;
 callbacks.get('click')?.();
 assert.equal(pending.length,2,'a fresh approval permits a fresh authorized request');
 pending[1].resolve({ok:false,code:'REJECTED'});
 await flush();
 assert.equal(approve.checked,false,
  'a failed native registration must not preserve the next attempt authorization');
});


/** TASK-017/015 / TEST-022/024/026: the user selected scenario is the
 * scope of an expressly started recheck plan. Changing the selection must
 * revoke the old plan, including an in-flight read-only native observation.
 * This harness runs the actual renderer handlers, not a parallel mock policy.
 */
test('TASK-017/015: switching scenarios stops pending native rechecks and never visits the old choice again',async()=>{
 const {runInNewContext}=await import('node:vm');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const start=ui.indexOf("scenarioRecheckStartButton?.addEventListener('click'");
 const end=ui.indexOf('let scenarioInspectionGeneration=0;',start);
 assert.ok(start>=0&&end>start,'real bounded recheck renderer handlers exist');
 const actions=new Map<string,()=>void>(),selections=new Map<string,()=>void>();
 const button=(store:Map<string,()=>void>)=>({addEventListener:(name:string,fn:()=>void)=>store.set(name,fn)});
 const selector={value:'scenario-A',addEventListener:(name:string,fn:()=>void)=>selections.set(name,fn)};
 const status={textContent:''};
 const calls:string[]=[];
 let finishNative:(value:unknown)=>void=()=>undefined;
 let cancelCount=0;
 const sandbox:{
  [key:string]:unknown;
  recheckCancelled:boolean;recheckRunning:boolean;recheckNativeActive:boolean
 }={
  scenarioRecheckStartButton:button(actions),scenarioRecheckStopButton:button(new Map()),
  scenarioInspectId:selector,scenarioRecheckStatus:status,
  browserBusy:false,stopInProgress:false,browserConnected:true,
  recheckRunning:false,recheckCancelled:false,recheckNativeActive:false,
  RECHECK_MAX_ROUNDS:3,
  revokeBoundedRechecks:()=>{sandbox.recheckCancelled=true;},
  waitRecheckInterval:()=>Promise.resolve(),
  browserControls:()=>undefined,observedScenarioIds:new Set(),
  window:{healer:{
   inspectScenario:(id:string)=>{calls.push(id);return new Promise(resolve=>{finishNative=resolve;});},
   cancelScenarioInspection:()=>{cancelCount++;return Promise.resolve({ok:true});}
  }}
 };
 runInNewContext(ui.slice(start,end),sandbox);
 actions.get('click')?.();
 assert.deepEqual(calls,['scenario-A'],'the first approved round uses the selected script');
 selector.value='scenario-B';selections.get('change')?.();
 assert.equal(sandbox.recheckCancelled,true,
  'changing selection must immediately revoke all future rounds');
 assert.equal(cancelCount,1,'pending native observation must receive cancellation request');
 finishNative({ok:true,status:'LIMITED_DOM_SIGNAL_ONLY',localArchiveStatus:'SAVED_UNVERIFIED'});
 await new Promise<void>(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,['scenario-A'],
  'an old scenario must not receive a second native visit after selection changes');
 assert.equal(sandbox.recheckRunning,false);
 assert.match(status.textContent,/停止|取消/,
  'the user needs a visible stop or cancellation confirmation, not a success claim');
});
