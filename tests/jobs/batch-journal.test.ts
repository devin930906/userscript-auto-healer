import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync,renameSync,writeFileSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReadOnlyBatchCoordinator} from '../../src/jobs/batch-coordinator';
import {
 BATCH_JOURNAL_FILENAME,saveReadOnlyBatchJournal,loadReadOnlyBatchJournal,
 runCheckpointedReadOnlyBatch
} from '../../src/jobs/batch-journal';

const hashes=[
 createHash('sha256').update('authorized-fixture-a').digest('hex'),
 createHash('sha256').update('authorized-fixture-b').digest('hex')
];
const options={count:2,jobHashes:hashes,maxAttempts:2,concurrency:1,timeoutMs:2000};
const completed=async()=> 'DONE' as const;
async function withJournal(run:(directory:string)=>Promise<void>){
 const directory=await mkdtemp(join(tmpdir(),'uah-batch-journal-'));
 try{await run(directory);}
 finally{await rm(directory,{recursive:true,force:true});}
}

test('TASK-013/TEST-022/026: forged out-of-order serial journal cannot skip a native worker',async()=>{
 await withJournal(async directory=>{
  const source=new ReadOnlyBatchCoordinator(options,completed);
  const forged={...source.snapshot(),jobs:[
   {ordinal:0,state:'QUEUED' as const,attempts:0},
   {ordinal:1,state:'SUCCEEDED' as const,attempts:1}
  ]};
  const file=join(directory,BATCH_JOURNAL_FILENAME);
  const bytes=JSON.stringify(forged);
  await writeFile(file,bytes);
  let dispatched=0;
  const restored=await loadReadOnlyBatchJournal(directory,options,async()=>{
   dispatched++;return 'DONE';
  });
  assert.deepEqual(restored,{status:'BLOCKED',reason:'INVALID_CHECKPOINT'});
  assert.equal(dispatched,0,'untrusted impossible state cannot resume/skips jobs');
  assert.deepEqual(await saveReadOnlyBatchJournal(directory,source),
   {status:'BLOCKED',reason:'INVALID_CHECKPOINT'},
   'existing corrupted journal may not be overwritten by a fresh save');
  assert.equal(await readFile(file,'utf8'),bytes);
 });
});

test('TASK-013/TEST-022: native checkpoint survives restart without granting repair authority',async()=>{
 await withJournal(async directory=>{
  const seen:number[]=[];
  const first=new ReadOnlyBatchCoordinator(options,async ordinal=>{
   seen.push(ordinal);return 'DONE';
  });
  const initial=await saveReadOnlyBatchJournal(directory,first);
  assert.equal(initial.status,'CHECKPOINT_SAVED_UNVERIFIED');
  assert.equal(seen.length,0);
  const restored=await loadReadOnlyBatchJournal(directory,options,async ordinal=>{
   seen.push(ordinal);return 'DONE';
  });
  assert.equal(restored.status,'CHECKPOINT_RESTORED_SCHEDULING_ONLY');
  if(restored.status!=='CHECKPOINT_RESTORED_SCHEDULING_ONLY')return;
  const result=await restored.coordinator.run();
  assert.deepEqual(seen,[0,1]);
  assert.deepEqual(result.jobs.map(job=>job.state),['SUCCEEDED','SUCCEEDED']);
  for(const field of ['automaticPatchAllowed','automaticRollbackAllowed',
    'tampermonkeyVerified','businessVerified'] as const)assert.equal(result[field],false);
  const final=await saveReadOnlyBatchJournal(directory,restored.coordinator);
  assert.equal(final.status,'CHECKPOINT_SAVED_UNVERIFIED');
  const bytes=await readFile(join(directory,BATCH_JOURNAL_FILENAME));
  const persisted=JSON.parse(bytes.toString('utf8')) as Record<string,unknown>;
  assert.equal(persisted.schema,'uah-readonly-batch-v2');
  assert.equal(JSON.stringify(persisted).includes(directory),false);
  assert.equal(JSON.stringify(persisted).includes('authorized-fixture-a'),false);
  if(final.status==='CHECKPOINT_SAVED_UNVERIFIED')
   assert.equal(final.sha256,createHash('sha256').update(bytes).digest('hex'));
  const again=await loadReadOnlyBatchJournal(directory,options,async ordinal=>{
   seen.push(ordinal);return 'DONE';
  });
  assert.equal(again.status,'CHECKPOINT_RESTORED_SCHEDULING_ONLY');
  if(again.status==='CHECKPOINT_RESTORED_SCHEDULING_ONLY'){
   assert.deepEqual((await again.coordinator.run()).jobs.map(job=>job.state),
     ['SUCCEEDED','SUCCEEDED']);
   assert.deepEqual(seen,[0,1],'a completed persisted batch must not replay');
  }
 });
});

