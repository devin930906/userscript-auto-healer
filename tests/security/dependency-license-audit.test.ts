/** TASK-018 / GATE-006/010: check installed locked dependency license disclosures.
 * This is metadata / installed-manifest consistency, NOT legal approval.
 */
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';

const verifier=resolve(__dirname,'../../../scripts/verify-locked-dependency-licenses.cjs');
type Entry={version:string;license?:string;optional?:boolean};
function fixture(t:{after:(cb:()=>void)=>void},
 entries:Record<string,Entry>, installed:Record<string,Entry>={}):string{
 const root=mkdtempSync(join(tmpdir(),'uah-license-audit-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 writeFileSync(join(root,'package-lock.json'),JSON.stringify({
  name:'isolated-audit-fixture',lockfileVersion:3,
  packages:{'':{name:'isolated-audit-fixture',version:'0.0.0'},...entries}
 }));
 for(const [key,pkg] of Object.entries(installed)){
  const where=join(root,key,'package.json');
  mkdirSync(dirname(where),{recursive:true});
  writeFileSync(where,JSON.stringify(pkg));
 }
 return root;
}
function audit(cwd:string){
 return spawnSync(process.execPath,[verifier],{cwd,encoding:'utf8',timeout:20000});
}
test('TASK-018/GATE-006: real locked dependencies have inspected license metadata',()=>{
 const result=audit(resolve(__dirname,'../../..'));
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
 assert.match(result.stdout,/LOCKED_DEPENDENCY_LICENSE_METADATA_OK/);
 assert.match(result.stdout,/packages=17\b/);
});
test('TASK-018/GATE-006: missing dependency license cannot pass',t=>{
 const root=fixture(t,{'node_modules/unlicensed':{version:'1.0.0'}},{
  'node_modules/unlicensed':{version:'1.0.0',license:'MIT'}
 });
 const result=audit(root);
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/MISSING_LICENSE_DECLARATION/);
});
test('TASK-018/GATE-006: installed manifest mismatch is not accepted as lockfile evidence',t=>{
 const root=fixture(t,{'node_modules/pkg':{version:'1.0.0',license:'MIT'}},{
  'node_modules/pkg':{version:'1.0.0',license:'ISC'}
 });
 const result=audit(root);
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/INSTALLED_LICENSE_MISMATCH/);
});
test('TASK-018/GATE-006: valid nested package and absent optional install remain distinguishable',t=>{
 const root=fixture(t,{
  'node_modules/@scope/pkg':{version:'1.0.0',license:'Apache-2.0'},
  'node_modules/parent/node_modules/child':{version:'2.0.0',license:'MIT'},
  'node_modules/optional':{version:'1.0.0',license:'ISC',optional:true}
 },{
  'node_modules/@scope/pkg':{version:'1.0.0',license:'Apache-2.0'},
  'node_modules/parent/node_modules/child':{version:'2.0.0',license:'MIT'}
 });
 const result=audit(root);
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
 assert.match(result.stdout,/packages=3\b/);
 assert.match(result.stdout,/optionalAbsent=1\b/);
});
test('TASK-018/GATE-006: traversal and forged package paths are refused',t=>{
 const root=fixture(t,{'node_modules/../../escape':{version:'1.0.0',license:'MIT'}});
 const result=audit(root);
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/INVALID_LOCKED_PACKAGE_PATH/);
});
