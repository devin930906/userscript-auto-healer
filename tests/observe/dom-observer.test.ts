import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {summarizeDomTree,observeApprovedDom,isApprovedTopFrame} from '../../src/observe/dom-observer';
test('TEST-010: iframe and shadow scope remain limited, not full-page coverage',()=>{
  const node={nodeType:9,nodeName:'#document',children:[
    {nodeType:1,nodeName:'HTML',children:[
      {nodeType:1,nodeName:'IFRAME'},
      {nodeType:1,nodeName:'DIV',shadowRoots:[{nodeType:11,nodeName:'#shadow-root',children:[]}]}
    ]}
  ]};
  const frames={frame:{url:'https://example.com/'},
    childFrames:[{frame:{url:'https://other.example/page'}}]};
  const summary=summarizeDomTree(node,frames,'https://example.com');
  assert.equal(summary?.elementCount,3,'Document and shadow-root containers are not elements');
  assert.equal(summary?.iframeCount,1);
  assert.equal(summary?.visibleShadowRoots,1);
  assert.ok(summary?.blindSpots.includes('IFRAME_CONTENT_UNVERIFIED'));
  assert.ok(summary?.blindSpots.includes('CROSS_ORIGIN_FRAME_UNVERIFIED'));
  assert.ok(summary?.blindSpots.includes('CLOSED_SHADOW_ROOT_UNKNOWN'));
});
test('TEST-010: cycles or extreme depth cannot yield an apparent valid snapshot',()=>{
  const n:any={nodeType:1,nodeName:'DIV'};n.children=[n];
  assert.equal(summarizeDomTree(n,{frame:{url:'https://example.com/'}},'https://example.com'),null);
  assert.equal(summarizeDomTree({children:'bad'}, {frame:{url:'https://example.com/'}},'https://example.com'),null);
});
test('TEST-012: missing authorization/session never produces a runtime claim',async()=>{
  const unavailable={ok:false as const,code:'PREFLIGHT_FAILED' as const};
  const target={ok:false as const,code:'UNVERIFIED_BROWSER' as const};
  assert.deepEqual(await observeApprovedDom(unavailable,target,'https://example.com/',false),
    {ok:false,code:'NOT_AUTHORIZED'});
  assert.deepEqual(await observeApprovedDom(unavailable,target,'https://example.com/',true),
    {ok:false,code:'UNVERIFIED_BROWSER'});
});

test('TEST-010: CDP snapshot rejects a top-frame origin switch, opaque URL and malformed frame tree',()=>{
  assert.equal(isApprovedTopFrame({frame:{url:'https://example.com/next'}},'https://example.com'),true);
  for(const value of [
    {frame:{url:'https://elsewhere.example/'}},
    {frame:{url:'https://example.com.evil.test/'}},
    {frame:{url:'about:blank'}},
    {frame:{url:'data:text/html,hi'}},
    {frame:{url:'https://user:pass@example.com/'}},
    {frame:{url:'invalid URL'}},
    {frame:{url:12}},
    {childFrames:[{frame:{url:'https://example.com/'}}]},
    null
  ]) {
    assert.equal(isApprovedTopFrame(value,'https://example.com'),false);
  }
});

test('TEST-010: malformed CDP DOM evidence and unrelated top-level origins fail closed',()=>{
  const approved='https://example.com';
  const frames={frame:{url:'https://example.com/safe'}};
  const valid={nodeType:9,nodeName:'#document',children:[]};
  assert.equal(summarizeDomTree(valid,{frame:{url:'https://unapproved.example/'}},approved),null);
  assert.equal(summarizeDomTree({nodeType:1,nodeName:17},frames,approved),null);
  assert.equal(summarizeDomTree({nodeType:'1',nodeName:'DIV'},frames,approved),null);
  assert.equal(summarizeDomTree({},frames,approved),null);
  assert.equal(summarizeDomTree(valid,frames,approved)?.elementCount,0);
});