test('TASK-013/TEST-022: foreign batch cannot replace or reuse a committed journal',async()=>{
 await withJournal(async directory=>{
  const original=new ReadOnlyBatchCoordinator(options,completed);
  assert.equal((await saveReadOnlyBatchJournal(directory,original)).status,
    'CHECKPOINT_SAVED_UNVERIFIED');
  const file=join(directory,BATCH_JOURNAL_FILENAME);
  const before=await readFile(file);
  const foreignOptions={...options,jobHashes:[...hashes].reverse()};
  const foreign=new ReadOnlyBatchCoordinator(foreignOptions,completed);
  const attempt=await saveReadOnlyBatchJournal(directory,foreign);
  assert.deepEqual(attempt,{status:'BLOCKED',reason:'INVALID_CHECKPOINT'});
  assert.deepEqual(await readFile(file),before);
  const load=await loadReadOnlyBatchJournal(directory,foreignOptions,completed);
  assert.deepEqual(load,{status:'BLOCKED',reason:'INVALID_CHECKPOINT'});
 });
});

test('TASK-013/TEST-022: malformed journal cannot be trusted or overwritten',async()=>{
 await withJournal(async directory=>{
  const file=join(directory,BATCH_JOURNAL_FILENAME);
  await writeFile(file,'{"schema":"tampered","automaticPatchAllowed":true}');
  const original=await readFile(file);
  assert.deepEqual(await loadReadOnlyBatchJournal(directory,options,completed),
    {status:'BLOCKED',reason:'INVALID_CHECKPOINT'});
  const fresh=new ReadOnlyBatchCoordinator(options,completed);
  assert.deepEqual(await saveReadOnlyBatchJournal(directory,fresh),
    {status:'BLOCKED',reason:'INVALID_CHECKPOINT'});
  assert.deepEqual(await readFile(file),original);
 });
});

test('TASK-013/TEST-022: active writer lock blocks reads and writes without cleanup',async()=>{
 await withJournal(async directory=>{
  const coordinator=new ReadOnlyBatchCoordinator(options,completed);
  assert.equal((await saveReadOnlyBatchJournal(directory,coordinator)).status,
    'CHECKPOINT_SAVED_UNVERIFIED');
  const lock=join(directory,'.uah-readonly-batch-v2.lock');
  await mkdir(lock);
  const before=await readFile(join(directory,BATCH_JOURNAL_FILENAME));
  assert.deepEqual(await loadReadOnlyBatchJournal(directory,options,completed),
    {status:'BLOCKED',reason:'BUSY'});
  assert.deepEqual(await saveReadOnlyBatchJournal(directory,coordinator),
    {status:'BLOCKED',reason:'BUSY'});
  assert.deepEqual(await readFile(join(directory,BATCH_JOURNAL_FILENAME)),before);
 });
});

test('TASK-013/TEST-022: missing journal and unapproved directory fail closed',async()=>{
 await withJournal(async directory=>{
  assert.deepEqual(await loadReadOnlyBatchJournal(directory,options,completed),
    {status:'BLOCKED',reason:'NOT_FOUND'});
  const absent=join(directory,'not-created');
  const coordinator=new ReadOnlyBatchCoordinator(options,completed);
  assert.deepEqual(await saveReadOnlyBatchJournal(absent,coordinator),
    {status:'BLOCKED',reason:'UNSAFE_PATH'});
  assert.deepEqual(await loadReadOnlyBatchJournal(absent,options,completed),
    {status:'BLOCKED',reason:'UNSAFE_PATH'});
 });
});


