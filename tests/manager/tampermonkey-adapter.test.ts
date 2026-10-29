import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {access,mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {join,win32} from 'node:path';
import {tmpdir} from 'node:os';
import {launchApprovedIsolatedChrome,isLiveApprovedChromeSession} from '../../src/browser/owned-chrome';
import {prepareApprovedIsolatedProfile} from '../../src/browser/chrome-launcher';
import {inspectTampermonkeyTargetHints,inspectApprovedTampermonkeyRuntime,
  readTampermonkeyCdpTargetReceipt,
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
 const valid={id:1,result:{targetInfos:[worker]}};
 assert.deepEqual(readTampermonkeyCdpTargetReceipt(JSON.stringify(valid)),[worker],
  'valid CDP reply remains a target metadata hint only');
 assert.equal(readTampermonkeyCdpTargetReceipt(JSON.stringify({id:2,result:valid.result})),undefined,
  'unrelated browser CDP events must not finish target inspection');
 for(const error of [false,0,'',null]){
  assert.equal(readTampermonkeyCdpTargetReceipt(JSON.stringify({
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
  assert.equal(readTampermonkeyCdpTargetReceipt(raw),null,
   'invalid/oversized/non-native-text receipts must not return manager hints');
 }
});
