import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {access,mkdtemp,rm} from 'node:fs/promises';
import {join,win32} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {prepareApprovedIsolatedProfile} from '../../src/browser/chrome-launcher';
import {launchApprovedIsolatedChrome} from '../../src/browser/owned-chrome';
import {openApprovedTarget} from '../../src/browser/cdp-target';
import {startIsolatedTampermonkeyGmProbe} from '../../src/manager/tampermonkey-gm-probe';
import {
 inspectApprovedScenarioDom,summarizeReadOnlyScenarioDom,
 inspectApprovedScenarioDomSeries,summarizeReadOnlyScenarioDomSeries
} from '../../src/diagnostics/scenario-dom-diagnostic';
import type {ScenarioInput} from '../../src/scenarios/scenario-registry';
import type {ObservationResult} from '../../src/observe/dom-observer';

const baseScenario:ScenarioInput={
 id:'owned_cdp_fixture',scriptSha256:'a'.repeat(64),userApproved:true,
 requiresLogin:false,targetUrl:'http://127.0.0.1:9081/',
 steps:[],assertions:[
   {kind:'selector-present',selector:'#current-target'},
   {kind:'selector-present',selector:'#obsolete-target'}
 ]
};
function sample(counts:Record<string,number>,routeChanged=false):ObservationResult{
 return {ok:true,status:'LIMITED_DOM_OBSERVATION',
   observedAt:'2026-10-18T00:00:00Z',routeChanged,originMatchesApproved:true,
   summary:{elementCount:4,iframeCount:0,visibleShadowRoots:0,blindSpots:[]},
   selectorCounts:counts,fullPageVerified:false,userscriptVerified:false};
}
const matched={'#current-target':1,'#obsolete-target':0};

test('TEST-013: absent approved top-level selector yields signal, never permission to patch',()=>{
 const result=summarizeReadOnlyScenarioDom(baseScenario,sample(matched),true);
 assert.equal(result.status,'LIMITED_DOM_SIGNAL_ONLY');
 assert.equal(result.checkedAssertions,2);
 assert.equal(result.triage.category,'SELECTOR_ASSERTION');
 assert.equal(result.triage.status,'SINGLE_CAUSE_SIGNAL_ONLY');
 assert.deepEqual(result.triage.evidenceIds,['scenario_assertion_2']);
 assert.equal(result.automaticPatchAllowed,false);
 assert.equal(result.businessVerified,false);
 assert.equal(result.tampermonkeyVerified,false);
 assert.equal(result.triage.businessRecoveredVerified,false);
});
test('TEST-013: all selectors present only means no missing DOM signal',()=>{
 const result=summarizeReadOnlyScenarioDom(
   baseScenario,sample({'#current-target':1,'#obsolete-target':1}),true);
 assert.equal(result.status,'LIMITED_DOM_SIGNAL_ONLY');
 assert.equal(result.triage.status,'NO_FAULT_SIGNAL');
 assert.equal(result.triage.category,'UNKNOWN');
 assert.equal(result.businessVerified,false);
});
test('TEST-013: consent and scenario registration cannot be forged into permission',()=>{
 const absent=summarizeReadOnlyScenarioDom(baseScenario,sample(matched),false);
 assert.equal(absent.code,'NOT_AUTHORIZED');
 for(const scenario of [
   {...baseScenario,userApproved:false},
   {...baseScenario,scriptSha256:'invalid'},
   {...baseScenario,targetUrl:undefined},
   {...baseScenario,assertions:[]},
   {...baseScenario,steps:[{kind:'wait-for',selector:'#current-target'}]},
   {...baseScenario,requiresLogin:true,loginReady:true},
   {...baseScenario,assertions:[{kind:'text-contains',selector:'body',expectedText:'secret'}]},
   {...baseScenario,assertions:[{kind:'selector-present',selector:'#secret',expectedText:'secret'}]},
   {...baseScenario,assertions:[
     {kind:'selector-present',selector:'#current-target'},
     {kind:'selector-present',selector:'#current-target'}
   ]},
   {...baseScenario,assertions:[{kind:'selector-present',selector:'x'.repeat(257)}]},
   {...baseScenario,assertions:[{kind:'selector-present',selector:'#a\n#b'}]},
   {...baseScenario,targetUrl:'http://127.0.0.1:9081/#private'}
 ]){
   const result=summarizeReadOnlyScenarioDom(scenario,sample(matched),true);
   assert.equal(result.status,'BLOCKED');
   assert.equal(result.triage.category,'UNKNOWN');
   assert.equal(result.automaticPatchAllowed,false);
 }
});
test('TEST-013: CDP failures and same-origin SPA route change block diagnostic proof',()=>{
 for(const observed of [
   {ok:false,code:'CDP_FAILED'} as const,
   {ok:false,code:'UNVERIFIED_TARGET'} as const,
   sample(matched,true),
   {...sample(matched),routeChanged:undefined} as unknown as ObservationResult,
   {...sample(matched),selectorCounts:{...matched,'#unapproved':1}} as ObservationResult,
   {...sample(matched),summary:{elementCount:0,iframeCount:0,visibleShadowRoots:0,blindSpots:[]}} as ObservationResult,
   sample({'#current-target':1}),
   sample({'#current-target':1,'#obsolete-target':NaN}),
   sample({'#current-target':1,'#obsolete-target':-1}),
   {...sample(matched),fullPageVerified:true} as unknown as ObservationResult,
   {...sample(matched),userscriptVerified:true} as unknown as ObservationResult
 ]){
   const result=summarizeReadOnlyScenarioDom(baseScenario,observed,true);
   assert.equal(result.status,'BLOCKED');
   assert.equal(result.triage.status,'INSUFFICIENT_EVIDENCE');
   assert.equal(result.automaticPatchAllowed,false);
 }
});
test('TEST-013: classified result never leaks URL, selectors or script hash',()=>{
 const result=summarizeReadOnlyScenarioDom(
   {...baseScenario,targetUrl:'https://example.test/private?token=DO_NOT_LEAK'},
   sample(matched),true);
 assert.equal(result.status,'LIMITED_DOM_SIGNAL_ONLY');
 const output=JSON.stringify(result);
 for(const term of ['DO_NOT_LEAK','#obsolete-target','example.test','aaaaaa'])
   assert.equal(output.includes(term),false);
});

