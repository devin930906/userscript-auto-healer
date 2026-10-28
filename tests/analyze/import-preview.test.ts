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
 const expected=scripts.map(previewImportedScriptAnalysis);
 assert.deepEqual(actual,expected);
 assert.equal(actual.length,24);
 assert.equal(actual.filter(x=>x.status==='STATIC_ANALYSIS_ONLY').length,24);
 assert.equal(actual.filter(x=>x.status==='SKIPPED_BATCH_BUDGET').length,0);
 assert.equal(JSON.stringify(actual).includes('private-selector-'),false);
 assert.ok(actual.every(x=>!x.automaticPatchAllowed&&!x.tampermonkeyVerified&&
   !x.businessVerified));
});

test('TASK-013/TEST-022/026: failed Worker startup reports only a bounded reason, never source',async()=>{
 // Structured clone rejects functions, so this fails before any Worker runs.
 // Keep the failure fixture disposable and assert fail-closed business flags.
 const script=imported(header+'document.querySelector("#private-selector-never-log");');
 const bad={
  bytes:script.bytes,
  textEncoding:(()=> 'PRIVATE_SOURCE_NEVER_LOG') as unknown as typeof script.textEncoding
 };
 const warnings:string[]=[];
 const originalWarn=console.warn;
 console.warn=(...parts:unknown[])=>{warnings.push(parts.map(String).join(' '));};
 let actual;
 try{
  actual=await previewImportedBatchOffMain([bad]);
 }finally{
  console.warn=originalWarn;
 }
 assert.deepEqual(actual.map(item=>item.status),['ISOLATED_ANALYSIS_FAILED']);
 assert.ok(actual.every(item=>!item.automaticPatchAllowed&&
  !item.tampermonkeyVerified&&!item.businessVerified));
 assert.deepEqual(warnings,[
  'UAH_AST_WORKER_UNAVAILABLE reason=START_FAILED count=1'
 ]);
 assert.ok(!warnings.join(' ').includes('PRIVATE_SOURCE_NEVER_LOG'));
 assert.ok(!warnings.join(' ').includes('private-selector-never-log'));
});

test('TEST-022/017: native batch previews 36 scripts across bounded isolated worker segments',async()=>{
 const scripts=Array.from({length:36},(_,i)=>imported(
  header+'document.querySelector("#private-segment-'+i+'");'
 ));
 const counts:Array<[number,number]>=[];
 const results=await previewImportedBatchOffMain(scripts,undefined,
   (processed,total)=>counts.push([processed,total]));
 assert.deepEqual(counts,[[16,36],[32,36],[36,36]]);
 assert.equal(results.length,36);
 assert.equal(results.filter(x=>x.status==='STATIC_ANALYSIS_ONLY').length,36,
  'files past the first 16 must be processed by later bounded worker segments');
 assert.equal(results.filter(x=>x.status==='SKIPPED_BATCH_BUDGET').length,0);
 assert.equal(JSON.stringify(results).includes('private-segment-'),false);
 assert.ok(results.every(x=>x.automaticPatchAllowed===false&&
   x.tampermonkeyVerified===false&&x.businessVerified===false));
});

test('TEST-022/NFR-009: read-only native AST batch continues beyond 64 files with bounded worker segments',async()=>{
 const scripts=Array.from({length:70},(_,i)=>imported(
  header+'document.querySelector("#not-exposed-'+i+'");'
 ));
 const progress:number[]=[];
 const reports=await previewImportedBatchOffMain(scripts,undefined,
   (processed,total)=>{
     assert.equal(total,70);
     progress.push(processed);
   });
 assert.deepEqual(progress,[16,32,48,64,70],
   'even budget-skipped files must complete the finite UI counter');
 assert.equal(reports.length,70);
 assert.deepEqual(reports.map(x=>x.status),
  Array(70).fill('STATIC_ANALYSIS_ONLY'),
  'eligible scripts after position 64 must not silently lose static AST analysis');
 assert.equal(JSON.stringify(reports).includes('not-exposed-'),false);
 assert.ok(reports.every(x=>!x.automaticPatchAllowed&&!x.businessVerified&&
   !x.tampermonkeyVerified));
});

