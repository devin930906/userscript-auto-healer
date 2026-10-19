import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createExclusiveOwnedDiagnosticGate} from '../../src/browser/diagnostic-operation-gate';

test('TEST-017/022/026: scenario and GM diagnostics cannot overlap on one owned Chrome',async()=>{
 const gate=createExclusiveOwnedDiagnosticGate();
 const scenario=gate.reserve();
 assert.equal(typeof scenario,'symbol');
 assert.equal(gate.busy(),true);
 assert.equal(gate.reserve(),null,'GM fixture cannot enter while scenario dialog/CDP is pending');
 // Even a completed Promise rejection must release only its own reservation.
 let rejected=false;
 try{
  assert.equal(gate.reserve(),null);
  throw Error('simulated read-only observation failure');
 }catch{rejected=true;}finally{gate.release(scenario!);}
 assert.equal(rejected,true);
 assert.equal(gate.busy(),false);
 const gm=gate.reserve();
 assert.equal(typeof gm,'symbol');
 assert.notEqual(gm,scenario);
 assert.equal(gate.reserve(),null,'scenario cannot enter while GM dialog/CDP is pending');
 gate.release(scenario!);
 assert.equal(gate.busy(),true,'stale prior operation must not release a newer GM operation');
 gate.release(Symbol('forged'));
 assert.equal(gate.busy(),true,'forged operation cannot release a lease');
 gate.release(gm!);
 assert.equal(gate.busy(),false);
});

test('TEST-017/026: rapid synchronous IPC-style admissions retain exclusive ownership',async()=>{
 const gate=createExclusiveOwnedDiagnosticGate();
 let active=0;
 let maximum=0;
 const enter=async()=>{
  const lease=gate.reserve();
  if(lease===null)return false;
  try{
   active++;
   maximum=Math.max(maximum,active);
   await new Promise<void>(resolve=>setImmediate(resolve));
   return true;
  }finally{
   active--;
   gate.release(lease);
  }
 };
 const attempted=await Promise.all(Array.from({length:40},()=>enter()));
 assert.equal(attempted.filter(Boolean).length,1);
 assert.equal(maximum,1);
 assert.equal(gate.busy(),false);
 assert.equal(await enter(),true,'a later consented operation may proceed after completion');
});

test('TEST-026: duplicate releases are idempotent and do not unlock a new owner',()=>{
 const gate=createExclusiveOwnedDiagnosticGate();
 const a=gate.reserve();
 assert.ok(a);
 gate.release(a!);
 const b=gate.reserve();
 assert.ok(b);
 gate.release(a!);
 assert.equal(gate.busy(),true);
 gate.release(b!);
 gate.release(b!);
 assert.equal(gate.busy(),false);
});