test('TEST-013: stable repeated selector observations stay limited, not business-verified',()=>{
 const approved=sample(matched);
 const observed={
   ok:true as const,status:'LIMITED_DYNAMIC_OBSERVATION' as const,
   samples:[approved,approved,approved],routeChangeDetected:false,
   selectorCountChanged:false,domCountChanged:false,userscriptVerified:false as const
 };
 const result=summarizeReadOnlyScenarioDomSeries(baseScenario,
   observed as unknown as Parameters<typeof summarizeReadOnlyScenarioDomSeries>[1],true);
 assert.equal(result.status,'LIMITED_DOM_SIGNAL_ONLY');
 assert.equal(result.triage.category,'SELECTOR_ASSERTION');
 assert.deepEqual(result.triage.evidenceIds,['scenario_assertion_2']);
 assert.equal(result.tampermonkeyVerified,false);
 assert.equal(result.businessVerified,false);
 assert.equal(result.automaticPatchAllowed,false);
});

test('TEST-013: changing or contradictory samples cannot yield stable defect evidence',()=>{
 const snapshots=[sample(matched),sample({'#current-target':1,'#obsolete-target':1})];
 const make=(samples:unknown[],extra:Record<string,unknown>={})=>({
   ok:true,status:'LIMITED_DYNAMIC_OBSERVATION',
   samples,routeChangeDetected:false,selectorCountChanged:false,
   domCountChanged:false,userscriptVerified:false,...extra
 }) as unknown as Parameters<typeof summarizeReadOnlyScenarioDomSeries>[1];
 for(const observed of [
   make(snapshots),
   make([sample(matched),sample(matched,true)]),
   make([sample(matched),sample({'#current-target':0,'#obsolete-target':0})]),
   make([sample(matched),sample(matched)],{selectorCountChanged:true}),
   make([sample(matched),sample(matched)],{routeChangeDetected:true}),
   make([sample(matched),sample(matched)],{domCountChanged:true}),
   make([sample(matched),sample({...matched})],{samples:[]}),
   make([sample(matched),sample(matched)],{samples:[sample(matched)]}),
   make([sample(matched),sample(matched)],{userscriptVerified:true}),
   make([sample(matched),sample(matched)],{routeChangeDetected:undefined}),
   make([sample(matched),{...sample(matched),observedAt:'not-a-date'}]),
   make([sample(matched),{...sample(matched),observedAt:'2026-10-17T00:00:00Z'}]),
   make([sample(matched),{...sample(matched),summary:{elementCount:3,iframeCount:0,visibleShadowRoots:0,blindSpots:[]}}])
 ]){
   const result=summarizeReadOnlyScenarioDomSeries(baseScenario,observed,true);
   assert.equal(result.status,'BLOCKED');
   assert.equal(result.businessVerified,false);
   assert.equal(result.automaticPatchAllowed,false);
 }
 assert.equal(summarizeReadOnlyScenarioDomSeries(
   baseScenario,make([sample(matched),sample(matched)]),false).code,'NOT_AUTHORIZED');
});

