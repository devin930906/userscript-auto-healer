/** TASK-011 / TEST-020/021/026: a read-only restore observation must not
 * certify the old recovery namespace if an interrupted transaction appears
 * during its final asynchronous source fingerprint.
 */
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createVerifiedBackupOnly} from '../../src/version/verified-backup';
import {restoreVerifiedOriginalNativeOnly} from '../../src/version/native-restore-transaction';
import {inspectNativeRestoreIntentReadOnly} from '../../src/version/restore-intent-inspection';

const original=Buffer.from('// ==UserScript==\n// @name Original\n// ==/UserScript==\n');
const changed=Buffer.from('// ==UserScript==\n// @name Modified\n// ==/UserScript==\n');
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');

test('TASK-011/TEST-020/026: new pending recovery intent during last source check revokes read-only observation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'uah-restore-intent-dir-race-'));
 const sourcePath=join(root,'selected.user.js');
 const backupDirectory=join(root,'recoveries');
 try{
  await mkdir(backupDirectory);
  await writeFile(sourcePath,original);
  const backup=await createVerifiedBackupOnly({
   sourcePath,backupDirectory,expectedSha256:sha(original),userApproved:true
  });
  assert.equal(backup.status,'BACKUP_ONLY');
  if(backup.status!=='BACKUP_ONLY')return;
  await writeFile(sourcePath,changed);
  const restored=await restoreVerifiedOriginalNativeOnly({
   sourcePath,backupDirectory,backupFileName:backup.backupFileName,
   expectedCurrentSha256:sha(changed),
   expectedOriginalSha256:sha(original),
   expectedOriginalByteLength:original.length,
   userApproved:true,manualRestoreApproved:true
  });
  assert.equal(restored.status,'RESTORED_NATIVE_ONLY',JSON.stringify(restored));
  if(restored.status!=='RESTORED_NATIVE_ONLY')return;
  const snapshot=require('../../src/version/source-snapshot') as
    typeof import('../../src/version/source-snapshot');
  const real=snapshot.verifyApprovedSourceFingerprint;
  const unexpected=join(backupDirectory,'.uah-restore-'+randomUUID()+'.pending');
  let checks=0;
  t.mock.method(snapshot,'verifyApprovedSourceFingerprint',async(
   ...args:Parameters<typeof real>)=>{
    const observed=await real(...args);
    if(++checks===2){
     assert.equal(observed.status,'MATCHED_READ_ONLY');
     // This file is written after the initial recovery directory snapshot
     // and its earlier lstat, but before the inspector returns its receipt.
     await writeFile(unexpected,Buffer.from('interrupted recovery intent'));
    }
    return observed;
  });
  const result=await inspectNativeRestoreIntentReadOnly({
   sourcePath,backupDirectory,journalFileName:restored.journalFileName,
   userApproved:true
  });
  assert.equal(checks,2,'fixture must inject after last source fingerprint');
  assert.equal(result.status,'BLOCKED',JSON.stringify(result));
  if(result.status==='BLOCKED')assert.equal(result.reason,'UNSAFE_JOURNAL');
  assert.equal(result.automaticPatchAllowed,false);
  assert.equal(result.automaticRollbackAllowed,false);
  assert.deepEqual(await readFile(sourcePath),original);
  assert.deepEqual(await readFile(unexpected),Buffer.from('interrupted recovery intent'),
   'read-only safety inspection must never remove the foreign crash record');
 }finally{t.mock.reset();await rm(root,{recursive:true,force:true});}
});
