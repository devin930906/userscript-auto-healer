/**
 * TASK-007 / TEST-017/018: independent cloud experiment with the official
 * vendor-hosted Tampermonkey MV3 package and disposable Chromium profile.
 * No access to the user's Chrome Profile, scripts, accounts or websites.
 * A successful fixture would only prove a synthetic GM/selector run, NOT
 * that Userscript Auto Healer has automatically repaired a script.
 */
'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {createHash}=require('node:crypto');
const dir=process.env.UAH_TM_EXTENSION_DIR;
const profile=process.env.UAH_TM_PROFILE_DIR;
if(!dir||!profile||!path.isAbsolute(dir)||!path.isAbsolute(profile))
  throw Error('Missing disposable test directories');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
assert.equal(manifest.manifest_version,3,'Official current Tampermonkey must be MV3');
assert.ok(/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version),'Unknown manager version');
const EXPECTED_ID='dhdgffkkebhmkfjojejmpbldmpobfkfo';
const RUN_AT_MODES=Object.freeze([
 'document-start','document-body','document-end','document-idle'
]);
const runAt=process.env.UAH_TM_RUN_AT;
const variant=process.env.UAH_TM_VARIANT;
assert.ok(['baseline','product-original','product-candidate','native-gm'].includes(variant),
  'Unreviewed fixture variant is forbidden');
// The reviewed AST original/candidate pair is tested in both idle and
// document-start modes: the latter proves that a real manager can execute
// the EXACT product-generated replacement after the target is created.
// The product's native GM diagnostic is independently tested in all four.
if(variant==='product-original'||variant==='product-candidate')
  assert.ok(['document-start','document-idle'].includes(runAt),
    'AST product cases must use reviewed matrix injection modes');
assert.ok(RUN_AT_MODES.includes(runAt),
  'A documented Tampermonkey @run-at mode must be supplied by the isolated CI matrix');
