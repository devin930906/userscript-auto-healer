import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {access,mkdir,mkdtemp,realpath,rm,symlink} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {join,win32} from 'node:path';
import {tmpdir} from 'node:os';
import {launchApprovedIsolatedChrome,isLiveApprovedChromeSession,
  type ChromeLaunchOptions,type ManagedLaunchResult} from '../../src/browser/owned-chrome';
import {prepareApprovedIsolatedProfile} from '../../src/browser/chrome-launcher';
import {inspectTampermonkeyTargetHints,inspectApprovedTampermonkeyRuntime,
  TAMPERMONKEY_EXTENSION_ID} from '../../src/manager/tampermonkey-adapter';
import {inspectApprovedTampermonkeyInstallation} from '../../src/manager/tampermonkey-installation';

const id='1234567890abcdef';
const worker={targetId:id,type:'service_worker',
 url:'chrome-extension://'+TAMPERMONKEY_EXTENSION_ID+'/background.js'};

test('TASK-007: isolated CI extension path is accepted only after the existing consent gates',async()=>{
 if(process.platform!=='win32')return;
 const previousActions=process.env.GITHUB_ACTIONS;
 const previousRunnerTemp=process.env.RUNNER_TEMP;
 const root=await realpath(await mkdtemp(join(tmpdir(),'uah-extension-option-gate-')));
 const extension=join(root,'extension');
 await mkdir(extension);
 process.env.GITHUB_ACTIONS='true';
 process.env.RUNNER_TEMP=root;
 try{
  const result=await launchApprovedIsolatedChrome(null,{
   userApproved:true,testHeadless:true,testExtensionDirectory:extension
  } as ChromeLaunchOptions);
  assert.deepEqual(result,{ok:false,code:'PREFLIGHT_FAILED'},
   'a valid gated fixture directory must pass option validation before the deliberately invalid browser config');
 }finally{
  if(previousActions===undefined)delete process.env.GITHUB_ACTIONS;
  else process.env.GITHUB_ACTIONS=previousActions;
  if(previousRunnerTemp===undefined)delete process.env.RUNNER_TEMP;
  else process.env.RUNNER_TEMP=previousRunnerTemp;
  await rm(root,{recursive:true,force:true});
 }
});

test('TASK-007: extension loading rejects missing consent, non-CI launches and non-single paths before preflight',async()=>{
 if(process.platform!=='win32')return;
 const previousActions=process.env.GITHUB_ACTIONS;
 const previousRunnerTemp=process.env.RUNNER_TEMP;
 const root=await realpath(await mkdtemp(join(tmpdir(),'uah-extension-option-reject-')));
 const extension=join(root,'extension');
 const outside=await realpath(await mkdtemp(join(tmpdir(),'uah-extension-option-outside-')));
 const outsideExtension=join(outside,'extension');
 const commaPath=join(root,'extension,second');
 const listPath=join(root,'extension;second');
 await Promise.all([mkdir(extension),mkdir(outsideExtension),mkdir(commaPath),mkdir(listPath)]);
 process.env.RUNNER_TEMP=root;
 process.env.GITHUB_ACTIONS='true';
 const run=(options:unknown)=>launchApprovedIsolatedChrome(null,options as ChromeLaunchOptions);
 try{
  const rejected=[
   {name:'explicit user approval is still required',options:{userApproved:false,testHeadless:true,testExtensionDirectory:extension}},
   {name:'testHeadless is required',options:{userApproved:true,testExtensionDirectory:extension}},
   {name:'testHeadless must be true',options:{userApproved:true,testHeadless:false,testExtensionDirectory:extension}},
   {name:'the GitHub Actions gate is required',options:{userApproved:true,testHeadless:true,testExtensionDirectory:extension},actions:'false'},
   {name:'the extension directory must stay under RUNNER_TEMP',options:{userApproved:true,testHeadless:true,testExtensionDirectory:outsideExtension}},
   {name:'comma-separated extension paths are rejected',options:{userApproved:true,testHeadless:true,testExtensionDirectory:commaPath}},
   {name:'semicolon-separated extension paths are rejected',options:{userApproved:true,testHeadless:true,testExtensionDirectory:listPath}},
   {name:'boxed strings are not accepted as path authority',options:{userApproved:true,testHeadless:true,testExtensionDirectory:new String(extension)}}
  ];
  for(const item of rejected){
   process.env.GITHUB_ACTIONS=item.actions??'true';
   assert.deepEqual(await run(item.options),{ok:false,code:'NOT_AUTHORIZED'},item.name);
  }
 }finally{
  if(previousActions===undefined)delete process.env.GITHUB_ACTIONS;
  else process.env.GITHUB_ACTIONS=previousActions;
  if(previousRunnerTemp===undefined)delete process.env.RUNNER_TEMP;
  else process.env.RUNNER_TEMP=previousRunnerTemp;
  await Promise.all([
   rm(root,{recursive:true,force:true}),
   rm(outside,{recursive:true,force:true})
  ]);
 }
});

