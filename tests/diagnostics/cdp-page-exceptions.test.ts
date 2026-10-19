import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createServer as createHttpServer} from 'node:http';
import {createServer as createTcpServer} from 'node:net';
import {access,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,win32} from 'node:path';
import {prepareApprovedIsolatedProfile} from '../../src/browser/chrome-launcher';
import {launchApprovedIsolatedChrome} from '../../src/browser/owned-chrome';
import {openApprovedTarget} from '../../src/browser/cdp-target';
import {BoundedFaultLog} from '../../src/diagnostics/fault-classifier';
import {
  inspectApprovedPageExceptions,inspectAndLogApprovedPageExceptions,
  countBoundedPageExceptionEvent,isArmedFrameNavigationReplay
} from '../../src/diagnostics/cdp-page-exceptions';

test('TEST-013: delayed Page.frameNavigated replay is not a new route',()=>{
  const armed={id:'frame-1',loaderId:'loader-1',url:'https://example.com/'};
  const replay={frame:{id:armed.id,loaderId:armed.loaderId,url:armed.url}};
  assert.equal(isArmedFrameNavigationReplay(replay,armed),true);
  assert.equal(isArmedFrameNavigationReplay(replay,null),false);
  assert.equal(isArmedFrameNavigationReplay(
    {frame:{...replay.frame,loaderId:'loader-2'}},armed),false);
  assert.equal(isArmedFrameNavigationReplay(
    {frame:{...replay.frame,id:'other-frame'}},armed),false);
  assert.equal(isArmedFrameNavigationReplay(
    {frame:{...replay.frame,url:'https://example.com/new'}},armed),false);
  assert.equal(isArmedFrameNavigationReplay({frame:{id:armed.id}},armed),false);
  assert.equal(isArmedFrameNavigationReplay({},armed),false);
});

test('TEST-013: repeated CDP exception IDs still consume the 32-event budget',()=>{
  let total=0;
  for(let i=0;i<32;i++){
    const counted=countBoundedPageExceptionEvent(total,7); // intentional replay
    assert.equal(counted.ok,true);
    if(!counted.ok)return;
    total=counted.count;
  }
  assert.equal(total,32);
  assert.deepEqual(countBoundedPageExceptionEvent(total,7),
    {ok:false,code:'TOO_MANY_EXCEPTIONS'});
  for(const invalid of [-1,NaN,Infinity,1.5,'7',null,undefined]){
    assert.deepEqual(countBoundedPageExceptionEvent(0,invalid),
      {ok:false,code:'INVALID_EXCEPTION_ID'});
  }
  assert.deepEqual(countBoundedPageExceptionEvent(-1,7),
    {ok:false,code:'INVALID_EXCEPTION_ID'});
});

test('TEST-013: no consent, fake ownership, bad targets, unsafe URL and bad window fail closed',async()=>{
  const bogusBrowser={
    ok:true,status:'OWNED_CDP_BROWSER_VERIFIED',pid:100,
    chromeVersion:'1.2.3.4',browserWebsocket:'ws://127.0.0.1:9223/devtools/browser/12345678',
    websocketHandshakeVerified:true,targetVerified:false,stop:()=>{}
  } as const;
  const bogusTarget={
    ok:true,status:'TARGET_ID_AND_URL_MATCH_ONLY',targetId:'12345678',
    businessVerified:false
  } as const;
  const valid='http://127.0.0.1:9081/';
  const unauthorized=await inspectApprovedPageExceptions(bogusBrowser,bogusTarget,valid,false);
  assert.equal(unauthorized.status,'BLOCKED');
  assert.equal(unauthorized.code,'NOT_AUTHORIZED');
  assert.equal(unauthorized.automaticPatchAllowed,false);
  assert.equal(unauthorized.tampermonkeyVerified,false);
  assert.equal(unauthorized.businessVerified,false);
  for(const duration of [-1,0,200,5001,Infinity,1.5]){
    const bad=await inspectApprovedPageExceptions(bogusBrowser,bogusTarget,valid,true,duration);
    assert.equal(bad.code,'INVALID_OPTIONS');
  }
  for(const unsafe of ['file:///private','https://user:secret@example.test/',
    'http://localhost/#secret','javascript:alert(1)',null]){
    const bad=await inspectApprovedPageExceptions(bogusBrowser,bogusTarget,unsafe,true);
    assert.equal(bad.status,'BLOCKED');
    assert.equal(bad.code,'INVALID_OPTIONS');
    assert.equal(JSON.stringify(bad).includes('secret'),false);
  }
  const forged=await inspectApprovedPageExceptions(bogusBrowser,bogusTarget,valid,true);
  assert.equal(forged.code,'UNVERIFIED_BROWSER');
  assert.equal(forged.triage.status,'INSUFFICIENT_EVIDENCE');
  const aborted=new AbortController();
  aborted.abort();
  assert.equal((await inspectApprovedPageExceptions(
    bogusBrowser,bogusTarget,valid,true,1200,aborted.signal
  )).code,'CANCELLED');
});