let reviewedCandidateForExport=null;
let source=[
 '// ==UserScript==',
 '// @name UAH disposable Tampermonkey CI fixture '+runAt,
 '// @namespace https://userscript-auto-healer.invalid/',
 '// @version 0.0.1',
 '// @match https://example.com/*',
 '// @grant GM_getValue',
 '// @grant GM_setValue',
 '// @run-at '+runAt,
 // Match the production disposable GM probe's explicit top-frame-only scope.
 '// @noframes',
 '// ==/UserScript==',
 'const injectedReadyState=document.readyState;',
 'let gmDefault=false;let gmRoundtrip=false;',
 'try { gmDefault=typeof GM_getValue==="function"&&',
 'GM_getValue("__uah_ci_missing_key__","ci-default")==="ci-default";',
 ' if(gmDefault&&typeof GM_setValue==="function"){',
 '  GM_setValue("__uah_ci_storage_roundtrip__","ci-write-readback");',
 '  gmRoundtrip=GM_getValue("__uah_ci_storage_roundtrip__","not-written")==="ci-write-readback";',
 ' }',
 ' }catch(e){}',
 'const gm=gmDefault&&gmRoundtrip;',
 'const report=()=>{',
 ' if(!document.documentElement)throw Error("Missing fixture root");',
 ' document.documentElement.dataset.uahCiInjected="yes";',
 ' document.documentElement.dataset.uahCiRunAt='+JSON.stringify(runAt)+';',
 ' document.documentElement.dataset.uahCiInjectionReadyState=injectedReadyState;',
 ' document.documentElement.dataset.uahCiGm=String(gm);',
 ' document.documentElement.dataset.uahCiGmDefault=String(gmDefault);',
 ' document.documentElement.dataset.uahCiGmRoundtrip=String(gmRoundtrip);',
 ' const anchor=document.querySelector("#uah-ci-target");',
 ' if(anchor&&gm)anchor.setAttribute("data-uah-ci-action","done");',
 ' document.documentElement.dataset.uahCiBusiness=anchor&&gm?"recovered":"missing-target";',
 '};',
 // For document-start/body, the root/fixture target can be unavailable until load.
 // Never report a business result before the real test page finishes loading.
 'if(document.readyState==="complete")report();',
 'else window.addEventListener("load",report,{once:true});'
].join('\n');
// Only a disposable selector source is ever handed to the application's
// existing AST planner. Neither the real user's scripts nor site data are read.
if(variant==='product-original'||variant==='product-candidate'){
  const original=source.replace(
    'document.querySelector("#uah-ci-target")',
    'document.querySelector("#uah-ci-stale-target")');
  assert.notEqual(original,source,'Original fixture must contain exactly one selector');
  const {analyzeSelectors}=require('../dist/src/analyze/selector-analyzer.js');
  const {proposeLiteralSelectorPatch,auditProposedLiteralSelectorPatch}=
    require('../dist/src/repair/patch-planner.js');
  const ast=analyzeSelectors(original);
  assert.equal(ast.status,'OK','Application AST analyzer must parse the original');
  const sites=ast.sites.filter(site=>site.method==='querySelector'&&
    site.selector==='#uah-ci-stale-target'&&site.kind==='literal');
  assert.equal(sites.length,1,'Exactly one unambiguous AST site is required');
  const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');
  const request={
    source:original,expectedSourceSha256:sha(original),callOffset:sites[0].offset,
    method:'querySelector',originalSelector:'#uah-ci-stale-target',
    replacementSelector:'#uah-ci-target',faultEvidenceId:'disposable-selector-fixture'
  };
  const proposal=proposeLiteralSelectorPatch(request);
  assert.equal(proposal.status,'CANDIDATE_ONLY',
    'Native application must produce an AST-bound review-only patch');
  const audit=auditProposedLiteralSelectorPatch(request,proposal);
  assert.equal(audit.status,'REVIEWABLE_ONLY',
    'Native application must independently audit its candidate');
  assert.equal(proposal.automaticPatchAllowed,false,
    'The offline proposal grants no automatic application permission');
  assert.equal(proposal.candidateSource,source,
    'No unrelated source or metadata edits are allowed');
  console.log('APPLICATION_GENERATED_CANDIDATE_RECEIPT '+JSON.stringify({
    variant,runAt,originalSha256:sha(original),
    candidateSha256:sha(proposal.candidateSource),audit:audit.status,
    automaticPatchAllowed:proposal.automaticPatchAllowed
  }));
  if(variant==='product-candidate')reviewedCandidateForExport={original,request,proposal};
  source=variant==='product-candidate'?proposal.candidateSource:original;
}

/** TASK-012 / TEST-023: exercise the REAL native stage and manual-export
 * implementation before asking the disposable Tampermonkey to install bytes.
 * Every file is CI-created under a fresh temp root; no real user script or
 * manager profile is read or modified by the native export operation.
 */
