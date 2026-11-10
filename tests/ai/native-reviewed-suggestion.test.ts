import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {NativeAiEvidenceStore,requestNativeReviewedAiSuggestion} from '../../src/ai/native-reviewed-suggestion';

const A='a'.repeat(64);
const config=()=>JSON.stringify({baseUrl:'https://models.example.com/v1',
  apiKey:'native-private-review-key',manualModel:'review-model',maxRequests:2,
  timeoutMs:1200,maxOutputTokens:64});
const response=()=>Response.json({choices:[{message:{role:'assistant',content:'Untrusted review idea only.'}}]});

test('TASK-014/TEST-015/026: only current native DOM receipts become unlinkable, bounded review metadata',()=>{
  let now=10000;
  const store=new NativeAiEvidenceStore(()=>now);
  assert.equal(store.record('safe_1',A,'div.example','UNKNOWN'),true);
  const evidence=store.resolve('safe_1');
  assert.ok(evidence);
  assert.deepEqual(Object.keys(evidence).sort(),['diagnosticCode','scenarioHash','selectorHash']);
  assert.equal(evidence?.diagnosticCode,'UNKNOWN');
  assert.match(evidence?.scenarioHash??'',/^[0-9a-f]{64}$/);
  assert.match(evidence?.selectorHash??'',/^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(evidence).includes('div.example'),false);
  assert.equal(JSON.stringify(evidence).includes(A),false);
  assert.equal(JSON.stringify(evidence).includes('safe_1'),false);
  const same=new NativeAiEvidenceStore(()=>now);
  assert.equal(same.record('safe_1',A,'div.example','UNKNOWN'),true);
  assert.notEqual(store.resolve('safe_1')?.scenarioHash,same.resolve('safe_1')?.scenarioHash);
  assert.equal(store.record('../unsafe',A,'div','UNKNOWN'),false);
  assert.equal(store.record('safe_2','a'.repeat(63),'div','UNKNOWN'),false);
  assert.equal(store.record('safe_2',A,'\nsecret','UNKNOWN'),false);
  assert.equal(store.record('safe_2',A,'div','CAN_APPLY' as 'UNKNOWN'),false);
  now+=300001;
  assert.equal(store.resolve('safe_1'),null,'expired receipts cannot be reused');
  store.clear();
  assert.equal(store.resolve('safe_1'),null);
});

test('TASK-014/TEST-015/016: no native consent or revoked approval sends zero network traffic',async()=>{
  const store=new NativeAiEvidenceStore();
  assert.equal(store.record('private_scope_934',A,'p','SELECTOR_ASSERTION'),true);
  const evidence=store.resolve('private_scope_934');
  let sent=0;
  const transport:typeof fetch=async()=>{sent++;return response();};
  assert.deepEqual(await requestNativeReviewedAiSuggestion(config(),evidence,async()=>false,undefined,transport),
    {ok:false,code:'CANCELLED',automaticPatchAllowed:false});
  const controller=new AbortController();
  assert.deepEqual(await requestNativeReviewedAiSuggestion(config(),evidence,async()=>{
    controller.abort();return true;
  },controller.signal,transport),{ok:false,code:'CANCELLED',automaticPatchAllowed:false});
  assert.equal(sent,0);
});

test('TASK-014/TEST-015/016: approved suggestion sends hashes only; response never gains patch authority',async()=>{
  const store=new NativeAiEvidenceStore();
  assert.equal(store.record('private_scope_934',A,'#secret-selector','SELECTOR_ASSERTION'),true);
  const evidence=store.resolve('private_scope_934');
  const approvals:string[]=[];
  const calls:{url:string;authorization:string;body:string}[]=[];
  const transport:typeof fetch=async(input,init)=>{
    calls.push({url:String(input),authorization:String((init?.headers as Record<string,string>).Authorization),
      body:String(init?.body)});
    return response();
  };
  const result=await requestNativeReviewedAiSuggestion(config(),evidence,
    async(origin,review)=>{approvals.push(origin+'|'+JSON.stringify(review));return true;},
    undefined,transport);
  assert.deepEqual(approvals,['https://models.example.com|'+JSON.stringify(evidence)]);
  assert.deepEqual(result,{ok:true,status:'UNTRUSTED_AI_TEXT_ONLY',
    candidateText:'Untrusted review idea only.',model:'review-model',tampermonkeyVerified:false,
    businessVerified:false,automaticPatchAllowed:false,automaticRollbackAllowed:false});
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://models.example.com/v1/chat/completions');
  assert.equal(calls[0].authorization,'Bearer native-private-review-key');
  assert.deepEqual(JSON.parse(calls[0].body).messages[1],
    {role:'user',content:JSON.stringify(evidence)});
  assert.equal(JSON.stringify(result).includes('native-private-review-key'),false);
  assert.equal(calls[0].body.includes('#secret-selector'),false);
  assert.equal(calls[0].body.includes(A),false);
  assert.equal(calls[0].body.includes('private_scope_934'),false);
});