test('TASK-007: extension loading rejects a junction that escapes RUNNER_TEMP',async t=>{
 if(process.platform!=='win32'){
  t.skip('Windows reparse-point behavior only');
  return;
 }
 const previousActions=process.env.GITHUB_ACTIONS;
 const previousRunnerTemp=process.env.RUNNER_TEMP;
 const root=await realpath(await mkdtemp(join(tmpdir(),'uah-extension-junction-root-')));
 const outside=await realpath(await mkdtemp(join(tmpdir(),'uah-extension-junction-outside-')));
 const extension=join(outside,'extension');
 const link=join(root,'escaped');
 await mkdir(extension);
 try{
  await symlink(outside,link,'junction');
 }catch{
  await Promise.all([
   rm(root,{recursive:true,force:true}),
   rm(outside,{recursive:true,force:true})
  ]);
  t.skip('Disposable Windows runner does not permit a test junction');
  return;
 }
 process.env.RUNNER_TEMP=root;
 process.env.GITHUB_ACTIONS='true';
 try{
  const result=await launchApprovedIsolatedChrome(null,{
   userApproved:true,testHeadless:true,testExtensionDirectory:join(link,'extension')
  } as ChromeLaunchOptions);
  assert.deepEqual(result,{ok:false,code:'NOT_AUTHORIZED'});
 }finally{
  if(previousActions===undefined)delete process.env.GITHUB_ACTIONS;
  else process.env.GITHUB_ACTIONS=previousActions;
  if(previousRunnerTemp===undefined)delete process.env.RUNNER_TEMP;
  else process.env.RUNNER_TEMP=previousRunnerTemp;
  await Promise.all([
   rm(root,{recursive:true,force:true}),
   rm(outside,{recursive:true,force:true})
  ]);
 }
});

test('TEST-017 stage: Tampermonkey runtime target is a hint, not proof of GM or installation',()=>{
 const result=inspectTampermonkeyTargetHints([worker]);
 assert.deepEqual(result,{ok:true,status:'RUNTIME_TARGET_HINT_ONLY',manager:'Tampermonkey',
   extensionId:TAMPERMONKEY_EXTENSION_ID,matchedRuntimeTargets:1,
   extensionAuthenticityVerified:false,versionVerified:false,permissionVerified:false,
   scriptInstallationVerified:false,scriptInjectionVerified:false,
   gmApiVerified:false,businessVerified:false});
});
test('TEST-017 stage: unrelated manager/page target cannot impersonate Tampermonkey',()=>{
 const variants=[
  {targetId:id,type:'page',url:worker.url},
  {targetId:id,type:'service_worker',url:'https://example.com/'},
  {targetId:id,type:'service_worker',url:'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bg.js'},
  {targetId:id,type:'service_worker',url:'chrome-extension://'+TAMPERMONKEY_EXTENSION_ID+'.evil.test/bg.js'},
  {targetId:id,type:'service_worker',url:'data:text/html,hello'}
 ];
 for(const variant of variants){
   assert.deepEqual(inspectTampermonkeyTargetHints([variant]),
     {ok:false,code:'RUNTIME_NOT_OBSERVED'});
 }
 assert.deepEqual(inspectTampermonkeyTargetHints([]),{ok:false,code:'RUNTIME_NOT_OBSERVED'});
});
test('TEST-017 stage: invalid/duplicate target metadata fails closed',()=>{
 for(const payload of [
  null,{},new Array(513).fill(worker),[null],[{type:'service_worker'}],
  [{...worker,targetId:'bad'}],[worker,{...worker}],
  [{...worker,type:'page',targetId:'bad'}],
  [{...worker,type:'page'},{...worker,type:'page'}],
  [{...worker,type:'page'},worker],
  [{...worker,url:6}],[{...worker,url:'x'.repeat(8193)}]
 ]){
   assert.deepEqual(inspectTampermonkeyTargetHints(payload),
     {ok:false,code:'INVALID_CDP_RESPONSE'});
 }
});
test('TEST-017 stage: user authorization and owned session are mandatory, no CDP call on failure',async()=>{
 const session={ok:false as const,code:'PREFLIGHT_FAILED' as const};
 assert.deepEqual(await inspectApprovedTampermonkeyRuntime(session,false),
   {ok:false,code:'NOT_AUTHORIZED'});
 assert.deepEqual(await inspectApprovedTampermonkeyRuntime(session,true),
   {ok:false,code:'UNVERIFIED_BROWSER'});
 const signal=AbortSignal.abort();
 assert.deepEqual(await inspectApprovedTampermonkeyRuntime(session,true,signal),
   {ok:false,code:'CANCELLED'});
 const fake={ok:true as const,status:'OWNED_CDP_BROWSER_VERIFIED' as const,
   pid:12345,chromeVersion:'155.0.0.0',browserWebsocket:'ws://127.0.0.1:9223/devtools/browser/1234567890abcdef',
   websocketHandshakeVerified:true as const,targetVerified:false as const,stop:()=>{}};
 assert.deepEqual(await inspectApprovedTampermonkeyRuntime(fake,true),
   {ok:false,code:'UNVERIFIED_BROWSER'});
});

/** A real Windows Chrome/CDP roundtrip is not a Tampermonkey GM test.
 * The expected isolated profile has no extensions; any detected runtime is a hint only.
 */
