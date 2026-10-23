import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
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
  let result=await launchApprovedIsolatedChrome(configForTest,launchOptions);
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
      result=await launchApprovedIsolatedChrome(configForTest,launchOptions);
    }
  }
  // Print only fixed stage labels and their counts on failure: no Chrome PID,
  // profile path, port, endpoint URL, version or returned response body.
  if(!result.ok){
    const counts:Record<string,number>={};
    for(const stage of startupStages)counts[stage]=(counts[stage]??0)+1;
    t.diagnostic('CDP_STARTUP_STAGE_COUNTS='+JSON.stringify(counts));
    t.diagnostic('CDP_BOOTSTRAP_MARKERS='+await redactedChromeBootstrapMarkers(profile));
  }
  assert.equal(result.ok,true,JSON.stringify(result));
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