test('TASK-014/TEST-015/016: malformed, missing, or no-manual-model scope never reaches provider',async()=>{
  let calls=0;let approvals=0;
  const transport:typeof fetch=async()=>{calls++;return response();};
  const approve=async()=>{approvals++;return true;};
  assert.deepEqual(await requestNativeReviewedAiSuggestion(config(),null,approve,undefined,transport),
    {ok:false,code:'NO_REVIEW_EVIDENCE',automaticPatchAllowed:false});
  assert.deepEqual(await requestNativeReviewedAiSuggestion(config(),{
    diagnosticCode:'UNKNOWN',scenarioHash:'bad',selectorHash:A
  },approve,undefined,transport),
    {ok:false,code:'INVALID_EVIDENCE',automaticPatchAllowed:false});
  assert.deepEqual(await requestNativeReviewedAiSuggestion('not-json',{
    diagnosticCode:'UNKNOWN',scenarioHash:A,selectorHash:A
  },approve,undefined,transport),
    {ok:false,code:'INVALID_CONFIGURATION',automaticPatchAllowed:false});
  const noModel=config().replace('"manualModel":"review-model"','"manualModel":null');
  assert.deepEqual(await requestNativeReviewedAiSuggestion(noModel,{
    diagnosticCode:'UNKNOWN',scenarioHash:A,selectorHash:A
  },approve,undefined,transport),
    {ok:false,code:'MODEL_NOT_SELECTED',automaticPatchAllowed:false});
  assert.equal(calls,0);
  assert.equal(approvals,0);
});

test('TASK-014/TEST-015/026: expired evidence frees bounded session capacity without evicting live receipts',()=>{
  let now=10000;
  const store=new NativeAiEvidenceStore(()=>now);
  for(let index=0;index<100;index++)
    assert.equal(store.record('slot_'+index,A,'p','UNKNOWN'),true);
  assert.equal(store.record('overflow',A,'p','UNKNOWN'),false,
    'valid receipts must not be evicted when the store is full');
  now+=300000;
  assert.equal(store.record('still_full',A,'p','UNKNOWN'),false,
    'receipts at the exact maximum age remain valid');
  now+=1;
  assert.equal(store.record('fresh',A,'p','UNKNOWN'),true,
    'expired receipts are reclaimed even if their IDs were never resolved');
  assert.equal(store.resolve('slot_0'),null);
  assert.equal(store.resolve('fresh')?.diagnosticCode,'UNKNOWN');
  for(let index=0;index<99;index++)
    assert.equal(store.record('new_'+index,A,'p','UNKNOWN'),true);
  assert.equal(store.record('new_overflow',A,'p','UNKNOWN'),false,
    'reclamation must preserve the original maximum live receipt limit');
});


test('TASK-014/TEST-015/026: native AI evidence clock failures fail closed without private error text',()=>{
 const secret='PRIVATE_NATIVE_AI_CLOCK_EXCEPTION_MUST_NOT_ESCAPE';
 let now=1000;
 let failing=false;
 const store=new NativeAiEvidenceStore(()=>{
  if(failing)throw Error(secret);
  return now;
 });
 assert.equal(store.record('existing',A,'#private','UNKNOWN'),true);
 assert.ok(store.resolve('existing'));
 failing=true;
 assert.doesNotThrow(()=>{
  assert.equal(store.resolve('existing'),null,
   'an unreadable clock must revoke existing evidence, not return a live receipt');
  assert.equal(store.record('new',A,'#private','UNKNOWN'),false,
   'an unreadable clock must not authorize creation of review evidence');
 });
 failing=false;
 now++;
 assert.equal(store.resolve('existing'),null,
  'revoked evidence cannot reappear when the native clock resumes');
 assert.equal(store.record('new',A,'#private','UNKNOWN'),true,
  'a fresh genuine inspection can create a new bounded receipt');
 assert.ok(store.resolve('new'));
});


test('TASK-014/TEST-015/026: reject forged cancellation before native disclosure or network effects',async()=>{
 const store=new NativeAiEvidenceStore();
 assert.equal(store.record('native_scope',A,'#private-selector','UNKNOWN'),true);
 const evidence=store.resolve('native_scope');
 let attackerCalls=0,approvals=0,requests=0;
 const poison=():never=>{attackerCalls++;throw Error('PRIVATE_SIGNAL_GETTER_EXECUTED');};
 const accessor={get aborted(){return poison();}};
 const proxy=new Proxy(new AbortController().signal,{
  get:poison,getPrototypeOf:poison,ownKeys:poison,
  getOwnPropertyDescriptor:poison
 });
 const revoked=Proxy.revocable(new AbortController().signal,{});
 revoked.revoke();
 const spoof=Object.create(AbortSignal.prototype) as AbortSignal;
 const shadow=new AbortController().signal;
 Object.defineProperty(shadow,'aborted',{get:poison});
 const listenerShadow=new AbortController().signal;
 Object.defineProperty(listenerShadow,'addEventListener',{value:poison});
 const approve=async()=>{approvals++;return true;};
 const transport:typeof fetch=async()=>{requests++;return response();};
 for(const bad of [accessor,proxy,revoked.proxy,spoof,shadow,listenerShadow]){
  const outcome=await requestNativeReviewedAiSuggestion(
    config(),evidence,approve,bad as AbortSignal,transport);
  assert.deepEqual(outcome,{ok:false,code:'INVALID_CANCEL_SIGNAL',automaticPatchAllowed:false});
 }
 assert.equal(attackerCalls,0,'no hostile signal getter or Proxy trap may execute');
 assert.equal(approvals,0,'invalid cancellation must not show native AI disclosure');
 assert.equal(requests,0,'invalid cancellation must not initiate network traffic');
 const cancelled=new AbortController();cancelled.abort();
 assert.deepEqual(await requestNativeReviewedAiSuggestion(
   config(),evidence,approve,cancelled.signal,transport),
   {ok:false,code:'CANCELLED',automaticPatchAllowed:false});
 assert.equal(approvals,0);
 assert.equal(requests,0);
});
