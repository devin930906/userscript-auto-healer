> **2026-11-28 当前续接核验**：REQ-022 / NFR-009 → TASK-013 → TEST-022/026 → GATE-007 → Issue [#857](https://github.com/devin930906/userscript-auto-healer/issues/857) → PR [#978](https://github.com/devin930906/userscript-auto-healer/pull/978)（Merged）。合并提交 `e7b4482efc976a818700896ad5b9d4978922d58a`；合并后 Application Skeleton [#46119733874](https://github.com/devin930906/userscript-auto-healer/actions/runs/46119733874) 通过，1,346 tests / 1,343 pass / 0 fail / 3 skipped，Windows shell smoke 通过。PR #978 只增加与新导入 SHA-256 绑定的 fail-closed 历史阶段提示归一化，不代表逐脚本阶段已持久化或完整批处理工作流已接通；#857 保持 Open，TEST-022/GATE-007 未通过。

# 工程要求追踪矩阵

> 本轮原文到现有 TASK、Issue 和验收的映射见 [原始需求校准](product-rebaseline.md)。

> 现行未验收映射补充（不替换下方历史矩阵）：REQ-006..009 → TASK-005 / #856 / TEST-006..009（默认 CDP 9896、Chrome++ 与 Profile 归属）；REQ-017/018/023 → TASK-007/010/012 / #486 #488 #603 / TEST-017/018/023（真实 Tampermonkey 与脚本安装/版本；新增自管 Chrome 扩展管理页元数据只读检查（不证明 Store 来源或 GM/业务））；REQ-014/019..022 → TASK-009..013 / #487 #488 #489 #857 / TEST-014/018..022（真实诊断、自动候选、受控提交与回滚、批次验收）；REQ-015/016 → TASK-014 / #604 / TEST-015/016（可选 AI 双协议）；REQ-001..003/022 → TASK-002/013/017 / #857 #607 / TEST-001..003/022（一次启动、逐项结果）。历史实现状态不能自动令这些增量或 GATE-001..011 通过。

> 历史状态说明：下方 REQ/NFR/TASK/TEST/GATE 主矩阵源于准备阶段；实际实现与验证证据见本文件后续日期增量、当前 Issue/PR 和 `docs/14-stable-work-register.md`，不得将原设计映射文字当作当前运行结果。

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

## 2026-11-17 当前 GitHub Issues ↔ TASK ↔ 验证证据追踪

> 保持上方 REQ-001..028 的权威映射与 NFR、GATE 定义不变。下表根据本次 GitHub Open Issues 快照更新；TASK 编号与 GitHub Issue 编号是独立序列。

| GitHub Issue | 正式 TASK | 已知关联需求 / 验证 | 当前缺口 |
| --- | --- | --- | --- |
| [#486](https://github.com/devin930906/userscript-auto-healer/issues/486) | `TASK-007` | REQ-017/018；TEST-017/018；GATE-004/005 | 用户截图确认 Chrome 中有 Tampermonkey v5.5.1；UAH 仍曾报告未找到官方卡片，精确的受控 Profile 绑定、产品安装/注入、GM、业务修复与回滚尚未验证 |
| [#487](https://github.com/devin930906/userscript-auto-healer/issues/487) | `TASK-009` | REQ-014/019；TEST-014/019 | 候选尚未与可信诊断、备份和真实安全应用完整串联 |
| [#488](https://github.com/devin930906/userscript-auto-healer/issues/488) | `TASK-010` | REQ-018/021；TEST-018/021 | 可信管理器/业务验收与未知状态 fail-closed 产品集成待完成 |
| [#489](https://github.com/devin930906/userscript-auto-healer/issues/489) | `TASK-011` | REQ-020/021；TEST-020/021/026 | 原子备份/恢复、故障注入和完整回滚仍需验证 |
| [#510](https://github.com/devin930906/userscript-auto-healer/issues/510) | `TASK-005` | REQ-006..009；TEST-006/008/009；GATE-003 | owned Chrome/CDP 间歇启动问题的根因仍未确认；不可用一次成功候选关闭此缺口 |
| [#857](https://github.com/devin930906/userscript-auto-healer/issues/857) | `TASK-013` | REQ-022；TEST-022/026；GATE-007 | 当前本地分支把 renderer 文件选择/拖放接入主进程受限批次并复用一次只读 AST 队列；主 frame reload 与 renderer 退出会清理未完成批次，Windows reload smoke 与 PR 检查待证。可恢复持久任务、动态诊断/修复、可选 AI、真实 Tampermonkey/业务证据和完整 GATE-007 仍未打通；此 Issue 承接 TASK-013，不以历史 #440 替代 |
| [#603](https://github.com/devin930906/userscript-auto-healer/issues/603) | `TASK-012` | REQ-023；TEST-023 | 管理器内版本状态和正式导出集成未完成 |
| [#604](https://github.com/devin930906/userscript-auto-healer/issues/604) | `TASK-014` | REQ-015/016；TEST-015/016；GATE-006 | 可选 AI 网关尚未接入真实诊断/批处理/候选流程，完整隐私和成本验收未完成 |
| [#605](https://github.com/devin930906/userscript-auto-healer/issues/605) | `TASK-015` | REQ-024；TEST-024 | 用户同意的周期监控和完整持久证据历史未完成 |
| [#606](https://github.com/devin930906/userscript-auto-healer/issues/606) | `TASK-016` | REQ-025；TEST-025 | 多脚本真实兼容回归和生产回滚未验证 |
| [#607](https://github.com/devin930906/userscript-auto-healer/issues/607) | `TASK-017` | REQ-001..025；TEST-002/022 | 完整桌面主流程尚缺真实诊断、修复、批处理与恢复的端到端联接 |
| [#608](https://github.com/devin930906/userscript-auto-healer/issues/608) | `TASK-018` | REQ-001..026；TEST-007/018/026 | 自动化阶段通过仍待最终 Stable 人工核验与完整产品级回归 |
| [#609](https://github.com/devin930906/userscript-auto-healer/issues/609) | `TASK-019` | REQ-027；TEST-027；GATE-008/011 | 最终同源正式安装包与集中安装/升级/卸载验收未完成 |
| [#610](https://github.com/devin930906/userscript-auto-healer/issues/610) | `TASK-021` | REQ-001..028；TEST-001..028；GATE-001..011 | 全部 Stable 门槛、最终同源双包和人工签署未完成 |

- 本快照共 14 个 Open Issues。#856、#480、#440 与 #215 已关闭；关闭只表示其对应历史 Issue 结束，不自动通过仍然适用的 TEST/GATE。#856 对 TASK-005 的部分 Chrome/Profile 工作有历史验收；#510 仍是独立 Open 缺口。#440 的历史 Worker 故障跟踪现由 TASK-013/#857 的当前需求及验收范围承接；#215 的便携历史问题不替代 #609/#610 和最终 GATE。
- 每个 PR 仍须记录受影响 TASK、Issue、REQ/NFR、TEST/GATE、精确代码 SHA、验证运行及合并结果；Issue 关闭或 PR 合并本身不是 TEST/GATE 成功证明。
- 修改 Issue 映射时同步核对 `docs/09-development-plan.md`、`docs/12-handoff.md` 和 `docs/14-stable-work-register.md`；保留正式 TASK 与测试编号，不新增重复任务。

## 2026-10-31 TASK-013 检查点安全边界实证增量

- REQ-022 / NFR-009 → TASK-013 → TEST-022/026 → [Issue #440](https://github.com/devin930906/userscript-auto-healer/issues/440) → [PR #531](https://github.com/devin930906/userscript-auto-healer/pull/531) → main `f7bd2cc0ed89bbf914aac0d02b48bf6a5004c937`：双并发持久检查点不得出现三个同时 RUNNING 的不可能状态。Windows RED [#41173176156](https://github.com/devin930906/userscript-auto-healer/actions/runs/41173176156)；PR GREEN [#41173377967](https://github.com/devin930906/userscript-auto-healer/actions/runs/41173377967)；合并后 main GREEN [#41173898572](https://github.com/devin930906/userscript-auto-healer/actions/runs/41173898572)。
- 这是已有 TASK 下的独立部分安全修复；#440 原始间歇性 AST Worker 故障仍 Open，TEST-004/011/022 全量及 GATE-003/007 不据此通过。所有历史 REQ/NFR/TASK/TEST/GATE 编号不变，未创建新的 GitHub Issue。

## 2026-10-31 TASK-013 重试持久化状态进展追踪
- REQ-022 / TASK-013 / TEST-022/026 → [Issue #440](https://github.com/devin930906/userscript-auto-healer/issues/440) (Open) → [PR #532](https://github.com/devin930906/userscript-auto-healer/pull/532) (Merged) → main `08f03a5dc12f2f1f74e37ad3a788063a74961d17`：修正 `QUEUED attempts=n` 可被同次 `SUCCEEDED/FAILED` 覆写的状态单调性缺口，保留合法重新尝试与取消。Windows RED [#41174961316](https://github.com/devin930906/userscript-auto-healer/actions/runs/41174961316)，PR GREEN [#41175266262](https://github.com/devin930906/userscript-auto-healer/actions/runs/41175266262)，main GREEN [#41175855520](https://github.com/devin930906/userscript-auto-healer/actions/runs/41175855520)。
- #440 原始 AST Worker 间歇性故障仍未验证解决，不等于 `TEST-004/011/022` 全量通过或 Stable GATE 通过。既有 REQ/NFR/TASK/TEST/GATE 编号均不变。


## 2026-11-02 新版（4）/（7）无独占认领迁移（现行续接依据）

- PR [#602](https://github.com/devin930906/userscript-auto-healer/pull/602) 合并提交 `617fd3879f7a33ff3a5311868c1164b4e6dfb6fb`，经 Documentation Integrity 和 Required PR Fence 成功验证。此 SHA 只是当时迁移基准，不保证永远是当前 main。
- 新指令取消 Issue 独占锁、创建认领分支、持有者签名轮次和 `HANDOFF_BLOCKED` 开发门槛。旧相关记录仍保留历史与安全证据，不能再阻止符合批准范围、依赖和 PR 规则的独立产品开发。
- 保留原始 REQ/NFR/ADR/RISK/TEST/GATE、TASK-001..021、已经合并的产品代码、PR 与 CI；（4）历史有条件准入不重跑，旧产品阶段不重做。并行工作必须以最新 main SHA、实际文件/接口冲突、分支隔离、PR Required Checks 及合并后回归为依据。
- 新建立已批准 TASK 的分类 Issue 映射：TASK-012→#603；TASK-014→#604；TASK-015→#605；TASK-016→#606；TASK-017→#607；TASK-018→#608；TASK-019→#609；TASK-021→#610。原有 #215/#440/#480/#486/#487/#488/#489/#510 保留，不因建立新 Issue 就认为相关功能已通过。
- 当前仍有真实 Tampermonkey 产品业务、可信自动应用与原子回滚、间歇性 Windows 故障、正式 EXE+ZIP、最终人工验收与全部 GATE 的证据缺口；不得把治理修复当作 Stable 验收。
- 现行执行依据：`AGENTS.md` 2026-11-02 小节及 `docs/19-stable-v7-migration.md`；每次均重新读取远端 GitHub 状态。

2026-11-12 用户新增范围：已有自定义 Data 外连 → REQ-006..009 / TASK-005、TASK-017 → TEST-006..009、TEST-022、TEST-026；真实 Chrome 授权与现有 Data 实机验收待完成。

## 2026-11-16 PR #883 合并后实际证据追踪

- **REQ-017/018 → TASK-007 → Issue #486 → PR #883 → main**：PR #883 合并 SHA `bcacd082a3c538e00dfbf481c7221c8e829818ad`，新增 app-owned Chrome `chrome://extensions` 管理页只读元数据（固定扩展 ID、名称/版本、启用状态、Allow User Scripts）；现有 Chrome attach 路径仍仅输出 runtime-target hints。Windows Application Checks #43806721310 为 1126 tests（1125 pass、0 fail、1 conditional skip），Electron shell smoke 成功。TASK-007 云端实验 #43806236366 证明隔离 Chromium 141 / vendor-hosted Tampermonkey 5.4.1 的签名 key/runtime ID 匹配及合成场景对照；`storeAuthenticityVerified=false`、`gmRoundtrip=false`，没有真实用户 Profile、完整 GM 与生产业务证据，故 TEST-017/018 与 GATE-004/005 不通过。
- **REQ-015/016 → TASK-014 → Issue #604 → PR #883 → main**：同一合并 SHA 整合可选模型发现的原生确认边界；这只证明阶段性权限/交互约束已整合，不证明完整 AI 网关、双协议或诊断/修复链路验收。
- **REQ-001..003/022 → TASK-017 → Issue #607 → PR #883 → main**：同一合并 SHA 将手动 GM 场景与手动场景注册留在折叠高级区，并连接导入结果至受控 Chrome 工作区；完整一次启动批处理及逐脚本结果主旅程仍缺失，源码静态审查不构成真实 UI/人工体验通过。
- **Windows 发布验证关联**：候选 EXE/ZIP [#43805989231](https://github.com/devin930906/userscript-auto-healer/actions/runs/43805989231) 在 TEST-006/008/009 的 owned-Chrome CDP 启动阶段失败，未生成候选双包；同 SHA 的 Application Checks #43805989201 与 Portable Chrome Product Validation #43805989203 成功。历史间歇故障 #510 已重新打开，根因未确认。不得用 PR Merged、Issue Open/Closed 或单个成功 Actions 运行推导 GATE-001..011 通过。
- **当前发行边界**：历史 Release v1.1.3 已发布，但 `docs/product-rebaseline.md` 明确其不是本次需求验收证据；当前没有新 Stable 候选双包、最终人工验收或新 Stable Release。

## 2026-11-16 PR #891 后的 TASK-007 边界追踪

- **TASK-007 / #486 / REQ-017/018 / TEST-017/018 / GATE-004/005**：PR [#891](https://github.com/devin930906/userscript-auto-healer/pull/891) 合并 SHA `8484b76f6cadd88d106c2d5bd077cece2328cf72`，只修复测试专用 owned-Chrome extension pipe 在 outgoing error/close 时的失败关闭，并补充 malformed/oversized、pipe failure、timeout 与 cancellation 负例。它不完成 Issue #486 的真实 Tampermonkey 身份、GM、业务或回滚验收；#486 继续 Open，GATE-004/005 未通过。
- 对应隔离 Windows run [#43843893323](https://github.com/devin930906/userscript-auto-healer/actions/runs/43843893323) 21/21 Job success，但日志仍为 `storeAuthenticityVerified=false`、`gmApiVerified=false`、`businessVerified=false` 与 `managerVerifiedForStable=false`。不得将该 CI 矩阵升级为真实用户或 Stable 证据。

## 2026-11-16 TASK-014 / Issue #604 AI 授权目标修正

- **REQ-015/016 → TASK-014 → Issue #604 → PR #893 → `main@5edebd67ef02248bae00457c14e81f1f331fd8aa`**：原生同意框现在根据选定的 Chat Completions 或 Responses 协议以及自定义 base-path 显示与实际 transport 相同的 `POST` 目标 URL；空 `?`/`#` 分隔符在同意和网络请求前被拒绝。PR [#893](https://github.com/devin930906/userscript-auto-healer/pull/893) 已合并。
- PR Application Checks [#43858568343](https://github.com/devin930906/userscript-auto-healer/actions/runs/43858568343) 与合并后 main Application Checks [#43860109349](https://github.com/devin930906/userscript-auto-healer/actions/runs/43860109349) 成功；后者包含 Windows Electron shell smoke。Windows 候选打包检查 [#43858568495](https://github.com/devin930906/userscript-auto-healer/actions/runs/43858568495) 也成功，但它是 PR-head 候选，不是 Stable Release。
- 本次只修正授权披露与协议目标一致性。批量分析、实际诊断与修复候选流程仍未接入 AI；依赖 TASK-009/TASK-013 未完成，Issue #604 保持 Open，TEST-015/016 与 Stable GATE 不得据此标为通过。

## 2026-11-16 TASK-014 / Issue #604 原生桌面 mock flow 增量

- **REQ/TEST 映射与整合**：REQ-015/016 → TASK-014 → Issue [#604](https://github.com/devin930906/userscript-auto-healer/issues/604) → PR [#895](https://github.com/devin930906/userscript-auto-healer/pull/895) → `main@d8d0bf7223d128f3839400689b2d1f935e52fe2e`，tree `896ee17313caeca39df2f7e61a29f983f66ce0d8`。新协调器由实际 `ai:discover-native` / `ai:review-native` IPC 调用；新增 mock 覆盖原生选择取消、授权拒绝、通过授权后的模型发现、review 只发送三项脱敏 evidence、精确配置请求 URL、输出仍是不可信建议，以及配置读取后撤销。review 授权等待期间收到 abort 会及时返回取消，后续晚到批准不触发网络请求。
- **本地验证**：`npm run build` 成功；`node --test --test-concurrency=1 dist/tests/ai/native-desktop-flow.test.js dist/tests/ai/native-model-discovery.test.js dist/tests/ai/native-reviewed-suggestion.test.js dist/tests/security/desktop-boundary.test.js` 为 99 pass / 0 fail。完整 `npm test` 为 1141 total / 1088 pass / 42 fail / 11 skipped；当前 42 个失败名称与合并前基线一致，限于既有 Windows symlink `EPERM` 与 TASK-011/018 restore-path 用例。基线对照因从当前工作树借用依赖，另有一项 GATE-006 license metadata 失败；这不作为本轮代码失败的证据。
- **远程验证**：PR Application Skeleton Checks [#43870858082](https://github.com/devin930906/userscript-auto-healer/actions/runs/43870858082)、Issue coordination / stale-round fence [#43870858081](https://github.com/devin930906/userscript-auto-healer/actions/runs/43870858081)、Portable Chrome Product Validation [#43870857971](https://github.com/devin930906/userscript-auto-healer/actions/runs/43870857971) 与 Windows Candidate EXE/ZIP [#43870858176](https://github.com/devin930906/userscript-auto-healer/actions/runs/43870858176) 均成功；合并后 main Application Checks [#43872192593](https://github.com/devin930906/userscript-auto-healer/actions/runs/43872192593) 针对精确合并 SHA 成功，包含 Windows Electron renderer/preload shell smoke。Candidate EXE/ZIP 仅为 CI 候选证据，不是正式 Stable 文件。
- **剩余范围**：批量分析、实际诊断和修复候选尚未接入 AI；TASK-009/TASK-013 依赖、完整 TEST-015/016、相关 GATE 和最终用户验收仍未完成。Issue #604 当前保持 Open；本增量不代表 TASK-014 全部完成。

## 2026-11-20 TASK-013 / Issue #857 本地接入增量

- REQ-022 → TASK-013 → Issue #857 → 本地代码 commit `9156b96e2c9070eadbfef1fd87b3089da8e58453`（父 `146f9a987e7e633496d723e7f517c68282e1fe07`）：renderer 文件选择/拖放现经 main-frame 授权的 begin/add/finish session 批量收集，逐项安全校验与 SHA 去重，结束时调用既有只读 AST 队列一次；仅保留内存结果，不写源文件或启动浏览器。当前为本地提交，尚未进入 GitHub PR。
- 对应回归：`tests/import/import-service.test.ts` 新增 6 项 1000 项/128 MiB/单文件边界、代理拒绝、错误隔离、去重与单次 finalize 测试；`tests/security/desktop-boundary.test.ts` 的 74 项包含精确 IPC 清单、主进程授权、无路径 preload 契约与 renderer 批次入口。
- 本地全量结果为 1,227 / 1,214 pass / 1 fail / 12 skips；TEST-003 symlink 创建因本机 Windows `EPERM` 失败。Electron shell-only 本地进程在回执前 `0xC0000005`，Windows 2025 PR Actions 是此变更的真实 shell smoke 待验收项。
- 该增量不完成动态诊断、候选修复/AI、可信管理器/GM/业务证据、持久恢复或 TEST-022/GATE-007；#857 保持 Open。PR、Windows run、远端 SHA 与合并结果待补充，不以本地 SHA 代替远端状态。

## 2026-11-21 TASK-013 / Issue #857 Windows smoke 诊断追踪

- **映射与远端基线**：REQ-022 → TASK-013 → Issue [#857](https://github.com/devin930906/userscript-auto-healer/issues/857) → PR [#925](https://github.com/devin930906/userscript-auto-healer/pull/925) 当前 HEAD `5a0480055bb515f587176fece14ac54cc2f61a50`（Open、未合并）。此 HEAD 的 `windows-shell-smoke` 失败 `DROPPED_BATCH_RELOAD_SETUP_FAILED`，Candidate packaging 失败 `SHELL_SMOKE_DROPPED_BATCH_CHECKPOINT_NOT_VISIBLE`；两条 Windows 失败来自实际 Electron smoke。Boundary、Portable Chrome、文档、Issue coordination 与隔离 Tampermonkey matrix 的相应 checks 成功，但不替代失败 job，也不证明实机用户验收。
- **本地 smoke 更新**：新增静态回归断言要求 checkpoint smoke 只接受唯一 `checkpoint-smoke.user.js` 结果，并等 renderer 导入控件恢复 idle 后才通过；TDD 观测到该断言 RED，修改后 desktop-boundary 79/79 通过、build 与 `git diff --check` 通过。新 PR HEAD 尚未运行，因此根因与 Windows 行为仍待验证。
- **全量测试边界**：`npm test` 1,248 项，1,193 pass / 43 fail / 12 skip；失败仍为 TASK-011 restore-path 41 项、TEST-003 symlink 1 项和 TASK-018/TEST-018 1 项。全量套件不是全绿。
- **本地 Electron 故障记录**：受控 temp profile 下 `electron@44.9.1 --uahtest-shell-only` 返回 `0xC0000005`，未产生回执。用户提供的截图显示 `electron.exe` 尝试读取地址 `0x8`，并说明此前也多次发生。当前命令沙盒为 `desktop-gmi4mrs\\codexsandboxonline`；其 Application Event ID 1000 查询没有读到匹配项，尚不能定位 native fault 或证明是用户交互式帐户中的同一事件。该结果不算 smoke 通过，不能与 GitHub Windows runner 的两个 JS smoke 状态混为一谈。
- **未完成**：需将 smoke 更新同步至 PR 后，以新的精确 SHA 重跑并检查两个 Windows job。#857、TEST-022/GATE-007、真实 Tampermonkey/GM/业务验证、候选失败恢复及 Stable GATE 仍未完成。

## 2026-11-21 TASK-013 / Issue #857 文件级 smoke 与 reload 恢复增量

- **需求映射**：REQ-022 / NFR-009 → TASK-013 → TEST-022/026 → Issue [#857](https://github.com/devin930906/userscript-auto-healer/issues/857) → PR [#925](https://github.com/devin930906/userscript-auto-healer/pull/925)。不新增 REQ、TASK、TEST、GATE 或 Issue。
- **代码范围**：候选 smoke 使用每次唯一的文件名和字节，并把 checkpoint 结果限制在本批新增日志行；reload fixture 同样逐轮生成唯一字节。renderer reload 时 main 保存单个同窗口摘要，trusted renderer 在文档加载后无参数读取、展示后以 main-issued、按 frame epoch 绑定的 receipt 确认；确认后 smoke 实测下一批可启动。分析未 settle 前取消仍有效；fragment-only 导航不交接；路径/控制符/超长拒绝文件名不会进入跨 frame 摘要。结果只在当前应用进程内存中存在，窗口关闭/应用退出清理，不能视为崩溃重启恢复。
- **当前验证**：desktop-boundary 81/81、checkpoint/import-queue 定向测试 59/59、import-service 36/37（唯一 TEST-003 symlink 因 sandbox `EPERM`）、build、typecheck 与 admission traceability 28/21/11 均通过。完整本地 `npm test` 为 1,251/1,196/43/12；43 项仍为 TASK-011 restore 41、TEST-003 symlink 1、TASK-018 E2E 1。未运行本地 Electron smoke。
- **远端状态**：上述实现尚待同步及精确新 SHA 的 Windows `windows-shell-smoke`、Candidate packaging、Documentation Integrity、Issue Coordination 与相关矩阵验证；此前 5a048... 的失败记录不代表新代码。TEST-022/GATE-007、真实 Tampermonkey/GM/业务验收及 Stable 发布仍未通过。

## 2026-11-21 TASK-013 / Issue #857 — Windows smoke preload inventory ordering fix

- **追踪范围**：REQ-022 / NFR-009 → TASK-013 → TEST-022/026 → Issue [#857](https://github.com/devin930906/userscript-auto-healer/issues/857) → PR [#925](https://github.com/devin930906/userscript-auto-healer/pull/925)。不新增 REQ、TASK、TEST、GATE 或 Issue。
- **失败归属**：PR HEAD `0e152ef180ef5354b522e52c19aa9c9ed176ea00` 的 `windows-shell-smoke` 与 Candidate packaging 均以 `SHELL_SMOKE_PRELOAD_KEY_INVENTORY_FAILED` 结束。preload export 集合本身完整；烟测静态预期顺序与排序后的 Electron bridge keys 不同。
- **本地变更与证据**：将 `recoverDroppedImportBatch` / `registerScenario` 调整为与实际排序一致，并新增 desktop-boundary 全量键名对照。`npm run build` 与 desktop-boundary 81/81 通过，`git diff --check` 通过。上述远端失败仍是旧 HEAD 的证据，不能代表此本地修正；新 SHA 的 Windows checks 尚待执行。
- **剩余**：PR #925 仍 Open、未合并；TASK-013/#857、TEST-022/GATE-007、真实 Tampermonkey/GM/业务验收和 Stable gate 均未完成。
