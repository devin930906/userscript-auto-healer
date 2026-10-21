import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {ReadOnlyBatchCoordinator} from '../../src/jobs/batch-coordinator';

const SCRIPT_A='a'.repeat(64), SCRIPT_B='b'.repeat(64), SCRIPT_C='c'.repeat(64);

test('TEST-022: independent batch results, bounded transient retry and no automatic authority',async()=>{
 const visited:number[]=[];
 const coordinator=new ReadOnlyBatchCoordinator({count:4,maxAttempts:2},
  async ordinal=>{
   visited.push(ordinal);
   if(ordinal===1)return 'PERMANENT_FAILURE';
   if(ordinal===2&&visited.filter(i=>i===2).length===1)
     return 'RETRYABLE_FAILURE';
   if(ordinal===3)throw Error('secret credentials cannot reach progress');
   return 'DONE';
  });
 const result=await coordinator.run();
 assert.deepEqual(result.jobs.map(j=>j.state),
   ['SUCCEEDED','FAILED','SUCCEEDED','FAILED']);
 assert.deepEqual(result.jobs.map(j=>j.attempts),[1,1,2,1]);
 assert.equal(result.automaticPatchAllowed,false);
 assert.equal(result.automaticRollbackAllowed,false);
 assert.equal(result.tampermonkeyVerified,false);
 assert.equal(result.businessVerified,false);
 assert.equal(JSON.stringify(result).includes('secret'),false);
 assert.deepEqual(await coordinator.run(),result);
 assert.equal(visited.length,5);
});
test('TEST-022: cancelling an in-flight job revokes future dispatch and late success',async()=>{
 let started!:()=>void;
 const activated=new Promise<void>(resolve=>{started=resolve;});
 let release!:()=>void;
 const pending=new Promise<void>(resolve=>{release=resolve;});
 const visited:number[]=[];
 const coordinator=new ReadOnlyBatchCoordinator({count:8},async ordinal=>{
  visited.push(ordinal);
  started();
  await pending; // intentionally ignores AbortSignal
  return 'DONE';
 });
 const run=coordinator.run();
 await activated;
 assert.equal(coordinator.snapshot().jobs[0].state,'RUNNING');
 coordinator.cancel();
 release();
 const result=await run;
 assert.deepEqual(visited,[0]);
 assert.ok(result.jobs.every(j=>j.state==='CANCELLED'));
 assert.deepEqual(result.jobs.map(j=>j.attempts),[1,0,0,0,0,0,0,0]);
});
test('TEST-022: restart checkpoint preserves completed work, bounds interrupted retry',async()=>{
 let release!:()=>void;
 const wait=new Promise<void>(resolve=>{release=resolve;});
 let started!:()=>void;
 const active=new Promise<void>(resolve=>{started=resolve;});
 const first=new ReadOnlyBatchCoordinator({count:3,maxAttempts:2,
  jobHashes:[SCRIPT_A,SCRIPT_B,SCRIPT_C]},async ordinal=>{
  if(ordinal===0)return 'DONE';
  started();
  await wait;
  return 'DONE';
 });
 const original=first.run();
 await active;
 const captured=first.snapshot();
 assert.deepEqual(captured.jobs.map(j=>j.state),
  ['SUCCEEDED','RUNNING','QUEUED']);
 release();
 await original;
 const replay:number[]=[];
 const resumed=new ReadOnlyBatchCoordinator({count:3,maxAttempts:2,
  jobHashes:[SCRIPT_A,SCRIPT_B,SCRIPT_C]},
  async ordinal=>{replay.push(ordinal);return 'DONE';},captured);
 const result=await resumed.run();
 assert.deepEqual(replay,[1,2]);
 assert.deepEqual(result.jobs.map(j=>j.attempts),[1,2,1]);
 assert.ok(result.jobs.every(j=>j.state==='SUCCEEDED'));
});
test('TEST-022: exhausting retry budget is final after restart',async()=>{
 const c=new ReadOnlyBatchCoordinator({count:1,maxAttempts:2,jobHashes:[SCRIPT_A]},
   async()=> 'RETRYABLE_FAILURE');
 const failed=await c.run();
 assert.equal(failed.jobs[0].state,'FAILED');
 assert.equal(failed.jobs[0].attempts,2);
 let replayed=false;
 const next=new ReadOnlyBatchCoordinator({count:1,maxAttempts:2,jobHashes:[SCRIPT_A]},
  async()=>{replayed=true;return 'DONE';},failed);
 await next.run();
 assert.equal(replayed,false);
});
test('TEST-022: at most two concurrent read-only workers',async()=>{
 let running=0,maxRunning=0;
 const coordinator=new ReadOnlyBatchCoordinator({count:12,concurrency:2},async()=>{
  running++;maxRunning=Math.max(running,maxRunning);
  await new Promise<void>(resolve=>setImmediate(resolve));
  running--;return 'DONE';
 });
 const report=await coordinator.run();
 assert.equal(maxRunning,2);
 assert.ok(report.jobs.every(j=>j.state==='SUCCEEDED'));
});
test('TEST-022: reject oversized batches, forged checkpoints and hostile getter fields',()=>{
 const worker=async()=> 'DONE' as const;
 for(const opts of [{count:0},{count:1001},{count:1,concurrency:3},
                     {count:1,maxAttempts:4},{count:NaN}]){
  assert.throws(()=>new ReadOnlyBatchCoordinator(opts,worker));
 }
 const coordinator=new ReadOnlyBatchCoordinator({count:1},worker);
 const checkpoint=coordinator.snapshot();
 let getterCalls=0;
 const hostile={...checkpoint,jobs:[{ordinal:0,state:'SUCCEEDED',attempts:1,
  source:'SECRET_USER_SCRIPT'}]};
 assert.throws(()=>new ReadOnlyBatchCoordinator({count:1},worker,hostile));
 const accessor={...checkpoint};
 Object.defineProperty(accessor,'jobs',{enumerable:true,
  get(){getterCalls++;return checkpoint.jobs;}});
 assert.throws(()=>new ReadOnlyBatchCoordinator({count:1},worker,accessor));
 assert.equal(getterCalls,0);
 assert.throws(()=>new ReadOnlyBatchCoordinator({count:1},worker,{
  ...checkpoint,tampermonkeyVerified:true
 }));
 assert.throws(()=>new ReadOnlyBatchCoordinator({count:1},worker,{
  ...checkpoint,jobs:[{ordinal:0,state:'RUNNING',attempts:0}]
 }));
});

