/** TASK-015/017 · REQ-024 · TEST-024/026: bounded session-only history.
 * Renderer supplies only a staged scenario ID. The privileged session
 * resolves its own imported script identity. This is NOT a manager, business,
 * recovery, or repair attestation; never expose raw hashes or evidence data.
 */
import {createHash} from 'node:crypto';
import {types as nodeTypes} from 'node:util';
import {DesktopScenarioSession} from '../scenarios/desktop-session';
import {LimitedHealthRegistry,type LimitedHealthStatus} from './health-registry';
import type {ArchiveRead} from './limited-health-archive';

const noAuthority=Object.freeze({
 tampermonkeyVerified:false as const,
 businessVerified:false as const,
 automaticPatchAllowed:false as const,
 automaticRollbackAllowed:false as const
});
export type LimitedHistoryView=
 |Readonly<{ok:false;code:'INVALID_ID'|'SCENARIO_NOT_FOUND'|
   'SCENARIO_NOT_READONLY_ELIGIBLE'|'HISTORY_UNAVAILABLE'}&typeof noAuthority>
 |Readonly<{ok:true;status:'UNVERIFIED_SESSION_HISTORY_ONLY';
   currentStatus:LimitedHealthStatus;
   events:readonly Readonly<{observedAtMs:number;
     status:'ELEMENT_FOUND_ONLY'|'INDETERMINATE'}>[]
  }&typeof noAuthority>;

/**
 * Index an observation by both imported script and registered scenario ID.
 * Two websites/selectors using the same userscript must not inherit each
 * other's DOM status. This key has no manager, repair or runtime authority.
 */
export function limitedScenarioHistoryKey(scriptHash:string,scenarioId:string):string {
 if(typeof scriptHash!=='string'||!/^[0-9a-f]{64}$/.test(scriptHash)||
    typeof scenarioId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(scenarioId))
  throw Error('INVALID_SESSION_HISTORY_SCOPE');
 return createHash('sha256').update('uah-session-scenario-v1\0')
  .update(scriptHash).update('\0').update(scenarioId).digest('hex');
}

export function readLimitedSessionHistory(
 session:DesktopScenarioSession,history:LimitedHealthRegistry,id:unknown
):LimitedHistoryView {
 try {
  const selected=session.resolveReadOnlyDom(id);
  if(!selected.ok)return Object.freeze({
    ok:false as const,code:selected.code,...noAuthority
  });
  const snapshot=history.snapshot(limitedScenarioHistoryKey(
    selected.scenario.scriptSha256,selected.scenario.id));
  const events=Object.freeze(snapshot.history.map(event=>Object.freeze({
    observedAtMs:event.observedAtMs,status:event.status
  })));
  return Object.freeze({
    ok:true as const,status:'UNVERIFIED_SESSION_HISTORY_ONLY' as const,
    currentStatus:snapshot.status,events,...noAuthority
  });
 }catch{
  return Object.freeze({ok:false as const,
    code:'HISTORY_UNAVAILABLE' as const,...noAuthority});
 }
}

/** TypeScript discriminants cannot authenticate records provided directly to
 * this exported merge helper. Reject untrusted event arrays before reading
 * any event fields; never run Proxy traps, accessors or user iterators.
 * Archive timestamps are strictly ordered. Current-session events may share
 * a millisecond, but neither source may introduce verified business states.
 */
function validLimitedEventRows(value:unknown,allowSameTick:boolean,allowEmpty:boolean,maxObservedAtMs:number):boolean{
 try{
  if(!Array.isArray(value)||nodeTypes.isProxy(value)||
     Object.getPrototypeOf(value)!==Array.prototype)return false;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  const size=Object.getOwnPropertyDescriptor(value,'length')?.value;
  if(!Number.isSafeInteger(size)||size<0||size>32||
     (!allowEmpty&&size===0)||Reflect.ownKeys(descriptors).length!==size+1)
   return false;
  let last=-1;
  for(let i=0;i<size;i++){
   const slot=descriptors[String(i)];
   if(!slot||!Object.prototype.hasOwnProperty.call(slot,'value'))return false;
   const entry:unknown=slot.value;
   if(!entry||typeof entry!=='object'||Array.isArray(entry)||
      nodeTypes.isProxy(entry))return false;
   const proto=Object.getPrototypeOf(entry);
   if(proto!==Object.prototype&&proto!==null)return false;
   const fields=Object.getOwnPropertyDescriptors(entry);
   if(Reflect.ownKeys(fields).length!==2)return false;
   const time=fields.observedAtMs,status=fields.status;
   if(!time||!status||
      !Object.prototype.hasOwnProperty.call(time,'value')||
      !Object.prototype.hasOwnProperty.call(status,'value')||
      !Number.isSafeInteger(time.value)||time.value<0||
      time.value>maxObservedAtMs||
      (status.value!=='ELEMENT_FOUND_ONLY'&&status.value!=='INDETERMINATE')||
      (allowSameTick?time.value<last:time.value<=last))return false;
   last=time.value;
  }
  return true;
 }catch{return false;}
}

/** Extract only own data descriptor values from a native merge input.
 * Never execute top-level accessors or Proxy traps when finding event arrays.
 * Unexpected extra own fields are ignored; only the listed properties cross.
 */
