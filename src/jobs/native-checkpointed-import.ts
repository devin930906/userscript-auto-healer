/** TASK-013 / REQ-022 / TEST-022: actual native-selected import AST jobs
 * connected to the bounded durable READ-ONLY scheduler. This only stores
 * ordered hash commitments and job attempts, never paths or source bytes.
 * A persisted SUCCEEDED hint is NEVER trusted as current AST evidence:
 * re-imported bytes are re-validated and previous previews re-run for display.
 * No auto repair, browser control, user file writes or Tampermonkey claims.
 */
import {createHash} from 'node:crypto';
import {types as nodeTypes} from 'node:util';
import {lstat,mkdir} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {MAX_SELECTED_FILES,type ImportedScript} from '../import/import-service';
import {MAX_BATCH_PREVIEW_FILES,MAX_BATCH_PREVIEW_BYTES,
 MAX_ISOLATED_ANALYSIS_BYTES,unavailableImportPreview,
 type ImportAnalysisPreview} from '../analyze/import-preview';
import {acquireNativeAstWorkerLease,previewImportedBatchOffMain,
 releaseNativeAstWorkerLease,type IsolatedBatchPreviewResult,
 type NativeAstWorkerLease} from '../analyze/isolated-batch-preview';
import {hasUnsafePathLink} from '../version/path-boundary';
import {snapshotNativeScripts} from './imported-analysis-queue';
import {ReadOnlyBatchCoordinator,type ReadOnlyBatchSnapshot} from './batch-coordinator';
import {loadReadOnlyBatchJournal,runCheckpointedReadOnlyBatch,
 type BatchJournalFailure} from './batch-journal';

type BatchOutcome=
 |Readonly<{status:'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED';
   resumed:boolean;previews:ImportAnalysisPreview[]}>
 |Readonly<{status:'BLOCKED';reason:BatchJournalFailure|'CANCELLED';
   previews:ImportAnalysisPreview[]}>;
const fail=(count:number,reason:BatchJournalFailure|'CANCELLED'):BatchOutcome=>Object.freeze({
 status:'BLOCKED' as const,reason,
 previews:Array.from({length:count},()=>unavailableImportPreview(
  reason==='CANCELLED'?'SKIPPED_CANCELLED':'ISOLATED_ANALYSIS_FAILED','NOT_CHECKED'))
});
const blank=(count:number,status:'SKIPPED_CANCELLED'|'SKIPPED_BATCH_BUDGET'|
 'ISOLATED_ANALYSIS_FAILED')=>
 Array.from({length:count},()=>unavailableImportPreview(status,'NOT_CHECKED'));

/** Only the explicit Worker lifecycle receipt can authorize another dispatch.
 * Old array-only results and malformed receipts have no retirement proof. */
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

/** A cancellation claim may come from an untrusted JS boundary even for
 * native-only callers. Require native AbortSignal internal slots BEFORE any
 * aborted getter or event method is read. Shadowed instance methods can
 * execute caller code later during scheduler cleanup, so reject them too.
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

/** journalRoot must come exclusively from Electron's own native userData.
 * A root for this feature does not confer any authority over selected files.
 * Reimporting the same ordered script bytes resumes a read-only scheduling
 * record; changing even one byte starts a separate isolated batch.
 */
