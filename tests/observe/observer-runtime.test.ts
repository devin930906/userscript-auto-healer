import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {access,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,win32} from 'node:path';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {launchApprovedIsolatedChrome,readBoundedCdpJson} from '../../src/browser/owned-chrome';
import {prepareApprovedIsolatedProfile} from '../../src/browser/chrome-launcher';
import {openApprovedTarget} from '../../src/browser/cdp-target';
import {observeApprovedDomSeries,observeApprovedDom} from '../../src/observe/dom-observer';

async function availablePort():Promise<number>{
 const socket=createServer();
 await new Promise<void>((resolve,reject)=>{
   socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);
 });
 const a=socket.address();
 await new Promise<void>(resolve=>socket.close(()=>resolve()));
 if(!a||typeof a==='string')throw Error('NO_TEST_PORT');
 return a.port;
}
test('TEST-010/012: real owned Chrome DOM + delayed SPA transition (not userscript verification)',async t=>{
 if(process.platform!=='win32'){t.skip('Requires real Windows Chrome');return;}
 let chrome:string|undefined;
 for(const base of [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA]){
   if(!base)continue;
   const path=win32.join(base,'Google','Chrome','Application','chrome.exe');
   try{await access(path);chrome=path;break;}catch{/* selected location absent */}
 }
 assert.ok(chrome,'The Windows runner must provide a signed Chrome for TEST-010/012');
 const root=await mkdtemp(join(tmpdir(),'uah-observe-e2e-'));
 let stop=()=>{};
 t.after(async()=>{stop();await rm(root,{recursive:true,force:true}).catch(()=>undefined);});
 const sub=createServer((_req,res)=>{
   res.writeHead(200,{'Content-Type':'text/html'});
   res.end('<!doctype html><html><body><div id="inside-frame"></div></body></html>');
 });
 await new Promise<void>((resolve,reject)=>{sub.once('error',reject);sub.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise<void>(resolve=>sub.close(()=>resolve())));
 const subAddr=sub.address();
 if(!subAddr||typeof subAddr==='string')throw Error('NO_SUBFRAME');
 const subUrl='http://127.0.0.1:'+subAddr.port+'/frame';
 let signalDynamicChange=false;
 const main=createServer((req,res)=>{
   if(req.url==='/trigger'){
     res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});
     res.end(signalDynamicChange?'go':'wait');
     return;
   }
   res.writeHead(200,{'Content-Type':'text/html'});
   res.end('<!doctype html><html><body><div id="initial">ready</div>'+
     '<iframe src="'+subUrl+'"></iframe>'+
     '<script>async function poll(){try{const r=await fetch("/trigger",{cache:"no-store"});'+
     'if((await r.text())==="go"){setTimeout(()=>{const el=document.createElement("div");'+
     'el.id="async-target";document.body.appendChild(el);'+
     'history.pushState({},"","/route-next");},850);return}}catch(e){}'+
     'setTimeout(poll,120)}poll()</script>'+
     '</body></html>');
 });
 await new Promise<void>((resolve,reject)=>{main.once('error',reject);main.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise<void>(resolve=>main.close(()=>resolve())));
 const address=main.address();
 if(!address||typeof address==='string')throw Error('NO_MAIN_PAGE');
 const site='http://127.0.0.1:'+address.port+'/';
 const port=await availablePort();
 const cfg={executablePath:chrome!,userDataDir:join(root,'profile'),
   remoteDebuggingPort:port,bindAddress:'127.0.0.1' as const};
 const prepared=await prepareApprovedIsolatedProfile(cfg,true);
 assert.equal(prepared.ok,true,JSON.stringify(prepared));
 const session=await launchApprovedIsolatedChrome(cfg,{userApproved:true,testHeadless:true});
 assert.equal(session.ok,true,JSON.stringify(session));
 if(!session.ok)return;
 stop=session.stop;
 const navigationStages:string[]=[];
 const tab=await openApprovedTarget(session,site,true,undefined,
  stage=>{if(navigationStages.length<96)navigationStages.push(stage);});
 if(!tab.ok){
  const counts:Record<string,number>={};
  for(const stage of navigationStages)counts[stage]=(counts[stage]??0)+1;
  t.diagnostic('CDP_TARGET_STAGE_COUNTS='+JSON.stringify(counts));
 }
 assert.equal(tab.ok,true,JSON.stringify(tab));
 if(!tab.ok)return;
 const notApproved=await observeApprovedDom(session,tab,site,false,['#initial']);
 assert.deepEqual(notApproved,{ok:false,code:'NOT_AUTHORIZED'});
 // Target.createTarget can register a tab before its first navigation commits.
 // Establish a genuine CDP DOM receipt before releasing the fixture's SPA timer.
 let ready=false;
 let lastObservation='NOT_STARTED';
 // On overloaded Windows runners the first CDP tab can remain mid-navigation
 // after Target.createTarget reports it. Give the real DOM receipt a bounded
 // startup window, without relaxing ownership/origin or selector assertions.
 for(let attempt=0;attempt<32;attempt++){
   const baseline=await observeApprovedDom(session,tab,site,true,['#initial']);
   lastObservation=baseline.ok
     ? 'initial-count='+baseline.selectorCounts['#initial']
     : baseline.code;
   if(baseline.ok&&baseline.selectorCounts['#initial']===1){ready=true;break;}
   await delay(150);
 }
 assert.equal(ready,true,
   'Approved top frame did not finish initial navigation; last='+lastObservation);
 signalDynamicChange=true;
 const observed=await observeApprovedDomSeries(session,tab,site,true,
   ['#initial','#async-target'],8,300);
 assert.equal(observed.ok,true,JSON.stringify(observed));
 if(!observed.ok)return;
 assert.equal(observed.userscriptVerified,false);
 assert.equal(observed.samples.length,8);
 assert.equal(observed.selectorCountChanged,true,'Must witness a delayed DOM change');
 assert.equal(observed.routeChangeDetected,true,'Must witness same-origin SPA route change');
 assert.equal(observed.samples.at(-1)?.selectorCounts['#async-target'],1);
 assert.ok(observed.samples.every(s=>s.userscriptVerified===false &&
   s.fullPageVerified===false));
 assert.ok(observed.samples.some(s=>s.summary.blindSpots.includes(
   'IFRAME_CONTENT_UNVERIFIED')));
 assert.ok(observed.samples.some(s=>s.summary.blindSpots.includes(
   'CROSS_ORIGIN_FRAME_UNVERIFIED')));
});



