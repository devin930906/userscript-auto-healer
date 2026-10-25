import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
 proposeLiteralSelectorPatch,type LiteralPatchRequest
} from '../../src/repair/patch-planner';
import {prepareReviewedLocalBackupOnly} from '../../src/acceptance/local-backup-preflight';

const source=[
 '// ==UserScript==',
 '// @name Native-only backup integration test',
 '// @match https://example.com/*',
 '// @grant none',
 '// ==/UserScript==',
 "document.querySelector('#old');",
 ''
].join('\n');
const sha=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
const request:LiteralPatchRequest={
 source,expectedSourceSha256:sha(source),
 callOffset:source.indexOf('document.querySelector'),
 method:'querySelector',originalSelector:'#old',
 replacementSelector:'#new',faultEvidenceId:'local_dom_1'
};
const candidate=proposeLiteralSelectorPatch(request);
assert.equal(candidate.status,'CANDIDATE_ONLY');

async function fixture(run:(paths:{
 sourcePath:string;backupDirectory:string
})=>Promise<void>):Promise<void>{
 const dir=await mkdtemp(join(tmpdir(),'uah-reviewed-backup-'));
 const sourcePath=join(dir,'fixture.user.js');
 const backupDirectory=join(dir,'backups');
 try{
  await mkdir(backupDirectory);
  await writeFile(sourcePath,source,'utf8');
  await run({sourcePath,backupDirectory});
 }finally{await rm(dir,{recursive:true,force:true});}
}

test('TEST-019/020/021: audited patch plus disk SHA creates a separately verified backup but never applies',async()=>{
 await fixture(async(paths)=>{
  const result=await prepareReviewedLocalBackupOnly(request,candidate,{
   ...paths,userApproved:true
  });
  assert.equal(result.status,'BACKUP_PREPARED_RUNTIME_UNVERIFIED',JSON.stringify(result));
  assert.equal(result.automaticPatchAllowed,false);
  assert.equal(result.automaticRollbackAllowed,false);
  assert.equal(result.tampermonkeyVerified,false);
  assert.equal(result.businessRecoveredVerified,false);
  if(result.status!=='BACKUP_PREPARED_RUNTIME_UNVERIFIED')return;
  assert.equal(result.sourceSha256,sha(source));
  assert.equal(result.candidateSha256,candidate.status==='CANDIDATE_ONLY'?
   candidate.candidateSha256:'');
  assert.equal(result.backupByteLength,Buffer.byteLength(source,'utf8'));
  assert.deepEqual(await readdir(paths.backupDirectory),[result.backupFileName]);
  assert.equal(await readFile(join(paths.backupDirectory,result.backupFileName),'utf8'),source);
  assert.equal(await readFile(paths.sourcePath,'utf8'),source);
  assert.equal(JSON.stringify(result).includes(paths.sourcePath),false);
  assert.equal(JSON.stringify(result).includes(paths.backupDirectory),false);
  assert.equal(JSON.stringify(result).includes(source),false);
 });
});

test('TASK-010/011 TEST-020/021: backup changed during final source check cannot be accepted',async t=>{
 await fixture(async paths=>{
  const sourceModule=require('../../src/version/source-snapshot') as
   typeof import('../../src/version/source-snapshot');
  const real=sourceModule.verifyApprovedSourceFingerprint;
  let reads=0;
  let changedBackup='';
  // The integration initially fingerprints source, creates/verifies an
  // independent backup, then fingerprints source AGAIN. Corrupt the backup
  // during the last source check, after its earlier successful verification.
  t.mock.method(sourceModule,'verifyApprovedSourceFingerprint',
   async (input:Parameters<typeof real>[0])=>{
    const result=await real(input);
    reads++;
    if(reads===2&&result.status==='MATCHED_READ_ONLY'){
     const names=await readdir(paths.backupDirectory);
     assert.equal(names.length,1,'the first backup verification already ran');
     changedBackup=join(paths.backupDirectory,names[0]);
     await writeFile(changedBackup,'// independently edited after verification\\n');
    }
    return result;
   });
  const result=await prepareReviewedLocalBackupOnly(request,candidate,{
   ...paths,userApproved:true
  });
  assert.equal(reads>=2,true,'must reach the asynchronous final source recheck');
  assert.notEqual(changedBackup,'','must mutate the verified backup');
  assert.deepEqual(result,{
   status:'BLOCKED',reason:'BACKUP_UNVERIFIED',
   automaticPatchAllowed:false,automaticRollbackAllowed:false,
   tampermonkeyVerified:false,businessRecoveredVerified:false
  });
  assert.equal(await readFile(paths.sourcePath,'utf8'),source,
   'never replace the selected source during backup preparation');
  assert.equal(await readFile(changedBackup,'utf8'),
   '// independently edited after verification\\n',
   'leave the independently edited backup for privileged reconciliation');
 });
});

