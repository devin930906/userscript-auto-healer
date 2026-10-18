import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {parseUserscriptMetadata,type MetadataResult} from '../../src/analyze/metadata-parser';
import {inspectTampermonkeyTargetHints,TAMPERMONKEY_EXTENSION_ID} from '../../src/manager/tampermonkey-adapter';
import {inspectReportedTampermonkeyPreflight} from '../../src/manager/tampermonkey-preflight';

const runtime=inspectTampermonkeyTargetHints([
 {targetId:'verified-structure-01',type:'service_worker',
  url:'chrome-extension://'+TAMPERMONKEY_EXTENSION_ID+'/background.js'}
]);
const report={
 extensionId:TAMPERMONKEY_EXTENSION_ID as string,version:'5.5.1',
 enabled:true,userScriptsPermission:true,userScriptsAllowed:true,
 scriptInstalled:true,scriptEnabled:true
};
const metadata=(tags:Record<string,string[]>):MetadataResult=>({
 status:'OK',header:'// ==UserScript==',lines:[],tags,unknownNames:[]
});
const normal=metadata({grant:['GM_getValue'],match:['https://example.com/*']});
const inspect=(source:typeof report=report,meta:MetadataResult=normal,
 target='https://example.com/foo',consent=true)=>
 inspectReportedTampermonkeyPreflight(runtime,source,meta,target,consent);

test('TEST-017: eligible metadata is not proof of installed script, actual GM or business success',()=>{
 const found=inspect();
 assert.deepEqual(found,{ok:true,status:'METADATA_ELIGIBLE_ONLY',
  extensionId:TAMPERMONKEY_EXTENSION_ID,reportedVersion:'5.5.1',
  scriptMatchPattern:'https://example.com/*',extensionAuthenticityVerified:false,
  scriptInstallationVerified:false,gmApiVerified:false,businessVerified:false});
});
test('TEST-017: read-only parser metadata integrates with preflight without claiming GM execution',()=>{
 const script=['// ==UserScript==','// @name Safe fixture',
  '// @match https://example.com/*','// @grant GM_getValue',
  '// ==/UserScript==','void 0;'].join('\\n').replace(/\\n/g,'\n');
 const parsed=parseUserscriptMetadata({bytes:new TextEncoder().encode(script),
  textEncoding:'utf-8'});
 assert.equal(parsed.status,'OK');
 const result=inspect(report,parsed);
 assert.equal(result.ok,true);
 if(result.ok){
   assert.equal(result.gmApiVerified,false);
   assert.equal(result.scriptInstallationVerified,false);
 }
});
test('TEST-017: consent and real owned-target hint stage cannot be bypassed',()=>{
 assert.deepEqual(inspect(report,normal,'https://example.com/',false),
   {ok:false,status:'BLOCKED',code:'NOT_AUTHORIZED',gmApiVerified:false,businessVerified:false});
 assert.equal(inspectReportedTampermonkeyPreflight(
  {ok:false,code:'RUNTIME_NOT_OBSERVED'},report,normal,'https://example.com/',true
 ).ok,false);
});
test('TEST-017: wrong extension, disabled manager, missing userScripts permission and absent installation are blocked',()=>{
 const cases:[Partial<typeof report>,string][]=[
  [{extensionId:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'},'WRONG_MANAGER'],
  [{version:'5.5.1;bad'},'VERSION_NOT_REPORTED'],
  [{enabled:false},'MANAGER_NOT_ENABLED'],
  [{userScriptsPermission:false},'USERSCRIPTS_PERMISSION_UNKNOWN'],
  [{userScriptsAllowed:false},'USERSCRIPTS_NOT_ALLOWED'],
  [{scriptInstalled:false},'SCRIPT_NOT_REPORTED_ENABLED'],
  [{scriptEnabled:false},'SCRIPT_NOT_REPORTED_ENABLED']
 ];
 for(const [change,code] of cases){
  const result=inspect({...report,...change});
  assert.equal(result.ok,false);
  if(!result.ok)assert.equal(result.code,code);
 }
});
test('TEST-017: GM grant must be explicit; incomplete source metadata is not a live test',()=>{
 for(const meta of [
  metadata({grant:['none'],match:['https://example.com/*']}),
  metadata({grant:['GM_xmlhttpRequest'],match:['https://example.com/*']})
 ]){
  assert.deepEqual(inspect(report,meta),
   {ok:false,status:'BLOCKED',code:'GM_GRANT_NOT_DECLARED',gmApiVerified:false,businessVerified:false});
 }
 const bad={...normal,status:'MISSING_HEADER' as const};
 const result=inspect(report,bad);
 assert.equal(result.ok,false);
 if(!result.ok)assert.equal(result.code,'INVALID_SCRIPT_METADATA');
});
test('TEST-017: ambiguous origins, wildcard hosts, exclusions and unsupported paths are never guessed',()=>{
 for(const [meta,target] of [
  [metadata({grant:['GM_getValue'],match:['https://example.com/*']}),'https://elsewhere.test/'],
  [metadata({grant:['GM_getValue'],match:['https://*.example.com/*']}),'https://a.example.com/'],
  [metadata({grant:['GM_getValue'],match:['*://*/*']}),'https://example.com/'],
  [metadata({grant:['GM_getValue'],match:['https://example.com/admin/*']}),'https://example.com/customer/'],
  [metadata({grant:['GM_getValue'],match:['https://example.com/*'],exclude:['https://example.com/private/*']}),'https://example.com/foo'],
  [metadata({grant:['GM_getValue'],match:['https://example.com/*']}),'https://example.com.evil.invalid/'],
  [metadata({grant:['GM_getValue'],match:['https://example.com/*']}),'https://example.com:8443/']
 ] as Array<[MetadataResult,string]>){
  const result=inspect(report,meta,target);
  assert.equal(result.ok,false);
  if(!result.ok)assert.equal(result.code,'MATCH_NOT_CONFIRMED');
 }
});
test('TEST-017: malformed target URL, credentials and fragment fail closed',()=>{
 for(const target of ['not a url','file:///tmp/private','https://user:pass@example.com/',
   'https://example.com/#private']){
  const result=inspect(report,normal,target);
  assert.equal(result.ok,false);
  if(!result.ok)assert.equal(result.code,'INVALID_INPUT');
 }
});

test('TEST-017: query string participates in conservative @match path matching',()=>{
 const exact=metadata({grant:['GM_getValue'],match:['https://example.com/admin']});
 assert.equal(inspect(report,exact,'https://example.com/admin').ok,true);
 const queried=inspect(report,exact,'https://example.com/admin?mode=edit');
 assert.equal(queried.ok,false);
 if(!queried.ok)assert.equal(queried.code,'MATCH_NOT_CONFIRMED');
 const queryPrefix=metadata({grant:['GM_getValue'],
   match:['https://example.com/admin?mode=edit*']});
 assert.equal(inspect(report,queryPrefix,'https://example.com/admin?mode=edit&tab=1').ok,true);
 const differentQuery=inspect(report,queryPrefix,'https://example.com/admin?mode=view');
 assert.equal(differentQuery.ok,false);
 if(!differentQuery.ok)assert.equal(differentQuery.code,'MATCH_NOT_CONFIRMED');
 const pathPrefix=metadata({grant:['GM_getValue'],match:['https://example.com/admin*']});
 assert.equal(inspect(report,pathPrefix,'https://example.com/admin?mode=edit').ok,true);
});
