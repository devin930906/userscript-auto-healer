/**
 * TASK-013 / REQ-022 / TEST-022 (stage 1): bounded, in-memory coordination
 * for a TRUSTED, native read-only worker. No user script source, path, URL,
 * credentials, patch application, manager installation or privileged IPC
 * is accepted by this queue. Integrate the authenticated worker separately.
 *
 * This checkpoint is a non-authoritative scheduling hint. Neither "DONE"
 * nor a resumed checkpoint verifies a userscript, Tampermonkey, or recovery.
 * Schema v2 rejects v1 snapshots because v1 did not bind timeoutMs. An
 * untrusted or obsolete checkpoint must never authorize skipping any job.
 */
import {createHash} from 'node:crypto';
import {types as nodeTypes} from 'node:util';

export type ReadOnlyWorkResult='DONE'|'RETRYABLE_FAILURE'|'PERMANENT_FAILURE';
export type BatchJobState='QUEUED'|'RUNNING'|'SUCCEEDED'|'FAILED'|'CANCELLED';
export interface BatchJobSnapshot{
 readonly ordinal:number;
 readonly state:BatchJobState;
 readonly attempts:number;
}
export interface ReadOnlyBatchSnapshot{
 readonly schema:'uah-readonly-batch-v2';
 readonly phase:'SCHEDULING_ONLY_UNVERIFIED';
 readonly maxAttempts:number;
 readonly concurrency:number;
 /** Native read-only deadline must not silently change during resume. */
 readonly timeoutMs:number;
 /** A non-authenticating SHA-256 commitment to the ordered imported script identities. */
 readonly batchFingerprint:string|null;
 readonly jobs:readonly BatchJobSnapshot[];
 readonly automaticPatchAllowed:false;
 readonly automaticRollbackAllowed:false;
 readonly tampermonkeyVerified:false;
 readonly businessVerified:false;
}
export type ReadOnlyWorker=(ordinal:number,signal:AbortSignal)=>Promise<ReadOnlyWorkResult>;
interface MutableJob{ordinal:number;state:BatchJobState;attempts:number}
type Options={count:number;maxAttempts?:number;concurrency?:number;timeoutMs?:number;
 /** Native-validated, ordered script byte hashes, never names or paths. */
 jobHashes?:readonly string[]};
type ValidatedOptions={count:number;maxAttempts:number;concurrency:number;
 timeoutMs:number;batchFingerprint:string|null};
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
 if(!input||typeof input!=='object'||nodeTypes.isProxy(input)||Array.isArray(input))return null;
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
/** An unbound positional snapshot cannot safely skip work for a new batch.
 * A digest protects against accidental cross-batch replay, NOT intentional
 * forgery of the mutable snapshot. It never grants repair or file authority.
 */
function fingerprintHashes(input:unknown,count:number):string|null {
 if(input===undefined)return null;
 if(nodeTypes.isProxy(input)||!Array.isArray(input)||input.length!==count||
    Object.getPrototypeOf(input)!==Array.prototype)
   throw Error('INVALID_BATCH_OPTIONS');
 const descriptors=Object.getOwnPropertyDescriptors(input);
 if(Reflect.ownKeys(descriptors).length!==count+1)
   throw Error('INVALID_BATCH_OPTIONS');
 const seen=new Set<string>();
 const hash=createHash('sha256').update('uah-readonly-batch-identities-v1\0');
 for(let i=0;i<count;i++){
  const slot=descriptors[String(i)];
  if(!slot||!Object.prototype.hasOwnProperty.call(slot,'value')||
     typeof slot.value!=='string'||!/^[0-9a-f]{64}$/.test(slot.value)||
     seen.has(slot.value))
   throw Error('INVALID_BATCH_OPTIONS');
  seen.add(slot.value);
  hash.update(slot.value);
 }
 return hash.digest('hex');
}
function validateOptions(options:Options):ValidatedOptions{
 try{
 // Inspect own descriptors first; never invoke accessor properties while
 // validating potentially hostile batch options.
 if(!options||typeof options!=='object'||nodeTypes.isProxy(options)||Array.isArray(options))
   throw Error('INVALID_BATCH_OPTIONS');
 const descriptors=Object.getOwnPropertyDescriptors(options);
 const allowed=['count','maxAttempts','concurrency','timeoutMs','jobHashes'] as const;
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
 return {count,maxAttempts,concurrency,timeoutMs,
  batchFingerprint:fingerprintHashes(value.jobHashes,count)};
 }catch{throw Error('INVALID_BATCH_OPTIONS');}
}
/** No checkpoint contains a script name or an event log. A caller must not
 * treat this mutable progress format as a signed, persistent audit ledger.
 */
