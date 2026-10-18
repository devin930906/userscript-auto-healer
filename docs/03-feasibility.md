# 技术可行性与技术选型

> 核验日期：2026-10-18。状态：Windows 托管环境中的 Chrome/CDP、Violentmonkey 真实 .user.js 注入及 GM_getValue 调用、临时 EXE 与历史 RAR5 工具链有正向 PoC；现行便携发行改为 ZIP，目标管理器、真实故障回归、正式应用 EXE+ZIP 仍待验收。

## 技术候选
A: Electron + TypeScript/Node（统一 GUI、AST、CDP、Windows 安装器）；B: .NET 桌面 UI + Node/JS 分析器（Windows 原生集成但双语言接口成本较高）；C: Python + 桌面 UI（AST JS/打包与浏览器管理增加异构依赖）。需求满足：A 高、B 高、C 中；兼容性：均须验证真实 Chrome；复杂度：A 中、B 高、C 中高；安全性：均需主动设计隔离；维护：A 统一 TS 优、B 双运行时负担；云端构建：A/B/C 理论可行未实证；许可成本：正式 ZIP 可使用 Windows 原生压缩工具，不需 WinRAR 创建许可证；其他依赖仍需核验；主要风险：A 的 Electron 安全默认配置、扩展自动化验证与产物体积。

## 官方依据
| 编号 | 来源 | 链接 | 适用性与核验结论 |
|---|---|---|---|
| REF-01 | Chrome 远程调试变更 | https://developer.chrome.com/blog/remote-debugging-port | Chrome 136 起普通 Chrome 默认用户数据目录不接受远程调试参数，需指定非默认 user-data-dir；专用目录必要 |
| REF-02 | CDP 协议文档 | https://chromedevtools.github.io/devtools-protocol/ | /json/version 提供浏览器端点；/json/list 列出目标，进程启动不等于连接已建立 |
| REF-03 | Tampermonkey 官方文档 | https://www.tampermonkey.net/documentation.php | @grant/@run-at/@match/@require/GM APIs 必须覆盖，注入与运行沙箱影响结果 |
| REF-04 | Playwright Chrome Extensions | https://playwright.dev/docs/chrome-extensions | 持久化上下文与扩展测试有 Chromium/Chrome 能力差异；不能假设任意正式 Chrome 支持扩展侧载 |
| REF-05 | Playwright persistent context | https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context | 浏览器不能复用已占用 User Data Directory；用户日常默认 Chrome Profile 不适合直接自动化 |
| REF-06 | Chrome userScripts API | https://developer.chrome.com/docs/extensions/reference/api/userScripts | 原生用户脚本注入依赖权限和环境；不能替代 Tampermonkey 全部 GM API 验证 |
| REF-07 | electron-builder NSIS | https://www.electron.build/v26/docs/nsis/ | 安装器 NSIS、portable 均有 Windows 构建路径；portable target 并不直接生成 .rar |
| REF-08 | GitHub 托管运行器 | https://docs.github.com/en/actions/reference/runners/github-hosted-runners | 可设计 windows-2025 x64 工作流，当前仓库 Actions 权限/用量尚未读取 |
| REF-09 | RAR 与 WinRAR EULA | https://www.rarlab.com/license.htm | 40 天试用期后须购买许可证；不能随软件打包未授权 WinRAR |
| REF-10 | RAR 命令行工具 | https://www.win-rar.com/cmd-shell-mode.html?L=1 | Windows WinRAR 提供 rar.exe，支持命令行创建；实际运行器安装与许可证待验证 |
| REF-11 | GitHub 工作流工件 | https://docs.github.com/en/actions/tutorials/store-and-share-data | 构建工件是工作流归档，最终 .rar/.exe 需作为正式文件本体检验 |

## 能力验证
CDP 浏览器协议读取：官方机制已确认；完整跨域/闭合 Shadow DOM 获取能力不得保证。AST 只覆盖可静态确定的调用；闭包/动态拼接转运行时待确认。Tampermonkey 与不同 Chrome/Profile 的真实运行链：未验证。第三方 AI 模型列表端点并非所有服务同构：需兼容检测及手填 fallback。

## 兼容性分析
待定义 Chrome 稳定版/便携版最低版本与操作系统；Chrome 136+ 使用非默认 Profile；默认端口 9223 且绑定本机回环地址；登录态只能在用户自行授权的测试 Profile 建立。强制 side-load 扩展在正式 Chrome 的可行性不可靠，须走受支持的管理器可用/用户授权初始化路径。即便 CDP 可见 DOM，不能冒称 GM API 已在真管理器中运行。

