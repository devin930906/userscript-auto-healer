import {test} from 'node:test';
import {mkdtemp,mkdir,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {strict as assert} from 'node:assert';
import {DesktopScenarioSession} from '../../src/scenarios/desktop-session';
import {LimitedHealthRegistry} from '../../src/health/health-registry';
import {limitedScenarioHistoryKey,readLimitedSessionHistory,mergeLimitedSessionArchive} from '../../src/health/session-history';

const A='a'.repeat(64), B='b'.repeat(64), E='e'.repeat(64);
const stage=(session:DesktopScenarioSession,id:string,hash:string)=>{
 session.recordImported(hash);
 return session.register({id,scriptSha256:hash,targetUrl:'https://example.test/',
  selector:'#target',userApproved:true,requiresLogin:false,loginReady:false});
};

test('TEST-024/026: only a registered read-only scenario reads its own redacted history',()=>{
 let clock=1000;
 const session=new DesktopScenarioSession();
 const history=new LimitedHealthRegistry(()=>clock);
 assert.equal(stage(session,'first',A).ok,true);
 assert.equal(stage(session,'other',B).ok,true);
 const empty=readLimitedSessionHistory(session,history,'first');
 assert.equal(empty.ok,true);
 if(!empty.ok)return;
 assert.equal(empty.status,'UNVERIFIED_SESSION_HISTORY_ONLY');
 assert.equal(empty.currentStatus,'UNTESTED');
 assert.deepEqual(empty.events,[]);
 history.record({scriptHash:limitedScenarioHistoryKey(A,'first'),kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
 clock=1001;
 history.record({scriptHash:limitedScenarioHistoryKey(A,'first'),kind:'INSUFFICIENT_EVIDENCE',evidenceHash:null});
 history.record({scriptHash:limitedScenarioHistoryKey(B,'other'),kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
 const response=readLimitedSessionHistory(session,history,'first');
 assert.equal(response.ok,true);
 if(!response.ok)return;
 assert.equal(response.currentStatus,'INDETERMINATE');
 assert.deepEqual(response.events,[
  {observedAtMs:1000,status:'ELEMENT_FOUND_ONLY'},
  {observedAtMs:1001,status:'INDETERMINATE'}]);
 assert.equal(response.tampermonkeyVerified,false);
 assert.equal(response.businessVerified,false);
 assert.equal(response.automaticPatchAllowed,false);
 assert.equal(response.automaticRollbackAllowed,false);
 assert.equal(JSON.stringify(response).includes(E),false);
 assert.equal(JSON.stringify(response).includes(A),false);
 assert.equal(JSON.stringify(response).includes('https://'),false);
 assert.ok(Object.isFrozen(response.events));
 assert.ok(Object.isFrozen(response.events[0]));
 assert.equal(readLimitedSessionHistory(session,history,'other').ok,true);
 assert.deepEqual(readLimitedSessionHistory(new DesktopScenarioSession(),history,'first'),
  {ok:false,code:'SCENARIO_NOT_FOUND',tampermonkeyVerified:false,
   businessVerified:false,automaticPatchAllowed:false,automaticRollbackAllowed:false});
});

test('TEST-024: different registered scenarios of the same script have isolated histories',()=>{
 const session=new DesktopScenarioSession();
 const history=new LimitedHealthRegistry(()=>2000);
 assert.equal(stage(session,'first',A).ok,true);
 assert.equal(stage(session,'second',A).ok,true);
 const firstKey=limitedScenarioHistoryKey(A,'first');
 const secondKey=limitedScenarioHistoryKey(A,'second');
 assert.notEqual(firstKey,secondKey);
 assert.match(firstKey,/^[0-9a-f]{64}$/);
 history.record({scriptHash:firstKey,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
 const first=readLimitedSessionHistory(session,history,'first');
 const second=readLimitedSessionHistory(session,history,'second');
 assert.equal(first.ok,true);
 assert.equal(second.ok,true);
 if(!first.ok||!second.ok)return;
 assert.equal(first.currentStatus,'ELEMENT_FOUND_ONLY');
 assert.equal(first.events.length,1);
 assert.equal(second.currentStatus,'UNTESTED');
 assert.deepEqual(second.events,[]);
 history.record({scriptHash:secondKey,kind:'INSUFFICIENT_EVIDENCE',evidenceHash:null});
 const next=readLimitedSessionHistory(session,history,'second');
 assert.equal(next.ok,true);
 if(next.ok)assert.equal(next.currentStatus,'INDETERMINATE');
 assert.equal(readLimitedSessionHistory(session,history,'first').ok,true);
 for(const args of [[A,'../first'],['wrong','first'],[A,'']] as const){
  assert.throws(()=>limitedScenarioHistoryKey(args[0],args[1]),
   /INVALID_SESSION_HISTORY_SCOPE/);
 }
});

test('TEST-024: history is limited to 32 events and expires to INDETERMINATE',()=>{
 let now=1000;
 const session=new DesktopScenarioSession();
 stage(session,'one',A);
 const history=new LimitedHealthRegistry(()=>now);
 for(let i=0;i<36;i++){now++;history.record({
  scriptHash:limitedScenarioHistoryKey(A,'one'),kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});}
 const result=readLimitedSessionHistory(session,history,'one');
 assert.equal(result.ok,true);
 if(!result.ok)return;
 assert.equal(result.events.length,32);
 assert.equal(result.events[0].observedAtMs,1005);
 now+=600001;
 const expired=readLimitedSessionHistory(session,history,'one');
 assert.equal(expired.ok,true);
 if(expired.ok)assert.equal(expired.currentStatus,'INDETERMINATE');
});

test('TEST-024/026: malformed, unregistered and non-readonly scenario ids fail closed',()=>{
 const session=new DesktopScenarioSession();
 const history=new LimitedHealthRegistry(()=>1);
 stage(session,'first',A);
 for(const id of [null,undefined,{},'../../first','not_staged',B,
  {toString(){throw Error('SECRET');}}]){
  const response=readLimitedSessionHistory(session,history,id);
  assert.equal(response.ok,false);
  assert.equal(JSON.stringify(response).includes('SECRET'),false);
 }
 const login=new DesktopScenarioSession();
 login.recordImported(B);
 const pending=login.register({id:'private',scriptSha256:B,
  targetUrl:'https://example.test/',selector:'#target',
  userApproved:true,requiresLogin:true,loginReady:false});
 assert.equal(pending.ok,true);
 assert.deepEqual(readLimitedSessionHistory(login,history,'private'),{
  ok:false,code:'SCENARIO_NOT_READONLY_ELIGIBLE',
  tampermonkeyVerified:false,businessVerified:false,
  automaticPatchAllowed:false,automaticRollbackAllowed:false});
});

test('TASK-015/TEST-024: native limited history survives restart but never replays current health authority',async()=>{
 // Resolve dynamically so the RED is a behavioral assertion, not a missing TS import error.
 const feature=(()=>{try{return require('../../src/health/limited-health-archive');}catch{return {};}})() as
  {saveLimitedHealthArchive?:Function;readLimitedHealthArchive?:Function};
 assert.equal(typeof feature.saveLimitedHealthArchive,'function');
 assert.equal(typeof feature.readLimitedHealthArchive,'function');
 const home=await mkdtemp(join(tmpdir(),'uah-history-archive-'));
 try{
  const userData=join(home,'user-data');
  await mkdir(userData);
  const key=limitedScenarioHistoryKey(A,'first');
  let clock=1000;
  const original=new LimitedHealthRegistry(()=>clock);
  original.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
  clock++;
  original.record({scriptHash:key,kind:'INSUFFICIENT_EVIDENCE',evidenceHash:null});
  const written=await feature.saveLimitedHealthArchive!(userData,original.snapshot(key));
  assert.equal(written.status,'ARCHIVE_SAVED_UNVERIFIED',JSON.stringify(written));
  const reread=await feature.readLimitedHealthArchive!(userData,key);
  assert.equal(reread.status,'ARCHIVE_READ_UNVERIFIED',JSON.stringify(reread));
  assert.deepEqual(reread.events,[
   {observedAtMs:1000,status:'ELEMENT_FOUND_ONLY'},
   {observedAtMs:1001,status:'INDETERMINATE'}]);
  assert.equal(reread.currentStatus,'INDETERMINATE',
   'historical DOM evidence can never become fresh post-restart health');
  assert.equal(reread.tampermonkeyVerified,false);
  assert.equal(reread.businessVerified,false);
  assert.equal(reread.automaticPatchAllowed,false);
  assert.equal(reread.automaticRollbackAllowed,false);
  assert.ok(!JSON.stringify(reread).includes(E));
  assert.ok(!JSON.stringify(reread).includes(A));
  const archivePath=join(userData,'limited-health-history-v1');
  const files=await readdir(archivePath);
  assert.equal(files.length,1);
  const stored=await readFile(join(archivePath,files[0]),'utf8');
  assert.ok(!stored.includes(E));
  assert.ok(!stored.includes(A));
  assert.ok(!stored.includes('https://'));
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-015/TEST-024: archived history is per-scenario and capped at 32, preserving prior events',async()=>{
 const feature=(()=>{try{return require('../../src/health/limited-health-archive');}catch{return {};}})() as any;
 assert.equal(typeof feature.saveLimitedHealthArchive,'function');
 const home=await mkdtemp(join(tmpdir(),'uah-health-retention-'));
 try{
  const userData=join(home,'user-data');await mkdir(userData);
  const key=limitedScenarioHistoryKey(A,'first');
  let clock=10;
  for(let i=0;i<36;i++){
   clock++;
   const run=new LimitedHealthRegistry(()=>clock);
   run.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
   assert.equal((await feature.saveLimitedHealthArchive(userData,run.snapshot(key))).status,
    'ARCHIVE_SAVED_UNVERIFIED');
  }
  const old=await feature.readLimitedHealthArchive(userData,key);
  assert.equal(old.status,'ARCHIVE_READ_UNVERIFIED');
  assert.equal(old.events.length,32);
  assert.equal(old.events[0].observedAtMs,15);
  assert.equal(old.events[31].observedAtMs,46);
  const other=await feature.readLimitedHealthArchive(userData,limitedScenarioHistoryKey(B,'first'));
  assert.equal(other.status,'NOT_FOUND');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-015/TEST-024/026: tampered or linked archive never becomes trusted or overwritten',async()=>{
 const feature=(()=>{try{return require('../../src/health/limited-health-archive');}catch{return {};}})() as any;
 assert.equal(typeof feature.readLimitedHealthArchive,'function');
 const home=await mkdtemp(join(tmpdir(),'uah-health-block-'));
 try{
  const userData=join(home,'user-data');await mkdir(userData);
  const key=limitedScenarioHistoryKey(A,'first');
  const original=new LimitedHealthRegistry(()=>100);
  original.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
  assert.equal((await feature.saveLimitedHealthArchive(userData,original.snapshot(key))).status,
   'ARCHIVE_SAVED_UNVERIFIED');
  const dir=join(userData,'limited-health-history-v1');
  const full=join(dir,(await readdir(dir))[0]);
  const unsafe='{"status":"RECOVERED_VERIFIED","businessVerified":true}';
  await writeFile(full,unsafe);
  assert.equal((await feature.readLimitedHealthArchive(userData,key)).status,'BLOCKED');
  assert.equal((await feature.saveLimitedHealthArchive(userData,original.snapshot(key))).status,'BLOCKED');
  assert.equal(await readFile(full,'utf8'),unsafe);
  assert.equal((await feature.readLimitedHealthArchive(userData,'../../unknown')).status,'BLOCKED');
  assert.equal((await readdir(dir)).length,1);
  const redirected=join(home,'linked-user-data');
  await symlink(userData,redirected,process.platform==='win32'?'junction':'dir');
  assert.equal((await feature.saveLimitedHealthArchive(redirected,original.snapshot(key))).status,'BLOCKED');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-015/TEST-024/026: a structurally valid future-dated archive cannot poison real observations',async()=>{
 const {saveLimitedHealthArchive,readLimitedHealthArchive}=
  require('../../src/health/limited-health-archive') as typeof import('../../src/health/limited-health-archive');
 const home=await mkdtemp(join(tmpdir(),'uah-future-health-'));
 try{
  const userData=join(home,'user-data');await mkdir(userData);
  const key=limitedScenarioHistoryKey(A,'first');
  const valid=new LimitedHealthRegistry(()=>Date.now()-1000);
  valid.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
  assert.equal((await saveLimitedHealthArchive(userData,valid.snapshot(key))).status,
   'ARCHIVE_SAVED_UNVERIFIED');
  const file=join(userData,'limited-health-history-v1',
   (await readdir(join(userData,'limited-health-history-v1')))[0]);
  const parsed=JSON.parse(await readFile(file,'utf8')) as {
   events:{observedAtMs:number;status:string}[];
  };
  // This remains an otherwise canonical JSON archive, not a broken schema.
  // Without a time boundary it would suppress every legitimate observation
  // made before the forged future timestamp, while claiming a successful save.
  parsed.events[0].observedAtMs=Date.now()+24*60*60*1000;
  const poisoned=JSON.stringify(parsed)+'\n';
  await writeFile(file,poisoned);
  assert.equal((await readLimitedHealthArchive(userData,key)).status,'BLOCKED');
  const current=new LimitedHealthRegistry(()=>Date.now());
  current.record({scriptHash:key,kind:'INSUFFICIENT_EVIDENCE',evidenceHash:null});
  assert.equal((await saveLimitedHealthArchive(userData,current.snapshot(key))).status,
   'BLOCKED');
  assert.equal(await readFile(file,'utf8'),poisoned,
   'never overwrite structurally valid yet future-poisoned evidence');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-015/TEST-024: native future-time observations are rejected before persistence',async()=>{
 const {saveLimitedHealthArchive}=
  require('../../src/health/limited-health-archive') as typeof import('../../src/health/limited-health-archive');
 const home=await mkdtemp(join(tmpdir(),'uah-future-clock-'));
 try{
  const userData=join(home,'user-data');await mkdir(userData);
  const key=limitedScenarioHistoryKey(A,'first');
  const future=new LimitedHealthRegistry(()=>Date.now()+24*60*60*1000);
  future.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
  assert.equal((await saveLimitedHealthArchive(userData,future.snapshot(key))).status,'BLOCKED');
 }finally{await rm(home,{recursive:true,force:true});}
});


test('TASK-015/TEST-024/026: same-millisecond native observations persist last limited status without promotion',async()=>{
 const {saveLimitedHealthArchive,readLimitedHealthArchive}=
  require('../../src/health/limited-health-archive') as typeof import('../../src/health/limited-health-archive');
 const home=await mkdtemp(join(tmpdir(),'uah-health-same-tick-'));
 try{
  const userData=join(home,'user-data');await mkdir(userData);
  const key=limitedScenarioHistoryKey(A,'first');
  let clock=Date.now()-1000;
  const registry=new LimitedHealthRegistry(()=>clock);
  // A legitimate native DOM scan can emit multiple events in one clock tick.
  registry.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
  registry.record({scriptHash:key,kind:'INSUFFICIENT_EVIDENCE',evidenceHash:null});
  const snapshot=registry.snapshot(key);
  assert.equal(snapshot.history.length,2);
  assert.equal(snapshot.history[0].observedAtMs,snapshot.history[1].observedAtMs);
  assert.equal((await saveLimitedHealthArchive(userData,snapshot)).status,
   'ARCHIVE_SAVED_UNVERIFIED');
  const first=await readLimitedHealthArchive(userData,key);
  assert.equal(first.status,'ARCHIVE_READ_UNVERIFIED');
  if(first.status!=='ARCHIVE_READ_UNVERIFIED')return;
  assert.equal(first.currentStatus,'INDETERMINATE');
  assert.deepEqual(first.events,[{observedAtMs:clock,status:'INDETERMINATE'}],
   'within one timestamp only the last actual observation may be retained');
  assert.equal(first.businessVerified,false);
  assert.equal(first.tampermonkeyVerified,false);
  assert.equal(first.automaticPatchAllowed,false);
  assert.equal(first.automaticRollbackAllowed,false);

  // Replaying the same bounded snapshot is idempotent. A later actual
  // observation is preserved while the two original same-tick events
  // remain collapsed into one historical entry.
  assert.equal((await saveLimitedHealthArchive(userData,snapshot)).status,
   'ARCHIVE_SAVED_UNVERIFIED');
  clock+=1;
  registry.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
  assert.equal((await saveLimitedHealthArchive(userData,registry.snapshot(key))).status,
   'ARCHIVE_SAVED_UNVERIFIED');
  const later=await readLimitedHealthArchive(userData,key);
  assert.equal(later.status,'ARCHIVE_READ_UNVERIFIED');
  if(later.status==='ARCHIVE_READ_UNVERIFIED'){
   assert.deepEqual(later.events,[
    {observedAtMs:clock-1,status:'INDETERMINATE'},
    {observedAtMs:clock,status:'ELEMENT_FOUND_ONLY'}]);
   assert.equal(later.currentStatus,'INDETERMINATE',
    'an archived DOM hit never becomes fresh or verified health after restart');
  }
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-015/TEST-026: independent same-tick contradictory archive updates remain blocked',async()=>{
 const {saveLimitedHealthArchive,readLimitedHealthArchive}=
  require('../../src/health/limited-health-archive') as typeof import('../../src/health/limited-health-archive');
 const home=await mkdtemp(join(tmpdir(),'uah-health-same-tick-conflict-'));
 try{
  const userData=join(home,'user-data');await mkdir(userData);
  const key=limitedScenarioHistoryKey(B,'first');
  const clock=Date.now()-1000;
  const found=new LimitedHealthRegistry(()=>clock);
  found.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
  assert.equal((await saveLimitedHealthArchive(userData,found.snapshot(key))).status,
   'ARCHIVE_SAVED_UNVERIFIED');
  const before=await readLimitedHealthArchive(userData,key);
  const disputed=new LimitedHealthRegistry(()=>clock);
  disputed.record({scriptHash:key,kind:'INSUFFICIENT_EVIDENCE',evidenceHash:null});
  assert.equal((await saveLimitedHealthArchive(userData,disputed.snapshot(key))).status,
   'BLOCKED','separate history at the same timestamp cannot rewrite existing status');
  assert.deepEqual(await readLimitedHealthArchive(userData,key),before);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-015/TEST-024: same-millisecond later insufficient evidence downgrades persisted DOM observation',async()=>{
 const {saveLimitedHealthArchive,readLimitedHealthArchive}=
  require('../../src/health/limited-health-archive') as typeof import('../../src/health/limited-health-archive');
 const home=await mkdtemp(join(tmpdir(),'uah-health-downgrade-'));
 try{
  const userData=join(home,'user-data');await mkdir(userData);
  const key=limitedScenarioHistoryKey(A,'first');
  const timestamp=Date.now()-1000;
  const registry=new LimitedHealthRegistry(()=>timestamp);
  registry.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
  assert.equal((await saveLimitedHealthArchive(userData,registry.snapshot(key))).status,
   'ARCHIVE_SAVED_UNVERIFIED');
  // The next actual observation may happen before the millisecond clock ticks.
  // Persisting it must not leave yesterday's more optimistic DOM-only status.
  registry.record({scriptHash:key,kind:'INSUFFICIENT_EVIDENCE',evidenceHash:null});
  assert.equal((await saveLimitedHealthArchive(userData,registry.snapshot(key))).status,
   'ARCHIVE_SAVED_UNVERIFIED');
  const restored=await readLimitedHealthArchive(userData,key);
  assert.equal(restored.status,'ARCHIVE_READ_UNVERIFIED');
  if(restored.status==='ARCHIVE_READ_UNVERIFIED'){
   assert.deepEqual(restored.events,[{observedAtMs:timestamp,status:'INDETERMINATE'}]);
   assert.equal(restored.currentStatus,'INDETERMINATE');
   assert.equal(restored.businessVerified,false);
   assert.equal(restored.automaticPatchAllowed,false);
  }
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-015/TEST-024: same-tick DOM after insufficient evidence cannot promote saved history',async()=>{
 const {saveLimitedHealthArchive,readLimitedHealthArchive}=
  require('../../src/health/limited-health-archive') as typeof import('../../src/health/limited-health-archive');
 const home=await mkdtemp(join(tmpdir(),'uah-health-no-promote-'));
 try{
  const userData=join(home,'user-data');await mkdir(userData);
  const key=limitedScenarioHistoryKey(A,'first');
  const timestamp=Date.now()-1000;
  const registry=new LimitedHealthRegistry(()=>timestamp);
  registry.record({scriptHash:key,kind:'INSUFFICIENT_EVIDENCE',evidenceHash:null});
  assert.equal((await saveLimitedHealthArchive(userData,registry.snapshot(key))).status,
   'ARCHIVE_SAVED_UNVERIFIED');
  registry.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
  assert.equal((await saveLimitedHealthArchive(userData,registry.snapshot(key))).status,
   'ARCHIVE_SAVED_UNVERIFIED');
  const restored=await readLimitedHealthArchive(userData,key);
  assert.equal(restored.status,'ARCHIVE_READ_UNVERIFIED');
  if(restored.status==='ARCHIVE_READ_UNVERIFIED')
   assert.deepEqual(restored.events,[{observedAtMs:timestamp,status:'INDETERMINATE'}]);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-015/TEST-024/026: native archive rejects forged event kind and evidence consistency',async()=>{
 const {saveLimitedHealthArchive}=
  require('../../src/health/limited-health-archive') as typeof import('../../src/health/limited-health-archive');
 const home=await mkdtemp(join(tmpdir(),'uah-health-event-shape-'));
 try{
  const userData=join(home,'user-data');await mkdir(userData);
  const key=limitedScenarioHistoryKey(A,'first');
  const registry=new LimitedHealthRegistry(()=>Date.now()-1000);
  registry.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
  const authentic=registry.snapshot(key);
  const event=authentic.history[0];
  for(const forged of [
   {...event,kind:'INSUFFICIENT_EVIDENCE'},
   {...event,evidenceHash:null},
   {...event,kind:'UNKNOWN_EVENT'},
   {...event,evidenceHash:'not-a-hash'}
  ]){
   const fake={...authentic,history:[forged]};
   assert.equal((await saveLimitedHealthArchive(userData,fake as typeof authentic)).status,
    'BLOCKED','inconsistent native observation must never be archived');
  }
  assert.deepEqual(await readdir(userData),[],
   'invalid snapshots must not even create an archive directory');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-015/TEST-024/026: archive refuses status claims inconsistent with observation evidence',async()=>{
 const {saveLimitedHealthArchive}=
  require('../../src/health/limited-health-archive') as typeof import('../../src/health/limited-health-archive');
 const home=await mkdtemp(join(tmpdir(),'uah-health-status-consistency-'));
 try{
  const userData=join(home,'user-data');await mkdir(userData);
  const key=limitedScenarioHistoryKey(A,'first');
  for(const [kind,evidenceHash,forgedStatus] of [
   ['INSUFFICIENT_EVIDENCE',null,'ELEMENT_FOUND_ONLY'],
   ['LIMITED_DOM_OBSERVATION',E,'INDETERMINATE']
  ] as const){
   const registry=new LimitedHealthRegistry(()=>Date.now()-1000);
   registry.record({scriptHash:key,kind,evidenceHash});
   const authentic=registry.snapshot(key);
   const forged={...authentic,history:[{...authentic.history[0],status:forgedStatus}]};
   assert.equal((await saveLimitedHealthArchive(userData,
    forged as typeof authentic)).status,'BLOCKED',
    `event ${kind} cannot be archived with forged ${forgedStatus} status`);
  }
  assert.deepEqual(await readdir(userData),[],
   'a mismatched native event must not create a durable archive directory');
 }finally{await rm(home,{recursive:true,force:true});}
});


test('TASK-015/TEST-024/026: hostile health snapshots cannot invoke accessors or Proxy traps',async()=>{
 const {saveLimitedHealthArchive}=
  require('../../src/health/limited-health-archive') as typeof import('../../src/health/limited-health-archive');
 const home=await mkdtemp(join(tmpdir(),'uah-health-input-boundary-'));
 try{
  const userData=join(home,'user-data');await mkdir(userData);
  const key=limitedScenarioHistoryKey(A,'first');
  const registry=new LimitedHealthRegistry(()=>Date.now()-1000);
  registry.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
  const valid=registry.snapshot(key);
  let accessorReads=0;
  let proxyTraps=0;
  const withGetter={...valid};
  Object.defineProperty(withGetter,'history',{
   enumerable:true,configurable:true,
   get(){accessorReads++;return valid.history;}
  });
  const makeTrap=<T extends object>(object:T):T=>new Proxy(object,{
   get(target,property,receiver){
    proxyTraps++;
    return Reflect.get(target,property,receiver);
   }
  });
  const hostile:unknown[]=[
   withGetter,
   makeTrap({...valid}),
   {...valid,history:makeTrap([...valid.history])},
   {...valid,history:[makeTrap({...valid.history[0]})]}
  ];
  for(const candidate of hostile){
   assert.equal((await saveLimitedHealthArchive(
    userData,candidate as typeof valid)).status,'BLOCKED');
  }
  assert.equal(accessorReads,0,'never invoke caller-provided snapshot accessors');
  assert.equal(proxyTraps,0,'never invoke caller-provided snapshot or event Proxy traps');
  assert.deepEqual(await readdir(userData),[],
   'rejected input cannot create a persistent health archive');
 }finally{await rm(home,{recursive:true,force:true});}
});


test('TASK-015/TEST-024/026: health archive rejects custom array iteration without invoking caller code',async()=>{
 const {saveLimitedHealthArchive}=
  require('../../src/health/limited-health-archive') as typeof import('../../src/health/limited-health-archive');
 const home=await mkdtemp(join(tmpdir(),'uah-health-iterator-boundary-'));
 try{
  const userData=join(home,'user-data');await mkdir(userData);
  const key=limitedScenarioHistoryKey(A,'first');
  const registry=new LimitedHealthRegistry(()=>Date.now()-1000);
  registry.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
  const good=registry.snapshot(key);
  let iteratorCalls=0;
  const history=[...good.history];
  Object.defineProperty(history,Symbol.iterator,{
   configurable:true,
   value:function*(){
    iteratorCalls++;
    yield* good.history;
   }
  });
  assert.equal((await saveLimitedHealthArchive(
   userData,{...good,history})).status,'BLOCKED',
   'a caller-owned iterator must not supply apparently valid native events');
  assert.equal(iteratorCalls,0,'untrusted array iterator must never run');
  assert.deepEqual(await readdir(userData),[],
   'invalid history cannot produce any persistent archive');
 }finally{await rm(home,{recursive:true,force:true});}
});


test('TASK-015/TEST-024/026: post-unlock same-byte replacement cannot attest archived history save',async()=>{
 // Interpose only on the owned writer mutex RELEASE. The real save,
 // hard-link publication and readback still execute on real Windows files.
 const {saveLimitedHealthArchive,readLimitedHealthArchive}=
  require('../../src/health/limited-health-archive') as typeof import('../../src/health/limited-health-archive');
 const fsPromises=require('node:fs/promises') as typeof import('node:fs/promises');
 const home=await mkdtemp(join(tmpdir(),'uah-health-post-unlock-'));
 const nativeRmdir=fsPromises.rmdir;
 const userData=join(home,'user-data');
 const key=limitedScenarioHistoryKey(A,'first');
 const dir=join(userData,'limited-health-history-v1');
 const archive=join(dir,'health-'+key+'.json');
 const lock=join(dir,'.health-'+key+'.lock');
 const retained=join(dir,'retained-original-archive-for-review');
 let replaced=false;
 try{
  await mkdir(userData);
  const registry=new LimitedHealthRegistry(()=>Date.now()-1000);
  registry.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
  (fsPromises as {rmdir:typeof nativeRmdir}).rmdir=async(...args)=>{
   await nativeRmdir(...args);
   if(args[0]===lock){
    // Substitute a new inode containing EXACTLY the same canonical bytes.
    // A byte-only post-unlock check must not claim ownership of the result.
    const bytes=await readFile(archive);
    await fsPromises.rename(archive,retained);
    await writeFile(archive,bytes);
    replaced=true;
   }
  };
  const outcome=await saveLimitedHealthArchive(userData,registry.snapshot(key));
  assert.equal(replaced,true,'must exercise the post-mutex-release window');
  assert.equal(outcome.status,'BLOCKED',
   'same bytes at a different inode cannot attest the file this writer published');
  assert.deepEqual(await readFile(archive),await readFile(retained));
  assert.equal((await readLimitedHealthArchive(userData,key)).status,
   'ARCHIVE_READ_UNVERIFIED','replacement remains limited historical data');
 }finally{
  (fsPromises as {rmdir:typeof nativeRmdir}).rmdir=nativeRmdir;
  await rm(home,{recursive:true,force:true});
 }
});

test('TASK-015/TEST-024/026: limited archive refuses forged or inconsistent top-level health states',async()=>{
 const {saveLimitedHealthArchive,readLimitedHealthArchive}=
  require('../../src/health/limited-health-archive') as typeof import('../../src/health/limited-health-archive');
 const userData=await mkdtemp(join(tmpdir(),'uah-health-status-invariant-'));
 try{
  const key=limitedScenarioHistoryKey(A,'status-invariant');
  const registry=new LimitedHealthRegistry(()=>1000);
  const genuine=registry.record({scriptHash:key,kind:'INSUFFICIENT_EVIDENCE',evidenceHash:null});
  assert.equal(genuine.status,'INDETERMINATE');
  // A renderer/caller-created object cannot upgrade an uncertain event or
  // claim an empty history while retaining evidence. The archive must refuse
  // these shapes BEFORE creating a durable history file.
  for(const status of ['RECOVERED_VERIFIED','ELEMENT_FOUND_ONLY','UNTESTED']){
   const forged={...genuine,status} as unknown as typeof genuine;
   const result=await saveLimitedHealthArchive(userData,forged);
   assert.equal(result.status,'BLOCKED','forged top-level status: '+status);
  }
  assert.equal((await readLimitedHealthArchive(userData,key)).status,'NOT_FOUND');
  // The original native, unverified observation remains persistable.
  assert.equal((await saveLimitedHealthArchive(userData,genuine)).status,
   'ARCHIVE_SAVED_UNVERIFIED');
  assert.equal((await readLimitedHealthArchive(userData,key)).status,
   'ARCHIVE_READ_UNVERIFIED');
 }finally{await rm(userData,{recursive:true,force:true});}
});


test('TASK-015/TEST-024/026: wholly stale unrelated history cannot claim a successful archive save',async()=>{
 const {saveLimitedHealthArchive,readLimitedHealthArchive}=
  require('../../src/health/limited-health-archive') as typeof import('../../src/health/limited-health-archive');
 const home=await mkdtemp(join(tmpdir(),'uah-health-stale-replay-'));
 try{
  const userData=join(home,'user-data');await mkdir(userData);
  const key=limitedScenarioHistoryKey(A,'stale');
  const current=new LimitedHealthRegistry(()=>Date.now()-1000);
  current.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
  assert.equal((await saveLimitedHealthArchive(userData,current.snapshot(key))).status,
   'ARCHIVE_SAVED_UNVERIFIED');
  const baseline=await readLimitedHealthArchive(userData,key);
  const stale=new LimitedHealthRegistry(()=>Date.now()-5000);
  stale.record({scriptHash:key,kind:'INSUFFICIENT_EVIDENCE',evidenceHash:null});
  assert.equal((await saveLimitedHealthArchive(userData,stale.snapshot(key))).status,
   'BLOCKED','a stale unrelated event must not receive a misleading save receipt');
  assert.deepEqual(await readLimitedHealthArchive(userData,key),baseline);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-015/TEST-024/026: matching current tail cannot conceal contradictory archived past',async()=>{
 const {saveLimitedHealthArchive,readLimitedHealthArchive}=
  require('../../src/health/limited-health-archive') as typeof import('../../src/health/limited-health-archive');
 const home=await mkdtemp(join(tmpdir(),'uah-health-contradictory-history-'));
 try{
  const userData=join(home,'user-data');await mkdir(userData);
  const key=limitedScenarioHistoryKey(A,'conflict');
  let clock=Date.now()-4000;
  const registry=new LimitedHealthRegistry(()=>clock);
  registry.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
  clock+=2000;
  registry.record({scriptHash:key,kind:'INSUFFICIENT_EVIDENCE',evidenceHash:null});
  const authentic=registry.snapshot(key);
  assert.equal((await saveLimitedHealthArchive(userData,authentic)).status,
   'ARCHIVE_SAVED_UNVERIFIED');
  const baseline=await readLimitedHealthArchive(userData,key);
  // The tail overlaps exactly, while an earlier timestamp rewrites a
  // previously recorded DOM observation as insufficient evidence.
  // A partial replay must never silently disregard that disagreement.
  const conflicting={...authentic,history:[
   {...authentic.history[0],kind:'INSUFFICIENT_EVIDENCE' as const,
    evidenceHash:null,status:'INDETERMINATE' as const},
   authentic.history[1]
  ]};
  const attempted=await saveLimitedHealthArchive(userData,conflicting);
  assert.equal(attempted.status,'BLOCKED',
   'a matching latest entry cannot launder a conflicting older event');
  assert.deepEqual(await readLimitedHealthArchive(userData,key),baseline);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-015/TEST-024/026: overlapping history refuses a previously unsaved interior observation',async()=>{
 const {saveLimitedHealthArchive,readLimitedHealthArchive}=
  require('../../src/health/limited-health-archive') as typeof import('../../src/health/limited-health-archive');
 const home=await mkdtemp(join(tmpdir(),'uah-health-interior-replay-'));
 try{
  const userData=join(home,'user-data');await mkdir(userData);
  const key=limitedScenarioHistoryKey(A,'interior-event');
  let clock=Date.now()-5000;
  const saved=new LimitedHealthRegistry(()=>clock);
  saved.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
  clock+=2000;
  saved.record({scriptHash:key,kind:'INSUFFICIENT_EVIDENCE',evidenceHash:null});
  assert.equal((await saveLimitedHealthArchive(userData,saved.snapshot(key))).status,
   'ARCHIVE_SAVED_UNVERIFIED');
  const baseline=await readLimitedHealthArchive(userData,key);
  const later=new LimitedHealthRegistry(()=>clock);
  clock-=2000;
  later.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
  clock+=1000;
  later.record({scriptHash:key,kind:'INSUFFICIENT_EVIDENCE',evidenceHash:null});
  clock+=1000;
  later.record({scriptHash:key,kind:'INSUFFICIENT_EVIDENCE',evidenceHash:null});
  const rejected=await saveLimitedHealthArchive(userData,later.snapshot(key));
  assert.equal(rejected.status,'BLOCKED',
   'a matching head and tail must not launder an unsaved interior observation');
  assert.deepEqual(await readLimitedHealthArchive(userData,key),baseline,
   'the original published sequence must remain unchanged');

  // Valid, genuinely new future evidence remains appendable.
  clock+=1000;
  saved.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
  assert.equal((await saveLimitedHealthArchive(userData,saved.snapshot(key))).status,
   'ARCHIVE_SAVED_UNVERIFIED');
  const appended=await readLimitedHealthArchive(userData,key);
  assert.equal(appended.status,'ARCHIVE_READ_UNVERIFIED');
  if(appended.status==='ARCHIVE_READ_UNVERIFIED')
   assert.equal(appended.events.length,3);
 }finally{await rm(home,{recursive:true,force:true});}
});


test('TASK-015/TEST-024/026: unavailable or overflowing native clock blocks archive reads and writes',async()=>{
 const {saveLimitedHealthArchive,readLimitedHealthArchive}=
  require('../../src/health/limited-health-archive') as typeof import('../../src/health/limited-health-archive');
 const home=await mkdtemp(join(tmpdir(),'uah-health-clock-invalid-'));
 const originalNow=Date.now;
 try{
  const userData=join(home,'user-data');await mkdir(userData);
  const existingKey=limitedScenarioHistoryKey(A,'existing-clock');
  const newKey=limitedScenarioHistoryKey(A,'new-clock');
  const original=new LimitedHealthRegistry(()=>originalNow()-1000);
  original.record({scriptHash:existingKey,kind:'INSUFFICIENT_EVIDENCE',evidenceHash:null});
  assert.equal((await saveLimitedHealthArchive(userData,original.snapshot(existingKey))).status,
   'ARCHIVE_SAVED_UNVERIFIED');
  const toSave=new LimitedHealthRegistry(()=>originalNow()-1000);
  toSave.record({scriptHash:newKey,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
  const candidate=toSave.snapshot(newKey);
  for(const invalid of [NaN,Infinity,-1,Number.MAX_SAFE_INTEGER]){
   Date.now=()=>invalid;
   assert.equal((await readLimitedHealthArchive(userData,existingKey)).status,'BLOCKED',
    'invalid clock cannot certify a stored timeline: '+String(invalid));
   assert.equal((await saveLimitedHealthArchive(userData,candidate)).status,'BLOCKED',
    'invalid clock cannot authorize publication: '+String(invalid));
   Date.now=originalNow;
   assert.equal((await readLimitedHealthArchive(userData,newKey)).status,'NOT_FOUND',
    'clock rejection must not publish candidate history');
  }
  assert.equal((await readLimitedHealthArchive(userData,existingKey)).status,
   'ARCHIVE_READ_UNVERIFIED','valid clock still permits existing unverified archive');
 }finally{
  Date.now=originalNow;
  await rm(home,{recursive:true,force:true});
 }
});


test('TASK-015/TEST-024/026: pending native archive save pins validated script scope before filesystem awaits',async()=>{
 const {saveLimitedHealthArchive,readLimitedHealthArchive}=
  require('../../src/health/limited-health-archive') as typeof import('../../src/health/limited-health-archive');
 const home=await mkdtemp(join(tmpdir(),'uah-health-scope-race-'));
 try{
  const userData=join(home,'user-data');await mkdir(userData);
  const key=limitedScenarioHistoryKey(A,'first');
  const otherKey=limitedScenarioHistoryKey(B,'first');
  const registry=new LimitedHealthRegistry(()=>Date.now()-1000);
  registry.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
  // Native callers should snapshot inputs, but this exported asynchronous
  // boundary must not silently persist A's validated events under B's key.
  const observation=registry.snapshot(key);
  const mutable={...observation,scriptHash:key,history:[...observation.history]};
  const saving=saveLimitedHealthArchive(userData,mutable);
  mutable.scriptHash=otherKey;
  const result=await saving;
  assert.equal(result.status,'ARCHIVE_SAVED_UNVERIFIED',JSON.stringify(result));
  assert.equal((await readLimitedHealthArchive(userData,key)).status,
   'ARCHIVE_READ_UNVERIFIED','validated original scope must survive asynchronous input changes');
  assert.equal((await readLimitedHealthArchive(userData,otherKey)).status,'NOT_FOUND',
   'mutated input must never redirect a validated native history write');
  assert.deepEqual(await readdir(join(userData,'limited-health-history-v1')),
   ['health-'+key+'.json']);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-015/TEST-024/026: read-only health archive refuses history while its native save mutex is present',async()=>{
 const {saveLimitedHealthArchive,readLimitedHealthArchive}=
  require('../../src/health/limited-health-archive') as typeof import('../../src/health/limited-health-archive');
 const home=await mkdtemp(join(tmpdir(),'uah-archive-read-lock-'));
 const userData=join(home,'user-data');
 const key=limitedScenarioHistoryKey(A,'lock-scenario');
 try{
  await mkdir(userData);
  const registry=new LimitedHealthRegistry(()=>1000);
  registry.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
  assert.equal((await saveLimitedHealthArchive(userData,registry.snapshot(key))).status,
   'ARCHIVE_SAVED_UNVERIFIED');
  const lock=join(userData,'limited-health-history-v1','.health-'+key+'.lock');
  await mkdir(lock);
  const during=await readLimitedHealthArchive(userData,key);
  assert.equal(during.status,'BLOCKED',JSON.stringify(during));
  assert.equal(during.automaticPatchAllowed,false);
  assert.equal(during.businessVerified,false);
  await rm(lock,{recursive:true});
  const restored=await readLimitedHealthArchive(userData,key);
  assert.equal(restored.status,'ARCHIVE_READ_UNVERIFIED');
  if(restored.status==='ARCHIVE_READ_UNVERIFIED'){
   assert.equal(restored.currentStatus,'INDETERMINATE');
   assert.deepEqual(restored.events,[{observedAtMs:1000,status:'ELEMENT_FOUND_ONLY'}]);
  }
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-015/TEST-024/026: same-tick conflicting archive evidence stays indeterminate after session merge',()=>{
 const session=new DesktopScenarioSession();
 const history=new LimitedHealthRegistry(()=>1000);
 assert.equal(stage(session,'same-tick',A).ok,true);
 const key=limitedScenarioHistoryKey(A,'same-tick');
 history.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
 const current=readLimitedSessionHistory(session,history,'same-tick');
 assert.equal(current.ok,true);
 if(!current.ok)return;
 assert.equal(current.currentStatus,'ELEMENT_FOUND_ONLY');
 const archived={
  status:'ARCHIVE_READ_UNVERIFIED' as const,
  currentStatus:'INDETERMINATE' as const,
  events:Object.freeze([{observedAtMs:1000,status:'INDETERMINATE' as const}]),
  tampermonkeyVerified:false as const,businessVerified:false as const,
  automaticPatchAllowed:false as const,automaticRollbackAllowed:false as const
 };
 const merged=mergeLimitedSessionArchive(current,archived);
 assert.equal(merged.archiveRetained,true);
 assert.deepEqual(merged.events,[{observedAtMs:1000,status:'INDETERMINATE'}]);
 assert.equal(merged.currentStatus,'INDETERMINATE',
  'a same-clock-tick observation cannot promote an archived uncertain state');
 assert.equal(merged.businessVerified,false);
 assert.equal(merged.automaticPatchAllowed,false);
});

test('TASK-015/TEST-024: a strictly newer native observation may show limited DOM status without inheriting archive authority',()=>{
 let clock=1000;
 const session=new DesktopScenarioSession();
 const history=new LimitedHealthRegistry(()=>clock);
 assert.equal(stage(session,'newer-tick',A).ok,true);
 const key=limitedScenarioHistoryKey(A,'newer-tick');
 clock=1001;
 history.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
 const current=readLimitedSessionHistory(session,history,'newer-tick');
 if(!current.ok)throw Error('SESSION_HISTORY_UNAVAILABLE');
 const archived={
  status:'ARCHIVE_READ_UNVERIFIED' as const,currentStatus:'INDETERMINATE' as const,
  events:Object.freeze([{observedAtMs:1000,status:'INDETERMINATE' as const}]),
  tampermonkeyVerified:false as const,businessVerified:false as const,
  automaticPatchAllowed:false as const,automaticRollbackAllowed:false as const
 };
 const merged=mergeLimitedSessionArchive(current,archived);
 assert.equal(merged.currentStatus,'ELEMENT_FOUND_ONLY');
 assert.deepEqual(merged.events,[
  {observedAtMs:1000,status:'INDETERMINATE'},
  {observedAtMs:1001,status:'ELEMENT_FOUND_ONLY'}
 ]);
 assert.equal(merged.tampermonkeyVerified,false);
 assert.equal(merged.businessVerified,false);
 assert.equal(merged.automaticPatchAllowed,false);
});

test('TASK-015/TEST-024/026: archive merge drops injected authority and arbitrary view fields',()=>{
 const session=new DesktopScenarioSession();
 const history=new LimitedHealthRegistry(()=>2001);
 assert.equal(stage(session,'safe-projection',A).ok,true);
 const key=limitedScenarioHistoryKey(A,'safe-projection');
 history.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
 const readonly=readLimitedSessionHistory(session,history,'safe-projection');
 if(!readonly.ok)throw Error('SESSION_HISTORY_UNAVAILABLE');
 const archive={
  status:'ARCHIVE_READ_UNVERIFIED' as const,
  currentStatus:'INDETERMINATE' as const,
  events:Object.freeze([{observedAtMs:2000,status:'INDETERMINATE' as const}]),
  tampermonkeyVerified:false as const,businessVerified:false as const,
  automaticPatchAllowed:false as const,automaticRollbackAllowed:false as const
 };
 // Simulate a future native caller supplying a structurally compatible view
 // with unexpected own fields. Return types are not runtime security checks.
 const forged=Object.assign({},readonly,{
  tampermonkeyVerified:true,businessVerified:true,
  automaticPatchAllowed:true,automaticRollbackAllowed:true,
  rawScript:'PRIVATE_SCRIPT_BYTES',externalAuthority:'VERIFIED'
 }) as unknown as Extract<typeof readonly,{ok:true}>;
 const merged=mergeLimitedSessionArchive(forged,archive);
 assert.equal(merged.currentStatus,'ELEMENT_FOUND_ONLY');
 assert.deepEqual(merged.events,[
  {observedAtMs:2000,status:'INDETERMINATE'},
  {observedAtMs:2001,status:'ELEMENT_FOUND_ONLY'}
 ]);
 assert.equal(merged.tampermonkeyVerified,false);
 assert.equal(merged.businessVerified,false);
 assert.equal(merged.automaticPatchAllowed,false);
 assert.equal(merged.automaticRollbackAllowed,false);
 assert.equal(Object.hasOwn(merged,'rawScript'),false);
 assert.equal(Object.hasOwn(merged,'externalAuthority'),false);
 assert.deepEqual(Object.keys(merged).sort(),[
  'archiveRetained','automaticPatchAllowed','automaticRollbackAllowed',
  'businessVerified','currentStatus','events','ok','status',
  'tampermonkeyVerified'
 ].sort());
 assert.ok(Object.isFrozen(merged));
 assert.ok(Object.isFrozen(merged.events));
 assert.ok(Object.isFrozen(merged.events[0]));
 assert.equal(JSON.stringify(merged).includes('PRIVATE_SCRIPT_BYTES'),false);
});

test('TASK-015/TEST-024/026: forged newer current health status never gains verification authority',()=>{
 const session=new DesktopScenarioSession();
 const history=new LimitedHealthRegistry(()=>3001);
 assert.equal(stage(session,'status-boundary',A).ok,true);
 const key=limitedScenarioHistoryKey(A,'status-boundary');
 history.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
 const view=readLimitedSessionHistory(session,history,'status-boundary');
 if(!view.ok)throw Error('SESSION_HISTORY_UNAVAILABLE');
 const archived={
  status:'ARCHIVE_READ_UNVERIFIED' as const,currentStatus:'INDETERMINATE' as const,
  events:Object.freeze([{observedAtMs:3000,status:'INDETERMINATE' as const}]),
  tampermonkeyVerified:false as const,businessVerified:false as const,
  automaticPatchAllowed:false as const,automaticRollbackAllowed:false as const
 };
 // TypeScript view types alone cannot reject forged status at runtime.
 for(const forgedStatus of ['RECOVERED_VERIFIED','BROKEN_VERIFIED','UNTESTED'] as const){
  const input={...view,currentStatus:forgedStatus} as unknown as typeof view;
  const merged=mergeLimitedSessionArchive(input,archived);
  assert.equal(merged.currentStatus,'INDETERMINATE',forgedStatus);
  assert.equal(merged.businessVerified,false);
  assert.equal(merged.tampermonkeyVerified,false);
  assert.equal(merged.automaticPatchAllowed,false);
  assert.equal(merged.automaticRollbackAllowed,false);
  assert.equal(JSON.stringify(merged).includes(forgedStatus),false);
  assert.equal(merged.events[1]?.status,'ELEMENT_FOUND_ONLY');
 }
 // Real post-restart native DOM observation is still permitted, unverified.
 assert.equal(mergeLimitedSessionArchive(view,archived).currentStatus,
  'ELEMENT_FOUND_ONLY');
});

/** A type assertion is not an evidence validator at the exported native
 * merge boundary. Runtime-forged records may never mint recovery status or
 * invoke script-owned getters, even when called outside the Electron handler.
 */
test('TASK-015/TEST-024/026: merged archive refuses forged event status and accessors',()=>{
 const session=new DesktopScenarioSession();
 const registry=new LimitedHealthRegistry(()=>2001);
 assert.equal(stage(session,'malformed-merge',A).ok,true);
 const key=limitedScenarioHistoryKey(A,'malformed-merge');
 registry.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
 const current=readLimitedSessionHistory(session,registry,'malformed-merge');
 if(!current.ok)throw Error('SESSION_HISTORY_UNAVAILABLE');
 const validArchive={
  status:'ARCHIVE_READ_UNVERIFIED' as const,
  currentStatus:'INDETERMINATE' as const,
  events:[{observedAtMs:2000,status:'INDETERMINATE' as const}],
  tampermonkeyVerified:false as const,businessVerified:false as const,
  automaticPatchAllowed:false as const,automaticRollbackAllowed:false as const
 };
 const merge=(now:unknown,old:unknown)=>mergeLimitedSessionArchive(
  now as typeof current,
  old as Parameters<typeof mergeLimitedSessionArchive>[1]
 );
 const forged={
  ...validArchive,events:[{observedAtMs:2000,status:'RECOVERED_VERIFIED'}]
 };
 assert.throws(()=>merge(current,forged),/INVALID_LIMITED_HISTORY_EVENTS/);
 let getterReads=0,proxyReads=0;
 const accessor=Object.defineProperty({},'observedAtMs',{get(){
  getterReads++;throw Error('PRIVATE_HISTORY_GETTER');
 }});
 const proxy=new Proxy({observedAtMs:2000,status:'INDETERMINATE'},{
  getPrototypeOf(){proxyReads++;throw Error('PRIVATE_HISTORY_PROXY');}
 });
 for(const bad of [accessor,proxy]){
  assert.throws(()=>merge(current,{...validArchive,events:[bad]}),
   /INVALID_LIMITED_HISTORY_EVENTS/);
  assert.throws(()=>merge({...current,events:[bad]},validArchive),
   /INVALID_LIMITED_HISTORY_EVENTS/);
 }
 assert.equal(getterReads,0);
 assert.equal(proxyReads,0);
 assert.deepEqual(merge(current,validArchive).events,[
  {observedAtMs:2000,status:'INDETERMINATE'},
  {observedAtMs:2001,status:'ELEMENT_FOUND_ONLY'}
 ]);
});



/** TASK-015 / TEST-024/026: the exported native archive merge must not
 * access outer record getters/Proxy traps just to discover its event rows.
 * The IPC caller cannot make a TypeScript assertion into native authority.
 */
test('TASK-015/TEST-024/026: archive merge refuses top-level getters and Proxy traps',()=>{
 const session=new DesktopScenarioSession();
 const history=new LimitedHealthRegistry(()=>2001);
 assert.equal(stage(session,'outer-record',A).ok,true);
 const key=limitedScenarioHistoryKey(A,'outer-record');
 history.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
 const current=readLimitedSessionHistory(session,history,'outer-record');
 if(!current.ok)throw Error('SESSION_HISTORY_UNAVAILABLE');
 const archived={
  status:'ARCHIVE_READ_UNVERIFIED' as const,
  currentStatus:'INDETERMINATE' as const,
  events:[{observedAtMs:2000,status:'INDETERMINATE' as const}],
  tampermonkeyVerified:false as const,businessVerified:false as const,
  automaticPatchAllowed:false as const,automaticRollbackAllowed:false as const
 };
 let getterReads=0,proxyReads=0;
 const getter=()=>{getterReads++;throw Error('PRIVATE_OUTER_GETTER');};
 const proxy=(value:object)=>new Proxy(value,{
  get(){proxyReads++;throw Error('PRIVATE_OUTER_PROXY');},
  getOwnPropertyDescriptor(){proxyReads++;throw Error('PRIVATE_OUTER_PROXY');}
 });
 const merge=(view:unknown,archive:unknown)=>mergeLimitedSessionArchive(
  view as typeof current,
  archive as Parameters<typeof mergeLimitedSessionArchive>[1]
 );
 for(const forged of [
  Object.defineProperty({...archived},'events',{get:getter}),
  Object.defineProperty({...archived},'currentStatus',{get:getter}),
  proxy(archived)
 ])assert.throws(()=>merge(current,forged),/INVALID_LIMITED_HISTORY_EVENTS/);
 for(const forged of [
  Object.defineProperty({...current},'events',{get:getter}),
  Object.defineProperty({...current},'currentStatus',{get:getter}),
  proxy(current)
 ])assert.throws(()=>merge(forged,archived),/INVALID_LIMITED_HISTORY_EVENTS/);
 assert.equal(getterReads,0,'native outer getters must never run');
 assert.equal(proxyReads,0,'native outer Proxy traps must never run');
 assert.deepEqual(merge(current,archived).events,[
  {observedAtMs:2000,status:'INDETERMINATE'},
  {observedAtMs:2001,status:'ELEMENT_FOUND_ONLY'}
 ]);
});

test('TASK-015/TEST-024/026: native history merge refuses far-future session and archive observations',()=>{
 const now=Date.now();
 const scenario=new DesktopScenarioSession();
 const health=new LimitedHealthRegistry(()=>now-1000);
 assert.equal(stage(scenario,'future-merge',A).ok,true);
 const key=limitedScenarioHistoryKey(A,'future-merge');
 health.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
 const current=readLimitedSessionHistory(scenario,health,'future-merge');
 if(!current.ok)throw Error('SESSION_HISTORY_UNAVAILABLE');
 const archive={
  status:'ARCHIVE_READ_UNVERIFIED' as const,
  currentStatus:'INDETERMINATE' as const,
  events:[{observedAtMs:now-2000,status:'INDETERMINATE' as const}],
  tampermonkeyVerified:false as const,businessVerified:false as const,
  automaticPatchAllowed:false as const,automaticRollbackAllowed:false as const
 };
 const merge=(recent:unknown,old:unknown)=>mergeLimitedSessionArchive(
  recent as typeof current,old as Parameters<typeof mergeLimitedSessionArchive>[1]);
 const impossible=now+24*60*60*1000;
 assert.throws(()=>merge(current,{...archive,
  events:[{observedAtMs:impossible,status:'INDETERMINATE'}]
 }),/INVALID_LIMITED_HISTORY_EVENTS/,
 'a future-stamped archive must not poison a restarted history timeline');
 assert.throws(()=>merge({...current,
  events:[{observedAtMs:impossible,status:'ELEMENT_FOUND_ONLY'}]},archive),
  /INVALID_LIMITED_HISTORY_EVENTS/,
  'a forged future native session event must not appear currently healthy');
 assert.deepEqual(merge(current,archive).events,[
  {observedAtMs:now-2000,status:'INDETERMINATE'},
  {observedAtMs:now-1000,status:'ELEMENT_FOUND_ONLY'}
 ],'valid bounded local observations remain mergeable');
});


test('TASK-015/TEST-024/026: native merge rejects a forged archive identity without trusting its events',()=>{
 const now=Date.now();
 const scenario=new DesktopScenarioSession();
 const history=new LimitedHealthRegistry(()=>now-1000);
 assert.equal(stage(scenario,'archive-identity',A).ok,true);
 const key=limitedScenarioHistoryKey(A,'archive-identity');
 history.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
 const current=readLimitedSessionHistory(scenario,history,'archive-identity');
 if(!current.ok)throw Error('SESSION_HISTORY_UNAVAILABLE');
 const archive={
  status:'ARCHIVE_READ_UNVERIFIED' as const,
  currentStatus:'INDETERMINATE' as const,
  events:[{observedAtMs:now-2000,status:'INDETERMINATE' as const}],
  tampermonkeyVerified:false as const,businessVerified:false as const,
  automaticPatchAllowed:false as const,automaticRollbackAllowed:false as const
 };
 const merge=(old:unknown)=>mergeLimitedSessionArchive(
  current,old as Parameters<typeof mergeLimitedSessionArchive>[1]);
 assert.deepEqual(merge(archive).events,[
  {observedAtMs:now-2000,status:'INDETERMINATE'},
  {observedAtMs:now-1000,status:'ELEMENT_FOUND_ONLY'}
 ]);
 for(const status of ['BLOCKED','NOT_FOUND','ARCHIVE_SAVED_UNVERIFIED',null,undefined]){
  assert.throws(()=>merge({...archive,status}),/INVALID_LIMITED_HISTORY_EVENTS/,
   'only an actual unverified archive-read receipt may contribute historical events');
 }
 assert.throws(()=>merge({...archive,currentStatus:'RECOVERED_VERIFIED'}),
  /INVALID_LIMITED_HISTORY_EVENTS/,
  'an archive read must never claim a verified or fresh current status');
});


test('TASK-015/TEST-024/026: native merge refuses a forged current session identity',()=>{
 const now=Date.now();
 const session=new DesktopScenarioSession();
 const registry=new LimitedHealthRegistry(()=>now-1000);
 assert.equal(stage(session,'session-identity',A).ok,true);
 const key=limitedScenarioHistoryKey(A,'session-identity');
 registry.record({scriptHash:key,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
 const view=readLimitedSessionHistory(session,registry,'session-identity');
 if(!view.ok)throw Error('SESSION_HISTORY_UNAVAILABLE');
 const archive={
  status:'ARCHIVE_READ_UNVERIFIED' as const,
  currentStatus:'INDETERMINATE' as const,
  events:[{observedAtMs:now-2000,status:'INDETERMINATE' as const}],
  tampermonkeyVerified:false as const,businessVerified:false as const,
  automaticPatchAllowed:false as const,automaticRollbackAllowed:false as const
 };
 const merge=(sessionView:unknown)=>mergeLimitedSessionArchive(
  sessionView as typeof view,archive);
 assert.deepEqual(merge(view).events,[
  {observedAtMs:now-2000,status:'INDETERMINATE'},
  {observedAtMs:now-1000,status:'ELEMENT_FOUND_ONLY'}
 ]);
 for(const [ok,status] of [
  [false,'UNVERIFIED_SESSION_HISTORY_ONLY'],
  [true,'RECOVERED_VERIFIED'],
  [true,'SCENARIO_NOT_FOUND'],
  [true,null],
  [true,undefined]
 ] as const){
  assert.throws(()=>merge({...view,ok,status}),
    /INVALID_LIMITED_HISTORY_EVENTS/,
    'only actual read-only session identity can contribute current events');
 }
});


test('TASK-015/TEST-024/026: merged current status cannot contradict its last limited observation',()=>{
 const now=Date.now();
 const scenario=new DesktopScenarioSession();
 const registry=new LimitedHealthRegistry(()=>now-1000);
 assert.equal(stage(scenario,'status-consistency',A).ok,true);
 const key=limitedScenarioHistoryKey(A,'status-consistency');
 registry.record({scriptHash:key,kind:'INSUFFICIENT_EVIDENCE',evidenceHash:null});
 const current=readLimitedSessionHistory(scenario,registry,'status-consistency');
 if(!current.ok)throw Error('SESSION_HISTORY_UNAVAILABLE');
 assert.equal(current.currentStatus,'INDETERMINATE');
 const archive={
  status:'ARCHIVE_READ_UNVERIFIED' as const,
  currentStatus:'INDETERMINATE' as const,
  events:[{observedAtMs:now-2000,status:'INDETERMINATE' as const}],
  tampermonkeyVerified:false as const,businessVerified:false as const,
  automaticPatchAllowed:false as const,automaticRollbackAllowed:false as const
 };
 const native=mergeLimitedSessionArchive(current,archive);
 assert.equal(native.currentStatus,'INDETERMINATE');
 const forged=mergeLimitedSessionArchive(
  {...current,currentStatus:'ELEMENT_FOUND_ONLY'},archive);
 assert.equal(forged.currentStatus,'INDETERMINATE',
  'forged current status must not promote an INDETERMINATE event to a DOM hit');
 assert.deepEqual(forged.events,native.events);
 assert.equal(forged.tampermonkeyVerified,false);
 assert.equal(forged.businessVerified,false);
 assert.equal(forged.automaticPatchAllowed,false);
});
