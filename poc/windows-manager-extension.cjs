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
  '// @match       http://127.0.0.1/*',
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
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const port = server.address().port;
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless:true,
      channel:'chromium',
      args:[
        '--disable-extensions-except='+extensionDir,
        '--load-extension='+extensionDir,
      ],
    });
    let workers = context.serviceWorkers();
    if (!workers.length) {
      try { workers = [await context.waitForEvent('serviceworker',{timeout:30000})]; }
      catch(e) { throw new Error('Published userscript manager did not start a service worker: '+e.message); }
    }
    const worker = workers.find(w => w.url().startsWith('chrome-extension://'));
    assert.ok(worker,'No actual Chrome extension worker was registered');
    // Playwright may evaluate a service-worker utility world without the extension's chrome API.
    // The registered chrome-extension:// worker is the reproducible minimum proof, not a GM proof.
    const info = {id:new URL(worker.url()).host,version:manifest.version};
    assert.match(info.id,/^[a-p]{32}$/);
    console.log('PASS POC-02A: published Violentmonkey MV3 extension worker registered; ID='+info.id+'; pinned version='+info.version+'; worker='+worker.url());
    console.log('NOTE: This uses bundled Chromium, not the selected installed Google Chrome or a user Profile.');

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
        await installer.waitForTimeout(2000);
        console.log('Authentic manager install confirmation clicked in ephemeral profile.');
      } catch(err){
        console.log('INCOMPLETE authentic installer confirmation: '+String(err.message).slice(0,230));
      }
    } else console.log('INCOMPLETE authentic installer: no manager confirmation tab observed');
    const probe=await context.newPage();
    await probe.goto('http://127.0.0.1:'+port+'/fixture',{waitUntil:'domcontentloaded'});
    let execution={installed:false};
    try {
      await probe.waitForFunction(()=>document.documentElement.dataset.userscriptFixture==='executed',{timeout:7000});
      execution={installed:true,gm:await probe.evaluate(()=>document.documentElement.dataset.gmApiPresent)};
    } catch(e){}
    if (execution.installed && execution.gm==='true')
      console.log('PASS POC-02B: .user.js really executed under extension context, GM_getValue available.');
    else console.log('INCOMPLETE POC-02B: no verified userscript injection/GM API; installation/real assertions still blocked; observed='+JSON.stringify(execution));
    await page.close(); await probe.close();
  } finally {
    if (context) await context.close().catch(()=>{});
    await new Promise(resolve=>server.close(resolve));
  }
}
main().catch(err=>{console.error('FAIL POC-02A: '+err.stack);process.exitCode=1});
