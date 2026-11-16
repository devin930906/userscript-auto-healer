import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {
 parseTampermonkeyExtensionCardReceipt,
 parseTampermonkeyUserScriptsReceipt
} from '../../src/manager/tampermonkey-installation';
import {TAMPERMONKEY_EXTENSION_ID} from '../../src/manager/tampermonkey-adapter';
import {TAMPERMONKEY_MANAGER_CARD_EXPRESSION,TAMPERMONKEY_USER_SCRIPTS_EXPRESSION} from '../../src/manager/tampermonkey-installation';

function card(value:Record<string,unknown>){
 return {result:{type:'object',value:{managerPage:true,matchingCount:1,
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
  result:{type:'object',value:{managerPage:true,matchingCount:0}}
 });
 assert.deepEqual(result,{
  ok:true,status:'NOT_INSTALLED',extensionId:TAMPERMONKEY_EXTENSION_ID,
  extensionAuthenticityVerified:false,storeProvenanceVerified:false,
  versionVerified:false,permissionVerified:false,
  scriptInstallationVerified:false,scriptInjectionVerified:false,
  gmApiVerified:false,businessVerified:false
 });
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
