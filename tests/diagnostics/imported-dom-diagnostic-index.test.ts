import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {ImportedDomDiagnosticIndex,recordImportedDomForCurrentOwner}
 from '../../src/diagnostics/imported-dom-diagnostic-index';

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

test('TASK-013/TEST-022/026: UTF-8 candidate source stays main-only and clears after batch use',()=>{
 const source='// ==UserScript==\n// @match https://example.org/*\n// @grant none\n// ==/UserScript==\ndocument.querySelector("#old");\n';
 const hash=createHash('sha256').update(source,'utf8').digest('hex');
 const index=new ImportedDomDiagnosticIndex();
 index.recordImported(hash,hints('#old'),'candidate.user.js',source);
 assert.equal(index.readUtf8CandidateSource(hash),source);
 assert.equal(JSON.stringify(index.plan('https://example.org/app')).includes(source),false);
 assert.equal(JSON.stringify(index.plan('https://example.org/app')).includes(hash),true);
 index.clearCandidateSources();
 assert.equal(index.readUtf8CandidateSource(hash),null);
});

test('TASK-013/TEST-022/026: candidate-source identity, size and expiry are bounded',()=>{
 let now=100;
 const index=new ImportedDomDiagnosticIndex(()=>now);
 const source='// ==UserScript==\n// @match https://example.org/*\n// @grant none\n// ==/UserScript==\n';
 const hash=createHash('sha256').update(source,'utf8').digest('hex');
 index.recordImported(hash,hints('#old'),'small.user.js',source);
 assert.equal(index.readUtf8CandidateSource(hash),source);
 now+=5*60*1000+1;
 assert.equal(index.readUtf8CandidateSource(hash),null,
  'retained imported text must expire after five minutes');

 const oversized='x'.repeat(256*1024+1);
 const oversizedHash=createHash('sha256').update(oversized,'utf8').digest('hex');
 index.recordImported(oversizedHash,hints('#old'),'large.user.js',oversized);
 assert.equal(index.readUtf8CandidateSource(oversizedHash),null,
  'one imported source above 256 KiB must not enter candidate memory');
 index.recordImported('d'.repeat(64),hints('#old'),'bad-hash.user.js',source);
 assert.equal(index.readUtf8CandidateSource('d'.repeat(64),'bad-hash.user.js'),null);
 const bom='\uFEFF'+source;
 const bomHash=createHash('sha256').update(bom,'utf8').digest('hex');
 index.recordImported(bomHash,hints('#old'),'bom.user.js',bom);
 assert.equal(index.readUtf8CandidateSource(bomHash),null,
  'UTF-8 BOM sources must not enter the candidate sidecar');
 const malformed='\uD800';
 const malformedHash=createHash('sha256').update(malformed,'utf8').digest('hex');
 index.recordImported(malformedHash,hints('#old'),'malformed.user.js',malformed);
 assert.equal(index.readUtf8CandidateSource(malformedHash),null,
  'strings that do not round-trip as strict UTF-8 must not be retained');
});

test('TASK-013/TEST-022/026: candidate source retention is capped per window',()=>{
 const index=new ImportedDomDiagnosticIndex();
 const first='x'.repeat(256*1024-1)+'!';
 const last='x'.repeat(256*1024-1)+'\u0002';
 const firstHash=createHash('sha256').update(first,'utf8').digest('hex');
 const lastHash=createHash('sha256').update(last,'utf8').digest('hex');
 for(let i=0;i<64;i++){
  const source='x'.repeat(256*1024-1)+String.fromCharCode(0x21+i);
  const hash=createHash('sha256').update(source,'utf8').digest('hex');
  index.recordImported(hash,null,`candidate-${i}.user.js`,source);
 }
 index.recordImported(lastHash,null,'candidate-over-cap.user.js',last);
 assert.ok(index.readUtf8CandidateSource(firstHash));
 assert.equal(index.readUtf8CandidateSource(lastHash),null,
  'source text above the 16 MiB per-window budget must be rejected');
});

test('TASK-013/TEST-022/026: idle candidate source is eagerly dropped at its expiry deadline',()=>{
 let now=100;
 const scheduled:Array<{callback:()=>void;delay:number}>=[];
 const timer={unref(){}} as unknown as ReturnType<typeof setTimeout>;
 const index=new ImportedDomDiagnosticIndex(()=>now,{
  candidateSourceTtlMs:10,
  setTimeout:(callback,delay)=>{scheduled.push({callback,delay});return timer;},
  clearTimeout:()=>{}
 });
 const source='short lived source';
 const hash=createHash('sha256').update(source,'utf8').digest('hex');
 index.recordImported(hash,null,'idle.user.js',source);
 assert.equal(scheduled[0]?.delay,10);
 now=111;
 scheduled[0]?.callback();
 now=100;
 assert.equal(index.readUtf8CandidateSource(hash),null,
  'the timer must remove the source even if no later import or lookup occurs');
});

test('TASK-013/TEST-022/026: a closed import owner cannot repopulate the replacement window index',()=>{
 const oldWindow={};
 const newWindow={};
 const oldIndex=new ImportedDomDiagnosticIndex();
 const newIndex=new ImportedDomDiagnosticIndex();
 const source='late result from a closed window';
 const hash=createHash('sha256').update(source,'utf8').digest('hex');
 assert.equal(recordImportedDomForCurrentOwner(oldIndex,newIndex,
  oldWindow,newWindow,false,hash,hints('#old'),'late.user.js',source),false);
 assert.equal(oldIndex.readUtf8CandidateSource(hash),null);
 assert.equal(newIndex.readUtf8CandidateSource(hash),null);

 const activeIndex=new ImportedDomDiagnosticIndex();
 assert.equal(recordImportedDomForCurrentOwner(activeIndex,activeIndex,
  newWindow,newWindow,false,hash,hints('#old'),'active.user.js',source),true);
 assert.equal(activeIndex.readUtf8CandidateSource(hash),source);
});
