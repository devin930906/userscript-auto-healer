import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { launchApprovedIsolatedChrome, readBoundedCdpJson, isLiveApprovedChromeSession } from '../../src/browser/owned-chrome';
import { openApprovedTarget } from '../../src/browser/cdp-target';
import {observeApprovedDom} from '../../src/observe/dom-observer';
import { prepareApprovedIsolatedProfile } from '../../src/browser/chrome-launcher';
import { createServer } from 'node:http';

function config(executablePath:string,userDataDir:string,port=9223) {
  return {executablePath,userDataDir,remoteDebuggingPort:port,bindAddress:'127.0.0.1'};
}
/** Reserve an OS-assigned loopback port briefly so Windows parallel test files
 * do not compete for the shared default 9223 listener.
 */
async function unusedLoopbackPort():Promise<number>{
  const probe=createServer();
  await new Promise<void>((resolve,reject)=>{
    probe.once('error',reject);
    probe.listen(0,'127.0.0.1',resolve);
  });
  const address=probe.address();
  await new Promise<void>((resolve,reject)=>
    probe.close(err=>err?reject(err):resolve()));
  if(!address||typeof address==='string')throw Error('PORT_PROBE_FAILED');
  return address.port;
}
/** Read only existence of Chrome's bootstrap markers inside this test-owned
 * disposable profile. Never read their contents or report paths, ports/PIDs,
 * command lines, Chrome logs or user data. These hints are not CDP proof.
 */
async function redactedChromeBootstrapMarkers(profile:string):Promise<string>{
  const exists=async(name:string)=>{
    try { await access(join(profile,name)); return 1; } catch { return 0; }
  };
  const [state,endpoint]=await Promise.all([
    exists('Local State'),exists('DevToolsActivePort')
  ]);
  return 'state='+state+' endpointMarker='+endpoint;
}

/** TASK-005 / TEST-006/008/009/026: diagnostic-only marker transitions.
 * Never retain profile paths, marker contents, ports, process IDs, errors or
 * untrusted strings. The caller observes only its own disposable CI profile.
 * Recording is monotonic, rounded down to whole seconds and capped to 12
 * transitions; no record is permission to relaunch Chrome or accept a CDP.
 */
function createBoundedChromeBootstrapTimeline(){
  const transitions:string[]=[];
  let last='';
  return {
    observe(elapsedMs:number,marker:unknown):void{
      if(!Number.isFinite(elapsedMs)||elapsedMs<0||typeof marker!=='string')
        return;
      const match=/^state=([01]) endpointMarker=([01])$/.exec(marker);
      if(!match)return;
      const next=match[1]+match[2];
      if(next===last)return;
      last=next;
      if(transitions.length>=12)return;
      const second=Math.min(31,Math.floor(elapsedMs/1000));
      transitions.push('t'+second+':'+next);
    },
    summary():string{
      return transitions.length>0?transitions.join(','):'NONE';
    }
  };
}
test('TASK-005/TEST-006/008/009/026: profile readiness evidence is bounded, monotonic and content-blind',()=>{
  const timeline=createBoundedChromeBootstrapTimeline();
  timeline.observe(0,'state=0 endpointMarker=0');
  timeline.observe(250,'state=0 endpointMarker=0');
  timeline.observe(1750,'state=1 endpointMarker=0');
  timeline.observe(20750,'state=1 endpointMarker=1');
  timeline.observe(25000,'state=0 endpointMarker=1');
  assert.equal(timeline.summary(),'t0:00,t1:10,t20:11,t25:01');
  const before=timeline.summary();
  for(const [time,marker] of [
    [Infinity,'state=1 endpointMarker=0'],
    [-1,'state=1 endpointMarker=0'],
    [500,'state=1 endpointMarker=1 private-profile-path'],
    [500,'PRIVATE_CHROME_CONTENT'],
    [2000,'state=99 endpointMarker=0']
  ] as const)timeline.observe(time,marker);
  assert.equal(timeline.summary(),before);
  const hostile=createBoundedChromeBootstrapTimeline();
  for(let i=0;i<100;i++)
    hostile.observe(i*1000,
      i%2===0?'state=0 endpointMarker=0':'state=1 endpointMarker=0');
  assert.equal(hostile.summary().split(',').length,12);
  assert.ok(hostile.summary().length<=100);
  assert.ok(!hostile.summary().includes('PRIVATE'));
});

/** A bounded CI-only recovery for Chrome that has not even touched its
 * disposable test profile. Never retry PID, version, WebSocket or permission
 * failures, or a partially bootstrapped browser; each fresh attempt must still
 * pass the complete real-browser ownership and CDP assertions.
 */
function mayRetryUntouchedChromeBootstrap(
 result:Awaited<ReturnType<typeof launchApprovedIsolatedChrome>>,
 markers:string,attempt:number,ci:boolean
):boolean {
 return ci&&attempt===0&&!result.ok&&result.code==='CDP_TIMEOUT'&&
   markers==='state=0 endpointMarker=0';
}
test('TEST-006/008/009: only an untouched Chrome bootstrap can receive one fresh CI attempt',()=>{
 const timeout={ok:false as const,code:'CDP_TIMEOUT' as const};
 assert.equal(mayRetryUntouchedChromeBootstrap(timeout,'state=0 endpointMarker=0',0,true),true);
 for(const [result,markers,attempt,ci] of [
  [timeout,'state=1 endpointMarker=0',0,true],
  [timeout,'state=0 endpointMarker=1',0,true],
  [timeout,'state=0 endpointMarker=0',1,true],
  [timeout,'state=0 endpointMarker=0',0,false],
  [{ok:false,code:'OWNER_MISMATCH'},'state=0 endpointMarker=0',0,true],
  [{ok:false,code:'WEBSOCKET_VERIFICATION_FAILED'},'state=0 endpointMarker=0',0,true]
 ] as const){
   assert.equal(mayRetryUntouchedChromeBootstrap(result,markers,attempt,ci),false);
 }
});

