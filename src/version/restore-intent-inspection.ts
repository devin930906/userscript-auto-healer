/**
 * TASK-011 / REQ-020 / TEST-020: read-only native recovery intent inspection.
 * No user-script edits, no automatic retry or restore and no renderer IPC.
 */
export type RestoreIntentObservation=
 |Readonly<{status:'BLOCKED';reason:'INVALID_REQUEST'|'NOT_AUTHORIZED'|
  'UNSAFE_PATH'|'UNSAFE_JOURNAL'|'BACKUP_UNVERIFIED'|
  'SOURCE_DIVERGED'|'IO_FAILURE';
  automaticPatchAllowed:false;automaticRollbackAllowed:false;
  tampermonkeyVerified:false;businessVerified:false}>
 |Readonly<{status:'RESTORE_INTENT_OBSERVED_READ_ONLY';
  sourceState:'ORIGINAL_PRESENT'|'DISPLACED_PRESENT';
  originalSha256:string;displacedSha256:string;
  automaticPatchAllowed:false;automaticRollbackAllowed:false;
  tampermonkeyVerified:false;businessVerified:false}>;
const noAuthority={automaticPatchAllowed:false as const,
 automaticRollbackAllowed:false as const,tampermonkeyVerified:false as const,
 businessVerified:false as const};
export async function inspectNativeRestoreIntentReadOnly(
  _input:unknown
):Promise<RestoreIntentObservation>{
 return Object.freeze({status:'BLOCKED' as const,
  reason:'INVALID_REQUEST' as const,...noAuthority});
}
