/** TASK-013 / REQ-022 / NFR-009: bounded, read-only batch AST previews.
 * A worker thread keeps parser work off Electron's privileged event loop.
 * This never executes imported source or supplies repair/manager authority.
 * 16 files / 1 MiB of copied payload per native batch are the existing
 * conservative bounds; larger imports remain imported but unanalysed.
 */
import {Worker} from 'node:worker_threads';
import {join} from 'node:path';
import type {ImportedScript} from '../import/import-service';
import {
 MAX_ANALYSIS_BYTES,MAX_BATCH_PREVIEW_BYTES,MAX_BATCH_PREVIEW_FILES,
 previewImportedScriptAnalysis,unavailableImportPreview,
 type ImportAnalysisPreview
} from './import-preview';

type Script=Pick<ImportedScript,'bytes'|'textEncoding'>;
const WORKER_DEADLINE_MS=10000;

function safeWorkerReply(value:unknown,count:number):value is ImportAnalysisPreview[]{
 if(!Array.isArray(value)||value.length!==count)return false;
 try{
  return value.every(x=>x&&typeof x==='object'&&!Array.isArray(x)&&
   x.automaticPatchAllowed===false&&x.tampermonkeyVerified===false&&
   x.businessVerified===false&&typeof x.status==='string'&&
   ['STATIC_ANALYSIS_ONLY','SKIPPED_TOO_LARGE','INVALID_ENCODING',
    'INVALID_METADATA','PARSE_ERROR','SKIPPED_BATCH_BUDGET'].includes(x.status)&&
   Number.isSafeInteger(x.totalSites)&&x.totalSites>=0&&
   Number.isSafeInteger(x.literalSites)&&x.literalSites>=0&&
   Number.isSafeInteger(x.runtimeConfirmationSites)&&x.runtimeConfirmationSites>=0&&
   Array.isArray(x.sites)&&x.sites.length<=8);
 }catch{return false;}
}

/** No paths, original file names or authenticated state are passed to the
 * worker. Cancellation revokes the pending preview without discarding imported
 * file records; a worker still running is forcibly terminated, never trusted.
 */
export async function previewImportedBatchOffMain(
 scripts:readonly Script[],signal?:AbortSignal
):Promise<ImportAnalysisPreview[]>{
 const selected:Script[]=[];
 const slots:(number|null)[]=[];
 const output:ImportAnalysisPreview[]=[];
 let usedBytes=0;
 for(const script of scripts){
  const size=script?.bytes instanceof Uint8Array?script.bytes.byteLength:Infinity;
  if(size>MAX_ANALYSIS_BYTES){
   slots.push(null);
   output.push(unavailableImportPreview('SKIPPED_TOO_LARGE','NOT_CHECKED'));
  }else if(selected.length>=MAX_BATCH_PREVIEW_FILES||
           usedBytes+size>MAX_BATCH_PREVIEW_BYTES){
   slots.push(null);
   output.push(unavailableImportPreview('SKIPPED_BATCH_BUDGET','NOT_CHECKED'));
  }else{
   slots.push(selected.length);
   output.push(unavailableImportPreview('ISOLATED_ANALYSIS_FAILED','NOT_CHECKED'));
   selected.push({bytes:script.bytes,textEncoding:script.textEncoding});
   usedBytes+=size;
  }
 }
 if(selected.length===0)return output;
 if(signal?.aborted)
  return output.map((x,i)=>slots[i]===null?x:
    unavailableImportPreview('SKIPPED_CANCELLED','NOT_CHECKED'));
 let worker:Worker;
 try{
  worker=new Worker(join(__dirname,'import-preview-worker.js'),{
   workerData:selected,
   resourceLimits:{maxOldGenerationSizeMb:96,maxYoungGenerationSizeMb:16}
  });
 }catch{return output;}
 const result=await new Promise<ImportAnalysisPreview[]|null>(resolve=>{
  let finished=false;
  let timer:NodeJS.Timeout|undefined;
  const finish=(answer:ImportAnalysisPreview[]|null,stopWorker:boolean)=>{
   if(finished)return;
   finished=true;
   if(timer)clearTimeout(timer);
   signal?.removeEventListener('abort',cancel);
   if(stopWorker)void worker.terminate().catch(()=>undefined);
   resolve(answer);
  };
  const cancel=()=>finish(null,true);
  worker.on('message',(value:unknown)=>{
   finish(safeWorkerReply(value,selected.length)?value:null,false);
  });
  worker.on('error',()=>finish(null,true));
  worker.on('exit',()=>finish(null,false));
  signal?.addEventListener('abort',cancel,{once:true});
  timer=setTimeout(()=>finish(null,true),WORKER_DEADLINE_MS);
  if(signal?.aborted)cancel();
 });
 return output.map((original,i)=>{
  const slot=slots[i];
  if(slot===null)return original;
  if(signal?.aborted)
   return unavailableImportPreview('SKIPPED_CANCELLED','NOT_CHECKED');
  return result?.[slot]??original;
 });
}
