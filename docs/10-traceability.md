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
