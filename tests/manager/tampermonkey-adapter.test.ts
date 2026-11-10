import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {access,mkdtemp,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {join,win32} from 'node:path';
import {tmpdir} from 'node:os';
import {launchApprovedIsolatedChrome,isLiveApprovedChromeSession} from '../../src/browser/owned-chrome';
import {prepareApprovedIsolatedProfile} from '../../src/browser/chrome-launcher';
import {inspectTampermonkeyTargetHints,inspectApprovedTampermonkeyRuntime,
  TAMPERMONKEY_EXTENSION_ID} from '../../src/manager/tampermonkey-adapter';

const id='1234567890abcdef';
const worker={targetId:id,type:'service_worker',
 url:'chrome-extension://'+TAMPERMONKEY_EXTENSION_ID+'/background.js'};

test('TEST-017 stage: Tampermonkey runtime target is a hint, not proof of GM or installation',()=>{
 const result=inspectTampermonkeyTargetHints([worker]);
 assert.deepEqual(result,{ok:true,status:'RUNTIME_TARGET_HINT_ONLY',manager:'Tampermonkey',
   extensionId:TAMPERMONKEY_EXTENSION_ID,matchedRuntimeTargets:1,
   extensionAuthenticityVerified:false,versionVerified:false,permissionVerified:false,
   scriptInstallationVerified:false,scriptInjectionVerified:false,
   gmApiVerified:false,businessVerified:false});
});
test('TEST-017 stage: unrelated manager/page target cannot impersonate Tampermonkey',()=>{
 const variants=[
  {targetId:id,type:'page',url:worker.url},
  {targetId:id,type:'service_worker',url:'https://example.com/'},
  {targetId:id,type:'service_worker',url:'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bg.js'},
  {targetId:id,type:'service_worker',url:'chrome-extension://'+TAMPERMONKEY_EXTENSION_ID+'.evil.test/bg.js'},
  {targetId:id,type:'service_worker',url:'data:text/html,hello'}
 ];
 for(const variant of variants){
   assert.deepEqual(inspectTampermonkeyTargetHints([variant]),
     {ok:false,code:'RUNTIME_NOT_OBSERVED'});
 }
 assert.deepEqual(inspectTampermonkeyTargetHints([]),{ok:false,code:'RUNTIME_NOT_OBSERVED'});
});
test('TEST-017 stage: invalid/duplicate target metadata fails closed',()=>{
 for(const payload of [
  null,{},new Array(513).fill(worker),[null],[{type:'service_worker'}],
  [{...worker,targetId:'bad'}],[worker,{...worker}],
  [{...worker,type:'page',targetId:'bad'}],
  [{...worker,type:'page'},{...worker,type:'page'}],
  [{...worker,type:'page'},worker],
  [{...worker,url:6}],[{...worker,url:'x'.repeat(8193)}]
 ]){
   assert.deepEqual(inspectTampermonkeyTargetHints(payload),
     {ok:false,code:'INVALID_CDP_RESPONSE'});
 }
});
test('TEST-017 stage: user authorization and owned session are mandatory, no CDP call on failure',async()=>{
 const session={ok:false as const,code:'PREFLIGHT_FAILED' as const};
 assert.deepEqual(await inspectApprovedTampermonkeyRuntime(session,false),
   {ok:false,code:'NOT_AUTHORIZED'});
 assert.deepEqual(await inspectApprovedTampermonkeyRuntime(session,true),
   {ok:false,code:'UNVERIFIED_BROWSER'});
 const signal=AbortSignal.abort();
 assert.deepEqual(await inspectApprovedTampermonkeyRuntime(session,true,signal),
   {ok:false,code:'CANCELLED'});
 const fake={ok:true as const,status:'OWNED_CDP_BROWSER_VERIFIED' as const,
   pid:12345,chromeVersion:'155.0.0.0',browserWebsocket:'ws://127.0.0.1:9223/devtools/browser/1234567890abcdef',
   websocketHandshakeVerified:true as const,targetVerified:false as const,stop:()=>{}};
 assert.deepEqual(await inspectApprovedTampermonkeyRuntime(fake,true),
   {ok:false,code:'UNVERIFIED_BROWSER'});
});

/** A real Windows Chrome/CDP roundtrip is not a Tampermonkey GM test.
 * The expected isolated profile has no extensions; any detected runtime is a hint only.
 */
test('TEST-017 stage: real owned Chrome target query remains non-verified',async t=>{
 if(process.platform!=='win32'){t.skip('Requires Windows signed Chrome');return;}
 let chrome:string|undefined;
 for(const base of [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA]){
   if(!base)continue;
   const candidate=win32.join(base,'Google','Chrome','Application','chrome.exe');
   try{await access(candidate);chrome=candidate;break;}catch{/* no Chrome at this location */}
 }
 assert.ok(chrome,'Windows runner must provide signed Chrome');
 const listener=createServer();
 await new Promise<void>((resolve,reject)=>{
   listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);
 });
 const address=listener.address();
 await new Promise<void>(resolve=>listener.close(()=>resolve()));
 if(!address||typeof address==='string')throw Error('NO_FREE_TEST_PORT');
 const root=await mkdtemp(join(tmpdir(),'uah-manager-presence-'));
 let stop=()=>{};
 t.after(async()=>{stop();await rm(root,{recursive:true,force:true}).catch(()=>undefined);});
 const config={executablePath:chrome!,userDataDir:join(root,'profile'),
   remoteDebuggingPort:address.port,bindAddress:'127.0.0.1' as const};
 const profile=await prepareApprovedIsolatedProfile(config,true);
 assert.equal(profile.ok,true,JSON.stringify(profile));
 const session=await launchApprovedIsolatedChrome(config,{userApproved:true,testHeadless:true});
 assert.equal(session.ok,true,JSON.stringify(session));
 if(!session.ok)return;
 stop=session.stop;
 const probe=await inspectApprovedTampermonkeyRuntime(session,true);
 assert.ok(probe.ok?probe.status==='RUNTIME_TARGET_HINT_ONLY':
   probe.code==='RUNTIME_NOT_OBSERVED',JSON.stringify(probe));
 if(probe.ok){
   assert.equal(probe.gmApiVerified,false);
   assert.equal(probe.scriptInjectionVerified,false);
   assert.equal(probe.extensionAuthenticityVerified,false);
 }

 // A user can cancel while the final asynchronous owner/PID check runs.
 // Even a legitimate listener match cannot revive cancelled authorization.
 // Replace only this module export after the real Chrome launch, and restore
 // it before the test exits; no browser/process or user script is modified.
 const listenerModule=require('../../src/browser/cdp-session') as typeof import('../../src/browser/cdp-session');
 const originalVerify=listenerModule.verifyWindowsLoopbackListenerPid;
 // Either Windows PID ownership query can stall in an OS subprocess.
 // Revoked consent must not wait for an eventual answer from that process.
 for(const blockedCheck of [1,2]){
  const controller=new AbortController();
  let checks=0;
  let signalEntered!:()=>void;
  const entered=new Promise<void>(resolve=>{signalEntered=resolve;});
  let release!:()=>void;
  (listenerModule as {verifyWindowsLoopbackListenerPid:typeof originalVerify})
   .verifyWindowsLoopbackListenerPid=async(...args)=>{
    checks++;
    if(checks!==blockedCheck)return originalVerify(...args);
    await new Promise<void>(resolve=>{release=resolve;signalEntered();});
    return originalVerify(...args);
   };
  try{
   const pending=inspectApprovedTampermonkeyRuntime(session,true,controller.signal);
   await Promise.race([entered,new Promise<never>((_,reject)=>
    setTimeout(()=>reject(Error('PID_PROBE_NOT_REACHED')),9000))]);
   controller.abort();
   const result=await Promise.race([pending,new Promise<never>((_,reject)=>
    setTimeout(()=>reject(Error('CONSENT_REVOCATION_STALLED_ON_PID')),1000))]);
   assert.deepEqual(result,{ok:false,code:'CANCELLED'},
    'cancelled native scope must not await a stalled OS listener query');
   assert.equal(checks,blockedCheck);
  }finally{
   release?.();
   (listenerModule as {verifyWindowsLoopbackListenerPid:typeof originalVerify})
    .verifyWindowsLoopbackListenerPid=originalVerify;
  }
 }

 const abort=new AbortController();
 let ownerChecks=0;
 (listenerModule as {verifyWindowsLoopbackListenerPid:typeof originalVerify})
   .verifyWindowsLoopbackListenerPid=async(...args)=>{
     const result=await originalVerify(...args);
     ownerChecks++;
     if(ownerChecks===2)abort.abort();
     return result;
   };
 try{
   const cancelled=await inspectApprovedTampermonkeyRuntime(session,true,abort.signal);
   assert.equal(ownerChecks,2,'fixture must cancel inside the final real PID check');
   assert.deepEqual(cancelled,{ok:false,code:'CANCELLED'},
     'revoked user consent cannot return a post-verification runtime hint');
 }finally{
   (listenerModule as {verifyWindowsLoopbackListenerPid:typeof originalVerify})
     .verifyWindowsLoopbackListenerPid=originalVerify;
 }

 // Closing the owned Chrome session during the FINAL asynchronous listener
 // check must invalidate its runtime hint, even if that check saw the same PID.
 // This is the test's disposable, app-launched Chrome: never an external PID.
 let lifetimeChecks=0;
 (listenerModule as {verifyWindowsLoopbackListenerPid:typeof originalVerify})
   .verifyWindowsLoopbackListenerPid=async(...args)=>{
     const result=await originalVerify(...args);
     lifetimeChecks++;
     if(lifetimeChecks===2){
       assert.equal(result.ok,true,'fixture must own the listener until final check');
       session.stop();
     }
     return result;
   };
 try{
   const stopped=await inspectApprovedTampermonkeyRuntime(session,true);
   assert.equal(lifetimeChecks,2,'fixture must stop after final listener check');
   assert.deepEqual(stopped,{ok:false,code:'UNVERIFIED_BROWSER'},
     'a stopped Chrome session cannot yield a post-verification runtime hint');
 }finally{
   (listenerModule as {verifyWindowsLoopbackListenerPid:typeof originalVerify})
     .verifyWindowsLoopbackListenerPid=originalVerify;
 }
});

