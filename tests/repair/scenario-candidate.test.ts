import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {proposeFromReadOnlyDomDiagnostic} from '../../src/repair/scenario-candidate';
import type {LiteralPatchRequest} from '../../src/repair/patch-planner';
import type {ScenarioInput} from '../../src/scenarios/scenario-registry';

const header='// ==UserScript==\n// @name Test\n// @match https://example.com/*\n// @grant none\n// ==/UserScript==\n';
const source=header+"const target=document.querySelector('#old');\n";
const hash=createHash('sha256').update(source).digest('hex');
const patch:LiteralPatchRequest={
  source,expectedSourceSha256:hash,
  callOffset:source.indexOf('document.querySelector'),
  method:'querySelector',originalSelector:'#old',
  replacementSelector:'#new',faultEvidenceId:'scenario_assertion_1'
};
const scenario:ScenarioInput={
  id:'owned_fixture',scriptSha256:hash,
  userApproved:true,requiresLogin:false,targetUrl:'https://example.com/',
  steps:[],
  assertions:[
    {kind:'selector-present',selector:'#old'},
    {kind:'selector-present',selector:'#new'}
  ]
};
function sample(oldCount=0,newCount=1,time='2026-10-18T00:00:00Z'){
  return {
    ok:true as const,status:'LIMITED_DOM_OBSERVATION' as const,
    observedAt:time,originMatchesApproved:true as const,
    routeChanged:false,
    summary:{elementCount:4,iframeCount:0,visibleShadowRoots:0,blindSpots:[]},
    selectorCounts:{'#old':oldCount,'#new':newCount},
    fullPageVerified:false as const,userscriptVerified:false as const
  };
}
function series(oldCount=0,newCount=1){
  return {
    ok:true as const,status:'LIMITED_DYNAMIC_OBSERVATION' as const,
    samples:[sample(oldCount,newCount),sample(oldCount,newCount,'2026-10-18T00:00:01Z')],
    routeChangeDetected:false,selectorCountChanged:false,domCountChanged:false,
    userscriptVerified:false as const
  };
}
test('TEST-014: stable old-absent/new-present DOM signals produce only a local candidate',()=>{
  const result=proposeFromReadOnlyDomDiagnostic(patch,scenario,series(),true);
  assert.equal(result.status,'CANDIDATE_ONLY');
  assert.equal(result.automaticPatchAllowed,false);
  assert.equal(result.tampermonkeyVerified,false);
  assert.equal(result.businessRecoveredVerified,false);
  if(result.status!=='CANDIDATE_ONLY')return;
  assert.equal(result.diagnosticLevel,'LIMITED_READ_ONLY_DOM_ONLY');
  assert.equal(result.scenarioId,'owned_fixture');
  assert.equal(result.reason,'REQUIRES_REAL_MANAGER_AND_BUSINESS_VALIDATION');
  assert.equal(result.candidateSource,header+"const target=document.querySelector(\"#new\");\n");
  assert.notEqual(result.candidateSha256,result.originalSha256);
});

test('TEST-019: a missing new selector or a clean old selector cannot produce a candidate',()=>{
  for(const data of [series(0,0),series(1,1),series(1,0)]){
    const result=proposeFromReadOnlyDomDiagnostic(patch,scenario,data,true);
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal('candidateSource' in result,false);
  }
});

test('TEST-013: unstable, incomplete or forged DOM evidence fails closed',()=>{
  const base=series();
  for(const observation of [
    null,{},false,
    {...base,routeChangeDetected:true},
    {...base,selectorCountChanged:true},
    {...base,domCountChanged:true},
    {...base,samples:[sample()]},
    {...base,samples:[sample(),sample(0,2,'2026-10-18T00:00:01Z')]},
    {...base,samples:[sample(),sample(0,1,'2026-10-18T00:00:00Z')]},
    {...base,samples:[sample(),{...sample(0,1,'2026-10-18T00:00:01Z'),routeChanged:true}]},
    {...base,samples:[{...sample(),userscriptVerified:true},sample(0,1,'2026-10-18T00:00:01Z')]},
    {...base,samples:[{...sample(),originMatchesApproved:false},sample(0,1,'2026-10-18T00:00:01Z')]},
    {...base,samples:[{...sample(),selectorCounts:{'#old':0,'#new':1,'#unauthorized':7}},sample(0,1,'2026-10-18T00:00:01Z')]}
  ]){
    const result=proposeFromReadOnlyDomDiagnostic(patch,scenario,observation,true);
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal('candidateSource' in result,false);
  }
});

