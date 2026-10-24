import {test} from 'node:test';
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
