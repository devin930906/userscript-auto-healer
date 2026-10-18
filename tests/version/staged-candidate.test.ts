import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {link,mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stageReviewedCandidateOnly} from '../../src/version/staged-candidate';
import {
  proposeLiteralSelectorPatch,type LiteralPatchRequest
} from '../../src/repair/patch-planner';
import {withNativeSourceLock} from '../../src/version/native-source-lock';

const original=[
  '// ==UserScript==',
  '// @name Isolated staged candidate',
  '// @match https://example.com/*',
  '// @grant none',
  '// ==/UserScript==',
  "document.querySelector('#old');",
  ''
].join('\n');
const hash=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
const request:LiteralPatchRequest={
  source:original,expectedSourceSha256:hash(original),
  callOffset:original.indexOf('document.querySelector'),
  method:'querySelector',originalSelector:'#old',
  replacementSelector:'#new',faultEvidenceId:'test_dom_candidate'
};
const proposal=proposeLiteralSelectorPatch(request);
assert.equal(proposal.status,'CANDIDATE_ONLY');

async function fixture(run:(x:{sourcePath:string;backupDirectory:string})=>Promise<void>){
  const root=await mkdtemp(join(tmpdir(),'uah-staged-candidate-'));
  const sourcePath=join(root,'case.user.js');
  const backupDirectory=join(root,'backups');
  try{
    await mkdir(backupDirectory);
    await writeFile(sourcePath,original,'utf8');
    await run({sourcePath,backupDirectory});
  }finally{await rm(root,{recursive:true,force:true});}
}

test('TEST-019/020/021: stage a real candidate and verified backup, never rewrite source',async()=>{
  await fixture(async(paths)=>{
    const result=await stageReviewedCandidateOnly(request,proposal,{
      ...paths,userApproved:true
    });
    assert.equal(result.status,'CANDIDATE_STAGED_RUNTIME_UNVERIFIED',JSON.stringify(result));
    if(result.status!=='CANDIDATE_STAGED_RUNTIME_UNVERIFIED'||proposal.status!=='CANDIDATE_ONLY')return;
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal(result.automaticRollbackAllowed,false);
    assert.equal(result.tampermonkeyVerified,false);
    assert.equal(result.businessVerified,false);
    assert.equal(result.originalSha256,hash(original));
    assert.equal(result.candidateSha256,proposal.candidateSha256);
    assert.equal(result.candidateByteLength,Buffer.byteLength(proposal.candidateSource,'utf8'));
    const entries=await readdir(paths.backupDirectory);
    assert.deepEqual(entries.sort(),[result.backupFileName,result.candidateFileName].sort());
    assert.match(result.candidateFileName,/\.candidate\.user\.js$/);
    assert.equal(await readFile(join(paths.backupDirectory,result.candidateFileName),'utf8'),
      proposal.candidateSource);
    assert.equal(await readFile(join(paths.backupDirectory,result.backupFileName),'utf8'),
      original);
    assert.equal(await readFile(paths.sourcePath,'utf8'),original);
    const serialized=JSON.stringify(result);
    assert.equal(serialized.includes(paths.sourcePath),false);
    assert.equal(serialized.includes(paths.backupDirectory),false);
    assert.equal(serialized.includes(original),false);
  });
});

test('TEST-020: stale disk source never stages or backs up',async()=>{
  await fixture(async(paths)=>{
    await writeFile(paths.sourcePath,original+'// outside changed\n');
    const result=await stageReviewedCandidateOnly(request,proposal,{
      ...paths,userApproved:true
    });
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.automaticPatchAllowed,false);
    assert.deepEqual(await readdir(paths.backupDirectory),[]);
    assert.equal(await readFile(paths.sourcePath,'utf8'),original+'// outside changed\n');
  });
});

test('TEST-019/021: forged candidate and claimed manager approval never stage',async()=>{
  await fixture(async(paths)=>{
    const option={...paths,userApproved:true};
    for(const malicious of [
      {...option,userApproved:false},
      {...option,userApproved:'true'},
      {...option,automaticPatchAllowed:true},
      {...option,runtimeEvidence:{tampermonkeyVerified:true}},
      {get sourcePath(){throw Error('path leak');}},
      Object.create(option),null
    ]){
      const result=await stageReviewedCandidateOnly(request,proposal,malicious);
      assert.equal(result.status,'BLOCKED');
      assert.equal(result.automaticPatchAllowed,false);
      assert.equal(JSON.stringify(result).includes(paths.sourcePath),false);
    }
    if(proposal.status!=='CANDIDATE_ONLY')return;
    for(const forged of [
      {...proposal,candidateSource:proposal.candidateSource+'// forged'},
      {...proposal,candidateSha256:'0'.repeat(64)},
      {...proposal,automaticPatchAllowed:true}
    ]){
      const result=await stageReviewedCandidateOnly(request,forged,option);
      assert.equal(result.status,'BLOCKED');
    }
    assert.deepEqual(await readdir(paths.backupDirectory),[]);
    assert.equal(await readFile(paths.sourcePath,'utf8'),original);
  });
});

test('TEST-020: existing native source lock denies candidate staging and original is untouched',async()=>{
  await fixture(async(paths)=>{
    await withNativeSourceLock(paths.sourcePath,async()=>{
      const result=await stageReviewedCandidateOnly(request,proposal,{
        ...paths,userApproved:true
      });
      assert.equal(result.status,'BLOCKED');
      assert.equal(result.automaticPatchAllowed,false);
      assert.deepEqual(await readdir(paths.backupDirectory),[]);
      assert.equal(await readFile(paths.sourcePath,'utf8'),original);
    });
  });
});

test('TEST-020: source hard link denies staged candidate publication',async()=>{
  await fixture(async(paths)=>{
    const twin=join(paths.backupDirectory,'alias.user.js');
    await link(paths.sourcePath,twin);
    const result=await stageReviewedCandidateOnly(request,proposal,{
      ...paths,userApproved:true
    });
    assert.equal(result.status,'BLOCKED');
    assert.deepEqual(await readdir(paths.backupDirectory),['alias.user.js']);
    assert.equal(await readFile(paths.sourcePath,'utf8'),original);
  });
});
