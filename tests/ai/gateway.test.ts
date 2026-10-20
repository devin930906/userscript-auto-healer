import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createServer} from 'node:http';
import {OptionalAiGateway} from '../../src/ai/model-gateway';

const A='a'.repeat(64),B='b'.repeat(64);
const options=(baseUrl='http://127.0.0.1:9555/v1')=>({
  baseUrl,apiKey:'canary-secret-key',manualModel:'example-model',
  maxRequests:3,timeoutMs:2000,maxOutputTokens:128
});
const evidence={diagnosticCode:'SELECTOR_ASSERTION',
  scenarioHash:A,selectorHash:B};
const approval=(origin='http://127.0.0.1:9555')=>
  ({userApproved:true,approvedOrigin:origin});

test('TEST-015/016: default disabled, narrow consent and no secret fields in state',async()=>{
  let called=0;
  const transport:typeof fetch=async()=>{called++;return new Response('{}');};
  const gateway=new OptionalAiGateway(options(),transport);
  assert.deepEqual(gateway.status(),{enabled:false,remainingRequests:3,
    manualModelAvailable:true});
  assert.equal((await gateway.suggest(approval(),evidence)).ok,false);
  assert.equal((await gateway.discoverModels(approval())).ok,false);
  assert.equal(called,0);
  assert.equal(gateway.enable({userApproved:false,approvedOrigin:approval().approvedOrigin}),false);
  assert.equal(gateway.enable(approval('https://bad.example')),false);
  assert.equal(gateway.enable({...approval(),unreviewed:'PRIVATE'}),false);
  assert.equal(gateway.enable(approval()),true);
  assert.equal(gateway.status().enabled,true);
  assert.equal(JSON.stringify(gateway.status()).includes('canary-secret-key'),false);
  assert.equal((await gateway.suggest(approval('https://bad.example'),evidence)).ok,false);
  assert.equal(called,0);
  gateway.disable();
  assert.equal(gateway.status().enabled,false);
});

test('TEST-015/016: local mock transport receives ONLY reviewed hashes and untrusted suggestions',async t=>{
  const requests:Array<{method:string;path:string;authorization:string;body:string}>=[];
  const server=createServer(async(req,res)=>{
    let body='';
    for await(const part of req)body+=part.toString('utf8');
    requests.push({method:req.method||'',path:req.url||'',
      authorization:String(req.headers.authorization||''),body});
    res.setHeader('Content-Type','application/json');
    if(req.url==='/v1/models')
      res.writeHead(200).end(JSON.stringify({data:[{id:'example-model'},{id:'model-v2'}]}));
    else if(req.url==='/v1/chat/completions')
      res.writeHead(200).end(JSON.stringify({choices:[{message:{
        role:'assistant',content:'Review the selector in an isolated test; do not apply.'
      }}]}));
    else res.writeHead(404).end('{}');
  });
  await new Promise<void>((resolve,reject)=>{
    server.once('error',reject);server.listen(0,'127.0.0.1',resolve);
  });
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const address=server.address();
  if(!address||typeof address==='string')throw Error('NO_PORT');
  const url='http://127.0.0.1:'+address.port;
  const gateway=new OptionalAiGateway(options(url+'/v1'));
  assert.equal(gateway.enable(approval(url)),true);
  const discovered=await gateway.discoverModels(approval(url));
  assert.equal(discovered.ok,true);
  if(discovered.ok)assert.deepEqual(discovered.models,['example-model','model-v2']);
  assert.equal((await gateway.suggest(approval(url),
    {...evidence,source:'SENSITIVE_SCRIPT_SOURCE'})).ok,false);
  assert.equal(requests.length,1,'unreviewed field must not be transmitted');
  const result=await gateway.suggest(approval(url),evidence);
  assert.equal(result.ok,true,JSON.stringify(result));
  if(result.ok&&'candidateText' in result){
    assert.equal(result.status,'UNTRUSTED_AI_TEXT_ONLY');
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal(result.automaticRollbackAllowed,false);
    assert.equal(result.tampermonkeyVerified,false);
    assert.equal(result.businessVerified,false);
  }
  assert.equal(requests.length,2);
  assert.deepEqual(requests.map(x=>x.path),['/v1/models','/v1/chat/completions']);
  assert.deepEqual(requests.map(x=>x.method),['GET','POST']);
  assert.ok(requests.every(x=>x.authorization==='Bearer canary-secret-key'));
  const payload=JSON.parse(requests[1].body) as {messages:Array<{role:string;content:string}>};
  const inner=JSON.parse(payload.messages[1].content);
  assert.deepEqual(inner,evidence);
  assert.equal(requests[1].body.includes('SENSITIVE_SCRIPT_SOURCE'),false);
  assert.equal(requests[1].body.includes('canary-secret-key'),false);
  assert.equal(JSON.stringify(result).includes('canary-secret-key'),false);
  assert.equal(gateway.status().remainingRequests,1);
});

