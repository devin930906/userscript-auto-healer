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
  createProfile: (): Promise<unknown> => ipcRenderer.invoke('browser:create-profile'),
  startBrowser: (port: number): Promise<unknown> => ipcRenderer.invoke('browser:start', port),
  inspectTampermonkey: (): Promise<unknown> => ipcRenderer.invoke('browser:tampermonkey-hint'),
  stopBrowser: (): Promise<unknown> => ipcRenderer.invoke('browser:stop'),
  startGmProbe: (runAt?: 'document-start' | 'document-idle'): Promise<unknown> =>
    ipcRenderer.invoke('gm-probe:start',runAt),
  gmProbeStatus: (): Promise<unknown> => ipcRenderer.invoke('gm-probe:status'),
  visitGmFixture: (mode: 'broken' | 'fixed'): Promise<unknown> => ipcRenderer.invoke('gm-probe:visit',mode),
  observeGmFixture: (mode: 'broken' | 'fixed'): Promise<unknown> => ipcRenderer.invoke('gm-probe:observe',mode),
  stopGmProbe: (): Promise<unknown> => ipcRenderer.invoke('gm-probe:stop')
}));
