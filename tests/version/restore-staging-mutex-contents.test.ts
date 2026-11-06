/** TASK-011 / TEST-020/021/026: a reserved restore-path mutex is not a
 * generic storage directory. Unknown children may be interrupted/foreign
 * restore evidence; a read-only scan must not treat them as a clean path.
 */
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hasInterruptedRestoreStaging} from '../../src/version/restore-staging-residue';

test('TASK-011/TEST-020/021/026: populated canonical restore mutex is foreign pending evidence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-restore-mutex-contents-'));
 try{
  const sourceParent=join(root,'selected');
  const recoveryStore=join(root,'recoveries');
  await mkdir(sourceParent);
  await mkdir(recoveryStore);
  const mutexName='.uah-restore-path-'+'a'.repeat(64);
  for(const directory of [sourceParent,recoveryStore]){
   const mutex=join(directory,mutexName);
   await mkdir(mutex);
   assert.equal(await hasInterruptedRestoreStaging(
    directory,undefined,undefined,
    directory===sourceParent?'source-parent':'recovery-store'),false,
    'empty, canonical cooperative lock remains a recognized namespace entry');
   const foreign=join(mutex,'unknown-restore-evidence');
   await writeFile(foreign,'foreign recovery contents');
   assert.equal(await hasInterruptedRestoreStaging(
    directory,undefined,undefined,
    directory===sourceParent?'source-parent':'recovery-store'),true,
    'foreign children inside a reserved lock must block a clean scan');
   assert.equal(await readFile(foreign,'utf8'),'foreign recovery contents',
    'read-only inspection must preserve foreign evidence');
   assert.deepEqual(await readdir(mutex),['unknown-restore-evidence']);
   await rm(foreign);
   assert.equal(await hasInterruptedRestoreStaging(
    directory,undefined,undefined,
    directory===sourceParent?'source-parent':'recovery-store'),false);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