test('TEST-006: Chrome bootstrap diagnostics are bounded and content-blind',async t=>{
  const root=await mkdtemp(join(tmpdir(),'uah-bootstrap-evidence-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  assert.equal(await redactedChromeBootstrapMarkers(root),
    'state=0 endpointMarker=0');
  await writeFile(join(root,'Local State'),'PRIVATE_PROFILE_CONTENT');
  await writeFile(join(root,'DevToolsActivePort'),'PRIVATE_ENDPOINT');
  const evidence=await redactedChromeBootstrapMarkers(root);
  assert.equal(evidence,'state=1 endpointMarker=1');
  assert.equal(evidence.includes(root),false);
  assert.equal(evidence.includes('PRIVATE_'),false);
});

test('TEST-007/008: never launch without approval or with bad config',async()=>{
  const impossible=config('C:\\nonexistent\\chrome.exe','C:\\uah-isolated');
  assert.deepEqual(await launchApprovedIsolatedChrome(impossible,{userApproved:false}),
    {ok:false,code:'NOT_AUTHORIZED'});
  assert.deepEqual(await launchApprovedIsolatedChrome(impossible,{userApproved:true}),
    {ok:false,code:process.platform==='win32'?'PREFLIGHT_FAILED':'PREFLIGHT_FAILED'});
});
test('TASK-005/TEST-006/007/009/026: Chrome launch consent options never evaluate accessors or Proxy traps',async()=>{
  const impossible=config('C:\\nonexistent\\chrome.exe','C:\\uah-isolated');
  type Options=Parameters<typeof launchApprovedIsolatedChrome>[1];
  let accessors=0,proxyTraps=0;
  const consentGetter=Object.defineProperty({},'userApproved',{
    enumerable:true,get(){accessors++;return true;}
  });
  const inheritedConsent=Object.create({userApproved:true}) as unknown;
  const signalGetter=Object.defineProperty({userApproved:true},'signal',{
    enumerable:true,get(){accessors++;throw Error('PRIVATE_CALLBACK_RAN');}
  });
  const callbackGetter=Object.defineProperty({userApproved:true},'onStartupStage',{
    enumerable:true,get(){accessors++;return ()=>{};}
  });
  const proxy=new Proxy({userApproved:true},{
    get(){proxyTraps++;return true;},
    ownKeys(){proxyTraps++;return ['userApproved'];},
    getOwnPropertyDescriptor(){proxyTraps++;throw Error('PRIVATE_PROXY_RAN');}
  });
  const revoked=Proxy.revocable({userApproved:true},{});
  revoked.revoke();
  for(const candidate of [consentGetter,inheritedConsent,signalGetter,
      callbackGetter,proxy,revoked.proxy]){
    assert.deepEqual(await launchApprovedIsolatedChrome(impossible,candidate as Options),
      {ok:false,code:'NOT_AUTHORIZED'},
      'untrusted launch options must fail before Chrome preflight or any side effects');
  }
  assert.equal(accessors,0,'consent parsing must never invoke an accessor');
  assert.equal(proxyTraps,0,'consent parsing must never invoke Proxy traps');
});

test('TASK-005/TEST-007/009: malformed launch signal cannot impersonate an AbortSignal',async()=>{
  const impossible=config('C:\\nonexistent\\chrome.exe','C:\\uah-isolated');
  type Options=Parameters<typeof launchApprovedIsolatedChrome>[1];
  let abortedReads=0;
  const signal=Object.defineProperty({},'aborted',{
    get(){abortedReads++;return false;}
  });
  assert.deepEqual(await launchApprovedIsolatedChrome(impossible,{
    userApproved:true,signal
  } as unknown as Options),{ok:false,code:'NOT_AUTHORIZED'});
  assert.equal(abortedReads,0);
  const controller=new AbortController();
  controller.abort();
  assert.deepEqual(await launchApprovedIsolatedChrome(impossible,{
    userApproved:true,signal:controller.signal
  }),{ok:false,code:'ABORTED'},
    'a genuinely aborted native signal must retain its cancellation semantics');
});

test('TEST-006: executable masquerading as Chrome cannot be launched',async t=>{
  if(process.platform!=='win32')return;
  const root=await mkdtemp(join(tmpdir(),'uah-fake-executable-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const executable=join(root,'chrome.exe'),profile=join(root,'profile');
  await writeFile(executable,'not a signed browser');
  await mkdir(profile);
  const port=await unusedLoopbackPort();
  assert.deepEqual(await launchApprovedIsolatedChrome(config(executable,profile,port),
    {userApproved:true}),{ok:false,code:'BINARY_NOT_VERIFIED'});
});
test('TEST-006/008/009: isolated signed Chrome presents owned CDP HTTP only',async t=>{
  if(process.platform!=='win32')return;
  let chrome:string|undefined;
  for(const base of [process.env['PROGRAMFILES'],process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA]) {
    if(!base)continue;
    const candidate=win32.join(base,'Google','Chrome','Application','chrome.exe');
    try{await access(candidate);chrome=candidate;break;}catch{ /* other location */ }
  }
  if(!chrome){t.skip('No official Chrome binary on runner');return;}
  const root=await mkdtemp(join(tmpdir(),'uah-owned-chrome-test-'));
  let profile=join(root,'profile');
  let stop:()=>void=()=>{};
  let unexpectedExits=0;
  t.after(async()=>{
    stop();
    await delay(800);
    await rm(root,{recursive:true,force:true}).catch(()=>undefined);
  });
  let port=await unusedLoopbackPort();
  let configForTest=config(chrome,profile,port);
  assert.deepEqual(await prepareApprovedIsolatedProfile(configForTest,false),
    {ok:false,code:'NOT_AUTHORIZED'});
  const prepared=await prepareApprovedIsolatedProfile(configForTest,true);
  assert.equal(prepared.ok,true,JSON.stringify(prepared));
  assert.deepEqual(await prepareApprovedIsolatedProfile(configForTest,true),
    {ok:false,code:'PROFILE_EXISTS'});
  const startupStages:string[]=[];
  // Pass through a variable so TS can compile this behavioural regression
  // against the old implementation, before the new optional hook exists.
  const launchOptions={userApproved:true,testHeadless:true,
    onUnexpectedExit:()=>{unexpectedExits++;},
    onStartupStage:(stage:string)=>{startupStages.push(stage);}};
  // This is TEST-ONLY observation of the independently owned disposable
  // directory: polling never edits Chrome, changes the launch deadline, reads
  // marker contents, queries the user profile or retries a touched browser.
  let timeline=createBoundedChromeBootstrapTimeline();
  const launchWithBoundedMarkers=async()=>{
    const started=performance.now();
    let sampling=false;
    const poll=async()=>{
      if(sampling)return;
      sampling=true;
      try{
        timeline.observe(performance.now()-started,
          await redactedChromeBootstrapMarkers(profile));
      }finally{sampling=false;}
    };
    await poll();
    const interval=setInterval(()=>{void poll();},750);
    try{return await launchApprovedIsolatedChrome(configForTest,launchOptions);}
    finally{
      clearInterval(interval);
      timeline.observe(performance.now()-started,
        await redactedChromeBootstrapMarkers(profile));
    }
  };
  let result=await launchWithBoundedMarkers();
  if(!result.ok){
    const markers=await redactedChromeBootstrapMarkers(profile);
    if(mayRetryUntouchedChromeBootstrap(result,markers,0,
        process.env.GITHUB_ACTIONS==='true')){
      t.diagnostic('CDP_FIRST_BOOTSTRAP_UNTOUCHED_RETRY_ONCE');
      // Never reuse or overwrite the first test profile, even on failure.
      profile=join(root,'retry-profile');
      port=await unusedLoopbackPort();
      configForTest=config(chrome,profile,port);
      const secondPrepared=await prepareApprovedIsolatedProfile(configForTest,true);
      assert.equal(secondPrepared.ok,true,JSON.stringify(secondPrepared));
      startupStages.length=0;
      timeline=createBoundedChromeBootstrapTimeline();
      result=await launchWithBoundedMarkers();
    }
  }
  // Print only fixed stage labels and their counts on failure: no Chrome PID,
  // profile path, port, endpoint URL, version or returned response body.
  if(!result.ok){
    const counts:Record<string,number>={};
    for(const stage of startupStages)counts[stage]=(counts[stage]??0)+1;
    t.diagnostic('CDP_STARTUP_STAGE_COUNTS='+JSON.stringify(counts));
    t.diagnostic('CDP_BOOTSTRAP_MARKERS='+await redactedChromeBootstrapMarkers(profile));
    t.diagnostic('CDP_BOOTSTRAP_TIMELINE='+timeline.summary());
  }
  assert.equal(result.ok,true,JSON.stringify(result));
  // Chrome uses an explicit nonzero CDP port here. Chromium writes
  // DevToolsActivePort for an OS-assigned port (0); absence with this
  // fixed-port successful control is NOT evidence of a missing listener.
  // See chromium/src/chrome/browser/devtools/remote_debugging_server.cc.
  // Record only disposable-profile marker presence, never its contents.
  t.diagnostic('CDP_FIXED_PORT_SUCCESS_MARKERS='+
    await redactedChromeBootstrapMarkers(profile));
  const allowed=new Set(['FETCH_FAILED','FETCH_REFUSED','FETCH_TIMEOUT',
    'FETCH_RESET','HTTP_REJECTED','BODY_REJECTED',
    'CDP_VERSION_REJECTED','CDP_VERSION_PARSED','CHILD_RUNNING_NO_CDP']);
  assert.ok(startupStages.every(stage=>allowed.has(stage)),
    'diagnostic stages must only use fixed redacted labels');
  assert.ok(startupStages.length<=100,'startup diagnostics must be bounded');
  assert.ok(startupStages.includes('CDP_VERSION_PARSED'),
    'a successful Chrome launch must report the parsed CDP version stage');
  if(result.ok) {
    stop=result.stop;
    assert.equal(result.status,'OWNED_CDP_BROWSER_VERIFIED');
    assert.equal(result.websocketHandshakeVerified,true);
    assert.equal(result.targetVerified,false);
    assert.equal(isLiveApprovedChromeSession(result),true);
    assert.ok(Object.isFrozen(result));
    assert.ok(result.pid>0);
    assert.match(result.chromeVersion,/^\d+\.\d+\.\d+\.\d+$/);
    const fixture=createServer((_req,res)=>{
      res.writeHead(200,{'Content-Type':'text/html'});
      res.end('<!doctype html><title>Approved local test</title><main id="approved-ready">ok</main>');
    });
    await new Promise<void>((resolve,reject)=>{
      fixture.once('error',reject);fixture.listen(0,'127.0.0.1',resolve);
    });
    t.after(()=>new Promise<void>(resolve=>fixture.close(()=>resolve())));
    const address=fixture.address();
    if(!address||typeof address==='string')throw Error('MISSING_LOCAL_FIXTURE');
    const site='http://127.0.0.1:'+address.port+'/';
    assert.deepEqual(await openApprovedTarget(result,site,false),
      {ok:false,code:'NOT_AUTHORIZED'});
    const target=await openApprovedTarget(result,site,true);
    assert.equal(target.ok,true,JSON.stringify(target));
    if(target.ok){
      assert.equal(target.status,'TARGET_ID_AND_URL_MATCH_ONLY');
      assert.equal(target.businessVerified,false);
      // TEST-009/010: opening a target must wait for its own Page frame to
      // leave about:blank; DOM read must not need an app-side navigation retry.
      const observed=await observeApprovedDom(result,target,site,true,['#approved-ready']);
      assert.equal(observed.ok,true,JSON.stringify(observed));
      if(observed.ok){
        assert.equal(observed.selectorCounts['#approved-ready'],1);
        assert.equal(observed.fullPageVerified,false);
        assert.equal(observed.userscriptVerified,false);
      }
    }
    // TEST-010/017/026: consent revoked while a legitimate CDP /json/list
    // fetch is pending must terminate promptly. This intentionally injects
    // only a stalled read-only transport, not a forged Chrome endpoint.
    const realFetch=globalThis.fetch;
    const controller=new AbortController();
    let markRequest:()=>void=()=>{};
    const requestStarted=new Promise<void>(resolve=>{markRequest=resolve;});
    let observedFetch=false;
    globalThis.fetch=(input,init)=>{
      if(typeof input==='string'&&input===
          'http://127.0.0.1:'+port+'/json/list'){
        observedFetch=true;markRequest();
        return new Promise<Response>((_resolve,reject)=>{
          const onAbort=()=>reject(new DOMException('ABORTED','AbortError'));
          init?.signal?.addEventListener('abort',onAbort,{once:true});
          if(init?.signal?.aborted)onAbort();
        });
      }
      return realFetch(input,init);
    };
    try{
      const pending=observeApprovedDom(result,target,site,true,
        ['#approved-ready'],controller.signal);
      await Promise.race([requestStarted,delay(5000).then(()=>{
        throw Error('OWNED_LISTENER_NOT_READY_FOR_REVOCATION_TEST');
      })]);
      assert.equal(observedFetch,true);
      controller.abort();
      const decision=await Promise.race([
        pending,
        delay(450).then(()=>({ok:false as const,code:'CANCELLATION_STALLED' as const}))
      ]);
      assert.deepEqual(decision,{ok:false,code:'CANCELLED'},
        'revoking DOM authorization must abort in-flight /json/list immediately');
    }finally{
      globalThis.fetch=realFetch;
      controller.abort();
    }
    // TEST-009/026: the final asynchronous port/PID check may finish after
    // the application has stopped its OWN isolated Chrome. A previous PID
    // match must not turn the now-dead browser session into a verified tab.
    const listenerModule=require('../../src/browser/cdp-session') as typeof import('../../src/browser/cdp-session');
    const verifyOriginal=listenerModule.verifyWindowsLoopbackListenerPid;
    let verificationCalls=0;
    (listenerModule as {verifyWindowsLoopbackListenerPid:typeof verifyOriginal})
      .verifyWindowsLoopbackListenerPid=async(...args)=>{
        const receipt=await verifyOriginal(...args);
        verificationCalls++;
        if(verificationCalls===2){
          assert.equal(receipt.ok,true,'the disposable browser owned the listener');
          result.stop();
        }
        return receipt;
      };
    try{
      const stale=await openApprovedTarget(result,site,true);
      assert.equal(verificationCalls,2,'stop must happen during final PID check');
      assert.deepEqual(stale,{ok:false,code:'UNVERIFIED_BROWSER'},
        'a stopped owned Chrome cannot return a verified new tab');
    }finally{
      (listenerModule as {verifyWindowsLoopbackListenerPid:typeof verifyOriginal})
        .verifyWindowsLoopbackListenerPid=verifyOriginal;
    }
    stop();
    assert.equal(isLiveApprovedChromeSession(result),false);
    await delay(350);
    assert.equal(unexpectedExits,0,'Intentional stop must not invoke unexpected-exit cleanup');
    assert.deepEqual(await openApprovedTarget(result,site,true),
      {ok:false,code:'UNVERIFIED_BROWSER'});
  }
});


test('TASK-007/TEST-017: unexpected exit of a verified owned Chrome notifies its owner exactly once',async t=>{
  if(process.platform!=='win32')return;
  let chrome:string|undefined;
  for(const base of [process.env['PROGRAMFILES'],process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA]){
    if(!base)continue;
    const candidate=win32.join(base,'Google','Chrome','Application','chrome.exe');
    try{await access(candidate);chrome=candidate;break;}catch{/* unavailable */}
  }
  if(!chrome){t.skip('No official Chrome binary on runner');return;}
  const root=await mkdtemp(join(tmpdir(),'uah-chrome-exit-test-'));
  let profile=join(root,'profile');
  let port=await unusedLoopbackPort();
  let cfg=config(chrome,profile,port);
  t.after(async()=>{await delay(800);await rm(root,{recursive:true,force:true}).catch(()=>undefined);});
  const ready=await prepareApprovedIsolatedProfile(cfg,true);
  assert.equal(ready.ok,true,JSON.stringify(ready));
  let notifications=0;
  const exitStartupStages:string[]=[];
  const launchOptions={
    userApproved:true,testHeadless:true,
    onUnexpectedExit:()=>{notifications++;},
    onStartupStage:(stage:string)=>{exitStartupStages.push(stage);}
  };
  let browser=await launchApprovedIsolatedChrome(cfg,launchOptions);
  if(!browser.ok){
    const markers=await redactedChromeBootstrapMarkers(profile);
    if(mayRetryUntouchedChromeBootstrap(browser,markers,0,
        process.env.GITHUB_ACTIONS==='true')){
      t.diagnostic('CDP_EXIT_FIRST_BOOTSTRAP_UNTOUCHED_RETRY_ONCE');
      profile=join(root,'retry-profile');
      port=await unusedLoopbackPort();
      cfg=config(chrome,profile,port);
      const retryReady=await prepareApprovedIsolatedProfile(cfg,true);
      assert.equal(retryReady.ok,true,JSON.stringify(retryReady));
      exitStartupStages.length=0;
      browser=await launchApprovedIsolatedChrome(cfg,launchOptions);
    }
  }
  if(!browser.ok){
    const counts:Record<string,number>={};
    for(const stage of exitStartupStages)counts[stage]=(counts[stage]??0)+1;
    t.diagnostic('CDP_EXIT_TEST_STARTUP_STAGES='+JSON.stringify(counts));
    t.diagnostic('CDP_EXIT_TEST_BOOTSTRAP_MARKERS='+await redactedChromeBootstrapMarkers(profile));
  }
  assert.equal(browser.ok,true,JSON.stringify(browser));
  if(!browser.ok)return;
  t.after(()=>browser.stop());
  assert.equal(isLiveApprovedChromeSession(browser),true);
  // This PID belongs to the new test-only Chrome child, not an existing user browser.
  process.kill(browser.pid);
  for(let i=0;i<30&&notifications===0;i++)await delay(100);
  assert.equal(notifications,1,'Unexpected browser termination must revoke dependent fixture consent');
  assert.equal(isLiveApprovedChromeSession(browser),false);
  await delay(150);
  assert.equal(notifications,1,'Exit and error events must not double-notify');
});

import { verifyCdpBrowserWebSocket } from '../../src/browser/cdp-session';
test('TEST-009: WebSocket handshake never connects to foreign origins',async()=>{
  assert.equal(await verifyCdpBrowserWebSocket(
    'ws://outside.example:9223/devtools/browser/aabbccdd',9223,'155.0.1.1'),false);
  assert.equal(await verifyCdpBrowserWebSocket(
    'ws://127.0.0.1:9223/devtools/browser/aabbccdd',9223,'not-a-version'),false);
});

test('TEST-009: CDP response enforces actual streamed byte limit without Content-Length',async()=>{
  const valid=new Response(JSON.stringify({Browser:'Chrome/155.0.1.1'}));
  assert.deepEqual(await readBoundedCdpJson(valid),{Browser:'Chrome/155.0.1.1'});
  const oversized=new Response(new ReadableStream<Uint8Array>({
    start(controller){controller.enqueue(new Uint8Array(17000));controller.close();}
  }),{status:200});
  assert.equal(await readBoundedCdpJson(oversized),null);
  assert.equal(await readBoundedCdpJson(new Response('{}',{
    headers:{'content-length':'17000'}})),null);
  assert.equal(await readBoundedCdpJson(new Response('{}',{status:403})),null);
});
test('TEST-009/026: oversized CDP body cannot be held hostage by a pending stream cancellation',async()=>{
 let cancelCalled=false;
 // An untrusted HTTP body may never finish cancellation. Size rejection must
 // return promptly instead of awaiting an unbounded external cleanup promise.
 const stream=new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(new Uint8Array(17000));},
  cancel(){cancelCalled=true;return new Promise<void>(()=>{});}
 });
 let timeout:NodeJS.Timeout|undefined;
 try{
  const outcome=await Promise.race([
   readBoundedCdpJson(new Response(stream)),
   new Promise<never>((_resolve,reject)=>{
    timeout=setTimeout(()=>reject(Error('CDP_STREAM_CANCEL_STALLED')),1000);
   })
  ]);
  assert.equal(outcome,null);
  assert.equal(cancelCalled,true,'oversized response still requests body cancellation');
 }finally{if(timeout)clearTimeout(timeout);}
});

