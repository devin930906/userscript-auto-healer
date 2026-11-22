/**
 * TASK-009/012 / REQ-014/019/020/021/023 / TEST-014/019/020/023.
 *
 * Native-only handoff from an actually imported on-disk .user.js and a
 * separately authorized stable DOM observation to the existing verified
 * backup -> staged candidate -> manual export flow. Never exposed as raw IPC.
 *
 * The script bytes are untrusted: a SHA, name, AST site and metadata must
 * agree. A candidate is possible only with ONE unambiguous literal document
 * selector call. Native UI must independently pick backup/export destinations
 * and obtain explicit consent before calling this function.
 */
import {createHash} from 'node:crypto';
import {types as nodeTypes} from 'node:util';
import {basename,isAbsolute} from 'node:path';
import {analyzeSelectors} from '../analyze/selector-analyzer';
import {MAX_ANALYSIS_BYTES} from '../analyze/import-preview';
import type {ImportedScript} from '../import/import-service';
import {preflightScenario,type ScenarioInput} from '../scenarios/scenario-registry';
import {proposeFromReadOnlyDomDiagnostic} from './scenario-candidate';
import {prepareManualRepairExportOnly,type ManualRepairFlowResult}
 from './manual-repair-flow';
import type {LiteralPatchRequest} from './patch-planner';

type ImportBlockReason='INVALID_IMPORT'|'UNSUPPORTED_ENCODING'|
 'SOURCE_IDENTITY_MISMATCH'|'INVALID_SCENARIO'|
 'UNSUPPORTED_SELECTOR_SITE'|'AMBIGUOUS_SELECTOR_SITE'|
 'INVALID_NATIVE_OPTIONS'|'CANDIDATE_IDENTITY_MISMATCH'|'DOM_CANDIDATE_BLOCKED';
const noAuthority={
 automaticPatchAllowed:false as const,
 automaticRollbackAllowed:false as const,
 tampermonkeyVerified:false as const,
 managerInstalled:false as const,
 businessVerified:false as const
};
const block=(reason:ImportBlockReason)=>Object.freeze({
 status:'BLOCKED' as const,reason,...noAuthority
});
export type ImportedManualExportResult=
 ManualRepairFlowResult|ReturnType<typeof block>;
const SHA=/^[a-f0-9]{64}$/;
const FILE=/^[^\\/\u0000-\u001f]+\.user\.js$/i;

/** Own-data descriptors avoid executing getters from a forged imported file
 * or user-supplied native selection. Reject unknown capabilities rather than
 * forwarding them to the stage/export services. */
function own(input:unknown,keys:readonly string[]):Record<string,unknown>|null{
 if(!input||typeof input!=='object'||nodeTypes.isProxy(input)||
    Array.isArray(input))return null;
 const proto=Object.getPrototypeOf(input);
 if(proto!==Object.prototype&&proto!==null)return null;
 const d=Object.getOwnPropertyDescriptors(input);
 const actual=Reflect.ownKeys(d);
 if(actual.length!==keys.length||
    actual.some(k=>typeof k!=='string'||!keys.includes(k))||
    keys.some(k=>!Object.prototype.hasOwnProperty.call(d,k)||
      !Object.prototype.hasOwnProperty.call(d[k],'value')))return null;
 const out:Record<string,unknown>=Object.create(null);
 for(const k of keys)out[k]=d[k].value;
 return out;
}

/**
 * TASK-009/012 / TEST-019/020/026. The user's original bytes must be
 * snapshotted without invoking a caller-supplied iterator, Species constructor
 * or shadowed typed-array length accessor. Array.from/Uint8Array.from consult
 * Symbol.iterator; TypedArray#slice consults Symbol.species. Neither is a
 * safe byte transfer from a potentially forged native import record.
 *
 * Use the intrinsic byteLength getter to bound allocation BEFORE reading
 * the native numeric elements of a genuine (non-Proxy) byte view. The copy
 * becomes the sole source for hashing, text decoding and AST review.
 * This is a local consistency boundary, NOT permission to modify user files.
 */
