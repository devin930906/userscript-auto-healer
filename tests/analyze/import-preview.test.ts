import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {importDroppedBytes} from '../../src/import/import-service';
import {previewImportedScriptAnalysis,previewImportedBatch} from '../../src/analyze/import-preview';
import {previewImportedBatchOffMain,validateIsolatedPreviewReply} from '../../src/analyze/isolated-batch-preview';

const header='// ==UserScript==\n// @name preview-test\n// @match https://example.org/*\n// ==/UserScript==\n';
function imported(code:string){
 const result=importDroppedBytes('preview.user.js',new TextEncoder().encode(code));
 assert.equal('code' in result,false);
 if('code' in result)throw Error(result.code);
 return result;
}

test('TEST-004/011: imports provide read-only selector position counts, not sensitive selector source',()=>{
 const source=header+
   'function run(){document.querySelector("#private-node");'+
   'document.querySelectorAll(dynamicSelector);}\n'+
   'document.getElementById("private-item");\n';
 const analyzed=previewImportedScriptAnalysis(imported(source));
 assert.equal(analyzed.status,'STATIC_ANALYSIS_ONLY');
 assert.equal(analyzed.metadataStatus,'OK');
 assert.equal(analyzed.totalSites,3);
 assert.equal(analyzed.literalSites,2);
 assert.equal(analyzed.runtimeConfirmationSites,1);
 assert.deepEqual(analyzed.sites.map(x=>x.method),
   ['querySelector','querySelectorAll','getElementById']);
 assert.equal(analyzed.automaticPatchAllowed,false);
 assert.equal(analyzed.tampermonkeyVerified,false);
 assert.equal(analyzed.businessVerified,false);
 const data=JSON.stringify(analyzed);
 assert.equal(data.includes('private-node'),false);
 assert.equal(data.includes('private-item'),false);
 assert.equal(data.includes('https://'),false);
});

test('TEST-004: incomplete metadata and invalid JS never produce verified selector evidence',()=>{
 const badMetadata=previewImportedScriptAnalysis(imported('document.querySelector("#secret");'));
 assert.equal(badMetadata.status,'INVALID_METADATA');
 assert.equal(badMetadata.totalSites,0);
 const badSource=previewImportedScriptAnalysis(imported(header+'function broken( {'));
 assert.equal(badSource.status,'PARSE_ERROR');
 assert.equal(badSource.totalSites,0);
 assert.equal(badSource.automaticPatchAllowed,false);
});

test('TEST-011: large imports remain readable but synchronous AST preview is bounded',()=>{
 const large=imported(header+'x'.repeat(256*1024));
 const analyzed=previewImportedScriptAnalysis(large);
 assert.equal(analyzed.status,'SKIPPED_TOO_LARGE');
 assert.equal(analyzed.metadataStatus,'NOT_CHECKED');
 assert.deepEqual(analyzed.sites,[]);
 assert.equal(analyzed.automaticPatchAllowed,false);
});

test('TEST-011: batch AST work is bounded without dropping imported scripts',()=>{
 const scripts=Array.from({length:24},()=>imported(header+'document.querySelector("#item");'));
 const previews=previewImportedBatch(scripts);
 assert.equal(previews.length,24);
 assert.equal(previews.filter(x=>x.status==='STATIC_ANALYSIS_ONLY').length,16);
 assert.equal(previews.filter(x=>x.status==='SKIPPED_BATCH_BUDGET').length,8);
 assert.ok(previews.every(x=>x.automaticPatchAllowed===false));
});

test('TEST-004/011/022: native-batch AST results run in an actual isolated Node worker',async()=>{
 const scripts=Array.from({length:24},(_,i)=>imported(
  header+`document.querySelector("#private-selector-${i}");`
 ));
 const actual=await previewImportedBatchOffMain(scripts);
 const expected=previewImportedBatch(scripts);
 assert.deepEqual(actual,expected);
 assert.equal(actual.length,24);
 assert.equal(actual.filter(x=>x.status==='STATIC_ANALYSIS_ONLY').length,16);
 assert.equal(actual.filter(x=>x.status==='SKIPPED_BATCH_BUDGET').length,8);
 assert.equal(JSON.stringify(actual).includes('private-selector-'),false);
 assert.ok(actual.every(x=>!x.automaticPatchAllowed&&!x.tampermonkeyVerified&&
   !x.businessVerified));
});

test('TEST-022/NFR-009: already-cancelled worker request cannot start source analysis',async()=>{
 const controller=new AbortController();
 controller.abort();
 const results=await previewImportedBatchOffMain(
  [imported(header+'document.querySelector("#secret");')],controller.signal);
 assert.deepEqual(results.map(x=>x.status),['SKIPPED_CANCELLED']);
 assert.equal(results[0].totalSites,0);
 assert.equal(JSON.stringify(results).includes('secret'),false);
});

