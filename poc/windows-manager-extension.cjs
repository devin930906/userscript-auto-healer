// POC-02A only: actual published MV3 userscript-manager extension in isolated Chromium.
// This is throwaway feasibility code; it neither repairs scripts nor touches user Chrome data.
const { chromium } = require('playwright');
const http = require('http');
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');

const extensionDir = process.env.USERSCRIPT_TEST_EXTENSION_DIR;
const profileDir = process.env.USERSCRIPT_TEST_PROFILE_DIR;
if (!extensionDir || !profileDir) throw new Error('Missing isolated PoC directories');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'),'utf8'));
assert.equal(manifest.manifest_version, 3, 'Expected the pinned MV3 extension release');
const payload = [
  '// ==UserScript==',
  '// @name        Userscript feasibility fixture',
  '// @namespace   https://userscript-auto-healer.invalid/',
  '// @version     0.0.1',
  '// @match       https://example.com/*',
  '// @grant       GM_getValue',
  '// @run-at      document-idle',
  '// ==/UserScript==',
  'document.documentElement.dataset.userscriptFixture = "executed";',
  'document.documentElement.dataset.gmApiPresent = String(typeof GM_getValue === "function");',
].join('\n');

async function main() {
  const server = http.createServer((req,res)=>{
    if (req.url.startsWith('/fixture.user.js')) {
      res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store'});
      return res.end(payload);
    }
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
    res.end('<!DOCTYPE html><title>Local userscript fixture</title><h1 id="fixture">Local page</h1>');
  });
  // A random loopback port serves only the manager's installer .user.js.
  // The SCRIPT under test matches the IANA-reserved https://example.com URL,
  // whose standard HTTPS port avoids nonstandard-port match discrepancies.
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      server.removeListener('error',reject);
      resolve();
    });
  });
  const port = server.address().port;
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      // Compare hosted Chromium GUI behavior with earlier headless feasibility runs.
      headless:process.env.USERSCRIPT_POC_GUI !== 'true',
      channel:'chromium',
      args:[
        '--disable-extensions-except='+extensionDir,
        '--load-extension='+extensionDir,
      ],
    });
    // Observe only local/disposable extension errors to explain incomplete injection.
    context.on('page', p=>{
      if (!p.url().startsWith('chrome-extension://')) return;
      p.on('console', m=>{if(m.type()==='error')console.log('MANAGER_PAGE_CONSOLE_ERROR: '+m.text().slice(0,450))});
      p.on('pageerror', e=>console.log('MANAGER_PAGE_ERROR: '+String(e).slice(0,450)));
    });
    let workers = context.serviceWorkers();
    if (!workers.some(w=>w.url().startsWith('chrome-extension://'))) {
      // A MV3 service worker may be idle before an extension page is used.
      // Confirm installation from Chromium's native extension UI, then wake it
      // by opening its own options page. Never claim success based on the UI alone.
      const settings = await context.newPage();
      try {
        await settings.goto('chrome://extensions/',{waitUntil:'domcontentloaded',timeout:12000});
        await settings.waitForTimeout(1400);
        const cards=await settings.evaluate(()=>{
          const found=[];
          function walk(root) {
            for (const el of root.querySelectorAll('*')){
              if(el.tagName.toLowerCase()==='extensions-item'){
                found.push({id:el.id||el.data?.id||'',name:el.shadowRoot?.querySelector('#name')?.textContent?.trim()||el.data?.name||''});
              }
              if(el.shadowRoot)walk(el.shadowRoot);
            }
          }
          walk(document);return found;
        });
        console.log('Extension items when worker is idle: '+JSON.stringify(cards.slice(0,8)));
        const item=cards.find(x=>/violentmonkey/i.test(x.name)&&/^[a-p]{32}$/.test(x.id));
        if(item) {
          const activation=await context.newPage();
          try{await activation.goto('chrome-extension://'+item.id+'/options/index.html',{waitUntil:'domcontentloaded',timeout:12000});await activation.waitForTimeout(1500);}
          catch(err){console.log('Extension wake-up attempt: '+String(err.message).slice(0,180));}
          await activation.close();
        }
      } catch(err){console.log('Extension inspection unavailable: '+String(err.message).slice(0,220));}
      await settings.close();
      workers = context.serviceWorkers();
      if (!workers.some(w=>w.url().startsWith('chrome-extension://'))) {
        try {workers=[await context.waitForEvent('serviceworker',{timeout:8000})]}
        catch(err){throw new Error('Extension worker still unavailable after safe native UI check: '+String(err.message).slice(0,200))}
      }
    }
    const worker = workers.find(w => w.url().startsWith('chrome-extension://'));
    assert.ok(worker,'No actual Chrome extension worker was registered');
    // Playwright can evaluate service-worker scripts in an isolated utility world
    // without the extension chrome API. Registered origin is a loading proof only.
    const info = {id:new URL(worker.url()).host,version:manifest.version};
    assert.match(info.id,/^[a-p]{32}$/);
    console.log('PASS POC-02A: published Violentmonkey MV3 extension worker registered; ID='+info.id+'; pinned version='+info.version+'; worker='+worker.url());
    console.log('NOTE: This uses bundled Chromium, not the selected installed Google Chrome or a user Profile.');

    // Chrome 138+ requires explicit per-extension Allow User Scripts opt-in.
    // The following UI interaction is restricted to THIS disposable profile and THIS
    // just-loaded manager extension, never a user's existing browser.
    const permissionPage=await context.newPage();
    try {
      await permissionPage.goto('chrome://extensions/?id='+info.id,{waitUntil:'domcontentloaded',timeout:12000});
      await permissionPage.waitForTimeout(1500);
      // Chrome settings is shadow-DOM based. Locate the actual control rather than
      // assuming clicking a static label changes its state.
      const controls=await permissionPage.evaluate(()=>{
        const hits=[];
        function walk(root){
          for(const el of root.querySelectorAll('*')){
            if(el.matches('cr-toggle,[role="switch"]')){
              const container=el.parentElement;
              hits.push({id:el.id,parentId:container?.id||'',title:container?.textContent?.trim().slice(0,130)||'',checked:el.checked,ariaChecked:el.getAttribute('aria-checked')});
            }
            if(el.shadowRoot)walk(el.shadowRoot);
          }
        }
        walk(document);return hits;
      });
      console.log('Chrome extension details toggle inventory: '+JSON.stringify(controls.slice(0,25)));
      const label=permissionPage.getByText('Allow User Scripts',{exact:true});
      if(await label.count()!==1){
        console.log('INCOMPLETE userScripts opt-in: label count='+await label.count());
      } else {
        const action=await label.evaluate(el=>{
          let node=el, row=null;
          while(node&&!row){
            if(node.matches?.('extensions-toggle-row'))row=node;
            else if(node.parentElement)node=node.parentElement;
            else node=node.getRootNode()?.host||null;
          }
          if(!row)return {foundRow:false};
          const t=row.shadowRoot?.querySelector('cr-toggle')||row.querySelector('cr-toggle');
          if(!t)return {foundRow:true,foundToggle:false,rowId:row.id};
          const before=Boolean(t.checked);
          if(!before)t.click();
          return {foundRow:true,foundToggle:true,rowId:row.id,before,after:Boolean(t.checked)};
        });
        console.log('Explicit opt-in control result on disposable profile: '+JSON.stringify(action));
      }
    } catch(err){console.log('INCOMPLETE extension details UI: '+String(err.message).slice(0,200));}
    // Distinct POC: a full browser restart, rather than native extension Reload,
    // allows userScripts consent to persist while starting a fresh MV3 worker.
    // This only restarts the disposable Chromium process created in this job.
    await permissionPage.close();
    await context.close();
    context=await chromium.launchPersistentContext(profileDir, {
      headless:process.env.USERSCRIPT_POC_GUI !== 'true',
      channel:'chromium',
      args:['--disable-extensions-except='+extensionDir,'--load-extension='+extensionDir],
    });
    console.log('Reopened the same disposable profile after explicit userScripts consent.');
    // Query the extension origin after restart. getScripts() should be callable
    // if the authorized userScripts API is actually available to this extension.
    const optionsProbe=await context.newPage();
    try {
      await optionsProbe.goto('chrome-extension://'+info.id+'/options/index.html',{waitUntil:'domcontentloaded',timeout:15000});
      const api=await optionsProbe.evaluate(async()=>{
        try {
          if(typeof chrome==='undefined'||!chrome.userScripts)return {available:false};
          const scripts=await chrome.userScripts.getScripts();
          const permissions=await chrome.permissions.getAll();
          const testHost=await chrome.permissions.contains({origins:['https://example.com/*']});
          // Temporary positive control: register a harmless marker against a
          // local fixture only. This tests Chrome injection independently of
          // Violentmonkey's manager pipeline; it cannot count as GM acceptance.
          let control='not attempted';
          try {
            await chrome.userScripts.register([{
              id:'poc-direct-control',
              matches:['https://example.com/*'],
              js:[{code:'document.documentElement.dataset.directApiControl = "executed"'}],
              runAt:'document_idle',
              world:'USER_SCRIPT',
            }]);
            control='registered';
          } catch(e) {control='registration failed: '+String(e).slice(0,220)}
          return {
            available:true,registrations:scripts.length,
            targetHostPermission:testHost,
            grantedOrigins:permissions.origins,
            declaredPermissions:permissions.permissions,
            directControl:control,
          };
        } catch(e) {return {available:false,error:String(e).slice(0,220)}}
      });
      console.log('UserScripts API and localhost direct-control diagnostic after browser restart: '+JSON.stringify(api));
      // Separate positive control for the webRequest event that Violentmonkey
      // uses to prepare page-specific registered script data.
      try {
        const observation=await optionsProbe.evaluate(()=>{
          window.__pocWebRequests=[];
          chrome.webRequest.onSendHeaders.addListener(details=>{
            if(details.url.startsWith('http://127.0.0.1:')||details.url.startsWith('https://example.com'))
              window.__pocWebRequests.push({url:details.url,tabId:details.tabId,type:details.type});
          },{urls:['<all_urls>']});
          return {listenerRegistered:chrome.webRequest.onSendHeaders.hasListeners()};
        });
        console.log('WebRequest event positive-control registration: '+JSON.stringify(observation));
      } catch(err){
        console.log('INCOMPLETE webRequest event positive-control setup: '+String(err.message).slice(0,190));
      }
    } catch(err) {console.log('INCOMPLETE extension API check after browser restart: '+String(err.message).slice(0,200));}
    // Retain this extension-origin page to observe local HTTP requests after the test navigation.

    // Best-effort discovery of the authentic userscript installation journey.
    // This does NOT silently install anything into a user browser; only ephemeral profile.
    const page=await context.newPage();
    // Trigger authentic link-click installation; headless Chromium can instead download the JS.
    // A browser-level download is a diagnostic limitation, not a defect in extension registration.
    await page.goto('http://127.0.0.1:'+port+'/fixture',{waitUntil:'domcontentloaded',timeout:20000});
    try {
      await page.evaluate(()=>{const a=document.createElement('a');a.href='/fixture.user.js';a.textContent='Install fixture';a.id='install-fixture';document.body.appendChild(a)});
      await page.locator('#install-fixture').click({timeout:8000});
      await page.waitForTimeout(2000);
    } catch (err) {
      console.log('INCOMPLETE installer navigation: '+String(err.message).slice(0,240));
    }
    console.log('Installation navigation destination: '+page.url());
    await page.waitForTimeout(2500);
    const candidates=context.pages().filter(tab=>tab.url().startsWith('chrome-extension://'+info.id));
    console.log('Manager extension tabs after .user.js click: '+JSON.stringify(candidates.map(tab=>tab.url())));
    const installer=candidates.find(tab=>tab.url().includes('/confirm/')) || (page.url().startsWith('chrome-extension://')?page:null);
    if(installer){
      try {
        await installer.locator('#confirm').waitFor({state:'visible',timeout:12000});
        await installer.locator('#confirm').click({timeout:7000});
        await installer.waitForTimeout(1000);
        try{
          const result=await installer.evaluate(async()=>{
            try{
              const area=await chrome.storage.local.get(null);
              const saved=area['scr:1'] || {};
              const regs=chrome.userScripts?await chrome.userScripts.getScripts():[];
              return {
                storageKeys:Object.keys(area).slice(0,24),
                runtimeOptions:{
                  isApplied:area.options?.isApplied,
                  injectInto:area.options?.defaultInjectInto,
                  ffInject:area.options?.ffInject,
                  xhrInject:area.options?.xhrInject,
                  blacklist:area.options?.blacklist,
                  blacklistNet:area.options?.blacklistNet,
                },
                testScript:{
                  name:saved.meta?.name,
                  match:saved.meta?.match,
                  include:saved.meta?.include,
                  config:saved.config,
                  codePresent:Boolean(area['code:1']),
                  id:saved.props?.id,
                },
                registration:regs.map(g=>({id:g.id,matches:g.matches,allFrames:g.allFrames,runAt:g.runAt})),
                availableUserScripts:Boolean(chrome.userScripts),
              };
            }catch(e){return {error:String(e).slice(0,180)}}
          });
          console.log('Manager installation storage/API diagnostic: '+JSON.stringify(result));
        }catch(e){console.log('INCOMPLETE manager install diagnostic: '+String(e.message).slice(0,200));}

        console.log('Authentic manager install confirmation clicked in ephemeral profile; current URL='+installer.url()+'; status='+String(await installer.locator('body').innerText()).slice(0,340));
      } catch(err){
        console.log('INCOMPLETE authentic installer confirmation: '+String(err.message).slice(0,230));
      }
    } else console.log('INCOMPLETE authentic installer: no manager confirmation tab observed');
    const probe=await context.newPage();
    probe.on('console',m=>{if(m.type()==='error')console.log('FIXTURE_CONSOLE_ERROR: '+m.text().slice(0,380))});
    probe.on('pageerror',e=>console.log('FIXTURE_PAGE_ERROR: '+String(e).slice(0,380)));
    await probe.goto('https://example.com/',{waitUntil:'domcontentloaded',timeout:30000});
    let control={directApi:false};
    try {
      await probe.waitForFunction(()=>document.documentElement.dataset.directApiControl==='executed',{timeout:3000});
      control.directApi=true;
    } catch(e) {}
    console.log('Direct Chrome userScripts injection positive-control on example.com: '+JSON.stringify(control));
    try {
      const webRequests=await optionsProbe.evaluate(()=>window.__pocWebRequests||[]);
      console.log('Observed local-installer + example.com webRequest events: '+JSON.stringify(webRequests.slice(-12)));
    } catch(err) {
      console.log('INCOMPLETE webRequest observed events: '+String(err.message).slice(0,180));
    }
    let execution={installed:false};
    try {
      await probe.waitForFunction(()=>document.documentElement.dataset.userscriptFixture==='executed',{timeout:7000});
      execution={installed:true,gm:await probe.evaluate(()=>document.documentElement.dataset.gmApiPresent)};
    } catch(e){}
    if (execution.installed && execution.gm==='true')
      console.log('PASS POC-02B: .user.js really executed under extension context, GM_getValue available.');
    else {console.log('INCOMPLETE POC-02B: no verified userscript injection/GM API; installation/real assertions still blocked; observed='+JSON.stringify(execution));process.exitCode=2;}
    await page.close(); await probe.close(); await optionsProbe.close();
  } finally {
    if (context) await context.close().catch(()=>{});
    await new Promise(resolve=>server.close(resolve));
  }
}
main().catch(err=>{console.error('FAIL POC-02A: '+err.stack);process.exitCode=1});
