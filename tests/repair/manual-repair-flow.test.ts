import {test,mock} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readdir,readFile,rename,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import type {LiteralPatchRequest} from '../../src/repair/patch-planner';
import type {ScenarioInput} from '../../src/scenarios/scenario-registry';
import {prepareManualRepairExportOnly} from '../../src/repair/manual-repair-flow';
import {inspectRecoveryCheckpointReadOnly} from '../../src/version/recovery-checkpoint';

const header='// ==UserScript==\n// @name Manual repair flow\n'+
  '// @match https://example.com/*\n// @grant none\n// ==/UserScript==\n';
const source=header+"const target=document.querySelector('#old');\n";
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const patch:LiteralPatchRequest={
  source,expectedSourceSha256:hash(source),
  callOffset:source.indexOf('document.querySelector'),
  method:'querySelector',originalSelector:'#old',
  replacementSelector:'#new',faultEvidenceId:'scenario_assertion_1'
};
const scenario:ScenarioInput={
  id:'manual_test',scriptSha256:hash(source),
  userApproved:true,requiresLogin:false,targetUrl:'https://example.com/',
  steps:[],assertions:[
    {kind:'selector-present',selector:'#old'},
    {kind:'selector-present',selector:'#new'}
  ]
};
function sample(time:string,oldCount=0,newCount=1){
  return {ok:true as const,status:'LIMITED_DOM_OBSERVATION' as const,
    observedAt:time,originMatchesApproved:true as const,routeChanged:false,
    summary:{elementCount:4,iframeCount:0,visibleShadowRoots:0,blindSpots:[]},
    selectorCounts:{'#old':oldCount,'#new':newCount},
    fullPageVerified:false as const,userscriptVerified:false as const};
}
const samples=()=>({ok:true as const,
  status:'LIMITED_DYNAMIC_OBSERVATION' as const,
  samples:[sample('2026-10-19T00:00:00Z'),sample('2026-10-19T00:00:01Z')],
  routeChangeDetected:false,selectorCountChanged:false,domCountChanged:false,
  userscriptVerified:false as const
});
async function fixture(run:(opts:{
 sourcePath:string;backupDirectory:string;exportDirectory:string;userApproved:boolean
})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'uah-repair-flow-'));
 const opts={sourcePath:join(root,'fixture.user.js'),
   backupDirectory:join(root,'backups'),
   exportDirectory:join(root,'manual-exports'),userApproved:true};
 try{
   await mkdir(opts.backupDirectory);
   await mkdir(opts.exportDirectory);
   await writeFile(opts.sourcePath,source);
   await run(opts);
 }finally{await rm(root,{recursive:true,force:true});}
}

test('TEST-014/019/020/023: stable DOM failure becomes separate reviewed manual file, never auto-apply',async()=>{
 await fixture(async opts=>{
   const result=await prepareManualRepairExportOnly(patch,scenario,samples(),opts);
   assert.equal(result.status,'MANUAL_EXPORT_READY_RUNTIME_UNVERIFIED',JSON.stringify(result));
   if(result.status!=='MANUAL_EXPORT_READY_RUNTIME_UNVERIFIED')return;
   const staged=await readFile(join(opts.backupDirectory,result.candidateFileName),'utf8');
   const exported=await readFile(join(opts.exportDirectory,result.exportFileName),'utf8');
   assert.equal(exported,staged);
   assert.equal(exported,header+'const target=document.querySelector("#new");\n');
   assert.equal(result.sourceSha256,hash(source));
   assert.equal(result.candidateSha256,hash(exported));
   assert.equal(result.candidateByteLength,Buffer.byteLength(exported));
   const checkpointName=(result as typeof result & {checkpointFileName:string}).checkpointFileName;
   assert.match(checkpointName,/\.checkpoint\.json$/);
   const checkpoint=await readFile(join(opts.backupDirectory,checkpointName));
   assert.equal((result as typeof result & {checkpointSha256:string}).checkpointSha256,hash(checkpoint));
   const parsed=JSON.parse(checkpoint.toString('utf8')) as Record<string,unknown>;
   assert.equal(parsed.status,'RECOVERY_CHECKPOINT_UNVERIFIED');
   assert.equal(parsed.originalSha256,hash(source));
   assert.equal(parsed.candidateSha256,hash(exported));
   const inspected=await inspectRecoveryCheckpointReadOnly(patch,checkpointName,{
    sourcePath:opts.sourcePath,backupDirectory:opts.backupDirectory,userApproved:true
   });
   assert.equal(inspected.status,'CHECKPOINT_RECHECKED_READ_ONLY',JSON.stringify(inspected));
   assert.equal(inspected.automaticPatchAllowed,false);
   assert.equal(inspected.automaticRollbackAllowed,false);
   assert.equal(result.automaticPatchAllowed,false);
   assert.equal(result.automaticRollbackAllowed,false);
   assert.equal(result.tampermonkeyVerified,false);
   assert.equal(result.managerInstalled,false);
   assert.equal(result.businessVerified,false);
   assert.deepEqual(await readFile(opts.sourcePath,'utf8'),source);
   assert.deepEqual(await readFile(join(opts.backupDirectory,result.backupFileName),'utf8'),source);
   assert.deepEqual((await readdir(opts.backupDirectory)).sort(),
     [result.backupFileName,result.candidateFileName,checkpointName].sort());
   assert.equal(await readFile(join(opts.exportDirectory,result.recoveryExportFileName),'utf8'),source);
   assert.notEqual(result.recoveryExportFileName,result.exportFileName);
   assert.equal((await readdir(opts.exportDirectory)).length,2);
   assert.equal(JSON.stringify(result).includes(opts.sourcePath),false);
 });
});

