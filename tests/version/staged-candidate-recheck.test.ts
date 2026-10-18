import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {link,mkdir,mkdtemp,readFile,readdir,rm,symlink,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {proposeLiteralSelectorPatch,type LiteralPatchRequest} from '../../src/repair/patch-planner';
import {stageReviewedCandidateOnly} from '../../src/version/staged-candidate';
import {verifyStagedCandidateReadOnly} from '../../src/version/staged-candidate-recheck';
import {withNativeSourceLock} from '../../src/version/native-source-lock';

const original=[
 '// ==UserScript==',
 '// @name Reviewed candidate recheck',
 '// @match https://example.com/*',
 '// @grant none',
 '// ==/UserScript==',
 "document.querySelector('#old');",
 ''
].join('\n');
const digest=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const request:LiteralPatchRequest={
 source:original,expectedSourceSha256:digest(original),
 callOffset:original.indexOf('document.querySelector'),method:'querySelector',
 originalSelector:'#old',replacementSelector:'#new',
 faultEvidenceId:'example_evidence'
};
const reviewed=proposeLiteralSelectorPatch(request);
assert.equal(reviewed.status,'CANDIDATE_ONLY');
type Stage=Awaited<ReturnType<typeof stageReviewedCandidateOnly>>;
type Paths={sourcePath:string;backupDirectory:string;root:string};
async function setup(run:(p:Paths,stage:Extract<Stage,{status:'CANDIDATE_STAGED_RUNTIME_UNVERIFIED'}>)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'uah-recheck-'));
 const sourcePath=join(root,'sample.user.js');
 const backupDirectory=join(root,'backups');
 try{
  await mkdir(backupDirectory);
  await writeFile(sourcePath,original,'utf8');
  const stage=await stageReviewedCandidateOnly(request,reviewed,{
    sourcePath,backupDirectory,userApproved:true
  });
  assert.equal(stage.status,'CANDIDATE_STAGED_RUNTIME_UNVERIFIED',JSON.stringify(stage));
  if(stage.status!=='CANDIDATE_STAGED_RUNTIME_UNVERIFIED')return;
  await run({sourcePath,backupDirectory,root},stage);
 }finally{await rm(root,{recursive:true,force:true});}
}
const args=(p:Paths)=>({sourcePath:p.sourcePath,backupDirectory:p.backupDirectory,userApproved:true});
test('TEST-020: staged candidate and original backup are revalidated without edits',async()=>{
 await setup(async(p,stage)=>{
  const before=await readFile(p.sourcePath);
  const entries=await readdir(p.backupDirectory);
  const result=await verifyStagedCandidateReadOnly(request,stage,args(p));
  assert.equal(result.status,'CANDIDATE_RECHECKED_READ_ONLY',JSON.stringify(result));
  if(result.status!=='CANDIDATE_RECHECKED_READ_ONLY')return;
  assert.equal(result.originalSha256,digest(original));
  assert.equal(result.candidateSha256,stage.candidateSha256);
  assert.equal(result.candidateByteLength,stage.candidateByteLength);
  assert.equal(result.automaticPatchAllowed,false);
  assert.equal(result.automaticRollbackAllowed,false);
  assert.equal(result.tampermonkeyVerified,false);
  assert.equal(result.businessVerified,false);
  assert.equal(JSON.stringify(result).includes(p.root),false);
  assert.deepEqual(await readdir(p.backupDirectory),entries);
  assert.deepEqual(await readFile(p.sourcePath),before);
 });
});
test('TEST-020: candidate content changed after staging cannot receive recheck',async()=>{
 await setup(async(p,stage)=>{
  const file=join(p.backupDirectory,stage.candidateFileName);
  const changed=Buffer.from((await readFile(file,'utf8')).replace('#new','#bad'));
  assert.equal(changed.length,stage.candidateByteLength);
  await writeFile(file,changed);
  const result=await verifyStagedCandidateReadOnly(request,stage,args(p));
  assert.equal(result.status,'BLOCKED');
  if(result.status==='BLOCKED')assert.equal(result.reason,'CANDIDATE_MISMATCH');
  assert.deepEqual(await readFile(p.sourcePath),Buffer.from(original));
 });
});
test('TEST-020: changed backup or original blocks candidate even when candidate bytes are intact',async()=>{
 for(const part of ['source','backup'] as const){
  await setup(async(p,stage)=>{
   const path=part==='source'?p.sourcePath:join(p.backupDirectory,stage.backupFileName);
   await writeFile(path,original+'// unexpected edit\n');
   const result=await verifyStagedCandidateReadOnly(request,stage,args(p));
   assert.equal(result.status,'BLOCKED');
   assert.equal(result.automaticPatchAllowed,false);
   if(result.status==='BLOCKED')assert.equal(result.reason,
     part==='source'?'SOURCE_UNVERIFIED':'BACKUP_UNVERIFIED');
  });
 }
});
test('TEST-019/021: hostile options, forged approval and forged receipts cannot revalidate',async()=>{
 await setup(async(p,stage)=>{
  const valid=args(p);
  const inputs:unknown[]=[
   {...valid,userApproved:false},
   {...valid,userApproved:'true'},
   {...valid,automaticPatchAllowed:true},
   {get sourcePath(){throw Error('private');}},
   Object.create(valid),null
  ];
  for(const input of inputs){
   const result=await verifyStagedCandidateReadOnly(request,stage,input);
   assert.equal(result.status,'BLOCKED');
   assert.equal(result.automaticPatchAllowed,false);
   assert.equal(JSON.stringify(result).includes(p.root),false);
  }
  for(const forged of [
   {...stage,candidateSha256:'0'.repeat(64)},
   {...stage,automaticPatchAllowed:true},
   {...stage,businessVerified:true},
   {...stage,candidateFileName:'../../evil.user.js'},
   {...stage,candidateByteLength:stage.candidateByteLength+1},
   {get candidateFileName(){throw Error('private');}},Object.create(stage),null
  ]){
   const result=await verifyStagedCandidateReadOnly(request,forged,valid);
   assert.equal(result.status,'BLOCKED');
  }
  assert.deepEqual(await readFile(p.sourcePath),Buffer.from(original));
 });
});
test('TEST-020: same bytes and script basename from a different directory are not reusable',async()=>{
 await setup(async(p,stage)=>{
  const elsewhere=join(p.root,'elsewhere');
  await mkdir(elsewhere);
  const sourcePath=join(elsewhere,'sample.user.js');
  await writeFile(sourcePath,original);
  const result=await verifyStagedCandidateReadOnly(request,stage,{
    sourcePath,backupDirectory:p.backupDirectory,userApproved:true
  });
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.automaticPatchAllowed,false);
  assert.deepEqual(await readFile(sourcePath),Buffer.from(original));
 });
});
test('TEST-020: candidate symlink and hard-link aliases are rejected',async t=>{
 await setup(async(p,stage)=>{
  const file=join(p.backupDirectory,stage.candidateFileName);
  const other=join(p.root,'other.user.js');
  await link(file,other);
  let result=await verifyStagedCandidateReadOnly(request,stage,args(p));
  assert.equal(result.status,'BLOCKED');
  if(result.status==='BLOCKED')assert.equal(result.reason,'CANDIDATE_CHANGED');
  await unlink(other);
  const content=await readFile(file);
  await unlink(file);
  await writeFile(other,content);
  try{await symlink(other,file,'file');}
  catch(error){
   if((error as NodeJS.ErrnoException).code==='EPERM'){
    t.diagnostic('File symlinks unavailable');return;
   }
   throw error;
  }
  result=await verifyStagedCandidateReadOnly(request,stage,args(p));
  assert.equal(result.status,'BLOCKED');
  assert.deepEqual(await readFile(p.sourcePath),Buffer.from(original));
 });
});
test('TEST-020: held native source lock refuses recheck',async()=>{
 await setup(async(p,stage)=>{
  await withNativeSourceLock(p.sourcePath,async()=>{
   const result=await verifyStagedCandidateReadOnly(request,stage,args(p));
   assert.equal(result.status,'BLOCKED');
   if(result.status==='BLOCKED')assert.equal(result.reason,'SOURCE_LOCKED');
  });
 });
});
test('TEST-020: directory junction ancestors do not bypass candidate receipt checks',async t=>{
 await setup(async(p,stage)=>{
  const alias=join(p.root,'redirect');
  try{await symlink(p.root,alias,process.platform==='win32'?'junction':'dir');}
  catch(error){
   if(['EPERM','ENOTSUP','EACCES'].includes((error as NodeJS.ErrnoException).code??'')){
    t.diagnostic('Junction unavailable');return;
   }
   throw error;
  }
  const result=await verifyStagedCandidateReadOnly(request,stage,{
    sourcePath:p.sourcePath,backupDirectory:join(alias,'backups'),userApproved:true
  });
  assert.equal(result.status,'BLOCKED');
  if(result.status==='BLOCKED')assert.equal(result.reason,'UNSAFE_PATH');
  assert.deepEqual(await readFile(p.sourcePath),Buffer.from(original));
 });
});
