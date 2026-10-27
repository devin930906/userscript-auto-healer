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
test('TASK-003/TEST-004/026: parser refuses hostile byte descriptors and fake byte containers before executing caller hooks', () => {
  const script=Buffer.from('// ==UserScript==\n// @name Safe\n// ==/UserScript==\n');
  let executed=0;
  const poison=():never=>{executed++;throw Error('PRIVATE_METADATA_INPUT_EXECUTED');};
  const accessor={textEncoding:'utf-8'} as Record<string,unknown>;
  Object.defineProperty(accessor,'bytes',{enumerable:true,get:poison});
  const forgedByteContainer={
    0:0xef,1:0xbb,2:0xbf,length:script.length+3,
    subarray:()=>{executed++;return script;}
  };
  const wrapped=new Proxy({bytes:script,textEncoding:'utf-8'},{get:poison,ownKeys:poison});
  const revoked=Proxy.revocable({bytes:script,textEncoding:'utf-8'},{get:poison});
  revoked.revoke();
  const proxyBytes=new Proxy(Buffer.from([0xef,0xbb,0xbf,...script]),{get:poison});
  const invalid:unknown[]=[
    accessor,wrapped,revoked.proxy,
    {bytes:forgedByteContainer,textEncoding:'utf-8-bom'},
    {bytes:proxyBytes,textEncoding:'utf-8-bom'}
  ];
  for(const hostile of invalid){
    assert.doesNotThrow(()=>{
      assert.equal(readUserscriptSource(hostile as Parameters<typeof readUserscriptSource>[0]),null);
      assert.equal(parseUserscriptMetadata(hostile as Parameters<typeof parseUserscriptMetadata>[0]).status,'INVALID_ENCODING');
    });
  }
  assert.equal(executed,0,'no untrusted getter, proxy trap or replacement subarray method may execute');
  assert.equal(parseUserscriptMetadata({bytes:script,textEncoding:'utf-8'}).status,'OK');
});
