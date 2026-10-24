import {test} from 'node:test';
import {mkdtemp,mkdir,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {strict as assert} from 'node:assert';
import {DesktopScenarioSession} from '../../src/scenarios/desktop-session';
import {LimitedHealthRegistry} from '../../src/health/health-registry';
import {limitedScenarioHistoryKey,readLimitedSessionHistory} from '../../src/health/session-history';

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