test('TEST-017 stage: real owned Chrome target query remains non-verified',async t=>{
 if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true'){
  t.skip('Dedicated signed Chrome Windows Actions only');
  return;
 }
 let chrome:string|undefined;
 for(const base of [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA]){
   if(!base)continue;
   const candidate=win32.join(base,'Google','Chrome','Application','chrome.exe');
   try{await access(candidate);chrome=candidate;break;}catch{/* no Chrome at this location */}
 }
 assert.ok(chrome,'Windows runner must provide signed Chrome');
 const listener=createServer();
 await new Promise<void>((resolve,reject)=>{
   listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);
 });
 const address=listener.address();
 await new Promise<void>(resolve=>listener.close(()=>resolve()));
 if(!address||typeof address==='string')throw Error('NO_FREE_TEST_PORT');
 const root=await mkdtemp(join(tmpdir(),'uah-manager-presence-'));
 let stop=()=>{};
 t.after(async()=>{stop();await rm(root,{recursive:true,force:true}).catch(()=>undefined);});
 const config={executablePath:chrome!,userDataDir:join(root,'profile'),
   remoteDebuggingPort:address.port,bindAddress:'127.0.0.1' as const};
 const profile=await prepareApprovedIsolatedProfile(config,true);
 assert.equal(profile.ok,true,JSON.stringify(profile));
 const session=await launchApprovedIsolatedChrome(config,{userApproved:true,testHeadless:true});
 assert.equal(session.ok,true,JSON.stringify(session));
 if(!session.ok)return;
 stop=session.stop;
 const probe=await inspectApprovedTampermonkeyRuntime(session,true);
 assert.ok(probe.ok?probe.status==='RUNTIME_TARGET_HINT_ONLY':
   probe.code==='RUNTIME_NOT_OBSERVED',JSON.stringify(probe));
 if(probe.ok){
   assert.equal(probe.gmApiVerified,false);
   assert.equal(probe.scriptInjectionVerified,false);
   assert.equal(probe.extensionAuthenticityVerified,false);
 }
 // The app-owned disposable profile has no Tampermonkey installation. The
 // manager-page inventory must distinguish this verified absence from an
 // idle service worker, and the temporary chrome://extensions target must be
 // closed before the inspection can return a result.
 const installation=await inspectApprovedTampermonkeyInstallation(session,true);
 assert.deepEqual(installation,{
  ok:true,status:'NOT_INSTALLED',extensionId:TAMPERMONKEY_EXTENSION_ID,
  extensionAuthenticityVerified:false,storeProvenanceVerified:false,
  versionVerified:false,permissionVerified:false,
  scriptInstallationVerified:false,scriptInjectionVerified:false,
  gmApiVerified:false,businessVerified:false
 });

 // A user can cancel while the final asynchronous owner/PID check runs.
 // Even a legitimate listener match cannot revive cancelled authorization.
 // Replace only this module export after the real Chrome launch, and restore
 // it before the test exits; no browser/process or user script is modified.
 const listenerModule=require('../../src/browser/cdp-session') as typeof import('../../src/browser/cdp-session');
 const originalVerify=listenerModule.verifyWindowsLoopbackListenerPid;
 // Either Windows PID ownership query can stall in an OS subprocess.
 // Revoked consent must not wait for an eventual answer from that process.
 for(const blockedCheck of [1,2]){
  const controller=new AbortController();
  let checks=0;
  let signalEntered!:()=>void;
  const entered=new Promise<void>(resolve=>{signalEntered=resolve;});
  let release!:()=>void;
  (listenerModule as {verifyWindowsLoopbackListenerPid:typeof originalVerify})
   .verifyWindowsLoopbackListenerPid=async(...args)=>{
    checks++;
    if(checks!==blockedCheck)return originalVerify(...args);
    await new Promise<void>(resolve=>{release=resolve;signalEntered();});
    return originalVerify(...args);
   };
  try{
   const pending=inspectApprovedTampermonkeyRuntime(session,true,controller.signal);
   await Promise.race([entered,new Promise<never>((_,reject)=>
    setTimeout(()=>reject(Error('PID_PROBE_NOT_REACHED')),9000))]);
   controller.abort();
   const result=await Promise.race([pending,new Promise<never>((_,reject)=>
    setTimeout(()=>reject(Error('CONSENT_REVOCATION_STALLED_ON_PID')),1000))]);
   assert.deepEqual(result,{ok:false,code:'CANCELLED'},
    'cancelled native scope must not await a stalled OS listener query');
   assert.equal(checks,blockedCheck);
  }finally{
   release?.();
   (listenerModule as {verifyWindowsLoopbackListenerPid:typeof originalVerify})
    .verifyWindowsLoopbackListenerPid=originalVerify;
  }
 }

 const abort=new AbortController();
 let ownerChecks=0;
 (listenerModule as {verifyWindowsLoopbackListenerPid:typeof originalVerify})
   .verifyWindowsLoopbackListenerPid=async(...args)=>{
     const result=await originalVerify(...args);
     ownerChecks++;
     if(ownerChecks===2)abort.abort();
     return result;
   };
 try{
   const cancelled=await inspectApprovedTampermonkeyRuntime(session,true,abort.signal);
   assert.equal(ownerChecks,2,'fixture must cancel inside the final real PID check');
   assert.deepEqual(cancelled,{ok:false,code:'CANCELLED'},
     'revoked user consent cannot return a post-verification runtime hint');
 }finally{
   (listenerModule as {verifyWindowsLoopbackListenerPid:typeof originalVerify})
     .verifyWindowsLoopbackListenerPid=originalVerify;
 }

 // Closing the owned Chrome session during the FINAL asynchronous listener
 // check must invalidate its runtime hint, even if that check saw the same PID.
 // This is the test's disposable, app-launched Chrome: never an external PID.
 let lifetimeChecks=0;
 (listenerModule as {verifyWindowsLoopbackListenerPid:typeof originalVerify})
   .verifyWindowsLoopbackListenerPid=async(...args)=>{
     const result=await originalVerify(...args);
     lifetimeChecks++;
     if(lifetimeChecks===2){
       assert.equal(result.ok,true,'fixture must own the listener until final check');
       session.stop();
     }
     return result;
   };
 try{
   const stopped=await inspectApprovedTampermonkeyRuntime(session,true);
   assert.equal(lifetimeChecks,2,'fixture must stop after final listener check');
   assert.deepEqual(stopped,{ok:false,code:'UNVERIFIED_BROWSER'},
     'a stopped Chrome session cannot yield a post-verification runtime hint');
 }finally{
   (listenerModule as {verifyWindowsLoopbackListenerPid:typeof originalVerify})
     .verifyWindowsLoopbackListenerPid=originalVerify;
 }
});

