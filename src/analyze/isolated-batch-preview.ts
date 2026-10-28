/** TASK-013 / REQ-022 / NFR-009: bounded, read-only batch AST previews.
 * A worker thread keeps parser work off Electron's privileged event loop.
 * This never executes imported source or supplies repair/manager authority.
 * Each isolated worker still receives at most 16 files / 1 MiB.
 * Native batches cover up to the importer's 1000-file cap in finite, sequential
 * worker segments with a separate total time budget. Any unanalysed remainder
 * is reported as skipped without losing file records. Cancellation revokes
 * the active worker and stops all subsequent segments. No userscript is executed.
 */
import {Worker} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
import {types as nodeTypes} from 'node:util';
import {join} from 'node:path';
import {MAX_SELECTED_FILES,MAX_TOTAL_IMPORTED_BYTES,type ImportedScript} from '../import/import-service';
import {
 MAX_ANALYSIS_BYTES,MAX_BATCH_PREVIEW_BYTES,MAX_BATCH_PREVIEW_FILES,
 previewImportedScriptAnalysis,unavailableImportPreview,
 type ImportAnalysisPreview
} from './import-preview';

type Script=Pick<ImportedScript,'bytes'|'textEncoding'>;
type WorkerFailureReason='START_FAILED'|'REPLY_REJECTED'|
 'WORKER_ERROR'|'EXIT_BEFORE_MESSAGE'|'DEADLINE';
/** Only bounded internal reason codes and segment cardinality enter logs.
 * Never log worker errors, user source, selectors, paths, hashes or URLs.
 * Logging must not replace the caller's fail-closed result even if a hook throws.
 */
function reportWorkerFailure(
 reason:WorkerFailureReason,count:number,startedAt:number,onlineAt:number|null
):void{
 try{
  // 'online' confirms the Worker thread began executing, not that the
  // parser loaded or finished. Log bounded relative timings only.
  const bucket=(ms:number)=>String(Math.min(12000,
   Math.max(0,Math.ceil(ms/1000)*1000)));
  const phase=onlineAt===null?'PRE_ONLINE':'POST_ONLINE';
  const onlineBucket=onlineAt===null?'NA':bucket(onlineAt-startedAt);
  console.warn(`UAH_AST_WORKER_UNAVAILABLE reason=${reason} count=${count} phase=${phase} elapsedBucketMs=${bucket(performance.now()-startedAt)} onlineBucketMs=${onlineBucket}`);
 }catch{/* Diagnostics never alter read-only fail-closed behavior. */}
}
const WORKER_DEADLINE_MS=10000;
// A pathological 1000-file batch must not consume up to 63 * 10 seconds.
const MAX_TOTAL_PREVIEW_MS=120000;
// Authenticate the native importer's scalar fields before Worker structured
// cloning (which can invoke getters on untrusted nested objects). Copy eligible
// AST source bytes once, before the first await or advisory progress callback;
// a later callback must not change the unprocessed scripts being examined.
// A bad direct native call returns [] before spawning any workers or progress.
const NATIVE_BYTE_LENGTH=Object.getOwnPropertyDescriptor(
 Object.getPrototypeOf(Uint8Array.prototype),'byteLength')?.get;