test('TEST-017 stage: distinct ordinary Chrome targets remain ignorable but cannot forge identities',()=>{
  const unrelated={targetId:'unrelated-target-01',type:'page',url:'https://example.com/'};
  assert.deepEqual(inspectTampermonkeyTargetHints([unrelated]),
    {ok:false,code:'RUNTIME_NOT_OBSERVED'});
  const mixed=inspectTampermonkeyTargetHints([unrelated,worker]);
  assert.equal(mixed.ok,true);
  if(mixed.ok)assert.equal(mixed.matchedRuntimeTargets,1);
});

test('TEST-017/026: CDP hint parser does not evaluate hostile getters or iterators',()=>{
 let getters=0;
 const accessorTarget={targetId:id,type:'service_worker'};
 Object.defineProperty(accessorTarget,'url',{enumerable:true,get(){
   getters++;throw Error('PRIVATE_EXTENSION_DATA');
 }});
 const accessorEntries=[worker] as unknown[];
 Object.defineProperty(accessorEntries,0,{enumerable:true,configurable:true,get(){
   getters++;throw Error('PRIVATE_TARGET_ENTRY');
 }});
 const trapped=[
   [accessorTarget],
   accessorEntries,
   [new Proxy(worker,{ownKeys(){throw Error('PRIVATE_TARGET_PROXY');}})],
   new Proxy([worker],{ownKeys(){throw Error('PRIVATE_ARRAY_PROXY');}}),
   [,worker],
   [{...worker,targetId:id, get url(){getters++;throw Error('PRIVATE_URL');}}]
 ];
 for(const sample of trapped){
   assert.deepEqual(inspectTampermonkeyTargetHints(sample),
     {ok:false,code:'INVALID_CDP_RESPONSE'});
 }
 assert.equal(getters,0,'CDP metadata getters must never be evaluated');
 const customIterator=[worker];
 Object.defineProperty(customIterator,Symbol.iterator,{get(){
   getters++;throw Error('PRIVATE_ITERATOR');
 }});
 const result=inspectTampermonkeyTargetHints(customIterator);
 assert.deepEqual(result,{ok:false,code:'INVALID_CDP_RESPONSE'},
   'extra own iterator metadata must fail closed without invoking it');
 assert.equal(getters,0);
});