test('TASK-013/TEST-022/026: native journal refuses forged instances and Proxy traps',async()=>{
 await withJournal(async directory=>{
  let invoked=0;
  const fake=Object.create(ReadOnlyBatchCoordinator.prototype) as ReadOnlyBatchCoordinator;
  Object.defineProperty(fake,'snapshot',{get(){
   invoked++;throw Error('PRIVATE_SOURCE_MUST_NOT_ESCAPE');
  }});
  const proxied=new Proxy(new ReadOnlyBatchCoordinator(options,completed),{
   getPrototypeOf(){invoked++;throw Error('PRIVATE_PROXY_TRAP');},
   get(){invoked++;throw Error('PRIVATE_PROXY_GET');}
  });
  for(const input of [fake,proxied]){
   assert.deepEqual(await saveReadOnlyBatchJournal(directory,input),
    {status:'BLOCKED',reason:'INVALID_INPUT'});
  }
  assert.equal(invoked,0,'reject malformed native instances without trap access');
  await assert.rejects(readFile(join(directory,BATCH_JOURNAL_FILENAME)),
   {code:'ENOENT'},'rejected inputs must not create a journal');
 });
});

test('TASK-013/TEST-022/026: shadowed instance methods cannot forge checkpoint writes',async()=>{
 await withJournal(async directory=>{
  const valid=new ReadOnlyBatchCoordinator(options,completed);
  Object.defineProperty(valid,'snapshot',{value:()=>{
   throw Error('OVERRIDDEN_SNAPSHOT_MUST_NOT_RUN');
  }});
  const written=await saveReadOnlyBatchJournal(directory,valid);
  assert.equal(written.status,'CHECKPOINT_SAVED_UNVERIFIED');
  const file=join(directory,BATCH_JOURNAL_FILENAME);
  const original=await readFile(file);
  const saved=JSON.parse(original.toString('utf8')) as Record<string,unknown>;
  assert.equal(saved.automaticPatchAllowed,false);
  assert.equal(saved.automaticRollbackAllowed,false);
  const foreign=new ReadOnlyBatchCoordinator({...options,jobHashes:[...hashes].reverse()},completed);
  Object.defineProperty(foreign,'mayPersistOver',{value:()=>true});
  assert.deepEqual(await saveReadOnlyBatchJournal(directory,foreign),
   {status:'BLOCKED',reason:'INVALID_CHECKPOINT'});
  assert.deepEqual(await readFile(file),original,
   'shadowed monotonicity check must not overwrite a different batch');
 });
});

test('TASK-013/TEST-022/026: a replaced pending checkpoint must not become the committed journal',async()=>{
 await withJournal(async directory=>{
  const native=new ReadOnlyBatchCoordinator(options,completed);
  const original=ReadOnlyBatchCoordinator.prototype.snapshot;
  let count=0;
  let replacementPath='';
  ReadOnlyBatchCoordinator.prototype.snapshot=function(this:ReadOnlyBatchCoordinator){
   count++;
   if(count===2){
    const staged=readdirSync(directory).filter(name=>
     name.startsWith('.uah-readonly-batch-')&&name.endsWith('.tmp'));
    assert.equal(staged.length,1,'fixture must intercept the staged file before publication');
    replacementPath=join(directory,staged[0]);
    renameSync(replacementPath,join(directory,'owned-staging-kept-for-review'));
    writeFileSync(replacementPath,'FOREIGN-STAGING-MUST-REMAIN');
   }
   return original.call(this);
  };
  try{
   const result=await saveReadOnlyBatchJournal(directory,native);
   assert.deepEqual(result,{status:'BLOCKED',reason:'INVALID_CHECKPOINT'});
   assert.equal(count,2);
   assert.equal((await readFile(replacementPath,'utf8')),'FOREIGN-STAGING-MUST-REMAIN');
   await assert.rejects(readFile(join(directory,BATCH_JOURNAL_FILENAME)),{code:'ENOENT'},
    'no unowned file may be promoted to the trusted journal name');
  }finally{ReadOnlyBatchCoordinator.prototype.snapshot=original;}
 });
});

