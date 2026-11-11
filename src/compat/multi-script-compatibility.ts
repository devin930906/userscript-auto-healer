/**
 * TASK-016 / REQ-025 / TEST-025: 多用户脚本兼容性与共享层回滚核验体系
 *
 * 核心设计目标：
 * 1. 多脚本消费者依赖拓扑分析：分析共享定位器/重试策略变更时，精确识别受影响的脚本集合。
 * 2. 批量回归与连锁破坏防护（RISK-011）：若升级破坏任一消费者的业务执行，全量阻断升级。
 * 3. 严格安全边界（Fail-Closed）：输入防御（Proxy/getter 陷阱拦截）、必须具备显式用户授权。
 * 4. 受控共享层回滚（Rollback）：发生故障时提供向稳定基线版本受控回滚的计划与可审计凭据。
 * 5. 坚决杜绝静默自动激活与自动修改：保持 automaticActivationAllowed: false, automaticRollbackAllowed: false。
 */

import {createHash} from 'node:crypto';
import {types as nodeTypes} from 'node:util';
import type {
  CompatibilityVersion,
  LimitedCompatibilityLayer,
  LocatorBinding
} from './compatibility-layer.js';

/**
 * 消费者用户脚本注册信息契约
 */
export type ScriptConsumerRegistration = Readonly<{
  scriptHash: string;
  scriptName: string;
  requiredBindings: readonly string[];
  minLayerVersion: string;
  maxLayerVersion: string;
}>;

/**
 * 单个消费者脚本的回归测试报告契约
 */
export type ConsumerRegressionReport = Readonly<{
  scriptHash: string;
  passed: boolean;
  testedBindings: readonly string[];
  executionEvidenceId: string;
  failureDetails?: string;
}>;

/**
 * 多脚本影响分析摘要
 */
export type MultiScriptImpactSummary = Readonly<{
  hasChanges: boolean;
  changedBindingKeys: readonly string[];
  impactedConsumerHashes: readonly string[];
  unaffectedConsumerHashes: readonly string[];
  versionCompatibilityOk: boolean;
  incompatibleConsumers: readonly string[];
}>;

/**
 * 多脚本升级评估决议契约
 */
export type MultiScriptUpgradeAssessment =
  | Readonly<{
      status: 'APPROVED_FOR_STAGING';
      fromVersion: string;
      toVersion: string;
      impactedConsumers: readonly string[];
      verifiedConsumers: readonly string[];
      failingConsumers: readonly [];
      automaticActivationAllowed: false;
      automaticPatchAllowed: false;
      automaticRollbackAllowed: false;
    }>
  | Readonly<{
      status: 'BLOCKED';
      reason:
        | 'INCOMPLETE_CONSUMER_COVERAGE'
        | 'CONSUMER_REGRESSION_DETECTED'
        | 'VERSION_OUT_OF_BOUNDS'
        | 'UNAUTHORIZED'
        | 'INVALID_INPUT';
      impactedConsumers?: readonly string[];
      verifiedConsumers?: readonly string[];
      failingConsumers?: readonly string[];
      automaticActivationAllowed: false;
      automaticPatchAllowed: false;
      automaticRollbackAllowed: false;
    }>;

/**
 * 共享层回滚计划契约
 */
export type SharedLayerRollbackPlan =
  | Readonly<{
      status: 'APPROVED_FOR_ROLLBACK';
      fromVersion: string;
      toVersion: string;
      affectedConsumers: readonly string[];
      rollbackAuditDigest: string;
      automaticRollbackAllowed: false;
    }>
  | Readonly<{
      status: 'REJECTED';
      reason: 'INVALID_ROLLBACK_TARGET' | 'UNAUTHORIZED' | 'INVALID_INPUT' | 'VERSION_OUT_OF_BOUNDS';
      automaticRollbackAllowed: false;
    }>;

const HASH_REGEX = /^[a-f0-9]{64}$/;
const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * 解析 SemVer 字符串为三元整数数组
 */
