import { app, BrowserWindow, ipcMain, session } from 'electron';
import { join } from 'node:path';
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
