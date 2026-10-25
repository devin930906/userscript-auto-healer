import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {proposeLiteralSelectorPatch,type LiteralPatchRequest} from '../../src/repair/patch-planner';
import {stageReviewedCandidateOnly} from '../../src/version/staged-candidate';
import {stageRecoveryCheckpointOnly} from '../../src/version/recovery-checkpoint';
import {inspectRecoveryCheckpointInventoryReadOnly} from '../../src/version/recovery-checkpoint-inventory';

const source=[
  '// ==UserScript==',
  '// @name Checkpoint inventory fixture',
  '// @match https://example.com/*',
  '// @grant none',
  '// ==/UserScript==',
  "document.querySelector('#old');",''
].join('\n');
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const request:LiteralPatchRequest={
  source,expectedSourceSha256:hash(source),
  callOffset:source.indexOf('document.querySelector'),
  method:'querySelector',originalSelector:'#old',replacementSelector:'#new',
  faultEvidenceId:'scenario_assertion_1'
};
async function fixture(run:(options:{
  sourcePath:string;backupDirectory:string;userApproved:boolean
})=>Promise<void>){
  const root=await mkdtemp(join(tmpdir(),'uah-checkpoint-inventory-'));
  const options={
    sourcePath:join(root,'script.user.js'),
    backupDirectory:join(root,'backups'),userApproved:true
  };
  try{
    await mkdir(options.backupDirectory);
    await writeFile(options.sourcePath,source);
    await run(options);
  }finally{await rm(root,{recursive:true,force:true});}
}

test('TEST-020: discover persisted checkpoint after loss of staged receipt, without original writes',async()=>{
  await fixture(async options=>{
    const empty=await inspectRecoveryCheckpointInventoryReadOnly(request,options);
    assert.equal(empty.status,'OBSERVED_CHECKPOINTS_READ_ONLY',JSON.stringify(empty));
    if(empty.status==='OBSERVED_CHECKPOINTS_READ_ONLY')
      assert.deepEqual(empty.checkpoints,[]);
    const candidate=proposeLiteralSelectorPatch(request);
    const staged=await stageReviewedCandidateOnly(request,candidate,options);
    assert.equal(staged.status,'CANDIDATE_STAGED_RUNTIME_UNVERIFIED',JSON.stringify(staged));
    if(staged.status!=='CANDIDATE_STAGED_RUNTIME_UNVERIFIED')return;
    const checkpoint=await stageRecoveryCheckpointOnly(request,staged,options);
    assert.equal(checkpoint.status,'CHECKPOINT_STAGED_UNVERIFIED',JSON.stringify(checkpoint));
    if(checkpoint.status!=='CHECKPOINT_STAGED_UNVERIFIED')return;
    const observed=await inspectRecoveryCheckpointInventoryReadOnly(request,options);
    assert.equal(observed.status,'OBSERVED_CHECKPOINTS_READ_ONLY',JSON.stringify(observed));
    if(observed.status==='OBSERVED_CHECKPOINTS_READ_ONLY'){
      assert.deepEqual(observed.checkpoints,[{
        checkpointFileName:checkpoint.checkpointFileName,
        checkpointSha256:checkpoint.checkpointSha256,
        originalSha256:checkpoint.originalSha256,
        candidateSha256:checkpoint.candidateSha256
      }]);
      assert.equal(observed.automaticPatchAllowed,false);
      assert.equal(observed.automaticRollbackAllowed,false);
      assert.equal(observed.tampermonkeyVerified,false);
      assert.equal(observed.businessVerified,false);
    }
    assert.equal(await readFile(options.sourcePath,'utf8'),source);
  });
});

