import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { launchApprovedIsolatedChrome, readBoundedCdpJson, isLiveApprovedChromeSession } from '../../src/browser/owned-chrome';
import { openApprovedTarget } from '../../src/browser/cdp-target';
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
  const profile=join(root,'profile');
  let stop:()=>void=()=>{};
  let unexpectedExits=0;
  t.after(async()=>{
    stop();
    await delay(800);
    await rm(root,{recursive:true,force:true}).catch(()=>undefined);
  });
  const port=await unusedLoopbackPort();
  const configForTest=config(chrome,profile,port);
  assert.deepEqual(await prepareApprovedIsolatedProfile(configForTest,false),
    {ok:false,code:'NOT_AUTHORIZED'});
  const prepared=await prepareApprovedIsolatedProfile(configForTest,true);
  assert.equal(prepared.ok,true,JSON.stringify(prepared));
  assert.deepEqual(await prepareApprovedIsolatedProfile(configForTest,true),
    {ok:false,code:'PROFILE_EXISTS'});
  const result=await launchApprovedIsolatedChrome(configForTest,
    {userApproved:true,testHeadless:true,onUnexpectedExit:()=>{unexpectedExits++;}});
  assert.equal(result.ok,true,JSON.stringify(result));
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
      res.end('<!doctype html><title>Approved local test</title>');
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
  const profile=join(root,'profile');
  const port=await unusedLoopbackPort();
  const cfg=config(chrome,profile,port);
  t.after(async()=>{await delay(800);await rm(root,{recursive:true,force:true}).catch(()=>undefined);});
  const ready=await prepareApprovedIsolatedProfile(cfg,true);
  assert.equal(ready.ok,true,JSON.stringify(ready));
  let notifications=0;
  const browser=await launchApprovedIsolatedChrome(cfg,{
    userApproved:true,testHeadless:true,
    onUnexpectedExit:()=>{notifications++;}
  });
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
