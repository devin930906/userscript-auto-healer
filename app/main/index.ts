import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { importApprovedPaths, importDroppedBytes, scanApprovedDirectory, type ImportedScript } from '../../src/import/import-service';
import { previewImportedScriptAnalysis } from '../../src/analyze/import-preview';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

function summarize(script: ImportedScript) {
  return {filename:script.filename, byteLength:script.byteLength,
    sha256:script.sha256, textEncoding:script.textEncoding,
    analysis:previewImportedScriptAnalysis(script)};
}
function summarizeResult(result: Awaited<ReturnType<typeof importApprovedPaths>>) {
  return {canceled:false, scripts:result.scripts.map(summarize),
    errors:result.errors, duplicates:result.duplicates};
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
  // Every path MUST come from the native OS picker, not renderer-provided input.
  ipcMain.handle('import:files', async (event) => {
    authorizeSender(event);
    const win = mainWindow;
    if (!win || win.isDestroyed()) throw new Error('NO_WINDOW');
    const choice = await dialog.showOpenDialog(win, {
      title:'选择 .user.js 文件', properties:['openFile','multiSelections'],
      filters:[{name:'Userscript',extensions:['js']}]
    });
    if (choice.canceled) return {canceled:true,scripts:[],errors:[],duplicates:0};
    return summarizeResult(await importApprovedPaths(choice.filePaths));
  });
  ipcMain.handle('import:folder', async (event) => {
    authorizeSender(event);
    const win = mainWindow;
    if (!win || win.isDestroyed()) throw new Error('NO_WINDOW');
    const choice = await dialog.showOpenDialog(win, {title:'选择脚本文件夹',properties:['openDirectory']});
    if (choice.canceled || choice.filePaths.length !== 1)
      return {canceled:true,scripts:[],errors:[],duplicates:0};
    return summarizeResult(await scanApprovedDirectory(choice.filePaths[0]));
  });
  ipcMain.handle('import:dropped', (event, name:unknown, data:unknown) => {
    authorizeSender(event);
    const result = importDroppedBytes(name,data);
    return 'code' in result ? {ok:false,code:result.code} : {ok:true,script:summarize(result)};
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
    // Fixture files live solely inside the disposable Windows Actions runner.
    const fixtureDir = mkdtempSync(join(tmpdir(), 'uah-task002-e2e-'));
    writeFileSync(join(fixtureDir, 'approved.user.js'), '// ==UserScript==\\n// smoke\\n');
    const nativeDialog = dialog.showOpenDialog;
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true, writable: true,
      value: async (_window: unknown, options: {properties?: string[]}) => ({
        canceled: false,
        filePaths: options.properties?.includes('openDirectory')
          ? [fixtureDir] : [join(fixtureDir, 'approved.user.js')]
      })
    });
    // The test is run inside a real Electron renderer. A static source assertion
    // cannot prove that the sandbox preload or frame-checked IPC actually work.
    const probe = await win.webContents.executeJavaScript(
      "(async () => { const a = window.healer; " +
      "if (!a || typeof window.require !== 'undefined') return {ok:false}; " +
      "const s = await a.getStatus(); const bad = await a.validateConfig({}); " +
      "const d = await a.importDropped('smoke.user.js', new Uint8Array([47,47,32,111,107])); " +
      "const nativeFiles=await a.chooseFiles(); const folderFiles=await a.chooseFolder(); " +
      "const area=document.getElementById('drop-area'); const transfer=new DataTransfer(); " +
      "transfer.items.add(new File(['// test'], 'drop-smoke.user.js')); " +
      "transfer.items.add(new File(['// test'], 'drop-smoke.user.js')); " +
      "transfer.items.add(new File(['// other'], 'drop-other.user.js')); " +
      "area.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer})); " +
      "const rendered=await new Promise(resolve=>{ const start=Date.now(); const tick=()=>{ " +
      "const list=Array.from(document.querySelectorAll('#import-list li')).map(x=>x.textContent); " +
      "const yes=list.filter(x=>x.startsWith('drop-smoke.user.js:')).length===1 && " +
      "list.filter(x=>x.startsWith('drop-other.user.js:')).length===1 && " +
      "list.some(x=>x.includes('忽略重复脚本')); " +
      "if(yes)resolve(true); else if(Date.now()-start>3000)resolve(false); else setTimeout(tick,40); }; tick(); }); " +
      "return {ok:s.shell === 'development-skeleton' && s.automaticRepairAvailable === false && " +
      "s.aiEnabled === false && s.automaticApplyEnabled === false && bad.ok === false && " +
      "bad.code === 'INVALID_SHAPE' && d.ok === true && rendered === true && " +
      "nativeFiles.scripts.length === 1 && folderFiles.scripts.length === 1 && " +
      "nativeFiles.scripts[0].filename === 'approved.user.js' && d.script.filename === 'smoke.user.js' && " +
      "a.security.sandboxed === true && " +
      "a.security.isolated === true, keys:Object.keys(a).sort()}; })()",
      true
    ) as { ok?: boolean; keys?: string[] };
    Object.defineProperty(dialog, 'showOpenDialog', {configurable: true, writable: true, value: nativeDialog});
    rmSync(fixtureDir, {recursive: true, force: true});
    if (!probe?.ok || probe.keys?.join(',') !== 'chooseFiles,chooseFolder,getStatus,importDropped,security,validateConfig') {
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
