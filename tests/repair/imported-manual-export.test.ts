import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {importApprovedPaths,type ImportedScript} from '../../src/import/import-service';
import {exportReviewedImportedSelectorOnly} from '../../src/repair/imported-manual-export';
import type {ScenarioInput} from '../../src/scenarios/scenario-registry';
import type {DynamicObservation} from '../../src/observe/dom-observer';

const header='// ==UserScript==\n// @name Native import bridge\n'+
 '// @match https://example.com/*\n// @grant none\n// ==/UserScript==\n';
const original=header+"const target=document.querySelector('#old');\n";
const hash=(input:Uint8Array|string)=>createHash('sha256').update(input).digest('hex');
function sample(at:string,old=0,next=1){
 return {ok:true as const,status:'LIMITED_DOM_OBSERVATION' as const,
   observedAt:at,originMatchesApproved:true as const,routeChanged:false,
   summary:{elementCount:4,iframeCount:0,visibleShadowRoots:0,blindSpots:[]},
   selectorCounts:{'#old':old,'#new':next},
   fullPageVerified:false as const,userscriptVerified:false as const};
}
const observation=():DynamicObservation=>({
 ok:true,status:'LIMITED_DYNAMIC_OBSERVATION',
 samples:[sample('2026-10-19T00:00:00Z'),sample('2026-10-19T00:00:01Z')],
 routeChangeDetected:false,selectorCountChanged:false,domCountChanged:false,
 userscriptVerified:false
});
const scenario=(digest:string):ScenarioInput=>({
 id:'native_bridge',scriptSha256:digest,
 userApproved:true,requiresLogin:false,targetUrl:'https://example.com/',
 steps:[],assertions:[
  {kind:'selector-present',selector:'#old'},
  {kind:'selector-present',selector:'#new'}
 ]
});

async function fixture(
 run:(data:{script:ImportedScript;scriptPath:string;source:string;
  backupDirectory:string;exportDirectory:string})=>Promise<void>,
 source=original
){
 const root=await mkdtemp(join(tmpdir(),'uah-native-export-'));
 const scriptPath=join(root,'approved.user.js');
 const backupDirectory=join(root,'backup');
 const exportDirectory=join(root,'manual');
 try{
  await mkdir(backupDirectory);
  await mkdir(exportDirectory);
  await writeFile(scriptPath,source);
  const imported=await importApprovedPaths([scriptPath]);
  assert.equal(imported.errors.length,0);
  assert.equal(imported.scripts.length,1);
  await run({script:imported.scripts[0],scriptPath,source,
   backupDirectory,exportDirectory});
 }finally{
  await rm(root,{recursive:true,force:true});
 }
}

test('TEST-014/019/020/023: native imported bytes and unique AST site produce a real independently backed-up manual export',async()=>{
 await fixture(async({script,scriptPath,source,backupDirectory,exportDirectory})=>{
  const result=await exportReviewedImportedSelectorOnly(script,scenario(script.sha256),
   observation(),{backupDirectory,exportDirectory,userApproved:true});
  assert.equal(result.status,'MANUAL_EXPORT_READY_RUNTIME_UNVERIFIED',JSON.stringify(result));
  if(result.status!=='MANUAL_EXPORT_READY_RUNTIME_UNVERIFIED')return;
  const expected=header+'const target=document.querySelector("#new");\n';
  assert.equal(await readFile(join(exportDirectory,result.exportFileName),'utf8'),expected);
  assert.equal(await readFile(join(backupDirectory,result.candidateFileName),'utf8'),expected);
  assert.equal(await readFile(join(backupDirectory,result.backupFileName),'utf8'),source);
  assert.equal(await readFile(scriptPath,'utf8'),source);
  assert.equal(result.sourceSha256,hash(source));
  assert.equal(result.candidateSha256,hash(expected));
  assert.equal(result.candidateByteLength,Buffer.byteLength(expected));
  assert.equal(result.automaticPatchAllowed,false);
  assert.equal(result.automaticRollbackAllowed,false);
  assert.equal(result.tampermonkeyVerified,false);
  assert.equal(result.managerInstalled,false);
  assert.equal(result.businessVerified,false);
  assert.equal(JSON.stringify(result).includes(scriptPath),false);
  assert.equal(JSON.stringify(result).includes('#old'),false);
 });
});

test('TEST-019/023: ambiguous, missing and unsupported AST sites leave disk unchanged',async()=>{
 for(const source of [
  header+"document.querySelector('#old');document.querySelector('#old');\n",
  header+"document.querySelector(variable);\n",
  header+"document.querySelector('#other');\n",
  header+"document.querySelector('#old') || document.querySelector('#other');\n",
  header+"const document={querySelector(){}};document.querySelector('#old');\n"
 ]){
  await fixture(async({script,backupDirectory,exportDirectory})=>{
   const response=await exportReviewedImportedSelectorOnly(script,scenario(script.sha256),
    observation(),{backupDirectory,exportDirectory,userApproved:true});
   assert.equal(response.status,'BLOCKED',JSON.stringify(response));
   assert.equal(await readdir(backupDirectory).then(v=>v.length),0);
   assert.equal(await readdir(exportDirectory).then(v=>v.length),0);
  },source);
 }
});

