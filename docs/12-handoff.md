# 项目开发交接

> 状态：**（4）工程准备已完成期末审查并交接，（7）可按「有条件准入」从 TASK-001 开始**。当前尚无正式产品代码，真实用户环境全面兼容和 Stable 仍待后续任务验收。

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

后续最优先的是在获授权的独立脚本/页面下完成真实 Tampermonkey 的 .user.js 安装、注入、GM_getValue/其他声明 GM API 与业务断言，再验证用户实际 Chrome/便携版/9223 CDP Profile 归属。若无法安全获得专用测试环境，就明确记为未验证而不是改动现有脚本；可依已通过的有限 PoC 进入 TASK-001 安全骨架开发。现行便携格式为 ZIP；最新资料请以 docs/13-predevelopment-admission.md 与 docs/11-readiness.md 为准。

## 真实 Tampermonkey 功能验证交接（POC-02T-LIVE，2026-10-18）
在用户连接的 Chrome + Tampermonkey 5.5.1 中，临时 `.user.js` 安装/注入、`GM_getValue`、人工 `broken`/`fixed` 选择器功能断言、删除及停止注入已取得真实浏览器工具返回。证据：docs/evidence/2026-10-18-tampermonkey-live-browser-qa.md。**此测试不是 Actions 云端 runner，也不是独立 Profile，更不是产品自动修复或 Stable TEST/GATE**。先前本文件的“尚未验证真 GM”是更早只读检查时的状态，后续仅该限定样本已得到正向结果。继续推进 TASK-001，正式管理器适配 TASK-007 与 TEST-017/018/GATE-004/005 必须另建产品集成测试和云端矩阵。

## （4）终局交接收据（2026-10-18）

**本阶段停止**：文档语义交叉审查、准入条件分类与后续 TASK 责任分配已写入 docs/11-readiness.md，正式 Windows EXE+ZIP（非 RAR）、首要 Tampermonkey（非将 Violentmonkey 当替代）、实际 POC-02T-LIVE 的限定成功均已反映在入口文件中。后续 GPT/Codex 不应继续把这些既定事项当未解决前期阻断，也不应从头生成新的准备文档。

**可直接执行的（7）起点：TASK-001，Electron+TypeScript Windows 桌面最小安全骨架。** 按 ADR-001 设计 renderer sandbox=true、contextIsolation=true、nodeIntegration=false，最小可信 preload IPC，Chrome 进程/独立 Profile 保护和非授权路径拒绝；先写安全负例再实施，执行真实 CI，提交可审计代码。任何原 .user.js 均不得未经授权读取、覆盖或在高权限主进程执行。

**延后而非忽略**：TASK-005 = Windows/Chrome/便携 Chrome/CDP Profile/9223 归属；TASK-007/010/018 = 独立云端真 Tampermonkey POC-02T、管理器适配、产品实际脚本业务断言/登录与安全矩阵；TASK-009..011 = 自动修复候选、备份/回滚/验收；TASK-019/020/021 = 真实应用 EXE+ZIP 及全部 Stable 门槛。PoC 无法替代任何正式 TEST/GATE。
**停止规则**：此段不是开始 TASK-001 的授权；只有用户正式下达（7）后才进入产品代码开发。恢复时重新读取 main HEAD、CI、Open PR/Issues 并遵循 AGENTS.md；无需重复（4）。