function snapshotNativeAstBatch(input:unknown):Script[]|null{
 try{
  if(nodeTypes.isProxy(input)||!Array.isArray(input)||
     Object.getPrototypeOf(input)!==Array.prototype)return null;
  const arrayFields=Object.getOwnPropertyDescriptors(input) as
   Record<string,PropertyDescriptor|undefined>;
  const count:unknown=arrayFields['length']?.value;
  if(!Number.isSafeInteger(count)||(count as number)<0||
     (count as number)>MAX_SELECTED_FILES)return null;
  if(Reflect.ownKeys(arrayFields).length!==(count as number)+1)return null;
  const safe:Script[]=[];
  let copiedBytes=0;
  for(let i=0;i<(count as number);i++){
   const slot=arrayFields[String(i)];
   if(!slot||!Object.prototype.hasOwnProperty.call(slot,'value'))return null;
   const item:unknown=slot.value;
   if(!item||typeof item!=='object'||nodeTypes.isProxy(item)||
      Object.getPrototypeOf(item)!==Object.prototype)return null;
   const fields=Object.getOwnPropertyDescriptors(item) as
    Record<string,PropertyDescriptor|undefined>;
   const byteField=fields['bytes'];
   const encodingField=fields['textEncoding'];
   if(!byteField||!encodingField||
      !Object.prototype.hasOwnProperty.call(byteField,'value')||
      !Object.prototype.hasOwnProperty.call(encodingField,'value'))
    return null;
   const encoding:unknown=encodingField.value;
   if(encoding!=='utf-8'&&encoding!=='utf-8-bom'&&
      encoding!=='utf-16le-bom'&&encoding!=='utf-16be-bom'&&
      encoding!=='gb18030-explicit')return null;
   const bytes:unknown=byteField.value;
   if(nodeTypes.isProxy(bytes)||!(bytes instanceof Uint8Array)||
      !NATIVE_BYTE_LENGTH||
      Object.prototype.hasOwnProperty.call(bytes,'byteLength'))return null;
   // Intrinsic internal slot, never a caller-provided getter.
   const length=NATIVE_BYTE_LENGTH.call(bytes) as number;
   if(!Number.isSafeInteger(length)||length<0)return null;
   // Scripts larger than the per-file AST budget are never sent to a worker.
   // Do not copy entire oversized scripts merely to report SKIPPED_TOO_LARGE.
   let stableBytes=bytes;
   if(length<=MAX_ANALYSIS_BYTES){
    // The native importer already enforces this 128 MiB total byte cap;
    // reject forged direct calls before allocating an unbounded snapshot.
    if(copiedBytes+length>MAX_TOTAL_IMPORTED_BYTES)return null;
    copiedBytes+=length;
    stableBytes=new Uint8Array(bytes);
   }
   safe.push({bytes:stableBytes,textEncoding:encoding});
  }
  return safe;
 }catch{return null;}
}


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
 if(!value||typeof value!=='object'||nodeTypes.isProxy(value)||Array.isArray(value))return null;
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
 if(nodeTypes.isProxy(value)||!Array.isArray(value)||value.length!==count||
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
 scripts:readonly Script[],signal?:AbortSignal,
 workerDeadlineMs=WORKER_DEADLINE_MS
):Promise<ImportAnalysisPreview[]>{
 const selected:Script[]=[];
 const slots:(number|null)[]=[];
 const output:ImportAnalysisPreview[]=[];
 let usedBytes=0;
 for(const script of scripts){
  // An oversized native-imported Uint8Array is intentionally not copied.
  // Read its intrinsic slot, not a subclass prototype's arbitrary getter,
  // before deciding that it must stay outside the isolated AST Worker.
  const size=script?.bytes instanceof Uint8Array&&NATIVE_BYTE_LENGTH
   ?NATIVE_BYTE_LENGTH.call(script.bytes) as number:Infinity;
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
 // Instrument constructor+online time without changing the existing
 // per-segment 10-second or overall 120-second fail-closed deadline.
 const startedAt=performance.now();
 let worker:Worker;
 try{
  worker=new Worker(join(__dirname,'import-preview-worker.js'),{
   workerData:selected,
   resourceLimits:{maxOldGenerationSizeMb:96,maxYoungGenerationSizeMb:16}
  });
 }catch{
  reportWorkerFailure('START_FAILED',selected.length,startedAt,null);
  return output;
 }
 const result=await new Promise<ImportAnalysisPreview[]|null>(resolve=>{
  let finished=false;
  let timer:NodeJS.Timeout|undefined;
  let onlineAt:number|null=null;
  const finish=(answer:ImportAnalysisPreview[]|null,stopWorker:boolean,
   reason?:WorkerFailureReason)=>{
   if(finished)return;
   finished=true;
   if(reason)reportWorkerFailure(reason,selected.length,startedAt,onlineAt);
   if(timer)clearTimeout(timer);
   signal?.removeEventListener('abort',cancel);
   if(stopWorker)void worker.terminate().catch(()=>undefined);
   resolve(answer);
  };
  const cancel=()=>finish(null,true);
  worker.on('online',()=>{
   if(!finished&&onlineAt===null)onlineAt=performance.now();
  });
  worker.on('message',(value:unknown)=>{
   const checked=validateIsolatedPreviewReply(value,selected.length);
   finish(checked,checked===null,checked===null?'REPLY_REJECTED':undefined);
  });
  worker.on('error',()=>finish(null,true,'WORKER_ERROR'));
  worker.on('exit',()=>finish(null,false,'EXIT_BEFORE_MESSAGE'));
  signal?.addEventListener('abort',cancel,{once:true});
  timer=setTimeout(()=>finish(null,true,'DEADLINE'),workerDeadlineMs);
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

/** A forged cancellation object can run arbitrary getters/listener hooks.
 * Only a native AbortSignal (with no own shadows) may affect worker lifetime.
 * Invalid direct-caller signals are refused before reading script contents,
 * dispatching workers or touching untrusted signal properties.
 */
function isNativeWorkerAbortSignal(value:unknown):value is AbortSignal{
 try{
  if(!value||typeof value!=='object'||nodeTypes.isProxy(value)||
     Object.getPrototypeOf(value)!==AbortSignal.prototype||
     ['aborted','addEventListener','removeEventListener'].some(name=>
       Object.prototype.hasOwnProperty.call(value,name)))return false;
  const getter=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted')?.get;
  return typeof getter==='function'&&typeof getter.call(value)==='boolean';
 }catch{return false;}
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
 // This exported boundary accepts only trusted native cancellation handles.
 // [] is the fail-closed refusal for an invalid direct native-batch request,
 // matching the existing over-capacity direct-caller rejection below.
 if(signal!==undefined&&!isNativeWorkerAbortSignal(signal))return [];
 // Validate and snapshot direct native records before reading .length, .slice,
 // any element/bytes properties or letting an advisory callback run.
 // Eligible bytes have an independent bounded copy before asynchronous work.
 const nativeScripts=snapshotNativeAstBatch(scripts);
 if(nativeScripts===null)return [];
 const results:ImportAnalysisPreview[]=[];
 const stopAt=Date.now()+MAX_TOTAL_PREVIEW_MS;
 for(let offset=0;offset<nativeScripts.length;offset+=MAX_BATCH_PREVIEW_FILES){
  const segment=nativeScripts.slice(offset,offset+MAX_BATCH_PREVIEW_FILES);
  if(signal?.aborted||Date.now()>=stopAt){
   const status=signal?.aborted
    ?'SKIPPED_CANCELLED' as const:'SKIPPED_BATCH_BUDGET' as const;
   for(const script of segment){
    const bytes=script?.bytes;
    // Preserve oversized skip status on cancellation without calling
    // an un-copied Uint8Array subclass's inherited byteLength getter.
    results.push(bytes instanceof Uint8Array&&NATIVE_BYTE_LENGTH&&
      (NATIVE_BYTE_LENGTH.call(bytes) as number)<=MAX_ANALYSIS_BYTES
       ?unavailableImportPreview(status,'NOT_CHECKED')
       :unavailableImportPreview('SKIPPED_TOO_LARGE','NOT_CHECKED'));
   }
   // Skipped positions are still accounted for in the progress denominator.
   try{onProgress?.(results.length,nativeScripts.length);}
   catch{/* advisory progress only */}
   continue;
  }
  // No overlapping workers, hidden unbounded queue or user-code execution:
  // every segment has at most 10s, with a 120s total batch deadline.
  // The 16-file/1MiB copied-byte limit remains unchanged.
  const remainingMs=Math.max(1,stopAt-Date.now());
  results.push(...await previewImportedChunkOffMain(segment,signal,
   Math.min(WORKER_DEADLINE_MS,remainingMs)));
  // A native import's UI may show finite, scalar-only AST progress.
  // No source bytes, file names or selective-analysis results cross this callback.
  try{onProgress?.(results.length,nativeScripts.length);}
  catch{/* progress is advisory; it cannot affect isolated parsing */}
 }
 return results;
}
