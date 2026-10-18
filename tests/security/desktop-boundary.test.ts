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

test('TASK-001: reject executable path injection and non-Chrome binaries', () => {
  for (const path of ['chrome.exe', String.raw`\\server\share\chrome.exe`,
    String.raw`C:\Apps\firefox.exe`, String.raw`C:\Apps\..\chrome.exe`,
    'C:\\Chrome\\chrome.exe\n--bad', String.raw`C:\Apps\chrome.exe.`]) {
    assert.equal(validateBrowserConfig({...allowed, executablePath: path}).ok, false);
  }
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
  assert.equal((main.match(/ipcMain\.handle\(/g) || []).length, 16);
  assert.match(main, /ipcMain\.handle\('browser:start'/);
  assert.match(main, /dialog\.showMessageBox/);
  assert.match(main, /stopOnlyOwnedBrowser\(\)/);
  assert.match(main, /prepareApprovedIsolatedProfile\(config\.config,true\)/);
  assert.match(main, /randomUUID\(\)/);
  assert.match(main, /ipcMain\.handle\('gm-probe:start'/);
  assert.match(main, /ipcMain\.handle\('gm-probe:status'/);
  assert.match(main, /ipcMain\.handle\('gm-probe:stop'/);
  assert.match(main, /startApprovedTampermonkeyDiagnostic\(owned,true/);
  assert.match(main, /ipcMain\.handle\('gm-probe:visit'/);
  assert.match(main, /ipcMain\.handle\('gm-probe:observe'/);
  assert.match(main, /consistencySnapshot\(\)/);
  assert.match(main, /domSnapshot\(\)/);
  assert.match(main, /stopOnlyGmProbe\(\)/);
  assert.match(main, /onUnexpectedExit:\(\)=>/);
  assert.match(main, /ownedBrowser=null;\s*stopOnlyGmProbe\(\)/);
});

test('TASK-001: preload does not expose raw IPC, shell or filesystem to renderer', () => {
  const preload = readFileSync(join(process.cwd(), 'app/preload/index.ts'), 'utf-8');
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.doesNotMatch(preload, /ipcRenderer\.(send|on|sendSync)\b/);
  assert.doesNotMatch(preload, /require\(['"]node:(fs|child_process)/);
  assert.equal((preload.match(/ipcRenderer\.invoke\(/g) || []).length, 16);
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\('browser:start',\s*(?:config|path)/);
  assert.match(preload, /ipcRenderer\.invoke\('gm-probe:start'\)/);
  assert.match(preload, /ipcRenderer\.invoke\('gm-probe:status'\)/);
  assert.match(preload, /ipcRenderer\.invoke\('gm-probe:stop'\)/);
  assert.match(preload, /ipcRenderer\.invoke\('gm-probe:visit',mode\)/);
  assert.match(preload, /ipcRenderer\.invoke\('gm-probe:observe',mode\)/);
});
