import { test } from 'node:test';
import { strict as assert } from 'node:assert';

// TASK-008 / ISSUE-480: label ONLY the fixed frame-receipt category.
// A redacted diagnostic may narrow an intermittent Chrome failure but must
// never attest navigation, run JavaScript, or echo a page URL.
const moduleUnderTest = require('../../src/browser/cdp-target') as {
  classifyMainFrameUrl?: (actual:unknown, expected:string)=>string;
  classifyMainFrameResponse?: (raw:string,expected:string)=>string|null;
  readCreatedTargetReceipt?: (raw:unknown)=>string|null|undefined;
  readClosedTargetReceipt?: (raw:unknown)=>boolean|undefined
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
  const good=JSON.stringify({id:1,result:{frameTree:{frame:{url:approved}}}});
  const cases:[string,string|null][]=[
    [good,'MAIN_FRAME_CONFIRMED'],
    [JSON.stringify({id:1,result:{frameTree:{frame:{url:'about:blank'}}}}),'MAIN_FRAME_ABOUT_BLANK'],
    [JSON.stringify({id:1,error:{code:-32000,message:'PRIVATE-CDP-ERROR'}}),'MAIN_FRAME_CDP_REJECTED'],
    [JSON.stringify({id:1,error:{message:'PRIVATE'},result:{frameTree:{frame:{url:approved}}}}),'MAIN_FRAME_CDP_REJECTED'],
    [JSON.stringify({id:1,result:{}}),'MAIN_FRAME_RESPONSE_INVALID'],
    [JSON.stringify({id:1,result:{frameTree:{frame:{}}}}),'MAIN_FRAME_MISSING_URL'],
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
  const frameTree={frame:{url}};
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