test('TEST-022: untrusted options and checkpoint array slots never invoke getters',()=>{
 const worker=async()=> 'DONE' as const;
 let optionGetterCalls=0;
 const options={count:1};
 Object.defineProperty(options,'maxAttempts',{enumerable:true,
  get(){optionGetterCalls++;return 2;}});
 assert.throws(()=>new ReadOnlyBatchCoordinator(options,worker),/INVALID_BATCH_OPTIONS/);
 assert.equal(optionGetterCalls,0);

 const coordinator=new ReadOnlyBatchCoordinator({count:1},worker);
 const checkpoint=coordinator.snapshot();
 let slotGetterCalls=0;
 const hostileJobs=[{ordinal:0,state:'QUEUED',attempts:0}];
 Object.defineProperty(hostileJobs,'0',{enumerable:true,configurable:true,
  get(){slotGetterCalls++;return {ordinal:0,state:'QUEUED',attempts:0};}});
 assert.throws(()=>new ReadOnlyBatchCoordinator({count:1},worker,
  {...checkpoint,jobs:hostileJobs}),/INVALID_BATCH_CHECKPOINT/);
 assert.equal(slotGetterCalls,0);
 assert.throws(()=>new ReadOnlyBatchCoordinator({count:1},worker,
  {...checkpoint,jobs:[{ordinal:0,state:'QUEUED',attempts:2}]}),
  /INVALID_BATCH_CHECKPOINT/);
 assert.throws(()=>new ReadOnlyBatchCoordinator({count:1},worker,
  {...checkpoint,jobs:[,{ordinal:0,state:'QUEUED',attempts:0}]}),
  /INVALID_BATCH_CHECKPOINT/);
});

test('TEST-022: hostile proxy traps cannot leak errors through batch validation',()=>{
 const worker=async()=> 'DONE' as const;
 const secret='PRIVATE_PROXY_EXCEPTION_MUST_NOT_ESCAPE';
 const badOptions=new Proxy({count:1},{
  ownKeys(){throw Error(secret);}
 });
 assert.throws(()=>new ReadOnlyBatchCoordinator(badOptions,worker),
   /INVALID_BATCH_OPTIONS/);

 const snapshot=new ReadOnlyBatchCoordinator({count:1},worker).snapshot();
 const badTop=new Proxy({...snapshot},{
  getOwnPropertyDescriptor(){throw Error(secret);}
 });
 assert.throws(()=>new ReadOnlyBatchCoordinator({count:1},worker,badTop),
   /INVALID_BATCH_CHECKPOINT/);

 const badSlots=new Proxy([{ordinal:0,state:'QUEUED',attempts:0}],{
  get(target,prop,receiver){
   if(prop==='length')throw Error(secret);
   return Reflect.get(target,prop,receiver);
  }
 });
 assert.throws(()=>new ReadOnlyBatchCoordinator({count:1},worker,
   {...snapshot,jobs:badSlots}),/INVALID_BATCH_CHECKPOINT/);

 const badJob=new Proxy({ordinal:0,state:'QUEUED',attempts:0},{
  ownKeys(){throw Error(secret);}
 });
 assert.throws(()=>new ReadOnlyBatchCoordinator({count:1},worker,
   {...snapshot,jobs:[badJob]}),/INVALID_BATCH_CHECKPOINT/);
});

test('TEST-022/026: untrusted batch Proxy inputs invoke zero reflection traps',()=>{
 const worker=async()=> 'DONE' as const;
 const hash=SCRIPT_A;
 const checkpoint=new ReadOnlyBatchCoordinator(
  {count:1,jobHashes:[hash]},worker).snapshot();
 let traps=0;
 const refuse=(label:string,make:()=>ReadOnlyBatchCoordinator)=>{
  traps=0;
  assert.throws(make,/INVALID_BATCH_(?:OPTIONS|CHECKPOINT)/,label);
  assert.equal(traps,0,label+' must not execute Proxy traps');
 };
 const optionsProxy=new Proxy({count:1},{
  ownKeys(target){traps++;return Reflect.ownKeys(target);}
 });
 refuse('options object',()=>new ReadOnlyBatchCoordinator(optionsProxy,worker));
 const hashesProxy=new Proxy([hash],{
  get(target,property,receiver){
   traps++;return Reflect.get(target,property,receiver);
  }
 });
 refuse('script identity array',()=>new ReadOnlyBatchCoordinator(
  {count:1,jobHashes:hashesProxy},worker));
 const checkpointProxy=new Proxy({...checkpoint},{
  getPrototypeOf(target){traps++;return Reflect.getPrototypeOf(target);}
 });
 refuse('checkpoint record',()=>new ReadOnlyBatchCoordinator(
  {count:1,jobHashes:[hash]},worker,checkpointProxy));
 const jobsProxy=new Proxy([{ordinal:0,state:'QUEUED' as const,attempts:0}],{
  get(target,property,receiver){
   traps++;return Reflect.get(target,property,receiver);
  }
 });
 refuse('checkpoint jobs array',()=>new ReadOnlyBatchCoordinator(
  {count:1,jobHashes:[hash]},worker,{...checkpoint,jobs:jobsProxy}));
 const jobProxy=new Proxy({ordinal:0,state:'QUEUED' as const,attempts:0},{
  getPrototypeOf(target){traps++;return Reflect.getPrototypeOf(target);}
 });
 refuse('checkpoint job entry',()=>new ReadOnlyBatchCoordinator(
  {count:1,jobHashes:[hash]},worker,{...checkpoint,jobs:[jobProxy]}));
 const revoked=Proxy.revocable([hash],{});
 revoked.revoke();
 refuse('revoked script identity Proxy',()=>new ReadOnlyBatchCoordinator(
  {count:1,jobHashes:revoked.proxy},worker));
});

