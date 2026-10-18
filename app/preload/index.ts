// Sandbox preload permits the Electron bridge; it must not load Node filesystem/process APIs.
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

contextBridge.exposeInMainWorld('healer', Object.freeze({
  getStatus: (): Promise<unknown> => ipcRenderer.invoke('app:status'),
  validateConfig: (config: unknown): Promise<unknown> => ipcRenderer.invoke('config:validate', config)
}));