test('TASK-007: installed vendor fixture returns only app-owned manager metadata and closes its inspection target',async t=>{
 if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true'||!process.env.UAH_TM_EXTENSION_DIR){
  t.skip('Signed disposable vendor CRX Windows Actions fixture only');
  return;
 }
 const runnerTemp=process.env.RUNNER_TEMP;
 const extension=process.env.UAH_TM_EXTENSION_DIR;
 assert.ok(runnerTemp&&win32.isAbsolute(runnerTemp),'Windows Actions must provide RUNNER_TEMP');
 assert.ok(extension&&win32.isAbsolute(extension),'CI must provide the verified unpacked vendor fixture');
 const fixturePreflight=await launchApprovedIsolatedChrome(null,{
  userApproved:true,testHeadless:true,testExtensionDirectory:extension
 });
 assert.deepEqual(fixturePreflight,{ok:false,code:'PREFLIGHT_FAILED'},
  'fixture path must pass the app-owned RUNNER_TEMP boundary before reading its manifest');
 const manifest=JSON.parse(readFileSync(win32.join(extension,'manifest.json'),'utf8')) as {
  manifest_version?:unknown;version?:unknown
 };
 assert.equal(manifest.manifest_version,3);
 assert.equal(typeof manifest.version,'string');
 let chrome:string|undefined;
 for(const base of [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA]){
  if(!base)continue;
  const candidate=win32.join(base,'Google','Chrome','Application','chrome.exe');
  try{await access(candidate);chrome=candidate;break;}catch{/* signed Chrome is absent at this runner location */}
 }
 assert.ok(chrome,'Windows runner must provide signed Chrome');
 const listener=createServer();
 await new Promise<void>((resolve,reject)=>{
  listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);
 });
 const address=listener.address();
 await new Promise<void>(resolve=>listener.close(()=>resolve()));
 if(!address||typeof address==='string')throw Error('NO_FREE_TEST_PORT');
 const root=await mkdtemp(win32.join(runnerTemp,'uah-tm-installed-metadata-'));
 const config={executablePath:chrome!,userDataDir:win32.join(root,'profile'),
  remoteDebuggingPort:address.port,bindAddress:'127.0.0.1' as const};
 let session:ManagedLaunchResult|undefined;
 let safeToRemoveProfile=true;
 t.after(async()=>{
  if(session?.ok&&isLiveApprovedChromeSession(session)){
   const closed=await session.closeGracefully?.().catch(()=>false);
   if(closed!==true)safeToRemoveProfile=false;
  }
  if(!safeToRemoveProfile)throw Error('OWNED_TEST_PROFILE_LEFT_FOR_RUNNER_CLEANUP');
  await rm(root,{recursive:true,force:true}).catch(()=>undefined);
 });
 const prepared=await prepareApprovedIsolatedProfile(config,true);
 assert.equal(prepared.ok,true,'only a new isolated profile under RUNNER_TEMP may be used');
 const launched=await launchApprovedIsolatedChrome(config,{
  userApproved:true,testHeadless:true,testExtensionDirectory:extension
 });
 assert.equal(launched.ok,true,'app-owned Chrome must load the disposable fixture '+
  (launched.ok?'':'('+launched.code+')'));
 if(!launched.ok)return;
 session=launched;
 const readPageTargets=async():Promise<string[]>=>{
  const response=await fetch('http://127.0.0.1:'+address.port+'/json/list');
  assert.equal(response.status===200,true,'owned Chrome target inventory must be readable');
  const raw:unknown=await response.json();
  assert.equal(Array.isArray(raw),true,'owned Chrome target inventory must be a list');
  return (raw as Array<Record<string,unknown>>)
   .filter(target=>target.type==='page'&&typeof target.id==='string')
   .map(target=>target.id as string).sort();
 };
 const pagesBefore=await readPageTargets();
 const installation=await inspectApprovedTampermonkeyInstallation(session,true);
 const pagesAfter=await readPageTargets();
 assert.equal(pagesAfter.join('|')===pagesBefore.join('|'),true,
  'metadata inspection must close its temporary chrome://extensions page and CDP target session');
 assert.equal(installation.ok,true,'installed fixture metadata probe must complete');
 if(!installation.ok)return;
 assert.equal(installation.status,'INSTALLED_METADATA_HINT_ONLY');
 if(installation.status!=='INSTALLED_METADATA_HINT_ONLY')return;
 assert.deepEqual({manager:installation.manager,extensionId:installation.extensionId,
  version:installation.version,enabled:installation.enabled},
 {manager:'Tampermonkey',extensionId:TAMPERMONKEY_EXTENSION_ID,
  version:manifest.version,enabled:'ENABLED'});
 assert.equal(['ENABLED','DISABLED','UNKNOWN','NOT_APPLICABLE'].includes(
  installation.allowUserScripts),true,'permission hint must use the supported state vocabulary');
 const chromeVersionMajor=Number(session.chromeVersion.split('.')[0]);
 assert.equal(installation.permissionVerified,chromeVersionMajor<138||
  installation.allowUserScripts==='ENABLED'||installation.allowUserScripts==='DISABLED');
 const metadataOnlyFlags={
  extensionAuthenticityVerified:installation.extensionAuthenticityVerified,
  storeProvenanceVerified:installation.storeProvenanceVerified,
  scriptInstallationVerified:installation.scriptInstallationVerified,
  scriptInjectionVerified:installation.scriptInjectionVerified,
  gmApiVerified:installation.gmApiVerified,businessVerified:installation.businessVerified
 };
 assert.deepEqual(metadataOnlyFlags,{
  extensionAuthenticityVerified:false,storeProvenanceVerified:false,
  scriptInstallationVerified:false,scriptInjectionVerified:false,
  gmApiVerified:false,businessVerified:false
 });
 for(const unsupportedAuthorityField of [
  'automaticInstallAllowed','automaticEnableAllowed','permissionChangeAllowed',
  'writeAllowed','applyAllowed','automaticPatchAllowed','rollbackAllowed',
  'automaticRollbackAllowed'
 ])assert.equal(Object.prototype.hasOwnProperty.call(installation,unsupportedAuthorityField),false,
  'metadata-only probe must not expose '+unsupportedAuthorityField);
 console.log('TAMPERMONKEY_INSTALLED_METADATA_HINT_ONLY '+JSON.stringify({
  fixture:'synthetic/signature-key-verified-unpacked-CRX',manager:installation.manager,
  extensionId:installation.extensionId,version:installation.version,
  enabled:installation.enabled,allowUserScripts:installation.allowUserScripts,
  permissionVerified:installation.permissionVerified,inspectionTargetClosed:true,
  ...metadataOnlyFlags
 }));
 const closed=await session.closeGracefully?.();
 if(closed!==true)safeToRemoveProfile=false;
 assert.equal(closed,true,'the app-owned disposable browser session must close');
 assert.equal(isLiveApprovedChromeSession(session),false,
  'closing the fixture session must revoke its app-owned session handle');
});