test('TEST-013: executable owned-browser entry refuses forged, unowned or cancelled sessions',async()=>{
 const bogus={ok:false,code:'PREFLIGHT_FAILED'} as const;
 const target={ok:false,code:'UNVERIFIED_BROWSER'} as const;
 assert.equal((await inspectApprovedScenarioDom(bogus,target,baseScenario,false)).code,
   'NOT_AUTHORIZED');
 assert.equal((await inspectApprovedScenarioDom(bogus,target,baseScenario,true)).code,
   'UNVERIFIED_BROWSER');
 assert.equal((await inspectApprovedScenarioDom(bogus,target,baseScenario,true,
   AbortSignal.abort())).code,'CANCELLED');
});

test('TEST-013: Windows owned Chrome yields limited selector triage without a script',async t=>{
 if(process.platform!=='win32'){t.skip('Requires actual signed Chrome on Windows');return;}
 let chrome:string|undefined;
 for(const dir of [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA]){
   if(!dir)continue;
   const candidate=win32.join(dir,'Google','Chrome','Application','chrome.exe');
   try{await access(candidate);chrome=candidate;break;}catch{/* no Chrome at that path */}
 }
 assert.ok(chrome,'Windows runner should contain signed Google Chrome');
 const root=await mkdtemp(join(tmpdir(),'uah-fault-cdp-'));
 let stopChrome=()=>{};
 t.after(async()=>{stopChrome();await rm(root,{recursive:true,force:true}).catch(()=>undefined);});
 const socket=createServer();
 await new Promise<void>((resolve,reject)=>{
   socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);
 });
 const addr=socket.address();
 await new Promise<void>(resolve=>socket.close(()=>resolve()));
 if(!addr||typeof addr==='string')throw Error('NO_PORT');
 const cfg={executablePath:chrome!,userDataDir:join(root,'profile'),
   remoteDebuggingPort:addr.port,bindAddress:'127.0.0.1' as const};
 const prepared=await prepareApprovedIsolatedProfile(cfg,true);
 assert.equal(prepared.ok,true,JSON.stringify(prepared));
 const opened=await launchApprovedIsolatedChrome(cfg,{userApproved:true,testHeadless:true});
 assert.equal(opened.ok,true,JSON.stringify(opened));
 if(!opened.ok)return;
 stopChrome=opened.stop;
 const probe=await startIsolatedTampermonkeyGmProbe(true,90000);
 assert.equal(probe.ok,true,JSON.stringify(probe));
 if(!probe.ok)return;
 t.after(()=>probe.session.stop());
 const url=probe.session.origin+'/?mode=fixed';
 const tab=await openApprovedTarget(opened,url,true);
 assert.equal(tab.ok,true,JSON.stringify(tab));
 if(!tab.ok)return;
 const scenario={...baseScenario,targetUrl:url};
 let result:Awaited<ReturnType<typeof inspectApprovedScenarioDom>>|undefined;
 for(let attempt=0;attempt<25;attempt++){
   result=await inspectApprovedScenarioDom(opened,tab,scenario,true);
   if(result.status==='LIMITED_DOM_SIGNAL_ONLY')break;
   await delay(160);
 }
 assert.ok(result, 'Expected a diagnostic result');
 assert.equal(result?.status,'LIMITED_DOM_SIGNAL_ONLY',JSON.stringify(result));
 assert.equal(result?.checkedAssertions,2);
 assert.equal(result?.triage.category,'SELECTOR_ASSERTION');
 assert.deepEqual(result?.triage.evidenceIds,['scenario_assertion_2']);
 assert.equal(result?.automaticPatchAllowed,false);
 assert.equal(result?.tampermonkeyVerified,false);
 assert.equal(result?.businessVerified,false);
 const series=await inspectApprovedScenarioDomSeries(opened,tab,scenario,true,2,150);
 assert.equal(series.status,'LIMITED_DOM_SIGNAL_ONLY',JSON.stringify(series));
 assert.equal(series.triage.category,'SELECTOR_ASSERTION');
 assert.equal(series.automaticPatchAllowed,false);
 assert.equal(series.tampermonkeyVerified,false);
 assert.deepEqual(probe.session.receiptSnapshot(),{});
});
