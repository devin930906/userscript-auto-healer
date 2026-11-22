/** Main-owned index of bounded AST hints for later consented DOM-only checks.
 * This index contains neither source bytes nor file paths and grants no browser
 * or userscript authority by itself. */
import {types as nodeTypes} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {matchingExactOriginPattern} from '../manager/tampermonkey-preflight';
import {normalizeScenarioTargetUrl} from '../scenarios/scenario-registry';
import type {ImportedDomDiagnosticHints} from '../analyze/import-preview';

const HASH=/^[a-f0-9]{64}$/;
const MAX_IMPORTED_SCRIPTS=1000;
const MAX_MATCH_PATTERNS=16;
const MAX_SELECTOR_SITES=8;
const MAX_SELECTOR_LENGTH=256;
const MAX_CANDIDATE_SOURCE_BYTES=256*1024;
const MAX_CANDIDATE_SOURCE_BYTES_PER_WINDOW=16*1024*1024;
const CANDIDATE_SOURCE_TTL_MS=5*60*1000;
const MAX_CANDIDATE_EXPORT_CONTEXTS_PER_WINDOW=16;
const MAX_CANDIDATE_EXPORT_CONTEXT_TTL_MS=5*60*1000;
export type ImportedDomPlanCode=
 'INVALID_TARGET_URL'|'NO_LITERAL_SELECTORS'|'UNSUPPORTED_MATCH_RULES'|
 'NO_MATCH_METADATA'|'TARGET_NOT_MATCHED'|'SELECTOR_LIMIT_EXCEEDED';
export type ImportedDomPlanItem=
 |Readonly<{ordinal:number;scriptSha256:string;status:'READY_FOR_INSPECTION';
   filename:string|null;targetUrl:string;
   selectorSites:readonly ImportedDomDiagnosticHints['selectorSites'][number][]}>
 |Readonly<{ordinal:number;scriptSha256:string;filename:string|null;
   status:'BLOCKED';code:ImportedDomPlanCode}>;
export interface ImportedDomPlan{
 readonly targetUrl:string|null;
 readonly items:readonly ImportedDomPlanItem[];
 readonly truncatedScripts:boolean;
}
interface Profile{readonly hash:string;readonly filename:string|null;
 readonly hints:ImportedDomDiagnosticHints|null}
interface CandidateSource{readonly source:string;readonly bytes:number;
 readonly expiresAt:number}
interface CandidateSourceLifecycleOptions{
 readonly candidateSourceTtlMs?:number;
 readonly setTimeout?:(callback:()=>void,delayMs:number)=>ReturnType<typeof setTimeout>;
 readonly clearTimeout?:(timer:ReturnType<typeof setTimeout>)=>void;
}

function safeCandidateSource(value:unknown,hash:string):Omit<CandidateSource,'expiresAt'>|null{
 if(typeof value!=='string'||value.length===0||value.charCodeAt(0)===0xfeff)return null;
 if(Buffer.byteLength(value,'utf8')>MAX_CANDIDATE_SOURCE_BYTES)return null;
 const bytes=Buffer.from(value,'utf8');
 try{
  const decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(decoded!==value||createHash('sha256').update(bytes).digest('hex')!==hash)return null;
 }catch{return null;}
 return {source:value,bytes:bytes.length};
}

