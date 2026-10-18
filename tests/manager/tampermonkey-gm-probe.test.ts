import {test} from 'node:test';
import {request} from 'node:http';
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