test('TEST-016: 404 discovery safely preserves optional manually specified model',async()=>{
  const called:string[]=[];
  const transport:typeof fetch=async(input,init)=>{
    called.push(String(input));
    if(init?.method==='GET')return new Response('no models',{status:404});
    return Response.json({choices:[{message:{role:'assistant',content:'Maybe check DOM.'}}]});
  };
  const gateway=new OptionalAiGateway(options(),transport);
  assert.equal(gateway.enable(approval()),true);
  const models=await gateway.discoverModels(approval());
  assert.equal(models.ok,true);
  if(models.ok){
    assert.equal(models.status,'MANUAL_MODEL_FALLBACK');
    assert.equal(models.manualModelAvailable,true);
    assert.deepEqual(models.models,[]);
  }
  assert.equal((await gateway.suggest(approval(),evidence)).ok,true);
  assert.equal(called.length,2);
});

test('TEST-016: no selected model, network status failures and request cap',async()=>{
  let called=0;
  const transport:typeof fetch=async()=>{
    called++;return new Response('rate limited',{status:429});
  };
  const config=options();
  const gateway=new OptionalAiGateway({...config,manualModel:null,maxRequests:1},transport);
  assert.equal(gateway.enable(approval()),true);
  const modelMissing=await gateway.suggest(approval(),evidence);
  assert.deepEqual(modelMissing,{ok:false,code:'MODEL_NOT_SELECTED',automaticPatchAllowed:false});
  assert.equal(called,0);
  const rejected=await gateway.discoverModels(approval());
  assert.deepEqual(rejected,{ok:false,code:'HTTP_REJECTED',automaticPatchAllowed:false});
  const limited=await gateway.discoverModels(approval());
  assert.deepEqual(limited,{ok:false,code:'REQUEST_LIMIT',automaticPatchAllowed:false});
  assert.equal(called,1);
  assert.equal(gateway.status().remainingRequests,0);
});

test('TEST-016: model discovery never hides unauthorized, throttled or unhealthy endpoints as fallback',async()=>{
  for(const status of [401,403,429,500,503]){
    const gateway=new OptionalAiGateway(options(),async()=>new Response('rejected',{status}));
    assert.equal(gateway.enable(approval()),true);
    assert.deepEqual(await gateway.discoverModels(approval()),
      {ok:false,code:'HTTP_REJECTED',automaticPatchAllowed:false},String(status));
  }
  const network=new OptionalAiGateway(options(),async()=>{throw Error('offline');});
  assert.equal(network.enable(approval()),true);
  assert.deepEqual(await network.discoverModels(approval()),
    {ok:false,code:'NETWORK_FAILED',automaticPatchAllowed:false});
  for(const status of [404,405]){
    const noList=new OptionalAiGateway(options(),async()=>new Response('',{status}));
    assert.equal(noList.enable(approval()),true);
    const result=await noList.discoverModels(approval());
    assert.equal(result.ok,true);
    if(result.ok)assert.equal(result.status,'MANUAL_MODEL_FALLBACK');
  }
});