function ownData(value:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!value||typeof value!=='object'||nodeTypes.isProxy(value)||Array.isArray(value))return null;
  const proto=Object.getPrototypeOf(value);
  if(proto!==Object.prototype&&proto!==null)return null;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  const own=Reflect.ownKeys(descriptors);
  if(own.length!==keys.length||own.some(key=>typeof key!=='string')||
     keys.some(key=>!Object.prototype.hasOwnProperty.call(descriptors,key)||
       !Object.prototype.hasOwnProperty.call(descriptors[key],'value')))return null;
  const copy:Record<string,unknown>=Object.create(null);
  for(const key of keys)copy[key]=descriptors[key].value;
  return copy;
 }catch{return null;}
}
function ownArray(value:unknown,maximum:number):unknown[]|null{
 try{
  if(nodeTypes.isProxy(value)||!Array.isArray(value)||
     Object.getPrototypeOf(value)!==Array.prototype)return null;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  const length:unknown=Object.getOwnPropertyDescriptor(value,'length')?.value;
  if(typeof length!=='number'||!Number.isSafeInteger(length)||
     length<0||length>maximum||Reflect.ownKeys(descriptors).length!==length+1)return null;
  const result:unknown[]=[];
  for(let index=0;index<length;index++){
   const slot=descriptors[String(index)];
   if(!slot||!Object.prototype.hasOwnProperty.call(slot,'value'))return null;
   result.push(slot.value);
  }
  return result;
 }catch{return null;}
}
function snapshotHints(value:unknown):ImportedDomDiagnosticHints|null{
 const hints=ownData(value,['matchPatterns','unsupportedScope','selectorSites',
  'selectorSitesTruncated']);
 if(!hints||typeof hints.unsupportedScope!=='boolean'||
    typeof hints.selectorSitesTruncated!=='boolean')return null;
 const patterns=ownArray(hints.matchPatterns,MAX_MATCH_PATTERNS);
 const rawSites=ownArray(hints.selectorSites,MAX_SELECTOR_SITES);
 if(!patterns||!rawSites)return null;
 const matchPatterns:string[]=[];
 const seenPatterns=new Set<string>();
 for(const item of patterns){
  if(typeof item!=='string'||item.length<1||item.length>1024||
     /[\u0000-\u001f\u007f]/.test(item)||seenPatterns.has(item))return null;
  seenPatterns.add(item);matchPatterns.push(item);
 }
 const selectorSites:ImportedDomDiagnosticHints['selectorSites'][number][]=[];
 const seenSelectors=new Set<string>();
 for(const item of rawSites){
  const site=ownData(item,['offset','method','selector']);
  if(!site||typeof site.offset!=='number'||!Number.isSafeInteger(site.offset)||
     site.offset<0||site.offset>512*1024||
     (site.method!=='querySelector'&&site.method!=='querySelectorAll')||
     typeof site.selector!=='string'||site.selector.length<1||
     site.selector.length>MAX_SELECTOR_LENGTH||
     /[\u0000-\u001f\u007f]/.test(site.selector)||
     seenSelectors.has(site.selector))return null;
  seenSelectors.add(site.selector);
  selectorSites.push(Object.freeze({offset:site.offset,method:site.method,
   selector:site.selector}));
 }
 return Object.freeze({matchPatterns:Object.freeze(matchPatterns),
  unsupportedScope:hints.unsupportedScope,
  selectorSites:Object.freeze(selectorSites),
  selectorSitesTruncated:hints.selectorSitesTruncated});
}

/** The native importer calls this after it has validated the source bytes.
 * Renderer IPC has no route to this method or to this main-owned index. */
