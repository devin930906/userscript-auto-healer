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


/** Exact IPC inventory: dropped-file batches use only three narrow lifecycle
 * channels, not an arbitrary renderer gateway. */
const approvedIpcChannels=[
 'ai:discover-native','ai:review-native','app:status','browser:choose-chrome','browser:choose-profile',
 'browser:connect-existing','browser:create-profile','browser:disconnect-existing',
 'browser:open-tampermonkey-store','browser:start','browser:stop',
 'browser:tampermonkey-hint','config:validate','gm-probe:observe',
 'gm-probe:save-report','gm-probe:start','gm-probe:status','gm-probe:stop',
  'gm-probe:visit','import:cancel-dropped','import:cancel-native',
  'import:dropped','import:dropped-batch:acknowledge','import:dropped-batch:add',
  'import:dropped-batch:begin','import:dropped-batch:finish','import:dropped-batch:recover',
  'import:files','import:folder','import:get-progress',
 'restore:inspect-intent','restore:inspect-inventory','restore:manual-original','scenario:cancel',
 'scenario:diagnose-imported-batch','scenario:export-imported-candidate','scenario:export-manual',
 'scenario:history','scenario:inspect','scenario:register'
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
  assert.match(main,/authorizeSender\(event\);\s*const controller=droppedImportController;\s*const pending=pendingDroppedImportRecovery;\s*if\(!controller\|\|\(pending\?\.controller===controller&&pending\.settled\)\)/);
  assert.match(main,/pending\?\.controller===controller&&pending\.settled/,
    'an in-flight read-only analysis remains cancelable until its summary settles');
  assert.match(main, /ipcMain\.handle\('import:dropped-batch:recover',async event=>\{\s*authorizeSender\(event\)/);
  assert.match(main, /ipcMain\.handle\('import:dropped-batch:acknowledge',\(event,recoveryId:unknown\)=>\{\s*authorizeSender\(event\)/);
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
  assert.match(main,/function createNativeAiDesktopSelection\(/);
  assert.match(main,/selectConfigFile:async\(\)=>/);
  assert.match(main,/readConfigFile:readNativeSelectedAiConfig/);
  assert.match(main,/rememberSelectedPath:path=>saveRememberedPath\('ai',path\)/);
  assert.match(main,/discoverNativeAiModelsFromDesktop\(selection,async origin=>/);
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
  assert.match(main,/createNativeAiDesktopSelection\(win,/);
  assert.match(main,/requestNativeAiSuggestionFromDesktop\(\s*selection,evidence,authorize,controller\.signal\)/);
  assert.ok(main.includes('formatNativeAiReviewDisclosure(origin,review,target)'));
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
  assert.match(preload, /connectExistingChrome: \(port: number\): Promise<unknown> => ipcRenderer\.invoke\('browser:connect-existing', port\)/);
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\('browser:connect-existing',\s*(?:config|path|url|pid|endpoint|\{)/,
    'external Chrome IPC accepts a numeric port, not a path or endpoint object');
  assert.match(preload, /disconnectExistingChrome: \(\): Promise<unknown> => ipcRenderer\.invoke\('browser:disconnect-existing'\)/);
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\('browser:disconnect-existing',\s*[^)]/);
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

test('TASK-013/TEST-026: dropped batch IPC is main-owned, frame-authorized and path-free',()=>{
  const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
  const preload=readFileSync(join(process.cwd(),'app/preload/index.ts'),'utf8');
  const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
  assert.ok(/ipcMain\.handle\('import:dropped-batch:begin',\s*event\s*=>\s*\{\s*authorizeSender\(event\)/.test(main),
    'batch start must authorize the main frame');
  assert.ok(/ipcMain\.handle\('import:dropped-batch:add',\s*\(event,\s*batchId:\s*unknown,\s*name:\s*unknown,\s*data:\s*unknown\)\s*=>\s*\{\s*authorizeSender\(event\)/.test(main),
    'each byte append must authorize the main frame');
  assert.ok(/ipcMain\.handle\('import:dropped-batch:finish',\s*async\s*\(event,\s*batchId:\s*unknown\)\s*=>\s*\{\s*authorizeSender\(event\)/.test(main),
    'batch finish must authorize the main frame');
  assert.ok(/batchId\s*=\s*randomUUID\(\)/.test(main),'the main process must create batch IDs');
  assert.ok(/session\.id\s*!==\s*batchId/.test(main),'append/finalize must reject stale batch IDs');
  assert.ok(/beginDroppedImportBatch:\s*\(\): Promise<unknown> => ipcRenderer\.invoke\('import:dropped-batch:begin'\)/.test(preload));
  assert.ok(/addDroppedImportBatch:\s*\(batchId: string, name: string, bytes: Uint8Array\): Promise<unknown> => ipcRenderer\.invoke\('import:dropped-batch:add', batchId, name, bytes\)/.test(preload));
  assert.ok(/finishDroppedImportBatch:\s*\(batchId: string\): Promise<unknown> => ipcRenderer\.invoke\('import:dropped-batch:finish', batchId\)/.test(preload));
  assert.doesNotMatch(preload,/ipcRenderer\.invoke\('import:dropped-batch:(?:begin|add|finish)',[^)]*(?:path|url|sourcePath)/i);
  assert.ok(/window\.healer\.beginDroppedImportBatch\(\)/.test(ui),'renderer file inputs must start one batch');
  assert.ok(/window\.healer\.finishDroppedImportBatch\(batchId\)/.test(ui),'renderer file inputs must finalize once');
  assert.ok(!/window\.healer\.importDropped\(file\.name,\s*bytes\)/.test(ui),
    'renderer must not launch one IPC analysis job per file');
});

test('TASK-013/TEST-022/026: Windows shell drop smoke targets the rendered drop area',()=>{
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
 assert.match(html,/<div id="drop-area">/,
  'the application must keep an identifiable file drop area');
 const smokeStart=main.indexOf('const droppedCheckpointSmokeState=');
 assert.notEqual(smokeStart,-1,'the package smoke must exercise a dropped batch');
 const smokeEnd=main.indexOf(') as string;',smokeStart);
 assert.ok(smokeEnd>smokeStart,'the package drop assertion must stay bounded');
 const smoke=main.slice(smokeStart,smokeEnd+12);
 assert.match(smoke,/const zone=document\.getElementById\('drop-area'\)/,
  'the shell smoke must dispatch through the same drop area used by the renderer');
 assert.match(smoke,/\n\s*true\s*\n\s*\) as string;/,
  'the synthetic native drop must run with the browser user-gesture flag');
 assert.doesNotMatch(smoke,/const zone=document\.getElementById\('drop-zone'\)/,
  'a stale test-only selector must not silently skip the real drop event');
});

test('TASK-013/TEST-022/026: checkpoint smoke waits for its own completed dropped batch',()=>{
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const smokeStart=main.indexOf('const droppedCheckpointSmokeState=');
 const smokeEnd=main.indexOf('rmSync(fixtureDir',smokeStart);
 assert.ok(smokeStart>=0&&smokeEnd>smokeStart,
  'the checkpoint smoke must remain a bounded, independently inspectable block');
 const smoke=main.slice(smokeStart,smokeEnd);
  assert.match(smoke,/text\.startsWith\(fileName\+': '\)/,
  'checkpoint visibility must belong to the unique file sent by this drop');
 assert.match(smoke,/text\.includes\('只读 AST 批处理检查点已保存'\)/,
  'the unique dropped file must finish the checkpointed import before the smoke passes');
 assert.match(smoke,/document\.getElementById\('choose-files'\)\?\.disabled===false/,
  'the smoke must wait for the renderer import lock to be released');
 assert.match(smoke,/document\.getElementById\('cancel-import'\)\?\.disabled===true/,
  'the smoke must wait until its current batch has fully settled');
 assert.match(main,/SHELL_SMOKE_DROPPED_BATCH_/,
  'Windows failures must expose the bounded drop-smoke diagnostic stage');
});

test('TASK-013/TEST-022/026: checkpoint smoke correlates its status with new file-specific rows',()=>{
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const smokeStart=main.indexOf('const droppedCheckpointSmokeState=');
 const smokeEnd=main.indexOf('rmSync(fixtureDir',smokeStart);
 assert.ok(smokeStart>=0&&smokeEnd>smokeStart);
 const smoke=main.slice(smokeStart,smokeEnd);
 assert.match(smoke,/const priorCount=document\.querySelectorAll\('#import-list li'\)\.length/,
  'the smoke must ignore historical import log rows');
 assert.match(smoke,/\.slice\(priorCount\)/,
  'the checkpoint result must be read only from rows appended by this batch');
 assert.match(smoke,/const nonce=Date\.now\(\)\.toString\(36\)\+Math\.random\(\)\.toString\(36\)\.slice\(2\)/,
  'the fixture bytes and name must not match a checkpoint from an earlier run');
 assert.match(smoke,/text\.startsWith\(fileName\+': '\)/,
  'the unique fixture name must be the one reported as imported');
});

test('TASK-013/TEST-022/026: renderer teardown hooks release the active dropped batch',()=>{
  const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
  const cleanup=main.match(/function abortDroppedImportForWindow\(win:BrowserWindow\):void\{[\s\S]*?\n\}/)?.[0]??'';
  assert.ok(cleanup.includes('const session=droppedImportBatchSession;')&&cleanup.includes('session.batch.finish()'),
    'teardown must discard staged source bytes');
  assert.ok(cleanup.includes('droppedImportBatchSession=null'),
    'teardown must release the batch session ID');
  assert.ok(cleanup.includes('controller.abort()')&&cleanup.includes('droppedImportController=null'),
    'teardown must cancel analysis and release the busy lock');
  assert.match(main,/win\.webContents\.on\('render-process-gone',\(\)=>\{[\s\S]*?nativeImportController\?\.abort\(\);[\s\S]*?abortDroppedImportForWindow\(win\);[\s\S]*?\}\);/,
    'renderer process loss must revoke native imports and clean up dropped batches');
  assert.ok(/win\.webContents\.on\('did-start-navigation',[\s\S]*?if\(isMainFrame&&!isInPlace\)[\s\S]*?abortDroppedImportForWindow\(win\)/.test(main),
    'main-frame reload must clean up its batch');
  assert.match(main,/if\(isMainFrame&&!isInPlace\)\{[\s\S]*?nativeImportController\?\.abort\(\);[\s\S]*?abortDroppedImportForWindow\(win\);/,
    'only full main-frame navigation revokes native imports and handles dropped recovery');
  assert.match(main,/win\.webContents\.on\('did-finish-load',[\s\S]*?pending\.ready=true/,
    'a pending result becomes recoverable only after the replacement document loads');
  assert.match(main,/pending\.frameEpoch!==mainFrameNavigationEpoch/,
    'recovery and acknowledgement receipts must belong to the current document epoch');
});

test('TASK-013/TEST-022/026: reload recovers an accepted dropped batch instead of losing it',()=>{
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const preload=readFileSync(join(process.cwd(),'app/preload/index.ts'),'utf8');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 assert.match(main,/ipcMain\.handle\('import:dropped-batch:recover'/,
  'the next main frame must be able to recover the completed main-owned batch summary');
 assert.match(main,/pendingDroppedImportRecovery/,
  'teardown must retain a bounded summary until the renderer acknowledges it');
 assert.match(preload,/recoverDroppedImportBatch:\s*\(\): Promise<unknown> => ipcRenderer\.invoke\('import:dropped-batch:recover'\)/,
  'recovery bridge must take no renderer-supplied ID, path, bytes or hash');
  assert.match(preload,/acknowledgeDroppedImportRecovery:\s*\(recoveryId: string\): Promise<unknown> =>\s*ipcRenderer\.invoke\('import:dropped-batch:acknowledge', recoveryId\)/,
   'acknowledgement may only return the main-issued recovery receipt');
  assert.match(main,/acknowledgeDroppedImportRecovery,addDroppedImportBatch/);
  assert.match(main,/recoverDroppedImportBatch,registerScenario,requestNativeAiReview/,
   'the package smoke preload-key inventory must include both bounded recovery methods');
 const preloadStart=preload.indexOf("contextBridge.exposeInMainWorld('healer', Object.freeze({");
 const preloadEnd=preload.indexOf('\n}));',preloadStart);
 assert.ok(preloadStart>=0&&preloadEnd>preloadStart,
  'inspect only the actual exposed healer bridge');
 const exportedKeys=[...preload.slice(preloadStart,preloadEnd).matchAll(/^  ([A-Za-z_]\w*):/gm)]
  .map(match=>match[1]).sort();
 const smokeInventory=main.match(/if \(probe\.keys\?\.join\(','\) !==\s*'([^']+)'\)/);
 assert.ok(smokeInventory,'the Windows shell smoke must retain its runtime preload inventory check');
 assert.deepEqual(smokeInventory[1].split(','),exportedKeys,
  'the smoke allowlist must exactly match the sorted runtime preload exports');
 assert.match(ui,/recoverDroppedImportBatch\(\)[\s\S]*?show\(recovered\.result\)/,
  'the reloaded renderer must render the previously accepted import result');
  assert.match(ui,/acknowledgeDroppedImportRecovery\(recovered\.recoveryId\)/,
   'the renderer must acknowledge the displayed recovery before the main process releases it');
 const reloadSmokeStart=main.indexOf('const abandonedDroppedBatch=');
 const reloadSmokeEnd=main.indexOf('const receipt = process.env.UAH_SMOKE_RECEIPT',reloadSmokeStart);
 assert.ok(reloadSmokeStart>=0&&reloadSmokeEnd>reloadSmokeStart,
  'the reload smoke must retain a bounded batch recovery scenario');
 const smoke=main.slice(reloadSmokeStart,reloadSmokeEnd);
 assert.match(smoke,/abandoned\.user\.js:/,
  'reload smoke must verify the accepted file is present in the new renderer');
  assert.match(smoke,/const recoveryNonce=Date\.now\(\)\.toString\(36\)\+Math\.random\(\)\.toString\(36\)\.slice\(2\)/,
   'the reload fixture must have a fresh byte identity across packaging runs');
 assert.match(smoke,/只读 AST 批处理检查点已保存/,
  'reload smoke must verify the recovered batch reached its read-only checkpoint');
  assert.match(smoke,/acknowledgeDroppedImportRecovery/,
   'reload smoke must acknowledge the recovered receipt');
  assert.match(smoke,/IMPORT_RECOVERY_PENDING/,
   'reload smoke must confirm that the receipt acknowledgement releases the next batch');
 assert.doesNotMatch(smoke,/finished\.scripts\.length===0/,
  'reload smoke must not pass by starting an unrelated empty batch');
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

test('TASK-013/TEST-023/026: imported candidate export uses a one-use main-only capability and native file identity',()=>{
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const preload=readFileSync(join(process.cwd(),'app/preload/index.ts'),'utf8');
 assert.ok(preload.includes("exportImportedDomCandidate: (candidateId: string): Promise<unknown> => ipcRenderer.invoke('scenario:export-imported-candidate',candidateId)"),
  'renderer may pass only the opaque candidate ID');
 assert.doesNotMatch(preload,/ipcRenderer\.invoke\('scenario:export-imported-candidate',[^)]*(?:path|source|scenario|url|selector|consent|sha256)/i);
 assert.match(main,/ImportedDomCandidateExportStore/);
 assert.match(main,/ImportedDomCandidateManualExportContext/);
 assert.match(main,/ipcMain\.handle\('scenario:export-imported-candidate',async\(event,id:unknown,\.\.\.args:unknown\[\]\)=>\{\s*authorizeSender\(event\)/);
 const start=main.indexOf("ipcMain.handle('scenario:export-imported-candidate'");
 const end=main.indexOf("ipcMain.handle('scenario:cancel'",start);
 assert.ok(start>=0&&end>start,'the native export handler must remain a separately auditable block');
 const handler=main.slice(start,end);
 assert.match(handler,/if\(args\.length!==0\)/,
  'the handler rejects appended renderer authority arguments');
 assert.match(handler,/nativeAiDiscoveryBusy/,
  'candidate native dialogs must not overlap a native AI discovery dialog');
 assert.match(handler,/importedDomCandidateExportStore\.reserve\(win,id\)/,
  'the capability is owner-bound and reserved before asynchronous dialogs');
 assert.match(handler,/dialog\.showOpenDialog\(win,[\s\S]*?properties:\['openFile'\]/,
  'the main process asks the OS to reselect the source file');
 assert.match(handler,/importApprovedPaths\(\[sourcePath\],controller\.signal\)/,
  'the selected file is re-read through the existing import validator');
 assert.match(handler,/current\.scripts\[0\]\.filename!==capability\.filename/,
  'the selected filename must match the imported batch identity');
 assert.match(handler,/current\.scripts\[0\]\.sha256!==capability\.context\.originalSha256/,
  'the selected bytes must match the reviewed source hash');
 assert.match(handler,/properties:\['openDirectory'\]/,
  'backup and export destinations must come from native directory pickers');
 const confirmation=handler.indexOf('const approved=await dialog.showMessageBox');
 const consume=handler.indexOf('importedDomCandidateExportStore.consume(win,id)');
 const write=handler.indexOf('exportReviewedImportedCandidateOnly(');
 assert.ok(confirmation>=0&&consume>confirmation&&write>consume,
  'the one-use capability is consumed only after final native confirmation and immediately before file staging');
 assert.match(handler,/if\(!consumed\)importedDomCandidateExportStore\.release\(win,id\)/,
  'cancelled or mismatched selections release the reservation for a fresh attempt');
 assert.match(handler,/candidateSha256:result\.candidateSha256/);
 assert.match(handler,/automaticRollbackAllowed:false/);
 assert.match(handler,/managerInstalled:false/);
 assert.match(handler,/\.\.\.unverified/);
 const unverifiedStart=main.indexOf('const unverified =');
 const unverifiedEnd=main.indexOf(';',unverifiedStart);
 const unverified=main.slice(unverifiedStart,unverifiedEnd);
 assert.match(unverified,/automaticPatchAllowed:false as const/);
 assert.match(unverified,/tampermonkeyVerified:false as const/);
 assert.match(unverified,/businessVerified:false as const/);
 assert.doesNotMatch(handler,/return \{ok:true,[\s\S]*?sourcePath:/,
  'renderer receipts must not reveal source paths');
 assert.match(main,/importedDomCandidateExportStore\.clearOwner\(win\)/,
  'closing the owning window clears its pending review capabilities');
});

test('TASK-013/TEST-022/023: accepted fresh imports retire prior manual candidate export capabilities',()=>{
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const native=main.slice(main.indexOf('const runNativeImport = async ('),
  main.indexOf("ipcMain.handle('import:get-progress'"));
 assert.match(native,/if\(choice\.canceled[\s\S]*?return \{canceled:true[\s\S]*?\};[\s\S]*?importedDomCandidateExportStore\.clearOwner\(win\)/,
  'a completed native file/folder selection invalidates earlier candidate export grants');
 const batch=main.slice(main.indexOf("ipcMain.handle('import:dropped-batch:begin'"),
  main.indexOf("ipcMain.handle('import:dropped-batch:add'"));
 assert.match(batch,/if\(scenarioObserveInProgress[\s\S]*?return \{ok:false,code:'IMPORT_BUSY'\};[\s\S]*?importedDomCandidateExportStore\.clearOwner\(win\)/,
  'a newly authorized dropped batch invalidates older export grants');
 const single=main.slice(main.indexOf("ipcMain.handle('import:dropped',"),
  main.indexOf("ipcMain.handle('import:cancel-dropped'"));
 assert.match(single,/const result=importDroppedBytes\(name,data\);[\s\S]*?if\('code' in result\)return \{ok:false,code:result\.code\};[\s\S]*?importedDomCandidateExportStore\.clearOwner\(win\)/,
  'a valid single dropped file invalidates previous candidate grants without allowing invalid data to do so');
 assert.doesNotMatch(native,/importedDomCandidateExportStore\.clearOwner\(win\)[\s\S]*?if\(choice\.canceled/,
  'canceling a native picker must not revoke already reviewed candidates');
 assert.match(ui,/function retireImportedDomCandidatesAfterImport\(\):void\{[\s\S]*?importedDomGeneration\+\+[\s\S]*?importedDomItems\?\.replaceChildren\(\)/,
  'the renderer must remove earlier candidate export actions when a new import is accepted');
 assert.match(ui,/if\(\(!result\.canceled\|\|result\.scripts\.length>0\|\|result\.errors\.length>0\)[\s\S]*?retireImportedDomCandidatesAfterImport\(\)/,
  'native picker cancellation with no accepted results preserves old actions, but partially completed imports retire them');
 assert.match(ui,/batchId=started\.batchId;[\s\S]*?retireImportedDomCandidatesAfterImport\(\)/,
  'a newly accepted dropped batch must retire stale candidate actions');
});

test('TASK-013/017 TEST-022/023: imported DOM candidate export is per-item, accessible and stale-reply fenced',()=>{
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const preload=readFileSync(join(process.cwd(),'app/preload/index.ts'),'utf8');
 const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
 assert.match(preload,/exportImportedDomCandidate: \(candidateId: string\): Promise<unknown> => ipcRenderer\.invoke\('scenario:export-imported-candidate',candidateId\)/);
 assert.match(ui,/candidateExportId\?:string/);
 assert.match(ui,/if\(typeof item\.candidateExportId==='string'/,
  'only an item with a live main-issued capability may render the export action');
 assert.match(ui,/window\.healer\.exportImportedDomCandidate\(candidateExportId\)/);
 assert.doesNotMatch(ui,/window\.healer\.exportImportedDomCandidate\([^)]*,/,
  'the renderer cannot attach source, path, target, selector, or consent data');
 assert.match(ui,/action\.textContent='另存候选与原始恢复版'/);
 assert.match(ui,/receipt\.setAttribute\('role','status'\)/);
 assert.match(ui,/receipt\.setAttribute\('aria-live','polite'\)/);
 assert.match(ui,/importedDomCandidateExportBusy/,
  'the action must lock while native dialogs and file staging are pending');
 assert.match(ui,/if\(importedDomTarget\)importedDomTarget\.disabled=importedDomBusy\|\|importedDomCandidateExportBusy/,
  'the observed target cannot be changed while diagnosis or export owns the preview');
 const targetInputStart=ui.indexOf("importedDomTarget?.addEventListener('input'");
 const targetInputEnd=ui.indexOf("importedDomRunButton?.addEventListener('click'",targetInputStart);
 assert.ok(targetInputStart>=0&&targetInputEnd>targetInputStart,
  'the target input lifecycle must remain a bounded block');
 const targetInputHandler=ui.slice(targetInputStart,targetInputEnd);
 assert.match(targetInputHandler,/importedDomGeneration\+\+/,
  'a changed target must retire the previous preview generation');
 assert.match(targetInputHandler,/importedDomItems\?\.replaceChildren\(\)/,
  'candidate actions for the previous target must disappear immediately');
 assert.match(targetInputHandler,/目标网址已更改/);
 assert.match(ui,/if\(generation!==importedDomGeneration\)return/,
  'late replies from replaced candidate previews must not repaint the current list');
 assert.match(ui,/answer\.status==='MANUAL_EXPORT_READY_RUNTIME_UNVERIFIED'/);
 assert.match(ui,/仍未验证|未经运行时验证/,
  'the success status must distinguish file export from runtime or business verification');
 assert.match(ui,/answer\.candidateConsumed===true/,
  'a consumed one-time candidate cannot be retried from a stale button');
 assert.match(ui,/const consumed=answer\.candidateConsumed===true;/,
  'only a capability already consumed after confirmation may imply that file staging could have started');
 assert.match(ui,/const candidateExpiredOrUnavailable=answer\.code==='CANDIDATE_EXPIRED'\|\|\s*answer\.code==='CANDIDATE_UNAVAILABLE'/,
  'pre-write expiry and unavailable responses must have a separate terminal receipt');
 assert.match(ui,/if\(consumed\|\|candidateExpiredOrUnavailable\)/,
  'a pre-write terminal result still retires its stale action');
 assert.match(ui,/candidateExpiredOrUnavailable\s*\?\s*'本次请求未开始文件写入/,
  'an expired or unavailable capability must not warn that this request may have left staged files');
 assert.match(ui,/暂存可能已开始/);
 assert.match(ui,/检查所选备份与导出目录/,
  'a consumed failed export must tell the user to inspect possible recovery files');
 assert.match(main,/候选观测目标：'\+capability\.context\.scenario\.targetUrl/,
  'the final native confirmation must identify the URL bound to the candidate');
 assert.match(main,/候选 SHA-256：'\+capability\.context\.candidateSha256/,
  'the final native confirmation must show the reviewed candidate identity');
 assert.match(html,/<p id="imported-dom-export-risk"[^>]*>[^<]*重新选择[^<]*SHA-256[^<]*最后确认[^<]*不会改写原始脚本[^<]*不会自动安装/s);
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


test('TASK-017/TEST-002/022: file-changing restore is visually distinct from read-only inspection', () => {
  const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
  const css=readFileSync(join(process.cwd(),'app/ui/index.css'),'utf8');
  assert.match(html, /<button id="restore-manual-original" type="button" aria-describedby="manual-restore-risk">[^<]*将改写所选文件/,
    'the write-capable action must visibly describe its local file effect');
  assert.match(css, /#manual-restore-risk\s*\{[^}]*border-inline-start:\s*0\.35rem solid[^}]*background:/s,
    'the write warning must be set apart by shape and background');
  assert.match(css, /#restore-manual-original\s*\{[^}]*border:\s*2px solid[^}]*font-weight:\s*700/s,
    'destructive restore must differ by border thickness and text weight, not color alone');
  assert.doesNotMatch(css, /#restore-inspect-intent\s*\{|#restore-inspect-inventory\s*\{/,
    'read-only checks must not be styled as file-changing actions');
  assert.match(css, /button:disabled\s*\{[^}]*opacity:/,
    'busy or disabled operations must retain their existing unavailable feedback');
  // Static source assertions only; rendered Windows GUI and assistive tech
  // interaction remain part of final human acceptance.
});

test('TASK-017/TEST-022: manual candidate export control exposes its consent and write-risk explanation', () => {
  const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
  assert.match(html,/<button\s+id="scenario-export-manual"\s+type="button"\s+disabled\s+aria-describedby="scenario-export-risk"/);
  assert.match(html,/<p\s+id="scenario-export-risk"[^>]*>[^<]*独立备份目录持久保存恢复检查点/);
});


test('TASK-013/TEST-022/026: one dropped script cannot survive a stale renderer frame',()=>{
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const begin=main.indexOf("ipcMain.handle('import:dropped',");
 const end=main.indexOf("ipcMain.handle('import:cancel-dropped'",begin);
 assert.ok(begin>=0&&end>begin);
 const handler=main.slice(begin,end);
 assert.match(handler,/const droppedFrameEpoch=mainFrameNavigationEpoch/,
  'single-file import captures the originating renderer frame');
 assert.match(handler,/currentFrame:\(\)=>[\s\S]*?mainFrameNavigationEpoch===droppedFrameEpoch/,
  'late checkpoint analysis must not reinsert AST hints after navigation');
 assert.match(handler,/if\(win!==mainWindow\|\|win\.isDestroyed\(\)\|\|[\s\S]*?droppedFrameEpoch!==mainFrameNavigationEpoch\)/,
  'old single-file invocation never returns success after page replacement');
});

test('TASK-013/TEST-022/026: native import completion is fenced to originating main frame',()=>{
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const start=main.indexOf('const runNativeImport = async');
 const end=main.indexOf("ipcMain.handle('import:get-progress'",start);
 const handler=main.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.match(handler,/const nativeFrameEpoch=mainFrameNavigationEpoch/);
 assert.match(handler,/mainFrameNavigationEpoch===nativeFrameEpoch/);
 assert.match(handler,/currentFrame:currentNativeFrame/);
 assert.match(handler,/if\(currentNativeFrame\(\)\)[\s\S]*?scenarioSession\.recordImported/);
 assert.match(handler,/if\(!currentNativeFrame\(\)\)return \{canceled:true/);
 assert.match(main,/readMainOnlyDiagnosticHints\(previews\[i\]\),script\.filename,candidateSource,[\s\S]*?owner\.currentFrame/);
 assert.match(main,/if\(isMainFrame&&!isInPlace\)\{[\s\S]*?nativeImportController\?\.abort\(\)/);
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
 // A delayed progress receipt must not shrink the promised batch total
 // while keeping the same phase and moving processed counters forward.
 assert.match(ui,/next\.total!<current\.total!/);
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

/** TASK-017 / TEST-015/022: a past DOM observation does not make a
 * disconnected browser a current AI review session. */
test('TASK-017/014: disconnected Chrome cannot enable or dispatch AI review',async()=>{
 const {runInNewContext}=await import('node:vm');
 const ts=await import('typescript');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const controls=ui.slice(ui.indexOf('function browserControls():void{'),
   ui.indexOf('async function browserAction('));
 const startAssignment=controls.indexOf('if(aiReviewButton)aiReviewButton.disabled=');
 const endAssignment=controls.indexOf(';',startAssignment);
 assert.ok(startAssignment>=0&&endAssignment>startAssignment,'real browserControls AI action gate');
 const assignment=controls.slice(startAssignment,endAssignment+1);
 let click:()=>void=()=>{throw Error('NO_HANDLER')};
 const button={disabled:false,addEventListener:(_:string,fn:()=>void)=>{click=fn;}};
 const scenarioInspectId={value:'scenario-A'};
 const observedScenarioIds=new Set(['scenario-A']);
 runInNewContext(assignment,{aiReviewButton:button,aiReviewPending:false,
  controlsBusy:false,browserBusy:false,stopInProgress:false,scenarioInspectionBusy:false,
  browserConnected:false,scenarioInspectId,observedScenarioIds});
 assert.equal(button.disabled,true,'a past observation must not enable review after disconnect');
 const start=ui.indexOf("aiReviewButton?.addEventListener('click'");
 const end=ui.indexOf('// Selection changes retire only renderer presentation',start);
 assert.ok(start>=0&&end>start,'real AI review click handler');
 const js=ts.transpileModule(ui.slice(start,end),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}
 }).outputText;
 let nativeCalls=0;
 const result={textContent:''};
 runInNewContext(js,{aiReviewButton:button,aiReviewPending:false,
  aiReviewGeneration:0,browserBusy:false,stopInProgress:false,
  scenarioInspectionBusy:false,browserConnected:false,scenarioInspectId,
  observedScenarioIds,aiReviewResult:result,browserControls:()=>undefined,
  window:{healer:{requestNativeAiReview:async()=>{nativeCalls++;return {ok:false};}}}});
 click();
 assert.equal(nativeCalls,0,'synthetic click must not cross disconnected browser gate');
 assert.match(result.textContent,/Chrome|浏览器|连接/,'blocked user action needs explanation');
});

test('TASK-017/TEST-002/026: seven accessible tabs switch distinct in-frame workspaces', () => {
  const html = readFileSync(join(process.cwd(), 'app', 'ui', 'index.html'), 'utf8');
  const ui = readFileSync(join(process.cwd(), 'app', 'ui', 'index.ts'), 'utf8');
  const targets = [
    ['import-workspace', '导入脚本'],
    ['browser-workspace', 'Chrome 诊断'],
    ['scenario-workspace', '测试场景'],
    ['diagnosis-workspace', '诊断记录'],
    ['candidate-workspace', '候选导出'],
    ['restore-workspace', '备份恢复'],
    ['ai-workspace', 'AI 模型']
  ] as const;

  assert.match(html, /<nav\b[^>]*aria-label="工作区导航"[^>]*role="tablist"/);
  for (const [id, label] of targets) {
    const buttonId = 'tab-' + id;
    const controls = 'aria-controls="' + id + '" data-workspace-target="' + id + '"';
    assert.ok(html.includes(controls), 'each tab must name its workspace: ' + label);
    assert.ok(html.includes('role="tab" id="' + buttonId + '"'),
      'each tab must have a stable accessible ID: ' + label);
    assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) ?? []).length, 1,
      'each workspace ID must be unique: ' + id);
    assert.match(html, new RegExp('<button[^>]*id="' + buttonId +
      '"[^>]*aria-selected="(?:true|false)"[^>]*tabindex="(?:0|-1)"[^>]*>'),
      'each tab must expose its selected and focusable state: ' + label);
    assert.match(html, new RegExp('<section id="' + id +
      '" role="tabpanel" tabindex="0" aria-labelledby="' + buttonId + '"'),
      'each workspace must be a labelled keyboard-focusable panel: ' + id);
    assert.ok(!html.includes('href="#' + id + '"'),
      'fragment navigation would change trustedMainFrame sender URL');
  }
  assert.ok(ui.includes("document.getElementById(button.dataset.workspaceTarget ?? '')"),
    'each tab resolves its declared panel in the renderer');

  const navigation = html.match(/<nav\b[^>]*aria-label="工作区导航"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(navigation);
  assert.deepEqual([...navigation.matchAll(/data-workspace-target="([^"]+)"/g)]
    .map(match => match[1]), targets.map(([id]) => id));
  assert.equal((navigation.match(/aria-selected="true"/g) ?? []).length, 1,
    'exactly one tab is initially selected');
  assert.ok(/selected\.button\.focus\s*\(\s*\{\s*preventScroll:\s*true\s*\}\s*\)/.test(ui),
    'tab activation should retain focus');
  assert.ok(html.indexOf('aria-label="工作区导航"') < html.indexOf('id="drop-area"'),
    'navigation must precede the long import workflow');
});

test('TASK-017/TEST-002/022: tab keyboard navigation preserves the trusted file URL',()=>{
 const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const css=readFileSync(join(process.cwd(),'app/ui/index.css'),'utf8');
 assert.ok(ui.includes('ArrowDown')&&ui.includes('ArrowUp'),
  'desktop vertical tabs need up and down arrow navigation');
 assert.ok(ui.includes('ArrowLeft')&&ui.includes('ArrowRight'),
  'narrow horizontal tabs need left and right arrow navigation');
 assert.ok(ui.includes("'Home'")&&ui.includes("'End'"),
  'Home and End should reach the first and last tabs');
 assert.ok(ui.includes('aria-orientation'),
  'assistive technology needs the orientation of the responsive tab list');
 assert.ok(/panel\.hidden\s*=\s*!active/.test(ui),
  'tab selection must show one panel and hide the others');
 assert.match(css,/@media\s*\(max-width:\s*760px\)/,
  'the tab layout must adapt to narrow Electron windows');
 assert.ok(ui.includes('selected.panel.focus({ preventScroll: true })'),
  'the skip control must focus the current panel');
 assert.ok(!ui.includes('location.hash=')&&!ui.includes('history.pushState(')&&
   !ui.includes('history.replaceState('),
  'tab navigation must retain the trusted Electron file URL');
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

test('TASK-017/TEST-002/022: workspaces retain their labelled headings behind the tabs', () => {
  const html = readFileSync(join(process.cwd(), 'app/ui/index.html'), 'utf-8');
  assert.match(html, /<section id="import-workspace" role="tabpanel" tabindex="0" aria-labelledby="tab-import-workspace">\s*<header class="page-heading"><h2>脚本库<\/h2>/);
  const navigation = html.match(/<nav\b[^>]*aria-label="工作区导航"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(navigation, 'functional tab navigation remains present');
  const targets = [...navigation.matchAll(/data-workspace-target="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(targets, [
    'import-workspace', 'browser-workspace', 'scenario-workspace',
    'diagnosis-workspace', 'candidate-workspace', 'restore-workspace',
    'ai-workspace'
  ]);
  assert.doesNotMatch(navigation, /<\/button>\s*·/,
    'tab names do not need spoken decorative separators');
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


test('TASK-017/TEST-022: existing Data connection and isolated Profile safety instructions are accessible',()=>{
 const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
 assert.match(html,/<p id="chrome-profile-safety">[^<]*不允许使用日常 Chrome Profile/,
  'the isolated launch warning must remain clear');
 assert.match(html,/<p id="existing-chrome-help">[\s\S]*?chrome:\/\/inspect\/#remote-debugging[\s\S]*?断开连接只会断开本软件[\s\S]*?<\/p>/,
  'the existing Chrome connection must explain Chrome authorization and safe disconnect');
 assert.match(html,/<button id="choose-profile" type="button" aria-describedby="owned-chrome-help">选择 Data \/ Profile<\/button>/,
  'existing Data selection must be described for assistive technology');
 assert.match(html,/<button id="connect-existing-chrome" type="button" aria-describedby="existing-chrome-help">/,
  'the running-browser connection needs a dedicated entry point');
 assert.match(html,/<button id="disconnect-existing-chrome" type="button">断开本软件与 Chrome 的连接<\/button>/,
  'the user needs a separate disconnect control');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const connection=ui.slice(ui.indexOf("connectExistingButton?.addEventListener('click'"),
  ui.indexOf("disconnectExistingButton?.addEventListener('click'"));
 assert.match(connection,/window\.healer\.connectExistingChrome\(port\)/,
  'renderer may forward only its validated numeric port, never a path, process ID or WebSocket endpoint');
 assert.match(connection,/existingChromeConnected=result\.ok&&result\.status==='AUTHORIZED_EXISTING_CDP_BROWSER_VERIFIED'/);
 assert.doesNotMatch(connection,/browserConnected\s*=/,
  'an external Chrome connection must not authorize app-owned-only workflows');
 assert.match(ui,/if\(gmStartButton\)gmStartButton\.disabled=controlsBusy\|\|!browserConnected\|\|gmProbeActive/,
  'the isolated GM fixture remains disabled for an externally connected Chrome');
 for(const id of ['create-profile','launch-chrome']){
  assert.match(html,new RegExp('<button id="'+id+'" type="button" aria-describedby="chrome-profile-safety"[^>]*>'),
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
 const end=ui.indexOf('/** Keep each workspace mounted',start);
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
  browserConnected:true,
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

/** TASK-017 / TEST-022: stopping an owned Chrome session must invalidate
 * a still-pending optional AI review in the real renderer click handlers.
 * This is only a presentation guard; native consent remains authoritative.
 */
test('TASK-017/TEST-022: late AI advice cannot repaint after owned Chrome stop',async()=>{
 const {runInNewContext}=await import('node:vm');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const aiStart=ui.indexOf("aiReviewButton?.addEventListener('click'");
 const aiEnd=ui.indexOf('/** Keep each workspace mounted',aiStart);
 const stopStart=ui.indexOf("stopButton?.addEventListener('click'");
 const stopEnd=ui.indexOf("gmStartButton?.addEventListener('click'",stopStart);
 assert.ok(aiStart>=0&&aiEnd>aiStart&&stopStart>=0&&stopEnd>stopStart,
  'real AI and owned-browser stop handlers must be present');
 const aiHandlers=new Map<string,()=>void>();
 const stopHandlers=new Map<string,()=>void>();
 const aiButton={disabled:false,addEventListener:(key:string,fn:()=>void)=>aiHandlers.set(key,fn)};
 const stopButton={disabled:false,addEventListener:(key:string,fn:()=>void)=>stopHandlers.set(key,fn)};
 const selector={value:'scene-A',addEventListener:()=>undefined};
 const aiResult={textContent:'PRIVATE_PREVIOUS_ADVICE'};
 const calls:{resolve:(value:unknown)=>void}[]=[];
 let stopCalls=0;
 const scope={
  aiReviewButton:aiButton,aiReviewPending:false,aiReviewGeneration:0,
  scenarioInspectId:selector,observedScenarioIds:new Set(['scene-A']),
  aiReviewResult:aiResult,scenarioInspectionBusy:false,
  browserBusy:false,browserConnected:true,stopInProgress:false,
  stopButton,recheckRunning:false,gmProbeGeneration:0,
  browserSessionGeneration:0,
  browserControls:()=>undefined,clearGmDisplay:()=>undefined,
  setBrowserStatus:()=>undefined,
  window:{healer:{
   requestNativeAiReview:()=>new Promise(resolve=>calls.push({resolve})),
   stopBrowser:async()=>{stopCalls++;return {ok:true};}
  }}
 };
 runInNewContext(ui.slice(aiStart,aiEnd)+'\n'+ui.slice(stopStart,stopEnd),scope);
 aiHandlers.get('click')?.();
 assert.equal(calls.length,1,'native optional AI review started only after prior observation');
 stopHandlers.get('click')?.();
 assert.equal(stopCalls,1,'real native browser stop still executes');
 assert.doesNotMatch(aiResult.textContent,/PRIVATE_PREVIOUS_ADVICE/,
  'old AI text must be hidden as soon as browser stop is requested');
 calls[0].resolve({ok:true,model:'stale-model',candidateText:'LATE_PRIVATE_ADVICE'});
 for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.doesNotMatch(aiResult.textContent,/LATE_PRIVATE_ADVICE/,
  'late advice from a stopped Chrome session must not repaint the UI');
});
 
/** TASK-017 / TEST-002/022: an owned Chrome launch may return after the user
 * has requested native stop. A late successful handshake is not a fresh
 * session: the renderer must keep the disconnected state and receipt.
 */
test('TASK-017/TEST-002/022: late Chrome launch cannot reconnect UI after stop',async()=>{
 const {runInNewContext}=await import('node:vm');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const actionStart=ui.indexOf('async function browserAction(');
 const actionEnd=ui.indexOf("scenarioHistoryButton?.addEventListener",actionStart);
 const launchStart=ui.indexOf("launchButton?.addEventListener('click'");
 const launchEnd=ui.indexOf("inspectButton?.addEventListener('click'",launchStart);
 const stopStart=ui.indexOf("stopButton?.addEventListener('click'");
 const stopEnd=ui.indexOf("gmStartButton?.addEventListener('click'",stopStart);
 assert.ok(actionStart>=0&&actionEnd>actionStart&&launchStart>=0&&
   launchEnd>launchStart&&stopStart>=0&&stopEnd>stopStart);
 const launchHandlers=new Map<string,()=>void>();
 const stopHandlers=new Map<string,()=>void>();
 let resolveLaunch:(value:unknown)=>void=()=>undefined;
 let stopCalls=0;
 let status='';
 const scope={
  launchButton:{addEventListener:(type:string,fn:()=>void)=>launchHandlers.set(type,fn)},
   managerStoreButton:null,
  stopButton:{addEventListener:(type:string,fn:()=>void)=>stopHandlers.set(type,fn)},
  portInput:{value:'9223'},browserBusy:false,stopInProgress:false,
  browserConnected:false,gmProbeGeneration:0,aiReviewGeneration:0,
  aiReviewResult:{textContent:''},recheckRunning:false,
  browserSessionGeneration:0,
  browserControls:()=>undefined,clearGmDisplay:()=>undefined,
  setBrowserStatus:(value:string)=>{status=value;},
  window:{healer:{
   startBrowser:()=>new Promise(resolve=>{resolveLaunch=resolve;}),
   stopBrowser:async()=>{stopCalls++;return {ok:true};}
  }}
 };
 // Strip only the TypeScript function signature for this VM harness; the
 // body is copied unchanged from the real renderer source.
 const actionSource=ui.slice(actionStart,actionEnd).replace(
  'async function browserAction(fn:()=>Promise<void>):Promise<void>{',
  'async function browserAction(fn){'
 );
 runInNewContext(
  actionSource+'\n'+ui.slice(launchStart,launchEnd)+'\n'+
  ui.slice(stopStart,stopEnd),scope
 );
 launchHandlers.get('click')?.();
 assert.equal(scope.browserBusy,true,'launch is still awaiting native validation');
 stopHandlers.get('click')?.();
 for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(stopCalls,1,'native stop must still be dispatched');
 assert.equal(scope.browserConnected,false);
 resolveLaunch({ok:true,status:'OWNED_CDP_BROWSER_VERIFIED',chromeVersion:'old'});
 for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(scope.browserConnected,false,
  'a delayed pre-stop handshake must not assert a new owned Chrome connection');
 assert.doesNotMatch(status,/已确认本程序启动的 Chrome CDP 连接/,
  'old launch success must not overwrite the stop receipt');
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
 const ts=require('typescript') as typeof import('typescript');
 const executable=ts.transpileModule(ui.slice(start,end),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}
 }).outputText;
 runInNewContext(executable,sandbox);
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


test('TASK-017/TEST-002: tab navigation follows selection and current orientation',()=>{
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const css=readFileSync(join(process.cwd(),'app/ui/index.css'),'utf8');
 assert.ok(ui.includes("button.addEventListener('click', () => selectWorkspace(index, 'tab'));"));
 assert.ok(ui.includes("button.addEventListener('keydown', event => {"));
 assert.ok(ui.includes("case 'Home': target = 0"));
 assert.ok(ui.includes("case 'End': target = count - 1"));
 assert.match(ui,/workspaceTablist\?\.setAttribute\('aria-orientation',[^;]+window\.innerWidth > 760 \? 'vertical' : 'horizontal'\)/);
 assert.ok(ui.includes("button.setAttribute('aria-selected', String(active))"),
  'tabs report their selection to assistive technology');
 assert.match(css,/@media\s*\(max-width:\s*760px\)/);
 assert.ok(!ui.includes('location.hash=')&&!ui.includes('history.pushState(')&&
   !ui.includes('history.replaceState('),
  'tab navigation must keep the trusted Electron file URL');
});

/** TASK-017 / TEST-022: execute the real transpiled renderer handlers.
 * A stop during pending native GM fixture creation invalidates even a late
 * success reply; the UI must not resurrect a revoked session or leak old
 * temporary fixture URLs. This tests display only, never GM authenticity.
 */
test('TASK-017/TEST-022: stopping a pending GM start cannot resurrect stale fixture links',async()=>{
 const {runInNewContext}=await import('node:vm');
 const ts=await import('typescript');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const start=ui.indexOf("gmStartButton?.addEventListener('click'");
 const end=ui.indexOf('const aiDiscoveryButton',start);
 assert.ok(start>=0&&end>start,'use the real GM start/stop renderer handlers');
 const source=ts.transpileModule(ui.slice(start,end),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}
 }).outputText;
 const handlers=new Map<string,()=>void>();
 const button=()=>({addEventListener:(event:string,fn:()=>void)=>{
  if(event==='click')handlers.set(handlers.size?'stop':'start',fn);
 }});
 const links={textContent:''}, result={textContent:''};
 let resolveStart:(value:unknown)=>void=()=>{throw Error('NO_PENDING_START')};
 let startCount=0,stopCount=0;
 const state:any={
  gmStartButton:button(),gmStopButton:button(),
  gmRunAtSelect:{value:'document-idle'},
  gmStatusButton:null,gmReportButton:null,
  gmVisitButtons:{broken:null,fixed:null},
  gmObserveButtons:{broken:null,fixed:null},
  gmProbeStarting:false,gmProbeActive:false,gmStopInProgress:false,gmProbeGeneration:0,
  gmLinks:links,gmResult:result,
  browserAction:(fn:()=>Promise<void>)=>fn(),
  browserControls:()=>undefined,
  retireGmIfNativeSessionGone:()=>false,
  window:{healer:{
   startGmProbe:()=>{startCount++;return new Promise(resolve=>{resolveStart=resolve;});},
   stopGmProbe:async()=>{stopCount++;return {ok:true,status:'FIXTURE_STOP_REQUESTED'};}
  }}
 };
 state.clearGmDisplay=(message:string)=>{
  state.gmProbeActive=false;links.textContent='';result.textContent=message;
 };
 runInNewContext(source,state);
 assert.ok(handlers.has('start')&&handlers.has('stop'));
 handlers.get('start')?.();
 assert.equal(startCount,1);
 assert.equal(state.gmProbeStarting,true);
 handlers.get('stop')?.();
 for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(stopCount,1);
 assert.equal(state.gmProbeActive,false);
 assert.equal(links.textContent,'');
 resolveStart({ok:true,status:'MANUAL_FIXTURE_READY_ONLY',
  installUrl:'http://127.0.0.1/private-fixture',
  brokenUrl:'http://127.0.0.1/broken',
  fixedUrl:'http://127.0.0.1/fixed',
  expiresAt:'2026-11-08T15:00:00Z',runAt:'document-idle'});
 for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(state.gmProbeActive,false,
  'an earlier GM start reply must not reactivate an explicitly stopped fixture');
 assert.equal(links.textContent,'','revoked fixture URLs must never reappear');
 assert.doesNotMatch(result.textContent,/测试服务已开启/,
  'stop confirmation must not be overwritten by a superseded success');
});


/** TASK-017 / TEST-022: a GM status request started before stop is a
 * stale presentation receipt. Native cancellation is independent, but an old
 * reply must not overwrite the stopped state shown to the user.
 */
test('TASK-017/TEST-022: late GM status cannot overwrite stopped fixture UI',async()=>{
 const {runInNewContext}=await import('node:vm');
 const ts=await import('typescript');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const start=ui.indexOf("gmStartButton?.addEventListener('click'");
 const end=ui.indexOf('const aiDiscoveryButton',start);
 assert.ok(start>=0&&end>start,'use real GM status and stop handlers');
 const script=ts.transpileModule(ui.slice(start,end),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}
 }).outputText;
 const handlers=new Map<string,()=>void>();
 const button=(name:string)=>({addEventListener:(event:string,handler:()=>void)=>{
  if(event==='click')handlers.set(name,handler);
 }});
 const links={textContent:'temporary link'};
 const result={textContent:'active fixture'};
 let resolveStatus:(value:unknown)=>void=()=>{throw Error('STATUS_NOT_REQUESTED')};
 let stopCount=0,statusCount=0;
 const state:any={
  gmStartButton:null,gmStatusButton:button('status'),gmStopButton:button('stop'),
  gmReportButton:null,gmRunAtSelect:null,
  gmVisitButtons:{broken:null,fixed:null},
  gmObserveButtons:{broken:null,fixed:null},
  gmProbeStarting:false,gmProbeActive:true,gmStopInProgress:false,gmProbeGeneration:0,
  gmLinks:links,gmResult:result,
  browserAction:(fn:()=>Promise<void>)=>fn(),
  browserControls:()=>undefined,
  retireGmIfNativeSessionGone:()=>false,
  window:{healer:{
   gmProbeStatus:()=>{statusCount++;return new Promise(resolve=>{resolveStatus=resolve;});},
   stopGmProbe:async()=>{stopCount++;return {ok:true,status:'FIXTURE_STOP_REQUESTED'};}
  }}
 };
 state.clearGmDisplay=(message:string)=>{
  state.gmProbeActive=false;links.textContent='';result.textContent=message;
 };
 runInNewContext(script,state);
 handlers.get('status')?.();
 assert.equal(statusCount,1,'status request must be in flight before stop');
 handlers.get('stop')?.();
 for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(stopCount,1);
 assert.equal(state.gmProbeActive,false);
 assert.equal(links.textContent,'');
 const stopped=result.textContent;
 assert.match(stopped,/关闭|删除|停止/);
 resolveStatus({ok:true,observedModes:2,reportedGmDefaultMatched:true,
  reportedGmStorageRoundtripMatched:true,reportedBrokenFailed:true,
  reportedFixedRecovered:true,consistencyStatus:'UNVERIFIED_FIXTURE_ONLY',
  comparedModes:2,brokenDomAction:'none',fixedDomAction:'done'});
 for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(result.textContent,stopped,
  'late pre-stop GM status must not repaint a revoked fixture');
 assert.equal(links.textContent,'');
 assert.equal(state.gmProbeActive,false);
});


/** TASK-007 / TEST-017/018: execute the actual cloud manager-selection
 * block with ambiguous chrome://extensions cards. This is isolated test
 * evidence only; name/ID are not store-installation attestation.
 */
test('TASK-007/TEST-017: cloud manager probe rejects ambiguous matching extension cards',async()=>{
 const {runInNewContext}=await import('node:vm');
 const source=readFileSync(join(process.cwd(),'poc/windows-tampermonkey-cloud.cjs'),'utf8');
 const cardsLine=source.indexOf('  const cards=await extensionCards(context);');
 const start=cardsLine<0?-1:source.indexOf('\n',cardsLine)+1;
 const end=source.indexOf('  // MV3 service workers',start);
 assert.ok(start>=0&&end>start,'execute the real cloud manager selection logic');
 const selection=source.slice(start,end)+'\nmanager;';
 const card=(id:string,name='Tampermonkey')=>({id,name});
 const first='a'.repeat(32),other='b'.repeat(32);
 const select=(cards:unknown)=>runInNewContext(selection,{cards,assert}) as {id:string;name:string};
 assert.equal(select([card(first)]).id,first,
  'a single actual matching extension card remains selectable');
 assert.throws(()=>select([card(first),card(other)]),/exactly one|ambiguous|unique/i,
  'two matching extension names cannot silently pick the first card');
 assert.throws(()=>select([card(first),card(first)]),/exactly one|ambiguous|unique/i,
  'duplicate cards for one runtime ID must also be rejected');
 assert.equal(select([card(first),card(other,'Unrelated Utility')]).id,first,
  'unrelated extension cards must not block the unique manager');
 assert.throws(()=>select([card(first,'Tampermonkey Beta')]),/register|matching|exactly one|ambiguous|unique/i,
  'excluded Beta variants must not be promoted as the supported manager');
});


/** TASK-017 / TEST-002/022: a native manual export may finish after the user
 * selects another scenario. Its result must not claim to belong to the new
 * selected scenario. This executes the existing renderer handlers, not a copy.
 * Native consent, backup and disk-write authority remain separate.
 */
test('TASK-017/TEST-022: delayed manual export result cannot repaint another scenario',async()=>{
 const {runInNewContext}=await import('node:vm');
 const ts=await import('typescript');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const selectionStart=ui.indexOf('let scenarioInspectionGeneration=0;');
 const selectionEnd=ui.indexOf("scenarioInspectButton?.addEventListener('click'",selectionStart);
 const exportStart=ui.indexOf("scenarioExportButton?.addEventListener('click'");
 const exportEnd=ui.indexOf("scenarioCancelButton?.addEventListener('click'",exportStart);
 assert.ok(selectionStart>=0&&selectionEnd>selectionStart&&
   exportStart>=0&&exportEnd>exportStart,'execute real scenario-selection and manual-export handlers');
 const source=ts.transpileModule(
  ui.slice(selectionStart,selectionEnd)+'\n'+ui.slice(exportStart,exportEnd),{
   compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}
  }).outputText;
 const events=new Map<string,()=>void>();
 const scenarioInspectId={
  value:'scenario-A',
  addEventListener:(name:string,callback:()=>void)=>events.set('selection-'+name,callback)
 };
 let resolveExport:(value:unknown)=>void=()=>{throw Error('NO_PENDING_EXPORT')};
 let calledWith='';
 const status={textContent:''};
 let handler:(()=>void)|undefined;
 const sandbox:any={
  scenarioInspectId,scenarioStatus:status,
  scenarioExportButton:{addEventListener:(name:string,callback:()=>void)=>{
   if(name==='click')handler=callback;
  }},
  manualExportBusy:false,browserConnected:true,
  browserControls:()=>undefined,
  browserAction:(fn:()=>Promise<void>)=>fn(),
  window:{healer:{exportManualScenario:(id:string)=>{
   calledWith=id;
   return new Promise(resolve=>{resolveExport=resolve;});
  }}}
 };
 runInNewContext(source,sandbox);
 assert.ok(handler&&events.has('selection-change'));
 handler?.();
 assert.equal(calledWith,'scenario-A');
 scenarioInspectId.value='scenario-B';
 events.get('selection-change')?.();
 const switched=status.textContent;
 assert.match(switched,/已切换场景/);
 resolveExport({ok:true,status:'MANUAL_EXPORT_READY_RUNTIME_UNVERIFIED',
  exportFileName:'scenario-A-candidate.user.js',candidateByteLength:42,
  candidateSha256:'a'.repeat(64),recoveryExportFileName:'original.user.js',
  backupFileName:'backup.user.js',checkpointFileName:'checkpoint.json'});
 for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(status.textContent,switched,
  'late successful export must not announce an old scenario candidate in the new view');
 assert.equal(sandbox.manualExportBusy,false,'native operation may settle normally');
 // A new request in the selected scenario must still present its own result.
 handler?.();
 assert.equal(calledWith,'scenario-B');
 resolveExport({ok:false,code:'NOT_AUTHORIZED'});
 for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.match(status.textContent,/人工导出未完成：NOT_AUTHORIZED/,
  'a current-scene denial must be shown accurately');
});


/** TASK-017 / TEST-022: stopping a GM fixture invalidates older asynchronous
 * manual report/visit/DOM receipts even if the native response arrives later.
 * The renderer must not present a revoked fixture as active or successful.
 */
test('TASK-017/TEST-022: late GM manual action cannot repaint stopped fixture',async()=>{
 const {runInNewContext}=await import('node:vm');
 const ts=await import('typescript');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const start=ui.indexOf("gmReportButton?.addEventListener('click'");
 const end=ui.indexOf('\nbrowserControls();',start);
 assert.ok(start>=0&&end>start,'run real GM report/visit/observe/stop handlers');
 const script=ts.transpileModule(ui.slice(start,end),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}
 }).outputText;
 for(const action of ['report','visit','observe'] as const){
  let resolveAction:(value:unknown)=>void=()=>{throw Error('NOT_REQUESTED')};
  const callbacks=new Map<string,()=>void>();
  const button=(key:string)=>({addEventListener:(event:string,handler:()=>void)=>{
   if(event==='click')callbacks.set(key,handler);
  }});
  const links={textContent:'temporary fixture URLs'};
  const result={textContent:'active fixture'};
  const sandbox:any={
   gmReportButton:button('report'),
   gmVisitButtons:{broken:button('visit'),fixed:null},
   gmObserveButtons:{broken:button('observe'),fixed:null},
   gmStopButton:button('stop'),
   gmProbeActive:true,gmProbeStarting:false,gmStopInProgress:false,gmProbeGeneration:0,
   gmLinks:links,gmResult:result,
   browserAction:(fn:()=>Promise<void>)=>fn(),
   browserControls:()=>undefined,
   retireGmIfNativeSessionGone:()=>false,
   window:{healer:{
    saveGmReport:()=>new Promise(resolve=>{resolveAction=resolve;}),
    visitGmFixture:()=>new Promise(resolve=>{resolveAction=resolve;}),
    observeGmFixture:()=>new Promise(resolve=>{resolveAction=resolve;}),
    stopGmProbe:async()=>({ok:true,status:'FIXTURE_STOP_REQUESTED'})
   }}
  };
  sandbox.clearGmDisplay=(message:string)=>{
   sandbox.gmProbeActive=false;links.textContent='';result.textContent=message;
  };
  runInNewContext(script,sandbox);
  callbacks.get(action)?.();
  callbacks.get('stop')?.();
  for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));
  const stopped=result.textContent;
  assert.match(stopped,/关闭|删除|停止/);
  resolveAction(action==='report'
   ?{ok:true,status:'UNVERIFIED_REPORT_SAVED_ONLY',fileName:'old.json',
      sha256:'a'.repeat(64),byteLength:14}
   :action==='visit'
    ?{ok:true}
    :{ok:true,actionCount:1,fixtureDomMatchesExpected:true});
  for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(result.textContent,stopped,
   'late '+action+' result must not repaint a revoked GM fixture');
  assert.equal(links.textContent,'');
  assert.equal(sandbox.gmProbeActive,false);
 }
});


/** TASK-017 / TEST-022: a delayed cancellation response belongs to the
 * original selected scenario. It may cancel native work, but must not
 * present the prior scenario's cancellation in a newly selected view.
 */
test('TASK-017/TEST-022: late scenario cancel receipt does not overwrite switched view',async()=>{
 const {runInNewContext}=await import('node:vm');
 const ts=await import('typescript');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const selectionStart=ui.indexOf('let scenarioInspectionGeneration=0;');
 const selectionEnd=ui.indexOf("scenarioInspectButton?.addEventListener('click'",selectionStart);
 const cancelStart=ui.indexOf("scenarioCancelButton?.addEventListener('click'");
 const cancelEnd=ui.indexOf("chooseChromeButton?.addEventListener('click'",cancelStart);
 assert.ok(selectionStart>=0&&selectionEnd>selectionStart&&
  cancelStart>=0&&cancelEnd>cancelStart,'run actual selection and cancel handlers');
 const js=ts.transpileModule(
  ui.slice(selectionStart,selectionEnd)+'\n'+ui.slice(cancelStart,cancelEnd),{
   compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}
  }).outputText;
 for(const fail of [false,true]){
  const events=new Map<string,()=>void>();
  const scenarioInspectId={
   value:'scene-A',
   addEventListener:(event:string,handler:()=>void)=>events.set('select-'+event,handler)
  };
  const scenarioStatus={textContent:'scene-A observation pending'};
  let cancelCalls=0;
  let resolveNative:(v:unknown)=>void=()=>{throw Error('NOT_CALLED')};
  let rejectNative:(e:unknown)=>void=()=>{throw Error('NOT_CALLED')};
  const sandbox:any={
   scenarioInspectId,scenarioStatus,
   scenarioInspectionBusy:true,manualExportBusy:false,
   scenarioCancelButton:{
    disabled:false,
    addEventListener:(event:string,handler:()=>void)=>{
     if(event==='click')events.set('cancel',handler);
    }
   },
   window:{healer:{cancelScenarioInspection:()=>{
    cancelCalls++;
    return new Promise((resolve,reject)=>{
     resolveNative=resolve;rejectNative=reject;
    });
   }}}
  };
  runInNewContext(js,sandbox);
  assert.ok(events.has('select-change')&&events.has('cancel'));
  events.get('cancel')?.();
  assert.equal(cancelCalls,1,'the native cancel remains requested for original scenario');
  scenarioInspectId.value='scene-B';
  events.get('select-change')?.();
  const switched=scenarioStatus.textContent;
  assert.match(switched,/已切换场景/);
  if(fail)rejectNative(Error('cancellation failed'));
  else resolveNative({ok:true});
  for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(scenarioStatus.textContent,switched,
   'old '+(fail?'rejected':'successful')+' cancellation must not repaint scene-B');
 }
});


/** TASK-017 / TEST-022: the cancellation boundary must retire earlier
 * in-flight inspection/export presentation, not just older cancellation
 * acknowledgements when the selected scenario changes. Native work may
 * already have completed; an obsolete reply is not fresh UI authority.
 */
test('TASK-017/TEST-022: cancel request fences late inspection and export success receipts',async()=>{
 const {runInNewContext}=await import('node:vm');
 const ts=await import('typescript');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const slice=(start:string,end:string)=>{
  const a=ui.indexOf(start),b=ui.indexOf(end,a);
  assert.ok(a>=0&&b>a,'real renderer handlers: '+start);
  return ui.slice(a,b);
 };
 const js=ts.transpileModule([
  slice('let scenarioInspectionGeneration=0;',
   "manualRestoreButton?.addEventListener('click'"),
  slice("scenarioExportButton?.addEventListener('click'",
   "scenarioCancelButton?.addEventListener('click'"),
  slice("scenarioCancelButton?.addEventListener('click'",
   "chooseChromeButton?.addEventListener('click'")
 ].join('\n'),{compilerOptions:{
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None
 }}).outputText;
 for(const action of ['inspect','export'] as const){
  const events=new Map<string,()=>void>();
  const button=(name:string)=>({disabled:false,
   addEventListener:(kind:string,fn:()=>void)=>{
    if(kind==='click')events.set(name,fn);
   }
  });
  let resolveWork:(value:unknown)=>void=()=>{throw Error('NO_WORK')};
  let nativeCancelCalls=0;
  const status={textContent:'not started'};
  const observed=new Set<string>();
  const sandbox:any={
   scenarioInspectId:{value:'scene-A',addEventListener:()=>undefined},
   scenarioInspectButton:button('inspect'),
   scenarioExportButton:button('export'),
   scenarioCancelButton:button('cancel'),
   scenarioStatus:status,
   scenarioInspectionBusy:false,manualExportBusy:false,
   browserAction:(fn:()=>Promise<void>)=>fn(),
   browserControls:()=>undefined,
   observedScenarioIds:observed,browserConnected:true,
   window:{healer:{
    inspectScenario:()=>new Promise(resolve=>{resolveWork=resolve;}),
    exportManualScenario:()=>new Promise(resolve=>{resolveWork=resolve;}),
    cancelScenarioInspection:async()=>{nativeCancelCalls++;return {ok:true};}
   }}
  };
  runInNewContext(js,sandbox);
  events.get(action)?.();
  assert.match(status.textContent,/等待系统原生授权|正在等待原生授权/);
  events.get('cancel')?.();
  for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(nativeCancelCalls,1,'native cancellation is still sent');
  const cancellationReceipt=status.textContent;
  assert.match(cancellationReceipt,/已请求取消/);
  resolveWork(action==='inspect'
   ?{ok:true,status:'LIMITED_DOM_SIGNAL_ONLY',checkedAssertions:1,
      faultCategory:'NO_ERROR',triageStatus:'READ_ONLY',evidenceCount:1}
   :{ok:true,status:'MANUAL_EXPORT_READY_RUNTIME_UNVERIFIED',
     exportFileName:'stale-candidate.user.js',candidateByteLength:99,
     candidateSha256:'a'.repeat(64)});
  for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(status.textContent,cancellationReceipt,
   'late '+action+' success must not overwrite pending cancellation');
  assert.equal(observed.has('scene-A'),false,
   'cancelled or stale DOM work must not unlock AI review of the scenario');
  assert.equal(sandbox.scenarioInspectionBusy,false);
  assert.equal(sandbox.manualExportBusy,false);
 }
});


test('TASK-017/TEST-002/022: offline history allows switching registered scenarios without enabling live browser actions', async () => {
 const {runInNewContext}=await import('node:vm');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const start=ui.indexOf('function browserControls():void{');
 const end=ui.indexOf('async function browserAction(',start);
 assert.ok(start>=0&&end>start,'must test the real renderer control policy');
 const names=[
  'chooseChromeButton','chooseProfileButton','createProfileButton','portInput',
  'launchButton','inspectButton','managerStoreButton','stopButton','scenarioInspectId',
  'scenarioInspectButton','scenarioRecheckStartButton','scenarioRecheckStopButton',
  'scenarioCancelButton','scenarioHistoryButton','scenarioExportButton',
  'aiReviewButton','gmStartButton','gmRunAtSelect','gmStatusButton',
  'gmReportButton','gmVisitButtons','gmObserveButtons','gmStopButton'
 ];
 const sandbox:Record<string,unknown>=Object.fromEntries(names.map(name=>[name,null]));
 const selector={disabled:true,value:'registered-A',options:[{},{}]};
 const history={disabled:true},inspect={disabled:false},ai={disabled:false};
 Object.assign(sandbox,{
  browserBusy:false,stopInProgress:false,browserConnected:false,
  chromeSelected:false,profileSelected:false,
  scenarioHistoryBusy:false,scenarioInspectionBusy:false,manualExportBusy:false,
  aiReviewPending:false,gmProbeActive:false,gmProbeStarting:false,gmStopInProgress:false,
  recheckRunning:false,observedScenarioIds:new Set(['registered-A']),
  gmVisitButtons:{},gmObserveButtons:{},
  scenarioInspectId:selector,scenarioHistoryButton:history,
  scenarioInspectButton:inspect,aiReviewButton:ai
 });
 const ts=await import('typescript');
 const controls=ts.transpileModule(ui.slice(start,end)+'\nbrowserControls();',{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}
 }).outputText;
 runInNewContext(controls,sandbox);
 assert.equal(selector.disabled,false,
  'registered scenarios must remain selectable for offline-only history');
 assert.equal(history.disabled,false,'read-only history remains available without Chrome');
 assert.equal(inspect.disabled,true,'actual DOM access remains disabled without Chrome');
 assert.equal(ai.disabled,true,'optional AI review cannot use a disconnected browser');
 Object.assign(sandbox,{browserBusy:true});
 runInNewContext('browserControls();',sandbox);
 assert.equal(selector.disabled,true,'an active native browser operation still freezes selection');
});


/** TASK-017 / TEST-022: a transient native GM status query failure is not
 * evidence that the owned fixture has expired or been revoked. Preserve the
 * active fixture and cleanup button; retire only when native session loss is
 * explicitly confirmed. This exercises the actual renderer handler.
 */
test('TASK-017/TEST-022: transient GM status failure preserves active fixture and stop control',async()=>{
 const {runInNewContext}=await import('node:vm');
 const ts=await import('typescript');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const start=ui.indexOf("gmStatusButton?.addEventListener('click'");
 const end=ui.indexOf("gmReportButton?.addEventListener('click'",start);
 assert.ok(start>=0&&end>start,'use the actual renderer GM status handler');
 const source=ts.transpileModule(ui.slice(start,end),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}
 }).outputText;
 const links={textContent:'authorized temporary fixture links'};
 const result={textContent:'fixture is active'};
 let callback:(()=>void)|undefined;
 let retired=0;
 const sandbox:any={
  gmStatusButton:{addEventListener:(type:string,fn:()=>void)=>{
   if(type==='click')callback=fn;
  }},
  gmProbeGeneration:1,gmProbeActive:true,gmResult:result,
  gmLinks:links,
  browserAction:(fn:()=>Promise<void>)=>fn(),
  window:{healer:{gmProbeStatus:async()=>({ok:false,code:'TEMPORARY_STATUS_IO_FAILURE'})}},
  retireGmIfNativeSessionGone:(code:string)=>{
   if(code!=='NO_ACTIVE_FIXTURE'&&code!=='SESSION_REVOKED')return false;
   retired++;sandbox.gmProbeActive=false;links.textContent='';return true;
  },
  clearGmDisplay:(message:string)=>{
   sandbox.gmProbeActive=false;links.textContent='';result.textContent=message;
  }
 };
 runInNewContext(source,sandbox);
 assert.ok(callback,'status handler registered');
 callback();
 for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(retired,0,'transient failure must not retire session');
 assert.equal(sandbox.gmProbeActive,true,'existing session remains stoppable');
 assert.equal(links.textContent,'authorized temporary fixture links',
  'do not erase the only instructions for cleanup on a query error');
 assert.match(result.textContent,/失败|受阻|无法确认/);
});


/** TASK-017 / TEST-022: an absent manager self-report is UNKNOWN, not FALSE.
 * Execute the actual renderer GM status handler so presentation cannot
 * convert nullable GM/fixture evidence into a misleading negative claim.
 * No real Tampermonkey or business validation is inferred from these fixtures.
 */
test('TASK-017/TEST-022: GM status summary preserves unknown versus explicit negative receipts',async()=>{
 const {runInNewContext}=await import('node:vm');
 const ts=await import('typescript');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const start=ui.indexOf("gmStatusButton?.addEventListener('click'");
 const end=ui.indexOf("gmReportButton?.addEventListener('click'",start);
 assert.ok(start>=0&&end>start,'exercise the real GM status handler');
 const source=ts.transpileModule(ui.slice(start,end),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}
 }).outputText;
 let click:(()=>void)|undefined;
 const result={textContent:''};
 const state:any={
  gmStatusButton:{addEventListener:(name:string,fn:()=>void)=>{
   if(name==='click')click=fn;
  }},
  gmProbeGeneration:1,gmProbeActive:true,gmResult:result,
  browserAction:(fn:()=>Promise<void>)=>fn(),
  retireGmIfNativeSessionGone:()=>false,
  window:{healer:{gmProbeStatus:async()=>({
   ok:true,observedModes:0,
   reportedGmDefaultMatched:null,
   reportedGmStorageRoundtripMatched:false,
   reportedBrokenFailed:null,
   reportedFixedRecovered:true,
   consistencyStatus:'UNVERIFIED_FIXTURE_ONLY',comparedModes:0
  })}}
 };
 runInNewContext(source,state);
 assert.ok(click,'the GM status handler must register');
 click();
 for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.match(result.textContent,/自报 GM 默认值匹配：未报告/,
  'missing self-report must remain unknown, not be converted to false');
 assert.match(result.textContent,/自报 GM 存储写入读回：否/,
  'a genuine false receipt must be distinguishable from missing evidence');
 assert.match(result.textContent,/自报 broken 失败：未报告/);
 assert.match(result.textContent,/自报 fixed 动作：是/);
 assert.match(result.textContent,/不证明真实 GM 或业务恢复/);
});


test('TASK-005/TEST-007/026: desktop close cannot force-kill selected or external Chrome or delete Profile locks',()=>{
  const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
  const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
  const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');

  assert.doesNotMatch(main,/terminateMatchingChromeProcesses/,
    'selected executable/Profile must never be used as a process-kill fallback');
  assert.doesNotMatch(main,/Stop-Process\s+-Id[\s\S]{0,80}-Force/,
    'desktop product code must not force-kill Chrome');
  assert.doesNotMatch(main,/rmSync\(\s*lockfile/,
    'desktop product code must not delete a Chrome Profile ownership lock');

  const stopHandler=main.match(
    /ipcMain\.handle\('browser:stop',async event=>\{([\s\S]*?)\n  \}\);/);
  assert.ok(stopHandler,'browser:stop handler must remain explicit and auditable');
  assert.doesNotMatch(stopHandler[1],/selectedChrome|selectedProfile/,
    'stop authority comes only from a live owned/attached session, never selected paths');
  assert.match(stopHandler[1],/EXISTING_BROWSER_DISCONNECTED/,
    'an attached pre-existing Chrome must only be disconnected, not closed');

  assert.doesNotMatch(html,/id="close-chrome"/,
    'existing-Chrome controls must not imply the app can close an external browser');
  assert.doesNotMatch(ui,/getElementById\('close-chrome'\)/,
    'renderer must not proxy external Chrome close into the owned-browser stop action');
});


test('TASK-007/TEST-017/026: official Tampermonkey installation entry is a consented owned-Chrome navigation only',()=>{
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const preload=readFileSync(join(process.cwd(),'app/preload/index.ts'),'utf8');
 const renderer=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
 const block=main.slice(
  main.indexOf("ipcMain.handle('browser:open-tampermonkey-store'"),
  main.indexOf("ipcMain.handle('browser:stop'")
 );
 assert.ok(block.startsWith("ipcMain.handle('browser:open-tampermonkey-store'"));
 assert.match(block,/authorizeSender\(event\)/);
 assert.match(block,/if\(args\.length\)/);
 assert.match(block,/readOwnedBrowser\(\)/);
 assert.match(block,/isLiveApprovedChromeSession\(owned\)/);
 assert.match(block,/dialog\.showMessageBox/);
 assert.match(block,/decision\.response!==0/);
 assert.match(block,/controller\.signal\.aborted/);
 assert.match(block,/openApprovedTarget\(owned,page,true,controller\.signal\)/);
 assert.match(block,/chromewebstore\.google\.com\/detail\/tampermonkey/);
 assert.match(block,/dhdgffkkebhmkfjojejmpbldmpobfkfo/);
 assert.match(block,/OFFICIAL_STORE_TAB_OPENED_UNVERIFIED/);
 assert.doesNotMatch(block,/installExtension|chrome\.management|shell\.openExternal/);
 assert.match(main,/managerStoreAbort\?\.abort\(\)/);
 assert.match(preload,/openTampermonkeyStore: \(\): Promise<unknown> => ipcRenderer\.invoke\('browser:open-tampermonkey-store'\)/);
 assert.match(html,/id="open-tampermonkey-store"/);
 assert.match(html,/Chrome 中确认/);
 assert.match(renderer,/managerStoreButton\.disabled=allControlsBusy\|\|!browserConnected/);
 assert.match(renderer,/window\.healer\.openTampermonkeyStore\(\)/);
 assert.match(renderer,/扩展身份、GM 和业务结果仍未验证/);
});


test('TASK-007/017 TEST-017/022: revoked Store navigation cannot overwrite Chrome stop state',async()=>{
 const {runInNewContext}=await import('node:vm');
 const ts=await import('typescript');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const begin=ui.indexOf("managerStoreButton?.addEventListener('click'");
 const end=ui.indexOf("inspectButton?.addEventListener('click'",begin);
 assert.ok(begin>=0&&end>begin,'execute the real Store UI handler');
 assert.match(ui,/browserSessionGeneration\+\+;/,
  'native stop must revoke earlier presentation generation');
 const script=ts.transpileModule(ui.slice(begin,end),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}
 }).outputText;
 let click:()=>void=()=>{throw Error('STORE_HANDLER_NOT_REGISTERED')};
 const pending:Array<{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>=[];
 const statuses:string[]=[];
 const sandbox={
  browserSessionGeneration:1,
  browserConnected:true,
  managerStoreButton:{addEventListener:(_name:string,cb:()=>void)=>{click=cb;}},
  browserAction:(fn:()=>Promise<void>)=>fn().catch(()=>
   statuses.push('浏览器操作受阻；没有获得验证成功的结果。')),
  setBrowserStatus:(message:string)=>statuses.push(message),
  window:{healer:{openTampermonkeyStore:()=>new Promise((resolve,reject)=>{
   pending.push({resolve,reject});
  })}}
 };
 runInNewContext(script,sandbox);
 const tick=async()=>{for(let i=0;i<3;i++)await new Promise(r=>setImmediate(r));};
 click();
 assert.equal(pending.length,1);
 sandbox.browserSessionGeneration++;
 sandbox.browserConnected=false;
 statuses.push('已撤销 Chrome 控制');
 pending[0].resolve({ok:true,status:'OFFICIAL_STORE_TAB_OPENED_UNVERIFIED'});
 await tick();
 assert.deepEqual(statuses,['已撤销 Chrome 控制'],
  'late success must not present an old Store page as a live session');
 // A rejected IPC after the same revocation must not repaint the stop receipt.
 sandbox.browserConnected=true;
 click();
 assert.equal(pending.length,2);
 sandbox.browserSessionGeneration++;
 sandbox.browserConnected=false;
 statuses.push('浏览器停止状态已确认');
 pending[1].reject(Error('REVOKED_BROWSER'));
 await tick();
 assert.equal(statuses.at(-1),'浏览器停止状态已确认');
 // A fresh request in a current owned session must still present its result.
 sandbox.browserConnected=true;
 click();
 assert.equal(pending.length,3);
 pending[2].resolve({ok:true,status:'OFFICIAL_STORE_TAB_OPENED_UNVERIFIED'});
 await tick();
 assert.match(statuses.at(-1)??'',/打开官方安装页/);
});


/** TASK-007/017, TEST-017/022: a read-only manager probe is still bound to
 * the exact Chrome renderer session. The native process remains authority;
 * late IPC receipts are not permitted to repaint a later stop/disconnect.
 */
test('TASK-007/017 TEST-017/022: stale Tampermonkey inspection cannot revive a stopped browser',async()=>{
 const {runInNewContext}=await import('node:vm');
 const ts=await import('typescript');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const begin=ui.indexOf("inspectButton?.addEventListener('click'");
 const end=ui.indexOf("stopButton?.addEventListener('click'",begin);
 assert.ok(begin>=0&&end>begin,'run the actual manager inspection renderer handler');
 const script=ts.transpileModule(ui.slice(begin,end),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}
 }).outputText;
 let click:()=>void=()=>{throw Error('MANAGER_INSPECTION_HANDLER_NOT_REGISTERED')};
 const pending:Array<{resolve:(value:unknown)=>void;reject:(reason:Error)=>void}>=[];
 const statuses:string[]=[];
 const state={
  browserSessionGeneration:1,
  browserConnected:true,existingChromeConnected:false,stopInProgress:false,
  inspectButton:{addEventListener:(name:string,cb:()=>void)=>{if(name==='click')click=cb;}},
  browserAction:(fn:()=>Promise<void>)=>fn().catch(()=>
   statuses.push('浏览器操作受阻；没有获得验证成功的结果。')),
  setBrowserStatus:(msg:string)=>statuses.push(msg),
  clearGmDisplay:(_msg:string)=>{},
  window:{healer:{inspectTampermonkey:()=>new Promise((resolve,reject)=>{
   pending.push({resolve,reject});
  })}}
 };
 runInNewContext(script,state);
 const tick=async()=>{for(let i=0;i<3;i++)await new Promise<void>(r=>setImmediate(r));};
 click();assert.equal(pending.length,1);
 state.browserSessionGeneration++;
 state.browserConnected=false;
 statuses.push('已停止独立 Chrome');
 pending[0].resolve({ok:true,status:'RUNTIME_TARGET_HINT_ONLY',matchedRuntimeTargets:1});
 await tick();
 assert.deepEqual(statuses,['已停止独立 Chrome'],
  'late successful runtime hint must never overwrite stopped session feedback');

 state.browserConnected=true;click();assert.equal(pending.length,2);
 state.browserSessionGeneration++;state.browserConnected=false;
 statuses.push('停止状态已确认');
 pending[1].reject(Error('CHROME_STOPPED'));
 await tick();
 assert.equal(statuses.at(-1),'停止状态已确认',
  'a rejected stale IPC cannot fall through to the generic browser error banner');

 state.browserConnected=true;click();assert.equal(pending.length,3);
 state.browserSessionGeneration++;state.browserConnected=false;
 statuses.push('连接撤销完毕');
 pending[2].resolve({ok:false,code:'BROWSER_NOT_RUNNING'});
 await tick();
 assert.equal(statuses.at(-1),'连接撤销完毕',
  'late browser-not-running receipt must not overwrite newer session status');

 state.browserConnected=true;click();assert.equal(pending.length,4);
 pending[3].resolve({ok:true,status:'RUNTIME_TARGET_HINT_ONLY',matchedRuntimeTargets:2});
 await tick();
 assert.match(statuses.at(-1)??'',/发现 2 个疑似 Tampermonkey 运行目标/,
  'a fresh current-session hint still remains visible but unverified');
});


/** TASK-017 / TEST-002/022: keep the ordinary browser workflow centered on
 * the app-owned selected Chrome/Profile. Existing-browser attachment and the
 * hand-installed GM fixture remain available only as collapsed advanced tools.
 */
test('TASK-017/TEST-002/022: controlled Chrome launch is primary and manual diagnostics stay advanced',()=>{
 const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
 const browser=html.match(/<section id="browser-workspace"[\s\S]*?<\/section>/)?.[0];
 assert.ok(browser,'the browser workspace must remain present');
 if(!browser)return;
 const primary=browser.indexOf('<h3>受控 Chrome</h3>');
 const launch=browser.indexOf('id="launch-chrome"');
 const existing=browser.indexOf('<details class="advanced-tools" data-advanced-workspace="existing-chrome">');
 const connect=browser.indexOf('id="connect-existing-chrome"');
 const manual=browser.indexOf('<details class="advanced-tools" data-advanced-workspace="manual-gm">');
 const gm=browser.indexOf('id="gm-probe-start"');
 assert.ok(primary>=0&&launch>primary&&launch<existing,
  'the selected app-owned Chrome launch must be visible before advanced connection tools');
 assert.ok(existing>launch&&connect>existing&&connect<manual,
  'attaching to an already-running Chrome must remain in a separate advanced section');
 assert.ok(manual>connect&&gm>manual,
  'the manual GM fixture must not appear in the ordinary browser workflow');
 const existingOpen=browser.slice(existing,browser.indexOf('</details>',existing)+10);
 const manualOpen=browser.slice(manual,browser.indexOf('</details>',manual)+10);
 assert.match(existingOpen,/^<details[^>]*data-advanced-workspace="existing-chrome"/);
 assert.match(manualOpen,/^<details[^>]*data-advanced-workspace="manual-gm"/);
 assert.doesNotMatch(existingOpen.match(/^<details[^>]*>/)?.[0]??'',/\bopen\b/);
 assert.doesNotMatch(manualOpen.match(/^<details[^>]*>/)?.[0]??'',/\bopen\b/);
 assert.match(manualOpen,/开发与验收工具：手动 GM 诊断（不属于普通修复流程）/);
});



test('TASK-017/TEST-002/022: manual scenario registration stays optional advanced diagnostics',()=>{
 const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
 const sectionStart=html.indexOf('<section id="scenario-workspace"');
 const sectionClose=html.indexOf('</section>',sectionStart);
 assert.ok(sectionStart>=0&&sectionClose>sectionStart,'the scenario workspace remains available');
 if(sectionStart<0||sectionClose<=sectionStart)return;
 const section=html.slice(sectionStart,sectionClose+'</section>'.length);
 const disclosureStart=section.indexOf('<details class="advanced-tools" data-advanced-workspace="manual-scenario">');
 const disclosureClose=section.indexOf('</details>',disclosureStart);
 assert.ok(disclosureStart>=0&&disclosureClose>disclosureStart,
  'manual scenario registration must be behind an advanced disclosure');
 if(disclosureStart<0||disclosureClose<=disclosureStart)return;
 const disclosure=section.slice(disclosureStart,disclosureClose+'</details>'.length);
 const opening=disclosure.slice(0,disclosure.indexOf('>')+1);
 assert.ok(disclosure.includes('<summary>高级诊断：手动登记只读场景（可选，不属于普通流程）</summary>'));
 for(const id of ['scenario-url','scenario-selector','scenario-replacement','scenario-register']){
  assert.ok(disclosure.includes('id="'+id+'"'),'the existing manual control must be preserved: '+id);
 }
 assert.equal(opening,'<details class="advanced-tools" data-advanced-workspace="manual-scenario">',
  'manual scenario controls must be collapsed by default');
 const ordinary=section.slice(0,disclosureStart);
 assert.ok(ordinary.includes('查看已登记场景与诊断状态；手动登记仅为可选高级辅助'));
 assert.doesNotMatch(ordinary,/登记本次会话要检查的目标网址和 CSS 选择器/);
 assert.doesNotMatch(ordinary,/id="scenario-(?:url|selector|replacement)"/,
  'ordinary scenario workspace must not require manual URL or selector entry');
 assert.ok(ordinary.includes('普通批量流程不要求逐脚本填写网址或 CSS 选择器'));
 assert.ok(ordinary.includes('UNKNOWN / 受阻'));
 assert.ok(section.includes('id="scenario-status"'));
 assert.ok(section.includes('id="scenario-list"'));
});

test('TASK-013/TEST-022/026: ordinary imported DOM batch derives selectors in main',()=>{
 const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const preload=readFileSync(join(process.cwd(),'app/preload/index.ts'),'utf8');
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const sectionStart=html.indexOf('<section id="diagnosis-workspace"');
 const sectionEnd=html.indexOf('</section>',sectionStart);
 assert.ok(sectionStart>=0&&sectionEnd>sectionStart,
  'the ordinary diagnosis workspace must exist');
 if(sectionStart<0||sectionEnd<=sectionStart)return;
 const diagnosis=html.slice(sectionStart,sectionEnd+'</section>'.length);
 const panelStart=diagnosis.indexOf('<div id="imported-dom-diagnosis"');
 const panelEnd=diagnosis.indexOf('<div data-scenario-context-slot>',panelStart);
 assert.ok(panelStart>=0&&panelEnd>panelStart,
  'the ordinary workflow must expose a batch DOM observation action');
 const panel=panelStart>=0&&panelEnd>panelStart?
  diagnosis.slice(panelStart,panelEnd):'';
 assert.match(panel,/id="imported-dom-target"/,
  'the batch target URL is explicit configuration');
 assert.match(panel,/id="imported-dom-run"/,
  'the user can start the ordinary read-only DOM batch');
 assert.match(panel,/id="imported-dom-result"/,
  'the ordinary flow must display UNKNOWN and per-script blocking results');
 assert.doesNotMatch(panel,/<input[^>]*(?:selector|选择器|CSS)/i,
  'the ordinary batch path must not ask the user to type CSS selectors');
 assert.match(panel,/不会执行脚本/);
 assert.match(panel,/候选的短时导出上下文只保存在主进程内存，最长五分钟/,
  'the ordinary UI must disclose the bounded in-memory candidate export context');
 assert.match(panel,/不证明.*Tampermonkey.*GM.*业务/);
 assert.match(ui,/diagnoseImportedBatch\(targetUrl\)/,
  'the renderer may send only the configured target URL');
 assert.match(preload,/diagnoseImportedBatch:\s*\(targetUrl: string\): Promise<unknown> =>\s*ipcRenderer\.invoke\('scenario:diagnose-imported-batch',targetUrl\)/);
 assert.match(main,/ipcMain\.handle\('scenario:diagnose-imported-batch'/,
  'the main process owns the imported-script diagnostic batch');
 assert.match(main,/importedDomDiagnosticIndex\.plan\(/);
 const handlerStart=main.indexOf("ipcMain.handle('scenario:diagnose-imported-batch'");
 const handlerEnd=main.indexOf("ipcMain.handle('scenario:inspect'",handlerStart);
 assert.ok(handlerStart>=0&&handlerEnd>handlerStart,
  'the new IPC handler must be bounded before the existing manual scenario path');
 const handler=handlerStart>=0&&handlerEnd>handlerStart?
  main.slice(handlerStart,handlerEnd):'';
 assert.match(handler,/dialog\.showMessageBox/,
  'each real navigation requires native consent');
 assert.match(handler,/readOwnedBrowser\(\)/,
  'ordinary DOM observations require the application-owned Chrome');
 assert.match(handler,/openApprovedTarget/);
 assert.match(handler,/observeApprovedDomSeries/,
  'the same consented DOM series must feed triage and candidate generation');
 assert.match(handler,/proposeImportedDomCandidate/);
 assert.match(handler,/readUtf8CandidateSource/);
 assert.match(handler,/clearCandidateSources/,
  'retained source must be cleared when the batch settles');
 assert.match(handler,/if\(!plan\.targetUrl\)\{\s*importedDomDiagnosticIndex\.clearCandidateSources\(\);/,
  'an invalid-target attempt must release retained source before returning');
 assert.match(handler,/if\(!owned\)\{\s*importedDomDiagnosticIndex\.clearCandidateSources\(\);/,
  'a no-browser attempt must release retained source before returning');
 assert.match(handler,/if\(lease===null\)return \{ok:false,code:'OBSERVATION_BUSY'/,
  'a busy operation must not clear another active operation’s source cache');
 assert.match(handler,/candidateStatus/);
 assert.doesNotMatch(handler,/candidateSource\s*:/,
  'full candidate source must never be returned over IPC');
 assert.match(handler,/candidateFields:Pick<ImportedDomResultItem/,
  'the IPC response must be narrowed to explicit candidate summary fields');
 assert.doesNotMatch(handler,/\.\.\.proposal/,
  'the internal proposal object must not be spread into an IPC response');
 assert.doesNotMatch(ui,/candidateSource/,
  'the renderer contract must contain only bounded candidate summaries');
 assert.match(ui,/候选预览（仅内存，尚未保存、应用或验证）/);
 assert.doesNotMatch(handler,/tampermonkeyVerified:\s*true|businessVerified:\s*true|automaticPatchAllowed:\s*true/);

 const importHandlers=main.slice(main.indexOf('const runNativeImport = async'),
  main.indexOf("ipcMain.handle('import:get-progress'"));
 assert.match(importHandlers,/scenarioObserveInProgress/,
  'a new native import cannot repopulate the source cache during DOM observation');
 const droppedBegin=main.slice(main.indexOf("ipcMain.handle('import:dropped-batch:begin'"),
  main.indexOf("ipcMain.handle('import:dropped-batch:add'"));
 assert.match(droppedBegin,/scenarioObserveInProgress/,
  'a new dropped batch cannot start during DOM observation');
 const singleDrop=main.slice(main.indexOf("ipcMain.handle('import:dropped',"),
  main.indexOf("ipcMain.handle('import:cancel-dropped'"));
 assert.match(singleDrop,/scenarioObserveInProgress/,
  'single dropped imports cannot start during DOM observation');
 assert.match(main,/recordImportedDomForCurrentOwner/,
  'an async import result must not write into a replacement window index');
});

test('TASK-013/TEST-022/026: cancelled DOM batch cannot retain export grants or return success',()=>{
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const start=main.indexOf("ipcMain.handle('scenario:diagnose-imported-batch'");
 const end=main.indexOf("ipcMain.handle('scenario:inspect'",start);
 assert.ok(start>=0&&end>start);
 const handler=main.slice(start,end);
 assert.match(handler,/let observationReceiptDelivered=false;/,
  'only a completely delivered batch receipt can retain export capabilities');
 assert.match(handler,/const cancelledItems=results\.map\(item=>item\.candidateStatus==='CANDIDATE_ONLY'[\s\S]*?candidateExportId:undefined[\s\S]*?return \{ok:false,code:deadlineExpired\?'TIME_BUDGET_EXHAUSTED':'CANCELLED',\s*items:cancelledItems/,
  'cancellation or timeout after partial observation must never return ok:true');
 assert.match(handler,/observationReceiptDelivered=true;\s*return \{ok:true,status:'UNKNOWN'/,
  'receipt ownership must be marked only at the final success path');
 assert.match(handler,/finally\{\s*clearTimeout\(deadline\);\s*importedDomDiagnosticIndex\.clearCandidateSources\(\);\s*if\(!observationReceiptDelivered\)importedDomCandidateExportStore\.clearOwner\(win\);/,
  'failure/cancelled observations must revoke partial one-use export handles');
 assert.match(handler,/if\(revoked\(\)\|\|win!==mainWindow\|\|win\.isDestroyed\(\)\|\|readOwnedBrowser\(\)!==owned\)/,
  'window and owned-browser replacement must remain fail-closed');
});

test('TASK-017/TEST-002/022: import completion routes to controlled Chrome, not optional manual scenarios',()=>{
 const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
 const workspace=html.match(/<section id="import-workspace"[\s\S]*?<\/section>/)?.[0];
 assert.ok(workspace,'the script library workspace must remain present');
 if(!workspace)return;
 assert.match(workspace,/<button[^>]*data-open-workspace="browser-workspace"[^>]*>前往浏览器环境<\/button>/,
  'the ordinary next step after import must lead to controlled Chrome setup');
 assert.doesNotMatch(workspace,/data-open-workspace="scenario-workspace"/,
  'optional manual scenario registration must not be presented as the ordinary next step');
});

test('TASK-013/TEST-022/026: full test command registers candidate planner and source-lifecycle regressions',()=>{
 const manifest=JSON.parse(readFileSync(join(process.cwd(),'package.json'),'utf8')) as
  {scripts?:{test?:string}};
 const command=manifest.scripts?.test??'';
 assert.match(command,/dist\/tests\/diagnostics\/imported-dom-diagnostic-index\.test\.js/,
  'CI and npm test must execute the source expiry/ownership regression tests');
 assert.match(command,/dist\/tests\/repair\/imported-dom-candidate\.test\.js/,
  'CI and npm test must execute candidate eligibility regressions');
});


test('TASK-007/TEST-017: silent Tampermonkey runtime produces actionable unknown-state guidance',()=>{
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
 const branch=ui.match(/else if\(result\.code==='RUNTIME_NOT_OBSERVED'\)\{([\s\S]*?)\}else setBrowserStatus/);
 assert.ok(branch,'a missing CDP runtime hint must be handled explicitly, not as an opaque code');
 if(!branch)return;
 assert.match(branch[1],/无法判断是否已安装/);
 assert.match(branch[1],/后台.*休眠/);
 assert.match(branch[1],/browserConnected\s*\?/,
  'owned and merely attached Chrome must have distinct safe recovery guidance');
 assert.match(branch[1],/官方安装页/);
 assert.match(branch[1],/另行.*确认/);
 assert.match(html,/id="open-tampermonkey-store"/);
 assert.match(html,/id="browser-status" role="status" aria-live="polite"/);
 assert.doesNotMatch(branch[1],/automaticPatchAllowed|scriptInstallationVerified:true/,
  'an absent runtime hint must never become installation or patch authority');
});


test('TASK-017/TEST-002/022: desktop ordinary user journey enforces unforced selector entry and explicit blocking visibility', () => {
  const html = readFileSync(join(process.cwd(), 'app/ui/index.html'), 'utf8');
  const ui = readFileSync(join(process.cwd(), 'app/ui/index.ts'), 'utf8');

  const expectedWorkspaces = [
    'import-workspace',
    'browser-workspace',
    'scenario-workspace',
    'diagnosis-workspace',
    'candidate-workspace',
    'restore-workspace',
    'ai-workspace',
  ];
  for (const id of expectedWorkspaces) {
    assert.match(html, new RegExp(`<section id="${id}"`));
  }

  const scenarioWorkspace = html.match(/<section id="scenario-workspace"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.ok(scenarioWorkspace.includes('普通批量流程不要求逐脚本填写网址或 CSS 选择器'));
  assert.ok(scenarioWorkspace.includes('data-advanced-workspace="manual-scenario"'));

  const browserWorkspace = html.match(/<section id="browser-workspace"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.ok(browserWorkspace.includes('data-advanced-workspace="manual-gm"'));
  assert.ok(browserWorkspace.includes('开发与验收工具：手动 GM 诊断（不属于普通修复流程）'));

  const importWorkspace = html.match(/<section id="import-workspace"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.match(importWorkspace, /data-open-workspace="browser-workspace"/);

  assert.ok(html.includes('UNKNOWN / 受阻'));
  assert.ok(ui.includes('无法判断是否已安装'));
});

test('TASK-013/TEST-023/026: native candidate export verifies original before directory dialogs and checks capability lifetime',()=>{
  const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
  const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
  const start=main.indexOf("ipcMain.handle('scenario:export-imported-candidate'");
  const end=main.indexOf("ipcMain.handle('scenario:cancel'",start);
  assert.ok(start>=0&&end>start);
  const handler=main.slice(start,end);
  const picked=handler.indexOf('const sourcePath=source.filePaths[0]');
  const initialRead=handler.indexOf('const initial=await importApprovedPaths([sourcePath],controller.signal)');
  const firstBackupDialog=handler.indexOf('const backup=await dialog.showOpenDialog');
  const finalRead=handler.indexOf('const current=await importApprovedPaths([sourcePath],controller.signal)');
  const exportDialog=handler.indexOf('const destination=await dialog.showOpenDialog');
  assert.ok(picked>=0&&initialRead>picked&&firstBackupDialog>initialRead,
   'source identity must be validated before asking for backup or export folders');
  assert.ok(handler.indexOf('initial.scripts[0].filename!==capability.filename')>initialRead&&
   handler.indexOf('initial.scripts[0].filename!==capability.filename')<firstBackupDialog);
  assert.ok(handler.indexOf('initial.scripts[0].sha256!==capability.context.originalSha256')>initialRead&&
   handler.indexOf('initial.scripts[0].sha256!==capability.context.originalSha256')<firstBackupDialog);
  assert.ok(finalRead>exportDialog,'source is re-read after destination dialogs to reject changed bytes');
  assert.ok((handler.match(/importedDomCandidateExportStore\.isReserved\(win,id\)/g)??[]).length>=3,
   'short-lived candidate authority must be rechecked before/between awaited native dialogs');
  assert.match(ui,/请重新导入原始脚本，再重新进行 DOM 观察/,
   'expired and consumed candidate receipts need explicit recovery instructions');
});

test('TASK-013/TEST-022/026: Electron shell smoke waits for recovered import state before consecutive file changes',()=>{
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const begin=main.indexOf('const waitForImportReady=async');
 const end=main.indexOf('const uiScenarioSelect=',begin);
 assert.ok(begin>=0&&end>begin);
 const smoke=main.slice(begin,end);
 const firstDispatch=smoke.indexOf("input.dispatchEvent(new Event('change',{bubbles:true}))");
 const secondDispatch=smoke.indexOf("input.dispatchEvent(new Event('change',{bubbles:true}))",
  firstDispatch+1);
 const helper=smoke.indexOf('const waitForImportReady=async');
 const firstDrop=smoke.indexOf("area.dispatchEvent(new DragEvent('drop'");
 const firstDropIdle=smoke.indexOf('const firstDropIdle=await waitForImportReady()');
 const badDrop=smoke.indexOf('const badDrop=new DataTransfer()');
 const badDropIdle=smoke.indexOf('const badDropIdle=await waitForImportReady()');
 const directoryScan=smoke.indexOf('const oldEntry=Object.getOwnPropertyDescriptor');
 assert.ok(helper>=0&&helper<firstDrop&&firstDropIdle>firstDrop&&
  firstDropIdle<badDrop&&badDropIdle>badDrop&&badDropIdle<directoryScan,
  'independent drags must wait for native finish and acknowledged recovery');
 const scanIdle=smoke.indexOf('const scanIdle=await waitForImportReady()');
 const batchIdle=smoke.indexOf('const batchIdle=await waitForImportReady()');
 assert.ok(helper>=0&&scanIdle>helper&&scanIdle<firstDispatch,
  'cancelled directory-scan recovery must settle before a new file-change event');
 assert.ok(firstDispatch>=0&&batchIdle>firstDispatch&&batchIdle<secondDispatch,
  'the previous file-input batch must fully settle before the next change event');
 assert.match(smoke,/NO_PENDING_RECOVERY/,
  'a rendered import row is not proof that main acknowledged its recovery receipt');
 assert.match(smoke,/select-files.*?disabled/,
  'the real file-input control must be checked for idle state');
 assert.match(smoke,/choose-files.*?disabled/);
 assert.match(smoke,/choose-folder.*?disabled/);
 assert.match(smoke,/cancel-import.*?disabled/);
 assert.match(smoke,/if\(!firstDropIdle\)throw Error\('SHELL_SMOKE_IMPORT_NOT_IDLE'\)/);
 assert.match(smoke,/if\(!badDropIdle\)throw Error\('SHELL_SMOKE_IMPORT_NOT_IDLE'\)/);
 assert.match(smoke,/if\(!scanIdle\)throw Error\('SHELL_SMOKE_IMPORT_NOT_IDLE'\)/);
 assert.match(smoke,/if\(!batchIdle\)throw Error\('SHELL_SMOKE_IMPORT_NOT_IDLE'\)/);
});

test('TASK-013/TEST-022: ordinary batch DOM observation has a scoped in-panel cancel action',()=>{
 const html=readFileSync(join(process.cwd(),'app/ui/index.html'),'utf8');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const panelStart=html.indexOf('<div id="imported-dom-diagnosis"');
 const panelEnd=html.indexOf('<div data-scenario-context-slot>',panelStart);
 assert.ok(panelStart>=0&&panelEnd>panelStart);
 const panel=html.slice(panelStart,panelEnd);
 assert.match(panel,/<button id="imported-dom-cancel" type="button"[^>]*disabled/);
 assert.match(ui,/const importedDomCancelButton=document\.getElementById\('imported-dom-cancel'\)/);
 assert.match(ui,/importedDomCancelButton\.disabled=!importedDomBusy\|\|importedDomCancelRequested/);
 assert.match(ui,/importedDomCancelButton\?\.addEventListener\('click'/);
 assert.match(ui,/void window\.healer\.cancelScenarioInspection\(\)/);
 assert.match(ui,/importedDomCancelRequested=true/);
 assert.match(ui,/importedDomCancelRequested=false/);
 assert.match(ui,/没有可靠取消回执|取消请求未确认/);
});

test('TASK-013/TEST-002/022: renderer skips unrelated file names before charging batch bytes',()=>{
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const start=ui.indexOf('async function importFiles(files: readonly File[])');
 const end=ui.indexOf('/** Read only the files of a folder',start);
 assert.ok(start>=0&&end>start,'ordinary importFiles implementation must exist');
 const body=ui.slice(start,end);
 const filenameCheck=body.indexOf("if (!/\\.user\\.js$/i.test(file.name))");
 const byteCheck=body.indexOf('if (readBytes + file.size > MAX_BATCH_BYTES)');
 const byteCharge=body.indexOf('readBytes += file.size');
 assert.ok(filenameCheck>=0&&filenameCheck<byteCheck&&filenameCheck<byteCharge,
  'an unrelated file must never consume the 128 MiB renderer budget before a valid userscript');
 assert.match(body,/file.name \+ ': NOT_USER_SCRIPT'/,
  'non-userscript selections must remain visible as independent failures');
 assert.match(body,/droppedImportProgress\.processed=index\+1/,
  'skipping an unrelated file must not stall batch progress reporting');
});

test('TASK-013/TEST-022/026: native batch candidate source lookup binds SHA and filename',()=>{
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const start=main.indexOf("ipcMain.handle('scenario:diagnose-imported-batch'");
 const end=main.indexOf("ipcMain.handle('scenario:inspect'",start);
 assert.ok(start>=0&&end>start,'native diagnosis handler must be present');
 const body=main.slice(start,end);
 assert.match(body,/readUtf8CandidateSource\(\s*item\.scriptSha256\s*,\s*item\.filename\s*\)/,
  'an imported hash alone must not select candidate source bytes for a different filename');
});

test('TASK-013/TEST-022/026: candidate proposal exceptions preserve completed DOM observation evidence',()=>{
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const start=main.indexOf("ipcMain.handle('scenario:diagnose-imported-batch'");
 const end=main.indexOf("ipcMain.handle('scenario:inspect'",start);
 assert.ok(start>=0&&end>start,'native batch diagnosis handler must remain present');
 const body=main.slice(start,end);
 // An isolated candidate error must not fall through to the outer
 // OBSERVATION_FAILED catch and discard an already accepted DOM result.
 assert.match(body,/candidatePreviewCount\+\+;\s*try\s*\{\s*const proposal=proposeImportedDomCandidate\(/,
  'candidate generation must have its own guarded failure boundary');
 assert.match(body,/catch\s*\{[\s\S]*?candidateFields=\{candidateStatus:'NOT_PROPOSED',\s*candidateReason:'PREVIEW_FAILED'\};\s*\}/,
  'a candidate-only exception must be reported without erasing the DOM observation');
 assert.match(body,/domStatus:'LIMITED_DOM_SIGNAL_ONLY'/,
  'the previously completed read-only observation remains in the per-item result');
});

test('TASK-013/TEST-022/026: candidate preview failure is legible without revoking DOM evidence',()=>{
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const start=ui.indexOf('function importedDomCandidateReason(');
 const end=ui.indexOf('function importedDomCandidateExportReason(',start);
 assert.ok(start>=0&&end>start,'candidate result translator must remain available');
 const messages=ui.slice(start,end);
 assert.match(messages,/PREVIEW_FAILED:'[^']*候选[^']*失败[^']*DOM[^']*保留[^']*未修改'/,
  'candidate-generation errors need a clear, read-only, no-mutation explanation');
});

test('TASK-013/TEST-022: absent owned Chrome preserves each script static block receipt',()=>{
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const start=main.indexOf("ipcMain.handle('scenario:diagnose-imported-batch'");
 const end=main.indexOf("ipcMain.handle('scenario:inspect'",start);
 assert.ok(start>=0&&end>start);
 const body=main.slice(start,end);
 const noBrowser=body.slice(body.indexOf('if(!owned){'),body.indexOf('const win=mainWindow;'));
 assert.match(noBrowser,/clearCandidateSources\(\)/,
  'failure must not retain source bytes without an owned browser');
 assert.match(noBrowser,/plan\.items\.map\(item=>/);
 assert.match(noBrowser,/item\.status==='READY_FOR_INSPECTION'/);
 assert.match(noBrowser,/blockedItem\(item,'BROWSER_NOT_RUNNING'\)/);
 assert.match(noBrowser,/blockedItem\(item\)/,
  'already blocked scripts must retain their distinct static-block reasons');
 assert.match(noBrowser,/items:.*perScriptBlocks/,
  'global absence of browser must still return per-script bounded receipts');
 const uiStart=ui.indexOf('if(!result.ok){',ui.indexOf('diagnoseImportedBatch(targetUrl).then('));
 const uiEnd=ui.indexOf('const items=Array.isArray(result.items)',uiStart);
 assert.ok(uiStart>=0&&uiEnd>uiStart);
 const failure=ui.slice(uiStart,uiEnd);
 assert.match(failure,/Array\.isArray\(result\.items\)/);
 assert.match(failure,/importedDomItems\?\.append\(row\)/);
 assert.match(failure,/importedDomBlockReason\(item\.code\)/);
 assert.match(failure,/重新导入/,
  'source-lifetime revocation must be explained without promising candidate reuse');
});

test('TASK-013/TEST-022: unavailable import sources do not exhaust 16 candidate proposal slots',()=>{
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const start=main.indexOf("ipcMain.handle('scenario:diagnose-imported-batch'");
 const end=main.indexOf("ipcMain.handle('scenario:inspect'",start);
 assert.ok(start>=0&&end>start,'batch DOM diagnosis must remain reachable');
 const body=main.slice(start,end);
 const guard=body.indexOf('if(candidatePreviewCount<16)');
 const source=body.indexOf('const source=importedDomDiagnosticIndex.readUtf8CandidateSource',guard);
 const absent=body.indexOf('if(source===null)',source);
 const proposal=body.indexOf('proposeImportedDomCandidate(',absent);
 const charge=body.indexOf('candidatePreviewCount++',guard);
 assert.ok(guard>=0&&source>guard&&absent>source&&proposal>absent&&
  charge>absent&&charge<proposal,
  'a missing source must not spend a proposal slot; only source-backed evaluations spend one');
 assert.match(body,/BATCH_PREVIEW_LIMIT/,
  'the maximum of sixteen actually attempted proposals must remain enforced');
});

test('TASK-013/TEST-022: startup dropped-batch recovery owns the renderer import lock',()=>{
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 assert.match(ui,/let startupRecoveryPending = true;/,
  'new renderer must visibly indicate pending recovery until its receipt settles');
 const summary=ui.slice(ui.indexOf('function updateImportSummary()'),ui.indexOf('function logLine('));
 assert.match(summary,/startupRecoveryPending\s*\?/,
  'pending recovery must be shown in the accessible import status');
 const handlers=ui.indexOf("cancelImport?.addEventListener('click'");
 const bootStart=ui.indexOf('void locked(async () => {',handlers);
 const pickerStart=ui.indexOf("chooseFile?.addEventListener('click'",handlers);
 assert.ok(handlers>=0&&bootStart>handlers&&pickerStart>bootStart,
  'startup recovery lock must be established before picker handlers');
 const boot=ui.slice(bootStart,pickerStart);
 assert.match(boot,/void locked\(async \(\) => \{/,
  'recovery must hold the same synchronous lock used by picker and drop handlers');
 assert.match(boot,/await recoverDroppedImportBatch\(\)/,
  'startup lock must not release before native recovery finishes');
 assert.match(boot,/finally \{[\s\S]*startupRecoveryPending = false;[\s\S]*updateImportSummary\(\)/,
  'status must leave recovery state even after a rejected recovery IPC');
 assert.doesNotMatch(boot,/void recoverDroppedImportBatch\(\)/,
  'fire-and-forget bootstrap must not allow overlapping new imports');
});

test('TASK-013/TEST-022: dropped directory entry errors isolate siblings and later roots',async()=>{
 const ts=await import('typescript');
 const vm=await import('node:vm');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 const start=ui.indexOf('function readDropEntry<T>(');
 const end=ui.indexOf("cancelImport?.addEventListener('click'",start);
 assert.ok(start>=0&&end>start,'bounded dropped-folder scan must exist');
 const source=ui.slice(start,end)+
  '\n(globalThis as unknown as {scan:typeof filesFromDrop}).scan=filesFromDrop;';
 const js=ts.transpileModule(source,{compilerOptions:{
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None
 }}).outputText;
 const lines:string[]=[];
 const env:Record<string,unknown>={
  MAX_DIRECTORY_ENTRIES:10000,MAX_DIRECTORY_DEPTH:8,MAX_FILES:1000,
  cancelRequested:false,failedCount:0,
  logLine:(line:string)=>lines.push(line),updateImportSummary:()=>{},
  setTimeout,clearTimeout,AbortController
 };
 vm.runInNewContext(js,env,{timeout:1000});
 const file=(name:string,rejected=false)=>({
  name,isFile:true,isDirectory:false,
  file:(ok:(v:unknown)=>void,fail:(e:Error)=>void)=>
   rejected?fail(new Error('file read denied')):ok({name})
 });
 const folder=(name:string,entries:unknown[],rejected=false)=>{
  let consumed=false;
  return {name,isFile:false,isDirectory:true,createReader:()=>({
   readEntries:(ok:(v:unknown[])=>void,fail:(e:Error)=>void)=>{
    if(rejected){fail(new Error('directory read denied'));return;}
    if(consumed){ok([]);return;}
    consumed=true;ok(entries);
   }
  })};
 };
 const roots=[
  folder('root',[
   file('bad.user.js',true),file('first.user.js'),
   folder('denied',[],true),file('second.user.js')
  ]),
  folder('another-root',[file('third.user.js')]),
  file('bad-root.user.js',true),
  file('last-root.user.js')
 ];
 const result=await (env.scan as (data:unknown,signal:AbortSignal)=>Promise<Array<{name:string}>>)({
  items:roots.map(entry=>({kind:'file',webkitGetAsEntry:()=>entry})),files:[]
 },new AbortController().signal);
 // Snapshot values into this Node realm: a vm Array has a distinct prototype.
 assert.deepEqual(Array.from(result,item=>item.name),[
  'first.user.js','second.user.js','third.user.js','last-root.user.js'
 ]);
 assert.equal(env.failedCount,3,'each unreadable entry counts as an isolated failure');
 assert.deepEqual(lines,[
  'bad.user.js: READ_OR_IMPORT_FAILED',
  'denied: DIRECTORY_READ_FAILED',
  'bad-root.user.js: READ_OR_IMPORT_FAILED'
 ]);
});


test('TASK-013/TEST-022/026: imported DOM batch uses bounded per-script retries and preserves per-script blocked receipts',()=>{
 const main=readFileSync(join(process.cwd(),'app/main/index.ts'),'utf8');
 const ui=readFileSync(join(process.cwd(),'app/ui/index.ts'),'utf8');
 assert.ok(main.includes("import {ReadOnlyBatchCoordinator} from '../../src/jobs/batch-coordinator'"),
  'the real native DOM batch must reuse the existing bounded coordinator');
 const start=main.indexOf("ipcMain.handle('scenario:diagnose-imported-batch'");
 const end=main.indexOf("ipcMain.handle('scenario:inspect'",start);
 assert.ok(start>=0&&end>start,'the native imported DOM batch handler must remain separately auditable');
 const handler=main.slice(start,end);
 assert.match(handler,/new ReadOnlyBatchCoordinator\(\{\s*count:ready\.length,\s*concurrency:1,\s*maxAttempts:2,\s*timeoutMs:120000\s*\}/,
  'each script must receive at most two sequential read-only attempts within the existing batch deadline');
 assert.match(handler,/return observation\.code==='CDP_FAILED'\?'RETRYABLE_FAILURE':'PERMANENT_FAILURE'/,
  'only a bounded transient CDP observation failure may consume the retry budget');
 assert.match(handler,/controller\.signal\.addEventListener\('abort',cancelCoordinator/,
  'batch cancellation and owner revocation must cancel queued retries');
 assert.match(handler,/batchSnapshot\.jobs\[index\]/,
  'the final per-script receipt must be derived from the coordinator outcome');
 assert.match(handler,/attempts:job\.attempts/,
  'the user-visible receipt must retain the actual attempt count');
 assert.match(handler,/if\(revoked\(\)\|\|win!==mainWindow\|\|win\.isDestroyed\(\)\|\|readOwnedBrowser\(\)!==owned\)\{[\s\S]*?code:deadlineExpired\?'TIME_BUDGET_EXHAUSTED':'CANCELLED',[\s\S]*?items:cancelledItems/,
  'the final synchronous receipt guard must re-check cancellation and batch timeout before returning success');
 assert.match(handler,/if\(!opened\.ok\)[\s\S]*?items:plan\.items\.map/,
  'a shared target-open failure must return a blocked receipt for every imported script');
 assert.match(ui,/item\.attempts/,
  'the UI must disclose actual attempts instead of hiding retry behavior');
 assert.match(handler,/\.\.\.unverified/);
 assert.match(main,/const unverified = \{tampermonkeyVerified:false as const,gmApiVerified:false as const,/);
 assert.match(main,/businessVerified:false as const,automaticPatchAllowed:false as const\}/);
});
