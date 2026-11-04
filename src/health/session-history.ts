/** TASK-015/017 · REQ-024 · TEST-024/026: bounded session-only history.
 * Renderer supplies only a staged scenario ID. The privileged session
 * resolves its own imported script identity. This is NOT a manager, business,
 * recovery, or repair attestation; never expose raw hashes or evidence data.
 */
import {createHash} from 'node:crypto';
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

/** TASK-015 / TEST-024: Merge separately persisted, always-unverified
 * historical observations with this window's limited in-memory history.
 * A matching timestamp is not proof of a newly observed session event:
 * this helper does not grant any business, manager or recovery authority.
 */
export function mergeLimitedSessionArchive(
 current:Extract<LimitedHistoryView,{ok:true}>,
 stored:Extract<ArchiveRead,{status:'ARCHIVE_READ_UNVERIFIED'}>
):Extract<LimitedHistoryView,{ok:true}>&Readonly<{archiveRetained:true}>{
 const oldLast=stored.events[stored.events.length-1].observedAtMs;
 const recent=current.events.filter(event=>event.observedAtMs>oldLast);
 const events=Object.freeze([...stored.events,...recent].slice(-32).map(
  event=>Object.freeze({observedAtMs:event.observedAtMs,status:event.status})));
 const currentLast=current.events[current.events.length-1]?.observedAtMs;
 // Equal timestamps cannot establish ordering across a retained archive and
 // this independent session. Never promote an archived INDETERMINATE row.
 const currentStatus=currentLast!==undefined&&currentLast>oldLast?
  current.currentStatus:'INDETERMINATE' as const;
 return Object.freeze({...current,currentStatus,events,archiveRetained:true as const});
}
