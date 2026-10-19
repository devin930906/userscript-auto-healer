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
