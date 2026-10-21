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
import {MAX_BATCH_PREVIEW_FILES,unavailableImportPreview,
 type ImportAnalysisPreview} from '../analyze/import-preview';
import {previewImportedBatchOffMain} from '../analyze/isolated-batch-preview';
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
// Invoke the native TypedArray byte-length getter, not a subclass override.
const NATIVE_TYPED_ARRAY_BYTE_LENGTH=Object.getOwnPropertyDescriptor(
 Object.getPrototypeOf(Uint8Array.prototype),'byteLength')?.get;


/** Bind the source bytes and ordered hashes to the SAME private native
 * snapshot. The native importer hands us Uint8Arrays, which remain mutable
 * even after their SHA-256 was checked. A later segment must not read bytes
 * modified by the caller while earlier workers/progress handlers run.
 */
function snapshotNativeScripts(scripts:readonly ImportedScript[]):BoundScript[]|null{
 try{
  // Only a native data-only batch can reach the privileged AST worker.
  // A Proxy, accessor-backed array index or custom iterator can execute
  // arbitrary JS even when the eventual hash check refuses its payload.
  if(nodeTypes.isProxy(scripts)||!Array.isArray(scripts)||
     Object.getPrototypeOf(scripts)!==Array.prototype||
     !NATIVE_TYPED_ARRAY_BYTE_LENGTH)return null;
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
 if(count>MAX_SELECTED_FILES)return Array.from({length:count},()=>unavailable('SKIPPED_BATCH_BUDGET'));
 const boundScripts=snapshotNativeScripts(scripts);
 if(!boundScripts)return Array.from({length:count},()=>unavailable('ISOLATED_ANALYSIS_FAILED'));
 if(signal?.aborted)return scripts.map(()=>unavailable('SKIPPED_CANCELLED'));
 const segmentCount=Math.ceil(count/MAX_BATCH_PREVIEW_FILES);
 const groups=Array.from({length:segmentCount},(_,index)=>{
  const offset=index*MAX_BATCH_PREVIEW_FILES;
  const list=boundScripts.slice(offset,offset+MAX_BATCH_PREVIEW_FILES);
  const hash=createHash('sha256');
  hash.update('uah-native-readonly-ast-segment-v1\0');
  hash.update(String(index));hash.update('\0');
  for(const script of list)hash.update(script.sha256);
  return {offset,list,hash:hash.digest('hex')};
 });
 const results:(ImportAnalysisPreview|null)[]=Array(count).fill(null);
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
   count:segmentCount,concurrency:1,maxAttempts:1,
   timeoutMs:SEGMENT_TIMEOUT_MS,jobHashes:groups.map(group=>group.hash)
  },async (ordinal,workerSignal)=>{
   const group=groups[ordinal];
   const previews=await previewImportedBatchOffMain(group.list,workerSignal);
   // Never promote a timed-out/cancelled result to completed work.
   if(workerSignal.aborted)return 'PERMANENT_FAILURE';
   for(let i=0;i<previews.length;i++)results[group.offset+i]=previews[i];
   processed+=group.list.length;
   try{onProgress?.(processed,count);}catch{/* no callback authority */}
   return previews.some(x=>x.status==='ISOLATED_ANALYSIS_FAILED')
    ?'PERMANENT_FAILURE':'DONE';
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
