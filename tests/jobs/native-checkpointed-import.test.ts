import {test,mock} from 'node:test';
import {createHash} from 'node:crypto';
import {strict as assert} from 'node:assert';
import {mkdtemp,mkdir,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {importApprovedPaths} from '../../src/import/import-service';
import {runCheckpointedNativeImportAnalysis} from '../../src/jobs/native-checkpointed-import';
import {BATCH_JOURNAL_FILENAME} from '../../src/jobs/batch-journal';
import {unavailableImportPreview} from '../../src/analyze/import-preview';

test('TASK-013/TEST-022/026: checkpointed native import must reject an array Proxy without reading properties',async()=>{
 let traps=0;
 const hostile=new Proxy([] as unknown as Parameters<
  typeof runCheckpointedNativeImportAnalysis>[1],{
  get(){traps++;throw Error('UNTRUSTED_BATCH_LENGTH');},
  getPrototypeOf(){traps++;throw Error('UNTRUSTED_BATCH_PROTOTYPE');},
  ownKeys(){traps++;throw Error('UNTRUSTED_BATCH_KEYS');}
 });
 const revoked=Proxy.revocable([] as unknown as Parameters<
  typeof runCheckpointedNativeImportAnalysis>[1],{});
 for(const supplied of [hostile,revoked.proxy]){
  const result=await runCheckpointedNativeImportAnalysis(
   join(tmpdir(),'uncreated-checkpointed-batch-proxy-root'),supplied);
  assert.deepEqual(result,{status:'BLOCKED',reason:'INVALID_INPUT',previews:[]},
   'a forged native batch must fail closed before reading its length or writing a journal');
 }
 revoked.revoke();
 const afterRevocation=await runCheckpointedNativeImportAnalysis(
  join(tmpdir(),'uncreated-checkpointed-batch-proxy-root'),revoked.proxy);
 assert.deepEqual(afterRevocation,{status:'BLOCKED',reason:'INVALID_INPUT',previews:[]});
 assert.equal(traps,0,'even an active Proxy must not trigger caller traps');
});

const header='// ==UserScript==\n// @name native-batch\n// @match https://example.org/*\n// ==/UserScript==\n';
test('TASK-013/TEST-022/026: forged native cancellation never executes getters or creates a journal',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-signal-boundary-'));
 try{
  const file=join(home,'approved.user.js');
  const source=header+'document.querySelector("#approved");';
  await writeFile(file,source);
  const scripts=(await importApprovedPaths([file])).scripts;
  assert.equal(scripts.length,1);
  const root=join(home,'nonexistent-userdata','readonly-journals');
  let calls=0;
  const forged={get aborted(){calls++;return true;}} as unknown as AbortSignal;
  const proxied=new Proxy(new AbortController().signal,{
   get(){calls++;throw Error('UNTRUSTED_ABORT_GETTER');},
   getPrototypeOf(){calls++;throw Error('UNTRUSTED_ABORT_PROTOTYPE');}
  });
  const revoked=Proxy.revocable(new AbortController().signal,{});
  revoked.revoke();
  const spoof=Object.create(AbortSignal.prototype) as AbortSignal;
  for(const signal of [forged,proxied,revoked.proxy,spoof]){
   const result=await runCheckpointedNativeImportAnalysis(root,scripts,signal);
   assert.equal(result.status,'BLOCKED');
   if(result.status==='BLOCKED')assert.equal(result.reason,'INVALID_INPUT');
  }
  assert.equal(calls,0,'native cancellation must be validated before caller hooks');
  assert.equal((await readdir(home)).includes('nonexistent-userdata'),false);
  assert.equal((await readFile(file)).toString(),source);
 }finally{await rm(home,{recursive:true,force:true});}
});

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