test('TEST-015: untrusted response cannot grant repairs, tools or oversized data',async()=>{
  let response:Response=Response.json({choices:[{message:{role:'assistant',
    content:'<untrusted text>',tool_calls:[{id:'run-something'}]}}]});
  const gateway=new OptionalAiGateway(options(),async()=>response);
  assert.equal(gateway.enable(approval()),true);
  let suggestion=await gateway.suggest(approval(),evidence);
  assert.deepEqual(suggestion,{ok:false,code:'INVALID_RESPONSE',automaticPatchAllowed:false});
  response=Response.json({choices:[{message:{role:'assistant',content:'Z'.repeat(5000)}}]});
  suggestion=await gateway.suggest(approval(),evidence);
  assert.equal(suggestion.ok,false);
  response=new Response('x'.repeat(32769));
  suggestion=await gateway.suggest(approval(),evidence);
  assert.deepEqual(suggestion,{ok:false,code:'INVALID_RESPONSE',automaticPatchAllowed:false});
});

test('TEST-015: reject forbidden raw payload, malformed IDs and accessors without calling them',async()=>{
  let sent=0;
  const gateway=new OptionalAiGateway(options(),async()=>{sent++;return Response.json({});});
  assert.equal(gateway.enable(approval()),true);
  let invoked=false;
  const accessor={diagnosticCode:'UNKNOWN',scenarioHash:A};
  Object.defineProperty(accessor,'selectorHash',{enumerable:true,get(){
    invoked=true;throw Error('should never read');
  }});
  for(const value of [accessor,{...evidence,selectorHash:'private URL'},
    {...evidence,diagnosticCode:'RECOVERED_VERIFIED'},
    {...evidence,scriptSource:'// @grant GM_getValue'},
    {...evidence,[Symbol('payload')]:'test'},
    Object.assign(Object.create({scenarioHash:A}),evidence),null]){
    assert.deepEqual(await gateway.suggest(approval(),value),
      {ok:false,code:'INVALID_EVIDENCE',automaticPatchAllowed:false});
  }
  assert.equal(invoked,false);
  assert.equal(sent,0);
});

test('TEST-016: invalid endpoints and unsafe configuration are rejected before network',()=>{
  const invalid=[
    'http://api.example.test/v1',
    'http://192.168.1.40/v1',
    'http://localhost:4444/v1',
    'https://user:password@api.example.com/v1',
    'https://api.example.com/v1?secret=1',
    'https://api.example.com/v1#note',
    'https://api.example.com/%2e%2e/private',
    'file:///C:/Users/admin',
    'https://127.0.0.1/v1'
  ];
  for(const baseUrl of invalid)
    assert.throws(()=>new OptionalAiGateway(options(baseUrl)),/INVALID_AI_CONFIGURATION/,baseUrl);
  for(const changed of [
    {...options(),apiKey:'token\nAuthorization: bad'},
    {...options(),maxRequests:9999},
    {...options(),timeoutMs:60000},
    {...options(),maxOutputTokens:4096},
    {...options(),manualModel:'gpt\nsecret'},
    {...options(),extra:'secret'}
  ])assert.throws(()=>new OptionalAiGateway(changed),/INVALID_AI_CONFIGURATION/);
});

test('TEST-016: disable cancels an in-flight request; cancellation never authorizes retry',async()=>{
  let invoked=0;
  const transport:typeof fetch=async(_input,init)=>{
    invoked++;
    return await new Promise<Response>((_resolve,reject)=>{
      init?.signal?.addEventListener('abort',()=>reject(Error('aborted')),{once:true});
    });
  };
  const gateway=new OptionalAiGateway(options(),transport);
  assert.equal(gateway.enable(approval()),true);
  const pending=gateway.suggest(approval(),evidence);
  gateway.disable();
  assert.deepEqual(await pending,{ok:false,code:'CANCELLED',automaticPatchAllowed:false});
  assert.equal(invoked,1);
  assert.equal(gateway.status().remainingRequests,2);
  assert.equal((await gateway.suggest(approval(),evidence)).ok,false);
});