test('TEST-017 stage: distinct ordinary Chrome targets remain ignorable but cannot forge identities',()=>{
  const unrelated={targetId:'unrelated-target-01',type:'page',url:'https://example.com/'};
  assert.deepEqual(inspectTampermonkeyTargetHints([unrelated]),
    {ok:false,code:'RUNTIME_NOT_OBSERVED'});
  const mixed=inspectTampermonkeyTargetHints([unrelated,worker]);
  assert.equal(mixed.ok,true);
  if(mixed.ok)assert.equal(mixed.matchedRuntimeTargets,1);
});

test('TEST-017/026: CDP hint parser does not evaluate hostile getters or iterators',()=>{
 let getters=0;
 const accessorTarget={targetId:id,type:'service_worker'};
 Object.defineProperty(accessorTarget,'url',{enumerable:true,get(){
   getters++;throw Error('PRIVATE_EXTENSION_DATA');
 }});
 const accessorEntries=[worker] as unknown[];
 Object.defineProperty(accessorEntries,0,{enumerable:true,configurable:true,get(){
   getters++;throw Error('PRIVATE_TARGET_ENTRY');
 }});
 const trapped=[
   [accessorTarget],
   accessorEntries,
   [new Proxy(worker,{ownKeys(){throw Error('PRIVATE_TARGET_PROXY');}})],
   new Proxy([worker],{ownKeys(){throw Error('PRIVATE_ARRAY_PROXY');}}),
   [,worker],
   [{...worker,targetId:id, get url(){getters++;throw Error('PRIVATE_URL');}}]
 ];
 for(const sample of trapped){
   assert.deepEqual(inspectTampermonkeyTargetHints(sample),
     {ok:false,code:'INVALID_CDP_RESPONSE'});
 }
 assert.equal(getters,0,'CDP metadata getters must never be evaluated');
 const customIterator=[worker];
 Object.defineProperty(customIterator,Symbol.iterator,{get(){
   getters++;throw Error('PRIVATE_ITERATOR');
 }});
 const result=inspectTampermonkeyTargetHints(customIterator);
 assert.deepEqual(result,{ok:false,code:'INVALID_CDP_RESPONSE'},
   'extra own iterator metadata must fail closed without invoking it');
 assert.equal(getters,0);
});

