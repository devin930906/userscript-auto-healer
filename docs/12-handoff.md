# 项目开发交接

> 状态：准备材料已保存 main；仅首个 TASK-001 安全骨架的技术准备有条件完成，全部前置/实际管理器支持范围与 Stable 尚未完成，产品源码仍未开始。

## 项目身份
仓库 https://github.com/devin930906/userscript-auto-healer；默认分支 main；产品为 Windows 本地优先、自动诊断与保守修复因网页变化失效的油猴脚本，交付 EXE 安装版与真实 RAR 便携包。不得混淆其他用户项目。

## 基准提交
仓库空仓库初始化基准 1205776e91ede1cbb122e699acb7fb7805be23cb；需求技术规格提交 32830ad793b48ccfa59bdb03eb97699a00635bee；测试开发计划提交 df82a2c50b4cdec2faaae676d0141939b9479664。实际每次开发起点以重新读取 main 的最新 HEAD 为准，本文列出的历史 SHA 不是永远的当前 HEAD。

## 权威文档
00-intake 原始输入；01-product 范围；02-requirements 行为；03-feasibility 官方依据/PoC；04-architecture 契约；05-experience 操作；06-security-risk 风险；07-testing 用例；08-release Stable；09-development-plan 任务；10-traceability 关联；11-readiness 准入；12-handoff 续接；docs/adr 为独立技术决策；AGENTS.md 为执行规则。

## 确认决策
CDP 默认绑定 127.0.0.1:9223，使用用户指定 Chrome 与合规非默认 Profile；严禁接管外部浏览器进程/改写旧 Profile；本地优先、AI 可选且默认关闭；只有真实油猴管理器运行+业务断言成功才算已验证恢复；任意自动应用必须有备份回滚；Windows EXE 与真 RAR 格式固定。Electron+TypeScript 仍是候选技术基线，不是实测最终决定。

## 待处理风险
BLOCK-01/02/03/04/05 的完整条件见 11-readiness；Windows runner 的 Chrome 155 非默认 Profile/CDP 已取得局部实证（https://github.com/devin930906/userscript-auto-healer/actions/runs/39082627685）；多便携 Chrome 与目标管理器/真实业务脚本覆盖、RAR 长期正式创建许可、Windows 正式产品构建、目标最低版本和业务场景仍缺证据。缺少 LICENSE 选择不自行补造。

### 2026-10-18 本轮技术验证续接点

- POC-01B 完成部分兼容验证：Chrome for Testing 154.0.8037.57 从独立解压路径可安全建立 CDP，错误 Profile 拒绝及端口占用预检通过。日志：https://github.com/devin930906/userscript-auto-healer/actions/runs/39088772310。
- POC-02A 实际加载 Violentmonkey MV3 2.49.0 Service Worker，脚本安装确认页面出现并完成确认；进一步在临时 Profile 中实测 Allow User Scripts `false→true`（https://github.com/devin930906/userscript-auto-healer/actions/runs/39090258155），**仍不能证明脚本注入/GM_getValue**，真实功能测试未完成。Chrome 138+ 扩展详情页的 Allow User Scripts 授权需要用户主动同意。日志：https://github.com/devin930906/userscript-auto-healer/actions/runs/39089315021；Chrome 官方：https://developer.chrome.com/docs/extensions/reference/api/userScripts。
- POC-03A 通过 Inno Setup 6 临时测试安装器制作/安装/卸载，不是正式产品 EXE：https://github.com/devin930906/userscript-auto-healer/actions/runs/39089013574。
- POC-03B 经 WinRAR 7.23 官方签名有效的限期评估创建真 RAR5、测试、解压与 SHA-256 核对成功；生产/正式 CI 长期许可证**仍未提供**，禁止自动反复试用或把测试归档当便携软件：https://github.com/devin930906/userscript-auto-healer/actions/runs/39089224242。
- POC-02C 最新复核：完整重启临时 Chromium 后，扩展 userScripts API available=true、registrations=1；管理器存储测试脚本 enabled=1 且 @match 对应本地测试页，仍未真实注入/运行 GM_getValue。工作流已明确失败，不再误将扩展加载或安装成功等同脚本功能成功：https://github.com/devin930906/userscript-auto-healer/actions/runs/39091275121。须继续查站点授权、注册注入、管理器真实运行日志与用户所选正式 Chrome 的差异，不能无条件准入。
- POC-02D **最新已通过**：标准 HTTPS 目标 `https://example.com/`、真实 Violentmonkey v2.49.0 MV3、隔离 Windows Chromium。通过打开扩展级 Allow User Scripts、安装真实 `.user.js`、执行 DOM 行为及调用 `GM_getValue("__poc_fixture_unset__", "poc-default")` 的严格断言。日志：https://github.com/devin930906/userscript-auto-healer/actions/runs/39092523277。原随机端口 PoC 属历史失败，不能继续将全部 POC-02 描述为未通过；但 Tampermonkey、用户正式 Chrome、真实损坏脚本修复仍未验证。
- 当前准备阶段重点：已有真实 Violentmonkey .user.js 注入与 GM_getValue 调用成功证据，下一步转向确认目标管理器、目标 Chrome/Windows 支持矩阵、真实坏脚本/业务断言及 ADR-001；生产 RAR 许可在发布阶段仍须落实。不得把隔离环境技术 PoC 当 Stable 功能完成。

