import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ISS_PATH = join(process.cwd(), 'packaging', 'windows', 'installer.iss');

test('TASK-019/TEST-027: production Inno Setup script exists and is readable', () => {
  assert.equal(existsSync(ISS_PATH), true, 'packaging/windows/installer.iss must exist');
  const content = readFileSync(ISS_PATH, 'utf8');
  assert.ok(content.length > 100, 'installer.iss content must not be empty');
});

test('TASK-019/TEST-027: production installer specifies isolated production AppId', () => {
  const content = readFileSync(ISS_PATH, 'utf8');
  const appIdMatch = content.match(/AppId=([^\r\n]+)/);
  assert.ok(appIdMatch, 'installer.iss must declare an AppId');
  const appId = appIdMatch[1].trim();

  // Must not reuse development candidate namespace
  assert.notEqual(
    appId,
    'UserscriptAutoHealerDevelopmentCandidate',
    'Production AppId must differ from disposable candidate AppId'
  );
  assert.ok(
    appId.startsWith('{{') && appId.endsWith('}}'),
    'Production AppId should be a valid Inno Setup GUID'
  );
});

test('TASK-019/TEST-027: production installer requires lowest privileges and user-level directory', () => {
  const content = readFileSync(ISS_PATH, 'utf8');

  // PrivilegesRequired=lowest ensures no admin UAC escalation is forced
  assert.match(
    content,
    /PrivilegesRequired=lowest/i,
    'Installer must set PrivilegesRequired=lowest for per-user installation'
  );

  // DefaultDirName must target per-user {localappdata}
  assert.match(
    content,
    /DefaultDirName=\{localappdata\}\\Programs\\UserscriptAutoHealer/i,
    'Installer must target {localappdata}\\Programs\\UserscriptAutoHealer'
  );
});

test('TASK-019/TEST-027: production installer preserves directory on upgrade', () => {
  const content = readFileSync(ISS_PATH, 'utf8');

  // UsePreviousAppDir=yes ensures same-AppId upgrades do not scatter installations
  assert.match(
    content,
    /UsePreviousAppDir=yes/i,
    'Installer must set UsePreviousAppDir=yes to support seamless upgrade'
  );
});

test('TASK-019/TEST-027: uninstaller and icon references are consistent and solid compression enabled', () => {
  const content = readFileSync(ISS_PATH, 'utf8');

  assert.match(
    content,
    /UninstallDisplayIcon=\{app\}\\/i,
    'UninstallDisplayIcon must point to app executable'
  );
  assert.match(
    content,
    /SolidCompression=yes/i,
    'Solid compression must be enabled'
  );
  assert.match(
    content,
    /Compression=lzma/i,
    'LZMA compression must be specified'
  );
});

test('TASK-019/TEST-027: desktop shortcut is optional and unchecked by default', () => {
  const content = readFileSync(ISS_PATH, 'utf8');

  const taskMatch = content.match(/Name:\s*"desktopicon"[^\r\n]*Flags:\s*unchecked/i);
  assert.ok(
    taskMatch,
    'Desktop icon task must have Flags: unchecked to respect user choice'
  );
});
