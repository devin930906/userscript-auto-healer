import {mock,test} from 'node:test';
import {createHash} from 'node:crypto';
import type {ImportedScript} from '../../src/import/import-service';
import {snapshotNativeScripts} from '../../src/jobs/imported-analysis-queue';

import {strict as assert} from 'node:assert';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {importApprovedPaths} from '../../src/import/import-service';
import {runImportedReadOnlyAnalysisQueue} from '../../src/jobs/imported-analysis-queue';
import {unavailableImportPreview} from '../../src/analyze/import-preview';
import {EventEmitter} from 'node:events';

test('TASK-013/TEST-022/026: cancelled queue waits for Worker retirement',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-ast-cancel-retirement-'));
 const workers=require('node:worker_threads') as
  {Worker:typeof import('node:worker_threads').Worker};
 const realWorker=workers.Worker;
 const controller=new AbortController();
 let markStarted!:()=>void;
 const started=new Promise<void>(resolve=>{markStarted=resolve;});
 let finishRetirement!:()=>void;
 const retirement=new Promise<number>(resolve=>{finishRetirement=()=>resolve(0);});
 let queue:ReturnType<typeof runImportedReadOnlyAnalysisQueue>|undefined;
 let settled=false;
 let retirementRequested=false;
 try{
  const file=join(root,'cancellation.user.js');
  await writeFile(file,'// ==UserScript==\n// @name cancellation\n'+
   '// @match https://example.org/*\n// ==/UserScript==\n'+
   'document.querySelector("#target");');
  const {scripts}=await importApprovedPaths([file]);
  assert.equal(scripts.length,1);
  workers.Worker=class extends EventEmitter{
   constructor(){super();markStarted();}
   terminate(){retirementRequested=true;return retirement;}
  } as unknown as typeof realWorker;
  queue=runImportedReadOnlyAnalysisQueue(scripts,controller.signal)
   .finally(()=>{settled=true;});
  await started;
  controller.abort();
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(retirementRequested,true);
  assert.equal(settled,false,'the scheduler must not return while termination is pending');
  finishRetirement();
  assert.deepEqual((await queue).map(row=>row.status),['SKIPPED_CANCELLED']);
 }finally{
  controller.abort();
  finishRetirement();
  await queue?.catch(()=>{});
  workers.Worker=realWorker;
  await rm(root,{recursive:true,force:true});
 }
});

/** TASK-013 / Issue #857 / TEST-022: each imported file must receive its
 * independent read-only AST opportunity. A 16-file count segment cannot
 * silently exhaust the separate 1 MiB isolated Worker byte budget.
 * All files are disposable, locally generated, and never executed.
 */
