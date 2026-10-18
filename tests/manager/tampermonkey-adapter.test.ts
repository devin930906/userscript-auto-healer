import {test} from 'node:test';
import {strict as assert} from 'node:assert';
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
