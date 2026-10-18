// Sandbox preload permits the Electron bridge; it must not load Node filesystem/process APIs.
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

const isolatedProcess = process as NodeJS.Process & { sandboxed?: boolean; contextIsolated?: boolean };

contextBridge.exposeInMainWorld('healer', Object.freeze({
  security: Object.freeze({
    sandboxed: isolatedProcess.sandboxed === true,
    isolated: isolatedProcess.contextIsolated === true
  }),
  getStatus: (): Promise<unknown> => ipcRenderer.invoke('app:status'),
  validateConfig: (config: unknown): Promise<unknown> => ipcRenderer.invoke('config:validate', config),
  chooseFiles: (): Promise<unknown> => ipcRenderer.invoke('import:files'),
  chooseFolder: (): Promise<unknown> => ipcRenderer.invoke('import:folder'),
  importDropped: (name: string, bytes: Uint8Array): Promise<unknown> => ipcRenderer.invoke('import:dropped', name, bytes),
  chooseChrome: (): Promise<unknown> => ipcRenderer.invoke('browser:choose-chrome'),
  chooseProfile: (): Promise<unknown> => ipcRenderer.invoke('browser:choose-profile'),
  startBrowser: (port: number): Promise<unknown> => ipcRenderer.invoke('browser:start', port),
  inspectTampermonkey: (): Promise<unknown> => ipcRenderer.invoke('browser:tampermonkey-hint'),
  stopBrowser: (): Promise<unknown> => ipcRenderer.invoke('browser:stop')
}));