function captureImportedBytes(input:unknown,claimedLength:number):Uint8Array|null{
 try{
  if(!input||typeof input!=='object'||nodeTypes.isProxy(input)||
     !(input instanceof Uint8Array))return null;
  // An own accessor or iterator is not a normal native-import byte view.
  // Reject it without invoking the overridden property.
  for(const key of ['byteLength','length','byteOffset','buffer',Symbol.iterator]){
   if(Object.getOwnPropertyDescriptor(input,key))return null;
  }
  const base=Object.getPrototypeOf(Uint8Array.prototype) as object;
  const sizeGetter=Object.getOwnPropertyDescriptor(base,'byteLength')?.get;
  if(!sizeGetter)return null;
  const trueSize:unknown=sizeGetter.call(input);
  if(typeof trueSize!=='number'||!Number.isSafeInteger(trueSize)||
     trueSize<1||trueSize>MAX_ANALYSIS_BYTES||
     trueSize!==claimedLength)return null;
  const bytes=new Uint8Array(trueSize);
  // Numeric TypedArray indexed reads use internal slots and bypass custom
  // iterators/getters. The input was confirmed non-Proxy before this point.
  for(let i=0;i<trueSize;i++)bytes[i]=input[i];
  return bytes;
 }catch{return null;}
}
interface PreparedImportedSelectorExport{
 readonly request:LiteralPatchRequest;
 readonly scenario:ScenarioInput;
 readonly sourcePath:string;
 readonly backupDirectory:string;
 readonly exportDirectory:string;
 readonly userApproved:boolean;
}
type PreparedImportedSelectorExportResult=
 |Readonly<{ok:true;value:PreparedImportedSelectorExport}>
 |Readonly<{ok:false;reason:ImportBlockReason}>;

/** Validate a native reimport and derive its exact literal patch without
 * writing files. Both ordinary and imported-batch manual exports use this
 * snapshot before entering the existing backup/checkpoint/export flow. */
function prepareImportedSelectorExport(
 untrustedImported:unknown,untrustedScenario:unknown,
 untrustedNativeOptions:unknown
):PreparedImportedSelectorExportResult{
 try{
  const script=own(untrustedImported,[
   'filename','bytes','byteLength','sha256','textEncoding','sourcePath'
  ]);
  if(!script||typeof script.filename!=='string'||
     !FILE.test(script.filename)||typeof script.sha256!=='string'||
     !SHA.test(script.sha256)||
     typeof script.sourcePath!=='string'||script.sourcePath.length===0||
     script.sourcePath.length>4096||script.sourcePath.includes('\0')||
     !isAbsolute(script.sourcePath)||
     // Content identity alone does not bind a different same-byte file to
     // the filename shown to the user for this native import.
     basename(script.sourcePath)!==script.filename||
     typeof script.byteLength!=='number'||
     !Number.isSafeInteger(script.byteLength)||
     script.byteLength<1||script.byteLength>MAX_ANALYSIS_BYTES)
   return Object.freeze({ok:false as const,reason:'INVALID_IMPORT' as const});
  // A non-UTF8 source has a different bytes-hash from the UTF8 AST string.
  // Never substitute the decoded text for the native on-disk fingerprint.
  if(script.textEncoding!=='utf-8')
   return Object.freeze({ok:false as const,reason:'UNSUPPORTED_ENCODING' as const});
  const bytes=captureImportedBytes(script.bytes,script.byteLength);
  if(!bytes)return Object.freeze({ok:false as const,reason:'INVALID_IMPORT' as const});
  if(createHash('sha256').update(bytes).digest('hex')!==script.sha256)
   return Object.freeze({ok:false as const,reason:'SOURCE_IDENTITY_MISMATCH' as const});
  const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(Buffer.byteLength(source,'utf8')!==bytes.length)
   return Object.freeze({ok:false as const,reason:'SOURCE_IDENTITY_MISMATCH' as const});

  const opts=own(untrustedNativeOptions,[
   'backupDirectory','exportDirectory','userApproved'
  ]);
  if(!opts||typeof opts.backupDirectory!=='string'||
     typeof opts.exportDirectory!=='string'||
     typeof opts.userApproved!=='boolean')
   return Object.freeze({ok:false as const,reason:'INVALID_NATIVE_OPTIONS' as const});
  // Reuse the strict native scenario contract before any property access.
  // A result is a normalized data-only copy; getters, sparse assertion arrays
  // and undeclared capability fields must not reach disk staging.
  const checked=preflightScenario(untrustedScenario as ScenarioInput);
  const scenario=checked.input;
  if(checked.state!=='READY_TO_TEST'||
     scenario.userApproved!==true||scenario.requiresLogin!==false||
     scenario.scriptSha256!==script.sha256||
     !Array.isArray(scenario.steps)||scenario.steps.length!==0||
     !Array.isArray(scenario.assertions)||scenario.assertions.length!==2||
     scenario.assertions[0]?.kind!=='selector-present'||
     scenario.assertions[1]?.kind!=='selector-present'||
     typeof scenario.assertions[0].selector!=='string'||
     typeof scenario.assertions[1].selector!=='string'||
     scenario.assertions[0].selector===scenario.assertions[1].selector)
   return Object.freeze({ok:false as const,reason:'INVALID_SCENARIO' as const});

  const analysis=analyzeSelectors(source);
  if(analysis.status!=='OK')
   return Object.freeze({ok:false as const,reason:'UNSUPPORTED_SELECTOR_SITE' as const});
  const oldSelector=scenario.assertions[0].selector;
  const nextSelector=scenario.assertions[1].selector;
  const exactId=/^#[A-Za-z_][A-Za-z0-9_-]{0,127}$/;
  const matches=analysis.sites.filter(site=>
   site.kind==='literal'&&site.fallbackGroup===null&&(
    ((site.method==='querySelector'||site.method==='querySelectorAll')&&
     site.selector===oldSelector)||
    // DOM assertions remain CSS selectors (#id); getElementById takes "id".
    (site.method==='getElementById'&&exactId.test(oldSelector)&&
     exactId.test(nextSelector)&&site.selector===oldSelector.slice(1))
   ));
  if(matches.length!==1)return Object.freeze({ok:false as const,reason:
   matches.length>1?'AMBIGUOUS_SELECTOR_SITE':'UNSUPPORTED_SELECTOR_SITE'});
  const match=matches[0];
  const request:LiteralPatchRequest={
   source,expectedSourceSha256:script.sha256,
   callOffset:match.offset,
   method:match.method as LiteralPatchRequest['method'],
   originalSelector:scenario.assertions[0].selector,
   replacementSelector:scenario.assertions[1].selector,
   faultEvidenceId:'scenario_assertion_1'
  };
  return Object.freeze({ok:true as const,value:Object.freeze({request,scenario,
   sourcePath:script.sourcePath,backupDirectory:opts.backupDirectory,
   exportDirectory:opts.exportDirectory,userApproved:opts.userApproved})});
 }catch{return Object.freeze({ok:false as const,reason:'INVALID_IMPORT' as const});}
}