test('TASK-013/TEST-022/026: post-rename matching bytes from a different inode must not attest a saved journal',async()=>{
 await withJournal(async directory=>{
  const fsPromises=require('node:fs/promises') as typeof import('node:fs/promises');
  const realRename=fsPromises.rename;
  const journal=join(directory,BATCH_JOURNAL_FILENAME);
  const retained=join(directory,'owned-journal-retained-for-review');
  let injected=false;
  // Interpose precisely after the native rename: the replacement is byte-for-byte
  // identical but a DIFFERENT inode. No arbitrary data is exposed or deleted.
  (fsPromises as {rename:typeof realRename}).rename=async(from,to)=>{
   await realRename(from,to);
   if(to===journal){
    injected=true;
    const bytes=await readFile(journal);
    await realRename(journal,retained);
    await writeFile(journal,bytes);
   }
  };
  try{
   const output=await saveReadOnlyBatchJournal(directory,
    new ReadOnlyBatchCoordinator(options,completed));
   assert.equal(injected,true);
   assert.deepEqual(output,{status:'BLOCKED',reason:'IO_FAILURE'});
   assert.deepEqual(await readFile(journal),await readFile(retained));
  }finally{(fsPromises as {rename:typeof realRename}).rename=realRename;}
 });
});

test('TASK-013/TEST-022/026: losing the writer lock identity aborts publish and preserves foreign lock',async()=>{
 await withJournal(async directory=>{
  const native=new ReadOnlyBatchCoordinator(options,completed);
  const original=ReadOnlyBatchCoordinator.prototype.snapshot;
  const lock=join(directory,'.uah-readonly-batch-v2.lock');
  let count=0;
  ReadOnlyBatchCoordinator.prototype.snapshot=function(this:ReadOnlyBatchCoordinator){
   count++;
   if(count===2){
    renameSync(lock,join(directory,'original-owned-lock-kept-for-review'));
    mkdirSync(lock);
   }
   return original.call(this);
  };
  try{
   const result=await saveReadOnlyBatchJournal(directory,native);
   assert.deepEqual(result,{status:'BLOCKED',reason:'BUSY'});
   assert.equal(count,2);
   assert.deepEqual(readdirSync(lock),[],
    'a substituted lock remains present and untouched for its actual owner');
   await assert.rejects(readFile(join(directory,BATCH_JOURNAL_FILENAME)),{code:'ENOENT'});
  }finally{ReadOnlyBatchCoordinator.prototype.snapshot=original;}
 });
});

test('TASK-013/TEST-022: each completed job and active read-only attempt is durable before next dispatch',async()=>{
 await withJournal(async directory=>{
  let waiting!:()=>void,release!:()=>void;
  const started=new Promise<void>(resolve=>{waiting=resolve;});
  const suspended=new Promise<void>(resolve=>{release=resolve;});
  const calls:number[]=[];
  const first=new ReadOnlyBatchCoordinator(options,async ordinal=>{
   calls.push(ordinal);
   if(ordinal===1){waiting();await suspended;}
   return 'DONE';
  });
  const progress=runCheckpointedReadOnlyBatch(directory,first);
  await started;
  // This snapshot exists while job #1 is still active: job #0 has been
  // durably completed, and job #1's first attempt was written before dispatch.
  const bytes=await readFile(join(directory,BATCH_JOURNAL_FILENAME));
  const onDisk=JSON.parse(bytes.toString('utf8'));
  assert.deepEqual(onDisk.jobs.map((job:{state:string})=>job.state),
   ['SUCCEEDED','RUNNING']);
  assert.deepEqual(onDisk.jobs.map((job:{attempts:number})=>job.attempts),[1,1]);
  assert.equal(onDisk.automaticPatchAllowed,false);
  assert.equal(onDisk.automaticRollbackAllowed,false);
  // Read the captured journal in a separate disposable folder to simulate
  // restarting with the crash-time bytes; never touch the live batch.
  await withJournal(async recoveryDirectory=>{
   await writeFile(join(recoveryDirectory,BATCH_JOURNAL_FILENAME),bytes);
   const replayed:number[]=[];
   const restored=await loadReadOnlyBatchJournal(
    recoveryDirectory,options,async ordinal=>{replayed.push(ordinal);return 'DONE';});
   assert.equal(restored.status,'CHECKPOINT_RESTORED_SCHEDULING_ONLY');
   if(restored.status!=='CHECKPOINT_RESTORED_SCHEDULING_ONLY')return;
   const after=await runCheckpointedReadOnlyBatch(recoveryDirectory,restored.coordinator);
   assert.equal(after.status,'BATCH_SETTLED_CHECKPOINTED_UNVERIFIED',JSON.stringify(after));
   assert.deepEqual(replayed,[1],'a completed job must not be replayed');
   if(after.status==='BATCH_SETTLED_CHECKPOINTED_UNVERIFIED'){
    assert.deepEqual(after.snapshot.jobs.map(j=>j.attempts),[1,2]);
    assert.equal(after.snapshot.businessVerified,false);
   }
  });
  release();
  const done=await progress;
  assert.equal(done.status,'BATCH_SETTLED_CHECKPOINTED_UNVERIFIED',JSON.stringify(done));
  assert.deepEqual(calls,[0,1]);
 });
});

