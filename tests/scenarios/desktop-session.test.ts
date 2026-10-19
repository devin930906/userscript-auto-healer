import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {DesktopScenarioSession} from '../../src/scenarios/desktop-session';

const digest='a'.repeat(64);
const request=()=>({
 id:'user_scenario_01',scriptSha256:digest,targetUrl:'https://example.test/app',
 selector:'#submit',userApproved:true,requiresLogin:false,loginReady:false
});

test('TEST-005/017: only a SHA from the native read-only import session can stage a scenario',()=>{
 const session=new DesktopScenarioSession();
 const rejected=session.register(request());
 assert.deepEqual(rejected,{ok:false,code:'SCRIPT_NOT_IMPORTED',
  automaticPatchAllowed:false,tampermonkeyVerified:false,businessVerified:false});
 session.recordImported(digest);
 const staged=session.register(request());
 assert.equal(staged.ok,true);
 if(staged.ok){
  assert.equal(staged.status,'STAGED_RUNTIME_UNVERIFIED');
  assert.equal(staged.state,'READY_TO_TEST');
  assert.deepEqual(staged.issues,[]);
  assert.equal(staged.scriptSha256,digest);
  assert.equal(staged.automaticPatchAllowed,false);
  assert.equal(staged.tampermonkeyVerified,false);
  assert.equal(staged.businessVerified,false);
  assert.equal(JSON.stringify(staged).includes('https://example.test/app'),false);
 }
 assert.deepEqual(session.register(request()),{ok:false,code:'DUPLICATE_ID',
  automaticPatchAllowed:false,tampermonkeyVerified:false,businessVerified:false});
});
test('TEST-005/017: staging never authorizes a browser visit, login or manager attestation',()=>{
 const session=new DesktopScenarioSession();
 session.recordImported(digest);
 const result=session.register({...request(),id:'login_needed',
   requiresLogin:true,loginReady:false});
 assert.equal(result.ok,true);
 if(result.ok){
  assert.equal(result.state,'UNKNOWN');
  assert.deepEqual(result.issues,['LOGIN_NOT_READY']);
  assert.equal(result.automaticPatchAllowed,false);
 }
 const invalid=session.register({...request(),id:'bad_url',targetUrl:'file:///C:/Users/private'});
 assert.equal(invalid.ok,false);
 if(!invalid.ok)assert.equal(invalid.code,'INVALID_SCENARIO');
 const unapproved=session.register({...request(),id:'no_consent',userApproved:false});
 assert.equal(unapproved.ok,false);
 if(!unapproved.ok)assert.equal(unapproved.code,'NOT_AUTHORIZED');
});
test('TEST-005/026: malformed schema, foreign hashes and hostile getters fail closed',()=>{
 const session=new DesktopScenarioSession();
 session.recordImported(digest);
 let getterCalls=0;
 const accessor={...request()};
 Object.defineProperty(accessor,'targetUrl',{enumerable:true,get(){
   getterCalls++;throw Error('private URL');
 }});
 const badProxy=new Proxy(request(),{ownKeys(){throw Error('private script');}});
 for(const value of [
  null,[],accessor,badProxy,{...request(),source:'// script'},
  {...request(),selector:''},{...request(),selector:'x'.repeat(513)},
  {...request(),scriptSha256:'b'.repeat(64)},{
   ...request(),requiresLogin:'yes'
  },{...request(),userApproved:1},
  {...request(),id:'../bad'},Object.assign(Object.create({other:1}),request())
 ]){
  const out=session.register(value);
  assert.equal(out.ok,false);
  assert.equal(out.automaticPatchAllowed,false);
  assert.equal(out.tampermonkeyVerified,false);
 }
 assert.equal(getterCalls,0);
 assert.equal(session.register(request()).ok,true);
});
test('TEST-005: a failed attempt does not consume a scenario identifier',()=>{
 const session=new DesktopScenarioSession();
 session.recordImported(digest);
 const a=session.register({...request(),targetUrl:'javascript:alert(1)'});
 assert.equal(a.ok,false);
 const b=session.register(request());
 assert.equal(b.ok,true);
});
