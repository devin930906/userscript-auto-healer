import {test,mock} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,rename,rm,symlink,writeFile} from 'node:fs/promises';
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

test('TEST-023/026: manual export rejects Proxy request, receipt and options before reflection',async()=>{
 await fixture(async options=>{
  const {staged}=await stage(options);
  if(staged.status!=='CANDIDATE_STAGED_RUNTIME_UNVERIFIED')return;
  let traps=0;
  const hostile=(value:object)=>new Proxy(value,{
    getPrototypeOf(){
      traps++;
      throw new Error('untrusted Proxy reflection must not execute');
    }
  });
  const cases=[
    [hostile(request),staged,options],
    [request,hostile(staged),options],
    [request,staged,hostile(options)]
  ] as const;
  for(const [input,receipt,paths] of cases){
    const result=await exportReviewedCandidateForManualInstall(input,receipt,paths);
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal(result.managerInstalled,false);
  }
  assert.equal(traps,0,'untrusted Proxy traps must not run');
  assert.deepEqual(await readdir(options.exportDirectory),[]);
  assert.equal(await readFile(options.sourcePath,'utf8'),source);
 });
});

test('TEST-023/026: failed candidate or recovery publication never unlinks a foreign pending replacement',async()=>{
 for(const stageName of ['candidate','recovery'] as const){
  await fixture(async options=>{
   const {candidate,staged}=await stage(options);
   if(candidate.status!=='CANDIDATE_ONLY'||
      staged.status!=='CANDIDATE_STAGED_RUNTIME_UNVERIFIED')return;
   const io=require('node:fs/promises') as typeof import('node:fs/promises');
   const originalLink=io.link;
   const foreign=Buffer.from('foreign process owns this pending path');
   const retained=join(options.exportDirectory,'outside-owned-'+stageName+'.pending');
   let replacedPath:string|undefined,intercepts=0;
   const hook=mock.method(io,'link',async(...args:Parameters<typeof originalLink>)=>{
    const [pending,destination]=args;
    if((stageName==='candidate'&&String(destination).includes('UAH-Reviewed-'))||
       (stageName==='recovery'&&String(destination).includes('UAH-Original-'))){
     intercepts++;
     // A separate process moves the app-created inode, then replaces the
     // pending pathname before link() reports a publication failure.
     await rename(pending,retained);
     await writeFile(pending,foreign);
     replacedPath=String(pending);
     throw new Error('injected external pending replacement before failed link');
    }
    return originalLink(...args);
   });
   try{
    const outcome=await exportReviewedCandidateForManualInstall(request,staged,options);
    assert.equal(outcome.status,'BLOCKED',JSON.stringify(outcome));
    assert.equal(intercepts,1,'the intended candidate/recovery publication must be reached');
    assert.ok(replacedPath);
    assert.deepEqual(await readFile(replacedPath!),foreign,
      'a failed native export must never unlink another process\'s replacement');
    assert.deepEqual(await readFile(retained),
      stageName==='candidate'?Buffer.from(candidate.candidateSource):Buffer.from(source),
      'the moved app-owned pending inode must not be silently deleted');
    assert.deepEqual(await readFile(options.sourcePath),Buffer.from(source),
      'manual export must not mutate the original userscript');
   }finally{hook.mock.restore();}
  });
 }
});

test('TEST-023/026: an externally replaced byte-identical published export cannot receive a success receipt',async()=>{
 for(const target of ['candidate','recovery'] as const){
  await fixture(async options=>{
   const {candidate,staged}=await stage(options);
   if(candidate.status!=='CANDIDATE_ONLY'||
      staged.status!=='CANDIDATE_STAGED_RUNTIME_UNVERIFIED')return;
   const checker=require('../../src/version/staged-candidate-recheck') as
     typeof import('../../src/version/staged-candidate-recheck');
   const originalCheck=checker.verifyStagedCandidateReadOnly;
   let checks=0;
   let displacedPath:string|undefined;
   const hook=mock.method(checker,'verifyStagedCandidateReadOnly',
    async(...args:Parameters<typeof originalCheck>)=>{
     const outcome=await originalCheck(...args);
     checks++;
     if(checks===3&&outcome.status==='CANDIDATE_RECHECKED_READ_ONLY'){
      const prefix=target==='candidate'?'UAH-Reviewed-':'UAH-Original-';
      const filename=(await readdir(options.exportDirectory)).find(
       name=>name.startsWith(prefix));
      assert.ok(filename,'both manually exported files exist before last check');
      const published=join(options.exportDirectory,filename);
      displacedPath=join(options.exportDirectory,'displaced-'+target+'.user.js');
      await rename(published,displacedPath);
      // Same bytes, different inode: a digest comparison alone cannot
      // establish ownership of the pathname receiving a success receipt.
      await writeFile(published,await readFile(displacedPath));
     }
     return outcome;
    });
   try{
    const result=await exportReviewedCandidateForManualInstall(request,staged,options);
    assert.equal(checks,3,'replacement must occur after the final candidate recheck');
    assert.ok(displacedPath);
    assert.equal(result.status,'BLOCKED',JSON.stringify(result));
    if(result.status==='BLOCKED')assert.equal(result.reason,'EXPORT_FAILED');
    assert.deepEqual(await readFile(displacedPath!),
     Buffer.from(target==='candidate'?candidate.candidateSource:source));
    assert.equal(await readFile(options.sourcePath,'utf8'),source,
     'the original userscript is never modified');
   }finally{hook.mock.restore();}
  });
 }
});