test('TASK-013/TEST-022: failed checkpoint refuses dispatch without overwriting foreign lock',async()=>{
 await withJournal(async directory=>{
  let called=0;
  const coordinator=new ReadOnlyBatchCoordinator(options,async()=>{
   called++;return 'DONE';
  });
  const original=ReadOnlyBatchCoordinator.prototype.snapshot;
  const fsPromises=require('node:fs/promises') as typeof import('node:fs/promises');
  const nativeRename=fsPromises.rename;
  const lock=join(directory,'.uah-readonly-batch-v2.lock');
  const target=join(directory,BATCH_JOURNAL_FILENAME);
  let firstJournalPublished=false,foreignLockInjected=false;
  // Install the foreign lock ONLY after the first fully published journal
  // has released its writer lock, just before the RUNNING transition tries
  // to persist. Do not depend on how many safety snapshots save() takes.
  (fsPromises as {rename:typeof nativeRename}).rename=async(from,to)=>{
   await nativeRename(from,to);
   if(to===target)firstJournalPublished=true;
  };
  ReadOnlyBatchCoordinator.prototype.snapshot=function(this:ReadOnlyBatchCoordinator){
   if(firstJournalPublished&&!foreignLockInjected&&!existsSync(lock)){
    mkdirSync(lock);foreignLockInjected=true;
   }
   return original.call(this);
  };
  try{
   const result=await runCheckpointedReadOnlyBatch(directory,coordinator);
   assert.equal(foreignLockInjected,true,'inject real contention before second save');
   assert.deepEqual(result,{status:'BLOCKED',reason:'BUSY'});
   assert.equal(called,0,'worker must not start without persisted RUNNING attempt');
   assert.deepEqual(readdirSync(lock),[],'foreign lock evidence is retained');
   const bytes=JSON.parse(await readFile(join(directory,BATCH_JOURNAL_FILENAME),'utf8'));
   assert.deepEqual(bytes.jobs.map((job:{state:string})=>job.state),
    ['QUEUED','QUEUED']);
  }finally{
   ReadOnlyBatchCoordinator.prototype.snapshot=original;
   (fsPromises as {rename:typeof nativeRename}).rename=nativeRename;
  }
 });
});

test('TASK-013/TEST-022: checkpointed run refuses concurrency two and unbound batch identities',async()=>{
 await withJournal(async directory=>{
  let called=0;
  const worker=async()=>{called++;return 'DONE' as const;};
  const concurrent=new ReadOnlyBatchCoordinator({...options,concurrency:2},worker);
  assert.deepEqual(await runCheckpointedReadOnlyBatch(directory,concurrent),
   {status:'BLOCKED',reason:'INVALID_INPUT'});
  const unbound=new ReadOnlyBatchCoordinator({count:1},worker);
  assert.deepEqual(await runCheckpointedReadOnlyBatch(directory,unbound),
   {status:'BLOCKED',reason:'INVALID_INPUT'});
  assert.equal(called,0);
  await assert.rejects(readFile(join(directory,BATCH_JOURNAL_FILENAME)),
   {code:'ENOENT'});
 });
});