## 开发起点

**仅对 TASK-001 开放有条件工程入口**：Chrome/CDP 系统和独立路径 PoC 已通过，Violentmonkey 2.49.0 在隔离 Windows Chromium 真实安装 .user.js 并调用 GM_getValue；另外两组独立 `broken`（旧 selector 未找到、业务失败）和 `fixed`（新 selector 命中、业务恢复）的人工作成版本已经得到真实管理器业务断言。记录：https://github.com/devin930906/userscript-auto-healer/actions/runs/39093275851。后者**不是自动修复实现**。

ADR-001 已有条件选定 Electron+TypeScript 作为 TASK-001 安全骨架基线；首任务需真正编写并测试 sandbox/contextIsolation、Node Integration 关闭、白名单 IPC 与安全配置入口，现阶段仍然没有这些正式产品代码。用户实际 Tampermonkey/Windows 10 或 11/不同便携 Chrome、实际损坏脚本及登录站点的完整业务回归均未验证；在后续任务各自的真实验收前不得声称支持。RAR 长期生产许可、产品真实 EXE/RAR 双包属于正式 Stable 发布门槛，并不因一次限期试用通过而解除。证据矩阵和恢复执行说明见 docs/13-predevelopment-admission.md。

POC-04B 另于 Ubuntu runner 以 Acorn 成功解析三处静态定位器与三处动态/未知调用（https://github.com/devin930906/userscript-auto-healer/actions/runs/39093951314），只证明技术可行。TASK-003 尚无正式产品源码，动态定位器不得被误判为静态可修。具体结果及适用范围见 docs/13-predevelopment-admission.md。

## 任务顺序
M0：POC-01/02，RAR 合规供应调查/POC-03；M1：TASK-001..004；M2：TASK-005..008；M3：TASK-009..017；M4：TASK-018..020；M5：TASK-021。依赖顺序与并发边界以 docs/09-development-plan.md 实际编号为准，不盲目逐编号执行有前置未满足的任务。

## 验证命令
暂无 package.json、lockfile、真正可运行产品功能或 npm test/build 命令，当前“不适用”。后续创建技术骨架后须把真实 test/lint/build/Windows E2E 指令和退出码更新到 07/09/本文件；未运行不能写通过。

## 云端限制
GitHub 连接账户有该仓库写入权限；最新 Ubuntu 文档 CI https://github.com/devin930906/userscript-auto-healer/actions/runs/39092836797 成功。Windows runner 已完成 Chrome/CDP 和独立路径探针、真实 Violentmonkey/GM_getValue PoC（https://github.com/devin930906/userscript-auto-healer/actions/runs/39092523277）、Inno 临时 EXE 和限期评估真 RAR5 工具链验证，但 Secrets、正式生产 RAR 授权、配额和应用构建仍未验证；截至 2026-10-18 查询 main 的 protected=false，不代表可忽略将来的规则变动。网页会话不等于用户 Windows 的实际浏览器登录环境；依赖实机用户授权的 GM 测试不能只用普通 DOM/模拟测试替代。

## 续接规则
读取 main、所有相关开发分支、Open PR/Issues、历史提交与 CI；按 11 把准入阻断优先处理；按 09 选择最高优先级可执行任务；先写测试/证据再实施最小代码并留痕；更新 REQ↔TEST↔TASK↔GATE、ADR、安全风险和本文。禁止重复生成新准备体系、无限新建 PR、静默覆盖用户脚本、绕过 Chrome 安全限制或在准入前正式开发。