## 许可证核验
Electron、TypeScript、AST 解析器、差异补丁依赖及实际锁定版本的许可证仍须在落地选型时逐项登记；未核验具体包版本，勿标记已批准。原 RAR/WinRAR 创建工具许可约束（REF-09）属于历史选择；现行 ZIP 需实测格式和完整性，不再要求 RAR 创建许可。

## 方案比较
优先提出 Electron/Node+TypeScript 作为**待批准的基线方案**，不是对已证实架构的冒充；理由是 JS AST 与 CDP/桌面打包技术栈一致。替代 B 在本地 Windows 集成上较直接但跨语言成本较高；C 更轻量但跨语言 JS 分析/可重复打包风险更大。未来若 GUI 或目标环境要求否定 A，应在 ADR 中记录变更而非强行执行。

## 关键风险
RISK-001 / RISK-002：Chrome/Profile 安全；RISK-003：管理器不可重复自动装载；RISK-004：ZIP 归档完整性/路径穿越/依赖遗漏；RISK-005：误把网页定位测试当用户脚本验收；RISK-006：不可信代码与凭据泄露。详见 06。

## 选型结论
ADR-001：条件性技术基线 Electron+TypeScript + CDP + AST（核心设计仍待 PoC 放行）。ADR-002：真实管理器测试分层。ADR-003 为历史 RAR 决策，ADR-004 将现行便携格式改为 ZIP。用户需求未授权的 GUI 细节不得自动上升为不可逆决定。

## PoC 状态
- POC-01（开发前关键）：Windows 用户指定 Chrome 可执行路径 / 自有非默认 Profile / `--remote-debugging-port=9223` / 回环绑定；验证 /json/version 与目标归属；失败则重新评估连接方案。
- POC-02（开发前关键）：用户授权的真实 Chrome+目标油猴管理器，在测试 Profile 导入测试脚本、确认 @match/@grant/@run-at/GM API、真实执行/回归；无法自动装载则固定受支持的初始化/人工授权步骤。
- POC-03（发布链关键）：原 RAR 验证仅保留历史技术证据；现行 Windows Actions 需验证真实 ZIP 的格式、内容哈希与安全解压，EXE 安装独立验收。
- POC-04（开发早期）：AST 解析静态/动态/函数封装与源码位置、脚本沙箱隔离的验证。
POC-01 **部分已执行并通过**：2026-10-18 Windows GitHub runner windows-2025 中，Chrome/155.0.8059.40（C:\Program Files\Google\Chrome\Application\chrome.exe）使用临时非默认 Profile、127.0.0.1:9223 成功启动，/json/version 握手、WebSocket 浏览器端点、监听进程可执行文件/命令行 Profile 归属及 /json/list（1 个目标）均通过；证据：https://github.com/devin930906/userscript-auto-healer/actions/runs/39082627685。**仅验证托管运行器内的 Chrome 实例，不代表用户任选便携 Chrome、Profile 迁移、错误场景或油猴管理器成功。** POC-02A、POC-03A、POC-03B 已进行了部分实证，详见下面新增记录；旧版非标准端口测试的 POC-02B 曾失败；标准 HTTPS 场景的 POC-02D 已实际通过 .user.js 运行及 GM_getValue 读取。POC-04 未执行。限定的核心技术可行性已成立，但实际目标管理器/浏览器/损坏脚本修复回归、RAR 生产许可和正式产品双包仍阻断无条件 Stable 验收。

### 2026-10-18 新增真实 PoC 证据与边界

