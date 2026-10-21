import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash,randomUUID} from 'node:crypto';
import {link,lstat,mkdir,mkdtemp,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {removeOwnedStagingPending} from '../../src/version/staging-pending-ownership';
import {proposeLiteralSelectorPatch,type LiteralPatchRequest} from '../../src/repair/patch-planner';
import {stageReviewedCandidateOnly} from '../../src/version/staged-candidate';
import {stageRecoveryCheckpointOnly,inspectRecoveryCheckpointReadOnly} from '../../src/version/recovery-checkpoint';

const source=[
 '// ==UserScript==',
 '// @name Recovery checkpoint fixture',
 '// @match https://example.com/*',
 '// @grant none',
 '// ==/UserScript==',
 "document.querySelector('#old');",
 ''
].join('\n');
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const request:LiteralPatchRequest={
 source,expectedSourceSha256:hash(source),
 callOffset:source.indexOf('document.querySelector'),
 method:'querySelector',originalSelector:'#old',replacementSelector:'#new',
 faultEvidenceId:'scenario_assertion_1'
};
const candidate=proposeLiteralSelectorPatch(request);
assert.equal(candidate.status,'CANDIDATE_ONLY');

async function fixture(run:(opts:{sourcePath:string;backupDirectory:string;
 userApproved:boolean})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'uah-checkpoint-'));
 const opts={sourcePath:join(root,'source.user.js'),
   backupDirectory:join(root,'backups'),userApproved:true};
 try{
   await mkdir(opts.backupDirectory);
   await writeFile(opts.sourcePath,source,'utf8');
   await run(opts);
 }finally{await rm(root,{recursive:true,force:true});}
}

