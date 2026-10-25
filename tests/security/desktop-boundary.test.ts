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
 'app:status','browser:choose-chrome','browser:choose-profile',
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
 assert.match(main,/archiveRetained:true/);
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