function parseSemverParts(version: unknown): [number, number, number] {
  if (typeof version !== 'string' || !SEMVER_REGEX.test(version)) {
    throw new Error('INVALID_SEMVER_FORMAT');
  }
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isSafeInteger(n) || n < 0)) {
    throw new Error('INVALID_SEMVER_PARTS');
  }
  return [parts[0], parts[1], parts[2]];
}

/**
 * 比较两个版本号:
 * 返回 > 0 如果 a > b
 * 返回 < 0 如果 a < b
 * 返回 0 如果 a === b
 */
function compareSemver(a: string, b: string): number {
  const partsA = parseSemverParts(a);
  const partsB = parseSemverParts(b);
  for (let i = 0; i < 3; i++) {
    if (partsA[i] !== partsB[i]) {
      return partsA[i] - partsB[i];
    }
  }
  return 0;
}

/**
 * 检查版本 v 是否在 [minVersion, maxVersion] 范围内（包含两端）
 */
function isVersionInRange(v: string, minV: string, maxV: string): boolean {
  return compareSemver(v, minV) >= 0 && compareSemver(v, maxV) <= 0;
}

/**
 * 严格验证输入对象为非 Proxy 的 Plain Object，并提取指定自有属性
 */
function extractOwnProps(
  input: unknown,
  expectedKeys: readonly string[]
): Record<string, unknown> | null {
  if (
    !input ||
    typeof input !== 'object' ||
    nodeTypes.isProxy(input) ||
    Array.isArray(input)
  ) {
    return null;
  }
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.length !== expectedKeys.length) {
    return null;
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(descriptors, key)) {
      return null;
    }
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor) || descriptor.get || descriptor.set) {
      return null;
    }
    result[key] = descriptor.value;
  }
  return result;
}

/**
 * 严格验证安全数组
 */
function extractSafeArray(input: unknown, maxLen = 128): readonly unknown[] | null {
  if (
    !input ||
    nodeTypes.isProxy(input) ||
    !Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Array.prototype ||
    input.length < 0 ||
    input.length > maxLen
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== input.length + 1) {
    return null;
  }
  const output: unknown[] = [];
  for (let i = 0; i < input.length; i++) {
    const desc = descriptors[String(i)];
    if (!desc || !('value' in desc) || desc.get || desc.set) {
      return null;
    }
    Object.defineProperty(output, i, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: desc.value
    });
  }
  return Object.freeze(output);
}

/**
 * 严格解析 ScriptConsumerRegistration
 */
function parseConsumerRegistration(raw: unknown): ScriptConsumerRegistration | null {
  const extracted = extractOwnProps(raw, [
    'scriptHash',
    'scriptName',
    'requiredBindings',
    'minLayerVersion',
    'maxLayerVersion'
  ]);
  if (!extracted) return null;
  if (typeof extracted.scriptHash !== 'string' || !HASH_REGEX.test(extracted.scriptHash)) {
    return null;
  }
  if (
    typeof extracted.scriptName !== 'string' ||
    extracted.scriptName.trim().length === 0 ||
    extracted.scriptName.length > 128 ||
    /[\x00-\x1f\x7f]/.test(extracted.scriptName)
  ) {
    return null;
  }
  const rawBindings = extractSafeArray(extracted.requiredBindings, 64);
  if (!rawBindings) return null;
  const bindings: string[] = [];
  for (const b of rawBindings) {
    if (typeof b !== 'string' || b.trim().length === 0 || b.length > 64) {
      return null;
    }
    bindings.push(b);
  }
  try {
    parseSemverParts(extracted.minLayerVersion);
    parseSemverParts(extracted.maxLayerVersion);
  } catch {
    return null;
  }
  return Object.freeze({
    scriptHash: extracted.scriptHash,
    scriptName: extracted.scriptName,
    requiredBindings: Object.freeze(bindings),
    minLayerVersion: extracted.minLayerVersion as string,
    maxLayerVersion: extracted.maxLayerVersion as string
  });
}

