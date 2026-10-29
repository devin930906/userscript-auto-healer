import { test } from 'node:test';
import { strict as assert } from 'node:assert';

// TASK-008 / ISSUE-480: label ONLY the fixed frame-receipt category.
// A redacted diagnostic may narrow an intermittent Chrome failure but must
// never attest navigation, run JavaScript, or echo a page URL.
const moduleUnderTest = require('../../src/browser/cdp-target') as {
  classifyMainFrameUrl?: (actual:unknown, expected:string)=>string
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
