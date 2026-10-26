import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {proposeLiteralSelectorPatch,auditProposedLiteralSelectorPatch,type LiteralPatchRequest} from '../../src/repair/patch-planner';

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

test('TEST-019: non-leading or disguised userscript headers cannot authorize candidates',()=>{
  const body="document.querySelector('#old');";
  const invalidSources=[
    'const bootstrap=true;\n'+meta+body,
    '// unrelated leading comment\n'+meta+body,
    '/* unrelated leading block */\n'+meta+body,
    'function bootstrap(){}\n'+meta+body,
    '// ==UserScript==\n// @name incomplete\n'+body,
    'const sourceText='+JSON.stringify(meta)+';\n'+body
  ];
  for(const bad of invalidSources){
    const result=proposeLiteralSelectorPatch(request(bad,{
      callOffset:bad.lastIndexOf('document.querySelector')
    }));
    assert.equal(result.status,'BLOCKED',bad.slice(0,80));
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal('candidateSource' in result,false);
  }
  // Canonical metadata may follow blank lines, but not executable code.
  const leadingBlank='\n\n'+meta+body;
  const valid=proposeLiteralSelectorPatch(request(leadingBlank,{
    callOffset:leadingBlank.indexOf('document.querySelector')
  }));
  assert.equal(valid.status,'CANDIDATE_ONLY');
  assert.equal(valid.automaticPatchAllowed,false);
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

test('TEST-019: shadowed or reassigned document never yields a DOM patch candidate',()=>{
  for(const snippet of [
    "function run(document) { return document.querySelector('#old'); }",
    "function run() { const document = {querySelector(){return null}}; return document.querySelector('#old'); }",
    "const {document} = globalThis; document.querySelector('#old');",
    "const [document] = []; document.querySelector('#old');",
    "document = anotherDocument; document.querySelector('#old');",
    "for (document of [fakeDocument]) { document.querySelector('#old'); }",
    "for (document in {key:1}) { document.querySelector('#old'); }",
    "for ([document] of [[fakeDocument]]) { document.querySelector('#old'); }",
    "for ({document} of [{document:fakeDocument}]) { document.querySelector('#old'); }",
    "with (window) { document.querySelector('#old'); }",
    "eval('var document = null'); document.querySelector('#old');"
  ]){
    const script=meta+snippet;
    const result=proposeLiteralSelectorPatch(request(script,{
      callOffset:script.indexOf('document.querySelector')
    }));
    assert.equal(result.status,'BLOCKED',snippet);
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal('candidateSource' in result,false);
  }
  const normal=meta+"function run(node) { return document.querySelector('#old'); }";
  assert.equal(proposeLiteralSelectorPatch(request(normal,{
    callOffset:normal.indexOf('document.querySelector')
  })).status,'CANDIDATE_ONLY');
});

test('TEST-019/026: modified DOM selector methods cannot yield an offline repair candidate',()=>{
  for(const snippet of [
    "document.querySelector = () => null; document.querySelector('#old');",
    "document['querySelector'] = customQuery; document.querySelector('#old');",
    "delete document.querySelector; document.querySelector('#old');",
    "document[methodName] = customQuery; document.querySelector('#old');",
    "document.querySelectorAll = customQuery; document.querySelector('#old');"
  ]){
    const script=meta+snippet;
    const result=proposeLiteralSelectorPatch(request(script,{
      callOffset:script.lastIndexOf('document.querySelector(')
    }));
    assert.equal(result.status,'BLOCKED',snippet);
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal('candidateSource' in result,false);
  }
  const unrelated=meta+"document.title = 'ok'; document.querySelector('#old');";
  assert.equal(proposeLiteralSelectorPatch(request(unrelated,{
    callOffset:unrelated.lastIndexOf('document.querySelector(')
  })).status,'CANDIDATE_ONLY');
});

test('TASK-009/TEST-019/026: reflective document selector mutation blocks offline candidate',()=>{
  for(const snippet of [
    "Object.defineProperty(document,'querySelector',{value:()=>null});",
    "Object.defineProperties(document,{querySelector:{value:()=>null}});",
    "Object.assign(document,{querySelector:()=>null});",
    "Reflect.set(document,'querySelector',()=>null);",
    "Reflect.defineProperty(document,'querySelector',{value:()=>null});",
    "Object.setPrototypeOf(document,{querySelector:()=>null});",
    "Reflect['set'](document,'querySelector',()=>null);",
    "Object[operation](document,'querySelector',()=>null);"
  ]){
    const script=meta+snippet+" document.querySelector('#old');";
    const result=proposeLiteralSelectorPatch(request(script,{
      callOffset:script.lastIndexOf('document.querySelector(')
    }));
    assert.equal(result.status,'BLOCKED',snippet);
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal('candidateSource' in result,false);
  }
  // Calls on unrelated targets do not mutate document's selector method.
  const control=meta+
    "Object.defineProperty(other,'querySelector',{value:()=>null});"+
    " Object.keys(document); document.querySelector('#old');";
  assert.equal(proposeLiteralSelectorPatch(request(control,{
    callOffset:control.lastIndexOf('document.querySelector(')
  })).status,'CANDIDATE_ONLY');
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


test('TEST-019/026: planner refuses executable getters and identity-shifting request objects before any read',()=>{
 const original=request();
 const candidate=proposeLiteralSelectorPatch(original);
 assert.equal(candidate.status,'CANDIDATE_ONLY');
 if(candidate.status!=='CANDIDATE_ONLY')return;
 let getterCalls=0,proxyTraps=0;
 const attacker=(field:keyof LiteralPatchRequest):LiteralPatchRequest=>{
  const bad={...original};
  Object.defineProperty(bad,field,{
   enumerable:true,configurable:true,
   get(){getterCalls++;return original[field];}
  });
  return bad;
 };
 const inputCases:unknown[]=[
  ...(['source','expectedSourceSha256','callOffset','method','originalSelector',
     'replacementSelector','faultEvidenceId'] as (keyof LiteralPatchRequest)[])
     .map(attacker),
  {...original,automaticPatchAllowed:true},
  {...original,[Symbol('secret')]:true},
  Object.assign(Object.create({inherited:true}),original),
  (()=>{const nullPrototype=Object.assign(Object.create(null),original);
   Object.defineProperty(nullPrototype,'replacementSelector',{
    enumerable:true,get(){getterCalls++;return '#new';}
   });
   return nullPrototype;
  })(),
  Object.fromEntries(Object.entries(original).filter(([key])=>key!=='method')),
  [original],
  new (class {source=original.source;})()
 ];
 const hostile=new Proxy({...original},{
  get(){proxyTraps++;throw Error('proxy get');},
  ownKeys(){proxyTraps++;throw Error('proxy keys');},
  getPrototypeOf(){proxyTraps++;throw Error('proxy prototype');},
  getOwnPropertyDescriptor(){proxyTraps++;throw Error('proxy descriptor');}
 });
 const revoked=Proxy.revocable({...original},{});
 revoked.revoke();
 inputCases.push(hostile,revoked.proxy);
 for(const [index,bad] of inputCases.entries()){
  const proposal=proposeLiteralSelectorPatch(bad as LiteralPatchRequest);
  assert.equal(proposal.status,'BLOCKED','proposal '+index);
  assert.equal(proposal.automaticPatchAllowed,false);
  assert.equal('candidateSource' in proposal,false);
  const review=auditProposedLiteralSelectorPatch(bad as LiteralPatchRequest,candidate);
  assert.equal(review.status,'BLOCKED','audit '+index);
  assert.equal(review.automaticPatchAllowed,false);
 }
 assert.equal(getterCalls,0,'no caller getter may execute during patch planning');
 assert.equal(proxyTraps,0,'no Proxy trap may execute during patch planning');
 const noProto=Object.assign(Object.create(null),original) as LiteralPatchRequest;
 assert.equal(proposeLiteralSelectorPatch(noProto).status,'CANDIDATE_ONLY');
 const frozen=Object.freeze({...original});
 assert.equal(proposeLiteralSelectorPatch(frozen).status,'CANDIDATE_ONLY');
 assert.equal(auditProposedLiteralSelectorPatch(frozen,candidate).status,'REVIEWABLE_ONLY');
});

test('TEST-019: independent local audit re-generates one permitted AST diff only',()=>{
  const req=request();
  const candidate=proposeLiteralSelectorPatch(req);
  assert.equal(candidate.status,'CANDIDATE_ONLY');
  const review=auditProposedLiteralSelectorPatch(req,candidate);
  assert.equal(review.status,'REVIEWABLE_ONLY');
  assert.equal(review.automaticPatchAllowed,false);
  assert.equal(review.tampermonkeyVerified,false);
  assert.equal(review.businessRecoveredVerified,false);
  assert.equal('candidateSource' in review,false);
  assert.equal('before' in review,false);
  assert.equal(Object.isFrozen(review),true);
  if(candidate.status==='CANDIDATE_ONLY'&&review.status==='REVIEWABLE_ONLY'){
    assert.equal(review.originalSha256,hash(source));
    assert.equal(review.candidateSha256,hash(candidate.candidateSource));
    assert.deepEqual(review.change,{
      start:candidate.change.start,end:candidate.change.end
    });
    // The review boundary also works for a serialized message from a worker.
    assert.equal(auditProposedLiteralSelectorPatch(
      req,JSON.parse(JSON.stringify(candidate))).status,'REVIEWABLE_ONLY');
    assert.equal(Object.isFrozen(review.change),true);
  }
});

test('TEST-019: altered source, hashes, diff and privilege flags are rejected',()=>{
  const req=request();
  const generated=proposeLiteralSelectorPatch(req);
  assert.equal(generated.status,'CANDIDATE_ONLY');
  if(generated.status!=='CANDIDATE_ONLY')return;
  const edit=(mutation:Record<string,unknown>)=>
    auditProposedLiteralSelectorPatch(req,{...generated,...mutation});
  for(const altered of [
    {candidateSource:generated.candidateSource.replace(
      '// @grant GM_getValue','// @grant GM_xmlhttpRequest')},
    {candidateSource:generated.candidateSource+'// injected trailing code'},
    {candidateSha256:'0'.repeat(64)},
    {originalSha256:'f'.repeat(64)},
    {faultEvidenceId:'unknown_evidence'},
    {status:'VERIFIED'},
    {reason:'ALREADY_VERIFIED'},
    {automaticPatchAllowed:true},
    {tampermonkeyVerified:true},
    {businessRecoveredVerified:true},
    {change:{...generated.change,after:'"arbitrary"'}},
    {change:{...generated.change,start:generated.change.start+1}},
    {change:{...generated.change,end:generated.change.end+1}}
  ]){
    const result=edit(altered);
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal('candidateSource' in result,false);
  }
  assert.equal(auditProposedLiteralSelectorPatch(
    req,{...generated,approved:true}).status,'BLOCKED');
  assert.equal(auditProposedLiteralSelectorPatch(
    req,{...generated,change:{...generated.change,grantPermission:true}}
  ).status,'BLOCKED');
});

test('TEST-019: stale inputs and malformed or hostile receipts fail closed',()=>{
  const req=request();
  const generated=proposeLiteralSelectorPatch(req);
  assert.equal(generated.status,'CANDIDATE_ONLY');
  if(generated.status!=='CANDIDATE_ONLY')return;
  assert.equal(auditProposedLiteralSelectorPatch({
    ...req,source:source+'//changed'
  },generated).status,'BLOCKED');
  assert.deepEqual(auditProposedLiteralSelectorPatch({
    ...req,expectedSourceSha256:'0'.repeat(64)
  },generated),{
    status:'BLOCKED',reason:'PLANNER_REJECTED',automaticPatchAllowed:false,
    tampermonkeyVerified:false,businessRecoveredVerified:false
  });
  const contaminated=Object.create({status:'CANDIDATE_ONLY'});
  Object.assign(contaminated,generated);
  const throwingGetter={...generated};
  Object.defineProperty(throwingGetter,'candidateSource',{
    enumerable:true,get(){throw Error('secret user data');}
  });
  const hostileProxy=new Proxy({...generated},{
    ownKeys(){throw Error('private metadata');}
  });
  const hostileChange={...generated,change:{
    get start(){throw Error('private input');},
    end:generated.change.end,before:generated.change.before,
    after:generated.change.after
  }};
  for(const input of [
    null,{},false,[],contaminated,throwingGetter,hostileProxy,
    hostileChange,{...generated,change:null},
    {...generated,change:{...generated.change,extra:'secret'}}
  ]){
    assert.doesNotThrow(()=>{
      const result=auditProposedLiteralSelectorPatch(req,input);
      assert.equal(result.status,'BLOCKED');
      assert.equal(result.automaticPatchAllowed,false);
      assert.equal(result.tampermonkeyVerified,false);
      assert.equal(result.businessRecoveredVerified,false);
      assert.equal(JSON.stringify(result).includes('private'),false);
    });
  }
});


test('TEST-019/026: hostile Proxy inputs cannot run traps during local patch planning or audit',()=>{
  const req=request();
  const candidate=proposeLiteralSelectorPatch(req);
  assert.equal(candidate.status,'CANDIDATE_ONLY');
  if(candidate.status!=='CANDIDATE_ONLY')return;

  function trapped<T extends object>(target:T){
    let traps=0;
    const value=new Proxy(target,{
      get(){traps++;throw Error('UNTRUSTED_PROXY_GET');},
      getPrototypeOf(){traps++;throw Error('UNTRUSTED_PROXY_PROTOTYPE');},
      ownKeys(){traps++;throw Error('UNTRUSTED_PROXY_KEYS');},
      getOwnPropertyDescriptor(){traps++;throw Error('UNTRUSTED_PROXY_DESCRIPTOR');}
    });
    return {value,trapCount:()=>traps};
  }

  const proxyRequest=trapped(req);
  assert.equal(proposeLiteralSelectorPatch(proxyRequest.value).status,'BLOCKED');
  assert.equal(proxyRequest.trapCount(),0,'request Proxy traps must never execute');

  const proxyCandidate=trapped({...candidate});
  assert.equal(auditProposedLiteralSelectorPatch(req,proxyCandidate.value).status,'BLOCKED');
  assert.equal(proxyCandidate.trapCount(),0,'receipt Proxy traps must never execute');

  const proxyChange=trapped({...candidate.change});
  assert.equal(auditProposedLiteralSelectorPatch(req,{
    ...candidate,change:proxyChange.value
  }).status,'BLOCKED');
  assert.equal(proxyChange.trapCount(),0,'nested change Proxy traps must never execute');

  const revoked=Proxy.revocable({...candidate},{});
  revoked.revoke();
  assert.equal(auditProposedLiteralSelectorPatch(req,revoked.proxy).status,'BLOCKED');
});


test('TASK-009/TEST-014/019: literal document.getElementById can propose only a reviewed ID-to-ID candidate',()=>{
 const script=meta+
  'const untouched = "old";\n'+
  "const selected = document.getElementById('old');\n";
 const req=request(script,{
  callOffset:script.indexOf('document.getElementById'),
  method:'getElementById' as LiteralPatchRequest['method'],
  originalSelector:'#old',replacementSelector:'#new'
 });
 const proposed=proposeLiteralSelectorPatch(req);
 assert.equal(proposed.status,'CANDIDATE_ONLY',JSON.stringify(proposed));
 if(proposed.status!=='CANDIDATE_ONLY')return;
 assert.equal(proposed.change.before,"'old'");
 assert.equal(proposed.change.after,'"new"');
 assert.equal(proposed.candidateSource,meta+
  'const untouched = "old";\n'+
  'const selected = document.getElementById("new");\n');
 assert.equal(auditProposedLiteralSelectorPatch(req,proposed).status,'REVIEWABLE_ONLY');
 assert.equal(proposed.automaticPatchAllowed,false);
 assert.equal(proposed.businessRecoveredVerified,false);
});

test('TASK-009/TEST-019/026: ID-only candidate never changes classes, computed methods, or an overridden document API',()=>{
 for(const [body,oldSelector,newSelector] of [
  ["document.getElementById('old');",'.old','.new'],
  ["document['getElementById']('old');",'#old','#new'],
  ["document.getElementById = () => null; document.getElementById('old');",'#old','#new'],
  ["Object.defineProperty(document, 'getElementById', {value: () => null}); document.getElementById('old');",'#old','#new'],
  ["document.getElementById('old') || document.getElementById('other');",'#old','#new']
 ]as const){
  const script=meta+body;
  const req=request(script,{
   callOffset:script.indexOf('document.getElementById'),
   method:'getElementById' as LiteralPatchRequest['method'],
   originalSelector:oldSelector,replacementSelector:newSelector
  });
  const result=proposeLiteralSelectorPatch(req);
  assert.equal(result.status,'BLOCKED',body);
  assert.equal(result.automaticPatchAllowed,false);
 }
});

test('TASK-009/TEST-019/026: global document aliases cannot silently replace native selector APIs',()=>{
 const unsafe=[
  ["window.document.querySelector = () => null; document.querySelector('#old');",'querySelector'],
  ["globalThis['document'].querySelectorAll = () => []; document.querySelector('#old');",'querySelector'],
  ["delete globalThis.document.querySelector; document.querySelector('#old');",'querySelector'],
  ["window.document = otherDocument; document.querySelector('#old');",'querySelector'],
  ["globalThis['document'] = otherDocument; document.querySelector('#old');",'querySelector'],
  ["globalThis.document.getElementById = () => null; document.getElementById('old');",'getElementById'],
  ["delete window['document'].getElementById; document.getElementById('old');",'getElementById']
 ] as const;
 for(const [body,method] of unsafe){
  const script=meta+body;
  const offset=script.lastIndexOf('document.'+method+'(');
  assert.ok(offset>=0,'test fixture contains a direct native-looking selector call');
  const result=proposeLiteralSelectorPatch(request(script,{
   callOffset:offset,method,
   originalSelector:'#old',replacementSelector:'#new'
  }));
  assert.equal(result.status,'BLOCKED',body);
  assert.equal(result.automaticPatchAllowed,false);
  assert.equal('candidateSource' in result,false);
 }
 // Unrelated properties on the global document remain eligible for manual
 // review and must never be mistaken for native selector replacement.
 const safe=meta+"window.document.title = 'ok'; document.querySelector('#old');";
 const result=proposeLiteralSelectorPatch(request(safe,{
  callOffset:safe.lastIndexOf('document.querySelector(')
 }));
 assert.equal(result.status,'CANDIDATE_ONLY');
 assert.equal(result.automaticPatchAllowed,false);
});

test('TASK-009/TEST-019/026: reflective global document replacement cannot yield an offline repair candidate',()=>{
 const unsafe=[
  "Object.defineProperty(window, 'document', {value: fakeDocument});",
  "Object.defineProperty(globalThis, key, {value: fakeDocument});",
  "Object.defineProperties(globalThis, {document:{value:fakeDocument}});",
  "Object.assign(window, {document:fakeDocument});",
  "Reflect.set(globalThis, 'document', fakeDocument);",
  "Reflect.deleteProperty(window, 'document');",
  "Object.setPrototypeOf(window, {document:fakeDocument});",
  "Reflect.set(window, key, fakeDocument);",
  "Object.defineProperty(globalThis['document'], 'querySelector', {value:()=>null});",
  "Reflect.set(window['document'], 'querySelector', ()=>null);"
 ];
 for(const mutation of unsafe){
  const script=meta+mutation+" document.querySelector('#old');";
  const result=proposeLiteralSelectorPatch(request(script,{
    callOffset:script.lastIndexOf('document.querySelector(')
  }));
  assert.equal(result.status,'BLOCKED',mutation);
  assert.equal(result.automaticPatchAllowed,false);
  assert.equal('candidateSource' in result,false);
 }
 // Unrelated known properties on window are not an excuse to disable the
 // entire conservative manual-candidate workflow.
 for(const safeMutation of [
  "Object.defineProperty(window,'unrelated',{value:1});",
  "Object.assign(globalThis,{unrelated:true});",
  "Reflect.set(window,'unrelated',true);"
 ]){
  const script=meta+safeMutation+" document.querySelector('#old');";
  const result=proposeLiteralSelectorPatch(request(script,{
    callOffset:script.lastIndexOf('document.querySelector(')
  }));
  assert.equal(result.status,'CANDIDATE_ONLY',safeMutation);
  assert.equal(result.automaticPatchAllowed,false);
 }
});

test('TASK-009/TEST-019/026: mutated Document prototype selector APIs block review-only candidates',()=>{
  // The target looks like a literal document.querySelector call, but
  // document's inherited DOM API has been replaced elsewhere in the script.
  // Never use such a call as evidence for a conservative selector patch.
  for(const mutation of [
    "Document.prototype.querySelector = () => null;",
    "Document.prototype['querySelector'] = () => null;",
    "Document.prototype[methodName] = () => null;",
    "window.Document.prototype.querySelector = () => null;",
    "Object.defineProperty(Document.prototype, 'querySelector', {value: () => null});",
    "Object.assign(Document.prototype, {querySelector: () => null});",
    "Reflect.set(Document.prototype, 'querySelector', () => null);",
    "Object.setPrototypeOf(Document.prototype, {});",
    "delete Document.prototype.querySelector;"
  ]){
    const script=meta+mutation+"\ndocument.querySelector('#old');";
    const result=proposeLiteralSelectorPatch(request(script,{
      callOffset:script.lastIndexOf("document.querySelector(")
    }));
    assert.equal(result.status,'BLOCKED',mutation);
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal('candidateSource' in result,false);
  }
  const normal=meta+"Document.prototype.unrelated = true;\ndocument.querySelector('#old');";
  assert.equal(proposeLiteralSelectorPatch(request(normal,{
    callOffset:normal.lastIndexOf('document.querySelector(')
  })).status,'CANDIDATE_ONLY');
});


test('TASK-009/TEST-019/026: prototype aliases cannot disguise a mutated native document selector',()=>{
  // In browser code these references reach the same DOM prototype as
  // Document.prototype. An offline reviewer must not treat the later call
  // as a native DOM selector without a trustworthy runtime provenance.
  const mutations=[
    "document.__proto__.querySelector = () => null;",
    "window.document['__proto__']['querySelector'] = () => null;",
    "document.__proto__[selectorName] = () => null;",
    "Object.getPrototypeOf(document).querySelector = () => null;",
    "Reflect.getPrototypeOf(globalThis.document).querySelector = () => null;",
    "document.constructor.prototype.querySelector = () => null;",
    "Object.defineProperty(document.__proto__, 'querySelector', {value:()=>null});",
    "Reflect.set(Object.getPrototypeOf(document), 'querySelector', ()=>null);"
  ];
  for(const mutation of mutations){
    const script=meta+mutation+"\nconst node = document.querySelector('#old');\n";
    const result=proposeLiteralSelectorPatch(request(script,{
      callOffset:script.lastIndexOf("document.querySelector(")
    }));
    assert.equal(result.status,'BLOCKED',mutation);
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal('candidateSource' in result,false);
  }
  for(const harmless of [
    "document.__proto__.unrelated = true;",
    "Object.getPrototypeOf(document).unrelated = true;",
    "Object.getPrototypeOf(otherObject).querySelector = () => null;"
  ]){
    const script=meta+harmless+"\nconst node = document.querySelector('#old');\n";
    const result=proposeLiteralSelectorPatch(request(script,{
      callOffset:script.lastIndexOf("document.querySelector(")
    }));
    assert.equal(result.status,'CANDIDATE_ONLY',harmless);
    assert.equal(result.automaticPatchAllowed,false);
  }
});

test('TASK-009/TEST-014/019: querySelectorAll NodeList[0] retains indexing and review-only identity',()=>{
 const script=meta+
  'const untouched = "#old";\n'+
  'const selected = document.querySelectorAll("#old")[0];\n';
 const req=request(script,{
  callOffset:script.indexOf('document.querySelectorAll'),
  method:'querySelectorAll' as LiteralPatchRequest['method'],
  originalSelector:'#old',replacementSelector:'#new'
 });
 const proposal=proposeLiteralSelectorPatch(req);
 assert.equal(proposal.status,'CANDIDATE_ONLY',JSON.stringify(proposal));
 if(proposal.status!=='CANDIDATE_ONLY')return;
 assert.equal(proposal.candidateSource,meta+
  'const untouched = "#old";\n'+
  'const selected = document.querySelectorAll("#new")[0];\n',
  'patch must only update the AST string literal; NodeList indexing stays intact');
 assert.equal(auditProposedLiteralSelectorPatch(req,proposal).status,'REVIEWABLE_ONLY');
 assert.equal(proposal.automaticPatchAllowed,false);
 assert.equal(proposal.tampermonkeyVerified,false);
 assert.equal(proposal.businessRecoveredVerified,false);
 const computed=script.replace('document.querySelectorAll(', 'document["querySelectorAll"](');
 assert.equal(proposeLiteralSelectorPatch(request(computed,{
  callOffset:computed.indexOf('document["querySelectorAll"]'),
  method:'querySelectorAll' as LiteralPatchRequest['method']
 })).status,'BLOCKED',
 'computed DOM method is not a verified direct native selector site');
});
