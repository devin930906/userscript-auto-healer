import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {
 assessManualProbeObservations,startApprovedTampermonkeyDiagnostic,createManualModeVisitLatch,
 summarizeFixtureDomEvidence
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

test('TEST-018 stage: read-only DOM fixture marker is evidence, never a GM or manager attestation',()=>{
 const sample=(actionCount:number,routeChanged=false)=>({
   ok:true as const,status:'LIMITED_DOM_OBSERVATION' as const,
   observedAt:'2026-10-18T00:00:00.000Z',
   originMatchesApproved:true as const,routeChanged,
   summary:{elementCount:4,iframeCount:0,visibleShadowRoots:0,blindSpots:[] as const},
   selectorCounts:{'#current-target':1,'#obsolete-target':0,
     '[data-uah-probe-action="done"]':actionCount},
   fullPageVerified:false as const,userscriptVerified:false as const
 });
 const broken=summarizeFixtureDomEvidence('broken',sample(0));
 const fixed=summarizeFixtureDomEvidence('fixed',sample(1));
 for(const [result,expected] of [[broken,true],[fixed,true]] as const){
   assert.equal(result.ok,true);
   if(result.ok){
     assert.equal(result.evidence.fixtureDomMatchesExpected,expected);
     assert.equal(result.evidence.extensionAuthenticityVerified,false);
     assert.equal(result.evidence.scriptInstallationVerified,false);
     assert.equal(result.evidence.gmApiVerified,false);
     assert.equal(result.evidence.businessVerified,false);
   }
 }
 const absent=summarizeFixtureDomEvidence('fixed',sample(0));
 assert.equal(absent.ok,true);
 if(absent.ok)assert.equal(absent.evidence.fixtureDomMatchesExpected,false);
 const inappropriate=summarizeFixtureDomEvidence('broken',sample(1));
 assert.equal(inappropriate.ok,true);
 if(inappropriate.ok)assert.equal(inappropriate.evidence.fixtureDomMatchesExpected,false);
});
test('TEST-018: different URL, malformed DOM or failed CDP cannot become fixture evidence',()=>{
 const base={
   ok:true as const,status:'LIMITED_DOM_OBSERVATION' as const,
   observedAt:'2026-10-18T00:00:00.000Z',
   originMatchesApproved:true as const,routeChanged:false,
   summary:{elementCount:3,iframeCount:0,visibleShadowRoots:0,blindSpots:[] as const},
   selectorCounts:{'#current-target':1,'#obsolete-target':0,
     '[data-uah-probe-action="done"]':1},
   fullPageVerified:false as const,userscriptVerified:false as const
 };
 for(const change of [
   {routeChanged:true},{originMatchesApproved:false},
   {selectorCounts:{...base.selectorCounts,'#current-target':0}},
   {selectorCounts:{...base.selectorCounts,'#obsolete-target':1}},
   {selectorCounts:{...base.selectorCounts,'[data-uah-probe-action="done"]':2}},
   {observedAt:'not-a-timestamp'},
   {fullPageVerified:true},
   {userscriptVerified:true}
 ]){
   const result=summarizeFixtureDomEvidence('fixed',{...base,...change} as typeof base);
   assert.deepEqual(result,{ok:false,code:'INVALID_FIXTURE_OBSERVATION'});
 }
 assert.deepEqual(summarizeFixtureDomEvidence('fixed',{ok:false,code:'CDP_FAILED'}),
   {ok:false,code:'CDP_FAILED'});
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
