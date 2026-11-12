import test from 'node:test';
import assert from 'node:assert/strict';
import {connectExistingBrowserWebSocket,isLiveExistingBrowserTransport} from '../../src/browser/existing-chrome';

class FakeWebSocket extends EventTarget {
  static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
  readyState=FakeWebSocket.CONNECTING;
  sent:string[]=[];
  static instances:FakeWebSocket[]=[];
  constructor(readonly url:string){super();FakeWebSocket.instances.push(this);queueMicrotask(()=>this.open());}
  open():void{this.readyState=FakeWebSocket.OPEN;this.dispatchEvent(new Event('open'));}
  send(raw:string):void{
    this.sent.push(raw);
    const request=JSON.parse(raw) as {id:number;method:string};
    const result=request.method==='Browser.getVersion'?
      {product:'Chrome/157.0.8103.39',protocolVersion:'1.3'}:{};
    const event=new Event('message') as MessageEvent<string>;
    Object.defineProperty(event,'data',{value:JSON.stringify({id:request.id,result})});
    queueMicrotask(()=>this.dispatchEvent(event));
  }
  close():void{this.readyState=FakeWebSocket.CLOSED;this.dispatchEvent(new Event('close'));}
}

const endpoint='ws://127.0.0.1:9223/devtools/browser/01234567-89ab-cdef-0123-456789abcdef';
const options={userApproved:true,WebSocketImpl:FakeWebSocket as unknown as typeof WebSocket,
  validateIdentity:async()=>true};

test('existing Chrome CDP keeps one user-authorized websocket for later commands',async()=>{
  FakeWebSocket.instances=[];
  const connected=await connectExistingBrowserWebSocket(endpoint,'157.0.8103.39',options);
  assert.equal(connected.ok,true);
  const socket=FakeWebSocket.instances[0];
  assert.equal(socket.sent.length,1,'only Browser.getVersion is sent before session verification');
  assert.equal(isLiveExistingBrowserTransport(connected),true);
  if(!connected.ok)throw new Error('unexpected refusal');
  const result=await connected.sendCommand('Target.getTargets');
  assert.deepEqual(result,{});
  assert.equal(FakeWebSocket.instances.length,1,'commands reuse the consented socket');
  assert.equal(socket.sent.length,2);
  await assert.rejects(connected.sendCommand('Target.createTarget',{url:'https://example.com'}),/INVALID_CDP_METHOD/);
  await assert.rejects(connected.sendCommand('Browser.getVersion'),/INVALID_CDP_METHOD/);
  assert.equal(socket.sent.length,2,'other CDP methods are rejected before they reach Chrome');
  connected.stop();
  assert.equal(socket.readyState,FakeWebSocket.CLOSED);
  assert.equal(isLiveExistingBrowserTransport(connected),false);
});

test('existing Chrome CDP revokes its session when the browser websocket closes',async()=>{
  FakeWebSocket.instances=[];
  const connected=await connectExistingBrowserWebSocket(endpoint,'157.0.8103.39',options);
  assert.equal(connected.ok,true);
  if(!connected.ok)return;
  FakeWebSocket.instances[0].close();
  assert.equal(connected.isLive(),false);
  assert.equal(isLiveExistingBrowserTransport(connected),false);
  await assert.rejects(connected.sendCommand('Target.getTargets'),/SESSION_REVOKED/);
});

test('existing Chrome CDP refuses a command after identity revalidation fails',async()=>{
  FakeWebSocket.instances=[];
  let identity=true;
  const connected=await connectExistingBrowserWebSocket(endpoint,'157.0.8103.39',{
    ...options,validateIdentity:async()=>identity
  });
  assert.equal(connected.ok,true);
  if(!connected.ok)return;
  identity=false;
  await assert.rejects(connected.sendCommand('Target.getTargets'),/SESSION_REVOKED/);
  assert.equal(FakeWebSocket.instances[0].readyState,FakeWebSocket.CLOSED);
  assert.equal(isLiveExistingBrowserTransport(connected),false);
});

test('existing Chrome CDP abort closes the authorized socket and rejects pending requests',async()=>{
  FakeWebSocket.instances=[];
  const connected=await connectExistingBrowserWebSocket(endpoint,'157.0.8103.39',options);
  assert.equal(connected.ok,true);
  if(!connected.ok)return;
  const controller=new AbortController();
  const pending=connected.sendCommand('Target.getTargets',undefined,controller.signal);
  controller.abort();
  await assert.rejects(pending,/ABORTED/);
  assert.equal(FakeWebSocket.instances[0].readyState,FakeWebSocket.CLOSED);
  assert.equal(isLiveExistingBrowserTransport(connected),false);
});

test('existing Chrome CDP rejects unapproved and non-loopback endpoints before opening a socket',async()=>{
  FakeWebSocket.instances=[];
  assert.deepEqual(await connectExistingBrowserWebSocket(endpoint,'157.0.8103.39',
    {...options,userApproved:false}),{ok:false,code:'NOT_AUTHORIZED'});
  assert.deepEqual(await connectExistingBrowserWebSocket(
    'ws://192.168.1.2:9223/devtools/browser/01234567-89ab-cdef-0123-456789abcdef',
    '157.0.8103.39',options),{ok:false,code:'INVALID_ENDPOINT'});
  assert.equal(FakeWebSocket.instances.length,0);
});
