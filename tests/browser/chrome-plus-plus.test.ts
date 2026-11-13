import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { win32 } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  isChromePlusPlus,
  getChromePlusPlusConfiguredDataDir,
  parseChromePlusPlusIni
} from '../../src/browser/chrome-plus-plus';

test('parseChromePlusPlusIni extracts data_dir and replaces %app% token', () => {
  const iniContent = `
[general]
data_dir=%app%\\..\\Data
cache_dir=%app%\\..\\Cache
command_line=--no-first-run
`;
  const appDir = 'C:\\Browser\\App';
  const parsed = parseChromePlusPlusIni(iniContent, appDir);
  assert.equal(parsed.dataDir, win32.normalize('C:\\Browser\\Data'));
});

test('parseChromePlusPlusIni handles absolute data_dir without %app%', () => {
  const iniContent = `
[general]
data_dir=D:\\UserData\\ChromeData
`;
  const appDir = 'C:\\Browser\\App';
  const parsed = parseChromePlusPlusIni(iniContent, appDir);
  assert.equal(parsed.dataDir, win32.normalize('D:\\UserData\\ChromeData'));
});

test('parseChromePlusPlusIni returns null dataDir when missing or empty', () => {
  const iniContent = `
[general]
cache_dir=%app%\\Cache
`;
  const appDir = 'C:\\Browser\\App';
  const parsed = parseChromePlusPlusIni(iniContent, appDir);
  assert.equal(parsed.dataDir, null);
});

test('isChromePlusPlus detects version.dll and chrome++.ini in exe directory', (t) => {
  const testRoot = win32.join(tmpdir(), 'chrome_plus_plus_test_' + Date.now());
  mkdirSync(testRoot, { recursive: true });
  t.after(() => rmSync(testRoot, { recursive: true, force: true }));

  const exePath = win32.join(testRoot, 'chrome.exe');
  writeFileSync(exePath, 'binary');

  assert.equal(isChromePlusPlus(exePath), false);

  const iniPath = win32.join(testRoot, 'chrome++.ini');
  writeFileSync(iniPath, '[general]\ndata_dir=%app%\\..\\Data\n');

  assert.equal(isChromePlusPlus(exePath), true);
  const dataDir = getChromePlusPlusConfiguredDataDir(exePath);
  assert.equal(dataDir, win32.normalize(win32.join(testRoot, '..', 'Data')));
});

import { isLiveApprovedChromeSession } from '../../src/browser/owned-chrome';

test('isLiveApprovedChromeSession handles false for unregistered or invalid sessions', () => {
  assert.equal(isLiveApprovedChromeSession(null as any), false);
  assert.equal(isLiveApprovedChromeSession({} as any), false);
  assert.equal(isLiveApprovedChromeSession({ ok: false, code: 'LAUNCH_FAILED' } as any), false);
});

