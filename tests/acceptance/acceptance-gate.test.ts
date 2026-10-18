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
