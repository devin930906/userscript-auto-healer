import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {createVerifiedBackupOnly} from '../../src/version/verified-backup';
import {link,mkdir,mkdtemp,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {proposeLiteralSelectorPatch,type LiteralPatchRequest} from '../../src/repair/patch-planner';
import {stageReviewedCandidateOnly} from '../../src/version/staged-candidate';
import {inspectChangedSourceRestorePreflightReadOnly} from
 '../../src/version/changed-source-restore-preflight';

const source=[
 '// ==UserScript==',
 '// @name Isolated restore preflight fixture',
 '// @match https://example.com/*',
 '// @grant none',
 '// ==/UserScript==',
 "document.querySelector('#old');",
 ''
].join('\n');
const changed=source.replace("'#old'","'#new'");
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const request:LiteralPatchRequest={
 source,expectedSourceSha256:sha(source),
 callOffset:source.indexOf('document.querySelector'),
 method:'querySelector',originalSelector:'#old',
 replacementSelector:'#new',faultEvidenceId:'independent_assertion_1'
};
const candidate=proposeLiteralSelectorPatch(request);
assert.equal(candidate.status,'CANDIDATE_ONLY');

async function fixture(run:(ctx:{
 root:string;sourcePath:string;backupDirectory:string;
 opts:{sourcePath:string;backupDirectory:string;backupFileName:string;
  expectedCurrentSha256:string;expectedOriginalSha256:string;
  expectedOriginalByteLength:number;userApproved:boolean}
})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'uah-changed-restore-'));
 const sourcePath=join(root,'fixture.user.js');
 const backupDirectory=join(root,'backups');
 try{
  await mkdir(backupDirectory);
  await writeFile(sourcePath,source,'utf8');
  const stage=await stageReviewedCandidateOnly(request,candidate,
   {sourcePath,backupDirectory,userApproved:true});
  assert.equal(stage.status,'CANDIDATE_STAGED_RUNTIME_UNVERIFIED',JSON.stringify(stage));
  if(stage.status!=='CANDIDATE_STAGED_RUNTIME_UNVERIFIED')return;
  await writeFile(sourcePath,changed,'utf8');
  const opts={
   sourcePath,backupDirectory,backupFileName:stage.backupFileName,
   expectedCurrentSha256:sha(changed),expectedOriginalSha256:sha(source),
   expectedOriginalByteLength:Buffer.byteLength(source),userApproved:true
  };
  await run({root,sourcePath,backupDirectory,opts});
 }finally{await rm(root,{recursive:true,force:true});}
}

test('TEST-020: changed original and unchanged verified backup yield read-only preflight',async()=>{
 await fixture(async ({sourcePath,backupDirectory,opts})=>{
  const entriesBefore=await readdir(backupDirectory);
  const originalBackup=await readFile(join(backupDirectory,opts.backupFileName));
  const result=await inspectChangedSourceRestorePreflightReadOnly(opts);
  assert.equal(result.status,'RESTORE_PREFLIGHT_READ_ONLY',JSON.stringify(result));
  if(result.status==='RESTORE_PREFLIGHT_READ_ONLY'){
   assert.equal(result.currentSha256,sha(changed));
   assert.equal(result.originalSha256,sha(source));
   assert.equal(result.originalByteLength,Buffer.byteLength(source));
  }
  assert.equal(result.automaticPatchAllowed,false);
  assert.equal(result.automaticRollbackAllowed,false);
  assert.equal(result.tampermonkeyVerified,false);
  assert.equal(result.businessVerified,false);
  assert.equal(JSON.stringify(result).includes(sourcePath),false);
  assert.equal(JSON.stringify(result).includes(backupDirectory),false);
  assert.equal(await readFile(sourcePath,'utf8'),changed);
  assert.deepEqual(await readFile(join(backupDirectory,opts.backupFileName)),originalBackup);
  assert.deepEqual((await readdir(backupDirectory)).sort(),entriesBefore.sort(),
   'read-only preflight must not create lock, temp or restored files');
 });
});

test('TEST-020/021: unknown consent or hostile accessor never grants restoration',async()=>{
 await fixture(async ({sourcePath,backupDirectory,opts})=>{
  let accessed=0;
  const getter={...opts};
  Object.defineProperty(getter,'backupDirectory',{enumerable:true,get(){
   accessed++;throw Error('PRIVATE_BACKUP_PATH');
  }});
  const proxy=new Proxy(opts,{ownKeys(){throw Error('PRIVATE_USER_SCRIPT');}});
  for(const input of [
   {...opts,userApproved:false},
   {...opts,runtimeEvidence:{businessVerified:true}},
   {...opts,automaticRollbackAllowed:true},
   getter,proxy,Object.create(opts),null
  ]){
   const result=await inspectChangedSourceRestorePreflightReadOnly(input);
   assert.equal(result.status,'BLOCKED');
   assert.equal(result.automaticPatchAllowed,false);
   assert.equal(result.automaticRollbackAllowed,false);
   assert.equal(JSON.stringify(result).includes(sourcePath),false);
   assert.equal(JSON.stringify(result).includes(backupDirectory),false);
  }
  assert.equal(accessed,0);
  assert.equal(await readFile(sourcePath,'utf8'),changed);
 });
});