test('TEST-013: real Windows owned Chrome samples page exceptions without source disclosure or user script claim',async t=>{
  if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true'){
    t.skip('Dedicated signed Chrome Windows Actions only');return;
  }
  let chrome:string|undefined;
  for(const root of [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA]){
    if(!root)continue;
    const path=win32.join(root,'Google','Chrome','Application','chrome.exe');
    try{await access(path);chrome=path;break;}catch{/* check next installed path */}
  }
  assert.ok(chrome,'Expected Google Chrome on Windows runner');
  const profileRoot=await mkdtemp(join(tmpdir(),'uah-runtime-fault-'));
  let stopChrome=()=>{};
  const server=createHttpServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type','text/html; charset=utf-8');
    // Deliberate website JS exception in an isolated test page, NOT a
    // Tampermonkey extension, installed script, or product acceptance run.
    const script=req.url==='/fault'
      ?'<script>const t=setInterval(()=>{throw Error("SECRET_PAGE_EXCEPTION");},350);setTimeout(()=>clearInterval(t),8000);</script>'
      :'';
    res.writeHead(200).end('<!doctype html><html><body><div id="fixture"></div>'+
      script+'</body></html>');
  });
  await new Promise<void>((resolve,reject)=>{
    server.once('error',reject);server.listen(0,'127.0.0.1',resolve);
  });
  t.after(async()=>{
    stopChrome();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await rm(profileRoot,{recursive:true,force:true}).catch(()=>undefined);
  });
  const address=server.address();
  if(!address||typeof address==='string')throw Error('NO_HTTP_PORT');
  const free=createTcpServer();
  await new Promise<void>((resolve,reject)=>{
    free.once('error',reject);free.listen(0,'127.0.0.1',resolve);
  });
  const freeAddress=free.address();
  if(!freeAddress||typeof freeAddress==='string')throw Error('NO_CDP_PORT');
  await new Promise<void>(resolve=>free.close(()=>resolve()));
  const cfg={executablePath:chrome!,userDataDir:join(profileRoot,'profile'),
    remoteDebuggingPort:freeAddress.port,bindAddress:'127.0.0.1' as const};
  const prepared=await prepareApprovedIsolatedProfile(cfg,true);
  assert.equal(prepared.ok,true,JSON.stringify(prepared));
  const launched=await launchApprovedIsolatedChrome(cfg,{userApproved:true,testHeadless:true});
  assert.equal(launched.ok,true,JSON.stringify(launched));
  if(!launched.ok)return;
  stopChrome=launched.stop;
  const faultUrl='http://127.0.0.1:'+address.port+'/fault';
  const faultTarget=await openApprovedTarget(launched,faultUrl,true);
  assert.equal(faultTarget.ok,true,JSON.stringify(faultTarget));
  if(!faultTarget.ok)return;
  const journal=new BoundedFaultLog(4);
  const fault=await inspectAndLogApprovedPageExceptions(
    launched,faultTarget,faultUrl,true,journal,1800);
  assert.equal(fault.status,'PAGE_EXCEPTION_SIGNAL_ONLY',JSON.stringify(fault));
  assert.ok(fault.observedCount>0&&fault.observedCount<=32);
  assert.equal(fault.triage.status,'SINGLE_CAUSE_SIGNAL_ONLY');
  assert.equal(fault.triage.category,'JAVASCRIPT');
  assert.equal(fault.tampermonkeyVerified,false);
  assert.equal(fault.businessVerified,false);
  assert.equal(fault.automaticPatchAllowed,false);
  assert.equal(journal.list()[0]?.category,'JAVASCRIPT');
  assert.equal(JSON.stringify(fault).includes('SECRET_PAGE_EXCEPTION'),false);
  assert.equal(JSON.stringify(journal.list()).includes('SECRET_PAGE_EXCEPTION'),false);
  assert.equal(JSON.stringify(journal.list()).includes(faultUrl),false);
  const cleanUrl='http://127.0.0.1:'+address.port+'/clean';
  const cleanTarget=await openApprovedTarget(launched,cleanUrl,true);
  assert.equal(cleanTarget.ok,true,JSON.stringify(cleanTarget));
  if(!cleanTarget.ok)return;
  const clean=await inspectApprovedPageExceptions(launched,cleanTarget,cleanUrl,true,500);
  assert.equal(clean.status,'NO_EXCEPTION_IN_WINDOW_ONLY',JSON.stringify(clean));
  assert.equal(clean.triage.status,'INSUFFICIENT_EVIDENCE');
  assert.equal(clean.businessVerified,false);
  assert.equal(clean.tampermonkeyVerified,false);
});