test('TEST-009/026: rejected CDP HTTP/status headers close untrusted response streams without waiting',async()=>{
 for(const reason of ['http-error','oversized-header','invalid-header'] as const){
  let cancelCalls=0;
  const stream=new ReadableStream<Uint8Array>({
   start(controller){controller.enqueue(new TextEncoder().encode('{}'));},
   cancel(){cancelCalls++;return new Promise<void>(()=>{});}
  });
  const options=reason==='http-error'?{status:503}:reason==='oversized-header'
   ?{headers:{'content-length':'17000'}}:{headers:{'content-length':'invalid'}};
  const response=new Response(stream,options);
  let timer:NodeJS.Timeout|undefined;
  try{
   const outcome=await Promise.race([
    readBoundedCdpJson(response),
    new Promise<never>((_resolve,reject)=>{
     timer=setTimeout(()=>reject(Error('CDP_EARLY_REJECTION_STALLED_'+reason)),1000);
    })
   ]);
   assert.equal(outcome,null,reason);
   assert.equal(cancelCalls,1,'Rejected '+reason+' response must release its unread body');
  }finally{if(timer)clearTimeout(timer);}
 }
});

test('TASK-005/TEST-006/009/026: CDP body that stops after headers is bounded and denied',async()=>{
 // A 200 response and one partial byte chunk can arrive before an untrusted
 // stream stalls permanently. Neither a stalled read nor its unresponsive
 // cancel hook may keep the owned-Chrome startup alive without a bound.
 let cancelCalls=0;
 const body=new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(new TextEncoder().encode('{"Browser":"Chrome/'));},
  pull(){return new Promise<void>(()=>{});},
  cancel(){cancelCalls++;return new Promise<void>(()=>{});}
 });
 let timer:NodeJS.Timeout|undefined;
 try{
  const result=await Promise.race([
   readBoundedCdpJson(new Response(body,{status:200})),
   new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>reject(Error('CDP_PARTIAL_BODY_UNBOUNDED')),2400);
   })
  ]);
  assert.equal(result,null,'partial stalled CDP JSON must never be trusted');
  assert.equal(cancelCalls,1,'timed-out CDP stream must request nonblocking cleanup');
 }finally{if(timer)clearTimeout(timer);}
});

