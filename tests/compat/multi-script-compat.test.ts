import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {LimitedCompatibilityLayer} from '../../src/compat/compatibility-layer';
import {
  assessMultiScriptImpact,
  evaluateMultiScriptUpgrade,
  planSharedLayerRollback,
  type ScriptConsumerRegistration,
  type ConsumerRegressionReport
} from '../../src/compat/multi-script-compatibility';

// TASK-016 / REQ-025 / TEST-025: 多用户脚本兼容性与共享层回滚测试套件
// 验证共享兼容层升级时的多消费者依赖图分析、全覆盖回归防连带破坏（RISK-011）以及受控回滚计划。

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

const initialVersion = {
  version: '1.0.0',
  consumers: [HASH_A, HASH_B, HASH_C],
  bindings: [
    {key: 'submitBtn', selector: '#old-submit', attempts: 2, delayMs: 100, observeMutations: true},
    {key: 'navMenu', selector: '.nav-bar', attempts: 1, delayMs: 0, observeMutations: false},
    {key: 'statusBanner', selector: '#status-text', attempts: 3, delayMs: 50, observeMutations: true}
  ]
};

const candidateUpgrade = {
  version: '1.1.0',
  consumers: [HASH_A, HASH_B, HASH_C],
  bindings: [
    {key: 'submitBtn', selector: '#new-submit', attempts: 2, delayMs: 100, observeMutations: true}, // 变更
    {key: 'navMenu', selector: '.nav-bar', attempts: 1, delayMs: 0, observeMutations: false},       // 未变
    {key: 'statusBanner', selector: '#status-text', attempts: 3, delayMs: 50, observeMutations: true} // 未变
  ]
};

// 注册 3 个消费者脚本，分别具有不同的依赖绑定与版本上下限
const registrations: ScriptConsumerRegistration[] = [
  {
    scriptHash: HASH_A,
    scriptName: 'Script-Alpha-Cart',
    requiredBindings: ['submitBtn', 'navMenu'],
    minLayerVersion: '1.0.0',
    maxLayerVersion: '1.5.0'
  },
  {
    scriptHash: HASH_B,
    scriptName: 'Script-Beta-Checkout',
    requiredBindings: ['submitBtn'],
    minLayerVersion: '1.0.0',
    maxLayerVersion: '1.2.0'
  },
  {
    scriptHash: HASH_C,
    scriptName: 'Script-Gamma-Analytics',
    requiredBindings: ['statusBanner'],
    minLayerVersion: '1.0.0',
    maxLayerVersion: '2.0.0'
  }
];

test('TEST-025: assessMultiScriptImpact 准确识别受变更绑定影响的消费者子集', () => {
  const layer = new LimitedCompatibilityLayer(initialVersion);
  const impact = assessMultiScriptImpact(layer, candidateUpgrade, registrations);

  assert.equal(impact.hasChanges, true);
  assert.deepEqual(impact.changedBindingKeys, ['submitBtn']);
  // Script A 和 Script B 依赖了 submitBtn，属于受影响消费者
  assert.deepEqual([...impact.impactedConsumerHashes].sort(), [HASH_A, HASH_B].sort());
  // Script C 仅依赖 statusBanner，不受 submitBtn 改动影响
  assert.deepEqual(impact.unaffectedConsumerHashes, [HASH_C]);
  assert.equal(impact.versionCompatibilityOk, true);
});