function nativeHistoryMergeField(source:unknown,key:string):{
 readonly accepted:true;readonly value:unknown
}|null{
 try{
  if(!source||typeof source!=='object'||nodeTypes.isProxy(source)||
     Array.isArray(source))return null;
  const descriptor=Object.getOwnPropertyDescriptor(source,key);
  if(!descriptor||!Object.prototype.hasOwnProperty.call(descriptor,'value'))
   return null;
  return {accepted:true,value:descriptor.value};
 }catch{return null;}
}

/** TASK-015 / TEST-024: Merge separately persisted, always-unverified
 * historical observations with this window's limited in-memory history.
 * A matching timestamp is not proof of a newly observed session event:
 * this helper does not grant any business, manager or recovery authority.
 */
export function mergeLimitedSessionArchive(
 current:Extract<LimitedHistoryView,{ok:true}>,
 stored:Extract<ArchiveRead,{status:'ARCHIVE_READ_UNVERIFIED'}>
):Extract<LimitedHistoryView,{ok:true}>&Readonly<{archiveRetained:true}>{
 // Refuse forged or malformed event data even if a caller supplied a
 // TypeScript-only valid archive/session discriminant.
 // The validated own-data descriptors below also guard the outer records.
 // Do not evaluate stored.events or current.events before those checks.
 // Both persisted and session event arrays are untrusted at this exported
 // native boundary. Do not let a far-future timestamp permanently outrank
 // newly observed DOM history, even if a caller forged TypeScript types.
 // Use one wall-clock snapshot for both arrays; invalid time fails closed.
 const now=Date.now();
 const futureSkewMs=5*60*1000;
 if(!Number.isSafeInteger(now)||now<0||
    now>Number.MAX_SAFE_INTEGER-futureSkewMs)
  throw Error('INVALID_LIMITED_HISTORY_EVENTS');
 const maxObservedAtMs=now+futureSkewMs;
 const storedRows=nativeHistoryMergeField(stored,'events');
 const sessionRows=nativeHistoryMergeField(current,'events');
 const sessionStatus=nativeHistoryMergeField(current,'currentStatus');
 const sessionReceipt=nativeHistoryMergeField(current,'status');
 const sessionOk=nativeHistoryMergeField(current,'ok');
 const archiveStatus=nativeHistoryMergeField(stored,'currentStatus');
 const archiveReceipt=nativeHistoryMergeField(stored,'status');
 // A BLOCKED/missing/foreign read cannot contribute historical evidence,
 // even if its event rows happen to look like a valid unverified archive.
 if(!storedRows||!sessionRows||!sessionStatus||!archiveStatus||
    !sessionReceipt||sessionReceipt.value!=='UNVERIFIED_SESSION_HISTORY_ONLY'||
    !sessionOk||sessionOk.value!==true||
    !archiveReceipt||archiveReceipt.value!=='ARCHIVE_READ_UNVERIFIED'||
    archiveStatus.value!=='INDETERMINATE'||
    !validLimitedEventRows(storedRows.value,false,false,maxObservedAtMs)||
    !validLimitedEventRows(sessionRows.value,true,true,maxObservedAtMs))
  throw Error('INVALID_LIMITED_HISTORY_EVENTS');
 const archived=storedRows.value as readonly Readonly<{observedAtMs:number;status:'ELEMENT_FOUND_ONLY'|'INDETERMINATE'}>[];
 const observed=sessionRows.value as
  readonly Readonly<{observedAtMs:number;status:'ELEMENT_FOUND_ONLY'|'INDETERMINATE'}>[];
 const oldLast=archived[archived.length-1].observedAtMs;
 const recent=observed.filter(event=>event.observedAtMs>oldLast);
 const events=Object.freeze([...archived,...recent].slice(-32).map(
  event=>Object.freeze({observedAtMs:event.observedAtMs,status:event.status})));
 const currentLast=observed[observed.length-1]?.observedAtMs;
 // Equal timestamps cannot establish ordering across a retained archive and
 // this independent session. Never promote an archived INDETERMINATE row.
 // Runtime callers can misstate a TypeScript-only discriminant. Historical
 // DOM observations never authorize VERIFIED/BROKEN/RECOVERED business state,
 // even when their timestamp is newer than the last archive record.
 // A DOM-hit summary is admissible only when the latest actual limited
 // observation is also a DOM hit. An independent, untrusted currentStatus
 // field can never promote INDETERMINATE evidence into a positive claim.
 const latestObserved=observed[observed.length-1];
 const limitedCurrent=sessionStatus.value==='ELEMENT_FOUND_ONLY'&&
  latestObserved?.status==='ELEMENT_FOUND_ONLY'?
  'ELEMENT_FOUND_ONLY' as const:'INDETERMINATE' as const;
 const currentStatus=currentLast!==undefined&&currentLast>oldLast?
  limitedCurrent:'INDETERMINATE' as const;
 // Do not spread the caller's view: the archive merge is a projection of
 // fixed unverified fields, not a way to carry arbitrary renderer-visible
 // properties or forged authorization flags into a native health response.
 return Object.freeze({
  ok:true as const,status:'UNVERIFIED_SESSION_HISTORY_ONLY' as const,
  currentStatus,events,archiveRetained:true as const,...noAuthority
 });
}