test('TEST-009: CDP JSON accepts split chunks but rejects malformed UTF-8',async()=>{
  const encoded=new TextEncoder().encode('{"Browser":"Chrome/155.0.1.1"}');
  const split=new Response(new ReadableStream<Uint8Array>({
    start(controller){
      controller.enqueue(encoded.subarray(0,12));
      controller.enqueue(encoded.subarray(12));
      controller.close();
    }
  }));
  assert.deepEqual(await readBoundedCdpJson(split),{Browser:'Chrome/155.0.1.1'});
  assert.equal(await readBoundedCdpJson(new Response(
    new Uint8Array([0x7b,0xff,0x7d]))),null);
});


test('TEST-009: target creation is rejected without an authenticated owned session',async()=>{
  const missing={ok:false as const,code:'PREFLIGHT_FAILED' as const};
  assert.deepEqual(await openApprovedTarget(missing,'https://example.com/',true),
    {ok:false,code:'UNVERIFIED_BROWSER'});
  assert.deepEqual(await openApprovedTarget(missing,'file:///C:/secret',false),
    {ok:false,code:'NOT_AUTHORIZED'});
});

test('TEST-009: a forged shape cannot authorize Chrome target creation',async()=>{
  const forged:Extract<Awaited<ReturnType<typeof launchApprovedIsolatedChrome>>,{ok:true}>={
    ok:true,status:'OWNED_CDP_BROWSER_VERIFIED',
    pid:process.pid,chromeVersion:'155.0.1.1',
    browserWebsocket:'ws://127.0.0.1:9223/devtools/browser/12345678',
    websocketHandshakeVerified:true,targetVerified:false,stop:()=>{}
  };
  assert.equal(isLiveApprovedChromeSession(forged),false);
  assert.deepEqual(await openApprovedTarget(forged,'https://example.com/',true),
    {ok:false,code:'UNVERIFIED_BROWSER'});
});

