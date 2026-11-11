import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {
  evaluateBusinessAcceptanceGate,
  type BusinessAcceptanceResult
} from '../../src/acceptance/business-acceptance-gate';

const origSha = createHash('sha256').update('original-source-code').digest('hex');
const candSha = createHash('sha256').update('candidate-patched-source-code').digest('hex');

const validAudit = {
  status: 'REVIEWABLE_ONLY' as const,
  originalSha256: origSha,
  candidateSha256: candSha,
  faultEvidenceId: 'scenario_assertion_1',
  change: {start: 10, end: 25},
  automaticPatchAllowed: false as const,
  tampermonkeyVerified: false as const,
  businessRecoveredVerified: false as const
};

const validBackup = {
  status: 'BACKUP_PREPARED_RUNTIME_UNVERIFIED' as const,
  backupFileName: 'original.user.js.bak-12345',
  sourceSha256: origSha,
  candidateSha256: candSha,
  backupByteLength: 1024,
  automaticPatchAllowed: false as const,
  automaticRollbackAllowed: false as const,
  tampermonkeyVerified: false as const,
  businessRecoveredVerified: false as const
};

const validOriginalEvidence = {
  status: 'REAL_MANAGER_ORIGINAL_EVALUATION' as const,
  sourceSha256: origSha,
  injected: true as const,
  gmVerified: true as const,
  businessOutcome: 'missing-target' as const,
  actionConfirmed: false as const,
  observedAt: '2026-11-11T12:00:00Z'
};

const validCandidateEvidence = {
  status: 'REAL_MANAGER_CANDIDATE_EVALUATION' as const,
  candidateSha256: candSha,
  injected: true as const,
  gmVerified: true as const,
  businessOutcome: 'recovered' as const,
  actionConfirmed: true as const,
  observedAt: '2026-11-11T12:05:00Z'
};

const validOptions = {
  userApproved: true
};

test('TASK-010 / TEST-018/021: valid original failure and candidate recovery passes business acceptance', () => {
  const result: BusinessAcceptanceResult = evaluateBusinessAcceptanceGate(
    validAudit,
    validBackup,
    validOriginalEvidence,
    validCandidateEvidence,
    validOptions
  );

  assert.equal(result.status, 'BUSINESS_ACCEPTED_AWAITING_TRANSACTION');
  assert.equal(result.originalSha256, origSha);
  assert.equal(result.candidateSha256, candSha);
  assert.equal(result.backupFileName, 'original.user.js.bak-12345');
  assert.equal(result.faultEvidenceId, 'scenario_assertion_1');
  assert.equal(result.automaticPatchAllowed, false);
  assert.equal(result.automaticRollbackAllowed, false);
  assert.equal(result.tampermonkeyVerified, true);
  assert.equal(result.businessVerified, true);
});

test('TASK-010 / TEST-018/021: missing user authorization fails closed', () => {
  for (const badOpts of [
    {userApproved: false},
    {userApproved: 'true'},
    {},
    null,
    undefined
  ]) {
    const result = evaluateBusinessAcceptanceGate(
      validAudit,
      validBackup,
      validOriginalEvidence,
      validCandidateEvidence,
      badOpts
    );
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.automaticPatchAllowed, false);
    assert.equal(result.businessVerified, false);
  }
});