test('TASK-013/TEST-022/026: cancellation during checkpoint rename cannot return a stale success receipt',async()=>{
 await withJournal(async directory=>{
  const fsPromises=require('node:fs/promises') as typeof import('node:fs/promises');
  const nativeRename=fsPromises.rename;
  const target=join(directory,BATCH_JOURNAL_FILENAME);
  const coordinator=new ReadOnlyBatchCoordinator(options,completed);
  let cancelledDuringPublish=false;
  // Reproduce the real async gap AFTER the earlier native snapshot check:
  // the rename completed, then a user cancellation changed queued jobs
  // before the original save() returned. No foreign file is introduced.
  (fsPromises as {rename:typeof nativeRename}).rename=async(from,to)=>{
   await nativeRename(from,to);
   if(to===target){
    cancelledDuringPublish=true;
    coordinator.cancel();
   }
  };
  try{
   const saved=await saveReadOnlyBatchJournal(directory,coordinator);
   assert.equal(cancelledDuringPublish,true,'test must hit the post-snapshot publication gap');
   assert.deepEqual(saved,{status:'BLOCKED',reason:'INVALID_CHECKPOINT'},
    'a stale QUEUED journal must not receive a successful durability receipt');
   const onDisk=JSON.parse(await readFile(target,'utf8'));
   assert.deepEqual(onDisk.jobs.map((job:{state:string})=>job.state),
    ['QUEUED','QUEUED'],'keep the prior bytes for a safe, explicit retry');
   assert.deepEqual(coordinator.snapshot().jobs.map(job=>job.state),
    ['CANCELLED','CANCELLED'],'do not erase a legitimate cancellation');
  }finally{
   (fsPromises as {rename:typeof nativeRename}).rename=nativeRename;
  }
  // A fresh, legitimate save of the current terminal state remains possible.
  const retry=await saveReadOnlyBatchJournal(directory,coordinator);
  assert.equal(retry.status,'CHECKPOINT_SAVED_UNVERIFIED');
  const latest=JSON.parse(await readFile(target,'utf8'));
  assert.deepEqual(latest.jobs.map((job:{state:string})=>job.state),
   ['CANCELLED','CANCELLED']);
 });
});

test('TASK-013/TEST-022/026: cancellation during final writer-lock recheck refuses stale receipt',async()=>{
 await withJournal(async directory=>{
  const fsPromises=require('node:fs/promises') as typeof import('node:fs/promises');
  const nativeRename=fsPromises.rename;
  const nativeLstat=fsPromises.lstat;
  const target=join(directory,BATCH_JOURNAL_FILENAME);
  const lock=join(directory,'.uah-readonly-batch-v2.lock');
  const coordinator=new ReadOnlyBatchCoordinator(options,completed);
  let published=false,lockChecks=0,cancelledDuringFinalCheck=false;
  // Interpose at the second post-publication lock identity read, AFTER
  // the initial post-rename verification and before the save receipt.
  (fsPromises as {rename:typeof nativeRename}).rename=async(from,to)=>{
   await nativeRename(from,to);
   if(to===target)published=true;
  };
  (fsPromises as {lstat:typeof nativeLstat}).lstat=(async(
   ...args:Parameters<typeof nativeLstat>
  )=>{
   const result=await nativeLstat(...args);
   if(published&&args[0]===lock&&++lockChecks===2){
    cancelledDuringFinalCheck=true;
    coordinator.cancel();
   }
   return result;
  }) as typeof nativeLstat;
  try{
   const saved=await saveReadOnlyBatchJournal(directory,coordinator);
   assert.equal(cancelledDuringFinalCheck,true,'inject cancellation during last async lock check');
   assert.deepEqual(saved,{status:'BLOCKED',reason:'INVALID_CHECKPOINT'});
   assert.deepEqual(JSON.parse(await readFile(target,'utf8')).jobs.map(
    (job:{state:string})=>job.state),['QUEUED','QUEUED']);
   assert.deepEqual(coordinator.snapshot().jobs.map(job=>job.state),
    ['CANCELLED','CANCELLED']);
  }finally{
   (fsPromises as {lstat:typeof nativeLstat}).lstat=nativeLstat;
   (fsPromises as {rename:typeof nativeRename}).rename=nativeRename;
  }
 });
});

