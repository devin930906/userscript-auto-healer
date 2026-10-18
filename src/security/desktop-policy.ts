/** Security invariants shared by the Electron main process and pure tests. */
export const DESKTOP_WEB_PREFERENCES = Object.freeze({
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false
});

/** This is an additional check: the main process must ALSO compare senderFrame object identity. */
export function trustedMainFrame(frameUrl: unknown, expectedUrl: string, isMainFrame: boolean): boolean {
  return isMainFrame && typeof frameUrl === 'string' &&
    frameUrl === expectedUrl && frameUrl.startsWith('file:///');
}

export type ShellStatus = Readonly<{
  shell: 'development-skeleton';
  automaticRepairAvailable: false;
  aiEnabled: false;
  automaticApplyEnabled: false;
}>;

export const SHELL_STATUS: ShellStatus = Object.freeze({
  shell: 'development-skeleton',
  automaticRepairAvailable: false,
  aiEnabled: false,
  automaticApplyEnabled: false
});