test('TEST-014/019: conflicting or forged DOM observations leave disk untouched',async()=>{
 await fixture(async opts=>{
  const mismatched={...samples(),samples:[
    sample('2026-10-19T00:00:00Z',0,0),
    sample('2026-10-19T00:00:01Z',0,0)
  ]};
  for(const [p,s,observation] of [
    [patch,scenario,mismatched],
    [patch,{...scenario,userApproved:false},samples()],
    [{...patch,replacementSelector:'#evil'},scenario,samples()],
    [Object.create(patch),scenario,samples()],
    [patch,scenario,{...samples(),routeChangeDetected:true}]
  ] as const){
    const output=await prepareManualRepairExportOnly(p,s,observation,opts);
    assert.equal(output.status,'BLOCKED');
    assert.equal(output.automaticPatchAllowed,false);
    assert.equal(output.managerInstalled,false);
  }
  const unauthorized=await prepareManualRepairExportOnly(
    patch,scenario,samples(),{...opts,userApproved:false});
  assert.equal(unauthorized.status,'BLOCKED');
  assert.deepEqual(await readdir(opts.backupDirectory),[]);
  assert.deepEqual(await readdir(opts.exportDirectory),[]);
  assert.equal(await readFile(opts.sourcePath,'utf8'),source);
 });
});

test('TEST-020/023: stale source or invalid export location never modifies selected original',async()=>{
 await fixture(async opts=>{
  await writeFile(opts.sourcePath,source+'// external change\n');
  const stale=await prepareManualRepairExportOnly(patch,scenario,samples(),opts);
  assert.equal(stale.status,'BLOCKED');
  assert.deepEqual(await readdir(opts.exportDirectory),[]);
  assert.equal(await readFile(opts.sourcePath,'utf8'),source+'// external change\n');
  await writeFile(opts.sourcePath,source);
  const invalid=await prepareManualRepairExportOnly(patch,scenario,samples(),{
    ...opts,exportDirectory:opts.backupDirectory
  });
  assert.equal(invalid.status,'BLOCKED');
  assert.equal(invalid.automaticPatchAllowed,false);
  assert.equal(invalid.businessVerified,false);
  assert.deepEqual(await readdir(opts.exportDirectory),[]);
  assert.equal(await readFile(opts.sourcePath,'utf8'),source);
 });
});

test('TEST-019/023/026: cross-origin @match blocks manual candidate export without any disk side effects',async()=>{
 await fixture(async opts=>{
   const expandedSource=source.replace('// @grant none',
     '// @match https://unobserved.example/*\n// @grant none');
   await writeFile(opts.sourcePath,expandedSource);
   const expandedPatch:LiteralPatchRequest={...patch,source:expandedSource,
     expectedSourceSha256:hash(expandedSource),
     callOffset:expandedSource.indexOf('document.querySelector')};
   const linkedScenario={...scenario,scriptSha256:expandedPatch.expectedSourceSha256};
   const result=await prepareManualRepairExportOnly(
     expandedPatch,linkedScenario,samples(),opts);
   assert.equal(result.status,'BLOCKED');
   assert.equal(result.automaticPatchAllowed,false);
   assert.equal(result.automaticRollbackAllowed,false);
   assert.equal(result.managerInstalled,false);
   assert.equal(result.businessVerified,false);
   assert.deepEqual(await readdir(opts.backupDirectory),[]);
   assert.deepEqual(await readdir(opts.exportDirectory),[]);
   assert.equal(await readFile(opts.sourcePath,'utf8'),expandedSource);
 });
});