test('TEST-010/012/026: unverified initial navigation must not leave a newly created Chrome tab',async t=>{
 if(process.platform!=='win32'){t.skip('Requires actual Windows Chrome');return;}
 let chrome:string|undefined;
 for(const base of [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA]){
   if(!base)continue;
   const candidate=win32.join(base,'Google','Chrome','Application','chrome.exe');
   try{await access(candidate);chrome=candidate;break;}catch{/* absent */}
 }
 assert.ok(chrome,'Windows runner needs real Chrome for abandoned-tab cleanup');
 const root=await mkdtemp(join(tmpdir(),'uah-abandoned-cdp-tab-'));
 let stop=()=>{};
 let requests=0;
 const fixture=createServer((req,res)=>{
   if(req.url!=='/stalled'){res.writeHead(404);res.end();return;}
   requests++;
   // Never send response headers. The site is NOT an approved loaded page.
   // Cleanup must not replay this potentially side-effectful user URL.
 });
 await new Promise<void>((resolve,reject)=>{
   fixture.once('error',reject);fixture.listen(0,'127.0.0.1',resolve);
 });
 t.after(async()=>{
   stop();
   fixture.closeAllConnections();
   await new Promise<void>(resolve=>fixture.close(()=>resolve()));
   await delay(350);
   await rm(root,{recursive:true,force:true}).catch(()=>undefined);
 });
 const addr=fixture.address();
 if(!addr||typeof addr==='string')throw Error('NO_STALLED_FIXTURE');
 const site='http://127.0.0.1:'+addr.port+'/stalled';
 const cfg={executablePath:chrome!,userDataDir:join(root,'profile'),
   remoteDebuggingPort:await availablePort(),bindAddress:'127.0.0.1' as const};
 assert.equal((await prepareApprovedIsolatedProfile(cfg,true)).ok,true);
 const session=await launchApprovedIsolatedChrome(cfg,{userApproved:true,testHeadless:true});
 assert.equal(session.ok,true,JSON.stringify(session));
 if(!session.ok)return;
 stop=session.stop;
 // Record real page target IDs before the newly authorized tab exists.
 // The test asserts no NEW tab remains, regardless of /json/list URL text.
 const pageIds=async():Promise<Set<string>>=>{
   const response=await fetch('http://127.0.0.1:'+cfg.remoteDebuggingPort+'/json/list',{
     redirect:'error',signal:AbortSignal.timeout(1500)});
   const json=await readBoundedCdpJson(response);
   assert.ok(Array.isArray(json),'owned Chrome target-list must be readable');
   const ids=new Set<string>();
   for(const raw of json){
     if(raw&&typeof raw==='object'&&!Array.isArray(raw)&&raw.type==='page'&&
        typeof raw.id==='string')ids.add(raw.id);
   }
   return ids;
 };
 const before=await pageIds();
 const stages:string[]=[];
 const target=await openApprovedTarget(session,site,true,undefined,
   stage=>{if(stages.length<100)stages.push(stage);});
 t.diagnostic('STALLED_TAB_STAGE_COUNTS='+JSON.stringify(
   stages.reduce<Record<string,number>>((counts,stage)=>{
     counts[stage]=(counts[stage]??0)+1;return counts;
   },{})));
 assert.deepEqual(target,{ok:false,code:'TARGET_NOT_CONFIRMED'},
   'A stalled first navigation must stay unverified');
 assert.ok(stages.includes('TAB_CREATED'));
 assert.equal(requests,1,'A failed confirmation must NEVER reload the approved URL');
 const after=await pageIds();
 assert.deepEqual([...after].filter(id=>!before.has(id)),[],
   'The specific newly created but unverified browser tab must be closed');
});