test('TASK-010 / TEST-018/021: hash mismatch between audit, backup and runtime evidence is blocked', () => {
  const foreignSha = 'e'.repeat(64);

  // Mismatched original SHA in backup
  const badBackupOrig = {...validBackup, sourceSha256: foreignSha};
  const r1 = evaluateBusinessAcceptanceGate(
    validAudit,
    badBackupOrig,
    validOriginalEvidence,
    validCandidateEvidence,
    validOptions
  );
  assert.equal(r1.status, 'BLOCKED');
  assert.equal(r1.reason, 'ORIGINAL_HASH_MISMATCH');

  // Mismatched original SHA in original runtime evidence
  const badOrigEv = {...validOriginalEvidence, sourceSha256: foreignSha};
  const r2 = evaluateBusinessAcceptanceGate(
    validAudit,
    validBackup,
    badOrigEv,
    validCandidateEvidence,
    validOptions
  );
  assert.equal(r2.status, 'BLOCKED');
  assert.equal(r2.reason, 'ORIGINAL_HASH_MISMATCH');

  // Mismatched candidate SHA in candidate runtime evidence
  const badCandEv = {...validCandidateEvidence, candidateSha256: foreignSha};
  const r3 = evaluateBusinessAcceptanceGate(
    validAudit,
    validBackup,
    validOriginalEvidence,
    badCandEv,
    validOptions
  );
  assert.equal(r3.status, 'BLOCKED');
  assert.equal(r3.reason, 'CANDIDATE_HASH_MISMATCH');
});

test('TASK-010 / TEST-018/021: original not broken or candidate not recovered is blocked', () => {
  // Original unexpectedly claims recovery
  const healthyOriginal = {...validOriginalEvidence, businessOutcome: 'recovered', actionConfirmed: true};
  const r1 = evaluateBusinessAcceptanceGate(
    validAudit,
    validBackup,
    healthyOriginal,
    validCandidateEvidence,
    validOptions
  );
  assert.equal(r1.status, 'BLOCKED');
  assert.equal(r1.reason, 'ORIGINAL_NOT_BROKEN');

  // Candidate failed to recover action
  const failedCandidate = {...validCandidateEvidence, businessOutcome: 'missing-target', actionConfirmed: false};
  const r2 = evaluateBusinessAcceptanceGate(
    validAudit,
    validBackup,
    validOriginalEvidence,
    failedCandidate,
    validOptions
  );
  assert.equal(r2.status, 'BLOCKED');
  assert.equal(r2.reason, 'CANDIDATE_NOT_RECOVERED');
});

test('TASK-010 / TEST-018/021: temporal inversion in observation timestamps is blocked', () => {
  const invertedCandidate = {
    ...validCandidateEvidence,
    observedAt: '2026-11-11T11:50:00Z' // before original observedAt (12:00:00Z)
  };
  const r = evaluateBusinessAcceptanceGate(
    validAudit,
    validBackup,
    validOriginalEvidence,
    invertedCandidate,
    validOptions
  );
  assert.equal(r.status, 'BLOCKED');
  assert.equal(r.reason, 'EVIDENCE_TEMPORAL_INVERSION');
});

test('TASK-010 / TEST-018/021/026: hostile Proxy and accessor inputs never execute traps or leak data', () => {
  let trapCount = 0;
  const hostileProxy = new Proxy(validOptions, {
    get(target, prop, receiver) {
      trapCount++;
      return Reflect.get(target, prop, receiver);
    }
  });

  const r1 = evaluateBusinessAcceptanceGate(
    validAudit,
    validBackup,
    validOriginalEvidence,
    validCandidateEvidence,
    hostileProxy
  );
  assert.equal(r1.status, 'BLOCKED');
  assert.equal(r1.reason, 'INVALID_OPTIONS');
  assert.equal(trapCount, 0, 'Proxy get trap must not be triggered during option validation');

  let getterCount = 0;
  const getterAudit = {...validAudit};
  Object.defineProperty(getterAudit, 'status', {
    enumerable: true,
    get() {
      getterCount++;
      return 'REVIEWABLE_ONLY';
    }
  });

  const r2 = evaluateBusinessAcceptanceGate(
    getterAudit,
    validBackup,
    validOriginalEvidence,
    validCandidateEvidence,
    validOptions
  );
  assert.equal(r2.status, 'BLOCKED');
  assert.equal(r2.reason, 'AUDIT_NOT_REVIEWABLE');
  assert.equal(getterCount, 0, 'Getter accessor must not be evaluated during audit validation');
});
