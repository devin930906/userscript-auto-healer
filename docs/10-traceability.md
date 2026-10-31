# 工程要求追踪矩阵

> 状态：准备阶段的设计映射，代码及测试未运行。

## 原始要求映射
I-001=用户故障成本；I-002=Chrome/CDP/Profile；I-003=文件导入与批量；I-004=AST/动态诊断/自愈；I-005=验收/备份回滚/监控；I-006=共享兼容层；I-007=AI；I-008=补充安全和管理器行为约束；I-009=开发前原始 Windows EXE+RAR 历史约束；I-010=用户 2026-10-18 明确将便携格式变更为 ZIP（覆盖 I-009 的 RAR 部分，保留 EXE）；I-011=用户 2026-10-18 确认 Tampermonkey 首选，纠正 Violentmonkey 验收替代风险。源原文 docs/00-intake.md，正式需求 docs/02-requirements.md。

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
| I-011 | REQ-017 | TampermonkeyManagerAdapter | TASK-007 | TEST-017 | GATE-001..007 |
| I-011 | REQ-018 | TampermonkeyAcceptanceGate | TASK-007, TASK-010 | TEST-018 | GATE-001..007 |
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
TASK-001..021 由 docs/09-development-plan.md 定义，编号不代表已经创建 GitHub Issue；TASK-001/002 的部分预计源码路径已实际创建，其余路径仍随对应任务实施。

## 测试映射
REQ-001..028 对应 TEST-001..028；测试层级、前置与反例见 docs/07-testing.md。TASK-001/002 的受限 Windows/Electron 自动化运行记录已存在；不能视作其它 TEST 或 Stable GATE 已通过。

## 发布门槛映射
GATE-001..011 的证据和阻断等级以 docs/08-release.md 为权威；表内缩写仅表示关联类别，不是范围取代其逐项要求。

## 覆盖缺口
Chrome/CDP 和独立 Profile、限定真实 Violentmonkey .user.js 注入/GM_getValue（https://github.com/devin930906/userscript-auto-healer/actions/runs/39092523277）、Inno Setup 临时安装器与历史真实 RAR5 格式已有开发前技术 PoC 证据（不是现行 ZIP 产品验收）；仍缺首选 Tampermonkey 与正式 Chrome/便携版的支持矩阵、真实损坏脚本修复/业务回归、现行 ZIP 应用完整性及便携测试、真实产品 EXE/ZIP 安装直启和应用 LICENSE 定案。原始用户输入中的各项核心功能已进入 REQ-001..026，双 Windows 包为 REQ-027/028；仍须逐字复查 00 与需求编号以确定完整覆盖。

## 2026-10-29 GitHub Issues ↔ TASK ↔ 验证证据增量追踪

> 保持以上 REQ-001..028 的 28 行权威映射与现有 NFR、GATE 定义不变。本节只为已确认的活跃 GitHub Issues 增加外部追踪层；`TASK-001..021` 是正式开发计划编号，GitHub `#N` 为另一套独立序列。历史记录以仓库真实提交、CI 与验收证据为准。

| GitHub Issue | 正式 TASK | 已知关联需求 / 验证 | 现存缺口和规则 |
| --- | --- | --- | --- |
| [#486](https://github.com/devin930906/userscript-auto-healer/issues/486) | `TASK-007` | REQ-017/018；TEST-017/018；GATE-004/005 | 真实 Tampermonkey 可信身份、明确支持矩阵及真实业务产品级验收未闭环 |
| [#480](https://github.com/devin930906/userscript-auto-healer/issues/480) | `TASK-008` | REQ-013；TEST-013 | Windows 自管 Chrome 主框架间歇确认失败；有失败日志，根因仍未证实 |
| [#487](https://github.com/devin930906/userscript-auto-healer/issues/487) | `TASK-009` | REQ-014/019；TEST-014/019 | 候选到可信诊断与真实安全应用仍需完整测试 |
| [#488](https://github.com/devin930906/userscript-auto-healer/issues/488) | `TASK-010` | REQ-018/021；TEST-018/021 | 可信管理器/业务验收与拒绝未知的产品集成待完成 |
| [#489](https://github.com/devin930906/userscript-auto-healer/issues/489) | `TASK-011` | REQ-020/021；TEST-020/021/026 | 原子备份/恢复、故障注入和完整真实回滚仍需验证 |
| [#440](https://github.com/devin930906/userscript-auto-healer/issues/440) | `TASK-013` | REQ-022；NFR-009；TEST-004/011/022 | 孤立 AST Worker 在 Windows Candidate 中的间歇故障；根因待查 |
| [#215](https://github.com/devin930906/userscript-auto-healer/issues/215) | `TASK-020` | REQ-028；TEST-028；GATE-009/011 | 便携目录在 Electron smoke 后的 Win32=5 间歇拒绝；不能以候选绿色验证消除风险 |

- 本表不是所有 Stable 缺口的总数：`TASK-012/014/015/016/017/018/019/021` 在开发计划/工作登记中保留实际剩余工作，目前没有专属 Open Issue；其正式验证要求不能因无 Issue 而遗漏。阶段性完成的 `TASK-001..006` 不反向生成历史 Issue。
- 每个后续 PR 记录受影响 TASK、Issue（如有）、REQ/NFR、TEST/GATE、代码 SHA、验证运行及合并状态。只有真实运行/人工验收能够使对应要求状态进展；PR 已合并或 Issue 已关闭本身都不构成 TEST/GATE 成功证明。
- 新增/修改 Issue 时先查重，并按实际变更更新本节及 `docs/09-development-plan.md`、`docs/12-handoff.md`、`docs/14-stable-work-register.md`；保留原始 28 行追踪表和正式 TASK 编号，不以额外 Issue 取代需求或测试。见 `docs/15-issue-driven-stable-bridge.md`。

## 2026-10-31 TASK-013 检查点安全边界实证增量

- `REQ-022 / NFR-009 → TASK-013 → TEST-022/026 → [Issue #440](https://github.com/devin930906/userscript-auto-healer/issues/440) → [PR #531](https://github.com/devin930906/userscript-auto-healer/pull/531) → main `f7bd2cc0ed89bbf914aac0d02b48bf6a5004c937``：双并发持久检查点不得出现三个同时 RUNNING 的不可能状态。Windows RED [#41173176156](https://github.com/devin930906/userscript-auto-healer/actions/runs/41173176156)；PR GREEN [#41173377967](https://github.com/devin930906/userscript-auto-healer/actions/runs/41173377967)；合并后 main GREEN [#41173898572](https://github.com/devin930906/userscript-auto-healer/actions/runs/41173898572)。
- 这是已有 TASK 下的独立部分安全修复；#440 原始间歇性 AST Worker 故障仍 Open，TEST-004/011/022 全量及 GATE-003/007 不据此通过。所有历史 REQ/NFR/TASK/TEST/GATE 编号不变，未创建新的 GitHub Issue。
