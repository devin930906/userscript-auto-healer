/** TASK-013 / REQ-022 / TEST-022: actual, native-imported, read-only AST
 * processing through the bounded batch coordinator. This is a scheduling
 * stage only: it never persists source, modifies a userscript, evaluates JS,
 * verifies Tampermonkey, or grants repair/rollback privileges. An import
 * resume across process restarts still requires a separate trusted workflow.
 */
import {createHash} from 'node:crypto';
import {MAX_SELECTED_FILES,type ImportedScript} from '../import/import-service';
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

function validateNativeScripts(scripts:readonly ImportedScript[]):boolean{
 try{
  const seen=new Set<string>();
  for(const item of scripts){
   if(!item||!(item.bytes instanceof Uint8Array)||
      !Number.isSafeInteger(item.byteLength)||
      item.byteLength!==item.bytes.byteLength||
      !SHA256.test(item.sha256)||!ENCODINGS.has(item.textEncoding)||
      seen.has(item.sha256)||
      createHash('sha256').update(item.bytes).digest('hex')!==item.sha256)
    return false;
   seen.add(item.sha256);
  }
  return true;
 }catch{return false;}
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
 const count=scripts.length;
 if(count===0)return [];
 if(count>MAX_SELECTED_FILES)return scripts.map(()=>unavailable('SKIPPED_BATCH_BUDGET'));
 if(!validateNativeScripts(scripts))
  return scripts.map(()=>unavailable('ISOLATED_ANALYSIS_FAILED'));
 if(signal?.aborted)return scripts.map(()=>unavailable('SKIPPED_CANCELLED'));
 const segmentCount=Math.ceil(count/MAX_BATCH_PREVIEW_FILES);
 const groups=Array.from({length:segmentCount},(_,index)=>{
  const offset=index*MAX_BATCH_PREVIEW_FILES;
  const list=scripts.slice(offset,offset+MAX_BATCH_PREVIEW_FILES);
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
 const deadline=setTimeout(cancel,GLOBAL_ANALYSIS_DEADLINE_MS);
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
  parent.signal.aborted?'SKIPPED_CANCELLED':'ISOLATED_ANALYSIS_FAILED'
 ));
}