test('TASK-013/TEST-022: valid later scripts are not skipped by earlier segment bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-ast-byte-aware-'));
 try{
  const files:string[]=[];
  for(let i=0;i<3;i++){
   const file=join(root,'byte-budget-'+i+'.user.js');
   const source='// ==UserScript==\n// @name byte-budget-'+i+
    '\n// @match https://example.org/*\n// ==/UserScript==\n'+
    'document.querySelector("#target");\n/*'+'x'.repeat(400*1024)+'*/';
   await writeFile(file,source);
   files.push(file);
  }
  const imported=await importApprovedPaths(files);
  assert.equal(imported.scripts.length,3,'all three authorized scripts must import');
  const counts:number[]=[];
  const previews=await runImportedReadOnlyAnalysisQueue(
   imported.scripts,undefined,(processed,total)=>{
    assert.equal(total,3);
    counts.push(processed);
   });
  assert.equal(previews.length,3);
  for(let i=0;i<previews.length;i++){
   assert.equal(previews[i].status,'STATIC_ANALYSIS_ONLY',
    'script '+i+' is below the per-file ceiling and must not be skipped solely by its preceding files');
   assert.equal(previews[i].tampermonkeyVerified,false);
   assert.equal(previews[i].businessVerified,false);
   assert.equal(previews[i].automaticPatchAllowed,false);
  }
  assert.equal(counts.at(-1),3);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('TASK-013/REQ-022/TEST-022: exhausted segment retries preserve successful sibling AST previews',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-ast-per-script-recovery-'));
 try{
  const files:string[]=[];
  const sources:string[]=[];
  for(let i=0;i<3;i++){
   const file=join(root,'script-'+i+'.user.js');
   const source='// ==UserScript==\n// @name per-script-'+i+
    '\n// @match https://example.org/*\n// ==/UserScript==\n'+
    'document.querySelector("#per-script-'+i+'");';
   await writeFile(file,source);
   files.push(file);sources.push(source);
  }
  const imported=await importApprovedPaths(files);
  const isolated=require('../../src/analyze/isolated-batch-preview') as
   typeof import('../../src/analyze/isolated-batch-preview');
  const actual=isolated.previewImportedBatchOffMain;
  let calls=0;
  const patch=mock.method(isolated,'previewImportedBatchOffMain',
   async(...args:Parameters<typeof actual>)=>{
    calls++;
    if(args[0].length>1)return {previews:args[0].map(()=>
     unavailableImportPreview('ISOLATED_ANALYSIS_FAILED','NOT_CHECKED')),
     safeToContinue:true} as unknown as Awaited<ReturnType<typeof actual>>;
    if(Buffer.from(args[0][0].bytes).toString('utf8').includes('#per-script-1'))
     return {previews:[unavailableImportPreview(
      'ISOLATED_ANALYSIS_FAILED','NOT_CHECKED')],safeToContinue:true} as unknown as
       Awaited<ReturnType<typeof actual>>;
    return actual(...args);
   });
  try{
   const previews=await runImportedReadOnlyAnalysisQueue(imported.scripts);
   assert.deepEqual(previews.map(row=>row.status),[
    'STATIC_ANALYSIS_ONLY','ISOLATED_ANALYSIS_FAILED','STATIC_ANALYSIS_ONLY'
   ],'each file should keep its own fresh result after one exhausted segment retry');
   assert.equal(calls,5,'two segment attempts then one bounded attempt per script');
   assert.ok(previews.every(row=>!row.automaticPatchAllowed&&
    !row.tampermonkeyVerified&&!row.businessVerified));
  }finally{patch.mock.restore();}
  for(let index=0;index<files.length;index++)
   assert.equal(await readFile(files[index],'utf8'),sources[index],
    'per-file AST recovery must never modify the selected source');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('TASK-013/TEST-022/026: cancellation during per-script recovery preserves earlier evidence and stops later workers',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-ast-per-script-cancel-'));
 try{
  const files:string[]=[];
  for(let i=0;i<3;i++){
   const file=join(root,'cancel-'+i+'.user.js');
   await writeFile(file,'// ==UserScript==\n// @name cancel-'+i+
    '\n// @match https://example.org/*\n// ==/UserScript==\n'+
    'document.querySelector("#cancel-'+i+'");');
   files.push(file);
  }
  const imported=await importApprovedPaths(files);
  const isolated=require('../../src/analyze/isolated-batch-preview') as
   typeof import('../../src/analyze/isolated-batch-preview');
  const actual=isolated.previewImportedBatchOffMain;
  const controller=new AbortController();
  let calls=0;
  const patch=mock.method(isolated,'previewImportedBatchOffMain',
   async(...args:Parameters<typeof actual>)=>{
    calls++;
    if(args[0].length>1)return {previews:args[0].map(()=>
     unavailableImportPreview('ISOLATED_ANALYSIS_FAILED','NOT_CHECKED')),
     safeToContinue:true} as unknown as Awaited<ReturnType<typeof actual>>;
    const result=await actual(...args);
    controller.abort();
    return result;
   });
  try{
   const previews=await runImportedReadOnlyAnalysisQueue(imported.scripts,
    controller.signal);
   assert.deepEqual(previews.map(row=>row.status),[
    'STATIC_ANALYSIS_ONLY','SKIPPED_CANCELLED','SKIPPED_CANCELLED'
   ],'cancellation must retain only completed fresh fallback evidence');
   assert.equal(calls,3,'cancellation must prevent later per-file Worker launches');
  }finally{patch.mock.restore();}
 }finally{await rm(root,{recursive:true,force:true});}
});

test('TASK-013/TEST-022/NFR-009: global deadline bounds per-script recovery',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-ast-fallback-deadline-'));
 const originalSetTimeout=globalThis.setTimeout;
 let expireDeadline:(()=>void)|undefined;
 globalThis.setTimeout=((callback:(...args:unknown[])=>void,delay?:number,
  ...args:unknown[])=>{
  if(delay===120000){
   expireDeadline=()=>callback(...args);
   return originalSetTimeout(()=>undefined,delay);
  }
  return originalSetTimeout(callback,delay,...args);
 }) as typeof setTimeout;
 try{
  const files:string[]=[];
  for(let i=0;i<3;i++){
   const file=join(root,'deadline-'+i+'.user.js');
   await writeFile(file,'// ==UserScript==\n// @name deadline-'+i+
    '\n// @match https://example.org/*\n// ==/UserScript==\n'+
    'document.querySelector("#deadline-'+i+'");');
   files.push(file);
  }
  const imported=await importApprovedPaths(files);
  const isolated=require('../../src/analyze/isolated-batch-preview') as
   typeof import('../../src/analyze/isolated-batch-preview');
  const actual=isolated.previewImportedBatchOffMain;
  let calls=0;
  const patch=mock.method(isolated,'previewImportedBatchOffMain',
   async(...args:Parameters<typeof actual>)=>{
    calls++;
    if(args[0].length>1)return {previews:args[0].map(()=>
     unavailableImportPreview('ISOLATED_ANALYSIS_FAILED','NOT_CHECKED')),
     safeToContinue:true} as unknown as Awaited<ReturnType<typeof actual>>;
    const result=await actual(...args);
    expireDeadline?.();
    expireDeadline=undefined;
    return result;
   });
  try{
   const previews=await runImportedReadOnlyAnalysisQueue(imported.scripts);
   assert.deepEqual(previews.map(row=>row.status),[
    'STATIC_ANALYSIS_ONLY','SKIPPED_BATCH_BUDGET','SKIPPED_BATCH_BUDGET'
   ]);
   assert.equal(calls,3,'global deadline must prevent later per-file worker launches');
  }finally{patch.mock.restore();}
 }finally{
  globalThis.setTimeout=originalSetTimeout;
  await rm(root,{recursive:true,force:true});
 }
});

test('TASK-013/TEST-022/026: unretired single-file fallback stops remaining file retries',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-ast-fallback-unretired-'));
 try{
  const files:string[]=[];
  for(let i=0;i<3;i++){
   const file=join(root,'unretired-fallback-'+i+'.user.js');
   await writeFile(file,'// ==UserScript==\n// @name unretired-fallback-'+i+
    '\n// @match https://example.org/*\n// ==/UserScript==\n'+
    'document.querySelector("#unretired-fallback-'+i+'");');
   files.push(file);
  }
  const imported=await importApprovedPaths(files);
  const isolated=require('../../src/analyze/isolated-batch-preview') as
   typeof import('../../src/analyze/isolated-batch-preview');
  const actual=isolated.previewImportedBatchOffMain;
  let calls=0;
  const patch=mock.method(isolated,'previewImportedBatchOffMain',
   async(...args:Parameters<typeof actual>)=>{
    calls++;
    if(args[0].length>1)return {previews:args[0].map(()=>
     unavailableImportPreview('ISOLATED_ANALYSIS_FAILED','NOT_CHECKED')),
     safeToContinue:true} as unknown as Awaited<ReturnType<typeof actual>>;
    return {previews:[unavailableImportPreview(
     'ISOLATED_ANALYSIS_FAILED','NOT_CHECKED')],safeToContinue:false} as unknown as
      Awaited<ReturnType<typeof actual>>;
   });
  try{
   const previews=await runImportedReadOnlyAnalysisQueue(imported.scripts);
   assert.equal(calls,3,'an unretired first fallback worker prevents every later launch');
   assert.deepEqual(previews.map(row=>row.status),
    Array(3).fill('ISOLATED_ANALYSIS_FAILED'));
  }finally{patch.mock.restore();}
 }finally{await rm(root,{recursive:true,force:true});}
});

