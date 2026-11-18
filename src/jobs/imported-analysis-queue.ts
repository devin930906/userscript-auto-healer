/** TASK-013 / REQ-022 / TEST-022: actual, native-imported, read-only AST
 * processing through the bounded batch coordinator. This is a scheduling
 * stage only: it never persists source, modifies a userscript, evaluates JS,
 * verifies Tampermonkey, or grants repair/rollback privileges. An import
 * resume across process restarts still requires a separate trusted workflow.
 */
import {createHash} from 'node:crypto';
import {types as nodeTypes} from 'node:util';
import {MAX_SCRIPT_BYTES,MAX_TOTAL_IMPORTED_BYTES,MAX_SELECTED_FILES,
 type ImportedScript} from '../import/import-service';
import {MAX_BATCH_PREVIEW_FILES,MAX_BATCH_PREVIEW_BYTES,
 MAX_ISOLATED_ANALYSIS_BYTES,unavailableImportPreview,
 type ImportAnalysisPreview} from '../analyze/import-preview';
import {previewImportedBatchOffMain,type IsolatedBatchPreviewResult} from '../analyze/isolated-batch-preview';
import {ReadOnlyBatchCoordinator} from './batch-coordinator';

const GLOBAL_ANALYSIS_DEADLINE_MS=120000;
const SEGMENT_TIMEOUT_MS=12000;
const SHA256=/^[0-9a-f]{64}$/;
const ENCODINGS=new Set<ImportedScript['textEncoding']>([
 'utf-8','utf-8-bom','utf-16le-bom','utf-16be-bom','gb18030-explicit'
]);
const unavailable=(status:'SKIPPED_CANCELLED'|'SKIPPED_BATCH_BUDGET'|
 'ISOLATED_ANALYSIS_FAILED')=>unavailableImportPreview(status,'NOT_CHECKED');

type BoundScript=Readonly<Pick<ImportedScript,'bytes'|'sha256'|'textEncoding'>>;
// Invoke native TypedArray internal-slot getters, not caller-owned accessors.
const NATIVE_TYPED_ARRAY_BYTE_LENGTH=Object.getOwnPropertyDescriptor(
 Object.getPrototypeOf(Uint8Array.prototype),'byteLength')?.get;
const NATIVE_TYPED_ARRAY_BUFFER=Object.getOwnPropertyDescriptor(
 Object.getPrototypeOf(Uint8Array.prototype),'buffer')?.get;

/** A cancellation handle is a privileged control surface, not an arbitrary
 * object with an aborted property. Reject proxies, accessors and shadowed
 * event methods before any callback or getter can execute caller code.
 */
function isNativeCancellationSignal(value:unknown):value is AbortSignal{
 try{
  if(!value||typeof value!=='object'||nodeTypes.isProxy(value)||
     Object.getPrototypeOf(value)!==AbortSignal.prototype||
     ['aborted','addEventListener','removeEventListener'].some(key=>
       Object.prototype.hasOwnProperty.call(value,key)))return false;
  const getter=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted')?.get;
  return typeof getter==='function'&&typeof getter.call(value)==='boolean';
 }catch{return false;}
}


/** Bind the source bytes and ordered hashes to the SAME private native
 * snapshot. The native importer hands us Uint8Arrays, which remain mutable
 * even after their SHA-256 was checked. A later segment must not read bytes
 * modified by the caller while earlier workers/progress handlers run.
 */
