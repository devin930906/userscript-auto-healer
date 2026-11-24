import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {
  evaluateBusinessAcceptanceGate,
  evaluateRollbackAcceptanceGate,
  type BusinessAcceptanceResult,
  type RollbackAcceptanceResult
} from '../../src/acceptance/business-acceptance-gate';
import {
  proposeConservativeRepairCandidateFromEvidence,
  type DiagnosticFaultEvidence
} from '../../src/repair/patch-planner';

const fixtureNow = Date.now();
const iso = (offsetMs: number): string => new Date(fixtureNow + offsetMs).toISOString();

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
  observedAt: iso(-5 * 60_000)
};

const validCandidateEvidence = {
  status: 'REAL_MANAGER_CANDIDATE_EVALUATION' as const,
  candidateSha256: candSha,
  injected: true as const,
  gmVerified: true as const,
  businessOutcome: 'recovered' as const,
  actionConfirmed: true as const,
  observedAt: iso(-60_000)
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
    observedAt: iso(-6 * 60_000) // before the original observation
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

test('TASK-010 / TEST-018/021: expired original or candidate evidence cannot certify business recovery', () => {
 for (const [original,candidate] of [
   [{...validOriginalEvidence, observedAt:iso(-60 * 60_000)}, validCandidateEvidence],
   [validOriginalEvidence, {...validCandidateEvidence, observedAt:iso(-60 * 60_000)}]
 ] as const) {
   const result = evaluateBusinessAcceptanceGate(
     validAudit, validBackup, original, candidate, validOptions
   );
   assert.equal(result.status, 'BLOCKED');
   assert.equal(result.reason, 'EVIDENCE_EXPIRED');
   assert.equal(result.businessVerified, false);
   assert.equal(result.automaticPatchAllowed, false);
 }
});

test('TASK-010 / TEST-018/021: future-dated or same-instant receipts cannot authorize recovery', () => {
 const future = {...validCandidateEvidence, observedAt:iso(5 * 60_000)};
 const futureResult=evaluateBusinessAcceptanceGate(
   validAudit,validBackup,validOriginalEvidence,future,validOptions
 );
 assert.equal(futureResult.status,'BLOCKED');
 assert.equal(futureResult.reason,'EVIDENCE_FUTURE_DATED');
 const simultaneous={...validCandidateEvidence,observedAt:validOriginalEvidence.observedAt};
 const sameTime=evaluateBusinessAcceptanceGate(
   validAudit,validBackup,validOriginalEvidence,simultaneous,validOptions
 );
 assert.equal(sameTime.status,'BLOCKED');
 assert.equal(sameTime.reason,'EVIDENCE_TEMPORAL_INVERSION');
});


test('TASK-010 / TEST-018/021/026: contradictory audit authority and backup verification flags fail closed', () => {
  for (const [field,value] of [
    ['automaticPatchAllowed',true],
    ['tampermonkeyVerified',true],
    ['businessRecoveredVerified',true]
  ] as const) {
    const audit = {...validAudit,[field]:value};
    const result = evaluateBusinessAcceptanceGate(
      audit,validBackup,validOriginalEvidence,validCandidateEvidence,validOptions
    );
    assert.equal(result.status,'BLOCKED',field);
    assert.equal(result.reason,'AUDIT_NOT_REVIEWABLE',field);
    assert.equal(result.automaticPatchAllowed,false,field);
    assert.equal(result.businessVerified,false,field);
  }
  for (const [field,value] of [
    ['automaticPatchAllowed',true],
    ['automaticRollbackAllowed',true],
    ['tampermonkeyVerified',true],
    ['businessRecoveredVerified',true],
    ['backupByteLength',0],
    ['backupByteLength',-1],
    ['backupByteLength',Number.NaN]
  ] as const) {
    const backup = {...validBackup,[field]:value};
    const result = evaluateBusinessAcceptanceGate(
      validAudit,backup,validOriginalEvidence,validCandidateEvidence,validOptions
    );
    assert.equal(result.status,'BLOCKED',field);
    assert.equal(result.reason,'BACKUP_NOT_VERIFIED',field);
    assert.equal(result.automaticPatchAllowed,false,field);
    assert.equal(result.businessVerified,false,field);
  }
});

test('TASK-010 / TEST-018/021: TASK-009 CANDIDATE_READY_FOR_REVIEW passes business acceptance', () => {
  const metaBlock = '// ==UserScript==\n// @name Fault Test\n// @match https://example.com/*\n// @grant GM_getValue\n// ==/UserScript==\n';
  const scriptSource = metaBlock +
    'const unrelated = "#old";\n' +
    'const node = document.querySelector("#old");\n' +
    'console.log(node);\n';

  const scriptSha = createHash('sha256').update(scriptSource, 'utf8').digest('hex');

  const evidence: DiagnosticFaultEvidence = {
    faultEvidenceId: 'fault_obs_001',
    targetUrl: 'https://example.com/page',
    originalSelector: '#old',
    replacementSelector: '#new-element',
    scriptSha256: scriptSha
  };

  const candidatePkg = proposeConservativeRepairCandidateFromEvidence(
    scriptSource,
    evidence,
    {userApproved: true}
  );

  assert.equal(candidatePkg.status, 'CANDIDATE_READY_FOR_REVIEW');
  if (candidatePkg.status === 'CANDIDATE_READY_FOR_REVIEW') {
    const backup = {
      ...validBackup,
      sourceSha256: scriptSha,
      candidateSha256: candidatePkg.candidateSha256
    };
    const origEv = {
      ...validOriginalEvidence,
      sourceSha256: scriptSha
    };
    const candEv = {
      ...validCandidateEvidence,
      candidateSha256: candidatePkg.candidateSha256
    };

    const result = evaluateBusinessAcceptanceGate(
      candidatePkg,
      backup,
      origEv,
      candEv,
      validOptions
    );

    assert.equal(result.status, 'BUSINESS_ACCEPTED_AWAITING_TRANSACTION');
    assert.equal(result.originalSha256, scriptSha);
    assert.equal(result.candidateSha256, candidatePkg.candidateSha256);
    assert.equal(result.faultEvidenceId, 'fault_obs_001');
    assert.equal(result.automaticPatchAllowed, false);
    assert.equal(result.tampermonkeyVerified, true);
    assert.equal(result.businessVerified, true);
  }
});

test('TASK-010 / TEST-018/021: AbortSignal cancellation fails closed', () => {
  const controller = new AbortController();
  controller.abort();

  const result = evaluateBusinessAcceptanceGate(
    validAudit,
    validBackup,
    validOriginalEvidence,
    validCandidateEvidence,
    validOptions,
    controller.signal
  );

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reason, 'NOT_AUTHORIZED');
  assert.equal(result.automaticPatchAllowed, false);
  assert.equal(result.businessVerified, false);
});

