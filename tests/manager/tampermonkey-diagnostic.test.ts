import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {
 assessManualProbeObservations,startApprovedTampermonkeyDiagnostic,createManualModeVisitLatch
} from '../../src/manager/tampermonkey-diagnostic';
import type {GmProbeReceipt} from '../../src/manager/tampermonkey-gm-probe';

const selfReport=(mode:'broken'|'fixed',gm:boolean,business:boolean):GmProbeReceipt=>({
 status:'SELF_REPORTED_FIXTURE_ONLY',mode,
 reportedGmDefaultMatched:gm,reportedBusinessAction:business,
 extensionAuthenticityVerified:false,scriptInstallationVerified:false,
 gmApiVerified:false,businessVerified:false
});
const both={broken:selfReport('broken',true,false),fixed:selfReport('fixed',true,true)};
const visited={broken:true,fixed:true};

test('TEST-017: concurrent or duplicate manual visits are blocked before CDP navigation',()=>{
 const visits=createManualModeVisitLatch();
 assert.deepEqual(visits.snapshot(),{broken:false,fixed:false});
 assert.equal(visits.reserve('broken'),'RESERVED');
 assert.equal(visits.reserve('broken'),'IN_PROGRESS');
 assert.equal(visits.reserve('fixed'),'IN_PROGRESS');
 assert.deepEqual(visits.snapshot(),{broken:false,fixed:false});
 visits.finish('broken',false);
 assert.equal(visits.reserve('fixed'),'RESERVED');
 visits.finish('fixed',true);
 assert.deepEqual(visits.snapshot(),{broken:false,fixed:true});
 assert.equal(visits.reserve('fixed'),'ALREADY_VISITED');
 assert.equal(visits.reserve('broken'),'RESERVED');
 visits.finish('broken',true);
 assert.deepEqual(visits.snapshot(),{broken:true,fixed:true});
 assert.equal(visits.reserve('broken'),'ALREADY_VISITED');
 // A late failure notification cannot roll back an already confirmed visit.
 visits.finish('broken',false);
 assert.deepEqual(visits.snapshot(),{broken:true,fixed:true});
});

test('TEST-017: orchestration rejects missing authorization and forged browser identity',async()=>{
 const fake={ok:true as const,status:'OWNED_CDP_BROWSER_VERIFIED' as const,
   pid:123456,chromeVersion:'155.0.0.0',
   browserWebsocket:'ws://127.0.0.1:9223/devtools/browser/1234567890abcdef',
   websocketHandshakeVerified:true as const,targetVerified:false as const,stop:()=>{}};
 assert.deepEqual(await startApprovedTampermonkeyDiagnostic(fake,false),
   {ok:false,code:'NOT_AUTHORIZED'});
 assert.deepEqual(await startApprovedTampermonkeyDiagnostic(fake,true),
   {ok:false,code:'UNVERIFIED_BROWSER'});
 const signal=AbortSignal.abort();
 assert.deepEqual(await startApprovedTampermonkeyDiagnostic(fake,true,{signal}),
   {ok:false,code:'CANCELLED'});
 assert.deepEqual(await startApprovedTampermonkeyDiagnostic(
   {ok:false,code:'PREFLIGHT_FAILED'},true),
   {ok:false,code:'UNVERIFIED_BROWSER'});
 for(const ttlMs of [-5,0,999,300001,1.5,NaN,Infinity]){
   assert.deepEqual(await startApprovedTampermonkeyDiagnostic(fake,true,{ttlMs}),
     {ok:false,code:'INVALID_OPTIONS'});
 }
});

test('TEST-018: matching fixture observations never become manager or GM verification',()=>{
 const x=assessManualProbeObservations(both,visited);
 assert.deepEqual(x,{
   status:'SELF_REPORTED_EXPECTATIONS_MATCH',observedModes:2,
   reportedGmDefaultMatched:true,reportedBrokenFailed:true,reportedFixedRecovered:true,
   extensionAuthenticityVerified:false,scriptInstallationVerified:false,
   gmApiVerified:false,businessVerified:false
 });
 assert.equal('verified' in x,false);
});

test('TEST-018: independent missing browser visits make even positive HTTP POSTs incomplete',()=>{
 const x=assessManualProbeObservations(both,{broken:false,fixed:false});
 assert.equal(x.status,'AWAITING_BROWSER_VISITS');
 assert.equal(x.gmApiVerified,false);
 const partiallyVisited=assessManualProbeObservations(both,{broken:true,fixed:false});
 assert.equal(partiallyVisited.status,'AWAITING_BROWSER_VISITS');
});

test('TEST-018: missing or malformed receipts are not accepted as observed success',()=>{
 assert.equal(assessManualProbeObservations({},visited).status,'AWAITING_REPORTS');
 assert.equal(assessManualProbeObservations(
   {broken:both.broken},visited).status,'AWAITING_REPORTS');
 assert.equal(assessManualProbeObservations(
   {broken:{...both.broken,mode:'fixed'},fixed:both.fixed},visited).status,
   'REPORTED_MISMATCH');
 const conflicting={
   broken:selfReport('broken',true,true),fixed:selfReport('fixed',false,true)
 };
 const result=assessManualProbeObservations(conflicting,visited);
 assert.equal(result.status,'REPORTED_MISMATCH');
 assert.equal(result.reportedBrokenFailed,false);
 assert.equal(result.reportedGmDefaultMatched,false);
 assert.equal(result.gmApiVerified,false);
});

test('TEST-017: assessment validates its own input instead of trusting caller claims',()=>{
 for(const value of [null,[],42,'x',{broken:{status:'VERIFIED',mode:'broken'}}]){
   const x=assessManualProbeObservations(value,{broken:true,fixed:true});
   assert.notEqual(x.status,'SELF_REPORTED_EXPECTATIONS_MATCH');
   assert.equal(x.businessVerified,false);
 }
 for(const flags of [null,{}, {broken:true,fixed:'true'},
     {broken:true,fixed:true,extensionVerified:true}]){
   const x=assessManualProbeObservations(both,flags);
   assert.notEqual(x.status,'SELF_REPORTED_EXPECTATIONS_MATCH');
 }
});
