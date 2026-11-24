import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {
 parseTampermonkeyExtensionCardReceipt,
 parseTampermonkeyUserScriptsReceipt,
 readTampermonkeyManagerCardAfterInventoryReady,
 TAMPERMONKEY_WEBSTORE_URL,
 launchApprovedTampermonkeyInstallation
} from '../../src/manager/tampermonkey-installation';
import {TAMPERMONKEY_EXTENSION_ID} from '../../src/manager/tampermonkey-adapter';
import {TAMPERMONKEY_MANAGER_CARD_EXPRESSION,TAMPERMONKEY_USER_SCRIPTS_EXPRESSION} from '../../src/manager/tampermonkey-installation';

function card(value:Record<string,unknown>){
 return {result:{type:'object',value:{managerPage:true,inventoryReady:true,matchingCount:1,
   id:TAMPERMONKEY_EXTENSION_ID,name:'Tampermonkey',version:'5.4.1',
   enabled:true,...value}}};
}

test('TASK-007: exact Tampermonkey card yields metadata-only installation evidence',()=>{
 const result=parseTampermonkeyExtensionCardReceipt(card({}));
 assert.deepEqual(result,{
  ok:true,status:'INSTALLED_METADATA_HINT_ONLY',manager:'Tampermonkey',
  extensionId:TAMPERMONKEY_EXTENSION_ID,version:'5.4.1',
  enabled:'ENABLED',allowUserScripts:'UNKNOWN',
  extensionAuthenticityVerified:false,storeProvenanceVerified:false,
  versionVerified:true,permissionVerified:false,
  scriptInstallationVerified:false,scriptInjectionVerified:false,
  gmApiVerified:false,businessVerified:false
 });
});

test('TASK-007: an authoritative empty manager inventory reports not installed',()=>{
 const result=parseTampermonkeyExtensionCardReceipt({
  result:{type:'object',value:{managerPage:true,inventoryReady:true,matchingCount:0}}
 });
 assert.deepEqual(result,{
  ok:true,status:'NOT_INSTALLED',extensionId:TAMPERMONKEY_EXTENSION_ID,
  installUrl:TAMPERMONKEY_WEBSTORE_URL,
  extensionAuthenticityVerified:false,storeProvenanceVerified:false,
  versionVerified:false,permissionVerified:false,
  scriptInstallationVerified:false,scriptInjectionVerified:false,
  gmApiVerified:false,businessVerified:false
 });
});

test('TASK-007: an empty manager page without completed inventory is not proof of absence',()=>{
 for(const value of [
  {managerPage:true,matchingCount:0},
  {managerPage:true,inventoryReady:false,matchingCount:0}
 ]){
  const result=parseTampermonkeyExtensionCardReceipt({result:{type:'object',value}});
  assert.deepEqual(result,{ok:false,code:'INVALID_CDP_RESPONSE'});
 }
});

test('TASK-007: manager-card probe retries pending inventory and accepts the ready card',async()=>{
 let now=0;
 const timeouts:number[]=[];
 const receipts:unknown[]=[
  {result:{type:'object',value:{managerPage:true,inventoryReady:false,matchingCount:0}}},
  card({})
 ];
 const result=await readTampermonkeyManagerCardAfterInventoryReady(async timeoutMs=>{
  timeouts.push(timeoutMs);
  return receipts.shift();
 },{
  timeoutMs:1000,
  now:()=>now,
  wait:async ms=>{now+=ms;}
 });
 assert.equal(result.ok,true);
 assert.equal(timeouts.length,2);
 assert.deepEqual(timeouts,[1000,750]);
});

test('TASK-007: manager-card probe passes remaining deadline to CDP and fails closed at timeout',async()=>{
 let now=0;
 const timeouts:number[]=[];
 const result=await readTampermonkeyManagerCardAfterInventoryReady(async timeoutMs=>{
  timeouts.push(timeoutMs);
  now+=timeoutMs;
  return {result:{type:'object',value:{managerPage:true,inventoryReady:false,matchingCount:0}}};
 },{
  timeoutMs:1000,
  now:()=>now,
  wait:async ms=>{now+=ms;}
 });
 assert.deepEqual(result,{ok:false,code:'INSPECTION_UNAVAILABLE',stage:'manager-card'});
 assert.deepEqual(timeouts,[1000]);
});