test('TASK-011/TEST-020/026: checkpoint changed while subsequent entries are checked invalidates inventory',async t=>{
 await fixture(async options=>{
   const stage=await stageReviewedCandidateOnly(request,
     proposeLiteralSelectorPatch(request),options);
   assert.equal(stage.status,'CANDIDATE_STAGED_RUNTIME_UNVERIFIED');
   if(stage.status!=='CANDIDATE_STAGED_RUNTIME_UNVERIFIED')return;
   const first=await stageRecoveryCheckpointOnly(request,stage,options);
   const second=await stageRecoveryCheckpointOnly(request,stage,options);
   assert.equal(first.status,'CHECKPOINT_STAGED_UNVERIFIED');
   assert.equal(second.status,'CHECKPOINT_STAGED_UNVERIFIED');
   if(first.status!=='CHECKPOINT_STAGED_UNVERIFIED'||
      second.status!=='CHECKPOINT_STAGED_UNVERIFIED')return;
   const names=[first.checkpointFileName,second.checkpointFileName].sort();
   const earliest=join(options.backupDirectory,names[0]);
   const changed=Buffer.from('{\"forged\":true}\\n');
   const module=require('../../src/version/recovery-checkpoint') as
     typeof import('../../src/version/recovery-checkpoint');
   const real=module.inspectRecoveryCheckpointReadOnly;
   let checks=0;
   t.mock.method(module,'inspectRecoveryCheckpointReadOnly',async(
     ...args:Parameters<typeof real>)=>{
       const result=await real(...args);
       if(++checks===2)await writeFile(earliest,changed);
       return result;
     });
   const result=await inspectRecoveryCheckpointInventoryReadOnly(request,options);
   assert.ok(checks>=2,'must exercise after a later checkpoint verification');
   assert.equal(result.status,'BLOCKED','previously inspected checkpoint must not remain trusted');
   assert.equal(await readFile(earliest,'utf8'),changed.toString('utf8'));
   assert.equal(await readFile(options.sourcePath,'utf8'),source);
 });
});

test('TASK-011/TEST-020/026: newly inserted checkpoint invalidates enumerated inventory',async t=>{
 await fixture(async options=>{
   const stage=await stageReviewedCandidateOnly(request,
     proposeLiteralSelectorPatch(request),options);
   assert.equal(stage.status,'CANDIDATE_STAGED_RUNTIME_UNVERIFIED');
   if(stage.status!=='CANDIDATE_STAGED_RUNTIME_UNVERIFIED')return;
   const made=await stageRecoveryCheckpointOnly(request,stage,options);
   assert.equal(made.status,'CHECKPOINT_STAGED_UNVERIFIED');
   if(made.status!=='CHECKPOINT_STAGED_UNVERIFIED')return;
   const newName=made.checkpointFileName.replace(
     /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.checkpoint\\.json$/,
     '00000000-0000-4000-8000-000000000001.checkpoint.json');
   assert.notEqual(newName,made.checkpointFileName);
   const latePath=join(options.backupDirectory,newName);
   const module=require('../../src/version/recovery-checkpoint') as
     typeof import('../../src/version/recovery-checkpoint');
   const real=module.inspectRecoveryCheckpointReadOnly;
   let checks=0;
   t.mock.method(module,'inspectRecoveryCheckpointReadOnly',async(
     ...args:Parameters<typeof real>)=>{
       const result=await real(...args);
       if(++checks===1)await writeFile(latePath,'unverified late checkpoint');
       return result;
     });
   const inventory=await inspectRecoveryCheckpointInventoryReadOnly(request,options);
   assert.ok(checks>=1,'must exercise insertion after initial enumeration');
   assert.equal(inventory.status,'BLOCKED','incomplete checkpoint inventory must not be returned');
   assert.equal(await readFile(latePath,'utf8'),'unverified late checkpoint');
   assert.equal(await readFile(options.sourcePath,'utf8'),source);
 });
});