test('TEST-019/023/026: manual repair rejects Proxy patch/options without reflection or disk writes',async()=>{
 await fixture(async opts=>{
  let traps=0;
  const hostile=(value:object)=>new Proxy(value,{
    getPrototypeOf(){
      traps++;
      throw new Error('untrusted Proxy reflection must not execute');
    }
  });
  for(const [patchInput,optionsInput] of [
    [hostile(patch),opts],
    [patch,hostile(opts)]
  ] as const){
    const result=await prepareManualRepairExportOnly(
      patchInput,scenario,samples(),optionsInput);
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.automaticPatchAllowed,false);
    assert.equal(result.automaticRollbackAllowed,false);
  }
  assert.equal(traps,0,'untrusted Proxy traps must not be invoked');
  assert.deepEqual(await readdir(opts.backupDirectory),[]);
  assert.deepEqual(await readdir(opts.exportDirectory),[]);
  assert.equal(await readFile(opts.sourcePath,'utf8'),source);
 });
});

test('TEST-023/026: rejected alias of backup and export folders creates no orphan candidate',async()=>{
 await fixture(async opts=>{
  for(const exportDirectory of [opts.backupDirectory,join(opts.backupDirectory,'.')]){
   const result=await prepareManualRepairExportOnly(
     patch,scenario,samples(),{...opts,exportDirectory});
   assert.equal(result.status,'BLOCKED');
   assert.equal(result.automaticPatchAllowed,false);
   assert.deepEqual(await readdir(opts.backupDirectory),[],
     'refused destinations must not leave a backup or staged candidate');
   assert.deepEqual(await readdir(opts.exportDirectory),[]);
   assert.equal(await readFile(opts.sourcePath,'utf8'),source);
  }
 });
});

test('TEST-023/026: source-directory export rejection leaves no orphan backup or staged candidate',async()=>{
 await fixture(async opts=>{
  const originalFolder=dirname(opts.sourcePath);
  for(const exportDirectory of [originalFolder,join(originalFolder,'.')]){
   const outcome=await prepareManualRepairExportOnly(
    patch,scenario,samples(),{...opts,exportDirectory});
   assert.equal(outcome.status,'BLOCKED');
   assert.equal(outcome.automaticPatchAllowed,false);
   assert.equal(outcome.managerInstalled,false);
   assert.deepEqual(await readdir(opts.backupDirectory),[],
    'rejected source-folder export must not publish backup or candidate');
   assert.deepEqual(await readdir(opts.exportDirectory),[]);
   assert.deepEqual(await readFile(opts.sourcePath,'utf8'),source);
  }
 });
});

test('TEST-023/026: redirected export directory never stages independent backup or candidate',async(t)=>{
 await fixture(async opts=>{
  const alias=join(dirname(opts.sourcePath),'redirected-export');
  try{await symlink(opts.backupDirectory,alias,
   process.platform==='win32'?'junction':'dir');}
  catch(error){
   if(['EPERM','EACCES','ENOTSUP'].includes((error as NodeJS.ErrnoException).code??'')){
    t.skip('directory junction or symlink unsupported in this Windows runner');
    return;
   }
   throw error;
  }
  const result=await prepareManualRepairExportOnly(
   patch,scenario,samples(),{...opts,exportDirectory:alias});
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.automaticPatchAllowed,false);
  assert.deepEqual(await readdir(opts.backupDirectory),[],
   'a redirected export must not leave an orphan backup or staged candidate');
  assert.deepEqual(await readdir(opts.exportDirectory),[]);
  assert.equal(await readFile(opts.sourcePath,'utf8'),source);
 });
});

test('TEST-023/026: missing manual export directory rejects before backing up source',async()=>{
 await fixture(async opts=>{
  const missing=join(dirname(opts.sourcePath),'nonexistent-export');
  const result=await prepareManualRepairExportOnly(
   patch,scenario,samples(),{...opts,exportDirectory:missing});
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.automaticPatchAllowed,false);
  assert.deepEqual(await readdir(opts.backupDirectory),[],
   'unusable export destination cannot create a backup as a side effect');
  assert.deepEqual(await readdir(opts.exportDirectory),[]);
  assert.equal(await readFile(opts.sourcePath,'utf8'),source);
 });
});

