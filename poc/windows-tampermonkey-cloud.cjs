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
assert.ok([
  'baseline','product-original','product-candidate',
  'product-id-original','product-id-candidate','native-gm'
].includes(variant),
  'Unreviewed fixture variant is forbidden');
// querySelector is tested at document-start and document-idle; the newer
// getElementById native manual export is tested independently at idle.
// Every variant uses an independent, disposable Tampermonkey Profile.
const isProductOriginal=variant==='product-original'||variant==='product-id-original';
const isProductCandidate=variant==='product-candidate'||variant==='product-id-candidate';
const isIdProduct=variant==='product-id-original'||variant==='product-id-candidate';
if(isProductOriginal||isProductCandidate)
  assert.ok(isIdProduct?runAt==='document-idle':
    ['document-start','document-idle'].includes(runAt),
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
if(isProductOriginal||isProductCandidate){
  // TASK-007/009/012: never hand-write the repaired fixture installed by
  // Tampermonkey. The latest getElementById support must pass the SAME real
  // planner, independent audit, native backup and manual-export contract.
  const healthy=isIdProduct?source.replace(
    'document.querySelector("#uah-ci-target")',
    'document.getElementById("uah-ci-target")'):source;
  assert.ok(!isIdProduct||healthy!==source,
    'The disposable fixture must contain exactly one native ID lookup');
  const method=isIdProduct?'getElementById':'querySelector';
  const healthyCall=isIdProduct?'document.getElementById("uah-ci-target")':
    'document.querySelector("#uah-ci-target")';
  const brokenCall=isIdProduct?'document.getElementById("uah-ci-stale-target")':
    'document.querySelector("#uah-ci-stale-target")';
  const original=healthy.replace(healthyCall,brokenCall);
  assert.notEqual(original,healthy,'Original fixture must contain exactly one selector');
  const {analyzeSelectors}=require('../dist/src/analyze/selector-analyzer.js');
  const {proposeLiteralSelectorPatch,auditProposedLiteralSelectorPatch}=
    require('../dist/src/repair/patch-planner.js');
  const ast=analyzeSelectors(original);
  assert.equal(ast.status,'OK','Application AST analyzer must parse the original');
  const sites=ast.sites.filter(site=>site.method===method&&
    site.selector===(isIdProduct?'uah-ci-stale-target':'#uah-ci-stale-target')&&
    site.kind==='literal');
  assert.equal(sites.length,1,'Exactly one unambiguous AST site is required');
  const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');
  const request={
    source:original,expectedSourceSha256:sha(original),callOffset:sites[0].offset,
    method,originalSelector:'#uah-ci-stale-target',
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
  assert.equal(proposal.candidateSource,healthy,
    'No unrelated source or metadata edits are allowed');
  console.log('APPLICATION_GENERATED_CANDIDATE_RECEIPT '+JSON.stringify({
    variant,runAt,method,originalSha256:sha(original),
    candidateSha256:sha(proposal.candidateSource),audit:audit.status,
    automaticPatchAllowed:proposal.automaticPatchAllowed
  }));
  // Both independent product variants install real on-disk exports:
  // the candidate file OR the separately emitted ORIGINAL recovery .user.js.
  reviewedCandidateForExport={original,request,proposal};
  source=isProductCandidate?proposal.candidateSource:original;
}

/** TASK-012 / TEST-023: exercise the REAL native stage and manual-export
 * implementation before asking the disposable Tampermonkey to install bytes.
 * The product-original control must actually install the original recovery
 * export from disk; a byte-equal artifact alone is not manager acceptance.
 * Every file is CI-created under a fresh temp root; no real user script or
 * manager profile is read or modified by the native export operation.
 */
/** TASK-007/009/012 + TEST-017/018/019/023:
 * Exercise the SAME native import → reviewed scenario → manual export entry
 * used by the Electron product, not isolated lower-level stage/export methods.
 * These synthetic DOM samples are EXPLICITLY fixture inputs, not actual CDP
 * provenance. Real Tampermonkey + GM + business checks run only afterwards.
 */
async function prepareNativeManualExportForManager(reviewed,browserContext){
 const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'uah-product-export-'));
 try{
  const sourcePath=path.join(root,'broken-original.user.js');
  const backupDirectory=path.join(root,'backups');
  const exportDirectory=path.join(root,'manual-exports');
  fs.mkdirSync(backupDirectory);
  fs.mkdirSync(exportDirectory);
  fs.writeFileSync(sourcePath,reviewed.original,{flag:'wx'});
  const {importApprovedPaths}=require('../dist/src/import/import-service.js');
  const {exportReviewedImportedSelectorOnly}=
    require('../dist/src/repair/imported-manual-export.js');
  const imported=await importApprovedPaths([sourcePath]);
  assert.equal(imported.errors.length,0,'Native importer must reject no fixture bytes');
  assert.equal(imported.scripts.length,1,'Native import must read exactly one .user.js');
  const script=imported.scripts[0];
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(script.sha256,reviewed.request.expectedSourceSha256,
    'Imported source fingerprint must match reviewed AST request');
  assert.equal(script.textEncoding,'utf-8','Only exact UTF-8 source may be staged');
  assert.equal(script.sourcePath,sourcePath,'Native importer retains selected path');
  const scenario={
   id:'tm_product_'+runAt.replace(/-/g,'_'),
   scriptSha256:script.sha256,
   userApproved:true,requiresLogin:false,
   targetUrl:'https://example.com/',
   steps:[],assertions:[
    {kind:'selector-present',selector:'#uah-ci-stale-target'},
    {kind:'selector-present',selector:'#uah-ci-target'}
   ]
  };
  // Observe an actual disposable Chromium document BEFORE installing the
  // manager script. This measures real fixture DOM, rather than supplying
  // invented selector counts. It is Playwright fixture evidence, NOT the
  // product's owned-Chrome/CDP diagnostic or Tampermonkey/GM attestation.
  const fixtureUrl='https://example.com/uah-native-observation-fixture';
  scenario.targetUrl=fixtureUrl;
  const observationPage=await browserContext.newPage();
  let domSamples;
  try{
   await observationPage.route(fixtureUrl,route=>route.fulfill({
    status:200,contentType:'text/html',
    body:'<!doctype html><html><head><title>Disposable UAH DOM sample</title></head>'+
     '<body><button id="uah-ci-target">Fixture only</button></body></html>'
   }));
   await observationPage.goto(fixtureUrl,{waitUntil:'load',timeout:20000});
   const capture=async()=>{
    const sample=await observationPage.evaluate(()=>{
     const count=selector=>document.querySelectorAll(selector).length;
     return {
      elementCount:count('*'),iframeCount:count('iframe'),
      visibleShadowRoots:[...document.querySelectorAll('*')]
       .filter(node=>node.shadowRoot!==null).length,
      oldCount:count('#uah-ci-stale-target'),nextCount:count('#uah-ci-target')
     };
    });
    return {
     ok:true,status:'LIMITED_DOM_OBSERVATION',
     observedAt:new Date().toISOString(),
     originMatchesApproved:new URL(observationPage.url()).origin===
      new URL(fixtureUrl).origin,
     routeChanged:observationPage.url()!==fixtureUrl,
     summary:{
      elementCount:sample.elementCount,iframeCount:sample.iframeCount,
      visibleShadowRoots:sample.visibleShadowRoots,
      blindSpots:['CLOSED_SHADOW_ROOT_UNKNOWN']
     },
     selectorCounts:{
      '#uah-ci-stale-target':sample.oldCount,
      '#uah-ci-target':sample.nextCount
     },
     fullPageVerified:false,userscriptVerified:false
    };
   };
   const captureSeries=async()=>{
    const samples=[];
    for(let i=0;i<3;i++){
     if(i)await sleep(300);
     samples.push(await capture());
    }
    return {
     ok:true,status:'LIMITED_DYNAMIC_OBSERVATION',samples,
     routeChangeDetected:samples.some(x=>x.routeChanged),
     selectorCountChanged:samples.some(x=>
      x.selectorCounts['#uah-ci-stale-target']!==samples[0].selectorCounts['#uah-ci-stale-target']||
      x.selectorCounts['#uah-ci-target']!==samples[0].selectorCounts['#uah-ci-target']),
     domCountChanged:samples.some(x=>
      x.summary.elementCount!==samples[0].summary.elementCount),
     userscriptVerified:false
    };
   };
   // Negative control: a real browser DOM where the supposedly obsolete
   // selector STILL exists must not create a backup, candidate or export.
   await observationPage.evaluate(()=>{
    const stale=document.createElement('div');
    stale.id='uah-ci-stale-target';
    document.body.append(stale);
   });
   const contaminated=await captureSeries();
   assert.equal(contaminated.samples[0].selectorCounts['#uah-ci-stale-target'],1);
   const denied=await exportReviewedImportedSelectorOnly(
    script,scenario,contaminated,
    {backupDirectory,exportDirectory,userApproved:true}
   );
   assert.equal(denied.status,'BLOCKED',
    'A real DOM with the obsolete selector present may never export a patch');
   assert.deepEqual(fs.readdirSync(backupDirectory),[],
    'Rejected Chromium DOM must never create a backup');
   assert.deepEqual(fs.readdirSync(exportDirectory),[],
    'Rejected Chromium DOM must never create a manager install file');
   assert.deepEqual(fs.readFileSync(sourcePath),Buffer.from(reviewed.original,'utf8'),
    'Rejected DOM must not modify the imported original');
   await observationPage.evaluate(
    ()=>document.getElementById('uah-ci-stale-target').remove()
   );
   domSamples=await captureSeries();
   assert.ok(domSamples.samples.every(x=>
     x.originMatchesApproved&&!x.routeChanged&&
     x.summary.iframeCount===0&&x.summary.visibleShadowRoots===0&&
     x.selectorCounts['#uah-ci-stale-target']===0&&
     x.selectorCounts['#uah-ci-target']===1),
    'Actual Chromium DOM must remain stable and scoped to the disposable fixture');
   console.log('PRODUCT_BROWSER_DOM_OBSERVATION '+JSON.stringify({
    variant,runAt,realChromiumDomReadOnly:true,
    observationMethod:'PLAYWRIGHT_DISPOSABLE_FIXTURE_NOT_PRODUCT_CDP',
    rejectedStalePresent:true,stableSamples:domSamples.samples.length,
    managerInstalled:false,automaticPatchAllowed:false
   }));
  }finally{await observationPage.close();}
  const exported=await exportReviewedImportedSelectorOnly(
   script,scenario,domSamples,
   {backupDirectory,exportDirectory,userApproved:true}
  );
  assert.equal(exported.status,'MANUAL_EXPORT_READY_RUNTIME_UNVERIFIED',
    'Product native import → scenario → manual export chain must succeed: '+JSON.stringify(exported));
  assert.equal(exported.automaticPatchAllowed,false);
  assert.equal(exported.automaticRollbackAllowed,false);
  assert.equal(exported.managerInstalled,false);
  assert.equal(exported.tampermonkeyVerified,false);
  assert.equal(exported.businessVerified,false);
  const exportedPath=path.join(exportDirectory,exported.exportFileName);
  const originalRecoveryPath=path.join(exportDirectory,exported.recoveryExportFileName);
  const candidateBytes=fs.readFileSync(exportedPath);
  const originalBytes=Buffer.from(reviewed.original,'utf8');
  assert.deepEqual(candidateBytes,Buffer.from(reviewed.proposal.candidateSource,'utf8'),
    'The actual manager-facing bytes must come from the product native manual export');
  assert.equal(sha(candidateBytes),reviewed.proposal.candidateSha256);
  assert.equal(exported.candidateSha256,reviewed.proposal.candidateSha256);
  assert.equal(exported.sourceSha256,script.sha256);
  assert.equal(exported.candidateByteLength,candidateBytes.byteLength);
  assert.deepEqual(fs.readFileSync(originalRecoveryPath),originalBytes,
    'Native recovery file must preserve the exact pre-repair bytes');
  assert.deepEqual(fs.readFileSync(path.join(backupDirectory,exported.backupFileName)),
    originalBytes,'Independent native backup must retain the original');
  assert.deepEqual(fs.readFileSync(path.join(backupDirectory,exported.candidateFileName)),
    candidateBytes,'Staged candidate must equal the exported manager-facing bytes');
  assert.deepEqual(fs.readFileSync(sourcePath),originalBytes,
    'Product handoff must never overwrite the original imported source');
  assert.equal(fs.readdirSync(exportDirectory).length,2,
    'Only candidate and independent recovery exports may be created');
  console.log('PRODUCT_NATIVE_IMPORT_TO_REAL_MANAGER '+JSON.stringify({
   variant,runAt,originalSha256:sha(originalBytes),
   candidateSha256:sha(candidateBytes),
   importedBytes:script.byteLength,exportedBytes:candidateBytes.byteLength,
   export:exported.status,browserObservedFixtureOnly:true,productCdpVerified:false,
   managerInstalled:false,automaticPatchAllowed:false,
   automaticRollbackAllowed:false
  }));
  return {root,exportedPath,originalRecoveryPath,sourcePath,originalBytes,
   originalSha256:sha(originalBytes),candidateSha256:sha(candidateBytes)};
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
 let nativeExport=null;
 const server=http.createServer((req,res)=>{
  if(req.url==='/test.user.js'||req.url==='/test.user.js?manual-recovery=1'){
   const restoringInstalledCandidate=req.url.endsWith('?manual-recovery=1');
   if(restoringInstalledCandidate&&(!isProductCandidate||!nativeExport)){
    res.writeHead(404,{'Cache-Control':'no-store'});
    return res.end('UNAUTHORIZED_DISPOSABLE_RESTORE_URL');
   }
   // A product-original control installs the actual native ORIGINAL recovery
   // file in its own manager Profile. Candidate installs the independently
   // exported reviewed candidate. Neither test ever updates a user's script.
   // A missing or modified disk artifact MUST NOT get an HTTP 200 response.
   let bytes=source;
   if(nativeExport){
    const fromOriginal=isProductOriginal||restoringInstalledCandidate;
    const installFile=fromOriginal
      ?nativeExport.originalRecoveryPath:nativeExport.exportedPath;
    const expectedSha=fromOriginal
      ?nativeExport.originalSha256:nativeExport.candidateSha256;
    const expectedBytes=fromOriginal?nativeExport.originalBytes:Buffer.from(source,'utf8');
    try{
     const disk=fs.readFileSync(installFile);
     if(createHash('sha256').update(disk).digest('hex')!==expectedSha ||
        !disk.equals(expectedBytes)){
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
  if(reviewedCandidateForExport)
   nativeExport=await prepareNativeManualExportForManager(
    reviewedCandidateForExport,context);
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
  },isProductOriginal
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
  if(isProductOriginal){
    assert.ok(nativeExport,'Original manager control must use the native recovery export');
    assert.deepEqual(fs.readFileSync(nativeExport.sourcePath),nativeExport.originalBytes,
      'Installing exported original in Tampermonkey must not rewrite original native script');
    assert.deepEqual(fs.readFileSync(nativeExport.originalRecoveryPath),nativeExport.originalBytes,
      'Manager-tested manual recovery export must retain original bytes');
    assert.equal(createHash('sha256').update(
      fs.readFileSync(nativeExport.originalRecoveryPath)).digest('hex'),
      nativeExport.originalSha256);
    console.log('PRODUCT_MANUAL_RECOVERY_EXPORT_REAL_MANAGER_ORIGINAL_BEHAVIOR_ONLY: native original recovery .user.js installed in independent disposable Tampermonkey; unchanged original still fails on target-present synthetic page; no installed-candidate rollback attested');
  }
  if(isProductCandidate){
    assert.ok(nativeExport,'Product candidate must have a real native manual export');
    assert.deepEqual(fs.readFileSync(nativeExport.sourcePath),nativeExport.originalBytes,
      'Actual Tampermonkey installation must not mutate the original native script');
    assert.equal(createHash('sha256').update(
      fs.readFileSync(nativeExport.exportedPath)).digest('hex'),
      nativeExport.candidateSha256,
      'The tested installed source must still match the reviewed on-disk export');
    console.log('PRODUCT_MANUAL_EXPORT_RUNTIME_RECOVERY_ONLY: native-backed candidate worked in disposable manager; original and recovery export were preserved; no automatic application');
   if(runAt==='document-idle'){
    // TASK-012 / TEST-023: the SAME disposable manager profile must now
    // explicitly reinstall the separately exported original recovery bytes.
    // This is a user-clicked isolated manager lifecycle, NOT an application
    // auto-rollback or an attestation of production recovery authority.
    for(const old of context.pages().filter(p=>p.url().startsWith('chrome-extension://'+id+'/')&&
        /confirm|install|\/ask\.html(?:\?|$)/i.test(p.url())))
      await old.close();
    const restoreUrl='http://127.0.0.1:'+port+'/test.user.js?manual-recovery=1';
    const restoreTab=await context.newPage();
    try{await restoreTab.goto(restoreUrl,{timeout:12000});}
    catch(error){console.log('DIRECT_MANUAL_RESTORE_NAVIGATION '+String(error).slice(0,130));}
    await sleep(2300);
    let restorePages=context.pages().filter(p=>p.url().startsWith('chrome-extension://'+id+'/'));
    const restoreAsk=restorePages.find(p=>/\/ask\.html(?:\?|$)/i.test(p.url()));
    if(restoreAsk){
     const actions=await restoreAsk.locator('button,input[type="button"],input[type="submit"]')
      .evaluateAll(nodes=>nodes.map(el=>({name:(el.innerText||el.value||'').trim(),id:el.id||''})));
     const allowed=actions.filter(x=>/^(allow|grant|continue|proceed|always allow)$/i.test(x.name));
     // The native ask.html page can ALREADY be the explicit
     // Install/Cancel confirmation. It is not an intermediate Allow page.
     // Only click an unambiguous intermediate permission button; otherwise
     // the strict manager Install confirmation below remains mandatory.
     if(allowed.length>1)throw Error('Ambiguous manager recovery permission controls');
     if(allowed.length===1){
      const chosen=allowed[0].id?restoreAsk.locator('#'+allowed[0].id):
       restoreAsk.getByRole('button',{name:allowed[0].name,exact:true});
      await chosen.first().click({timeout:8000});
      await sleep(1600);
     }
    }
    restorePages=context.pages().filter(p=>p.url().startsWith('chrome-extension://'+id+'/'));
    const restoreConfirm=restorePages.find(p=>/confirm|install|\/ask\.html(?:\?|$)/i.test(p.url()));
    assert.ok(restoreConfirm,'Native manager did not prompt to reinstall original recovery export');
    const recoveryText=await restoreConfirm.locator('body').innerText();
    assert.ok(recoveryText.includes('UAH disposable Tampermonkey CI fixture '+runAt),
      'Native manager recovery confirmation does not identify the isolated fixture');
    let reinstallClicked=false;
    for(const selector of ['#confirm','#install','#btnInstall','button:has-text("Reinstall")',
      'button:has-text("Update")','button:has-text("Install")',
      'input[value="Reinstall"]','input[value="Update"]','input[value="Install"]']){
     const control=restoreConfirm.locator(selector);
     if(await control.count()&&await control.first().isVisible()){
      await control.first().click({timeout:10000});reinstallClicked=true;break;
     }
    }
    assert.equal(reinstallClicked,true,'No explicit real manager manual restore installation click');
    await sleep(1900);
    const restoredPage=await context.newPage();
    await restoredPage.addInitScript(()=>{
     if(window.top!==window)return;
     document.addEventListener('DOMContentLoaded',()=>{
      const el=document.createElement('button');el.id='uah-ci-target';
      document.body?.append(el);
     },{once:true});
    });
    await restoredPage.goto('https://example.com/',{
     waitUntil:'domcontentloaded',timeout:30000});
    const restored=await readBusiness(restoredPage);
    assert.equal(restored.runAt,runAt);
    assert.deepEqual({injected:restored.injected,gm:restored.gm,
     gmDefault:restored.gmDefault,gmRoundtrip:restored.gmRoundtrip,
     business:restored.business,action:restored.action},{
      injected:'yes',gm:'true',gmDefault:'true',gmRoundtrip:'true',
      business:'missing-target',action:null
     },'After explicit in-manager recovery, a fresh target-present page must execute the ORIGINAL broken script');
    assert.deepEqual(fs.readFileSync(nativeExport.sourcePath),nativeExport.originalBytes,
     'Manual manager recovery may not modify the original native script');
    assert.deepEqual(fs.readFileSync(nativeExport.originalRecoveryPath),nativeExport.originalBytes,
     'Manual manager recovery may not modify the recovery export');
    assert.equal(createHash('sha256').update(fs.readFileSync(nativeExport.exportedPath)).digest('hex'),
     nativeExport.candidateSha256,'The separate candidate export must remain available');
    console.log('PRODUCT_REAL_MANAGER_MANUAL_INSTALLED_VERSION_RESTORE '+JSON.stringify({
     runAt,originalSha256:nativeExport.originalSha256,
     candidateSha256:nativeExport.candidateSha256,
     before:'reviewed-candidate-recovered/done',after:'manual-original-missing-target',
     gmDefault:restored.gmDefault,gmRoundtrip:restored.gmRoundtrip,
     originalBytesPreserved:true,automaticRollbackAllowed:false,
     stableManagerAttestation:false
    }));
    await restoredPage.close();
   }
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
