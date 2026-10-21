import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import {createLimitedGmReport,saveLimitedGmReportOnly} from '../../src/manager/gm-report';

const flags={extensionAuthenticityVerified:false as const,
  scriptInstallationVerified:false as const,gmApiVerified:false as const,businessVerified:false as const};
const summary={
 status:'SELF_REPORTED_EXPECTATIONS_MATCH' as const,observedModes:2,
 reportedGmDefaultMatched:true,reportedGmStorageRoundtripMatched:true,
 reportedBrokenFailed:true,
 reportedFixedRecovered:true,...flags
};
const consistency={status:'CONSISTENT_UNVERIFIED_FIXTURE_ONLY' as const,comparedModes:2 as const,...flags};
const observedAt='2026-10-19T02:00:00.000Z';
const dom=(mode:'broken'|'fixed',actionCount:0|1)=>({
 status:'LIMITED_FIXTURE_DOM_ONLY' as const,mode,observedAt:mode==='broken'?
 observedAt:'2026-10-19T02:00:01.000Z',targetCount:1 as const,
 actionCount,fixtureDomMatchesExpected:true,...flags
});
const session={
 runAt:'document-end' as const,browserVersion:'155.0.8059.40',
 expiresAt:Date.parse('2026-10-19T02:05:00.000Z'),
 source:'SECRET_SOURCE_NEVER_EXPORT',
 installUrl:'http://127.0.0.1:4321/install.user.js?key=SECRET_TOKEN_NEVER_EXPORT',
 origin:'http://127.0.0.1:4321',
 runtimeHint:{status:'RUNTIME_TARGET_HINT_ONLY',manager:'Tampermonkey'},
 snapshot:()=>summary,consistencySnapshot:()=>consistency,
 domSnapshot:()=>({broken:dom('broken',0),fixed:dom('fixed',1)})
};
test('TEST-017: report includes bounded unverified evidence but no source, token, URL or manager claims',()=>{
 const result=createLimitedGmReport(session,Date.parse('2026-10-19T02:02:00.000Z'));
 assert.equal(result.status,'UNVERIFIED_REPORT_READY');
 if(result.status!=='UNVERIFIED_REPORT_READY')return;
 const report=result.report;
 assert.equal(report.verdict,'NOT_VERIFIED');
 assert.equal(report.schema,'uah-manual-gm-fixture-v3');
 assert.equal(report.browserVersion,'155.0.8059.40');
 assert.equal(report.runAt,'document-end');
 assert.equal(report.assessment.status,'SELF_REPORTED_EXPECTATIONS_MATCH');
 assert.equal(report.assessment.reportedGmStorageRoundtripMatched,true);
 assert.equal(report.consistency.status,'CONSISTENT_UNVERIFIED_FIXTURE_ONLY');
 assert.equal(report.dom.broken?.actionCount,0);
 assert.equal(report.dom.fixed?.actionCount,1);
 assert.equal(report.extensionAuthenticityVerified,false);
 assert.equal(report.scriptInstallationVerified,false);
 assert.equal(report.gmApiVerified,false);
 assert.equal(report.businessVerified,false);
 assert.equal(report.automaticPatchAllowed,false);
 assert.equal(report.automaticRollbackAllowed,false);
 const serialized=JSON.stringify(report);
 for(const secret of ['SECRET_SOURCE_NEVER_EXPORT','SECRET_TOKEN_NEVER_EXPORT',
   '127.0.0.1','install.user.js','runtimeHint','source','origin']){
   assert.equal(serialized.includes(secret),false,secret);
 }
 assert.ok(Buffer.byteLength(serialized)<4096);
});
test('TEST-017: incomplete or malformed self-reports fail closed; never claim real GM success',()=>{
 const awaiting={...session,snapshot:()=>({...summary,
   status:'AWAITING_BROWSER_VISITS' as const,observedModes:0,
   reportedGmDefaultMatched:false,reportedGmStorageRoundtripMatched:false,
   reportedBrokenFailed:false,reportedFixedRecovered:false}),
   consistencySnapshot:()=>({...consistency,
     status:'AWAITING_BROWSER_VISITS' as const,comparedModes:0 as const}),
   domSnapshot:()=>({})};
 const pending=createLimitedGmReport(awaiting,Date.parse('2026-10-19T02:02:00.000Z'));
 assert.equal(pending.status,'UNVERIFIED_REPORT_READY');
 if(pending.status==='UNVERIFIED_REPORT_READY'){
   assert.equal(pending.report.verdict,'NOT_VERIFIED');
   assert.equal(pending.report.dom.broken,null);
   assert.equal(pending.report.dom.fixed,null);
 }
 for(const bad of [
  {...session,runAt:'document-end;evil'},
  {...session,snapshot:()=>({...summary,gmApiVerified:true})},
  {...session,consistencySnapshot:()=>({...consistency,comparedModes:3})},
  {...session,domSnapshot:()=>({broken:{...dom('broken',0),actionCount:2}})},
  {...session,expiresAt:Infinity},
  {...session,browserVersion:'unverified'},
  {...session,browserVersion:'155.0.8059.40;--debugging'},
  {...session,browserVersion:'155.0.8059.40\\nProfile:secret'}
 ]){
   assert.equal(createLimitedGmReport(bad as typeof session,Date.now()).status,'BLOCKED');
 }
});

