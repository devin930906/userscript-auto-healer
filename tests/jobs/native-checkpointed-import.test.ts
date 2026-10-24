import {test,mock} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,mkdir,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {importApprovedPaths} from '../../src/import/import-service';
import {runCheckpointedNativeImportAnalysis} from '../../src/jobs/native-checkpointed-import';
import {BATCH_JOURNAL_FILENAME} from '../../src/jobs/batch-journal';

const header='// ==UserScript==\n// @name native-batch\n// @match https://example.org/*\n// ==/UserScript==\n';
test('TASK-013/TEST-022: real native imported scripts checkpoint and safely reanalyse after restart',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-batch-test-'));
 try{
  const a=join(home,'a.user.js'),b=join(home,'b.user.js');
  await writeFile(a,header+'document.querySelector("#private-one");');
  await writeFile(b,header+'document.querySelector("#private-two");');
  const root=join(home,'userdata','readonly-journals');
  await mkdir(join(home,'userdata'));
  const picked=await importApprovedPaths([a,b]);
  assert.equal(picked.errors.length,0);
  assert.equal(picked.scripts.length,2);
  const progress:Array<[number,number]>=[];
  const first=await runCheckpointedNativeImportAnalysis(root,picked.scripts,
   undefined,(done,total)=>progress.push([done,total]));
  assert.equal(first.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
  if(first.status!=='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED')return;
  assert.equal(first.resumed,false);
  assert.deepEqual(first.previews.map(x=>x.status),
   ['STATIC_ANALYSIS_ONLY','STATIC_ANALYSIS_ONLY']);
  assert.deepEqual(progress,[[2,2]]);
  assert.equal(JSON.stringify(first).includes('private-one'),false);
  const batches=await readdir(root);
  assert.equal(batches.length,1);
  const journal=join(root,batches[0],BATCH_JOURNAL_FILENAME);
  const stored=await readFile(journal,'utf8');
  const checkpoint=JSON.parse(stored);
  assert.deepEqual(checkpoint.jobs.map((x:{state:string})=>x.state),['SUCCEEDED']);
  assert.equal(stored.includes('private-one'),false);
  assert.equal(stored.includes(a),false);
  const selectedAgain=await importApprovedPaths([a,b]);
  const second=await runCheckpointedNativeImportAnalysis(root,selectedAgain.scripts);
  assert.equal(second.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
  if(second.status==='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED'){
   assert.equal(second.resumed,true);
   assert.deepEqual(second.previews,first.previews,
    'resume must independently re-run AST to obtain current display evidence');
  }
  // Same native file paths with changed bytes MUST start a different batch.
  await writeFile(b,header+'document.querySelector("#changed-bytes");');
  const modified=await importApprovedPaths([a,b]);
  const third=await runCheckpointedNativeImportAnalysis(root,modified.scripts);
  assert.equal(third.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
  if(third.status==='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED')
   assert.equal(third.resumed,false);
  assert.equal((await readdir(root)).length,2);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-013/TEST-022/026: tampered persistent batch blocks without replacing evidence',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-corrupt-test-'));
 try{
  const a=join(home,'script.user.js');
  await writeFile(a,header+'document.querySelector("#private-node");');
  const data=(await importApprovedPaths([a])).scripts;
  const root=join(home,'user-data','jobs');
  await mkdir(join(home,'user-data'));
  const first=await runCheckpointedNativeImportAnalysis(root,data);
  assert.equal(first.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
  const batch=(await readdir(root))[0];
  const journal=join(root,batch,BATCH_JOURNAL_FILENAME);
  const tampered='{"tampermonkeyVerified":true,"automaticPatchAllowed":true}';
  await writeFile(journal,tampered);
  const blocked=await runCheckpointedNativeImportAnalysis(root,data);
  assert.equal(blocked.status,'BLOCKED');
  if(blocked.status==='BLOCKED'){
   assert.equal(blocked.reason,'INVALID_CHECKPOINT');
   assert.ok(blocked.previews.every(x=>x.status==='ISOLATED_ANALYSIS_FAILED'));
  }
  assert.equal(await readFile(journal,'utf8'),tampered);
  const cancelled=new AbortController();cancelled.abort();
  const abort=await runCheckpointedNativeImportAnalysis(root,data,cancelled.signal);
  assert.deepEqual(abort.status,'BLOCKED');
  assert.equal(await readFile(journal,'utf8'),tampered);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-013/TEST-022/026: junctioned or missing userData parent cannot cause any checkpoint directory creation',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-journal-boundary-'));
 try{
  const selected=join(home,'selected.user.js');
  await writeFile(selected,header+'document.querySelector("#safe");');
  const data=(await importApprovedPaths([selected])).scripts;
  assert.equal(data.length,1);
  const foreign=join(home,'unrelated-foreign-directory');
  await mkdir(foreign);
  const alias=join(home,'redirected-userdata');
  // A Windows junction does not require changing the app's file ownership.
  await symlink(foreign,alias,process.platform==='win32'?'junction':'dir');
  const diverted=await runCheckpointedNativeImportAnalysis(join(alias,'readonly-import-journals'),data);
  assert.equal(diverted.status,'BLOCKED');
  if(diverted.status==='BLOCKED')assert.equal(diverted.reason,'UNSAFE_PATH');
  assert.deepEqual(await readdir(foreign),[],
   'a malicious parent must be rejected BEFORE mkdir can touch its target');
  assert.deepEqual(await readFile(selected),Buffer.from(header+'document.querySelector("#safe");'));

  const absent=join(home,'missing-app-userdata');
  const missing=await runCheckpointedNativeImportAnalysis(join(absent,'readonly-import-journals'),data);
  assert.equal(missing.status,'BLOCKED');
  if(missing.status==='BLOCKED')assert.equal(missing.reason,'UNSAFE_PATH');
  assert.equal((await readdir(home)).includes('missing-app-userdata'),false,
   'the import scheduler is not permitted to recursively construct userData');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-013/TEST-022: cancellation during resumed AST display analysis cannot return a checkpointed success',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-resumed-cancel-'));
 try{
  const file=join(home,'selected.user.js');
  const script=header+'document.querySelector("#source-retained");';
  await writeFile(file,script);
  const selected=(await importApprovedPaths([file])).scripts;
  assert.equal(selected.length,1);
  const root=join(home,'userdata','read-only');
  await mkdir(join(home,'userdata'));
  const first=await runCheckpointedNativeImportAnalysis(root,selected);
  assert.equal(first.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
  const journal=join(root,(await readdir(root))[0],BATCH_JOURNAL_FILENAME);
  const checkpointBefore=await readFile(journal);
  const isolated=require('../../src/analyze/isolated-batch-preview') as
   typeof import('../../src/analyze/isolated-batch-preview');
  const native=isolated.previewImportedBatchOffMain;
  const controller=new AbortController();
  const progress:Array<[number,number]>=[];
  let injected=0;
  const patched=mock.method(isolated,'previewImportedBatchOffMain',
   async(...args:Parameters<typeof native>)=>{
    const reports=await native(...args);
    injected++;
    controller.abort();
    return reports;
   });
  try{
   const result=await runCheckpointedNativeImportAnalysis(root,selected,
    controller.signal,(processed,total)=>progress.push([processed,total]));
   assert.equal(injected,1,'abort must happen during resumed display-only AST');
   assert.equal(controller.signal.aborted,true);
   assert.equal(result.status,'BLOCKED',
    'a stale completed scheduling hint must never override active cancellation');
   if(result.status==='BLOCKED'){
    assert.equal(result.reason,'CANCELLED');
    assert.deepEqual(result.previews.map(p=>p.status),['SKIPPED_CANCELLED']);
   }
   assert.deepEqual(progress,[],'cancelled display must not signal finished progress');
  }finally{patched.mock.restore();}
  assert.deepEqual(await readFile(file),Buffer.from(script),
   'never modify selected userscript bytes');
  assert.deepEqual(await readFile(journal),checkpointBefore,
   'late display cancellation must not rewrite previous durable scheduling');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-013/TEST-022: resumed AST worker fault stays isolated and other segments retain verified static previews',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-resumed-worker-failure-'));
 try{
  const files:string[]=[];
  for(let i=0;i<17;i++){
   const path=join(home,'selected-'+i+'.user.js');
   await writeFile(path,header+'document.querySelector("#isolated-'+i+'");');
   files.push(path);
  }
  const scripts=(await importApprovedPaths(files)).scripts;
  assert.equal(scripts.length,17);
  const root=join(home,'userdata','readonly-journals');
  await mkdir(join(home,'userdata'));
  const first=await runCheckpointedNativeImportAnalysis(root,scripts);
  assert.equal(first.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
  if(first.status!=='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED')return;
  assert.equal(first.previews.every(row=>row.status==='STATIC_ANALYSIS_ONLY'),true);
  const directory=join(root,(await readdir(root))[0]);
  const journal=join(directory,BATCH_JOURNAL_FILENAME);
  const saved=await readFile(journal);

  // A previously persisted SUCCEEDED hint is NOT fresh AST evidence.
  // Inject a Worker-level exception only in the first resumed segment.
  // The next independent segment must still yield real preview evidence.
  const isolated=require('../../src/analyze/isolated-batch-preview') as
   typeof import('../../src/analyze/isolated-batch-preview');
  const actual=isolated.previewImportedBatchOffMain;
  let calls=0;
  const patch=mock.method(isolated,'previewImportedBatchOffMain',
   async(...args:Parameters<typeof actual>)=>{
    calls++;
    if(calls===1)throw Error('INJECTED_RESUMED_AST_WORKER_FAILURE');
    return actual(...args);
   });
  const progress:Array<[number,number]>=[];
  try{
   const resumed=await runCheckpointedNativeImportAnalysis(root,scripts,
    undefined,(processed,total)=>progress.push([processed,total]));
   assert.equal(resumed.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
   if(resumed.status==='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED'){
    assert.equal(resumed.resumed,true);
    assert.deepEqual(resumed.previews.slice(0,16).map(row=>row.status),
     Array(16).fill('ISOLATED_ANALYSIS_FAILED'));
    assert.equal(resumed.previews[16].status,'STATIC_ANALYSIS_ONLY',
     'an independent segment must not be lost to a prior Worker failure');
    assert.equal(resumed.previews.every(row=>row.automaticPatchAllowed===false&&
     row.tampermonkeyVerified===false&&row.businessVerified===false),true);
   }
   assert.equal(calls,2,'every resumed segment independently re-runs AST');
   assert.deepEqual(progress,[[16,17],[17,17]]);
  }finally{patch.mock.restore();}
  assert.deepEqual(await readFile(journal),saved,
   'resumed display-only faults must not rewrite durable scheduling history');
  for(let i=0;i<17;i++){
   assert.equal((await readFile(files[i],'utf8')).includes('#isolated-'+i),true,
    'Worker failures must not alter imported userscripts');
  }
 }finally{await rm(home,{recursive:true,force:true});}
});
