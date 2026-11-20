import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {ImportedDomDiagnosticIndex} from '../../src/diagnostics/imported-dom-diagnostic-index';

const shaA='a'.repeat(64);
const shaB='b'.repeat(64);
const hints=(selector:string)=>({
 matchPatterns:['https://example.org/*'],
 unsupportedScope:false,
 selectorSitesTruncated:false,
 selectorSites:[{offset:120,method:'querySelector',selector}]
});
const code=(item:ReturnType<ImportedDomDiagnosticIndex['plan']>['items'][number])=>
 'code' in item?item.code:undefined;

test('TASK-013/TEST-022: imported DOM diagnosis plans each script independently',()=>{
 const index=new ImportedDomDiagnosticIndex();
 index.recordImported(shaA,hints('#submit'));
 index.recordImported(shaB,{...hints('.old'),unsupportedScope:true});
 index.recordImported('c'.repeat(64),null);
 const result=index.plan('https://example.org/app');
 assert.equal(result.targetUrl,'https://example.org/app');
 assert.deepEqual(result.items.map(item=>item.status),[
  'READY_FOR_INSPECTION','BLOCKED','BLOCKED'
 ]);
 assert.deepEqual(result.items.map(code),[
  undefined,'UNSUPPORTED_MATCH_RULES','NO_LITERAL_SELECTORS'
 ]);
 assert.deepEqual('selectorSites' in result.items[0]?result.items[0].selectorSites:undefined,[
  {offset:120,method:'querySelector',selector:'#submit'}
 ]);
 assert.equal(result.items[0].scriptSha256,shaA);
});

test('TASK-013/TEST-022/026: an exact target must match a declared exact-origin @match',()=>{
 const index=new ImportedDomDiagnosticIndex();
 index.recordImported(shaA,hints('#submit'));
 assert.equal(code(index.plan('https://other.example/app').items[0]),'TARGET_NOT_MATCHED');
 assert.equal(code(index.plan('https://user@example.org/app').items[0]),'INVALID_TARGET_URL');
 assert.equal(code(index.plan('https://example.org/a/../app').items[0]),'INVALID_TARGET_URL');
});

test('TASK-013/TEST-022/026: untrusted selector hint accessors and Proxies are rejected without invocation',()=>{
 const index=new ImportedDomDiagnosticIndex();
 let getterCalls=0;
 const hostile=Object.defineProperty({},'matchPatterns',{
  enumerable:true,get(){getterCalls++;throw new Error('hostile getter');}
 });
 index.recordImported(shaA,hostile);
 assert.equal(getterCalls,0);
 assert.equal(code(index.plan('https://example.org/app').items[0]),'NO_LITERAL_SELECTORS');
 const proxy=new Proxy({}, {get(){throw new Error('hostile proxy');}});
 index.recordImported(shaB,proxy);
 assert.equal(code(index.plan('https://example.org/app').items[1]),'NO_LITERAL_SELECTORS');
});

test('TASK-013/TEST-022: diagnostic plans cap scripts, selectors and match patterns',()=>{
 const index=new ImportedDomDiagnosticIndex();
 const malformed={
  matchPatterns:Array.from({length:17},(_,i)=>`https://example.org/${i}/*`),
  unsupportedScope:false,
  selectorSites:Array.from({length:9},(_,i)=>({
   offset:i,method:'querySelector',selector:`#selector-${i}`
  }))
 };
 index.recordImported(shaA,malformed);
 assert.equal(code(index.plan('https://example.org/app').items[0]),'NO_LITERAL_SELECTORS');
 const capped=new ImportedDomDiagnosticIndex();
 capped.recordImported(shaB,{
  matchPatterns:['https://example.org/*'],unsupportedScope:false,
  selectorSites:Array.from({length:8},(_,i)=>({
   offset:i,method:'querySelector',selector:`#selector-${i}`
  })),selectorSitesTruncated:true
 });
 assert.equal(code(capped.plan('https://example.org/app').items[0]),
  'SELECTOR_LIMIT_EXCEEDED');
});