test('TEST-017/026: Proxy-based CDP targets never run reflection traps',()=>{
 let trapCalls=0;
 const proxyTarget=new Proxy(worker,{
   getPrototypeOf(){trapCalls++;return Object.prototype;},
   ownKeys(){trapCalls++;return Reflect.ownKeys(worker);},
   getOwnPropertyDescriptor(target,key){
     trapCalls++;return Reflect.getOwnPropertyDescriptor(target,key);
   }
 });
 const entries=[worker];
 const proxyList=new Proxy(entries,{
   getPrototypeOf(){trapCalls++;return Array.prototype;},
   ownKeys(){trapCalls++;return Reflect.ownKeys(entries);},
   getOwnPropertyDescriptor(target,key){
     trapCalls++;return Reflect.getOwnPropertyDescriptor(target,key);
   }
 });
 for(const payload of [proxyList,[proxyTarget]]){
   assert.deepEqual(inspectTampermonkeyTargetHints(payload),
     {ok:false,code:'INVALID_CDP_RESPONSE'});
 }
 assert.equal(trapCalls,0,'Untrusted Proxy reflection traps must not execute');
});

test('TASK-007/TEST-017/026: runtime inspection rejects forged AbortSignals before any getter or CDP access',async()=>{
 const session={ok:false as const,code:'PREFLIGHT_FAILED' as const};
 let traps=0;
 const accessor={
  get aborted(){traps++;throw Error('HOSTILE_ABORTED_GETTER');}
 } as unknown as AbortSignal;
 const active=new Proxy(new AbortController().signal,{
  get(){traps++;throw Error('HOSTILE_ABORT_PROXY_GET');},
  getPrototypeOf(){traps++;throw Error('HOSTILE_ABORT_PROXY_PROTO');},
  ownKeys(){traps++;throw Error('HOSTILE_ABORT_PROXY_KEYS');}
 });
 const revoked=Proxy.revocable(new AbortController().signal,{});
 revoked.revoke();
 const spoof=Object.create(AbortSignal.prototype) as AbortSignal;
 const shadow=new AbortController().signal;
 Object.defineProperty(shadow,'addEventListener',{value:()=>{
  traps++;throw Error('HOSTILE_ABORT_LISTENER');
 }});
 for(const signal of [accessor,active,revoked.proxy,spoof,shadow]){
  const result=await inspectApprovedTampermonkeyRuntime(session,true,signal);
  assert.deepEqual(result,{ok:false,code:'INVALID_OPTIONS'},
   'a non-native or shadowed signal cannot invoke caller code or reach CDP');
 }
 assert.equal(traps,0,'no untrusted getter, proxy or listener is ever executed');
 // Legitimate native cancellation continues to be handled distinctly.
 const cancelled=new AbortController();
 cancelled.abort();
 assert.deepEqual(await inspectApprovedTampermonkeyRuntime(session,true,cancelled.signal),
  {ok:false,code:'CANCELLED'});
});