test('TASK-007: manager inventory ambiguity and mismatched identity fail closed',()=>{
 const invalid=[
  null,
  {},
  {result:{type:'object',value:{managerPage:false,matchingCount:0}}},
  {result:{type:'object',value:{managerPage:true,matchingCount:2}}},
  card({id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}),
  card({name:'Not Tampermonkey'}),
  card({version:'not-a-version'}),
  {result:{type:'string',value:'Tampermonkey'}}
 ];
 for(const receipt of invalid){
  assert.deepEqual(parseTampermonkeyExtensionCardReceipt(receipt),
   {ok:false,code:'INVALID_CDP_RESPONSE'});
 }
});

test('TASK-007: user-script permission is reported only from one matching management toggle',()=>{
 const enabled={result:{type:'object',value:{
  managerPage:true,matchingRows:1,allowUserScriptsAvailable:true,allowUserScripts:true
 }}};
 const disabled={result:{type:'object',value:{
  managerPage:true,matchingRows:1,allowUserScriptsAvailable:true,allowUserScripts:false
 }}};
 assert.equal(parseTampermonkeyUserScriptsReceipt(enabled,155),'ENABLED');
 assert.equal(parseTampermonkeyUserScriptsReceipt(disabled,155),'DISABLED');
 assert.equal(parseTampermonkeyUserScriptsReceipt({
  result:{type:'object',value:{managerPage:true,matchingRows:0,allowUserScriptsAvailable:false}}
 },155),'UNKNOWN');
 assert.equal(parseTampermonkeyUserScriptsReceipt(enabled,137),'NOT_APPLICABLE');
});

test('TASK-007: user-script permission rejects malformed or ambiguous receipts',()=>{
 for(const receipt of [
  null,{},{result:{type:'string',value:'yes'}},
  {result:{type:'object',value:{managerPage:false,matchingRows:1,allowUserScriptsAvailable:true,allowUserScripts:true}}},
  {result:{type:'object',value:{managerPage:true,matchingRows:1,allowUserScriptsAvailable:true,allowUserScripts:'yes'}}}
 ]){
  assert.equal(parseTampermonkeyUserScriptsReceipt(receipt,155),'UNKNOWN');
 }
});