test('TASK-013/TEST-022/026: cancellation during writer lock cleanup never acknowledges stale checkpoint',async()=>{
 await withJournal(async directory=>{
  const fsPromises=require('node:fs/promises') as typeof import('node:fs/promises');
  const nativeRmdir=fsPromises.rmdir;
  const lock=join(directory,'.uah-readonly-batch-v2.lock');
  const file=join(directory,BATCH_JOURNAL_FILENAME);
  const coordinator=new ReadOnlyBatchCoordinator(options,completed);
  let cancelledInCleanup=false;
  // Interpose at an actual asynchronous cleanup boundary, after the last
  // in-try coordinator snapshot but BEFORE save() resolves to its caller.
  (fsPromises as {rmdir:typeof nativeRmdir}).rmdir=async(path,...rest)=>{
   await nativeRmdir(path,...rest);
   if(path===lock){
    cancelledInCleanup=true;
    coordinator.cancel();
   }
  };
  try{
   const result=await saveReadOnlyBatchJournal(directory,coordinator);
   assert.equal(cancelledInCleanup,true,'exercise genuine post-check cleanup await');
   assert.deepEqual(result,{status:'BLOCKED',reason:'INVALID_CHECKPOINT'},
    'do not acknowledge obsolete QUEUED bytes after an accepted cancellation');
   assert.deepEqual(JSON.parse(await readFile(file,'utf8')).jobs.map(
    (job:{state:string})=>job.state),['QUEUED','QUEUED']);
   assert.deepEqual(coordinator.snapshot().jobs.map(job=>job.state),
    ['CANCELLED','CANCELLED']);
  }finally{
   (fsPromises as {rmdir:typeof nativeRmdir}).rmdir=nativeRmdir;
  }
  const retry=await saveReadOnlyBatchJournal(directory,coordinator);
  assert.equal(retry.status,'CHECKPOINT_SAVED_UNVERIFIED');
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')).jobs.map(
   (job:{state:string})=>job.state),['CANCELLED','CANCELLED']);
 });
});

test('TASK-013/TEST-022/026: checkpoint tampering after writer mutex release invalidates the save receipt',async()=>{
 for(const mutation of ['different-bytes','same-bytes-new-inode'] as const){
  await withJournal(async directory=>{
   const fsPromises=require('node:fs/promises') as typeof import('node:fs/promises');
   const nativeRmdir=fsPromises.rmdir;
   const lock=join(directory,'.uah-readonly-batch-v2.lock');
   const target=join(directory,BATCH_JOURNAL_FILENAME);
   const coordinator=new ReadOnlyBatchCoordinator(options,completed);
   let injected=false;
   (fsPromises as {rmdir:typeof nativeRmdir}).rmdir=async(path,...rest)=>{
    await nativeRmdir(path,...rest);
    if(path===lock){
     injected=true;
     if(mutation==='different-bytes'){
      await writeFile(target,Buffer.from('externally modified checkpoint'));
     }else{
      const exact=await readFile(target);
      const previous=join(directory,'prior-owned-journal-preserved');
      renameSync(target,previous);
      writeFileSync(target,exact);
     }
    }
   };
   try{
    const result=await saveReadOnlyBatchJournal(directory,coordinator);
    assert.equal(injected,true,'test must mutate after the real lock release');
    assert.deepEqual(result,{status:'BLOCKED',reason:'INVALID_CHECKPOINT'});
    if(mutation==='different-bytes'){
     assert.equal((await readFile(target)).toString(),
      'externally modified checkpoint');
     assert.deepEqual(await loadReadOnlyBatchJournal(directory,options,completed),
      {status:'BLOCKED',reason:'INVALID_CHECKPOINT'});
    }else{
     const data=await readFile(target);
     assert.equal(JSON.parse(data.toString('utf8')).schema,'uah-readonly-batch-v2');
     assert.deepEqual(await readFile(join(directory,'prior-owned-journal-preserved')),data);
    }
    assert.deepEqual(coordinator.snapshot().jobs.map(j=>j.state),
     ['QUEUED','QUEUED'],'no batch worker or script update was authorized');
   }finally{
    (fsPromises as {rmdir:typeof nativeRmdir}).rmdir=nativeRmdir;
   }
  });
 }
});

test('TASK-013/TEST-022/026: lock cleanup denial cannot acknowledge an unusable checkpoint',async()=>{
 await withJournal(async directory=>{
  const fsPromises=require('node:fs/promises') as typeof import('node:fs/promises');
  const nativeRmdir=fsPromises.rmdir;
  const lock=join(directory,'.uah-readonly-batch-v2.lock');
  const file=join(directory,BATCH_JOURNAL_FILENAME);
  const coordinator=new ReadOnlyBatchCoordinator(options,completed);
  let denied=false;
  // The checkpoint is atomically published, but OS lock cleanup fails.
  // A successful receipt would strand every subsequent save/load as BUSY.
  (fsPromises as {rmdir:typeof nativeRmdir}).rmdir=async(path,...rest)=>{
   if(path===lock){
    denied=true;
    throw Object.assign(new Error('disposable lock directory is in use'),
     {code:'EACCES'});
   }
   return nativeRmdir(path,...rest);
  };
  try{
   const result=await saveReadOnlyBatchJournal(directory,coordinator);
   assert.equal(denied,true,'must exercise actual lock cleanup error');
   assert.deepEqual(result,{status:'BLOCKED',reason:'BUSY'});
   assert.deepEqual(JSON.parse(await readFile(file,'utf8')).jobs.map(
    (job:{state:string})=>job.state),['QUEUED','QUEUED']);
   assert.deepEqual(await loadReadOnlyBatchJournal(directory,options,completed),
    {status:'BLOCKED',reason:'BUSY'});
   assert.deepEqual(await saveReadOnlyBatchJournal(directory,coordinator),
    {status:'BLOCKED',reason:'BUSY'});
  }finally{
   (fsPromises as {rmdir:typeof nativeRmdir}).rmdir=nativeRmdir;
  }
 });
});


