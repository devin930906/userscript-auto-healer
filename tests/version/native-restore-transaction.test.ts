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
import {dirname,join} from 'node:path';
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
   const id=randomUUID();
   const pending=join(directory,'.uah-restore-'+id+'.pending');
   const published=join(directory,'.uah-restore-'+id+'.journal.json');
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

  // A same-inode journal with a different transaction ID must not
  // authorize removal of the pending entry from an unrelated identity.
  const mismatched=await linkedJournal();
  const foreignJournal=join(directory,'.uah-restore-'+randomUUID()+'.journal.json');
  await rename(mismatched.published,foreignJournal);
  assert.equal(await removeOwnedPublishedJournalPending(
   mismatched.pending,foreignJournal,mismatched.staged,owner),false);
  assert.equal((await readFile(mismatched.pending)).toString(),'original journal bytes');
  assert.equal((await readFile(foreignJournal)).toString(),'original journal bytes');

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

test('TEST-020/026: restore intent blocks source changed during final asynchronous backup recheck',async t=>{
 await fixture(async opts=>{
  const restored=await restoreVerifiedOriginalNativeOnly(opts);
  assert.equal(restored.status,'RESTORED_NATIVE_ONLY');
  if(restored.status!=='RESTORED_NATIVE_ONLY')return;
  const inspection={sourcePath:opts.sourcePath,
   backupDirectory:opts.backupDirectory,
   journalFileName:restored.journalFileName,userApproved:true};
  const module=require('../../src/version/recovery-source') as
   typeof import('../../src/version/recovery-source');
  const realVerify=module.verifyBackupRecoverySource;
  let checks=0;
  const externalBytes=Buffer.from('// independently edited while backups are rechecked\\n');
  // The inspector initially checks both backups, then fingerprints source,
  // then checks both backups again. Change the SOURCE only after that
  // fourth asynchronous backup verification; the earlier source snapshot
  // is now obsolete, even though both backup copies are still authentic.
  t.mock.method(module,'verifyBackupRecoverySource',
   async (input:Parameters<typeof realVerify>[0])=>{
    const verified=await realVerify(input);
    checks++;
    if(checks===4)await writeFile(opts.sourcePath,externalBytes);
    return verified;
   });
  const result=await inspectNativeRestoreIntentReadOnly(inspection);
  assert.equal(checks>=4,true,'must exercise the late-backup-check window');
  assert.deepEqual(result,{
   status:'BLOCKED',reason:'SOURCE_DIVERGED',
   automaticPatchAllowed:false,automaticRollbackAllowed:false,
   tampermonkeyVerified:false,businessVerified:false
  });
  assert.deepEqual(await readFile(opts.sourcePath),externalBytes,
   'observation may not overwrite the external editor');
  assert.deepEqual(await readFile(
   join(opts.backupDirectory,opts.backupFileName)),original);
 });
});

test('TEST-020/026: a journal changed during the second backup round cannot yield a stale recovery observation',async t=>{
 await fixture(async opts=>{
  const restored=await restoreVerifiedOriginalNativeOnly(opts);
  assert.equal(restored.status,'RESTORED_NATIVE_ONLY');
  if(restored.status!=='RESTORED_NATIVE_ONLY')return;
  const query={sourcePath:opts.sourcePath,backupDirectory:opts.backupDirectory,
   journalFileName:restored.journalFileName,userApproved:true};
  const journalPath=join(opts.backupDirectory,restored.journalFileName);
  const originalJournal=await readFile(journalPath);
  const module=require('../../src/version/recovery-source') as
   typeof import('../../src/version/recovery-source');
  const realVerify=module.verifyBackupRecoverySource;
  let checks=0;
  const tampered=Buffer.from('journal altered while asynchronous backups were rechecked');
  // First two calls verify the initial backup pair; calls 3 and 4 are
  // the final pair. Simulate an external writer after #4 has returned its
  // valid result, where the old inspector would acknowledge stale evidence.
  t.mock.method(module,'verifyBackupRecoverySource',
   async (input:Parameters<typeof realVerify>[0])=>{
    const result=await realVerify(input);
    if(++checks===4)await writeFile(journalPath,tampered);
    return result;
   });
  const observation=await inspectNativeRestoreIntentReadOnly(query);
  assert.equal(checks,4,'must mutate after the second complete backup pass');
  assert.deepEqual(observation,{
   status:'BLOCKED',reason:'UNSAFE_JOURNAL',
   automaticPatchAllowed:false,automaticRollbackAllowed:false,
   tampermonkeyVerified:false,businessVerified:false
  });
  assert.deepEqual(await readFile(journalPath),tampered,
   'read-only reconciliation must not overwrite or auto-repair external changes');
  assert.deepEqual(await readFile(opts.sourcePath),original);
  assert.deepEqual(await readFile(join(opts.backupDirectory,opts.backupFileName)),original);
  assert.notDeepEqual(await readFile(journalPath),originalJournal);
 });
});

