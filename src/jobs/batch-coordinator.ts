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
type Options={count:number;maxAttempts?:number;concurrency?:number};
const MAX_JOBS=1000;
const MAX_CONCURRENCY=2;
const MAX_ATTEMPTS=3;
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
}
function validateOptions(options:Options):Required<Options>{
 const value=exactData(options,options.maxAttempts===undefined&&options.concurrency===undefined
   ?['count']:options.maxAttempts===undefined?['count','concurrency']:
    options.concurrency===undefined?['count','maxAttempts']:
    ['count','maxAttempts','concurrency']);
 if(!value)throw Error('INVALID_BATCH_OPTIONS');
 const count=value.count;
 const maxAttempts=value.maxAttempts??2;
 const concurrency=value.concurrency??1;
 if(typeof count!=='number'||!Number.isSafeInteger(count)||count<1||
    count>MAX_JOBS||typeof maxAttempts!=='number'||
    !Number.isSafeInteger(maxAttempts)||maxAttempts<1||
    maxAttempts>MAX_ATTEMPTS||typeof concurrency!=='number'||
    !Number.isSafeInteger(concurrency)||concurrency<1||
    concurrency>MAX_CONCURRENCY)throw Error('INVALID_BATCH_OPTIONS');
 return {count,maxAttempts,concurrency};
}
/** No checkpoint contains a script name or an event log. A caller must not
 * treat this mutable progress format as a signed, persistent audit ledger.
 */
function validateCheckpoint(input:unknown,opts:Required<Options>):MutableJob[]{
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
 const jobs:MutableJob[]=[];
 for(let i=0;i<opts.count;i++){
  const job=exactData(top.jobs[i],['ordinal','state','attempts']);
  if(!job||job.ordinal!==i||!validState.has(job.state as BatchJobState)||
     typeof job.attempts!=='number'||!Number.isSafeInteger(job.attempts)||
     job.attempts<0||job.attempts>opts.maxAttempts||
     ((job.state==='RUNNING'||job.state==='SUCCEEDED'||job.state==='FAILED')&&
      job.attempts===0))
    throw Error('INVALID_BATCH_CHECKPOINT');
  // A killed read-only job may be retried at most within the original limit.
  // A completed job is never replayed just because the process restarted.
  const state=job.state==='RUNNING'
    ?(job.attempts===opts.maxAttempts?'FAILED':'QUEUED')
    :job.state as BatchJobState;
  jobs.push({ordinal:i,state,attempts:job.attempts});
 }
 return jobs;
}
export class ReadOnlyBatchCoordinator{
 private readonly jobs:MutableJob[];
 private readonly maxAttempts:number;
 private readonly concurrency:number;
 private readonly worker:ReadOnlyWorker;
 private controller:AbortController|null=null;
 private inFlight:Promise<ReadOnlyBatchSnapshot>|null=null;
 constructor(options:Options,worker:ReadOnlyWorker,checkpoint?:unknown){
  const opts=validateOptions(options);
  if(typeof worker!=='function')throw Error('INVALID_BATCH_WORKER');
  this.maxAttempts=opts.maxAttempts;
  this.concurrency=opts.concurrency;
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
    try{outcome=await this.worker(job.ordinal,controller.signal);}
    catch{ /* a thrown error is not proven transient; do not retry */ }
    if(controller.signal.aborted)job.state='CANCELLED';
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