/**
 * 严格解析 ConsumerRegressionReport
 */
function parseRegressionReport(raw: unknown): ConsumerRegressionReport | null {
  if (!raw || typeof raw !== 'object' || nodeTypes.isProxy(raw)) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const ownKeys = Reflect.ownKeys(descriptors);
  const hasDetails = ownKeys.includes('failureDetails');
  const expectedKeys = hasDetails
    ? ['scriptHash', 'passed', 'testedBindings', 'executionEvidenceId', 'failureDetails']
    : ['scriptHash', 'passed', 'testedBindings', 'executionEvidenceId'];

  const extracted = extractOwnProps(raw, expectedKeys);
  if (!extracted) return null;

  if (typeof extracted.scriptHash !== 'string' || !HASH_REGEX.test(extracted.scriptHash)) {
    return null;
  }
  if (typeof extracted.passed !== 'boolean') {
    return null;
  }
  if (typeof extracted.executionEvidenceId !== 'string' || extracted.executionEvidenceId.length < 16) {
    return null;
  }
  const rawTested = extractSafeArray(extracted.testedBindings, 64);
  if (!rawTested) return null;
  const testedBindings: string[] = [];
  for (const t of rawTested) {
    if (typeof t !== 'string') return null;
    testedBindings.push(t);
  }
  let failureDetails: string | undefined;
  if (hasDetails) {
    if (typeof extracted.failureDetails !== 'string' || extracted.failureDetails.length > 512) {
      return null;
    }
    failureDetails = extracted.failureDetails;
  }

  return Object.freeze({
    scriptHash: extracted.scriptHash,
    passed: extracted.passed,
    testedBindings: Object.freeze(testedBindings),
    executionEvidenceId: extracted.executionEvidenceId,
    ...(failureDetails !== undefined ? {failureDetails} : {})
  });
}

/**
 * 分析当前活跃层与升级候选之间绑定的差异，并定位受影响的消费者脚本列表
 */
export function assessMultiScriptImpact(
  activeLayer: LimitedCompatibilityLayer,
  candidate: CompatibilityVersion,
  registrations: readonly ScriptConsumerRegistration[]
): MultiScriptImpactSummary {
  const activeSnapshot = activeLayer.snapshot();
  const activeBindings = activeSnapshot.active.bindings;
  const candidateBindings = candidate.bindings;

  const activeBindingMap = new Map<string, LocatorBinding>();
  for (const b of activeBindings) {
    activeBindingMap.set(b.key, b);
  }

  const changedBindingKeysSet = new Set<string>();

  // 1. 查找被修改或新增的绑定
  for (const cb of candidateBindings) {
    const existing = activeBindingMap.get(cb.key);
    if (!existing) {
      changedBindingKeysSet.add(cb.key);
      continue;
    }
    if (
      existing.selector !== cb.selector ||
      existing.attempts !== cb.attempts ||
      existing.delayMs !== cb.delayMs ||
      existing.observeMutations !== cb.observeMutations
    ) {
      changedBindingKeysSet.add(cb.key);
    }
  }

  // 2. 查找在 candidate 中被移除的绑定
  const candidateKeySet = new Set(candidateBindings.map((b) => b.key));
  for (const ab of activeBindings) {
    if (!candidateKeySet.has(ab.key)) {
      changedBindingKeysSet.add(ab.key);
    }
  }

  const changedBindingKeys = Array.from(changedBindingKeysSet).sort();
  const impactedConsumersSet = new Set<string>();
  const unaffectedConsumersSet = new Set<string>();
  const incompatibleConsumersSet = new Set<string>();

  // 3. 消费者依赖映射与版本区间匹配
  for (const reg of registrations) {
    const isImpacted = reg.requiredBindings.some((reqKey) => changedBindingKeysSet.has(reqKey));
    if (isImpacted) {
      impactedConsumersSet.add(reg.scriptHash);
    } else {
      unaffectedConsumersSet.add(reg.scriptHash);
    }

    // 检查候选版本是否处于消费者的允许范围内
    if (!isVersionInRange(candidate.version, reg.minLayerVersion, reg.maxLayerVersion)) {
      incompatibleConsumersSet.add(reg.scriptHash);
    }
  }

  return Object.freeze({
    hasChanges: changedBindingKeys.length > 0,
    changedBindingKeys: Object.freeze(changedBindingKeys),
    impactedConsumerHashes: Object.freeze(Array.from(impactedConsumersSet).sort()),
    unaffectedConsumerHashes: Object.freeze(Array.from(unaffectedConsumersSet).sort()),
    versionCompatibilityOk: incompatibleConsumersSet.size === 0,
    incompatibleConsumers: Object.freeze(Array.from(incompatibleConsumersSet).sort())
  });
}

