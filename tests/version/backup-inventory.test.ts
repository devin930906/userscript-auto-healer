import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {lstat,mkdtemp,mkdir,readFile,readdir,rm,symlink,truncate,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectBackupInventoryReadOnly} from '../../src/version/backup-inventory';
import {backupPrefix,createVerifiedBackupOnly} from '../../src/version/verified-backup';
import {MAX_SCRIPT_BYTES} from '../../src/import/import-service';

const fixtureBytes=Buffer.from('// ==UserScript==\n// @name history-test\n// ==/UserScript==\n','utf8');
const sha=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
async function withFixture(fn:(source:string,backupDir:string,root:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'uah-backup-inventory-'));
 const source=join(root,'example.user.js');
 const backupDir=join(root,'backup');
 try{
   await mkdir(backupDir);
   await writeFile(source,fixtureBytes);
   await fn(source,backupDir,root);
 }finally{await rm(root,{force:true,recursive:true});}
}
test('TEST-020 stage: list multiple observed backups without editing any source or backup',async()=>{
 await withFixture(async(source,backupDir,root)=>{
   const first=await createVerifiedBackupOnly({sourcePath:source,backupDirectory:backupDir,
     expectedSha256:sha(fixtureBytes),userApproved:true});
   const second=await createVerifiedBackupOnly({sourcePath:source,backupDirectory:backupDir,
     expectedSha256:sha(fixtureBytes),userApproved:true});
   assert.equal(first.status,'BACKUP_ONLY');
   assert.equal(second.status,'BACKUP_ONLY');
   if(first.status!=='BACKUP_ONLY'||second.status!=='BACKUP_ONLY')return;
   const other=join(root,'another.user.js');
   await writeFile(other,fixtureBytes);
   const third=await createVerifiedBackupOnly({sourcePath:other,backupDirectory:backupDir,
     expectedSha256:sha(fixtureBytes),userApproved:true});
   assert.equal(third.status,'BACKUP_ONLY');
   await writeFile(join(backupDir,'.incomplete.pending'),Buffer.from('pending'));
   const before=await readdir(backupDir);
   const observed=await inspectBackupInventoryReadOnly({
     sourcePath:source,backupDirectory:backupDir,userApproved:true
   });
   assert.equal(observed.status,'OBSERVED_BACKUP_CANDIDATES_READ_ONLY',JSON.stringify(observed));
   if(observed.status!=='OBSERVED_BACKUP_CANDIDATES_READ_ONLY')return;
   assert.deepEqual(observed.candidates.map(x=>x.backupFileName).sort(),
     [first.backupFileName,second.backupFileName].sort());
   assert.deepEqual(observed.candidates.map(x=>x.observedSha256),
     [sha(fixtureBytes),sha(fixtureBytes)]);
   assert.deepEqual(observed.candidates.map(x=>x.byteLength),
     [fixtureBytes.length,fixtureBytes.length]);
   assert.equal(observed.automaticPatchAllowed,false);
   assert.equal(observed.automaticRollbackAllowed,false);
   assert.equal(observed.tampermonkeyVerified,false);
   assert.equal(observed.businessVerified,false);
   assert.equal(JSON.stringify(observed).includes(root),false);
   assert.deepEqual(await readdir(backupDir),before);
   assert.deepEqual(await readFile(source),fixtureBytes);
   assert.deepEqual(await readFile(other),fixtureBytes);
 });
});
test('TASK-011/TEST-020/026: recheck earlier backup when another editor changes it after later verification',async t=>{
 await withFixture(async(source,backupDirectory)=>{
   const made=[];
   for(let i=0;i<2;i++){
     const backup=await createVerifiedBackupOnly({sourcePath:source,backupDirectory,
       expectedSha256:sha(fixtureBytes),userApproved:true});
     assert.equal(backup.status,'BACKUP_ONLY');
     if(backup.status!=='BACKUP_ONLY')return;
     made.push(backup.backupFileName);
   }
   made.sort();
   const first=join(backupDirectory,made[0]);
   const changed=Buffer.from('// independently changed after the first inspection\\n');
   const recovery=require('../../src/version/recovery-source') as
     typeof import('../../src/version/recovery-source');
   const real=recovery.verifyBackupRecoverySource;
   let calls=0;
   t.mock.method(recovery,'verifyBackupRecoverySource',async(
     options:Parameters<typeof real>[0])=>{
       const result=await real(options);
       if(++calls===2)await writeFile(first,changed);
       return result;
     });
   const inventory=await inspectBackupInventoryReadOnly({
     sourcePath:source,backupDirectory,userApproved:true
   });
   assert.ok(calls>=2,'exercise cross-candidate change after both initial checks');
   assert.equal(inventory.status,'BLOCKED','stale first-backup hash must not be returned');
   assert.deepEqual(await readFile(first),changed,'inventory never fixes or deletes edited bytes');
   assert.deepEqual(await readFile(source),fixtureBytes);
 });
});