test('TEST-020: changed-source identity mismatch or unchanged hash blocks',async()=>{
 await fixture(async ({sourcePath,opts})=>{
  const attacks=[
   {...opts,expectedCurrentSha256:'0'.repeat(64)},
   {...opts,expectedCurrentSha256:opts.expectedOriginalSha256},
   {...opts,expectedOriginalSha256:'0'.repeat(64)},
   {...opts,expectedOriginalByteLength:1},
   {...opts,backupFileName:'unrelated.00000000-0000-4000-8000-000000000000.backup.user.js'},
   {...opts,backupFileName:'../escape.backup.user.js'},
   {...opts,expectedOriginalSha256:'x'},
   {...opts,expectedOriginalByteLength:0}
  ];
  for(const input of attacks){
   const result=await inspectChangedSourceRestorePreflightReadOnly(input);
   assert.equal(result.status,'BLOCKED',JSON.stringify(input));
   assert.equal(result.automaticRollbackAllowed,false);
  }
  assert.equal(await readFile(sourcePath,'utf8'),changed);
 });
});

test('TEST-020: tampered backup and a later external source edit both block',async()=>{
 await fixture(async ({sourcePath,backupDirectory,opts})=>{
  const backupPath=join(backupDirectory,opts.backupFileName);
  await writeFile(backupPath,'INVALID BACKUP\n');
  const corrupted=await inspectChangedSourceRestorePreflightReadOnly(opts);
  assert.equal(corrupted.status,'BLOCKED');
  assert.equal(corrupted.automaticRollbackAllowed,false);
  await writeFile(backupPath,source,'utf8');
  await writeFile(sourcePath,changed+'// external edit\n','utf8');
  const stale=await inspectChangedSourceRestorePreflightReadOnly(opts);
  assert.equal(stale.status,'BLOCKED');
  assert.equal(stale.automaticRollbackAllowed,false);
  assert.equal(await readFile(sourcePath,'utf8'),changed+'// external edit\n');
 });
});

test('TEST-020: extra hardlink to changed source is not a trusted restore target',async()=>{
 await fixture(async ({root,sourcePath,opts})=>{
  await link(sourcePath,join(root,'second-name.user.js'));
  const result=await inspectChangedSourceRestorePreflightReadOnly(opts);
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.automaticPatchAllowed,false);
  assert.equal(result.automaticRollbackAllowed,false);
  assert.equal(await readFile(sourcePath,'utf8'),changed);
 });
});

// A digest alone does not bind two observations to the same approved inode.
// Swap at the boundary between the first source read and the recovery check:
// both independent SHA-256 reads still match, so cross-read identity matters.
test('TEST-020: same-byte source replacement during preflight fails closed',async()=>{
 await fixture(async ({sourcePath,opts})=>{
  const recovery=require('../../src/version/recovery-source') as typeof import('../../src/version/recovery-source');
  const originalVerify=recovery.verifyBackupRecoverySource;
  let replaced=false;
  // This test uses an isolated Node test process; restore the export in finally.
  (recovery as {verifyBackupRecoverySource:typeof originalVerify}).verifyBackupRecoverySource=async (input)=>{
   if(!replaced){
    replaced=true;
    await rename(sourcePath,sourcePath+'.prior-inode');
    await writeFile(sourcePath,changed,'utf8');
   }
   return originalVerify(input);
  };
  try{
   const result=await inspectChangedSourceRestorePreflightReadOnly(opts);
   assert.equal(replaced,true);
   assert.equal(result.status,'BLOCKED',JSON.stringify(result));
   if(result.status==='BLOCKED')assert.equal(result.reason,'SOURCE_UNVERIFIED');
   assert.equal(result.automaticRollbackAllowed,false);
   assert.equal(await readFile(sourcePath,'utf8'),changed);
  }finally{
   (recovery as {verifyBackupRecoverySource:typeof originalVerify}).verifyBackupRecoverySource=originalVerify;
  }
 });
});