- **POC-01B 通过（有限）**：官方 Chrome for Testing 154.0.8037.57 从独立解压目录运行，127.0.0.1:9333 上 CDP 的版本、目标和进程/Profile 归属均通过，并拒绝错误 Profile、检测已占用端口。证据：https://github.com/devin930906/userscript-auto-healer/actions/runs/39088772310。独立路径并非用户任意便携 Chrome 均兼容。
- **POC-02A 通过（有限）**：隔离 Windows Playwright Chromium 中加载公开 Violentmonkey MV3 2.49.0，真实 Service Worker 注册并进入脚本安装确认页，点击确认。**POC-02B 未通过**：无法证实 .user.js 实际注入与 GM_getValue；不能标记脚本运行成功。证据：https://github.com/devin930906/userscript-auto-healer/actions/runs/39089315021。
- **扩展权限复测（2026-10-18）**：Windows Chromium 独立临时 Profile 中，已实际找到 Violentmonkey 扩展的 `allow-user-scripts` 控件，读取状态从 `before=false` 变为 `after=true`，确认开关可按用户授权启用；仍在确认安装后报告 `INCOMPLETE POC-02B`，没有脚本 DOM 标记或 GM_getValue 成功证据。日志：https://github.com/devin930906/userscript-auto-healer/actions/runs/39090258155。**缺少此开关并非能够单独解释所有失败，根因仍无法确认。**
- **关键权限机制**：Chrome 138 及以后，需要用户在扩展详情页主动打开「Allow User Scripts」，不等于开启 CDP 或安装扩展即可启用。官方：https://developer.chrome.com/docs/extensions/reference/api/userScripts；https://developer.chrome.com/blog/chrome-userscript。该权限缺失可能解释当前注入失败，但**具体根因尚未核实**。必须设计真实扩展授权预检与按版本提示，不得自动绕过用户同意。
- **POC-03A 通过（有限）**：Windows runner 的 Inno Setup 6 实际生成临时文本 .exe 安装程序，完成安装/卸载；未制作真正产品安装版。证据：https://github.com/devin930906/userscript-auto-healer/actions/runs/39089013574。
- **POC-03B 通过（有限）**：RARLab 官方 WinRAR 7.23 评估安装器的 Authenticode 签名有效；实际创建、校验与解压 RAR5，原始与解压文件 SHA-256 一致。证据：https://github.com/devin930906/userscript-auto-healer/actions/runs/39089224242。RAR 官方 EULA（https://www.rarlab.com/license.htm）允许限期评估，**正式长期 CI 使用尚无获授权的创建器/许可证，仍然阻断 Stable**；评估工作流已限制为手动确认资格，不在每次提交运行。
- **剩余真实阻断**：用户目标 Chrome 与油猴管理器矩阵、扩展级权限+真实脚本加载/GM API/业务断言、最终 EXE 和 ZIP 应用包直启/升级与 ZIP 完整性测试、供应链/最低系统基线均需核验。POC-04 未运行。所有技术 PoC 仅处理临时测试资料，无正式产品功能代码。

- **POC-02C 历史失败案例，2026-10-18**：在托管 Windows 上使用同一临时 Profile 启用 Allow User Scripts 后**完整关闭并重新打开浏览器**，已真实调用扩展源中的 `chrome.userScripts.getScripts()`（available=true，registrations=1）；点击原生 Violentmonkey 安装确认后，在扩展本地存储看到了 `scr:1` 与 `code:1`，其中 `config.enabled=1`，`meta.match=["http://127.0.0.1/*"]`，而 `userScripts` 的注册记录 ID 为 `1001`、`matches=["<all_urls>"]`、`allFrames=true`、`runAt=document_start`。但测试页仍未出现脚本执行标记，也未证明 `GM_getValue` 运行，**此轮 POC-02B 未通过，现已被下述标准 HTTPS 场景的真实通过结果部分解除**。真实失败运行：https://github.com/devin930906/userscript-auto-healer/actions/runs/39091275121。以上仅限版本 Violentmonkey 2.49.0 + 隔离 Playwright Chromium（并非用户选择的正式 Chrome），不能据此断言管理器或 API 在所有浏览器失效。已避免自动测试在未达成业务断言时报告 overall success。
- **已排除的简单解释（有范围限制）**：不再把失败直接归咎于“CDP 不可用”“扩展完全未加载”“Allow User Scripts 尚未启用”“脚本没有写入管理器本地存储”或“只因为 Headless 模式”。尚未查明实际页面注入未发生的根因；下一技术路径应检查扩展实际站点权限、注册注入世界、管理器运行日志、脚本依赖/时机与真实桌面 Google Chrome 兼容矩阵，在用户授权的独立 Profile 下复核。

### 2026-10-18 POC-02D 当前有效结论：限定环境的真脚本运行已通过