test('TEST-019: scenario consent, source identity and exact assertion ordering are mandatory',()=>{
  for(const badScenario of [
    {...scenario,userApproved:false},
    {...scenario,requiresLogin:true,loginReady:true},
    {...scenario,steps:[{kind:'click',selector:'#old'}]},
    {...scenario,scriptSha256:'0'.repeat(64)},
    {...scenario,targetUrl:'https://example.com/#secret'},
    {...scenario,assertions:[scenario.assertions[1],scenario.assertions[0]]},
    {...scenario,assertions:[scenario.assertions[0]]},
    {...scenario,assertions:[...scenario.assertions,{kind:'selector-present',selector:'#third'}]},
    {...scenario,assertions:[{kind:'text-contains',selector:'#old',expectedText:'private'},scenario.assertions[1]]}
  ]){
    const result=proposeFromReadOnlyDomDiagnostic(patch,badScenario,series(),true);
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.automaticPatchAllowed,false);
  }
  assert.equal(proposeFromReadOnlyDomDiagnostic(patch,scenario,series(),false).status,'BLOCKED');
  assert.equal(proposeFromReadOnlyDomDiagnostic({...patch,faultEvidenceId:'other'},scenario,series(),true).status,'BLOCKED');
  assert.equal(proposeFromReadOnlyDomDiagnostic({...patch,expectedSourceSha256:'f'.repeat(64)},scenario,series(),true).status,'BLOCKED');
});

test('TEST-019: malformed candidate and hostile getters never expose source or execute scripts',()=>{
  const maliciousScenario={get id():string{throw Error('private payload');}};
  const malformed={...patch,replacementSelector:'#new\n@grant GM_xmlhttpRequest'};
  for(const [input,scen] of [
    [malformed,scenario],[patch,maliciousScenario],[patch,null]
  ] as const){
    const result=proposeFromReadOnlyDomDiagnostic(input,scen,series(),true);
    assert.equal(result.status,'BLOCKED');
    assert.equal('candidateSource' in result,false);
    assert.equal(JSON.stringify(result).includes('private payload'),false);
    assert.equal(result.automaticPatchAllowed,false);
  }
});


test('TEST-019: proposed source must actually match the approved scenario URL',()=>{
  // Even a perfectly shaped (caller-controlled) DOM receipt says nothing
  // about a userscript on an origin or path outside its own @match.
  for(const targetUrl of [
    'https://unrelated.example/', 'http://example.com/',
    'https://example.com:8443/', 'https://example.com/#fragment'
  ]){
    const result=proposeFromReadOnlyDomDiagnostic(
      patch,{...scenario,targetUrl},series(),true);
    assert.equal(result.status,'BLOCKED',targetUrl);
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal('candidateSource' in result,false);
  }
  const scopedSource=source.replace(
    '@match https://example.com/*','@match https://example.com/approved/*'
  );
  const scopedPatch={
    ...patch,source:scopedSource,
    expectedSourceSha256:createHash('sha256').update(scopedSource).digest('hex'),
    callOffset:scopedSource.indexOf('document.querySelector')
  };
  assert.equal(proposeFromReadOnlyDomDiagnostic(scopedPatch,{
    ...scenario,scriptSha256:scopedPatch.expectedSourceSha256,
    targetUrl:'https://example.com/outside'
  },series(),true).status,'BLOCKED');
  assert.equal(proposeFromReadOnlyDomDiagnostic(scopedPatch,{
    ...scenario,scriptSha256:scopedPatch.expectedSourceSha256,
    targetUrl:'https://example.com/approved/page?mode=1'
  },series(),true).status,'CANDIDATE_ONLY');
});


test('TEST-019: unresolved metadata execution and update dependencies block DOM-only candidates',()=>{
  // A matching URL alone is insufficient to reason about what the manager
  // installs/loads. DOM snapshots cannot attest @require/@resource, network
  // grants, automatic updates, or unrecognized manager-specific directives.
  for(const tag of [
    '// @require https://cdn.example.test/lib.js',
    '// @resource icon https://cdn.example.test/icon.png',
    '// @connect api.example.test',
    '// @updateURL https://cdn.example.test/script.meta.js',
    '// @downloadURL https://cdn.example.test/script.user.js',
    '// @inject-into page'
  ]){
    const changed=source.replace('// @grant none',tag+'\n// @grant none');
    const request={
      ...patch,source:changed,
      expectedSourceSha256:createHash('sha256').update(changed).digest('hex'),
      callOffset:changed.indexOf('document.querySelector')
    };
    const linked={...scenario,scriptSha256:request.expectedSourceSha256};
    const result=proposeFromReadOnlyDomDiagnostic(request,linked,series(),true);
    assert.equal(result.status,'BLOCKED',tag);
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal('candidateSource' in result,false);
  }
});

test('TEST-019: @include and @exclude precedence cannot silently authorize a candidate',()=>{
  for(const extra of [
    '// @exclude https://example.com/*\n',
    '// @exclude-match https://example.com/*\n',
    '// @include https://example.com/*\n'
  ]){
    const changed=source.replace('// @grant none',extra+'// @grant none');
    const edited={
      ...patch,source:changed,
      expectedSourceSha256:createHash('sha256').update(changed).digest('hex'),
      callOffset:changed.indexOf('document.querySelector')
    };
    const linked={...scenario,scriptSha256:edited.expectedSourceSha256};
    const result=proposeFromReadOnlyDomDiagnostic(edited,linked,series(),true);
    assert.equal(result.status,'BLOCKED',extra);
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal('candidateSource' in result,false);
  }
});
