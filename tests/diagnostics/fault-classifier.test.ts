import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {
  classifyFaultSignals,BoundedFaultLog,type FaultSignalCode
} from '../../src/diagnostics/fault-classifier';

const signal=(id:string,code:FaultSignalCode)=>({id,code});

test('TEST-013: individual non-DOM failures cannot become selector defects',()=>{
  for(const [code,expected] of [
    ['PERMISSION_DENIED','PERMISSION'],
    ['NETWORK_FAILURE','NETWORK'],
    ['SCRIPT_EXCEPTION','JAVASCRIPT'],
    ['BUSINESS_ASSERTION_FAILED','BUSINESS_ASSERTION'],
    ['SELECTOR_NOT_FOUND','SELECTOR_ASSERTION']
  ] as const){
    const result=classifyFaultSignals([signal('observation_1',code)]);
    assert.equal(result.status,'SINGLE_CAUSE_SIGNAL_ONLY');
    assert.equal(result.category,expected);
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal(result.tampermonkeyVerified,false);
    assert.equal(result.businessRecoveredVerified,false);
  }
});

test('TEST-013: mixed fault signals stay ambiguous instead of proposing DOM repair',()=>{
  for(const pair of [
    ['PERMISSION_DENIED','SELECTOR_NOT_FOUND'],
    ['NETWORK_FAILURE','SELECTOR_NOT_FOUND'],
    ['SCRIPT_EXCEPTION','BUSINESS_ASSERTION_FAILED']
  ] as const){
    const result=classifyFaultSignals([signal('first',pair[0]),signal('second',pair[1])]);
    assert.equal(result.status,'MULTIPLE_CAUSE_SIGNALS');
    assert.equal(result.category,'UNKNOWN');
    assert.equal(result.automaticPatchAllowed,false);
  }
});

test('TEST-013: repeated same-category evidence remains limited signal triage',()=>{
  const result=classifyFaultSignals([
    signal('a','NETWORK_FAILURE'),signal('b','NETWORK_FAILURE')
  ]);
  assert.deepEqual(result.evidenceIds,['a','b']);
  assert.equal(result.category,'NETWORK');
  assert.equal(result.status,'SINGLE_CAUSE_SIGNAL_ONLY');
  assert.equal(result.tampermonkeyVerified,false);
});

test('TEST-013: absence of an observed fault is not a business-success attestation',()=>{
  const result=classifyFaultSignals([signal('ok','NO_FAILURE_OBSERVED')]);
  assert.equal(result.status,'NO_FAULT_SIGNAL');
  assert.equal(result.category,'UNKNOWN');
  assert.equal(result.businessRecoveredVerified,false);
});

test('TEST-013: clean and fault signals in one batch are contradictory',()=>{
  for(const code of [
    'PERMISSION_DENIED','NETWORK_FAILURE','SCRIPT_EXCEPTION',
    'SELECTOR_NOT_FOUND','BUSINESS_ASSERTION_FAILED'
  ] as const){
    for(const reversed of [false,true]){
      const pair=[signal('clean','NO_FAILURE_OBSERVED'),signal('fault',code)];
      const result=classifyFaultSignals(reversed?pair.reverse():pair);
      assert.equal(result.status,'INSUFFICIENT_EVIDENCE');
      assert.equal(result.category,'UNKNOWN');
      assert.equal(result.evidenceIds.length,2);
      assert.equal(result.automaticPatchAllowed,false);
      assert.equal(result.tampermonkeyVerified,false);
      assert.equal(result.businessRecoveredVerified,false);
    }
  }
  const log=new BoundedFaultLog(2);
  assert.equal(log.record([
    signal('clean','NO_FAILURE_OBSERVED'),signal('fault','SELECTOR_NOT_FOUND')
  ]).status,'INSUFFICIENT_EVIDENCE');
});