test('TASK-013/TEST-022/026: unretired Worker stops retries and every later segment',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-ast-unretired-worker-'));
 try{
  const files:string[]=[];
  for(let i=0;i<17;i++){
   const file=join(root,'unretired-'+i+'.user.js');
   await writeFile(file,'// ==UserScript==\n// @name unretired-'+i+
    '\n// @match https://example.org/*\n// ==/UserScript==\n'+
    'document.querySelector("#unretired-'+i+'");');
   files.push(file);
  }
  const imported=await importApprovedPaths(files);
  const isolated=require('../../src/analyze/isolated-batch-preview') as
   typeof import('../../src/analyze/isolated-batch-preview');
  let calls=0;
  const patch=mock.method(isolated,'previewImportedBatchOffMain',async(
   scripts:readonly Pick<ImportedScript,'bytes'|'textEncoding'>[]
  )=>{
   calls++;
   const failed=Array.from({length:scripts.length},()=>
    unavailableImportPreview('ISOLATED_ANALYSIS_FAILED','NOT_CHECKED'));
   return {previews:failed,safeToContinue:false};
  });
  try{
   const previews=await runImportedReadOnlyAnalysisQueue(imported.scripts);
   assert.equal(calls,1,'a possibly live Worker must block retry and later segments');
   assert.equal(previews.length,17);
   assert.equal(previews.every(row=>row.status==='ISOLATED_ANALYSIS_FAILED'),true);
  }finally{patch.mock.restore();}
 }finally{await rm(root,{recursive:true,force:true});}
});

