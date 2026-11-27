# 项目开发交接

> WebChatGPT 第（7）份指令的当前续接点见 [原始需求校准](product-rebaseline.md)。

> **当前最新续接（2026-11-23）**：正式基线为 `main@96cd4028e227d4934077933f5123230c14ec0367`；PR [#925](https://github.com/devin930906/userscript-auto-healer/pull/925) 分支 `feat/task013-dropped-batch-20261119` 当前 HEAD `566648d6fac7139af36ae0c2ec3f02f816211d59`，PR 仍 Open、未合并，Issue [#857](https://github.com/devin930906/userscript-auto-healer/issues/857) 仍 Open。
> TASK-013 已将现有 `ReadOnlyBatchCoordinator` 接入真实导入脚本的只读 DOM 观察：串行执行、每项最多两次尝试、仅 `CDP_FAILED` 重试一次、逐脚本失败回执、取消传播，并在最终成功回执前重新检查取消、超时及 Chrome 所有权；取消时移除候选导出句柄。UI 显示实际尝试次数，并将系统确认说明修正为每批一次。
> 精确 HEAD 的 Application Skeleton [#45148067926](https://github.com/devin930906/userscript-auto-healer/actions/runs/45148067926) success：1,279 tests / 1,276 pass / 0 fail / 3 skipped，TypeScript 与 Windows Shell Smoke 均通过；Portable Chrome [#45148067979](https://github.com/devin930906/userscript-auto-healer/actions/runs/45148067979)、Documentation Integrity [#45148068082](https://github.com/devin930906/userscript-auto-healer/actions/runs/45148068082) 和 Issue Coordination [#45148062034](https://github.com/devin930906/userscript-auto-healer/actions/runs/45148062034) success。
> Windows Candidate EXE/ZIP [#45148068037](https://github.com/devin930906/userscript-auto-healer/actions/runs/45148068037) success，Artifact [14805317987](https://github.com/devin930906/userscript-auto-healer/actions/runs/45148068037/artifacts/14805317987) 保留至 2026-11-26T09:40:12Z；它是 v1.1.3 候选包，不是 Stable。隔离 Tampermonkey matrix [#45148068016](https://github.com/devin930906/userscript-auto-healer/actions/runs/45148068016) 快照为 13/21 jobs success、8 pending/in progress、0 failure；CRX 获取步骤明确标注 NOT store attestation。
> Issue 对账：#487、#488、#489、#603–#609 已重新打开，连同原有 #486、#510、#857、#610 共 14 个 Open Issues，与追踪文档当前计数一致；不以 PR 或任务部分完成关闭这些 Issue。
> 仍未完成：TASK-013 的可信持久批次队列、崩溃/重启恢复、真实脚本修复/应用/回滚、完整 Tampermonkey/GM/业务验证；TEST-022/GATE-007；最终真实 Windows GUI/用户验收、Stable 完整验收及正式 Release。候选包机器安装/卸载与便携校验不替代最终人工验证。

> 历史快照（2026-11-16，PR #897 合并及 #510 对照后）：产品代码基线为 PR [#897](https://github.com/devin930906/userscript-auto-healer/pull/897) 合并 SHA `36a8760ade24b7249cead0d369f9e4deb300339a`，tree `5d48b548c8be9b6c34cf3a6a27c253896ff84585`。PR #897 只增加 TASK-005 手动 cold/preinitialized Profile 诊断；没有修改产品启动实现。Windows run [#43885592542](https://github.com/devin930906/userscript-auto-healer/actions/runs/43885592542) 在同一 SHA 上成功，两个 Profile 启动都通过现有所有权校验。Issue #510 仍 Open，根因未确认。
>
> TASK-014/#604 仍未完成：AI 尚未进入实际批处理分析、故障诊断及候选生成链；TASK-009/TASK-013 依赖和完整 TEST-015/016 未通过。此次 Windows Candidate EXE/ZIP [#43870858176](https://github.com/devin930906/userscript-auto-healer/actions/runs/43870858176) 是未批准候选，不是 Stable 发布文件。保留 #486 与 #510 的独立开放阻断，Stable 发布仍未达到验收门槛。
>
> #510 限时 Profile 对照只覆盖同一 Windows runner 上一组 cold/warm 配对：预热 Chrome 无 CDP，warmup 退出码 0；cold 与 warm 两臂均在 t0/t1 秒级窗口内完成 CDP / PID / WebSocket 验证。它没有复现 t20 timeout，也没有定位原失败根因；本轮没有执行 Candidate Packaging 或生成 EXE/ZIP。

> 历史快照（2026-11-16 PR #893 产品代码合并时）：产品代码合并 SHA 为 `5edebd67ef02248bae00457c14e81f1f331fd8aa`，tree 为 `804b83353d2c16d39b04d4eef598d79410b1d5c6`；当时本轮文档更新开始前，本地产品代码树与该 tree 一致。当前仓库 HEAD 应始终以 GitHub `main` 实际状态重新核对。PR [#893](https://github.com/devin930906/userscript-auto-healer/pull/893) 修复 TASK-014/#604 原生 AI 同意框与实际协议目标不一致：Chat Completions/Responses、自定义 base-path 的确切 POST URL 会显示在确认框，空 query/fragment 分隔符会在同意及网络流量前拒绝。
>
> PR-head Application Checks [#43858568343](https://github.com/devin930906/userscript-auto-healer/actions/runs/43858568343)、Candidate Packaging [#43858568495](https://github.com/devin930906/userscript-auto-healer/actions/runs/43858568495) 与合并后 main Application Checks [#43860109349](https://github.com/devin930906/userscript-auto-healer/actions/runs/43860109349) 均成功；main run 的 Electron shell smoke 成功，可选启动/AST 诊断 job skipped。候选 EXE/ZIP 与校验仅为候选交付，不是正式 Stable。
>
> TASK-014/#604 仍未完成：AI 尚未进入实际批处理分析、故障诊断及候选生成链；TASK-009/TASK-013 依赖和完整 TEST-015/016 未通过，#604 继续 Open。下一步按依赖推进真实产品集成和负向测试；保留 #486 与 #510 的独立开放阻断，Stable 发布仍未达到验收门槛。

> 2026-11-15 PR #858 原始需求校准续接：现行 REQ-008 默认端口 9896（9223 仅是历史 PoC 参数），用户主流程为 Chrome/Chrome++ 和授权 Profile → 批量导入 → 一次启动 → 逐项真实诊断/安全修复/验收/版本结果；缺登录、授权或业务断言必须逐项受阻并保留原件。主线待完成 TASK-007/009..014/017 对应 #486 #487 #488 #489 #603 #604 #857 #607 的真实代码与 TEST。下方历史日期、版本、端口、Issue 锁定记录仅保留可追溯性，不得覆盖当前准入与真实主干状态。
>
> 历史快照（2026-11-16 PR #886 合并时）：产品代码合并点为 main@7c02f828ba781677629634b0947c7e729b1c170b，PR HEAD ce81f10124c9a8d8a976ece414ec6978415ad32f。TASK-007 / #486 仍 Open；Windows Actions #43822893465 的 21 个 Job success、product-candidate/document-idle 为 22/22 pass，但 metadata hint 本身只报告 synthetic unpacked CRX 的 app-owned 元数据。相同矩阵另有四个 product-candidate run-at Job（各 5/5）记录合成 broken/fixed 脚本注入及测试业务结果；候选 GM roundtrip=false、managerInstalled/productCdpVerified=false。四个 native-gm Job 的合成 roundtrip=true，但 gmApiVerified/businessVerified/managerVerifiedForStable=false。Store/扩展真实性、真实用户 Profile、完整产品安装/注入/授权业务和回滚未验证，TEST-017/018、GATE-004/005 未通过。
>
> 先前 PR 临时合并候选 [#43822893260](https://github.com/devin930906/userscript-auto-healer/actions/runs/43822893260) 来自 SHA a41f2e676da766aed184217f1d55424633d9970f，现已被后续 main 同源候选取代；历史文件 SHA 仍保留于 docs/07-testing.md。
>
> #510 仍 Open：原失败 [#43805989231](https://github.com/devin930906/userscript-auto-healer/actions/runs/43805989231) 有 79 次 FETCH_REFUSED 至 t20、state=1/endpointMarker=0。main Application #43824662618 与当时的 main Candidate #43828261977 在四次拒绝后于 t4 成功读取 CDP；这些成功样本不能证明根因已定位。

> **2026-11-02 最新续接**：按 `docs/19-stable-v7-migration.md`、`AGENTS.md` 新版规则和真实 GitHub 远端状态继续。以下旧版认领/签名/HANDOFF_BLOCKED 均保留为历史资料，不再是产品开发准入条件；真实产品安全和 Stable GATE 未取消。


> 状态（2026-10-26）：**（4）准备阶段有条件准入并已交接；（7）已有持续实际工程成果**。当前主干 `c3c28451636400a4228688d7354c8f42ba0ccbca` 已具 Electron/TypeScript 应用源码，Windows 应用回归 #40272189600 为 603 项（602 通过、0 失败、1 条件跳过），旧基线 Tampermonkey 隔离矩阵 #40270144017 为 15/15 Job 通过。开发候选 EXE＋ZIP 已有阶段验证，但完整用户兼容、可信自动修复/回滚、正式 Stable GATE 和 GitHub Release 均未完成。历史“尚无源码”文字仅为准备阶段当时的快照。

## 项目身份
仓库 https://github.com/devin930906/userscript-auto-healer；默认分支 main；产品为 Windows 本地优先、自动诊断与保守修复因网页变化失效的油猴脚本，交付 EXE 安装版与真实 ZIP 便携包。不得混淆其他用户项目。

## 基准提交
仓库空仓库初始化基准 1205776e91ede1cbb122e699acb7fb7805be23cb；需求技术规格提交 32830ad793b48ccfa59bdb03eb97699a00635bee；测试开发计划提交 df82a2c50b4cdec2faaae676d0141939b9479664。实际每次开发起点以重新读取 main 的最新 HEAD 为准，本文列出的历史 SHA 不是永远的当前 HEAD。

## 权威文档
00-intake 原始输入；01-product 范围；02-requirements 行为；03-feasibility 官方依据/PoC；04-architecture 契约；05-experience 操作；06-security-risk 风险；07-testing 用例；08-release Stable；09-development-plan 任务；10-traceability 关联；11-readiness 准入；12-handoff 续接；13-predevelopment-admission 为实证支持矩阵与分阶段准入；docs/adr 为独立技术决策；AGENTS.md 为执行规则。

## 确认决策
CDP 默认绑定 127.0.0.1:9223，使用用户指定 Chrome 与合规非默认 Profile；严禁接管外部浏览器进程/改写旧 Profile；本地优先、AI 可选且默认关闭；只有真实油猴管理器运行+业务断言成功才算已验证恢复；任意自动应用必须有备份回滚；Windows EXE 与真实 ZIP 格式固定（I-010、ADR-004）。ADR-001 已有条件选定 Electron+TypeScript 作为 TASK-001 的安全骨架基线，但未制作或测试正式 Electron 产品；真实用户设备、完整支持范围与最终 UI 仍须验证。

## 待处理风险
BLOCK-01/02/03/04/05 的完整条件见 11-readiness；Windows runner 的 Chrome 155 非默认 Profile/CDP 已取得局部实证（https://github.com/devin930906/userscript-auto-healer/actions/runs/39082627685）；多便携 Chrome 与目标管理器/真实业务脚本覆盖、ZIP 便携应用完整性、Windows 正式产品构建、目标最低版本和业务场景仍缺证据。缺少 LICENSE 选择不自行补造。

### 2026-10-18 本轮技术验证续接点

- POC-01B 完成部分兼容验证：Chrome for Testing 154.0.8037.57 从独立解压路径可安全建立 CDP，错误 Profile 拒绝及端口占用预检通过。日志：https://github.com/devin930906/userscript-auto-healer/actions/runs/39088772310。
- POC-02A 实际加载 Violentmonkey MV3 2.49.0 Service Worker，脚本安装确认页面出现并完成确认；进一步在临时 Profile 中实测 Allow User Scripts `false→true`（https://github.com/devin930906/userscript-auto-healer/actions/runs/39090258155），**在当时的测试条件下无法证明脚本注入/GM_getValue**；后续 POC-02D 已在标准 HTTPS 示例场景成功真实执行，不能把本历史记录作为当前总阻断。Chrome 138+ 扩展详情页的 Allow User Scripts 授权需要用户主动同意。日志：https://github.com/devin930906/userscript-auto-healer/actions/runs/39089315021；Chrome 官方：https://developer.chrome.com/docs/extensions/reference/api/userScripts。
- POC-03A 通过 Inno Setup 6 临时测试安装器制作/安装/卸载，不是正式产品 EXE：https://github.com/devin930906/userscript-auto-healer/actions/runs/39089013574。
- POC-03B 经 WinRAR 7.23 官方签名有效的限期评估创建真 RAR5、测试、解压与 SHA-256 核对成功；生产/正式 CI 长期许可证**仍未提供**，禁止自动反复试用或把测试归档当便携软件：https://github.com/devin930906/userscript-auto-healer/actions/runs/39089224242。
- POC-02C 最新复核：完整重启临时 Chromium 后，扩展 userScripts API available=true、registrations=1；管理器存储测试脚本 enabled=1 且 @match 对应本地测试页，在该历史随机端口条件下仍未注入/运行 GM_getValue；后续标准 HTTPS POC-02D 已通过，不能据此断言管理器整体失败。工作流如实保留失败证据：https://github.com/devin930906/userscript-auto-healer/actions/runs/39091275121。须继续查站点授权、注册注入、管理器真实运行日志与用户所选正式 Chrome 的差异，不能无条件准入。
- POC-02D **最新已通过**：标准 HTTPS 目标 `https://example.com/`、真实 Violentmonkey v2.49.0 MV3、隔离 Windows Chromium。通过打开扩展级 Allow User Scripts、安装真实 `.user.js`、执行 DOM 行为及调用 `GM_getValue("__poc_fixture_unset__", "poc-default")` 的严格断言。日志：https://github.com/devin930906/userscript-auto-healer/actions/runs/39092523277。原随机端口 PoC 属历史失败，不能继续将全部 POC-02 描述为未通过；但 Tampermonkey、用户正式 Chrome、真实损坏脚本修复仍未验证。
- 当前准备阶段重点：已有真实 Violentmonkey .user.js、GM_getValue 与预设 broken/fixed 两组行为证据；ADR-001 已有条件选定。后续应确认目标 Tampermonkey/Chrome/Windows 实机矩阵、真实坏脚本授权与修复回归；现行 ZIP 格式、完整性及实际运行需在发布前验证。不得把隔离环境技术 PoC 当 Stable 完成。

## 开发起点

**仅对 TASK-001 开放有条件工程入口**：Chrome/CDP 系统和独立路径 PoC 已通过，Violentmonkey 2.49.0 在隔离 Windows Chromium 真实安装 .user.js 并调用 GM_getValue；另外两组独立 `broken`（旧 selector 未找到、业务失败）和 `fixed`（新 selector 命中、业务恢复）的人工作成版本已经得到真实管理器业务断言。记录：https://github.com/devin930906/userscript-auto-healer/actions/runs/39093275851。后者**不是自动修复实现**。

ADR-001 已有条件选定 Electron+TypeScript 作为 TASK-001 安全骨架基线；首任务需真正编写并测试 sandbox/contextIsolation、Node Integration 关闭、白名单 IPC 与安全配置入口，现阶段仍然没有这些正式产品代码。用户实际 Tampermonkey/Windows 10 或 11/不同便携 Chrome、实际损坏脚本及登录站点的完整业务回归均未验证；在后续任务各自的真实验收前不得声称支持。ZIP 真实打包验证、产品真实 EXE/ZIP 双包属于正式 Stable 发布门槛，并不因一次限期试用通过而解除。证据矩阵和恢复执行说明见 docs/13-predevelopment-admission.md。

POC-04B 另于 Ubuntu runner 以 Acorn 成功解析三处静态定位器与三处动态/未知调用（https://github.com/devin930906/userscript-auto-healer/actions/runs/39093951314），只证明技术可行。TASK-003 尚无正式产品源码，动态定位器不得被误判为静态可修。具体结果及适用范围见 docs/13-predevelopment-admission.md。

## 任务顺序
M0：POC-01/02，ZIP 工具链验证/POC-03C；M1：TASK-001..004；M2：TASK-005..008；M3：TASK-009..017；M4：TASK-018..020；M5：TASK-021。依赖顺序与并发边界以 docs/09-development-plan.md 实际编号为准，不盲目逐编号执行有前置未满足的任务。

## 验证命令
当前仓库已有 `package.json`、`package-lock.json`、Electron/TypeScript 应用源码与注册的 Node 回归测试；下列命令用于**实际开发检查**，不表示完整 Stable 功能或 Windows 用户环境已经验收。旧的“暂无 package.json / npm test/build”仅属于 2026-10-18 准备阶段历史快照，不再是当前可执行指引。

- **Node.js 22（以 Windows Actions 锁定环境为准）**：`npm ci --ignore-scripts --no-audit --no-fund` 安装编译/单元测试所需锁定依赖；随后执行 `npm run typecheck`、`npm test`（`npm test` 会先运行 `npm run build`）。`npm run build` 也可单独调用。执行结果以相同提交 SHA 的真实命令退出码及日志为准，不得以文件存在判定通过。
- **真实 Electron sandbox/preload smoke**：通过 `.github/workflows/app-check.yml` 的 `windows-shell-smoke` Job 在 Windows runner 安装完整 Electron 运行时、编译并启动受限测试入口；Node 单元测试无法取代这一验证。
- **开发候选 EXE + 真 ZIP（非 Stable）**：通过 `.github/workflows/windows-candidate-packages.yml` 的 Windows Job 执行 `scripts/test-windows-portable-relocation.ps1` 与 `scripts/windows-package-candidate.ps1`；必须检查目标 SHA、全部 Job 结论、产品文件与校验日志。此工作流不授予正式 GATE、Release 或产品自动修复能力。

2026-10-28 已验证样本（仅供追溯，不是未来最新 HEAD）：`main@67e97b092bf5c15b41414609aebb5fc543077c30`；[Application #40692321010](https://github.com/devin930906/userscript-auto-healer/actions/runs/40692321010) 成功，695 项 Node 测试中 694 通过、0 失败、1 条条件跳过，Electron smoke 成功；[Windows 候选 #40691143772](https://github.com/devin930906/userscript-auto-healer/actions/runs/40691143772) 成功，包含 148 文件一致性和三轮首次尝试成功的真实便携目录移动。Issue #215 的间歇性 `Win32=5` 与 Issue #440 的 Worker 偶发故障仍开放；样本绿色不代表根因已修复，全部 GATE 仍须独立验收。

## 云端限制
GitHub 连接账户有该仓库写入权限；最新 Ubuntu 文档 CI https://github.com/devin930906/userscript-auto-healer/actions/runs/39092836797 成功。Windows runner 已完成 Chrome/CDP 和独立路径探针、真实 Violentmonkey/GM_getValue PoC（https://github.com/devin930906/userscript-auto-healer/actions/runs/39092523277）、Inno 临时 EXE、历史 RAR5 和**现行原生 ZIP 工具链 POC-03C** 有限定验证（https://github.com/devin930906/userscript-auto-healer/actions/runs/39095747797）；但正式 ZIP 应用包、Secrets、配额和产品构建仍未验证；截至 2026-10-18 查询 main 的 protected=false，不代表可忽略将来的规则变动。网页会话不等于用户 Windows 的实际浏览器登录环境；依赖实机用户授权的 GM 测试不能只用普通 DOM/模拟测试替代。

## 续接规则
读取 main、所有相关开发分支、Open PR/Issues、历史提交与 CI；按 11 把准入阻断优先处理；按 09 选择最高优先级可执行任务；先写测试/证据再实施最小代码并留痕；更新 REQ↔TEST↔TASK↔GATE、ADR、安全风险和本文。禁止重复生成新准备体系、无限新建 PR、静默覆盖用户脚本、绕过 Chrome 安全限制或在准入前正式开发。

## 2026-10-18 ZIP 发行续接说明
用户已明确将原 RAR 便携改为真实 ZIP 便携，安装 EXE 不变。I-010/ADR-004 生效；后续 TASK-020 生成并验证真实产品 ZIP。RAR5 PoC 和试用许可证信息仅存档，不是现行 Stable 采购或发布阻断。继续从 TASK-001 条件准入推进，不把格式变更误判为正式产品功能已开发。

## ZIP 工具链执行证据
POC-03C 在 Windows Actions 完成普通 ZIP 压缩/解压/内容哈希验证，run：https://github.com/devin930906/userscript-auto-healer/actions/runs/39095747797；该成功只是临时夹具测试，不是用户实际可运行的便携程序。后续仍须实现 TASK-020/TEST-028 并通过 GATE。旧 RAR 试用工作流已从现行 GitHub Actions 工作流删除，历史评估脚本仍留存供审计，禁止将其纳入正式发行。

## Chrome Browser MCP 真实 Tampermonkey 只读核验（2026-10-18）

用户已连接的 Windows x64 Google Chrome **155.0.8059.40**，真正的 Tampermonkey/篡改猴 **5.5.1**（扩展 ID `dhdgffkkebhmkfjojejmpbldmpobfkfo`、MV3）已实际通过只读身份、`chrome.userScripts.getScripts()` API（返回 2 条注册记录）、`userScripts` 权限与示例目标原点的授权检查。**这些不是油猴脚本安装数量，亦不证明 Tampermonkey 下已执行测试脚本、GM API 或用户业务动作。** 没有读取、安装、修改或卸载任何用户脚本，也没有处理用户个人 Chrome Profile。原始证据来自本次连接的 Chrome Browser MCP；不得编造 GitHub Actions run 作为这次的测试链接。

此前建议先完成的临时 .user.js 注入、GM_getValue 与人工业务断言已于后续 POC-02T-LIVE 在现有用户浏览器的限定范围完成。现在优先开展的是独立云端真 Tampermonkey、更多实际 GM/脚本业务/Chrome 便携兼容与 9223 CDP Profile 归属的**后续任务阶段测试**，而不是重新运行相同临时 PoC。若无法安全获得专用测试环境，就明确记为未验证而不是改动现有脚本；可依已通过的有限 PoC 进入 TASK-001 安全骨架开发。现行便携格式为 ZIP；最新资料请以 docs/13-predevelopment-admission.md 与 docs/11-readiness.md 为准。

## 真实 Tampermonkey 功能验证交接（POC-02T-LIVE，2026-10-18）
在用户连接的 Chrome + Tampermonkey 5.5.1 中，临时 `.user.js` 安装/注入、`GM_getValue`、人工 `broken`/`fixed` 选择器功能断言、删除及停止注入已取得真实浏览器工具返回。证据：docs/evidence/2026-10-18-tampermonkey-live-browser-qa.md。**此测试不是 Actions 云端 runner，也不是独立 Profile，更不是产品自动修复或 Stable TEST/GATE**。先前本文件的“尚未验证真 GM”是更早只读检查时的状态，后续仅该限定样本已得到正向结果。继续推进 TASK-001，正式管理器适配 TASK-007 与 TEST-017/018/GATE-004/005 必须另建产品集成测试和云端矩阵。

## （4）终局交接收据（2026-10-18）

**本阶段停止**：文档语义交叉审查、准入条件分类与后续 TASK 责任分配已写入 docs/11-readiness.md，正式 Windows EXE+ZIP（非 RAR）、首要 Tampermonkey（非将 Violentmonkey 当替代）、实际 POC-02T-LIVE 的限定成功均已反映在入口文件中。后续 GPT/Codex 不应继续把这些既定事项当未解决前期阻断，也不应从头生成新的准备文档。

**可直接执行的（7）起点：TASK-001，Electron+TypeScript Windows 桌面最小安全骨架。** 按 ADR-001 设计 renderer sandbox=true、contextIsolation=true、nodeIntegration=false，最小可信 preload IPC，Chrome 进程/独立 Profile 保护和非授权路径拒绝；先写安全负例再实施，执行真实 CI，提交可审计代码。任何原 .user.js 均不得未经授权读取、覆盖或在高权限主进程执行。

**延后而非忽略**：TASK-005 = Windows/Chrome/便携 Chrome/CDP Profile/9223 归属；TASK-007/010/018 = 独立云端真 Tampermonkey POC-02T、管理器适配、产品实际脚本业务断言/登录与安全矩阵；TASK-009..011 = 自动修复候选、备份/回滚/验收；TASK-019/020/021 = 真实应用 EXE+ZIP 及全部 Stable 门槛。PoC 无法替代任何正式 TEST/GATE。
**停止规则**：此段不是开始 TASK-001 的授权；只有用户正式下达（7）后才进入产品代码开发。恢复时重新读取 main HEAD、CI、Open PR/Issues 并遵循 AGENTS.md；无需重复（4）。

## （7）TASK-001 产品代码起步（2026-10-18）

正式开发已经启动，已创建单一集成开发分支 `feat/stable-development`；Windows 安全壳源码和负例测试已推送。初步验证证据为 https://github.com/devin930906/userscript-auto-healer/actions/runs/39100320005（对应 SHA `244f853fae7e5f7443f86a69b5804bc14b7883aa`），静态类型检查和 11 项测试成功。**不是**实际 Electron 桌面启动、Tampermonkey/Chrome 或产品 TEST/GATE 完整通过。这是 TASK-001 起步时的历史状态；后续 Windows Electron 真运行已成功，最新合并状态与下一任务按本文件追加证据及 PR 确认。当前正式产品尚无稳定安装 EXE、便携 ZIP 或 Release；不要重做（4），不要创建并行堆积 PR。下一轮须读取远程 HEAD/PR/Actions 后续状态，不以本文中的历史 SHA 代替最新 SHA。

## （7）TASK-001 最新验收、合并前交接（2026-10-18）

Windows runner 测试在 `5f2830d52d349ab19583740dc177427e1652e355` 的 Actions [39100881800](https://github.com/devin930906/userscript-auto-healer/actions/runs/39100881800) **完整成功**：静态检查及 11 个 Node 安全测试、Electron 按需下载、编译、真实 renderer/preload IPC 沙箱验证与无效配置输入拒绝。文档 CI [39100881819](https://github.com/devin930906/userscript-auto-healer/actions/runs/39100881819) 成功。TASK-001 的安全骨架开发结果处于 **已完成未整合**，活跃唯一开发 PR 为 [#1](https://github.com/devin930906/userscript-auto-healer/pull/1)；合并之前不得称 main 具有这项功能。后续需核验最新 HEAD 和 PR/CI/审核，通过后整合；随后开始 `TASK-002`（脚本导入及路径安全）。完整 TEST-026、Chrome/Tampermonkey 与发布 GATE 仍未完成，正式 EXE/ZIP 尚未生成。

## （7）TASK-001 合并收据与 TASK-002 续接（2026-10-18）

PR [#1](https://github.com/devin930906/userscript-auto-healer/pull/1) 已合并，合并提交 `083de9db209d00b52183794687f0bb97d04e1e8d`，有效代码已进入 main，不再是“已完成未整合”。来源分支通过 Windows 真实 Electron smoke + 静态测试（https://github.com/devin930906/userscript-auto-healer/actions/runs/39101063472）和 docs CI（https://github.com/devin930906/userscript-auto-healer/actions/runs/39101063490）。TASK-001 的入口安全骨架已经完成，今后新会话不得重复从 TASK-001 搭建骨架；下一项按计划为 **TASK-002**（REQ-001..003 / TEST-001..003）：安全批量导入、字节哈希、目录递归边界、失败隔离。进行新任务前读取 main 最新 SHA、PR 和验证结果；不得假设自动修复、Tampermonkey 产品功能或 Windows EXE/ZIP 已实现。M1 尚未退出；所有 GATE 均尚未完成。

## （7）TASK-002 合并收据与 TASK-003 续接（2026-10-18）

TASK-002（REQ-001..003 / TEST-001..003）的只读导入、字节/编码/哈希、路径安全与目录扫描、GUI 原生选择及拖放入口已通过 Windows 自动化限定范围验证：[Actions 39103414900](https://github.com/devin930906/userscript-auto-healer/actions/runs/39103414900)，源提交 `f238366e4d436a7d245e8ae609e8704b25b4b1fc`；PR [#2](https://github.com/devin930906/userscript-auto-healer/pull/2) 已合并，main 合并 SHA `0a8b8ff1033fc99a01cc0c24978c092a016e7c7a`。已确认的实测仅为 Windows runner 的 Node 回归与真实 Electron 加程序化拖放，非用户手动文件夹拖放或完整产品 GATE。

下一项依赖满足的正式任务：**TASK-003（REQ-004/011、TEST-004/011）**，在现有 `main` 上基于用户脚本真实字节建立元数据/AST 静态证据并保持只读；TASK-005 作为 TASK-001 后可独立推进的安全浏览器入口。未完成 Tampermonkey 产品适配、真实坏脚本自动修复、备份回滚、完整 EXE+ZIP 和所有 GATE；不重做 TASK-001/002，也不从前期准备重新开始。

## （7）TASK-003 合并与 TASK-004 续接（2026-10-18）

Acorn AST 与元数据只读分析（REQ-004/011，TEST-004/011 限阶段）已在 Windows CI 通过：[Actions 39104178253](https://github.com/devin930906/userscript-auto-healer/actions/runs/39104178253)，HEAD `534f97b464384d18559d0c61127de7c6b3abc9c0`；[PR #3](https://github.com/devin930906/userscript-auto-healer/pull/3) 已合并至 main SHA `cc15da038ecf01c4c03001e7165b7698eecab4d5`。这不是浏览器动态 DOM/脚本业务/修复的完整验收。按已确认依赖，下一项可执行为 **TASK-004** 场景登记、真实 URL/登录前提和业务断言契约；**TASK-005** Chrome/Profile/CDP 也可独立开展。不得回到 TASK-001/002/003 重做已验证代码，必须先复查当前 main SHA/PR/Actions。

## （7）TASK-004 合并及 TASK-005 续接（2026-10-18）

REQ-005 的场景登记、明确测试授权/目标 URL、登录前提、操作与业务断言预检已合并：[PR #4](https://github.com/devin930906/userscript-auto-healer/pull/4)，merge SHA `dc088797220f9a3d7efa5b1d89dede6ff0ae657c`。源码 `src/scenarios/scenario-registry.ts`；测试 `tests/scenarios/registry.test.ts`。Windows [Actions 39104629620](https://github.com/devin930906/userscript-auto-healer/actions/runs/39104629620)，源提交 `a39004f973a1c72469ffa620bfa6f01a517570ab`，30 项 Node 回归和真实 Electron smoke 通过。只完成 TEST-005 静态阶段契约验证，真实登录/业务断言尚未跑。

**下一 TASK-005**：在既定授权边界内校验标准/便携 Chrome 路径，拒绝默认/被占用 Profile，隔离启动与 CDP 实例归属；必须首先测试安全拒绝策略。真实用户 Profile、已登录站点和既有脚本不得擅自接管或修改。TASK-001..004 已合并；EXE+ZIP 与 Stable GATE 仍未达到。


## （7）TASK-005 Chrome/Profile/CDP 完成并整合（2026-10-18）

PR [#6](https://github.com/devin930906/userscript-auto-healer/pull/6) 已合并至 `main`，合并 SHA `baa05c877a98c580f67d5b7aa2e40d45f9f55580`。实现签名 Google Chrome 及用户指定独立路径的身份/版本核验、只有用户显式同意才创建空的新隔离 Profile、CDP loopback 端口/PID/进程归属、Browser.getVersion WebSocket 真握手、目标页 URL/ID 的真实创建与比对、停止后撤销会话资格及安全负例。禁止接管既有 Profile/外部浏览器，拒绝不可信签名且不会静默降级。后续用户未验证的便携 Chrome 型号不应宣布兼容。

阶段验证：源 HEAD `1a2709f59b024f4cc4d7a961b55e889146967864` 的 [Application Skeleton Checks 39109205421](https://github.com/devin930906/userscript-auto-healer/actions/runs/39109205421) 两项工作成功（Node 52/53 通过、0 失败，1 项专用独立路径检查由单独工作流覆盖）；[独立路径 Chrome 产品测试 39109205450](https://github.com/devin930906/userscript-auto-healer/actions/runs/39109205450) 9/9 成功且 0 跳过；[文档完整性 39109205434](https://github.com/devin930906/userscript-auto-healer/actions/runs/39109205434) 成功。独立路径测试复制 runner 上受信任签名 Chrome 的全部应用目录再使用实际产品模块，并非全部第三方免安装 Chrome 的兼容担保。先前官方但无可验证 Authenticode 签名的 Chrome for Testing 测试 [39109021075](https://github.com/devin930906/userscript-auto-healer/actions/runs/39109021075) 按产品安全规则**拒绝**；其独立信任模型没有批准，不能降低校验标准。合并的 `main` CI 仍需对应主干最新提交单独核实。

**TASK-005 阶段成果已整合**；这不是 GATE-004/005、全部真实系统支持矩阵、Tampermonkey 产品注入/GM/业务断言或 Stable 发布通过。按照已批准依赖，下一任务为 **TASK-006（REQ-010/012；TEST-010/012）DOM/SPA 动态观测与可见性盲区**，继续以真实授权的自管 Chrome CDP 安全 API 开发；其余任务/发行仍需各自测试和验收。


## （7）TASK-006 合并、云端实证与 TASK-007 恢复位置（2026-10-18）

[PR #7](https://github.com/devin930906/userscript-auto-healer/pull/7) 已按当前源 SHA `824f9c89f673e0d05adbaf3084fd609f8e20eca0` 的成功检查合并至 main：`ee360dbdd936b92cc44609e7680d551fe364289d`。合并代码包括只读 `src/observe/dom-observer.ts`（自管 CDP/来源保护/iframe 与 shadow 限制、选择器计数、SPA 定时采样与跨源导航双次核对）及 `tests/observe/`。Windows [App Checks 39110563542](https://github.com/devin930906/userscript-auto-healer/actions/runs/39110563542) 57 通过、0 失败、1 项专项跳过、真实 Electron 进程运行测试成功；[Chrome 39110563531](https://github.com/devin930906/userscript-auto-healer/actions/runs/39110563531) 与 [docs 39110563515](https://github.com/devin930906/userscript-auto-healer/actions/runs/39110563515) 通过。旧的初始化竞态失败 run 39110333660 有历史记录，不得篡改。该证据为源提交验证，合并后的 main SHA 和后续 CI 需按实时检查确认。

**下一正式任务 TASK-007（REQ-017/018；TEST-017/018）**：在既有受控浏览器会话与测试场景上，构建真实 Tampermonkey 管理器适配，保守检测扩展身份/版本/授权、脚本安装启用、站点和 GM API 权限及真业务断言；缺任一必要实证都不能声称 VERIFIED。不得复制/接管用户现有 Chrome Profile，不得以纯 CDP DOM 或 Violentmonkey PoC 充当 Tampermonkey 产品通过。随后按依赖推进 008..021，正式 EXE/ZIP 尚未生成且所有 Stable GATE 尚待验收。


## （7）TASK-007 第一阶段并入 main，完整 Tampermonkey 尚待续做（2026-10-18）

只读 Tampermonkey 运行目标查询已合并 [PR #9](https://github.com/devin930906/userscript-auto-healer/pull/9)，main merge SHA `ca573cfc6a83d934b10d1de349d83311267ed642`，源 HEAD `f09e0e68fcb67c3dbdeb4b2b8fc48af250614bb0`。产品代码仅在真正的自管理 Chrome/CDP 及用户明确授权下查询扩展运行目标；只返回未验证线索，**不能据此得出脚本已安装、执行、GM API 工作或业务恢复**。Windows [39111259895](https://github.com/devin930906/userscript-auto-healer/actions/runs/39111259895) 在 64 项 Node 测试中 63 通过、0 失败、1 由独立 Chrome 工作流覆盖，真实 Electron smoke 通过；[39111259835](https://github.com/devin930906/userscript-auto-healer/actions/runs/39111259835) Chrome 专项成功。

下一仍为 **TASK-007**：基于独立合法可信的 Tampermonkey 测试环境，把扩展身份与版本、安装/站点/userScripts 权限、实际脚本注入/GM 调用和真实业务断言联成不可跳过的可审计证据链；没有对应授权或环境就保留阻断，禁止借 CDP DOM 或 Violentmonkey 顶替。TASK-007 未正式完成，后续 TASK-008..021 均不可提前标记完成；EXE+ZIP 产品尚未构建，全部 Stable GATE 尚未通过。需按当前 main SHA 重新读 CI/PR，不将历史源 SHA 当作当前基准。


## （7）TASK-007 CDP 元数据安全复核合并（2026-10-18）

后续 [PR #10](https://github.com/devin930906/userscript-auto-healer/pull/10) 已在 [Windows Application Checks 39111684155](https://github.com/devin930906/userscript-auto-healer/actions/runs/39111684155) 完成通过后，合并至 main SHA `16c7a62855d3e13f7f0c08ac90ca555578a54e6f`（源 HEAD `53f91afc70ba9ca15b0d1795e433c904e83ff485`）。变更限定为对所有 CDP 目标 ID（含无关网页目标）校验格式与重复、并在 WebSocket 连接延迟完成但请求已经取消时拒绝发送 `Target.getTargets`，补充 TEST-017 负例。该安全加固**仅说明该阶段测试通过**，不能推断 Tampermonkey 扩展、GM API、脚本实际执行或业务恢复已验收。继续 TASK-007 真实管理器前置条件、真实用户授权与业务断言；Stable EXE/ZIP 未完成。

## （7）TASK-007 元数据拒绝门槛代码与验证（2026-10-18）

复用 `feat/stable-development` 并提交 PR [#11](https://github.com/devin930906/userscript-auto-healer/pull/11)：`src/manager/tampermonkey-preflight.ts` 只在明确授权、已有运行线索、报告的 Tampermonkey 身份/版本及权限、已声明的 GM_getValue 和保守的 @match 检查满足时返回 `METADATA_ELIGIBLE_ONLY`；这一状态**不保证**报告真实、扩展已安装、脚本执行、GM API 或业务断言通过，必须由后续实际管理器实验独立验证。对禁用、错 ID、畸形版本、无 @grant、通配/排除规则等提供拒绝负例，测试文件加入 Windows `npm test`。

源 SHA `ab250732165b8635c88e68a52ffee8d371aa1e7a` 的 [Windows Application Checks 39114195987](https://github.com/devin930906/userscript-auto-healer/actions/runs/39114195987) success（71 pass、0 fail、1 skip），[专用 Chrome 39114195971](https://github.com/devin930906/userscript-auto-healer/actions/runs/39114195971) success，Electron 沙箱运行 smoke success。修复了此前 PR #11 的 TypeScript 测试夹具类型错误；失败运行保留。以 PR #11 和 main 最新 SHA 重新核对是否整合。**下一任务继续 TASK-007 真实 Tampermonkey 授权 Profile / 版本与脚本安装状态 / GM API / 业务断言取证**，没有安全可信的实测证据时不能自动标记 TEST-017/018 通过；TASK-008..021 与 EXE+ZIP 仍未全部实现。

## （7）TASK-007 独立诊断 DOM 对照与 Windows 负例（2026-10-18）

在此前已整合的管理器线索、静态预检及手动临时 GM fixture 基础上，[PR #18](https://github.com/devin930906/userscript-auto-healer/pull/18) 补充针对应用自管 Chrome 已确认目标页的只读 DOM 对照：`observe(mode,explicitUserApproved)`、`domSnapshot()`，读取 `#current-target` 与 `[data-uah-probe-action="done"]`，对未授权、错误来源/路由、畸形观察及缺少访问前置条件保守拒绝，绝不因 DOM 命中转为 GM/业务 VERIFIED。

该阶段源码 `2cf1b9ec031e58b049231de60c86c0030c3f8d72` 的 [Windows Application Checks 39125313780](https://github.com/devin930906/userscript-auto-healer/actions/runs/39125313780) 已成功：88 项 Node 回归、87 pass、0 fail、1 专用路径跳过；Windows Electron smoke success。新增真实 Windows 签名 Chrome＋独立 Profile **无脚本负例**验证测试 DOM 存在但固定模式下无动作标记，因此不能伪报脚本恢复。文档完整性 [39125313781](https://github.com/devin930906/userscript-auto-healer/actions/runs/39125313781) success。PR 最终合并状态须重新核验，不能根据本文推定已合并。

**TASK-007 仍开发中**：独立合法的真实 Tampermonkey 完整安装/授权、GM API、注入时机及产品业务断言尚未获取，TEST-017/018 和 GATE-004/005 均不能据此通过。下一步优先做经许可的真实 Tampermonkey 专项 E2E 与产品验收，严禁复制既有用户 Profile、改写现有脚本或把 CDP 模拟当管理器结果。其余 TASK-008..021、正式 EXE＋ZIP 双包均须按依赖与发布门槛推进。

## （7）2026-10-18 TASK-008 只读场景证据完整性修复交接

最新代码修复已从 [PR #24](https://github.com/devin930906/userscript-auto-healer/pull/24) 合并到 `main`：`843510150d18dec390519e69d0cc7decfd23d84c`，涉及 `src/diagnostics/scenario-dom-diagnostic.ts`、`tests/diagnostics/scenario-dom-diagnostic.test.ts`。修复了缺少明确路由布尔值、额外未授权 selector count、超出 DOM 节点总数的计数仍可能进入故障信号分类的问题。首轮 [CI #39131443350](https://github.com/devin930906/userscript-auto-healer/actions/runs/39131443350) 类型检查失败后已修复，源 HEAD `681ab55967e16181e17998703af5819a85eaa397` 的 [CI #39131544473](https://github.com/devin930906/userscript-auto-healer/actions/runs/39131544473) 已完成：107 测试、106 pass、0 fail、1 skip，Windows Electron smoke 成功。`main` 合并后需以新 SHA 重新核验对应 Actions；未经运行的 TEST/GATE 仍未完成。TASK-007 的真实 Tampermonkey 产品级注入/GM/业务断言依然需要独立授权与可靠取证；TASK-008 的实际根因联动尚未完整验收；TASK-009..021、正式 EXE+ZIP 与全部 Stable GATE 未完成。新会话应重新读取 `main`、PR、CI、docs/09 与现存授权环境，而非重复已合并的 #24 修复。

## （7）2026-10-18 TASK-007/008 双项安全诊断增量交接

当前有效代码合并截至 `46be9e33775238caa942a47e1a346339d17b45a4`（本记录的权威状态以上线后每次重新读取 main 为准）。[PR #25](https://github.com/devin930906/userscript-auto-healer/pull/25) 已整合到 `836c39385f2306ed03ce5d357432d79adeb0af07`：TEST-018 限定 DOM 样本校验与异常拒绝，源 [Actions #39132321986](https://github.com/devin930906/userscript-auto-healer/actions/runs/39132321986) 通过且其 main [#39132472768](https://github.com/devin930906/userscript-auto-healer/actions/runs/39132472768) 成功。[PR #26](https://github.com/devin930906/userscript-auto-healer/pull/26) 已整合到 `46be9e33775238caa942a47e1a346339d17b45a4`：TEST-013 多次 DOM 样本要求稳定且失败保守，源 [Actions #39132694315](https://github.com/devin930906/userscript-auto-healer/actions/runs/39132694315) 成功，对应 main SHA `46be9e33775238caa942a47e1a346339d17b45a4` 的 [Application Skeleton Checks #39132821886](https://github.com/devin930906/userscript-auto-healer/actions/runs/39132821886) 已完成且成功。两者均没有安装真 Tampermonkey、接触个人 Profile 或执行油猴脚本，也不产生验证通过的 GM/业务/自动补丁标志。下一优先为 TASK-007 的独立授权真实 Tampermonkey 产品级 E2E（TEST-017/018）；受该前置限制以外，TASK-008 可继续对独立故障证据分类做安全集成。TASK-009..021 和 GATE-001..011 尚不能宣称完成；EXE+ZIP 正式文件及 GitHub Release 尚未形成。禁止复做已合并的 #25/#26。


## （7）TASK-011 阶段进度续接（2026-10-19）

[PR #44](https://github.com/devin930906/userscript-auto-healer/pull/44) 以独立只读磁盘 `.user.js` 原文一致性检查推进 REQ-020 / TEST-020，源 `31a31f111a7e6dbd35dbe454305d99431c1ad954` 的 Windows Application Checks `39147314079`（151 cases: 150 pass / 0 fail / 1 conditional skip + real Electron smoke）与 portable Chrome `39147314150` 均为 success。仍须重新核实 PR 实际是否已合并、最终 main SHA 与 CI；本模块不暴露任意路径 IPC、不修改用户脚本、不完成授权可信来源、持久备份、原子写入或回滚。下阶段优先解除 TASK-007/010 的真 Tampermonkey / 业务证据阻断，TASK-011 的真正事务写入不得绕过这些安全门槛。EXE/ZIP/GATE 仍为正式发布阻断。

## （7）TASK-011 备份-only 阶段续接（2026-10-19）

续接 [PR #45](https://github.com/devin930906/userscript-auto-healer/pull/45)：`src/version/verified-backup.ts` 以只读磁盘原文比对、独立备份副本的 SHA-256 与无覆盖发布推进 REQ-020/TEST-020，并增加 Windows 安全负例。PR 当前 SHA、Windows 测试和合并结果须另行核实。**未完成**可恢复事务版本库、自动应用与写中断恢复、回滚及可信 Tampermonkey/业务验收。下一步只有在 TASK-007/010 可信证据、安全锁定及崩溃恢复方案可验证后才连接任何真实脚本写入；不得将备份成功当作修复成功，也不得称 Stable 已交付。

## （7）TASK-011 恢复来源只读验证阶段续接（2026-10-19）

[PR #46](https://github.com/devin930906/userscript-auto-healer/pull/46) 在 PR #45 备份-only 基础上增加 `verifyBackupRecoverySource` 及 Windows 单元负例。新的只读收据要求符合生成器格式的 UUID 文件名、独立普通文件与单链接、原文长度和 SHA-256 一致，并拒绝源文件硬链接冒充备份；不会恢复或修改脚本。恢复源在核验后仍可能变化，因此下一步必须在**可信 Tampermonkey/业务证据、原生授权、事务锁和可恢复写入日志**俱备时，重新校验并实现真实回滚。请重新读取 main SHA、PR 合并状态和当前 CI；不可把阶段性测试当作完整 TEST-020 / GATE-007 或 Stable。正式 EXE+ZIP 尚未构建。

## （7）TASK-010／011 离线审核到真实备份的安全集成续接（2026-10-19）

[PR #48](https://github.com/devin930906/userscript-auto-healer/pull/48) 以代码源 SHA `3ef164150d66eea542bc741e27e1802181fc5227` 连接本地补丁 AST 审查、实际磁盘 SHA-256、独立备份创建、只读恢复来源复验和源文件末次复核。Windows [应用检查 #39151296629](https://github.com/devin930906/userscript-auto-healer/actions/runs/39151296629) 已通过 164 case（163 pass、0 fail、1 条件 skip）与 Electron smoke；[便携 Chrome #39151296637](https://github.com/devin930906/userscript-auto-healer/actions/runs/39151296637) success。务必重新核查 PR 是否已合并及最新 main SHA，勿将该 CI 自动沿用至之后的代码改动。此增量绝不访问用户现有 Profile、不执行脚本、不授予自动覆盖/回滚、不证明真实 Tampermonkey；TASK-007/010/011、TEST-017/018/020/021、全部 Stable GATE 依旧未完成，正式 EXE 与 ZIP 尚未交付。


## （7）TASK-007 到期后临时脚本副作用安全回归交接（2026-10-19）

本轮复用已有 `feat/task007-isolated-tampermonkey-install-url` 分支，处理短期授权诊断服务器关闭后脚本仍可能留存运行的安全缺口。TEST-017 测试提交 `0c2e0065ad4ca14baa9e17a420f047abebb9ea38` 在 [Actions #39158174162](https://github.com/devin930906/userscript-auto-healer/actions/runs/39158174162) 确认旧行为失败；修复提交 `46880b3ae2a1b72f260ef07bd5caaed32dcae619` 在 [Actions #39158298596](https://github.com/devin930906/userscript-auto-healer/actions/runs/39158298596) 已通过 Windows TypeScript、177 项 Node 回归（176 pass/0 fail/1 skip）与真实 Electron smoke。PR [#58](https://github.com/devin930906/userscript-auto-healer/pull/58) 的实际合并及 main 复核需以当前 GitHub 状态确认；不重复开发此前已合并 #57 的原脚本硬链接拒绝。

到期拒绝只在本应用**生成的临时测试脚本**内生效，不能撤销已安装扩展权限，用户仍需自行清理测试脚本；没有真实 Tampermonkey 产品级 GM 与业务恢复验收。后续优先 TASK-007 的授权实际 Tampermonkey 支持矩阵和可靠验收证据，在可信运行条件不具备时推进不依赖真实扩展且已有规格的独立功能；任务 TASK-008..021、完整 TEST-017/018 与 Stable GATE、正式 EXE/ZIP 均不可标完成。

## （7）TASK-007 产品界面 Chrome 安全连接及独立 Profile 新建阶段（2026-10-19）

[PR #66](https://github.com/devin930906/userscript-auto-healer/pull/66) 已合并至 main，提交 78e3a86d4ededc5ec125ff14eeb611c527561f3f；合并后 Windows [应用检查 #39165441788](https://github.com/devin930906/userscript-auto-healer/actions/runs/39165441788) 成功。产品界面现通过系统路径选择器和单独的原生授权确认接入现有签名 Chrome/CDP 所属进程检查；停止仅针对本程序启动的 Chrome，Tampermonkey 探测只提供运行目标提示，扩展真实性、脚本安装、GM API 和业务恢复仍未得到产品级证明。

后续在另一条可安全快进的历史 TASK-007 分支中，复用 prepareApprovedIsolatedProfile 实现“选取已有父目录→原生明确授权→随机生成子目录→签名 Chrome 校验→仅创建全新空 Profile”。本阶段不能覆盖、迁移或清理用户既有 Profile；代码与 Windows CI 的整合状态须根据当次 PR 重新核验。TEST-017/018、GATE-004/005 和正式 EXE/ZIP 均未完成。

## （7）TASK-007 有限 GM 报告保存交接（2026-10-19）

[PR #93](https://github.com/devin930906/userscript-auto-healer/pull/93) 的阶段实现（`src/manager/gm-report.ts`，Electron native save IPC，界面按钮及 `TEST-017` 回归）在活动且归属已核验的独立 Chrome 会话内，经原生文件选择与二次授权保存**未经认证**的脱敏 JSON 手动诊断摘要；不覆盖已有文件，返回本机文件名、长度与 SHA-256。主干合并之前来源证据为 `cd64e0b402b5b3b2a6e1b89b9d198177d8726665` 的 Windows [#39189509991](https://github.com/devin930906/userscript-auto-healer/actions/runs/39189509991) success（247 pass／0 fail／1 skip，Electron smoke）、便携 Chrome [#39189509990](https://github.com/devin930906/userscript-auto-healer/actions/runs/39189509990) success；合并结果及主干 CI 需重新读取。**下一任务仍是 TASK-007**：在受授权的真实 Tampermonkey 中安装/启用一次性测试脚本，独立取证 GM_getValue、注入时机与业务断言。报告中的自报与 DOM 对照不构成经理器认证或产品修复验收；TEST-017/018、GATE-004/005、EXE/ZIP 与 Stable 全部按原门槛保留。


## （7）TASK-013 只读批处理协调阶段交接（2026-10-19）

新增 `src/jobs/batch-coordinator.ts` 与 `tests/jobs/batch-coordinator.test.ts`，提供内存队列隔离、最多两个并发、有限瞬时重试、取消及不含脚本内容/路径的非权威恢复快照；绝不执行或写入真实脚本，也不授权应用/回滚、Tampermonkey/业务验证。具体提交和 CI 以本阶段 PR 实际合并及最终 main 核验为准。TASK-013 仍为开发中：真实批处理服务集成、经验证的持久恢复、受授权运行和 TEST-022 完整验收未完成；TASK-007/010/011/012 不得因此标记完成。

## （7）TASK-017 原生选择导入取消与批次互斥阶段（2026-10-19）

PR [#101](https://github.com/devin930906/userscript-auto-healer/pull/101) 对 app/main、app/preload、app/ui 和 src/import/import-service.ts 接入 Windows 原生文件／文件夹选择后的**只读**导入批次互斥与取消。仅 Electron 已授权主窗口可经固定无参数 IPC 请求取消；每次批次保留原生选择器给出的路径，不接受 renderer 任意文件路径。目录扫描和文件读取在文件边界协作式中止，已完成结果保留、未处理数量限于已知选中项目。补充 TEST-002/022 的提前取消、文件间取消、未修改源文件与 Electron 原生选择器并发负例，更新 TEST-026 严格 IPC 白名单。Windows 最终回归结果须对照 PR 当前 HEAD 的 Actions；未通过前不得标为完成。

此阶段**没有**持久化可靠队列、已认证的真实 Tampermonkey GM/业务证据、自动修复/回滚权限，也没有正式 EXE/ZIP 制品。TASK-013/017 仍为开发中，TEST-022 与所有 Stable GATE 的完整验收继续受阻。不得将本轮取消功能视为修复引擎或 Stable 验收通过.

## （7）TASK-002／017 字节身份去重阶段（2026-10-19）

[PR #102](https://github.com/devin930906/userscript-auto-healer/pull/102) 在已整合的只读导入上统一 SHA-256 原字节身份：不同文件名但字节相同的 native 多选／目录／拖放脚本按重复处理，同文件名但内容确实不同的脚本版本保留为独立只读结果。文件读取预算覆盖已扫描的相同内容／坏编码，而非仅计入最终保留的唯一脚本。TEST-002/003 增补 Windows 文件系统及 Electron 界面回归，主仓库 PR HEAD、CI 和 main 合并结果需以实际 GitHub 记录为准。

此阶段不修改、执行、安装任何脚本，也不会验证真实 Tampermonkey GM、网站业务或自动修复；TASK-007/013/017、正式 Windows 双包及完整 Stable GATE 仍未完成。

## （7）TASK-011 已变化原文件恢复准备交接（2026-10-20）

现有备份、候选与检查点链路新增对“原文件内容已变但独立旧备份仍在”场景的只读恢复前置校验，代码 `src/version/changed-source-restore-preflight.ts`，测试 `tests/version/changed-source-restore-preflight.test.ts`，纳入 Windows npm TEST-020/021 回归。输入需严格描述符安全、用户同意声明、两份独立哈希和旧备份长度；不能把声明当原生授权或未来恢复权限。该阶段不覆盖原文件、不证明业务恢复、不是原子写入/回滚。下一动作仍需真实 Tampermonkey 认证和可恢复写入事务。TASK-011、TEST-020/021、GATE-007 仍未完成，具体集成以 PR/Actions/main 复核。

## （7）TASK-015/017 有限健康历史接入续接点（2026-10-20）

最新分支 `feat/task015-session-dom-health-bridge` 基于当时 `main@1a99091414ed8cb269927ad3bd9df9518432a8f8` 连接现有内存 `LimitedHealthRegistry` 与本应用自管 Chrome 中的场景只读 DOM + 被动页面异常检查，仅将通过授权且完整完成的有限摘要登记至当前桌面窗口会话。断言缺失、异常信号记录不确定；窗口关闭后清空。新增 TEST-024 负例及 UI 语义约束。**这个阶段既不验证 Tampermonkey/GM/业务，也不能授权自动应用或回滚**。实际源提交、PR、Windows CI、整合状态需按远程最新记录重新核验；PR 未合并不得当成已入 main。下一优先仍为 TASK-007 的真实 Tampermonkey 产品验收、TASK-010/011 的可信验收/事务恢复依赖，TASK-017 完整旅程和 TASK-018..021/EXE/ZIP/GATE 不得标完成。

## （7）TASK-015/017 当前窗口历史查询阶段（2026-10-20）

新增 `src/health/session-history.ts`、`tests/health/session-history.test.ts` 和严格白名单 `scenario:history` 原生 IPC，按已导入并登记的只读场景 ID 提供最多 32 条时间与保守状态记录；桌面可在没有 Chrome 运行时查看本窗口历史。绝不向 renderer 公开用户原始脚本路径／内容、SHA／证据哈希，不授予自动补丁、回滚、Tampermonkey/GM/业务 VERIFIED。PR、合并提交及 CI 以 GitHub 最新证据为准；阶段性历史查询不构成完整 TEST-024。下一优先 TASK-007 真 Tampermonkey 产品 E2E 与 TASK-010/011 的授权可信事务阻断，完成前不得宣布 Stable，EXE/ZIP 未交付。

## （7）2026-10-20 TASK-019/020 候选用户数据路径及卸载保留交接

PR [#149](https://github.com/devin930906/userscript-auto-healer/pull/149) 已合并 main `d090ea074143e4e0ed31832281b134cd796500ac`。Windows [候选构建 #39369480855](https://github.com/devin930906/userscript-auto-healer/actions/runs/39369480855) 在 PR 合成源码 `28ff09c93324aa244e700ed241d25c150c854029` 验证 138 文件真实 ZIP 完整性、138 文件安装完整性、Electron 暂存/解压/安装启动和候选 userData 合成哨兵在卸载后的保留；独立 [应用检查 #39369480904](https://github.com/devin930906/userscript-auto-healer/actions/runs/39369480904) 成功。首次失败 #39369061023 的 Chrome/CDP 及错误 APPDATA 假设已保留，不应删除失败证据。本阶段未验证真实用户 Windows 升级、真实业务数据迁移/回滚、只读 ZIP 目录或正式 Tampermonkey 修复与自动回滚，TASK-019/020、TEST-027/028、GATE-008/009/011 仍未完成，**不是 Stable**。下一优先仍是 TASK-007 实际授权 Tampermonkey 产品级 E2E、TASK-010/011 真实事务门槛，之后继续 TASK-018..021；每轮从 GitHub 最新 main/PR/Actions 恢复。

## （7）2026-10-20 TASK-013 批次恢复超时契约闭合（局部）

PR [#150](https://github.com/devin930906/userscript-auto-healer/pull/150) 已合并 main `30d716eafe9a97edf05f4ab00558baefeecfa9b0`，修复只读调度检查点原先未绑定 `timeoutMs` 的策略漂移：新 `uah-readonly-batch-v2` 快照包含原始超时值，仅允许完全一致的超时配置恢复；旧 `uah-readonly-batch-v1`、更短/更长超时、伪造值与访问器一律拒绝而非继续跳过工作。变更范围 `src/jobs/batch-coordinator.ts` 和 `tests/jobs/batch-coordinator.test.ts`；新增两项 TEST-022/NFR-009/TEST-026 负例与同策略成功恢复。
[Windows 应用回归 #39370945409](https://github.com/devin930906/userscript-auto-healer/actions/runs/39370945409) 与 [开发候选双包 #39370945321](https://github.com/devin930906/userscript-auto-healer/actions/runs/39370945321) 都成功（347 测试：346 pass / 0 fail / 1 skip）；双包工作流实际测试 PR 合成提交 `99dac866f466d6589d5659fa898f077cdf19d124`，不能作为最终 main Stable 发布证据。本次是非授权、内存只读调度提示格式升级，并未保存/恢复真实用户任务、修改脚本、验证 Tampermonkey/GM/业务、实现原子修复或回滚。TASK-013、TEST-022、GATE-007 仍为开发中/阻断；下一优先 TASK-007 的受授权真实管理器验证，未满足时执行其他无依赖的既定安全功能任务。

## （7）2026-10-20 TASK-006/007 CDP 诊断连接中撤销权限修复（局部）

PR [#151](https://github.com/devin930906/userscript-auto-healer/pull/151) 已合并 main `09acca1e46ce0ab8d141809ec7ea04a508a32ca3`。此前 `src/observe/dom-observer.ts` 的只读页面 CDP WebSocket 在 CONNECTING 阶段不监听用户取消信号，可一直等待 4 秒，并在迟到 OPEN 时进入后续查询流程；现已将 OPEN/error/close/timeout/abort 统一为可取消握手，失败安全关闭套接字、清理监听器，且不发送后续 Page/DOM 命令。新增 `tests/observe/dom-observer.test.ts` 三项 TEST-010/017 负例／正常回归。独立 [Windows 应用回归 #39372158090](https://github.com/devin930906/userscript-auto-healer/actions/runs/39372158090) 与 [开发候选 EXE+ZIP #39372158077](https://github.com/devin930906/userscript-auto-healer/actions/runs/39372158077) 均通过；350 项 Node 测试中 349 通过、0 失败、1 跳过。候选双包实际 PR 合成源码为 `a48bc08eb8aa75af7f695774176512d7eaa34ff9`，不是正式 Stable 发行基线。

本项只证明诊断传输层撤销权限边界，不证明 Tampermonkey 扩展身份、实际脚本运行、GM API、业务恢复或自动补丁／回滚；TASK-007、TEST-017/018、GATE-004/005 仍未完成。下一步仍优先争取真实授权的独立 Tampermonkey 产品级 E2E，或在受阻时继续其它已批准、依赖满足的必要代码工作。

## （7）2026-10-20 TASK-020/TEST-028 Windows 只读便携运行阶段续接

[PR #152](https://github.com/devin930906/userscript-auto-healer/pull/152) 已合并 main `961a5d8c230c748d7c12f4aeb8b854c8fc306157`，修改 `scripts/windows-package-candidate.ps1`，在 Windows 临时 ZIP 解压树施加真实 NTFS 可继承的 `WD` 拒绝，确认不能新建测试文件、Electron 候选启动和独立 AppData userData 哨兵数据保持一致、随后移除所加 ACL。实际 Windows 候选 [#39373670565](https://github.com/devin930906/userscript-auto-healer/actions/runs/39373670565) 成功；主应用检查 [#39373670552](https://github.com/devin930906/userscript-auto-healer/actions/runs/39373670552) 成功，350 项 Node 测试 349 pass/0 fail/1 skip。保留先前 `(W)` ACL 递归错误 #39373022139 和无法启动 #39373382713，并注意现在的 `WD` 检查不构成全量文件系统不可变性证明。候选双包仅供开发验证，源为 PR 合成提交 `0e7494233eab668da8d09723213277794ca88142`；正式 Stable EXE/ZIP、Tampermonkey 真 E2E、原子回滚、完整 TEST-028/GATE-009 仍受阻。继续按 docs/09-development-plan.md 从最新主干和 PR 状态审计。

## （7）2026-10-20 TASK-019/TEST-027 开发候选模拟升级验证

[PR #154](https://github.com/devin930906/userscript-auto-healer/pull/154) 已合并至 main `df8bec1e6f962785a3f351bc33cabd659f4e2dac`。仅修改 `scripts/windows-package-candidate.ps1`，在 GitHub Actions 一次性 Windows Runner 中先用当前 Electron 候选源码及相同**开发候选** AppId 创建、真实安装 `AppVersion=0.0.0` 的**合成旧版安装器**，执行旧版应用沙箱启动，写入其独立 AppData 测试哨兵；然后用当前 `0.0.1-dev` 开发候选安装器在同一临时安装路径覆盖升级，运行 Electron 沙箱并验证旧版数据未改变、138 个安装文件与构建源 SHA-256 一致、最终卸载仍保留原有哨兵。合成旧版 EXE 仅存 RUNNER_TEMP，禁止进入发布附件。

[Windows 候选工作流 #39376523388](https://github.com/devin930906/userscript-auto-healer/actions/runs/39376523388) 已完成 success，实际测试合成源码 SHA `8715f3af01cf0be769a2fcaa77ee37ec40ff02e5`；[Application Skeleton Checks #39376523417](https://github.com/devin930906/userscript-auto-healer/actions/runs/39376523417) success（351 项，350 pass/0 fail/1 skip，真实 Electron smoke）。候选 EXE+ZIP Artifact ID `12243552631`，仅临时留存且明确**非 Stable**。日志保留 `PASS: synthetic older Inno installer upgraded to current candidate with AppData intact` 和完整 ZIP／安装文件哈希验证。

本次证据只适用于**合成旧版 → 同源产品候选**的 Inno 安装覆盖语义，无法证明任何真实历史版本迁移、正式升级规则、完整用户设置/业务数据、Windows 用户设备适配、真实 Tampermonkey 或自动修复/回滚。TASK-019／TEST-027／GATE-008 仍属开发中／阻断；TASK-007 真管理器产品级验证、TASK-010/011 可信验收与事务恢复、TASK-018 安全 E2E、TASK-019/020 正式交付、TASK-021 发布验收仍须按实际依赖推进。下一轮首先重新读取最新 main、PR、CI、正式文档和真实可授权环境；不得把本段当作 Stable 发行或使用本轮候选 SHA-256 作为未来正式制品。

## （7）2026-10-20 TASK-011/TEST-020 原生备份源拒绝原因回归

[PR #155](https://github.com/devin930906/userscript-auto-healer/pull/155) 已合并 main `7dd950f695579c7b46c5c6c56141f505c3f0bcd4`。对 `src/version/verified-backup.ts` 的现有 `createVerifiedBackupOnly()` 进行最小错误分类修复：底层 `withNativeSourceLock()` **原本就拒绝**多重硬链接源和符号链接／Junction 祖先且在备份回调前终止；上层却统一将 `NativeSourceLockError.INVALID_SOURCE` 和 `SOURCE_CHANGED` 隐藏为 `IO_FAILURE`。现在分别返回 `INVALID_PATH` 和 `SOURCE_CHANGED`，`SOURCE_LOCKED` 原语义保持不变，未知磁盘异常仍返回 `IO_FAILURE`。没有放宽权限、覆盖源脚本、自动安装、应用或回滚。

新增 `tests/version/verified-backup.test.ts` 的两个 TEST-020/026 Windows 负例，涵盖双路径硬链接和祖先 Junction，并检查没有发布备份、用户原始字节不变。修复前测试提交 `0781b3ddd72deb633b2726970cad49c40e44fdda` 对应 [Actions #39377816631](https://github.com/devin930906/userscript-auto-healer/actions/runs/39377816631)：353 tests，350 pass、2 fail、1 skip，两项新增负例都仅返回 `IO_FAILURE`。修复提交 `cd06d0a05cc590529c175c54b2ff7275723d3d09` 对应 [Windows 应用检查 #39378078806](https://github.com/devin930906/userscript-auto-healer/actions/runs/39378078806) success：353 tests，352 pass、0 fail、1 skip，真实 Electron 启动通过；[候选 EXE／ZIP #39378078848](https://github.com/devin930906/userscript-auto-healer/actions/runs/39378078848) success，实际测试合成 SHA `c78e8dc701363c32ec5b0f3cbfffda4a1895421b`，138 文件 ZIP／安装哈希及模拟升级／卸载验证通过，构建仍明确 **CANDIDATE ONLY — NOT STABLE**。

该增量是已有安全锁的错误原因保真及回归测试，**不是新增原子事务写入／断电恢复能力**，不能把 TASK-011、TEST-020/026 或 GATE-006/007 标记完全通过。TASK-007 的受授权 Tampermonkey 产品级注入/GM/业务证据、TASK-010/011 完整可信自动验收及回滚、TASK-018 安全 E2E、TASK-019/020 正式双包、TASK-021 最终验收仍受各自条件约束。下一轮从最新 main/PR/Actions 恢复，以真实条件与已批准 TASK 优先级继续推进。

## （7）2026-10-20 TASK-009/TEST-019 不完整 DOM 覆盖下拒绝人工候选

[PR #156](https://github.com/devin930906/userscript-auto-healer/pull/156) 已合并 main `07c9b4b10f74bd755cce818625ce4b4be3ad3c8a`。修改 `src/repair/scenario-candidate.ts` 和 `tests/repair/scenario-candidate.test.ts`，锁定已存在的 TASK-009/REQ-019/TEST-019（关联 TEST-026）人工修复候选证据门槛。旧行为会在只读 Chrome/CDP 样本明确报告页面包含 iframe 或可见 Shadow DOM 子树、但顶层 selectorCounts 稳定时，仍把未观测到的旧选择器提升为 `CANDIDATE_ONLY`（仅审核候选，非自动应用）。这可能造成错误人工修复建议。现仅在诊断仍然可用的情况下，对实际检测到 iframe 或可见 shadowRoot 的采样返回 `BLOCKED/INCOMPLETE_DOM_COVERAGE`；不改变源文件、Tampermonkey、备份或任何自动修复权限。

注意现有 `summarizeDomTree` 总会报告通用 `CLOSED_SHADOW_ROOT_UNKNOWN`，即使未发现 Shadow Root，所以不能把该标记**单独**当作不合格条件而彻底封锁正常人工审核。已增加正例保证仅有默认未知标记仍保留原审核候选路径，负例覆盖普通 iframe、可见 Shadow DOM、跨源 iframe，且只读诊断继续提供限界观察，不制造 GM/业务 VERIFIED。

**失败证据完整保留**：测试源码初次 #39379502533 与 #39379687220 因测试类型错误失败，并已纠正；[红灯 Windows #39379795677](https://github.com/devin930906/userscript-auto-healer/actions/runs/39379795677) 在真正进入 TEST-019/026 后为 355 tests：353 pass、1 fail、1 skip，iframe 情况原逻辑实际返回 `CANDIDATE_ONLY` 而不是 `BLOCKED`。首次修复源码 #39379928858/#39379928846 因 `DynamicObservation` 联合类型缺少静态收窄编译失败，已修复。最终修复 HEAD `d01214862a0ab8b610b39ca47da562485bb9969e` 的 [Application Checks #39380039664](https://github.com/devin930906/userscript-auto-healer/actions/runs/39380039664) 第 1 次执行有真实 Windows Chrome/CDP `CDP_FAILED`（不涉及本轮候选门控），而独立候选工作流的同一回归通过；在保留原失败的前提下，仅重跑一次失败作业，第 2 次为 355 tests、354 pass、0 fail、1 skip，真实 Electron shell smoke success。[Windows 候选双包 #39380039677](https://github.com/devin930906/userscript-auto-healer/actions/runs/39380039677) success，实际 PR 合成源码 `d58de00e1e4cdda6c0152786c0991222b186e1c9`；138 文件 ZIP/安装哈希、只读目录启动、合成升级/卸载数据保留均 PASS，Artifact ID `12244869034`，明确**CANDIDATE ONLY / NOT STABLE**。该 Windows CI 的首轮 CDP 失败仍为需要后续稳定性观察的信号，不能因重跑通过而删除历史。

本项只降低只读场景→人工修复候选的错误建议风险，并未实现完整的真实 Tampermonkey 注入/GM/业务诊断、正式自动修复、原子事务/回滚、Stable EXE/ZIP 或 TEST-019/026/GATE 全通过。继续以 TASK-007 真正授权管理器环境的产品级验证作为最高未完成前置；有条件受阻时推进其它已有 TASK 必需链路，不得把审阅候选当作已验证修复。

## （7）TASK-013 / TEST-022 分段 AST 只读预览超过 64 份的覆盖

PR [#164](https://github.com/devin930906/userscript-auto-healer/pull/164) 复用已有分支，修复原生批量导入最多 1000 份 .user.js、但孤立 AST Worker 只分析前 64 份的覆盖缺口。当前代码按 16 份/每段及 1 MiB/每段串行预览，单 Worker 最长 10 秒，并对全批施加 120 秒总预算；超时或超过导入上限的输入保守返回 `SKIPPED_BATCH_BUDGET`，取消后按 `SKIPPED_CANCELLED` 记录，原脚本字节不修改，不执行用户脚本，所有 Tampermonkey / 业务 / 自动应用权限继续为 false。此处不声称完整 1000 份性能基准或可信持久批处理已经验收。

测试先行源码 `2cbc8941a48d50070311d0c6329d096f7477680c` 的 [Windows CI #39405858361](https://github.com/devin930906/userscript-auto-healer/actions/runs/39405858361) 实际失败：364 项中 361 pass、2 fail、1 skip，两项 TEST-022 均为超过原 64 份界限的断言；修复源码 `001b90f3bc466ac6760667ac6070666f44006e03` 的 [Application Checks #39406194800](https://github.com/devin930906/userscript-auto-healer/actions/runs/39406194800) success：364 项，363 pass、0 fail、1 skip，实际 Windows Electron sandbox/preload smoke 成功。已核验 70 份实际 Worker 预览和预先取消；完整 1000 份用户业务与性能基线尚未测试。

[Windows 开发候选 EXE+ZIP #39406194811](https://github.com/devin930906/userscript-auto-healer/actions/runs/39406194811) 第一次测试因不涉及本次 AST 改动的 Chrome/CDP `CDP_TIMEOUT` 失败，保留失败证据；仅重跑一次后 attempt 2 success：同样 364 项回归、ZIP 138 文件哈希往返、只读路径启动、EXE 138 文件安装完整性、合成升级及卸载数据保留均通过。该候选构建实际 PR 测试合成源码为 `b2a7b1736c514fbb6e11fd648b3b3c3aa4023371`，不是 PR HEAD 或 main；Artifact ID `12257896775`，2026-10-23 到期，明确 CANDIDATE ONLY / NOT STABLE。候选 EXE SHA-256 `c8827b2c209d38da498091614fc63fb178250212a39a63bcc19ef9ed2c5572a5`、候选 ZIP SHA-256 `6ea313e15d7227f66c7d65bd05fa290d26d52e4060a2a796688e41224b9df462`，不能挪用为正式 Release 校验。本轮 TASK-013/TEST-022 仍是开发中，持久恢复、真实 Tampermonkey/GM/业务及最终 Stable GATE 未完成；合并状态及 main SHA 需独立复核。

## （7）2026-10-26 主干交接证据更新

- 仓库 `main` 已核验提交 `35033f74c52aa6edaca3723ac4ca23165db3d3d5`（PR #374 已合并）。当前会话读取时 Open PR 为 0；之后的状态必须重新查询，不得视为永久无 PR。
- 主干代码及测试 [#40270063756](https://github.com/devin930906/userscript-auto-healer/actions/runs/40270063756)：599 tests、598 pass、0 fail、1 conditional skip；Tampermonkey 官方厂商托管扩展隔离 Windows [#40270144017](https://github.com/devin930906/userscript-auto-healer/actions/runs/40270144017)：15/15 Job 成功，实际版本 5.4.1、Chromium 141，扩展运行 ID 非商店正式 ID，原版/修复候选 GM+合成业务与人工原版恢复均有有限实证。
- 发行候选 [#40270461210](https://github.com/devin930906/userscript-auto-healer/actions/runs/40270461210)：同一 SHA 的 Windows EXE 与真实 ZIP 候选构建成功、147 文件完整性对照、受限 Windows 安装与便携 smoke 成功；Artifact `12628621628` 仅开发候选，非 Stable Release。
- **恢复执行位置**：继续现有 TASK-007/010/011 的可信真实 Tampermonkey 验收、业务诊断、自动应用前硬门槛及可恢复事务实现；随后按原 TASK-018..021 与 GATE-001..011 执行。不得回到（4）重做或把全部矩阵仅凭这次隔离成功自动判绿。

## （7）2026-10-27 TASK-003 安全回归续接

- 当前开发分支 `fix/task003-untrusted-metadata-byte-boundary` 已提交新增 TEST-004/026 恶意字节输入负例及解析器最小修复。RED `339007a66aa68b4b9d303e47071f1ee3abd19bfa` 对应 [Windows #40454762079](https://github.com/devin930906/userscript-auto-healer/actions/runs/40454762079) 642 项：640 pass / 1 预期失败 / 1 skip；GREEN `ad10c62c071b486f7f9dd0398816aea09ec6091c` 对应 [Windows #40455069810](https://github.com/devin930906/userscript-auto-healer/actions/runs/40455069810) 641 pass / 0 fail / 1 skip，Electron 真实沙箱 smoke success。
- 该安全修复仅限制不可信字节容器触发解析器任意 Getter、Proxy 或伪造 `subarray` 方法，不执行脚本、不认证 Tampermonkey、不触碰脚本原件、不授予自动应用/回滚权限。PR 整合与合并后 main HEAD/Checks 以最新 GitHub 记录为准；下个仍需优先处理的关键链路为 TASK-007/010/011、TASK-018 与 GATE-001..011。

## （7）2026-10-27 TASK-011 检查点回执新鲜度修复与续接
- 在 `fix/task011-checkpoint-final-receipt` 上实现既有 TASK-011 / TEST-020/026 的原生检查点安全增量：发布后仍等待源/备份/候选复核期间，检查点被独立修改或同名同字节文件替换，不再获得陈旧的“已暂存”成功回执；源码与独立备份不被本项修改。
- TDD RED `c2f1bf4a0f79ed7744d699b5e3cafb5aff3fbfca`、[Windows #40457329095](https://github.com/devin930906/userscript-auto-healer/actions/runs/40457329095) 643 tests（641 pass/1 预期新失败/1 skip）；GREEN `74eb05cf6c971e13a212b87ede93fdcb15d596e9`、[Windows #40457596319](https://github.com/devin930906/userscript-auto-healer/actions/runs/40457596319) 643 tests（642 pass/0 fail/1 skip），Electron shell smoke success。
- 此项没有实现自动脚本应用、真实 Tampermonkey 业务、原子断电回滚或正式 Stable GATE；本次 PR/合并后的 main 最新 SHA 与 Checks 必须重新核查。优先续接 TASK-007/010/011 可信业务和恢复链路及其全部必要 TEST，再推进 TASK-018..021。

## 2026-10-29 新版（7）持续开发正式交接（Issue 驱动迁移）

> 本节是旧版（4）+（7）到新版（7）的**增量治理交接**，不是重新执行开发前期准备。迁移审计基准 `main@e3169fc982c9703e26710eb335b36a41f0812454`；治理变更位于分支 `docs/issue-driven-stable-governance-20261029`，应先查询 PR #485 合并状态，再以最新主干 SHA、Open Issues、Open PR、真实 CI/GATE 证据恢复开发。前文 TASK-001 起点及旧主干 SHA 是当时真实历史，不得覆盖已经发生的阶段开发。

**交接权威与连续性**：原始用户需求、REQ/NFR、ADR、RISK、TEST、GATE、TASK 编号保持不变；原有 09 的 21 条任务仍是开发计划；`docs/15-issue-driven-stable-bridge.md` 仅补充新 Issue/PR 工作流，不能推翻原安全/发布约束。`AGENTS.md` 与 `docs/10-traceability.md` 有最新对应规则，`docs/14-stable-work-register.md` 保存剩余工作实证，不得从头重启 TASK-001、重复历史 PR 或先执行未批准的增强功能。

**现有关键 Open Issues（2026-10-29 UTC 查询）**：
- [#486](https://github.com/devin930906/userscript-auto-healer/issues/486) TASK-007：真实 Tampermonkey 可信支持矩阵/产品级验收；
- [#480](https://github.com/devin930906/userscript-auto-healer/issues/480) TASK-008：主框架确认偶发失败；
- [#487](https://github.com/devin930906/userscript-auto-healer/issues/487) TASK-009：可信诊断联动的保守修复候选与安全应用；
- [#488](https://github.com/devin930906/userscript-auto-healer/issues/488) TASK-010：完整业务验收门控；
- [#489](https://github.com/devin930906/userscript-auto-healer/issues/489) TASK-011：真实原子备份、恢复与回滚；
- [#440](https://github.com/devin930906/userscript-auto-healer/issues/440) TASK-013：孤立 AST Worker 间歇失败；
- [#215](https://github.com/devin930906/userscript-auto-healer/issues/215) TASK-020：便携目录重命名偶发 Win32=5。

**不得遗漏计划内无专属 Issue 的工作**：TASK-012/014/015/016/017/018/019/021 仍按 `docs/09-development-plan.md` 的依赖、完成条件和 `docs/14-stable-work-register.md` 的剩余工作管理，待真正接近实施时查重并按需创建 Issue。TASK-001..006 的阶段合并结果不重复开发，也不意味着相应所有 GATE 通过。

**下次直接使用新版（7）的步骤**：读取最新主干 SHA、当前有效 Open PR（先处理可复用者）、Open/Closed Issues、09/10/11/12/14/15、对应 TEST/GATE 和当前 Actions；根据依赖、故障风险及现有验证选择一个能实际推进的 TASK+Issue；不反复做完整（4）。PR 提供代码变更、审查与真实测试，只有完整满足 Issue 验收才关闭 Issue；`Refs #N` 不会自动关闭，`Fixes #N` 仅在真正全部解决且默认分支自动关闭语义适用时使用。每轮写入前重新检查当前分支 SHA，防止并发覆盖。

**准入/发布状态**：历史（4）阶段为有条件准入，正式（7）开发已在进行；本迁移不需要先重新准入。当前验证并不覆盖真实用户 Chrome/Tampermonkey 所有组合、可信自动修复/回滚、发行级 EXE/ZIP 与全部 GATE-001..011，不应宣称已有 Stable 版本。任何对已安装用户脚本/Profile 的操作、正式 Release、仓库规则/Secrets 更改仍需各自的实际授权和验证。

**迁移交接收据**：该分支首先由 PR #485 提出文档治理迁移；后续同 PR 追加 09/10/12/14/AGENTS 与现有 Issues 映射。合并前只能称“已提交待审”，不能称 main 已采用新版规则；合并后仍须读取真实合并 SHA、Docs Integrity CI 结论并按照实际结果更新迁移状态。已完成的软件进度不因治理迁移重置。

## 2026-10-31 正式（7）开发增量交接：TASK-013 并发检查点拒绝异常状态

- 先以实际 GitHub main/PR/Issues/Actions 为准，本节新增合并证据：代码 PR [#531](https://github.com/devin930906/userscript-auto-healer/pull/531) squash 合并 `main@f7bd2cc0ed89bbf914aac0d02b48bf6a5004c937`，在双并发模式中拒绝超额的 `RUNNING` 快照；变更文件 `src/jobs/batch-coordinator.ts` 与 `tests/jobs/batch-coordinator.test.ts`。测试先行 RED `e4849f3cc14c25db93fda3931bc4e8234191d0b1`，修复分支 HEAD `e1e17bd40d84676a19b6ee41372c4df49b07f03e`。
- Windows RED [#41173176156](https://github.com/devin930906/userscript-auto-healer/actions/runs/41173176156) 760/758 pass/1 expected fail/1 skip；PR GREEN [#41173377967](https://github.com/devin930906/userscript-auto-healer/actions/runs/41173377967) 与最终 main [#41173898572](https://github.com/devin930906/userscript-auto-healer/actions/runs/41173898572) 均 760/759 pass/0 fail/1 skip，Electron smoke 成功。Windows 开发候选 [#41173378150](https://github.com/devin930906/userscript-auto-healer/actions/runs/41173378150) 成功，检出的是 PR 合成提交 `3dbe9f9904cfc43c0a583c233b5cb406651a8827`，**不是**正式 Stable 发布源。
- 此轮仅限阶段性安全约束，关联 [#440](https://github.com/devin930906/userscript-auto-healer/issues/440) 仍 Open：其原始 AST Worker 偶发故障未确认根因；其他当前 Open Issues 包括 #510/#489/#488/#487/#486/#480/#215。真实用户 Tampermonkey 产品业务/修复/回滚、Windows 支持矩阵、完整 TEST 与全部 GATE-001..011 仍未闭环。EXE/ZIP 仅为开发候选，未发布正式 GitHub Release；下一轮按当前 Issue 与计划依赖选择可安全执行的最高优先级任务，不重复本次守卫逻辑。

## 2026-10-31 TASK-013 并发队列持久化重试单调性正式开发续接
- 真实代码合并：[PR #532](https://github.com/devin930906/userscript-auto-healer/pull/532) → `main@08f03a5dc12f2f1f74e37ad3a788063a74961d17`；更改 `src/jobs/batch-coordinator.ts` 与 `tests/jobs/batch-coordinator.test.ts`，阻止无新增尝试的已排队重试被直接标记为成功或失败；保留中断状态归一化及取消兼容。
- Windows 修正后 RED `b4267a4866ca9acc41690402699eaa7365d80e47` [#41174961316](https://github.com/devin930906/userscript-auto-healer/actions/runs/41174961316)：761/759 通过/1 预期失败/1 跳过；GREEN `3e3d7ef17ebd82d5e21e2da60ddf839dec0fef9d` [#41174965009](https://github.com/devin930906/userscript-auto-healer/actions/runs/41174965009)、PR Application [#41175266262](https://github.com/devin930906/userscript-auto-healer/actions/runs/41175266262) 与 main [#41175855520](https://github.com/devin930906/userscript-auto-healer/actions/runs/41175855520)：761/760 通过/0 失败/1 跳过，Electron smoke 成功。先前错误的 RUNNING 测试假设及其失败运行 #41174519830、#41174726071 仍在 PR 中可审计，不属于真实产品回归。
- Windows 开发候选 #41175266285 通过，Artifact `13032676896` 仅保留至 2026-11-03 UTC；PR 合成 SHA `4c8e52d632c1ffd581c4c7836736b25e659a012d`。EXE 和真正便携 ZIP 是非 Stable 候选，未执行正式 Release。
- 下一轮从真实最新 main、Open Issues/PR 和 TASK 依赖选择工作；优先检查 [#510](https://github.com/devin930906/userscript-auto-healer/issues/510) 的真实 Windows CDP 启动根因（目前未确定）及可独立安全推进的工作。[#440](https://github.com/devin930906/userscript-auto-healer/issues/440) 保持 Open：真正 AST Worker 间歇故障未修复。真实 Tampermonkey 业务、自动修复/原子回滚及 GATE-001..011 不可因这次局部修复宣布完成。

## 2026-10-31 新版（7）跨会话续接补充

原（4）有条件准入与既有实现继续有效，不重做前期准备。本次针对新版（7）新增跨网页对话独占认领和并行文件/接口冲突控制，规范位于 `docs/16-cross-session-issue-claims.md`，过程追踪为 GitHub Issue #547。其记录的 `main@0ad14ef92b37d15c846fbff3dbecdfdc0fc3f3e3` 为本次迁移开始时的审计基线，并非持续变化的最新主干。后续会话须重新读取 main、全部 Open Issues/PR、有关历史工作分支与 CI，执行 creation-only `work/issue-<N>` 认领验证及依赖/文件隔离检查；工具不具备原子创建语义时不得声称互斥已经生效。项目 Stable GATE、最终 EXE＋ZIP 产品验收仍依原权威标准，不能由本治理迁移代替。

## 2026-11-01：新版（4）→（7）跨轮次安全续接迁移（增量）

- GitHub 远程审计基线 `main@850349001a52326fca09e8c5dccdcfd4ab043cbd`。既有 Electron/TypeScript 产品代码、TASK-001..021、REQ/NFR/ADR/RISK/TEST/GATE、历史 PR 和证据全部保留；不重新执行原（4）或 TASK-001。
- 当前 8 个 Open Issues：#215/#440/#480/#486/#487/#488/#489/#510；各自固定 `work/issue-N` 分支存在，均相对本次 main 有 ahead/behind 差异；当时没有 Open PR。此快照不能判定分支代码是否已全部整合，也不能推定原执行者已经安全退出。
- 首次创建互斥已见 [Actions #41211634125](https://github.com/devin930906/userscript-auto-healer/actions/runs/41211634125) 和 [#41211891107](https://github.com/devin930906/userscript-auto-healer/actions/runs/41211891107)；跨轮次的**并发安全释放/重新认领/失效写入隔离**尚无生产 Issue 验证证据。八个 Issue 均须先按 `docs/16-cross-session-issue-claims.md` 分别核验归属、合并范围、实际剩余、停止写入及安全接管。
- 严禁直接删除旧分支或建立带后缀的第二认领；取得正式安全释放证据后才允许新一轮从最新 main 原子认领并接续。缺少条件标记 `HANDOFF_BLOCKED`，不应暂停其他不冲突的治理工作。
- 新增手动治理测试仅操作 `test/claim-lifecycle-*`，不构成生产交接。合并后应使用实际 run ID 复核结果；不将脚本文件存在当作测试通过，不将开发候选 EXE/ZIP 当作 Stable 发行包。


## 2026-11-01 cross-round coordination test receipt (after PR #566)

The manual, test-only GitHub Actions lifecycle run [#41281277986](https://github.com/devin930906/userscript-auto-healer/actions/runs/41281277986) completed **SUCCESS** on `main@4ce1c9b55fcd1721f95b0cd9df75da21f6222bc8`: two independent runners contested a descendant of a previously released coordination ref, with HTTP 200 winner A / HTTP 422 loser B and 741ms start gap. Final verification rejected a losing sibling and an old-round replay, then recorded release and successful round-three acquisition. See `docs/16-cross-session-issue-claims.md` for exact job evidence.

**Development handoff still blocked for prior eight product Issue claims:** this experimental ref mechanism is not a production owner/round authorization or protected merge/write gate; legacy `work/issue-215/440/480/486/487/488/489/510` ownership and unmatched changes remain unverified. Track full production coordinator, protected integration and individual handoffs in open [Issue #565](https://github.com/devin930906/userscript-auto-healer/issues/565). Do not infer safe product takeover from this success or start over with the former (4) preparation. Other independent, properly authorized work may continue under the existing scope and admission rules.


## 2026-11-02 新版（4）/（7）无独占认领迁移（现行续接依据）

- PR [#602](https://github.com/devin930906/userscript-auto-healer/pull/602) 合并提交 `617fd3879f7a33ff3a5311868c1164b4e6dfb6fb`，经 Documentation Integrity 和 Required PR Fence 成功验证。此 SHA 只是当时迁移基准，不保证永远是当前 main。
- 新指令取消 Issue 独占锁、创建认领分支、持有者签名轮次和 `HANDOFF_BLOCKED` 开发门槛。旧相关记录仍保留历史与安全证据，不能再阻止符合批准范围、依赖和 PR 规则的独立产品开发。
- 保留原始 REQ/NFR/ADR/RISK/TEST/GATE、TASK-001..021、已经合并的产品代码、PR 与 CI；（4）历史有条件准入不重跑，旧产品阶段不重做。并行工作必须以最新 main SHA、实际文件/接口冲突、分支隔离、PR Required Checks 及合并后回归为依据。
- 新建立已批准 TASK 的分类 Issue 映射：TASK-012→#603；TASK-014→#604；TASK-015→#605；TASK-016→#606；TASK-017→#607；TASK-018→#608；TASK-019→#609；TASK-021→#610。原有 #215/#440/#480/#486/#487/#488/#489/#510 保留，不因建立新 Issue 就认为相关功能已通过。
- 当前仍有真实 Tampermonkey 产品业务、可信自动应用与原子回滚、间歇性 Windows 故障、正式 EXE+ZIP、最终人工验收与全部 GATE 的证据缺口；不得把治理修复当作 Stable 验收。
- 现行执行依据：`AGENTS.md` 2026-11-02 小节及 `docs/19-stable-v7-migration.md`；每次均重新读取远端 GitHub 状态。

2026-11-12 外连续接：实现单独授权连接已有自定义 Data 的运行中 Chrome；当前只支持 Tampermonkey 目标只读提示。继续验收 Chrome 原生授权和用户真实 Data；随后分别实现并验证外连场景诊断及 GM 工作流，切勿将外连会话伪装为自启动进程或以断开结束用户 Chrome。

## 2026-11-16 最终 Stable 开发续接记录（PR #883 后）

- **当前远程基线**：仓库 `devin930906/userscript-auto-healer`；默认分支 `main`；当前提交 `e3f2851beb6cdb59849d66b26953933137491f57`。PR [#884](https://github.com/devin930906/userscript-auto-healer/pull/884) 是文档同步提交；产品代码基线仍为 PR [#883](https://github.com/devin930906/userscript-auto-healer/pull/883) 的合并 SHA `bcacd082a3c538e00dfbf481c7221c8e829818ad`。不得从 PR #883 的旧 head `f2675b9e730a76c67aad760625f04c430828fc1e` 继续写入。
- **PR #883 实际范围**：TASK-007/#486 的 app-owned Chrome `chrome://extensions` 管理页只读 Tampermonkey ID/名称/版本/启用状态与 Allow User Scripts 元数据探测；连接已有 Chrome 仍只提供 runtime-target hints。另含 TASK-014/#604 的可选 AI 模型发现原生确认边界，以及 TASK-017/#607 的高级 GM/手动场景夹具折叠与导入结果到受控 Chrome 工作区的导航。三个 Issue 均保持 Open，PR 不代表各自 TASK 完成。
- **合并后机器验证**：Application Skeleton Checks [#43806721310](https://github.com/devin930906/userscript-auto-healer/actions/runs/43806721310) 成功：1126 tests / 1125 pass / 0 fail / 1 conditional skip；Windows Electron shell smoke 成功。Documentation Integrity [#43806721242](https://github.com/devin930906/userscript-auto-healer/actions/runs/43806721242) 成功。
- **TASK-007 专项阶段证据**：[云端实验 #43806236366](https://github.com/devin930906/userscript-auto-healer/actions/runs/43806236366) 在隔离 Chromium 141.0.7390.37 中运行 vendor-hosted Tampermonkey 5.4.1；签名 CRX3 key 推导的 ID 与运行时 ID 匹配，service worker 被观察，原始合成脚本失败、候选脚本恢复合成目标。此实验明确不证明 Chrome Web Store 来源（`storeAuthenticityVerified=false`）、GM 存储往返（`gmRoundtrip=false`）、真实用户 Chrome/Profile、完整应用管理器探测编排、真实生产业务、自动应用或回滚。TASK-007/#486、TEST-017/018 与 GATE-004/005 仍未通过。
- **Windows Candidate 阻断**：候选 EXE/ZIP [#43805989231](https://github.com/devin930906/userscript-auto-healer/actions/runs/43805989231) 在 TEST-006/008/009 的 owned-Chrome CDP 启动阶段失败：`CDP_TIMEOUT`、`FETCH_REFUSED=79`、`CHILD_RUNNING_NO_CDP=1`，打包前终止，本轮没有产生候选 EXE/ZIP。相同 PR SHA 的 Application Checks [#43805989201](https://github.com/devin930906/userscript-auto-healer/actions/runs/43805989201) 与 Portable Chrome Product Validation [#43805989203](https://github.com/devin930906/userscript-auto-healer/actions/runs/43805989203) 成功；不能用这些成功覆盖失败。新增同 SHA 的受控三阶段对照 [#43810123635](https://github.com/devin930906/userscript-auto-healer/actions/runs/43810123635) 在隔离 Chrome 前、全量套件和隔离 Chrome后均成功（60/60、1126/1126、60/60），本次没有复现，不构成根因或修复证据。历史间歇故障 [Issue #510](https://github.com/devin930906/userscript-auto-healer/issues/510) 保持 Open；下一次诊断需提供新的因果差异，不能重复同一对照直到变绿，也不提高超时、不跳过、不弱化 PID/监听归属。
- **UI/UX 状态**：Impeccable Web 对 HTML/CSS/TypeScript 的静态审查确认手动 GM 场景与手动注册夹具位于折叠高级区，tab 键盘导航及窄屏方向同步有源码实现；普通用户主流程仍未形成“选择 Chrome/Profile → 批量导入 → 一次启动 → 逐脚本进度/结果”的完整旅程。未运行真实 Electron 可视页面或人工 GUI 测试，故不记录视觉/人工验收通过。
- **历史发布边界**：GitHub Release `v1.1.3` 已存在，但 `docs/product-rebaseline.md` 明确它不是本次需求验收证据。当前不得沿用旧 GATE 签署或旧双包哈希作为新 Stable。
- **下一执行顺序**：#510 的受控全量套件对照已在 #43810123635 完成但未复现根因；只有取得新的可比较证据时才继续该故障诊断，不重复相同对照。并行继续 TASK-007/#486 的真实管理器、安装授权、GM 与业务验收；只有 TASK-007/008 可信证据具备后，才按正式依赖推进 TASK-009/#487、TASK-010/#488、TASK-011/#489、TASK-012/#603、TASK-013/#857 与 TASK-017/#607 的真实闭环。TASK-014/#604、TASK-015/#605、TASK-016/#606 按其正式依赖和剩余验收独立推进。不得因为 Issue 没有认领人、没有任务锁或最终人工验收尚未开始而停止独立合法工作。
- **最终人工验收**：仍须在正式候选 EXE/ZIP 生成且机器检查通过后集中执行；本轮没有执行安装、解压、真实用户设备操作或 GUI 人工体验。Stable 未完成、未发布。


## 2026-11-16 本地与远端恢复状态

- 本地完整克隆的 TASK-007 工作树：userscript-auto-healer-task007-worktree；工作分支 feat/task007-installed-probe-positive-20261116，工作树干净。当前本地提交 3d484305822541d18e0d11dbae38128220e509ad 的 tree SHA eed6e9625b859f5986d177fb0b98e8bb4f04dd4c 与 GitHub PR 分支 ce81f10124c9a8d8a976ece414ec6978415ad32f 的 tree 相同。本地提交 SHA 本身未进入远端提交历史；文件内容已由 GitHub 文件 API 同步并经 PR #886 合并。
- Node v26.12.1 / npm 11.20.0；本地 npm run build、manager adapter 20 pass / 0 fail / 2 intentional skips、pipe focused test 1 pass、git diff --check 通过。
- Windows Candidate EXE/ZIP run #43822893260 source SHA a41f2e676da766aed184217f1d55424633d9970f 与代码合并点 SHA 7c02f828ba781677629634b0947c7e729b1c170b 不同，候选包仍未满足正式最终发布条件。此前 #43805989231 失败和 #510 根因未确认均继续保留。
- 正式发布路径仍须按 docs/08-release.md 与 docs/product-rebaseline.md：同一最终源 SHA、完整机器 GATE、用户授权真实环境和集中人工验证；无 Issue 认领/任务锁门槛。


> main@d647 候选：Candidate Packaging [#43828261977](https://github.com/devin930906/userscript-auto-healer/actions/runs/43828261977) 于 workflow_dispatch 时以 main@d647003f391f9c350e6efb94a3924f604bd80ead 构建成功；后续 docs-only PR #888 将 main 推进到 eeeac2ecaa2e7188a38d6be03d534032eb86bba7，产品代码未变。PR #888 主干 Documentation Integrity [#43831022566](https://github.com/devin930906/userscript-auto-healer/actions/runs/43831022566) success。EXE SHA-256 6ac2b0530b0243b3886a9d24d61ff0263ebf69d70423ed1abd0548ec0a63c65b；ZIP SHA-256 7994ad8452cb939beb0270111e5cd0eb4f051767b217a3159a2aeaf6da80f41e；Artifact 14207796979，digest sha256:74a54016d4dbf3583a8f9fd7fb254bc4ea201dbc520c59f24f053b6c4cfe7be2，到期 2026-11-19。候选不是正式 Release；ZIP 重定位首轮用了 8 次尝试，后两轮首试成功。

> #510 后续对照：Windows run [#43834078871](https://github.com/devin930906/userscript-auto-healer/actions/runs/43834078871) 在失败源 SHA `f2675b9e730a76c67aad760625f04c430828fc1e` 上以 `chrome_cpu_pressure=true` 运行隔离 Chrome 诊断，限时两个测试子进程各最多 8 秒；完整测试文件及 3 次单独启动均成功（CDP 最迟 t4），全量边界测试 1126 / 1125 pass / 0 fail / 1 skip，Electron shell smoke 成功。该实验未复现间歇性超时，未定位根因、未修改代码或期限，也没有生成候选包。PR #889 已把 docs-only main 推进至 `a9654297e7350b9777876e5a79c333bc038fded4`，产品代码来源仍是 PR #886 合并点 `7c02f828ba781677629634b0947c7e729b1c170b`；#510 保持 Open。

## 2026-11-17 TASK-007 / #486 实时验收续接

- **远端快照**：`main@ad34e61fba377349b0303c4feabb139b9c88a0e2`；当时无 Open PR；Issue #486 仍 Open；最近正式 Release 仍为 v1.1.3。每次继续工作前重新核对 SHA、PR、Actions、Issue 与 Release。
- **新增有限业务样本**：用户指定 `ChatGPT-Prompt-Flow.user.js` v1.0.51 在用户授权的 MCP Profile 中完成 1 条 TXT 导入、发送与精确短句回复，详细记录见 `docs/evidence/2026-11-17-chatgpt-prompt-flow-1.0.51-mcp-acceptance.md`。原 v1.0.53 已恢复启用，源文件未改；样本不是 Userscript Auto Healer 的自动诊断、候选、应用、备份或回滚。
- **未解除门槛**：指定 Codex Chrome Data 路径绑定、Web Store 来源、原生文件选择器、正式产品安装/注入/GM 可信证据、supported matrix、失败修复/回滚及最终 Stable GATE 仍待完成；#486 保持 Open，TEST-017/018 与 GATE-004/005 未通过。
- **下一任务**：继续 TASK-007/#486 的独立可信身份与产品级安装/注入/GM/业务证据链，保留未知状态关闭；不将本次用户脚本样本推广为产品 Verified。此后按真实依赖推进 TASK-008..021、双包构建和最终集中人工验收。

## 2026-11-17 main@ad34 Windows candidate package result

- **Source and workflow**: Windows Candidate EXE/ZIP run [#43910270170](https://github.com/devin930906/userscript-auto-healer/actions/runs/43910270170) succeeded on exact `main@ad34e61fba377349b0303c4feabb139b9c88a0e2`, package version `1.1.3`. This is a candidate run, not a Stable Release.
- **Machine results**: TypeScript typecheck, Windows portable relocation/file-lock/no-overwrite checks, and checksum-manifest refusal cases passed. Registered regressions: **1,143 tests; 1,140 passed, 0 failed, 3 conditional skips**. The ZIP round-trip checked 159 files; cold relocation and three post-use relocation/restart cycles passed, including Unicode/space paths and an actual read-only ACL extraction. The candidate installed cleanly with 159-file payload SHA-256 parity, Electron launch, uninstall, and userData retention. Upgrade used a synthetic older Inno Setup installer, not a real historical release.
- **Candidate hashes**: EXE `b225db2d93caad7b62639bbcf1ae5f144c7d6d26b7410f2788f8736508f31741`; Portable ZIP `c285f59e93c9f067eddf74878a2a62e0c7063a1391bb5be7ea18354c20e0da12`. Temporary Actions artifact [14247526962](https://github.com/devin930906/userscript-auto-healer/actions/runs/43910270170/artifacts/14247526962), digest `sha256:4aaa73ffd9ad06ab8f4d8b20ee430933b0b921d17150fb32e14457f3125cb879`, expires 2026-11-19 16:49 UTC.
- **Acceptance boundary**: These checks verify this candidate build only. They do not complete the remaining real Tampermonkey/business acceptance, final user verification, Stable GATEs, or a formal Release. #486 remains Open; TEST-017/018 and GATE-004/005 remain incomplete.

## 2026-11-17 TASK-007 / #486 Tampermonkey manager inventory readiness correction

- **GitHub 同步**：[PR #901](https://github.com/devin930906/userscript-auto-healer/pull/901) 已于 2026-11-17 squash 合并至 `main@4129a966a2917801fe71f49d7d357f54404b8a77`；PR 的文档、边界、Windows smoke 与 Windows 候选打包检查均成功，两个条件诊断 job 按条件跳过。候选包不是正式 Release；Issue #486 仍保持 Open。

- 用户截图显示 Tampermonkey options 页为 v5.5.1；UAH 状态框同时显示未找到官方卡片。截图无法独立绑定到 UAH 启动的 Profile，因此只作为差异线索。
- 代码路径检查发现探针只等待 Page.loadEventFired，而 Chromium 扩展管理器之后还会异步读取并初始化扩展列表。未完成初始化时的零卡片不能证明未安装。
- 已加入管理器就绪标记、最多 4 秒的单调时钟等待，并让每次 CDP 调用受剩余预算限制。未就绪超时按 INSPECTION_UNAVAILABLE 失败关闭；探针继续只读管理页元数据。
- 本地验证：build 成功；manager 专项 10/10；完整套件 1,146 项（1,134 通过、0 失败、12 条件跳过）。详细证据见 [Tampermonkey manager readiness 记录](evidence/2026-11-17-tampermonkey-manager-inventory-readiness.md)。
- 尚未做修复后的浏览器复测；不证明同一 Profile、商店来源、脚本注入、GM、业务恢复或回滚。#486 保持 Open；TEST-017/018、GATE-004/005 和 Stable 状态不变。


## 2026-11-17 当前续接快照（PR #901/#902 与用户截图后）

- 当前 `main@674548901ebf1e58b6ef9b66fc681a393a8c99a1`；PR #901 产品改动合并 SHA `4129a966a2917801fe71f49d7d357f54404b8a77`，PR #902 docs-only 合并。PR #902 的 Documentation Integrity run [#44031797621](https://github.com/devin930906/userscript-auto-healer/actions/runs/44031797621) 成功；当前无 Open PR。
- 用户最新 Chrome 截图确认 Tampermonkey 5.5.1 已安装并可打开其仪表盘。这与 UAH 状态框的“未找到官方卡片”冲突；不得再把状态框结果解释成用户未安装，也不要要求重装。截图未提供 Data/Profile 的进程级绑定，且没有在截图中显示 UAH 对该精确 Profile 的复测结果。
- PR #901 Windows Candidate run [#44030158756](https://github.com/devin930906/userscript-auto-healer/actions/runs/44030158756) 成功，HEAD `408d55c18edb4245e7797bcbc57ed919d00286f1`；候选包与当前 main 的产品代码树一致但来自 PR HEAD。该产物为临时 Candidate，不是 Stable Release；artifact 14304753363 于 2026-11-20T06:25:48Z 过期。
- 当前 Open Issues 14 个：#486/#487/#488/#489/#510/#603..#610/#857。#856/#480/#440/#215 已关闭历史；#857 是 TASK-013 当前 Issue，#610 是最终 TASK-021/GATE 跟踪。
- 最新正式 Release 仍是 v1.1.3。TASK-007、TEST-017/018、GATE-004/005 以及所有最终 Stable GATE 与人工验收仍未完成。继续保持不操作用户桌面；如需补充实机步骤，由用户自己操作并提供结果。

## 2026-11-20 TASK-013 / #857 持续开发交接

- **当前正式基线**：GitHub `main@146f9a987e7e633496d723e7f517c68282e1fe07`。本地 smoke fix commit `23c9e806f0cc024cdefe86771183a7f84abee797` 对应远端 `ce62dc41b33e417328581ec2e3fef992d8e1f813`，tree `69a1d8306950da0dcc44e2ae2d921e75f1529f5c`。此前 docs commit `0162420a7a8f5902688a6ce20abfbb18f7b5624a` 对应 PR head `0f1a2cdc5e29d612d82e996d88058359fa9c39c9`，tree `7a06f0a39634e451b8b8564608d6f626f5e07ace`。最终 Actions 证据已收集，当前这次文档修正待同步。
- **本地已完成增量**：main-owned bounded dropped-file batch、renderer file-picker/drop 共用 session、main/preload begin/add/finish IPC、错误隔离/去重/上限及只读 AST 一次分析。补入 main-frame reload、renderer-process loss 和窗口关闭时的统一批次清理；reload smoke 已移到现有 renderer 断言之后，且行为 probe 与 preload key inventory 失败码分开。旧单文件入口保留；renderer 无路径或写入/修复权。
- **验证与 CI**：本轮 `npm run build`、`npm run typecheck`、desktop-boundary 75/75、predevelopment 28/21/11 与 `git diff --check` 通过。组合 desktop-boundary/import-service 为 111 项中 110 通过、1 失败；唯一失败为本地 Windows sandbox 创建 symlink 返回 TEST-003 `EPERM`。PR source head `0f1a2cdc5e29d612d82e996d88058359fa9c39c9` 的 Application Skeleton [#44576767661](https://github.com/devin930906/userscript-auto-healer/actions/runs/44576767661)（含 windows-shell-smoke 与 boundary）及 Candidate Windows [#44576767432](https://github.com/devin930906/userscript-auto-healer/actions/runs/44576767432) 均成功；Candidate 全套 Node tests 1,228 总计、1,225 通过、0 失败、3 跳过。Documentation Integrity [#44576768274](https://github.com/devin930906/userscript-auto-healer/actions/runs/44576768274)、Issue Coordination [#44576960099](https://github.com/devin930906/userscript-auto-healer/actions/runs/44576960099) 和隔离 Tampermonkey experiment [#44576767709](https://github.com/devin930906/userscript-auto-healer/actions/runs/44576767709) 成功。Artifact 14556773161 的 SHA-256 为 `f18619e66f41dfe91b5965f0bfc1f6065335154ef90ee5968aa4df80140b59f5`，这是临时候选，不是 Stable。此前本机 Electron 仍在回执前以 `0xC0000005` 退出；Windows shell smoke 已独立通过。
- **根因与修正**：smoke 原本在首个 `File.arrayBuffer()` 开始前就触发取消；renderer 取消监听先设置 `cancelRequested`，批次循环因此跳过两份文件。当前本地 commit `23c9e80` 为首读加入可控门闩，等读取开始后发取消，再释放首读，并只返回首读、取消和计数的布尔诊断；source head 的 Windows shell smoke 已通过。
- **远端状态与下一动作**：PR [#925](https://github.com/devin930906/userscript-auto-healer/pull/925) 已开、未合并，PR source head `0f1a2cdc5e29d612d82e996d88058359fa9c39c9` 的 code tree 与本地 source commit 相同；本轮最终 Actions 记录将随文档更新同步。#857/#610 保持 Open；不要据此关闭。
- **完整 #857 未完成范围**：持久/崩溃恢复、普通流程动态诊断、保守候选、可选 AI、可信 Tampermonkey/GM/业务证据及失败恢复；按 #486/#487/#488/#489/#603/#604 真实依赖继续。
- **Stable**：最新正式 Release 仍需以 GitHub 状态复核；当前没有由本分支构建的候选包，更没有同一最终 SHA 的正式 EXE+ZIP、完整 GATE 与最终集中人工验收。本轮不发布 Stable。

## 2026-11-21 TASK-013 / #857 续接检查点

- GitHub PR #925 当前 HEAD `5a0480055bb515f587176fece14ac54cc2f61a50`、Open 且未合并。精确该 HEAD 的 Application Skeleton `windows-shell-smoke` 失败 `DROPPED_BATCH_RELOAD_SETUP_FAILED`，Candidate Windows packaging 失败 `SHELL_SMOKE_DROPPED_BATCH_CHECKPOINT_NOT_VISIBLE`；对应 run 为 [#44878587959](https://github.com/devin930906/userscript-auto-healer/actions/runs/44878587959) 与 [#44878587931](https://github.com/devin930906/userscript-auto-healer/actions/runs/44878587931)。Boundary、Portable Chrome、Documentation Integrity、Issue Coordination 与隔离 Tampermonkey matrix 的列出 job 成功，但不构成完整 Stable 或用户 Profile 验收。
- 本地 smoke 检查已改为等待渲染器导入控件 idle、匹配本次唯一合成文件的检查点结果，并返回有限阶段码。Build、desktop-boundary 79/79、diff check 通过；本地完整 `npm test` 为 1,248/1,193/43/12，43 个失败仍在 TASK-011、TEST-003、TASK-018 既有类别。
- 同一轮本机隔离 `electron@44.9.1 --uahtest-shell-only` 发生 native `0xC0000005` 退出、无回执；用户截图显示 `electron.exe` 访问 `0x8` 后崩溃，并说明先前也有多次故障。当前沙盒帐户的 Application Event ID 1000 查询没有匹配记录，故障模块与用户交互式帐户中的实际事件仍未确认。不得据此宣称本机 smoke 成功；新 smoke 修改仅待 GitHub 新 HEAD 验证。
- **恢复顺序**：将本地提交安全同步到 PR #925；读取新 HEAD 的 Windows shell smoke、Candidate packaging、Documentation Integrity、Issue Coordination 及 Tampermonkey matrix 最终状态；按失败码继续排查。#857/#610 保持 Open，TEST-022/GATE-007、剩余真实管理器/GM/业务验收、同源 EXE+ZIP 与最终集中人工签署继续未完成。

## 2026-11-21 TASK-013 / #857 — 唯一 smoke fixture 与 renderer reload recovery

- **远端基线**：本轮同步前 GitHub PR #925 仍 Open、未合并，HEAD `5a0480055bb515f587176fece14ac54cc2f61a50`，目标 `main`。该 SHA 的两个 Windows shell smoke 失败已记录在上方；不得把它们当作当前本地改动的验证。
- **本地增量**：drop smoke 用 nonce 同时唯一化文件名和源码字节，只接受本轮新追加的对应文件行与后续 checkpoint 行。main-frame reload 时 main finalize 已接受批次并完成有界只读摘要；仅 `did-finish-load` 后的可信新文档可领取；按 `mainFrameNavigationEpoch` 轮换 recovery receipt，旧文档无法 ack 新结果。分析未 settle 时仍允许用户取消，fragment-only 导航不结束批次；reload smoke 还确认展示后 ack 解锁下一批。摘要只在同一进程/同一 `BrowserWindow` 内存存在，不含源码或路径，关闭/退出清理，不覆盖进程崩溃后的持久恢复。错误名显示有长度限制并拒绝路径/控制字符。
- **机器证据**：`npm run build` / `npm run typecheck` 通过；desktop-boundary 81/81；native checkpoint 与 imported analysis queue 59/59；`.github/scripts/verify-predevelopment.py` 通过 28 REQ/TEST、21 TASK、11 GATE。import-service 36/37，唯一失败是本机 TEST-003 symlink `EPERM`。完整 `npm test` 为 1,251 total / 1,196 pass / 43 fail / 12 skipped，43 项是 TASK-011 restore 41、TEST-003 symlink 1、TASK-018 E2E 1，不报告全套通过。未在本机重跑 Electron smoke。
- **Git 现场**：项目分支 `feat/task013-smoke-stability-20261121` 复用本地 smoke 修正，并包含当前源码、测试与此交接更新。原生 git fetch 通过命令级空 credential helper + OpenSSL 成功刷新远端；PR #925 远端 head 仍为 `5a0480055bb515f587176fece14ac54cc2f61a50`。当前提交/同步正在按 compare-and-swap 方式准备，尚未记录新 PR head 或 Actions 结果。
- **下一步**：将完整验证后的这组改动同步至现有 PR #925 分支；核对精确新 SHA 的 Windows shell smoke、Candidate packaging、Documentation Integrity、Issue Coordination 和隔离 Tampermonkey matrix，按新 run 阶段码继续处理。#857/#610、TEST-022/GATE-007、其他 Stable GATE、同源 EXE+ZIP 和最终人工验收继续未完成。

## 2026-11-21 TASK-013 / #857 — preload inventory smoke 顺序修正续接

- PR [#925](https://github.com/devin930906/userscript-auto-healer/pull/925) 当前远端 HEAD 为 `0e152ef180ef5354b522e52c19aa9c9ed176ea00`，Open、未合并。该 SHA 的 Application Skeleton `windows-shell-smoke` run [#44903243817](https://github.com/devin930906/userscript-auto-healer/actions/runs/44903243817) 与 Candidate packaging run [#44903243773](https://github.com/devin930906/userscript-auto-healer/actions/runs/44903243773) 均因 `SHELL_SMOKE_PRELOAD_KEY_INVENTORY_FAILED` 失败。
- 根因是 smoke 的静态键名清单排序与真实 preload `Object.keys(...).sort()` 次序不同。当前本地改动已改正 `recoverDroppedImportBatch` 与 `registerScenario` 的顺序，并新增测试从 preload 源码导出键生成排序清单后做全量等值断言。
- 本地 `npm run build`、desktop-boundary 81/81、`git diff --check` 通过。没有本机重跑 Electron smoke；远端失败仍属于旧 HEAD，修正需在新的 PR HEAD 验证。最新检查快照中 PR 的 30 个 check runs 均已结束：26 success、2 failure、2 skipped；两项失败正是上述 Windows smoke 和 Candidate packaging。成功 checks 不能替代这两项 smoke，也不能证明完整 Stable 通过。
- 后续按授权将此本地修正同步至现有 PR，不创建新 Issue/PR；随后以精确新 HEAD 核对 `windows-shell-smoke`、Candidate packaging、Documentation Integrity、Issue coordination 与全部 Tampermonkey matrix。#857、TEST-022/GATE-007、真实 manager/GM/业务和 Stable gate 继续保持未完成。

## 2026-11-22 TASK-013 / #857 — 批量候选单项原生确认导出续接

- **过期句柄回执修正**：复审发现 `CANDIDATE_EXPIRED` 和 `CANDIDATE_UNAVAILABLE` 在本次请求写文件前返回；旧回执把它们误报为“暂存可能已开始”。新增 desktop-boundary 断言先红，之后将预写入失效状态与 `candidateConsumed === true` 的确认后失败分别提示。修正后 desktop-boundary 83/83、四组定向测试 114/114；完整 `npm test` 为 1,258 total / 1,203 pass / 43 fail / 12 skipped，43 项仍为 TASK-011 restore 41 项、TEST-003 symlink `EPERM` 1 项及 TASK-018 E2E 1 项。

- **本地分支与增量**：在 `feat/task013-dropped-batch-20261119` 的现有 PR #925 代码线上继续，基线 `35c70b4cfb712e55130decf38ba30b85004c8571`、base `main@146f9a987e7e633496d723e7f517c68282e1fe07`。新增短时、窗口归属、每窗最多 16 项的一次性候选能力；renderer 只拿不透明 ID。主进程重新选择同名 `.user.js`、核对 SHA-256、让用户分别选择备份/导出目录，并在最后系统确认后用既有安全导出流程写入候选、恢复副本与检查点。原始文件不覆盖。
- **失败和界面边界**：取消或文件身份不符会释放能力供重试；能力过期、已消费或最终确认后的写入失败不会重放，若确认后失败，界面提示先检查所选目录中的可能暂存文件。每项 UI 操作有忙碌状态和 `role=status` 回执，旧批次回执不更新新列表；目标输入在诊断/导出期间锁定，目标变化即清除旧结果和候选操作，最终确认展示所绑定的目标网址、源/候选 SHA 与选择器差异。回执明确表示文件另存不等于安装、运行、Tampermonkey/GM 或业务验收。仅完成静态界面源码审查，没有执行 Windows Electron 图形界面人工验收。
- **本地验证**：build、typecheck、predevelopment 文件/追溯验证（28 REQ/TEST、21 TASK、11 GATE）、diff check 通过；相关索引、候选、导出与 desktop-boundary 测试 114/114 通过。全套 `npm test` 为 1,258/1,203/43/12；43 项与既有 TASK-011 restore 41 项、TEST-003 symlink `EPERM`、TASK-018 E2E 各 1 项相同，不能记作全套通过。Electron smoke 未在本机执行。
- **测试覆盖限制**：新增 IPC 对话框顺序由 desktop-boundary 源码边界断言核验；候选能力 store 与候选/文件导出服务另有可执行单测。没有用 Electron mock 实际驱动每一个系统对话框取消、等待期过期、窗口关闭或确认后的部分写入回执；也未做真实窗口或屏幕阅读器操作验收。原始文件保护仍由现有 native source lock、验证备份与导出服务承担。
- **GitHub 同步前状态**：PR #925 在本轮本地验证时仍 Open、未合并，观察 head `35c70b4cfb712e55130decf38ba30b85004c8571`；本轮修改待本地 commit 与 push。推送后必须按新精确 SHA 核验 Application Skeleton `windows-shell-smoke`、Candidate Windows packaging、Documentation Integrity、Issue Coordination 及 Tampermonkey matrix；不合并 PR。
- **剩余范围**：#857 仍缺完整批量协调、候选后续应用与失败恢复、授权动态诊断/可选 AI、真实 Tampermonkey/GM/业务正反验收及 TEST-022/GATE-007。#857 与 #610 保持 Open；其他 TASK/GATE、同源 EXE+ZIP、最终集中人工验收与正式 Stable Release 未完成。下一步完成本文档检查、保存本地提交并同步 PR #925，再按新 SHA 处理真实 Windows/CI 结果。

## 2026-11-22 PR #925 候选导出 head 与 Windows checks 续接

- PR [#925](https://github.com/devin930906/userscript-auto-healer/pull/925) 当前 head 为 `0a5b64f79a0d753000c1243d4cd655bbe15b3226`，base 为 `main@146f9a987e7e633496d723e7f517c68282e1fe07`，仍 Open、未合并；Issue [#857](https://github.com/devin930906/userscript-auto-healer/issues/857) 保持 Open。
- 精确 head 的 GitHub check runs 为 31 项：29 success、2 个可选诊断 job skipped、0 failure。Application Skeleton Checks [#44995638952](https://github.com/devin930906/userscript-auto-healer/actions/runs/44995638952) 的 `boundary` 与 `windows-shell-smoke` 通过；Windows Candidate EXE/ZIP [#44995638933](https://github.com/devin930906/userscript-auto-healer/actions/runs/44995638933)、Documentation Integrity、Issue Coordination 与隔离 Tampermonkey matrix 均已在该 head 完成。候选包和隔离矩阵仍不是正式 Stable/真实用户环境验收。
- 本地 `npm test` 仍为 1,258 total / 1,203 pass / 43 fail / 12 skipped；43 项为既有 TASK-011 restore、TEST-003 symlink `EPERM` 与 TASK-018/TEST-018 E2E 类别，不能记为全量通过。候选导出只证明经原生确认的独立人工导出边界，未授予安装、执行、Tampermonkey、GM、业务或自动应用权限。
- **下一续接**：继续 #857 的逐脚本动态诊断与完整批量协调、候选后续安全应用/失败恢复和 TEST-022/GATE-007 证据；真实 Tampermonkey/GM/业务验收、同源 EXE+ZIP、最终集中人工验收及 Release 仍未完成。

## 2026-11-22 TASK-013 / Issue #857 — 本轮收尾与下一轮续接收据

- **当前远端事实**：PR [#925](https://github.com/devin930906/userscript-auto-healer/pull/925) 当前 head 为 `51c12933e5ac3203682e0e2c07b0c65703171cd4`，base 为 `main@146f9a987e7e633496d723e7f517c68282e1fe07`；PR 仍 Open、未合并，Issue [#857](https://github.com/devin930906/userscript-auto-healer/issues/857) 仍 Open。此前 `0a5b64f` 的绿色检查仅作历史证据，不能代替当前 head。
- **精确 head CI**：当前 30 个 check runs 为 **28 success、2 optional diagnostic skipped、0 failure**。Application Skeleton run [#45017092193](https://github.com/devin930906/userscript-auto-healer/actions/runs/45017092193)、Documentation Integrity、Issue Coordination、完整隔离 Tampermonkey matrix 与 Windows Candidate run [#45017092162](https://github.com/devin930906/userscript-auto-healer/actions/runs/45017092162) 均以 `51c1293` 完成成功；Candidate run 的第一次 attempt 曾出现 `SHELL_SMOKE_DROPPED_FIRST_READ_NOT_STARTED`，读取日志后只重跑失败 job，第二次 attempt 成功。该重跑结果不证明下列产品时序问题已经修复。
- **审查结论**：当前只读审查未发现 Critical，但保留 3 项下一轮必须先处理的 Important：候选包 smoke 应等待导入恢复确认和输入控件真正 idle 后再触发下一次 change；候选导出应在源文件 picker 返回后、任何备份/导出目录 picker 之前完成文件名与 SHA-256 身份核验，并在对话框之间重新确认 capability 未过期；候选过期/消费失败后的 UI 指示应明确“重新导入原脚本，再重新观察”，不能只要求重新观察。当前本轮没有绕过这些问题，也没有把重跑绿色写成修复证明。
- **测试边界**：本地完整 `npm test` 仍记录为 1,258 total / 1,203 pass / 43 fail / 12 skipped；失败类别为 TASK-011 restore 41 项、TEST-003 Windows symlink `EPERM` 1 项及 TASK-018/TEST-018 E2E 1 项。精确 head 的 Windows Candidate job 内部回归为 1,258 total / 1,255 pass / 0 fail / 3 skipped，随后 smoke 与打包也成功；这两种证据边界均不等于真实用户 GUI 或最终 Stable 验收。
- **下一轮入口**：从 `51c1293` 继续，先按审查项补失败测试和最小修复，再重新执行本地 focused/full verification 与精确 head Windows checks；随后才继续 #857 的统一逐脚本批处理、动态诊断、候选评估/失败恢复和真实 Tampermonkey/GM/业务验收。不得合并 PR、关闭 Issue、创建 Release 或宣称 Stable。

## 2026-11-23 TASK-013 / Issue #857 — handoff at 73abbbb

- **代码基线**：PR [#925](https://github.com/devin930906/userscript-auto-healer/pull/925) 分支 `feat/task013-dropped-batch-20261119` 的产品代码 HEAD 为 `73abbbb03a7354e5dfda20fa1dff350e4a824bcf`，基线 `main@96cd4028e227d4934077933f5123230c14ec0367`。本 handoff 仅增加文档记录；PR 仍 Open、未合并，Issue [#857](https://github.com/devin930906/userscript-auto-healer/issues/857) 仍 Open。
- **本轮续接成果**：批量 DOM 成功回执交付前新增主窗口与受控 Chrome 所有权复核；原生候选导出源文件身份前置校验、对话框间 capability 过期复核、过期/消费失败后的重新导入提示，以及 shell smoke 恢复回执与控件 idle 等待，均已在当前分支源码与边界测试中体现。
- **精确代码 HEAD 的 Actions**：Application Skeleton [#45131854718](https://github.com/devin930906/userscript-auto-healer/actions/runs/45131854718)、Documentation Integrity [#45131854753](https://github.com/devin930906/userscript-auto-healer/actions/runs/45131854753)、Issue Coordination [#45131851784](https://github.com/devin930906/userscript-auto-healer/actions/runs/45131851784)、Portable Chrome [#45131854841](https://github.com/devin930906/userscript-auto-healer/actions/runs/45131854841) 均 success；隔离 Tampermonkey matrix [#45131854771](https://github.com/devin930906/userscript-auto-healer/actions/runs/45131854771) 为 21/21 jobs success。
- **候选发行证据**：Windows Candidate [#45131854740](https://github.com/devin930906/userscript-auto-healer/actions/runs/45131854740) success，1,278 tests / 1,275 pass / 0 fail / 3 skipped；来源是合成 merge SHA `a79145a098ad8ae7c5eae9f422662992462040a7`，Artifact [14797684503](https://github.com/devin930906/userscript-auto-healer/actions/runs/45131854740/artifacts/14797684503) 为临时候选，2026-11-26T07:41:26Z 到期。候选 EXE/ZIP 哈希及 161 文件载荷校验详见 `docs/09-development-plan.md` 对应日期记录；不可将该 Artifact 当作 Stable Release。
- **下一步**：重新读取最新 PR HEAD、Review threads 与 Required Checks 后，完成 PR #925 的整合判定；TASK-013 仍须继续真实逐脚本诊断/修复、候选安全应用与失败恢复。上游 TASK-007 / Issue #486 的真实 Tampermonkey/GM/业务证据仍未闭环；Issue #510 的间歇 CDP 根因未确认，除非出现新的可比较失败，不重复既有诊断；TASK-021 / Issue #610 与最终同源 EXE+ZIP、集中人工验收及 Stable Release 仍未完成。
- **状态限制**：当前会话未执行本地 `npm test` 或本地 GUI；所有本轮机器验证来自明确列出的 GitHub Actions。没有用户真实 Windows 桌面验收，没有 GATE-007 或 Stable 完成结论，也未合并 PR、关闭 Issue 或创建 Release。


## 2026-11-23 TASK-013 / Issue #857 — bounded DOM batch coordinator and Windows candidate

- **代码基线**：PR [#925](https://github.com/devin930906/userscript-auto-healer/pull/925) 当前 head `566648d6fac7139af36ae0c2ec3f02f816211d59`，base `main@96cd4028e227d4934077933f5123230c14ec0367`；PR Open、未合并，Issue #857 Open。当前变更文件为 `app/main/index.ts`、`app/ui/index.ts`、`app/ui/index.html` 与 `tests/security/desktop-boundary.test.ts`。
- **实现范围**：原生导入 DOM 批次复用 `ReadOnlyBatchCoordinator`，`concurrency=1`、`maxAttempts=2`、`timeoutMs=120000`；仅 `CDP_FAILED` 返回 `RETRYABLE_FAILURE`，其余错误按脚本隔离；每项回执带实际 attempts；系统授权拒绝、目标打开失败及其他早期阻断会返回逐脚本状态；外层取消信号会取消协调器；最终返回前再次核对 `revoked()`、窗口与受控 Chrome 所有权；取消时移除候选导出句柄并在 `finally` 撤销导出源。UI 增加尝试次数与准确的每批一次系统确认文案。
- **精确 head 机器验证**：Application Skeleton [#45148067926](https://github.com/devin930906/userscript-auto-healer/actions/runs/45148067926) success，1,279 tests / 1,276 pass / 0 fail / 3 skipped；TypeScript、Boundary Regression、Windows Shell Smoke 通过。Portable Chrome [#45148067979](https://github.com/devin930906/userscript-auto-healer/actions/runs/45148067979)、Documentation Integrity [#45148068082](https://github.com/devin930906/userscript-auto-healer/actions/runs/45148068082)、Issue Coordination [#45148062034](https://github.com/devin930906/userscript-auto-healer/actions/runs/45148062034) success。
- **Windows 候选产物**：Candidate Packaging [#45148068037](https://github.com/devin930906/userscript-auto-healer/actions/runs/45148068037) success。工作流从 PR 合成 merge commit `3b619813b5a419147666ef3a60baf0cfdb44436` 构建 v1.1.3 候选；安装程序 `Userscript-Auto-Healer-v1.1.3-3b619813b5a4-CANDIDATE-Setup.exe` SHA-256 `e6b5ad08c444ac7a631c58d0b1a6dac40725d4b957c08e76e5b5fcda1f989762`；便携包 `Userscript-Auto-Healer-v1.1.3-3b619813b5a4-CANDIDATE-Portable.zip` SHA-256 `7ac71b35e8d3baaf89b15ccdafe32648a9a2b7503298a8a7f52bb6c882a643cd`。候选机器检查通过：161 文件安装载荷 SHA-256 parity、合成旧 Inno 安装器升级与 AppData 保留（不是实际历史版本迁移）、干净候选安装、Electron 启动、卸载与 userData 保留、ZIP 完整性及便携 staging/extract/install 检查。Artifact [14805317987](https://github.com/devin930906/userscript-auto-healer/actions/runs/45148068037/artifacts/14805317987) 大小 278,135,894 bytes，外层 Artifact ZIP SHA-256 `1b33de942ab58b0d860203bb03d8301af64e66ef3f11e81e1adaa5a6ea2f71cc`，到期 `2026-11-26T09:40:12Z`。外层 Artifact ZIP 不等于项目自身 Portable ZIP。
- **Tampermonkey 试验边界**：TASK-007 matrix [#45148068016](https://github.com/devin930906/userscript-auto-healer/actions/runs/45148068016) 快照为 13/21 jobs success、8 pending/in progress、0 failure；签名 CRX 获取步骤名称明确注明 NOT store attestation。不得据此宣称官方商店认证、完整管理器兼容或真实业务验收。
- **状态与下一步**：本次只完成受控只读 DOM 观察调度与取消边界，不执行导入用户脚本、不自动应用修复、不自动回滚、不证明 Tampermonkey/GM/业务成功。持久任务队列、可信检查点/崩溃恢复、脚本执行与安全应用、失败回滚、完整 TM/GM/业务正反证据、TEST-022/GATE-007、最终真实 Windows GUI 与用户人工验收均未完成。PR #925 不合并，Issue #857 及相关 Issues 保持 Open，候选 Artifact 不发布为 Release。


## 2026-11-24 实时主干状态核对——TASK-013 整合与当前续接

> 证据基准：`main@e151a8597d2e74e6be1f5876184a95cdf18541de`。本节修正上方仍将 PR #925 描述为开放或未合并的历史快照；历史记录按当时状态保留，不回写篡改。

### 已确认的整合状态

- PR [#925](https://github.com/devin930906/userscript-auto-healer/pull/925) 已于 2026-11-23 17:53:04 UTC 合并，合并提交为 `b15d2b7d92cbd43a4e794b34e7a8ebb5ae23fc01`，来源 HEAD 为 `484fa0677d812871393893701d6e464732aad5f7`。Issue [#857](https://github.com/devin930906/userscript-auto-healer/issues/857) 仍为 Open；该 PR 只交付 TASK-013 的有限范围，不代表整个 TASK 完成。
- TASK-013 后续 PR 也已合并：[PR #944](https://github.com/devin930906/userscript-auto-healer/pull/944) → `ddbb47088328171103327fde4fb2d972c11a355f`（取消后的只读 Worker 未退出前保留诊断租约）；[PR #945](https://github.com/devin930906/userscript-auto-healer/pull/945) → `1fd002a734dbd7a23517e9476637564161f74772`（Worker 退出前保留原生导入 busy fence）；[PR #946](https://github.com/devin930906/userscript-auto-healer/pull/946) → `8d89a8ef1bd6002e72ae5dd946d679e7ab7fb3fc`（阻止普通场景检查与活动导入重叠）；[PR #948](https://github.com/devin930906/userscript-auto-healer/pull/948) → `51eb2ad2ae0cb2cc4790bf4efce845073fa42dd8`（取消后的拖放批次拒绝迟到文件字节）。
- 本次核对时 `main` HEAD 为 `e151a8597d2e74e6be1f5876184a95cdf18541de`。主干 Application Skeleton 工作流 [#45361522839](https://github.com/devin930906/userscript-auto-healer/actions/runs/45361522839) 已在该 SHA 完成：boundary 与 Windows shell smoke 通过；可选 AST-worker 与 Chrome-startup 诊断按条件跳过。该结果是主干机器检查，不代表 TEST-022 或 Stable 验收完成。
- 仓库实时 Open-PR 列表目前仅返回 Draft [PR #956](https://github.com/devin930906/userscript-auto-healer/pull/956)，属于 TASK-010，HEAD `f3f411b0d2dd58ac30d3f70b89b9fedbd3025954`，基于当前 main SHA。它与 TASK-013 独立，不得当作 TASK-013 PR；当前仍为 Draft，不应提前合并。其 Application boundary/shell smoke、Issue fence 与 Windows candidate packaging 检查已完成成功，但候选包不是 Stable 发行文件。

### 持久检查点范围——不得重复开发或夸大能力

- 仓库已经存在 `src/jobs/batch-journal.ts` 与 `src/jobs/native-checkpointed-import.ts`。原生导入 AST 路径使用位于应用自有 userData 下、有界且绑定哈希的只读调度日志；用户重新导入时会重新校验源字节并重新运行 AST 预览。该日志不是身份认证凭据、脚本执行授权、修复凭据，也不能证明当前浏览器或管理器状态。
- 现有 AST 检查点不等于后续动态 DOM 诊断/修复流程已经具备跨重启持久恢复。重启、目标页面变化或 Chrome 会话替换后，旧 DOM 观察可能已经过期；未来恢复必须重新核验当前受控浏览器/会话，并取得每个脚本的新鲜 DOM 证据，不能仅凭持久化的 `SUCCEEDED` 状态跳过观察。
- 不得另建第二套通用日志或重复实现现有 AST 检查点。首先定义并测试动态观察的重启语义、浏览器/目标身份绑定、取消、Worker 退出及安全重放规则。检查点不得保存脚本源码、任意路径、凭据、Cookie 或特权授权。

### TASK-013 / Issue #857 尚未完成的验收范围

- 普通动态 DOM 批次跨进程重启/崩溃的可信恢复语义仍未完成；现有进程内取消/renderer reload 处理与 AST 调度检查点只覆盖更窄的能力。
- 三种普通导入入口仍需形成完整的逐脚本流程：新鲜诊断、可信证据、保守候选审阅、仅在全部前置条件满足时授权应用，以及经过验证的失败恢复/回滚。只读 DOM 信号或导出候选不等于脚本已经修复。
- 真实受控 Chrome 下的 Tampermonkey 安装/注入、GM 往返、业务正反断言与失败恢复，仍依赖 #486/#487/#488/#489/#603 等适用任务；可选 AI 由 #604 追踪，桌面用户旅程由 #607 追踪，最终 Stable 签核由 #610 追踪。
- 保持 #857 与 #610 为 Open。不得根据 PR 已合并、shell smoke 通过、AST 日志持久化、隔离管理器矩阵或候选 EXE/ZIP 工件推断 TEST-022/GATE-007 或 Stable 已通过。

### 当前续接入口

- 下一项正式任务：**TASK-013 / Issue #857**。任何新写入前，重新读取当前 `main`、#857 最新正文/评论、`src/jobs/`、`app/main/`、`app/preload/`、`app/ui/` 及相关测试，并对照此基准与新出现的 PR。
- 安全实施方案必须明确区分：(1) 已有的持久 AST 调度提示；(2) 重启后必须重新获取的动态 DOM 观察；(3) 检查点本身不能授予的候选应用/回滚权限。新工作使用独立分支和 PR，先建立失败测试，再以新 HEAD 执行对应 Windows Actions 检查后才进入整合判定。
- 本快照的 Open Issues 为 #486、#487、#488、#489、#510、#857、#603、#604、#605、#606、#607、#608、#609、#610。执行时必须重新读取实时状态；此列表仅为当前快照，不是永久数量。
- 本次状态核对没有本地工作区、未执行本地 `npm test`、未运行真实用户 Windows GUI、未完成最终人工验收，也未创建 Stable Release。


## 2026-11-27 TASK-005 / Issue #510 — Windows Chrome bootstrap diagnostics on main

> 证据基线：main@643cfaf2b58f61087dcd9d166b8a0f4bcac7d058。本节仅记录受控 Windows Actions 诊断；没有修改产品代码、20 秒启动期限、浏览器身份验证或测试通过判据。

### 当前主干与机器验证

- 当前 package.json 版本为 1.1.3；最新正式 Release 仍为 [v1.1.3](https://github.com/devin930906/userscript-auto-healer/releases/tag/v1.1.3)，发布时间为 2026-11-13。它是历史发行，不是本轮新 Stable 候选或验收凭证。
- 主干 Application Skeleton Checks [#45954222320](https://github.com/devin930906/userscript-auto-healer/actions/runs/45954222320) 成功：1,333 tests，1,330 pass、0 fail、3 conditional skips；Windows Electron shell smoke 成功。
- 主干 Portable Chrome Product Validation [#45954419857](https://github.com/devin930906/userscript-auto-healer/actions/runs/45954419857) 成功：64 tests，63 pass、0 fail、1 conditional skip；真实签名 Chrome 的 owned CDP HTTP 测试成功。此项不是完整 Stable 或最终用户验收。

### #510 历史失败特征

- 失败样本 [#45459793020](https://github.com/devin930906/userscript-auto-healer/actions/runs/45459793020) 的 owned Chrome 测试返回 CDP_TIMEOUT；诊断计数为 FETCH_REFUSED=59、FETCH_TIMEOUT=3、CHILD_RUNNING_NO_CDP=1、CDP_TIMEOUT_LISTENER_PID_MATCH=1。
- 时间窗口为 FETCH_REFUSED=t0..t15、FETCH_TIMEOUT=t17..t20、超时后在约 t18 观察到 listener。失败样本没有 CDP_VERSION_PARSED，所以证据指向 20 秒期限内未取得可解析的 CDP HTTP 版本响应；listener 存在不等于 /json/version 已就绪，也不证明 PID 与 WebSocket proof 已完成。
- 上述结果缩小了故障阶段，但仍不足以确认 Chrome 网络服务启动、HTTP accept/response、Runner 时序或其他具体根因。

### 2026-11-27 同一 SHA 的受控对照

1. [Full-suite differential #45956938775](https://github.com/devin930906/userscript-auto-healer/actions/runs/45956938775) — success，固定在同一 Windows Runner 与 SHA：
   - 全套测试前 owned Chrome：64 tests，63 pass、0 fail、1 skip；Chrome 测试约 4.75 秒，CDP_VERSION_PARSED=t1，PID 与 WebSocket proof 通过。
   - 完整注册测试：1,333 tests，1,331 pass、0 fail、2 skip；运行约 152.5 秒。
   - 全套测试后 owned Chrome：64 tests，63 pass、0 fail、1 skip；CDP 版本解析、PID 与 WebSocket proof 均通过。三个阶段退出码均为 0。
   - 本次没有复现故障；单次对照不能证明完整测试负载永远不会影响间歇性启动。

2. [Cold / preinitialized Profile comparison #45957485205](https://github.com/devin930906/userscript-auto-healer/actions/runs/45957485205) — success：
   - 预初始化 warmup 退出码 0。
   - 冷 Profile 与预初始化 Profile 均返回 OWNED_CDP_BROWSER_VERIFIED；两者均在约 1 秒窗口完成 CDP 版本解析，PID 与 WebSocket proof 均通过。
   - 本次未观察到 Profile 预初始化带来可辨识的启动改善；样本量为单次，不构成统计结论。

3. Issue 记录已同步至 [#510 诊断评论](https://github.com/devin930906/userscript-auto-healer/issues/510#issuecomment-7212357595)。

### 结论、限制与下一步

- #510 仍保持 Open；两项对照均未复现历史故障，根因仍为“无法确认”。不得将绿色诊断解释为修复完成。
- 不提高 20 秒期限，不接受迟到 listener，不放宽 PID/HTTP/WebSocket 身份验证，不跳过测试，不以关闭 Issue 或单次绿色重跑代替根因修复。
- 本轮未运行 Candidate Packaging，未生成新的 EXE/ZIP，未指定 Stable 候选 SHA，未执行最终集中人工验收，也未创建新 Stable Release。
- 正式产品续接入口仍为 **TASK-013 / Issue #857**；其上游管理器、修复、业务验收及导出依赖必须重新核对 [#486](https://github.com/devin930906/userscript-auto-healer/issues/486)、[#487](https://github.com/devin930906/userscript-auto-healer/issues/487)、[#488](https://github.com/devin930906/userscript-auto-healer/issues/488)、[#489](https://github.com/devin930906/userscript-auto-healer/issues/489)、[#603](https://github.com/devin930906/userscript-auto-healer/issues/603)、[#604](https://github.com/devin930906/userscript-auto-healer/issues/604)。#510 仍是 Windows 候选构建前必须继续解决的独立风险。
- 当前审计时 Open PR 为 0、Open Issues 为 14；每次续接仍须以实时 GitHub 状态为准。Stable GATE-001..011 尚无完整通过证据。


## 2026-11-27 live-main reconciliation — TASK-005 / TASK-013 / TASK-017

> Current documentation baseline: main@e5a0030a0a29ddff42ad8ca3a1da4a37f6577b43. This is a docs-only merge after the code evidence baseline main@643cfaf2; no product code changed in PR #966.

### TASK-005 / Issue #510 — third controlled Windows diagnostic

- In addition to the full-suite differential #45956938775 and cold/preinitialized Profile comparison #45957485205 recorded above, bounded CPU-pressure comparison [#45957783316](https://github.com/devin930906/userscript-auto-healer/actions/runs/45957783316) completed success on the same code SHA 643cfaf2.
- The workflow ran the isolated Chrome check once without pressure and once with exactly two test-owned Node workers capped at eight seconds. Both checks passed 64 tests / 63 pass / 0 fail / 1 conditional skip; under pressure, CDP_VERSION_PARSED=t1 and PID/WebSocket proof passed.
- The CPU-pressure sample did not reproduce the historical timeout. It does not exclude other runner contention or rare timing conditions. Full evidence is consolidated in [Issue #510 comment](https://github.com/devin930906/userscript-auto-healer/issues/510#issuecomment-7212357595).
- #510 remains Open and unresolved. No product code, 20-second deadline, browser ownership proof, HTTP validation, WebSocket proof or test threshold was changed. No Candidate Packaging, new EXE/ZIP, Stable candidate, final human acceptance or Release was run.

### TASK-013 / Issue #857 — live-main code reconciliation

- Re-read current main source after merged PR #960. Current blob identities: app/main/index.ts 3a1ba2632317a9ef5341a0cfd5662bd6ab0751e8; app/ui/index.ts f614f2579f93daaf49363c67b2333ef72791e69a; src/jobs/imported-analysis-queue.ts 76af281d203dbd66eadea7f43017f369394f512b; src/jobs/native-checkpointed-import.ts d35965cc4cd7184ddc7247c77f2dc138f66fea93; src/jobs/batch-journal.ts faf535e9f7287422d8309e2b81957d4b308825e8.
- Native multi-select/folder and renderer file-input/drag-drop now converge on the same main-process summarizeResult → analyzeImportedOutcomeWithCheckpoint read-only AST scheduling path. The old Issue #857 body statement that renderer drop/file selection used a separate per-file AST path was stale; the Issue body has been minimally corrected on 2026-11-27.
- Existing batch-journal / native-checkpointed-import persists read-only scheduling hints and ordered hash commitments only. It does not persist source bytes, grant authority, or complete the full durable per-script dynamic diagnosis/repair task across process restart. The source comments explicitly require a separate trusted workflow for restart recovery.
- Remaining TASK-013 scope: durable task-level recovery with fresh consent and current re-import; end-to-end per-script dynamic diagnosis, conservative repair candidate, optional consented AI, real Tampermonkey/GM and business positive/negative proof, versioning/backup, authorized apply/export, and full TEST-022/GATE-007. Keep #857 Open.
- Recheck upstream dependencies #486/#487/#488/#489/#603/#604 and related UI #607 before selecting a dependent implementation slice. No Issue lock/claim is required.

### TASK-017 / Issue #607 — Impeccable Web static UX critique

- A source-only Web evidence review was added to [Issue #607 comment](https://github.com/devin930906/userscript-auto-healer/issues/607#issuecomment-7212545970), based on app/ui/index.html, app/ui/index.css, app/ui/index.ts and docs/05-experience.md at main@e5a0030.
- Positive source evidence: semantic tab/tabpanel relationships, responsive tab orientation, Arrow/Home/End keyboard handling, skip-to-workspace control, visible focus, named buttons, connected labels (including wrapped checkboxes), live status regions, advanced manual GM tools grouped under details, and sampled text-token/background contrast ratios above 4.5:1.
- Main P1 UX gap: the approved single batch journey is still fragmented across seven visible workspaces (Script Library, Browser, Scenarios, Diagnosis, Candidates, Restore, AI). The static review recommends a guided primary batch journey with a persistent stage summary while retaining advanced workspaces and every native-consent/security boundary.
- Review limitations are explicit: no rendered screenshot, live browser, automated a11y detector, Windows GUI, actual keyboard/screen-reader or resize test was available. This is not a visual QA pass, UI code change or Stable GATE pass.

### Current lifecycle state

- After PR #966 merged, current main is e5a0030a0a29ddff42ad8ca3a1da4a37f6577b43; package.json remains 1.1.3 and latest formal Release remains historical v1.1.3 (2026-11-13).
- At the post-merge audit point, Open PRs were 0 and Open Issues were 14. This count is a dated observation, not a substitute for re-querying on the next session.
- Formal product continuation remains TASK-013 / #857 after live dependency recheck; #510 remains an unresolved Windows candidate blocker; TASK-017/#607 remains dependent on TASK-013..016.
- No current Stable candidate SHA, new EXE/ZIP, final human acceptance, complete GATE-001..011 evidence or new Stable Release exists.


## 2026-11-27 PR #968 merged — TASK-013 / TEST-022/026 partial

- PR [#968](https://github.com/devin930906/userscript-auto-healer/pull/968) was marked Ready after rechecking the live base and then squash-merged to `main`. Integrated commit: `22af5f409f62ac41de459c2807d915a265a4fbac`; base before merge: `d850e44fa42745f34ccef65700af08b7abcd4ba2`; PR head: `28bdce3a803c37db3f6dc281363a138d73ab996b`.
- Exact change: `ReadOnlyBatchCoordinator.reserveCheckpointedRun()` now refuses a new checkpoint reservation while `pendingWorkers.size > 0`. The regression proves that cancellation of scheduling is not proof that the underlying read-only worker has retired; after the worker settles, a new reservation is permitted. Only `src/jobs/batch-coordinator.ts` and `tests/jobs/batch-coordinator.test.ts` changed.
- PR-head Application Skeleton Checks [#45960531836](https://github.com/devin930906/userscript-auto-healer/actions/runs/45960531836) succeeded: boundary and Windows shell smoke passed; optional AST-worker and Chrome-startup diagnostics were skipped. PR-head Windows Candidate EXE/ZIP [#45960531797](https://github.com/devin930906/userscript-auto-healer/actions/runs/45960531797) succeeded: 1,334 registered tests, 1,331 passed, 0 failed, 3 conditional skips; candidate packaging and the listed Windows relocation/install/ZIP checks passed. Required Issue Coordination run [#45962649166](https://github.com/devin930906/userscript-auto-healer/actions/runs/45962649166) succeeded.
- Candidate packaging used synthetic merge source `61809054fbd55cb1f80a1e0610f2959487d323d7`, not a Stable release commit. Candidate EXE SHA-256: `732312536d342551dc36679a412b3463f14f0d240fac88eb3493c285737e7a3e`; candidate ZIP SHA-256: `bd67a233f843cacb869e95df92294863b14cf74dfa9c4a9fd9f20c87c381836b`. Artifact [15180204973](https://github.com/devin930906/userscript-auto-healer/actions/runs/45960531797/artifacts/15180204973) is temporary and unapproved; it is not a Release.
- Post-merge main Application Skeleton run [#45962697988](https://github.com/devin930906/userscript-auto-healer/actions/runs/45962697988) completed successfully: the boundary and Windows shell smoke jobs passed; the optional Chrome-startup and AST-worker diagnostic jobs were skipped by their configured conditions.
- This is a narrow worker-lifecycle fence only. It does not complete durable full-task restart recovery, dynamic diagnosis/repair orchestration, authorized apply/export, real Tampermonkey/GM/business positive and negative acceptance, rollback, TEST-022 or GATE-007. Keep Issue [#857](https://github.com/devin930906/userscript-auto-healer/issues/857) Open. No Stable GATE-001..011 completion, final Windows human acceptance or new Stable Release is claimed.
- Current integrated code baseline after PR #968: `main@22af5f409f62ac41de459c2807d915a265a4fbac`. Before any further write, refresh main, PRs, Issues and dependency evidence; no Issue claim/lock is required.
