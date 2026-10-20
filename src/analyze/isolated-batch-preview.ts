/** TASK-013 / REQ-022 / NFR-009: bounded, read-only batch AST previews.
 * A worker thread keeps parser work off Electron's privileged event loop.
 * This never executes imported source or supplies repair/manager authority.
 * Each isolated worker still receives at most 16 files / 1 MiB.
 * Native batches now use up to four sequential segments (64 file positions
 * maximum), then explicitly report the unanalysed remainder without losing
 * imported file records. Cancellation revokes the current worker and stops
 * all subsequent segments. No userscript is executed.
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

/** Treat worker messages as untrusted, even though today's worker is ours.
 * No unexpected field (in particular source, paths or selector text) may
 * cross this boundary. Copy only whitelisted scalar evidence into fresh
 * objects; a message is all-or-nothing to avoid partial forged progress.
 */
const PREVIEW_KEYS=[
 'status','metadataStatus','totalSites','literalSites',
 'runtimeConfirmationSites','sites','tampermonkeyVerified',
 'businessVerified','automaticPatchAllowed'
] as const;
const SITE_KEYS=['line','column','method','kind'] as const;
const PREVIEW_STATUSES=new Set([
 'STATIC_ANALYSIS_ONLY','SKIPPED_TOO_LARGE','INVALID_ENCODING',
 'INVALID_METADATA','PARSE_ERROR','SKIPPED_BATCH_BUDGET'
]);
const METADATA_STATUSES=new Set([
 'OK','MISSING_HEADER','UNTERMINATED_HEADER','INVALID_ENCODING','NOT_CHECKED'
]);
const SELECTOR_METHODS=new Set([
 'querySelector','querySelectorAll','getElementById',
 'getElementsByClassName','getElementsByName','getElementsByTagName',
 '<dynamic-member>'
]);
function replyRecord(value:unknown,keys:readonly string[]):Record<string,unknown>|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const proto=Object.getPrototypeOf(value);
 if(proto!==Object.prototype&&proto!==null)return null;
 const descriptors=Object.getOwnPropertyDescriptors(value);
 const names=Reflect.ownKeys(descriptors);
 if(names.length!==keys.length||names.some(key=>typeof key!=='string')||
    keys.some(key=>!Object.prototype.hasOwnProperty.call(descriptors,key)||
      !Object.prototype.hasOwnProperty.call(descriptors[key],'value')))
  return null;
 const fields:Record<string,unknown>=Object.create(null);
 for(const key of keys)fields[key]=descriptors[key].value;
 return fields;
}
function replyArray(value:unknown,count:number):unknown[]|null{
 if(!Array.isArray(value)||value.length!==count||
    Object.getPrototypeOf(value)!==Array.prototype)return null;
 const descriptors=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(descriptors).length!==count+1)return null;
 const items:unknown[]=[];
 for(let i=0;i<count;i++){
  const slot=descriptors[String(i)];
  if(!slot||!Object.prototype.hasOwnProperty.call(slot,'value'))return null;
  items.push(slot.value);
 }
 return items;
}

/** Internal reply-wire contract, exported for hostile-payload regression tests.
 * It never authenticates an extension or gives repair/write permission.
 */