test('TASK-013/TEST-022: native AST progress is visible after a durable segment before later workers finish',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-live-progress-'));
 const isolated=require('../../src/analyze/isolated-batch-preview') as
  typeof import('../../src/analyze/isolated-batch-preview');
 const native=isolated.previewImportedBatchOffMain;
 let releaseSecond!:()=>void;
 const waitForRelease=new Promise<void>(resolve=>{releaseSecond=resolve;});
 let secondStarted!:()=>void;
 const secondEntered=new Promise<void>(resolve=>{secondStarted=resolve;});
 let running:ReturnType<typeof runCheckpointedNativeImportAnalysis>|undefined;
 let calls=0;
 const patched=mock.method(isolated,'previewImportedBatchOffMain',
  async(...args:Parameters<typeof native>)=>{
   calls++;
   // The scheduler must publish the first 16 real scripts as complete
   // only AFTER its corresponding terminal state has been saved.
   if(args[0].length===1){secondStarted();await waitForRelease;}
   return native(...args);
  });
 try{
  const files:string[]=[];
  for(let i=0;i<17;i++){
   const file=join(home,'batch-'+i+'.user.js');
   await writeFile(file,header+'document.querySelector("#batch-'+i+'");');
   files.push(file);
  }
  const scripts=(await importApprovedPaths(files)).scripts;
  assert.equal(scripts.length,17);
  const root=join(home,'userdata','readonly-journals');
  await mkdir(join(home,'userdata'));
  const progress:Array<[number,number]>=[];
  running=runCheckpointedNativeImportAnalysis(root,scripts,undefined,
   (done,total)=>progress.push([done,total]));
  await secondEntered;
  const folder=(await readdir(root))[0];
  const journal=JSON.parse(await readFile(join(root,folder,BATCH_JOURNAL_FILENAME),'utf8'));
  assert.equal(journal.jobs[0].state,'SUCCEEDED');
  assert.equal(journal.jobs[1].state,'RUNNING');
  assert.deepEqual(progress,[[16,17]],
   'a durable completed segment must reach native UI before the next Worker finishes');
  releaseSecond();
  const final=await running;
  assert.equal(final.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
  assert.deepEqual(progress,[[16,17],[17,17]],
   'durable scheduling updates and final display must not duplicate progress');
  assert.equal(calls,2);
 }finally{
  releaseSecond();
  if(running)await running;
  patched.mock.restore();
  await rm(home,{recursive:true,force:true});
 }
});

test('TASK-013/TEST-022: cancelling later AST segment retains only earlier durable static previews',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-partial-cancel-'));
 const isolated=require('../../src/analyze/isolated-batch-preview') as
  typeof import('../../src/analyze/isolated-batch-preview');
 const actual=isolated.previewImportedBatchOffMain;
 const controller=new AbortController();
 let calls=0;
 const patched=mock.method(isolated,'previewImportedBatchOffMain',
  async(...args:Parameters<typeof actual>)=>{
   calls++;
   if(calls===2)controller.abort();
   return actual(...args);
  });
 try{
  const filenames:string[]=[];
  for(let i=0;i<17;i++){
   const path=join(home,'selected-'+i+'.user.js');
   await writeFile(path,header+'document.querySelector("#partial-'+i+'");');
   filenames.push(path);
  }
  const scripts=(await importApprovedPaths(filenames)).scripts;
  assert.equal(scripts.length,17);
  const root=join(home,'userdata','readonly-journals');
  await mkdir(join(home,'userdata'));
  const progress:Array<[number,number]>=[];
  const outcome=await runCheckpointedNativeImportAnalysis(root,scripts,
   controller.signal,(done,total)=>progress.push([done,total]));
  assert.equal(calls,2,'must cancel during the second independent Worker');
  assert.equal(controller.signal.aborted,true);
  assert.equal(outcome.status,'BLOCKED','cancellation never acknowledges batch success');
  if(outcome.status!=='BLOCKED')return;
  assert.equal(outcome.reason,'CANCELLED');
  assert.equal(outcome.previews.length,17);
  assert.deepEqual(outcome.previews.slice(0,16).map(p=>p.status),
   Array(16).fill('STATIC_ANALYSIS_ONLY'),
   'an independently saved successful segment must retain its read-only evidence');
  assert.equal(outcome.previews[16].status,'SKIPPED_CANCELLED',
   'an unfinished segment must never be presented as successful analysis');
  assert.equal(outcome.previews.every(p=>p.automaticPatchAllowed===false&&
   p.tampermonkeyVerified===false&&p.businessVerified===false),true);
  assert.deepEqual(progress,[[16,17]],
   'only durably settled work may count as completed progress');
  const directory=join(root,(await readdir(root))[0]);
  const disk=JSON.parse(await readFile(join(directory,BATCH_JOURNAL_FILENAME),'utf8'));
  assert.deepEqual(disk.jobs.map((x:{state:string})=>x.state),
   ['SUCCEEDED','CANCELLED']);
  for(let i=0;i<17;i++)
   assert.equal((await readFile(filenames[i],'utf8')).includes('#partial-'+i),true,
    'cancellation must never modify user-selected script bytes');
 }finally{
  patched.mock.restore();
  await rm(home,{recursive:true,force:true});
 }
});

