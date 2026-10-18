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
