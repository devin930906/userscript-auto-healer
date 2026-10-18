/** TASK-008 / REQ-013 / RISK-005: conservative local fault-signal triage.
 * This module never runs imported scripts, reads raw logs or grants repairs.
 * Callers must independently validate the provenance of their observations.
 * A category here is only a signal classification, not root-cause proof.
 */
export type FaultCategory =
  'PERMISSION'|'NETWORK'|'JAVASCRIPT'|'SELECTOR_ASSERTION'|
  'BUSINESS_ASSERTION'|'UNKNOWN';

export type FaultSignalCode =
  'PERMISSION_DENIED'|'NETWORK_FAILURE'|'SCRIPT_EXCEPTION'|
  'SELECTOR_NOT_FOUND'|'BUSINESS_ASSERTION_FAILED'|
  'NO_FAILURE_OBSERVED'|'UNVERIFIED_OBSERVATION';

export type FaultTriageStatus =
  'SINGLE_CAUSE_SIGNAL_ONLY'|'MULTIPLE_CAUSE_SIGNALS'|
  'NO_FAULT_SIGNAL'|'INSUFFICIENT_EVIDENCE'|'INVALID_EVIDENCE';

export interface FaultSignal {
  /** Only opaque local identifiers; never pass URLs, paths, DOM or messages. */
  readonly id:string;
  readonly code:FaultSignalCode;
}

export interface FaultTriage {
  readonly status:FaultTriageStatus;
  readonly category:FaultCategory;
  readonly evidenceIds:readonly string[];
  readonly automaticPatchAllowed:false;
  readonly tampermonkeyVerified:false;
  readonly businessRecoveredVerified:false;
}

const signalCategories:Readonly<Record<FaultSignalCode,FaultCategory|null>>={
  PERMISSION_DENIED:'PERMISSION',
  NETWORK_FAILURE:'NETWORK',
  SCRIPT_EXCEPTION:'JAVASCRIPT',
  SELECTOR_NOT_FOUND:'SELECTOR_ASSERTION',
  BUSINESS_ASSERTION_FAILED:'BUSINESS_ASSERTION',
  NO_FAILURE_OBSERVED:null,
  UNVERIFIED_OBSERVATION:null
};
const MAX_SIGNALS=32;
const safeId=/^[A-Za-z0-9_-]{1,64}$/;

function triage(
  status:FaultTriageStatus,category:FaultCategory,ids:readonly string[]
):FaultTriage {
  return Object.freeze({
    status,category,evidenceIds:Object.freeze([...ids]),
    automaticPatchAllowed:false as const,
    tampermonkeyVerified:false as const,
    businessRecoveredVerified:false as const
  });
}

/** Reject malformed, duplicated or mixed raw payloads. No raw error text or
 * user-controlled URLs are retained, returned or written to diagnostic logs.
 * Even a single selector failure is *not* authorization to edit a userscript.
 */
export function classifyFaultSignals(input:unknown):FaultTriage {
  try{
  if(!Array.isArray(input)||input.length===0||input.length>MAX_SIGNALS)
    return triage('INVALID_EVIDENCE','UNKNOWN',[]);
  const ids:string[]=[];
  const unique=new Set<string>();
  const categories=new Set<FaultCategory>();
  let unknown=false;
  let noFailureObserved=false;
  for(const item of input){
    if(item===null||typeof item!=='object'||Array.isArray(item))
      return triage('INVALID_EVIDENCE','UNKNOWN',[]);
    // Read descriptors instead of invoking hostile accessor properties.
    // Proxy traps and revoked proxies can throw: the enclosing fail-closed
    // boundary returns INVALID_EVIDENCE without retaining raw payloads.
    const fields=Object.getOwnPropertyDescriptors(item);
    if(Reflect.ownKeys(fields).length!==2||
      !Object.prototype.hasOwnProperty.call(fields,'id')||
      !Object.prototype.hasOwnProperty.call(fields,'code')||
      !Object.prototype.hasOwnProperty.call(fields.id,'value')||
      !Object.prototype.hasOwnProperty.call(fields.code,'value'))
      return triage('INVALID_EVIDENCE','UNKNOWN',[]);
    const id:unknown=fields.id.value;
    const code:unknown=fields.code.value;
    if(typeof id!=='string'||!safeId.test(id)||
      typeof code!=='string'||
      !Object.prototype.hasOwnProperty.call(signalCategories,code)||
      unique.has(id))
      return triage('INVALID_EVIDENCE','UNKNOWN',[]);
    unique.add(id);
    ids.push(id);
    if(code==='UNVERIFIED_OBSERVATION')unknown=true;
    if(code==='NO_FAILURE_OBSERVED')noFailureObserved=true;
    const category=signalCategories[code as FaultSignalCode];
    if(category!==null)categories.add(category);
  }
  // A clean observation contradicts any explicit fault in the same evidence
  // batch. Never label that batch as a single cause or successful recovery.
  if(unknown||(noFailureObserved&&categories.size>0))
    return triage('INSUFFICIENT_EVIDENCE','UNKNOWN',ids);
  if(categories.size>1)return triage('MULTIPLE_CAUSE_SIGNALS','UNKNOWN',ids);
  if(categories.size===0)return triage('NO_FAULT_SIGNAL','UNKNOWN',ids);
  return triage('SINGLE_CAUSE_SIGNAL_ONLY',[...categories][0],ids);
  }catch{
    return triage('INVALID_EVIDENCE','UNKNOWN',[]);
  }
}

export interface SafeFaultLogEntry extends FaultTriage {
  readonly sequence:number;
  readonly recordedAt:string;
}
/** In-memory, bounded, strictly schema-minimized diagnostic log.
 * No persistence or external communication; future persistence requires
 * separate encryption/retention/user-consent work in later tasks.
 */
export class BoundedFaultLog {
  private readonly entries:SafeFaultLogEntry[]=[];
  private sequence=0;
  constructor(private readonly capacity=128){
    if(!Number.isInteger(capacity)||capacity<1||capacity>1024)
      throw new RangeError('INVALID_CAPACITY');
  }
  record(input:unknown):SafeFaultLogEntry {
    const result=classifyFaultSignals(input);
    const entry:SafeFaultLogEntry=Object.freeze({
      sequence:++this.sequence,
      recordedAt:new Date().toISOString(),
      ...result,
      evidenceIds:Object.freeze([...result.evidenceIds])
    });
    this.entries.push(entry);
    if(this.entries.length>this.capacity)this.entries.shift();
    return entry;
  }
  list():readonly SafeFaultLogEntry[]{
    return Object.freeze([...this.entries]);
  }
  clear():void{this.entries.length=0;}
}