async function prepareNativeManualExportForManager(reviewed){
 const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'uah-product-export-'));
 try{
  const sourcePath=path.join(root,'broken-original.user.js');
  const backupDirectory=path.join(root,'backups');
  const exportDirectory=path.join(root,'manual-exports');
  fs.mkdirSync(backupDirectory);
  fs.mkdirSync(exportDirectory);
  fs.writeFileSync(sourcePath,reviewed.original,{flag:'wx'});
  const opts={sourcePath,backupDirectory,exportDirectory,userApproved:true};
  const {stageReviewedCandidateOnly}=
    require('../dist/src/version/staged-candidate.js');
  const {exportReviewedCandidateForManualInstall}=
    require('../dist/src/export/manual-candidate-export.js');
  // Staging has its own three-field exact-data contract; the fourth export
  // directory is only accepted by the subsequent manual-export interface.
  const staged=await stageReviewedCandidateOnly(reviewed.request,reviewed.proposal,{
   sourcePath,backupDirectory,userApproved:true
  });
  assert.equal(staged.status,'CANDIDATE_STAGED_RUNTIME_UNVERIFIED',
    'Native candidate must have a separately verified original backup: '+JSON.stringify(staged));
  assert.equal(staged.automaticPatchAllowed,false);
  assert.equal(staged.automaticRollbackAllowed,false);
  const exported=await exportReviewedCandidateForManualInstall(
    reviewed.request,staged,opts);
  assert.equal(exported.status,'EXPORTED_RUNTIME_UNVERIFIED',
    'The actual native manual exporter must produce a reviewed .user.js: '+JSON.stringify(exported));
  assert.equal(exported.managerInstalled,false);
  assert.equal(exported.automaticPatchAllowed,false);
  assert.equal(exported.automaticRollbackAllowed,false);
  assert.equal(exported.tampermonkeyVerified,false);
  assert.equal(exported.businessVerified,false);
  const exportedPath=path.join(exportDirectory,exported.exportFileName);
  const originalRecoveryPath=path.join(exportDirectory,exported.recoveryExportFileName);
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  const candidateBytes=fs.readFileSync(exportedPath);
  const originalBytes=Buffer.from(reviewed.original,'utf8');
  assert.deepEqual(candidateBytes,Buffer.from(reviewed.proposal.candidateSource,'utf8'),
    'The actual manager-facing source must come from the native manual export');
  assert.equal(sha(candidateBytes),reviewed.proposal.candidateSha256);
  assert.deepEqual(fs.readFileSync(originalRecoveryPath),originalBytes,
    'The independent manual recovery export must retain exact original bytes');
  assert.deepEqual(fs.readFileSync(path.join(backupDirectory,staged.backupFileName)),
    originalBytes,'Native independent backup must retain the actual original');
  assert.deepEqual(fs.readFileSync(sourcePath),originalBytes,
    'Native export must not overwrite the imported original script');
  assert.equal(exported.candidateSha256,reviewed.proposal.candidateSha256);
  assert.equal(exported.byteLength,candidateBytes.byteLength);
  console.log('NATIVE_MANUAL_EXPORT_FOR_REAL_MANAGER '+JSON.stringify({
   runAt,originalSha256:sha(originalBytes),candidateSha256:sha(candidateBytes),
   recoveryExportBytes:originalBytes.byteLength,stage:staged.status,
   export:exported.status,automaticPatchAllowed:false,managerInstalled:false
  }));
  return {root,exportedPath,sourcePath,originalBytes,candidateSha256:sha(candidateBytes)};
 }catch(error){
  fs.rmSync(root,{recursive:true,force:true});
  throw error;
 }
}

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function extensionCards(context){
 const page=await context.newPage();
 try{
  await page.goto('chrome://extensions/',{waitUntil:'domcontentloaded',timeout:20000});
  await sleep(1500);
  return await page.evaluate(()=>{
   const results=[];
   function scan(root){
    for(const el of root.querySelectorAll('*')){
     if(el.tagName.toLowerCase()==='extensions-item'){
      results.push({
       id:el.id||el.data?.id||'',
       name:el.shadowRoot?.querySelector('#name')?.textContent?.trim()||
         el.data?.name||''
      });
     }
     if(el.shadowRoot)scan(el.shadowRoot);
    }
   }
   scan(document);
   return results;
  });
 }finally{await page.close();}
}
async function optIn(context,id){
 const page=await context.newPage();
 try{
  await page.goto('chrome://extensions/?id='+id,{
   waitUntil:'domcontentloaded',timeout:20000
  });
  await sleep(1200);
  return await page.evaluate(()=>{
   const results=[];
   function scan(root){
    for(const el of root.querySelectorAll('*')){
     if(el.tagName.toLowerCase()==='extensions-toggle-row'){
      const label=(el.textContent||'')+' '+(el.shadowRoot?.textContent||'');
      const toggle=el.shadowRoot?.querySelector('cr-toggle')||
        el.querySelector('cr-toggle');
      if(/allow user scripts/i.test(label)&&toggle){
       const before=Boolean(toggle.checked);
       if(!before)toggle.click();
       results.push({before,after:Boolean(toggle.checked)});
      }
     }
     if(el.shadowRoot)scan(el.shadowRoot);
    }
   }
   scan(document);
   return results;
  });
 }finally{await page.close();}
}
async function main(){
 const nativeExport=reviewedCandidateForExport
  ?await prepareNativeManualExportForManager(reviewedCandidateForExport):null;
 const server=http.createServer((req,res)=>{
  if(req.url==='/test.user.js'){
   // The product-candidate variant must install EXACT bytes created by the
   // native manual exporter, not the in-memory AST proposal. If another
   // process changes the disposable file, fail closed before returning 200.
   let bytes=source;
   if(nativeExport){
    try{
     const disk=fs.readFileSync(nativeExport.exportedPath);
     if(createHash('sha256').update(disk).digest('hex')!==
        nativeExport.candidateSha256){
      res.writeHead(409,{'Cache-Control':'no-store'});
      return res.end('DISPOSABLE_EXPORT_CHANGED');
     }
     bytes=disk;
    }catch{
     res.writeHead(409,{'Cache-Control':'no-store'});
     return res.end('DISPOSABLE_EXPORT_UNAVAILABLE');
    }
   }
   res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8',
     'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   return res.end(bytes);
  }
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  // A second, independently bound loopback port is an unauthorized origin
  // for the product GM probe, despite its intentionally broad @match host.
  // Expose the same DOM target here so an origin-guard regression is visible.
  res.end(req.url==='/?mode=fixed'
   ? '<!doctype html><html><body><div id="current-target">Wrong-port fixture</div></body></html>'
   : '<!doctype html><title>Disposable CI install</title><a href="/test.user.js" id="install">Test only</a>');
 });
 await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',resolve);
 });
 // Native variant runs the product's actual bounded, consented diagnostic
 // source. Its loopback self-reports are not manager attestation.
 let nativeProbe;
 if(variant==='native-gm'){
  const {startIsolatedTampermonkeyGmProbe}=
    require('../dist/src/manager/tampermonkey-gm-probe.js');
  const started=await startIsolatedTampermonkeyGmProbe(true,300000,runAt);
  assert.equal(started.ok,true,'Native product loopback fixture must start');
  nativeProbe=started.session;
  assert.ok(nativeProbe.source.includes('// @grant GM_getValue'));
  assert.ok(nativeProbe.source.includes('// @grant GM_setValue'));
  console.log('NATIVE_PRODUCT_FIXTURE '+JSON.stringify({
   runAt:nativeProbe.runAt,unverified:true,ttlMinutes:5
  }));
 }
 let context;
 const launch=()=>chromium.launchPersistentContext(profile,{
  channel:'chromium',headless:false,
  args:['--disable-extensions-except='+dir,'--load-extension='+dir]
 });
 try{
  context=await launch();
  console.log('TESTED_DECLARED_RUN_AT '+runAt);
  const cards=await extensionCards(context);
  const manager=cards.find(x=>/tampermonkey/i.test(x.name)&&
    !/beta|legacy/i.test(x.name));
  assert.ok(manager,'Official-hosted Tampermonkey package did not register in isolated Chromium: '+JSON.stringify(cards));
  assert.match(manager.id,/^[a-p]{32}$/);
  const id=manager.id;
  const workers=context.serviceWorkers();
  const sw=workers.find(x=>x.url().startsWith('chrome-extension://'+id+'/'))||
    await context.waitForEvent('serviceworker',{timeout:20000});
  assert.ok(sw.url().startsWith('chrome-extension://'+id+'/'),
    'Tampermonkey service worker not registered for installed runtime');
  // Unpacked extension IDs can differ from signed Chrome Web Store IDs.
  // Explicitly record this distinction; vendor download alone is not a
  // cryptographic attestation of a store-signed installation.
  console.log('ISOLATED_TAMPERMONKEY_RUNTIME '+JSON.stringify({
   managerName:manager.name,version:manifest.version,manifest:manifest.manifest_version,
   runtimeId:id,officialStoreIdMatch:id===EXPECTED_ID,chromeVersion:context.browser()?.version()
  }));
  const toggles=await optIn(context,id);
  console.log('DISPOSABLE_USER_SCRIPTS_OPT_IN '+JSON.stringify(toggles));
  await context.close();
  context=await launch();
  const installerPage=await context.newPage();
  const port=server.address().port;
  if(nativeProbe){
   await installerPage.goto(nativeProbe.origin+'/?mode=broken',{
    waitUntil:'domcontentloaded'});
  }else{
   await installerPage.goto('http://127.0.0.1:'+port+'/',{waitUntil:'domcontentloaded'});
   await installerPage.locator('#install').click();
  }
  await sleep(1800);
  // Tampermonkey MV3 may use an intermediate vendor-hosted page or a
  // browser download, especially for loopback URLs. Never promote either
  // to installed-script evidence. Try the documented direct URL next.
  const displayPages=()=>context.pages().map(p=>({
    url:p.url().replace(/([?&](?:url|token|key|aid)=)[^&]+/gi,'$1[redacted]').slice(0,220)
  }));
  console.log('POST_LINK_NAVIGATION '+JSON.stringify(displayPages()));
  if(nativeProbe||!context.pages().some(p=>p.url().startsWith('chrome-extension://'+id+'/'))){
    const direct=await context.newPage();
    try{await direct.goto(nativeProbe?.installUrl||'http://127.0.0.1:'+port+'/test.user.js',{timeout:12000});}
    catch(error){console.log('DIRECT_SCRIPT_NAVIGATION '+String(error).slice(0,130));}
    await sleep(2200);
    console.log('POST_DIRECT_NAVIGATION '+JSON.stringify(displayPages()));
  }
  let tabs=context.pages().filter(p=>p.url().startsWith('chrome-extension://'+id));
  if(!tabs.some(p=>/confirm|install/i.test(p.url()))){
    // The vendor documents "Options > Utilities > Import from URL" as
    // an alternative when automatic URL detection does not fire.
    const optionsPage=manifest.options_ui?.page||manifest.options_page;
    console.log('MANAGER_OPTIONS_ENTRY '+JSON.stringify(optionsPage||null));
    if(typeof optionsPage==='string'&&optionsPage.length<160){
      const settings=await context.newPage();
      try{
        await settings.goto('chrome-extension://'+id+'/'+optionsPage,{
          waitUntil:'domcontentloaded',timeout:15000
        });
        await sleep(1200);
        console.log('OPTIONS_UI_TEXT '+JSON.stringify(
          (await settings.locator('body').innerText()).slice(0,1500)));
      }catch(error){
        console.log('OPTIONS_PAGE_UNAVAILABLE '+String(error).slice(0,210));
      }
    }
  }
  tabs=context.pages().filter(p=>p.url().startsWith('chrome-extension://'+id));
  // Tampermonkey 5.4.x sometimes opens ask.html before the actual
  // confirmation page. It is another explicit step, not installation proof.
  const ask=tabs.find(p=>/\/ask\.html(?:\?|$)/i.test(p.url()));
  if(ask){
    const question=await ask.locator('body').innerText().catch(()=>'');
    const actions=await ask.locator('button,input[type="button"],input[type="submit"]').evaluateAll(nodes=>
      nodes.map(el=>({name:(el.innerText||el.value||'').trim().slice(0,90),id:el.id||''})));
    console.log('TAMPERMONKEY_ASK_PAGE '+JSON.stringify({
      visibleText:question.slice(0,1600),controls:actions.slice(0,18)
    }));
    const allow=actions.filter(x=>/^(allow|grant|continue|proceed|always allow)$/i.test(x.name));
    if(allow.length===1){
      const chosen=allow[0].id ? ask.locator('#'+allow[0].id):
        ask.getByRole('button',{name:allow[0].name,exact:true});
      await chosen.first().click({timeout:8000});
      await sleep(1700);
    }
  }
  tabs=context.pages().filter(p=>p.url().startsWith('chrome-extension://'+id));
  console.log('MANAGER_INSTALLATION_PAGES '+JSON.stringify(tabs.map(p=>p.url().replace(/([?&](?:url|token|key|aid)=)[^&]+/gi,'$1[redacted]'))));
  const confirmation=tabs.find(p=>/confirm|install|\/ask\.html(?:\?|$)/i.test(p.url()));
  assert.ok(confirmation,'Manager script installation confirmation did not appear');
  let clicked=false;
  for(const selector of ['#confirm','#install','#btnInstall','button:has-text("Install")','input[value="Install"]']){
   const control=confirmation.locator(selector);
   if(await control.count()&&await control.first().isVisible()){
    await control.first().click({timeout:10000});clicked=true;break;
   }
  }
  assert.equal(clicked,true,'No visible native manager Install confirmation');
  await sleep(1800);
  if(nativeProbe){
   const flags=[
    'extensionAuthenticityVerified','scriptInstallationVerified',
    'gmApiVerified','businessVerified'
   ];
   for(const mode of ['broken','fixed']){
    const page=await context.newPage();
    await page.goto(nativeProbe.origin+'/?mode='+mode,{
     waitUntil:'domcontentloaded',timeout:20000});
    const deadline=Date.now()+30000;
    let receipt;
    while(Date.now()<deadline){
     receipt=nativeProbe.receiptSnapshot()[mode];
     if(receipt)break;
     await sleep(200);
    }
    assert.ok(receipt,'Native product fixture receipt missing for '+mode);
    assert.equal(receipt.status,'SELF_REPORTED_FIXTURE_ONLY');
    assert.equal(receipt.reportedGmDefaultMatched,true,
     'Real manager did not self-report default GM_getValue');
    assert.equal(receipt.reportedGmStorageRoundtripMatched,true,
     'Real manager did not self-report GM_setValue/readback');
    assert.equal(receipt.reportedBusinessAction,mode==='fixed',
     'Real manager fixture broken/fixed state differed');
    for(const key of flags)assert.equal(receipt[key],false,
     'No trust authority from an HTTP receipt: '+key);
    const marker=await page.locator('#current-target')
     .getAttribute('data-uah-probe-action');
    assert.equal(marker,mode==='fixed'?'done':null,
     'Independent fixture DOM must match HTTP report');
    console.log('NATIVE_PRODUCT_REAL_MANAGER_UNVERIFIED '+JSON.stringify({
     mode,gmDefault:receipt.reportedGmDefaultMatched,
     gmRoundtrip:receipt.reportedGmStorageRoundtripMatched,
     reportedBusiness:receipt.reportedBusinessAction,
     domMarker:marker,gmApiVerified:false,businessVerified:false
    }));
    await page.close();
   }
   // TASK-007 / TEST-017/018: the ACTUAL product-generated @noframes
   // script must not execute inside a same-origin nested frame. Previous
   // unit/VM tests alone cannot establish real Tampermonkey injection policy.
   // Use a fresh disposable top-level fixture, not any user's website.
   const top=await context.newPage();
   try{
    await top.goto(nativeProbe.origin+'/?mode=fixed',{
     waitUntil:'domcontentloaded',timeout:20000});
    await top.locator('#current-target[data-uah-probe-action="done"]')
     .waitFor({timeout:30000});
    await top.evaluate(()=>{
     const frame=document.createElement('iframe');
     frame.id='uah-native-gm-child-frame';
     frame.src=location.origin+'/?mode=fixed';
     document.body.append(frame);
    });
    const child=top.frameLocator('#uah-native-gm-child-frame');
    await child.locator('#current-target').waitFor({timeout:20000});
    const childFrame=top.frames().find(frame=>
     frame!==top.mainFrame()&&frame.url()===nativeProbe.origin+'/?mode=fixed');
    assert.ok(childFrame,'Product GM fixture child frame not loaded');
    await childFrame.waitForLoadState('load',{timeout:20000});
    await sleep(1400);
    const childMarker=await child.locator('#current-target')
     .getAttribute('data-uah-probe-action');
    assert.equal(childMarker,null,
     'Native Tampermonkey GM fixture must never act inside matching-origin iframe');
    assert.equal(await top.locator('#current-target')
     .getAttribute('data-uah-probe-action'),'done',
     'Rejecting nested injection must not break top-level consented fixture');
    console.log('NATIVE_PRODUCT_REAL_MANAGER_NOFRAMES '+JSON.stringify({
     runAt,topLevelAction:true,childAction:false,
     managerVerifiedForStable:false,automaticPatchAllowed:false
    }));
   }finally{await top.close();}
   // TEST-017/018: Chrome match patterns cannot encode a loopback port.
   // The same live manager therefore sees this disposable *other* local port,
   // but the actual product-generated script must honor its exact consented
   // location.origin guard before any GM/DOM/report effect.
   const wrongOrigin='http://127.0.0.1:'+port;
   assert.notEqual(wrongOrigin,nativeProbe.origin,
    'Control fixture must not share the authorized GM probe origin');
   const wrongPort=await context.newPage();
   try{
    await wrongPort.goto(wrongOrigin+'/?mode=fixed',{
     waitUntil:'domcontentloaded',timeout:20000});
    await wrongPort.locator('#current-target').waitFor({timeout:20000});
    await sleep(1600);
    const wrongMarker=await wrongPort.locator('#current-target')
     .getAttribute('data-uah-probe-action');
    assert.equal(wrongMarker,null,
     'Product GM script must not act on a different loopback port');
    console.log('NATIVE_PRODUCT_REAL_MANAGER_CROSS_PORT_DENIED '+JSON.stringify({
     runAt,wrongPortAction:false,authorizedOriginUnchanged:true,
     managerVerifiedForStable:false,automaticPatchAllowed:false
    }));
   }finally{await wrongPort.close();}
   assert.deepEqual(Object.keys(nativeProbe.receiptSnapshot()).sort(),['broken','fixed']);
   console.log('NATIVE_PRODUCT_GM_DIAGNOSTIC_STAGE_PASSED: real unpacked Tampermonkey ran product-generated source; synthetic evidence only; no auto repair or store-signed identity.');
   return;
  }
  const readBusiness=async(page)=>{
    await page.waitForFunction(
      ()=>document.documentElement.dataset.uahCiInjected==='yes',{timeout:12000});
    return page.evaluate(()=>({
      injected:document.documentElement.dataset.uahCiInjected,
      runAt:document.documentElement.dataset.uahCiRunAt,
      injectionReadyState:document.documentElement.dataset.uahCiInjectionReadyState,
      gm:document.documentElement.dataset.uahCiGm,
      gmDefault:document.documentElement.dataset.uahCiGmDefault,
      gmRoundtrip:document.documentElement.dataset.uahCiGmRoundtrip,
      business:document.documentElement.dataset.uahCiBusiness,
      action:document.querySelector('#uah-ci-target')?.getAttribute('data-uah-ci-action')||null
    }));
  };
  // Both pages execute the EXACT SAME installed .user.js; only the
  // disposable DOM differs. This proves synthetic broken/fixed behavior,
  // NOT that the product diagnosed or repaired real userscript source.
  const brokenPage=await context.newPage();
  await brokenPage.goto('https://example.com/',{
    waitUntil:'domcontentloaded',timeout:30000});
  const broken=await readBusiness(brokenPage);
  console.log('TAMPERMONKEY_SYNTHETIC_BROKEN '+JSON.stringify(broken));
  assert.equal(broken.runAt,runAt,'Manager ran the declared injection mode');
  assert.ok(['loading','interactive','complete'].includes(broken.injectionReadyState),
    'Actual userscript injection readyState must be recorded');
  assert.deepEqual({
    injected:broken.injected,gm:broken.gm,gmDefault:broken.gmDefault,
    gmRoundtrip:broken.gmRoundtrip,business:broken.business,action:broken.action
  },{
    injected:'yes',gm:'true',gmDefault:'true',gmRoundtrip:'true',
    business:'missing-target',action:null
  });
  const fixedPage=await context.newPage();
  await fixedPage.addInitScript(()=>{
    // The top-page fixture owns this target. A child frame supplies its own
    // independent target, never a duplicate ID from this injected helper.
    if(window.top!==window)return;
    document.addEventListener('DOMContentLoaded',()=>{
      const el=document.createElement('button');el.id='uah-ci-target';
      document.body?.append(el);
    },{once:true});
  });
  await fixedPage.goto('https://example.com/',{
    waitUntil:'domcontentloaded',timeout:30000});
  const fixed=await readBusiness(fixedPage);
  console.log('TAMPERMONKEY_SYNTHETIC_FIXED '+JSON.stringify(fixed));
  assert.equal(fixed.runAt,runAt,'Manager ran the declared injection mode');
  assert.ok(['loading','interactive','complete'].includes(fixed.injectionReadyState),
    'Actual userscript injection readyState must be recorded');
  assert.deepEqual({
    injected:fixed.injected,gm:fixed.gm,gmDefault:fixed.gmDefault,
    gmRoundtrip:fixed.gmRoundtrip,business:fixed.business,action:fixed.action
  },variant==='product-original'
    ?{injected:'yes',gm:'true',gmDefault:'true',gmRoundtrip:'true',business:'missing-target',action:null}
    :{injected:'yes',gm:'true',gmDefault:'true',gmRoundtrip:'true',business:'recovered',action:'done'});
  // TASK-007 / TEST-017/026: a matching-origin child frame is not an
  // independent user-approved top-level script target. A genuine extension
  // is present here; the browser must exercise the actual manager policy.
  // The disposable frame is served locally via Playwright routing, without
  // reading an account, user script, profile or third-party site data.
  await context.route('https://example.com/uah-ci-nested-frame',route=>
    route.fulfill({status:200,contentType:'text/html',
      body:'<!doctype html><html><body><button id="uah-ci-target">Disposable iframe</button></body></html>'}));
  await fixedPage.evaluate(()=>{
    const child=document.createElement('iframe');
    child.id='uah-ci-nested-frame';
    child.src='https://example.com/uah-ci-nested-frame';
    document.body.append(child);
  });
  await fixedPage.frameLocator('#uah-ci-nested-frame').locator('#uah-ci-target')
    .waitFor({timeout:15000});
  const childFrame=fixedPage.frames().find(frame=>
    frame.url()==='https://example.com/uah-ci-nested-frame');
  assert.ok(childFrame,'Disposable child frame did not reach the intended URL');
  await childFrame.waitForLoadState('load',{timeout:15000});
  await sleep(1200);
  const childEvidence=await childFrame.evaluate(()=>({
    injected:document.documentElement.dataset.uahCiInjected||null,
    gm:document.documentElement.dataset.uahCiGm||null,
    action:document.querySelector('#uah-ci-target')?.getAttribute('data-uah-ci-action')||null
  }));
  console.log('TAMPERMONKEY_UNAUTHORIZED_CHILD_FRAME '+JSON.stringify(childEvidence));
  assert.deepEqual(childEvidence,{injected:null,gm:null,action:null},
    'A disposable matching-origin iframe must not execute this top-frame-only diagnostic script');
  console.log('PASS: vendor-hosted unpacked Tampermonkey '+runAt+
    ' fixture variant '+variant+' GM_getValue default + GM_setValue/readback and expected business assertions.');
  if(variant==='product-original')
    console.log('EXPECTED_PRODUCT_ORIGINAL_FAILURE: unchanged selector fails on target-present page');
  if(variant==='product-candidate'){
    assert.ok(nativeExport,'Product candidate must have a real native manual export');
    assert.deepEqual(fs.readFileSync(nativeExport.sourcePath),nativeExport.originalBytes,
      'Actual Tampermonkey installation must not mutate the original native script');
    assert.equal(createHash('sha256').update(
      fs.readFileSync(nativeExport.exportedPath)).digest('hex'),
      nativeExport.candidateSha256,
      'The tested installed source must still match the reviewed on-disk export');
    console.log('PRODUCT_MANUAL_EXPORT_RUNTIME_RECOVERY_ONLY: native-backed candidate worked in disposable manager; original and recovery export were preserved; no automatic application');
  }
  console.log('NOT VERIFIED: official store-signed ID, program auto-repair, user Chrome support matrix and Stable GATE.');
 }finally{
  if(context)await context.close().catch(()=>{});
  if(nativeProbe)await nativeProbe.stop();
  await new Promise(resolve=>server.close(resolve));
  if(nativeExport)fs.rmSync(nativeExport.root,{recursive:true,force:true});
 }
}
main().catch(error=>{
 console.error('TAMPERMONKEY_CLOUD_EXPERIMENT_BLOCKED: '+String(error?.stack||error).slice(0,2200));
 process.exitCode=1;
});
