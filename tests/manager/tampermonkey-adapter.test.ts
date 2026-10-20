import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {access,mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {join,win32} from 'node:path';
import {tmpdir} from 'node:os';
import {launchApprovedIsolatedChrome} from '../../src/browser/owned-chrome';
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
 assert.equal(result.ok,true,'iteration must use captured array data slots');
 assert.equal(getters,0);
});
