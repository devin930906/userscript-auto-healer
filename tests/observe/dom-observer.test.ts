import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {summarizeDomTree,observeApprovedDom} from '../../src/observe/dom-observer';
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