test('TEST-017/026: Proxy-based CDP targets never run reflection traps',()=>{
 let trapCalls=0;
 const proxyTarget=new Proxy(worker,{
   getPrototypeOf(){trapCalls++;return Object.prototype;},
   ownKeys(){trapCalls++;return Reflect.ownKeys(worker);},
   getOwnPropertyDescriptor(target,key){
     trapCalls++;return Reflect.getOwnPropertyDescriptor(target,key);
   }
 });
 const entries=[worker];
 const proxyList=new Proxy(entries,{
   getPrototypeOf(){trapCalls++;return Array.prototype;},
   ownKeys(){trapCalls++;return Reflect.ownKeys(entries);},
   getOwnPropertyDescriptor(target,key){
     trapCalls++;return Reflect.getOwnPropertyDescriptor(target,key);
   }
 });
 for(const payload of [proxyList,[proxyTarget]]){
   assert.deepEqual(inspectTampermonkeyTargetHints(payload),
     {ok:false,code:'INVALID_CDP_RESPONSE'});
 }
 assert.equal(trapCalls,0,'Untrusted Proxy reflection traps must not execute');
});

test('TASK-007/TEST-017/026: runtime inspection rejects forged AbortSignals before any getter or CDP access',async()=>{
 const session={ok:false as const,code:'PREFLIGHT_FAILED' as const};
 let traps=0;
 const accessor={
  get aborted(){traps++;throw Error('HOSTILE_ABORTED_GETTER');}
 } as unknown as AbortSignal;
 const active=new Proxy(new AbortController().signal,{
  get(){traps++;throw Error('HOSTILE_ABORT_PROXY_GET');},
  getPrototypeOf(){traps++;throw Error('HOSTILE_ABORT_PROXY_PROTO');},
  ownKeys(){traps++;throw Error('HOSTILE_ABORT_PROXY_KEYS');}
 });
 const revoked=Proxy.revocable(new AbortController().signal,{});
 revoked.revoke();
 const spoof=Object.create(AbortSignal.prototype) as AbortSignal;
 const shadow=new AbortController().signal;
 Object.defineProperty(shadow,'addEventListener',{value:()=>{
  traps++;throw Error('HOSTILE_ABORT_LISTENER');
 }});
 for(const signal of [accessor,active,revoked.proxy,spoof,shadow]){
  const result=await inspectApprovedTampermonkeyRuntime(session,true,signal);
  assert.deepEqual(result,{ok:false,code:'INVALID_OPTIONS'},
   'a non-native or shadowed signal cannot invoke caller code or reach CDP');
 }
 assert.equal(traps,0,'no untrusted getter, proxy or listener is ever executed');
 // Legitimate native cancellation continues to be handled distinctly.
 const cancelled=new AbortController();
 cancelled.abort();
 assert.deepEqual(await inspectApprovedTampermonkeyRuntime(session,true,cancelled.signal),
  {ok:false,code:'CANCELLED'});
});

test('TASK-007/TEST-017/026: only native registered Chrome sessions may be inspected without getter or Proxy effects',async()=>{
 let calls=0;
 const poison=()=>{calls++;throw Error('FORGED_CHROME_SESSION_GETTER');};
 const getter=Object.defineProperty({},'ok',{get:poison});
 const proxy=new Proxy({ok:true,status:'OWNED_CDP_BROWSER_VERIFIED'},{
  get:poison,getPrototypeOf:poison,ownKeys:poison
 });
 const revoked=Proxy.revocable({ok:true},{get:poison});
 revoked.revoke();
 const samples=[getter,proxy,revoked.proxy];
 for(const candidate of samples){
  const session=candidate as Parameters<typeof inspectApprovedTampermonkeyRuntime>[0];
  assert.equal(isLiveApprovedChromeSession(session),false,
   'ownership must be decided before observing caller session properties');
  assert.deepEqual(await inspectApprovedTampermonkeyRuntime(session,true),
   {ok:false,code:'UNVERIFIED_BROWSER'});
 }
 assert.equal(calls,0,'unregistered Chrome session accessors or Proxy traps must not execute');
});

