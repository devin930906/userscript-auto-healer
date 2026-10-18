import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preflightChrome } from '../../src/browser/chrome-launcher';

async function fixture(t:{after:(cb:()=>Promise<void>)=>void}){
  const root=await mkdtemp(join(tmpdir(),'uah-browser-preflight-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const executable=join(root,'chrome.exe');
  const profile=join(root,'owned-profile');
  await writeFile(executable,Buffer.from('fixture-only-not-a-chrome-binary'));
  await mkdir(profile);
  return {root,executable,profile};
}
function config(executablePath:string,userDataDir:string,remoteDebuggingPort=9223){
  return {executablePath,userDataDir,remoteDebuggingPort,bindAddress:'127.0.0.1'};
}
test('TEST-006/007: preflight only verifies paths, never launches a browser',async t=>{
  if(process.platform!=='win32')return;
  const f=await fixture(t);
  const result=await preflightChrome(config(f.executable,f.profile));
  assert.equal(result.ok,true,JSON.stringify(result));
  if(result.ok){
    assert.equal(result.runtimeIdentityVerified,false);
    assert.equal(result.status,'PATH_AND_PORT_CHECKED_ONLY');
  }
});
test('TEST-007: denies unsafe Chrome default profiles and active locks',async t=>{
  if(process.platform!=='win32')return;
  const f=await fixture(t);
  const unsafe=await preflightChrome(config(f.executable,'C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\User Data'));
  assert.equal(unsafe.ok,false);
  await writeFile(join(f.profile,'SingletonLock'),'lock');
  const active=await preflightChrome(config(f.executable,f.profile));
  assert.deepEqual(active,{ok:false,code:'PROFILE_IN_USE'});
});
test('TEST-006/007: missing selected Chrome/profile fails without creation',async t=>{
  if(process.platform!=='win32')return;
  const f=await fixture(t);
  const missingChrome=await preflightChrome(config(join(f.root,'not-installed','chrome.exe'),f.profile));
  assert.deepEqual(missingChrome,{ok:false,code:'EXECUTABLE_NOT_FOUND'});
  const missingProfile=await preflightChrome(config(f.executable,join(f.root,'new-profile')));
  assert.deepEqual(missingProfile,{ok:false,code:'PROFILE_NOT_FOUND'});
});
test('TEST-008: occupied CDP port is rejected without contacting existing service',async t=>{
  if(process.platform!=='win32')return;
  const f=await fixture(t);
  const occupied=createServer();
  await new Promise<void>((resolve,reject)=>{
    occupied.once('error',reject);
    occupied.listen({host:'127.0.0.1',port:0},resolve);
  });
  t.after(()=>new Promise<void>(resolve=>occupied.close(()=>resolve())));
  const addr=occupied.address();
  if(!addr || typeof addr==='string')throw Error('NO_PORT');
  const result=await preflightChrome(config(f.executable,f.profile,addr.port));
  assert.deepEqual(result,{ok:false,code:'CDP_PORT_IN_USE'});
  assert.equal(occupied.listening,true);
});


import { inspectWindowsChromeBinary } from '../../src/browser/chrome-launcher';
test('TEST-006: a renamed executable fixture cannot pass signed Chrome identity',async t=>{
  if(process.platform!=='win32')return;
  const f=await fixture(t);
  const verdict=await inspectWindowsChromeBinary(config(f.executable,f.profile));
  assert.equal(verdict.ok,false,JSON.stringify(verdict));
  assert.ok(!verdict.ok && ['IDENTITY_UNAVAILABLE','UNTRUSTED_BINARY',
    'VERSION_UNAVAILABLE'].includes(verdict.code));
  assert.deepEqual(await inspectWindowsChromeBinary(config(f.executable,f.profile,0)),
    {ok:false,code:'INVALID_CONFIG'});
});


test('TEST-006: inspect actual official Chrome binary on Windows runner when installed',async t=>{
  if(process.platform!=='win32')return;
  const { access }=await import('node:fs/promises');
  const { win32 }=await import('node:path');
  const bases=[process.env['PROGRAMFILES'],process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA]
    .filter((v):v is string=>typeof v==='string'&&v.length>0);
  let chrome:string|undefined;
  for(const base of bases){
    const path=win32.join(base,'Google','Chrome','Application','chrome.exe');
    try {await access(path);chrome=path;break;}catch { /* another location */ }
  }
  if(!chrome){t.skip('No installed Chrome on this Windows image');return;}
  const decision=await inspectWindowsChromeBinary(config(chrome,
    win32.join(process.env.TEMP??'C:\\Temp','uah-test-isolated-profile')));
  assert.equal(decision.ok,true,JSON.stringify(decision));
  if(decision.ok){
    assert.match(decision.version,/^\d+\.\d+\.\d+\.\d+$/);
    assert.equal(decision.runtimeVerified,false);
  }
});
