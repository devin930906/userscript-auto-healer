import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {proposeLiteralSelectorPatch,type LiteralPatchRequest} from '../../src/repair/patch-planner';
import {stageReviewedCandidateOnly} from '../../src/version/staged-candidate';
import {exportReviewedCandidateForManualInstall} from '../../src/export/manual-candidate-export';

const source=[
  '// ==UserScript==',
  '// @name Manual candidate export',
  '// @match https://example.com/*',
  '// @grant none',
  '// ==/UserScript==',
  "document.querySelector('#obsolete');",
  ''
].join('\n');
const digest=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const request:LiteralPatchRequest={
  source,expectedSourceSha256:digest(source),
  callOffset:source.indexOf('document.querySelector'),
  method:'querySelector',originalSelector:'#obsolete',
  replacementSelector:'#current',faultEvidenceId:'scenario_assertion_1'
};
async function fixture(run:(options:{
  sourcePath:string;backupDirectory:string;exportDirectory:string;
  userApproved:boolean
})=>Promise<void>){
  const root=await mkdtemp(join(tmpdir(),'uah-export-'));
  const options={
    sourcePath:join(root,'fixture.user.js'),
    backupDirectory:join(root,'backups'),
    exportDirectory:join(root,'manual-exports'),
    userApproved:true
  };
  try{
    await mkdir(options.backupDirectory);
    await mkdir(options.exportDirectory);
    await writeFile(options.sourcePath,source);
    await run(options);
  }finally{await rm(root,{recursive:true,force:true});}
}
async function stage(options:{
  sourcePath:string;backupDirectory:string;userApproved:boolean
}){
  const candidate=proposeLiteralSelectorPatch(request);
  assert.equal(candidate.status,'CANDIDATE_ONLY');
  const staged=await stageReviewedCandidateOnly(request,candidate,{
    sourcePath:options.sourcePath,
    backupDirectory:options.backupDirectory,
    userApproved:true
  });
  assert.equal(staged.status,'CANDIDATE_STAGED_RUNTIME_UNVERIFIED',JSON.stringify(staged));
  return {candidate,staged};
}

test('TEST-023: export backed-up reviewed bytes without changing original or manager state',async()=>{
  await fixture(async options=>{
    const {candidate,staged}=await stage(options);
    assert.equal(candidate.status,'CANDIDATE_ONLY');
    if(candidate.status!=='CANDIDATE_ONLY'||staged.status!=='CANDIDATE_STAGED_RUNTIME_UNVERIFIED')return;
    const beforeBackups=(await readdir(options.backupDirectory)).sort();
    const first=await exportReviewedCandidateForManualInstall(request,staged,options);
    const second=await exportReviewedCandidateForManualInstall(request,staged,options);
    assert.equal(first.status,'EXPORTED_RUNTIME_UNVERIFIED',JSON.stringify(first));
    assert.equal(second.status,'EXPORTED_RUNTIME_UNVERIFIED',JSON.stringify(second));
    if(first.status!=='EXPORTED_RUNTIME_UNVERIFIED'||second.status!=='EXPORTED_RUNTIME_UNVERIFIED')return;
    assert.notEqual(first.exportFileName,second.exportFileName);
    assert.notEqual(first.recoveryExportFileName,second.recoveryExportFileName);
    assert.equal(first.candidateSha256,digest(candidate.candidateSource));
    assert.equal(first.byteLength,Buffer.byteLength(candidate.candidateSource));
    for(const exported of [first,second]){
      assert.match(exported.exportFileName,/^UAH-Reviewed-[0-9a-f]{12}-[\w-]+\.user\.js$/);
      assert.deepEqual(await readFile(join(options.exportDirectory,exported.exportFileName)),
        Buffer.from(candidate.candidateSource));
      assert.match(exported.recoveryExportFileName,/^UAH-Original-[0-9a-f]{12}-[\w-]+\.user\.js$/);
      assert.deepEqual(await readFile(join(options.exportDirectory,exported.recoveryExportFileName)),
        Buffer.from(source),'the independently usable manual recovery file retains original bytes');
      assert.equal(exported.automaticPatchAllowed,false);
      assert.equal(exported.automaticRollbackAllowed,false);
      assert.equal(exported.tampermonkeyVerified,false);
      assert.equal(exported.managerInstalled,false);
      assert.equal(exported.businessVerified,false);
      assert.equal(JSON.stringify(exported).includes(options.sourcePath),false);
    }
    assert.deepEqual(await readFile(options.sourcePath,'utf8'),source);
    assert.deepEqual((await readdir(options.backupDirectory)).sort(),beforeBackups);
    assert.equal((await readdir(options.exportDirectory)).length,4);
  });
});

