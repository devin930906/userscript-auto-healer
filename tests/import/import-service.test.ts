import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importApprovedPaths, importDroppedBytes, MAX_SCRIPT_BYTES, scanApprovedDirectory } from '../../src/import/import-service';

async function workspace(t: { after: (cb: () => Promise<void>) => void }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'uah-import-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const script = '// ==UserScript==\\n// @name Safe\\n// ==/UserScript==\\nconsole.log(1);\\n'.replaceAll('\\n', '\n');

test('TEST-001: raw input bytes, SHA-256 and source file stay unchanged', async t => {
  const root = await workspace(t);
  const path = join(root, 'valid.user.js');
  const bytes = Buffer.from(script, 'utf8');
  await writeFile(path, bytes);
  const o = await importApprovedPaths([path]);
  assert.equal(o.scripts.length, 1);
  assert.equal(o.errors.length, 0);
  assert.deepEqual(Buffer.from(o.scripts[0].bytes), bytes);
  assert.equal(o.scripts[0].sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(o.scripts[0].textEncoding, 'utf-8');
  assert.deepEqual(await readFile(path), bytes);
});

test('TEST-001: UTF-8 BOM and UTF-16 BOM recognized without rewriting originals', async t => {
  const root = await workspace(t);
  const a = join(root, 'bom.user.js');
  const b = join(root, 'utf16.user.js');
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(script)]);
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(script, 'utf16le')]);
  await writeFile(a, bom); await writeFile(b, utf16);
  const o = await importApprovedPaths([a, b]);
  assert.equal(o.errors.length, 0);
  assert.deepEqual(o.scripts.map(s => s.textEncoding).sort(), ['utf-16le-bom', 'utf-8-bom']);
  assert.deepEqual(await readFile(a), bom);
});

test('TEST-001: malformed, binary and wrong-suffix files fail independently', async t => {
  const root = await workspace(t);
  const good = join(root, 'good.user.js');
  const invalid = join(root, 'invalid.user.js');
  const binary = join(root, 'binary.user.js');
  const txt = join(root, 'note.txt');
  await writeFile(good, script); await writeFile(invalid, Buffer.from([0xff, 0xfd, 0xfb]));
  await writeFile(binary, Buffer.from([0, 1, 2, 3]));
  await writeFile(txt, script);
  const o = await importApprovedPaths([invalid, good, binary, txt]);
  assert.equal(o.scripts.length, 1);
  assert.equal(o.errors.length, 3);
  assert.ok(o.errors.some(e => e.code === 'INVALID_ENCODING'));
  assert.ok(o.errors.some(e => e.code === 'BINARY_CONTENT'));
  assert.ok(o.errors.some(e => e.code === 'NOT_USER_SCRIPT'));
});

test('TEST-001: missing files fail safely while valid files import', async t => {
  const root = await workspace(t);
  const good = join(root, 'good.user.js');
  await writeFile(good, script);
  const o = await importApprovedPaths([join(root, 'missing.user.js'), good]);
  assert.equal(o.scripts.length, 1);
  assert.equal(o.errors[0].code, 'IO_FAILURE');
});

test('TEST-002: duplicate selected paths are only imported once', async t => {
  const root = await workspace(t);
  const file = join(root, 'same.user.js');
  await writeFile(file, script);
  const o = await importApprovedPaths([file, file]);
  assert.equal(o.duplicates, 1);
  assert.equal(o.scripts.length, 1);
});

test('TEST-002: drag bytes need valid name and byte buffer, no disk read', () => {
  const input = new TextEncoder().encode(script);
  const okay = importDroppedBytes('drag.user.js', input);
  assert.equal('code' in okay, false);
  assert.equal('bytes' in okay && okay.byteLength, input.length);
  assert.equal('code' in importDroppedBytes('../evil.user.js', input), true);
  assert.equal('code' in importDroppedBytes('x.user.js', [1,2,3]), true);
  assert.equal('code' in importDroppedBytes('oversize.user.js', new Uint8Array(MAX_SCRIPT_BYTES + 1)), true);
});

test('TEST-003: nested directory skips non-scripts and avoids outside roots', async t => {
  const root = await workspace(t);
  const nested = join(root, 'nested');
  await mkdir(nested);
  await writeFile(join(root, 'one.user.js'), script);
  await writeFile(join(nested, 'two.user.js'), script);
  await writeFile(join(nested, 'not-a-script.js'), 'bad');
  const o = await scanApprovedDirectory(root);
  assert.equal(o.scripts.length, 2);
  assert.equal(o.errors.length, 0);
  assert.deepEqual(o.scripts.map(s => s.filename).sort(), ['one.user.js', 'two.user.js']);
});