test('TASK-010 / TEST-018/021: evaluateRollbackAcceptanceGate validates native restore receipt', () => {
  const validRollbackReceipt = {
    status: 'RESTORED_NATIVE_ONLY' as const,
    originalSha256: origSha,
    displacedSha256: candSha,
    displacedBackupFileName: 'candidate.user.js.bak-12345',
    journalFileName: 'restore.journal.json',
    automaticPatchAllowed: false as const,
    automaticRollbackAllowed: false as const,
    tampermonkeyVerified: false as const,
    businessRecoveredVerified: false as const
  };

  const success = evaluateRollbackAcceptanceGate(
    validRollbackReceipt,
    origSha,
    candSha,
    validOptions
  );

  assert.equal(success.status, 'ROLLBACK_ACCEPTED_ORIGINAL_RESTORED');
  assert.equal(success.originalSha256, origSha);
  assert.equal(success.displacedSha256, candSha);
  assert.equal(success.displacedBackupFileName, 'candidate.user.js.bak-12345');
  assert.equal(success.journalFileName, 'restore.journal.json');
  assert.equal(success.automaticPatchAllowed, false);
  assert.equal(success.automaticRollbackAllowed, false);
  // Native byte restoration is not evidence of manager execution or business recovery.
  assert.deepEqual([success.tampermonkeyVerified, success.businessVerified], [false, false]);

  const {businessRecoveredVerified, ...nativeFields} = validRollbackReceipt;
  const nativeReceipt = {...nativeFields, businessVerified: false};
  const native = evaluateRollbackAcceptanceGate(nativeReceipt, origSha, candSha, validOptions);
  assert.equal(native.status, 'ROLLBACK_ACCEPTED_ORIGINAL_RESTORED');
  assert.deepEqual([native.tampermonkeyVerified, native.businessVerified], [false, false]);
  assert.equal(native.automaticPatchAllowed, false);
  assert.equal(native.automaticRollbackAllowed, false);

  // Hash mismatch
  const foreignSha = 'f'.repeat(64);
  const badOrig = evaluateRollbackAcceptanceGate(
    validRollbackReceipt,
    foreignSha,
    candSha,
    validOptions
  );
  assert.equal(badOrig.status, 'BLOCKED');
  assert.equal(badOrig.reason, 'ORIGINAL_HASH_MISMATCH');

  const badDisplaced = evaluateRollbackAcceptanceGate(
    validRollbackReceipt,
    origSha,
    foreignSha,
    validOptions
  );
  assert.equal(badDisplaced.status, 'BLOCKED');
  assert.equal(badDisplaced.reason, 'DISPLACED_HASH_MISMATCH');

  // Cancelled signal
  const abortCtrl = new AbortController();
  abortCtrl.abort();
  const aborted = evaluateRollbackAcceptanceGate(
    validRollbackReceipt,
    origSha,
    candSha,
    validOptions,
    abortCtrl.signal
  );
  assert.equal(aborted.status, 'BLOCKED');
  assert.equal(aborted.reason, 'NOT_AUTHORIZED');

  // Proxy trap refused
  let trapCount = 0;
  const proxiedReceipt = new Proxy(validRollbackReceipt, {
    get(target, prop, receiver) {
      trapCount++;
      return Reflect.get(target, prop, receiver);
    }
  });
  const proxyResult = evaluateRollbackAcceptanceGate(
    proxiedReceipt,
    origSha,
    candSha,
    validOptions
  );
  assert.equal(proxyResult.status, 'BLOCKED');
  assert.equal(proxyResult.reason, 'ROLLBACK_RECEIPT_INVALID');
  assert.equal(trapCount, 0, 'Proxy traps on rollback receipt must not execute');
});

