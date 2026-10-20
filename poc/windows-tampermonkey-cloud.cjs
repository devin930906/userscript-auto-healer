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
const dir=process.env.UAH_TM_EXTENSION_DIR;
const profile=process.env.UAH_TM_PROFILE_DIR;
if(!dir||!profile||!path.isAbsolute(dir)||!path.isAbsolute(profile))
  throw Error('Missing disposable test directories');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
assert.equal(manifest.manifest_version,3,'Official current Tampermonkey must be MV3');
assert.ok(/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version),'Unknown manager version');
const EXPECTED_ID='dhdgffkkebhmkfjojejmpbldmpobfkfo';
const source=[
 '// ==UserScript==',
 '// @name UAH disposable Tampermonkey CI fixture',
 '// @namespace https://userscript-auto-healer.invalid/',
 '// @version 0.0.1',
 '// @match https://example.com/*',
 '// @grant GM_getValue',
 '// @run-at document-idle',
 '// ==/UserScript==',
 'document.documentElement.dataset.uahCiInjected="yes";',
 'let gm=false;',
 'try { gm=typeof GM_getValue==="function"&&',
 'GM_getValue("__uah_ci_missing_key__","ci-default")==="ci-default"; }catch(e){}',
 'document.documentElement.dataset.uahCiGm=String(gm);',
 'const anchor=document.querySelector("#uah-ci-target");',
 'if(anchor&&gm)anchor.setAttribute("data-uah-ci-action","done");',
 'document.documentElement.dataset.uahCiBusiness=anchor&&gm?"recovered":"missing-target";'
].join('\n');
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
 const server=http.createServer((req,res)=>{
  if(req.url==='/test.user.js'){
   res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8',
     'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   return res.end(source);
  }
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end('<!doctype html><title>Disposable CI install</title><a href="/test.user.js" id="install">Test only</a>');
 });
 await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',resolve);
 });
 let context;
 const launch=()=>chromium.launchPersistentContext(profile,{
  channel:'chromium',headless:false,
  args:['--disable-extensions-except='+dir,'--load-extension='+dir]
 });
 try{
  context=await launch();
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
  await installerPage.goto('http://127.0.0.1:'+port+'/',{waitUntil:'domcontentloaded'});
  await installerPage.locator('#install').click();
  await sleep(1800);
  // Tampermonkey MV3 may use an intermediate vendor-hosted page or a
  // browser download, especially for loopback URLs. Never promote either
  // to installed-script evidence. Try the documented direct URL next.
  const displayPages=()=>context.pages().map(p=>({
    url:p.url().replace(/([?&](?:url|token|key|aid)=)[^&]+/gi,'$1[redacted]').slice(0,220)
  }));
  console.log('POST_LINK_NAVIGATION '+JSON.stringify(displayPages()));
  if(!context.pages().some(p=>p.url().startsWith('chrome-extension://'+id+'/'))){
    const direct=await context.newPage();
    try{await direct.goto('http://127.0.0.1:'+port+'/test.user.js',{timeout:12000});}
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
  const readBusiness=async(page)=>{
    await page.waitForFunction(
      ()=>document.documentElement.dataset.uahCiInjected==='yes',{timeout:12000});
    return page.evaluate(()=>({
      injected:document.documentElement.dataset.uahCiInjected,
      gm:document.documentElement.dataset.uahCiGm,
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
  assert.deepEqual(broken,{
    injected:'yes',gm:'true',business:'missing-target',action:null
  });
  const fixedPage=await context.newPage();
  await fixedPage.addInitScript(()=>{
    document.addEventListener('DOMContentLoaded',()=>{
      const el=document.createElement('button');el.id='uah-ci-target';
      document.body?.append(el);
    },{once:true});
  });
  await fixedPage.goto('https://example.com/',{
    waitUntil:'domcontentloaded',timeout:30000});
  const fixed=await readBusiness(fixedPage);
  console.log('TAMPERMONKEY_SYNTHETIC_FIXED '+JSON.stringify(fixed));
  assert.deepEqual(fixed,{
    injected:'yes',gm:'true',business:'recovered',action:'done'
  });
  console.log('PASS: vendor-hosted unpacked Tampermonkey GM_getValue and both synthetic DOM/business assertions.');
  console.log('NOT VERIFIED: official store-signed ID, program auto-repair, user Chrome support matrix and Stable GATE.');
 }finally{
  if(context)await context.close().catch(()=>{});
  await new Promise(resolve=>server.close(resolve));
 }
}
main().catch(error=>{
 console.error('TAMPERMONKEY_CLOUD_EXPERIMENT_BLOCKED: '+String(error?.stack||error).slice(0,2200));
 process.exitCode=1;
});
