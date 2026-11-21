import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {proposeImportedDomCandidate} from '../../src/repair/imported-dom-candidate';
import type {DynamicObservation} from '../../src/observe/dom-observer';

const source=[
 '// ==UserScript==',
 '// @name bounded candidate fixture',
 '// @match https://example.org/*',
 '// @grant none',
 '// ==/UserScript==',
 'document.querySelector("#old-submit");',
 'document.querySelector("#new-submit");',
 ''
].join('\n');
const sha=createHash('sha256').update(source,'utf8').digest('hex');
const sample=(observedAt:string,oldCount=0,newCount=1,iframeCount=0)=>({
 ok:true as const,status:'LIMITED_DOM_OBSERVATION' as const,
 observedAt,originMatchesApproved:true as const,routeChanged:false,
 summary:{elementCount:Math.max(oldCount,newCount),iframeCount,visibleShadowRoots:0,
  blindSpots:[] as ('IFRAME_CONTENT_UNVERIFIED'|'CLOSED_SHADOW_ROOT_UNKNOWN'|'CROSS_ORIGIN_FRAME_UNVERIFIED')[]},
 selectorCounts:{'#old-submit':oldCount,'#new-submit':newCount},
 fullPageVerified:false as const,userscriptVerified:false as const
});
const observation=(oldCounts:[number,number,number]=[0,0,0],
 newCounts:[number,number,number]=[1,1,1],iframeCount=0):DynamicObservation=>({
 ok:true,status:'LIMITED_DYNAMIC_OBSERVATION',userscriptVerified:false,
 routeChangeDetected:false,selectorCountChanged:false,domCountChanged:false,
 samples:[sample('2026-11-20T00:00:00.000Z',oldCounts[0],newCounts[0],iframeCount),
  sample('2026-11-20T00:00:01.000Z',oldCounts[1],newCounts[1],iframeCount),
  sample('2026-11-20T00:00:02.000Z',oldCounts[2],newCounts[2],iframeCount)]
});
const request=(patch:Record<string,unknown>={})=>({
 source,expectedSourceSha256:sha,targetUrl:'https://example.org/app',
 observation:observation(),nativeConsent:true,...patch
});

test('TASK-013/TEST-022: one missing and one present literal selector yields a local-only candidate',()=>{
 const result=proposeImportedDomCandidate(request());
 assert.equal(result.status,'CANDIDATE_ONLY',JSON.stringify(result));
 if(result.status!=='CANDIDATE_ONLY')return;
 assert.equal(result.originalSha256,sha);
 assert.equal(result.change.before,'"#old-submit"');
 assert.equal(result.change.after,'"#new-submit"');
 assert.match(result.candidateSource,/querySelector\("#new-submit"\)/);
 assert.equal(result.automaticPatchAllowed,false);
 assert.equal(result.tampermonkeyVerified,false);
 assert.equal(result.businessVerified,false);
});

test('TASK-013/TEST-022/026: reversed selector counts still select the unique missing site',()=>{
 const result=proposeImportedDomCandidate(request({
  observation:observation([1,1,1],[0,0,0])
 }));
 assert.equal(result.status,'CANDIDATE_ONLY',JSON.stringify(result));
 if(result.status==='CANDIDATE_ONLY'){
  assert.equal(result.change.before,'"#new-submit"');
  assert.equal(result.change.after,'"#old-submit"');
 }
});

test('TASK-013/TEST-022/026: stale identity, missing consent and non-UTF8 sources fail closed',()=>{
 assert.deepEqual(proposeImportedDomCandidate(request({
  expectedSourceSha256:'a'.repeat(64)
 })),{
  status:'BLOCKED',reason:'SOURCE_IDENTITY_MISMATCH',automaticPatchAllowed:false,
  tampermonkeyVerified:false,businessVerified:false
 });
 const blocked=proposeImportedDomCandidate(request({nativeConsent:false}));
 assert.equal(blocked.status,'BLOCKED');
 if(blocked.status==='BLOCKED')assert.equal(blocked.reason,'NOT_AUTHORIZED');
 for(const invalidSource of ['\uFEFF'+source,source+'// \uD800\n']){
  const invalidHash=createHash('sha256').update(invalidSource,'utf8').digest('hex');
  const invalid=proposeImportedDomCandidate(request({source:invalidSource,
   expectedSourceSha256:invalidHash}));
  assert.equal(invalid.status,'BLOCKED','BOM and malformed UTF-8 strings are ineligible');
  if(invalid.status==='BLOCKED')assert.equal(invalid.reason,'INVALID_UTF8_SOURCE');
 }
});

test('TASK-013/TEST-022: ambiguous source/metadata and unstable DOM never make a candidate',()=>{
 const threeSites=source+'document.querySelector("#other");\n';
 const nestedSelector=source.replace('document.querySelector("#old-submit");',
  'function delayed(){ document.querySelector("#old-submit"); }');
 const dynamicSelector=source+'const method="querySelector"; document[method]("#dynamic");\n';
 const wrongGrant=source.replace('// @grant none','// @grant GM_xmlhttpRequest');
 const staleDom=observation([0,0,1],[1,1,1]);
 const incompleteDom=observation([0,0,0],[1,1,1],1);
 for(const input of [
  request({source:threeSites,expectedSourceSha256:createHash('sha256').update(threeSites,'utf8').digest('hex')}),
  request({source:nestedSelector,expectedSourceSha256:createHash('sha256').update(nestedSelector,'utf8').digest('hex')}),
  request({source:dynamicSelector,expectedSourceSha256:createHash('sha256').update(dynamicSelector,'utf8').digest('hex')}),
  request({source:wrongGrant,expectedSourceSha256:createHash('sha256').update(wrongGrant,'utf8').digest('hex')}),
  request({observation:staleDom}),
  request({observation:incompleteDom})
 ])assert.equal(proposeImportedDomCandidate(input).status,'BLOCKED');
});

test('TASK-013/TEST-022/026: conditional and non-Document alternatives cannot justify a candidate',()=>{
 const cases=[
  ['selector nested in a top-level branch',source.replace(
   'document.querySelector("#old-submit");',
   'if (false) { document.querySelector("#old-submit"); }')],
  ['selector nested in a conditional expression',source.replace(
   'document.querySelector("#old-submit");\ndocument.querySelector("#new-submit");',
   'true ? document.querySelector("#old-submit") : document.querySelector("#new-submit");')],
  ['alternative selector called on another receiver',source.replace(
   'document.querySelector("#new-submit");',
   'widget.querySelector("#new-submit");')],
  ['alternative selector call has extra arguments',source.replace(
   'document.querySelector("#new-submit");',
   'document.querySelector("#new-submit", {});')]
 ] as const;
 for(const [label,candidateSource] of cases){
  const candidateSha=createHash('sha256').update(candidateSource,'utf8').digest('hex');
  const result=proposeImportedDomCandidate(request({source:candidateSource,
   expectedSourceSha256:candidateSha}));
  assert.equal(result.status,'BLOCKED',label);
 }
});