test('TEST-022/NFR-009: cancellation settles without waiting for an unresponsive read-only worker',async()=>{
 let started!:()=>void;
 const entered=new Promise<void>(resolve=>{started=resolve;});
 let release!:()=>void;
 const stalled=new Promise<void>(resolve=>{release=resolve;});
 let dispatched=0;
 let lateFinished=false;
 const coordinator=new ReadOnlyBatchCoordinator({count:2},async()=>{
  dispatched++;
  started();
  await stalled; // worker intentionally ignores the cancellation signal
  lateFinished=true;
  return 'DONE';
 });
 const running=coordinator.run();
 await entered;
 coordinator.cancel();
 let timeout:NodeJS.Timeout|undefined;
 let result;
 try{
  result=await Promise.race([
   running,
   new Promise<never>((_resolve,reject)=>{
    timeout=setTimeout(()=>reject(Error('CANCELLATION_WAITED_FOR_WORKER')),2000);
   })
  ]);
 }finally{
  if(timeout)clearTimeout(timeout);
  release(); // always release even when the regression fails
 }
 assert.deepEqual(result.jobs.map(j=>j.state),['CANCELLED','CANCELLED']);
 assert.deepEqual(result.jobs.map(j=>j.attempts),[1,0]);
 assert.equal(dispatched,1);
 assert.equal(result.automaticPatchAllowed,false);
 assert.equal(result.automaticRollbackAllowed,false);
 assert.equal(result.tampermonkeyVerified,false);
 assert.equal(result.businessVerified,false);
 await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(lateFinished,true);
 assert.deepEqual(coordinator.snapshot(),result,'late worker success must not change a cancelled terminal result');
});

test('TEST-022: late worker rejection after cancellation is contained',async()=>{
 let started!:()=>void;
 const entered=new Promise<void>(resolve=>{started=resolve;});
 let rejectLate!:(error:Error)=>void;
 const stalled=new Promise<never>((_resolve,reject)=>{rejectLate=reject;});
 const coordinator=new ReadOnlyBatchCoordinator({count:1},async()=>{
  started();
  return await stalled;
 });
 const running=coordinator.run();
 await entered;
 coordinator.cancel();
 let timeout:NodeJS.Timeout|undefined;
 try {
  const result=await Promise.race([
   running,
   new Promise<never>((_resolve,reject)=>{
    timeout=setTimeout(()=>reject(Error('CANCEL_REJECTION_HUNG')),2000);
   })
  ]);
  assert.equal(result.jobs[0].state,'CANCELLED');
  rejectLate(Error('PRIVATE_WORKER_ERROR'));
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(coordinator.snapshot().jobs[0].state,'CANCELLED');
 }finally{
  if(timeout)clearTimeout(timeout);
 }
});


test('TEST-022/NFR-009: a stalled worker without user cancellation times out and stops dispatch',async()=>{
 let release!:()=>void;
 const stalled=new Promise<void>(resolve=>{release=resolve;});
 let entered!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;});
 const dispatched:number[]=[];
 const queue=new ReadOnlyBatchCoordinator(
  {count:3,concurrency:1,maxAttempts:2,timeoutMs:50},
  async ordinal=>{
   dispatched.push(ordinal);
   entered();
   await stalled; // deliberately ignores the AbortSignal forever
   return 'DONE';
  }
 );
 let timer:NodeJS.Timeout|undefined;
 try{
  const run=queue.run();
  await started;
  const report=await Promise.race([
   run,
   new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>reject(Error('TIMED_OUT_WORKER_BLOCKED_QUEUE')),2000);
   })
  ]);
  assert.deepEqual(dispatched,[0]);
  assert.deepEqual(report.jobs.map(x=>x.state),['FAILED','CANCELLED','CANCELLED']);
  assert.deepEqual(report.jobs.map(x=>x.attempts),[1,0,0]);
  assert.equal(report.automaticPatchAllowed,false);
  assert.equal(report.automaticRollbackAllowed,false);
  assert.equal(report.tampermonkeyVerified,false);
  assert.equal(report.businessVerified,false);
  release(); // late completion must never promote a failed result
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.deepEqual(queue.snapshot(),report);
  assert.deepEqual(await queue.run(),report);
 }finally{
  if(timer)clearTimeout(timer);
  release();
 }
});

