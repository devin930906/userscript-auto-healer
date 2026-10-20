import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {DesktopScenarioSession} from '../../src/scenarios/desktop-session';
import {LimitedHealthRegistry} from '../../src/health/health-registry';
import {readLimitedSessionHistory} from '../../src/health/session-history';

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
 history.record({scriptHash:A,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
 clock=1001;
 history.record({scriptHash:A,kind:'INSUFFICIENT_EVIDENCE',evidenceHash:null});
 history.record({scriptHash:B,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});
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

test('TEST-024: history is limited to 32 events and expires to INDETERMINATE',()=>{
 let now=1000;
 const session=new DesktopScenarioSession();
 stage(session,'one',A);
 const history=new LimitedHealthRegistry(()=>now);
 for(let i=0;i<36;i++){now++;history.record({
  scriptHash:A,kind:'LIMITED_DOM_OBSERVATION',evidenceHash:E});}
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