test('TASK-010/011 · TEST-020/021/023: mutated recovery checkpoint blocks native candidate export before any .user.js publication',async()=>{
 await fixture(async opts=>{
  const checkpointModule=require('../../src/version/recovery-checkpoint') as
    typeof import('../../src/version/recovery-checkpoint');
  const inspect=checkpointModule.inspectRecoveryCheckpointReadOnly;
  let invocations=0;
  const replacement=mock.method(checkpointModule,'inspectRecoveryCheckpointReadOnly',
   async (...args:Parameters<typeof inspect>)=>{
    invocations++;
    const checkpointFileName=args[1];
    assert.equal(typeof checkpointFileName,'string');
    await writeFile(join(opts.backupDirectory,checkpointFileName as string),
      '{"forged":"checkpoint"}\\n');
    return inspect(...args);
   });
  try{
   const result=await prepareManualRepairExportOnly(patch,scenario,samples(),opts);
   assert.equal(result.status,'BLOCKED','The native export MUST recheck the persisted checkpoint');
   if(result.status==='BLOCKED')assert.equal(result.reason,'CHECKPOINT_BLOCKED');
   assert.equal(invocations,1,'The checkpoint must be rechecked before producing the export');
   assert.deepEqual(await readdir(opts.exportDirectory),[],
     'Invalid checkpoint cannot produce manager-facing userscripts');
   assert.equal(await readFile(opts.sourcePath,'utf8'),source);
   assert.equal((await readdir(opts.backupDirectory)).length,3,
     'On a failed pre-export check, recovery artifacts remain for manual review');
  }finally{replacement.mock.restore();}
 });
});

test('TASK-010/011 · TEST-020/021/023: a checkpoint altered during export rejects the final successful receipt',async()=>{
 await fixture(async opts=>{
  const checkpointModule=require('../../src/version/recovery-checkpoint') as
    typeof import('../../src/version/recovery-checkpoint');
  const inspect=checkpointModule.inspectRecoveryCheckpointReadOnly;
  let invocations=0;
  const replacement=mock.method(checkpointModule,'inspectRecoveryCheckpointReadOnly',
   async (...args:Parameters<typeof inspect>)=>{
    invocations++;
    if(invocations===2){
     const checkpointFileName=args[1];
     assert.equal(typeof checkpointFileName,'string');
     await writeFile(join(opts.backupDirectory,checkpointFileName as string),
       '{"replaced":"during-export"}\\n');
    }
    return inspect(...args);
   });
  try{
   const result=await prepareManualRepairExportOnly(patch,scenario,samples(),opts);
   assert.equal(result.status,'BLOCKED',
     'A checkpoint changed after the first audit must not receive an export-ready receipt');
   if(result.status==='BLOCKED')assert.equal(result.reason,'CHECKPOINT_BLOCKED');
   assert.equal(invocations,2,'The on-disk checkpoint must be rechecked after export');
   assert.equal((await readdir(opts.exportDirectory)).length,2,
     'Already-written manual exports remain for native reconciliation; never delete potential recovery files');
   assert.equal(await readFile(opts.sourcePath,'utf8'),source);
  }finally{replacement.mock.restore();}
 });
});


test('TASK-011/012 TEST-020/021/023/026: checkpoint recheck cannot bless altered manual exports',async()=>{
 for(const alteration of ['candidate-bytes','original-bytes','candidate-replaced-same-bytes'] as const){
  await fixture(async opts=>{
   const checkpointModule=require('../../src/version/recovery-checkpoint') as
     typeof import('../../src/version/recovery-checkpoint');
   const inspect=checkpointModule.inspectRecoveryCheckpointReadOnly;
   let invocations=0;
   const replacement=mock.method(checkpointModule,'inspectRecoveryCheckpointReadOnly',
    async (...args:Parameters<typeof inspect>)=>{
     invocations++;
     const result=await inspect(...args);
     if(invocations===2&&result.status==='CHECKPOINT_RECHECKED_READ_ONLY'){
      const names=await readdir(opts.exportDirectory);
      const prefix=alteration==='original-bytes'?'UAH-Original-':'UAH-Reviewed-';
      const exported=names.filter(name=>name.startsWith(prefix));
      assert.equal(exported.length,1,'fixture must actually publish both exports');
      const target=join(opts.exportDirectory,exported[0]);
      if(alteration==='candidate-replaced-same-bytes'){
       const bytes=await readFile(target);
       const replacementPath=join(opts.exportDirectory,'replacement.tmp');
       await writeFile(replacementPath,bytes);
       await rename(replacementPath,target);
      }else{
       await writeFile(target,'// independent editor changed the manual .user.js\\n');
      }
     }
     return result;
    });
   try{
    const outcome=await prepareManualRepairExportOnly(patch,scenario,samples(),opts);
    assert.equal(invocations,2,'both independent checkpoint checks must run');
    assert.deepEqual(outcome,{
     status:'BLOCKED',reason:'EXPORT_BLOCKED',
     automaticPatchAllowed:false,automaticRollbackAllowed:false,
     tampermonkeyVerified:false,managerInstalled:false,businessVerified:false
    },'manual export receipt must not outlive '+alteration);
    assert.equal((await readdir(opts.exportDirectory)).length,2,
     'never delete or silently overwrite published evidence after a failed check');
    assert.equal(await readFile(opts.sourcePath,'utf8'),source,
     'never touch the original selected userscript');
   }finally{replacement.mock.restore();}
  });
 }
});
