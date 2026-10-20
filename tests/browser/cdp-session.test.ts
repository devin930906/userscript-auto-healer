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


import { createServer } from 'node:net';
import { verifyWindowsLoopbackListenerPid, parseWindowsLoopbackListeners } from '../../src/browser/cdp-session';
test('TEST-009/026: netstat lookup is absolute and cannot search the working directory',()=>{
  const {resolveWindowsNetstatExecutable}=require('../../src/browser/cdp-session') as
    typeof import('../../src/browser/cdp-session');
  assert.equal(resolveWindowsNetstatExecutable('C:\\Windows'),
    'C:\\Windows\\System32\\netstat.exe');
  assert.equal(resolveWindowsNetstatExecutable('D:\\WinRoot'),
    'D:\\WinRoot\\System32\\netstat.exe');
  for(const bad of [
    undefined,'','Windows','netstat.exe','C:\\','C:\\Windows\\..\\temp',
    'C:\\Windows\\.','C:\\Windows\\\\Temp','C:\\Windows\\',
    '\\\\server\\share','\\\\?\\C:\\Windows',
    'C:/Windows','C:\\Windows\\Temp.','C:\\Windows\\Temp ',
    'C:\\Windows\\evil:stream','%SystemRoot%'
  ])assert.equal(resolveWindowsNetstatExecutable(bad),null,
    'never fall back to PATH for an ambiguous or unsafe SystemRoot');
});

test('TEST-009: OS loopback listener must belong to the expected process PID',async t=>{
  if(process.platform!=='win32')return;
  const server=createServer();
  await new Promise<void>((resolve,reject)=>{
    server.once('error',reject);
    server.listen({host:'127.0.0.1',port:0},resolve);
  });
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const addr=server.address();
  if(!addr || typeof addr==='string')throw Error('MISSING_LISTENER_PORT');
  const actual=await verifyWindowsLoopbackListenerPid(addr.port,process.pid);
  assert.equal(actual.ok,true,JSON.stringify(actual));
  if(actual.ok){
    assert.equal(actual.pid,process.pid);
    assert.equal(actual.executableVerified,false);
  }
  assert.deepEqual(await verifyWindowsLoopbackListenerPid(addr.port,process.pid+1),
    {ok:false,code:'LISTENER_PID_MISMATCH'});
  assert.deepEqual(await verifyWindowsLoopbackListenerPid(0,process.pid),
    {ok:false,code:'INVALID_ARGUMENTS'});
  assert.equal(server.listening,true);
});

test('TEST-009/026: a forged non-LISTENING loopback row is never accepted as ownership',()=>{
  const rows=[
    'TCP 127.0.0.1:9223 0.0.0.0:0 CLOSE_WAIT 9999',
    'TCP 127.0.0.1:9223 0.0.0.0:0 LISTENING 2345',
    'TCP 127.0.0.1:9223 0.0.0.0:0 ESTABLISHED 4444'
  ].join('\r\n');
  assert.deepEqual(parseWindowsLoopbackListeners(rows,9223),[2345]);
});

test('TEST-009: listener netstat parsing excludes wildcard and connected remote sockets',()=>{
  const sample=[
    'Proto   Local Address          Foreign Address        State           PID',
    ' TCP    127.0.0.1:9223          0.0.0.0:0              LISTENING       1234',
    ' TCP    0.0.0.0:9223            0.0.0.0:0              LISTENING       1111',
    ' TCP    127.0.0.1:9223          127.0.0.1:49150        ESTABLISHED    1112',
    ' TCP    [::1]:9223              [::]:0                 LISTENING       1113',
    ' TCP    127.0.0.1:9333          0.0.0.0:0              LISTENING       1114'
  ].join('\r\n');
  assert.deepEqual(parseWindowsLoopbackListeners(sample,9223),[1234]);
  assert.deepEqual(parseWindowsLoopbackListeners(sample,9333),[1114]);
  assert.deepEqual(parseWindowsLoopbackListeners(sample,9222),[]);
  assert.deepEqual(parseWindowsLoopbackListeners(sample,0),[]);
  assert.deepEqual(parseWindowsLoopbackListeners(
    'TCP 127.0.0.1:9223 0.0.0.0:0 LISTENING not-a-pid',9223).length,1);
});
