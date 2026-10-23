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
  // Reserved Win32 device names also accept extensions. They must be
  // denied lexically, before lstat or any future privileged path operation.
  for(const alias of ['CON','con.txt','PRN','AUX','NUL',
    'COM1','LPT9','COM¹','LPT²','CONIN
 }finally{await rm(root,{recursive:true,force:true});}
});
,'CONOUT
 }finally{await rm(root,{recursive:true,force:true});}
});
]){
   assert.equal(await hasUnsafePathLink(join(root,alias,'safe.user.js')),true,
    'Win32 device namespace must not be used as an ancestor: '+alias);
  }
  for(const alias of ['CON.user.js','NUL.txt','COM3.user.js']){
   assert.equal(await hasUnsafePathLink(join(parent,alias)),true,
    'Win32 device namespace must not be selected as source: '+alias);
  }
  assert.deepEqual(await readFile(source),bytes,'boundary does not alter source');
 }finally{await rm(root,{recursive:true,force:true});}
});
