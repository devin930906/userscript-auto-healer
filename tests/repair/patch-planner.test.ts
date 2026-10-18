import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {proposeLiteralSelectorPatch,type LiteralPatchRequest} from '../../src/repair/patch-planner';

const meta='// ==UserScript==\n// @name Repair test\n// @match https://example.com/*\n// @grant GM_getValue\n// ==/UserScript==\n';
const hash=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
const source=meta+
  'const unrelated = "#old"; // do not rewrite this text\n'+
  "const node = document.querySelector('#old');\n"+
  "const second = document.querySelector('#other');\n";
function request(
  text=source,overrides:Partial<LiteralPatchRequest>={}
):LiteralPatchRequest{
  return {
    source:text,expectedSourceSha256:hash(text),
    callOffset:text.indexOf('document.querySelector'),
    method:'querySelector',originalSelector:'#old',
    replacementSelector:'#new',faultEvidenceId:'scenario_assertion_1',
    ...overrides
  };
}

test('TEST-014: a unique literal selector yields ONLY an AST-anchored local candidate',()=>{
  const result=proposeLiteralSelectorPatch(request());
  assert.equal(result.status,'CANDIDATE_ONLY');
  assert.equal(result.automaticPatchAllowed,false);
  assert.equal(result.tampermonkeyVerified,false);
  assert.equal(result.businessRecoveredVerified,false);
  if(result.status!=='CANDIDATE_ONLY')return;
  assert.equal(result.reason,'REQUIRES_REAL_MANAGER_AND_BUSINESS_VALIDATION');
  assert.equal(result.originalSha256,hash(source));
  assert.equal(result.candidateSha256,hash(result.candidateSource));
  assert.equal(result.faultEvidenceId,'scenario_assertion_1');
  assert.equal(result.change.before,"'#old'");
  assert.equal(result.change.after,'"#new"');
  assert.equal(result.candidateSource.slice(0,meta.length),meta);
  assert.ok(result.candidateSource.includes('const unrelated = "#old"'));
  assert.ok(result.candidateSource.includes('document.querySelector("#new")'));
  assert.ok(result.candidateSource.includes("document.querySelector('#other')"));
  assert.equal(
    source.slice(0,result.change.start)+result.change.after+
    source.slice(result.change.end),result.candidateSource
  );
  assert.equal(Object.isFrozen(result),true);
  assert.equal(Object.isFrozen(result.change),true);
});

test('TEST-019: source SHA, evidence ID, site identity and metadata are mandatory',()=>{
  const invalid=[
    request(source,{expectedSourceSha256:'0'.repeat(64)}),
    request(source,{expectedSourceSha256:hash(source).toUpperCase()}),
    request(source,{faultEvidenceId:'https://private.invalid?token=secret'}),
    request(source,{callOffset:source.indexOf('document.querySelector')+1}),
    request(source,{originalSelector:'#other'}),
    request(source,{method:'querySelectorAll'}),
    request(source,{replacementSelector:'#old'})
  ];
  for(const item of invalid){
    const result=proposeLiteralSelectorPatch(item);
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal('candidateSource' in result,false);
    assert.equal(JSON.stringify(result).includes('secret'),false);
  }
  const noHeader="document.querySelector('#old');";
  assert.equal(proposeLiteralSelectorPatch(request(noHeader)).status,'BLOCKED');
  const withinMeta=meta.replace('// @name Repair test',
    "// @name document.querySelector('#old')");
  assert.equal(proposeLiteralSelectorPatch(request(withinMeta)).status,'BLOCKED');
});

test('TEST-014: complex/new selectors and injection-looking strings fail closed',()=>{
  for(const replacementSelector of [
    '', '#new target', '#new, body', '[data-token]',':has(*)',
    '#new\n// @grant GM_xmlhttpRequest', '#a" ); evil(); //',
    '.'.concat('z'.repeat(200)), '__proto__', 'body'
  ]){
    const result=proposeLiteralSelectorPatch(request(source,{replacementSelector}));
    assert.equal(result.status,'BLOCKED',replacementSelector);
    assert.equal(result.automaticPatchAllowed,false);
  }
});

test('TEST-014: dynamic, computed and unrelated methods are not patched',()=>{
  for(const [text,offsetHint] of [
    [meta+"document.querySelector(target);", 'document.querySelector'],
    [meta+"document['querySelector']('#old');", "document['querySelector']"],
    [meta+"shadow.querySelector('#old');", 'shadow.querySelector'],
    [meta+"document.getElementById('old');", 'document.getElementById'],
    [meta+"document.querySelector('#old') || document.querySelector('#backup');",
      'document.querySelector']
  ]as const){
    const result=proposeLiteralSelectorPatch(request(text,{
      callOffset:text.indexOf(offsetHint)
    }));
    assert.equal(result.status,'BLOCKED',offsetHint);
    assert.equal(result.automaticPatchAllowed,false);
  }
});

test('TEST-014: exact call location prevents replacing repeated selectors globally',()=>{
  const repeated=meta+
    "document.querySelector('#old');\n"+
    "document.querySelector('#old');\n";
  const first=repeated.indexOf('document.querySelector');
  const second=repeated.indexOf('document.querySelector',first+1);
  const result=proposeLiteralSelectorPatch(request(repeated,{callOffset:second}));
  assert.equal(result.status,'CANDIDATE_ONLY');
  if(result.status==='CANDIDATE_ONLY'){
    assert.equal(result.candidateSource.match(/querySelector\('#old'\)/g)?.length,1);
    assert.equal(result.candidateSource.match(/querySelector\("#new"\)/g)?.length,1);
    assert.ok(result.change.start>second);
  }
});

test('TEST-019: syntactically invalid source cannot produce a patch',()=>{
  const broken=meta+"document.querySelector('#old');\nfunction (";
  const result=proposeLiteralSelectorPatch(request(broken));
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.automaticPatchAllowed,false);
  assert.equal('candidateSource' in result,false);
});

test('TEST-019: malformed inputs and unsafe diagnostic getters never produce patch',()=>{
  const hostile={
    get source(){throw new Error('secret must not be surfaced');}
  }as unknown as LiteralPatchRequest;
  const huge=meta+" ".repeat(8*1024*1024);
  for(const bad of [
    null,{},hostile,request(source,{faultEvidenceId:''}),
    request(source,{callOffset:-1}),request(huge)
  ]){
    const result=proposeLiteralSelectorPatch(bad as LiteralPatchRequest);
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal('candidateSource' in result,false);
    assert.equal(JSON.stringify(result).includes('secret'),false);
  }
});
