/** TASK-013 / REQ-022 / TEST-022: actual native-selected import AST jobs
 * connected to the bounded durable READ-ONLY scheduler. This only stores
 * ordered hash commitments and job attempts, never paths or source bytes.
 * A persisted SUCCEEDED hint is NEVER trusted as current AST evidence:
 * re-imported bytes are re-validated and previous previews re-run for display.
 * No auto repair, browser control, user file writes or Tampermonkey claims.
 */
import {createHash} from 'node:crypto';
import {lstat,mkdir} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {MAX_SELECTED_FILES,type ImportedScript} from '../import/import-service';
import {MAX_BATCH_PREVIEW_FILES,unavailableImportPreview,
 type ImportAnalysisPreview} from '../analyze/import-preview';
import {previewImportedBatchOffMain} from '../analyze/isolated-batch-preview';
import {hasUnsafePathLink} from '../version/path-boundary';
import {snapshotNativeScripts} from './imported-analysis-queue';
import {ReadOnlyBatchCoordinator} from './batch-coordinator';
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
const blank=(count:number,status:'SKIPPED_CANCELLED'|'ISOLATED_ANALYSIS_FAILED')=>
 Array.from({length:count},()=>unavailableImportPreview(status,'NOT_CHECKED'));

/** journalRoot must come exclusively from Electron's own native userData.
 * A root for this feature does not confer any authority over selected files.
 * Reimporting the same ordered script bytes resumes a read-only scheduling
 * record; changing even one byte starts a separate isolated batch.
 */
export async function runCheckpointedNativeImportAnalysis(
 journalRoot:string,scripts:readonly ImportedScript[],signal?:AbortSignal,
 onProgress?:(processed:number,total:number)=>void
):Promise<BatchOutcome>{
 const count=Array.isArray(scripts)?scripts.length:0;
 // The native importer caps its batches. Do not allocate an unbounded
 // failure array or snapshot for a forged direct caller.
 if(count>MAX_SELECTED_FILES)return fail(0,'INVALID_INPUT');
 if(signal?.aborted)return fail(count,'CANCELLED');
 const bound=snapshotNativeScripts(scripts);
 if(!bound||bound.length===0)return fail(count,'INVALID_INPUT');
 if(typeof journalRoot!=='string'||journalRoot.length===0||
    journalRoot.length>4096||!isAbsolute(journalRoot)||
    journalRoot!==resolve(journalRoot)||journalRoot.includes('\0'))
  return fail(count,'UNSAFE_PATH');
 // No untrusted hash or path enters the directory name; the digest uses only
 // the native importer's verified bytes, ordered and domain-separated.
 const nameHash=createHash('sha256').update('uah-native-import-batch-v1\0');
 const groups:Array<{scripts:typeof bound;fingerprint:string}>=[];
 for(const script of bound)nameHash.update(script.sha256);
 for(let offset=0;offset<bound.length;offset+=MAX_BATCH_PREVIEW_FILES){
  const segment=bound.slice(offset,offset+MAX_BATCH_PREVIEW_FILES);
  const h=createHash('sha256').update('uah-native-import-segment-v1\0');
  h.update(String(offset));h.update('\0');
  for(const item of segment)h.update(item.sha256);
  groups.push({scripts:segment,fingerprint:h.digest('hex')});
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
 const lifetime=new AbortController();
 const worker=async(ordinal:number,abort:AbortSignal)=>{
  const previews=await previewImportedBatchOffMain(groups[ordinal].scripts,abort);
  if(abort.aborted||signal?.aborted||lifetime.signal.aborted||
     previews.some(row=>row.status==='ISOLATED_ANALYSIS_FAILED'||
       row.status==='SKIPPED_CANCELLED'||row.status==='SKIPPED_BATCH_BUDGET'))
   return 'PERMANENT_FAILURE' as const;
  observations[ordinal]=previews;
  return 'DONE' as const;
 };
 const options={count:groups.length,concurrency:1,maxAttempts:1,
  timeoutMs:15000,jobHashes:groups.map(g=>g.fingerprint)};
 const loaded=await loadReadOnlyBatchJournal(directory,options,worker);
 if(loaded.status==='BLOCKED'&&loaded.reason!=='NOT_FOUND')
  return fail(count,loaded.reason);
 if(signal?.aborted)return fail(count,'CANCELLED');
 const resumed=loaded.status==='CHECKPOINT_RESTORED_SCHEDULING_ONLY';
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
  const outcome=await runCheckpointedReadOnlyBatch(directory,coordinator);
  if(outcome.status==='BLOCKED')return fail(count,outcome.reason);
  const previews:ImportAnalysisPreview[]=[];
  let processed=0;
  for(let ordinal=0;ordinal<groups.length;ordinal++){
   const group=groups[ordinal];
   const state=outcome.snapshot.jobs[ordinal].state;
   // A prior success is an unauthenticated scheduling hint. Always rerun
   // its bounded, isolated AST worker to return fresh, source-matched UI data.
   let reports=observations[ordinal];
   if(!reports&&state==='SUCCEEDED'&&!lifetime.signal.aborted)
    reports=await previewImportedBatchOffMain(group.scripts,lifetime.signal);
   previews.push(...(reports??blank(group.scripts.length,
    lifetime.signal.aborted?'SKIPPED_CANCELLED':'ISOLATED_ANALYSIS_FAILED')));
   processed+=group.scripts.length;
   try{onProgress?.(processed,count);}catch{/* advisory UI counters only */}
  }
  return Object.freeze({status:'READ_ONLY_BATCH_CHECKPOINTED_UNVERIFIED' as const,
   resumed,previews});
 }finally{
  clearTimeout(timeout);
  signal?.removeEventListener('abort',cancel);
  lifetime.signal.removeEventListener('abort',onAbort);
 }
}
