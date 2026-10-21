import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {mkdirSync,readdirSync,renameSync,writeFileSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReadOnlyBatchCoordinator} from '../../src/jobs/batch-coordinator';
import {
 BATCH_JOURNAL_FILENAME,saveReadOnlyBatchJournal,loadReadOnlyBatchJournal
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