test('TEST-023: unauthorized and forged receipts must not create export files',async()=>{
  await fixture(async options=>{
    const {staged}=await stage(options);
    if(staged.status!=='CANDIDATE_STAGED_RUNTIME_UNVERIFIED')return;
    const hostile=[
      [staged,{...options,userApproved:false}],
      [staged,{...options,managerInstalled:true}],
      [{...staged,tampermonkeyVerified:true},options],
      [{...staged,candidateSha256:'0'.repeat(64)},options],
      [Object.create(staged),options],
      [staged,{...options,exportDirectory:'relative'}],
      [staged,{...options,exportDirectory:options.backupDirectory}],
      [staged,{...options,exportDirectory:join(options.sourcePath,'alias')}]
    ] as const;
    for(const [receipt,requestOptions] of hostile){
      const result=await exportReviewedCandidateForManualInstall(
        request,receipt,requestOptions);
      assert.equal(result.status,'BLOCKED',JSON.stringify(result));
      assert.equal(result.automaticPatchAllowed,false);
      assert.equal(result.managerInstalled,false);
    }
    assert.deepEqual(await readdir(options.exportDirectory),[]);
    assert.deepEqual(await readFile(options.sourcePath,'utf8'),source);
  });
});

test('TEST-023: protected backup descendants are never manual export destinations',async()=>{
  await fixture(async options=>{
    const {staged}=await stage(options);
    if(staged.status!=='CANDIDATE_STAGED_RUNTIME_UNVERIFIED')return;
    const nested=join(options.backupDirectory,'manual-export-inside-backups');
    await mkdir(nested);
    const backupsBefore=(await readdir(options.backupDirectory)).sort();
    const denied=await exportReviewedCandidateForManualInstall(request,staged,{
      ...options,exportDirectory:nested
    });
    assert.equal(denied.status,'BLOCKED');
    if(denied.status==='BLOCKED')assert.equal(denied.reason,'UNSAFE_DESTINATION');
    assert.deepEqual(await readdir(nested),[]);
    assert.deepEqual((await readdir(options.backupDirectory)).sort(),backupsBefore);
    assert.equal(await readFile(options.sourcePath,'utf8'),source);
  });
});

test('TEST-023: source/candidate changes block a new manual export',async()=>{
  await fixture(async options=>{
    const {staged}=await stage(options);
    if(staged.status!=='CANDIDATE_STAGED_RUNTIME_UNVERIFIED')return;
    await writeFile(options.sourcePath,source+'// outside edit\n');
    const stale=await exportReviewedCandidateForManualInstall(request,staged,options);
    assert.equal(stale.status,'BLOCKED');
    await writeFile(options.sourcePath,source);
    await writeFile(join(options.backupDirectory,staged.candidateFileName),
      'malicious candidate');
    const changed=await exportReviewedCandidateForManualInstall(request,staged,options);
    assert.equal(changed.status,'BLOCKED');
    assert.deepEqual(await readdir(options.exportDirectory),[]);
    assert.deepEqual(await readFile(options.sourcePath,'utf8'),source);
  });
});

test('TEST-023: output directory junction is not a manual export destination',async t=>{
  await fixture(async options=>{
    const {staged}=await stage(options);
    if(staged.status!=='CANDIDATE_STAGED_RUNTIME_UNVERIFIED')return;
    const alias=join(options.exportDirectory,'redirected');
    try{
      await symlink(options.backupDirectory,alias,
        process.platform==='win32'?'junction':'dir');
    }catch(error){
      if(['EPERM','ENOTSUP','EACCES'].includes(
        (error as NodeJS.ErrnoException).code??'')){
        t.diagnostic('Cannot create directory junction on this runner');
        return;
      }
      throw error;
    }
    const denied=await exportReviewedCandidateForManualInstall(request,staged,{
      ...options,exportDirectory:alias
    });
    assert.equal(denied.status,'BLOCKED');
    assert.equal(denied.managerInstalled,false);
    assert.deepEqual(await readFile(options.sourcePath,'utf8'),source);
    assert.deepEqual((await readdir(options.exportDirectory)).sort(),['redirected']);
  });
});
