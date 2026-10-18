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


import { inspectCdpTargetList } from '../../src/browser/cdp-session';
const pageId='a69ab247520b42f3981863911ab1b251';
const testPage={
  id:pageId,type:'page',url:'https://example.com/authorized-test',
  webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/'+pageId
};
test('TEST-009: requested tab shape is not a verified owned session',()=>{
  const result=inspectCdpTargetList([testPage],9223,testPage.url);
  assert.equal(result.ok,true);
  if(result.ok){
    assert.equal(result.status,'TARGET_STRUCTURE_ONLY');
    assert.equal(result.owned,false);
    assert.equal(result.targetId,pageId);
  }
});
test('TEST-009: deny cross-origin, malformed, ambiguous or spoofed target endpoints',()=>{
  for(const bad of [
    {...testPage,webSocketDebuggerUrl:'ws://127.0.0.1:9333/devtools/page/'+pageId},
    {...testPage,webSocketDebuggerUrl:'ws://localhost:9223/devtools/page/'+pageId},
    {...testPage,webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/browser/'+pageId},
    {...testPage,webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/incorrect'},
    {...testPage,webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/'+pageId+'?token=x'},
    {...testPage,id:'../bad'}
  ]){
    assert.equal(inspectCdpTargetList([bad],9223,testPage.url).ok,false);
  }
  assert.deepEqual(inspectCdpTargetList([testPage,testPage],9223,testPage.url),
    {ok:false,code:'TARGET_AMBIGUOUS'});
  assert.deepEqual(inspectCdpTargetList([testPage],9223,'https://unrelated.example/'),
    {ok:false,code:'TARGET_NOT_FOUND'});
  assert.deepEqual(inspectCdpTargetList([testPage],9223,'file:///C:/hidden'),
    {ok:false,code:'INVALID_TARGET_INPUT'});
  assert.deepEqual(inspectCdpTargetList([testPage],9223,'https://user:secret@example.com/'),
    {ok:false,code:'INVALID_TARGET_INPUT'});
});