/**
 * 评估多用户脚本升级请求
 *
 * 遵循严格原则：
 * - 只有所有受影响消费者均经过验证且结果通过时，才允许暂存（APPROVED_FOR_STAGING）。
 * - 任何回归失败立即阻断（CONSUMER_REGRESSION_DETECTED）。
 * - 缺少受影响消费者的回归报告立即阻断（INCOMPLETE_CONSUMER_COVERAGE）。
 * - 越界版本或未授权操作立即阻断。
 * - 永远不会自动激活或静默修改文件。
 */
export function evaluateMultiScriptUpgrade(options: {
  activeLayer: LimitedCompatibilityLayer;
  candidate: unknown;
  registrations: unknown;
  reports: unknown;
  userConsentToken: unknown;
}): MultiScriptUpgradeAssessment {
  // 1. 验证用户授权令牌
  if (
    typeof options.userConsentToken !== 'string' ||
    options.userConsentToken.trim().length === 0 ||
    options.userConsentToken.length > 256 ||
    /[\x00-\x1f\x7f]/.test(options.userConsentToken)
  ) {
    return Object.freeze({
      status: 'BLOCKED' as const,
      reason: 'UNAUTHORIZED' as const,
      automaticActivationAllowed: false as const,
      automaticPatchAllowed: false as const,
      automaticRollbackAllowed: false as const
    });
  }

  // 2. 验证并解析 Candidate
  if (!options.candidate || typeof options.candidate !== 'object' || nodeTypes.isProxy(options.candidate)) {
    return Object.freeze({
      status: 'BLOCKED' as const,
      reason: 'INVALID_INPUT' as const,
      automaticActivationAllowed: false as const,
      automaticPatchAllowed: false as const,
      automaticRollbackAllowed: false as const
    });
  }

  let candidateVersion: CompatibilityVersion;
  try {
    const candidateObj = options.candidate as CompatibilityVersion;
    if (typeof candidateObj.version !== 'string' || !Array.isArray(candidateObj.bindings)) {
      throw new Error('INVALID_CANDIDATE');
    }
    candidateVersion = candidateObj;
  } catch {
    return Object.freeze({
      status: 'BLOCKED' as const,
      reason: 'INVALID_INPUT' as const,
      automaticActivationAllowed: false as const,
      automaticPatchAllowed: false as const,
      automaticRollbackAllowed: false as const
    });
  }

  // 3. 验证并解析 Registrations
  const safeRegistrationsArray = extractSafeArray(options.registrations, 64);
  if (!safeRegistrationsArray) {
    return Object.freeze({
      status: 'BLOCKED' as const,
      reason: 'INVALID_INPUT' as const,
      automaticActivationAllowed: false as const,
      automaticPatchAllowed: false as const,
      automaticRollbackAllowed: false as const
    });
  }
  const parsedRegistrations: ScriptConsumerRegistration[] = [];
  for (const item of safeRegistrationsArray) {
    const parsed = parseConsumerRegistration(item);
    if (!parsed) {
      return Object.freeze({
        status: 'BLOCKED' as const,
        reason: 'INVALID_INPUT' as const,
        automaticActivationAllowed: false as const,
        automaticPatchAllowed: false as const,
        automaticRollbackAllowed: false as const
      });
    }
    parsedRegistrations.push(parsed);
  }

  // 4. 影响与版本分析
  let impact: MultiScriptImpactSummary;
  try {
    impact = assessMultiScriptImpact(options.activeLayer, candidateVersion, parsedRegistrations);
  } catch {
    return Object.freeze({
      status: 'BLOCKED' as const,
      reason: 'INVALID_INPUT' as const,
      automaticActivationAllowed: false as const,
      automaticPatchAllowed: false as const,
      automaticRollbackAllowed: false as const
    });
  }

  if (!impact.versionCompatibilityOk) {
    return Object.freeze({
      status: 'BLOCKED' as const,
      reason: 'VERSION_OUT_OF_BOUNDS' as const,
      automaticActivationAllowed: false as const,
      automaticPatchAllowed: false as const,
      automaticRollbackAllowed: false as const
    });
  }

  // 5. 验证并解析 Reports
  const safeReportsArray = extractSafeArray(options.reports, 128);
  if (!safeReportsArray) {
    return Object.freeze({
      status: 'BLOCKED' as const,
      reason: 'INVALID_INPUT' as const,
      automaticActivationAllowed: false as const,
      automaticPatchAllowed: false as const,
      automaticRollbackAllowed: false as const
    });
  }

  const reportsByScript = new Map<string, ConsumerRegressionReport>();
  for (const item of safeReportsArray) {
    const parsed = parseRegressionReport(item);
    if (!parsed) {
      return Object.freeze({
        status: 'BLOCKED' as const,
        reason: 'INVALID_INPUT' as const,
        automaticActivationAllowed: false as const,
        automaticPatchAllowed: false as const,
        automaticRollbackAllowed: false as const
      });
    }
    reportsByScript.set(parsed.scriptHash, parsed);
  }

  // 6. 核查每一个受影响消费者的报告
  const verifiedConsumers: string[] = [];
  const failingConsumers: string[] = [];

  for (const scriptHash of impact.impactedConsumerHashes) {
    const report = reportsByScript.get(scriptHash);
    if (!report) {
      // 缺少报告：阻断
      return Object.freeze({
        status: 'BLOCKED' as const,
        reason: 'INCOMPLETE_CONSUMER_COVERAGE' as const,
        impactedConsumers: impact.impactedConsumerHashes,
        automaticActivationAllowed: false as const,
        automaticPatchAllowed: false as const,
        automaticRollbackAllowed: false as const
      });
    }
    if (report.passed !== true) {
      failingConsumers.push(scriptHash);
    } else {
      verifiedConsumers.push(scriptHash);
    }
  }

  if (failingConsumers.length > 0) {
    return Object.freeze({
      status: 'BLOCKED' as const,
      reason: 'CONSUMER_REGRESSION_DETECTED' as const,
      impactedConsumers: impact.impactedConsumerHashes,
      verifiedConsumers: Object.freeze(verifiedConsumers.sort()),
      failingConsumers: Object.freeze(failingConsumers.sort()),
      automaticActivationAllowed: false as const,
      automaticPatchAllowed: false as const,
      automaticRollbackAllowed: false as const
    });
  }

  const activeSnapshot = options.activeLayer.snapshot();
  return Object.freeze({
    status: 'APPROVED_FOR_STAGING' as const,
    fromVersion: activeSnapshot.active.version,
    toVersion: candidateVersion.version,
    impactedConsumers: impact.impactedConsumerHashes,
    verifiedConsumers: Object.freeze(verifiedConsumers.sort()),
    failingConsumers: Object.freeze([] as const),
    automaticActivationAllowed: false as const,
    automaticPatchAllowed: false as const,
    automaticRollbackAllowed: false as const
  });
}