export function validateIsolatedPreviewReply(
 value:unknown,count:number
):ImportAnalysisPreview[]|null{
 try{
  if(!Number.isSafeInteger(count)||count<0||count>MAX_BATCH_PREVIEW_FILES)
   return null;
  const rows=replyArray(value,count);
  if(!rows)return null;
  const safe:ImportAnalysisPreview[]=[];
  for(const row of rows){
   const x=replyRecord(row,PREVIEW_KEYS);
   if(!x||typeof x.status!=='string'||!PREVIEW_STATUSES.has(x.status)||
      typeof x.metadataStatus!=='string'||!METADATA_STATUSES.has(x.metadataStatus)||
      x.automaticPatchAllowed!==false||x.tampermonkeyVerified!==false||
      x.businessVerified!==false||
      !Number.isSafeInteger(x.totalSites)||!(x.totalSites as number>=0)||
      (x.totalSites as number)>MAX_ANALYSIS_BYTES||
      !Number.isSafeInteger(x.literalSites)||!(x.literalSites as number>=0)||
      !Number.isSafeInteger(x.runtimeConfirmationSites)||
      !(x.runtimeConfirmationSites as number>=0)||
      (x.literalSites as number)+(x.runtimeConfirmationSites as number)!==x.totalSites)
    return null;
   const sitesRaw=replyArray(x.sites,Math.min(8,x.totalSites as number));
   if(!sitesRaw)return null;
   if(x.status==='STATIC_ANALYSIS_ONLY'){
    if(x.metadataStatus!=='OK')return null;
   }else{
    if(x.totalSites!==0||sitesRaw.length!==0)return null;
    if(x.status==='INVALID_ENCODING'&&x.metadataStatus!=='INVALID_ENCODING')
     return null;
    if(x.status==='INVALID_METADATA'&&
       x.metadataStatus!=='MISSING_HEADER'&&x.metadataStatus!=='UNTERMINATED_HEADER')
     return null;
    if((x.status==='SKIPPED_TOO_LARGE'||x.status==='SKIPPED_BATCH_BUDGET')&&
       x.metadataStatus!=='NOT_CHECKED')return null;
    if(x.status==='PARSE_ERROR'&&x.metadataStatus!=='OK'&&
       x.metadataStatus!=='NOT_CHECKED')return null;
   }
   const sites:ImportAnalysisPreview['sites'][number][]=[];
   let visibleLiteral=0;
   let visibleRuntime=0;
   for(const item of sitesRaw){
    const s=replyRecord(item,SITE_KEYS);
    if(!s||!Number.isSafeInteger(s.line)||!(s.line as number>=1)||
       (s.line as number)>MAX_ANALYSIS_BYTES+1||
       !Number.isSafeInteger(s.column)||!(s.column as number>=1)||
       (s.column as number)>MAX_ANALYSIS_BYTES+1||
       typeof s.method!=='string'||!SELECTOR_METHODS.has(s.method)||
       (s.kind!=='literal'&&s.kind!=='needs-runtime-confirmation')||
       (s.method==='<dynamic-member>'&&s.kind!=='needs-runtime-confirmation'))
      return null;
    if(s.kind==='literal')visibleLiteral++;
    else visibleRuntime++;
    sites.push(Object.freeze({
     line:s.line as number,column:s.column as number,
     method:s.method,kind:s.kind
    }));
   }
   // The first eight AST sites are a bounded prefix. Even a partial prefix
   // cannot contain more sites of a kind than the worker's reported totals.
   // For an untruncated preview, every site must account for its category.
   if(visibleLiteral>(x.literalSites as number)||
      visibleRuntime>(x.runtimeConfirmationSites as number)||
      ((x.totalSites as number)<=8&&
       (visibleLiteral!==x.literalSites||
        visibleRuntime!==x.runtimeConfirmationSites)))
    return null;
   safe.push(Object.freeze({
    status:x.status as ImportAnalysisPreview['status'],
    metadataStatus:x.metadataStatus as ImportAnalysisPreview['metadataStatus'],
    totalSites:x.totalSites as number,literalSites:x.literalSites as number,
    runtimeConfirmationSites:x.runtimeConfirmationSites as number,
    sites:Object.freeze(sites),tampermonkeyVerified:false as const,
    businessVerified:false as const,automaticPatchAllowed:false as const
   }));
  }
  return Object.freeze(safe) as unknown as ImportAnalysisPreview[];
 }catch{
  // Malicious Proxy traps and accessor-backed arrays cannot inject errors or data.
  return null;
 }
}

/** No paths, original file names or authenticated state are passed to the
 * worker. Cancellation revokes the pending preview without discarding imported
 * file records; a worker still running is forcibly terminated, never trusted.
 */
async function previewImportedChunkOffMain(
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
   const checked=validateIsolatedPreviewReply(value,selected.length);
   finish(checked,checked===null);
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

/** Process a real native multi-file/folder import without silently omitting
 * every script beyond the first 16. Each segment remains a separately bounded
 * and validated worker. This is an unprivileged read-only preview, not the
 * durable repair queue or a Tampermonkey/GM business verification.
 */
export async function previewImportedBatchOffMain(
 scripts:readonly Script[],signal?:AbortSignal,
 onProgress?:(processed:number,total:number)=>void
):Promise<ImportAnalysisPreview[]>{
 const MAX_SEGMENTS=4;
 const results:ImportAnalysisPreview[]=[];
 for(let offset=0;offset<scripts.length;offset+=MAX_BATCH_PREVIEW_FILES){
  const segment=scripts.slice(offset,offset+MAX_BATCH_PREVIEW_FILES);
  if(offset>=MAX_SEGMENTS*MAX_BATCH_PREVIEW_FILES||signal?.aborted){
   const status=offset>=MAX_SEGMENTS*MAX_BATCH_PREVIEW_FILES
    ?'SKIPPED_BATCH_BUDGET' as const:'SKIPPED_CANCELLED' as const;
   for(const script of segment){
    const bytes=script?.bytes;
    results.push(bytes instanceof Uint8Array&&
      bytes.byteLength<=MAX_ANALYSIS_BYTES
       ?unavailableImportPreview(status,'NOT_CHECKED')
       :unavailableImportPreview('SKIPPED_TOO_LARGE','NOT_CHECKED'));
   }
   // Skipped positions are still accounted for in the progress denominator.
   try{onProgress?.(results.length,scripts.length);}
   catch{/* advisory progress only */}
   continue;
  }
  // No overlapping workers, hidden unbounded queue or user-code execution:
  // every segment has its own 10s deadline, 16-file/1MiB copied-byte limit.
  results.push(...await previewImportedChunkOffMain(segment,signal));
  // A native import's UI may show finite, scalar-only AST progress.
  // No source bytes, file names or selective-analysis results cross this callback.
  try{onProgress?.(results.length,scripts.length);}
  catch{/* progress is advisory; it cannot affect isolated parsing */}
 }
 return results;
}