function validateCheckpoint(input:unknown,opts:ValidatedOptions,
 normalizeInterrupted=true):MutableJob[]{
 try{
 const top=exactData(input,[
  'schema','phase','maxAttempts','concurrency','timeoutMs','batchFingerprint','jobs',
  'automaticPatchAllowed','automaticRollbackAllowed',
  'tampermonkeyVerified','businessVerified'
 ]);
 if(!top||top.schema!=='uah-readonly-batch-v2'||
    top.phase!=='SCHEDULING_ONLY_UNVERIFIED'||
    top.maxAttempts!==opts.maxAttempts||top.concurrency!==opts.concurrency||
    top.timeoutMs!==opts.timeoutMs||
    opts.batchFingerprint===null||top.batchFingerprint!==opts.batchFingerprint||
    top.automaticPatchAllowed!==false||top.automaticRollbackAllowed!==false||
    top.tampermonkeyVerified!==false||top.businessVerified!==false||
    nodeTypes.isProxy(top.jobs)||!Array.isArray(top.jobs)||top.jobs.length!==opts.count)
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
  // Only a PROCESS RESTART turns an interrupted attempt into queued/failed.
  // Persistence comparison must preserve a live RUNNING terminal attempt:
  // it may still succeed before the worker returns, even at maxAttempts.
  const state=normalizeInterrupted&&job.state==='RUNNING'
    ?(job.attempts===opts.maxAttempts?'FAILED':'QUEUED')
    :job.state as BatchJobState;
  jobs.push({ordinal:i,state,attempts:job.attempts});
 }
 return jobs;
 }catch{throw Error('INVALID_BATCH_CHECKPOINT');}
}
export class ReadOnlyBatchCoordinator{
 /** A runtime brand, not a forgeable prototype or TypeScript-only type. */
 readonly #nativeBrand=true;
 /** Native journal entrypoints must reject prototype-spoofed objects and
  * Proxy wrappers without invoking user-defined reflection traps. */
 static isNativeInstance(value:unknown):value is ReadOnlyBatchCoordinator{
  return typeof value==='object'&&value!==null&&
   !nodeTypes.isProxy(value)&&#nativeBrand in value&&
   Object.getPrototypeOf(value)===ReadOnlyBatchCoordinator.prototype;
 }
 private readonly jobs:MutableJob[];
 private readonly maxAttempts:number;
 private readonly concurrency:number;
 private readonly timeoutMs:number;
 private readonly batchFingerprint:string|null;
 private readonly worker:ReadOnlyWorker;
 private controller:AbortController|null=null;
 private inFlight:Promise<ReadOnlyBatchSnapshot>|null=null;
 constructor(options:Options,worker:ReadOnlyWorker,checkpoint?:unknown){
  const opts=validateOptions(options);
  if(typeof worker!=='function')throw Error('INVALID_BATCH_WORKER');
  this.maxAttempts=opts.maxAttempts;
  this.concurrency=opts.concurrency;
  this.timeoutMs=opts.timeoutMs;
  this.batchFingerprint=opts.batchFingerprint;
  this.worker=worker;
  this.jobs=checkpoint===undefined
    ?Array.from({length:opts.count},(_,ordinal)=>({
       ordinal,state:'QUEUED' as BatchJobState,attempts:0
      }))
    :validateCheckpoint(checkpoint,opts);
 }
 snapshot():ReadOnlyBatchSnapshot{
  return Object.freeze({
   schema:'uah-readonly-batch-v2' as const,
   phase:'SCHEDULING_ONLY_UNVERIFIED' as const,
   maxAttempts:this.maxAttempts,
   concurrency:this.concurrency,
   timeoutMs:this.timeoutMs,
   batchFingerprint:this.batchFingerprint,
   jobs:Object.freeze(this.jobs.map(job=>Object.freeze({...job}))),
   ...authority
  });
 }
 /** Native journal write guard: never allow an older or foreign batch
  * snapshot to overwrite a later persisted scheduling hint.
  * This is NOT checkpoint authentication and grants no script authority.
  * Persistence compares the original RUNNING state without restart
  * normalization; only constructor recovery turns an interrupted attempt into
  * QUEUED or FAILED according to its retry budget.
  */
 mayPersistOver(previous:unknown):boolean{
  let persisted:MutableJob[];
  try{
   persisted=validateCheckpoint(previous,{
    count:this.jobs.length,
    maxAttempts:this.maxAttempts,concurrency:this.concurrency,
    timeoutMs:this.timeoutMs,batchFingerprint:this.batchFingerprint
   },false);
  }catch{return false;}
  return persisted.every((old,i)=>{
   const current=this.jobs[i];
   if(current.attempts<old.attempts)return false;
   // Once a job has a persisted terminal outcome, a stale process must
   // never erase it, change its outcome, or replay its attempt count.
   if(old.state==='SUCCEEDED'||old.state==='FAILED'||old.state==='CANCELLED')
    return current.state===old.state&&current.attempts===old.attempts;
   return true;
  });
 }
 cancel():void{
  this.controller?.abort();
  for(const job of this.jobs){
   if(job.state==='QUEUED')job.state='CANCELLED';
  }
 }
 /** Multiple ordinary run calls share one promise; no duplicate dispatch.
  * Native-only opt-in checkpoint callbacks are deliberately serialized:
  * a running job is persisted BEFORE the trusted read-only worker starts,
  * and its result is persisted BEFORE another job is dispatched. Concurrent
  * checkpoint writers are unsupported and fail closed, never downgraded.
  * Only trusted native code may supply this callback; it grants no script
  * write, browser, manager or rollback permissions.
  */
 run(onTransition?:()=>Promise<void>):Promise<ReadOnlyBatchSnapshot>{
  if(onTransition!==undefined&&
     (typeof onTransition!=='function'||this.concurrency!==1))
   return Promise.reject(Error('INVALID_CHECKPOINT_CALLBACK'));
  if(this.inFlight){
   if(onTransition)return Promise.reject(Error('BATCH_ALREADY_RUNNING'));
   return this.inFlight;
  }
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
    if(onTransition){
     try{await onTransition();}
     catch{
      // No worker may start when its RUNNING attempt was not durable.
      this.cancel();
      job.state='CANCELLED';
      throw Error('CHECKPOINT_FAILED');
     }
     if(controller.signal.aborted){
      job.state='CANCELLED';
      try{await onTransition();}
      catch{
       // The cancellation checkpoint is not durable. Never leak the
       // underlying storage error or begin another read-only worker.
       this.cancel();
       throw Error('CHECKPOINT_FAILED');
      }
      return;
     }
    }
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
    if(onTransition){
     try{await onTransition();}
     catch{
      // The worker may already have settled, but a failed journal update
      // must stop later jobs. A crash-time RUNNING record can only replay a
      // trusted read-only worker, never a script mutation or auto-repair.
      this.cancel();
      throw Error('CHECKPOINT_FAILED');
     }
    }
   }
  };
  this.inFlight=Promise.all(Array.from({length:this.concurrency},()=>lane()))
   .then(()=>this.snapshot())
   .finally(()=>{this.controller=null;this.inFlight=null;});
  return this.inFlight;
 }
}