test('TEST-022/NFR-009: cancellation before batch dispatch marks all eligible segments cancelled',async()=>{
 const controller=new AbortController();
 controller.abort();
 const scripts=Array.from({length:70},(_,i)=>imported(
  header+'document.querySelector("#do-not-run-'+i+'");'
 ));
 const reports=await previewImportedBatchOffMain(scripts,controller.signal);
 assert.deepEqual(reports.map(x=>x.status),
  Array(70).fill('SKIPPED_CANCELLED'),
  'cancelled files beyond the old segment cap are still counted as cancelled');
 assert.equal(JSON.stringify(reports).includes('do-not-run-'),false);
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

test('TEST-011/026: isolated AST site kinds must agree with reported totals, including truncated previews',()=>{
 const literal=JSON.parse(JSON.stringify(previewImportedScriptAnalysis(
   imported(header+'document.querySelector("#private");'))));
 assert.equal(literal.status,'STATIC_ANALYSIS_ONLY');
 assert.equal(literal.literalSites,1);
 assert.equal(literal.runtimeConfirmationSites,0);
 assert.equal(validateIsolatedPreviewReply([literal],1)?.length,1);
 // A forged worker response can preserve totalSites while swapping its
 // kind breakdown or changing the detailed site's kind.
 assert.equal(validateIsolatedPreviewReply([{
   ...literal,literalSites:0,runtimeConfirmationSites:1
 }],1),null);
 assert.equal(validateIsolatedPreviewReply([{
   ...literal,sites:[{...literal.sites[0],kind:'needs-runtime-confirmation'}]
 }],1),null);
 assert.equal(validateIsolatedPreviewReply([{
   ...literal,sites:[{...literal.sites[0],method:'<dynamic-member>'}]
 }],1),null);

 const many=JSON.parse(JSON.stringify(previewImportedScriptAnalysis(
   imported(header+'document.querySelector("#private");'.repeat(8)+
     'document.querySelector(dynamicSelector);'))));
 assert.equal(many.totalSites,9);
 assert.equal(many.sites.length,8);
 assert.equal(many.literalSites,8);
 assert.equal(many.runtimeConfirmationSites,1);
 assert.equal(validateIsolatedPreviewReply([many],1)?.length,1,
   'a valid truncated preview must remain accepted');
 assert.equal(validateIsolatedPreviewReply([{
   ...many,literalSites:1,runtimeConfirmationSites:8
 }],1),null,'visible literals cannot exceed reported literal count');
 assert.equal(validateIsolatedPreviewReply([{
   ...many,sites:[{...many.sites[0],kind:'needs-runtime-confirmation'},...many.sites.slice(1)]
 }],1)?.length,1,
   'a truncated preview may show only a subset of each category');
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

test('TASK-013/TEST-022/026: forged batch AbortSignal never runs attacker hooks',async()=>{
 const script=imported(header+'document.querySelector("#private-abort");');
 let invoked=0;
 // A direct caller must not turn a forged cancellation object into native
 // abort authority, nor run its getter before deciding whether to spawn work.
 const fake=Object.defineProperty({addEventListener:()=>{invoked++;}},
  'aborted',{get(){invoked++;throw Error('UNTRUSTED_ABORT_GETTER');}});
 assert.deepEqual(await previewImportedBatchOffMain([script],
  fake as unknown as AbortSignal),[]);
 assert.equal(invoked,0,'a rejected signal must not execute its getter');
 const proxy=new Proxy(new AbortController().signal,{
  get(){invoked++;throw Error('UNTRUSTED_ABORT_PROXY_GET');},
  getPrototypeOf(){invoked++;throw Error('UNTRUSTED_ABORT_PROXY_PROTO');}
 });
 assert.deepEqual(await previewImportedBatchOffMain([script],proxy),[]);
 assert.equal(invoked,0,'a Proxy signal must be rejected before traps');
 const revoked=Proxy.revocable(new AbortController().signal,{});
 revoked.revoke();
 assert.deepEqual(await previewImportedBatchOffMain([script],revoked.proxy),[]);
 assert.equal(invoked,0);
});

test('TASK-013/TEST-022/026: native AST batch rejects hostile arrays and fields before their JS hooks run',async()=>{
 const script=imported(header+'document.querySelector("#never-expose-untrusted");');
 let traps=0;
 const attack=()=>{traps++;throw Error('UNTRUSTED_AST_BATCH_HOOK');};
 const refuse=async(value:unknown)=>{
  assert.deepEqual(await previewImportedBatchOffMain(
   value as ReturnType<typeof imported>[]),[],
   'untrusted direct native request must be rejected before worker dispatch');
  assert.equal(traps,0,'hostile batch input must not execute any JS hooks');
 };
 const proxy=new Proxy([script],{
  get:attack,getPrototypeOf:attack,ownKeys:attack
 });
 await refuse(proxy);
 const revoked=Proxy.revocable([script],{});revoked.revoke();
 await refuse(revoked.proxy);
 const accessorSlot=[script];
 Object.defineProperty(accessorSlot,'0',{configurable:true,enumerable:true,get:attack});
 await refuse(accessorSlot);
 const accessorField=Object.defineProperty({},'bytes',{
  configurable:true,enumerable:true,get:attack
 });
 await refuse([accessorField]);
 const proxiedEntry=new Proxy(script,{
  get:attack,getPrototypeOf:attack,ownKeys:attack
 });
 await refuse([proxiedEntry]);
 const proxiedBytes=new Proxy(script.bytes,{
  get:attack,getPrototypeOf:attack,ownKeys:attack
 });
 await refuse([{...script,bytes:proxiedBytes}]);
 const overriddenSlice=[script];
 Object.defineProperty(overriddenSlice,'slice',{value:attack});
 await refuse(overriddenSlice);
 const overriddenLength=Uint8Array.from(script.bytes);
 Object.defineProperty(overriddenLength,'byteLength',{get:attack});
 await refuse([{...script,bytes:overriddenLength}]);
 const good=await previewImportedBatchOffMain([script]);
 assert.deepEqual(good,[previewImportedScriptAnalysis(script)],
  'genuine native imported bytes must retain normal isolated worker behavior');
});

test('TASK-013/TEST-022/026: native AST batch encoding rejects structured-clone getter hooks',async()=>{
 const script=imported(header+'document.querySelector("#secret-encoding");');
 let invoked=0;
 const hostileEncoding=Object.defineProperty({},'secret',{
  enumerable:true,get(){invoked++;throw Error('UNTRUSTED_ENCODING_CLONE_GETTER');}
 });
 const bad={bytes:script.bytes,
  textEncoding:hostileEncoding as unknown as typeof script.textEncoding};
 assert.deepEqual(await previewImportedBatchOffMain([bad]),[],
  'invalid direct native encoding must fail before Worker structured clone');
 assert.equal(invoked,0,'Worker startup may not evaluate untrusted encoding getters');
});

test('TASK-013/TEST-022: native AST progress cannot replace unprocessed source bytes',async()=>{
 const scripts=Array.from({length:17},(_,i)=>imported(
  header+`document.querySelector("#private-before-progress-${i}");`
 ));
 const original=scripts.map(previewImportedScriptAnalysis);
 const progress:number[]=[];
 const reports=await previewImportedBatchOffMain(scripts,undefined,(processed,total)=>{
  progress.push(processed);
  assert.equal(total,17);
  if(processed===16) scripts[16].bytes.fill(0);
 });
 assert.deepEqual(progress,[16,17]);
 assert.deepEqual(reports,original,
  'a progress callback cannot change the source analyzed by a later worker');
 assert.ok(reports.every(x=>x.status==='STATIC_ANALYSIS_ONLY'));
});

test('TASK-013/TEST-022/026: direct over-capacity AST call refuses before invoking caller methods',async()=>{
 // The native importer caps batches at 1000. A forged direct call must not
 // allocate one fallback per untrusted slot or invoke overridden Array.map.
 const tooMany=new Array(1001) as ReturnType<typeof imported>[];
 let mapCalls=0;
 Object.defineProperty(tooMany,'map',{value(){
  mapCalls++;
  throw Error('UNTRUSTED_OVER_CAPACITY_ARRAY_MAP');
 }});
 let progressCalls=0;
 const reports=await previewImportedBatchOffMain(tooMany,undefined,
  ()=>{progressCalls++;});
 assert.deepEqual(reports,[],'invalid direct batches must fail without output allocation');
 assert.equal(mapCalls,0,'over-capacity refusal must not execute a caller method');
 assert.equal(progressCalls,0,'invalid batches have no valid per-file progress');
});

test('TASK-013/TEST-022/026: isolated reply rejects Proxy arrays, rows and sites before reflection',()=>{
 const preview=JSON.parse(JSON.stringify(previewImportedScriptAnalysis(
  imported(header+'document.querySelector("#sensitive");'))));
 let traps=0;
 const reject=()=>{traps++;throw Error('PRIVATE_WORKER_PROXY_TRAP');};
 const proxyArray=new Proxy([preview],{get:reject,getPrototypeOf:reject});
 const proxyRow=new Proxy(preview,{getPrototypeOf:reject,ownKeys:reject});
 const proxySite=new Proxy(preview.sites[0],{getPrototypeOf:reject,ownKeys:reject});
 for(const input of [
  proxyArray,[proxyRow],[{...preview,sites:[proxySite]}]
 ]) {
  assert.equal(validateIsolatedPreviewReply(input,1),null);
  assert.equal(traps,0,'hostile Proxy traps must never run in a read-only reply boundary');
 }
 const revokedArray=Proxy.revocable([preview],{});revokedArray.revoke();
 const revokedRow=Proxy.revocable(preview,{});revokedRow.revoke();
 const revokedSite=Proxy.revocable(preview.sites[0],{});revokedSite.revoke();
 for(const input of [revokedArray.proxy,[revokedRow.proxy],
  [{...preview,sites:[revokedSite.proxy]}]]) {
  assert.equal(validateIsolatedPreviewReply(input,1),null);
 }
 assert.equal(traps,0);
});
