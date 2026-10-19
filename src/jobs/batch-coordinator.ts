/**
 * TASK-013 / REQ-022 / TEST-022 (stage 1): bounded, in-memory coordination
 * for a TRUSTED, native read-only worker. No user script source, path, URL,
 * credentials, patch application, manager installation or privileged IPC
 * is accepted by this queue. Integrate the authenticated worker separately.
 *
 * This checkpoint is a non-authoritative scheduling hint. Neither "DONE"
 * nor a resumed checkpoint verifies a userscript, Tampermonkey, or recovery.
 */
export type ReadOnlyWorkResult='DONE'|'RETRYABLE_FAILURE'|'PERMANENT_FAILURE';
export type BatchJobState='QUEUED'|'RUNNING'|'SUCCEEDED'|'FAILED'|'CANCELLED';
export interface BatchJobSnapshot{
 readonly ordinal:number;
 readonly state:BatchJobState;
 readonly attempts:number;
}
export interface ReadOnlyBatchSnapshot{
 readonly schema:'uah-readonly-batch-v1';
 readonly phase:'SCHEDULING_ONLY_UNVERIFIED';
 readonly maxAttempts:number;
 readonly concurrency:number;
 readonly jobs:readonly BatchJobSnapshot[];
 readonly automaticPatchAllowed:false;
 readonly automaticRollbackAllowed:false;
 readonly tampermonkeyVerified:false;
 readonly businessVerified:false;
}
export type ReadOnlyWorker=(ordinal:number,signal:AbortSignal)=>Promise<ReadOnlyWorkResult>;
interface MutableJob{ordinal:number;state:BatchJobState;attempts:number}
type Options={count:number;maxAttempts?:number;concurrency?:number;timeoutMs?:number};
const MAX_JOBS=1000;
const MAX_CONCURRENCY=2;
const MAX_ATTEMPTS=3;
const MIN_TIMEOUT_MS=25;
const MAX_TIMEOUT_MS=300000;
const DEFAULT_TIMEOUT_MS=30000;
const validState=new Set<BatchJobState>([
 'QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED'
]);
const authority={
 automaticPatchAllowed:false as const,
 automaticRollbackAllowed:false as const,
 tampermonkeyVerified:false as const,
 businessVerified:false as const
};
function exactData(input:unknown,keys:readonly string[]):Record<string,unknown>|null{
 // Hostile Proxies can throw during descriptor or prototype inspection.
 // Treat them as invalid input, never propagate their arbitrary errors.
 try{
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 const proto=Object.getPrototypeOf(input);
 if(proto!==Object.prototype&&proto!==null)return null;
 const descriptors=Object.getOwnPropertyDescriptors(input);
 const own=Reflect.ownKeys(descriptors);
 if(own.length!==keys.length||own.some(k=>typeof k!=='string')||
   keys.some(k=>!Object.prototype.hasOwnProperty.call(descriptors,k)||
      !Object.prototype.hasOwnProperty.call(descriptors[k],'value')))return null;
 const output:Record<string,unknown>=Object.create(null);
 for(const key of keys)output[key]=descriptors[key].value;
 return output;
 }catch{return null;}
}
function validateOptions(options:Options):Required<Options>{
 try{
 // Inspect own descriptors first; never invoke accessor properties while
 // validating potentially hostile batch options.
 if(!options||typeof options!=='object'||Array.isArray(options))
   throw Error('INVALID_BATCH_OPTIONS');
 const descriptors=Object.getOwnPropertyDescriptors(options);
 const allowed=['count','maxAttempts','concurrency','timeoutMs'] as const;
 const keys=Reflect.ownKeys(descriptors);
 if(!Object.prototype.hasOwnProperty.call(descriptors,'count')||
    keys.length>allowed.length||
    keys.some(key=>typeof key!=='string'||!allowed.includes(key as typeof allowed[number])))
   throw Error('INVALID_BATCH_OPTIONS');
 const value=exactData(options,keys as string[]);
 if(!value)throw Error('INVALID_BATCH_OPTIONS');
 const count=value.count;
 const maxAttempts=value.maxAttempts??2;
 const concurrency=value.concurrency??1;
 const timeoutMs=value.timeoutMs??DEFAULT_TIMEOUT_MS;
 if(typeof count!=='number'||!Number.isSafeInteger(count)||count<1||
    count>MAX_JOBS||typeof maxAttempts!=='number'||
    !Number.isSafeInteger(maxAttempts)||maxAttempts<1||
    maxAttempts>MAX_ATTEMPTS||typeof concurrency!=='number'||
    !Number.isSafeInteger(concurrency)||concurrency<1||
    concurrency>MAX_CONCURRENCY||typeof timeoutMs!=='number'||
    !Number.isSafeInteger(timeoutMs)||timeoutMs<MIN_TIMEOUT_MS||
    timeoutMs>MAX_TIMEOUT_MS)throw Error('INVALID_BATCH_OPTIONS');
 return {count,maxAttempts,concurrency,timeoutMs};
 }catch{throw Error('INVALID_BATCH_OPTIONS');}
}
/** No checkpoint contains a script name or an event log. A caller must not
 * treat this mutable progress format as a signed, persistent audit ledger.
 */
