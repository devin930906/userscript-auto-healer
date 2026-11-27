/** TASK-007 / TEST-017/026: strict official Store-source acquisition must not silently fall back to a vendor URL. */
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {join} from 'node:path';

type PackageSourcePlan = Readonly<{
  mode:'store-only'|'vendor-preferred';
  strict:boolean;
  sources:readonly Readonly<{kind:'chrome-web-store'|'vendor';url:string}>[];
}>;

const integrity = require(join(process.cwd(),'poc/crx3-package-integrity.cjs')) as {
  resolveTampermonkeyPackageSources?: (mode:string)=>PackageSourcePlan;
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