test('TEST-019/020/023: stale source or forged imports cannot export',async()=>{
 await fixture(async({script,scriptPath,source,backupDirectory,exportDirectory})=>{
  const options={backupDirectory,exportDirectory,userApproved:true};
  await writeFile(scriptPath,source+'// concurrent mutation\n');
  const stale=await exportReviewedImportedSelectorOnly(script,scenario(script.sha256),observation(),options);
  assert.equal(stale.status,'BLOCKED');
  assert.equal(await readdir(exportDirectory).then(v=>v.length),0);
  await writeFile(scriptPath,source);
  const forged={...script,bytes:Uint8Array.from([33,44])};
  const bad=await exportReviewedImportedSelectorOnly(forged,scenario(script.sha256),observation(),options);
  assert.equal(bad.status,'BLOCKED');
  const sourceMismatch={...script,sha256:'a'.repeat(64)};
  const badHash=await exportReviewedImportedSelectorOnly(sourceMismatch,scenario(script.sha256),observation(),options);
  assert.equal(badHash.status,'BLOCKED');
  const wrongEncoding={...script,textEncoding:'utf-8-bom'};
  const badEncoding=await exportReviewedImportedSelectorOnly(wrongEncoding,scenario(script.sha256),observation(),options);
  assert.equal(badEncoding.status,'BLOCKED');
  const fromDrop={...script};
  delete (fromDrop as {sourcePath?:string}).sourcePath;
  const rejectedDrop=await exportReviewedImportedSelectorOnly(fromDrop,scenario(script.sha256),observation(),options);
  assert.equal(rejectedDrop.status,'BLOCKED');
  assert.deepEqual(await readdir(backupDirectory),[]);
  assert.deepEqual(await readdir(exportDirectory),[]);
 });
});

test('TEST-013/019/023: invalid DOM signals, missing consent and unrelated scenarios fail without disk write',async()=>{
 await fixture(async({script,backupDirectory,exportDirectory})=>{
  const options={backupDirectory,exportDirectory,userApproved:true};
  const invalidSeries={...observation(),samples:[
   sample('2026-10-19T00:00:00Z',0,0),
   sample('2026-10-19T00:00:01Z',0,0)
  ]} as DynamicObservation;
  for(const [s,obs,opts] of [
   [scenario(script.sha256),invalidSeries,options],
   [{...scenario(script.sha256),targetUrl:'https://evil.example/'},observation(),options],
   [{...scenario(script.sha256),scriptSha256:'f'.repeat(64)},observation(),options],
   [scenario(script.sha256),observation(),{...options,userApproved:false}],
   [scenario(script.sha256),observation(),{...options,exportDirectory:backupDirectory}]
  ] as const){
   const result=await exportReviewedImportedSelectorOnly(script,s,obs,opts);
   assert.equal(result.status,'BLOCKED');
  }
  assert.deepEqual(await readdir(exportDirectory),[]);
 });
});

test('TEST-019/026: native file handoff rejects accessors and extra pathname authority',async()=>{
 await fixture(async({script,backupDirectory,exportDirectory})=>{
  const options={backupDirectory,exportDirectory,userApproved:true};
  let called=0;
  const scriptGetter={...script};
  Object.defineProperty(scriptGetter,'sourcePath',{get(){called++;throw Error('private path');}});
  const optionsGetter={...options};
  Object.defineProperty(optionsGetter,'exportDirectory',{get(){called++;throw Error('private directory');}});
  for(const [input,opts] of [
   [scriptGetter,options],[{...script,path:'C:\\secret'},options],
   [script,optionsGetter],[script,{...options,unsafeOverwrite:true}],
   [new Proxy(script,{ownKeys(){throw Error('private script')}}),options]
  ] as const){
   const out=await exportReviewedImportedSelectorOnly(input,scenario(script.sha256),observation(),opts);
   assert.equal(out.status,'BLOCKED');
   assert.equal(out.automaticPatchAllowed,false);
   assert.equal(out.businessVerified,false);
  }
  assert.equal(called,0);
  assert.deepEqual(await readdir(backupDirectory),[]);
  assert.deepEqual(await readdir(exportDirectory),[]);
 });
});

test('TEST-019/023/026: native manual export rejects accessor scenarios before touching disk',async()=>{
 await fixture(async({script,backupDirectory,exportDirectory})=>{
  let invoked=0;
  const base=scenario(script.sha256);
  const hostile={...base};
  Object.defineProperty(hostile,'userApproved',{
   enumerable:true,get(){invoked++;return true;}
  });
  const hostileRow={...base,assertions:[...base.assertions]};
  Object.defineProperty(hostileRow.assertions,'0',{
   enumerable:true,configurable:true,get(){invoked++;return base.assertions[0];}
  });
  for(const input of [hostile,hostileRow,{...base,automaticPatchAllowed:true}]){
   const result=await exportReviewedImportedSelectorOnly(
    script,input,observation(),{backupDirectory,exportDirectory,userApproved:true});
   assert.equal(result.status,'BLOCKED',JSON.stringify(result));
   assert.equal(result.automaticPatchAllowed,false);
  }
  assert.equal(invoked,0);
  assert.deepEqual(await readdir(backupDirectory),[]);
  assert.deepEqual(await readdir(exportDirectory),[]);
 });
});