/**
 * 规划受控的共享层回滚操作
 */
export function planSharedLayerRollback(options: {
  currentLayer: LimitedCompatibilityLayer;
  targetBaseline: unknown;
  registrations: unknown;
  userConsentToken: unknown;
}): SharedLayerRollbackPlan {
  // 1. 验证用户授权令牌
  if (
    typeof options.userConsentToken !== 'string' ||
    options.userConsentToken.trim().length === 0 ||
    options.userConsentToken.length > 256 ||
    /[\x00-\x1f\x7f]/.test(options.userConsentToken)
  ) {
    return Object.freeze({
      status: 'REJECTED' as const,
      reason: 'UNAUTHORIZED' as const,
      automaticRollbackAllowed: false as const
    });
  }

  // 2. 验证目标基线版本
  if (!options.targetBaseline || typeof options.targetBaseline !== 'object' || nodeTypes.isProxy(options.targetBaseline)) {
    return Object.freeze({
      status: 'REJECTED' as const,
      reason: 'INVALID_INPUT' as const,
      automaticRollbackAllowed: false as const
    });
  }

  const currentSnapshot = options.currentLayer.snapshot();
  const currentVersion = currentSnapshot.active.version;
  const baseline = options.targetBaseline as CompatibilityVersion;

  try {
    if (typeof baseline.version !== 'string' || !Array.isArray(baseline.bindings)) {
      throw new Error('INVALID_BASELINE');
    }
    // 回滚必须严格走向更旧（更小）的版本
    if (compareSemver(baseline.version, currentVersion) >= 0) {
      return Object.freeze({
        status: 'REJECTED' as const,
        reason: 'INVALID_ROLLBACK_TARGET' as const,
        automaticRollbackAllowed: false as const
      });
    }
  } catch {
    return Object.freeze({
      status: 'REJECTED' as const,
      reason: 'INVALID_ROLLBACK_TARGET' as const,
      automaticRollbackAllowed: false as const
    });
  }

  // 3. 解析注册信息
  const safeRegistrationsArray = extractSafeArray(options.registrations, 64);
  if (!safeRegistrationsArray) {
    return Object.freeze({
      status: 'REJECTED' as const,
      reason: 'INVALID_INPUT' as const,
      automaticRollbackAllowed: false as const
    });
  }
  const parsedRegistrations: ScriptConsumerRegistration[] = [];
  for (const item of safeRegistrationsArray) {
    const parsed = parseConsumerRegistration(item);
    if (!parsed) {
      return Object.freeze({
        status: 'REJECTED' as const,
        reason: 'INVALID_INPUT' as const,
        automaticRollbackAllowed: false as const
      });
    }
    parsedRegistrations.push(parsed);
  }

  // 4. 验证基线版本在所有消费者的兼容区间内
  for (const reg of parsedRegistrations) {
    if (!isVersionInRange(baseline.version, reg.minLayerVersion, reg.maxLayerVersion)) {
      return Object.freeze({
        status: 'REJECTED' as const,
        reason: 'VERSION_OUT_OF_BOUNDS' as const,
        automaticRollbackAllowed: false as const
      });
    }
  }

  // 5. 计算受影响的消费者
  const impact = assessMultiScriptImpact(options.currentLayer, baseline, parsedRegistrations);

  // 6. 生成回滚审计 SHA-256 摘要
  const auditPayload = JSON.stringify({
    schema: 'uah-shared-layer-rollback-v1',
    fromVersion: currentVersion,
    toVersion: baseline.version,
    affectedConsumers: impact.impactedConsumerHashes,
    token: options.userConsentToken
  });
  const auditDigest = createHash('sha256').update(auditPayload, 'utf8').digest('hex');

  return Object.freeze({
    status: 'APPROVED_FOR_ROLLBACK' as const,
    fromVersion: currentVersion,
    toVersion: baseline.version,
    affectedConsumers: impact.impactedConsumerHashes,
    rollbackAuditDigest: auditDigest,
    automaticRollbackAllowed: false as const
  });
}