test('TASK-011/TEST-020/026: newly added backup during scan invalidates stale inventory counts',async t=>{
 await withFixture(async(source,backupDirectory)=>{
   const made=await createVerifiedBackupOnly({sourcePath:source,backupDirectory,
     expectedSha256:sha(fixtureBytes),userApproved:true});
   assert.equal(made.status,'BACKUP_ONLY');
   if(made.status!=='BACKUP_ONLY')return;
   const inserted=join(backupDirectory,backupPrefix(source)+
     '.00000000-0000-4000-8000-000000000001.backup.user.js');
   const recovery=require('../../src/version/recovery-source') as
     typeof import('../../src/version/recovery-source');
   const real=recovery.verifyBackupRecoverySource;
   let calls=0;
   t.mock.method(recovery,'verifyBackupRecoverySource',async(
     options:Parameters<typeof real>[0])=>{
       const result=await real(options);
       if(++calls===1)await writeFile(inserted,fixtureBytes);
       return result;
     });
   const inventory=await inspectBackupInventoryReadOnly({
     sourcePath:source,backupDirectory,userApproved:true
   });
   assert.ok(calls>=1,'exercise directory insertion after enumeration');
   assert.equal(inventory.status,'BLOCKED','stale namespace may not be returned as complete');
   assert.deepEqual(await readFile(inserted),fixtureBytes);
   assert.deepEqual(await readFile(source),fixtureBytes);
 });
});

