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
