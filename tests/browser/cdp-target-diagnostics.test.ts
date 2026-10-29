import { test } from 'node:test';
import { strict as assert } from 'node:assert';

// TASK-008 / ISSUE-480: label ONLY the fixed frame-receipt category.
// A redacted diagnostic may narrow an intermittent Chrome failure but must
// never attest navigation, run JavaScript, or echo a page URL.
const moduleUnderTest = require('../../src/browser/cdp-target') as {
  classifyMainFrameUrl?: (actual:unknown, expected:string)=>string;
  classifyMainFrameResponse?: (raw:string,expected:string)=>string|null;
  readCreatedTargetReceipt?: (raw:unknown)=>string|null|undefined;
  readClosedTargetReceipt?: (raw:unknown)=>boolean|undefined;
  isClosedTargetAbsentFromValidList?: (payload:unknown,targetId:unknown)=>boolean
};

test('TEST-013/026: main-frame evidence distinguishes provisional, mismatched and confirmed URLs',()=>{
  const classify=moduleUnderTest.classifyMainFrameUrl;
  assert.equal(typeof classify,'function',
    'TASK-008 needs a real content-blind main-frame receipt classifier');
  if(!classify)return;
  const approved='https://example.com/fixture?mode=one';
  for(const [actual,expected] of [
    ['about:blank','MAIN_FRAME_ABOUT_BLANK'],
    [undefined,'MAIN_FRAME_MISSING_URL'],
    ['not a url','MAIN_FRAME_INVALID_URL'],
    ['chrome-error://chromewebdata/','MAIN_FRAME_INVALID_URL'],
    ['https://elsewhere.example/fixture?token=PRIVATE','MAIN_FRAME_URL_MISMATCH'],
    ['https://example.com/other','MAIN_FRAME_URL_MISMATCH'],
    ['https://example.com/fixture?mode=two','MAIN_FRAME_URL_MISMATCH'],
    ['https://EXAMPLE.COM:443/fixture?mode=one','MAIN_FRAME_CONFIRMED']
  ] as const){
    const stage=classify(actual,approved);
    assert.equal(stage,expected);
    assert.match(stage,/^MAIN_FRAME_[A-Z_]+$/);
    assert.equal(stage.includes('PRIVATE'),false);
    assert.equal(stage.includes('example'),false);
  }
});

test('TEST-013/026: malformed frame receipt cannot be counted as verified',()=>{
  const classify=moduleUnderTest.classifyMainFrameUrl;
  assert.equal(typeof classify,'function');
  if(!classify)return;
  for(const actual of [null,0,{},[], 'https://user:private@example.com/']){
    assert.notEqual(classify(actual,'https://example.com/'),'MAIN_FRAME_CONFIRMED');
  }
});

test('TASK-008/TEST-013/026: CDP rejection and malformed receipts have distinct URL-blind stages',()=>{
  const inspect=moduleUnderTest.classifyMainFrameResponse;
  assert.equal(typeof inspect,'function',
    'the actual frame socket must classify command errors separately from navigation pending');
  if(!inspect)return;
  const approved='https://example.com/fixture?mode=one';
  const frameId='0123456789abcdef0123456789abcdef';
  const good=JSON.stringify({id:1,result:{frameTree:{frame:{id:frameId,url:approved}}}});
  const cases:[string,string|null][]=[
    [good,'MAIN_FRAME_CONFIRMED'],
    [JSON.stringify({id:1,result:{frameTree:{frame:{id:frameId,url:'about:blank'}}}}),'MAIN_FRAME_ABOUT_BLANK'],
    [JSON.stringify({id:1,error:{code:-32000,message:'PRIVATE-CDP-ERROR'}}),'MAIN_FRAME_CDP_REJECTED'],
    [JSON.stringify({id:1,error:{message:'PRIVATE'},result:{frameTree:{frame:{url:approved}}}}),'MAIN_FRAME_CDP_REJECTED'],
    [JSON.stringify({id:1,result:{}}),'MAIN_FRAME_RESPONSE_INVALID'],
    [JSON.stringify({id:1,result:{frameTree:{frame:{id:frameId}}}}),'MAIN_FRAME_MISSING_URL'],
    ['PRIVATE-not-json','MAIN_FRAME_RESPONSE_INVALID'],
    [JSON.stringify({id:1,result:{frameTree:{frame:{url:approved}}},padding:'PRIVATE'.repeat(6000)}),'MAIN_FRAME_RESPONSE_INVALID'],
    [JSON.stringify({id:2,result:{frameTree:{frame:{url:approved}}}}),null]
  ];
  for(const [raw,expected] of cases){
    const stage=inspect(raw,approved);
    assert.equal(stage,expected);
    if(stage!==null){
      assert.match(stage,/^MAIN_FRAME_[A-Z_]+$/);
      assert.equal(stage.includes('PRIVATE'),false);
      assert.equal(stage.includes('example.com'),false);
    }
  }
});