test('TEST-020 stage: explicit consent and native-only exact input required',async()=>{
 await withFixture(async(source,backupDirectory)=>{
   const valid={sourcePath:source,backupDirectory,userApproved:true};
   for(const candidate of [
     {...valid,userApproved:false},
     {...valid,userApproved:'true'},
     {...valid,sourcePath:'relative.user.js'},
     {...valid,backupDirectory:'relative'},
     {...valid,automaticRollbackAllowed:true},
     Object.create(valid),
     {get sourcePath(){throw Error('secret path')}},
     null
   ]){
     const result=await inspectBackupInventoryReadOnly(candidate);
     assert.equal(result.status,'BLOCKED');
     assert.equal(result.automaticRollbackAllowed,false);
     assert.equal(JSON.stringify(result).includes(source),false);
   }
   const empty=await inspectBackupInventoryReadOnly(valid);
   assert.equal(empty.status,'OBSERVED_BACKUP_CANDIDATES_READ_ONLY');
   if(empty.status==='OBSERVED_BACKUP_CANDIDATES_READ_ONLY')
     assert.deepEqual(empty.candidates,[]);
 });
});
test('TEST-020/026: backup inventory rejects live and revoked Proxy before any reflection',async()=>{
 await withFixture(async(source,backupDirectory)=>{
   const selected={sourcePath:source,backupDirectory,userApproved:true};
   let traps=0;
   const live=new Proxy(selected,{
     getPrototypeOf(){traps++;throw Error('untrusted prototype trap');},
     ownKeys(){traps++;throw Error('untrusted ownKeys trap');},
     get(){traps++;throw Error('untrusted getter trap');}
   });
   const revoked=Proxy.revocable(selected,{});
   revoked.revoke();
   const before=await readdir(backupDirectory);
   for(const untrusted of [live,revoked.proxy]){
     const result=await inspectBackupInventoryReadOnly(untrusted);
     assert.equal(result.status,'BLOCKED');
     if(result.status==='BLOCKED')assert.equal(result.reason,'INVALID_REQUEST');
     assert.equal(result.automaticPatchAllowed,false);
     assert.equal(result.automaticRollbackAllowed,false);
   }
   assert.equal(traps,0,'never invoke traps on an untrusted Proxy');
   assert.deepEqual(await readdir(backupDirectory),before);
   assert.deepEqual(await readFile(source),fixtureBytes);
 });
});
test('TEST-020 stage: a forged or altered recovery copy is observational, never restore authority',async()=>{
 await withFixture(async(source,backupDirectory)=>{
   const made=await createVerifiedBackupOnly({sourcePath:source,backupDirectory,
     expectedSha256:sha(fixtureBytes),userApproved:true});
   assert.equal(made.status,'BACKUP_ONLY');
   if(made.status!=='BACKUP_ONLY')return;
   // A later edit must not be mislabeled as the originally authorized version.
   const changed=Buffer.from('// modified backup - cannot infer authenticity');
   await writeFile(join(backupDirectory,made.backupFileName),changed);
   const observed=await inspectBackupInventoryReadOnly({
     sourcePath:source,backupDirectory,userApproved:true
   });
   assert.equal(observed.status,'OBSERVED_BACKUP_CANDIDATES_READ_ONLY');
   if(observed.status!=='OBSERVED_BACKUP_CANDIDATES_READ_ONLY')return;
   assert.equal(observed.candidates[0]?.observedSha256,sha(changed));
   assert.notEqual(observed.candidates[0]?.observedSha256,made.sha256);
   assert.equal(observed.automaticRollbackAllowed,false);
   assert.deepEqual(await readFile(source),fixtureBytes);
 });
});
test('TEST-020 stage: matching backup symlink and hardlink aliases refuse the entire inventory',async t=>{
 await withFixture(async(source,backupDirectory)=>{
   const made=await createVerifiedBackupOnly({sourcePath:source,backupDirectory,
     expectedSha256:sha(fixtureBytes),userApproved:true});
   assert.equal(made.status,'BACKUP_ONLY');
   if(made.status!=='BACKUP_ONLY')return;
   const file=join(backupDirectory,made.backupFileName);
   await unlink(file);
   try{await symlink(source,file,'file');}
   catch(error){
     if((error as NodeJS.ErrnoException).code==='EPERM'){
       t.diagnostic('No symlink permission on this Windows runner');
       return;
     }
     throw error;
   }
   const observed=await inspectBackupInventoryReadOnly({
     sourcePath:source,backupDirectory,userApproved:true
   });
   assert.equal(observed.status,'BLOCKED');
   if(observed.status==='BLOCKED')assert.equal(observed.reason,'UNSAFE_BACKUP');
   assert.equal((await lstat(file)).isSymbolicLink(),true);
   assert.deepEqual(await readFile(source),fixtureBytes);
 });
});
test('TEST-020 stage: version candidate bound prevents unbounded directory enumeration',async()=>{
 await withFixture(async(source,backupDirectory)=>{
   const prefix=backupPrefix(source);
   for(let i=0;i<65;i++){
     const id='00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0');
     await writeFile(join(backupDirectory,prefix+'.'+id+'.backup.user.js'),fixtureBytes);
   }
   const observed=await inspectBackupInventoryReadOnly({
     sourcePath:source,backupDirectory,userApproved:true
   });
   assert.equal(observed.status,'BLOCKED');
   if(observed.status==='BLOCKED')assert.equal(observed.reason,'TOO_MANY_ENTRIES');
   assert.deepEqual(await readFile(source),fixtureBytes);
 });
});


