/**
 * TASK-011 / REQ-020/021 / TEST-020/021/026: a manually approved
 * original-file recovery is not automatic application or manager verification.
 * All source mutations here affect disposable .user.js fixtures only.
 */
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash,randomUUID} from 'node:crypto';
import {chmod,link,lstat,mkdtemp,mkdir,readFile,readdir,rename,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createVerifiedBackupOnly} from '../../src/version/verified-backup';
import {restoreVerifiedOriginalNativeOnly,stillOwnNativeRestorePathLock,removeOwnedNativeRestorePending,removeOwnedPublishedJournalPending} from '../../src/version/native-restore-transaction';
import {inspectNativeRestoreIntentReadOnly} from '../../src/version/restore-intent-inspection';

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
test('TEST-020/026: published restore intent cleanup never unlinks a foreign replacement',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-published-journal-'));
 const directory=join(root,'recoveries');
 const former=join(root,'former-recoveries');
 try{
  await mkdir(directory);
  const owner=await lstat(directory,{bigint:true});
  async function linkedJournal(){
   const pending=join(directory,'.uah-restore-'+randomUUID()+'.pending');
   const published=join(directory,'.uah-restore-'+randomUUID()+'.journal.json');
   await writeFile(pending,'original journal bytes');
   const staged=await lstat(pending,{bigint:true});
   await link(pending,published);
   return {pending,published,staged};
  }
  const valid=await linkedJournal();
  assert.equal(await removeOwnedPublishedJournalPending(
   valid.pending,valid.published,valid.staged,owner),true);
  assert.equal((await readFile(valid.published)).toString(),'original journal bytes');
  assert.equal((await lstat(valid.published)).nlink,1);
  assert.equal((await readdir(directory)).includes(
   valid.pending.slice(directory.length+1)),false);

  // The old pending is still present under a different name; never remove
  // the unrelated newly created file at its former pathname.
  const replacedPending=await linkedJournal();
  const escaped=join(directory,'kept-old-pending');
  await rename(replacedPending.pending,escaped);
  await writeFile(replacedPending.pending,'replacement pending');
  assert.equal(await removeOwnedPublishedJournalPending(
   replacedPending.pending,replacedPending.published,
   replacedPending.staged,owner),false);
  assert.equal((await readFile(replacedPending.pending)).toString(),'replacement pending');
  assert.equal((await readFile(replacedPending.published)).toString(),'original journal bytes');
  assert.equal((await readFile(escaped)).toString(),'original journal bytes');

  // Replacing the published journal does not grant cleanup ownership.
  const replacedPublished=await linkedJournal();
  const savedPublished=join(directory,'kept-old-published');
  await rename(replacedPublished.published,savedPublished);
  await writeFile(replacedPublished.published,'replacement journal');
  assert.equal(await removeOwnedPublishedJournalPending(
   replacedPublished.pending,replacedPublished.published,
   replacedPublished.staged,owner),false);
  assert.equal((await readFile(replacedPublished.published)).toString(),'replacement journal');
  assert.equal((await readFile(replacedPublished.pending)).toString(),'original journal bytes');

  // An unknown third alias or parent replacement must fail closed.
  const extraAlias=await linkedJournal();
  await link(extraAlias.pending,join(directory,'unexpected-third-link'));
  assert.equal(await removeOwnedPublishedJournalPending(
   extraAlias.pending,extraAlias.published,extraAlias.staged,owner),false);
  assert.equal((await readFile(extraAlias.pending)).toString(),'original journal bytes');

  const movedParent=await linkedJournal();
  await rename(directory,former);
  await mkdir(directory);
  await writeFile(movedParent.pending,'unowned pending');
  await writeFile(movedParent.published,'unowned journal');
  assert.equal(await removeOwnedPublishedJournalPending(
   movedParent.pending,movedParent.published,movedParent.staged,owner),false);
  assert.equal((await readFile(movedParent.pending)).toString(),'unowned pending');
  assert.equal((await readFile(movedParent.published)).toString(),'unowned journal');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('TEST-020/026: native restore cleanup removes only its own verified pending inode',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-pending-owner-'));
 const parent=join(root,'selected-parent');
 const movedParent=join(root,'original-parent');
 try{
  await mkdir(parent);
  const pending=join(parent,'.uah-restore-'+randomUUID()+'.pending');
  const parentIdentity=await lstat(parent,{bigint:true});
  await writeFile(pending,'owned');
  const owned=await lstat(pending,{bigint:true});
  assert.equal(await removeOwnedNativeRestorePending(pending,owned,parentIdentity),true);
  assert.deepEqual(await readdir(parent),[],'only own verified temp is removed');

  // An external rename/replacement at the SAME path must never be deleted.
  await writeFile(pending,'owned');
  const displaced=await lstat(pending,{bigint:true});
  await rename(pending,join(parent,'preserved-previous-temp'));
  await writeFile(pending,'foreign');
  assert.equal(await removeOwnedNativeRestorePending(pending,displaced,parentIdentity),false);
  assert.equal((await readFile(pending)).toString(),'foreign');
  assert.equal((await readFile(join(parent,'preserved-previous-temp'))).toString(),'owned');

  // Even an in-place external modification makes the metadata receipt stale.
  const stale=await lstat(pending,{bigint:true});
  await writeFile(pending,'mutated-foreign-content');
  assert.equal(await removeOwnedNativeRestorePending(pending,stale,parentIdentity),false);
  assert.equal((await readFile(pending)).toString(),'mutated-foreign-content');

  // Replacing the parent directory must not redirect cleanup to a new tree.
  const parentFile=join(parent,'.uah-restore-'+randomUUID()+'.pending');
  await writeFile(parentFile,'keep-old-tree');
  const beforeParentMove=await lstat(parentFile,{bigint:true});
  await rename(parent,movedParent);
  await mkdir(parent);
  await writeFile(parentFile,'keep-new-tree');
  assert.equal(await removeOwnedNativeRestorePending(parentFile,beforeParentMove,parentIdentity),false);
  assert.equal((await readFile(parentFile)).toString(),'keep-new-tree');
  assert.equal((await readFile(join(movedParent,
   parentFile.slice(parent.length+1)))).toString(),'keep-old-tree');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('TEST-020/026: displaced or removed restore path mutex is never mistaken for the acquired lock',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-restore-lock-'));
 try{
  const lock=join(root,'owner-lock');
  const moved=join(root,'moved-lock');
  await mkdir(lock);
  const owner=await lstat(lock,{bigint:true});
  assert.equal(await stillOwnNativeRestorePathLock(lock,owner),true,
   'unchanged acquired mutex must remain usable');
  await rename(lock,moved);
  assert.equal(await stillOwnNativeRestorePathLock(lock,owner),false,
   'missing mutex must refuse source replacement');
  await mkdir(lock);
  assert.equal(await stillOwnNativeRestorePathLock(lock,owner),false,
   'a newly created mutex with the same path is a DIFFERENT owner');
  await rm(lock,{recursive:true});
  assert.equal(await stillOwnNativeRestorePathLock(lock,owner),false,
   'the original mutex relocated elsewhere is not still held');
  assert.ok((await lstat(moved,{bigint:true})).isDirectory(),
   'unknown displaced lock evidence must remain intact');
 }finally{await rm(root,{recursive:true,force:true});}
});

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

test('TEST-020/026: refuse read-only selected source before creating any recovery side effects',async()=>{
 await fixture(async opts=>{
  await chmod(opts.sourcePath,0o444);
  try{
   const prior=await readdir(opts.backupDirectory);
   const result=await restoreVerifiedOriginalNativeOnly(opts);
   assert.deepEqual(result,{status:'BLOCKED',reason:'UNSAFE_PATH',
    automaticPatchAllowed:false,automaticRollbackAllowed:false,
    tampermonkeyVerified:false,businessVerified:false});
   assert.deepEqual(await readFile(opts.sourcePath),changed);
   assert.deepEqual(await readdir(opts.backupDirectory),prior,
    'do not publish displaced backups or recovery journals for read-only files');
  }finally{await chmod(opts.sourcePath,0o666);}
 });
});
test('TEST-020: successful native restore retains selected script permission mode',async()=>{
 await fixture(async opts=>{
  await chmod(opts.sourcePath,0o666);
  const before=(await stat(opts.sourcePath)).mode&0o777;
  const result=await restoreVerifiedOriginalNativeOnly(opts);
  assert.equal(result.status,'RESTORED_NATIVE_ONLY',JSON.stringify(result));
  assert.equal((await stat(opts.sourcePath)).mode&0o777,before,
   'replace must not silently change the original permission bits');
  if(result.status==='RESTORED_NATIVE_ONLY'){
   const journalStat=await stat(join(opts.backupDirectory,result.journalFileName));
   assert.equal(journalStat.nlink,1,'completed journal must have a single independent path');
   assert.ok((await readdir(opts.backupDirectory)).every(n=>!n.endsWith('.pending')),
    'do not leave staging names after successful journal publication');
  }
 });
});

test('TEST-020: read-only native intent inspection identifies restored and displaced source without changing files',async()=>{
 await fixture(async opts=>{
  const restored=await restoreVerifiedOriginalNativeOnly(opts);
  assert.equal(restored.status,'RESTORED_NATIVE_ONLY',JSON.stringify(restored));
  if(restored.status!=='RESTORED_NATIVE_ONLY')return;
  const query={sourcePath:opts.sourcePath,backupDirectory:opts.backupDirectory,
   journalFileName:restored.journalFileName,userApproved:true};
  const beforeNames=await readdir(opts.backupDirectory);
  const journalBefore=await readFile(join(opts.backupDirectory,restored.journalFileName));
  const first=await inspectNativeRestoreIntentReadOnly(query);
  assert.equal(first.status,'RESTORE_INTENT_OBSERVED_READ_ONLY',JSON.stringify(first));
  if(first.status==='RESTORE_INTENT_OBSERVED_READ_ONLY'){
   assert.equal(first.sourceState,'ORIGINAL_PRESENT');
   assert.equal(first.originalSha256,sha(original));
   assert.equal(first.displacedSha256,sha(changed));
   assert.equal(first.automaticPatchAllowed,false);
   assert.equal(first.automaticRollbackAllowed,false);
   assert.equal(first.tampermonkeyVerified,false);
   assert.equal(first.businessVerified,false);
  }
  assert.deepEqual(await readFile(opts.sourcePath),original);
  await writeFile(opts.sourcePath,changed);
  const second=await inspectNativeRestoreIntentReadOnly(query);
  assert.equal(second.status,'RESTORE_INTENT_OBSERVED_READ_ONLY',JSON.stringify(second));
  if(second.status==='RESTORE_INTENT_OBSERVED_READ_ONLY')
   assert.equal(second.sourceState,'DISPLACED_PRESENT');
  assert.deepEqual(await readFile(opts.sourcePath),changed);
  assert.deepEqual(await readdir(opts.backupDirectory),beforeNames);
  assert.deepEqual(await readFile(join(opts.backupDirectory,restored.journalFileName)),journalBefore);
 });
});

test('TEST-020/026: restore inspection refuses a backup changed after its first verification',async t=>{
 await fixture(async opts=>{
  const restored=await restoreVerifiedOriginalNativeOnly(opts);
  assert.equal(restored.status,'RESTORED_NATIVE_ONLY');
  if(restored.status!=='RESTORED_NATIVE_ONLY')return;
  const query={sourcePath:opts.sourcePath,backupDirectory:opts.backupDirectory,
   journalFileName:restored.journalFileName,userApproved:true};
  const snapshotModule=require('../../src/version/source-snapshot') as
   typeof import('../../src/version/source-snapshot');
  const verified=snapshotModule.verifyApprovedSourceFingerprint;
  let swapped=false;
  // Deterministic interleaving: the two backup reads have completed when
  // source fingerprinting begins. An external editor invalidates one backup
  // before the inspector could issue a success receipt.
  t.mock.method(snapshotModule,'verifyApprovedSourceFingerprint',
   async (input:Parameters<typeof verified>[0])=>{
    const result=await verified(input);
    if(!swapped&&result.status==='MATCHED_READ_ONLY'){
     swapped=true;
     await writeFile(join(opts.backupDirectory,opts.backupFileName),
      Buffer.from('tampered-during-read-only-inspection'));
    }
    return result;
   });
  const result=await inspectNativeRestoreIntentReadOnly(query);
  assert.equal(swapped,true,'the test must mutate after initial backup checks');
  assert.equal(result.status,'BLOCKED',JSON.stringify(result));
  if(result.status==='BLOCKED')assert.equal(result.reason,'BACKUP_UNVERIFIED');
  assert.equal(result.automaticPatchAllowed,false);
  assert.equal(result.automaticRollbackAllowed,false);
  assert.deepEqual(await readFile(opts.sourcePath),original);
 });
});

test('TEST-020/026: forged journal, tampered backup and diverged source never give a usable receipt',async()=>{
 await fixture(async opts=>{
  const restored=await restoreVerifiedOriginalNativeOnly(opts);
  assert.equal(restored.status,'RESTORED_NATIVE_ONLY');
  if(restored.status!=='RESTORED_NATIVE_ONLY')return;
  const query={sourcePath:opts.sourcePath,backupDirectory:opts.backupDirectory,
   journalFileName:restored.journalFileName,userApproved:true};
  const journalPath=join(opts.backupDirectory,restored.journalFileName);
  const authentic=await readFile(journalPath);
  await writeFile(journalPath,Buffer.from('{"state":"RESTORE_INTENT_UNVERIFIED"}\\n'));
  assert.equal((await inspectNativeRestoreIntentReadOnly(query)).status,'BLOCKED');
  await writeFile(journalPath,authentic);
  await writeFile(join(opts.backupDirectory,opts.backupFileName),'tampered');
  assert.equal((await inspectNativeRestoreIntentReadOnly(query)).status,'BLOCKED');
  // The original backup is now tainted; even an unchanged journal is not enough.
  assert.deepEqual(await readFile(opts.sourcePath),original);
  await writeFile(opts.sourcePath,Buffer.from('unrelated third party update'));
  assert.equal((await inspectNativeRestoreIntentReadOnly(query)).status,'BLOCKED');
 });
});

test('TEST-020/026: manual approval, exact journal name and untrusted Proxy are rejected without traps',async()=>{
 await fixture(async opts=>{
  const restored=await restoreVerifiedOriginalNativeOnly(opts);
  assert.equal(restored.status,'RESTORED_NATIVE_ONLY');
  if(restored.status!=='RESTORED_NATIVE_ONLY')return;
  const query={sourcePath:opts.sourcePath,backupDirectory:opts.backupDirectory,
   journalFileName:restored.journalFileName,userApproved:true};
  let traps=0;
  const proxy=new Proxy(query,{
   getPrototypeOf(){traps++;throw Error('untrusted prototype');},
   ownKeys(){traps++;throw Error('untrusted keys');},
   get(){traps++;throw Error('untrusted access');}
  });
  for(const input of [proxy,{...query,userApproved:false},
   {...query,journalFileName:'../../other.journal.json'},
   {...query,journalFileName:'.uah-restore-anything.pending'},
   {...query,automaticRollbackAllowed:true}]){
   const result=await inspectNativeRestoreIntentReadOnly(input);
   assert.equal(result.status,'BLOCKED',JSON.stringify(result));
  }
  assert.equal(traps,0);
  assert.deepEqual(await readFile(opts.sourcePath),original);
 });
});