test('TASK-005/TEST-008/026: created-tab CDP replies are bounded and fail closed',()=>{
  const inspect=moduleUnderTest.readCreatedTargetReceipt;
  assert.equal(typeof inspect,'function',
    'Target.createTarget must use a bounded native string-only receipt parser');
  if(!inspect)return;
  const id='0123456789abcdef0123456789abcdef';
  const safe=JSON.stringify({id:2,result:{targetId:id}});
  assert.equal(inspect(safe),id);
  assert.equal(inspect(JSON.stringify({id:17,result:{targetId:id}})),undefined,
    'unrelated CDP events do not terminate a valid in-flight command');
  for(const raw of [
    '{"id":2,"result":{"targetId":"BAD"}}',
    JSON.stringify({id:2,error:{message:'PRIVATE_SECRET'},result:{targetId:id}}),
    JSON.stringify({id:2,result:{targetId:id},padding:'PRIVATE'.repeat(6000)}),
    '{"id":2,"result":{"targetId":',
    null,[],{toString(){throw Error('PRIVATE_EXECUTED');}}
  ]){
    const result=inspect(raw);
    assert.equal(result,null,'invalid, oversized or non-string replies must fail closed');
    assert.equal(String(result).includes('PRIVATE'),false);
  }
});

// ISSUE-480 / TASK-008 / TEST-013/026: a matching close-target CDP reply
// carrying ANY error field must not be reported as acknowledged cleanup.
// In particular, falsy but present JSON errors are still errors.
test('TASK-008/TEST-013/026: close-target acknowledgement rejects falsy errors and forged binary receipts',()=>{
  const inspect=moduleUnderTest.readClosedTargetReceipt;
  assert.equal(typeof inspect,'function',
    'actual cleanup must use a bounded native-text close-target receipt parser');
  if(!inspect)return;
  assert.equal(inspect(JSON.stringify({id:3,result:{success:true}})),true);
  assert.equal(inspect(JSON.stringify({id:17,result:{success:true}})),undefined,
    'unrelated CDP message IDs must not prematurely terminate cleanup');
  for(const error of [false,0,'',null]){
    assert.equal(inspect(JSON.stringify({id:3,error,result:{success:true}})),false,
      'an explicit error field cannot be mistaken for an acknowledged tab closure');
  }
  for(const raw of [
    JSON.stringify({id:3,result:{success:false}}),
    JSON.stringify({id:3,result:{success:'true'}}),
    JSON.stringify({id:3,result:{success:true},padding:'PRIVATE'.repeat(6000)}),
    '{not-json',
    Buffer.from(JSON.stringify({id:3,result:{success:true}})),
    {toString(){throw Error('PRIVATE_EXFILTRATION');}}
  ]){
    assert.equal(inspect(raw),false,
      'invalid, oversized or non-text close receipts may never confirm cleanup');
  }
});


// TASK-008 / Issue #480 / TEST-013/026: an explicit CDP error key is
// failure even when its JSON value is falsy. Page.getFrameTree is a
// read-only navigation hint and can never be elevated from an error receipt.
test('TASK-008/TEST-013/026: main-frame receipt refuses all present falsy CDP errors',()=>{
  const classify=moduleUnderTest.classifyMainFrameResponse;
  assert.equal(typeof classify,'function');
  if(!classify)return;
  const url='https://example.com/fixture?mode=one';
  const frameTree={frame:{id:'0123456789abcdef0123456789abcdef',url}};
  assert.equal(classify(JSON.stringify({id:1,result:{frameTree}}),url),
    'MAIN_FRAME_CONFIRMED','ordinary result must remain supported');
  for(const error of [false,0,'',null]){
    const raw=JSON.stringify({id:1,error,result:{frameTree}});
    assert.equal(classify(raw,url),'MAIN_FRAME_CDP_REJECTED',
      'a present CDP error can never confirm the main frame');
  }
  assert.equal(classify(JSON.stringify({id:4,error:null,result:{frameTree}}),url),
    null,'unrelated CDP ids must still be ignored');
});