export class ImportedDomDiagnosticIndex{
 private readonly profiles=new Map<string,Profile>();
 private readonly candidateSources=new Map<string,CandidateSource>();
 private candidateSourceBytes=0;
 private candidateSourceExpiryTimer:ReturnType<typeof setTimeout>|null=null;
 private readonly candidateSourceTtlMs:number;
 private readonly scheduleTimer:(callback:()=>void,delayMs:number)=>ReturnType<typeof setTimeout>;
 private readonly cancelTimer:(timer:ReturnType<typeof setTimeout>)=>void;
 private truncatedScripts=false;
 constructor(private readonly now:()=>number=()=>performance.now(),
  lifecycle:CandidateSourceLifecycleOptions={}){
  this.candidateSourceTtlMs=typeof lifecycle.candidateSourceTtlMs==='number'&&
    Number.isFinite(lifecycle.candidateSourceTtlMs)&&lifecycle.candidateSourceTtlMs>0
      ?lifecycle.candidateSourceTtlMs:CANDIDATE_SOURCE_TTL_MS;
  this.scheduleTimer=lifecycle.setTimeout??setTimeout;
  this.cancelTimer=lifecycle.clearTimeout??clearTimeout;
 }
 private scheduleCandidateSourceExpiry():void{
  if(this.candidateSourceExpiryTimer!==null){
   this.cancelTimer(this.candidateSourceExpiryTimer);
   this.candidateSourceExpiryTimer=null;
  }
  let nextExpiry=Infinity;
  for(const entry of this.candidateSources.values())
   nextExpiry=Math.min(nextExpiry,entry.expiresAt);
  if(!Number.isFinite(nextExpiry))return;
  const delay=Math.max(0,nextExpiry-this.now());
  try{
   const timer=this.scheduleTimer(()=>{
    this.candidateSourceExpiryTimer=null;
    this.pruneCandidateSources();
   },delay);
   this.candidateSourceExpiryTimer=timer;
   timer.unref?.();
  }catch{
   // Never retain imported source text if its bounded lifetime cannot be
   // scheduled. AST-only diagnostic metadata remains available separately.
   this.clearCandidateSources();
  }
 }
 private pruneCandidateSources():void{
  const now=this.now();
  for(const [hash,entry] of this.candidateSources){
   if(entry.expiresAt<=now){
    this.candidateSources.delete(hash);
    this.candidateSourceBytes-=entry.bytes;
   }
  }
  this.scheduleCandidateSourceExpiry();
 }
 private retainCandidateSource(hash:string,source:unknown):void{
  const safe=safeCandidateSource(source,hash);
  if(!safe)return;
  this.pruneCandidateSources();
  const previous=this.candidateSources.get(hash);
  const currentBytes=this.candidateSourceBytes-(previous?.bytes??0);
  if(currentBytes+safe.bytes>MAX_CANDIDATE_SOURCE_BYTES_PER_WINDOW)return;
  this.candidateSources.set(hash,Object.freeze({source:safe.source,
   bytes:safe.bytes,expiresAt:this.now()+this.candidateSourceTtlMs}));
  this.candidateSourceBytes=currentBytes+safe.bytes;
  this.scheduleCandidateSourceExpiry();
 }
 /** Source text stays in this main-only sidecar and never enters plan output. */
 readUtf8CandidateSource(hash:unknown,expectedFilename?:unknown):string|null{
  if(typeof hash!=='string'||!HASH.test(hash))return null;
  this.pruneCandidateSources();
  const entry=this.candidateSources.get(hash);
  if(!entry)return null;
  if(expectedFilename!==undefined){
   const profile=this.profiles.get(hash);
   if(typeof expectedFilename!=='string'||!profile||profile.filename!==expectedFilename)
    return null;
  }
  return entry.source;
 }
 clearCandidateSources():void{
  if(this.candidateSourceExpiryTimer!==null){
   this.cancelTimer(this.candidateSourceExpiryTimer);
   this.candidateSourceExpiryTimer=null;
  }
  this.candidateSources.clear();
  this.candidateSourceBytes=0;
 }
 recordImported(hash:unknown,hints:unknown,filename:unknown=null,source?:unknown):void{
  if(typeof hash!=='string'||!HASH.test(hash))return;
  const previous=this.profiles.get(hash);
  if(!previous&&this.profiles.size>=MAX_IMPORTED_SCRIPTS){
   this.truncatedScripts=true;
   return;
  }
  // Retain source bytes only for a script actually tracked by this index.
  // A rejected over-cap import must not create an orphan source sidecar.
  if(source!==undefined)this.retainCandidateSource(hash,source);
  const label=typeof filename==='string'&&filename.length>0&&filename.length<=255&&
   !/[\u0000-\u001f\u007f/\\:]/.test(filename)?filename:null;
  const safeHints=hints===null||hints===undefined?null:snapshotHints(hints);
  if(previous){
   if(!previous.hints&&safeHints)
    this.profiles.set(hash,Object.freeze({hash,filename:previous.filename??label,hints:safeHints}));
   return;
  }
  this.profiles.set(hash,Object.freeze({hash,filename:label,hints:safeHints}));
 }
 plan(targetInput:unknown):ImportedDomPlan{
  const normalizedUrl=normalizeScenarioTargetUrl(targetInput);
  let target:URL|null=null;
  try{
   if(normalizedUrl){
    const parsed=new URL(normalizedUrl);
    if(!parsed.hash)target=parsed;
   }
  }catch{target=null;}
  const targetUrl=target?normalizedUrl:null;
  const items:ImportedDomPlanItem[]=[];
  let ordinal=0;
  for(const profile of this.profiles.values()){
   const base={ordinal:ordinal++,scriptSha256:profile.hash,
    filename:profile.filename} as const;
   const blocked=(code:ImportedDomPlanCode):ImportedDomPlanItem=>
    Object.freeze({...base,status:'BLOCKED' as const,code});
   if(!targetUrl||!target){items.push(blocked('INVALID_TARGET_URL'));continue;}
   const hints=profile.hints;
   if(!hints||hints.selectorSites.length===0){
    items.push(blocked('NO_LITERAL_SELECTORS'));continue;
   }
   if(hints.unsupportedScope){items.push(blocked('UNSUPPORTED_MATCH_RULES'));continue;}
   if(hints.selectorSitesTruncated){items.push(blocked('SELECTOR_LIMIT_EXCEEDED'));continue;}
   if(hints.matchPatterns.length===0){items.push(blocked('NO_MATCH_METADATA'));continue;}
   if(!hints.matchPatterns.some(pattern=>matchingExactOriginPattern(pattern,target))){
    items.push(blocked('TARGET_NOT_MATCHED'));continue;
   }
   items.push(Object.freeze({...base,status:'READY_FOR_INSPECTION' as const,
    targetUrl,selectorSites:hints.selectorSites}));
  }
  return Object.freeze({targetUrl,items:Object.freeze(items),
   truncatedScripts:this.truncatedScripts});
 }
}