test('TASK-007/TEST-017/026: only native registered Chrome sessions may be inspected without getter or Proxy effects',async()=>{
 let calls=0;
 const poison=()=>{calls++;throw Error('FORGED_CHROME_SESSION_GETTER');};
 const getter=Object.defineProperty({},'ok',{get:poison});
 const proxy=new Proxy({ok:true,status:'OWNED_CDP_BROWSER_VERIFIED'},{
  get:poison,getPrototypeOf:poison,ownKeys:poison
 });
 const revoked=Proxy.revocable({ok:true},{get:poison});
 revoked.revoke();
 const samples=[getter,proxy,revoked.proxy];
 for(const candidate of samples){
  const session=candidate as Parameters<typeof inspectApprovedTampermonkeyRuntime>[0];
  assert.equal(isLiveApprovedChromeSession(session),false,
   'ownership must be decided before observing caller session properties');
  assert.deepEqual(await inspectApprovedTampermonkeyRuntime(session,true),
   {ok:false,code:'UNVERIFIED_BROWSER'});
 }
 assert.equal(calls,0,'unregistered Chrome session accessors or Proxy traps must not execute');
});

// TASK-007 / Issue #486 / TEST-017/026: a Target.getTargets CDP reply is
// not successful when its error key is present, even with a falsy JSON value
// and plausible runtime targetInfos. No CDP failure may mint a runtime hint.
test('TASK-007/TEST-017/026: CDP target-list receipt rejects explicit falsy errors and non-text data',()=>{
 const inspect=(require('../../src/manager/tampermonkey-adapter') as {
  readTampermonkeyCdpTargetReceipt?: (raw:unknown)=>unknown|null|undefined
 }).readTampermonkeyCdpTargetReceipt;
 assert.equal(typeof inspect,'function',
  'a manager CDP response must have an independently testable bounded parser');
 if(!inspect)return;
 const valid={id:1,result:{targetInfos:[worker]}};
 assert.deepEqual(inspect(JSON.stringify(valid)),[worker],
  'valid CDP reply remains a target metadata hint only');
 assert.equal(inspect(JSON.stringify({id:2,result:valid.result})),undefined,
  'unrelated browser CDP events must not finish target inspection');
 for(const error of [false,0,'',null]){
  assert.equal(inspect(JSON.stringify({
   id:1,error,result:valid.result
  })),null,'an explicit CDP error must block even when its JSON value is falsy');
 }
 for(const raw of [
  JSON.stringify({id:1,error:{message:'PRIVATE_EXTENSION_INFO'},result:valid.result}),
  JSON.stringify({id:1,result:null}),
  JSON.stringify({id:1,result:{}}),
  JSON.stringify({id:1,result:{targetInfos:'forged'}}),
  JSON.stringify({id:1,result:valid.result,padding:'PRIVATE'.repeat(90000)}),
  'null','not-json',Buffer.from(JSON.stringify(valid)),
  {toString(){throw Error('PRIVATE_CALLED_BY_PARSER');}}
 ]){
  assert.equal(inspect(raw),null,
   'invalid/oversized/non-native-text receipts must not return manager hints');
 }
});

