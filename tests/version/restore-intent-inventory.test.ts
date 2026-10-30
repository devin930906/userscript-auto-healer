/** TASK-011 / TEST-020/021/026: bounded native-only recovery inventory. */
import {test,mock} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,rm,stat,symlink,truncate,utimes,writeFile} from 'node:fs/promises';
import {promises as fsPromises} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MAX_SCRIPT_BYTES} from '../../src/import/import-service';
import {createVerifiedBackupOnly} from '../../src/version/verified-backup';
import {restoreVerifiedOriginalNativeOnly} from '../../src/version/native-restore-transaction';
import {inspectNativeRestoreIntentInventoryReadOnly} from '../../src/version/restore-intent-inventory';
const original=Buffer.from('// ==UserScript==\n// @name old\n// ==/UserScript==\n');
const updated=Buffer.from('// ==UserScript==\n// @name new\n// ==/UserScript==\n');
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');

test('TASK-011/TEST-020/021/026: empty, oversized or co-located source cannot yield clean zero-intent inventory',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-intent-invalid-source-'));
 try{
  const sourcePath=join(home,'selected.user.js');
  const backupDirectory=join(home,'recoveries');
  await mkdir(backupDirectory);
  await writeFile(sourcePath,original);
  const inspect=(directory:string)=>inspectNativeRestoreIntentInventoryReadOnly({
   sourcePath,backupDirectory:directory,userApproved:true
  });
  const clean=await inspect(backupDirectory);
  assert.equal(clean.status,'RESTORE_INTENT_INVENTORY_READ_ONLY',
   'a valid isolated empty recovery folder remains inspectable');
  if(clean.status==='RESTORE_INTENT_INVENTORY_READ_ONLY')
   assert.equal(clean.inspected,0);

  const coLocated=await inspect(home);
  assert.deepEqual(coLocated,{status:'BLOCKED',reason:'UNSAFE_PATH',
   automaticPatchAllowed:false,automaticRollbackAllowed:false,
   tampermonkeyVerified:false,businessVerified:false},
   'source parent cannot double as backup store even with no journal');

  await writeFile(sourcePath,'');
  const empty=await inspect(backupDirectory);
  assert.equal(empty.status,'BLOCKED',
   'a zero-byte userscript cannot generate a clean recovery observation');
  assert.equal('reason' in empty?empty.reason:null,'UNSAFE_PATH');

  await writeFile(sourcePath,original);
  await truncate(sourcePath,MAX_SCRIPT_BYTES+1);
  const oversized=await inspect(backupDirectory);
  assert.equal(oversized.status,'BLOCKED',
   'a source beyond the native bounded script limit cannot be treated as clean');
  assert.equal('reason' in oversized?oversized.reason:null,'UNSAFE_PATH');
  assert.equal((await stat(sourcePath)).size,MAX_SCRIPT_BYTES+1,
   'read-only recovery inspection must never touch the source');
  assert.deepEqual(await readdir(backupDirectory),[],
   'rejected inventory must never create or delete recovery files');
 }finally{await rm(home,{recursive:true,force:true});}
});

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