interface CandidateExportStoreLifecycleOptions{
 readonly setTimeout?:(callback:()=>void,delayMs:number)=>ReturnType<typeof setTimeout>;
 readonly clearTimeout?:(timer:ReturnType<typeof setTimeout>)=>void;
}
interface CandidateExportEntry<T extends object>{
 readonly owner:object;
 readonly context:T;
 readonly expiresAt:number;
 reserved:boolean;
}
const CANDIDATE_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Main-only, window-owned, short-lived one-use handles for manual candidate
 * export. The generic context is never serialized or persisted by this store;
 * callers are responsible for supplying only the bounded review data needed
 * after a renderer receives the opaque ID. */
export class ImportedDomCandidateExportStore<T extends object>{
 private readonly entries=new Map<string,CandidateExportEntry<T>>();
 private expiryTimer:ReturnType<typeof setTimeout>|null=null;
 private timerGeneration=0;
 private readonly scheduleTimer:(callback:()=>void,delayMs:number)=>ReturnType<typeof setTimeout>;
 private readonly cancelTimer:(timer:ReturnType<typeof setTimeout>)=>void;

 constructor(private readonly now:()=>number=()=>performance.now(),
  lifecycle:CandidateExportStoreLifecycleOptions={}){
  this.scheduleTimer=lifecycle.setTimeout??setTimeout;
  this.cancelTimer=lifecycle.clearTimeout??clearTimeout;
 }

 private clearTimer():void{
  this.timerGeneration++;
  if(this.expiryTimer!==null){
   this.cancelTimer(this.expiryTimer);
   this.expiryTimer=null;
  }
 }

 private scheduleExpiry():boolean{
  this.clearTimer();
  let nextExpiry=Infinity;
  for(const entry of this.entries.values())
   nextExpiry=Math.min(nextExpiry,entry.expiresAt);
  if(!Number.isFinite(nextExpiry))return true;
  const generation=this.timerGeneration;
  try{
   const timer=this.scheduleTimer(()=>{
    if(generation!==this.timerGeneration)return;
    this.expiryTimer=null;
    this.pruneExpired();
   },Math.max(0,nextExpiry-this.now()));
   this.expiryTimer=timer;
   timer.unref?.();
   return true;
  }catch{
   // If eager cleanup cannot be scheduled, fail closed and drop every pending
   // capability instead of leaving its review context resident indefinitely.
   this.entries.clear();
   this.clearTimer();
   return false;
  }
 }

