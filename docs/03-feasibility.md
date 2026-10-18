# 技术可行性与技术选型

> 核验日期：2026-10-18。状态：官方文档层面已调研；实际 Chrome、脚本管理器、Windows 构建、RAR 创建尚未执行 PoC。

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
四项均**已规划，未执行**。POC-01/02 阻断对最终架构的无条件确认；POC-03 阻断声称 Windows 双包路径已可执行，但不阻断单纯产品需求分析。
