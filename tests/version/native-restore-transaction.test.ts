/**
 * TASK-011 / REQ-020/021 / TEST-020/021/026: a manually approved
 * original-file recovery is not automatic application or manager verification.
 * All source mutations here affect disposable .user.js fixtures only.
 */
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createVerifiedBackupOnly} from '../../src/version/verified-backup';
import {restoreVerifiedOriginalNativeOnly} from '../../src/version/native-restore-transaction';

const original=Buffer.from('// ==UserScript==\n// @name Original\n// ==/UserScript==\n');
const changed=Buffer.from('// ==UserScript==\n// @name Edited\n// ==/UserScript==\n');
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function fixture(run:(data:{
  sourcePath:string;backupDirectory:string;backupFileName:string;
  expectedCurrentSha256:string;expectedOriginalSha256:string;
  expectedOriginalByteLength:number;userApproved:boolean;manualRestoreApproved:boolean
})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'uah-native-restore-'));
 try{
  const sourcePath=join(root,'selected.user.js');
  const backupDirectory=join(root,'recoveries');
  await mkdir(backupDirectory);
  await writeFile(sourcePath,original);
  const backup=await createVerifiedBackupOnly({
   sourcePath,backupDirectory,expectedSha256:sha(original),userApproved:true
  });
  assert.equal(backup.status,'BACKUP_ONLY');
  if(backup.status!=='BACKUP_ONLY')return;
  await writeFile(sourcePath,changed);
  await run({
   sourcePath,backupDirectory,backupFileName:backup.backupFileName,
   expectedCurrentSha256:sha(changed),expectedOriginalSha256:sha(original),
   expectedOriginalByteLength:original.length,
   userApproved:true,manualRestoreApproved:true
  });
 }finally{await rm(root,{recursive:true,force:true});}
}
test('TEST-020: isolated native manual restore preserves displaced bytes as a second independently verifiable backup',async()=>{
 await fixture(async opts=>{
  const result=await restoreVerifiedOriginalNativeOnly(opts);
  assert.equal(result.status,'RESTORED_NATIVE_ONLY',JSON.stringify(result));
  assert.equal(result.automaticPatchAllowed,false);
  assert.equal(result.automaticRollbackAllowed,false);
  assert.equal(result.tampermonkeyVerified,false);
  assert.equal(result.businessVerified,false);
  if(result.status!=='RESTORED_NATIVE_ONLY')return;
  assert.equal(result.originalSha256,sha(original));
  assert.equal(result.displacedSha256,sha(changed));
  assert.deepEqual(await readFile(opts.sourcePath),original);
  const inventory=await readdir(opts.backupDirectory);
  assert.ok(inventory.includes(opts.backupFileName));
  assert.ok(inventory.includes(result.displacedBackupFileName));
  assert.ok(inventory.includes(result.journalFileName));
  assert.notEqual(result.displacedBackupFileName,opts.backupFileName);
  assert.deepEqual(await readFile(join(opts.backupDirectory,result.displacedBackupFileName)),changed);
  const journal=JSON.parse((await readFile(join(opts.backupDirectory,result.journalFileName))).toString('utf8'));
  assert.equal(journal.state,'RESTORE_INTENT_UNVERIFIED');
  assert.equal(journal.displacedSha256,sha(changed));
  assert.equal(journal.originalSha256,sha(original));
  assert.equal(journal.sourcePath,undefined);
  assert.equal(JSON.stringify(result).includes(opts.sourcePath),false);
 });
});
test('TEST-020/021: missing independent manual consent cannot overwrite the selected source',async()=>{
 await fixture(async opts=>{
  const before=await readdir(opts.backupDirectory);
  for(const data of [
   {...opts,userApproved:false},
   {...opts,manualRestoreApproved:false},
   {...opts,expectedCurrentSha256:sha(original)},
   {...opts,expectedOriginalSha256:sha(changed)},
   {...opts,expectedOriginalByteLength:12345}
  ]){
   const result=await restoreVerifiedOriginalNativeOnly(data);
   assert.equal(result.status,'BLOCKED');
   assert.deepEqual(await readFile(opts.sourcePath),changed);
  }
  assert.deepEqual(await readdir(opts.backupDirectory),before);
 });
});
test('TEST-020/026: tampered backup and stale source must not trigger restoration',async()=>{
 await fixture(async opts=>{
  await writeFile(join(opts.backupDirectory,opts.backupFileName),Buffer.from('tampered'));
  assert.equal((await restoreVerifiedOriginalNativeOnly(opts)).status,'BLOCKED');
  assert.deepEqual(await readFile(opts.sourcePath),changed);
 });
 await fixture(async opts=>{
  await writeFile(opts.sourcePath,Buffer.from('third-party update'));
  assert.equal((await restoreVerifiedOriginalNativeOnly(opts)).status,'BLOCKED');
  assert.deepEqual(await readFile(opts.sourcePath),Buffer.from('third-party update'));
 });
});
test('TEST-020/026: untrusted Proxy and accessors are rejected before any callback execution',async()=>{
 await fixture(async opts=>{
  let traps=0;
  const proxy=new Proxy(opts,{
   get(){traps++;throw Error('secret read');},
   getPrototypeOf(){traps++;throw Error('secret prototype');},
   ownKeys(){traps++;throw Error('secret ownKeys');}
  });
  const getter={...opts};
  Object.defineProperty(getter,'manualRestoreApproved',{
   enumerable:true,get(){traps++;return true;}
  });
  for(const candidate of [proxy,getter,{...opts,extraAuthority:true}]){
   const result=await restoreVerifiedOriginalNativeOnly(candidate);
   assert.equal(result.status,'BLOCKED');
  }
  assert.equal(traps,0);
  assert.deepEqual(await readFile(opts.sourcePath),changed);
 });
});