/** TASK-013 / REQ-022/026 / TEST-022/026: imported byte snapshots are
 * data-only. A caller-owned TypedArray iterator is executable JavaScript,
 * not a safe way to read native source bytes. */
test('TASK-013/TEST-026: snapshot never invokes a caller-owned byte iterator',()=>{
 const original=new Uint8Array(Buffer.from('// ==UserScript==\\n// @name safe\\n// ==/UserScript==\\n'));
 const sha256=createHash('sha256').update(original).digest('hex');
 let invoked=0;
 Object.defineProperty(original,Symbol.iterator,{
  configurable:true,
  get(){invoked++;throw Error('UNTRUSTED_ITERATOR_GETTER');}
 });
 const input=[{bytes:original,byteLength:original.byteLength,sha256,
  textEncoding:'utf-8'}] as unknown as ImportedScript[];
 const snapshot=snapshotNativeScripts(input);
 assert.equal(invoked,0,'native byte copying must not read Symbol.iterator');
 assert.ok(snapshot,'a valid native byte buffer must remain analyzable');
 assert.equal(createHash('sha256').update(snapshot[0].bytes).digest('hex'),sha256);
 assert.notEqual(snapshot[0].bytes,original,'the native boundary must copy bytes');
 original[0]=0;
 assert.equal(createHash('sha256').update(snapshot[0].bytes).digest('hex'),sha256,
  'mutating the caller buffer after snapshot must not change trusted bytes');
});

test('TASK-013/TEST-026: a deceptive source iterator cannot replace original bytes',()=>{
 const original=new Uint8Array([1,2,3,4]);
 const sha256=createHash('sha256').update(original).digest('hex');
 let invoked=0;
 Object.defineProperty(original,Symbol.iterator,{
  configurable:true,
  value:function*(){invoked++;yield 9;yield 9;yield 9;yield 9;}
 });
 const input=[{bytes:original,byteLength:4,sha256,
  textEncoding:'utf-8'}] as unknown as ImportedScript[];
 const snapshot=snapshotNativeScripts(input);
 assert.equal(invoked,0);
 assert.ok(snapshot);
 assert.deepEqual([...Uint8Array.prototype.values.call(snapshot[0].bytes)],[1,2,3,4]);
});

/** A SharedArrayBuffer can be mutated by a different thread while the
 * importer captures the purportedly identity-bound source. The isolated
 * AST worker already rejects shared backing; the preceding native batch
 * snapshot must enforce the same boundary. */
test('TASK-013/TEST-026: native batch boundary refuses shared mutable byte backing',()=>{
 if(typeof SharedArrayBuffer==='undefined')return;
 const backing=new SharedArrayBuffer(4);
 const bytes=new Uint8Array(backing);
 Uint8Array.prototype.set.call(bytes,new Uint8Array([1,2,3,4]));
 const sha256=createHash('sha256').update(bytes).digest('hex');
 const input=[{bytes,byteLength:4,sha256,
  textEncoding:'utf-8'}] as unknown as ImportedScript[];
 assert.equal(snapshotNativeScripts(input),null,
  'a cross-thread mutable shared buffer must never enter the native AST queue');
});
