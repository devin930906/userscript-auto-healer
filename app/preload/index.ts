// Sandbox preload permits the Electron bridge; it must not load Node filesystem/process APIs.
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

const isolatedProcess = process as NodeJS.Process & { sandboxed?: boolean; contextIsolated?: boolean };

contextBridge.exposeInMainWorld('healer', Object.freeze({
  security: Object.freeze({
    sandboxed: isolatedProcess.sandboxed === true,
    isolated: isolatedProcess.contextIsolated === true
  }),
  getStatus: (): Promise<unknown> => ipcRenderer.invoke('app:status'),
  validateConfig: (config: unknown): Promise<unknown> => ipcRenderer.invoke('config:validate', config)
}));
