/** TASK-007 / TEST-017/026: never publish disposable manager-install capabilities in CI logs. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';

const source=readFileSync(resolve(process.cwd(),'poc/windows-tampermonkey-cloud.cjs'),'utf8');

test('TASK-007/TEST-017/026: raw manager confirmation body and embedded script source are not printed',()=>{
 // The observed UI contains /install.user.js?key= and the generated
 // userscript with its short-lived GM receipt token. Both are bearer secrets.
 assert.doesNotMatch(source,/visibleText\s*:\s*question(?:\.slice)?/,
  'printing ask.html body leaks the install URL and embedded script token');
 assert.doesNotMatch(source,/console\.log\(['"]OPTIONS_UI_TEXT\s/,
  'complete manager settings UI must never be logged');
});

test('TASK-007/TEST-017/026: navigation failures never log raw URL-bearing exception messages',()=>{
 assert.doesNotMatch(source,/String\(error\)\.slice\(/,
  'raw Playwright navigation errors may disclose capability URLs');
 assert.doesNotMatch(source,/String\(error\?\.stack\|\|error\)/,
  'full stacks may contain installation URLs or embedded secrets');
});

test('TASK-007/TEST-017/026: manager URL diagnostics never log raw URLs with fragment-embedded capabilities',()=>{
 // Real native-gm Windows job #124592885695 leaked ?key= inside the URL
 // encoded by Tampermonkey's vendor installer as a fragment (#url=...).
 // A regular expression on only top-level ?key= is not sufficient.
 assert.doesNotMatch(source,/p\\.url\\(\\)\\.replace\\(/,
  'never copy arbitrary browser URLs to Actions logs after query-only redaction');
});

test('TASK-007/TEST-017/026: manager page classifications are bounded and contain no bearer URL values',()=>{
 const helperPath=resolve(process.cwd(),'poc/safe-tampermonkey-page-label.cjs');
 assert.ok(existsSync(helperPath),
  'isolated manager page labels must come from a value-free classification helper');
 const {classifyTampermonkeyPageUrl}=require(helperPath) as {
  classifyTampermonkeyPageUrl:(url:string)=>string
 };
 const cases:[string,string][]=[
  ['about:blank','BLANK_PAGE'],
  ['https://www.tampermonkey.net/script_installation.php#url=http://127.0.0.1:53567/install.user.js?key=DEMO_SECRET_ABC','VENDOR_INSTALL_FLOW'],
  ['chrome-extension://abcdefghabcdefghabcdefghabcdefgh/ask.html?aid=DEMO_SECRET_ABC','MANAGER_CONFIRMATION'],
  ['chrome-extension://abcdefghabcdefghabcdefghabcdefgh/options.html#token=DEMO_SECRET_ABC','MANAGER_OPTIONS'],
  ['http://127.0.0.1:53567/?mode=broken#key=DEMO_SECRET_ABC','DISPOSABLE_LOCAL_PAGE'],
  ['https://www.tampermonkey.net.evil.example/?key=DEMO_SECRET_ABC','OTHER_PAGE'],
  ['https://unknown.example/#url=http://127.0.0.1:53567/install.user.js?key=DEMO_SECRET_ABC','OTHER_PAGE'],
  ['javascript:alert("DEMO_SECRET_ABC")','OTHER_PAGE']
 ];
 for(const [url,expected] of cases){
  const label=classifyTampermonkeyPageUrl(url);
  assert.equal(label,expected,'classification mismatch for synthetic URL');
  assert.doesNotMatch(label,/DEMO_SECRET_ABC|key=|url=|53567|abcdefgh/i,
   'manager page summaries must contain no URL or transient secret');
 }
 assert.equal(classifyTampermonkeyPageUrl('not a URL'),'OTHER_PAGE');
});
