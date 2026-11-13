import { existsSync, readFileSync } from 'node:fs';
import { win32 } from 'node:path';

export interface ChromePlusPlusConfig {
  readonly isChromePlusPlus: boolean;
  readonly dataDir: string | null;
}

/**
 * Parses chrome++.ini contents to extract data_dir in the [general] section.
 * Replaces `%app%` with the directory containing chrome.exe.
 */
export function parseChromePlusPlusIni(content: string, appDir: string): { dataDir: string | null } {
  if (typeof content !== 'string' || content.length === 0 || content.length > 65536) {
    return { dataDir: null };
  }

  let inGeneralSection = false;
  let rawDataDir: string | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) {
      continue;
    }

    if (line.startsWith('[') && line.endsWith(']')) {
      const section = line.slice(1, -1).trim().toLowerCase();
      inGeneralSection = (section === 'general');
      continue;
    }

    if (inGeneralSection) {
      const eqIdx = line.indexOf('=');
      if (eqIdx !== -1) {
        const key = line.slice(0, eqIdx).trim().toLowerCase();
        const value = line.slice(eqIdx + 1).trim();
        if (key === 'data_dir' && value.length > 0 && value.toLowerCase() !== 'none') {
          rawDataDir = value.replace(/^["']|["']$/g, '');
          break;
        }
      }
    }
  }

  if (!rawDataDir) {
    return { dataDir: null };
  }

  try {
    // Replace %app% (case-insensitive) with appDir
    const expanded = rawDataDir.replace(/%app%/gi, appDir);
    const normalized = win32.normalize(expanded).replace(/[\\/]+$/, '');
    return { dataDir: normalized };
  } catch {
    return { dataDir: null };
  }
}

/**
 * Checks whether the given Chrome executable resides in a Chrome++ portable environment.
 * Indicators: presence of version.dll or chrome++.ini in the executable directory.
 */
export function isChromePlusPlus(executablePath: string): boolean {
  if (typeof executablePath !== 'string' || executablePath.length < 3) {
    return false;
  }
  try {
    const dir = win32.dirname(executablePath);
    const hasIni = existsSync(win32.join(dir, 'chrome++.ini'));
    const hasDll = existsSync(win32.join(dir, 'version.dll'));
    return hasIni || hasDll;
  } catch {
    return false;
  }
}

/**
 * Reads and returns the normalized data directory configured by chrome++.ini if present.
 */
export function getChromePlusPlusConfiguredDataDir(executablePath: string): string | null {
  if (!isChromePlusPlus(executablePath)) {
    return null;
  }
  try {
    const dir = win32.dirname(executablePath);
    const iniPath = win32.join(dir, 'chrome++.ini');
    if (!existsSync(iniPath)) {
      // Default convention for Chrome++ when ini has no data_dir is %app%\..\Data
      const defaultData = win32.normalize(win32.join(dir, '..', 'Data'));
      return existsSync(defaultData) ? defaultData : null;
    }
    const content = readFileSync(iniPath, 'utf8');
    const parsed = parseChromePlusPlusIni(content, dir);
    if (parsed.dataDir) {
      return parsed.dataDir;
    }
    // Fallback to convention %app%\..\Data
    const defaultData = win32.normalize(win32.join(dir, '..', 'Data'));
    return existsSync(defaultData) ? defaultData : null;
  } catch {
    return null;
  }
}