test('TEST-017: native report refuses nested unknown fields and accessors before writing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-gm-report-schema-'));
 try{
  const ready=createLimitedGmReport(session,Date.parse('2026-10-19T02:02:00.000Z'));
  assert.equal(ready.status,'UNVERIFIED_REPORT_READY');
  if(ready.status!=='UNVERIFIED_REPORT_READY')return;
  const report=ready.report;
  const malformed:unknown[]=[
   {...report,assessment:{...report.assessment,installUrl:'SECRET_URL'}},
   {...report,consistency:{...report.consistency,source:'SECRET_SOURCE'}},
   {...report,dom:{...report.dom,broken:{...report.dom.broken,source:'SECRET_SOURCE'}}},
   {...report,dom:{...report.dom,extraneous:'SECRET_TOKEN'}},
   {...report,assessment:{...report.assessment,status:'VERIFIED'}},
   {...report,expiresAt:'invalid timestamp'},
   {...report,browserVersion:'Chrome/155.0.8059.40'},
   {...report,browserVersion:'155.0.8059.40\\nSECRET_PROFILE_PATH'},
   {...report,schema:'uah-manual-gm-fixture-v1'},
   {...report,dom:{...report.dom,fixed:{...report.dom.fixed,actionCount:5}}}
  ];
  let getterCalls=0;
  const withAccessor={...report,assessment:{...report.assessment}};
  Object.defineProperty(withAccessor.assessment,'status',{
   enumerable:true,get(){getterCalls++;return 'SELF_REPORTED_EXPECTATIONS_MATCH';}
  });
  malformed.push(withAccessor);
  for(let i=0;i<malformed.length;i++){
   const result=await saveLimitedGmReportOnly(
    malformed[i] as typeof report,join(root,'malformed-'+i+'.json'),true);
   assert.equal(result.status,'BLOCKED','malformed '+i);
  }
  assert.equal(getterCalls,0);
  assert.deepEqual(await readdir(root),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('TEST-017/026: report save refuses live and revoked Proxy inputs before any reflection',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-gm-report-proxy-'));
 try{
  const ready=createLimitedGmReport(session,Date.parse('2026-10-19T02:02:00.000Z'));
  assert.equal(ready.status,'UNVERIFIED_REPORT_READY');
  if(ready.status!=='UNVERIFIED_REPORT_READY')return;
  const report=ready.report;
  let trapCalls=0;
  const traps:ProxyHandler<object>={
   getPrototypeOf(){trapCalls++;throw Error('Unexpected proxy prototype access');},
   ownKeys(){trapCalls++;throw Error('Unexpected proxy key enumeration');},
   getOwnPropertyDescriptor(){trapCalls++;throw Error('Unexpected proxy descriptor access');}
  };
  const inputs:unknown[]=[
   new Proxy({...report},traps),
   {...report,assessment:new Proxy({...report.assessment},traps)},
   {...report,consistency:new Proxy({...report.consistency},traps)},
   {...report,dom:new Proxy({...report.dom},traps)},
   {...report,dom:{...report.dom,broken:new Proxy({...report.dom.broken},traps)}},
   {...report,dom:{...report.dom,fixed:new Proxy({...report.dom.fixed},traps)}}
  ];
  const revoked=Proxy.revocable({...report},{});
  revoked.revoke();
  inputs.push(revoked.proxy);
  for(const [index,input] of inputs.entries()){
   const result=await saveLimitedGmReportOnly(
    input as typeof report,join(root,'refused-'+index+'.json'),true);
   assert.equal(result.status,'BLOCKED','proxy input '+index);
   if(result.status==='BLOCKED')
    assert.equal(result.code,'INVALID_REQUEST','proxy input '+index);
  }
  assert.equal(trapCalls,0,'no untrusted Proxy trap may run during validation');
  assert.deepEqual(await readdir(root),[],'no partial report may be published');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('TEST-017: native report creates a private separate JSON only once and never overwrites',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-gm-report-'));
 try{
  const path=join(root,'manual-qa.json');
  const ready=createLimitedGmReport(session,Date.parse('2026-10-19T02:02:00.000Z'));
  assert.equal(ready.status,'UNVERIFIED_REPORT_READY');
  if(ready.status!=='UNVERIFIED_REPORT_READY')return;
  const denied=await saveLimitedGmReportOnly(ready.report,path,false);
  assert.equal(denied.status,'BLOCKED');
  assert.deepEqual(await readdir(root),[]);
  const saved=await saveLimitedGmReportOnly(ready.report,path,true);
  assert.equal(saved.status,'REPORT_SAVED_UNVERIFIED_ONLY',JSON.stringify(saved));
  if(saved.status!=='REPORT_SAVED_UNVERIFIED_ONLY')return;
  const bytes=await readFile(path);
  const parsed=JSON.parse(bytes.toString('utf8'));
  assert.deepEqual(parsed,ready.report);
  assert.equal(saved.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(saved.fileName,'manual-qa.json');
  assert.equal(saved.automaticPatchAllowed,false);
  assert.equal(saved.businessVerified,false);
  assert.equal(JSON.stringify(saved).includes(root),false);
  const repeat=await saveLimitedGmReportOnly(ready.report,path,true);
  assert.equal(repeat.status,'BLOCKED');
  assert.deepEqual(await readFile(path),bytes);
  assert.deepEqual(await readdir(root),['manual-qa.json']);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('TEST-017: redirected directory and invalid report path cannot write native evidence',async t=>{
 const root=await mkdtemp(join(tmpdir(),'uah-gm-report-negative-'));
 try{
  const other=join(root,'good');await mkdir(other);
  const valid=createLimitedGmReport(session,Date.parse('2026-10-19T02:02:00.000Z'));
  assert.equal(valid.status,'UNVERIFIED_REPORT_READY');
  if(valid.status!=='UNVERIFIED_REPORT_READY')return;
  for(const path of [join(other,'a.user.js'),'relative.json',other+sep+'..'+sep+'evil.json']){
   const output=await saveLimitedGmReportOnly(valid.report,path,true);
   assert.equal(output.status,'BLOCKED');
  }
  const link=join(root,'alias');
  try{await symlink(other,link,process.platform==='win32'?'junction':'dir');}
  catch(e){if(['EPERM','EACCES','ENOTSUP'].includes((e as NodeJS.ErrnoException).code??'')){t.diagnostic('Junction privilege unavailable');return;}throw e;}
  assert.equal((await saveLimitedGmReportOnly(valid.report,join(link,'hidden.json'),true)).status,'BLOCKED');
  assert.deepEqual(await readdir(other),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});

// A report may have valid types and still contradict itself. Never let a
// hand-edited JSON report imply two-mode fixture agreement without evidence.
test('TEST-017/026: coherent report semantics are required at capture and native save',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-gm-report-coherence-'));
 try{
  const ready=createLimitedGmReport(session,Date.parse('2026-10-19T02:02:00.000Z'));
  assert.equal(ready.status,'UNVERIFIED_REPORT_READY');
  if(ready.status!=='UNVERIFIED_REPORT_READY')return;
  const original=ready.report;
  const forged=[
   {...original,assessment:{...original.assessment,observedModes:1}},
   {...original,assessment:{...original.assessment,reportedBrokenFailed:false}},
   {...original,assessment:{...original.assessment,reportedGmStorageRoundtripMatched:false}},
   {...original,assessment:{...original.assessment,status:'AWAITING_REPORTS',observedModes:2}},
   {...original,consistency:{...original.consistency,comparedModes:1}},
   {...original,consistency:{...original.consistency,status:'AWAITING_DOM_OBSERVATIONS'}},
   {...original,dom:{...original.dom,broken:null}},
   {...original,dom:{...original.dom,broken:{...original.dom.broken,actionCount:1}}},
   {...original,dom:{...original.dom,fixed:{...original.dom.fixed,fixtureDomMatchesExpected:false}}},
   {...original,dom:{...original.dom,fixed:{...original.dom.fixed,observedAt}}},
  ];
  for(const [i,bad] of forged.entries()){
   const result=await saveLimitedGmReportOnly(
    bad as typeof original,join(root,'forged-'+i+'.json'),true);
   assert.equal(result.status,'BLOCKED','forged report '+i);
  }
  assert.deepEqual(await readdir(root),[]);
  for(const fake of [
   {...session,snapshot:()=>({...summary,observedModes:1})},
   {...session,consistencySnapshot:()=>({...consistency,comparedModes:1})},
   {...session,domSnapshot:()=>({broken:dom('broken',0)})}
  ]){
   assert.equal(createLimitedGmReport(fake as typeof session,
    Date.parse('2026-10-19T02:02:00.000Z')).status,'BLOCKED');
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('TEST-017/026: report chronology rejects future DOM and post-expiry evidence at capture and save',async()=>{
 const root=await mkdtemp(join(tmpdir(),'uah-gm-timeline-'));
 try{
  const at=Date.parse('2026-10-19T02:02:00.000Z');
  const ready=createLimitedGmReport(session,at);
  assert.equal(ready.status,'UNVERIFIED_REPORT_READY');
  if(ready.status!=='UNVERIFIED_REPORT_READY')return;
  const report=ready.report;

  // Legitimate operators can visit fixed first: chronology is bounded but
  // the two modes are not assumed to have a fixed temporal ordering.
  const reverse={...session,domSnapshot:()=>({
    broken:{...dom('broken',0),observedAt:'2026-10-19T02:00:01.000Z'},
    fixed:{...dom('fixed',1),observedAt:'2026-10-19T02:00:00.000Z'}
  })};
  assert.equal(createLimitedGmReport(reverse,at).status,'UNVERIFIED_REPORT_READY');

  const impossible=[
    {...session,expiresAt:at},
    {...session,expiresAt:at-1},
    {...session,domSnapshot:()=>({
      broken:{...dom('broken',0),observedAt:'2026-10-19T02:02:01.000Z'},
      fixed:dom('fixed',1)
    })},
    {...session,domSnapshot:()=>({
      broken:dom('broken',0),
      fixed:{...dom('fixed',1),observedAt:'2026-10-19T02:06:00.000Z'}
    })}
  ];
  for(const [i,invalid] of impossible.entries()){
    assert.equal(createLimitedGmReport(invalid as typeof session,at).status,
      'BLOCKED','capture timeline '+i);
  }

  const forged=[
    {...report,collectedAt:'2026-10-19T02:05:00.000Z'},
    {...report,expiresAt:'2026-10-19T02:02:00.000Z'},
    {...report,dom:{...report.dom,broken:{
      ...report.dom.broken,observedAt:'2026-10-19T02:02:01.000Z'}}},
    {...report,dom:{...report.dom,fixed:{
      ...report.dom.fixed,observedAt:'2026-10-19T02:06:00.000Z'}}}
  ];
  for(const [i,invalid] of forged.entries()){
    const saved=await saveLimitedGmReportOnly(
      invalid as typeof report,join(root,'timeline-'+i+'.json'),true);
    assert.equal(saved.status,'BLOCKED','saved timeline '+i);
  }
  assert.deepEqual(await readdir(root),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});
