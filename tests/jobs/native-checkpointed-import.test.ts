import {test,mock} from 'node:test';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {strict as assert} from 'node:assert';
import {mkdtemp,mkdir,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DroppedImportBatch,importApprovedPaths,type ImportOutcome} from '../../src/import/import-service';
import * as checkpointedImportModule from '../../src/jobs/native-checkpointed-import';
import {runCheckpointedNativeImportAnalysis} from '../../src/jobs/native-checkpointed-import';
import {BATCH_JOURNAL_FILENAME,saveReadOnlyBatchJournal} from '../../src/jobs/batch-journal';
import {ReadOnlyBatchCoordinator} from '../../src/jobs/batch-coordinator';
import {previewImportedScriptAnalysis,unavailableImportPreview} from '../../src/analyze/import-preview';
import {runImportedReadOnlyAnalysisQueue} from '../../src/jobs/imported-analysis-queue';

function runNodeTestChild(args:string[],extraEnv:NodeJS.ProcessEnv={}):string{
 const childEnv:NodeJS.ProcessEnv={...process.env,...extraEnv};
 // Node uses this variable to tell a child that it is already under the test
 // runner. Remove it when deliberately starting a separate child test runner.
 delete childEnv.NODE_TEST_CONTEXT;
 return execFileSync(process.execPath,args,{encoding:'utf8',env:childEnv});
}