// TASK-007 / Issue #486 / TEST-017/026: a Target.getTargets CDP reply is
// not successful when its error key is present, even with a falsy JSON value
// and plausible runtime targetInfos. No CDP failure may mint a runtime hint.
test('TASK-007/TEST-017/026: CDP target-list receipt rejects explicit falsy errors and non-text data',()=>{
 const inspect=(require('../../src/manager/tampermonkey-adapter') as {
  readTampermonkeyCdpTargetReceipt?: (raw:unknown)=>unknown|null|undefined
 }).readTampermonkeyCdpTargetReceipt;
 assert.equal(typeof inspect,'function',
  'a manager CDP response must have an independently testable bounded parser');
 if(!inspect)return;
 const valid={id:1,result:{targetInfos:[worker]}};
 assert.deepEqual(inspect(JSON.stringify(valid)),[worker],
  'valid CDP reply remains a target metadata hint only');
 assert.equal(inspect(JSON.stringify({id:2,result:valid.result})),undefined,
  'unrelated browser CDP events must not finish target inspection');
 for(const error of [false,0,'',null]){
  assert.equal(inspect(JSON.stringify({
   id:1,error,result:valid.result
  })),null,'an explicit CDP error must block even when its JSON value is falsy');
 }
 for(const raw of [
  JSON.stringify({id:1,error:{message:'PRIVATE_EXTENSION_INFO'},result:valid.result}),
  JSON.stringify({id:1,result:null}),
  JSON.stringify({id:1,result:{}}),
  JSON.stringify({id:1,result:{targetInfos:'forged'}}),
  JSON.stringify({id:1,result:valid.result,padding:'PRIVATE'.repeat(90000)}),
  'null','not-json',Buffer.from(JSON.stringify(valid)),
  {toString(){throw Error('PRIVATE_CALLED_BY_PARSER');}}
 ]){
  assert.equal(inspect(raw),null,
   'invalid/oversized/non-native-text receipts must not return manager hints');
 }
});

// TASK-007 / Issue #486: only a bare Target.getTargets response envelope
// is eligible for a runtime hint. A message with extra protocol fields or
// extra result properties cannot be treated as an ordinary successful reply.
test('TASK-007/TEST-017/026: mixed or extended CDP envelopes fail closed',()=>{
 const {readTampermonkeyCdpTargetReceipt:read}=
  require('../../src/manager/tampermonkey-adapter') as typeof import('../../src/manager/tampermonkey-adapter');
 const targetInfos=[worker];
 assert.deepEqual(read(JSON.stringify({id:1,result:{targetInfos}})),targetInfos);
 for(const raw of [
  {id:1,result:{targetInfos},method:'Target.targetCreated'},
  {id:1,result:{targetInfos},sessionId:'not-a-browser-root-reply'},
  {id:1,result:{targetInfos},padding:'unexpected'},
  {id:1,result:{targetInfos,unexpected:true}}
 ]){
  assert.equal(read(JSON.stringify(raw)),null,
   'an extended response envelope must not become an ordinary target hint');
 }
 assert.equal(read(JSON.stringify({
  id:2,result:{targetInfos},method:'Target.targetCreated'
 })),undefined,'other command IDs remain unrelated, not fatal errors');
});

test('TASK-007/TEST-017/026: raw extension target URLs must not become hints through URL normalization',()=>{
 const canonical='chrome-extension://'+TAMPERMONKEY_EXTENSION_ID+'/background.js';
 assert.equal(inspectTampermonkeyTargetHints([{
  ...worker,url:canonical
 }]).ok,true,'legitimate extension target remains a limited hint');
 const normalizedAliases=[
  canonical+'\n',
  '\t'+canonical,
  canonical+'\r',
  canonical.replace('/background.js','/back\\ground.js'),
  canonical.replace('/background.js','/./background.js'),
  canonical+'#redirected',
  canonical+'?credential=private'
 ];
 for(const raw of normalizedAliases){
  assert.deepEqual(inspectTampermonkeyTargetHints([{...worker,url:raw}]),
   {ok:false,code:'RUNTIME_NOT_OBSERVED'},
   'ambiguous raw target must not be accepted after URL constructor normalization');
 }
});

// Source-level asynchronous boundary invariant: an AbortSignal may be revoked
// while Windows PID ownership verification is pending. Cancellation must win
// before reporting a stale listener error or starting CDP communication.
test('TASK-007/TEST-017/026: cancellation wins after first async listener owner check',()=>{
 const source=readFileSync(join(process.cwd(),'src','manager','tampermonkey-adapter.ts'),'utf8');
 const start=source.indexOf('const owned=await awaitListenerProofOrRevocation(port,session.pid,signal);');
 const second=source.indexOf('const payload=await readBoundedTargets(session.browserWebsocket,signal);',start);
 assert.ok(start>=0&&second>start,'bounded first ownership and CDP steps are present');
 const between=source.slice(start,second);
 const cancelled=between.indexOf("if(signal?.aborted)return {ok:false,code:'CANCELLED'};");
 const ownerFailure=between.indexOf("if(owned.cancelled||!owned.ok||!isLiveApprovedChromeSession(session))");
 assert.ok(cancelled>=0&&ownerFailure>cancelled,
  'revoked consent must be observed before an in-flight owner lookup error');
});