// TASK-008 / TEST-008/013/026: createTarget cannot mint a verified target
// ID from an error response even when error is a falsy JSON value.
test('TASK-008/TEST-008/013/026: create-target receipt refuses all present falsy CDP errors',()=>{
  const read=moduleUnderTest.readCreatedTargetReceipt;
  assert.equal(typeof read,'function');
  if(!read)return;
  const targetId='0123456789abcdef0123456789abcdef';
  assert.equal(read(JSON.stringify({id:2,result:{targetId}})),targetId);
  for(const error of [false,0,'',null]){
    assert.equal(read(JSON.stringify({id:2,error,result:{targetId}})),null,
      'CDP command errors cannot create approved target identities');
  }
  assert.equal(read(JSON.stringify({id:99,error:null,result:{targetId}})),
    undefined,'unrelated CDP ids are ignored');
});


// TASK-008 / REQ-013 / TEST-013/026: matching a URL is insufficient if
// Page.getFrameTree lacks a real root frame identity, actually describes a
// child frame, or reports a failed navigation through unreachableUrl. The
// owned-browser socket is not permission to treat any frame URL as the main
// approved document. Reject only; never expose frame IDs or private URLs.
test('TASK-008/TEST-013/026: CDP cannot confirm a child or unreachable frame as the main document',()=>{
  const classify=moduleUnderTest.classifyMainFrameResponse;
  assert.equal(typeof classify,'function');
  if(!classify)return;
  const url='https://example.com/fixture?mode=one';
  const frameId='0123456789abcdef0123456789abcdef';
  const response=(frame:Record<string,unknown>)=>JSON.stringify({
    id:1,result:{frameTree:{frame}}
  });
  assert.equal(classify(response({id:frameId,url}),url),'MAIN_FRAME_CONFIRMED',
    'a real root frame with an identity is still a valid read-only signal');
  for(const frame of [
    {url},
    {id:'',url},
    {id:frameId,url,parentId:'different-parent'},
    {id:frameId,url,parentId:null},
    {id:frameId,url,unreachableUrl:'https://example.com/private'},
    {id:frameId,url,unreachableUrl:''}
  ]){
    assert.equal(classify(response(frame),url),'MAIN_FRAME_RESPONSE_INVALID',
      'an absent/child/error frame cannot establish verified main navigation');
  }
  const childOnly=response({id:'child-frame-id-001',parentId:frameId,url});
  assert.notEqual(classify(childOnly,url),'MAIN_FRAME_CONFIRMED');
});


// TASK-008 / TEST-013/026: an acknowledged Target.closeTarget is insufficient
// to report UNVERIFIED_TAB_CLOSED until a well-formed, bounded /json/list
// proves this exact freshly created ID is absent. Previously a JSON array
// with invalid members (or duplicate target IDs) was accepted as 'absent'.
test('TASK-008/TEST-013/026: cleanup refuses malformed or ambiguous CDP target lists',()=>{
  const check=moduleUnderTest.isClosedTargetAbsentFromValidList;
  assert.equal(typeof check,'function',
    'the actual tab-close path needs strict, read-only target-list validation');
  if(!check)return;
  const mine='0123456789abcdef0123456789abcdef';
  const another='fedcba9876543210fedcba9876543210';
  assert.equal(check([],mine),true,'an actually empty target list is unambiguous');
  assert.equal(check([{id:another,type:'page',url:'about:blank'}],mine),true,
    'well-formed unrelated targets must not block acknowledged cleanup');
  assert.equal(check([{id:mine,type:'page',url:'about:blank'}],mine),false,
    'a still-open created tab cannot be reported as closed');
  for(const bad of [
    null,undefined,{},false,
    [null],['not a target'],[{}],[{id:9}],[{id:''}],[{id:'bad'}],
    [{id:another}],
    [{id:another,type:'page',url:'about:blank'},
     {id:another,type:'page',url:'about:blank'}],
    [{id:another},'private string'],
    Array.from({length:1001},()=>({id:another}))
  ]){
    assert.equal(check(bad,mine),false,
      'malformed, duplicate or oversized lists are not proof of cleanup');
  }
  let getterCalls=0;
  const accessor=Object.defineProperty({},'id',{
    get(){getterCalls++;throw Error('PRIVATE_SOURCE_WAS_EVALUATED');}
  });
  assert.equal(check([accessor],mine),false,
    'an accessor cannot be read as remote CDP identity');
  assert.equal(getterCalls,0,'untrusted accessors must not execute');
  let proxyCalls=0;
  const proxy=new Proxy([{id:another}],{
    get(){proxyCalls++;throw Error('PRIVATE_PROXY_WAS_EVALUATED');}
  });
  assert.equal(check(proxy,mine),false);
  assert.equal(proxyCalls,0,'untrusted Proxy traps must not execute');
  assert.equal(check([], 'bad'),false);
});
