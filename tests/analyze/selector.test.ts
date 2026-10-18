import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { analyzeSelectors } from '../../src/analyze/selector-analyzer';

test('TEST-011: literal and dynamic selectors with line/owner/scope',()=>{
  const source=[
    'function bindHandlers(root, className, method) {',
    '  const action = root.querySelector("#new-action");',
    "  const cssClass = root.querySelector('.' + className);",
    '  const menu = root.querySelector(' + String.fromCharCode(96) + '[data-kind="menu"]' + String.fromCharCode(96) + ');',
    '  function inner() {',
    '    return root.querySelectorAll("." + className);',
    '  }',
    '  const old = document.getElementById("legacy");',
    '  const dynamicMethod = root[method]("#unknown");',
    '  return {action, cssClass, menu, inner, old, dynamicMethod};',
    '}'
  ].join('\n');
  const result=analyzeSelectors(source);
  assert.equal(result.status,'OK');
  assert.equal(result.sites.length,6);
  const byLine=new Map(result.sites.map(site=>[site.line,site]));
  assert.equal(byLine.get(2)?.selector,'#new-action');
  assert.equal(byLine.get(2)?.owner,'bindHandlers');
  assert.equal(byLine.get(3)?.kind,'needs-runtime-confirmation');
  assert.equal(byLine.get(4)?.selector,'[data-kind="menu"]');
  assert.equal(byLine.get(6)?.scope,'bindHandlers/inner');
  assert.equal(byLine.get(8)?.selector,'legacy');
  assert.equal(byLine.get(9)?.method,'<dynamic-member>');
  assert.equal(byLine.get(9)?.selector,null);
});
test('TEST-011: fallback grouping is not proof of operation',()=>{
  const result=analyzeSelectors('const x=document.querySelector("#a") || document.querySelector("#b");');
  assert.equal(result.status,'OK');
  assert.equal(result.sites.length,2);
  assert.equal(result.sites[0].fallbackGroup,result.sites[1].fallbackGroup);
  assert.notEqual(result.sites[0].fallbackGroup,null);
});
test('TEST-011: source is parsed but never executed, malformed syntax fails',()=>{
  const result=analyzeSelectors('document.querySelector("#a");globalThis.__uAstExecuted=true;');
  assert.equal(result.status,'OK');
  assert.equal((globalThis as Record<string,unknown>).__uAstExecuted,undefined);
  assert.deepEqual(analyzeSelectors('function broken('),{status:'PARSE_ERROR',sites:[]});
});


test('TEST-011: assigned function expressions and callbacks retain accurate scope',()=>{
  const source=[
    'const first=function(){return document.querySelector("#first");};',
    'const second=()=>document.querySelector("#second");',
    'function outer(){const third=function(){return document.querySelector("#third");};}',
    'document.addEventListener("load",()=>document.querySelector("#callback"));'
  ].join('\n');
  const result=analyzeSelectors(source);
  assert.equal(result.status,'OK');
  assert.deepEqual(result.sites.map(s=>({selector:s.selector,scope:s.scope})),[
    {selector:'#first',scope:'first'},
    {selector:'#second',scope:'second'},
    {selector:'#third',scope:'outer/third'},
    {selector:'#callback',scope:'<arrow>'}
  ]);
});