// TASK-007 / Issue #486: only a bare Target.getTargets response envelope
// is eligible for a runtime hint. A message with extra protocol fields or
// extra result properties cannot be treated as an ordinary successful reply.
test('TASK-007/TEST-017/026: mixed or extended CDP envelopes fail closed',()=>{
 const {readTampermonkeyCdpTargetReceipt:read}=
  require('../../src/manager/tampermonkey-adapter') as typeof import('../../src/manager/tampermonkey-adapter');
 const targetInfos=[worker];
 assert.deepEqual(read(JSON.stringify({id:1,result:{targetInfos}})),targetInfos);
 for(const raw of [
  {id:1,result:{targetInfos},method:'Target.targetCreated'},
  {id:1,result:{targetInfos},sessionId:'not-a-browser-root-reply'},
  {id:1,result:{targetInfos},padding:'unexpected'},
  {id:1,result:{targetInfos,unexpected:true}}
 ]){
  assert.equal(read(JSON.stringify(raw)),null,
   'an extended response envelope must not become an ordinary target hint');
 }
 assert.equal(read(JSON.stringify({
  id:2,result:{targetInfos},method:'Target.targetCreated'
 })),undefined,'other command IDs remain unrelated, not fatal errors');
});

test('TASK-007/TEST-017/026: raw extension target URLs must not become hints through URL normalization',()=>{
 const canonical='chrome-extension://'+TAMPERMONKEY_EXTENSION_ID+'/background.js';
 assert.equal(inspectTampermonkeyTargetHints([{
  ...worker,url:canonical
 }]).ok,true,'legitimate extension target remains a limited hint');
 const normalizedAliases=[
  canonical+'\n',
  '\t'+canonical,
  canonical+'\r',
  canonical.replace('/background.js','/back\\ground.js'),
  canonical.replace('/background.js','/./background.js'),
  canonical+'#redirected',
  canonical+'?credential=private'
 ];
 for(const raw of normalizedAliases){
  assert.deepEqual(inspectTampermonkeyTargetHints([{...worker,url:raw}]),
   {ok:false,code:'RUNTIME_NOT_OBSERVED'},
   'ambiguous raw target must not be accepted after URL constructor normalization');
 }
});