test('TASK-011/TEST-020/021/026: malformed reserved restore evidence cannot masquerade as an empty recovery inventory',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-malformed-restore-evidence-'));
 try{
  const sourcePath=join(home,'selected.user.js');
  const backupDirectory=join(home,'recoveries');
  await mkdir(backupDirectory);
  await writeFile(sourcePath,original);
  const inspect=()=>inspectNativeRestoreIntentInventoryReadOnly({
   sourcePath,backupDirectory,userApproved:true
  });
  await writeFile(join(backupDirectory,'ordinary-notes.txt'),'other user notes');
  const clean=await inspect();
  assert.equal(clean.status,'RESTORE_INTENT_INVENTORY_READ_ONLY',
   'unrelated files must not be mistaken for recovery evidence');
  if(clean.status==='RESTORE_INTENT_INVENTORY_READ_ONLY')
   assert.equal(clean.inspected,0);

  for(const damagedName of [
   '.uah-restore-'+randomUUID()+'.pending.corrupt',
   '.uah-restore-'+randomUUID()+'.journal.json.partial',
   '.UAH-RESTORE-'+randomUUID()+'.pending'
  ]){
   const file=join(backupDirectory,damagedName);
   await writeFile(file,'incomplete native recovery evidence');
   const seen=await inspect();
   assert.deepEqual([seen.status,'reason' in seen?seen.reason:null],
    ['BLOCKED','RECOVERY_REVIEW_REQUIRED'],
    'damaged reserved restore artifacts require manual review: '+damagedName);
   assert.deepEqual(await readFile(file,'utf8'),'incomplete native recovery evidence',
    'a read-only inventory must preserve the ambiguous recovery artifact');
   await rm(file);
  }
  assert.deepEqual(await readFile(sourcePath),original);
  assert.deepEqual(await readdir(backupDirectory),['ordinary-notes.txt']);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-011/TEST-020/021/026: interrupted restore journal pending must not look like an empty clean inventory',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-interrupted-journal-'));
 try{
  const sourcePath=join(home,'selected.user.js');
  const backupDirectory=join(home,'recoveries');
  await writeFile(sourcePath,original);await mkdir(backupDirectory);
  const pending=join(backupDirectory,'.uah-restore-'+randomUUID()+'.pending');
  await writeFile(pending,'partial journal from interrupted native restore');
  const result=await inspectNativeRestoreIntentInventoryReadOnly({
   sourcePath,backupDirectory,userApproved:true
  });
  assert.deepEqual([result.status,'reason' in result?result.reason:null],
   ['BLOCKED','RECOVERY_REVIEW_REQUIRED']);
  assert.equal('inspected' in result,false,'a pending restore is not a reconciled empty history');
  assert.deepEqual(await readFile(sourcePath),original);
  assert.equal(await readFile(pending,'utf8'),'partial journal from interrupted native restore');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-011/TEST-020/021/026: stranded native restore path mutex blocks clean inventory receipt',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-interrupted-mutex-'));
 try{
  const sourcePath=join(home,'selected.user.js');
  const backupDirectory=join(home,'recoveries');
  await writeFile(sourcePath,original);await mkdir(backupDirectory);
  const canonical=process.platform==='win32'?sourcePath.toLowerCase():sourcePath;
  const lock=join(home,'.uah-restore-path-'+createHash('sha256').update(canonical).digest('hex'));
  await mkdir(lock);
  const result=await inspectNativeRestoreIntentInventoryReadOnly({
   sourcePath,backupDirectory,userApproved:true
  });
  assert.deepEqual([result.status,'reason' in result?result.reason:null],
   ['BLOCKED','RECOVERY_REVIEW_REQUIRED']);
  assert.equal('inspected' in result,false,'active or abandoned lock cannot be called clean');
  assert.deepEqual(await readFile(sourcePath),original);
  assert.ok((await readdir(home)).includes(lock.slice(home.length+1)),
   'never clear an ambiguous lock automatically');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-011/TEST-020/021/026: malformed source-parent recovery residue cannot yield a false-clean inventory',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-malformed-source-residue-'));
 try{
  const sourcePath=join(home,'selected.user.js');
  const backupDirectory=join(home,'recoveries');
  await mkdir(backupDirectory);await writeFile(sourcePath,original);
  const inspect=()=>inspectNativeRestoreIntentInventoryReadOnly({
   sourcePath,backupDirectory,userApproved:true
  });
  // A different source's well-formed cooperative lock is not an interrupted
  // staging file for the selected source. Preserve this positive control.
  const unrelatedLock=join(home,'.uah-restore-path-'+'f'.repeat(64));
  await mkdir(unrelatedLock);
  const clean=await inspect();
  assert.deepEqual([clean.status,'inspected' in clean?clean.inspected:null],
   ['RESTORE_INTENT_INVENTORY_READ_ONLY',0]);
  for(const damagedName of [
   '.uah-restore-'+randomUUID()+'.pending.corrupt',
   '.uah-restore-'+randomUUID()+'.journal.json.partial',
   '.UAH-RESTORE-'+randomUUID()+'.pending'
  ]){
   const residue=join(home,damagedName);
   await writeFile(residue,'incomplete source-parent restore evidence');
   const observed=await inspect();
   assert.deepEqual([observed.status,'reason' in observed?observed.reason:null],
    ['BLOCKED','RECOVERY_REVIEW_REQUIRED'],
    'malformed source-parent restore artifact needs manual review: '+damagedName);
   assert.equal(await readFile(residue,'utf8'),
    'incomplete source-parent restore evidence','inspection must never delete evidence');
   assert.deepEqual(await readFile(sourcePath),original,
    'source script must remain byte-identical');
   await rm(residue);
  }
  assert.deepEqual(await readdir(backupDirectory),[]);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('TASK-011/TEST-020/021/026: source-parent staging residue cannot be a clean zero-intent recovery inventory',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-intent-source-staging-'));
 try{
  const sourcePath=join(home,'selected.user.js');
  const backupDirectory=join(home,'recoveries');
  await mkdir(backupDirectory);
  await writeFile(sourcePath,original);
  const pending=join(home,'.uah-restore-'+randomUUID()+'.pending');
  await writeFile(pending,'unresolved source staging');
  const inspected=await inspectNativeRestoreIntentInventoryReadOnly({
   sourcePath,backupDirectory,userApproved:true
  });
  assert.deepEqual([inspected.status,'reason' in inspected?inspected.reason:null],
   ['BLOCKED','RECOVERY_REVIEW_REQUIRED']);
  assert.deepEqual(await readdir(backupDirectory),[]);
  assert.deepEqual(await readFile(sourcePath),original);
  assert.equal(await readFile(pending,'utf8'),'unresolved source staging');
 }finally{await rm(home,{recursive:true,force:true});}
});


test('TASK-011/TEST-020/021/026: shared native recovery directory counts only the selected source',async()=>{
 const home=await mkdtemp(join(tmpdir(),'uah-intent-shared-recovery-'));
 try{
  const backupDirectory=join(home,'recoveries');
  await mkdir(backupDirectory);
  const sources=[join(home,'selected.user.js'),join(home,'other.user.js')];
  for(const sourcePath of sources){
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
   assert.equal(restored.status,'RESTORED_NATIVE_ONLY',
    'different scripts must retain independent recovery intents in one store');
  }
  const before=(await readdir(backupDirectory)).sort();
  for(const sourcePath of sources){
   const result=await inspectNativeRestoreIntentInventoryReadOnly({
    sourcePath,backupDirectory,userApproved:true
   });
   assert.equal(result.status,'RESTORE_INTENT_INVENTORY_READ_ONLY');
   if(result.status==='RESTORE_INTENT_INVENTORY_READ_ONLY')
    assert.deepEqual(
     [result.inspected,result.originalPresent,result.displacedPresent,result.rejected],
     [1,1,0,0],
     'a valid foreign-script journal must not be misreported as a rejected current-script recovery');
   assert.deepEqual(await readFile(sourcePath),original);
  }
  assert.deepEqual((await readdir(backupDirectory)).sort(),before,
   'read-only scope inspection must not modify either journal or backup');
 }finally{await rm(home,{recursive:true,force:true});}
});