export function snapshotNativeScripts(scripts:readonly ImportedScript[]):BoundScript[]|null{
 try{
  // Only a native data-only batch can reach the privileged AST worker.
  // A Proxy, accessor-backed array index or custom iterator can execute
  // arbitrary JS even when the eventual hash check refuses its payload.
  if(nodeTypes.isProxy(scripts)||!Array.isArray(scripts)||
     Object.getPrototypeOf(scripts)!==Array.prototype||
     !NATIVE_TYPED_ARRAY_BYTE_LENGTH||!NATIVE_TYPED_ARRAY_BUFFER)return null;
  const slots=Object.getOwnPropertyDescriptors(scripts);
  if(Reflect.ownKeys(slots).length!==scripts.length+1)return null;
  const seen=new Set<string>();
  const copies:BoundScript[]=[];
  let totalBytes=0;
  for(let i=0;i<scripts.length;i++){
   const slot=slots[String(i)];
   if(!slot||!Object.prototype.hasOwnProperty.call(slot,'value'))return null;
   const item:unknown=slot.value;
   if(!item||typeof item!=='object'||nodeTypes.isProxy(item)||
      Object.getPrototypeOf(item)!==Object.prototype)return null;
   const fields=Object.getOwnPropertyDescriptors(item);
   if(['bytes','sha256','byteLength','textEncoding'].some(key=>
       !fields[key]||!Object.prototype.hasOwnProperty.call(fields[key],'value')))
    return null;
   const original:unknown=fields.bytes.value;
   const sha:unknown=fields.sha256.value;
   const encoding:unknown=fields.textEncoding.value;
   const claimedByteLength:unknown=fields.byteLength.value;
   if(!original||typeof original!=='object'||nodeTypes.isProxy(original)||
      !(original instanceof Uint8Array))return null;
   // A SharedArrayBuffer may be mutated simultaneously from another thread.
   // Enforce the same non-shared source boundary as isolated-batch-preview.
   // Read the native internal slot: never invoke a caller-owned .buffer getter.
   if(nodeTypes.isSharedArrayBuffer(NATIVE_TYPED_ARRAY_BUFFER.call(original)))
     return null;
   const actualByteLength=NATIVE_TYPED_ARRAY_BYTE_LENGTH.call(original) as number;
   if(!Number.isSafeInteger(claimedByteLength)||
      claimedByteLength!==actualByteLength||
      actualByteLength>MAX_SCRIPT_BYTES||
      totalBytes+actualByteLength>MAX_TOTAL_IMPORTED_BYTES||
      typeof sha!=='string'||!SHA256.test(sha)||
      !ENCODINGS.has(encoding as ImportedScript['textEncoding'])||
      seen.has(sha))return null;
   // A native TypedArray constructor copies bytes through internal slots:
   // unlike Uint8Array.from, it cannot execute an overridden iterator.
   // A concurrent external mutation cannot replace the validated copy.
   const bytes=new Uint8Array(original);
   if(createHash('sha256').update(bytes).digest('hex')!==sha)return null;
   totalBytes+=bytes.byteLength;
   seen.add(sha);
   copies.push(Object.freeze({bytes,sha256:sha,
     textEncoding:encoding as ImportedScript['textEncoding']}));
  }
  return copies;
 }catch{return null;}
}

/** A worker lifecycle receipt is required before dispatching another worker.
 * A legacy array-only result has no retirement evidence and therefore fails
 * closed; the opt-in structured API supplies the required boolean. */
function readWorkerResult(value:unknown):IsolatedBatchPreviewResult|null{
 try{
  if(!value||typeof value!=='object'||nodeTypes.isProxy(value)||Array.isArray(value))
   return null;
  const fields=Object.getOwnPropertyDescriptors(value);
  const names=Reflect.ownKeys(fields);
  if(names.length!==2||
     !Object.prototype.hasOwnProperty.call(fields,'previews')||
     !Object.prototype.hasOwnProperty.call(fields,'safeToContinue')||
     !Object.prototype.hasOwnProperty.call(fields.previews,'value')||
     !Object.prototype.hasOwnProperty.call(fields.safeToContinue,'value')||
     !Array.isArray(fields.previews.value)||
     typeof fields.safeToContinue.value!=='boolean')return null;
  return {previews:fields.previews.value as ImportAnalysisPreview[],
   safeToContinue:fields.safeToContinue.value};
 }catch{return null;}
}

/** Only explicitly native-imported byte identities can enter this worker.
 * The 16-file isolated AST worker is the actual trusted read-only task;
 * one scheduler job owns one segment. No raw bytes or paths reach progress.
 * A failed worker stays unverified, never a repaired or business-tested job.
 */