test('TEST-016/026: oversized AI reply cannot hang on a never-settling stream cancellation',async()=>{
 // A malicious or broken provider stream can return a cancel promise that
 // never settles. The response is already over the 32-KiB limit; neither a
 // timed-out diagnostic nor disabling AI may leave its caller pending forever.
 let cancelCalls=0;
 const body=new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(new Uint8Array(32*1024+1));},
  cancel(){cancelCalls++;return new Promise<void>(()=>{});}
 });
 const gateway=new OptionalAiGateway({...options(),maxRequests:1},
  async()=>new Response(body,{status:200}));
 assert.equal(gateway.enable(approval()),true);
 const result=await Promise.race([
  gateway.discoverModels(approval()),
  new Promise<'STREAM_CANCEL_STALLED'>(resolve=>
   setTimeout(()=>resolve('STREAM_CANCEL_STALLED'),250))
 ]);
 assert.deepEqual(result,{
  ok:false,code:'INVALID_RESPONSE',automaticPatchAllowed:false
 });
 assert.equal(cancelCalls,1,'oversized response must request best-effort cleanup');
 assert.equal(gateway.status().remainingRequests,0);
 gateway.disable();
});

test('TEST-016/026: cancelling a stalled provider response body settles even when stream ignores cancellation',async()=>{
  let reading!:()=>void;
  const didRead=new Promise<void>(resolve=>{reading=resolve;});
  let cancelCalls=0;
  const body=new ReadableStream<Uint8Array>({
    pull(){reading();return new Promise<void>(()=>{});},
    cancel(){cancelCalls++;return new Promise<void>(()=>{});}
  });
  const gateway=new OptionalAiGateway({...options(),maxRequests:1},
    async()=>new Response(body,{status:200}));
  assert.equal(gateway.enable(approval()),true);
  const pending=gateway.discoverModels(approval());
  await didRead;
  gateway.disable();
  const result=await Promise.race([
    pending,
    new Promise<'BODY_READ_STALLED'>(resolve=>setTimeout(()=>resolve('BODY_READ_STALLED'),1500))
  ]);
  assert.deepEqual(result,{ok:false,code:'CANCELLED',automaticPatchAllowed:false});
  assert.ok(cancelCalls>=1);
});

test('TEST-016/026: response body with no chunks respects the configured request deadline',async()=>{
  const body=new ReadableStream<Uint8Array>({
    pull(){return new Promise<void>(()=>{});},
    cancel(){return new Promise<void>(()=>{});}
  });
  const gateway=new OptionalAiGateway({...options(),timeoutMs:500,maxRequests:1},
    async()=>new Response(body,{status:200}));
  assert.equal(gateway.enable(approval()),true);
  const result=await Promise.race([
    gateway.discoverModels(approval()),
    new Promise<'BODY_DEADLINE_STALLED'>(resolve=>setTimeout(()=>resolve('BODY_DEADLINE_STALLED'),2000))
  ]);
  assert.deepEqual(result,{ok:false,code:'NETWORK_FAILED',automaticPatchAllowed:false});
});

test('TEST-016/026: oversized declared response body also requests nonblocking cleanup',async()=>{
 let cancelCalls=0;
 const body=new ReadableStream<Uint8Array>({
  cancel(){cancelCalls++;return new Promise<void>(()=>{});}
 });
 const gateway=new OptionalAiGateway({...options(),maxRequests:1},
  async()=>new Response(body,{headers:{'content-length':'32769'}}));
 assert.equal(gateway.enable(approval()),true);
 const result=await Promise.race([
  gateway.discoverModels(approval()),
  new Promise<'STREAM_CANCEL_STALLED'>(resolve=>
   setTimeout(()=>resolve('STREAM_CANCEL_STALLED'),250))
 ]);
 assert.deepEqual(result,{
  ok:false,code:'INVALID_RESPONSE',automaticPatchAllowed:false
 });
 assert.equal(cancelCalls,1,'rejected response must not pin a live stream');
 gateway.disable();
});
