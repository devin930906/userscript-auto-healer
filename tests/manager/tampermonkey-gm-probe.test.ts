import {test} from 'node:test';
import {request} from 'node:http';
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
   const target={setAttribute:()=>{effects.attributes++;}};
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
