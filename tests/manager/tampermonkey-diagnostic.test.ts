import {access,mkdtemp,rm} from 'node:fs/promises';
import {join,win32} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {prepareApprovedIsolatedProfile} from '../../src/browser/chrome-launcher';
import {launchApprovedIsolatedChrome} from '../../src/browser/owned-chrome';
import {openApprovedTarget} from '../../src/browser/cdp-target';
import {observeApprovedDom} from '../../src/observe/dom-observer';
import {startIsolatedTampermonkeyGmProbe} from '../../src/manager/tampermonkey-gm-probe';
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {
 assessManualProbeObservations,startApprovedTampermonkeyDiagnostic,createManualModeVisitLatch,
 summarizeFixtureDomEvidence,correlateManualFixtureEvidence
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
     '[data-uah-probe-action="done"]':actionCount,
     '#current-target[data-uah-probe-action="done"]':actionCount},
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
     '[data-uah-probe-action="done"]':1,
     '#current-target[data-uah-probe-action="done"]':1},
   fullPageVerified:false as const,userscriptVerified:false as const
 };
 for(const change of [
   {routeChanged:true},{originMatchesApproved:false},
   {selectorCounts:{...base.selectorCounts,'#current-target':0}},
   {selectorCounts:{...base.selectorCounts,'#obsolete-target':1}},
   {selectorCounts:{...base.selectorCounts,'[data-uah-probe-action="done"]':2}},
   // A marker on another element does not prove that the target was acted on.
   {selectorCounts:{...base.selectorCounts,
     '#current-target[data-uah-probe-action="done"]':0}},
   {selectorCounts:{...base.selectorCounts,
     '#current-target[data-uah-probe-action="done"]':2}},
   {selectorCounts:{...base.selectorCounts,
     '[data-uah-probe-action="done"]':0}},
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

test('TEST-018: malformed or mixed fixture DOM snapshots fail closed without throwing',()=>{
 const valid={
   ok:true as const,status:'LIMITED_DOM_OBSERVATION' as const,
   observedAt:'2026-10-18T00:00:00.000Z',
   originMatchesApproved:true as const,routeChanged:false,
   summary:{elementCount:4,iframeCount:0,visibleShadowRoots:0,
     blindSpots:[] as const},
   selectorCounts:{
     '#current-target':1,'#obsolete-target':0,
     '[data-uah-probe-action="done"]':1,
     '#current-target[data-uah-probe-action="done"]':1
   },
   fullPageVerified:false as const,userscriptVerified:false as const
 };
 const asSample=(value:unknown):Parameters<typeof summarizeFixtureDomEvidence>[1]=>
   value as Parameters<typeof summarizeFixtureDomEvidence>[1];
 const malformed=[
   null,42,[],{ok:true},
   {...valid,routeChanged:undefined},
   {...valid,selectorCounts:undefined},
   {...valid,selectorCounts:[]},
   {...valid,selectorCounts:{
     ...valid.selectorCounts,'#unapproved-private-selector':1
   }},
   {...valid,selectorCounts:{
     '#current-target':1,'#obsolete-target':0,
     '[data-uah-probe-action="done"]':1
   }},
   {...valid,summary:undefined},
   {...valid,summary:{...valid.summary,elementCount:0}},
   {...valid,summary:{...valid.summary,iframeCount:-1}},
   {...valid,summary:{...valid.summary,visibleShadowRoots:100}},
   {...valid,observedAt:'2026-02-30T00:00:00.000Z'},
   {...valid,observedAt:'2026-10-18T00:00:00Z'}
 ];
 for(const sample of malformed){
   assert.doesNotThrow(()=>summarizeFixtureDomEvidence('fixed',asSample(sample)));
   assert.deepEqual(summarizeFixtureDomEvidence('fixed',asSample(sample)),
     {ok:false,code:'INVALID_FIXTURE_OBSERVATION'});
 }
 assert.deepEqual(summarizeFixtureDomEvidence(
   'unknown' as 'fixed',asSample(valid)),{ok:false,code:'INVALID_MODE'});
 assert.equal(summarizeFixtureDomEvidence('fixed',valid).ok,true);
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


test('TEST-018 stage: HTTP claims and independent DOM evidence must agree, never become VERIFIED',()=>{
 const observedAt='2026-10-18T00:00:00.000Z';
 const dom=(mode:'broken'|'fixed',actionCount:0|1)=>({
   status:'LIMITED_FIXTURE_DOM_ONLY' as const,mode,observedAt,targetCount:1 as const,
   actionCount,fixtureDomMatchesExpected:actionCount===(mode==='fixed'?1:0),
   extensionAuthenticityVerified:false as const,
   scriptInstallationVerified:false as const,gmApiVerified:false as const,
   businessVerified:false as const
 });
 const matched={broken:dom('broken',0),fixed:dom('fixed',1)};
 const consistent=correlateManualFixtureEvidence(both,visited,matched);
 assert.deepEqual(consistent,{
   status:'CONSISTENT_UNVERIFIED_FIXTURE_ONLY',comparedModes:2,
   extensionAuthenticityVerified:false,scriptInstallationVerified:false,
   gmApiVerified:false,businessVerified:false
 });
 assert.equal(correlateManualFixtureEvidence(both,{broken:false,fixed:true},matched)
   .status,'AWAITING_BROWSER_VISITS');
 assert.equal(correlateManualFixtureEvidence({},visited,matched).status,'AWAITING_REPORTS');
 assert.equal(correlateManualFixtureEvidence(both,visited,{}).status,
   'AWAITING_DOM_OBSERVATIONS');
 assert.deepEqual(correlateManualFixtureEvidence(both,visited,{broken:matched.broken}),{
   status:'AWAITING_DOM_OBSERVATIONS',comparedModes:1,
   extensionAuthenticityVerified:false,scriptInstallationVerified:false,
   gmApiVerified:false,businessVerified:false
 });
 // A forged positive self-report cannot establish recovery when real DOM is unchanged.
 assert.equal(correlateManualFixtureEvidence(both,visited,{
   broken:matched.broken,fixed:dom('fixed',0)
 }).status,'DOM_REPORT_CONFLICT');
 assert.equal(correlateManualFixtureEvidence(both,visited,{
   broken:dom('broken',1),fixed:matched.fixed
 }).status,'DOM_REPORT_CONFLICT');
 assert.equal(correlateManualFixtureEvidence(both,visited,{
   broken:matched.broken,fixed:{...matched.fixed,gmApiVerified:true}
 }).status,'INVALID_DOM_EVIDENCE');
 assert.equal(correlateManualFixtureEvidence(both,visited,{
   broken:matched.broken,fixed:{...matched.fixed,actionCount:42}
 }).status,'INVALID_DOM_EVIDENCE');
 assert.equal(correlateManualFixtureEvidence({
   broken:selfReport('broken',false,false),fixed:both.fixed
 },visited,matched).status,'REPORTED_MISMATCH');
});

/** Actual Windows CDP observation of the temporary fixture, with NO extension
 * installed. This negative is intentionally distinct from TEST-018's future
 * real Tampermonkey/GM and repaired userscript business acceptance.
 */
test('TEST-018 stage: real isolated Windows Chrome never reports a repair without a userscript',async t=>{
 if(process.platform!=='win32'){t.skip('Requires real signed Chrome on Windows');return;}
 let chrome:string|undefined;
 for(const base of [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA]){
   if(!base)continue;
   const candidate=win32.join(base,'Google','Chrome','Application','chrome.exe');
   try{await access(candidate);chrome=candidate;break;}catch{/* no candidate */}
 }
 assert.ok(chrome,'Windows CI should provide signed Chrome');
 const root=await mkdtemp(join(tmpdir(),'uah-tm-diagnostic-negative-'));
 let stopChrome=()=>{};
 t.after(async()=>{stopChrome();await rm(root,{recursive:true,force:true}).catch(()=>undefined);});
 const socket=createServer();
 await new Promise<void>((resolve,reject)=>{
   socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);
 });
 const address=socket.address();
 await new Promise<void>(resolve=>socket.close(()=>resolve()));
 if(!address||typeof address==='string')throw Error('NO_PORT');
 const cfg={executablePath:chrome!,userDataDir:join(root,'isolated-profile'),
   remoteDebuggingPort:address.port,bindAddress:'127.0.0.1' as const};
 const prep=await prepareApprovedIsolatedProfile(cfg,true);
 assert.equal(prep.ok,true,JSON.stringify(prep));
 const opened=await launchApprovedIsolatedChrome(cfg,{userApproved:true,testHeadless:true});
 assert.equal(opened.ok,true,JSON.stringify(opened));
 if(!opened.ok)return;
 stopChrome=opened.stop;
 const probe=await startIsolatedTampermonkeyGmProbe(true,90000);
 assert.equal(probe.ok,true,JSON.stringify(probe));
 if(!probe.ok)return;
 t.after(()=>probe.session.stop());
 const expectedUrl=probe.session.origin+'/?mode=fixed';
 const tab=await openApprovedTarget(opened,expectedUrl,true);
 assert.equal(tab.ok,true,JSON.stringify(tab));
 if(!tab.ok)return;
 // On Windows, a registered target may precede the first DOM navigation commit.
 let observed:Awaited<ReturnType<typeof observeApprovedDom>>={ok:false,code:'CDP_FAILED'};
 for(let tries=0;tries<25;tries++){
   observed=await observeApprovedDom(opened,tab,expectedUrl,true,
     ['#current-target','#obsolete-target','[data-uah-probe-action="done"]',
      '#current-target[data-uah-probe-action="done"]']);
   if(observed.ok&&observed.selectorCounts['#current-target']===1)break;
   await delay(160);
 }
 assert.equal(observed.ok,true,JSON.stringify(observed));
 if(!observed.ok)return;
 const classified=summarizeFixtureDomEvidence('fixed',observed);
 assert.equal(classified.ok,true,JSON.stringify(classified));
 if(!classified.ok)return;
 assert.equal(classified.evidence.actionCount,0);
 assert.equal(classified.evidence.fixtureDomMatchesExpected,false);
 assert.equal(classified.evidence.gmApiVerified,false);
 assert.equal(classified.evidence.businessVerified,false);
 assert.deepEqual(probe.session.receiptSnapshot(),{},
   'No manager is installed, so the fixture has no GM userscript report');
});