test('TEST-025: 所有受影响消费者测试均通过时，升级评估通过暂存批准（但不自动激活）', () => {
  const layer = new LimitedCompatibilityLayer(initialVersion);
  const reports: ConsumerRegressionReport[] = [
    {scriptHash: HASH_A, passed: true, testedBindings: ['submitBtn'], executionEvidenceId: '1'.repeat(64)},
    {scriptHash: HASH_B, passed: true, testedBindings: ['submitBtn'], executionEvidenceId: '2'.repeat(64)}
  ];

  const decision = evaluateMultiScriptUpgrade({
    activeLayer: layer,
    candidate: candidateUpgrade,
    registrations,
    reports,
    userConsentToken: 'USER_AUTHORIZED_TOKEN_2026_TEST_025'
  });

  assert.equal(decision.status, 'APPROVED_FOR_STAGING');
  assert.equal(decision.automaticActivationAllowed, false);
  assert.equal(decision.automaticPatchAllowed, false);
  assert.equal(decision.automaticRollbackAllowed, false);
  assert.equal(decision.fromVersion, '1.0.0');
  assert.equal(decision.toVersion, '1.1.0');
  assert.deepEqual([...decision.impactedConsumers].sort(), [HASH_A, HASH_B].sort());
  assert.deepEqual([...decision.verifiedConsumers].sort(), [HASH_A, HASH_B].sort());
  assert.deepEqual(decision.failingConsumers, []);
});

test('TEST-025 / RISK-011: 任何一个受影响消费者测试未通过，升级必须立即 BLOCKED 防止连锁破坏', () => {
  const layer = new LimitedCompatibilityLayer(initialVersion);
  // Script A 通过，但 Script B 失败
  const reports: ConsumerRegressionReport[] = [
    {scriptHash: HASH_A, passed: true, testedBindings: ['submitBtn'], executionEvidenceId: '1'.repeat(64)},
    {scriptHash: HASH_B, passed: false, testedBindings: ['submitBtn'], executionEvidenceId: '2'.repeat(64), failureDetails: 'DOM node #new-submit not found in checkout frame'}
  ];

  const decision = evaluateMultiScriptUpgrade({
    activeLayer: layer,
    candidate: candidateUpgrade,
    registrations,
    reports,
    userConsentToken: 'USER_AUTHORIZED_TOKEN_2026_TEST_025'
  });

  assert.equal(decision.status, 'BLOCKED');
  assert.equal(decision.reason, 'CONSUMER_REGRESSION_DETECTED');
  assert.equal(decision.automaticActivationAllowed, false);
  assert.deepEqual(decision.failingConsumers, [HASH_B]);
  assert.deepEqual(decision.verifiedConsumers, [HASH_A]);
});

test('TEST-025: 受影响消费者缺少测试报告时必须 BLOCKED（INCOMPLETE_CONSUMER_COVERAGE）', () => {
  const layer = new LimitedCompatibilityLayer(initialVersion);
  // 仅提供了 Script A 的报告，遗漏了 Script B
  const reports: ConsumerRegressionReport[] = [
    {scriptHash: HASH_A, passed: true, testedBindings: ['submitBtn'], executionEvidenceId: '1'.repeat(64)}
  ];

  const decision = evaluateMultiScriptUpgrade({
    activeLayer: layer,
    candidate: candidateUpgrade,
    registrations,
    reports,
    userConsentToken: 'USER_AUTHORIZED_TOKEN_2026_TEST_025'
  });

  assert.equal(decision.status, 'BLOCKED');
  assert.equal(decision.reason, 'INCOMPLETE_CONSUMER_COVERAGE');
  assert.equal(decision.automaticActivationAllowed, false);
});

test('TEST-025: 升级候选版本超出任一消费者的 maxLayerVersion 限制时必须 BLOCKED', () => {
  const layer = new LimitedCompatibilityLayer(initialVersion);
  // 假设候选升级版本为 1.3.0，而 Script B 的 maxLayerVersion 是 1.2.0
  const highVersionCandidate = {
    ...candidateUpgrade,
    version: '1.3.0'
  };

  const reports: ConsumerRegressionReport[] = [
    {scriptHash: HASH_A, passed: true, testedBindings: ['submitBtn'], executionEvidenceId: '1'.repeat(64)},
    {scriptHash: HASH_B, passed: true, testedBindings: ['submitBtn'], executionEvidenceId: '2'.repeat(64)}
  ];

  const decision = evaluateMultiScriptUpgrade({
    activeLayer: layer,
    candidate: highVersionCandidate,
    registrations,
    reports,
    userConsentToken: 'USER_AUTHORIZED_TOKEN_2026_TEST_025'
  });

  assert.equal(decision.status, 'BLOCKED');
  assert.equal(decision.reason, 'VERSION_OUT_OF_BOUNDS');
});

