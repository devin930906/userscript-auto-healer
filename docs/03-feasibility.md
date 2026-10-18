# 技术可行性与技术选型

> 核验日期：2026-10-18。状态：已进行多项真实 Windows 云端技术 PoC；正式油猴管理器脚本注入/GM API、完整用户环境与商业 RAR 授权仍有阻断。

## 技术候选
A: Electron + TypeScript/Node（统一 GUI、AST、CDP、Windows 安装器）；B: .NET 桌面 UI + Node/JS 分析器（Windows 原生集成但双语言接口成本较高）；C: Python + 桌面 UI（AST JS/打包与浏览器管理增加异构依赖）。需求满足：A 高、B 高、C 中；兼容性：均须验证真实 Chrome；复杂度：A 中、B 高、C 中高；安全性：均需主动设计隔离；维护：A 统一 TS 优、B 双运行时负担；云端构建：A/B/C 理论可行未实证；许可成本：RAR 均有授权依赖；主要风险：A 的 Electron 安全默认配置、扩展自动化验证与产物体积。

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
Electron、TypeScript、AST 解析器、差异补丁依赖及实际锁定版本的许可证仍须在落地选型时逐项登记；未核验具体包版本，勿标记已批准。RAR/WinRAR 创建工具有使用许可约束（REF-09）；打包时不能假设 runner 自带受许可工具。

## 方案比较
优先提出 Electron/Node+TypeScript 作为**待批准的基线方案**，不是对已证实架构的冒充；理由是 JS AST 与 CDP/桌面打包技术栈一致。替代 B 在本地 Windows 集成上较直接但跨语言成本较高；C 更轻量但跨语言 JS 分析/可重复打包风险更大。未来若 GUI 或目标环境要求否定 A，应在 ADR 中记录变更而非强行执行。

## 关键风险
RISK-001 / RISK-002：Chrome/Profile 安全；RISK-003：管理器不可重复自动装载；RISK-004：RAR 合法工具供应；RISK-005：误把网页定位测试当用户脚本验收；RISK-006：不可信代码与凭据泄露。详见 06。

## 选型结论
ADR-001：条件性技术基线 Electron+TypeScript + CDP + AST（核心设计仍待 PoC 放行）。ADR-002：真实管理器测试分层。ADR-003：双 Windows 发行包和 RAR 授权。用户需求未授权的 GUI 细节不得自动上升为不可逆决定。

## PoC 状态
- POC-01（开发前关键）：Windows 用户指定 Chrome 可执行路径 / 自有非默认 Profile / `--remote-debugging-port=9223` / 回环绑定；验证 /json/version 与目标归属；失败则重新评估连接方案。
- POC-02（开发前关键）：用户授权的真实 Chrome+目标油猴管理器，在测试 Profile 导入测试脚本、确认 @match/@grant/@run-at/GM API、真实执行/回归；无法自动装载则固定受支持的初始化/人工授权步骤。
- POC-03（发布链关键）：Windows Actions runner 用有合法授权的 rar.exe 创建、RAR 校验、解压及 EXE 安装；许可证供应、安装权限和工件保持待核实。
- POC-04（开发早期）：AST 解析静态/动态/函数封装与源码位置、脚本沙箱隔离的验证。
POC-01 **部分已执行并通过**：2026-10-18 Windows GitHub runner windows-2025 中，Chrome/155.0.8059.40（C:\Program Files\Google\Chrome\Application\chrome.exe）使用临时非默认 Profile、127.0.0.1:9223 成功启动，/json/version 握手、WebSocket 浏览器端点、监听进程可执行文件/命令行 Profile 归属及 /json/list（1 个目标）均通过；证据：https://github.com/devin930906/userscript-auto-healer/actions/runs/39082627685。**仅验证托管运行器内的 Chrome 实例，不代表用户任选便携 Chrome、Profile 迁移、错误场景或油猴管理器成功。** POC-02A、POC-03A、POC-03B 已进行了部分实证，详见下面新增记录；POC-02B 真脚本运行仍未通过，POC-04 未执行。核心用户脚本兼容性仍阻断无条件架构确认；RAR 长期生产许可、真实应用打包及 GM 脚本行为验收仍阻断 Stable。

### 2026-10-18 新增真实 PoC 证据与边界

- **POC-01B 通过（有限）**：官方 Chrome for Testing 154.0.8037.57 从独立解压目录运行，127.0.0.1:9333 上 CDP 的版本、目标和进程/Profile 归属均通过，并拒绝错误 Profile、检测已占用端口。证据：https://github.com/devin930906/userscript-auto-healer/actions/runs/39088772310。独立路径并非用户任意便携 Chrome 均兼容。
- **POC-02A 通过（有限）**：隔离 Windows Playwright Chromium 中加载公开 Violentmonkey MV3 2.49.0，真实 Service Worker 注册并进入脚本安装确认页，点击确认。**POC-02B 未通过**：无法证实 .user.js 实际注入与 GM_getValue；不能标记脚本运行成功。证据：https://github.com/devin930906/userscript-auto-healer/actions/runs/39089315021。
- **关键权限机制**：Chrome 138 及以后，需要用户在扩展详情页主动打开「Allow User Scripts」，不等于开启 CDP 或安装扩展即可启用。官方：https://developer.chrome.com/docs/extensions/reference/api/userScripts；https://developer.chrome.com/blog/chrome-userscript。该权限缺失可能解释当前注入失败，但**具体根因尚未核实**。必须设计真实扩展授权预检与按版本提示，不得自动绕过用户同意。
- **POC-03A 通过（有限）**：Windows runner 的 Inno Setup 6 实际生成临时文本 .exe 安装程序，完成安装/卸载；未制作真正产品安装版。证据：https://github.com/devin930906/userscript-auto-healer/actions/runs/39089013574。
- **POC-03B 通过（有限）**：RARLab 官方 WinRAR 7.23 评估安装器的 Authenticode 签名有效；实际创建、校验与解压 RAR5，原始与解压文件 SHA-256 一致。证据：https://github.com/devin930906/userscript-auto-healer/actions/runs/39089224242。RAR 官方 EULA（https://www.rarlab.com/license.htm）允许限期评估，**正式长期 CI 使用尚无获授权的创建器/许可证，仍然阻断 Stable**；评估工作流已限制为手动确认资格，不在每次提交运行。
- **剩余真实阻断**：用户目标 Chrome 与油猴管理器矩阵、扩展级权限+真实脚本加载/GM API/业务断言、最终 EXE 和 RAR 应用包直启/升级测试、生产 RAR 许可、供应链/最低系统基线均需核验。POC-04 未运行。所有技术 PoC 仅处理临时测试资料，无正式产品功能代码。
