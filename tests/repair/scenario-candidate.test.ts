import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {proposeFromReadOnlyDomDiagnostic} from '../../src/repair/scenario-candidate';
import {summarizeReadOnlyScenarioDomSeries} from '../../src/diagnostics/scenario-dom-diagnostic';
import type {LiteralPatchRequest} from '../../src/repair/patch-planner';
import type {ScenarioInput} from '../../src/scenarios/scenario-registry';
import type {DomSummary} from '../../src/observe/dom-observer';

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
test('TEST-019/026: diagnostic request rejects extra authority claims at its own boundary',()=>{
  const cases:unknown[]=[
    {...patch,automaticPatchAllowed:true},
    {...patch,businessRecoveredVerified:true},
    {...patch,[Symbol('privileged')]:true}
  ];
  for(const bad of cases){
    const result=proposeFromReadOnlyDomDiagnostic(
      bad as LiteralPatchRequest,scenario,series(),true);
    assert.equal(result.status,'BLOCKED');
    if(result.status==='BLOCKED')
      assert.equal(result.reason,'INVALID_SCENARIO_LINK');
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal('candidateSource' in result,false);
  }
  // Exact, descriptor-backed inputs remain eligible for review only.
  const frozen=Object.freeze({...patch});
  const noProto=Object.assign(Object.create(null),patch) as LiteralPatchRequest;
  for(const valid of [frozen,noProto]){
    const result=proposeFromReadOnlyDomDiagnostic(valid,scenario,series(),true);
    assert.equal(result.status,'CANDIDATE_ONLY');
    assert.equal(result.automaticPatchAllowed,false);
  }
});

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

test('TEST-019/026: a detected iframe or shadow subtree blocks incomplete-scope repair candidates',()=>{
  const complete=series();
  const cases:{name:string;summary:DomSummary}[]=[
    {name:'iframe content is outside the top-level selector inventory',summary:{
      elementCount:4,iframeCount:1,visibleShadowRoots:0,
      blindSpots:['CLOSED_SHADOW_ROOT_UNKNOWN','IFRAME_CONTENT_UNVERIFIED']}},
    {name:'visible shadow subtree has a distinct selector scope',summary:{
      elementCount:4,iframeCount:0,visibleShadowRoots:1,
      blindSpots:['CLOSED_SHADOW_ROOT_UNKNOWN']}},
    {name:'cross-origin iframe remains unverified',summary:{
      elementCount:4,iframeCount:1,visibleShadowRoots:0,
      blindSpots:['CLOSED_SHADOW_ROOT_UNKNOWN','IFRAME_CONTENT_UNVERIFIED',
        'CROSS_ORIGIN_FRAME_UNVERIFIED']}}
  ];
  // Read-only diagnostics remain usable; only escalating an unverified
  // top-level selector absence to a patch candidate is restricted.
  for(const entry of cases){
    const incomplete={...complete,samples:complete.samples.map(sample=>({
      ...sample,summary:entry.summary
    }))};
    const observation=summarizeReadOnlyScenarioDomSeries(
      scenario,incomplete,true);
    assert.equal(observation.status,'LIMITED_DOM_SIGNAL_ONLY',entry.name);
    const candidate=proposeFromReadOnlyDomDiagnostic(
      patch,scenario,incomplete,true);
    assert.equal(candidate.status,'BLOCKED',entry.name);
    if(candidate.status==='BLOCKED')
      assert.equal(String(candidate.reason),'INCOMPLETE_DOM_COVERAGE',entry.name);
    assert.equal(candidate.automaticPatchAllowed,false,entry.name);
    assert.equal('candidateSource' in candidate,false,entry.name);
  }
});

