import { win32 } from 'node:path';

export type BrowserConfig = Readonly<{
  executablePath: string;
  userDataDir: string;
  remoteDebuggingPort: number;
  bindAddress: '127.0.0.1';
}>;

export type ConfigValidation =
  | Readonly<{ ok: true; config: BrowserConfig; verifiedOnDisk: false }>
  | Readonly<{ ok: false; code: 'INVALID_SHAPE' | 'INVALID_EXECUTABLE' | 'UNSAFE_PROFILE' | 'INVALID_PORT' | 'INVALID_BIND' }>;

/**
 * Syntactic preflight ONLY, with no filesystem access, no process launch and no writes.
 * TASK-005 must additionally verify the real executable, symlinks, profile ownership/locks,
 * Chrome default-profile identity and occupied CDP ports before starting a browser.
 */
function safeWindowsDrivePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096 || value.length < 4) return false;
  if (!/^[A-Za-z]:\\/.test(value) || !win32.isAbsolute(value)) return false;
  if (/[\u0000-\u001f<>|"*?%]/.test(value) || value.includes('/')) return false;
  if (value.split('\\').some(part => part === '.' || part === '..' || part.endsWith('.') || part.endsWith(' '))) return false;
  return true;
}

export function validateBrowserConfig(input: unknown): ConfigValidation {
  // Renderer-supplied IPC objects have no authority to run getters or carry
  // hidden/symbol properties. Snapshot exact own DATA descriptors first;
  // revoked/hostile Proxies fail closed without leaking their error text.
  let record: Record<string, unknown>;
  try {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, code: 'INVALID_SHAPE' };
    }
    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) {
      return { ok: false, code: 'INVALID_SHAPE' };
    }
    const allowed = ['executablePath', 'userDataDir', 'remoteDebuggingPort', 'bindAddress'];
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const own = Reflect.ownKeys(descriptors);
    if (own.length !== allowed.length || own.some(key => typeof key !== 'string') ||
        allowed.some(key => !Object.prototype.hasOwnProperty.call(descriptors, key) ||
          !Object.prototype.hasOwnProperty.call(descriptors[key], 'value'))) {
      return { ok: false, code: 'INVALID_SHAPE' };
    }
    record = Object.create(null) as Record<string, unknown>;
    for (const key of allowed) record[key] = descriptors[key].value;
  } catch {
    return { ok: false, code: 'INVALID_SHAPE' };
  }
  if (!safeWindowsDrivePath(record.executablePath) ||
      win32.basename(record.executablePath).toLowerCase() !== 'chrome.exe') {
    return { ok: false, code: 'INVALID_EXECUTABLE' };
  }
  if (!safeWindowsDrivePath(record.userDataDir)) {
    return { ok: false, code: 'UNSAFE_PROFILE' };
  }
  const profile = win32.normalize(record.userDataDir).replace(/\\+$/, '').toLowerCase();
  const executable = win32.normalize(record.executablePath).toLowerCase();
  const parent = win32.dirname(executable);
  // A root, Chrome's existing daily-use profile, or an application binary directory
  // can never be accepted as a proposed isolated profile.
  if (/^[a-z]:$/.test(profile) ||
      /\\google\\chrome\\user data(?:\\|$)/.test(profile) ||
      profile === parent || executable.startsWith(profile + '\\')) {
    return { ok: false, code: 'UNSAFE_PROFILE' };
  }
  if (!Number.isInteger(record.remoteDebuggingPort) ||
      (record.remoteDebuggingPort as number) < 1024 ||
      (record.remoteDebuggingPort as number) > 65535) {
    return { ok: false, code: 'INVALID_PORT' };
  }
  if (record.bindAddress !== '127.0.0.1') {
    return { ok: false, code: 'INVALID_BIND' };
  }
  return {
    ok: true,
    config: {
      executablePath: win32.normalize(record.executablePath),
      userDataDir: win32.normalize(record.userDataDir),
      remoteDebuggingPort: record.remoteDebuggingPort as number,
      bindAddress: '127.0.0.1'
    },
    verifiedOnDisk: false
  };
}