test('TASK-013/TEST-022: checkpoint reservation prevents ordinary dispatch before initial durable save',async()=>{
 await withJournal(async directory=>{
  const dispatched:number[]=[];
  const coordinator=new ReadOnlyBatchCoordinator(options,async ordinal=>{
   dispatched.push(ordinal);
   return 'DONE';
  });
  // The checkpointed operation must reserve its coordinator synchronously,
  // before its first asynchronous filesystem await. Ordinary run() must
  // not start workers that bypass the durable transition callback.
  const pending=runCheckpointedReadOnlyBatch(directory,coordinator);
  await assert.rejects(coordinator.run(),/BATCH_CHECKPOINT_RESERVED/);
  const result=await pending;
  assert.equal(result.status,'BATCH_SETTLED_CHECKPOINTED_UNVERIFIED');
  assert.deepEqual(dispatched,[0,1]);
  const recovered=await loadReadOnlyBatchJournal(directory,options,completed);
  assert.equal(recovered.status,'CHECKPOINT_RESTORED_SCHEDULING_ONLY');
 });
});


test('TASK-013/TEST-022/026: first checkpoint publish cannot overwrite a foreign target created after preflight',async()=>{
 await withJournal(async directory=>{
  const fsPromises=require('node:fs/promises') as typeof import('node:fs/promises');
  const nativeRename=fsPromises.rename;
  const nativeLink=fsPromises.link;
  const target=join(directory,BATCH_JOURNAL_FILENAME);
  const foreign='FOREIGN_UNTRUSTED_BATCH_MUST_NOT_BE_OVERWRITTEN';
  const coordinator=new ReadOnlyBatchCoordinator(options,completed);
  let injected=0;
  // Inject a competing file at the real filesystem publish syscall.
  // The ordinary earlier lstat() must see an ABSENT target. Both rename
  // (legacy) and hard-link (safe no-clobber) encounter the same adversary.
  const insertBeforePublish=(from:import('node:fs').PathLike,to:import('node:fs').PathLike)=>{
   if(typeof from==='string' && typeof to==='string' &&
      to===target && from.startsWith(join(directory,'.uah-readonly-batch-'))){
    injected++;
    writeFileSync(target,foreign,{flag:'wx'});
   }
  };
  (fsPromises as {rename:typeof nativeRename}).rename=async(from,to)=>{
   insertBeforePublish(from,to);
   return nativeRename(from,to);
  };
  (fsPromises as {link:typeof nativeLink}).link=async(from,to)=>{
   insertBeforePublish(from,to);
   return nativeLink(from,to);
  };
  try{
   const result=await saveReadOnlyBatchJournal(directory,coordinator);
   assert.equal(injected,1,'test must interleave after preflight and before publication');
   assert.equal(result.status,'BLOCKED',
    'a competing first-write target must never receive a successful checkpoint receipt');
   assert.equal(await readFile(target,'utf8'),foreign,
    'the owner of the newly appeared target keeps its original bytes');
   assert.deepEqual(coordinator.snapshot().jobs.map(j=>j.state),
    ['QUEUED','QUEUED'],'no read-only jobs may be reported as dispatched');
   assert.deepEqual(await loadReadOnlyBatchJournal(directory,options,completed),
    {status:'BLOCKED',reason:'INVALID_CHECKPOINT'});
  }finally{
   (fsPromises as {rename:typeof nativeRename}).rename=nativeRename;
   (fsPromises as {link:typeof nativeLink}).link=nativeLink;
  }
 });
});
