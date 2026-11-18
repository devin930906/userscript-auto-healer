import {mock,test} from 'node:test';
import {createHash} from 'node:crypto';
import type {ImportedScript} from '../../src/import/import-service';
import {snapshotNativeScripts} from '../../src/jobs/imported-analysis-queue';

import {strict as assert} from 'node:assert';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {importApprovedPaths} from '../../src/import/import-service';
import {runImportedReadOnlyAnalysisQueue} from '../../src/jobs/imported-analysis-queue';
import {unavailableImportPreview} from '../../src/analyze/import-preview';

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