test('TEST-020/021: changed on-disk source fails closed before any backup is created',async()=>{
 await fixture(async(paths)=>{
  await writeFile(paths.sourcePath,source+'// external edit\n','utf8');
  const result=await prepareReviewedLocalBackupOnly(request,candidate,{
   ...paths,userApproved:true
  });
  assert.deepEqual(result,{
   status:'BLOCKED',reason:'DISK_SOURCE_UNVERIFIED',
   automaticPatchAllowed:false,automaticRollbackAllowed:false,
   tampermonkeyVerified:false,businessRecoveredVerified:false
  });
  assert.deepEqual(await readdir(paths.backupDirectory),[]);
  assert.equal(await readFile(paths.sourcePath,'utf8'),source+'// external edit\n');
 });
});

test('TEST-019/021: forged approval, stale candidate and hostile options cannot create a backup',async()=>{
 await fixture(async(paths)=>{
  const invalid:unknown[]=[
   {...paths,userApproved:false},
   {...paths,userApproved:true,automaticPatchAllowed:true},
   {...paths,userApproved:true,runtimeEvidence:{businessVerified:true}},
   {...paths,userApproved:'true'},
   {get sourcePath(){throw Error('sensitive path');}},
   Object.create({...paths,userApproved:true}),
   null
  ];
  for(const options of invalid){
   const result=await prepareReviewedLocalBackupOnly(request,candidate,options);
   assert.equal(result.status,'BLOCKED');
   assert.equal(result.automaticPatchAllowed,false);
   assert.equal(JSON.stringify(result).includes(paths.sourcePath),false);
  }
  if(candidate.status!=='CANDIDATE_ONLY')return;
  for(const forged of [
   {...candidate,candidateSha256:'f'.repeat(64)},
   {...candidate,candidateSource:candidate.candidateSource+'// injected'},
   {...candidate,tampermonkeyVerified:true}
  ]){
   const result=await prepareReviewedLocalBackupOnly(request,forged,{
    ...paths,userApproved:true
   });
   assert.equal(result.status,'BLOCKED');
   assert.equal(result.automaticPatchAllowed,false);
  }
  assert.deepEqual(await readdir(paths.backupDirectory),[]);
  assert.equal(await readFile(paths.sourcePath,'utf8'),source);
 });
});

test('TEST-020: symlinked backup directory is rejected, source remains untouched',async(t)=>{
 await fixture(async(paths)=>{
  const alias=join(paths.backupDirectory,'..','alias-backups');
  try{await symlink(paths.backupDirectory,alias,'dir');}
  catch(e){
   if((e as NodeJS.ErrnoException).code==='EPERM'){
    t.diagnostic('Windows runner does not permit directory symlinks');return;
   }
   throw e;
  }
  const result=await prepareReviewedLocalBackupOnly(request,candidate,{
   sourcePath:paths.sourcePath,backupDirectory:alias,userApproved:true
  });
  assert.equal(result.status,'BLOCKED');
  if(result.status==='BLOCKED')assert.equal(result.reason,'BACKUP_FAILED');
  assert.equal(await readFile(paths.sourcePath,'utf8'),source);
  assert.deepEqual(await readdir(paths.backupDirectory),[]);
 });
});

test('TASK-010/011 TEST-020/021/026: source changed during final backup check rejects stale prepared receipt',async t=>{
 await fixture(async paths=>{
  const recoveryModule=require('../../src/version/recovery-source') as
   typeof import('../../src/version/recovery-source');
  const real=recoveryModule.verifyBackupRecoverySource;
  const externalEdit=source+'// external editor changed the selected source during final backup I/O\\n';
  let backupChecks=0;
  let originalBackupPath='';
  t.mock.method(recoveryModule,'verifyBackupRecoverySource',
   async(input:Parameters<typeof real>[0])=>{
    const result=await real(input);
    if(result.status==='RECOVERY_SOURCE_VERIFIED_READ_ONLY'){
     backupChecks++;
     if(backupChecks===2){
      const names=await readdir(paths.backupDirectory);
      assert.equal(names.length,1,'the independently verified backup must exist');
      originalBackupPath=join(paths.backupDirectory,names[0]);
      await writeFile(paths.sourcePath,externalEdit,'utf8');
     }
    }
    return result;
   });
  const result=await prepareReviewedLocalBackupOnly(request,candidate,{
   ...paths,userApproved:true
  });
  assert.equal(backupChecks,2,'test must reach the second real backup verification');
  assert.deepEqual(result,{
   status:'BLOCKED',reason:'SOURCE_CHANGED',
   automaticPatchAllowed:false,automaticRollbackAllowed:false,
   tampermonkeyVerified:false,businessRecoveredVerified:false
  },'the selected source no longer matches the independently stored backup');
  assert.equal(await readFile(paths.sourcePath,'utf8'),externalEdit,
   'native backup preparation must never overwrite a third-party edit');
  assert.equal(await readFile(originalBackupPath,'utf8'),source,
   'independent original recovery bytes must remain preserved');
 });
});