test('TASK-013/TEST-022: identical bytes under different approved text encodings use separate durable batches',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-encoding-identity-'));
 try{
  const file=join(home,'encoded.user.js');
  await writeFile(file,header+'document.querySelector("#same-bytes");');
  const imported=(await importApprovedPaths([file])).scripts;
  assert.equal(imported.length,1);
  assert.equal(imported[0].textEncoding,'utf-8');
  const root=join(home,'userdata','readonly-journals');
  await mkdir(join(home,'userdata'));
  const first=await runCheckpointedNativeImportAnalysis(root,imported);
  assert.equal(first.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
  if(first.status!=='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED')return;
  assert.equal(first.resumed,false);
  const originalDirectory=(await readdir(root))[0];
  const originalJournal=await readFile(join(root,originalDirectory,BATCH_JOURNAL_FILENAME));
  // Explicitly approved alternate decoder policy leaves raw bytes/SHA intact,
  // but changes the semantics of the isolated AST parse and its retry budget.
  // One encoding's SUCCEEDED/FAILED hints must not be replayed for another.
  const alternate=imported.map(script=>({...script,textEncoding:'gb18030-explicit' as const}));
  assert.equal(alternate[0].sha256,imported[0].sha256);
  const second=await runCheckpointedNativeImportAnalysis(root,alternate);
  assert.equal(second.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
  if(second.status!=='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED')return;
  assert.equal(second.resumed,false,
   'same script bytes decoded with another encoding must start its own durable batch');
  assert.equal((await readdir(root)).length,2);
  assert.deepEqual(await readFile(join(root,originalDirectory,BATCH_JOURNAL_FILENAME)),
   originalJournal,'changing the decoder must not rewrite earlier durable evidence');
  const repeat=await runCheckpointedNativeImportAnalysis(root,alternate);
  assert.equal(repeat.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
  if(repeat.status==='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED')
   assert.equal(repeat.resumed,true,'the same byte and encoding identity may resume');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-013/TEST-022: transient isolated AST worker failure is retried once and durably settles',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-ast-retry-'));
 try{
  const sourcePath=join(home,'review.user.js');
  const original=header+'document.querySelector("#retry");';
  await writeFile(sourcePath,original);
  const scripts=(await importApprovedPaths([sourcePath])).scripts;
  const root=join(home,'userdata','readonly-journals');
  await mkdir(join(home,'userdata'));
  const isolated=require('../../src/analyze/isolated-batch-preview') as
   typeof import('../../src/analyze/isolated-batch-preview');
  const real=isolated.previewImportedBatchOffMain;
  let calls=0;
  const changed=mock.method(isolated,'previewImportedBatchOffMain',
   async(...args:Parameters<typeof real>)=>{
    if(++calls===1)return [
     unavailableImportPreview('ISOLATED_ANALYSIS_FAILED','NOT_CHECKED')];
    return real(...args);
   });
  try{
   const outcome=await runCheckpointedNativeImportAnalysis(root,scripts);
   assert.equal(calls,2,'one isolated worker crash deserves one bounded retry');
   assert.equal(outcome.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
   if(outcome.status==='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED'){
    assert.equal(outcome.resumed,false);
    assert.deepEqual(outcome.previews.map(p=>p.status),['STATIC_ANALYSIS_ONLY']);
    assert.equal(outcome.previews[0].automaticPatchAllowed,false);
    assert.equal(outcome.previews[0].tampermonkeyVerified,false);
    assert.equal(outcome.previews[0].businessVerified,false);
   }
   const journal=join(root,(await readdir(root))[0],BATCH_JOURNAL_FILENAME);
   const stored=JSON.parse(await readFile(journal,'utf8'));
   assert.deepEqual(stored.jobs.map((j:{state:string;attempts:number})=>
    [j.state,j.attempts]),[['SUCCEEDED',2]]);
   assert.equal(stored.maxAttempts,2,'retry budget must be bound to saved policy');
  }finally{changed.mock.restore();}
  assert.equal(await readFile(sourcePath,'utf8'),original);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-013/TEST-022: repeated AST worker crashes exhaust retry budget without replay on restart',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-ast-retry-limit-'));
 try{
  const sourcePath=join(home,'review.user.js');
  const original=header+'document.querySelector("#bounded");';
  await writeFile(sourcePath,original);
  const scripts=(await importApprovedPaths([sourcePath])).scripts;
  const root=join(home,'userdata','readonly-journals');
  await mkdir(join(home,'userdata'));
  const isolated=require('../../src/analyze/isolated-batch-preview') as
   typeof import('../../src/analyze/isolated-batch-preview');
  let calls=0;
  const injected=mock.method(isolated,'previewImportedBatchOffMain',async()=>{
   calls++;
   return [unavailableImportPreview('ISOLATED_ANALYSIS_FAILED','NOT_CHECKED')];
  });
  try{
   const first=await runCheckpointedNativeImportAnalysis(root,scripts);
   assert.equal(first.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
   assert.equal(calls,2,'must stop after exactly two failed attempts');
   if(first.status==='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED')
    assert.deepEqual(first.previews.map(p=>p.status),['ISOLATED_ANALYSIS_FAILED']);
   const journal=join(root,(await readdir(root))[0],BATCH_JOURNAL_FILENAME);
   const stored=JSON.parse(await readFile(journal,'utf8'));
   assert.deepEqual(stored.jobs.map((j:{state:string;attempts:number})=>
    [j.state,j.attempts]),[['FAILED',2]]);
   const again=await runCheckpointedNativeImportAnalysis(root,scripts);
   assert.equal(again.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
   if(again.status==='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED')
    assert.equal(again.resumed,true);
   assert.equal(calls,2,'persisted terminal failure must not endlessly retry');
  }finally{injected.mock.restore();}
  assert.equal(await readFile(sourcePath,'utf8'),original);
 }finally{await rm(home,{recursive:true,force:true});}
});


test('TASK-013/TEST-022/026: new retry policy preserves old v1 checkpoint evidence untouched',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-ast-v1-migration-'));
 try{
  const sourcePath=join(home,'review.user.js');
  const original=header+'document.querySelector("#legacy");';
  await writeFile(sourcePath,original);
  const scripts=(await importApprovedPaths([sourcePath])).scripts;
  assert.equal(scripts.length,1);
  const root=join(home,'userdata','readonly-journals');
  await mkdir(join(home,'userdata'));
  await mkdir(root);
  const oldBatchHash=createHash('sha256')
   .update('uah-native-import-batch-v1\0')
   .update(scripts[0].sha256).digest('hex');
  const oldDir=join(root,'batch-'+oldBatchHash);
  await mkdir(oldDir);
  const oldFile=join(oldDir,BATCH_JOURNAL_FILENAME);
  const legacy=Buffer.from('{"legacy":"untouched-v1-checkpoint"}');
  await writeFile(oldFile,legacy);
  const outcome=await runCheckpointedNativeImportAnalysis(root,scripts);
  assert.equal(outcome.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
  assert.deepEqual(await readFile(oldFile),legacy,
   'do not delete or rewrite a prior maxAttempts=1 journal');
  const all=await readdir(root);
  assert.equal(all.length,2,'new attempt policy uses a separate batch namespace');
  assert.equal(all.includes('batch-'+oldBatchHash),true);
  const current=join(root,all.find(n=>n!=='batch-'+oldBatchHash)!,
   BATCH_JOURNAL_FILENAME);
  const checkpoint=JSON.parse(await readFile(current,'utf8'));
  assert.equal(checkpoint.maxAttempts,2);
  assert.equal(await readFile(sourcePath,'utf8'),original);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-013/TEST-022: rejected isolated AST worker restarts only once',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-ast-reject-'));
 try{
  const sourcePath=join(home,'review.user.js');
  const original=header+'document.querySelector("#rejected");';
  await writeFile(sourcePath,original);
  const scripts=(await importApprovedPaths([sourcePath])).scripts;
  const root=join(home,'userdata','readonly-journals');
  await mkdir(join(home,'userdata'));
  const isolated=require('../../src/analyze/isolated-batch-preview') as
   typeof import('../../src/analyze/isolated-batch-preview');
  const actual=isolated.previewImportedBatchOffMain;
  let calls=0;
  const patched=mock.method(isolated,'previewImportedBatchOffMain',
   async(...args:Parameters<typeof actual>)=>{
    if(++calls===1)throw Error('INJECTED_ISOLATED_AST_CRASH');
    return actual(...args);
   });
  try{
   const outcome=await runCheckpointedNativeImportAnalysis(root,scripts);
   assert.equal(calls,2);
   assert.equal(outcome.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
   if(outcome.status==='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED')
    assert.deepEqual(outcome.previews.map(p=>p.status),['STATIC_ANALYSIS_ONLY']);
  }finally{patched.mock.restore();}
  assert.equal(await readFile(sourcePath,'utf8'),original);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-013/TEST-022: permanent preview budget failure is not retried as a transient crash',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-ast-permanent-'));
 try{
  const sourcePath=join(home,'review.user.js');
  await writeFile(sourcePath,header+'document.querySelector("#budget");');
  const scripts=(await importApprovedPaths([sourcePath])).scripts;
  const root=join(home,'userdata','readonly-journals');
  await mkdir(join(home,'userdata'));
  const isolated=require('../../src/analyze/isolated-batch-preview') as
   typeof import('../../src/analyze/isolated-batch-preview');
  let calls=0;
  const injected=mock.method(isolated,'previewImportedBatchOffMain',async()=>{
   calls++;
   return [unavailableImportPreview('SKIPPED_BATCH_BUDGET','NOT_CHECKED')];
  });
  try{
   await runCheckpointedNativeImportAnalysis(root,scripts);
   assert.equal(calls,1);
   const journal=join(root,(await readdir(root))[0],BATCH_JOURNAL_FILENAME);
   const stored=JSON.parse(await readFile(journal,'utf8'));
   assert.deepEqual(stored.jobs.map((j:{state:string;attempts:number})=>
    [j.state,j.attempts]),[['FAILED',1]]);
  }finally{injected.mock.restore();}
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
    if(calls<=2)throw Error('INJECTED_RESUMED_AST_WORKER_FAILURE');
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
   assert.equal(calls,3,'failed resumed segment retries once; next segment still runs AST');
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

test('TASK-013/TEST-022/026: truncated resumed AST display cannot silently omit imported scripts',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-resumed-truncated-preview-'));
 try{
  const paths:string[]=[];
  for(let i=0;i<17;i++){
   const path=join(home,'segment-'+i+'.user.js');
   await writeFile(path,header+'document.querySelector("#segment-'+i+'");');
   paths.push(path);
  }
  const scripts=(await importApprovedPaths(paths)).scripts;
  assert.equal(scripts.length,17);
  const root=join(home,'userdata','readonly-journals');
  await mkdir(join(home,'userdata'));
  const initial=await runCheckpointedNativeImportAnalysis(root,scripts);
  assert.equal(initial.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
  const journal=join(root,(await readdir(root))[0],BATCH_JOURNAL_FILENAME);
  const before=await readFile(journal);
  const isolated=require('../../src/analyze/isolated-batch-preview') as
   typeof import('../../src/analyze/isolated-batch-preview');
  const real=isolated.previewImportedBatchOffMain;
  let calls=0;
  const patch=mock.method(isolated,'previewImportedBatchOffMain',
   async(...args:Parameters<typeof real>)=>{
    if(++calls<=2)return [] as Awaited<ReturnType<typeof real>>;
    return real(...args);
   });
  try{
   const progress:Array<[number,number]>=[];
   const resumed=await runCheckpointedNativeImportAnalysis(root,scripts,
    undefined,(done,total)=>progress.push([done,total]));
   assert.equal(resumed.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
   if(resumed.status==='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED'){
    assert.equal(resumed.resumed,true);
    assert.equal(resumed.previews.length,17,'every selected file needs a display receipt');
    assert.deepEqual(resumed.previews.slice(0,16).map(row=>row.status),
     Array(16).fill('ISOLATED_ANALYSIS_FAILED'),
     'truncated fresh Worker output must fail closed for its whole segment');
    assert.equal(resumed.previews[16].status,'STATIC_ANALYSIS_ONLY',
     'a failed segment must not discard another independently valid one');
    assert.equal(resumed.previews.every(row=>
     !row.automaticPatchAllowed&&!row.tampermonkeyVerified&&!row.businessVerified),true);
   }
   assert.equal(calls,3,'truncated segment retries once; next segment independently runs');
   assert.deepEqual(progress,[[16,17],[17,17]]);
  }finally{patch.mock.restore();}
  assert.deepEqual(await readFile(journal),before,
   'display-only recovery must leave persisted scheduling evidence untouched');
  for(let i=0;i<paths.length;i++)
   assert.equal((await readFile(paths[i],'utf8')).includes('#segment-'+i),true);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-013/TEST-022: resumed read-only AST display retries one transient Worker crash without rewriting the checkpoint',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-resumed-display-retry-'));
 try{
  const file=join(home,'review.user.js');
  const source=header+'document.querySelector("#resumed-static");';
  await writeFile(file,source);
  const scripts=(await importApprovedPaths([file])).scripts;
  const root=join(home,'userdata','readonly-journals');
  await mkdir(join(home,'userdata'));
  const initial=await runCheckpointedNativeImportAnalysis(root,scripts);
  assert.equal(initial.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
  const journal=join(root,(await readdir(root))[0],BATCH_JOURNAL_FILENAME);
  const before=await readFile(journal);
  const isolated=require('../../src/analyze/isolated-batch-preview') as
   typeof import('../../src/analyze/isolated-batch-preview');
  const real=isolated.previewImportedBatchOffMain;
  let calls=0;
  const injected=mock.method(isolated,'previewImportedBatchOffMain',
   async(...args:Parameters<typeof real>)=>{
    if(++calls===1)throw Error('TRANSIENT_RESUMED_DISPLAY_WORKER_CRASH');
    return real(...args);
   });
  try{
   const resumed=await runCheckpointedNativeImportAnalysis(root,scripts);
   assert.equal(resumed.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
   if(resumed.status==='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED'){
    assert.equal(resumed.resumed,true);
    assert.deepEqual(resumed.previews.map(p=>p.status),['STATIC_ANALYSIS_ONLY'],
     'a transient crashed display worker must not permanently discard safe static evidence');
    assert.equal(resumed.previews[0].automaticPatchAllowed,false);
    assert.equal(resumed.previews[0].tampermonkeyVerified,false);
    assert.equal(resumed.previews[0].businessVerified,false);
   }
   assert.equal(calls,2,'allow exactly one fresh independent retry for a transient display failure');
  }finally{injected.mock.restore();}
  assert.deepEqual(await readFile(journal),before,
   'display-only replay must not modify a previously persisted scheduler journal');
  assert.equal(await readFile(file,'utf8'),source);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-013/TEST-022: resumed AST display never retries a permanent worker budget result',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-resumed-budget-'));
 try{
  const file=join(home,'budget.user.js');
  const script=header+'document.querySelector("#bounded-display");';
  await writeFile(file,script);
  const imported=(await importApprovedPaths([file])).scripts;
  const root=join(home,'userdata','readonly-journals');
  await mkdir(join(home,'userdata'));
  const initial=await runCheckpointedNativeImportAnalysis(root,imported);
  assert.equal(initial.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
  const journal=join(root,(await readdir(root))[0],BATCH_JOURNAL_FILENAME);
  const before=await readFile(journal);
  const isolated=require('../../src/analyze/isolated-batch-preview') as
   typeof import('../../src/analyze/isolated-batch-preview');
  let calls=0;
  const patch=mock.method(isolated,'previewImportedBatchOffMain',async()=>{
   calls++;
   return [unavailableImportPreview('SKIPPED_BATCH_BUDGET','NOT_CHECKED')];
  });
  try{
   const resumed=await runCheckpointedNativeImportAnalysis(root,imported);
   assert.equal(resumed.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
   if(resumed.status==='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED'){
    assert.equal(resumed.resumed,true);
    assert.deepEqual(resumed.previews.map(p=>p.status),['ISOLATED_ANALYSIS_FAILED']);
    assert.equal(resumed.previews[0].automaticPatchAllowed,false);
   }
   assert.equal(calls,1,'a budget failure must NOT receive a second worker attempt');
  }finally{patch.mock.restore();}
  assert.deepEqual(await readFile(journal),before);
  assert.equal(await readFile(file,'utf8'),script);
 }finally{await rm(home,{recursive:true,force:true});}
});