test('TEST-003: directory link escape never traversed', async t => {
  const root = await workspace(t);
  const outside = await workspace(t);
  const destination = join(outside, 'private.user.js');
  await writeFile(destination, script);
  await writeFile(join(root, 'safe.user.js'), script);
  await symlink(outside, join(root, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir');
  const o = await scanApprovedDirectory(root);
  assert.deepEqual(o.scripts.map(s => s.filename), ['safe.user.js']);
  assert.ok(o.errors.some(e => e.code === 'SYMLINK_REJECTED'));
});

test('TEST-003: symlink file cannot bypass path scanner', async t => {
  const root = await workspace(t);
  const target = join(root, 'source.user.js');
  const link = join(root, 'linked.user.js');
  await writeFile(target, script);
  await symlink(target, link, 'file');
  const o = await importApprovedPaths([link]);
  assert.equal(o.scripts.length, 0);
  assert.equal(o.errors[0].code, 'SYMLINK_REJECTED');
});

test('TEST-003: non-absolute root is never scanned', async () => {
  const o = await scanApprovedDirectory('relative/path');
  assert.equal(o.scripts.length, 0);
  assert.equal(o.errors[0].code, 'INVALID_PATH');
});

test('TEST-001: disk import accepts exact byte limit and rejects larger files without loading them', async t => {
  const root = await workspace(t);
  const exactPath = join(root, 'exact.user.js');
  const tooLargePath = join(root, 'oversized.user.js');
  const exact = Buffer.alloc(MAX_SCRIPT_BYTES, 0x61);
  exact.write(script, 0, 'utf8');
  await writeFile(exactPath, exact);
  await writeFile(tooLargePath, Buffer.concat([exact, Buffer.from('!')]));
  const imported = await importApprovedPaths([tooLargePath, exactPath]);
  assert.equal(imported.scripts.length, 1);
  assert.equal(imported.scripts[0].filename, 'exact.user.js');
  assert.equal(imported.scripts[0].byteLength, MAX_SCRIPT_BYTES);
  assert.equal(imported.scripts[0].sha256, createHash('sha256').update(exact).digest('hex'));
  assert.ok(imported.errors.some(error =>
    error.filename === 'oversized.user.js' && error.code === 'FILE_TOO_LARGE'));
  assert.deepEqual(await readFile(exactPath), exact);
});

test('TEST-001: disk source is re-read and rehashed instead of accepting stale source bytes', async t => {
  const root = await workspace(t);
  const selected = join(root, 'updated.user.js');
  const original = Buffer.from(script);
  const changed = Buffer.from(script.replace('console.log(1)', 'console.log(2)'));
  await writeFile(selected, original);
  const first = await importApprovedPaths([selected]);
  assert.equal(first.scripts.length, 1);
  await writeFile(selected, changed);
  const second = await importApprovedPaths([selected]);
  assert.equal(second.scripts.length, 1);
  assert.deepEqual(Buffer.from(second.scripts[0].bytes), changed);
  assert.notEqual(first.scripts[0].sha256, second.scripts[0].sha256);
});

test('TEST-002/022: canceled native selection does not read any script bytes', async t => {
  const root = await workspace(t);
  const path = join(root, 'untouched.user.js');
  const source = Buffer.from(script);
  await writeFile(path, source);
  const controller = new AbortController();
  controller.abort();
  const outcome = await importApprovedPaths([path], controller.signal);
  assert.equal(outcome.canceled, true);
  assert.equal(outcome.unprocessed, 1);
  assert.equal(outcome.scripts.length, 0);
  assert.deepEqual(await readFile(path), source);

  const folder = await scanApprovedDirectory(root, controller.signal);
  assert.equal(folder.canceled, true);
  assert.equal(folder.scripts.length, 0);
});

test('TEST-002/022: cancellation between files preserves completed results', async t => {
  const root = await workspace(t);
  const one = join(root, 'first.user.js');
  const two = join(root, 'second.user.js');
  const source = Buffer.from(script);
  await writeFile(one, source);
  await writeFile(two, source);
  const controller = new AbortController();
  // Deterministic cancellation after first entry is scheduled, while keeping
  // filesystem reads intact. The second path must never be processed.
  const chosen = [one, two];
  Object.defineProperty(chosen, '0', {configurable:true,
    get(){controller.abort();return one;}});
  const outcome = await importApprovedPaths(chosen, controller.signal);
  assert.equal(outcome.canceled, true);
  assert.equal(outcome.unprocessed, 1);
  assert.deepEqual(outcome.scripts.map(x=>x.filename), ['first.user.js']);
  assert.equal(outcome.errors.length, 0);
  assert.deepEqual(await readFile(one), source);
  assert.deepEqual(await readFile(two), source);
});

test('TEST-002/003: byte-identical renamed scripts dedupe, changed revisions stay independent', async t => {
  const root = await workspace(t);
  const firstDir = join(root, 'one');
  const secondDir = join(root, 'two');
  await mkdir(firstDir); await mkdir(secondDir);
  const a = join(firstDir, 'original.user.js');
  const b = join(secondDir, 'renamed.user.js');
  const c = join(secondDir, 'original.user.js');
  const different = script.replace('console.log(1)', 'console.log(2)');
  await writeFile(a, script);
  await writeFile(b, script);
  await writeFile(c, different);

  const native = await importApprovedPaths([a, b, c]);
  assert.equal(native.errors.length, 0);
  assert.equal(native.duplicates, 1);
  assert.deepEqual(native.scripts.map(x => x.filename),
    ['original.user.js', 'original.user.js']);
  assert.notEqual(native.scripts[0].sha256, native.scripts[1].sha256);

  const folder = await scanApprovedDirectory(root);
  assert.equal(folder.errors.length, 0);
  assert.equal(folder.scripts.length, 2);
  assert.equal(folder.duplicates, 1);
  assert.deepEqual(new Set(folder.scripts.map(x => x.sha256)),
    new Set(native.scripts.map(x => x.sha256)));

  // Neither deduplication nor parsing is allowed to mutate originals.
  assert.equal(await readFile(a, 'utf8'), script);
  assert.equal(await readFile(b, 'utf8'), script);
  assert.equal(await readFile(c, 'utf8'), different);
});