test('TEST-020: stale original and corrupted checkpoint fail closed',async()=>{
  await fixture(async options=>{
    const staged=await stageReviewedCandidateOnly(
      request,proposeLiteralSelectorPatch(request),options);
    assert.equal(staged.status,'CANDIDATE_STAGED_RUNTIME_UNVERIFIED');
    if(staged.status!=='CANDIDATE_STAGED_RUNTIME_UNVERIFIED')return;
    const checkpoint=await stageRecoveryCheckpointOnly(request,staged,options);
    assert.equal(checkpoint.status,'CHECKPOINT_STAGED_UNVERIFIED');
    if(checkpoint.status!=='CHECKPOINT_STAGED_UNVERIFIED')return;
    const path=join(options.backupDirectory,checkpoint.checkpointFileName);
    const original=await readFile(path);
    await writeFile(path,Buffer.from('{"status":"forged"}\n'));
    const forged=await inspectRecoveryCheckpointInventoryReadOnly(request,options);
    assert.equal(forged.status,'BLOCKED');
    if(forged.status==='BLOCKED')assert.equal(forged.reason,'UNSAFE_CHECKPOINT');
    await writeFile(path,original);
    await writeFile(options.sourcePath,source+'// external change\n');
    const stale=await inspectRecoveryCheckpointInventoryReadOnly(request,options);
    assert.equal(stale.status,'BLOCKED');
    if(stale.status==='BLOCKED')assert.equal(stale.reason,'SOURCE_UNVERIFIED');
  });
});

test('TEST-020: invalid claims, unrelated files and oversized folders are bounded',async()=>{
  await fixture(async options=>{
    const denied=await inspectRecoveryCheckpointInventoryReadOnly(
      request,{...options,userApproved:false});
    assert.equal(denied.status,'BLOCKED');
    if(denied.status==='BLOCKED')assert.equal(denied.reason,'NOT_AUTHORIZED');
    const malicious=await inspectRecoveryCheckpointInventoryReadOnly(
      request,{...options,businessVerified:true});
    assert.equal(malicious.status,'BLOCKED');
    await writeFile(join(options.backupDirectory,'other.checkpoint.json'),'unrelated');
    const ignored=await inspectRecoveryCheckpointInventoryReadOnly(request,options);
    assert.equal(ignored.status,'OBSERVED_CHECKPOINTS_READ_ONLY');
    if(ignored.status==='OBSERVED_CHECKPOINTS_READ_ONLY')
      assert.deepEqual(ignored.checkpoints,[]);
    for(let i=0;i<512;i++){
      await writeFile(join(options.backupDirectory,'unrelated-'+i),'x');
    }
    const bounded=await inspectRecoveryCheckpointInventoryReadOnly(request,options);
    assert.equal(bounded.status,'BLOCKED');
    if(bounded.status==='BLOCKED')assert.equal(bounded.reason,'TOO_MANY_ENTRIES');
    assert.equal((await readdir(options.backupDirectory)).length,513);
    assert.equal(await readFile(options.sourcePath,'utf8'),source);
  });
});

test('TEST-020/026: untrusted Proxy claims never execute traps before checkpoint inventory rejection',async()=>{
  await fixture(async options=>{
    let traps=0;
    const hostile=<T extends object>(value:T):T=>new Proxy(value,{
      getPrototypeOf(){traps++;throw Error('untrusted getPrototypeOf');},
      ownKeys(){traps++;throw Error('untrusted ownKeys');},
      get(){traps++;throw Error('untrusted get');}
    });
    for(const [candidate,opts] of [
      [request,hostile(options)],
      [hostile(request),options]
    ] as const){
      const result=await inspectRecoveryCheckpointInventoryReadOnly(candidate,opts);
      assert.deepEqual(result,{
        status:'BLOCKED',reason:'INVALID_REQUEST',
        automaticPatchAllowed:false,automaticRollbackAllowed:false,
        tampermonkeyVerified:false,businessVerified:false
      });
    }
    assert.equal(traps,0,'reject the Proxy without evaluating its user-defined traps');
    assert.equal(await readFile(options.sourcePath,'utf8'),source);
    assert.deepEqual(await readdir(options.backupDirectory),[]);
  });
});
