import { test } from 'node:test';
import { strict as assert } from 'node:assert';

// TASK-008 / ISSUE-480: label ONLY the fixed frame-receipt category.
// A redacted diagnostic may narrow an intermittent Chrome failure but must
// never attest navigation, run JavaScript, or echo a page URL.
const moduleUnderTest = require('../../src/browser/cdp-target') as {
  classifyMainFrameUrl?: (actual:unknown, expected:string)=>string;
  classifyMainFrameResponse?: (raw:string,expected:string)=>string|null
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
