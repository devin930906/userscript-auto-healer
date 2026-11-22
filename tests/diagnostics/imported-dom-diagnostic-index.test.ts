import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import * as importedDomIndexModule from '../../src/diagnostics/imported-dom-diagnostic-index';
import {ImportedDomDiagnosticIndex,recordImportedDomForCurrentOwner}
 from '../../src/diagnostics/imported-dom-diagnostic-index';

type CandidateStoreApi<T>={
 put(owner:object,context:T,expiresAt:number):string|null;
 reserve(owner:object,id:unknown):T|null;
 release(owner:object,id:unknown):boolean;
 consume(owner:object,id:unknown):T|null;
 isReserved(owner:object,id:unknown):boolean;
 clearOwner(owner:object):void;
};
type CandidateStoreLifecycle={
 setTimeout?:(callback:()=>void,delayMs:number)=>ReturnType<typeof setTimeout>;
 clearTimeout?:(timer:ReturnType<typeof setTimeout>)=>void;
};
type CandidateStoreConstructor=new <T>(now?:()=>number,
 lifecycle?:CandidateStoreLifecycle)=>CandidateStoreApi<T>;
function candidateStoreConstructor():CandidateStoreConstructor|null{
 const exported=(importedDomIndexModule as unknown as {
  ImportedDomCandidateExportStore?:unknown
 }).ImportedDomCandidateExportStore;
 return typeof exported==='function'?exported as CandidateStoreConstructor:null;
}

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

test('TASK-013/TEST-022/026: candidate-source timer failure drops retained source fail-closed',()=>{
 const source='temporary private candidate bytes';
 const hash=createHash('sha256').update(source,'utf8').digest('hex');
 let attempts=0;
 const index=new ImportedDomDiagnosticIndex(()=>100,{
  setTimeout:()=>{attempts++;throw new Error('timer unavailable');},
  clearTimeout:()=>{}
 });
 assert.doesNotThrow(()=>index.recordImported(hash,null,'timer-failure.user.js',source));
 assert.ok(attempts>=1,'the injected timer failure must be exercised');
 assert.equal(index.readUtf8CandidateSource(hash),null,
  'source text must not remain in memory without a scheduled expiration');
 assert.equal(index.plan('https://example.org/app').items.length,1,
  'failing to retain candidate source must not discard independent AST metadata');
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

test('TASK-013/TEST-023/026: candidate export capabilities are owner-bound, reserved and one-use',()=>{
 const Store=candidateStoreConstructor();
 assert.ok(Store,'main-only imported candidate export store must exist');
 if(!Store)return;
 let now=100;
 const timer={unref(){}} as unknown as ReturnType<typeof setTimeout>;
 const store=new Store<{label:string}>(()=>now,{
  setTimeout:()=>timer,clearTimeout:()=>{}
 });
 const firstWindow={};
 const secondWindow={};
 const context={label:'candidate context'};
 const token=store.put(firstWindow,context,now+5*60*1000);
 assert.ok(token);
 if(!token)return;
 assert.equal(store.reserve(secondWindow,token),null,
  'a different BrowserWindow must not claim the candidate context');
 assert.equal(store.reserve(firstWindow,token),context);
 assert.equal(store.reserve(firstWindow,token),null,
  'a reserved export must reject a concurrent request');
 assert.equal(store.release(firstWindow,token),true,
  'cancel before the write confirmation must release the reservation');
 assert.equal(store.reserve(firstWindow,token),context);
 assert.equal(store.consume(secondWindow,token),null);
 assert.equal(store.consume(firstWindow,token),context);
 assert.equal(store.reserve(firstWindow,token),null,
  'a consumed candidate must not be replayable');
});

test('TASK-013/TEST-023/026: candidate export capabilities expire eagerly and cap each window',()=>{
 const Store=candidateStoreConstructor();
 assert.ok(Store,'main-only imported candidate export store must exist');
 if(!Store)return;
 let now=200;
 const scheduled:Array<{callback:()=>void;delay:number}>=[];
 const timer={unref(){}} as unknown as ReturnType<typeof setTimeout>;
 const store=new Store<{label:string}>(()=>now,{
  setTimeout:(callback,delay)=>{scheduled.push({callback,delay});return timer;},
  clearTimeout:()=>{}
 });
 const owner={};
 const first=store.put(owner,{label:'expires'},now+10);
 assert.ok(first);
 assert.equal(scheduled[0]?.delay,10);
 now+=10;
 scheduled[0]?.callback();
 assert.equal(first?store.reserve(owner,first):null,null,
  'the expiry timer must clear a candidate without a later lookup');
 now=300;
 const live=Array.from({length:16},(_,i)=>store.put(owner,
  {label:'candidate-'+i},now+60_000));
 assert.ok(live.every(Boolean),'a window may keep up to 16 live candidate capabilities');
 assert.equal(store.put(owner,{label:'over-cap'},now+60_000),null,
  'a seventeenth live candidate must fail closed');
 assert.ok(store.put({},{label:'other-window'},now+60_000),
  'one window must not consume another window’s independent quota');
 store.clearOwner(owner);
 assert.ok(store.put(owner,{label:'after-close'},now+60_000),
  'closing a window must release its bounded in-memory candidate records');
});

test('TASK-013/TEST-023/026: reserved candidate expiry is observable without consuming or extending authority',()=>{
 const Store=candidateStoreConstructor();
 assert.ok(Store);
 if(!Store)return;
 let now=500;
 const timer={unref(){}} as unknown as ReturnType<typeof setTimeout>;
 const store=new Store<{label:string}>(()=>now,{setTimeout:()=>timer,clearTimeout:()=>{}});
 const owner={};
 const foreignOwner={};
 const token=store.put(owner,{label:'short-lived'},now+100);
 assert.ok(token);
 if(!token)return;
 assert.equal(store.isReserved(owner,token),false,'unreserved handle cannot be staged');
 assert.ok(store.reserve(owner,token));
 assert.equal(store.isReserved(owner,token),true);
 assert.equal(store.isReserved(foreignOwner,token),false);
 now+=101;
 assert.equal(store.isReserved(owner,token),false,'native dialog delays must not extend expiry');
 assert.equal(store.consume(owner,token),null,'expired reserved handle cannot stage files');
});
