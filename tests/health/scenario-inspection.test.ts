import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {LimitedHealthRegistry} from '../../src/health/health-registry';
import {recordLimitedScenarioInspection} from '../../src/health/scenario-inspection';

const A='a'.repeat(64);
const valid=()=>({
  scriptHash:A,checkedAssertions:2,
  triageStatus:'NO_FAULT_SIGNAL',
  pageRuntimeStatus:'NO_EXCEPTION_IN_WINDOW_ONLY',
  pageExceptionCount:0
});

test('TEST-024: a clean owned-browser DOM observation creates only unverified element history',()=>{
  const history=new LimitedHealthRegistry(()=>1200);
  const result=recordLimitedScenarioInspection(history,valid());
  assert.equal(result.status,'ELEMENT_FOUND_ONLY');
  assert.equal(result.history.length,1);
  assert.match(result.history[0].evidenceHash??'',/^[0-9a-f]{64}$/);
  assert.equal(result.phase,'UNVERIFIED_LOCAL_HISTORY');
  assert.equal(result.tampermonkeyVerified,false);
  assert.equal(result.businessVerified,false);
  assert.equal(result.automaticPatchAllowed,false);
  assert.equal(result.automaticRollbackAllowed,false);
  assert.deepEqual(result,history.snapshot(A));
  assert.equal(JSON.stringify(result).includes('https://'),false);
});

test('TEST-024: missing selector and JavaScript exception cannot be displayed as healthy',()=>{
  const history=new LimitedHealthRegistry(()=>1200);
  const missing=recordLimitedScenarioInspection(history,{
    ...valid(),triageStatus:'SINGLE_CAUSE_SIGNAL_ONLY'
  });
  assert.equal(missing.status,'INDETERMINATE');
  assert.equal(missing.history[0].evidenceHash,null);
  const brokenPage=recordLimitedScenarioInspection(history,{
    ...valid(),pageRuntimeStatus:'PAGE_EXCEPTION_SIGNAL_ONLY',pageExceptionCount:1
  });
  assert.equal(brokenPage.status,'INDETERMINATE');
  assert.equal(brokenPage.history.length,2);
  assert.equal(brokenPage.automaticPatchAllowed,false);
});

test('TEST-024: observation history is session-local, bounded and ages out',()=>{
  let now=1000;
  const history=new LimitedHealthRegistry(()=>now);
  for(let i=0;i<35;i++){
    now++;
    recordLimitedScenarioInspection(history,valid());
  }
  assert.equal(history.snapshot(A).history.length,32);
  now+=600001;
  assert.equal(history.snapshot(A).status,'INDETERMINATE');
  assert.equal(new LimitedHealthRegistry(()=>now).snapshot(A).status,'UNTESTED');
});

test('TEST-024: invalid or accessor-backed partial receipts fail closed with no history',()=>{
  const history=new LimitedHealthRegistry(()=>1200);
  let touched=false;
  const accessor=valid();
  Object.defineProperty(accessor,'triageStatus',{get(){touched=true;throw Error('SECRET');}});
  const bad=[
    accessor,{...valid(),extra:'https://sensitive.example'},
    {...valid(),checkedAssertions:0},
    {...valid(),checkedAssertions:3},
    {...valid(),triageStatus:'RECOVERED_VERIFIED'},
    {...valid(),pageExceptionCount:1},
    {...valid(),pageRuntimeStatus:'PAGE_EXCEPTION_SIGNAL_ONLY'},
    {...valid(),pageRuntimeStatus:'BLOCKED'},
    {...valid(),scriptHash:'../../unsafe.user.js'},
    new Proxy(valid(),{ownKeys(){throw Error('SECRET');}})
  ];
  for(const receipt of bad){
    assert.throws(()=>recordLimitedScenarioInspection(history,receipt),
      (err:unknown)=>err instanceof Error &&
      ['INVALID_LIMITED_INSPECTION','INVALID_HEALTH_SCRIPT_ID'].includes(err.message));
  }
  assert.equal(touched,false);
  assert.equal(history.snapshot(A).status,'UNTESTED');
});

test('TEST-024/026: valid-looking Proxy receipts cannot execute traps or enter history',()=>{
  const history=new LimitedHealthRegistry(()=>1200);
  let traps=0;
  const proxy=new Proxy(valid(),{
    getPrototypeOf(target){traps++;return Reflect.getPrototypeOf(target);},
    ownKeys(target){traps++;return Reflect.ownKeys(target);},
    getOwnPropertyDescriptor(target,key){
      traps++;return Reflect.getOwnPropertyDescriptor(target,key);
    }
  });
  assert.throws(()=>recordLimitedScenarioInspection(history,proxy),
    /INVALID_LIMITED_INSPECTION/);
  assert.equal(traps,0,'no untrusted reflection trap may run');

  const revoked=Proxy.revocable(valid(),{});
  revoked.revoke();
  assert.throws(()=>recordLimitedScenarioInspection(history,revoked.proxy),
    /INVALID_LIMITED_INSPECTION/);
  assert.equal(history.snapshot(A).status,'UNTESTED');
});