test('TEST-025: 缺少用户授权令牌或令牌伪造时必须 BLOCKED（UNAUTHORIZED）', () => {
  const layer = new LimitedCompatibilityLayer(initialVersion);
  const reports: ConsumerRegressionReport[] = [
    {scriptHash: HASH_A, passed: true, testedBindings: ['submitBtn'], executionEvidenceId: '1'.repeat(64)},
    {scriptHash: HASH_B, passed: true, testedBindings: ['submitBtn'], executionEvidenceId: '2'.repeat(64)}
  ];

  for (const badToken of [null, undefined, '', '   ', 12345, {}]) {
    const decision = evaluateMultiScriptUpgrade({
      activeLayer: layer,
      candidate: candidateUpgrade,
      registrations,
      reports,
      userConsentToken: badToken
    });
    assert.equal(decision.status, 'BLOCKED');
    assert.equal(decision.reason, 'UNAUTHORIZED');
  }
});

test('TEST-025: 恶意 Proxy 与带有 getter 的输入拒绝执行并安全失败（Fail-Closed）', () => {
  let trapped = 0;
  const hostile = <T extends object>(val: T): T => new Proxy(val, {
    get(_t, k, r) {
      trapped++;
      return Reflect.get(val, k, r);
    },
    getPrototypeOf() {
      trapped++;
      return null;
    }
  });

  const layer = new LimitedCompatibilityLayer(initialVersion);
  const decision = evaluateMultiScriptUpgrade({
    activeLayer: layer,
    candidate: hostile({...candidateUpgrade}),
    registrations,
    reports: [{scriptHash: HASH_A, passed: true, testedBindings: ['submitBtn'], executionEvidenceId: '1'.repeat(64)}],
    userConsentToken: 'TOKEN'
  });

  assert.equal(decision.status, 'BLOCKED');
  assert.equal(decision.reason, 'INVALID_INPUT');
  assert.equal(trapped, 0, 'Proxy traps must not be executed at boundary');
});

test('TEST-025: planSharedLayerRollback 成功规划受控基线回退并包含多脚本审计证据', () => {
  // 当前处于 1.1.0 版本
  const currentLayer = new LimitedCompatibilityLayer(candidateUpgrade);
  // 回滚目标为 1.0.0
  const rollbackPlan = planSharedLayerRollback({
    currentLayer,
    targetBaseline: initialVersion,
    registrations,
    userConsentToken: 'USER_ROLLBACK_CONFIRMATION_TOKEN'
  });

  assert.equal(rollbackPlan.status, 'APPROVED_FOR_ROLLBACK');
  assert.equal(rollbackPlan.fromVersion, '1.1.0');
  assert.equal(rollbackPlan.toVersion, '1.0.0');
  assert.equal(rollbackPlan.automaticRollbackAllowed, false);
  assert.deepEqual([...rollbackPlan.affectedConsumers].sort(), [HASH_A, HASH_B].sort());
  assert.ok(rollbackPlan.rollbackAuditDigest.length === 64);
});

test('TEST-025: planSharedLayerRollback 拒绝未经授权或前向升级冒充回滚', () => {
  const currentLayer = new LimitedCompatibilityLayer(initialVersion);
  // 试图把更高版本假冒成回滚
  const badRollback = planSharedLayerRollback({
    currentLayer,
    targetBaseline: candidateUpgrade, // 1.1.0 相比 1.0.0 不是回滚
    registrations,
    userConsentToken: 'TOKEN'
  });

  assert.equal(badRollback.status, 'REJECTED');
  assert.equal(badRollback.reason, 'INVALID_ROLLBACK_TARGET');

  // 未授权
  const unauthRollback = planSharedLayerRollback({
    currentLayer: new LimitedCompatibilityLayer(candidateUpgrade),
    targetBaseline: initialVersion,
    registrations,
    userConsentToken: ''
  });
  assert.equal(unauthRollback.status, 'REJECTED');
  assert.equal(unauthRollback.reason, 'UNAUTHORIZED');
});
