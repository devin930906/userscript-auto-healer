import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { importDroppedBytes } from '../../src/import/import-service';
import { parseUserscriptMetadata, readUserscriptSource } from '../../src/analyze/metadata-parser';

const source = [
  '// ==UserScript==',
  '// @name Example',
  '// @match https://a.test/*',
  '// @match https://b.test/*',
  '// @include https://old.test/*',
  '// @exclude https://a.test/private/*',
  '// @run-at document-end',
  '// @grant GM_getValue',
  '// @require https://cdn.test/safe.js',
  '// @resource icon https://cdn.test/icon.png',
  '// @connect api.test',
  '// @custom-tag keep this',
  '// ordinary comment',
  '// ==/UserScript==',
  'globalThis.__uaExecuted = true;'
].join('\r\n');

test('TEST-004: ordered metadata and repeated tags without executing source', () => {
  const imported = importDroppedBytes('main.user.js', Buffer.from(source));
  assert.ok(!('code' in imported));
  if ('code' in imported) return;
  const original = Buffer.from(imported.bytes);
  const data = parseUserscriptMetadata(imported);
  assert.equal(data.status,'OK');
  assert.deepEqual(data.tags.match,['https://a.test/*','https://b.test/*']);
  for (const key of ['include','exclude','run-at','grant','require','resource','connect']) {
    assert.equal(data.tags[key].length,1);
  }
  assert.deepEqual(data.unknownNames,['custom-tag']);
  assert.equal(data.lines[0].line,2);
  assert.equal(data.lines[0].raw,'// @name Example');
  assert.equal(data.lines.at(-1)?.raw,'// ordinary comment');
  assert.deepEqual(Buffer.from(imported.bytes),original);
  assert.equal((globalThis as Record<string, unknown>).__uaExecuted,undefined);
});
test('TEST-004: BOM and missing/invalid metadata fail safely', () => {
  const bytes = Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(source,'utf16le')]);
  const imported = importDroppedBytes('utf16.user.js',bytes);
  assert.ok(!('code' in imported));
  if ('code' in imported) return;
  assert.equal(parseUserscriptMetadata(imported).status,'OK');
  assert.equal(readUserscriptSource(imported),source);
  assert.equal(parseUserscriptMetadata({bytes:Buffer.from('alert(1)'),textEncoding:'utf-8'}).status,'MISSING_HEADER');
  assert.equal(parseUserscriptMetadata({bytes:Buffer.from('// ==UserScript==\n// @name X'),textEncoding:'utf-8'}).status,'UNTERMINATED_HEADER');
  assert.equal(parseUserscriptMetadata({bytes:Buffer.from([0xff]),textEncoding:'utf-8'}).status,'INVALID_ENCODING');
});