test('TEST-022/NFR-009: user cancellation before worker deadline stays CANCELLED',async()=>{
 let entered!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;});
 let release!:()=>void;
 const stalled=new Promise<void>(resolve=>{release=resolve;});
 const queue=new ReadOnlyBatchCoordinator({count:2,timeoutMs:200},
  async()=>{
   entered();
   await stalled;
   return 'DONE';
  });
 try{
  const run=queue.run();
  await started;
  queue.cancel();
  const report=await run;
  assert.deepEqual(report.jobs.map(x=>x.state),['CANCELLED','CANCELLED']);
  await new Promise(resolve=>setTimeout(resolve,230));
  assert.deepEqual(queue.snapshot(),report,'cleared deadline must not flip cancellation to failure');
 }finally{release();}
});

test('TEST-022/NFR-009: invalid timeout settings and hostile accessor are rejected',()=>{
 const worker=async()=> 'DONE' as const;
 for(const timeoutMs of [-1,0,24,300001,1.5,NaN,Infinity]){
  assert.throws(()=>new ReadOnlyBatchCoordinator({count:1,timeoutMs},worker),
   /INVALID_BATCH_OPTIONS/);
 }
 let accessed=0;
 const options={count:1};
 Object.defineProperty(options,'timeoutMs',{enumerable:true,
  get(){accessed++;return 100;}});
 assert.throws(()=>new ReadOnlyBatchCoordinator(options,worker),
  /INVALID_BATCH_OPTIONS/);
 assert.equal(accessed,0);
});

// A positional scheduling checkpoint is not sufficient to resume the same
// scripts. Bind it to the ordered, already-imported byte identities.
test('TEST-022: resume never transfers terminal states to a different batch of identical size',async()=>{
 const keys=[SCRIPT_A,SCRIPT_B];
 const options={count:2,maxAttempts:2,jobHashes:keys};
 const completed=new ReadOnlyBatchCoordinator(options,async()=> 'DONE');
 const receipt=await completed.run();
 assert.deepEqual(receipt.jobs.map(j=>j.state),['SUCCEEDED','SUCCEEDED']);
 assert.match(receipt.batchFingerprint??'',/^[0-9a-f]{64}$/);
 let replayCount=0;
 const continued=new ReadOnlyBatchCoordinator(options,async()=>{
  replayCount++;return 'DONE';
 },receipt);
 assert.deepEqual(await continued.run(),receipt);
 assert.equal(replayCount,0);
 for(const next of [
  {count:2,maxAttempts:2,jobHashes:[SCRIPT_B,SCRIPT_A]},
  {count:2,maxAttempts:2,jobHashes:[SCRIPT_A,SCRIPT_C]},
  {count:2,maxAttempts:2},
 ])assert.throws(()=>new ReadOnlyBatchCoordinator(next,async()=>{
  replayCount++;return 'DONE';
 },receipt),/INVALID_BATCH_CHECKPOINT/);
 assert.equal(replayCount,0);
});

test('TEST-022/026: script identity binding rejects sparse, accessor, duplicate and forged identities',()=>{
 const worker=async()=> 'DONE' as const;
 const valid={count:2,jobHashes:[SCRIPT_A,SCRIPT_B]};
 const saved=new ReadOnlyBatchCoordinator(valid,worker).snapshot();
 assert.equal(saved.automaticPatchAllowed,false);
 const aliases=[
  {count:2,jobHashes:[SCRIPT_A,SCRIPT_A]},
  {count:2,jobHashes:[SCRIPT_A,'invalid']},
  {count:2,jobHashes:[SCRIPT_A]},
  {count:2,jobHashes:[,SCRIPT_B] as string[]},
  {count:2,jobHashes:[SCRIPT_A,SCRIPT_B,SCRIPT_C]},
 ];
 for(const opts of aliases)assert.throws(()=>new ReadOnlyBatchCoordinator(opts,worker),
  /INVALID_BATCH_OPTIONS/);
 let getterCalled=false;
 const accessors=[SCRIPT_A,SCRIPT_B];
 Object.defineProperty(accessors,'0',{configurable:true,enumerable:true,get(){
  getterCalled=true;throw Error('PRIVATE_SCRIPT');
 }});
 assert.throws(()=>new ReadOnlyBatchCoordinator({count:2,jobHashes:accessors},worker),
  /INVALID_BATCH_OPTIONS/);
 assert.equal(getterCalled,false);
 const forged={...saved,batchFingerprint:SCRIPT_A};
 assert.throws(()=>new ReadOnlyBatchCoordinator(valid,worker,forged),
  /INVALID_BATCH_CHECKPOINT/);
 // Old position-only snapshots cannot be treated as safely resumable.
 const old={...saved};
 delete (old as {batchFingerprint?:unknown}).batchFingerprint;
 assert.throws(()=>new ReadOnlyBatchCoordinator(valid,worker,old),
  /INVALID_BATCH_CHECKPOINT/);
});

