/** TASK-007 / TEST-017/026: strict official Store-source acquisition must not silently fall back to a vendor URL. */
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';

type PackageSourcePlan = Readonly<{
  mode:'store-only'|'vendor-preferred';
  strict:boolean;
  sources:readonly Readonly<{kind:'chrome-web-store'|'vendor';url:string}>[];
}>;

const integrity = require(join(process.cwd(),'poc/crx3-package-integrity.cjs')) as {
  resolveTampermonkeyPackageSources?: (mode?:string)=>PackageSourcePlan;
};

test('TASK-007/TEST-017: strict Store-only source plan contains exactly the official update endpoint and no vendor fallback',()=>{
  const resolveSources=integrity.resolveTampermonkeyPackageSources;
  assert.equal(typeof resolveSources,'function',
    'the signed-package source policy must be exposed as an executable, testable contract');
  if(typeof resolveSources!=='function')return;
  const plan=resolveSources('store-only');
  assert.deepEqual(plan,{
    mode:'store-only',
    strict:true,
    sources:[{
      kind:'chrome-web-store',
      url:'https://clients2.google.com/service/update2/crx?response=redirect&prodversion=155.0.0.0&acceptformat=crx3&x=id%3Ddhdgffkkebhmkfjojejmpbldmpobfkfo%26uc'
    }]
  });
});

test('TASK-007/TEST-026: default and explicit vendor-preferred plans preserve source order',()=>{
  const resolveSources=integrity.resolveTampermonkeyPackageSources;
  assert.ok(resolveSources);
  const store=resolveSources('store-only').sources[0];
  const expected={
    mode:'vendor-preferred',strict:false,
    sources:[{kind:'vendor',url:'https://www.tampermonkey.net/crx/tampermonkey_stable.crx'},store]
  };
  assert.deepEqual(resolveSources(),expected);
  assert.deepEqual(resolveSources('vendor-preferred'),expected);
});

test('TASK-007/TEST-026: invalid modes cannot provide custom download endpoints',()=>{
  const resolveSources=integrity.resolveTampermonkeyPackageSources;
  assert.ok(resolveSources);
  for(const mode of ['', 'STORE-ONLY', 'https://example.invalid/package.crx']){
    assert.throws(()=>resolveSources(mode),/INVALID_TAMPERMONKEY_PACKAGE_SOURCE_MODE/);
  }
});

test('TASK-007/TEST-017: source-plan CLI emits the exact selected policy and rejects invalid modes',()=>{
  const resolveSources=integrity.resolveTampermonkeyPackageSources;
  assert.ok(resolveSources);
  const cli=join(process.cwd(),'poc/crx3-package-integrity.cjs');
  for(const mode of ['store-only','vendor-preferred']){
    const stdout=execFileSync(process.execPath,[cli,'--source-plan',mode],{encoding:'utf8'});
    assert.deepEqual(JSON.parse(stdout),resolveSources(mode));
  }
  const invalid=spawnSync(process.execPath,[cli,'--source-plan','invalid'],{encoding:'utf8'});
  assert.equal(invalid.status,1);
  assert.equal(invalid.stdout,'');
  assert.match(invalid.stderr,/INVALID_TAMPERMONKEY_PACKAGE_SOURCE_MODE/);
});