/** This only processes paths obtained by a privileged native on-disk import.
 * Dropped bytes have no sourcePath and cannot be silently used as a writable
 * source. The original is NEVER changed, even when export succeeds. */
export async function exportReviewedImportedSelectorOnly(
 untrustedImported:unknown,untrustedScenario:unknown,
 untrustedDomSamples:unknown,untrustedNativeOptions:unknown
):Promise<ImportedManualExportResult>{
 const prepared=prepareImportedSelectorExport(
  untrustedImported,untrustedScenario,untrustedNativeOptions);
 if(!prepared.ok)return block(prepared.reason);
 const {request,scenario,sourcePath,backupDirectory,exportDirectory,userApproved}=
  prepared.value;
 return await prepareManualRepairExportOnly(request,scenario,untrustedDomSamples,{
  sourcePath,backupDirectory,exportDirectory,userApproved
 });
}

/** Reuse the same strict imported-byte and native path validation, then
 * compare the manual export's pure DOM/AST candidate hash with the exact hash
 * shown in the batch preview BEFORE any backup or candidate file is staged. */
export async function exportReviewedImportedCandidateOnly(
 untrustedImported:unknown,untrustedContext:unknown,untrustedNativeOptions:unknown
):Promise<ImportedManualExportResult>{
 try{
  const context=own(untrustedContext,[
   'scenario','domSamples','originalSha256','candidateSha256'
  ]);
  if(!context||typeof context.originalSha256!=='string'||
     !SHA.test(context.originalSha256)||typeof context.candidateSha256!=='string'||
     !SHA.test(context.candidateSha256))return block('INVALID_SCENARIO');
  const prepared=prepareImportedSelectorExport(untrustedImported,
   context.scenario,untrustedNativeOptions);
  if(!prepared.ok)return block(prepared.reason);
  const {request,scenario,sourcePath,backupDirectory,exportDirectory,userApproved}=
   prepared.value;
  if(request.expectedSourceSha256!==context.originalSha256)
   return block('SOURCE_IDENTITY_MISMATCH');
  const reviewed=proposeFromReadOnlyDomDiagnostic(
   request,scenario,context.domSamples,true);
  if(reviewed.status!=='CANDIDATE_ONLY')return block('DOM_CANDIDATE_BLOCKED');
  if(reviewed.originalSha256!==context.originalSha256||
     reviewed.candidateSha256!==context.candidateSha256)
   return block('CANDIDATE_IDENTITY_MISMATCH');
  return await prepareManualRepairExportOnly(request,scenario,context.domSamples,{
   sourcePath,backupDirectory,exportDirectory,userApproved
  });
 }catch{
  // Never surface source, URL, path, selector, native error details or traces.
  return block('INVALID_SCENARIO');
 }
}
