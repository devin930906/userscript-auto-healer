/** TASK-015/017 · TEST-024: session-only bridge from a bounded, owned-Chrome
 * read-only scenario result to the limited health history. A DOM match is
 * NEVER Tampermonkey, GM API, business, or repair verification.
 */
import {createHash} from 'node:crypto';
import {LimitedHealthRegistry, type LimitedHealthSnapshot} from './health-registry';
import type {FaultTriageStatus} from '../diagnostics/fault-classifier';
import type {PageExceptionSignalResult} from '../diagnostics/cdp-page-exceptions';

type PageStatus = Exclude<PageExceptionSignalResult['status'], 'BLOCKED'>;
type LimitedInspection = {
  readonly scriptHash: string;
  readonly checkedAssertions: number;
  readonly triageStatus: FaultTriageStatus;
  readonly pageRuntimeStatus: PageStatus;
  readonly pageExceptionCount: number;
};
const keys = ['scriptHash', 'checkedAssertions', 'triageStatus',
  'pageRuntimeStatus', 'pageExceptionCount'] as const;
const allowedTriage = new Set<FaultTriageStatus>([
  'SINGLE_CAUSE_SIGNAL_ONLY', 'MULTIPLE_CAUSE_SIGNALS', 'NO_FAULT_SIGNAL',
  'INSUFFICIENT_EVIDENCE', 'INVALID_EVIDENCE'
]);

/** Main-process only. Reject inconsistent receipts; never persist DOM or URLs. */
export function recordLimitedScenarioInspection(
  registry: LimitedHealthRegistry, raw: unknown
): LimitedHealthSnapshot {
  let value: LimitedInspection;
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error();
    const proto = Object.getPrototypeOf(raw);
    if (proto !== Object.prototype && proto !== null) throw Error();
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    const names = Reflect.ownKeys(descriptors);
    if (names.length !== keys.length ||
        names.some(name => typeof name !== 'string') ||
        keys.some(key => !Object.prototype.hasOwnProperty.call(descriptors, key) ||
          !Object.prototype.hasOwnProperty.call(descriptors[key], 'value')))
      throw Error();
    const values = Object.create(null) as Record<string,unknown>;
    for (const key of keys) values[key] = descriptors[key].value;
    if (typeof values.scriptHash !== 'string' ||
        !Number.isSafeInteger(values.checkedAssertions) ||
        (values.checkedAssertions as number) < 1 ||
        (values.checkedAssertions as number) > 2 ||
        !allowedTriage.has(values.triageStatus as FaultTriageStatus) ||
        (values.pageRuntimeStatus !== 'PAGE_EXCEPTION_SIGNAL_ONLY' &&
         values.pageRuntimeStatus !== 'NO_EXCEPTION_IN_WINDOW_ONLY') ||
        !Number.isSafeInteger(values.pageExceptionCount) ||
        (values.pageExceptionCount as number) < 0 ||
        (values.pageExceptionCount as number) > 32 ||
        (values.pageRuntimeStatus === 'NO_EXCEPTION_IN_WINDOW_ONLY' &&
          values.pageExceptionCount !== 0) ||
        (values.pageRuntimeStatus === 'PAGE_EXCEPTION_SIGNAL_ONLY' &&
          values.pageExceptionCount === 0))
      throw Error();
    value = values as LimitedInspection;
  } catch {
    throw Error('INVALID_LIMITED_INSPECTION');
  }

  // Only a bounded clean DOM window without page exceptions supports
  // ELEMENT_FOUND_ONLY. Any fault or uncertainty remains INDETERMINATE.
  const foundOnly = value.triageStatus === 'NO_FAULT_SIGNAL' &&
    value.pageRuntimeStatus === 'NO_EXCEPTION_IN_WINDOW_ONLY';
  // This hash identifies only a minimized *summary*, not a trusted DOM proof.
  const evidenceHash = foundOnly ? createHash('sha256')
    .update('uah-limited-dom-summary-v1\n' + value.scriptHash + '\n' +
      value.checkedAssertions + '\nNO_FAULT_SIGNAL\nNO_EXCEPTION_IN_WINDOW_ONLY')
    .digest('hex') : null;
  return registry.record({
    scriptHash: value.scriptHash,
    kind: foundOnly ? 'LIMITED_DOM_OBSERVATION' : 'INSUFFICIENT_EVIDENCE',
    evidenceHash
  });
}
