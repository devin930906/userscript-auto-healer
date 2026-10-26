import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {summarizeDomTree,observeApprovedDom,isApprovedTopFrame,approvedTopFrameUrl,awaitReadOnlyCdpSocketOpen} from '../../src/observe/dom-observer';
test('TEST-010: iframe and shadow scope remain limited, not full-page coverage',()=>{
  const node={nodeType:9,nodeName:'#document',children:[
    {nodeType:1,nodeName:'HTML',children:[
      {nodeType:1,nodeName:'IFRAME'},
      {nodeType:1,nodeName:'DIV',shadowRoots:[{nodeType:11,nodeName:'#shadow-root',children:[]}]}
    ]}
  ]};
  const frames={frame:{url:'https://example.com/'},
    childFrames:[{frame:{url:'https://other.example/page'}}]};
  const summary=summarizeDomTree(node,frames,'https://example.com');
  assert.equal(summary?.elementCount,3,'Document and shadow-root containers are not elements');
  assert.equal(summary?.iframeCount,1);
  assert.equal(summary?.visibleShadowRoots,1);
  assert.ok(summary?.blindSpots.includes('IFRAME_CONTENT_UNVERIFIED'));
  assert.ok(summary?.blindSpots.includes('CROSS_ORIGIN_FRAME_UNVERIFIED'));
  assert.ok(summary?.blindSpots.includes('CLOSED_SHADOW_ROOT_UNKNOWN'));
});
test('TEST-010: cycles or extreme depth cannot yield an apparent valid snapshot',()=>{
  const n:any={nodeType:1,nodeName:'DIV'};n.children=[n];
  assert.equal(summarizeDomTree(n,{frame:{url:'https://example.com/'}},'https://example.com'),null);
  assert.equal(summarizeDomTree({children:'bad'}, {frame:{url:'https://example.com/'}},'https://example.com'),null);
});
test('TEST-012: missing authorization/session never produces a runtime claim',async()=>{
  const unavailable={ok:false as const,code:'PREFLIGHT_FAILED' as const};
  const target={ok:false as const,code:'UNVERIFIED_BROWSER' as const};
  assert.deepEqual(await observeApprovedDom(unavailable,target,'https://example.com/',false),
    {ok:false,code:'NOT_AUTHORIZED'});
  assert.deepEqual(await observeApprovedDom(unavailable,target,'https://example.com/',true),
    {ok:false,code:'UNVERIFIED_BROWSER'});
});

test('TEST-010: CDP snapshot rejects a top-frame origin switch, opaque URL and malformed frame tree',()=>{
  assert.equal(isApprovedTopFrame({frame:{url:'https://example.com/next'}},'https://example.com'),true);
  for(const value of [
    {frame:{url:'https://elsewhere.example/'}},
    {frame:{url:'https://example.com.evil.test/'}},
    {frame:{url:'about:blank'}},
    {frame:{url:'data:text/html,hi'}},
    {frame:{url:'https://user:pass@example.com/'}},
    {frame:{url:'invalid URL'}},
    {frame:{url:12}},
    {childFrames:[{frame:{url:'https://example.com/'}}]},
    null
  ]) {
    assert.equal(isApprovedTopFrame(value,'https://example.com'),false);
  }
});

test('TEST-010: malformed CDP DOM evidence and unrelated top-level origins fail closed',()=>{
  const approved='https://example.com';
  const frames={frame:{url:'https://example.com/safe'}};
  const valid={nodeType:9,nodeName:'#document',children:[]};
  assert.equal(summarizeDomTree(valid,{frame:{url:'https://unapproved.example/'}},approved),null);
  assert.equal(summarizeDomTree({nodeType:1,nodeName:17},frames,approved),null);
  assert.equal(summarizeDomTree({nodeType:'1',nodeName:'DIV'},frames,approved),null);
  assert.equal(summarizeDomTree({},frames,approved),null);
  assert.equal(summarizeDomTree(valid,frames,approved)?.elementCount,0);
});

test('TEST-012: CDP frame URL distinguishes same-origin routes without elevating evidence',()=>{
 const origin='https://example.com';
 const first={frame:{url:origin+'/fixture?mode=broken'}};
 const changed={frame:{url:origin+'/fixture?mode=fixed'}};
 assert.equal(approvedTopFrameUrl(first,origin),origin+'/fixture?mode=broken');
 assert.equal(approvedTopFrameUrl(changed,origin),origin+'/fixture?mode=fixed');
 assert.notEqual(approvedTopFrameUrl(first,origin),approvedTopFrameUrl(changed,origin),
   'A route transition during a DOM observation must be discarded');
 assert.equal(isApprovedTopFrame(changed,origin),true,
   'A stable SPA route on the same approved origin remains observable');
 for(const frame of [
   {frame:{url:'https://elsewhere.example/fixture?mode=fixed'}},
   {frame:{url:'https://user:pass@example.com/private'}},
   {frame:{url:'about:blank'}},
   {frame:{url:'https://example.com/'+'x'.repeat(4097)}},
   {frame:{url:12}},
   null
 ]){
   assert.equal(approvedTopFrameUrl(frame,origin),null);
 }
});

