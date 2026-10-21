import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,join} from 'node:path';
import {createVerifiedBackupOnly} from '../../src/version/verified-backup';
import {prepareManualOriginalRestoreSelection} from '../../src/version/manual-restore-selection';
import {restoreVerifiedOriginalNativeOnly} from '../../src/version/native-restore-transaction';

const original=Buffer.from('// ==UserScript==\n// @name Original\n// ==/UserScript==\n');
const changed=Buffer.from('// ==UserScript==\n// @name Changed\n// ==/UserScript==\n');
const sha=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
async function fixture(run:(ctx:{source:string;backupFile:string;backupDirectory:string})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'uah-manual-restore-ui-'));
 const source=join(root,'owned.user.js'),backupDirectory=join(root,'backup');
 try{
  await mkdir(backupDirectory);
  await writeFile(source,original);
  const b=await createVerifiedBackupOnly({
   sourcePath:source,backupDirectory,expectedSha256:sha(original),userApproved:true
  });
  assert.equal(b.status,'BACKUP_ONLY',JSON.stringify(b));
  if(b.status!=='BACKUP_ONLY')return;
  await writeFile(source,changed);
  await run({source,backupFile:join(backupDirectory,b.backupFileName),backupDirectory});
 }finally{await rm(root,{recursive:true,force:true});}
}

test('TASK-011/TEST-020/021: selected source-bound backup is checked before explicit manual restore',async()=>{
 await fixture(async({source,backupFile,backupDirectory})=>{
  const ready=await prepareManualOriginalRestoreSelection(source,backupFile);
  assert.equal(ready.status,'AWAITING_NATIVE_RESTORE_CONSENT',JSON.stringify(ready));
  if(ready.status!=='AWAITING_NATIVE_RESTORE_CONSENT')return;
  assert.equal(ready.expectedCurrentSha256,sha(changed));
  assert.equal(ready.expectedOriginalSha256,sha(original));
  assert.equal(ready.backupFileName,basename(backupFile));
  assert.deepEqual(await readFile(source),changed,'preflight must never modify source');
  const denied=await restoreVerifiedOriginalNativeOnly({
   ...ready,userApproved:false,manualRestoreApproved:false
  });
  assert.equal(denied.status,'BLOCKED');
  // The privileged Electron handler removes status before building the real
  // transaction input, and alone supplies consent from its own OS dialog.
  const {status:_,...options}=ready;
  const restored=await restoreVerifiedOriginalNativeOnly({
   ...options,userApproved:true,manualRestoreApproved:true
  });
  assert.equal(restored.status,'RESTORED_NATIVE_ONLY',JSON.stringify(restored));
  assert.deepEqual(await readFile(source),original);
  if(restored.status==='RESTORED_NATIVE_ONLY'){
   assert.deepEqual(await readFile(join(backupDirectory,restored.displacedBackupFileName)),changed);
   assert.equal(restored.automaticPatchAllowed,false);
   assert.equal(restored.automaticRollbackAllowed,false);
   assert.equal(restored.businessVerified,false);
  }
 });
});

test('TASK-011/TEST-026: wrong source/backup, self-selection and equal bytes fail without writes',async()=>{
 await fixture(async({source,backupFile,backupDirectory})=>{
  const foreign=join(join(backupDirectory,'..'),'foreign.user.js');
  await writeFile(foreign,changed);
  const bad=await prepareManualOriginalRestoreSelection(foreign,backupFile);
  assert.deepEqual(bad,{status:'BLOCKED',reason:'BACKUP_UNVERIFIED'});
  assert.deepEqual(await prepareManualOriginalRestoreSelection(source,source),
   {status:'BLOCKED',reason:'INVALID_SELECTION'});
  assert.deepEqual(await readFile(source),changed);
  await writeFile(source,original);
  const equal=await prepareManualOriginalRestoreSelection(source,backupFile);
  assert.deepEqual(equal,{status:'BLOCKED',reason:'SOURCE_UNCHANGED'});
 });
});

test('TASK-011/TEST-020: a post-preflight source change cannot bypass native restore rechecks',async()=>{
 await fixture(async({source,backupFile})=>{
  const ready=await prepareManualOriginalRestoreSelection(source,backupFile);
  assert.equal(ready.status,'AWAITING_NATIVE_RESTORE_CONSENT');
  if(ready.status!=='AWAITING_NATIVE_RESTORE_CONSENT')return;
  await writeFile(source,Buffer.from('// ==UserScript==\n// third party edit\n'));
  const {status:_,...options}=ready;
  const result=await restoreVerifiedOriginalNativeOnly({
   ...options,userApproved:true,manualRestoreApproved:true
  });
  assert.equal(result.status,'BLOCKED');
  assert.deepEqual(await readFile(source),Buffer.from('// ==UserScript==\n// third party edit\n'));
 });
});
