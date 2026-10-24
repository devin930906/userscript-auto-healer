/** TASK-011 / TEST-020/021/026: bounded native-only recovery inventory. */
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createVerifiedBackupOnly} from '../../src/version/verified-backup';
import {restoreVerifiedOriginalNativeOnly} from '../../src/version/native-restore-transaction';
import {inspectNativeRestoreIntentInventoryReadOnly} from '../../src/version/restore-intent-inventory';
const original=Buffer.from('// ==UserScript==\n// @name old\n// ==/UserScript==\n');
const updated=Buffer.from('// ==UserScript==\n// @name new\n// ==/UserScript==\n');
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');

test('TASK-011/TEST-020/021: inspect original/displaced and reject forged journal with no source mutation',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-intent-inventory-'));
 try{
  const sourcePath=join(home,'selected.user.js'),backupDirectory=join(home,'recoveries');
  await mkdir(backupDirectory);await writeFile(sourcePath,original);
  const backup=await createVerifiedBackupOnly({
   sourcePath,backupDirectory,expectedSha256:sha(original),userApproved:true
  });
  assert.equal(backup.status,'BACKUP_ONLY');if(backup.status!=='BACKUP_ONLY')return;
  await writeFile(sourcePath,updated);
  const restored=await restoreVerifiedOriginalNativeOnly({
   sourcePath,backupDirectory,backupFileName:backup.backupFileName,
   expectedCurrentSha256:sha(updated),expectedOriginalSha256:sha(original),
   expectedOriginalByteLength:original.length,userApproved:true,
   manualRestoreApproved:true
  });
  assert.equal(restored.status,'RESTORED_NATIVE_ONLY');
  if(restored.status!=='RESTORED_NATIVE_ONLY')return;
  const scan=()=>inspectNativeRestoreIntentInventoryReadOnly({
   sourcePath,backupDirectory,userApproved:true
  });
  const first=await scan();
  assert.equal(first.status,'RESTORE_INTENT_INVENTORY_READ_ONLY');
  if(first.status==='RESTORE_INTENT_INVENTORY_READ_ONLY')
   assert.deepEqual([first.inspected,first.originalPresent,
    first.displacedPresent,first.rejected],[1,1,0,0]);
  await writeFile(sourcePath,updated);
  const second=await scan();
  assert.equal(second.status,'RESTORE_INTENT_INVENTORY_READ_ONLY');
  if(second.status==='RESTORE_INTENT_INVENTORY_READ_ONLY')
   assert.deepEqual([second.inspected,second.originalPresent,
    second.displacedPresent,second.rejected],[1,0,1,0]);
  const before=(await readdir(backupDirectory)).sort();
  const forged='.uah-restore-'+randomUUID()+'.journal.json';
  await writeFile(join(backupDirectory,forged),'{"tampermonkeyVerified":true}');
  const third=await scan();
  assert.equal(third.status,'RESTORE_INTENT_INVENTORY_READ_ONLY');
  if(third.status==='RESTORE_INTENT_INVENTORY_READ_ONLY')
   assert.deepEqual([third.inspected,third.originalPresent,
    third.displacedPresent,third.rejected],[2,0,1,1]);
  assert.deepEqual((await readdir(backupDirectory)).sort(),[...before,forged].sort());
  assert.deepEqual(await readFile(sourcePath),updated);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('TASK-011/TEST-026: linked directory and journal scan overflow cannot produce an inventory receipt',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-intent-inventory-boundary-'));
 try{
  const sourcePath=join(home,'selected.user.js'),directory=join(home,'recoveries');
  await writeFile(sourcePath,original);await mkdir(directory);
  const alias=join(home,'redirected');
  await symlink(directory,alias,process.platform==='win32'?'junction':'dir');
  const diverted=await inspectNativeRestoreIntentInventoryReadOnly({
   sourcePath,backupDirectory:alias,userApproved:true
  });
  assert.deepEqual([diverted.status,'reason' in diverted?diverted.reason:null],
   ['BLOCKED','UNSAFE_PATH']);
  for(let i=0;i<33;i++)
   await writeFile(join(directory,'.uah-restore-'+randomUUID()+'.journal.json'),'bad');
  const overflow=await inspectNativeRestoreIntentInventoryReadOnly({
   sourcePath,backupDirectory:directory,userApproved:true
  });
  assert.deepEqual([overflow.status,'reason' in overflow?overflow.reason:null],
   ['BLOCKED','SCAN_LIMIT']);
  assert.equal((await readdir(directory)).length,33);
  assert.deepEqual(await readFile(sourcePath),original);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('TASK-011/TEST-026: adversarial inventory inputs cannot invoke getters or Proxy traps',async()=>{
 let getters=0,traps=0;
 const values={sourcePath:'C:\\script.user.js',backupDirectory:'C:\\safe',userApproved:true};
 const accessor=Object.defineProperty({...values},'sourcePath',{get(){getters++;throw Error('executed');}});
 const proxied=new Proxy(values,{get(){traps++;throw Error('executed');}});
 for(const c of [accessor,proxied,{...values,userApproved:false},
   {...values,automaticPatchAllowed:true}]){
  const result=await inspectNativeRestoreIntentInventoryReadOnly(c);
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.automaticPatchAllowed,false);
  assert.equal(result.automaticRollbackAllowed,false);
 }
 assert.equal(getters,0);assert.equal(traps,0);
});