- **技术实测通过**：GitHub Windows 2025 托管运行器，真实发行版 Violentmonkey MV3 2.49.0、隔离 Playwright Chromium 临时 Profile，确认 Chrome 138+「Allow User Scripts」许可，随后从临时本地 HTTP 服务器点击安装真正的测试 `.user.js`。脚本使用有效 `@match https://example.com/*` 和 `@grant GM_getValue`，在公共保留示例页 `https://example.com/` 上观察到脚本在真实管理器环境执行。并且通过实际调用 `GM_getValue("__poc_fixture_unset__", "poc-default")` 验证返回 `poc-default`（不仅是 `typeof` 检查）。成功运行及日志：https://github.com/devin930906/userscript-auto-healer/actions/runs/39092523277。先前仅检查 GM 函数存在性的首个成功记录：https://github.com/devin930906/userscript-auto-healer/actions/runs/39092415791。
- **重要对照**：同一临时 Chromium 上，Chrome 官方 `chrome.userScripts.register()` 直接注入标记也成功，且扩展 HTTP webRequest 监听能观察到测试页请求。早先 `http://127.0.0.1:<动态端口>/fixture` 场景的脚本曾未执行；改用规范的标准 HTTPS 目标网址后通过。结合 Violentmonkey 公共源码中的 host 匹配与动态注册逻辑，非标准端口差异是有证据的**可能原因**；不能据此对第三方管理器普遍的端口兼容性作最终结论。尝试将临时服务绑定 Windows 80 端口曾得到 `EACCES`，仅说明该 runner 的受限端口不可用（https://github.com/devin930906/userscript-auto-healer/actions/runs/39092300187），不意味着真实油猴管理器不兼容。
- **与正式项目严格区分**：此 PoC 证明了 Windows 云端至少存在一条可工作的“扩展安装→用户授予脚本权限→安装真实 .user.js→网页注入→GM API 读取”的链路；**没有**证明 Tampermonkey、用户任选 Google Chrome/便携 Chrome、登录场景、真实损坏脚本诊断与自动修复、共享兼容层、稳定恢复、真实 EXE/便携 ZIP 可以工作。PoC 成功不等于 TEST-018 或 Stable GATE 已通过。
- **开发前准入续接**：已解除“任何真实管理器都不能运行 GM API”的关键技术疑虑；待确认首选管理器及受支持 Chrome/Windows 范围、实际业务断言样本与条件性 ADR-001，再判定是否可进入 TASK-001。现行 ZIP 格式、文件完整性和干净 Windows 便携启动须作为正式发布硬门槛，不因一次评估通过而自动放行。

### POC-04A：已知失效选择器与人工更正版（限定真实管理器基准）

真实 Windows 2025 runner 的 Violentmonkey MV3 2.49.0 测试矩阵已分别执行两个独立的 `.user.js` 情境：旧定位器 `#poc-obsolete-anchor` 虽然脚本与 GM_getValue 真实执行，但业务结果 `missing-target`；新定位器 `#poc-new-anchor` 同样经真实脚本管理器执行后业务结果为 `recovered` 且目标动作完成。两项实际通过：https://github.com/devin930906/userscript-auto-healer/actions/runs/39093275851；代码路径 `poc/windows-manager-extension.cjs`、`.github/workflows/windows-manager-extension-poc.yml`。这是合成测试中**事先人工准备的两个版本**，不是程序已经自动诊断或修复，不能替代真实用户油猴脚本修复前后的测试。

范围、依赖、正式首期工程基线和开发/发布不同准入门槛，统一归档：docs/13-predevelopment-admission.md。Windows 10/11 实际设备、目标 Tampermonkey、部分便携 Chrome 和真实受登录保护的业务场景仍需后续实际授权验证。

### 2026-10-18 POC-04B：真实 JavaScript AST 解析器验证通过

在 Ubuntu GitHub Actions 的一次性隔离环境中，锁定 `acorn@8.14.0` 并禁用安装脚本，真实解析包含字面 querySelector、常量模板、拼接表达式、嵌套函数以及动态成员方法的测试 JavaScript；按源码行/列、所属函数与静态确定性识别出三处确定值及三处必须运行时确认的未知值。结果：https://github.com/devin930906/userscript-auto-healer/actions/runs/39093951314；代码：`poc/ast-selector-feasibility.cjs`。本 PoC 不执行导入脚本、不生成补丁，不替代后续 TASK-003 的真实 AST 分析器、修复和安全验收；动态与封装计算不能伪称静态确定。

## 2026-10-18 发行格式变更
用户新指令 I-010 将便携发行格式由 RAR 改为 ZIP，现行基线见 ADR-004、REQ-028、TEST-028、TASK-020 与 docs/08-release.md。REF-09/10 和 POC-03B 的 RAR 条款、试用工具及历史结果仅用于追溯旧选型，不再是产品发行阻断。ZIP 工具链 PoC 与正式 ZIP 应用验收须分别取得真实证据，不得借用历史 RAR 通过结果。