test('TEST-013: unknown provenance blocks single-cause classification',()=>{
  const result=classifyFaultSignals([
    signal('network','NETWORK_FAILURE'),
    signal('pending','UNVERIFIED_OBSERVATION')
  ]);
  assert.equal(result.status,'INSUFFICIENT_EVIDENCE');
  assert.equal(result.category,'UNKNOWN');
  assert.equal(result.automaticPatchAllowed,false);
});

test('TEST-013: malformed or secret-bearing input rejects without echoing raw data',()=>{
  const secret='SECRET_COOKIE_token_example';
  for(const input of [
    null,{},[],Array(33).fill(signal('a','NETWORK_FAILURE')),
    [signal('x','NETWORK_FAILURE'),signal('x','SCRIPT_EXCEPTION')],
    [{id:'private/path',code:'NETWORK_FAILURE'}],
    [{id:'ok',code:'SELECTOR_NOT_FOUND',message:secret}],
    [{id:'ok',code:'OTHER'}],
    [{id:'ok',code:'NETWORK_FAILURE',cookie:secret}],
    [{id:'ok',code:'NETWORK_FAILURE',url:'https://example.test/?key='+secret}],
    [{id:'ok',code:'NETWORK_FAILURE'},null],
    [{id:4,code:'NETWORK_FAILURE'}],
    [{id:'ok',code:'NETWORK_FAILURE',details:{secret}}],
    [{id:'ok',code:'NO_FAILURE_OBSERVED',extra:true}]
  ]){
    const result=classifyFaultSignals(input);
    assert.equal(result.status,'INVALID_EVIDENCE');
    assert.equal(result.category,'UNKNOWN');
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal(JSON.stringify(result).includes(secret),false);
  }
});

test('TEST-013: safe logs are bounded and expose only allowlisted fields',()=>{
  const log=new BoundedFaultLog(2);
  const a=log.record([signal('a','SCRIPT_EXCEPTION')]);
  const b=log.record([signal('b','NETWORK_FAILURE')]);
  const c=log.record([signal('c','PERMISSION_DENIED')]);
  assert.equal(a.sequence,1);
  assert.equal(b.sequence,2);
  assert.equal(c.sequence,3);
  assert.ok(Number.isFinite(Date.parse(c.recordedAt)));
  assert.deepEqual(log.list().map(entry=>entry.sequence),[2,3]);
  assert.deepEqual(Object.keys(c).sort(),[
    'automaticPatchAllowed','businessRecoveredVerified','category',
    'evidenceIds','recordedAt','sequence','status','tampermonkeyVerified'
  ].sort());
  assert.equal(Object.isFrozen(c),true);
  assert.equal(Object.isFrozen(c.evidenceIds),true);
  assert.equal(Object.isFrozen(log.list()),true);
  log.clear();
  assert.equal(log.list().length,0);
  assert.equal(log.record([signal('new','NETWORK_FAILURE')]).sequence,4);
});

test('TEST-013: even unsafe input is logged only as safe rejection metadata',()=>{
  const secret='Bearer super_sensitive_value';
  const log=new BoundedFaultLog();
  const entry=log.record([{id:'safe',code:'SCRIPT_EXCEPTION',stack:secret}]);
  assert.equal(entry.status,'INVALID_EVIDENCE');
  assert.equal(entry.category,'UNKNOWN');
  assert.equal(entry.evidenceIds.length,0);
  assert.equal(JSON.stringify(log.list()).includes(secret),false);
});

test('TEST-013: log capacity rejects invalid resource allocations',()=>{
  for(const capacity of [0,-1,1.2,Infinity,1025,NaN]){
    assert.throws(()=>new BoundedFaultLog(capacity),/INVALID_CAPACITY/);
  }
});

