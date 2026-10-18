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