test('TASK-007: manager probes are fixed, read-only and never target extension origins',()=>{
 assert.match(TAMPERMONKEY_MANAGER_CARD_EXPRESSION,/extensions-item/);
 assert.match(TAMPERMONKEY_MANAGER_CARD_EXPRESSION,new RegExp(TAMPERMONKEY_EXTENSION_ID));
 assert.match(TAMPERMONKEY_MANAGER_CARD_EXPRESSION,/didInitPage_/);
 assert.match(TAMPERMONKEY_MANAGER_CARD_EXPRESSION,/inventoryReady/);
 assert.doesNotMatch(TAMPERMONKEY_MANAGER_CARD_EXPRESSION,/chrome-extension:\/\//);
 assert.match(TAMPERMONKEY_USER_SCRIPTS_EXPRESSION,/allow user scripts\|允许用户脚本/);
 assert.doesNotMatch(TAMPERMONKEY_USER_SCRIPTS_EXPRESSION,/\.click\s*\(/);
 assert.doesNotMatch(TAMPERMONKEY_USER_SCRIPTS_EXPRESSION,/GM_(?:getValue|setValue|deleteValue)/);
});

test('TASK-007/026: receipt parsers never execute accessors or Proxy traps',()=>{
 let getterCalls=0,proxyCalls=0;
 const accessor:Record<string,unknown>={};
 Object.defineProperty(accessor,'result',{enumerable:true,get(){getterCalls++;return {type:'object',value:{managerPage:true,matchingCount:0}};}});
 assert.deepEqual(parseTampermonkeyExtensionCardReceipt(accessor),{ok:false,code:'INVALID_CDP_RESPONSE'});
 const hostile=new Proxy({}, {getPrototypeOf(){proxyCalls++;throw Error('trap');}});
 assert.deepEqual(parseTampermonkeyExtensionCardReceipt(hostile),{ok:false,code:'INVALID_CDP_RESPONSE'});
 assert.equal(getterCalls,0);
 assert.equal(proxyCalls,0);
});

test('TASK-007: localized and branded Tampermonkey extension names are accepted',()=>{
 for(const name of [
  'Tampermonkey',
  'tampermonkey',
  'TAMPERMONKEY',
  'Tampermonkey (篡改猴)',
  'Tampermonkey（篡改猴）',
  'Tampermonkey 篡改猴',
  'Tampermonkey®',
  'Tampermonkey beta',
  '篡改猴'
 ]){
  const result=parseTampermonkeyExtensionCardReceipt(card({name}));
  assert.equal(result.ok,true,`Expected name "${name}" to be accepted`);
  if(result.ok&&result.status==='INSTALLED_METADATA_HINT_ONLY'){
   assert.equal(result.manager,'Tampermonkey');
  }
 }
});

test('TASK-007: non-matching or spoofed extension names fail closed',()=>{
 for(const name of [
  'Not Tampermonkey',
  'Violentmonkey',
  'Tampermonkey 2',
  'TampermonkeyClone',
  '篡改猴 Fake',
  ''
 ]){
  const result=parseTampermonkeyExtensionCardReceipt(card({name}));
  assert.deepEqual(result,{ok:false,code:'INVALID_CDP_RESPONSE'},
   `Expected name "${name}" to fail closed`);
 }
});

test('TASK-007: official Web Store install URL is well-formed and targets official ID',()=>{
 assert.match(TAMPERMONKEY_WEBSTORE_URL,/^https:\/\/chromewebstore\.google\.com\/detail\/tampermonkey\//);
 assert.ok(TAMPERMONKEY_WEBSTORE_URL.endsWith(TAMPERMONKEY_EXTENSION_ID));
});

test('TASK-007: launchApprovedTampermonkeyInstallation enforces authorization and listener ownership before CDP',async()=>{
 const fakeSession:any={
  ok:true,
  pid:1234,
  browserWebsocket:'ws://127.0.0.1:9222/devtools/browser/12345678-1234-1234-1234-123456789abc',
  chromeVersion:'138.0.0.0',
  userDataDir:'C:\\fakepath'
 };

 const unapproved=await launchApprovedTampermonkeyInstallation(fakeSession,false);
 assert.deepEqual(unapproved,{ok:false,code:'NOT_AUTHORIZED'});

 const controller=new AbortController();
 controller.abort();
 const aborted=await launchApprovedTampermonkeyInstallation(fakeSession,true,controller.signal);
 assert.deepEqual(aborted,{ok:false,code:'CANCELLED'});

 const hostileSignal:any={aborted:false};
 const hostile=await launchApprovedTampermonkeyInstallation(fakeSession,true,hostileSignal);
 assert.deepEqual(hostile,{ok:false,code:'INVALID_OPTIONS'});

 const unverified=await launchApprovedTampermonkeyInstallation({} as any,true);
 assert.deepEqual(unverified,{ok:false,code:'UNVERIFIED_BROWSER'});
});



test('TASK-007: ready inventory received at or after the deadline cannot attest installation or absence',async()=>{
 const empty={result:{type:'object',value:{managerPage:true,inventoryReady:true,matchingCount:0}}};
 for(const receipt of [card({}),empty]){
  for(const elapsed of [1000,1001]){
   let now=0;
   const result=await readTampermonkeyManagerCardAfterInventoryReady(async()=>{
    now+=elapsed;
    return receipt;
   },{timeoutMs:1000,now:()=>now,wait:async()=>{assert.fail('late receipt must not retry');}});
   assert.deepEqual(result,{ok:false,code:'INSPECTION_UNAVAILABLE',stage:'manager-card'});
  }
 }
});