test('TEST-010/017: abort during pending CDP open settles immediately, not after handshake timeout',async()=>{
 const socket=new EventTarget() as WebSocket;
 const controller=new AbortController();
 const pending=awaitReadOnlyCdpSocketOpen(socket,controller.signal);
 let settled:'PENDING'|'OPEN'|'BLOCKED'='PENDING';
 void pending.then(open=>{settled=open?'OPEN':'BLOCKED';});
 controller.abort();
 await Promise.resolve();
 assert.equal(settled,'BLOCKED','revocation must unblock a pending connection');
 assert.equal(await pending,false);
 socket.dispatchEvent(new Event('open'));
 assert.equal(settled,'BLOCKED','late OPEN must not resurrect revoked consent');
});

test('TEST-010/017: already aborted CDP open never yields an authenticated transport',async()=>{
 const socket=new EventTarget() as WebSocket;
 const controller=new AbortController();
 controller.abort();
 assert.equal(await awaitReadOnlyCdpSocketOpen(socket,controller.signal),false);
 socket.dispatchEvent(new Event('open'));
});

test('TEST-010: CDP open succeeds only on timely OPEN, and fails on socket loss',async()=>{
 const socket=new EventTarget() as WebSocket;
 const opened=awaitReadOnlyCdpSocketOpen(socket);
 socket.dispatchEvent(new Event('open'));
 assert.equal(await opened,true);
 const failed=new EventTarget() as WebSocket;
 const closed=awaitReadOnlyCdpSocketOpen(failed);
 failed.dispatchEvent(new Event('close'));
 assert.equal(await closed,false);
 failed.dispatchEvent(new Event('open'));
});

test('TASK-006/008/TEST-010/013/026: CDP observation rejects forged cancellation and session getters before effects',async()=>{
 const {observeApprovedDomSeries}=await import('../../src/observe/dom-observer');
 const browser={ok:false as const,code:'PREFLIGHT_FAILED' as const};
 const target={ok:false as const,code:'UNVERIFIED_BROWSER' as const};
 let executed=0;
 const poison=Object.defineProperty({},'aborted',{get(){
  executed++;throw Error('UNTRUSTED_ABORT_GETTER');
 }}) as AbortSignal;
 const spoof=Object.create(AbortSignal.prototype) as AbortSignal;
 const proxy=new Proxy(new AbortController().signal,{
  get(){executed++;throw Error('UNTRUSTED_ABORT_PROXY');},
  getPrototypeOf(){executed++;throw Error('UNTRUSTED_ABORT_REFLECT');}
 });
 const revoked=Proxy.revocable(new AbortController().signal,{});
 revoked.revoke();
 const shadowed=new AbortController().signal;
 Object.defineProperty(shadowed,'addEventListener',{value:()=>{
  executed++;throw Error('UNTRUSTED_ABORT_LISTENER');
 }});
 for(const signal of [poison,spoof,proxy,revoked.proxy,shadowed]){
  assert.deepEqual(await observeApprovedDom(browser,target,'https://example.com/',true,[],signal),
   {ok:false,code:'INVALID_OPTIONS'});
  assert.deepEqual(await observeApprovedDomSeries(
   browser,target,'https://example.com/',true,[],2,100,signal),
   {ok:false,code:'INVALID_OPTIONS'});
  assert.equal(await awaitReadOnlyCdpSocketOpen(new EventTarget() as WebSocket,signal),
   false,'transport must not register fake AbortSignal listeners');
 }
 const fakeBrowser=Object.defineProperty({},'ok',{get(){
  executed++;throw Error('UNTRUSTED_BROWSER_GETTER');
 }});
 const trappedBrowser=new Proxy({ok:true},{
  get(){executed++;throw Error('UNTRUSTED_BROWSER_PROXY');},
  getPrototypeOf(){executed++;throw Error('UNTRUSTED_BROWSER_REFLECT');}
 });
 for(const suspect of [fakeBrowser,trappedBrowser]){
  assert.deepEqual(await observeApprovedDom(
   suspect as Parameters<typeof observeApprovedDom>[0],target,
   'https://example.com/',true),{ok:false,code:'UNVERIFIED_BROWSER'});
 }
 assert.equal(executed,0,'untrusted getters/Proxy traps are never executed');
 assert.deepEqual(await observeApprovedDom(browser,target,'https://example.com/',true,[],
   AbortSignal.abort()),{ok:false,code:'CANCELLED'});
 assert.deepEqual(await observeApprovedDom(browser,target,'https://example.com/',false,[],
   poison),{ok:false,code:'NOT_AUTHORIZED'});
});