 private pruneExpired():void{
  const now=this.now();
  for(const [id,entry] of this.entries){
   if(entry.expiresAt<=now)this.entries.delete(id);
  }
  this.scheduleExpiry();
 }

 private ownerCount(owner:object):number{
  let count=0;
  for(const entry of this.entries.values())if(entry.owner===owner)count++;
  return count;
 }

 put(owner:object,context:T,expiresAt:number):string|null{
  this.pruneExpired();
  const now=this.now();
  if(!owner||typeof owner!=='object'||nodeTypes.isProxy(owner)||
     !context||typeof context!=='object'||nodeTypes.isProxy(context)||
     typeof expiresAt!=='number'||!Number.isFinite(expiresAt)||
     expiresAt<=now||expiresAt-now>MAX_CANDIDATE_EXPORT_CONTEXT_TTL_MS||
     this.ownerCount(owner)>=MAX_CANDIDATE_EXPORT_CONTEXTS_PER_WINDOW)
   return null;
  const id=randomUUID();
  this.entries.set(id,{owner,context,expiresAt,reserved:false});
  if(!this.scheduleExpiry())return null;
  return id;
 }

 reserve(owner:object,id:unknown):T|null{
  this.pruneExpired();
  if(!owner||typeof owner!=='object'||nodeTypes.isProxy(owner)||
     typeof id!=='string'||!CANDIDATE_ID.test(id))return null;
  const entry=this.entries.get(id);
  if(!entry||entry.owner!==owner||entry.reserved)return null;
  entry.reserved=true;
  return entry.context;
 }

 /** Check an already reserved handle after awaited native dialogs.
  * This never extends the deadline or authorizes another export. */
 isReserved(owner:object,id:unknown):boolean{
  this.pruneExpired();
  if(!owner||typeof owner!=='object'||nodeTypes.isProxy(owner)||
     typeof id!=='string'||!CANDIDATE_ID.test(id))return false;
  const entry=this.entries.get(id);
  return !!entry&&entry.owner===owner&&entry.reserved;
 }

 release(owner:object,id:unknown):boolean{
  this.pruneExpired();
  if(!owner||typeof owner!=='object'||nodeTypes.isProxy(owner)||
     typeof id!=='string'||!CANDIDATE_ID.test(id))return false;
  const entry=this.entries.get(id);
  if(!entry||entry.owner!==owner||!entry.reserved)return false;
  entry.reserved=false;
  return true;
 }

 consume(owner:object,id:unknown):T|null{
  this.pruneExpired();
  if(!owner||typeof owner!=='object'||nodeTypes.isProxy(owner)||
     typeof id!=='string'||!CANDIDATE_ID.test(id))return null;
  const entry=this.entries.get(id);
  if(!entry||entry.owner!==owner||!entry.reserved)return null;
  this.entries.delete(id);
  this.scheduleExpiry();
  return entry.context;
 }

 clearOwner(owner:object):void{
  if(!owner||typeof owner!=='object'||nodeTypes.isProxy(owner))return;
  for(const [id,entry] of this.entries){
   if(entry.owner===owner)this.entries.delete(id);
  }
  this.scheduleExpiry();
 }
}

/** A long-running import may finish after its BrowserWindow has closed and a
 * new window has installed a fresh index. Never let the stale owner populate
 * that replacement index with delayed source text or AST hints. */
export function recordImportedDomForCurrentOwner(
 ownerIndex:ImportedDomDiagnosticIndex,
 activeIndex:ImportedDomDiagnosticIndex,
 ownerWindow:object,
 activeWindow:object|null,
 ownerWindowDestroyed:boolean,
 hash:unknown,hints:unknown,filename:unknown=null,source?:unknown
):boolean{
 if(ownerIndex!==activeIndex||ownerWindow!==activeWindow||ownerWindowDestroyed)
  return false;
 ownerIndex.recordImported(hash,hints,filename,source);
 return true;
}