test('TASK-010 / TEST-018/021: identical original and candidate bytes cannot establish repair acceptance', () => {
  const result = evaluateBusinessAcceptanceGate(
    {...validAudit, candidateSha256: origSha},
    {...validBackup, candidateSha256: origSha},
    validOriginalEvidence,
    {...validCandidateEvidence, candidateSha256: origSha},
    validOptions
  );
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.automaticPatchAllowed, false);
  assert.equal(result.tampermonkeyVerified, false);
  assert.equal(result.businessVerified, false);
});

test('TASK-010 / TEST-018/021: whitespace-only evidence identifiers cannot establish business acceptance', () => {
  for (const [audit, backup] of [
    [{...validAudit, faultEvidenceId: '   '}, validBackup],
    [validAudit, {...validBackup, backupFileName: '   '}]
  ] as const) {
    const result = evaluateBusinessAcceptanceGate(
      audit, backup, validOriginalEvidence, validCandidateEvidence, validOptions
    );
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.automaticPatchAllowed, false);
    assert.equal(result.businessVerified, false);
  }
});

for (const receiptKind of ['native', 'legacy'] as const) {
  for (const field of ['displacedBackupFileName', 'journalFileName'] as const) {
    test(`TASK-010 / TEST-018/021: reject whitespace-only ${field} in ${receiptKind} rollback receipt`, () => {
      const receipt = {
        status: 'RESTORED_NATIVE_ONLY',
        originalSha256: origSha,
        displacedSha256: candSha,
        displacedBackupFileName: 'candidate.user.js.bak-12345',
        journalFileName: 'restore.journal.json',
        automaticPatchAllowed: false,
        automaticRollbackAllowed: false,
        tampermonkeyVerified: false,
        ...(receiptKind === 'native' ? {businessVerified: false} : {businessRecoveredVerified: false}),
        [field]: ' \t '
      };
      const result = evaluateRollbackAcceptanceGate(receipt, origSha, candSha, validOptions);
      assert.deepEqual(result, {
        status: 'BLOCKED',
        reason: 'ROLLBACK_RECEIPT_INVALID',
        automaticPatchAllowed: false,
        automaticRollbackAllowed: false,
        tampermonkeyVerified: false,
        businessVerified: false
      });
    });
  }
}