test('TASK-005/TEST-009/026: CDP navigation rejects unregistered browser accessors and Proxies before touching them',async()=>{
 let getterCalls=0,trapCalls=0;
 const malicious={
  get ok(){getterCalls++;throw Error('PRIVATE_BROWSER_GETTER');}
 } as unknown as Parameters<typeof openApprovedTarget>[0];
 const proxied=new Proxy({},{
  get(){trapCalls++;throw Error('PRIVATE_BROWSER_PROXY_GET');},
  getPrototypeOf(){trapCalls++;throw Error('PRIVATE_BROWSER_PROXY_PROTO');}
 }) as Parameters<typeof openApprovedTarget>[0];
 const revoked=Proxy.revocable({},{});
 revoked.revoke();
 for(const browser of [malicious,proxied,
   revoked.proxy as Parameters<typeof openApprovedTarget>[0]]){
  assert.deepEqual(await openApprovedTarget(browser,'https://example.com/',true),
    {ok:false,code:'UNVERIFIED_BROWSER'});
 }
 assert.equal(getterCalls,0);
 assert.equal(trapCalls,0);
});

test('TASK-005/TEST-009/026: invalid CDP navigation AbortSignal cannot run getters or initiate work',async()=>{
 let traps=0;
 const poisoned=new Proxy(new AbortController().signal,{
  get(){traps++;throw Error('PRIVATE_ABORT_GET');},
  getPrototypeOf(){traps++;throw Error('PRIVATE_ABORT_PROTO');}
 });
 const shadow=new AbortController().signal;
 Object.defineProperty(shadow,'aborted',{
  get(){traps++;throw Error('PRIVATE_ABORT_SHADOW');}
 });
 const forged=Object.create(AbortSignal.prototype) as AbortSignal;
 const revoked=Proxy.revocable(new AbortController().signal,{});
 revoked.revoke();
 const missing={ok:false as const,code:'PREFLIGHT_FAILED' as const};
 for(const signal of [
  poisoned,shadow,forged,revoked.proxy,{aborted:false} as AbortSignal
 ]){
  assert.deepEqual(await openApprovedTarget(
   missing,'https://example.com/',true,signal),
   {ok:false,code:'INVALID_OPTIONS'});
 }
 assert.equal(traps,0,'no user getter or Proxy trap may run before CDP ownership');
 const cancelled=new AbortController();
 cancelled.abort();
 assert.deepEqual(await openApprovedTarget(
  missing,'https://example.com/',true,cancelled.signal),
  {ok:false,code:'CANCELLED'});
 assert.deepEqual(await openApprovedTarget(
  missing,'https://example.com/',true,new AbortController().signal),
  {ok:false,code:'UNVERIFIED_BROWSER'});
});