test('TASK-011/TEST-020/026: intent edited during the last source fingerprint cannot yield a stale observation',async t=>{
 await fixture(async opts=>{
  const restored=await restoreVerifiedOriginalNativeOnly(opts);
  assert.equal(restored.status,'RESTORED_NATIVE_ONLY');
  if(restored.status!=='RESTORED_NATIVE_ONLY')return;
  const journalPath=join(opts.backupDirectory,restored.journalFileName);
  const sourceModule=require('../../src/version/source-snapshot') as
   typeof import('../../src/version/source-snapshot');
  const real=sourceModule.verifyApprovedSourceFingerprint;
  let originalReads=0;
  const external=Buffer.from('intent changed during final source fingerprint');
  // The inspector checks the original source twice: first before its late
  // backup/journal checks, then once more for final source stability.
  // Change the intent AFTER the second verified source read returns, where
  // an earlier journal recheck can no longer establish current evidence.
  t.mock.method(sourceModule,'verifyApprovedSourceFingerprint',
   async (input:Parameters<typeof real>[0])=>{
    const result=await real(input);
    if(input!==null&&typeof input==='object'&&
       'expectedSha256' in input&&input.expectedSha256===sha(original)&&
       result.status==='MATCHED_READ_ONLY'&&++originalReads===2)
      await writeFile(journalPath,external);
    return result;
   });
  const result=await inspectNativeRestoreIntentReadOnly({
   sourcePath:opts.sourcePath,backupDirectory:opts.backupDirectory,
   journalFileName:restored.journalFileName,userApproved:true
  });
  assert.equal(originalReads,2,'must inject only at the last source check');
  assert.deepEqual(result,{
   status:'BLOCKED',reason:'UNSAFE_JOURNAL',
   automaticPatchAllowed:false,automaticRollbackAllowed:false,
   tampermonkeyVerified:false,businessVerified:false
  });
  assert.deepEqual(await readFile(journalPath),external,
   'read-only inspection must not erase independent edits or rewrite evidence');
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

test('TASK-011/TEST-020/026: post-rename journal corruption must not receive a success receipt',async t=>{
 await fixture(async opts=>{
  const snapshot=require('../../src/version/source-snapshot') as
   typeof import('../../src/version/source-snapshot');
  const realVerify=snapshot.verifyApprovedSourceFingerprint;
  let mutated=false;
  t.mock.method(snapshot,'verifyApprovedSourceFingerprint',
   async (input:Parameters<typeof realVerify>[0])=>{
    const result=await realVerify(input);
    // Only after the actual rename: this exact ORIGINAL hash cannot
    // match the pre-restore edited source. A third party damages the
    // already-published intent between source validation and success.
    if(!mutated&&input!==null&&typeof input==='object'&&
       'expectedSha256' in input&&input.expectedSha256===sha(original)&&
       result.status==='MATCHED_READ_ONLY'){
      const journals=(await readdir(opts.backupDirectory))
       .filter(name=>name.endsWith('.journal.json'));
      assert.equal(journals.length,1);
      mutated=true;
      await writeFile(join(opts.backupDirectory,journals[0]),
       Buffer.from('externally-corrupted-post-rename-journal'));
    }
    return result;
   });
  const receipt=await restoreVerifiedOriginalNativeOnly(opts);
  assert.equal(mutated,true,'must inject after actual original-file replacement');
  assert.deepEqual(receipt,{status:'BLOCKED',reason:'RECOVERY_SAFETY_FAILED',
   automaticPatchAllowed:false,automaticRollbackAllowed:false,
   tampermonkeyVerified:false,businessVerified:false});
  assert.deepEqual(await readFile(opts.sourcePath),original,
   'do not automatically undo an already completed rename');
  assert.ok((await readdir(opts.backupDirectory))
   .some(name=>name.endsWith('.backup.user.js')&&name!==opts.backupFileName),
   'retain the displaced-version backup for manual reconciliation');
 });
});

test('TASK-011/TEST-020/026: post-rename original backup corruption must not receive success',async t=>{
 await fixture(async opts=>{
  const snapshot=require('../../src/version/source-snapshot') as
   typeof import('../../src/version/source-snapshot');
  const realVerify=snapshot.verifyApprovedSourceFingerprint;
  let mutated=false;
  t.mock.method(snapshot,'verifyApprovedSourceFingerprint',
   async (input:Parameters<typeof realVerify>[0])=>{
    const result=await realVerify(input);
    if(!mutated&&input!==null&&typeof input==='object'&&
       'expectedSha256' in input&&input.expectedSha256===sha(original)&&
       result.status==='MATCHED_READ_ONLY'){
      mutated=true;
      await writeFile(join(opts.backupDirectory,opts.backupFileName),
       Buffer.from('externally-corrupted-original-backup'));
    }
    return result;
   });
  const receipt=await restoreVerifiedOriginalNativeOnly(opts);
  assert.equal(mutated,true);
  assert.deepEqual(receipt,{status:'BLOCKED',reason:'RECOVERY_SAFETY_FAILED',
   automaticPatchAllowed:false,automaticRollbackAllowed:false,
   tampermonkeyVerified:false,businessVerified:false});
  assert.deepEqual(await readFile(opts.sourcePath),original);
  assert.ok((await readdir(opts.backupDirectory))
   .some(name=>name.endsWith('.journal.json')),
   'preserve published intent even when subsequent evidence is unsafe');
 });
});

test('TASK-011/TEST-020/021: a source changed during final journal verification cannot receive a restore success receipt',async t=>{
 await fixture(async opts=>{
  const module=require('../../src/version/candidate-bytes') as
   typeof import('../../src/version/candidate-bytes');
  const real=module.verifyExactCandidateBytesReadOnly;
  const externalBytes=Buffer.from('// externally edited AFTER restored source was checked\\n');
  let journalChecks=0;
  let changedAfterRename=false;
  // The native transaction checks the published journal once BEFORE
  // source replacement, and again AFTER the source has been restored and
  // independently verified. Mutate only during the SECOND check, simulating
  // an uncooperative external writer while post-rename evidence is awaited.
  t.mock.method(module,'verifyExactCandidateBytesReadOnly',
   async (path:Parameters<typeof real>[0],expected:Parameters<typeof real>[1])=>{
    const result=await real(path,expected);
    if(path.endsWith('.journal.json')&&++journalChecks===2){
     changedAfterRename=true;
     assert.deepEqual(await readFile(opts.sourcePath),original,
      'the restored original must already be installed before fault injection');
     await writeFile(opts.sourcePath,externalBytes);
    }
    return result;
   });
  const receipt=await restoreVerifiedOriginalNativeOnly(opts);
  assert.equal(changedAfterRename,true,'must execute the post-rename interleaving');
  assert.deepEqual(receipt,{
   status:'BLOCKED',reason:'RECOVERY_SAFETY_FAILED',
   automaticPatchAllowed:false,automaticRollbackAllowed:false,
   tampermonkeyVerified:false,businessVerified:false
  });
  assert.deepEqual(await readFile(opts.sourcePath),externalBytes,
   'never overwrite the external writer during receipt rejection');
  const names=await readdir(opts.backupDirectory);
  assert.ok(names.includes(opts.backupFileName));
  assert.ok(names.some(x=>x.endsWith('.backup.user.js')&&x!==opts.backupFileName));
  assert.ok(names.some(x=>x.endsWith('.journal.json')),
   'retain the independent recovery evidence for manual reconciliation');
 });
});


test('TASK-011/TEST-020/026: replaced pending inode after last byte check must never overwrite selected source',async t=>{
 await fixture(async opts=>{
  const module=require('../../src/version/candidate-bytes') as
   typeof import('../../src/version/candidate-bytes');
  const realVerify=module.verifyExactCandidateBytesReadOnly;
  let stagingChecks=0;
  const sourceParent=dirname(opts.sourcePath);
  const foreign=Buffer.alloc(original.length,0x58);
  // First check validates the staged recovery bytes. After the FINAL check
  // returns MATCH, simulate another process swapping the pending pathname.
  // The earlier digest must not authorize renaming the replacement inode.
  t.mock.method(module,'verifyExactCandidateBytesReadOnly',
   async (path:Parameters<typeof realVerify>[0],
          expected:Parameters<typeof realVerify>[1])=>{
    const result=await realVerify(path,expected);
    if(dirname(path)===sourceParent&&
       path.slice(sourceParent.length+1).startsWith('.uah-restore-')&&path.endsWith('.pending')&&
       result==='MATCH'&&++stagingChecks===2){
     const displacedPending=join(sourceParent,'.externally-moved-'+randomUUID());
     await rename(path,displacedPending);
     await writeFile(path,foreign);
    }
    return result;
   });
  const result=await restoreVerifiedOriginalNativeOnly(opts);
  assert.equal(stagingChecks,2,'must inject between final digest and atomic rename');
  assert.deepEqual(result,{
   status:'BLOCKED',reason:'RECOVERY_SAFETY_FAILED',
   automaticPatchAllowed:false,automaticRollbackAllowed:false,
   tampermonkeyVerified:false,businessVerified:false
  });
  assert.deepEqual(await readFile(opts.sourcePath),changed,
   'never replace the selected original with a different pending inode');
  assert.deepEqual(await readFile(join(opts.backupDirectory,opts.backupFileName)),original);
  assert.ok((await readdir(opts.backupDirectory))
   .some(n=>n.endsWith('.journal.json')),
   'retain recovery intent and backups for independent reconciliation');
 });
});

test('TASK-011/TEST-020/026: Windows case aliases must share a native restore path lock',
 {skip:process.platform!=='win32'},async()=>{
 await fixture(async opts=>{
  // A Windows path normally names the same file regardless of component case.
  // Pre-hold its canonical mutex before either spelling is admitted. No
  // replacement or new backup may occur; the existing source is user data.
  const canonicalKey=opts.sourcePath.toLowerCase();
  const expectedLock=join(join(opts.sourcePath,'..'),
   '.uah-restore-path-'+createHash('sha256').update(canonicalKey,'utf8').digest('hex'));
  await mkdir(expectedLock);
  try{
   const before=await readdir(opts.backupDirectory);
   const alternate=opts.sourcePath.toUpperCase();
   assert.notEqual(alternate,opts.sourcePath,'fixture must exercise a different spelling');
   for(const sourcePath of [opts.sourcePath,alternate]){
    const result=await restoreVerifiedOriginalNativeOnly({...opts,sourcePath});
    assert.deepEqual(result,{
     status:'BLOCKED',reason:'SOURCE_LOCKED',
     automaticPatchAllowed:false,automaticRollbackAllowed:false,
     tampermonkeyVerified:false,businessVerified:false
    },'alias spelling must never bypass an existing recovery mutex');
   }
   assert.deepEqual(await readFile(opts.sourcePath),changed);
   assert.deepEqual(await readdir(opts.backupDirectory),before,
    'blocked aliases must not publish a backup, intent, or staged restore');
  }finally{await rm(expectedLock,{recursive:true,force:true});}
 });
});

test('TASK-011/TEST-020/021: source modified while mutex is released cannot get success',async()=>{
 await fixture(async opts=>{
  const fsPromises=require('node:fs/promises') as typeof import('node:fs/promises');
  const originalRmdir=fsPromises.rmdir;
  const external=Buffer.from('// external editor intervened during mutex release\n');
  let changedDuringRelease=false;
  (fsPromises as {rmdir:typeof originalRmdir}).rmdir=async(path,...args)=>{
   const result=await originalRmdir(path,...args);
   if(typeof path==='string'&&path.includes('.uah-restore-path-')){
    assert.deepEqual(await readFile(opts.sourcePath),original);
    await writeFile(opts.sourcePath,external);
    changedDuringRelease=true;
   }
   return result;
  };
  try{
   const result=await restoreVerifiedOriginalNativeOnly(opts);
   assert.equal(changedDuringRelease,true);
   assert.deepEqual(result,{status:'BLOCKED',reason:'RECOVERY_SAFETY_FAILED',
    automaticPatchAllowed:false,automaticRollbackAllowed:false,
    tampermonkeyVerified:false,businessVerified:false});
   assert.deepEqual(await readFile(opts.sourcePath),external,
    'must preserve external writes after restoring source');
   const names=await readdir(opts.backupDirectory);
   assert.ok(names.includes(opts.backupFileName));
   assert.ok(names.some(n=>n.endsWith('.backup.user.js')&&n!==opts.backupFileName));
   assert.ok(names.some(n=>n.endsWith('.journal.json')));
  }finally{(fsPromises as {rmdir:typeof originalRmdir}).rmdir=originalRmdir;}
 });
});

test('TASK-011/TEST-020/021: journal changed while mutex is released cannot get success',async()=>{
 await fixture(async opts=>{
  const fsPromises=require('node:fs/promises') as typeof import('node:fs/promises');
  const originalRmdir=fsPromises.rmdir;
  let changedDuringRelease=false;
  (fsPromises as {rmdir:typeof originalRmdir}).rmdir=async(path,...args)=>{
   const result=await originalRmdir(path,...args);
   if(typeof path==='string'&&path.includes('.uah-restore-path-')){
    const journals=(await readdir(opts.backupDirectory))
     .filter(n=>n.endsWith('.journal.json'));
    assert.equal(journals.length,1);
    await writeFile(join(opts.backupDirectory,journals[0]),
     Buffer.from('external journal replacement after mutex release'));
    changedDuringRelease=true;
   }
   return result;
  };
  try{
   const result=await restoreVerifiedOriginalNativeOnly(opts);
   assert.equal(changedDuringRelease,true);
   assert.deepEqual(result,{status:'BLOCKED',reason:'RECOVERY_SAFETY_FAILED',
    automaticPatchAllowed:false,automaticRollbackAllowed:false,
    tampermonkeyVerified:false,businessVerified:false});
   assert.deepEqual(await readFile(opts.sourcePath),original);
   const names=await readdir(opts.backupDirectory);
   assert.ok(names.includes(opts.backupFileName));
   assert.ok(names.some(n=>n.endsWith('.backup.user.js')&&n!==opts.backupFileName));
  }finally{(fsPromises as {rmdir:typeof originalRmdir}).rmdir=originalRmdir;}
 });
});
test('TASK-011/TEST-020/026: lock cleanup denied cannot acknowledge a native restore',async()=>{
 await fixture(async opts=>{
  const fsPromises=require('node:fs/promises') as typeof import('node:fs/promises');
  const nativeRmdir=fsPromises.rmdir;
  const expectedLock=join(
   join(opts.sourcePath,'..'),
   '.uah-restore-path-'+createHash('sha256').update(
    process.platform==='win32'?opts.sourcePath.toLowerCase():opts.sourcePath,
    'utf8').digest('hex')
  );
  let denied=false;
  (fsPromises as {rmdir:typeof nativeRmdir}).rmdir=async(path,...rest)=>{
   if(path===expectedLock){
    denied=true;
    throw Object.assign(new Error('lock directory busy'),{code:'EACCES'});
   }
   return nativeRmdir(path,...rest);
  };
  try{
   const result=await restoreVerifiedOriginalNativeOnly(opts);
   assert.equal(denied,true,'must inject a real final lock-cleanup error');
   assert.deepEqual(result,{
    status:'BLOCKED',reason:'RECOVERY_SAFETY_FAILED',
    automaticPatchAllowed:false,automaticRollbackAllowed:false,
    tampermonkeyVerified:false,businessVerified:false
   });
   // The atomic rename may already have succeeded; do not falsely imply
   // that the source is unchanged or erase its independent recovery copies.
   assert.deepEqual(await readFile(opts.sourcePath),original);
   const names=await readdir(opts.backupDirectory);
   assert.ok(names.includes(opts.backupFileName));
   assert.ok(names.some(n=>n.endsWith('.journal.json')));
   assert.ok(names.some(n=>n.endsWith('.backup.user.js')&&n!==opts.backupFileName));
   assert.ok((await lstat(expectedLock)).isDirectory(),
    'stranded cooperative lock must remain for explicit reconciliation');
  }finally{
   (fsPromises as {rmdir:typeof nativeRmdir}).rmdir=nativeRmdir;
  }
 });
});

const invokeNativeRestoreWithSignal=restoreVerifiedOriginalNativeOnly as
 (options:unknown,signal:AbortSignal)=>ReturnType<typeof restoreVerifiedOriginalNativeOnly>;
test('TASK-011/TEST-020/021/026: revoked native restore before start never touches selected source',async()=>{
 await fixture(async opts=>{
  const abort=new AbortController();
  abort.abort();
  const before=(await readdir(opts.backupDirectory)).sort();
  const result=await invokeNativeRestoreWithSignal(opts,abort.signal);
  assert.deepEqual([result.status,'reason' in result?result.reason:null],
   ['BLOCKED','CANCELLED']);
  assert.deepEqual(await readFile(opts.sourcePath),changed);
  assert.deepEqual((await readdir(opts.backupDirectory)).sort(),before,
   'no displaced backup, journal, pending or lock may be created');
  let traps=0;
  const hostile=new Proxy(abort.signal,{get(){traps++;throw Error('signal trap');}});
  const invalid=await invokeNativeRestoreWithSignal(opts,hostile);
  assert.deepEqual([invalid.status,'reason' in invalid?invalid.reason:null],
   ['BLOCKED','INVALID_REQUEST']);
  assert.equal(traps,0,'never evaluate a foreign signal proxy');
  assert.deepEqual(await readFile(opts.sourcePath),changed);
 });
});
test('TASK-011/TEST-020/021/026: revoked native window before final rename retains both backups and source',async()=>{
 await fixture(async opts=>{
  const abort=new AbortController();
  const fsPromises=require('node:fs/promises') as typeof import('node:fs/promises');
  const originalLink=fsPromises.link;
  let revokedAfterJournal=false;
  (fsPromises as {link:typeof originalLink}).link=async(from,to)=>{
   const completed=await originalLink(from,to);
   if(typeof to==='string'&&to.endsWith('.journal.json')){
    revokedAfterJournal=true;
    abort.abort();
   }
   return completed;
  };
  try{
   const result=await invokeNativeRestoreWithSignal(opts,abort.signal);
   assert.equal(revokedAfterJournal,true,'must reach actual published journal');
   assert.deepEqual([result.status,'reason' in result?result.reason:null],
    ['BLOCKED','CANCELLED']);
   assert.deepEqual(await readFile(opts.sourcePath),changed,
    'native restore cannot overwrite source after revocation');
   const entries=await readdir(opts.backupDirectory);
   assert.ok(entries.includes(opts.backupFileName));
   assert.ok(entries.some(n=>n.endsWith('.backup.user.js')&&n!==opts.backupFileName),
    'displaced version must remain independently recoverable');
   assert.ok(entries.some(n=>n.endsWith('.journal.json')),
    'published crash-recovery intent must survive cancellation');
   const root=await readdir(dirname(opts.sourcePath));
   assert.ok(!root.some(n=>n.startsWith('.uah-restore-path-')),
    'owned cooperative mutex must be released after cancellation');
  }finally{
   (fsPromises as {link:typeof originalLink}).link=originalLink;
  }
 });
});
