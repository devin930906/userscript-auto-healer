# 项目开发交接

> 状态：**（4）工程准备已完成期末审查并交接，（7）可按「有条件准入」从 TASK-001 开始**。正式产品源码尚未完成，真实用户环境全面兼容和 Stable 仍待后续任务验收。

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
暂无 package.json、lockfile、真正可运行产品功能或 npm test/build 命令，当前“不适用”。后续创建技术骨架后须把真实 test/lint/build/Windows E2E 指令和退出码更新到 07/09/本文件；未运行不能写通过。

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
