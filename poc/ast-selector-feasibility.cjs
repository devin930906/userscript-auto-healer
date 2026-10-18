// POC-04B only: static JavaScript AST feasibility, never executes user scripts.
const assert = require('node:assert/strict');
const acorn = require('acorn');
const fixture = [
  'function bindHandlers(root, className, method) {',
  '  const action = root.querySelector("#new-action");',
  "  const cssClass = root.querySelector('.' + className);",
  '  const menu = root.querySelector(`[data-kind="menu"]`);',
  '  function inner() {',
  '    return root.querySelectorAll("." + className);',
  '  }',
  '  const old = document.getElementById("legacy");',
  '  const dynamicMethod = root[method]("#unknown");',
  '  return {action, cssClass, menu, inner, old, dynamicMethod};',
  '}',
].join('\n');
const ast = acorn.parse(fixture,{ecmaVersion:'latest',sourceType:'script',locations:true});
const methods = new Set(['querySelector','querySelectorAll','getElementById','getElementsByClassName','getElementsByName','getElementsByTagName']);
const results = [];
function argData(x) {
  if(!x) return {kind:'needs-runtime-confirmation',selector:null};
  if(x.type==='Literal'&&typeof x.value==='string')return {kind:'literal',selector:x.value};
  if(x.type==='TemplateLiteral'&&!x.expressions.length)return {kind:'literal',selector:x.quasis.map(q=>q.value.cooked).join('')};
  return {kind:'needs-runtime-confirmation',selector:null};
}
function visit(x,fn='top-level') {
  if(!x||typeof x!=='object')return;
  const owner=x.type==='FunctionDeclaration' ? x.id?.name||'<anonymous>' : fn;
  if(x.type==='CallExpression'&&x.callee?.type==='MemberExpression'){
    const c=x.callee;
    const method=c.computed?(c.property.type==='Literal'?c.property.value:null):c.property.name;
    const known=methods.has(method);
    if(known||c.computed&&method===null){
      const data=argData(x.arguments[0]);
      results.push({line:x.loc.start.line,column:x.loc.start.column+1,owner,method:known?method:'<dynamic-member>',selector:known?data.selector:null,kind:known?data.kind:'needs-runtime-confirmation'});
    }
  }
  for(const [key,v] of Object.entries(x)){
    if(['loc','start','end'].includes(key))continue;
    if(Array.isArray(v))v.forEach(y=>y?.type&&visit(y,owner));
    else if(v?.type)visit(v,owner);
  }
}
visit(ast);
assert.equal(results.length,6);
const m=Object.fromEntries(results.map(x=>[x.line,x]));
assert.deepEqual([m[2].selector,m[2].owner],['#new-action','bindHandlers']);
assert.equal(m[3].kind,'needs-runtime-confirmation');
assert.deepEqual([m[4].kind,m[4].selector],['literal','[data-kind="menu"]']);
assert.deepEqual([m[6].kind,m[6].owner],['needs-runtime-confirmation','inner']);
assert.equal(m[8].selector,'legacy');
assert.deepEqual([m[9].method,m[9].kind],['<dynamic-member>','needs-runtime-confirmation']);
assert.equal(results.filter(x=>x.kind==='literal').length,3);
assert.equal(results.filter(x=>x.kind==='needs-runtime-confirmation').length,3);
console.log('PASS POC-04B: acorn parsed 3 literal and 3 dynamic/unknown selector sites with source lines and owners');
console.log(JSON.stringify(results));
console.log('Not an auto-repair feature; no script code was run and no patch is generated.');
