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