export async function runCheckpointedNativeImportAnalysis(
 journalRoot:string,scripts:readonly ImportedScript[],signal?:AbortSignal,
 onProgress?:(processed:number,total:number)=>void
):Promise<BatchOutcome>{
 // Refuse caller-controlled batch Proxies BEFORE accessing their length.
 // Array.isArray(revokedProxy) throws and active Proxy length may run traps.
 // Match the in-memory native AST queue's fail-closed input boundary.
 if(nodeTypes.isProxy(scripts)||!Array.isArray(scripts))
  return fail(0,'INVALID_INPUT');
 const count=scripts.length;
 // The native importer caps its batches. Do not allocate an unbounded
 // failure array or snapshot for a forged direct caller.
 if(count>MAX_SELECTED_FILES)return fail(0,'INVALID_INPUT');
 if(signal!==undefined&&!isNativeCancellationSignal(signal))
  return fail(count,'INVALID_INPUT');
 if(signal?.aborted)return fail(count,'CANCELLED');
 const bound=snapshotNativeScripts(scripts);
 if(!bound||bound.length===0)return fail(count,'INVALID_INPUT');
 if(typeof journalRoot!=='string'||journalRoot.length===0||
    journalRoot.length>4096||!isAbsolute(journalRoot)||
    journalRoot!==resolve(journalRoot)||journalRoot.includes('\0'))
  return fail(count,'UNSAFE_PATH');
 // Reserve the shared process lifecycle before any journal directory or file
 // operation. A busy or permanently unsafe gate is an unstarted request, so
 // it must not turn an existing scheduling hint into FAILED or create one.
 const acquisition=acquireNativeAstWorkerLease();
 if(acquisition.status!=='ACQUIRED')return fail(count,'BUSY');
 const lease:NativeAstWorkerLease=acquisition.lease;
 let safeToLaunchWorkers=true;
 try{
 // No untrusted hash or path enters the directory name; the digest uses only
 // the native importer's verified bytes, ordered and domain-separated.
 // v1/v2 did not bind the decoder and v3 grouped only by file count,
 // allowing the isolated Worker's 1 MiB budget to starve valid later files.
 // v4 leaves older on-disk scheduling hints intact in separate directories.
 // No persisted success can substitute for current-session AST evidence.
 const nameHash=createHash('sha256').update('uah-native-import-batch-v4\0');
 const groups:Array<{scripts:typeof bound;fingerprint:string}>=[];
 for(const script of bound){
  nameHash.update(script.sha256);nameHash.update('\0');
  nameHash.update(script.textEncoding);nameHash.update('\0');
 }
 for(let offset=0;offset<bound.length;){
  let end=offset;
  let eligibleBytes=0;
  while(end<bound.length&&end-offset<MAX_BATCH_PREVIEW_FILES){
   const size=bound[end].bytes.byteLength;
   // Oversized files are marked SKIPPED_TOO_LARGE by the Worker and must
   // never consume bytes reserved for otherwise eligible AST previews.
   const charge=size<=MAX_ISOLATED_ANALYSIS_BYTES?size:0;
   if(end>offset&&eligibleBytes+charge>MAX_BATCH_PREVIEW_BYTES)break;
   eligibleBytes+=charge;
   end++;
  }
  const segment=bound.slice(offset,end);
  const h=createHash('sha256').update('uah-native-import-segment-v3\0');
  h.update(String(offset));h.update('\0');
  for(const item of segment){
   h.update(item.sha256);h.update('\0');
   h.update(item.textEncoding);h.update('\0');
  }
  groups.push({scripts:segment,fingerprint:h.digest('hex')});
  offset=end;
 }
 const directory=join(journalRoot,'batch-'+nameHash.digest('hex'));
 try{
  // Electron must have already created its own userData parent. A recursive
  // mkdir on journalRoot used to follow a pre-existing userData junction
  // BEFORE detecting it, potentially creating folders outside app-owned
  // storage. Refuse the redirected/missing parent before any mkdir at all.
  const parent=dirname(journalRoot);
  if(await hasUnsafePathLink(parent))return fail(count,'UNSAFE_PATH');
  const parentStart=await lstat(parent,{bigint:true});
  if(!parentStart.isDirectory()||parentStart.isSymbolicLink())
   return fail(count,'UNSAFE_PATH');
  await mkdir(journalRoot,{recursive:false,mode:0o700}).catch(error=>{
   if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
  });
  if(await hasUnsafePathLink(journalRoot))return fail(count,'UNSAFE_PATH');
  const root=await lstat(journalRoot,{bigint:true});
  const parentAgain=await lstat(parent,{bigint:true});
  if(!root.isDirectory()||root.isSymbolicLink()||
     !parentAgain.isDirectory()||parentAgain.isSymbolicLink()||
     parentAgain.dev!==parentStart.dev||parentAgain.ino!==parentStart.ino)
   return fail(count,'UNSAFE_PATH');
  await mkdir(directory,{recursive:false,mode:0o700}).catch(error=>{
   if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
  });
  const meta=await lstat(directory);
  if(!meta.isDirectory()||meta.isSymbolicLink()||
     await hasUnsafePathLink(directory))return fail(count,'UNSAFE_PATH');
 }catch{return fail(count,'UNSAFE_PATH');}
 const observations:(ImportAnalysisPreview[]|undefined)[]=Array(groups.length);
 const needsRecovery:boolean[]=Array(groups.length).fill(false);
 // A persisted success alone is not fresh AST evidence. Notify only for
 // contiguous, newly analysed segments AFTER the terminal checkpoint write.
 // Avoid duplicate progress when the final UI preview is assembled.
 let lastReported=0;
 const reportSavedProgress=(snapshot:ReadOnlyBatchSnapshot)=>{
  if(signal?.aborted)return;
  let processed=0;
  for(let ordinal=0;ordinal<groups.length;ordinal++){
   if(snapshot.jobs[ordinal]?.state!=='SUCCEEDED'||
      observations[ordinal]?.length!==groups[ordinal].scripts.length)break;
   processed+=groups[ordinal].scripts.length;
  }
  if(processed>lastReported){
   lastReported=processed;
   try{onProgress?.(processed,count);}catch{/* Advisory only. */}
  }
 };
 const lifetime=new AbortController();
 // Keep this process-local stop state after an unconfirmed Worker retirement;
 // journal rows remain ordinary scheduling states, never lifecycle authority.
 const attemptCounts:number[]=Array(groups.length).fill(0);
 const inFlightWorkers=new Set<Promise<unknown>>();
 const recoverIndividually=async(group:typeof groups[number])=>{
  const rows:(ImportAnalysisPreview|undefined)[]=
   Array(group.scripts.length).fill(undefined);
  for(let index=0;index<group.scripts.length;index++){
   if(lifetime.signal.aborted)break;
   const task=previewImportedBatchOffMain([group.scripts[index]],
    lifetime.signal,undefined,true,lease);
   inFlightWorkers.add(task);
   try{
    const value=await task;
    const evidence=readWorkerResult(value);
    if(!evidence||!evidence.safeToContinue){
     safeToLaunchWorkers=false;
     break;
    }
    if(evidence.previews.length!==1){
     rows[index]=unavailableImportPreview('ISOLATED_ANALYSIS_FAILED','NOT_CHECKED');
     continue;
    }
    rows[index]=evidence.previews[0];
    if(rows[index]?.status==='SKIPPED_CANCELLED'||
       rows[index]?.status==='SKIPPED_BATCH_BUDGET')break;
   }catch{
    // A thrown call has no retirement receipt; stop the per-file retry chain.
    safeToLaunchWorkers=false;
    break;
   }finally{
    inFlightWorkers.delete(task);
   }
  }
  return rows;
 };
 const worker=async(ordinal:number,abort:AbortSignal)=>{
  if(!safeToLaunchWorkers)return 'PERMANENT_FAILURE' as const;
  const attempt=++attemptCounts[ordinal];
  let previews:ImportAnalysisPreview[];
  const task=previewImportedBatchOffMain(groups[ordinal].scripts,abort,
   undefined,true,lease);
  inFlightWorkers.add(task);
  try{
   const value=await task;
   const evidence=readWorkerResult(value);
   if(!evidence){safeToLaunchWorkers=false;return 'PERMANENT_FAILURE' as const;}
   previews=evidence.previews;
   if(!evidence.safeToContinue)safeToLaunchWorkers=false;
  }catch{
   // No structured retirement receipt means a replacement could overlap a
   // Worker that remains live. Fail closed for this and later segments.
   safeToLaunchWorkers=false;
   return 'PERMANENT_FAILURE' as const;
  }finally{
   inFlightWorkers.delete(task);
  }
  if(abort.aborted||signal?.aborted||lifetime.signal.aborted||
     previews.some(row=>row.status==='SKIPPED_CANCELLED'||
       row.status==='SKIPPED_BATCH_BUDGET'))
   return 'PERMANENT_FAILURE' as const;
  if(!safeToLaunchWorkers)return 'PERMANENT_FAILURE' as const;
  // A worker crash or malformed / truncated reply has no trusted AST
  // evidence. Retry once only when the structured receipt confirms the
  // previous Worker retired; never use stale success as fresh evidence.
  const failed=previews.length!==groups[ordinal].scripts.length||
   previews.some(row=>row.status==='ISOLATED_ANALYSIS_FAILED');
  if(failed){
   const exhausted=previews.some(row=>row.status==='SKIPPED_CANCELLED'||
    row.status==='SKIPPED_BATCH_BUDGET');
   if(safeToLaunchWorkers&&!exhausted&&attempt<2)
    return 'RETRYABLE_FAILURE' as const;
   if(safeToLaunchWorkers&&!exhausted&&attempt>=2)
    needsRecovery[ordinal]=true;
   return 'PERMANENT_FAILURE' as const;
  }
  observations[ordinal]=previews;
  return 'DONE' as const;
 };
 const options={count:groups.length,concurrency:1,maxAttempts:2,
  timeoutMs:15000,jobHashes:groups.map(g=>g.fingerprint)};
 const loaded=await loadReadOnlyBatchJournal(directory,options,worker);
 if(loaded.status==='BLOCKED'&&loaded.reason!=='NOT_FOUND')
  return fail(count,loaded.reason);
 if(signal?.aborted)return fail(count,'CANCELLED');
 const resumed=loaded.status==='CHECKPOINT_RESTORED_SCHEDULING_ONLY';
 if(resumed){
  for(const job of loaded.coordinator.snapshot().jobs)
   attemptCounts[job.ordinal]=job.attempts;
 }
 const coordinator=resumed?loaded.coordinator:
  new ReadOnlyBatchCoordinator(options,worker);
 // Preserve the pre-existing 120-second overall AST budget, not merely
 // the per-segment timeout. A 1000-file import must not hold the UI for
 // 63 independent 15-second attempts.
 const cancel=()=>lifetime.abort();
 const onAbort=()=>coordinator.cancel();
 const timeout=setTimeout(cancel,120000);
 signal?.addEventListener('abort',cancel,{once:true});
 lifetime.signal.addEventListener('abort',onAbort,{once:true});
 try{
  if(signal?.aborted||lifetime.signal.aborted)return fail(count,'CANCELLED');
  const outcome=await runCheckpointedReadOnlyBatch(directory,coordinator,reportSavedProgress);
  if(signal?.aborted||lifetime.signal.aborted){
   // Cancellation revokes the batch receipt but should not erase results
   // from independently completed segments. A durable SUCCEEDED state is
   // insufficient on its own: also require current-session Worker evidence.
   // A checkpoint write failure leaves NO trusted durability evidence.
   if(outcome.status==='BLOCKED')return fail(count,'CANCELLED');
   const incompleteStatus=lifetime.signal.aborted&&!signal?.aborted
    ?'SKIPPED_BATCH_BUDGET' as const:'SKIPPED_CANCELLED' as const;
   const partial=groups.flatMap((group,ordinal)=>{
    const fresh=observations[ordinal];
    return outcome.snapshot.jobs[ordinal].state==='SUCCEEDED'&&
     fresh?.length===group.scripts.length
     ?fresh:blank(group.scripts.length,incompleteStatus);
   });
   return Object.freeze({status:'BLOCKED' as const,
    reason:'CANCELLED' as const,previews:partial});
  }
  if(outcome.status==='BLOCKED')return fail(count,outcome.reason);
  const previews:ImportAnalysisPreview[]=[];
  let processed=0;
  for(let ordinal=0;ordinal<groups.length;ordinal++){
   const group=groups[ordinal];
   const state=outcome.snapshot.jobs[ordinal].state;
   // A cancelled journal job is terminal, not an AST Worker failure or
   // successful batch work. Re-importing identical approved bytes must not
   // silently resume it, reclassify it as a crash, or count it as processed.
   if(state==='CANCELLED'){
    previews.push(...blank(group.scripts.length,'SKIPPED_CANCELLED'));
    continue;
   }
   // A prior success is an unauthenticated scheduling hint. Always rerun
   // its bounded, isolated AST worker to return fresh, source-matched UI data.
   let reports=observations[ordinal];
   if(!reports&&state==='SUCCEEDED'&&!lifetime.signal.aborted&&
      safeToLaunchWorkers){
    // A persisted success is a scheduling hint, not fresh AST evidence.
    // Resumed display has the same TWO-attempt transient-worker budget as
    // initial read-only analysis. Never rewrite the durable journal, and
    // never retry cancelled or budget-limited requests.
    let exhaustedTransientRetries=false;
    for(let attempt=0;attempt<2;attempt++){
     if(signal?.aborted||lifetime.signal.aborted)break;
     try{
      const value=await previewImportedBatchOffMain(group.scripts,lifetime.signal,
       undefined,true,lease);
      const evidence=readWorkerResult(value);
      if(!evidence){safeToLaunchWorkers=false;break;}
      const fresh=evidence.previews;
      if(!evidence.safeToContinue)safeToLaunchWorkers=false;
      if(fresh.length===group.scripts.length&&
         evidence.safeToContinue&&
         !fresh.some(row=>row.status==='ISOLATED_ANALYSIS_FAILED'||
           row.status==='SKIPPED_CANCELLED'||row.status==='SKIPPED_BATCH_BUDGET')){
       reports=fresh;
       break;
      }
      if(fresh.some(row=>row.status==='SKIPPED_CANCELLED'||
         row.status==='SKIPPED_BATCH_BUDGET'))break;
      if(!evidence.safeToContinue)break;
      if(attempt===1)exhaustedTransientRetries=true;
     }catch{
      // No retirement receipt means a replacement could overlap a live Worker.
      safeToLaunchWorkers=false;
      break;
     }
    }
    if(exhaustedTransientRetries&&safeToLaunchWorkers)
     needsRecovery[ordinal]=true;
   }
   let partialRecovery:(ImportAnalysisPreview|undefined)[]|undefined;
   if(!reports&&needsRecovery[ordinal]&&group.scripts.length>1&&
      safeToLaunchWorkers&&!lifetime.signal.aborted)
    partialRecovery=await recoverIndividually(group);
   // Resume reanalysis awaits a worker AFTER checkpoint settlement. Any
   // cancellation during that await revokes the display receipt, even when
   // the previously persisted scheduling hint was SUCCEEDED.
   if(signal?.aborted||lifetime.signal.aborted){
    const incompleteStatus=lifetime.signal.aborted&&!signal?.aborted
     ?'SKIPPED_BATCH_BUDGET' as const:'SKIPPED_CANCELLED' as const;
    const recovered=partialRecovery?.map(row=>{
     if(row?.status==='SKIPPED_CANCELLED'&&incompleteStatus==='SKIPPED_BATCH_BUDGET')
      return unavailableImportPreview('SKIPPED_BATCH_BUDGET','NOT_CHECKED');
     return row??unavailableImportPreview(incompleteStatus,'NOT_CHECKED');
    })??[];
    return Object.freeze({status:'BLOCKED' as const,
     reason:'CANCELLED' as const,
     previews:[...previews,...recovered,
      ...blank(count-previews.length-recovered.length,incompleteStatus)]});
   }
   if(partialRecovery)
    reports=partialRecovery.map(row=>row??
     unavailableImportPreview('ISOLATED_ANALYSIS_FAILED','NOT_CHECKED'));
   previews.push(...(reports??blank(group.scripts.length,
    'ISOLATED_ANALYSIS_FAILED')));
   processed+=group.scripts.length;
   if(processed>lastReported){
    lastReported=processed;
    try{onProgress?.(processed,count);}catch{/* advisory UI counters only */}
   }
  }
  if(signal?.aborted||lifetime.signal.aborted||
     outcome.snapshot.jobs.some(job=>job.state==='CANCELLED'))
   return Object.freeze({status:'BLOCKED' as const,
    reason:'CANCELLED' as const,previews});
  return Object.freeze({status:'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED' as const,
   resumed,previews});
 }finally{
  clearTimeout(timeout);
  signal?.removeEventListener('abort',cancel);
  lifetime.signal.removeEventListener('abort',onAbort);
  if(inFlightWorkers.size>0){
   await Promise.allSettled(Array.from(inFlightWorkers));
  }
 }
 }finally{
  releaseNativeAstWorkerLease(lease,safeToLaunchWorkers);
 }
}