// Source-level asynchronous boundary invariant: an AbortSignal may be revoked
// while Windows PID ownership verification is pending. Cancellation must win
// before reporting a stale listener error or starting CDP communication.
test('TASK-007/TEST-017/026: cancellation wins after first async listener owner check',()=>{
 const source=readFileSync(join(process.cwd(),'src','manager','tampermonkey-adapter.ts'),'utf8');
 const start=source.indexOf('const owned=await awaitListenerProofOrRevocation(port,session.pid,signal);');
 const second=source.indexOf('const payload=await readBoundedTargets(session.browserWebsocket,signal);',start);
 assert.ok(start>=0&&second>start,'bounded first ownership and CDP steps are present');
 const between=source.slice(start,second);
 const cancelled=between.indexOf("if(signal?.aborted)return {ok:false,code:'CANCELLED'};");
 const ownerFailure=between.indexOf("if(owned.cancelled||!owned.ok||!isLiveApprovedChromeSession(session))");
 assert.ok(cancelled>=0&&ownerFailure>cancelled,
  'revoked consent must be observed before an in-flight owner lookup error');
});


test('TASK-007/TEST-017/026: CDP target hints reject hidden or accessor-only extra target fields without executing them',()=>{
 let getterCalls=0;
 const withExtraData={...worker,title:'background',attached:false};
 const legitimate=inspectTampermonkeyTargetHints([withExtraData]);
 assert.equal(legitimate.ok,true,'ordinary JSON target metadata remains supported');
 if(legitimate.ok)assert.equal(legitimate.matchedRuntimeTargets,1);
 const withAccessor=Object.defineProperty({...worker},'title',{
  enumerable:true,get(){getterCalls++;throw Error('PRIVATE_TARGET_METADATA');}
 });
 const withHidden=Object.defineProperty({...worker},Symbol('secret'),{
  enumerable:false,get(){getterCalls++;throw Error('PRIVATE_HIDDEN_METADATA');}
 });
 const withExtraSymbol=Object.defineProperty({...worker},Symbol('private'),{
  enumerable:false,value:'PRIVATE_EXTENSION_METADATA'
 });
 for(const item of [withAccessor,withHidden,withExtraSymbol]){
  assert.deepEqual(inspectTampermonkeyTargetHints([item]),
   {ok:false,code:'INVALID_CDP_RESPONSE'},
   'unexpected non-JSON property descriptors must not produce a manager hint');
 }
 assert.equal(getterCalls,0,'no metadata accessor may execute while inspecting targets');
});


test('TASK-007/TEST-017/026: CDP receipt enforces UTF-8 byte budget, not UTF-16 code units',()=>{
 const {readTampermonkeyCdpTargetReceipt:read}=
   require('../../src/manager/tampermonkey-adapter') as typeof import('../../src/manager/tampermonkey-adapter');
 const withinBudget=JSON.stringify({id:1,result:{targetInfos:[
   {...worker,title:'界'.repeat(80_000)}
 ]}});
 assert.ok(Buffer.byteLength(withinBudget,'utf8')<256*1024);
 assert.equal((read(withinBudget) as unknown[])?.length,1,
   'ordinary browser metadata inside the declared byte budget remains eligible');
 const oversized=JSON.stringify({id:1,result:{targetInfos:[
   {...worker,title:'界'.repeat(90_000)}
 ]}});
 assert.ok(oversized.length<256*1024,
   'the regression specifically fits the old UTF-16 code-unit check');
 assert.ok(Buffer.byteLength(oversized,'utf8')>256*1024);
 assert.equal(read(oversized),null,
   'a multibyte page title cannot bypass the CDP 256 KiB raw message limit');
});