test('TASK-007/TEST-017/026: CDP target hints reject hidden or accessor-only extra target fields without executing them',()=>{
 let getterCalls=0;
 const withExtraData={...worker,title:'background',attached:false};
 const legitimate=inspectTampermonkeyTargetHints([withExtraData]);
 assert.equal(legitimate.ok,true,'ordinary JSON target metadata remains supported');
 if(legitimate.ok)assert.equal(legitimate.matchedRuntimeTargets,1);
 const withAccessor=Object.defineProperty({...worker},'title',{
  enumerable:true,get(){getterCalls++;throw Error('PRIVATE_TARGET_METADATA');}
 });
 const withHidden=Object.defineProperty({...worker},Symbol('secret'),{
  enumerable:false,get(){getterCalls++;throw Error('PRIVATE_HIDDEN_METADATA');}
 });
 const withHiddenData=Object.defineProperty({...worker},'opaqueMetadata',{
  enumerable:false,value:'UNTRUSTED_CDP_PAYLOAD'
 });
 const withHiddenRequired=Object.defineProperty({...worker},'url',{
  enumerable:false,value:worker.url
 });
 const withExtraSymbol=Object.defineProperty({...worker},Symbol('private'),{
  enumerable:false,value:'PRIVATE_EXTENSION_METADATA'
 });
 for(const item of [withAccessor,withHidden,withHiddenData,withHiddenRequired,withExtraSymbol]){
  assert.deepEqual(inspectTampermonkeyTargetHints([item]),
   {ok:false,code:'INVALID_CDP_RESPONSE'},
   'unexpected non-JSON property descriptors must not produce a manager hint');
 }
 assert.equal(getterCalls,0,'no metadata accessor may execute while inspecting targets');
});


test('TASK-007/TEST-017/026: CDP receipt enforces UTF-8 byte budget, not UTF-16 code units',()=>{
 const {readTampermonkeyCdpTargetReceipt:read}=
   require('../../src/manager/tampermonkey-adapter') as typeof import('../../src/manager/tampermonkey-adapter');
 const withinBudget=JSON.stringify({id:1,result:{targetInfos:[
   {...worker,title:'界'.repeat(80_000)}
 ]}});
 assert.ok(Buffer.byteLength(withinBudget,'utf8')<256*1024);
 assert.equal((read(withinBudget) as unknown[])?.length,1,
   'ordinary browser metadata inside the declared byte budget remains eligible');
 const oversized=JSON.stringify({id:1,result:{targetInfos:[
   {...worker,title:'界'.repeat(90_000)}
 ]}});
 assert.ok(oversized.length<256*1024,
   'the regression specifically fits the old UTF-16 code-unit check');
 assert.ok(Buffer.byteLength(oversized,'utf8')>256*1024);
 assert.equal(read(oversized),null,
   'a multibyte page title cannot bypass the CDP 256 KiB raw message limit');
});


test('TASK-007/TEST-017/026: renderer manager hint cannot accept a replaced owned Chrome session',()=>{
 const source=readFileSync(join(process.cwd(),'app','main','index.ts'),'utf8');
 const start=source.indexOf("ipcMain.handle('browser:tampermonkey-hint'");
 const end=source.indexOf("ipcMain.handle('browser:open-tampermonkey-store'",start);
 assert.ok(start>=0&&end>start,'manager hint must keep its native IPC boundary');
 const handler=source.slice(start,end);
 const inspect=handler.indexOf('inspectApprovedTampermonkeyInstallation(owned,true)');
 const finalReceipt=handler.indexOf('return {...status,...unverified};');
 assert.ok(inspect>=0&&finalReceipt>inspect,
   'only inspected read-only manager metadata may reach the UI');
 assert.ok(handler.includes('chrome://extensions'),
   'native consent must identify the Chrome extensions management page');
 assert.ok(handler.includes('不会自动安装、启用或修改权限'),
   'manager inspection must not imply installation or permission changes');
 // An independently authorized browser can be stopped/replaced while native
 // CDP lookup is pending. A stale success must not repaint the new session.
 const fence=handler.indexOf('readOwnedBrowser()!==owned',inspect);
 assert.ok(fence>inspect&&fence<finalReceipt,
   'recheck the exact currently selected app-owned Chrome after awaited inspection');
 assert.ok(handler.includes('readExistingBrowser()!==attached'),
   'the already-connected Chrome path retains the same stale-session fence');
});


test('TASK-007/TEST-017/026: ambiguous duplicate JSON keys cannot mint CDP manager hints',()=>{
 const {readTampermonkeyCdpTargetReceipt:read}=
   require('../../src/manager/tampermonkey-adapter') as typeof import('../../src/manager/tampermonkey-adapter');
 const targets=JSON.stringify([worker]);
 const valid='{"id":1,"result":{"targetInfos":'+targets+'}}';
 assert.deepEqual(read(valid),[worker]);
 const aliases=[
   '{"id":1,"id":1,"result":{"targetInfos":'+targets+'}}',
   '{"id":1,"result":{"targetInfos":'+targets+'},"result":{"targetInfos":'+targets+'}}',
   '{"id":1,"result":{"targetInfos":'+targets+',"targetInfos":'+targets+'}}',
   '{"id":1,"result":{"targetInfos":[{"targetId":"'+id+
      '","type":"service_worker","url":"https://untrusted.example/",'+
      '"url":"'+worker.url+'"}]}}',
   // Escaped property names decode to the same key even though raw bytes differ.
   '{"id":1,"result":{"targetInfos":'+targets+',"target\\u0049nfos":'+targets+'}}'
 ];
 for(const raw of aliases){
   assert.equal(read(raw),null,
     'duplicate JSON object keys are ambiguous CDP evidence, never a presence hint');
 }
});
