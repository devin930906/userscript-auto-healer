/** TASK-011 / TEST-020/021/026: bounded native-only recovery inventory. */
import {test,mock} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,rm,symlink,utimes,writeFile} from 'node:fs/promises';
import {promises as fsPromises} from 'node:fs';
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

test('TASK-011/TEST-020/026: concurrent directory insertion during scan invalidates entire recovery summary',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-intent-inventory-race-'));
 try{
  const sourcePath=join(home,'selected.user.js');
  const backupDirectory=join(home,'recoveries');
  await writeFile(sourcePath,original);
  await mkdir(backupDirectory);
  // Pin mtime to the past so a concurrent namespace edit produces a
  // distinguishable directory identity even on coarse-timestamp volumes.
  await utimes(backupDirectory,new Date('2000-01-01T00:00:00Z'),
   new Date('2000-01-01T00:00:00Z'));
  const before=await readFile(sourcePath);
  const originalOpen=fsPromises.opendir.bind(fsPromises);
  let inserted=0;
  const patched=mock.method(fsPromises,'opendir',
   (async(...args:Parameters<typeof fsPromises.opendir>)=>{
    const handle=await originalOpen(...args);
    // Inject external directory mutation AFTER the production pre-scan
    // identity snapshot and BEFORE its actual enumeration.
    inserted++;
    await writeFile(join(backupDirectory,'external-concurrent-edit.txt'),'x');
    return handle;
   }) as typeof fsPromises.opendir);
  try{
   const result=await inspectNativeRestoreIntentInventoryReadOnly({
    sourcePath,backupDirectory,userApproved:true
   });
   assert.deepEqual([result.status,'reason' in result?result.reason:null],
    ['BLOCKED','UNSAFE_PATH']);
   assert.equal('inspected' in result,false,
    'a changed directory must never produce a partial trusted count');
  }finally{patched.mock.restore();}
  assert.equal(inserted,1);
  assert.deepEqual(await readFile(sourcePath),before);
  assert.deepEqual(await readdir(backupDirectory),['external-concurrent-edit.txt']);
 }finally{await rm(home,{recursive:true,force:true});}
});


test('TASK-011/TEST-020/026: journal edited after individual inspection cannot yield a stale inventory count',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-inventory-journal-race-'));
 try{
  const sourcePath=join(home,'selected.user.js');
  const backupDirectory=join(home,'recoveries');
  await mkdir(backupDirectory);
  await writeFile(sourcePath,original);
  const backup=await createVerifiedBackupOnly({
   sourcePath,backupDirectory,expectedSha256:sha(original),userApproved:true
  });
  assert.equal(backup.status,'BACKUP_ONLY');
  if(backup.status!=='BACKUP_ONLY')return;
  await writeFile(sourcePath,updated);
  const restored=await restoreVerifiedOriginalNativeOnly({
   sourcePath,backupDirectory,backupFileName:backup.backupFileName,
   expectedCurrentSha256:sha(updated),expectedOriginalSha256:sha(original),
   expectedOriginalByteLength:original.length,userApproved:true,
   manualRestoreApproved:true
  });
  assert.equal(restored.status,'RESTORED_NATIVE_ONLY');
  const journal=(await readdir(backupDirectory)).find(n=>n.endsWith('.journal.json'));
  assert.ok(journal,'real native restore must publish its journal');
  const journalPath=join(backupDirectory,journal);
  const inspection=require('../../src/version/restore-intent-inspection') as
   typeof import('../../src/version/restore-intent-inspection');
  const originalInspect=inspection.inspectNativeRestoreIntentReadOnly;
  let edited=0;
  const patched=mock.method(inspection,'inspectNativeRestoreIntentReadOnly',
   async(...args:Parameters<typeof originalInspect>)=>{
    const observed=await originalInspect(...args);
    if(observed.status==='RESTORE_INTENT_OBSERVED_READ_ONLY'&&edited++===0){
     // Simulate an uncooperative writer mutating journal BYTES after its
     // own verification, without changing the parent directory namespace.
     await writeFile(journalPath,'{"tampermonkeyVerified":true}\n');
    }
    return observed;
   });
  try{
   const result=await inspectNativeRestoreIntentInventoryReadOnly({
    sourcePath,backupDirectory,userApproved:true
   });
   assert.equal(edited,1,'the race must occur after the first valid observation');
   assert.deepEqual([result.status,'reason' in result?result.reason:null],
    ['BLOCKED','UNSAFE_PATH'],
    'a changed earlier journal cannot remain an accepted count');
   assert.equal('inspected' in result,false);
  }finally{patched.mock.restore();}
  assert.deepEqual(await readFile(sourcePath),original);
  assert.equal((await readFile(journalPath)).toString(),
   '{"tampermonkeyVerified":true}\n');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-011/TEST-020/026: in-place journal mutation after final per-item recheck blocks stale inventory',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-intent-late-rewrite-'));
 try{
  const sourcePath=join(home,'selected.user.js');
  const backupDirectory=join(home,'recoveries');
  await mkdir(backupDirectory);
  await writeFile(sourcePath,original);
  const backup=await createVerifiedBackupOnly({
   sourcePath,backupDirectory,expectedSha256:sha(original),userApproved:true
  });
  assert.equal(backup.status,'BACKUP_ONLY');
  if(backup.status!=='BACKUP_ONLY')return;
  await writeFile(sourcePath,updated);
  const restored=await restoreVerifiedOriginalNativeOnly({
   sourcePath,backupDirectory,backupFileName:backup.backupFileName,
   expectedCurrentSha256:sha(updated),expectedOriginalSha256:sha(original),
   expectedOriginalByteLength:original.length,userApproved:true,
   manualRestoreApproved:true
  });
  assert.equal(restored.status,'RESTORED_NATIVE_ONLY');
  if(restored.status!=='RESTORED_NATIVE_ONLY')return;
  const journal=(await readdir(backupDirectory)).find(n=>n.endsWith('.journal.json'));
  assert.ok(journal);
  const journalPath=join(backupDirectory,journal);
  const inspection=require('../../src/version/restore-intent-inspection') as
   typeof import('../../src/version/restore-intent-inspection');
  const actual=inspection.inspectNativeRestoreIntentReadOnly;
  let checks=0;
  const patched=mock.method(inspection,'inspectNativeRestoreIntentReadOnly',
   async(...args:Parameters<typeof actual>)=>{
    const result=await actual(...args);
    if(result.status==='RESTORE_INTENT_OBSERVED_READ_ONLY'&&++checks===2){
     // The directory entries have not changed. A native external editor
     // rewrites the already-rechecked journal before the aggregate returns.
     await writeFile(journalPath,'{"tampermonkeyVerified":true}\\n');
    }
    return result;
   });
  try{
   const inventory=await inspectNativeRestoreIntentInventoryReadOnly({
    sourcePath,backupDirectory,userApproved:true
   });
   assert.ok(checks>=2,'must pass through the previously final per-item recheck');
   assert.deepEqual([inventory.status,'reason' in inventory?inventory.reason:null],
    ['BLOCKED','UNSAFE_PATH']);
   assert.equal('originalPresent' in inventory,false,
    'must not display stale original-present counts');
  }finally{patched.mock.restore();}
  assert.deepEqual(await readFile(sourcePath),original);
  assert.equal((await readFile(journalPath,'utf8')),'{"tampermonkeyVerified":true}\\n');
 }finally{await rm(home,{recursive:true,force:true});}
});