// The higher-level read-only restore preflight must not elevate a relocated
// co-located backup to a recoverable version before manual native consent.
test('TASK-011/TEST-020/021: relocated backup cannot pass changed-source restore preflight',async()=>{
 await fixture(async({root,sourcePath,backupDirectory,opts})=>{
  const moved=join(root,opts.backupFileName);
  await rename(join(backupDirectory,opts.backupFileName),moved);
  const before=await readdir(root);
  const result=await inspectChangedSourceRestorePreflightReadOnly({
   ...opts,backupDirectory:root
  });
  assert.equal(result.status,'BLOCKED',JSON.stringify(result));
  if(result.status==='BLOCKED')assert.equal(result.reason,'BACKUP_UNVERIFIED');
  assert.equal(result.automaticRollbackAllowed,false);
  assert.equal(await readFile(sourcePath,'utf8'),changed);
  assert.deepEqual(await readFile(moved,'utf8'),source);
  assert.deepEqual((await readdir(root)).sort(),before.sort());
 });
});


test('TASK-011/TEST-020/021: interrupted native restore staging blocks read-only preflight',async()=>{
 for(const location of ['source-parent','recovery-store'] as const){
  await fixture(async ({root,sourcePath,backupDirectory,opts})=>{
   const pending=join(location==='source-parent'?root:backupDirectory,
    '.uah-restore-12345678-1234-4123-8123-123456789abc.pending');
   await writeFile(pending,'interrupted native recovery evidence');
   const before=await readFile(pending);
   const result=await inspectChangedSourceRestorePreflightReadOnly(opts);
   assert.equal(result.status,'BLOCKED',JSON.stringify({location,result}));
   if(result.status==='BLOCKED')
    assert.equal(result.reason,'RECOVERY_REVIEW_REQUIRED');
   assert.equal(result.automaticPatchAllowed,false);
   assert.equal(result.automaticRollbackAllowed,false);
   assert.equal(result.businessVerified,false);
   assert.equal(await readFile(sourcePath,'utf8'),changed);
   assert.deepEqual(await readFile(pending),before,
    'a read-only preflight must preserve crash evidence for manual review');
   assert.equal(await readFile(join(backupDirectory,opts.backupFileName),'utf8'),source);
  });
 }
});

test('TASK-011/TEST-020/021: an occupied native restore path mutex blocks read-only preflight',async()=>{
 await fixture(async ({root,sourcePath,backupDirectory,opts})=>{
  const key=sha(process.platform==='win32'?sourcePath.toLowerCase():sourcePath);
  const lock=join(root,'.uah-restore-path-'+key);
  await mkdir(lock);
  const before=await readdir(root);
  const result=await inspectChangedSourceRestorePreflightReadOnly(opts);
  assert.equal(result.status,'BLOCKED',JSON.stringify(result));
  if(result.status==='BLOCKED')assert.equal(result.reason,'RECOVERY_REVIEW_REQUIRED');
  assert.equal(result.automaticRollbackAllowed,false);
  assert.equal(result.automaticPatchAllowed,false);
  assert.deepEqual((await readdir(root)).sort(),before.sort());
  assert.equal(await readFile(sourcePath,'utf8'),changed);
  assert.equal(await readFile(join(backupDirectory,opts.backupFileName),'utf8'),source);
 });
});

test('TASK-011/TEST-020/021: existing published same-source restore intent blocks preflight',async()=>{
 await fixture(async ({sourcePath,backupDirectory,opts})=>{
  const displaced=await createVerifiedBackupOnly({
   sourcePath,backupDirectory,expectedSha256:sha(changed),userApproved:true
  });
  assert.equal(displaced.status,'BACKUP_ONLY',JSON.stringify(displaced));
  if(displaced.status!=='BACKUP_ONLY')return;
  const journalPath=join(backupDirectory,
   '.uah-restore-12345678-1234-4123-8123-123456789abc.journal.json');
  const journal=JSON.stringify({
   schema:1,state:'RESTORE_INTENT_UNVERIFIED',
   sourcePathSha256:sha(sourcePath),
   originalSha256:sha(source),displacedSha256:sha(changed),
   originalBackupFileName:opts.backupFileName,
   displacedBackupFileName:displaced.backupFileName,
   automaticPatchAllowed:false,automaticRollbackAllowed:false
  })+'\\n';
  await writeFile(journalPath,journal,'utf8');
  const entries=await readdir(backupDirectory);
  const result=await inspectChangedSourceRestorePreflightReadOnly(opts);
  assert.equal(result.status,'BLOCKED',JSON.stringify(result));
  if(result.status==='BLOCKED')assert.equal(result.reason,'RECOVERY_REVIEW_REQUIRED');
  assert.equal(result.automaticPatchAllowed,false);
  assert.equal(result.automaticRollbackAllowed,false);
  assert.equal(await readFile(journalPath,'utf8'),journal);
  assert.equal(await readFile(sourcePath,'utf8'),changed);
  assert.equal(await readFile(join(backupDirectory,opts.backupFileName),'utf8'),source);
  assert.equal(await readFile(join(backupDirectory,displaced.backupFileName),'utf8'),changed);
  assert.deepEqual((await readdir(backupDirectory)).sort(),entries.sort());
 });
});