test('TASK-013/TEST-022: nested node test runner executes its selected test body',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-nested-node-test-'));
 try{
  const childFile=join(home,'nested-runner.test.cjs');
  await writeFile(childFile,
   "const {test}=require('node:test');test('child sentinel',()=>console.log('UAH_CHILD_TEST_BODY_EXECUTED'));\n");
  const output=runNodeTestChild(['--test','--test-reporter=tap',childFile]);
  assert.match(output,/UAH_CHILD_TEST_BODY_EXECUTED/);
  assert.match(output,/(?:^|\r?\n)# tests 1(?:\r?\n|$)/);
  assert.match(output,/(?:^|\r?\n)# pass 1(?:\r?\n|$)/);
 }finally{await rm(home,{recursive:true,force:true});}
});

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

test('TASK-013/TEST-022/026: renderer-dropped outcomes use the shared checkpoint and fresh AST on reimport',async()=>{
 type CheckpointedOutcome=Awaited<ReturnType<typeof runCheckpointedNativeImportAnalysis>>;
 type Analyzer=(journalRoot:string,outcome:ImportOutcome,signal?:AbortSignal,
  onProgress?:(processed:number,total:number)=>void)=>Promise<{
   checkpoint:CheckpointedOutcome|null;canceled:boolean;unprocessed:number
  }>;
 const candidate=(checkpointedImportModule as unknown as Record<string,unknown>)
  .analyzeImportedOutcomeWithCheckpoint;
 assert.equal(typeof candidate,'function',
  'all validated import outcomes need one main-process checkpointed AST entrypoint');
 if(typeof candidate!=='function')return;
 const analyze=candidate as Analyzer;
 const home=await mkdtemp(join(tmpdir(),'uah-dropped-checkpoint-entry-'));
 try{
  const userData=join(home,'userdata');
  await mkdir(userData);
  const journalRoot=join(userData,'readonly-import-journals');
  const makeOutcome=(names:readonly string[],revision='v1')=>{
   const batch=new DroppedImportBatch();
   for(const name of names){
    const source=header+'document.querySelector("#'+name+'-'+revision+'");\n';
    const added=batch.add(name+'.user.js',Buffer.from(source));
    assert.equal(added.ok,true);
   }
   const finished=batch.finish();
   assert.ok(finished);
   return finished!;
  };
  const firstOutcome=makeOutcome(['alpha','beta']);
  assert.equal(firstOutcome.scripts.every(script=>'sourcePath' in script),false,
   'renderer bytes must remain path-free while entering the shared pipeline');

  let workerStarts=0;
  const isolated=require('../../src/analyze/isolated-batch-preview') as
   typeof import('../../src/analyze/isolated-batch-preview');
  const runWorker=isolated.previewImportedBatchOffMain;
  const workerSpy=mock.method(isolated,'previewImportedBatchOffMain',(...args:Parameters<typeof runWorker>)=>{
   workerStarts++;
   return runWorker(...args);
  });
  try{
   const first=await analyze(journalRoot,firstOutcome);
   assert.equal(first.checkpoint?.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
   assert.equal(first.checkpoint?.resumed,false);
   assert.deepEqual(first.checkpoint?.previews.map(row=>row.status),
    ['STATIC_ANALYSIS_ONLY','STATIC_ANALYSIS_ONLY']);
   const firstDispatches=workerStarts;
   assert.ok(firstDispatches>0,'the fresh dropped batch must run the real isolated AST worker');

   const second=await analyze(journalRoot,firstOutcome);
   assert.equal(second.checkpoint?.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
   assert.equal(second.checkpoint?.resumed,true,
    'same ordered byte identities should find only the matching scheduling hint');
   assert.deepEqual(second.checkpoint?.previews.map(row=>row.status),
    ['STATIC_ANALYSIS_ONLY','STATIC_ANALYSIS_ONLY']);
   assert.ok(workerStarts>firstDispatches,
    'a resumed scheduling hint must still rerun the AST worker on newly imported bytes');

   const reordered=await analyze(journalRoot,makeOutcome(['beta','alpha']));
   assert.equal(reordered.checkpoint?.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
   assert.equal(reordered.checkpoint?.resumed,false,
    'reordering scripts must not reuse the prior batch identity');
   const changed=await analyze(journalRoot,makeOutcome(['alpha','beta'],'v2'));
   assert.equal(changed.checkpoint?.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
   assert.equal(changed.checkpoint?.resumed,false,
    'changed script bytes must create a separate scheduling identity');

   const journalDirectories=await readdir(journalRoot);
   assert.equal(journalDirectories.length,3);
   for(const directory of journalDirectories){
    const journal=await readFile(join(journalRoot,directory,BATCH_JOURNAL_FILENAME),'utf8');
    assert.equal(journal.includes('alpha.user.js'),false);
    assert.equal(journal.includes('https://example.org'),false);
    assert.equal(journal.includes('document.querySelector'),false);
   }
  }finally{workerSpy.mock.restore();}

  const cancelledController=new AbortController();
  cancelledController.abort();
  const cancelled=await analyze(journalRoot,makeOutcome(['cancelled']),
   cancelledController.signal);
  assert.equal(cancelled.checkpoint?.status,'BLOCKED');
  assert.equal(cancelled.checkpoint?.reason,'CANCELLED');
  assert.equal(cancelled.canceled,true);
  assert.equal(cancelled.unprocessed,0);
  assert.deepEqual(cancelled.checkpoint?.previews.map(row=>row.status),
   ['SKIPPED_CANCELLED']);
  assert.equal((await readdir(journalRoot)).length,3,
   'a pre-cancelled imported batch must not write a new checkpoint');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-013/TEST-022/026: cancellation during early per-file recovery preserves later completed segment evidence',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-recovery-later-segment-'));
 const isolated=require('../../src/analyze/isolated-batch-preview') as
  typeof import('../../src/analyze/isolated-batch-preview');
 const actual=isolated.previewImportedBatchOffMain;
 const controller=new AbortController();
 let recoveryStarted!:()=>void;
 const started=new Promise<void>(resolve=>{recoveryStarted=resolve;});
 let finishRecovery!:()=>void;
 const heldRecovery=new Promise<void>(resolve=>{finishRecovery=resolve;});
 let firstSegmentAttempts=0;
 let lastScriptDigest='';
 let pending:ReturnType<typeof runCheckpointedNativeImportAnalysis>|undefined;
 const patch=mock.method(isolated,'previewImportedBatchOffMain',
  async(...args:Parameters<typeof actual>)=>{
   const selected=args[0];
   if(selected.length===16){
    firstSegmentAttempts++;
    return {previews:selected.map(()=>unavailableImportPreview(
     'ISOLATED_ANALYSIS_FAILED','NOT_CHECKED')),
     safeToContinue:true} as unknown as Awaited<ReturnType<typeof actual>>;
   }
   if(selected.length===1&&createHash('sha256').update(selected[0].bytes).digest('hex')===lastScriptDigest)
    return actual(...args);
   recoveryStarted();
   await heldRecovery;
   return {previews:[unavailableImportPreview('SKIPPED_CANCELLED','NOT_CHECKED')],
    safeToContinue:true} as unknown as Awaited<ReturnType<typeof actual>>;
  });
 try{
  const paths:string[]=[];
  for(let index=0;index<17;index++){
   const path=join(home,`recovery-${index}.user.js`);
   await writeFile(path,header+`document.querySelector("#recovery-${index}");`);
   paths.push(path);
  }
  const scripts=(await importApprovedPaths(paths)).scripts;
  assert.equal(scripts.length,17);
  lastScriptDigest=createHash('sha256').update(scripts[16].bytes).digest('hex');
  const userData=join(home,'userdata');
  await mkdir(userData);
  pending=runCheckpointedNativeImportAnalysis(
   join(userData,'readonly-journals'),scripts,controller.signal);
  await started;
  controller.abort();
  finishRecovery();
  const result=await pending;
  assert.equal(firstSegmentAttempts,2);
  assert.equal(result.status,'BLOCKED');
  if(result.status==='BLOCKED'){
   assert.equal(result.reason,'CANCELLED');
   assert.equal(result.previews.length,17);
   assert.equal(result.previews.slice(0,16).every(row=>
    row.status==='SKIPPED_CANCELLED'),true);
   assert.equal(result.previews[16].status,'STATIC_ANALYSIS_ONLY',
    'a later segment already completed with fresh evidence before recovery was cancelled');
  }
 }finally{
  controller.abort();
  finishRecovery();
  await pending?.catch(()=>{});
  patch.mock.restore();
  await rm(home,{recursive:true,force:true});
 }
});

test('TASK-013/TEST-022/026: native queue rejects a malformed single preview',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-malformed-preview-'));
 try{
  const file=join(home,'malformed.user.js');
  await writeFile(file,header+'document.querySelector("#malformed");');
  const scripts=(await importApprovedPaths([file])).scripts;
  const userData=join(home,'userdata');
  await mkdir(userData);
  const isolated=require('../../src/analyze/isolated-batch-preview') as
   typeof import('../../src/analyze/isolated-batch-preview');
  const actual=isolated.previewImportedBatchOffMain;
  const patch=mock.method(isolated,'previewImportedBatchOffMain',async()=>({
   previews:[{status:'UNRECOGNIZED_PREVIEW'}],safeToContinue:true
  } as unknown as Awaited<ReturnType<typeof actual>>));
  try{
   const outcome=await runCheckpointedNativeImportAnalysis(
    join(userData,'readonly-journals'),scripts);
   assert.equal(outcome.previews.length,1);
   assert.equal(outcome.previews[0].status,'ISOLATED_ANALYSIS_FAILED');
   assert.equal(outcome.previews[0].automaticPatchAllowed,false);
   assert.equal(outcome.previews[0].tampermonkeyVerified,false);
   assert.equal(outcome.previews[0].businessVerified,false);
  }finally{patch.mock.restore();}
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-013/TEST-022/026: native synchronous adapter failure stops later segments',async()=>{
 if(isolateNativePoisoningTest(
  'native synchronous adapter failure stops later segments','native-sync-adapter'))return;
 const home=await mkdtemp(join(tmpdir(),'uah-native-sync-adapter-failure-'));
 try{
  const paths:string[]=[];
  for(let index=0;index<17;index++){
   const path=join(home,`native-sync-${index}.user.js`);
   await writeFile(path,header+`document.querySelector("#native-sync-${index}");`);
   paths.push(path);
  }
  const scripts=(await importApprovedPaths(paths)).scripts;
  const userData=join(home,'userdata');
  await mkdir(userData);
  const isolated=require('../../src/analyze/isolated-batch-preview') as
   typeof import('../../src/analyze/isolated-batch-preview');
  const actual=isolated.previewImportedBatchOffMain;
  let calls=0;
  const patch=mock.method(isolated,'previewImportedBatchOffMain',
   (...args:Parameters<typeof actual>)=>{
    calls++;
    if(calls===1)throw Error('SYNC_ADAPTER_FAILURE');
    return actual(...args);
   });
  try{
   const outcome=await runCheckpointedNativeImportAnalysis(
    join(userData,'readonly-journals'),scripts);
   assert.equal(calls,1,'an untrusted synchronous throw carries no retirement receipt');
   assert.equal(outcome.previews.length,17);
   assert.equal(outcome.previews.every(row=>
    row.status==='ISOLATED_ANALYSIS_FAILED'),true);
  }finally{patch.mock.restore();}
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-013/TEST-022/NFR-009: delayed native deadline timer prevents post-budget Worker retry',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-late-deadline-'));
 const performance=require('node:perf_hooks').performance as Performance;
 let now=0;
 const clock=mock.method(performance,'now',()=>now);
 try{
  const paths:string[]=[];
  for(let index=0;index<2;index++){
   const path=join(home,`native-late-${index}.user.js`);
   await writeFile(path,header+`document.querySelector("#native-late-${index}");`);
   paths.push(path);
  }
  const scripts=(await importApprovedPaths(paths)).scripts;
  const userData=join(home,'userdata');
  await mkdir(userData);
  const isolated=require('../../src/analyze/isolated-batch-preview') as
   typeof import('../../src/analyze/isolated-batch-preview');
  const actual=isolated.previewImportedBatchOffMain;
  let calls=0;
  const patch=mock.method(isolated,'previewImportedBatchOffMain',
   async(...args:Parameters<typeof actual>)=>{
    calls++;
    assert.equal(args[5],120000,
     'the Worker must receive the same absolute deadline as the native batch');
    now=120001; // Simulate monotonic deadline expiry before timer delivery.
    return {previews:args[0].map(()=>unavailableImportPreview(
     'ISOLATED_ANALYSIS_FAILED','NOT_CHECKED')),
     safeToContinue:true} as unknown as Awaited<ReturnType<typeof actual>>;
   });
  try{
   const outcome=await runCheckpointedNativeImportAnalysis(
    join(userData,'readonly-journals'),scripts);
   assert.equal(calls,1,'a delayed timer must not permit a retry Worker');
   assert.equal(outcome.previews.length,2);
   assert.deepEqual(outcome.previews.map(row=>row.status),[
    'SKIPPED_BATCH_BUDGET','SKIPPED_BATCH_BUDGET'
   ]);
  }finally{patch.mock.restore();}
 }finally{
  clock.mock.restore();
  await rm(home,{recursive:true,force:true});
 }
});

test('TASK-013/TEST-022/NFR-009: budget stop preserves fresh later native segment observations',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-budget-later-observation-'));
 const performance=require('node:perf_hooks').performance as Performance;
 const isolated=require('../../src/analyze/isolated-batch-preview') as
  typeof import('../../src/analyze/isolated-batch-preview');
 let deadlineClockArmed=false;
 let readsAfterArm=0;
 const clock=mock.method(performance,'now',()=>{
  if(!deadlineClockArmed)return 0;
  if(readsAfterArm++===0)return 0;
  deadlineClockArmed=false;
  return 120001;
 });
 const patch=mock.method(isolated,'previewImportedBatchOffMain',
  async(...args:Parameters<typeof isolated.previewImportedBatchOffMain>)=>({
   previews:args[0].map(previewImportedScriptAnalysis),safeToContinue:true
  } as unknown as Awaited<ReturnType<typeof isolated.previewImportedBatchOffMain>>));
 try{
  const paths:string[]=[];
  for(let index=0;index<17;index++){
   const path=join(home,`budget-observation-${index}.user.js`);
   await writeFile(path,header+`document.querySelector("#budget-observation-${index}");`);
   paths.push(path);
  }
  const scripts=(await importApprovedPaths(paths)).scripts;
  const userData=join(home,'userdata');
  await mkdir(userData);
  const result=await runCheckpointedNativeImportAnalysis(
   join(userData,'readonly-journals'),scripts,undefined,(done,total)=>{
    if(done===total){deadlineClockArmed=true;readsAfterArm=0;}
   });
  assert.equal(result.status,'BLOCKED');
  if(result.status==='BLOCKED'){
   assert.equal(result.reason,'CANCELLED');
   assert.equal(result.previews.length,17);
   assert.deepEqual(result.previews.map(row=>row.status),
    Array(17).fill('STATIC_ANALYSIS_ONLY'),
    'budget completion must retain fresh AST evidence already returned by later jobs');
  }
 }finally{
  patch.mock.restore();clock.mock.restore();
  await rm(home,{recursive:true,force:true});
 }
});

function isolateNativePoisoningTest(pattern:string,childKey:string):boolean{
 if(process.env.UAH_TASK013_NATIVE_CHILD===childKey)return false;
 const output=runNodeTestChild([
  '--test','--test-reporter=tap','--test-name-pattern',pattern,__filename
 ],{UAH_TASK013_NATIVE_CHILD:childKey});
 assert.match(output,/(?:^|\r?\n)# tests 1(?:\r?\n|$)/,
  'the isolated child process must execute exactly one selected test');
 assert.match(output,/(?:^|\r?\n)# pass 1(?:\r?\n|$)/,
  'the isolated child test must pass rather than silently skip');
 assert.match(output,/(?:^|\r?\n)# fail 0(?:\r?\n|$)/);
 const targetLine=output.split(/\r?\n/).find(line=>
  /^ok \d+ - /.test(line)&&line.includes(pattern)&&!line.includes('# SKIP'));
 assert.ok(targetLine,'the named target test itself must have an executed TAP success line');
 return true;
}

test('TASK-013/TEST-022/026: native cleanup bounds an adapter promise that ignores cancellation',async()=>{
 if(isolateNativePoisoningTest(
  'native cleanup bounds an adapter promise that ignores cancellation',
  'hung-adapter-cleanup'))return;
 const home=await mkdtemp(join(tmpdir(),'uah-native-hung-adapter-cleanup-'));
 const performance=require('node:perf_hooks').performance as Performance;
 const isolated=require('../../src/analyze/isolated-batch-preview') as
  typeof import('../../src/analyze/isolated-batch-preview');
 const controller=new AbortController();
 let now=0;
 const clock=mock.method(performance,'now',()=>now);
 let notifyCall!:()=>void;
 const called=new Promise<void>(resolve=>{notifyCall=resolve;});
 const never=new Promise<never>(()=>{});
 const patch=mock.method(isolated,'previewImportedBatchOffMain',()=>{
  controller.abort();
  now=120001;
  notifyCall();
  return never;
 });
 try{
  const selected=join(home,'hung-native.user.js');
  await writeFile(selected,header+'document.querySelector("#hung-native");');
  const scripts=(await importApprovedPaths([selected])).scripts;
  const userData=join(home,'userdata');
  await mkdir(userData);
  const pending=runCheckpointedNativeImportAnalysis(
   join(userData,'readonly-journals'),scripts,controller.signal);
  await called;
  const result=await Promise.race([pending,new Promise<'PENDING'>(resolve=>
   setTimeout(()=>resolve('PENDING'),1000))]);
  assert.notEqual(result,'PENDING','native cleanup must not hang on an unresponsive adapter');
  const outcome=result as Awaited<typeof pending>;
  assert.equal(outcome.status,'BLOCKED');
  if(outcome.status==='BLOCKED'){
   assert.equal(outcome.reason,'CANCELLED');
   assert.deepEqual(outcome.previews.map(row=>row.status),
    ['SKIPPED_CANCELLED']);
  }
 }finally{
  controller.abort();patch.mock.restore();clock.mock.restore();
  await rm(home,{recursive:true,force:true});
 }
});

test('TASK-013/TEST-022/026: unretired native coordinator timeout suppresses recovery dispatch',async()=>{
 if(isolateNativePoisoningTest(
  'unretired native coordinator timeout suppresses recovery dispatch',
  'unretired-native-no-overlap'))return;
 const home=await mkdtemp(join(tmpdir(),'uah-native-unretired-coordinator-'));
 const isolated=require('../../src/analyze/isolated-batch-preview') as
  typeof import('../../src/analyze/isolated-batch-preview');
 const performance=require('node:perf_hooks').performance as Performance;
 let now=0;
 const clock=mock.method(performance,'now',()=>now);
 const originalSetTimeout=globalThis.setTimeout;
 let triggerLifecycleTimeout:(()=>void)|undefined;
 globalThis.setTimeout=((callback:(...args:unknown[])=>void,delay?:number,
  ...args:unknown[])=>{
  if(delay===10000){
   triggerLifecycleTimeout=()=>callback(...args);
   return originalSetTimeout(()=>undefined,delay,...args);
  }
  return originalSetTimeout(callback,delay,...args);
 }) as typeof setTimeout;
 let calls=0;
 let notifyPending!:()=>void;
 const pendingStarted=new Promise<void>(resolve=>{notifyPending=resolve;});
 const never=new Promise<never>(()=>{});
 const patch=mock.method(isolated,'previewImportedBatchOffMain',
  async(...args:Parameters<typeof isolated.previewImportedBatchOffMain>)=>{
   calls++;
   if(args[0].length>1)return {previews:args[0].map(()=>unavailableImportPreview(
    'ISOLATED_ANALYSIS_FAILED','NOT_CHECKED')),
    safeToContinue:true} as unknown as Awaited<
      ReturnType<typeof isolated.previewImportedBatchOffMain>>;
   notifyPending();
   return never;
  });
 try{
  const paths:string[]=[];
  for(let index=0;index<17;index++){
   const path=join(home,`native-unretired-${index}.user.js`);
   await writeFile(path,header+`document.querySelector("#native-unretired-${index}");`);
   paths.push(path);
  }
  const scripts=(await importApprovedPaths(paths)).scripts;
  const userData=join(home,'userdata');
  await mkdir(userData);
  const pending=runCheckpointedNativeImportAnalysis(
   join(userData,'readonly-journals'),scripts);
  await pendingStarted;
  assert.ok(triggerLifecycleTimeout,'the hanging adapter must have a bounded lifecycle timer');
  triggerLifecycleTimeout();
  const result=await Promise.race([pending,new Promise<'PENDING'>(resolve=>
   originalSetTimeout(()=>resolve('PENDING'),1000))]);
  assert.notEqual(result,'PENDING','native scheduler must return after adapter timeout');
  assert.equal(calls,3,'no per-file recovery may start behind an unretired segment');
  assert.deepEqual((result as Awaited<typeof pending>).previews.map(row=>row.status),
   Array(17).fill('ISOLATED_ANALYSIS_FAILED'));
 }finally{
  patch.mock.restore();globalThis.setTimeout=originalSetTimeout;clock.mock.restore();
  await rm(home,{recursive:true,force:true});
 }
});

test('TASK-013/TEST-022/026: native single-file recovery bounds a hung adapter and preserves later evidence',async()=>{
 if(isolateNativePoisoningTest(
  'native single-file recovery bounds a hung adapter and preserves later evidence',
  'native-hung-recovery'))return;
 const home=await mkdtemp(join(tmpdir(),'uah-native-hung-recovery-'));
 const isolated=require('../../src/analyze/isolated-batch-preview') as
  typeof import('../../src/analyze/isolated-batch-preview');
 const actual=isolated.previewImportedBatchOffMain;
 const performance=require('node:perf_hooks').performance as Performance;
 const controller=new AbortController();
 let now=0;
 const clock=mock.method(performance,'now',()=>now);
 let lastDigest='';
 let calls=0;
 const never=new Promise<never>(()=>{});
 const patch=mock.method(isolated,'previewImportedBatchOffMain',
  async(...args:Parameters<typeof actual>)=>{
   calls++;
   const selected=args[0];
   if(selected.length>1)return {previews:selected.map(()=>unavailableImportPreview(
    'ISOLATED_ANALYSIS_FAILED','NOT_CHECKED')),
    safeToContinue:true} as unknown as Awaited<ReturnType<typeof actual>>;
   if(createHash('sha256').update(selected[0].bytes).digest('hex')===lastDigest)
    return actual(...args);
   controller.abort();
   now=120001;
   return never;
  });
 try{
  const paths:string[]=[];
  for(let index=0;index<17;index++){
   const path=join(home,`native-recovery-${index}.user.js`);
   await writeFile(path,header+`document.querySelector("#native-recovery-${index}");`);
   paths.push(path);
  }
  const scripts=(await importApprovedPaths(paths)).scripts;
  lastDigest=createHash('sha256').update(scripts[16].bytes).digest('hex');
  const userData=join(home,'userdata');
  await mkdir(userData);
  const pending=runCheckpointedNativeImportAnalysis(
   join(userData,'readonly-journals'),scripts,controller.signal);
  const result=await Promise.race([pending,new Promise<'PENDING'>(resolve=>
   setTimeout(()=>resolve('PENDING'),1000))]);
  assert.notEqual(result,'PENDING','single-file recovery must remain bounded');
  const outcome=result as Awaited<typeof pending>;
  assert.equal(outcome.status,'BLOCKED');
  assert.equal(calls,4,'two failed segment attempts, one later success, then one bounded recovery');
  assert.deepEqual(outcome.previews.slice(0,16).map(row=>row.status),
   Array(16).fill('SKIPPED_CANCELLED'));
  assert.equal(outcome.previews[16].status,'STATIC_ANALYSIS_ONLY',
   'completed fresh evidence from a later segment must survive recovery cancellation');
 }finally{
  controller.abort();patch.mock.restore();clock.mock.restore();
  await rm(home,{recursive:true,force:true});
 }
});

test('TASK-013/TEST-022/NFR-009: first native budget stop survives a later user cancel during recovery',async()=>{
 if(isolateNativePoisoningTest(
  'first native budget stop survives a later user cancel during recovery',
  'native-budget-before-user-cancel'))return;
 const home=await mkdtemp(join(tmpdir(),'uah-native-budget-stop-order-'));
 const isolated=require('../../src/analyze/isolated-batch-preview') as
  typeof import('../../src/analyze/isolated-batch-preview');
 const actual=isolated.previewImportedBatchOffMain;
 const performance=require('node:perf_hooks').performance as Performance;
 const controller=new AbortController();
 let now=0;
 const clock=mock.method(performance,'now',()=>now);
 const originalSetTimeout=globalThis.setTimeout;
 let fireBudgetTimer:(()=>void)|undefined;
 globalThis.setTimeout=((callback:(...args:unknown[])=>void,delay?:number,
  ...args:unknown[])=>{
  if(delay!==undefined&&delay>100000){
   fireBudgetTimer=()=>callback(...args);
   return originalSetTimeout(()=>undefined,delay,...args);
  }
  return originalSetTimeout(callback,delay,...args);
 }) as typeof setTimeout;
 let lastDigest='';
 let calls=0;
 let notifyRecovery!:()=>void;
 const recoveryStarted=new Promise<void>(resolve=>{notifyRecovery=resolve;});
 let finishRecovery!:(value:unknown)=>void;
 const patch=mock.method(isolated,'previewImportedBatchOffMain',
  async(...args:Parameters<typeof actual>)=>{
   calls++;
   const selected=args[0];
   if(selected.length>1)return {previews:selected.map(()=>unavailableImportPreview(
    'ISOLATED_ANALYSIS_FAILED','NOT_CHECKED')),
    safeToContinue:true} as unknown as Awaited<ReturnType<typeof actual>>;
   if(createHash('sha256').update(selected[0].bytes).digest('hex')===lastDigest)
    return actual(...args);
   notifyRecovery();
    const held=new Promise<unknown>(resolve=>{finishRecovery=resolve;});
    return await held as unknown as Awaited<ReturnType<typeof actual>>;
  });
 try{
  const paths:string[]=[];
  for(let index=0;index<17;index++){
   const path=join(home,`native-stop-order-${index}.user.js`);
   await writeFile(path,header+`document.querySelector("#native-stop-order-${index}");`);
   paths.push(path);
  }
  const scripts=(await importApprovedPaths(paths)).scripts;
  lastDigest=createHash('sha256').update(scripts[16].bytes).digest('hex');
  const userData=join(home,'userdata');
  await mkdir(userData);
  const pending=runCheckpointedNativeImportAnalysis(
   join(userData,'readonly-journals'),scripts,controller.signal);
  await recoveryStarted;
  assert.ok(fireBudgetTimer);
  now=120001;
  fireBudgetTimer();
  controller.abort();
  finishRecovery({previews:[unavailableImportPreview(
   'SKIPPED_CANCELLED','NOT_CHECKED')],safeToContinue:true});
  const result=await Promise.race([pending,new Promise<'PENDING'>(resolve=>
   originalSetTimeout(()=>resolve('PENDING'),1000))]);
  assert.notEqual(result,'PENDING','recovery must settle after the first budget stop');
  const outcome=result as Awaited<typeof pending>;
  assert.equal(outcome.status,'BLOCKED');
  if(outcome.status==='BLOCKED'){
   assert.deepEqual(outcome.previews.slice(0,16).map(row=>row.status),
    Array(16).fill('SKIPPED_BATCH_BUDGET'));
   assert.equal(outcome.previews[16].status,'STATIC_ANALYSIS_ONLY');
  }
  assert.equal(calls,4);
 }finally{
  controller.abort();patch.mock.restore();clock.mock.restore();
  globalThis.setTimeout=originalSetTimeout;
  await rm(home,{recursive:true,force:true});
 }
});

test('TASK-013/TEST-022/026: resumed native display bounds a hung adapter after cancellation',async()=>{
 if(isolateNativePoisoningTest(
  'resumed native display bounds a hung adapter after cancellation',
  'native-hung-resumed-display'))return;
 const home=await mkdtemp(join(tmpdir(),'uah-native-hung-resumed-display-'));
 const isolated=require('../../src/analyze/isolated-batch-preview') as
  typeof import('../../src/analyze/isolated-batch-preview');
 const performance=require('node:perf_hooks').performance as Performance;
 let now=0;
 const controller=new AbortController();
 let notifyCall!:()=>void;
 const called=new Promise<void>(resolve=>{notifyCall=resolve;});
 const never=new Promise<never>(()=>{});
 let restoreMocks=()=>{};
 try{
  const selected=join(home,'resumed-hung.user.js');
  await writeFile(selected,header+'document.querySelector("#resumed-hung");');
  const scripts=(await importApprovedPaths([selected])).scripts;
  const userData=join(home,'userdata');
  await mkdir(userData);
  const root=join(userData,'readonly-journals');
  const initial=await runCheckpointedNativeImportAnalysis(root,scripts);
  assert.equal(initial.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
  const clock=mock.method(performance,'now',()=>now);
  const patch=mock.method(isolated,'previewImportedBatchOffMain',()=>{
   controller.abort();
   now=120001;
   notifyCall();
   return never;
  });
  restoreMocks=()=>{patch.mock.restore();clock.mock.restore();};
  const pending=runCheckpointedNativeImportAnalysis(root,scripts,controller.signal);
  await called;
  const result=await Promise.race([pending,new Promise<'PENDING'>(resolve=>
   setTimeout(()=>resolve('PENDING'),1000))]);
  assert.notEqual(result,'PENDING','resumed display must bound its direct adapter wait');
  const outcome=result as Awaited<typeof pending>;
  assert.equal(outcome.status,'BLOCKED');
  if(outcome.status==='BLOCKED')assert.deepEqual(outcome.previews.map(row=>row.status),
   ['SKIPPED_CANCELLED']);
 }finally{
  controller.abort();restoreMocks();
  await rm(home,{recursive:true,force:true});
 }
});

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
  // A later native picker can reselect the exact same script bytes after an
  // app restart. A persisted CANCELLED job must remain cancelled, not be
  // silently reclassified as a successful or failed AST batch.
  const beforeRestart=await readFile(join(directory,BATCH_JOURNAL_FILENAME));
  const pickedAgain=(await importApprovedPaths(filenames)).scripts;
  const recoveredProgress:Array<[number,number]>=[];
  const recovered=await runCheckpointedNativeImportAnalysis(root,pickedAgain,
   undefined,(done,total)=>recoveredProgress.push([done,total]));
  assert.equal(recovered.status,'BLOCKED',
   'reimport cannot turn a previously cancelled durable job into batch success');
  if(recovered.status==='BLOCKED'){
   assert.equal(recovered.reason,'CANCELLED');
   assert.deepEqual(recovered.previews.slice(0,16).map(p=>p.status),
    Array(16).fill('STATIC_ANALYSIS_ONLY'),
    'old SUCCEEDED hints must be independently re-analysed before display');
   assert.equal(recovered.previews[16].status,'SKIPPED_CANCELLED',
    'persisted cancellation is not a worker crash or analysis failure');
   assert.equal(recovered.previews.every(p=>
    p.automaticPatchAllowed===false&&p.tampermonkeyVerified===false&&
    p.businessVerified===false),true);
  }
  assert.deepEqual(recoveredProgress,[[16,17]],
   'resumed progress must not count a cancelled job as completed');
  assert.deepEqual(await readFile(join(directory,BATCH_JOURNAL_FILENAME)),
   beforeRestart,'reimport must not erase terminal cancellation evidence');
  for(let i=0;i<17;i++)
   assert.equal((await readFile(filenames[i],'utf8')).includes('#partial-'+i),true,
    'cancellation and restart must never modify user-selected script bytes');
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
    if(++calls===1)return {previews:[
     unavailableImportPreview('ISOLATED_ANALYSIS_FAILED','NOT_CHECKED')],
     safeToContinue:true} as unknown as Awaited<ReturnType<typeof real>>;
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
   return {previews:[unavailableImportPreview('ISOLATED_ANALYSIS_FAILED',
    'NOT_CHECKED')],safeToContinue:true} as unknown as
     Awaited<ReturnType<typeof isolated.previewImportedBatchOffMain>>;
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

test('TASK-013/REQ-022/TEST-022: exhausted native segment keeps each fresh per-script result without rewriting FAILED checkpoint',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-per-script-recovery-'));
 try{
  const paths:string[]=[];
  const sources:string[]=[];
  for(let i=0;i<3;i++){
   const path=join(home,'source-'+i+'.user.js');
   const source=header+'document.querySelector("#native-recover-'+i+'");';
   await writeFile(path,source);
   paths.push(path);sources.push(source);
  }
  const scripts=(await importApprovedPaths(paths)).scripts;
  const root=join(home,'userdata','readonly-journals');
  await mkdir(join(home,'userdata'));
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
    if(Buffer.from(args[0][0].bytes).toString('utf8').includes('#native-recover-1'))
     return {previews:[unavailableImportPreview(
      'ISOLATED_ANALYSIS_FAILED','NOT_CHECKED')],safeToContinue:true} as unknown as
       Awaited<ReturnType<typeof actual>>;
    return actual(...args);
   });
  try{
   const outcome=await runCheckpointedNativeImportAnalysis(root,scripts);
   assert.equal(outcome.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
   if(outcome.status==='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED')
    assert.deepEqual(outcome.previews.map(row=>row.status),[
     'STATIC_ANALYSIS_ONLY','ISOLATED_ANALYSIS_FAILED','STATIC_ANALYSIS_ONLY'
    ]);
   assert.equal(calls,5,'two segment attempts then one current AST attempt per script');
   const journal=join(root,(await readdir(root))[0],BATCH_JOURNAL_FILENAME);
   const stored=JSON.parse(await readFile(journal,'utf8'));
   assert.deepEqual(stored.jobs.map((job:{state:string;attempts:number})=>
    [job.state,job.attempts]),[['FAILED',2]],
    'per-file display recovery must not change the genuine failed checkpoint');
  }finally{patch.mock.restore();}
  for(let index=0;index<paths.length;index++)
   assert.equal(await readFile(paths[index],'utf8'),sources[index]);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-013/REQ-022/TEST-022: resumed segment retries preserve per-script results and journal bytes',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-resumed-isolation-'));
 try{
  const paths:string[]=[];
  const sources:string[]=[];
  for(let i=0;i<3;i++){
   const path=join(home,'resumed-'+i+'.user.js');
   const source=header+'document.querySelector("#resumed-'+i+'");';
   await writeFile(path,source);paths.push(path);sources.push(source);
  }
  const scripts=(await importApprovedPaths(paths)).scripts;
  const root=join(home,'userdata','readonly-journals');
  await mkdir(join(home,'userdata'));
  const initial=await runCheckpointedNativeImportAnalysis(root,scripts);
  assert.equal(initial.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
  const journal=join(root,(await readdir(root))[0],BATCH_JOURNAL_FILENAME);
  const before=await readFile(journal);
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
    if(Buffer.from(args[0][0].bytes).toString('utf8').includes('#resumed-1'))
     return {previews:[unavailableImportPreview(
      'ISOLATED_ANALYSIS_FAILED','NOT_CHECKED')],safeToContinue:true} as unknown as
       Awaited<ReturnType<typeof actual>>;
    return actual(...args);
   });
  try{
   const resumed=await runCheckpointedNativeImportAnalysis(root,scripts);
   assert.equal(resumed.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
   if(resumed.status==='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED'){
    assert.equal(resumed.resumed,true);
    assert.deepEqual(resumed.previews.map(row=>row.status),[
     'STATIC_ANALYSIS_ONLY','ISOLATED_ANALYSIS_FAILED','STATIC_ANALYSIS_ONLY'
    ]);
   }
   assert.equal(calls,5,'two resumed segment checks then one fresh analysis per script');
  }finally{patch.mock.restore();}
  assert.deepEqual(await readFile(journal),before,
   'display recovery after resume must not alter durable scheduling state');
  for(let index=0;index<paths.length;index++)
   assert.equal(await readFile(paths[index],'utf8'),sources[index]);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-013/TEST-022/026: restored FAILED checkpoint does not imply prior Worker retirement',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-restored-failed-recovery-'));
 try{
  const path=join(home,'restored.user.js');
  const source=header+'document.querySelector("#restored");';
  await writeFile(path,source);
  const [script]=(await importApprovedPaths([path])).scripts;
  const userData=join(home,'userdata');
  const root=join(userData,'readonly-journals');
  await mkdir(root,{recursive:true});
  const nameHash=createHash('sha256')
   .update('uah-native-import-batch-v4\0')
   .update(script.sha256).update('\0').update(script.textEncoding).update('\0')
   .digest('hex');
  const batchDirectory=join(root,'batch-'+nameHash);
  await mkdir(batchDirectory);
  const segmentHash=createHash('sha256')
   .update('uah-native-import-segment-v3\0').update('0').update('\0')
   .update(script.sha256).update('\0').update(script.textEncoding).update('\0')
   .digest('hex');
  const options={count:1,maxAttempts:2,concurrency:1,timeoutMs:15000,
   jobHashes:[segmentHash]};
  const seed=new ReadOnlyBatchCoordinator(options,async()=> 'DONE');
  const exhausted={...seed.snapshot(),jobs:[{
   ordinal:0,state:'FAILED' as const,attempts:2
  }]};
  const saved=new ReadOnlyBatchCoordinator(options,async()=> 'DONE',exhausted);
  assert.equal((await saveReadOnlyBatchJournal(batchDirectory,saved)).status,
   'CHECKPOINT_SAVED_UNVERIFIED');
  const journal=join(batchDirectory,BATCH_JOURNAL_FILENAME);
  const before=await readFile(journal);

  // The journal does not encode retirement authority. Even when supplied as
  // a clean-process fixture, FAILED/2 remains untrusted history and cannot
  // itself authorize a new Worker in this recovery path.
  const isolated=require('../../src/analyze/isolated-batch-preview') as
   typeof import('../../src/analyze/isolated-batch-preview');
  let calls=0;
  const guard=mock.method(isolated,'previewImportedBatchOffMain',async()=>{
   calls++;
   throw Error('FAILED_CHECKPOINT_MUST_NOT_AUTHORIZE_WORKER');
  });
  let outcome:Awaited<ReturnType<typeof runCheckpointedNativeImportAnalysis>>;
  try{outcome=await runCheckpointedNativeImportAnalysis(root,[script]);}
  finally{guard.mock.restore();}
  assert.equal(outcome.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
  if(outcome.status==='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED'){
   assert.equal(outcome.resumed,true);
   assert.deepEqual(outcome.previews.map(row=>row.status),[
    'ISOLATED_ANALYSIS_FAILED'
   ]);
   assert.equal(outcome.previews[0].automaticPatchAllowed,false);
   assert.equal(outcome.previews[0].tampermonkeyVerified,false);
   assert.equal(outcome.previews[0].businessVerified,false);
  }
  assert.equal(calls,0,'FAILED/2 is not proof that any previous Worker retired');
  assert.deepEqual(await readFile(journal),before,
   'fresh display recovery must not rewrite a terminal FAILED journal');
  assert.equal(await readFile(path,'utf8'),source);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-013/TEST-022/026: cancelling resumed per-script recovery keeps only completed preview evidence',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-resumed-cancel-'));
 try{
  const paths:string[]=[];
  for(let i=0;i<3;i++){
   const path=join(home,'cancel-'+i+'.user.js');
   await writeFile(path,header+'document.querySelector("#cancel-'+i+'");');
   paths.push(path);
  }
  const scripts=(await importApprovedPaths(paths)).scripts;
  const root=join(home,'userdata','readonly-journals');
  await mkdir(join(home,'userdata'));
  const initial=await runCheckpointedNativeImportAnalysis(root,scripts);
  assert.equal(initial.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
  const journal=join(root,(await readdir(root))[0],BATCH_JOURNAL_FILENAME);
  const before=await readFile(journal);
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
   const resumed=await runCheckpointedNativeImportAnalysis(root,scripts,
    controller.signal);
   assert.equal(resumed.status,'BLOCKED');
   if(resumed.status==='BLOCKED'){
    assert.equal(resumed.reason,'CANCELLED');
    assert.deepEqual(resumed.previews.map(row=>row.status),[
     'STATIC_ANALYSIS_ONLY','SKIPPED_CANCELLED','SKIPPED_CANCELLED'
    ]);
   }
   assert.equal(calls,3,'cancellation stops all later per-script workers');
  }finally{patch.mock.restore();}
  assert.deepEqual(await readFile(journal),before,
   'cancelled display recovery must leave the checkpoint unchanged');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-013/TEST-022/026: unretired native fallback worker stops remaining files and leaves FAILED journal intact',async()=>{
 if(isolateNativePoisoningTest('unretired native fallback worker stops remaining files','native-fallback'))return;
 const home=await mkdtemp(join(tmpdir(),'uah-native-fallback-unretired-'));
 try{
  const paths:string[]=[];
  for(let i=0;i<3;i++){
   const path=join(home,'unretired-'+i+'.user.js');
   await writeFile(path,header+'document.querySelector("#unretired-'+i+'");');
   paths.push(path);
  }
  const scripts=(await importApprovedPaths(paths)).scripts;
  const root=join(home,'userdata','readonly-journals');
  await mkdir(join(home,'userdata'));
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
   const outcome=await runCheckpointedNativeImportAnalysis(root,scripts);
   assert.equal(outcome.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
   assert.equal(calls,3,'an unretired fallback worker blocks the rest of the per-file loop');
   if(outcome.status==='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED')
    assert.deepEqual(outcome.previews.map(row=>row.status),
     Array(3).fill('ISOLATED_ANALYSIS_FAILED'));
   const journal=join(root,(await readdir(root))[0],BATCH_JOURNAL_FILENAME);
   const stored=JSON.parse(await readFile(journal,'utf8'));
   assert.deepEqual(stored.jobs.map((job:{state:string;attempts:number})=>
    [job.state,job.attempts]),[['FAILED',2]],
    'per-file fallback lifecycle must not rewrite the FAILED scheduling record');
  }finally{patch.mock.restore();}
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-013/TEST-022/026: unretired initial worker blocks retries and later journal segments',async()=>{
 if(isolateNativePoisoningTest('unretired initial worker blocks retries and later journal segments','initial-worker'))return;
 const home=await mkdtemp(join(tmpdir(),'uah-native-unretired-worker-'));
 try{
  const paths:string[]=[];
  for(let i=0;i<17;i++){
   const path=join(home,'segment-'+i+'.user.js');
   await writeFile(path,header+'document.querySelector("#unretired-'+i+'");');
   paths.push(path);
  }
  const scripts=(await importApprovedPaths(paths)).scripts;
  const root=join(home,'userdata','readonly-journals');
  await mkdir(join(home,'userdata'));
  const isolated=require('../../src/analyze/isolated-batch-preview') as
   typeof import('../../src/analyze/isolated-batch-preview');
  let calls=0;
  const patched=mock.method(isolated,'previewImportedBatchOffMain',async(
   batch:Parameters<typeof isolated.previewImportedBatchOffMain>[0]
  )=>{
   calls++;
   return {previews:Array.from({length:batch.length},()=>
    unavailableImportPreview('ISOLATED_ANALYSIS_FAILED','NOT_CHECKED')),
    safeToContinue:false} as unknown as
     Awaited<ReturnType<typeof isolated.previewImportedBatchOffMain>>;
  });
  try{
   const outcome=await runCheckpointedNativeImportAnalysis(root,scripts);
   assert.equal(outcome.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
   assert.equal(calls,1,'an unretired worker must block retry and the next segment');
   if(outcome.status==='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED')
    assert.ok(outcome.previews.every(row=>
     row.status==='ISOLATED_ANALYSIS_FAILED'&&
     row.automaticPatchAllowed===false&&row.tampermonkeyVerified===false&&
     row.businessVerified===false));
   const journal=join(root,(await readdir(root))[0],BATCH_JOURNAL_FILENAME);
   const stored=JSON.parse(await readFile(journal,'utf8'));
   assert.deepEqual(stored.jobs.map((job:{state:string;attempts:number})=>
    [job.state,job.attempts]),[['FAILED',1],['FAILED',1]],
    'the journal records failed scheduling attempts without claiming Worker retirement');
  }finally{patched.mock.restore();}
  for(const path of paths)
   assert.equal((await readFile(path,'utf8')).includes('#unretired-'),true);
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

test('TASK-013/TEST-022/026: thrown AST call without retirement proof stops retries',async()=>{
 if(isolateNativePoisoningTest('thrown AST call without retirement proof stops retries','thrown-worker'))return;
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
   assert.equal(calls,1,'an exception has no retirement receipt and cannot authorize retry');
   assert.equal(outcome.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
   if(outcome.status==='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED')
    assert.deepEqual(outcome.previews.map(p=>p.status),['ISOLATED_ANALYSIS_FAILED']);
  }finally{patched.mock.restore();}
  assert.equal(await readFile(sourcePath,'utf8'),original);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-013/TEST-022: permanent preview budget failure is not retried as a transient crash',async()=>{
 if(isolateNativePoisoningTest('permanent preview budget failure is not retried as a transient crash','budget-worker'))return;
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

test('TASK-013/TEST-022/026: resumed AST worker fault without retirement proof stops later segments',async()=>{
 if(isolateNativePoisoningTest('resumed AST worker fault without retirement proof stops later segments','resumed-worker'))return;
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
  // Inject a Worker-level exception in resumed display. Without a retirement
  // receipt, later segments must not start overlapping isolated workers.
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
    assert.equal(resumed.previews.every(row=>row.automaticPatchAllowed===false&&
     row.tampermonkeyVerified===false&&row.businessVerified===false),true);
   }
   assert.equal(calls,1,'an unretired resumed Worker stops all later segment dispatch');
   assert.equal(resumed.status==='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED'&&
    resumed.previews.every(row=>row.status==='ISOLATED_ANALYSIS_FAILED'),true,
    'later scheduling hints cannot be reanalysed after retirement becomes unknown');
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

test('TASK-013/TEST-022/026: truncated resumed AST display recovers each script without rewriting the journal',async()=>{
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
    if(++calls<=2)return {previews:[],safeToContinue:true} as unknown as
     Awaited<ReturnType<typeof real>>;
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
     Array(16).fill('STATIC_ANALYSIS_ONLY'),
     'truncated batch replies should receive bounded fresh per-script analysis');
    assert.equal(resumed.previews[16].status,'STATIC_ANALYSIS_ONLY',
     'a failed segment must not discard another independently valid one');
    assert.equal(resumed.previews.every(row=>
     !row.automaticPatchAllowed&&!row.tampermonkeyVerified&&!row.businessVerified),true);
   }
   assert.equal(calls,19,
    'two segment attempts are followed by 16 single-file rechecks and the last segment');
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
    if(++calls===1)return {previews:[unavailableImportPreview(
     'ISOLATED_ANALYSIS_FAILED','NOT_CHECKED')],safeToContinue:true} as unknown as
      Awaited<ReturnType<typeof real>>;
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
 if(isolateNativePoisoningTest('resumed AST display never retries a permanent worker budget result','resumed-budget'))return;
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

test('TASK-013/TEST-022/026: ordinary and checkpointed queue paths share one active Worker gate',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-shared-worker-lifecycle-'));
 const workers=require('node:worker_threads') as
  {Worker:typeof import('node:worker_threads').Worker};
 const {EventEmitter}=require('node:events') as typeof import('node:events');
 const native=workers.Worker;
 let starts=0;
 let notifyRetirement!:()=>void;
 const retirementStarted=new Promise<void>(resolve=>{notifyRetirement=resolve;});
 let releaseRetirement!:()=>void;
 try{
  const paths:string[]=[];
  for(let i=0;i<3;i++){
   const path=join(home,'shared-'+i+'.user.js');
   await writeFile(path,header+'document.querySelector("#shared-'+i+'");');
   paths.push(path);
  }
  const scripts=(await importApprovedPaths(paths)).scripts;
  const userData=join(home,'userdata');
  await mkdir(userData);
  workers.Worker=class extends EventEmitter{
   constructor(_filename:string,options:{workerData:typeof scripts}){
    super();starts++;
    setImmediate(()=>{
     this.emit('online');
     this.emit('message',options.workerData.map(previewImportedScriptAnalysis));
    });
   }
   terminate():Promise<number>{
    if(starts===2)return new Promise(resolve=>{
     notifyRetirement();releaseRetirement=()=>resolve(0);
    });
    return Promise.resolve(0);
   }
  } as unknown as typeof native;

  const journalRoot=join(userData,'readonly-journals');
  const seeded=await runCheckpointedNativeImportAnalysis(journalRoot,scripts);
  assert.equal(seeded.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
  const journalDirectory=join(journalRoot,(await readdir(journalRoot))[0]);
  const journalPath=join(journalDirectory,BATCH_JOURNAL_FILENAME);
  const journalBeforeBusy=await readFile(journalPath);

  const ordinary=runImportedReadOnlyAnalysisQueue([scripts[0]]);
  await retirementStarted;
  const nativeDuring=await runCheckpointedNativeImportAnalysis(
   journalRoot,scripts);
  assert.deepEqual(nativeDuring,{status:'BLOCKED',reason:'BUSY',
   previews:scripts.map(()=>unavailableImportPreview(
    'ISOLATED_ANALYSIS_FAILED','NOT_CHECKED'))});
  assert.equal(starts,2,
   'the native checkpoint path must be rejected while the ordinary path owns an active Worker');
  assert.deepEqual(await readFile(journalPath),journalBeforeBusy,
   'a Worker gate refusal must leave existing checkpoint bytes untouched');

  releaseRetirement();
  assert.deepEqual((await ordinary).map(row=>row.status),['STATIC_ANALYSIS_ONLY']);
  const nativeAfter=await runCheckpointedNativeImportAnalysis(
   journalRoot,scripts);
  assert.equal(nativeAfter.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
  if(nativeAfter.status==='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED')
   assert.deepEqual(nativeAfter.previews.map(row=>row.status),
    Array(3).fill('STATIC_ANALYSIS_ONLY'));
  assert.equal(starts,3,
   'a new native Worker may start after the ordinary Worker retires safely');
  assert.deepEqual(await readFile(journalPath),journalBeforeBusy,
   'the retry may use fresh display evidence without rewriting a settled journal');
 }finally{
  releaseRetirement?.();
  workers.Worker=native;
  await rm(home,{recursive:true,force:true});
 }
});

test('TASK-013/TEST-022/026: native cancellation holds the lease until Worker retirement',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-cancel-retirement-'));
 const workers=require('node:worker_threads') as
  {Worker:typeof import('node:worker_threads').Worker};
 const realWorker=workers.Worker;
 const controller=new AbortController();
 let workerStarted!:()=>void;
 const started=new Promise<void>(resolve=>{workerStarted=resolve;});
 let retire!:()=>void;
 const retirement=new Promise<number>(resolve=>{retire=()=>resolve(0);});
 let pending:ReturnType<typeof runCheckpointedNativeImportAnalysis>|undefined;
 let terminationRequested=false;
 try{
  const file=join(home,'selected.user.js');
  const source=header+'document.querySelector("#source-retained");';
  await writeFile(file,source);
  const {scripts}=await importApprovedPaths([file]);
  assert.equal(scripts.length,1);
  workers.Worker=class extends EventEmitter{
   constructor(){super();workerStarted();}
   terminate(){terminationRequested=true;return retirement;}
  } as unknown as typeof realWorker;
  const journalRoot=join(home,'journals');
  pending=runCheckpointedNativeImportAnalysis(journalRoot,scripts,controller.signal);
  const startDeadline=new AbortController();
  try{
   await Promise.race([started,delay(5000,undefined,{signal:startDeadline.signal})
    .then(()=>assert.fail('the native Worker did not start'))]);
  }finally{startDeadline.abort();}
  controller.abort();
  assert.equal(terminationRequested,true);
  const early=await Promise.race([pending,delay(250,'STILL_WAITING' as const)]);
  assert.equal(early,'STILL_WAITING','cancellation must await the outstanding termination');
  const busy=await runCheckpointedNativeImportAnalysis(join(home,'competing'),scripts);
  assert.equal(busy.status,'BLOCKED');
  if(busy.status==='BLOCKED')assert.equal(busy.reason,'BUSY');
  assert.deepEqual((await readdir(home)).sort(),['journals','selected.user.js']);
  retire();
  const cancelled=await pending;
  assert.equal(cancelled.status,'BLOCKED');
  if(cancelled.status==='BLOCKED')assert.equal(cancelled.reason,'CANCELLED');
  assert.deepEqual(cancelled.previews.map(row=>row.status),['SKIPPED_CANCELLED']);
  assert.equal(await readFile(file,'utf8'),source);
 }finally{
  controller.abort();
  retire();
  await pending?.catch(()=>{});
  workers.Worker=realWorker;
  await rm(home,{recursive:true,force:true});
 }
});

test('TASK-013/TEST-022/026: permanently blocked Worker gate returns before creating a native journal',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-blocked-gate-'));
 try{
  const selected=join(home,'blocked.user.js');
  await writeFile(selected,header+'document.querySelector("#blocked");');
  const userData=join(home,'userdata');
  await mkdir(userData);
  const journalRoot=join(userData,'readonly-journals');
  const isolatedPath=require.resolve('../../src/analyze/isolated-batch-preview');
  const previewPath=require.resolve('../../src/analyze/import-preview');
  const importPath=require.resolve('../../src/import/import-service');
  const nativePath=require.resolve('../../src/jobs/native-checkpointed-import');
  const childCode=`
   const assert=require('node:assert/strict');
   const {EventEmitter}=require('node:events');
   const {previewImportedBatchOffMain}=require(${JSON.stringify(isolatedPath)});
   const {previewImportedScriptAnalysis}=require(${JSON.stringify(previewPath)});
   const {importApprovedPaths}=require(${JSON.stringify(importPath)});
   const {runCheckpointedNativeImportAnalysis}=require(${JSON.stringify(nativePath)});
   const workers=require('node:worker_threads');
   const nativeWorker=workers.Worker;
   const selected=${JSON.stringify(selected)};
   const journalRoot=${JSON.stringify(journalRoot)};
   let starts=0;
   (async()=>{
    try{
     workers.Worker=class extends EventEmitter{
      constructor(_filename,options){
       super();starts++;
       setImmediate(()=>{
        this.emit('online');
        this.emit('message',options.workerData.map(previewImportedScriptAnalysis));
       });
      }
      terminate(){return Promise.reject(Error('PRIVATE_RETIREMENT_FAILURE'));}
     };
     const scripts=(await importApprovedPaths([selected])).scripts;
     const failed=await previewImportedBatchOffMain(scripts);
     assert.equal(failed[0].status,'ISOLATED_ANALYSIS_FAILED');
     const refused=await runCheckpointedNativeImportAnalysis(journalRoot,scripts);
     assert.equal(refused.status,'BLOCKED');
     assert.equal(refused.reason,'BUSY');
     assert.equal(starts,1,'a permanently blocked gate must not dispatch another Worker');
     const fs=require('node:fs');
     assert.equal(fs.existsSync(journalRoot),false,
      'a permanent lifecycle refusal must not create or persist a FAILED journal');
     process.stdout.write(JSON.stringify({status:refused.status,reason:refused.reason,starts}));
    }finally{workers.Worker=nativeWorker;}
   })().catch(error=>{console.error(error);process.exitCode=1;});
  `;
  const childResult=JSON.parse(execFileSync(process.execPath,['-e',childCode],
   {encoding:'utf8'})) as {status:string;reason:string;starts:number};
  assert.deepEqual(childResult,{status:'BLOCKED',reason:'BUSY',starts:1});
  assert.deepEqual(await readdir(userData),[],
   'an unretired worker must leave the native userData directory without journal artifacts');
 }finally{await rm(home,{recursive:true,force:true});}
});


test('TASK-013 / TEST-022: checkpointed native AST partitions by byte budget and does not starve later valid scripts',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-native-byte-partition-'));
 try{
  const paths:string[]=[];
  // Each script is individually eligible (under 512 KiB) but three such
  // sources exceed a single 1 MiB isolated Worker segment.
  for(let i=0;i<3;i++){
   const path=join(home,'budget-'+i+'.user.js');
   await writeFile(path,header+'document.querySelector("#budget-'+i+'");\n/*'+
    'x'.repeat(400*1024)+'*/');
   paths.push(path);
  }
  const imported=await importApprovedPaths(paths);
  assert.equal(imported.errors.length,0);
  assert.equal(imported.scripts.length,3);
  const root=join(home,'userdata','readonly-journals');
  await mkdir(join(home,'userdata'));
  const progress:Array<[number,number]>=[];
  const first=await runCheckpointedNativeImportAnalysis(root,imported.scripts,
   undefined,(done,total)=>progress.push([done,total]));
  assert.equal(first.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
  if(first.status!=='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED')return;
  assert.deepEqual(first.previews.map(p=>p.status),[
   'STATIC_ANALYSIS_ONLY','STATIC_ANALYSIS_ONLY','STATIC_ANALYSIS_ONLY'
  ],'eligible third script must be analysed by a later Worker, not marked skipped');
  assert.deepEqual(progress,[[2,3],[3,3]]);
  const directory=join(root,(await readdir(root))[0]);
  const disk=JSON.parse(await readFile(join(directory,BATCH_JOURNAL_FILENAME),'utf8'));
  assert.deepEqual(disk.jobs.map((j:{state:string})=>j.state),[
   'SUCCEEDED','SUCCEEDED'
  ]);
  const again=await runCheckpointedNativeImportAnalysis(root,imported.scripts);
  assert.equal(again.status,'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED');
  if(again.status==='READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED'){
   assert.equal(again.resumed,true);
   assert.deepEqual(again.previews,first.previews);
  }
  for(const path of paths)
   assert.equal((await readFile(path,'utf8')).includes('document.querySelector'),true);
 }finally{await rm(home,{recursive:true,force:true});}
});