test('TEST-013: hostile diagnostic accessors and proxy traps fail closed',()=>{
  const throwingGetter={
    get id():string{throw new Error('private stack must never run');},
    code:'SELECTOR_NOT_FOUND'
  };
  const accessorCode={
    id:'opaque',
    get code():string{throw new Error('private token must never run');}
  };
  const hostileProxy=new Proxy({id:'opaque',code:'SELECTOR_NOT_FOUND'},{
    ownKeys(){throw new Error('untrusted proxy trap');}
  });
  const contaminated=Object.create({id:'inherited'});
  contaminated.code='SELECTOR_NOT_FOUND';
  for(const candidate of [throwingGetter,accessorCode,hostileProxy,contaminated]){
    assert.doesNotThrow(()=>{
      const classified=classifyFaultSignals([candidate]);
      assert.equal(classified.status,'INVALID_EVIDENCE');
      assert.equal(classified.category,'UNKNOWN');
      assert.equal(classified.automaticPatchAllowed,false);
      assert.deepEqual(classified.evidenceIds,[]);
    });
    const log=new BoundedFaultLog(2);
    assert.doesNotThrow(()=>log.record([candidate]));
    assert.equal(log.list()[0].status,'INVALID_EVIDENCE');
  }
});


test('TASK-008/TEST-013/026: outer evidence array cannot execute an iterator, index getter or Proxy trap',()=>{
 let executed=0;
 const poison=():never=>{executed++;throw Error('SECRET_HOSTILE_EVIDENCE_EXECUTED');};
 const valid=signal('safe','SELECTOR_NOT_FOUND');
 const indexGetter=[valid];
 Object.defineProperty(indexGetter,'0',{configurable:true,enumerable:true,get:poison});
 const iterationOverride=[valid];
 Object.defineProperty(iterationOverride,Symbol.iterator,{configurable:true,value:poison});
 const iteratorGetter=[valid];
 Object.defineProperty(iteratorGetter,Symbol.iterator,{configurable:true,get:poison});
 const proxy=new Proxy([valid],{
  get:poison,getPrototypeOf:poison,ownKeys:poison,
  getOwnPropertyDescriptor:poison
 });
 const revoked=Proxy.revocable([valid],{get:poison});
 revoked.revoke();
 const sparse=Array(1);
 const additional=Object.assign([valid],{privateToken:'SECRET'});
 const customProto=[valid];
 Object.setPrototypeOf(customProto,Object.create(Array.prototype));
 const malformed=[
  indexGetter,iterationOverride,iteratorGetter,proxy,revoked.proxy,
  sparse,additional,customProto
 ];
 for(const payload of malformed){
  assert.doesNotThrow(()=>{
   const result=classifyFaultSignals(payload);
   assert.equal(result.status,'INVALID_EVIDENCE');
   assert.equal(result.category,'UNKNOWN');
   assert.deepEqual(result.evidenceIds,[]);
   assert.equal(result.automaticPatchAllowed,false);
   const entry=new BoundedFaultLog().record(payload);
   assert.equal(entry.status,'INVALID_EVIDENCE');
   assert.equal(JSON.stringify(entry).includes('SECRET'),false);
  });
 }
 assert.equal(executed,0,'untrusted array getters, iterator hooks and Proxy traps must never run');
 assert.equal(classifyFaultSignals([valid]).status,'SINGLE_CAUSE_SIGNAL_ONLY');
});

test('TASK-008/TEST-013/026: non-plain or proxied evidence records cannot certify a fault',()=>{
 let accessed=0;
 const trap=():never=>{accessed++;throw Error('SECRET_PROXY_ACCESS');};
 const recordProxy=new Proxy(signal('safe','NETWORK_FAILURE'),{
  getPrototypeOf:trap,ownKeys:trap,getOwnPropertyDescriptor:trap,get:trap
 });
 const nonPlain=Object.assign(Object.create({hijack:true}),signal('safe','NETWORK_FAILURE'));
 for(const value of [recordProxy,nonPlain]){
  const result=classifyFaultSignals([value]);
  assert.deepEqual(result.evidenceIds,[]);
  assert.equal(result.status,'INVALID_EVIDENCE');
  assert.equal(result.automaticPatchAllowed,false);
 }
 assert.equal(accessed,0,'reject malformed records without reflecting on hostile proxies');
});