test('TEST-022/NFR-009: cancellation terminates in-flight static worker without verified claims',async()=>{
 const controller=new AbortController();
 const scripts=Array.from({length:5},()=>imported(header+
  'document.querySelector("#private");'.repeat(5000)));
 const analysis=previewImportedBatchOffMain(scripts,controller.signal);
 controller.abort();
 let timeout:NodeJS.Timeout|undefined;
 try{
  const results=await Promise.race([analysis,
   new Promise<never>((_resolve,reject)=>{
    timeout=setTimeout(()=>reject(Error('WORKER_CANCELLATION_STALLED')),2000);
   })]);
  assert.equal(results.length,5);
  assert.ok(results.some(x=>x.status==='SKIPPED_CANCELLED'));
  assert.ok(results.every(x=>x.automaticPatchAllowed===false&&
    x.tampermonkeyVerified===false&&x.businessVerified===false));
 }finally{if(timeout)clearTimeout(timeout);}
});


test('TEST-004/022: one dropped userscript is parsed by the real isolated worker, never verified',async()=>{
 const source=header+'document.querySelector("#sensitive-candidate");';
 const script=imported(source);
 const before=Buffer.from(script.bytes).toString('hex');
 const [isolated]=await previewImportedBatchOffMain([script]);
 assert.deepEqual(isolated,previewImportedScriptAnalysis(script));
 assert.equal(isolated.status,'STATIC_ANALYSIS_ONLY');
 assert.equal(isolated.automaticPatchAllowed,false);
 assert.equal(isolated.tampermonkeyVerified,false);
 assert.equal(isolated.businessVerified,false);
 assert.equal(JSON.stringify(isolated).includes('sensitive-candidate'),false);
 assert.equal(Buffer.from(script.bytes).toString('hex'),before,'worker cannot modify imported bytes');
 const invalid=imported('document.querySelector("#private");');
 const [rejected]=await previewImportedBatchOffMain([invalid]);
 assert.equal(rejected.status,'INVALID_METADATA');
 assert.equal(rejected.automaticPatchAllowed,false);
});

test('TEST-011/022/026: isolated worker reply accepts only sanitized preview fields',()=>{
 const original=previewImportedScriptAnalysis(imported(header+
   'document.querySelector("#private-selector");'));
 const clean=JSON.parse(JSON.stringify(original));
 const received=validateIsolatedPreviewReply([clean],1);
 assert.deepEqual(received,[original]);
 assert.ok(received);
 assert.notEqual(received![0],clean,'do not forward a worker-owned object directly');
 assert.equal(JSON.stringify(received).includes('private-selector'),false);

 // An unexpected field at any depth could carry private source/selector data.
 assert.equal(validateIsolatedPreviewReply([{...clean,source:'SECRET_SOURCE'}],1),null);
 assert.equal(validateIsolatedPreviewReply([{
   ...clean,sites:[{...clean.sites[0],selector:'#SECRET_SELECTOR'}]
 }],1),null);
 assert.equal(validateIsolatedPreviewReply([{
   ...clean,sites:[{...clean.sites[0],method:'document.cookie'}]
 }],1),null);
 assert.equal(validateIsolatedPreviewReply([{
   ...clean,sites:[{...clean.sites[0],kind:'secret'}]
 }],1),null);

 // A syntactically plausible but contradictory result cannot claim evidence.
 assert.equal(validateIsolatedPreviewReply([{
   ...clean,totalSites:10,literalSites:10,runtimeConfirmationSites:1
 }],1),null);
 assert.equal(validateIsolatedPreviewReply([{
   ...clean,metadataStatus:'NOT_CHECKED'
 }],1),null);
 assert.equal(validateIsolatedPreviewReply([{
   ...clean,sites:[{...clean.sites[0],line:0}]
 }],1),null);
 assert.equal(validateIsolatedPreviewReply([{
   ...clean,tampermonkeyVerified:true
 }],1),null);
});

test('TEST-026: hostile worker-reply getters, proxies and array slots fail closed',()=>{
 const preview=JSON.parse(JSON.stringify(previewImportedScriptAnalysis(
   imported(header+'document.querySelector("#sensitive");'))));
 let invoked=0;
 const hostileSite={...preview.sites[0]};
 Object.defineProperty(hostileSite,'method',{enumerable:true,
   get(){invoked++;return 'querySelector';}});
 assert.equal(validateIsolatedPreviewReply([{
   ...preview,sites:[hostileSite]
 }],1),null);
 assert.equal(invoked,0);

 const hostileTop={...preview};
 Object.defineProperty(hostileTop,'sites',{enumerable:true,
   get(){invoked++;return preview.sites;}});
 assert.equal(validateIsolatedPreviewReply([hostileTop],1),null);
 assert.equal(invoked,0);

 const accessorArray=[preview];
 Object.defineProperty(accessorArray,'0',{configurable:true,enumerable:true,
   get(){invoked++;return preview;}});
 assert.equal(validateIsolatedPreviewReply(accessorArray,1),null);
 assert.equal(invoked,0);
 assert.equal(validateIsolatedPreviewReply(new Array(1),1),null);
 assert.equal(validateIsolatedPreviewReply(new Proxy([preview],{
   ownKeys(){throw Error('PRIVATE_PROXY_ERROR');}
 }),1),null);
 assert.equal(validateIsolatedPreviewReply([Object.create({source:'leak'})],1),null);
});