test('TEST-022/NFR-009: restarted batch retains exact timeout policy and rejects legacy checkpoints',async()=>{
 const hashes=[SCRIPT_A,SCRIPT_B];
 const opts={count:2,timeoutMs:50,maxAttempts:2,jobHashes:hashes};
 const completed=await new ReadOnlyBatchCoordinator(opts,async()=> 'DONE').run();
 assert.equal(completed.schema,'uah-readonly-batch-v2');
 assert.equal(completed.timeoutMs,50);
 let resumedWork=0;
 const samePolicy=new ReadOnlyBatchCoordinator(opts,async()=>{
  resumedWork++;return 'DONE';
 },completed);
 assert.deepEqual(await samePolicy.run(),completed);
 assert.equal(resumedWork,0,'unchanged completed work is not repeated');

 // Same SHA identities must not permit a different deadline on restart,
 // even if maxAttempts and concurrency remain unchanged.
 for(const deadline of [25,100,300000]){
  assert.throws(()=>new ReadOnlyBatchCoordinator(
   {...opts,timeoutMs:deadline},async()=>{
    resumedWork++;return 'DONE';
   },completed),/INVALID_BATCH_CHECKPOINT/);
 }
 assert.equal(resumedWork,0);
 const legacy={...completed,schema:'uah-readonly-batch-v1'};
 delete (legacy as {timeoutMs?:unknown}).timeoutMs;
 assert.throws(()=>new ReadOnlyBatchCoordinator(opts,async()=>{
  resumedWork++;return 'DONE';
 },legacy),/INVALID_BATCH_CHECKPOINT/);
 // A forged timeout cannot silently downgrade a checkpoint's deadline.
 const changed={...completed,timeoutMs:300000};
 assert.throws(()=>new ReadOnlyBatchCoordinator(opts,async()=> 'DONE',changed),
  /INVALID_BATCH_CHECKPOINT/);
 assert.equal(resumedWork,0);
});

test('TEST-022/026: timeout checkpoint accessor and hostile deadline fail closed',()=>{
 const opts={count:1,timeoutMs:50,jobHashes:[SCRIPT_A]};
 const checkpoint=new ReadOnlyBatchCoordinator(opts,async()=> 'DONE').snapshot();
 let reads=0;
 const accessor={...checkpoint};
 Object.defineProperty(accessor,'timeoutMs',{enumerable:true,
  get(){reads++;throw Error('PRIVATE_CHECKPOINT_DATA');}});
 assert.throws(()=>new ReadOnlyBatchCoordinator(opts,async()=> 'DONE',accessor),
  /INVALID_BATCH_CHECKPOINT/);
 assert.equal(reads,0);
 for(const timeoutMs of [-1,0,NaN,Infinity,'50',300001]){
  assert.throws(()=>new ReadOnlyBatchCoordinator(opts,async()=> 'DONE',
   {...checkpoint,timeoutMs}),/INVALID_BATCH_CHECKPOINT/);
 }
});


import {mkdtemp,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BATCH_JOURNAL_FILENAME,saveReadOnlyBatchJournal,loadReadOnlyBatchJournal} from '../../src/jobs/batch-journal';

