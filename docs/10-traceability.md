# 工程要求追踪矩阵

> 状态：准备阶段的设计映射，代码及测试未运行。

## 原始要求映射
I-001=用户故障成本；I-002=Chrome/CDP/Profile；I-003=文件导入与批量；I-004=AST/动态诊断/自愈；I-005=验收/备份回滚/监控；I-006=共享兼容层；I-007=AI；I-008=补充安全和管理器行为约束；I-009=开发前原始 Windows EXE+RAR 历史约束；I-010=用户 2026-10-18 明确将便携格式变更为 ZIP（覆盖 I-009 的 RAR 部分，保留 EXE）。源原文 docs/00-intake.md，正式需求 docs/02-requirements.md。

## 功能需求映射
| 来源 | 功能需求 | 负责架构模块 | 开发任务 | 测试映射 | 发布门槛 |
|---|---|---|---|---|---|
| I-003 | REQ-001 | ImportService | TASK-002 | TEST-001 | GATE-001..007 |
| I-003 | REQ-002 | ImportService | TASK-002 | TEST-002 | GATE-001..007 |
| I-003 | REQ-003 | ImportService | TASK-002 | TEST-003 | GATE-001..007 |
| I-008 | REQ-004 | MetadataAst | TASK-003 | TEST-004 | GATE-001..007 |
| I-008 | REQ-005 | ScenarioRegistry | TASK-004 | TEST-005 | GATE-001..007 |
| I-002 | REQ-006 | ChromeLauncher | TASK-005 | TEST-006 | GATE-001..007 |
| I-002 | REQ-007 | ChromeLauncher | TASK-005 | TEST-007 | GATE-001..007 |
| I-002 | REQ-008 | ChromeLauncher | TASK-005 | TEST-008 | GATE-001..007 |
| I-002 | REQ-009 | CdpSession | TASK-005 | TEST-009 | GATE-001..007 |
| I-002 | REQ-010 | PageObserver | TASK-006 | TEST-010 | GATE-001..007 |
| I-004 | REQ-011 | MetadataAst | TASK-003 | TEST-011 | GATE-001..007 |
| I-004 | REQ-012 | PageObserver | TASK-006 | TEST-012 | GATE-001..007 |
| I-004 | REQ-013 | Diagnostics | TASK-008 | TEST-013 | GATE-001..007 |
| I-004 | REQ-014 | RepairService | TASK-009 | TEST-014 | GATE-001..007 |
| I-007 | REQ-015 | AIGateway | TASK-014 | TEST-015 | GATE-001..007 |
| I-007 | REQ-016 | AIGateway | TASK-014 | TEST-016 | GATE-001..007 |
| I-008 | REQ-017 | ManagerAdapter | TASK-007 | TEST-017 | GATE-001..007 |
| I-005 | REQ-018 | AcceptanceGate | TASK-007, TASK-010 | TEST-018 | GATE-001..007 |
| I-008 | REQ-019 | RepairService | TASK-009 | TEST-019 | GATE-001..007 |
| I-005 | REQ-020 | VersionStore | TASK-011 | TEST-020 | GATE-001..007 |
| I-008 | REQ-021 | AcceptanceGate | TASK-010, TASK-011 | TEST-021 | GATE-001..007 |
| I-003 | REQ-022 | BatchCoordinator | TASK-013 | TEST-022 | GATE-001..007 |
| I-008 | REQ-023 | VersionStore/Export | TASK-012 | TEST-023 | GATE-001..007 |
| I-005 | REQ-024 | HealthHistory | TASK-015 | TEST-024 | GATE-001..007 |
| I-006 | REQ-025 | CompatibilityLayer | TASK-016 | TEST-025 | GATE-001..007 |
| I-008 | REQ-026 | SecurityBoundary | TASK-001, TASK-018 | TEST-026 | GATE-001..007 |
| I-009 | REQ-027 | WindowsPackaging | TASK-019 | TEST-027 | GATE-008 |
| I-010 | REQ-028 | WindowsPackaging | TASK-020 | TEST-028 | GATE-009 |

## 非功能需求映射
| 编号 | 技术依据 | 任务与测试 | 发布门槛 |
|---|---|---|---|
| NFR-001..004 | docs/04-architecture.md、docs/06-security-risk.md | TASK-001/005/011/018；TEST-007/009/020/026 | GATE-006/007 |
| NFR-005..008 | docs/04-architecture.md、docs/07-testing.md | TASK-003/007/013/016；TEST-011/017/018/022/025 | GATE-003/004/005/007 |
| NFR-009..012 | docs/06-security-risk.md、docs/08-release.md | TASK-014/018/019/020；TEST-015/016/027/028 | GATE-006/008/009/011 |

## 架构映射
以本表模块为唯一主要负责位置，输入/输出与异常边界见 docs/04-architecture.md；重大技术决定分别见 docs/adr/ADR-001-application-baseline.md、ADR-002-real-userscript-acceptance.md、ADR-003-windows-dual-package.md。

## 开发任务映射
TASK-001..021 由 docs/09-development-plan.md 定义，编号不代表已经创建 GitHub Issue；所有预计源码路径在实际实施前均不存在。

## 测试映射
REQ-001..028 对应 TEST-001..028；测试层级、前置与反例见 docs/07-testing.md。无真实运行证据。

## 发布门槛映射
GATE-001..011 的证据和阻断等级以 docs/08-release.md 为权威；表内缩写仅表示关联类别，不是范围取代其逐项要求。

## 覆盖缺口
Chrome/CDP 和独立 Profile、限定真实 Violentmonkey .user.js 注入/GM_getValue（https://github.com/devin930906/userscript-auto-healer/actions/runs/39092523277）、Inno Setup 临时安装器与历史真实 RAR5 格式已有开发前技术 PoC 证据（不是现行 ZIP 产品验收）；仍缺首选 Tampermonkey 与正式 Chrome/便携版的支持矩阵、真实损坏脚本修复/业务回归、现行 ZIP 应用完整性及便携测试、真实产品 EXE/ZIP 安装直启和应用 LICENSE 定案。原始用户输入中的各项核心功能已进入 REQ-001..026，双 Windows 包为 REQ-027/028；仍须逐字复查 00 与需求编号以确定完整覆盖。