/** Dedicated cloud job supplies a signed, independently located official
 * Chrome for Testing. Standard app-check skips this optional matrix cell.
 */
test('TEST-006/007/008/009: signed Chrome from an independent application path',async t=>{
  const executable=process.env.UAH_TEST_PORTABLE_CHROME;
  if(!executable){t.skip('Dedicated portable Chrome job supplies this fixture');return;}
  assert.equal(process.platform,'win32');
  await access(executable);
  const root=await mkdtemp(join(tmpdir(),'uah-portable-product-'));
  const profile=join(root,'profile');
  let stop:()=>void=()=>{};
  t.after(async()=>{stop();await delay(900);await rm(root,{force:true,recursive:true}).catch(()=>undefined);});
  const port=await unusedLoopbackPort();
  const cfg=config(executable,profile,port);
  const prepared=await prepareApprovedIsolatedProfile(cfg,true);
  assert.equal(prepared.ok,true,JSON.stringify(prepared));
  const session=await launchApprovedIsolatedChrome(cfg,{userApproved:true,testHeadless:true});
  assert.equal(session.ok,true,JSON.stringify(session));
  if(!session.ok)return;
  stop=session.stop;
  assert.ok(session.pid>0);
  assert.equal(session.websocketHandshakeVerified,true);
  assert.equal(isLiveApprovedChromeSession(session),true);
  const fixture=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<title>Portable product check</title>');});
  await new Promise<void>((resolve,reject)=>{
    fixture.once('error',reject);fixture.listen(0,'127.0.0.1',resolve);
  });
  t.after(()=>new Promise<void>(resolve=>fixture.close(()=>resolve())));
  const address=fixture.address();
  if(!address||typeof address==='string')throw Error('MISSING_TEST_SITE');
  const site='http://127.0.0.1:'+address.port+'/';
  const page=await openApprovedTarget(session,site,true);
  assert.equal(page.ok,true,JSON.stringify(page));
  if(page.ok)assert.equal(page.businessVerified,false);
  stop();
  assert.equal(isLiveApprovedChromeSession(session),false);
});


// A failing Windows runner must identify the transport class without leaking
// OS errors, profile locations, URLs, ports, or private Chrome output.
import * as ownedChromeDiagnostics from '../../src/browser/owned-chrome';
test('TASK-005/TEST-006/008/009: timeout listener status is bounded and has no PID leakage',()=>{
  const classify=(ownedChromeDiagnostics as unknown as {
    classifyCdpTimeoutListener?: (v:unknown)=>string
  }).classifyCdpTimeoutListener;
  assert.equal(typeof classify,'function','timeout diagnosis must exist');
  if(!classify)return;
  const cases=[
    [{ok:true,status:'LISTENER_PID_MATCH_ONLY',pid:987654,executableVerified:false},
      'CDP_TIMEOUT_LISTENER_PID_MATCH'],
    [{ok:false,code:'LISTENER_UNAVAILABLE'},'CDP_TIMEOUT_LISTENER_UNAVAILABLE'],
    [{ok:false,code:'LISTENER_PID_MISMATCH'},'CDP_TIMEOUT_LISTENER_PID_MISMATCH'],
    [{ok:false,code:'LISTENER_AMBIGUOUS'},'CDP_TIMEOUT_LISTENER_AMBIGUOUS'],
    [{ok:false,code:'UNSUPPORTED_PLATFORM'},'CDP_TIMEOUT_PROBE_INCONCLUSIVE'],
    [{ok:false,code:'INVALID_ARGUMENTS'},'CDP_TIMEOUT_PROBE_INCONCLUSIVE']
  ] as const;
  for(const [probe,expected] of cases){
    const stage=classify(probe);
    assert.equal(stage,expected);
    assert.match(stage,/^CDP_TIMEOUT_[A-Z_]+$/);
    assert.equal(stage.includes('987654'),false,'never emit process identity');
  }
});