test('TEST-022: native durable read-only checkpoint restores matching batch after process restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-batch-journal-'));
 try{
  const opts={count:2,jobHashes:[SCRIPT_A,SCRIPT_B],timeoutMs:100};
  const source=new ReadOnlyBatchCoordinator(opts,async()=> 'DONE');
  assert.deepEqual((await source.run()).jobs.map(x=>x.state),['SUCCEEDED','SUCCEEDED']);
  const written=await saveReadOnlyBatchJournal(root,source);
  assert.equal(written.status,'CHECKPOINT_SAVED_UNVERIFIED',JSON.stringify(written));
  if(written.status!=='CHECKPOINT_SAVED_UNVERIFIED')return;
  const text=await readFile(join(root,BATCH_JOURNAL_FILENAME),'utf8');
  assert.ok(!text.includes(root),'persisted scheduling hint must never expose disk paths');
  const saved=JSON.parse(text) as Record<string,unknown>;
  assert.equal(saved.automaticPatchAllowed,false);
  assert.equal(saved.automaticRollbackAllowed,false);
  assert.equal(saved.tampermonkeyVerified,false);
  assert.equal(saved.businessVerified,false);
  let dispatched=0;
  const loaded=await loadReadOnlyBatchJournal(root,opts,async()=>{dispatched++;return 'DONE';});
  assert.equal(loaded.status,'CHECKPOINT_RESTORED_SCHEDULING_ONLY',JSON.stringify(loaded));
  if(loaded.status!=='CHECKPOINT_RESTORED_SCHEDULING_ONLY')return;
  assert.deepEqual((await loaded.coordinator.run()).jobs.map(x=>x.state),['SUCCEEDED','SUCCEEDED']);
  assert.equal(dispatched,0,'completed read-only work must not be silently dispatched again');
  const wrong=await loadReadOnlyBatchJournal(root,
   {...opts,jobHashes:[SCRIPT_B,SCRIPT_A]},async()=>{dispatched++;return 'DONE';});
  assert.deepEqual(wrong,{status:'BLOCKED',reason:'INVALID_CHECKPOINT'});
  assert.equal(dispatched,0,'replayed checkpoint cannot mark another batch complete');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('TEST-022/026: malformed, stale and legacy journals never skip work',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-batch-invalid-'));
 const opts={count:1,jobHashes:[SCRIPT_A]};
 let dispatched=0;
 try{
  const base=new ReadOnlyBatchCoordinator(opts,async()=> 'DONE');
  const written=await saveReadOnlyBatchJournal(root,base);
  assert.equal(written.status,'CHECKPOINT_SAVED_UNVERIFIED');
  const path=join(root,BATCH_JOURNAL_FILENAME);
  const valid=JSON.parse(await readFile(path,'utf8')) as Record<string,unknown>;
  for(const damaged of [
   '{bad json',
   JSON.stringify({...valid,schema:'uah-readonly-batch-v1'}),
   JSON.stringify({...valid,automaticPatchAllowed:true}),
   JSON.stringify({...valid,batchFingerprint:'0'.repeat(64)}),
   ' '.repeat(250000)
  ]){
   await writeFile(path,damaged);
   const result=await loadReadOnlyBatchJournal(root,opts,async()=>{dispatched++;return 'DONE';});
   assert.deepEqual(result,{status:'BLOCKED',reason:'INVALID_CHECKPOINT'});
  }
  assert.equal(dispatched,0);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('TEST-022/026: refuse unbound, symlinked and non-native checkpoint directory',async t=>{
 const root=await mkdtemp(join(tmpdir(),'uah-batch-linked-'));
 const queue=new ReadOnlyBatchCoordinator({count:1},async()=> 'DONE');
 try{
  assert.deepEqual(await saveReadOnlyBatchJournal(root,queue),
    {status:'BLOCKED',reason:'INVALID_INPUT'});
  const bound=new ReadOnlyBatchCoordinator({count:1,jobHashes:[SCRIPT_A]},async()=> 'DONE');
  assert.deepEqual(await saveReadOnlyBatchJournal('relative-directory',bound),
    {status:'BLOCKED',reason:'UNSAFE_PATH'});
  const target=join(root,'target');
  const linked=join(root,'linked');
  await (await import('node:fs/promises')).mkdir(target);
  try{await symlink(target,linked,'junction');}
  catch{t.diagnostic('Symlink creation unavailable; platform-specific assertion skipped');return;}
  assert.deepEqual(await saveReadOnlyBatchJournal(linked,bound),
    {status:'BLOCKED',reason:'UNSAFE_PATH'});
 }finally{await rm(root,{recursive:true,force:true});}
});


test('TEST-022: persisted in-flight read-only task resumes within original attempt limit',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-batch-interrupted-'));
 const opts={count:2,jobHashes:[SCRIPT_A,SCRIPT_B],maxAttempts:2,timeoutMs:2000};
 let notify!:()=>void;
 const started=new Promise<void>(resolve=>{notify=resolve;});
 let release!:()=>void;
 const hanging=new Promise<void>(resolve=>{release=resolve;});
 const source=new ReadOnlyBatchCoordinator(opts,async ordinal=>{
  if(ordinal===0)return 'DONE';
  notify();
  await hanging;
  return 'DONE';
 });
 try{
  const oldRun=source.run();
  await started;
  assert.deepEqual(source.snapshot().jobs.map(j=>j.state),['SUCCEEDED','RUNNING']);
  assert.deepEqual(source.snapshot().jobs.map(j=>j.attempts),[1,1]);
  const stored=await saveReadOnlyBatchJournal(root,source);
  assert.equal(stored.status,'CHECKPOINT_SAVED_UNVERIFIED',JSON.stringify(stored));
  source.cancel();
  release();
  await oldRun;
  const visited:number[]=[];
  const restored=await loadReadOnlyBatchJournal(root,opts,async ordinal=>{
   visited.push(ordinal);return 'DONE';
  });
  assert.equal(restored.status,'CHECKPOINT_RESTORED_SCHEDULING_ONLY');
  if(restored.status!=='CHECKPOINT_RESTORED_SCHEDULING_ONLY')return;
  assert.deepEqual(restored.coordinator.snapshot().jobs.map(j=>j.state),['SUCCEEDED','QUEUED']);
  assert.deepEqual(restored.coordinator.snapshot().jobs.map(j=>j.attempts),[1,1]);
  const final=await restored.coordinator.run();
  assert.deepEqual(visited,[1]);
  assert.deepEqual(final.jobs.map(j=>j.state),['SUCCEEDED','SUCCEEDED']);
  assert.deepEqual(final.jobs.map(j=>j.attempts),[1,2]);
  assert.equal(final.automaticPatchAllowed,false);
  assert.equal(final.automaticRollbackAllowed,false);
 }finally{release();await rm(root,{recursive:true,force:true});}
});


test('TEST-022: native durable journal refuses overwriting a foreign-batch checkpoint',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-batch-no-foreign-overwrite-'));
 try{
  const originalOpts={count:1,jobHashes:[SCRIPT_A]};
  const original=new ReadOnlyBatchCoordinator(originalOpts,async()=> 'DONE');
  await original.run();
  assert.equal((await saveReadOnlyBatchJournal(root,original)).status,'CHECKPOINT_SAVED_UNVERIFIED');
  const path=join(root,BATCH_JOURNAL_FILENAME);
  const originalBytes=await readFile(path);
  const different=new ReadOnlyBatchCoordinator({count:1,jobHashes:[SCRIPT_B]},
    async()=> 'DONE');
  assert.deepEqual(await saveReadOnlyBatchJournal(root,different),
    {status:'BLOCKED',reason:'INVALID_CHECKPOINT'});
  assert.deepEqual(await readFile(path),originalBytes,'foreign batch must not lose prior resume data');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('TEST-022: stale checkpoints cannot regress persisted completion or attempts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-batch-monotonic-'));
 const opts={count:2,maxAttempts:2,jobHashes:[SCRIPT_A,SCRIPT_B]};
 try{
  const stale=new ReadOnlyBatchCoordinator(opts,async()=> 'DONE');
  assert.equal((await saveReadOnlyBatchJournal(root,stale)).status,'CHECKPOINT_SAVED_UNVERIFIED');
  const completed=new ReadOnlyBatchCoordinator(opts,async()=> 'DONE');
  await completed.run();
  assert.equal((await saveReadOnlyBatchJournal(root,completed)).status,'CHECKPOINT_SAVED_UNVERIFIED');
  const path=join(root,BATCH_JOURNAL_FILENAME);
  const saved=await readFile(path);
  assert.deepEqual(await saveReadOnlyBatchJournal(root,stale),
   {status:'BLOCKED',reason:'INVALID_CHECKPOINT'});
  assert.deepEqual(await readFile(path),saved);
  const partiallyDone=new ReadOnlyBatchCoordinator(opts,async()=> 'DONE',{
   ...completed.snapshot(),
   jobs:[{ordinal:0,state:'SUCCEEDED',attempts:1},
         {ordinal:1,state:'QUEUED',attempts:0}]
  });
  assert.deepEqual(await saveReadOnlyBatchJournal(root,partiallyDone),
   {status:'BLOCKED',reason:'INVALID_CHECKPOINT'});
  assert.deepEqual(await readFile(path),saved);
  assert.equal((await saveReadOnlyBatchJournal(root,completed)).status,
    'CHECKPOINT_SAVED_UNVERIFIED','saving identical verified state is idempotent');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('TEST-022/026: an in-flight journal save must not publish a snapshot captured before native dispatch',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-batch-snapshot-race-'));
 const opts={count:1,maxAttempts:2,timeoutMs:2000,jobHashes:[SCRIPT_A]};
 let release!:()=>void;
 const pending=new Promise<void>(resolve=>{release=resolve;});
 let started!:()=>void;
 const active=new Promise<void>(resolve=>{started=resolve;});
 const batch=new ReadOnlyBatchCoordinator(opts,async()=>{
  started();await pending;return 'DONE';
 });
 try{
  assert.equal((await saveReadOnlyBatchJournal(root,batch)).status,
   'CHECKPOINT_SAVED_UNVERIFIED');
  const path=join(root,BATCH_JOURNAL_FILENAME);
  const previous=await readFile(path);
  // save() captures QUEUED attempt 0 synchronously, before its first await.
  const saving=saveReadOnlyBatchJournal(root,batch);
  const running=batch.run();
  await active;
  assert.deepEqual(batch.snapshot().jobs.map(x=>[x.state,x.attempts]),[['RUNNING',1]]);
  assert.deepEqual(await saving,{status:'BLOCKED',reason:'INVALID_CHECKPOINT'});
  assert.deepEqual(await readFile(path),previous,
   'an obsolete queued/zero-attempt snapshot must not replace prior durable bytes');
  batch.cancel();release();await running;
 }finally{release();await rm(root,{recursive:true,force:true});}
});

test('TEST-022: readers do not accept a checkpoint while native writer lock exists',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-batch-busy-reader-'));
 const opts={count:1,jobHashes:[SCRIPT_A]};
 try{
  const queue=new ReadOnlyBatchCoordinator(opts,async()=> 'DONE');
  assert.equal((await saveReadOnlyBatchJournal(root,queue)).status,
    'CHECKPOINT_SAVED_UNVERIFIED');
  const lock=join(root,'.uah-readonly-batch-v2.lock');
  await (await import('node:fs/promises')).mkdir(lock);
  assert.deepEqual(await loadReadOnlyBatchJournal(root,opts,async()=> 'DONE'),
   {status:'BLOCKED',reason:'BUSY'});
  await rm(lock,{recursive:true,force:true});
  assert.equal((await loadReadOnlyBatchJournal(root,opts,async()=> 'DONE')).status,
   'CHECKPOINT_RESTORED_SCHEDULING_ONLY');
 }finally{await rm(root,{recursive:true,force:true});}
});

import {importDroppedBytes} from '../../src/import/import-service';
import {runImportedReadOnlyAnalysisQueue} from '../../src/jobs/imported-analysis-queue';
import {previewImportedScriptAnalysis} from '../../src/analyze/import-preview';

const QUEUE_HEADER=['// ==UserScript==','// @name actual-native-queue','// @match https://example.org/*','// ==/UserScript==',''].join(String.fromCharCode(10));
function realNativeScript(index:number){
 const bytes=new TextEncoder().encode(QUEUE_HEADER+
  'document.querySelector("#private-script-'+index+'");');
 const imported=importDroppedBytes('actual-'+index+'.user.js',bytes);
 assert.equal('code' in imported,false);
 if('code' in imported)throw Error(imported.code);
 return imported;
}

test('TEST-022: actual native imported scripts run through identity-bound read-only queue and isolated AST',async()=>{
 const imported=Array.from({length:34},(_,i)=>realNativeScript(i));
 const progress:Array<[number,number]>=[];
 const hashes=imported.map(x=>x.sha256);
 const previews=await runImportedReadOnlyAnalysisQueue(imported,undefined,
  (done,total)=>progress.push([done,total]));
 assert.deepEqual(progress,[[16,34],[32,34],[34,34]]);
 assert.deepEqual(previews,imported.map(previewImportedScriptAnalysis));
 assert.deepEqual(imported.map(x=>x.sha256),hashes,
  'queue may not edit imported bytes, identity or original script');
 assert.equal(JSON.stringify(previews).includes('private-script-'),false);
 assert.ok(previews.every(x=>x.automaticPatchAllowed===false&&
  x.tampermonkeyVerified===false&&x.businessVerified===false));
});

test('TEST-022: native scheduling abort revokes all later script segments without discarding earlier evidence',async()=>{
 const imported=Array.from({length:34},(_,i)=>realNativeScript(i));
 const controller=new AbortController();
 const counts:number[]=[];
 const previews=await runImportedReadOnlyAnalysisQueue(imported,controller.signal,
  (done,total)=>{assert.equal(total,34);counts.push(done);
   if(done===16)controller.abort();
  });
 assert.deepEqual(counts,[16]);
 assert.deepEqual(previews.slice(0,16).map(x=>x.status),
  Array(16).fill('STATIC_ANALYSIS_ONLY'));
 assert.deepEqual(previews.slice(16).map(x=>x.status),
  Array(18).fill('SKIPPED_CANCELLED'));
 assert.ok(previews.every(x=>!x.automaticPatchAllowed));
});

test('TEST-022/026: foreign or forged native script hashes are rejected before any analysis dispatch',async()=>{
 const script=realNativeScript(1);
 const forged={...script,sha256:'0'.repeat(64)};
 const progress:number[]=[];
 const previews=await runImportedReadOnlyAnalysisQueue([forged],undefined,
  (done)=>progress.push(done));
 assert.deepEqual(progress,[]);
 assert.deepEqual(previews.map(x=>x.status),['ISOLATED_ANALYSIS_FAILED']);
 assert.equal(previews[0].automaticPatchAllowed,false);
});

test('TASK-013/TEST-022/026: native AST queue rejects executable input descriptors and proxies without side effects',async()=>{
 const script=realNativeScript(55);
 let trapCalls=0;
 const badScript=new Proxy({...script},{
  get(target,key,receiver){trapCalls++;return Reflect.get(target,key,receiver);}
 });
 const bad=await runImportedReadOnlyAnalysisQueue([badScript]);
 assert.deepEqual(bad.map(item=>item.status),['ISOLATED_ANALYSIS_FAILED']);
 assert.equal(trapCalls,0,'no untrusted script Proxy trap may run');

 let getterCalls=0;
 const accessor={...script};
 Object.defineProperty(accessor,'bytes',{enumerable:true,get(){
  getterCalls++;return script.bytes;
 }});
 const badAccessor=await runImportedReadOnlyAnalysisQueue([accessor]);
 assert.deepEqual(badAccessor.map(item=>item.status),['ISOLATED_ANALYSIS_FAILED']);
 assert.equal(getterCalls,0,'no script property getter may run');

 const byteProxy=new Proxy(script.bytes,{
  get(target,key,receiver){trapCalls++;return Reflect.get(target,key,receiver);}
 });
 trapCalls=0;
 const badBytes=await runImportedReadOnlyAnalysisQueue([{...script,bytes:byteProxy}]);
 assert.deepEqual(badBytes.map(item=>item.status),['ISOLATED_ANALYSIS_FAILED']);
 assert.equal(trapCalls,0,'no byte buffer Proxy trap may run');

 const list=[script];
 Object.defineProperty(list,'0',{enumerable:true,configurable:true,get(){
  getterCalls++;return script;
 }});
 getterCalls=0;
 const badIndex=await runImportedReadOnlyAnalysisQueue(list);
 assert.deepEqual(badIndex.map(item=>item.status),['ISOLATED_ANALYSIS_FAILED']);
 assert.equal(getterCalls,0,'no imported batch index getter may run');

 const proxyList=new Proxy([script],{
  get(target,key,receiver){trapCalls++;return Reflect.get(target,key,receiver);}
 });
 trapCalls=0;
 assert.deepEqual(await runImportedReadOnlyAnalysisQueue(proxyList),[]);
 assert.equal(trapCalls,0,'no batch Proxy trap may run even to read length');
});

test('TASK-013/TEST-022/026: native AST copy ignores a typed-array subclass iterator',async()=>{
 const script=realNativeScript(56);
 let iteratorCalls=0;
 class HostileIteratorBytes extends Uint8Array{
  *[Symbol.iterator]():ArrayIterator<number>{
   iteratorCalls++;
   yield* super[Symbol.iterator]();
  }
 }
 const subclass=new HostileIteratorBytes(script.bytes);
 const result=await runImportedReadOnlyAnalysisQueue([{...script,bytes:subclass}]);
 assert.deepEqual(result,[previewImportedScriptAnalysis(script)]);
 assert.equal(iteratorCalls,0,'snapshot must copy native bytes without executing user iteration');
});

test('TEST-022/026: later native AST segments cannot be swapped after script identity validation',async()=>{
 const scripts=Array.from({length:34},(_,i)=>realNativeScript(i));
 const expected=scripts.map(previewImportedScriptAnalysis);
 let mutationApplied=false;
 const actual=await runImportedReadOnlyAnalysisQueue(scripts,undefined,
  processed=>{
   if(processed===16){
    // This is a real byte mutation, after the batch has already bound
    // script SHA-256 identities but before the second worker starts.
    scripts[17].bytes.fill(0x78);
    mutationApplied=true;
   }
  });
 assert.equal(mutationApplied,true);
 assert.equal(previewImportedScriptAnalysis(scripts[17]).status,'INVALID_METADATA',
  'the caller did mutate the original byte buffer');
 assert.deepEqual(actual,expected,
  'isolated AST evidence must describe the validated bytes, not a later caller mutation');
 assert.ok(actual.every(x=>!x.automaticPatchAllowed&&!x.businessVerified&&
  !x.tampermonkeyVerified));
});

test('TEST-022: expired global AST deadline is distinguished from user cancellation',async()=>{
 // Shorten only the production 120s global batch budget. The real isolated
 // worker still runs; this test must not sleep 120s or execute a userscript.
 const script=realNativeScript(900);
 const nativeTimeout=globalThis.setTimeout;
 globalThis.setTimeout=((
  callback:(...args:unknown[])=>void,delay?:number,...args:unknown[]
 )=>nativeTimeout(callback,delay===120000?0:delay,...args)) as typeof setTimeout;
 try{
  const results=await runImportedReadOnlyAnalysisQueue([script]);
  assert.deepEqual(results.map(item=>item.status),['SKIPPED_BATCH_BUDGET']);
  assert.equal(results[0].automaticPatchAllowed,false);
  assert.equal(results[0].tampermonkeyVerified,false);
  assert.equal(results[0].businessVerified,false);
 }finally{
  globalThis.setTimeout=nativeTimeout;
 }
});
