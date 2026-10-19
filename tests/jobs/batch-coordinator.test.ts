import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {ReadOnlyBatchCoordinator} from '../../src/jobs/batch-coordinator';

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
 const first=new ReadOnlyBatchCoordinator({count:3,maxAttempts:2},async ordinal=>{
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
 const resumed=new ReadOnlyBatchCoordinator({count:3,maxAttempts:2},
  async ordinal=>{replay.push(ordinal);return 'DONE';},captured);
 const result=await resumed.run();
 assert.deepEqual(replay,[1,2]);
 assert.deepEqual(result.jobs.map(j=>j.attempts),[1,2,1]);
 assert.ok(result.jobs.every(j=>j.state==='SUCCEEDED'));
});
test('TEST-022: exhausting retry budget is final after restart',async()=>{
 const c=new ReadOnlyBatchCoordinator({count:1,maxAttempts:2},
   async()=> 'RETRYABLE_FAILURE');
 const failed=await c.run();
 assert.equal(failed.jobs[0].state,'FAILED');
 assert.equal(failed.jobs[0].attempts,2);
 let replayed=false;
 const next=new ReadOnlyBatchCoordinator({count:1,maxAttempts:2},
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