export async function runImportedReadOnlyAnalysisQueue(
 scripts:readonly ImportedScript[],signal?:AbortSignal,
 onProgress?:(processed:number,total:number)=>void
):Promise<ImportAnalysisPreview[]>{
 // A hostile batch Proxy must not be consulted even for its length.
 if(nodeTypes.isProxy(scripts)||!Array.isArray(scripts))return [];
 const count=scripts.length;
 if(count===0)return [];
 // Do not allocate per-slot placeholders for an invalid, potentially huge
 // caller-controlled array length. The native importer permits at most 1000.
 if(count>MAX_SELECTED_FILES)return [];
 // Validate the native AbortSignal before reading aborted or subscribing to
 // events. An invalid direct caller has no scheduling authority.
 if(signal!==undefined&&!isNativeCancellationSignal(signal))
  return Array.from({length:count},()=>unavailable('ISOLATED_ANALYSIS_FAILED'));
 const boundScripts=snapshotNativeScripts(scripts);
 if(!boundScripts)return Array.from({length:count},()=>unavailable('ISOLATED_ANALYSIS_FAILED'));
 // Do not call the caller's Array.prototype.map: an already-aborted native
 // request still must avoid globally replaced/injected array methods.
 if(signal?.aborted)return Array.from({length:count},()=>unavailable('SKIPPED_CANCELLED'));
 // Each isolated Worker has TWO independent budgets: up to 16 files
 // and up to 1 MiB of eligible AST bytes. Count-only partitions let an
 // early large script starve later valid scripts in the same segment.
 // Scripts over the per-file ceiling are reported as SKIPPED_TOO_LARGE
 // by the Worker and must not consume its eligible AST byte budget.
 const groups:{offset:number;list:BoundScript[];hash:string}[]=[];
 for(let offset=0;offset<count;){
  let end=offset;
  let eligibleBytes=0;
  while(end<count&&end-offset<MAX_BATCH_PREVIEW_FILES){
   const size=boundScripts[end].bytes.byteLength;
   const charge=size<=MAX_ISOLATED_ANALYSIS_BYTES?size:0;
   if(end>offset&&eligibleBytes+charge>MAX_BATCH_PREVIEW_BYTES)break;
   eligibleBytes+=charge;
   end++;
  }
  const list=boundScripts.slice(offset,end);
  const hash=createHash('sha256');
  hash.update('uah-native-readonly-ast-segment-v1\0');
  hash.update(String(groups.length));hash.update('\0');
  for(const script of list)hash.update(script.sha256);
  groups.push({offset,list,hash:hash.digest('hex')});
  offset=end;
 }
 const segmentCount=groups.length;
 const results:(ImportAnalysisPreview|null)[]=Array(count).fill(null);
 // A transient isolated Worker failure is retryable once, but neither
 // retries nor a malformed reply may double-count completed script slots.
 const attempts:number[]=Array(segmentCount).fill(0);
 // A Worker that did not retire within its original deadline may still be
 // alive. Stop this whole batch before retrying it or starting later segments.
 let safeToLaunchWorkers=true;
 const parent=new AbortController();
 const cancel=()=>parent.abort();
 signal?.addEventListener('abort',cancel,{once:true});
 // A global analysis budget expiry is not a user cancellation. Keep
 // the source explicit so all unprocessed segments retain the right status.
 let deadlineExpired=false;
 const deadline=setTimeout(()=>{
  deadlineExpired=true;
  cancel();
 },GLOBAL_ANALYSIS_DEADLINE_MS);
 if(signal?.aborted)cancel();
 let processed=0;
 try{
  const coordinator=new ReadOnlyBatchCoordinator({
   count:segmentCount,concurrency:1,maxAttempts:2,
   timeoutMs:SEGMENT_TIMEOUT_MS,jobHashes:groups.map(group=>group.hash)
  },async (ordinal,workerSignal)=>{
   if(!safeToLaunchWorkers)return 'PERMANENT_FAILURE';
   const group=groups[ordinal];
   const attempt=++attempts[ordinal];
   let previews:ImportAnalysisPreview[]=[];
   try{
    const value=await previewImportedBatchOffMain(group.list,workerSignal,
     undefined,true);
    const evidence=readWorkerResult(value);
    if(!evidence){safeToLaunchWorkers=false;return 'PERMANENT_FAILURE';}
    previews=evidence.previews;
    if(!evidence.safeToContinue)safeToLaunchWorkers=false;
   }catch{
    // A thrown call has no retirement receipt. Do not risk overlapping a
    // replacement Worker with one that may still be running.
    safeToLaunchWorkers=false;
   }
   // Cancellation and timeouts never start a replacement Worker.
   if(workerSignal.aborted)return 'PERMANENT_FAILURE';
  if(!safeToLaunchWorkers)return 'PERMANENT_FAILURE';
   const failed=previews.length!==group.list.length||
    previews.some(x=>x.status==='ISOLATED_ANALYSIS_FAILED');
   const exhausted=previews.some(x=>
    x.status==='SKIPPED_CANCELLED'||x.status==='SKIPPED_BATCH_BUDGET');
  if(failed&&!exhausted&&safeToLaunchWorkers&&attempt<2)
   return 'RETRYABLE_FAILURE';
   // Reject the entire malformed/failed segment, not just its supplied
   // prefix. A later segment can still produce independent AST evidence.
   if(!failed){
    for(let i=0;i<previews.length;i++)results[group.offset+i]=previews[i];
   }
   processed+=group.list.length;
   try{onProgress?.(processed,count);}catch{/* no callback authority */}
   return failed?'PERMANENT_FAILURE':'DONE';
  });
  if(parent.signal.aborted)coordinator.cancel();
  const onAbort=()=>coordinator.cancel();
  parent.signal.addEventListener('abort',onAbort,{once:true});
  try{await coordinator.run();}
  finally{parent.signal.removeEventListener('abort',onAbort);}
 }finally{
  clearTimeout(deadline);
  signal?.removeEventListener('abort',cancel);
 }
 return results.map(value=>value??unavailable(
  signal?.aborted?'SKIPPED_CANCELLED':
  deadlineExpired?'SKIPPED_BATCH_BUDGET':'ISOLATED_ANALYSIS_FAILED'
 ));
}
