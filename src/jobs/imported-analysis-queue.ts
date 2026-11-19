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
import {acquireNativeAstWorkerLease,previewImportedBatchOffMain,
 releaseNativeAstWorkerLease,validateIsolatedBatchPreviewResult,
 MAX_TOTAL_PREVIEW_MS,
 type IsolatedBatchPreviewResult,
 type NativeAstWorkerLease} from '../analyze/isolated-batch-preview';
import {ReadOnlyBatchCoordinator} from './batch-coordinator';

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
function readWorkerResult(value:unknown,count:number):IsolatedBatchPreviewResult|null{
 return validateIsolatedBatchPreviewResult(value,count);
}
type WorkerTaskOutcome<T>=
 |Readonly<{status:'FULFILLED';value:T;settledAt:number}>
 |Readonly<{status:'REJECTED'}>
 |Readonly<{status:'TIMED_OUT'}>;
/** Adapter Promises are expected to settle when their AbortSignal is aborted,
 * but the scheduler must stay bounded if a broken adapter ignores it. The
 * worker lease is poisoned when this limit expires, so a late task can never
 * authorize a replacement Worker. */
async function waitForWorkerTask<T>(task:Promise<T>,deadlineAt:number):Promise<WorkerTaskOutcome<T>>{
 const settled=task.then(
  value=>({status:'FULFILLED' as const,value,settledAt:performance.now()}),
  ()=>({status:'REJECTED' as const})
 );
 const remaining=Math.min(10000,Math.max(0,deadlineAt-performance.now()));
 let timer:NodeJS.Timeout|undefined;
 const timedOut=new Promise<Readonly<{status:'TIMED_OUT'}>>(resolve=>{
  if(remaining<=0)queueMicrotask(()=>resolve({status:'TIMED_OUT'}));
  else timer=setTimeout(()=>resolve({status:'TIMED_OUT'}),remaining);
 });
 try{return await Promise.race([settled,timedOut]);}
 finally{if(timer)clearTimeout(timer);}
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
 const needsRecovery:boolean[]=Array(segmentCount).fill(false);
  const deadlineAt=performance.now()+MAX_TOTAL_PREVIEW_MS;
 // A Worker that did not retire within its original deadline may still be
 // alive. Stop this whole batch before retrying it or starting later segments.
 let safeToLaunchWorkers=true;
 const stopWorkers=()=>{
  safeToLaunchWorkers=false;
 };
  const parent=new AbortController();
  let stopReason:'CANCELLED'|'BUDGET'|null=null;
  let deadlineExpired=false;
  const cancel=()=>{
   if(stopReason===null){
    if(performance.now()>=deadlineAt){
     stopReason='BUDGET';
     deadlineExpired=true;
    }else stopReason='CANCELLED';
   }
   parent.abort();
  };
  const cancelForBudget=()=>{
   if(stopReason===null)stopReason='BUDGET';
   deadlineExpired=true;
   parent.abort();
  };
  // A global analysis budget expiry is not a user cancellation. Keep
  // the source explicit so all unprocessed segments retain the right status.
 const expireDeadlineIfNeeded=()=>{
   if(!deadlineExpired&&!signal?.aborted&&performance.now()>=deadlineAt){
    cancelForBudget();
  }
  return deadlineExpired;
 };
 let deadline:NodeJS.Timeout|undefined;
  let processed=0;
 const inFlightWorkers=new Set<Promise<unknown>>();
  let unretiredTasksDetected=false;
  let allowSingleFileRecovery=true;
  // Acquire only after all synchronous hashing/allocation, and enter the
  // release-protected region immediately so setup failures cannot strand it.
  const acquisition=acquireNativeAstWorkerLease();
  if(acquisition.status!=='ACQUIRED')
   return Array.from({length:count},()=>unavailable('ISOLATED_ANALYSIS_FAILED'));
  const lease:NativeAstWorkerLease=acquisition.lease;
 try{
  signal?.addEventListener('abort',cancel,{once:true});
  deadline=setTimeout(()=>{
   if(!signal?.aborted)cancelForBudget();
  },Math.max(0,deadlineAt-performance.now()));
  if(signal?.aborted)cancel();
  expireDeadlineIfNeeded();
  const coordinator=new ReadOnlyBatchCoordinator({
   count:segmentCount,concurrency:1,maxAttempts:2,
   timeoutMs:SEGMENT_TIMEOUT_MS,jobHashes:groups.map(group=>group.hash)
  },async (ordinal,workerSignal)=>{
   if(expireDeadlineIfNeeded()||workerSignal.aborted||!safeToLaunchWorkers)
    return 'PERMANENT_FAILURE';
   const group=groups[ordinal];
   const attempt=++attempts[ordinal];
   let previews:ImportAnalysisPreview[]=[];
   let task:Promise<unknown>|undefined;
    let taskSettled=false;
   try{
    task=previewImportedBatchOffMain(group.list,workerSignal,
     undefined,true,lease,deadlineAt);
    inFlightWorkers.add(task);
     const awaited=await waitForWorkerTask(task,deadlineAt);
     if(awaited.status==='TIMED_OUT'){
      if(!signal?.aborted&&performance.now()>=deadlineAt)
       expireDeadlineIfNeeded();
      stopWorkers();
      unretiredTasksDetected=true;
      return 'PERMANENT_FAILURE';
     }
     taskSettled=true;
     if(awaited.status==='REJECTED'){
      stopWorkers();
      return 'PERMANENT_FAILURE';
     }
     const value=awaited.value;
    const evidence=readWorkerResult(value,group.list.length);
    if(!evidence){stopWorkers();return 'PERMANENT_FAILURE';}
    previews=evidence.previews;
    if(!evidence.safeToContinue)stopWorkers();
    if(expireDeadlineIfNeeded())return 'PERMANENT_FAILURE';
   }catch{
    // A thrown call has no retirement receipt. Do not risk overlapping a
    // replacement Worker with one that may still be running.
    stopWorkers();
   }finally{
     if(task&&taskSettled)inFlightWorkers.delete(task);
   }
   // Cancellation and timeouts never start a replacement Worker.
   if(workerSignal.aborted)return 'PERMANENT_FAILURE';
   if(!safeToLaunchWorkers)return 'PERMANENT_FAILURE';
   const failed=previews.length!==group.list.length||
    previews.some(x=>x.status==='ISOLATED_ANALYSIS_FAILED');
   const exhausted=previews.some(x=>
    x.status==='SKIPPED_CANCELLED'||x.status==='SKIPPED_BATCH_BUDGET');
   if(failed&&!exhausted&&attempt<2)return 'RETRYABLE_FAILURE';
   if(failed&&!exhausted&&attempt>=2)needsRecovery[ordinal]=true;
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
  // The coordinator may return on its own timeout while an adapter Promise
  // still owns an unretired Worker. Never enter single-file recovery then.
  if(inFlightWorkers.size>0){
    allowSingleFileRecovery=false;
  }
  // A failed multi-file segment may hide independently analyzable scripts.
  // Re-import each already-snapshotted byte record through a fresh one-file
  // Worker, within the same global signal/deadline and original Worker limit.
  // The checkpointed scheduler is not involved and no source is written.
  for(let ordinal=0;ordinal<groups.length&&safeToLaunchWorkers&&allowSingleFileRecovery&&
      !parent.signal.aborted;ordinal++){
   if(expireDeadlineIfNeeded())break;
   const group=groups[ordinal];
   if(!needsRecovery[ordinal]||group.list.length<2)continue;
   for(let index=0;index<group.list.length;index++){
    if(parent.signal.aborted||expireDeadlineIfNeeded())break;
    let task:Promise<unknown>|undefined;
    let taskSettled=false;
    try{
     task=previewImportedBatchOffMain([group.list[index]],
      parent.signal,undefined,true,lease,deadlineAt);
     inFlightWorkers.add(task);
     const awaited=await waitForWorkerTask(task,deadlineAt);
     if(awaited.status==='TIMED_OUT'){
       if(!signal?.aborted&&performance.now()>=deadlineAt)
        expireDeadlineIfNeeded();
      stopWorkers();
      unretiredTasksDetected=true;
       results[group.offset+index]=unavailable(
        stopReason==='BUDGET'?'SKIPPED_BATCH_BUDGET':
        stopReason==='CANCELLED'?'SKIPPED_CANCELLED':'ISOLATED_ANALYSIS_FAILED');
       break;
     }
     taskSettled=true;
     if(awaited.status==='REJECTED'){
      stopWorkers();
       break;
     }
     const value=awaited.value;
     const evidence=readWorkerResult(value,1);
     if(!evidence||!evidence.safeToContinue){
      stopWorkers();
      break;
     }
     if(evidence.previews.length!==1){
      results[group.offset+index]=unavailable('ISOLATED_ANALYSIS_FAILED');
      continue;
     }
     let report=evidence.previews[0];
      if(awaited.settledAt>=deadlineAt){
       if(stopReason===null&&!signal?.aborted)expireDeadlineIfNeeded();
       if(stopReason==='BUDGET')
        report=unavailable('SKIPPED_BATCH_BUDGET');
      }
      if(stopReason==='BUDGET'&&report.status==='SKIPPED_CANCELLED')
      report=unavailable('SKIPPED_BATCH_BUDGET');
     results[group.offset+index]=report;
     if(report.status==='SKIPPED_CANCELLED'||
        report.status==='SKIPPED_BATCH_BUDGET')break;
    }catch{
     // A thrown call carries no retirement proof; stop the fallback chain.
     stopWorkers();
     break;
    }finally{
     if(task&&taskSettled)inFlightWorkers.delete(task);
    }
   }
  }
 }finally{
  if(deadline)clearTimeout(deadline);
  signal?.removeEventListener('abort',cancel);
   let allWorkersRetired=inFlightWorkers.size===0&&!unretiredTasksDetected;
   if(inFlightWorkers.size>0&&!unretiredTasksDetected){
    const pending=Promise.allSettled(Array.from(inFlightWorkers)).then(()=>true);
    const remaining=Math.min(10000,Math.max(0,deadlineAt-performance.now()));
    if(remaining>0){
     let cleanupTimer:NodeJS.Timeout|undefined;
     const deadlineWait=new Promise<false>(resolve=>{
      cleanupTimer=setTimeout(()=>resolve(false),remaining);
     });
     allWorkersRetired=await Promise.race([pending,deadlineWait]);
     if(cleanupTimer)clearTimeout(cleanupTimer);
    }
  }
   releaseNativeAstWorkerLease(lease,safeToLaunchWorkers&&allWorkersRetired);
 }
  return results.map(value=>value??unavailable(
   stopReason==='BUDGET'?'SKIPPED_BATCH_BUDGET':
   stopReason==='CANCELLED'?'SKIPPED_CANCELLED':'ISOLATED_ANALYSIS_FAILED'
  ));
}
