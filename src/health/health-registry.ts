/**
 * TASK-015 / REQ-024 / TEST-024: limited, in-memory health history.
 *
 * History is NOT a Tampermonkey attestation, a durable audit journal, or an
 * authority to patch/rollback an original userscript. A reported DOM hit is
 * only ELEMENT_FOUND_ONLY. A real RECOVERED_VERIFIED or BROKEN_VERIFIED state
 * must be implemented later behind a trusted manager/business acceptance gate.
 * Never store script source, file paths, URLs, cookies, or unredacted errors.
 */
import {types as nodeTypes} from 'node:util';

export type LimitedObservationKind =
  'LIMITED_DOM_OBSERVATION' | 'INSUFFICIENT_EVIDENCE';
export type LimitedHealthStatus =
  'UNTESTED' | 'ELEMENT_FOUND_ONLY' | 'INDETERMINATE';
export interface LimitedHealthEvent {
  readonly kind: LimitedObservationKind;
  readonly evidenceHash: string | null;
  readonly observedAtMs: number;
  readonly status: Exclude<LimitedHealthStatus, 'UNTESTED'>;
}
export interface LimitedHealthSnapshot {
  readonly schema: 'uah-limited-health-v1';
  readonly phase: 'UNVERIFIED_LOCAL_HISTORY';
  readonly scriptHash: string;
  readonly status: LimitedHealthStatus;
  readonly history: readonly LimitedHealthEvent[];
  readonly tampermonkeyVerified: false;
  readonly businessVerified: false;
  readonly automaticPatchAllowed: false;
  readonly automaticRollbackAllowed: false;
}
const MAX_SCRIPTS = 1000;
const MAX_EVENTS_PER_SCRIPT = 32;
const FRESHNESS_MS = 10 * 60 * 1000;
const SHA256 = /^[0-9a-f]{64}$/;
type ObservationInput = {
  readonly scriptHash: string;
  readonly kind: LimitedObservationKind;
  readonly evidenceHash: string | null;
};
/** Read ONLY own data descriptor values: do not invoke getters from untrusted inputs. */
function exactRecord(input: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (!input || typeof input !== 'object' || nodeTypes.isProxy(input) ||
        Array.isArray(input)) return null;
    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const names = Reflect.ownKeys(descriptors);
    if (names.length !== keys.length || names.some(name => typeof name !== 'string') ||
        keys.some(key => !Object.prototype.hasOwnProperty.call(descriptors, key) ||
          !Object.prototype.hasOwnProperty.call(descriptors[key], 'value'))) return null;
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys) result[key] = descriptors[key].value;
    return result;
  } catch {
    // Proxy traps are untrusted: do not expose arbitrary error text to callers.
    return null;
  }
}
function validateHash(input: unknown): string {
  if (typeof input !== 'string' || !SHA256.test(input))
    throw Error('INVALID_HEALTH_SCRIPT_ID');
  return input;
}
function validObservation(input: unknown): ObservationInput {
  const value = exactRecord(input, ['scriptHash', 'kind', 'evidenceHash']);
  if (!value) throw Error('INVALID_HEALTH_OBSERVATION');
  const scriptHash = validateHash(value.scriptHash);
  if (value.kind !== 'LIMITED_DOM_OBSERVATION' &&
      value.kind !== 'INSUFFICIENT_EVIDENCE')
    throw Error('INVALID_HEALTH_OBSERVATION');
  if (value.kind === 'LIMITED_DOM_OBSERVATION') {
    if (typeof value.evidenceHash !== 'string' || !SHA256.test(value.evidenceHash))
      throw Error('INVALID_HEALTH_EVIDENCE');
  } else if (value.evidenceHash !== null) {
    throw Error('INVALID_HEALTH_EVIDENCE');
  }
  return {scriptHash, kind: value.kind, evidenceHash: value.evidenceHash as string | null};
}
export class LimitedHealthRegistry {
  private readonly entries = new Map<string, LimitedHealthEvent[]>();
  // An observation once seen expired or time-reversed must never regain
  // fresh status merely because the OS clock moved backwards. Per-script
  // revocation is cleared only by a NEW, timestamp-ordered observation.
  private readonly staleEvidence = new Set<string>();
  constructor(private readonly now: () => number = Date.now) {
    if (typeof now !== 'function') throw Error('INVALID_HEALTH_CLOCK');
  }
  private time(): number {
    const time = this.now();
    if (!Number.isSafeInteger(time) || time < 0) throw Error('INVALID_HEALTH_CLOCK');
    return time;
  }
  /** No user-supplied timestamp or claim of verified recovery is accepted. */
  record(input: unknown): LimitedHealthSnapshot {
    const observation = validObservation(input);
    const timestamp = this.time();
    const prior = this.entries.get(observation.scriptHash);
    if (!prior && this.entries.size >= MAX_SCRIPTS)
      throw Error('HEALTH_CAPACITY_EXCEEDED');
    if (prior && prior.length && timestamp < prior[prior.length - 1].observedAtMs) {
      this.staleEvidence.add(observation.scriptHash);
      throw Error('HEALTH_CLOCK_ROLLBACK');
    }
    const status = observation.kind === 'LIMITED_DOM_OBSERVATION'
      ? 'ELEMENT_FOUND_ONLY' : 'INDETERMINATE';
    const event = Object.freeze({
      kind: observation.kind,
      evidenceHash: observation.evidenceHash,
      observedAtMs: timestamp,
      status
    }) as LimitedHealthEvent;
    const history = [...(prior || []), event].slice(-MAX_EVENTS_PER_SCRIPT);
    this.entries.set(observation.scriptHash, history);
    this.staleEvidence.delete(observation.scriptHash);
    return this.snapshotAt(observation.scriptHash, timestamp);
  }
  /** Freshness concerns only the limited observation, never script health. */
  snapshot(scriptHash: string): LimitedHealthSnapshot {
    const hash = validateHash(scriptHash);
    return this.snapshotAt(hash, this.time());
  }
  private snapshotAt(hash: string, timestamp: number): LimitedHealthSnapshot {
    const history = this.entries.get(hash) || [];
    const latest = history[history.length - 1];
    // A wall-clock rollback must not revive previously stale evidence.
    // Retain the fact that this specific script was observed as expired or
    // time-reversed, without changing or deleting historical observations.
    const expired = !!latest && (timestamp < latest.observedAtMs ||
      timestamp - latest.observedAtMs > FRESHNESS_MS);
    if (expired) this.staleEvidence.add(hash);
    const status: LimitedHealthStatus = !latest ? 'UNTESTED' :
      this.staleEvidence.has(hash) ? 'INDETERMINATE' : latest.status;
    return Object.freeze({
      schema: 'uah-limited-health-v1' as const,
      phase: 'UNVERIFIED_LOCAL_HISTORY' as const,
      scriptHash: hash,
      status,
      history: Object.freeze([...history]),
      tampermonkeyVerified: false as const,
      businessVerified: false as const,
      automaticPatchAllowed: false as const,
      automaticRollbackAllowed: false as const
    });
  }
}
