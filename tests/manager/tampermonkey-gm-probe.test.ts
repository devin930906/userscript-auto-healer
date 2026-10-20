import {test} from 'node:test';
import {request} from 'node:http';
import {createConnection} from 'node:net';
import {runInNewContext} from 'node:vm';
import {strict as assert} from 'node:assert';
import {startIsolatedTampermonkeyGmProbe} from '../../src/manager/tampermonkey-gm-probe';

test('TEST-017: explicit consent and bounded lifetime required before binding probe',async()=>{
 assert.deepEqual(await startIsolatedTampermonkeyGmProbe(false),
   {ok:false,code:'NOT_AUTHORIZED'});
 for(const invalid of [-1,0,999,300001,Infinity,1.5]){
   assert.deepEqual(await startIsolatedTampermonkeyGmProbe(true,invalid),
     {ok:false,code:'INVALID_OPTIONS'});
 }
});
test('TEST-017: only supported GM injection timing values can be requested',async()=>{
 for(const invalid of ['document-end;unsafe','document-start;unsafe','',null,17]){
   assert.deepEqual(await startIsolatedTampermonkeyGmProbe(
     true,30000,invalid as 'document-start'),{ok:false,code:'INVALID_OPTIONS'});
 }
});
test('TEST-017: separate temporary sessions never reuse a Tampermonkey userscript identity',async t=>{
 const first=await startIsolatedTampermonkeyGmProbe(true,30000);
 assert.equal(first.ok,true);
 if(!first.ok)return;
 t.after(()=>first.session.stop());
 const second=await startIsolatedTampermonkeyGmProbe(true,30000);
 assert.equal(second.ok,true);
 if(!second.ok)return;
 t.after(()=>second.session.stop());
 const identity=(text:string)=>{
  const meta=text.split('// ==/UserScript==')[0];
  const name=/^\/\/ @name (.+)$/m.exec(meta)?.[1];
  const namespace=/^\/\/ @namespace (.+)$/m.exec(meta)?.[1];
  assert.match(name??'',/^UAH Isolated GM Diagnostic [0-9a-f]{8}$/);
  assert.match(namespace??'',/^uah-isolated-gm-probe\.[0-9a-f]{32}$/);
  return {name,namespace};
 };
 const a=identity(first.session.source),b=identity(second.session.source);
 assert.notEqual(a.name,b.name);
 assert.notEqual(a.namespace,b.namespace);
 assert.equal(first.session.source.includes('// @grant GM_getValue'),true);
 assert.equal(second.session.source.includes('// @grant GM_getValue'),true);
 for(const session of [first.session,second.session]){
  const token=session.source.match(/token:"([0-9a-f]{64})"/)?.[1];
  assert.ok(token);
  const meta=session.source.split('// ==/UserScript==')[0];
  assert.equal(meta.includes(token),false,'capability must not be published in manager identity');
  const downloaded=await fetch(session.installUrl);
  assert.equal(downloaded.status,200);
  assert.equal(await downloaded.text(),session.source);
 }
});
test('TEST-017: document-body and document-end accept each explicit run-at and defer DOM when parsing',async t=>{
 for(const runAt of ['document-body','document-end'] as const){
  const result=await startIsolatedTampermonkeyGmProbe(true,30000,runAt);
  assert.equal(result.ok,true);
  if(!result.ok)continue;
  const probe=result.session;
  t.after(()=>probe.stop());
  assert.equal(probe.runAt,runAt);
  assert.equal(probe.source.split('\n').includes('// @run-at '+runAt),true);
  let onReady:(()=>void)|undefined;
  const count={gm:0,query:0,report:0};
  runInNewContext(probe.source,{
   Date:class extends Date{static now(){return probe.expiresAt-1000;}},URL,
   location:{origin:probe.origin,href:probe.origin+'/?mode=broken'},
   document:{readyState:'loading',
    addEventListener:(event:string,handler:()=>void)=>{
     assert.equal(event,'DOMContentLoaded');onReady=handler;
    },
    querySelector:()=>{count.query++;return null;}
   },
   GM_getValue:(_key:string,fallback:string)=>{count.gm++;return fallback;},
   fetch:()=>{count.report++;return Promise.resolve();}
  });
  assert.deepEqual(count,{gm:1,query:0,report:0},runAt);
  assert.equal(typeof onReady,'function');
  onReady?.();
  assert.deepEqual(count,{gm:1,query:1,report:1},runAt);
 }
});
test('TEST-017: document-start invokes GM at injection and defers DOM until ready',async t=>{
 const started=await startIsolatedTampermonkeyGmProbe(true,30000,'document-start');
 assert.equal(started.ok,true);
 if(!started.ok)return;
 const probe=started.session;
 t.after(()=>probe.stop());
 assert.equal(probe.runAt,'document-start');
 assert.match(probe.source,/\/\/ @run-at document-start/);
 assert.doesNotMatch(probe.source,/\/\/ @run-at document-idle/);
 let now=probe.expiresAt-1000;
 let handler:(()=>void)|undefined;
 const effects={gm:0,queries:0,actions:0,reports:0};
 const document={
   readyState:'loading',
   addEventListener:(type:string,callback:()=>void,options:{once:boolean})=>{
     assert.equal(type,'DOMContentLoaded');
     assert.equal(options.once,true);
     handler=callback;
   },
   querySelector:()=>{effects.queries++;return {setAttribute:()=>effects.actions++,getAttribute:()=> 'done'};}
 };
 const clock=class extends Date{static now(){return now;}};
 runInNewContext(probe.source,{
   Date:clock,URL,document,
   location:{origin:probe.origin,href:probe.origin+'/?mode=fixed'},
   GM_getValue:(_key:string,fallback:string)=>{effects.gm++;return fallback;},
   fetch:()=>{effects.reports++;return Promise.resolve();}
 });
 assert.deepEqual(effects,{gm:1,queries:0,actions:0,reports:0});
 assert.equal(typeof handler,'function');
 handler?.();
 assert.deepEqual(effects,{gm:1,queries:1,actions:1,reports:1});
 // A late DOM-ready event must not revive an expired consent window.
 now=probe.expiresAt+1;
 handler?.();
 assert.deepEqual(effects,{gm:1,queries:1,actions:1,reports:1});
});
test('TEST-017: document-start expired while parsing never mutates DOM or reports',async t=>{
 const started=await startIsolatedTampermonkeyGmProbe(true,30000,'document-start');
 assert.equal(started.ok,true);
 if(!started.ok)return;
 t.after(()=>started.session.stop());
 let clockNow=started.session.expiresAt-1;
 let handler:(()=>void)|undefined;
 const effects={gm:0,query:0,report:0};
 runInNewContext(started.session.source,{
  Date:class extends Date{static now(){return clockNow;}},URL,
  location:{origin:started.session.origin,href:started.session.origin+'/?mode=fixed'},
  document:{
    readyState:'loading',
    addEventListener:(_name:string,fn:()=>void)=>{handler=fn;},
    querySelector:()=>{effects.query++;return null;}
  },
  GM_getValue:(_key:string,fallback:string)=>{effects.gm++;return fallback;},
  fetch:()=>{effects.report++;return Promise.resolve();}
 });
 assert.equal(effects.gm,1);
 clockNow=started.session.expiresAt;
 handler?.();
 assert.deepEqual(effects,{gm:1,query:0,report:0});
});
test('TEST-018: fixed-mode action must be read back, not inferred from selector existence',async t=>{
 const started=await startIsolatedTampermonkeyGmProbe(true,30000);
 assert.equal(started.ok,true);
 if(!started.ok)return;
 const probe=started.session;
 t.after(()=>probe.stop());
 const outcomes:boolean[]=[];
 for(const persists of [false,true]){
   let actualAttribute:string|undefined;
   runInNewContext(probe.source,{
     Date:class extends Date{static now(){return probe.expiresAt-1000;}},URL,
     location:{origin:probe.origin,href:probe.origin+'/?mode=fixed'},
     document:{readyState:'complete',querySelector:()=>({
       setAttribute:(_name:string,value:string)=>{
         if(persists)actualAttribute=value;
       },
       getAttribute:(_name:string)=>actualAttribute
     })},
     GM_getValue:(_key:string,fallback:string)=>fallback,
     fetch:(_url:string,options:{body:string})=>{
       const report=JSON.parse(options.body) as {businessAction:boolean};
       outcomes.push(report.businessAction);
       return Promise.resolve();
     }
   });
 }
 // A DOM element can exist while an action has not actually taken effect.
 // Even a matching self-report must NEVER be treated as manager attestation.
 assert.deepEqual(outcomes,[false,true]);
});