test('TASK-005/TEST-006: bounded CDP startup transport failure labels are useful and non-secret',()=>{
  const classify=(ownedChromeDiagnostics as unknown as {
    classifyCdpStartupTransportFailure?: (e:unknown)=>string
  }).classifyCdpStartupTransportFailure;
  assert.equal(typeof classify,'function','production diagnosis must exist');
  if(!classify)return;
  const error=(code:string)=>Object.assign(new Error('fetch failed'),{
    cause:Object.assign(new Error('private URL http://127.0.0.1:9223'),{code})
  });
  assert.equal(classify(error('ECONNREFUSED')),'FETCH_REFUSED');
  assert.equal(classify(error('UND_ERR_CONNECT_TIMEOUT')),'FETCH_TIMEOUT');
  assert.equal(classify(error('ETIMEDOUT')),'FETCH_TIMEOUT');
  assert.equal(classify(error('ECONNRESET')),'FETCH_RESET');
  assert.equal(classify({name:'TimeoutError'}),'FETCH_TIMEOUT');
  for(const bad of [
    error('EPRIVATE_SCRIPT_CONTENT'),new Error('secret path C:/data/source.user.js'),
    Object.defineProperty({},'cause',{get(){throw Error('PRIVATE_DETAILS');}}),
    Object.defineProperty({},'code',{get(){throw Error('PRIVATE_DETAILS');}})
  ])assert.equal(classify(bad),'FETCH_FAILED');
});



test('TASK-005/TEST-006/008/009: bundled native fetch refusals remain redacted and distinguishable',()=>{
  const classify=(ownedChromeDiagnostics as unknown as {
    classifyCdpStartupTransportFailure:(error:unknown)=>string
  }).classifyCdpStartupTransportFailure;
  const reason=(code:string)=>Object.assign(new Error('PRIVATE_LOCAL_ENDPOINT'),{code});
  const wrapped=(codes:string[])=>({
    cause:new AggregateError(codes.map(reason),'PRIVATE_ENDPOINT_AND_PROFILE')
  });
  assert.equal(classify(wrapped(['ECONNREFUSED','ECONNREFUSED'])),'FETCH_REFUSED',
    'uniform native AggregateError refusals must not lose the diagnostic category');
  assert.equal(classify(wrapped(['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT'])),'FETCH_TIMEOUT');
  assert.equal(classify(wrapped(['ECONNREFUSED','ETIMEDOUT'])),'FETCH_FAILED',
    'mixed failures must not be misrepresented as one proven cause');
  assert.equal(classify(wrapped([])),'FETCH_FAILED');
  assert.equal(classify(wrapped(Array.from({length:9},()=> 'ECONNREFUSED'))),
    'FETCH_FAILED','oversized aggregate evidence remains inconclusive');
});

test('TASK-005/TEST-006/008/009/026: diagnostic classifier never executes Proxy traps',()=>{
  const classify=(ownedChromeDiagnostics as unknown as {
    classifyCdpStartupTransportFailure:(error:unknown)=>string
  }).classifyCdpStartupTransportFailure;
  let traps=0;
  const poisoned=new Proxy({code:'ECONNREFUSED'},{
    ownKeys(){traps++;return ['code'];},
    getOwnPropertyDescriptor(){traps++;return {
      configurable:true,enumerable:true,writable:true,value:'ECONNREFUSED'
    };}
  });
  assert.equal(classify({cause:poisoned}),'FETCH_FAILED');
  assert.equal(traps,0,'classification cannot invoke proxy reflection traps');
  const revoked=Proxy.revocable({code:'ETIMEDOUT'},{});
  revoked.revoke();
  assert.equal(classify({cause:revoked.proxy}),'FETCH_FAILED');
});


test('TASK-005/TEST-006/008/009: a forward Windows wall-clock adjustment cannot prematurely expire an owned Chrome bootstrap',async t=>{
  // Synthetic, strictly owned launch fixture: no user Chrome, filesystem,
  // network endpoint, profile or script is touched. This isolates deadline
  // arithmetic from the independent intermittent real Chrome startup bug.
  const { EventEmitter }=require('node:events') as typeof import('node:events');
  const childProcesses=require('node:child_process') as typeof import('node:child_process');
  const launcher=require('../../src/browser/chrome-launcher') as
    typeof import('../../src/browser/chrome-launcher');
  const cdp=require('../../src/browser/cdp-session') as
    typeof import('../../src/browser/cdp-session');
  const port=12023;
  const cfg=config('C:\\synthetic\\chrome.exe','C:\\synthetic\\fresh-profile',port);
  const child=Object.assign(new EventEmitter(),{
    pid:41234,exitCode:null as number|null,killed:false,signalCode:null as string|null,
    kill(){this.killed=true;return true;}
  });
  const actualNow=Date.now;
  let jumped=false,requests=0;
  let session:Awaited<ReturnType<typeof launchApprovedIsolatedChrome>>|undefined;
  try{
    t.mock.method(launcher,'preflightChrome',async()=>({
      ok:true as const,status:'PATH_AND_PORT_CHECKED_ONLY' as const,
      config:cfg,runtimeIdentityVerified:false as const
    }));
    t.mock.method(launcher,'inspectWindowsChromeBinary',async()=>({
      ok:true as const,status:'SIGNED_GOOGLE_CHROME_BINARY' as const,
      version:'155.0.1.1',publisher:'Google LLC' as const,
      runtimeVerified:false as const
    }));
    t.mock.method(childProcesses,'spawn',()=>child as unknown as
      import('node:child_process').ChildProcess);
    t.mock.method(cdp,'verifyWindowsLoopbackListenerPid',async()=>({
      ok:true as const,status:'LISTENER_PID_MATCH_ONLY' as const,
      pid:41234,executableVerified:false as const
    }));
    t.mock.method(cdp,'verifyCdpBrowserWebSocket',async()=>true);
    t.mock.method(Date,'now',()=>actualNow()+(jumped?60000:0));
    t.mock.method(globalThis,'fetch',async(input:Parameters<typeof fetch>[0])=>{
      assert.equal(input,'http://127.0.0.1:'+port+'/json/version');
      requests++;
      if(requests===1){
        jumped=true;
        throw Object.assign(new Error('synthetic refused probe'),{code:'ECONNREFUSED'});
      }
      return new Response(JSON.stringify({
        Browser:'Chrome/155.0.1.1',
        webSocketDebuggerUrl:'ws://127.0.0.1:'+port+'/devtools/browser/abcdefgh-1234'
      }));
    });
    session=await launchApprovedIsolatedChrome(cfg,{userApproved:true});
    assert.equal(jumped,true,'fixture must advance the wall clock after probe one');
    assert.ok(requests>=2,'the authorized bootstrap must retry after a refused probe');
    assert.equal(session.ok,true,JSON.stringify(session));
    if(session.ok)assert.equal(session.websocketHandshakeVerified,true);
  }finally{
    if(session?.ok)session.stop();
    t.mock.reset();
  }
});