test('TEST-020: empty or oversized source cannot enter read-only recovery inventory',async()=>{
 for(const size of [0,MAX_SCRIPT_BYTES+1]){
  await withFixture(async(source,backupDirectory)=>{
   await truncate(source,size);
   const result=await inspectBackupInventoryReadOnly({
     sourcePath:source,backupDirectory,userApproved:true
   });
   assert.equal(result.status,'BLOCKED');
   if(result.status==='BLOCKED')assert.equal(result.reason,'SOURCE_SIZE_LIMIT');
   assert.equal(result.automaticRollbackAllowed,false);
   assert.equal(result.automaticPatchAllowed,false);
   assert.equal(JSON.stringify(result).includes(source),false);
  });
 }
});

test('TEST-020: oversized directory inventory is refused even when entries are unrelated',async()=>{
 await withFixture(async(source,backupDirectory)=>{
   // The cap applies to all directory entries, not only matching backups.
   // Streaming enumeration must stop at the bound without materializing the
   // full untrusted directory into a single unbounded readdir result.
   for(let i=0;i<513;i++){
     await writeFile(join(backupDirectory,'unrelated-'+String(i).padStart(4,'0')), '');
   }
   const result=await inspectBackupInventoryReadOnly({
     sourcePath:source,backupDirectory,userApproved:true
   });
   assert.equal(result.status,'BLOCKED');
   if(result.status==='BLOCKED')assert.equal(result.reason,'TOO_MANY_ENTRIES');
   assert.equal(result.automaticPatchAllowed,false);
   assert.equal(result.automaticRollbackAllowed,false);
   assert.deepEqual(await readFile(source),fixtureBytes);
 });
});


test('TEST-020: empty inventory rejects linked ancestor paths without touching user files',async t=>{
 await withFixture(async(source,backupDirectory,root)=>{
   const nested=join(root,'nested');
   const alias=join(root,'nested-junction');
   await mkdir(nested);
   const nestedSource=join(nested,'nested.user.js');
   const nestedBackup=join(nested,'empty-backups');
   await writeFile(nestedSource,fixtureBytes);
   await mkdir(nestedBackup);
   try{
     await symlink(nested,alias,process.platform==='win32'?'junction':'dir');
   }catch(error){
     if(['EPERM','ENOTSUP','EACCES'].includes(
       (error as NodeJS.ErrnoException).code??'')){
       t.diagnostic('Ancestor junction privilege unavailable');
       return;
     }
     throw error;
   }
   // The final file or directory is ordinary: only a parent is redirected.
   assert.equal((await lstat(join(alias,'nested.user.js'))).isSymbolicLink(),false);
   assert.equal((await lstat(join(alias,'empty-backups'))).isSymbolicLink(),false);
   const redirectedSource=await inspectBackupInventoryReadOnly({
     sourcePath:join(alias,'nested.user.js'),
     backupDirectory,userApproved:true
   });
   assert.equal(redirectedSource.status,'BLOCKED');
   if(redirectedSource.status==='BLOCKED')
     assert.equal(redirectedSource.reason,'INVALID_PATH');
   const redirectedDirectory=await inspectBackupInventoryReadOnly({
     sourcePath:source,
     backupDirectory:join(alias,'empty-backups'),userApproved:true
   });
   assert.equal(redirectedDirectory.status,'BLOCKED');
   if(redirectedDirectory.status==='BLOCKED')
     assert.equal(redirectedDirectory.reason,'BACKUP_DIRECTORY_INVALID');
   assert.deepEqual(await readdir(nestedBackup),[]);
   assert.deepEqual(await readFile(source),fixtureBytes);
   assert.deepEqual(await readFile(nestedSource),fixtureBytes);
 });
});
