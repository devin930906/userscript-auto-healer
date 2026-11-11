import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SCRIPT_PATH = join(ROOT, 'scripts', 'windows-package-production.ps1');
const WORKFLOW_PATH = join(ROOT, '.github', 'workflows', 'release.yml');
const ISS_PATH = join(ROOT, 'packaging', 'windows', 'installer.iss');

test('TASK-021/GATE-008/011: production packaging script exists and is readable', () => {
  assert.equal(existsSync(SCRIPT_PATH), true, 'scripts/windows-package-production.ps1 must exist');
  const rawBytes = readFileSync(SCRIPT_PATH);
  assert.equal(rawBytes[0], 0xef, 'Byte 0 must be UTF-8 BOM 0xEF');
  assert.equal(rawBytes[1], 0xbb, 'Byte 1 must be UTF-8 BOM 0xBB');
  assert.equal(rawBytes[2], 0xbf, 'Byte 2 must be UTF-8 BOM 0xBF');
  assert.equal(rawBytes[3], 0x23, 'Byte 3 must be # (0x23), preventing duplicate BOM or corrupt leading token');
  const content = readFileSync(SCRIPT_PATH, 'utf8');
  assert.ok(content.length > 500, 'production packaging script must contain comprehensive logic');
});

test('TASK-021/GATE-008/011: production packaging script specifies production naming and installer template', () => {
  const content = readFileSync(SCRIPT_PATH, 'utf8');

  // Prefix must be production style: Userscript-Auto-Healer-v$version (no CANDIDATE suffix)
  assert.match(
    content,
    /\$prefix\s*=\s*"Userscript-Auto-Healer-v\$version"/,
    'Production deliverables prefix must be Userscript-Auto-Healer-v$version'
  );

  // Must reference packaging/windows/installer.iss
  assert.match(
    content,
    /packaging\\windows\\installer\.iss/,
    'Production packaging must use packaging/windows/installer.iss specification'
  );

  // Must produce official deliverables: Setup.exe, Portable.zip, SHA256SUMS.txt
  assert.match(content, /\$setupName\s*=\s*"\$prefix-Setup"/, 'Must define Setup name with prefix');
  assert.match(content, /\$prefix-Portable\.zip/i, 'Must output Portable.zip');
  assert.match(content, /SHA256SUMS\.txt/, 'Must output SHA256SUMS.txt');
});

test('TASK-021/GATE-008/009: production packaging enforces complete file hash parity and NTFS read-only test', () => {
  const content = readFileSync(SCRIPT_PATH, 'utf8');

  // Full SHA-256 parity for every file
  assert.match(
    content,
    /Get-FileHash -LiteralPath \$original\.FullName -Algorithm SHA256/,
    'Must compute SHA-256 for all individual files'
  );

  // NTFS ACL read-only verification
  assert.match(
    content,
    /icacls\.exe\s+\$expanded\s+\/deny/,
    'Must test ZIP extraction under NTFS read-only deny ACL'
  );

  // Independent checksum verification invocation
  assert.match(
    content,
    /Assert-CandidateChecksums/,
    'Must call Assert-CandidateChecksums for manifest integrity validation'
  );
});

test('TASK-021/GATE-011: release workflow defines official tag trigger and production pipeline', () => {
  assert.equal(existsSync(WORKFLOW_PATH), true, '.github/workflows/release.yml must exist');
  const content = readFileSync(WORKFLOW_PATH, 'utf8');

  // Triggered on v* tags and workflow_dispatch
  assert.match(content, /tags:\s*\r?\n\s*-\s*'v\*'/, 'Workflow must trigger on tags: [v*]');
  assert.match(content, /workflow_dispatch:/, 'Workflow must support workflow_dispatch trigger');

  // Windows 2025 runner
  assert.match(content, /runs-on:\s*windows-2025/, 'Workflow must run on windows-2025');

  // Execution steps: typecheck, test, packaging, release
  assert.match(content, /npm run typecheck/, 'Must verify TypeScript contracts');
  assert.match(content, /npm test/, 'Must run registered test suite');
  assert.match(content, /windows-package-production\.ps1/, 'Must execute production packaging script');
});

test('TASK-021/GATE-008: production app metadata isolates identity from candidate namespace', () => {
  const content = readFileSync(SCRIPT_PATH, 'utf8');

  // Production package.json in packaged app
  assert.match(
    content,
    /name\s*=\s*'userscript-auto-healer'/,
    'Packaged app name must be userscript-auto-healer'
  );
  assert.match(
    content,
    /productName\s*=\s*'Userscript Auto Healer'/,
    'Packaged app productName must be Userscript Auto Healer'
  );

  // Fail-Closed invariant
  assert.match(
    content,
    /automaticRepairAvailable\s*-ne\s*\$false/,
    'Must verify automaticRepairAvailable is false'
  );
});