test('TASK-005/TEST-006/009/026: abort during verified WebSocket handshake cannot register an owned browser',async t=>{
  // This synthetic child never starts a real Chrome, touches a user Profile,
  // or performs network I/O. Consent is revoked *after* the earlier abort
  // check, while the asynchronous browser handshake is still in progress.
  const {EventEmitter}=require('node:events') as typeof import('node:events');
  const childProcesses=require('node:child_process') as typeof import('node:child_process');
  const launcher=require('../../src/browser/chrome-launcher') as
    typeof import('../../src/browser/chrome-launcher');
  const cdp=require('../../src/browser/cdp-session') as
    typeof import('../../src/browser/cdp-session');
  const cfg=config('C:\\synthetic\\chrome.exe','C:\\synthetic\\fresh-profile',12024);
  const controller=new AbortController();
  const child=Object.assign(new EventEmitter(),{
    pid:41235,exitCode:null as number|null,killed:false,
    signalCode:null as string|null,
    kill(){this.killed=true;return true;}
  });
  let handshakeObserved=false;
  let result:Awaited<ReturnType<typeof launchApprovedIsolatedChrome>>|undefined;
  try{
    t.mock.method(launcher,'preflightChrome',async()=>({
      ok:true as const,status:'PATH_AND_PORT_CHECKED_ONLY' as const,
      config:cfg,runtimeIdentityVerified:false as const
    }));
    t.mock.method(launcher,'inspectWindowsChromeBinary',async()=>({
      ok:true as const,status:'SIGNED_GOOGLE_CHROME_BINARY' as const,
      version:'155.0.1.1',publisher:'Google LLC' as const,
      runtimeVerified:false as const
    }));
    t.mock.method(childProcesses,'spawn',()=>child as unknown as
      import('node:child_process').ChildProcess);
    t.mock.method(cdp,'verifyWindowsLoopbackListenerPid',async()=>({
      ok:true as const,status:'LISTENER_PID_MATCH_ONLY' as const,
      pid:41235,executableVerified:false as const
    }));
    t.mock.method(cdp,'verifyCdpBrowserWebSocket',async()=>{
      handshakeObserved=true;
      controller.abort();
      return true;
    });
    t.mock.method(globalThis,'fetch',async()=>
      new Response(JSON.stringify({
        Browser:'Chrome/155.0.1.1',
        webSocketDebuggerUrl:'ws://127.0.0.1:12024/devtools/browser/abcdefgh-1234'
      }))
    );
    result=await launchApprovedIsolatedChrome(cfg,{
      userApproved:true,signal:controller.signal
    });
    assert.equal(handshakeObserved,true,
      'the abort must occur in the authenticated handshake, not before launch');
    assert.deepEqual(result,{ok:false,code:'ABORTED'},
      'a completed handshake cannot reinstate revoked user consent');
    assert.equal(child.killed,true,
      'only the synthetic child owned by this launch is cleaned up');
    assert.equal(isLiveApprovedChromeSession(result),false);
  }finally{
    if(result?.ok)result.stop();
    t.mock.reset();
  }
});

test('TASK-005/TEST-006/009/026: native revocation aborts an in-flight owned CDP HTTP probe',async t=>{
  // This fixture creates no browser/profile/network activity. It uses the
  // existing trusted-native mock boundary to model a Chrome child whose
  // first CDP HTTP request is still pending when approval is revoked.
  const {EventEmitter}=require('node:events') as typeof import('node:events');
  const childProcesses=require('node:child_process') as typeof import('node:child_process');
  const launcher=require('../../src/browser/chrome-launcher') as
    typeof import('../../src/browser/chrome-launcher');
  const cfg=config('C:\\synthetic\\chrome.exe','C:\\synthetic\\isolated-profile',12025);
  const controller=new AbortController();
  const child=Object.assign(new EventEmitter(),{
    pid:41236,exitCode:null as number|null,killed:false,
    signalCode:null as string|null,
    kill(){this.killed=true;return true;}
  });
  let onFetch:()=>void=()=>{};
  const fetchStarted=new Promise<void>(resolve=>{onFetch=resolve;});
  let probeSignal:AbortSignal|undefined;
  let result:Awaited<ReturnType<typeof launchApprovedIsolatedChrome>>|undefined;
  try{
    t.mock.method(launcher,'preflightChrome',async()=>({
      ok:true as const,status:'PATH_AND_PORT_CHECKED_ONLY' as const,
      config:cfg,runtimeIdentityVerified:false as const
    }));
    t.mock.method(launcher,'inspectWindowsChromeBinary',async()=>({
      ok:true as const,status:'SIGNED_GOOGLE_CHROME_BINARY' as const,
      version:'155.0.1.1',publisher:'Google LLC' as const,
      runtimeVerified:false as const
    }));
    t.mock.method(childProcesses,'spawn',()=>child as unknown as
      import('node:child_process').ChildProcess);
    t.mock.method(globalThis,'fetch',(_request,init)=>
      new Promise<Response>((_resolve,reject)=>{
        probeSignal=init?.signal??undefined;
        const onAbort=()=>reject(new DOMException('Cancelled','AbortError'));
        probeSignal?.addEventListener('abort',onAbort,{once:true});
        if(probeSignal?.aborted)onAbort();
        onFetch();
      })
    );
    const pending=launchApprovedIsolatedChrome(cfg,{
      userApproved:true,signal:controller.signal
    });
    await Promise.race([fetchStarted,delay(1000).then(()=>{
      throw Error('SYNTHETIC_CDP_PROBE_DID_NOT_BEGIN');
    })]);
    assert.equal(probeSignal?.aborted,false,
      'the synthetic CDP fetch must genuinely be pending at revocation');
    controller.abort();
    // Capture this synchronously: a separate fixed 1500ms timeout is NOT
    // evidence that user revocation cancelled the HTTP probe.
    const cancelledByUser=probeSignal?.aborted===true;
    result=await pending;
    assert.equal(cancelledByUser,true,
      'the active CDP fetch must receive user cancellation immediately');
    assert.deepEqual(result,{ok:false,code:'ABORTED'});
    assert.equal(child.killed,true,
      'cancelling owned bootstrap must terminate only its own child');
    assert.equal(isLiveApprovedChromeSession(result),false);
  }finally{
    if(result?.ok)result.stop();
    controller.abort();
    t.mock.reset();
  }
});
