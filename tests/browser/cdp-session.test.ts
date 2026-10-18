import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { inspectCdpVersion } from '../../src/browser/cdp-session';

const envelope={Browser:'Chrome/154.0.8037.57',
  webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/browser/18ed998f-2182-41b5-9203-a6c2f45b7ccb'};
test('TEST-009: endpoint shape never becomes an ownership assertion',()=>{
  const result=inspectCdpVersion(envelope,9223);
  assert.equal(result.ok,true);
  if(result.ok){
    assert.equal(result.status,'STRUCTURE_ONLY');
    assert.equal(result.owned,false);
  }
});
test('TEST-009: spoofed or non-loopback CDP addresses rejected',()=>{
  for(const url of [
    'ws://0.0.0.0:9223/devtools/browser/18ed998f-2182-41b5-9203-a6c2f45b7ccb',
    'ws://127.0.0.1:9333/devtools/browser/18ed998f-2182-41b5-9203-a6c2f45b7ccb',
    'wss://127.0.0.1:9223/devtools/browser/18ed998f-2182-41b5-9203-a6c2f45b7ccb',
    'ws://127.0.0.1:9223/other/18ed998f-2182-41b5-9203-a6c2f45b7ccb'
  ]) {
    assert.equal(inspectCdpVersion({...envelope,webSocketDebuggerUrl:url},9223).ok,false);
  }
  assert.equal(inspectCdpVersion({...envelope,Browser:'FakeChrome/1.0'},9223).ok,false);
});