function validateCheckpoint(input:unknown,opts:Required<Options>):MutableJob[]{
 try{
 const top=exactData(input,[
  'schema','phase','maxAttempts','concurrency','jobs',
  'automaticPatchAllowed','automaticRollbackAllowed',
  'tampermonkeyVerified','businessVerified'
 ]);
 if(!top||top.schema!=='uah-readonly-batch-v1'||
    top.phase!=='SCHEDULING_ONLY_UNVERIFIED'||
    top.maxAttempts!==opts.maxAttempts||top.concurrency!==opts.concurrency||
    top.automaticPatchAllowed!==false||top.automaticRollbackAllowed!==false||
    top.tampermonkeyVerified!==false||top.businessVerified!==false||
    !Array.isArray(top.jobs)||top.jobs.length!==opts.count)
   throw Error('INVALID_BATCH_CHECKPOINT');
 // Checkpoint arrays are untrusted: accessor-backed elements can have
 // side effects, and sparse/extra properties must never be accepted.
 const entries=top.jobs as unknown[];
 if(Object.getPrototypeOf(entries)!==Array.prototype)
   throw Error('INVALID_BATCH_CHECKPOINT');
 const slots=Object.getOwnPropertyDescriptors(entries);
 if(Reflect.ownKeys(slots).length!==opts.count+1)
   throw Error('INVALID_BATCH_CHECKPOINT');
 const jobs:MutableJob[]=[];
 for(let i=0;i<opts.count;i++){
  const slot=slots[String(i)];
  if(!slot||!Object.prototype.hasOwnProperty.call(slot,'value'))
    throw Error('INVALID_BATCH_CHECKPOINT');
  const job=exactData(slot.value,['ordinal','state','attempts']);
  if(!job||job.ordinal!==i||!validState.has(job.state as BatchJobState)||
     typeof job.attempts!=='number'||!Number.isSafeInteger(job.attempts)||
     job.attempts<0||job.attempts>opts.maxAttempts||
     ((job.state==='RUNNING'||job.state==='SUCCEEDED'||job.state==='FAILED')&&
      job.attempts===0)||
     (job.state==='QUEUED'&&job.attempts===opts.maxAttempts))
    throw Error('INVALID_BATCH_CHECKPOINT');
  // A killed read-only job may be retried at most within the original limit.
  // A completed job is never replayed just because the process restarted.
  const state=job.state==='RUNNING'
    ?(job.attempts===opts.maxAttempts?'FAILED':'QUEUED')
    :job.state as BatchJobState;
  jobs.push({ordinal:i,state,attempts:job.attempts});
 }
 return jobs;
 }catch{throw Error('INVALID_BATCH_CHECKPOINT');}
}
export class ReadOnlyBatchCoordinator{
 private readonly jobs:MutableJob[];
 private readonly maxAttempts:number;
 private readonly concurrency:number;
 private readonly timeoutMs:number;
 private readonly worker:ReadOnlyWorker;
 private controller:AbortController|null=null;
 private inFlight:Promise<ReadOnlyBatchSnapshot>|null=null;
 constructor(options:Options,worker:ReadOnlyWorker,checkpoint?:unknown){
  const opts=validateOptions(options);
  if(typeof worker!=='function')throw Error('INVALID_BATCH_WORKER');
  this.maxAttempts=opts.maxAttempts;
  this.concurrency=opts.concurrency;
  this.timeoutMs=opts.timeoutMs;
  this.worker=worker;
  this.jobs=checkpoint===undefined
    ?Array.from({length:opts.count},(_,ordinal)=>({
       ordinal,state:'QUEUED' as BatchJobState,attempts:0
      }))
    :validateCheckpoint(checkpoint,opts);
 }
 snapshot():ReadOnlyBatchSnapshot{
  return Object.freeze({
   schema:'uah-readonly-batch-v1' as const,
   phase:'SCHEDULING_ONLY_UNVERIFIED' as const,
   maxAttempts:this.maxAttempts,
   concurrency:this.concurrency,
   jobs:Object.freeze(this.jobs.map(job=>Object.freeze({...job}))),
   ...authority
  });
 }
 cancel():void{
  this.controller?.abort();
  for(const job of this.jobs){
   if(job.state==='QUEUED')job.state='CANCELLED';
  }
 }
 /** Multiple run calls share one promise; no duplicate dispatch. */
 run():Promise<ReadOnlyBatchSnapshot>{
  if(this.inFlight)return this.inFlight;
  const controller=new AbortController();
  this.controller=controller;
  const take=():MutableJob|undefined=>{
   if(controller.signal.aborted)return undefined;
   const job=this.jobs.find(j=>j.state==='QUEUED');
   if(!job)return undefined;
   job.state='RUNNING';
   job.attempts++;
   return job;
  };
  const lane=async()=>{
   while(true){
    const job=take();
    if(!job)return;
    let outcome:ReadOnlyWorkResult='PERMANENT_FAILURE';
    let timedOut=false;
    let deadline:NodeJS.Timeout|undefined;
    // A cooperative read-only worker may ignore AbortSignal forever. Do not
    // hold the entire batch open after cancellation, and never accept its
    // late success. The underlying worker cannot be forcibly stopped here;
    // callers MUST keep it trusted, read-only and independently cancellable.
    let removeAbortListener=()=>{};
    const cancelled=new Promise<undefined>(resolve=>{
     if(controller.signal.aborted){resolve(undefined);return;}
     const onAbort=()=>resolve(undefined);
     controller.signal.addEventListener('abort',onAbort,{once:true});
     removeAbortListener=()=>controller.signal.removeEventListener('abort',onAbort);
    });
    // A worker which never settles cannot hold the scheduling promise
    // indefinitely. Timeout is a batch-wide fail-closed stop: its promise
    // may still be running, so never dispatch a replacement and violate
    // the in-flight concurrency limit. No late result gains authority.
    const deadlineReached=new Promise<undefined>(resolve=>{
     deadline=setTimeout(()=>{
      timedOut=true;
      this.cancel();
      resolve(undefined);
     },this.timeoutMs);
    });
    try{
     const settled=await Promise.race([
      this.worker(job.ordinal,controller.signal),
      cancelled,
      deadlineReached
     ]);
     if(settled!==undefined)outcome=settled;
    }catch{ /* unknown worker errors are permanent, never trusted as transient */ }
    finally{
     if(deadline)clearTimeout(deadline);
     removeAbortListener();
    }
    if(timedOut)job.state='FAILED';
    else if(controller.signal.aborted)job.state='CANCELLED';
    else if(outcome==='DONE')job.state='SUCCEEDED';
    else if(outcome==='RETRYABLE_FAILURE'&&job.attempts<this.maxAttempts)
      job.state='QUEUED';
    else job.state='FAILED';
   }
  };
  this.inFlight=Promise.all(Array.from({length:this.concurrency},()=>lane()))
   .then(()=>this.snapshot())
   .finally(()=>{this.controller=null;this.inFlight=null;});
  return this.inFlight;
 }
}