test('TEST-020/026: pending cleanup refuses substituted source, alias and parent',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-cleanup-'));
 const folder=join(root,'backup');
 try{
  await mkdir(folder);
  const parent=await lstat(folder,{bigint:true});
  const next=()=>join(folder,'.'+randomUUID()+'.pending');
  const owned=next();
  await writeFile(owned,'owned');
  const first=await lstat(owned,{bigint:true});
  assert.equal(await removeOwnedStagingPending(owned,first,parent),true);
  assert.equal((await readdir(folder)).length,0);

  await writeFile(owned,'previous');
  const old=await lstat(owned,{bigint:true});
  await rename(owned,join(folder,'previous-preserved'));
  await writeFile(owned,'replacement');
  assert.equal(await removeOwnedStagingPending(owned,old,parent),false);
  assert.equal((await readFile(owned)).toString(),'replacement');
  assert.equal((await readFile(join(folder,'previous-preserved'))).toString(),'previous');

  const alias=next();
  await writeFile(alias,'double-linked');
  const beforeAlias=await lstat(alias,{bigint:true});
  await link(alias,join(folder,'third-alias'));
  assert.equal(await removeOwnedStagingPending(alias,beforeAlias,parent),false);
  assert.equal((await readFile(alias)).toString(),'double-linked');

  const pending=next();
  const published=join(folder,'published.backup.user.js');
  await writeFile(pending,'verified-copy');
  const before=await lstat(pending,{bigint:true});
  await link(pending,published);
  assert.equal(await removeOwnedStagingPending(pending,before,parent,published),true);
  assert.equal((await readFile(published)).toString(),'verified-copy');
  assert.equal((await lstat(published,{bigint:true})).nlink,1n);

  const separate=next();
  const unrelated=join(folder,'other.backup.user.js');
  await writeFile(separate,'important');
  const separateOwner=await lstat(separate,{bigint:true});
  await writeFile(unrelated,'other');
  assert.equal(await removeOwnedStagingPending(separate,separateOwner,parent,unrelated),false);
  assert.equal((await readFile(separate)).toString(),'important');
  assert.equal((await readFile(unrelated)).toString(),'other');

  const protectedPending=next();
  await writeFile(protectedPending,'old-directory');
  const identity=await lstat(protectedPending,{bigint:true});
  const oldDirectory=join(root,'previous-folder');
  await rename(folder,oldDirectory);
  await mkdir(folder);
  await writeFile(protectedPending,'new-directory');
  assert.equal(await removeOwnedStagingPending(protectedPending,identity,parent),false);
  assert.equal((await readFile(protectedPending)).toString(),'new-directory');
  assert.equal((await readFile(join(oldDirectory,
     protectedPending.slice(folder.length+1)))).toString(),'old-directory');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('TEST-020: persist a bounded recovery checkpoint without changing source or backup',async()=>{
 await fixture(async opts=>{
  const staged=await stageReviewedCandidateOnly(request,candidate,opts);
  assert.equal(staged.status,'CANDIDATE_STAGED_RUNTIME_UNVERIFIED');
  if(staged.status!=='CANDIDATE_STAGED_RUNTIME_UNVERIFIED')return;
  const output=await stageRecoveryCheckpointOnly(request,staged,opts);
  assert.equal(output.status,'CHECKPOINT_STAGED_UNVERIFIED',JSON.stringify(output));
  if(output.status!=='CHECKPOINT_STAGED_UNVERIFIED')return;
  const entries=await readdir(opts.backupDirectory);
  assert.deepEqual(entries.sort(),[
    staged.backupFileName,staged.candidateFileName,output.checkpointFileName
  ].sort());
  const bytes=await readFile(join(opts.backupDirectory,output.checkpointFileName));
  const json=JSON.parse(bytes.toString('utf8')) as Record<string,unknown>;
  assert.equal(json.schemaVersion,1);
  assert.equal(json.status,'RECOVERY_CHECKPOINT_UNVERIFIED');
  assert.equal(json.originalSha256,hash(source));
  assert.equal(json.backupFileName,staged.backupFileName);
  assert.equal(json.candidateFileName,staged.candidateFileName);
  assert.equal(json.candidateSha256,staged.candidateSha256);
  assert.equal(json.automaticPatchAllowed,false);
  assert.equal(json.automaticRollbackAllowed,false);
  assert.equal(json.tampermonkeyVerified,false);
  assert.equal(json.businessVerified,false);
  assert.equal(output.checkpointSha256,hash(bytes));
  // Rebuild the recovery observation from the persisted filename; no in-memory
  // staged receipt is passed to the reader, and no original file is written.
  const restored=await inspectRecoveryCheckpointReadOnly(
    request,output.checkpointFileName,opts
  );
  assert.equal(restored.status,'CHECKPOINT_RECHECKED_READ_ONLY',JSON.stringify(restored));
  if(restored.status==='CHECKPOINT_RECHECKED_READ_ONLY'){
    assert.equal(restored.checkpointSha256,hash(bytes));
    assert.equal(restored.originalSha256,hash(source));
    assert.equal(restored.automaticRollbackAllowed,false);
  }
  assert.equal(output.automaticPatchAllowed,false);
  assert.equal(output.automaticRollbackAllowed,false);
  assert.equal(await readFile(opts.sourcePath,'utf8'),source);
  assert.equal(await readFile(join(opts.backupDirectory,staged.backupFileName),'utf8'),source);
  assert.equal(JSON.stringify(output).includes(opts.sourcePath),false);
  assert.equal(bytes.includes(Buffer.from(opts.sourcePath,'utf8')),false);
 });
});

test('TEST-020/021: refuse untrusted receipts and absent native consent',async()=>{
 await fixture(async opts=>{
  const staged=await stageReviewedCandidateOnly(request,candidate,opts);
  assert.equal(staged.status,'CANDIDATE_STAGED_RUNTIME_UNVERIFIED');
  if(staged.status!=='CANDIDATE_STAGED_RUNTIME_UNVERIFIED')return;
  const baseline=(await readdir(opts.backupDirectory)).sort();
  const attacks=[
    [staged,{...opts,userApproved:false}],
    [{...staged,candidateSha256:'0'.repeat(64)},opts],
    [{...staged,automaticPatchAllowed:true},opts],
    [{...staged,businessVerified:true},opts],
    [staged,{...opts,runtimeEvidence:{tampermonkeyVerified:true}}],
    [Object.create(staged),opts],
    [{get status(){throw Error('private path');}},opts]
  ] as const;
  for(const [receipt,options] of attacks){
    const result=await stageRecoveryCheckpointOnly(request,receipt,options);
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal(JSON.stringify(result).includes(opts.sourcePath),false);
  }
  assert.deepEqual((await readdir(opts.backupDirectory)).sort(),baseline);
  assert.equal(await readFile(opts.sourcePath,'utf8'),source);
 });
});

test('TEST-020/026: recovery checkpoint stage and inspection reject Proxy before any reflection or filesystem mutation',async()=>{
 await fixture(async opts=>{
  const staged=await stageReviewedCandidateOnly(request,candidate,opts);
  assert.equal(staged.status,'CANDIDATE_STAGED_RUNTIME_UNVERIFIED');
  if(staged.status!=='CANDIDATE_STAGED_RUNTIME_UNVERIFIED')return;
  const before=(await readdir(opts.backupDirectory)).sort();
  let traps=0;
  const hostile=<T extends object>(value:T):T=>new Proxy(value,{
   getPrototypeOf(){traps++;throw Error('SECRET_PROXY_TRAP');},
   ownKeys(){traps++;throw Error('SECRET_PROXY_TRAP');},
   getOwnPropertyDescriptor(){traps++;throw Error('SECRET_PROXY_TRAP');},
   get(){traps++;throw Error('SECRET_PROXY_TRAP');}
  });
  for(const [req,receipt,options] of [
   [request,staged,hostile(opts)],
   [request,hostile(staged),opts],
   [hostile(request),staged,opts]
  ] as const){
   const result=await stageRecoveryCheckpointOnly(req,receipt,options);
   assert.deepEqual(result.status,'BLOCKED');
   assert.equal(result.automaticPatchAllowed,false);
   assert.equal(result.automaticRollbackAllowed,false);
  }
  assert.equal(traps,0,'unauthorized Proxy reflection must never execute its handler');
  assert.deepEqual((await readdir(opts.backupDirectory)).sort(),before);
  assert.equal(await readFile(opts.sourcePath,'utf8'),source);
  const saved=await stageRecoveryCheckpointOnly(request,staged,opts);
  assert.equal(saved.status,'CHECKPOINT_STAGED_UNVERIFIED');
  if(saved.status!=='CHECKPOINT_STAGED_UNVERIFIED')return;
  const priorEntries=(await readdir(opts.backupDirectory)).sort();
  for(const [req,options] of [
   [hostile(request),opts],
   [request,hostile(opts)]
  ] as const){
   const result=await inspectRecoveryCheckpointReadOnly(
    req,saved.checkpointFileName,options);
   assert.equal(result.status,'BLOCKED');
   assert.equal(result.automaticPatchAllowed,false);
   assert.equal(result.automaticRollbackAllowed,false);
  }
  assert.equal(traps,0,'read-only checkpoint inspection cannot invoke Proxy traps');
  assert.deepEqual((await readdir(opts.backupDirectory)).sort(),priorEntries);
  assert.equal(await readFile(opts.sourcePath,'utf8'),source);
 });
});

test('TEST-020: stale source or modified staged candidate never yields checkpoint',async()=>{
 await fixture(async opts=>{
  const staged=await stageReviewedCandidateOnly(request,candidate,opts);
  assert.equal(staged.status,'CANDIDATE_STAGED_RUNTIME_UNVERIFIED');
  if(staged.status!=='CANDIDATE_STAGED_RUNTIME_UNVERIFIED')return;
  await writeFile(opts.sourcePath,source+'// outside edit\n');
  const stale=await stageRecoveryCheckpointOnly(request,staged,opts);
  assert.equal(stale.status,'BLOCKED');
  assert.equal((await readdir(opts.backupDirectory)).length,2);
  await writeFile(opts.sourcePath,source);
  await writeFile(join(opts.backupDirectory,staged.candidateFileName),'unsafe');
  const changed=await stageRecoveryCheckpointOnly(request,staged,opts);
  assert.equal(changed.status,'BLOCKED');
  assert.equal((await readdir(opts.backupDirectory)).length,2);
  assert.equal(await readFile(opts.sourcePath,'utf8'),source);
 });
});


test('TEST-020: a forged or stale persisted checkpoint never gains restore authority',async()=>{
 await fixture(async opts=>{
  const stage=await stageReviewedCandidateOnly(request,candidate,opts);
  assert.equal(stage.status,'CANDIDATE_STAGED_RUNTIME_UNVERIFIED');
  if(stage.status!=='CANDIDATE_STAGED_RUNTIME_UNVERIFIED')return;
  const saved=await stageRecoveryCheckpointOnly(request,stage,opts);
  assert.equal(saved.status,'CHECKPOINT_STAGED_UNVERIFIED');
  if(saved.status!=='CHECKPOINT_STAGED_UNVERIFIED')return;
  const file=join(opts.backupDirectory,saved.checkpointFileName);
  const original=await readFile(file);
  const poisoned=JSON.parse(original.toString('utf8')) as Record<string,unknown>;
  poisoned.automaticRollbackAllowed=true;
  await writeFile(file,JSON.stringify(poisoned)+'\n');
  const forged=await inspectRecoveryCheckpointReadOnly(
    request,saved.checkpointFileName,opts
  );
  assert.equal(forged.status,'BLOCKED');
  assert.equal(forged.automaticRollbackAllowed,false);
  await writeFile(file,original);
  const foreign=await inspectRecoveryCheckpointReadOnly(
    request,'unrelated.00000000-0000-4000-8000-000000000000.checkpoint.json',opts
  );
  assert.equal(foreign.status,'BLOCKED');
  await writeFile(opts.sourcePath,source+'// external editor\n');
  const stale=await inspectRecoveryCheckpointReadOnly(
    request,saved.checkpointFileName,opts
  );
  assert.equal(stale.status,'BLOCKED');
  assert.equal(stale.automaticPatchAllowed,false);
  assert.equal((await readdir(opts.backupDirectory)).length,3);
 });
});
