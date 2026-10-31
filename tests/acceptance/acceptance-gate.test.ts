import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {proposeLiteralSelectorPatch, type LiteralPatchRequest} from '../../src/repair/patch-planner';
import {assessLocalAcceptancePreflight} from '../../src/acceptance/acceptance-gate';

const source=[
  '// ==UserScript==',
  '// @name Consent-only example',
  '// @match https://example.com/*',
  '// @grant none',
  '// ==/UserScript==',
  "document.querySelector('#old');",
  ''
].join('\n');
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const request:LiteralPatchRequest={
  source,expectedSourceSha256:sha(source),
  callOffset:source.indexOf('document.querySelector'),
  method:'querySelector',originalSelector:'#old',
  replacementSelector:'#new',faultEvidenceId:'scenario_assertion_1'
};
const candidate=proposeLiteralSelectorPatch(request);
assert.equal(candidate.status,'CANDIDATE_ONLY');
const opts={userApproved:true,diskSourceSha256:request.expectedSourceSha256};

test('TEST-021: a correctly reviewed local diff still cannot authorize a write or claim business recovery',()=>{
  const result=assessLocalAcceptancePreflight(request,candidate,opts);
  assert.equal(result.status,'AWAITING_TRUSTED_RUNTIME_AND_BACKUP');
  assert.equal(result.automaticPatchAllowed,false);
  assert.equal(result.tampermonkeyVerified,false);
  assert.equal(result.businessRecoveredVerified,false);
  assert.equal('candidateSource' in result,false);
  assert.equal('source' in result,false);
  if(result.status==='AWAITING_TRUSTED_RUNTIME_AND_BACKUP'){
    assert.equal(result.originalSha256,sha(source));
    assert.equal(result.candidateSha256,candidate.status==='CANDIDATE_ONLY'?candidate.candidateSha256:'');
    assert.equal(result.faultEvidenceId,'scenario_assertion_1');
  }
});

test('TEST-021: explicit consent and exact current source hash are mandatory',()=>{
  for(const bad of [
    {...opts,userApproved:false},
    {...opts,userApproved:'yes'},
    {...opts,diskSourceSha256:'0'.repeat(64)},
    {...opts,diskSourceSha256:request.expectedSourceSha256.toUpperCase()},
    {userApproved:true},
    null
  ]){
    const result=assessLocalAcceptancePreflight(request,candidate,bad);
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.automaticPatchAllowed,false);
  }
});

test('TEST-021: self-reported manager, GM and business assertions are never trusted evidence',()=>{
  for(const forged of [
    {...opts,runtimeEvidence:{tampermonkeyVerified:true,gmApiVerified:true,businessVerified:true}},
    {...opts,runtimeEvidence:false},
    {...opts,automaticPatchAllowed:true},
    {...opts,verified:true}
  ]){
    const result=assessLocalAcceptancePreflight(request,candidate,forged);
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal(result.tampermonkeyVerified,false);
  }
});

test('TEST-019/021: tampered candidate hashes, text, approval claims and extra fields fail closed',()=>{
  if(candidate.status!=='CANDIDATE_ONLY')return;
  for(const forged of [
    {...candidate,candidateSha256:'0'.repeat(64)},
    {...candidate,candidateSource:candidate.candidateSource+'// extra'},
    {...candidate,automaticPatchAllowed:true},
    {...candidate,tampermonkeyVerified:true},
    {...candidate,businessRecoveredVerified:true},
    {...candidate,secret:'leak'},
    {...candidate,change:{...candidate.change,after:'"#unexpected"'}}
  ]){
    const result=assessLocalAcceptancePreflight(request,forged,opts);
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal('candidateSource' in result,false);
  }
});

test('TEST-021: malformed, hostile inputs never produce approval or disclose raw source',()=>{
  const poisoned={get userApproved(){throw Error('private selector and token');}};
  const evil=Object.create(null) as Record<string,unknown>;
  Object.defineProperty(evil,'userApproved',{get(){throw Error('secret');},enumerable:true});
  for(const [r,c,o] of [
    [request,candidate,poisoned],
    [request,candidate,evil],
    [request,Object.create({status:'CANDIDATE_ONLY'}),opts],
    [request,null,opts],
    [{...request,source:source+'// changed'},candidate,opts],
    [null,candidate,opts]
  ] as const){
    const result=assessLocalAcceptancePreflight(r as LiteralPatchRequest,c,o);
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal(JSON.stringify(result).includes('private selector'),false);
    assert.equal(JSON.stringify(result).includes('Consent-only example'),false);
  }
});

test('TASK-010/TEST-021/026: acceptance request must be own plain data without executing accessors',()=>{
  let getterCalls=0;
  const accessorHash={...request};
  Object.defineProperty(accessorHash,'expectedSourceSha256',{
    enumerable:true,
    get(){getterCalls++;return request.expectedSourceSha256;}
  });
  const accessorSource={...request};
  Object.defineProperty(accessorSource,'source',{
    enumerable:true,
    get(){getterCalls++;return source;}
  });
  const inherited=Object.create(request) as LiteralPatchRequest;
  const extraSymbol=Object.assign({...request},{[Symbol('unexpected')]:true});
  for(const input of [accessorHash,accessorSource,inherited,extraSymbol]){
    const outcome=assessLocalAcceptancePreflight(input,candidate,opts);
    assert.equal(outcome.status,'BLOCKED',
      'untrusted request must not pass the local acceptance boundary');
    assert.equal(outcome.automaticPatchAllowed,false);
  }
  assert.equal(getterCalls,0,
    'untrusted request getters must not run in the acceptance preflight');
});


test('TASK-010/TEST-018/021/026: reject object-valued evidence IDs before implicit coercion',()=>{
  // A plain request can carry an object-valued data property. The lower-level
  // planner's RegExp.test would coerce the value and run attacker JavaScript;
  // the acceptance boundary must refuse it before any such coercion.
  let coercions=0;
  const forgedIds:unknown[]=[
    {toString(){coercions++;return 'scenario_assertion_1';}},
    {[Symbol.toPrimitive](){coercions++;throw Error('PRIVATE_EVIDENCE_ID');}}
  ];
  for(const faultEvidenceId of forgedIds){
    const hostile={...request,faultEvidenceId} as unknown as LiteralPatchRequest;
    const result=assessLocalAcceptancePreflight(hostile,candidate,opts);
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal(result.tampermonkeyVerified,false);
    assert.equal(result.businessRecoveredVerified,false);
    assert.equal(JSON.stringify(result).includes('PRIVATE_EVIDENCE_ID'),false);
  }
  assert.equal(coercions,0,'never execute attacker-controlled evidence ID coercion');
});
