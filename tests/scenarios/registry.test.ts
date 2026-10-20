import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { ScenarioRegistry, preflightScenario, suggestSites, type ScenarioInput } from '../../src/scenarios/scenario-registry';
import { parseUserscriptMetadata } from '../../src/analyze/metadata-parser';

const sha='a'.repeat(64);
const metadata=parseUserscriptMetadata({
  bytes:Buffer.from('// ==UserScript==\n// @match https://example.test/app/*\n// @include *://*.other.test/*\n// ==/UserScript==\n'),
  textEncoding:'utf-8'
});
const bare:ScenarioInput={
  id:'scenario_one',scriptSha256:sha,userApproved:false,requiresLogin:true,
  steps:[{kind:'wait-for',selector:'#content'}],
  assertions:[{kind:'selector-present',selector:'#submit'}]
};

test('TEST-005: pattern hints never fabricate approved test URLs',()=>{
  const hints=suggestSites(metadata);
  assert.equal(hints.length,2);
  assert.equal(hints[0].hostPattern,'example.test');
  assert.equal(hints[1].hostPattern,'*.other.test');
  const state=preflightScenario(bare,metadata);
  assert.equal(state.state,'UNKNOWN');
  assert.ok(state.issues.includes('MISSING_TARGET_URL'));
  assert.ok(state.issues.includes('NOT_AUTHORIZED'));
  assert.ok(state.issues.includes('LOGIN_NOT_READY'));
  assert.equal(state.input.targetUrl,undefined);
});
test('TEST-005: explicitly authorized URL plus assertions is READY_TO_TEST, not verified',()=>{
  const state=preflightScenario({...bare,targetUrl:'https://example.test/app/a',
    userApproved:true,loginReady:true},metadata);
  assert.equal(state.state,'READY_TO_TEST');
  assert.deepEqual(state.issues,[]);
  assert.equal(state.input.targetUrl,'https://example.test/app/a');
});
test('TEST-005: unsafe URL or invalid assertions rejected independently',()=>{
  for(const targetUrl of ['javascript:alert(1)','file:///C:/private','https://user:pass@example.test/']) {
    const result=preflightScenario({...bare,userApproved:true,targetUrl});
    assert.equal(result.state,'INVALID');
    assert.ok(result.issues.includes('INVALID_URL'));
  }
  const bad=preflightScenario({...bare,assertions:[{kind:'text-contains',selector:'#a'}]});
  assert.equal(bad.state,'INVALID');
  assert.ok(bad.issues.includes('INVALID_ASSERTION'));
  const unknown=preflightScenario({...bare,userApproved:true,requiresLogin:false,
    targetUrl:'http://127.0.0.1:9000/',assertions:[]});
  assert.equal(unknown.state,'UNKNOWN');
  assert.ok(unknown.issues.includes('MISSING_ASSERTIONS'));
});
test('TEST-005: registry is isolated from caller mutation and duplicate IDs',()=>{
  const registry=new ScenarioRegistry();
  const ready={...bare,targetUrl:'https://example.test/app/a',userApproved:true,loginReady:true};
  const accepted=registry.register(ready,metadata);
  assert.equal(accepted.state,'READY_TO_TEST');
  (accepted.input.assertions as ScenarioInput['assertions'] as ScenarioInput['assertions'] & Array<unknown>).pop();
  assert.equal(registry.get('scenario_one')?.input.assertions.length,1);
  const again=registry.register(ready,metadata);
  assert.equal(again.state,'INVALID');
  assert.ok(again.issues.includes('DUPLICATE_ID'));
  assert.equal(registry.list().length,1);
});

test('TEST-005/026: scenario registry rejects accessor and Proxy traps without invoking getters',()=>{
  const valid:ScenarioInput={...bare,id:'safe_case',userApproved:true,requiresLogin:false,
    targetUrl:'https://example.test/app',steps:[{kind:'wait-for',selector:'#ready'}]};
  const registry=new ScenarioRegistry();
  let getterCalls=0;
  const accessor={...valid};
  Object.defineProperty(accessor,'targetUrl',{enumerable:true,get(){
    getterCalls++;throw Error('PRIVATE_SCENARIO_URL');
  }});
  const nestedStep={kind:'wait-for'};
  Object.defineProperty(nestedStep,'selector',{enumerable:true,get(){
    getterCalls++;throw Error('PRIVATE_STEP_SELECTOR');
  }});
  const nestedAssertion={kind:'selector-present'};
  Object.defineProperty(nestedAssertion,'selector',{enumerable:true,get(){
    getterCalls++;throw Error('PRIVATE_ASSERTION_SELECTOR');
  }});
  const blocked=[
    accessor,
    {...valid,steps:[nestedStep]},
    {...valid,assertions:[nestedAssertion]},
    {...valid,steps:[,]},
    {...valid,assertions:[{kind:'selector-present',selector:'#ok',unexpected:'secret'}]},
    new Proxy({...valid},{ownKeys(){throw Error('PRIVATE_PROXY_TRAP');}}),
    null
  ];
  for(const input of blocked){
    const result=registry.register(input as ScenarioInput);
    assert.equal(result.state,'INVALID');
    assert.ok(result.issues.length>0);
    assert.equal(registry.list().length,0);
  }
  assert.equal(getterCalls,0,'validation must never evaluate accessor fields');
  assert.equal(registry.register(valid).state,'READY_TO_TEST');
  assert.equal(registry.list().length,1);
  assert.equal(registry.get('safe_case')?.input.targetUrl,'https://example.test/app');
});

test('TEST-005/026: scenario snapshots capture validated fields without late accessor reads',()=>{
  const scenario:ScenarioInput={...bare,id:'captured',targetUrl:'https://example.test/app',
    userApproved:true,requiresLogin:false};
  const result=preflightScenario(scenario);
  assert.equal(result.state,'READY_TO_TEST');
  (scenario.steps[0] as {selector:string}).selector='#mutated';
  (scenario.assertions[0] as {selector:string}).selector='#mutated';
  assert.equal(result.input.steps[0].selector,'#content');
  assert.equal(result.input.assertions[0].selector,'#submit');
});
