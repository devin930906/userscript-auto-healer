/** TASK-011 / TEST-020/026: Windows path aliases must fail before
 * privileged backup/restore selection can acquire a path-derived mutex.
 * A real file under an ordinary directory is the positive control.
 */
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hasUnsafePathLink} from '../../src/version/path-boundary';

test('TEST-020/026: Windows trailing dot/space ancestor aliases are rejected',async t=>{
 if(process.platform!=='win32'){
  t.skip('Win32 filesystem path normalization is Windows-only');return;
 }
 const root=await mkdtemp(join(tmpdir(),'uah-path-alias-'));
 try{
  const parent=join(root,'selected');
  await mkdir(parent);
  const source=join(parent,'safe.user.js');
  const bytes=Buffer.from('// ==UserScript==\\n// @name Safely selected\\n// ==/UserScript==\\n');
  await writeFile(source,bytes);
  assert.equal(await hasUnsafePathLink(source),false,
   'unambiguous native-selected path remains eligible');
  for(const alias of ['selected.','selected ']){
   const unsafe=join(root,alias,'safe.user.js');
   assert.equal(await hasUnsafePathLink(unsafe),true,
    'ambiguous Win32 ancestor must fail closed before following its alias: '+alias);
  }
  assert.deepEqual(await readFile(source),bytes,'boundary does not alter source');
 }finally{await rm(root,{recursive:true,force:true});}
});
