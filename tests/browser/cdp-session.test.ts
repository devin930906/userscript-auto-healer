import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { inspectCdpVersion, resolveWindowsNetstatExecutable } from '../../src/browser/cdp-session';

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


test('TASK-018/TEST-009/026: browser websocket path dot-segments cannot silently normalize',()=>{
  const forged=envelope.webSocketDebuggerUrl.replace('/devtools/','/hidden/../devtools/');
  assert.deepEqual(inspectCdpVersion({...envelope,webSocketDebuggerUrl:forged},9223),
    {ok:false,code:'UNSAFE_WEBSOCKET'});
  assert.equal(inspectCdpVersion(envelope,9223).ok,true);
});

test('TASK-018/TEST-009/026: reject parser-normalized CDP browser websocket URLs',()=>{
  const url=envelope.webSocketDebuggerUrl;
  for(const forged of [
    ' '+url,url+' ',url+'\n',url+'\r',
    url.replace('ws://','ws:\\\\'),
    url.replace('/devtools/','\\\\devtools/')
  ]){
    assert.deepEqual(inspectCdpVersion({...envelope,webSocketDebuggerUrl:forged},9223),
      {ok:false,code:'UNSAFE_WEBSOCKET'},JSON.stringify(forged));
  }
  assert.equal(inspectCdpVersion(envelope,9223).ok,true);
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
test('TASK-008/TEST-009/013/026: CDP list URL must not silently normalize to approved target',()=>{
  // Chrome's target inventory is a structure-only navigation hint, never a
  // replacement for an exact raw approved URL or a main-frame receipt.
  const malformed=[
    ' '+testPage.url,
    testPage.url+' ',
    'https://exam\nple.com/authorized-test',
    'https://example.com\\authorized-test',
    testPage.url+'\u0000'
  ];
  for(const raw of malformed){
    const forged={...testPage,url:raw};
    const inspected=inspectCdpTargetList([forged],9223,testPage.url,pageId);
    assert.deepEqual(inspected,{ok:false,code:'TARGET_NOT_FOUND'},
      'parser-normalized CDP strings cannot be considered a created tab match');
  }
  assert.equal(inspectCdpTargetList([testPage],9223,testPage.url,pageId).ok,true,
    'valid exact CDP target inventory still works');
});


test('TASK-018/TEST-009/026: page websocket path dot-segments cannot silently normalize',()=>{
  const forged=testPage.webSocketDebuggerUrl.replace('/devtools/','/hidden/../devtools/');
  assert.deepEqual(inspectCdpTargetList(
    [{...testPage,webSocketDebuggerUrl:forged}],9223,testPage.url,pageId),
    {ok:false,code:'UNSAFE_TARGET_WEBSOCKET'});
  assert.equal(inspectCdpTargetList([testPage],9223,testPage.url,pageId).ok,true);
});

test('TASK-018/TEST-009/026: reject parser-normalized CDP page websocket URLs',()=>{
  const url=testPage.webSocketDebuggerUrl;
  for(const forged of [
    ' '+url,url+' ',url+'\t',url+'\n',
    url.replace('ws://','ws:\\\\'),
    url.replace('/devtools/','\\\\devtools/')
  ]){
    const item={...testPage,webSocketDebuggerUrl:forged};
    assert.deepEqual(inspectCdpTargetList([item],9223,testPage.url,pageId),
      {ok:false,code:'UNSAFE_TARGET_WEBSOCKET'},JSON.stringify(forged));
  }
  assert.equal(inspectCdpTargetList([testPage],9223,testPage.url,pageId).ok,true);
});

test('TEST-009: a newly created target ID is selectable despite a pre-existing identical URL tab',()=>{
  // An ordinary owned Chrome can already contain another tab at the same URL.
  // The target ID is returned by this specific Target.createTarget command,
  // not supplied by arbitrary page JavaScript.
  const newId='b'.repeat(32);
  const newer={...testPage,id:newId,
    webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/'+newId};
  // Keep RED as a behavior failure, not a compile-time arity failure.
  const lookup=inspectCdpTargetList as unknown as (
    payload:unknown,port:number,url:string,createdTargetId?:string
  )=>ReturnType<typeof inspectCdpTargetList>;
  const found=lookup([testPage,newer],9223,testPage.url,newId);
  assert.deepEqual(found,{ok:true,status:'TARGET_STRUCTURE_ONLY',
    targetId:newId,websocketUrl:newer.webSocketDebuggerUrl,owned:false},
    'the exact new page remains identifiable without trusting the older page');
  assert.deepEqual(lookup([testPage,newer],9223,testPage.url,'c'.repeat(32)),
    {ok:false,code:'TARGET_NOT_FOUND'},
    'never substitute another matching-URL page for the created tab');
  assert.deepEqual(lookup([testPage,newer],9223,testPage.url,'../forged'),
    {ok:false,code:'INVALID_TARGET_INPUT'});
  assert.deepEqual(lookup([newer,newer],9223,testPage.url,newId),
    {ok:false,code:'TARGET_AMBIGUOUS'},
    'duplicate records of the exact created ID must fail closed');
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


test('TASK-005/TEST-009/026: version structure inspector rejects accessors, inherited evidence and revoked Proxies',()=>{
  let getters=0,traps=0;
  const accessors=Object.defineProperty({},'Browser',{
    enumerable:true,get(){getters++;return envelope.Browser;}
  });
  Object.defineProperty(accessors,'webSocketDebuggerUrl',{
    enumerable:true,value:envelope.webSocketDebuggerUrl
  });
  const inherited=Object.create(envelope);
  const proxied=new Proxy({...envelope},{
    get(){traps++;return envelope.Browser;},
    ownKeys(){traps++;throw Error('PRIVATE_PROXY');}
  });
  const revoked=Proxy.revocable({...envelope},{});revoked.revoke();
  for(const input of [accessors,inherited,proxied,revoked.proxy]){
    assert.doesNotThrow(()=>{
      assert.deepEqual(inspectCdpVersion(input,9223),
        {ok:false,code:'INVALID_SHAPE'});
    });
  }
  assert.equal(getters,0,'an input accessor must not run');
  assert.equal(traps,0,'Proxy traps must not run');
});

test('TASK-005/TEST-009/026: target inventory refuses accessor or Proxy spoofing without executing traps',()=>{
  let getters=0,traps=0;
  const byGetter=Object.defineProperty({...testPage},'type',{
    enumerable:true,get(){getters++;return 'page';}
  });
  const inherited=Object.create(testPage);
  const wrapped=new Proxy({...testPage},{
    get(){traps++;throw Error('PRIVATE_PROXY');},
    getOwnPropertyDescriptor(){traps++;throw Error('PRIVATE_PROXY');}
  });
  const revoked=Proxy.revocable({...testPage},{});revoked.revoke();
  const arrayProxy=new Proxy([testPage],{
    get(){traps++;throw Error('PRIVATE_ARRAY_PROXY');},
    getOwnPropertyDescriptor(){traps++;throw Error('PRIVATE_ARRAY_PROXY');}
  });
  const revokedArray=Proxy.revocable([testPage],{});revokedArray.revoke();
  for(const list of [[byGetter],[inherited],[wrapped],[revoked.proxy],
      arrayProxy,revokedArray.proxy]){
    assert.doesNotThrow(()=>{
      assert.deepEqual(inspectCdpTargetList(list,9223,testPage.url),
        {ok:false,code:'INVALID_TARGET_LIST'});
    });
  }
  assert.equal(getters,0);
  assert.equal(traps,0);
  assert.equal(inspectCdpTargetList([testPage],9223,testPage.url).ok,true,
    'native JSON-shaped data remains valid');
});

import { createServer } from 'node:net';
import { verifyWindowsLoopbackListenerPid, parseWindowsLoopbackListeners } from '../../src/browser/cdp-session';
test('TEST-009/026: netstat lookup is absolute and cannot search the working directory',()=>{
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


test('TASK-005/008/TEST-009/026: target inventory rejects ambiguous raw approved URLs',()=>{
 for(const malformed of [
   'https://exa\nmple.com/authorized-test',
   'https://example.com/\tauthorized-test',
   'https://example.com/authorized-test\r',
   'https://example.com\\authorized-test',
   ' https://example.com/authorized-test',
   'https://example.com/authorized-test '
 ]){
   assert.deepEqual(inspectCdpTargetList([testPage],9223,malformed),
     {ok:false,code:'INVALID_TARGET_INPUT'},JSON.stringify(malformed));
 }
 assert.equal(inspectCdpTargetList([testPage],9223,testPage.url).ok,true);
});


test('TASK-008/TEST-013/026: CDP target list refuses normalized URL aliases at the raw boundary',()=>{
 const aliases=[
  'https://example.com/hidden/../authorized-test',
  'https://example.com/hidden/%2e%2e/authorized-test',
  'https://example.com/hidden/.%2e/authorized-test',
  'https://example.com/./authorized-test',
  'https://%65xample.com/authorized-test'
 ];
 for(const alias of aliases){
  assert.deepEqual(inspectCdpTargetList(
   [{...testPage,url:alias}],9223,testPage.url,pageId),
   {ok:false,code:'TARGET_NOT_FOUND'},
   'a raw CDP target URL alias must not match a differently spelled approved URL');
  assert.deepEqual(inspectCdpTargetList([testPage],9223,alias,pageId),
   {ok:false,code:'INVALID_TARGET_INPUT'},
   'an ambiguous consented target must not become valid through URL normalization');
 }
 const canonical='https://example.com/authorized-test?return=/../legit';
 assert.equal(inspectCdpTargetList(
  [{...testPage,url:canonical}],9223,canonical,pageId).ok,true,
  'query data with path-like text remains inside exact consented URL matching');
 assert.equal(inspectCdpTargetList([testPage],9223,testPage.url,pageId).ok,true);
});


import * as cdpSessionModule from '../../src/browser/cdp-session';

class FakeGracefulCloseWebSocket extends EventTarget {
  static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
  static instances:FakeGracefulCloseWebSocket[]=[];
  readyState=FakeGracefulCloseWebSocket.CONNECTING;
  sent:string[]=[];
  constructor(readonly url:string){
    super();
    FakeGracefulCloseWebSocket.instances.push(this);
    queueMicrotask(()=>{
      this.readyState=FakeGracefulCloseWebSocket.OPEN;
      this.dispatchEvent(new Event('open'));
    });
  }
  send(raw:string):void{
    this.sent.push(raw);
    const request=JSON.parse(raw) as {id:number;method:string};
    if(request.method==='Browser.getVersion'){
      const event=new Event('message') as MessageEvent<string>;
      Object.defineProperty(event,'data',{value:JSON.stringify({
        id:request.id,result:{product:'Chrome/154.0.8037.57'}
      })});
      queueMicrotask(()=>this.dispatchEvent(event));
      return;
    }
    if(request.method==='Browser.close'){
      queueMicrotask(()=>this.close());
    }
  }
  close():void{
    if(this.readyState===FakeGracefulCloseWebSocket.CLOSED)return;
    this.readyState=FakeGracefulCloseWebSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }
}

test('TASK-005/TEST-007/009/026: verified owned Chrome closes through CDP Browser.close, never process termination',async()=>{
  type CloseFn=(websocketUrl:string,expectedPort:number,expectedVersion:string,
    signal?:AbortSignal,WebSocketImpl?:typeof WebSocket)=>Promise<boolean>;
  const gracefulClose=(cdpSessionModule as unknown as {
    requestVerifiedCdpBrowserClose?:CloseFn
  }).requestVerifiedCdpBrowserClose;
  assert.equal(typeof gracefulClose,'function',
    'owned Chrome needs an authenticated Browser.close primitive');
  if(typeof gracefulClose!=='function')return;

  FakeGracefulCloseWebSocket.instances=[];
  const ok=await gracefulClose(envelope.webSocketDebuggerUrl,9223,
    '154.0.8037.57',undefined,
    FakeGracefulCloseWebSocket as unknown as typeof WebSocket);
  assert.equal(ok,true);
  assert.equal(FakeGracefulCloseWebSocket.instances.length,1);
  assert.deepEqual(FakeGracefulCloseWebSocket.instances[0].sent.map(raw=>
    (JSON.parse(raw) as {method:string}).method),
    ['Browser.getVersion','Browser.close'],
    'normal close must re-verify the exact browser before sending Browser.close');

  const before=FakeGracefulCloseWebSocket.instances.length;
  assert.equal(await gracefulClose(
    'ws://192.168.1.9:9223/devtools/browser/18ed998f-2182-41b5-9203-a6c2f45b7ccb',
    9223,'154.0.8037.57',undefined,
    FakeGracefulCloseWebSocket as unknown as typeof WebSocket),false);
  assert.equal(FakeGracefulCloseWebSocket.instances.length,before,
    'non-loopback endpoints must be rejected before opening a socket');
});
