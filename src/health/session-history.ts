/** TASK-015/017 · REQ-024 · TEST-024/026: bounded session-only history.
 * Renderer supplies only a staged scenario ID. The privileged session
 * resolves its own imported script identity. This is NOT a manager, business,
 * recovery, or repair attestation; never expose raw hashes or evidence data.
 */
import {DesktopScenarioSession} from '../scenarios/desktop-session';
import {LimitedHealthRegistry,type LimitedHealthStatus} from './health-registry';

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

export function readLimitedSessionHistory(
 session:DesktopScenarioSession,history:LimitedHealthRegistry,id:unknown
):LimitedHistoryView {
 try {
  const selected=session.resolveReadOnlyDom(id);
  if(!selected.ok)return Object.freeze({
    ok:false as const,code:selected.code,...noAuthority
  });
  const snapshot=history.snapshot(selected.scenario.scriptSha256);
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
