/** TASK-007 / TEST-017/026: never publish disposable manager-install capabilities in CI logs. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
