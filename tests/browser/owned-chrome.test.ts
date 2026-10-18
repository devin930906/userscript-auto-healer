import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { launchApprovedIsolatedChrome } from '../../src/browser/owned-chrome';

function config(executablePath:string,userDataDir:string,port=9223) {
  return {executablePath,userDataDir,remoteDebuggingPort:port,bindAddress:'127.0.0.1'};
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
  assert.deepEqual(await launchApprovedIsolatedChrome(config(executable,profile),
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
  await mkdir(profile);
  let stop:()=>void=()=>{};
  t.after(async()=>{
    stop();
    await delay(800);
    await rm(root,{recursive:true,force:true}).catch(()=>undefined);
  });
  const result=await launchApprovedIsolatedChrome(config(chrome,profile),
    {userApproved:true,testHeadless:true});
  assert.equal(result.ok,true,JSON.stringify(result));
  if(result.ok) {
    stop=result.stop;
    assert.equal(result.status,'OWNED_CDP_BROWSER_VERIFIED');
    assert.equal(result.websocketHandshakeVerified,true);
    assert.equal(result.targetVerified,false);
    assert.ok(result.pid>0);
    assert.match(result.chromeVersion,/^\d+\.\d+\.\d+\.\d+$/);
  }
});


import { verifyCdpBrowserWebSocket } from '../../src/browser/cdp-session';
test('TEST-009: WebSocket handshake never connects to foreign origins',async()=>{
  assert.equal(await verifyCdpBrowserWebSocket(
    'ws://outside.example:9223/devtools/browser/aabbccdd',9223,'155.0.1.1'),false);
  assert.equal(await verifyCdpBrowserWebSocket(
    'ws://127.0.0.1:9223/devtools/browser/aabbccdd',9223,'not-a-version'),false);
});