test('TEST-017/018 stage: isolated local probe generates explicit GM userscript but no verified claims',async t=>{
 const started=await startIsolatedTampermonkeyGmProbe(true,30000);
 assert.equal(started.ok,true);
 if(!started.ok)return;
 const probe=started.session;
 t.after(()=>probe.stop());
 assert.match(probe.origin,/^http:\/\/127\.0\.0\.1:\d+$/);
 assert.match(probe.source,/\/\/ @grant GM_getValue/);
 assert.match(probe.source,/\/\/ @run-at document-idle/);
 assert.match(probe.source,/\/\/ @noframes/);
 assert.match(probe.source,/\/\/ @match http:\/\/127\.0\.0\.1\/\*/);
 assert.ok(probe.source.includes('location.origin!=='+JSON.stringify(probe.origin)));
 assert.match(probe.source,/#obsolete-target/);
 assert.match(probe.source,/#current-target/);
 assert.ok(!probe.source.includes('https://'));
 const initial=probe.receiptSnapshot();
 assert.deepEqual(initial,{});
 for(const mode of ['broken','fixed'] as const){
   const response=await fetch(probe.origin+'/?mode='+mode);
   assert.equal(response.status,200);
   const page=await response.text();
   assert.match(page,/id="current-target"/);
   assert.doesNotMatch(page,/@grant|GM_getValue|<script/);
 }
 const wrongRoute=await fetch(probe.origin+'/unrelated');
 assert.equal(wrongRoute.status,404);
});
test('TEST-018 stage: untrusted posted receipts never become manager/GM/business VERIFIED',async t=>{
 const started=await startIsolatedTampermonkeyGmProbe(true,30000);
 assert.equal(started.ok,true);
 if(!started.ok)return;
 const probe=started.session;
 t.after(()=>probe.stop());
 const token=probe.source.match(/token:"([0-9a-f]{64})"/)?.[1];
 assert.ok(token,'script source embeds a cryptographically random single-run token');
 const send=(payload:unknown,headers:Record<string,string>={'Content-Type':'application/json'})=>
   fetch(probe.origin+'/receipt',{method:'POST',headers,body:JSON.stringify(payload)});
 assert.equal((await send({token:'wrong',mode:'fixed',
   gmDefaultMatched:true,businessAction:true})).status,403);
 assert.deepEqual(probe.receiptSnapshot(),{});
 // A browser's cross-origin Origin must not submit a purported fixture receipt.
 assert.equal((await send({token,mode:'fixed',
   gmDefaultMatched:true,businessAction:true},{
   'Content-Type':'application/json','Origin':'http://unrelated.invalid'})).status,403);
 assert.deepEqual(probe.receiptSnapshot(),{});
 // Reject an HTTP absolute-form request target even if Host is local. URL()
 // otherwise uses the supplied external origin instead of the local base.
 const absoluteTargetStatus=await new Promise<number>((resolve,reject)=>{
   const req=request(probe.origin,{method:'POST',
     path:'http://unrelated.invalid/receipt',
     headers:{'Content-Type':'application/json'}},response=>{
     response.resume();response.on('end',()=>resolve(response.statusCode??0));
   });
   req.on('error',reject);
   req.end(JSON.stringify({token,mode:'fixed',
     gmDefaultMatched:true,businessAction:true}));
 });
 assert.equal(absoluteTargetStatus,400);
 assert.deepEqual(probe.receiptSnapshot(),{});
 assert.equal((await send({token,mode:'fixed',
   gmDefaultMatched:'true',businessAction:true})).status,403);
 assert.equal((await send({token,mode:'fixed',
   gmDefaultMatched:true,businessAction:true,extensionVerified:true})).status,403);
 assert.equal((await send({token,mode:'fixed',
   gmDefaultMatched:true,businessAction:true},{'Content-Type':'text/plain'})).status,415);
 assert.equal((await send({token,mode:'broken',
   gmDefaultMatched:true,businessAction:false})).status,204);
 assert.equal((await send({token,mode:'fixed',
   gmDefaultMatched:true,businessAction:true})).status,204);
 // The same mode's later conflicting report must never overwrite the first.
 assert.equal((await send({token,mode:'fixed',
   gmDefaultMatched:false,businessAction:false})).status,409);
 assert.equal((await send({token,mode:'broken',
   gmDefaultMatched:false,businessAction:true})).status,409);
 const receipts=probe.receiptSnapshot();
 assert.equal(receipts.broken?.status,'SELF_REPORTED_FIXTURE_ONLY');
 assert.equal(receipts.broken?.reportedBusinessAction,false);
 assert.equal(receipts.fixed?.reportedBusinessAction,true);
 assert.equal(receipts.fixed?.reportedGmDefaultMatched,true);
 for(const mode of ['broken','fixed'] as const){
   assert.equal(receipts[mode]?.extensionAuthenticityVerified,false);
   assert.equal(receipts[mode]?.scriptInstallationVerified,false);
   assert.equal(receipts[mode]?.gmApiVerified,false);
   assert.equal(receipts[mode]?.businessVerified,false);
 }
});
test('TEST-017 stage: stopped isolated probe closes its listener',async()=>{
 const result=await startIsolatedTampermonkeyGmProbe(true,30000);
 assert.equal(result.ok,true);
 if(!result.ok)return;
 const url=result.session.origin;
 await result.session.stop();
 await result.session.stop();
 await assert.rejects(fetch(url+'/'));
});

test('TEST-017: automatic expiry closes stalled loopback HTTP connections',async()=>{
 const result=await startIsolatedTampermonkeyGmProbe(true,1000);
 assert.equal(result.ok,true);
 if(!result.ok)return;
 const probe=result.session;
 const port=Number(new URL(probe.origin).port);
 const socket=createConnection({host:'127.0.0.1',port});
 // A forced server close may reset the client rather than gracefully end it.
 socket.on('error',()=>{});
 try{
   await new Promise<void>((resolve,reject)=>{
     socket.once('connect',resolve);
     socket.once('error',reject);
   });
   const closed=new Promise<void>((resolve,reject)=>{
     const timeout=setTimeout(()=>reject(new Error('EXPIRED_SOCKET_REMAINED_OPEN')),6000);
     socket.once('close',()=>{clearTimeout(timeout);resolve();});
   });
   // The HTTP parser has received complete headers but NOT the claimed body.
   // A plain server.close() can leave this live request open after the TTL.
   socket.write('POST /receipt HTTP/1.1\r\nHost: 127.0.0.1:'+port+
     '\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{');
   await new Promise(resolve=>setTimeout(resolve,100));
   await closed;
   await Promise.all([probe.stop(),probe.stop()]);
   await assert.rejects(fetch(probe.origin+'/'));
   assert.deepEqual(probe.receiptSnapshot(),{});
 }finally{
   socket.destroy();
   await probe.stop();
 }
});

test('TEST-017: non-canonical route aliases cannot serve the consented fixture',async t=>{
 const started=await startIsolatedTampermonkeyGmProbe(true,30000);
 assert.equal(started.ok,true);
 if(!started.ok)return;
 const probe=started.session;
 t.after(()=>probe.stop());
 const query=new URL(probe.installUrl).search;
 const rawGet=(path:string)=>new Promise<number>((resolve,reject)=>{
   // Node's HTTP request path is left raw; fetch()/URL would normalize it.
   const req=request(probe.origin,{method:'GET',path},response=>{
     response.resume();
     response.on('end',()=>resolve(response.statusCode??0));
   });
   req.on('error',reject);
   req.end();
 });
 for(const path of [
   '/unrelated/../install.user.js'+query,
   '/unrelated/%2e%2e/install.user.js'+query,
   '/./install.user.js'+query,
   '/unrelated/../?mode=broken'
 ]){
   assert.equal(await rawGet(path),400,path);
 }
 // Exact canonical routes must remain available to the explicit tester.
 assert.equal(await rawGet('/install.user.js'+query),200);
 assert.equal(await rawGet('/?mode=broken'),200);
 assert.deepEqual(probe.receiptSnapshot(),{});
});

test('TEST-017: disposable import URL serves only the authorized, expiring userscript source',async t=>{
 const started=await startIsolatedTampermonkeyGmProbe(true,30000);
 assert.equal(started.ok,true);
 if(!started.ok)return;
 const probe=started.session;
 t.after(()=>probe.stop());
 const url=new URL(probe.installUrl);
 const trustedOrigin='chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo';
 assert.equal(url.origin,probe.origin);
 assert.equal(url.pathname,'/install.user.js');
 assert.match(url.search,/^\?key=[0-9a-f]{64}$/);
 assert.notEqual(url.searchParams.get('key'),probe.source.match(/token:"([0-9a-f]{64})"/)?.[1]);
 assert.deepEqual(probe.receiptSnapshot(),{});

 const native=await fetch(probe.installUrl);
 assert.equal(native.status,200);
 assert.match(native.headers.get('content-type')??'',/text\/javascript/);
 assert.equal(native.headers.get('access-control-allow-origin'),null);
 assert.equal(await native.text(),probe.source);

 const manager=await fetch(probe.installUrl,{headers:{Origin:trustedOrigin}});
 assert.equal(manager.status,200);
 assert.equal(manager.headers.get('access-control-allow-origin'),trustedOrigin);
 assert.equal(await manager.text(),probe.source);

 const forbidden=[
   probe.origin+'/install.user.js',
   probe.origin+'/install.user.js?key=bad',
   probe.installUrl+'&extra=true',
   probe.origin+'/install.user.js?key='+url.searchParams.get('key')?.toUpperCase()
 ];
 for(const input of forbidden){
   const response=await fetch(input);
   assert.equal(response.status,403);
   assert.doesNotMatch(await response.text(),/@grant|GM_getValue/);
 }
 for(const options of [
   {method:'POST',headers:{'Content-Type':'text/plain'},body:'test'},
   {method:'HEAD'}
 ]){
   assert.equal((await fetch(probe.installUrl,options)).status,403);
 }
 const foreign=await fetch(probe.installUrl,{headers:{Origin:'https://example.com'}});
 assert.equal(foreign.status,403);
 assert.equal(foreign.headers.get('access-control-allow-origin'),null);
 // Neither downloading the script nor a forged cross-origin request is a
 // Chrome extension installation, GM execution, or business recovery.
 assert.deepEqual(probe.receiptSnapshot(),{});
 await probe.stop();
 await assert.rejects(fetch(probe.installUrl));
});


test('TEST-017: installed temporary fixture stops all DOM/GM/network effects after authorization expires',async t=>{
 const started=await startIsolatedTampermonkeyGmProbe(true,30000);
 assert.equal(started.ok,true);
 if(!started.ok)return;
 const probe=started.session;
 t.after(()=>probe.stop());
 const execute=(now:number)=>{
   const effects={queries:0,attributes:0,gmCalls:0,network:0};
   const target={setAttribute:()=>{effects.attributes++;},getAttribute:()=> 'done'};
   const clock=class extends Date {static now(){return now;}};
   runInNewContext(probe.source,{
     Date:clock,URL,
     location:{origin:probe.origin,href:probe.origin+'/?mode=fixed'},
     document:{querySelector:()=>{effects.queries++;return target;}},
     GM_getValue:(_key:string,fallback:string)=>{effects.gmCalls++;return fallback;},
     fetch:()=>{effects.network++;return Promise.resolve();}
   });
   return effects;
 };
 // The live window remains a permitted disposable diagnostic fixture only,
 // NOT independently verified Tampermonkey or production acceptance.
 assert.deepEqual(execute(probe.expiresAt-1),{
   queries:1,attributes:1,gmCalls:1,network:1
 });
 // An already-installed script can survive its short-lived HTTP service.
 // Reusing that loopback port later must not resurrect its actions.
 for(const time of [probe.expiresAt,probe.expiresAt+1000]){
   assert.deepEqual(execute(time),{
     queries:0,attributes:0,gmCalls:0,network:0
   });
 }
});


test('TEST-017: mid-run consent expiry prevents later GM fixture side effects',async t=>{
 const started=await startIsolatedTampermonkeyGmProbe(true,30000);
 assert.equal(started.ok,true);
 if(!started.ok)return;
 const probe=started.session;
 t.after(()=>probe.stop());
 for(const expiresDuring of ['gm','query','attribute'] as const){
   let now=probe.expiresAt-1;
   const effects={gm:0,query:0,attribute:0,network:0};
   const clock=class extends Date {static now(){return now;}};
   runInNewContext(probe.source,{
     Date:clock,URL,
     location:{origin:probe.origin,href:probe.origin+'/?mode=fixed'},
     GM_getValue:(_key:string,defaultValue:string)=>{
       effects.gm++;
       if(expiresDuring==='gm')now=probe.expiresAt;
       return defaultValue;
     },
     document:{querySelector:()=>{
       effects.query++;
       if(expiresDuring==='query')now=probe.expiresAt;
       return {setAttribute:()=>{
         effects.attribute++;
         if(expiresDuring==='attribute')now=probe.expiresAt;
       }};
     }},
     fetch:()=>{effects.network++;return Promise.resolve();}
   });
   assert.deepEqual(effects,{
     gm:1,
     query:expiresDuring==='gm'?0:1,
     attribute:expiresDuring==='attribute'?1:0,
     network:0
   },'Expired fixture must not advance to another side effect after '+expiresDuring);
 }
});

test('TEST-017/026: interrupted HTTP receipt does not terminate fixture or record partial evidence',async t=>{
 const started=await startIsolatedTampermonkeyGmProbe(true,30000);
 assert.equal(started.ok,true);
 if(!started.ok)return;
 const probe=started.session;
 t.after(()=>probe.stop());
 const port=Number(new URL(probe.origin).port);
 const socket=createConnection({host:'127.0.0.1',port});
 socket.on('error',()=>{}); // Client may observe reset when it aborts.
 try{
   await new Promise<void>((resolve,reject)=>{
     socket.once('connect',resolve);
     socket.once('error',reject);
   });
   // A complete HTTP header but deliberately incomplete JSON and body.
   socket.write('POST /receipt HTTP/1.1\r\nHost: 127.0.0.1:'+port+
     '\r\nContent-Type: application/json\r\nContent-Length: 512\r\n\r\n'+
     '{"token":"incomplete');
   // Give the receiver a chance to attach request stream listeners.
   await new Promise(resolve=>setTimeout(resolve,50));
   const closed=new Promise<void>(resolve=>socket.once('close',()=>resolve()));
   socket.destroy();
   await closed;

   assert.deepEqual(probe.receiptSnapshot(),{});
   const page=await fetch(probe.origin+'/?mode=broken');
   assert.equal(page.status,200);
   assert.match(await page.text(),/id="current-target"/);
   // A subsequent *complete* POST remains usable, but still never authenticates
   // the extension, script installation, GM API or business outcome.
   const token=probe.source.match(/token:"([0-9a-f]{64})"/)?.[1];
   assert.ok(token);
   const reply=await fetch(probe.origin+'/receipt',{
     method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({token,mode:'broken',
       gmDefaultMatched:false,businessAction:false})
   });
   assert.equal(reply.status,204);
   assert.equal(probe.receiptSnapshot().broken?.status,'SELF_REPORTED_FIXTURE_ONLY');
   assert.equal(probe.receiptSnapshot().broken?.gmApiVerified,false);
 }finally{
   socket.destroy();
 }
});

test('TEST-017/018: fixture rejects noncanonical route and delayed route drift',async t=>{
 const started=await startIsolatedTampermonkeyGmProbe(true,30000,'document-start');
 assert.equal(started.ok,true);
 if(!started.ok)return;
 const probe=started.session;
 t.after(()=>probe.stop());
 const clock=class extends Date {static now(){return probe.expiresAt-1000;}};
 for(const href of [
   probe.origin+'/other?mode=fixed',
   probe.origin+'/?mode=fixed&extra=1',
   probe.origin+'/?mode=fixed#not-the-approved-route'
 ]){
   const effects={gm:0,query:0,action:0,report:0};
   runInNewContext(probe.source,{
     Date:clock,URL,location:{origin:probe.origin,href},
     document:{readyState:'complete',querySelector:()=>{
       effects.query++;return {setAttribute:()=>{effects.action++;},getAttribute:()=> 'done'};
     }},
     GM_getValue:(_key:string,fallback:string)=>{effects.gm++;return fallback;},
     fetch:()=>{effects.report++;return Promise.resolve();}
   });
   assert.deepEqual(effects,{gm:0,query:0,action:0,report:0},href);
 }
 const location={origin:probe.origin,href:probe.origin+'/?mode=fixed'};
 let ready:(()=>void)|undefined;
 const delayed={gm:0,query:0,action:0,report:0};
 runInNewContext(probe.source,{
   Date:clock,URL,location,
   document:{readyState:'loading',addEventListener:(_name:string,fn:()=>void)=>{ready=fn;},
     querySelector:()=>{delayed.query++;return {setAttribute:()=>{delayed.action++;},getAttribute:()=> 'done'};}},
   GM_getValue:(_key:string,fallback:string)=>{delayed.gm++;return fallback;},
   fetch:()=>{delayed.report++;return Promise.resolve();}
 });
 assert.equal(delayed.gm,1);
 location.href=probe.origin+'/?mode=broken';
 ready?.();
 assert.deepEqual(delayed,{gm:1,query:0,action:0,report:0},
   'An existing delayed callback must not report or mutate a different test mode');
 const during={gm:0,query:0,action:0,report:0};
 location.href=probe.origin+'/?mode=fixed';
 runInNewContext(probe.source,{
   Date:clock,URL,location,
   document:{readyState:'complete',querySelector:()=>{
     during.query++;
     location.href=probe.origin+'/other?mode=fixed';
     return {setAttribute:()=>{during.action++;},getAttribute:()=> 'done'};
   }},
   GM_getValue:(_key:string,fallback:string)=>{during.gm++;return fallback;},
   fetch:()=>{during.report++;return Promise.resolve();}
 });
 assert.deepEqual(during,{gm:1,query:1,action:0,report:0},
   'A route change during DOM lookup must not mutate the stale target');
 const afterSet={gm:0,query:0,action:0,read:0,report:0};
 location.href=probe.origin+'/?mode=fixed';
 runInNewContext(probe.source,{
   Date:clock,URL,location,
   document:{readyState:'complete',querySelector:()=>{
     afterSet.query++;
     return {setAttribute:()=>{
       afterSet.action++;location.href=probe.origin+'/?mode=broken';
     },getAttribute:()=>{afterSet.read++;return 'done';}};
   }},
   GM_getValue:(_key:string,fallback:string)=>{afterSet.gm++;return fallback;},
   fetch:()=>{afterSet.report++;return Promise.resolve();}
 });
 assert.deepEqual(afterSet,{gm:1,query:1,action:1,read:0,report:0},
   'A route change during DOM action must not yield a stale success report');
});
