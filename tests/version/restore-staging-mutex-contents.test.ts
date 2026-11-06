/** TASK-011 / TEST-020/021/026: a reserved restore-path mutex is not a
 * generic storage directory. Unknown children may be interrupted/foreign
 * restore evidence; a read-only scan must not treat them as a clean path.
 */
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
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


test('TASK-011/TEST-020/026: late foreign contents in an initially empty restore mutex block clean inventory',async t=>{
 const root=await mkdtemp(join(tmpdir(),'uah-late-restore-mutex-'));
 try{
  const mutex=join(root,'.uah-restore-path-'+'a'.repeat(64));
  await mkdir(mutex);
  const journal=join(root,'.uah-restore-'+randomUUID()+'.journal.json');
  const prefix='fixture~'+'b'.repeat(24);
  await writeFile(journal,JSON.stringify({
   schema:1,state:'RESTORE_INTENT_UNVERIFIED',
   sourcePathSha256:'c'.repeat(64),
   originalSha256:'d'.repeat(64),displacedSha256:'e'.repeat(64),
   originalBackupFileName:prefix+'.'+randomUUID()+'.backup.user.js',
   displacedBackupFileName:prefix+'.'+randomUUID()+'.backup.user.js',
   automaticPatchAllowed:false,automaticRollbackAllowed:false
  })+'\\n');
  assert.equal(await hasInterruptedRestoreStaging(root),false,
   'an empty canonical lock and a valid published journal start clean');
  const fsPromises=require('node:fs/promises') as typeof import('node:fs/promises');
  const originalReadDir=fsPromises.readdir;
  const inspector=require('../../src/version/restore-intent-inspection') as
   typeof import('../../src/version/restore-intent-inspection');
  const originalInspect=inspector.hasStructurallyValidNativeRestoreJournalReadOnly;
  const foreign=join(mutex,'late-foreign-recovery-evidence');
  let scannedEmpty=false,inserted=false;
  t.mock.method(fsPromises,'readdir',async (...args:Parameters<typeof originalReadDir>)=>{
   const entries=await originalReadDir(...args);
   if(String(args[0])===mutex&&Array.isArray(entries)&&entries.length===0)
    scannedEmpty=true;
   return entries;
  });
  t.mock.method(inspector,'hasStructurallyValidNativeRestoreJournalReadOnly',async(path:string)=>{
   const valid=await originalInspect(path);
   if(valid&&scannedEmpty&&!inserted){
    // The native recovery scanner already accepted the mutex as empty;
    // now a later await while validating another journal gives an external
    // process time to insert evidence INSIDE the mutex. The outer recovery
    // directory's entry list and timestamps need not change.
    await writeFile(foreign,'late foreign evidence');
    inserted=true;
   }
   return valid;
  });
  assert.equal(await hasInterruptedRestoreStaging(root),true,
   'a clean result must not ignore later edits inside previously scanned locks');
  assert.equal(scannedEmpty,true);
  assert.equal(inserted,true);
  assert.equal(await readFile(foreign,'utf8'),'late foreign evidence',
   'scanner must not delete or rewrite unknown recovery evidence');
 }finally{t.mock.reset();await rm(root,{recursive:true,force:true});}
});