test('TEST-019: unobservable closed-shadow possibility alone must not disable all review-only candidates',()=>{
  // The real CDP DOM summary always includes this conservative unknown
  // marker; it does not establish a detected shadow root on the page.
  const base=series();
  const samples=base.samples.map(s=>({
    ...s,summary:{...s.summary,
      blindSpots:['CLOSED_SHADOW_ROOT_UNKNOWN'] as const}
  }));
  const observed={...base,samples};
  assert.equal(summarizeReadOnlyScenarioDomSeries(scenario,observed,true).status,
    'LIMITED_DOM_SIGNAL_ONLY');
  const result=proposeFromReadOnlyDomDiagnostic(patch,scenario,observed,true);
  assert.equal(result.status,'CANDIDATE_ONLY');
  assert.equal(result.automaticPatchAllowed,false);
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

test('TASK-009/TEST-019/026: unverified manager execution wrappers and external icons block DOM-only review',()=>{
  // A static selector hit cannot verify manager injection context or
  // network-loaded metadata resources. No candidate is eligible here.
  for(const tag of [
    '// @unwrap',
    '// @icon https://assets.example.invalid/logo.png',
    '// @icon64 https://assets.example.invalid/logo-large.png'
  ]){
    const changed=source.replace('// @grant none',tag+'\\n// @grant none'.replace('\\n','\n'));
    const request={...patch,source:changed,
      expectedSourceSha256:createHash('sha256').update(changed).digest('hex'),
      callOffset:changed.indexOf('document.querySelector')};
    const linked={...scenario,scriptSha256:request.expectedSourceSha256};
    const result=proposeFromReadOnlyDomDiagnostic(request,linked,series(),true);
    assert.equal(result.status,'BLOCKED',tag);
    assert.equal(result.automaticPatchAllowed,false,tag);
    assert.equal('candidateSource' in result,false,tag);
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

test('TEST-019/026: hostile scenario getters and forged fields never enter the candidate gate',()=>{
 let invoked=0;
 const maliciousApproval={...scenario};
 Object.defineProperty(maliciousApproval,'userApproved',{
  enumerable:true,get(){invoked++;return true;}
 });
 const maliciousRows={...scenario,assertions:[...scenario.assertions]};
 Object.defineProperty(maliciousRows.assertions,'0',{
  enumerable:true,configurable:true,get(){invoked++;return scenario.assertions[0];}
 });
 const maliciousUrl={...scenario};
 Object.defineProperty(maliciousUrl,'targetUrl',{
  enumerable:true,get(){invoked++;return 'https://example.com/';}
 });
 for(const input of [
  maliciousApproval,maliciousRows,maliciousUrl,
  {...scenario,automaticPatchAllowed:true},
  {...scenario,assertions:[...scenario.assertions,].concat([]).map((row,i)=>
   i===0?{...row,unexpectedAuthority:true}:row)}
 ]){
  const result=proposeFromReadOnlyDomDiagnostic(patch,input,series(),true);
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.automaticPatchAllowed,false);
  assert.equal('candidateSource' in result,false);
 }
 assert.equal(invoked,0,'no untrusted scenario accessor may execute');
});

test('TEST-019/026: one consented DOM origin cannot review a multi-origin userscript',()=>{
  // The old predicate only required SOME @match line to match. A second
  // unobserved site or a different path remains outside the DOM evidence.
  for(const otherMatch of [
    '// @match https://unobserved.example/*',
    '// @match http://example.com/*',
    '// @match https://example.com/private/*',
    '// @match *://*/*'
  ]){
    const multiSource=source.replace('// @grant none',
      otherMatch+'\n// @grant none');
    const request={...patch,source:multiSource,
      expectedSourceSha256:createHash('sha256').update(multiSource).digest('hex'),
      callOffset:multiSource.indexOf('document.querySelector')};
    const observedScenario={...scenario,scriptSha256:request.expectedSourceSha256};
    const result=proposeFromReadOnlyDomDiagnostic(
      request,observedScenario,series(),true);
    assert.equal(result.status,'BLOCKED',otherMatch);
    assert.equal(result.automaticPatchAllowed,false,otherMatch);
    assert.equal('candidateSource' in result,false,otherMatch);
  }
  // Multiple explicitly scoped patterns that BOTH match the same observed
  // target remain eligible for human review (never automatic application).
  const redundantSource=source.replace('// @grant none',
    '// @match https://example.com/\n// @grant none');
  const request={...patch,source:redundantSource,
    expectedSourceSha256:createHash('sha256').update(redundantSource).digest('hex'),
    callOffset:redundantSource.indexOf('document.querySelector')};
  const result=proposeFromReadOnlyDomDiagnostic(
    request,{...scenario,scriptSha256:request.expectedSourceSha256},series(),true);
  assert.equal(result.status,'CANDIDATE_ONLY');
  assert.equal(result.automaticPatchAllowed,false);
});

test('TEST-019/026: DOM repair candidate rejects request Proxy and getters before reflection',()=>{
  let executed=0;
  const hostileProxy=new Proxy({...patch},{
    get(){executed++;throw Error('untrusted request read');},
    getPrototypeOf(){executed++;throw Error('untrusted prototype');},
    ownKeys(){executed++;throw Error('untrusted keys');},
    getOwnPropertyDescriptor(){executed++;throw Error('untrusted descriptor');}
  });
  const revoked=Proxy.revocable({...patch},{});
  revoked.revoke();
  const hostileGetter={...patch};
  Object.defineProperty(hostileGetter,'expectedSourceSha256',{
    enumerable:true,
    get(){executed++;return hash;}
  });
  const nestedGetter={...patch};
  Object.defineProperty(nestedGetter,'originalSelector',{
    enumerable:true,
    get(){executed++;return '#old';}
  });
  for(const request of [hostileProxy,revoked.proxy,hostileGetter,nestedGetter]){
    const result=proposeFromReadOnlyDomDiagnostic(
      request,scenario,series(),true);
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal('candidateSource' in result,false);
  }
  assert.equal(executed,0,'request reflection must not execute caller code');
});


test('TASK-009/TEST-019/026: mutable/accessor DOM evidence cannot be laundered into a candidate',()=>{
 let executed=0;
 const forbidden=():never=>{
  executed++;throw Error('UNTRUSTED_DOM_ACCESSOR_MUST_NOT_RUN');
 };
 const topAccessor={...series()};
 Object.defineProperty(topAccessor,'samples',{
  enumerable:true,get:forbidden
 });
 const nestedSummary={...sample()};
 Object.defineProperty(nestedSummary,'summary',{
  enumerable:true,get:forbidden
 });
 const nestedCounts={...sample()};
 Object.defineProperty(nestedCounts,'selectorCounts',{
  enumerable:true,get:forbidden
 });
 const slotArray=series().samples.slice();
 Object.defineProperty(slotArray,'0',{enumerable:true,configurable:true,get:forbidden});
 const getterArray={...series(),samples:slotArray};
 const customIterator=series().samples.slice();
 Object.defineProperty(customIterator,Symbol.iterator,{get:forbidden});
 const proxy=new Proxy(series(),{
  get:forbidden,getPrototypeOf:forbidden,
  ownKeys:forbidden,getOwnPropertyDescriptor:forbidden
 });
 const nestedProxy=new Proxy({...sample().summary},{
  get:forbidden,getPrototypeOf:forbidden,
  ownKeys:forbidden,getOwnPropertyDescriptor:forbidden
 });
 const revoked=Proxy.revocable(series(),{get:forbidden});revoked.revoke();
 const hostileCounts={...sample()};
 hostileCounts.selectorCounts=new Proxy({...sample().selectorCounts},{
  get:forbidden,getPrototypeOf:forbidden,
  ownKeys:forbidden,getOwnPropertyDescriptor:forbidden
 });
 const invalid=[
  topAccessor,
  {...series(),samples:[nestedSummary,sample(0,1,'2026-10-18T00:00:01Z')]},
  {...series(),samples:[nestedCounts,sample(0,1,'2026-10-18T00:00:01Z')]},
  getterArray,
  {...series(),samples:customIterator},
  proxy,revoked.proxy,
  {...series(),samples:[{...sample(),summary:nestedProxy},sample(0,1,'2026-10-18T00:00:01Z')]},
  {...series(),samples:[hostileCounts,sample(0,1,'2026-10-18T00:00:01Z')]},
  {...series(),samples:[{...sample(),extraAuthority:true},sample(0,1,'2026-10-18T00:00:01Z')]},
  {...series(),samples:[{...sample(),selectorCounts:{'#old':0,'#new':1,extra:99}},
    sample(0,1,'2026-10-18T00:00:01Z')]}
 ];
 for(const observation of invalid){
  const decision=proposeFromReadOnlyDomDiagnostic(
   patch,scenario,observation,true);
  assert.equal(decision.status,'BLOCKED');
  assert.equal(decision.automaticPatchAllowed,false);
  assert.equal('candidateSource' in decision,false);
 }
 assert.equal(executed,0,'untrusted DOM getters/iterators/Proxy traps were never executed');
 // Preserve the actual existing, review-only happy path.
 assert.equal(proposeFromReadOnlyDomDiagnostic(
  patch,scenario,series(),true).status,'CANDIDATE_ONLY');
});

test('TASK-009/TEST-019/026: a mutating DOM sample getter cannot change scope after validation',()=>{
 let reads=0;
 const changing={...series()};
 Object.defineProperty(changing,'samples',{enumerable:true,get(){
  reads++;
  if(reads===1)return series().samples;
  return series().samples.map(item=>({
   ...item,summary:{elementCount:4,iframeCount:1,visibleShadowRoots:0,
    blindSpots:['IFRAME_CONTENT_UNVERIFIED']}
  }));
 }});
 const result=proposeFromReadOnlyDomDiagnostic(patch,scenario,changing,true);
 assert.equal(result.status,'BLOCKED');
 assert.equal(result.automaticPatchAllowed,false);
 assert.equal('candidateSource' in result,false);
 assert.equal(reads,0,'never read caller-owned getter before or after DOM validation');
});
