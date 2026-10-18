import { app, BrowserWindow, ipcMain, session } from 'electron';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateBrowserConfig } from '../../src/security/browser-config';
import { DESKTOP_WEB_PREFERENCES, SHELL_STATUS, trustedMainFrame } from '../../src/security/desktop-policy';

let mainWindow: BrowserWindow | null = null;
const uiFile = join(__dirname, '..', 'ui', 'index.html');
const trustedUrl = pathToFileURL(uiFile).href;

function authorizeSender(event: Electron.IpcMainInvokeEvent): void {
  const win = mainWindow;
  const frame = event.senderFrame;
  if (!win || win.isDestroyed() || !frame ||
      event.sender !== win.webContents ||
      frame !== win.webContents.mainFrame ||
      !trustedMainFrame(frame.url, trustedUrl, true)) {
    throw new Error('UNAUTHORIZED_RENDERER');
  }
}

function registerSafeIpc(): void {
  // No general invoke/channel/payload gateway; no file reading, shell access or script execution.
  ipcMain.handle('app:status', (event) => {
    authorizeSender(event);
    return SHELL_STATUS;
  });
  ipcMain.handle('config:validate', (event, input: unknown) => {
    authorizeSender(event);
    return validateBrowserConfig(input);
  });
}

async function createMainWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 900,
    height: 620,
    minWidth: 650,
    minHeight: 420,
    show: false,
    webPreferences: {
      ...DESKTOP_WEB_PREFERENCES,
      preload: join(__dirname, '..', 'preload', 'index.js')
    }
  });
  mainWindow = win;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
  await win.loadFile(uiFile);
  if (process.argv.includes('--uahtest-shell-only')) {
    // The test is run inside a real Electron renderer. A static source assertion
    // cannot prove that the sandbox preload or frame-checked IPC actually work.
    const probe = await win.webContents.executeJavaScript(
      "(async () => { const a = window.healer; " +
      "if (!a || typeof window.require !== 'undefined') return {ok:false}; " +
      "const s = await a.getStatus(); const bad = await a.validateConfig({}); " +
      "return {ok:s.shell === 'development-skeleton' && s.automaticRepairAvailable === false && " +
      "s.aiEnabled === false && s.automaticApplyEnabled === false && bad.ok === false && " +
      "bad.code === 'INVALID_SHAPE' && a.security.sandboxed === true && " +
      "a.security.isolated === true, keys:Object.keys(a).sort()}; })()",
      true
    ) as { ok?: boolean; keys?: string[] };
    if (!probe?.ok || probe.keys?.join(',') !== 'getStatus,security,validateConfig') {
      throw new Error('SHELL_SMOKE_SECURITY_FAILED');
    }
    const receipt = process.env.UAH_SMOKE_RECEIPT;
    if (!receipt) throw new Error('SHELL_SMOKE_RECEIPT_NOT_CONFIGURED');
    writeFileSync(receipt, JSON.stringify({
      shell: 'development-skeleton',
      preloadIpcVerified: true,
      rendererSandboxVerified: true,
      automaticRepairAvailable: false
    }), { encoding: 'utf-8', flag: 'wx' });
    app.exit(0);
    return;
  }
  if (!win.isDestroyed()) win.show();
}

app.whenReady().then(async () => {
  // Shell has no need for permissions. Explicit denial prevents accidental privilege creep.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  registerSafeIpc();
  await createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });
}).catch(() => {
  process.exitCode = 1;
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
