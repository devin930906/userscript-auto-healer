# Userscript Auto Healer

> 状态：开发前工程准备阶段；**没有正式产品功能、没有已验证构建、没有 Stable 发布**。

## 项目用途
针对目标网站 DOM、Selector 和页面运行机制变化导致的 `.user.js` 油猴脚本失效，设计 Windows 本地优先、CDP 诊断、保守自动修复与可验证回滚的工具。用户可指定 Chrome/便携版路径、专用调试 Profile、默认 9223 端口，批量导入脚本，必要时启用自定义 AI 服务。

## 核心功能与支持环境
拟支持静态 AST、真实浏览器动态诊断、脚本管理器环境验证、多级修复、差异/备份/回滚、批处理、健康记录、共享兼容层及受控 AI。目标交付 Windows `.exe` 安装程序与真实 `.zip` 便携发行包；**正式产品开发、真实用户设备兼容、正式应用双包及签名均未验收**；开发前 Chrome/CDP、GM API、AST 和打包工具链 PoC 的通过结果单独列于下方。

## 准备成果与开发入口
见 [docs/00-intake.md](docs/00-intake.md)、[docs/11-readiness.md](docs/11-readiness.md)、[docs/12-handoff.md](docs/12-handoff.md)。需求权威来源为 `docs/00-intake.md` 与 `docs/02-requirements.md`；任务位于 `docs/09-development-plan.md`；架构与发布证据分别在 `docs/04-architecture.md`、`docs/08-release.md`。

## 运行与发布状态
尚无应用入口、安装程序、便携包或正式 Release。不得将本准备文件当作可执行软件。

## 2026-10-18 开发前实测状态

Windows GitHub Actions 已实际验证 Chrome/CDP、真实 Violentmonkey v2.49.0 注入与 `GM_getValue` 调用，及**人工预设**的 `broken`/ `fixed` 选择器业务断言（https://github.com/devin930906/userscript-auto-healer/actions/runs/39093275851）。这并不代表自动修复功能已开发。

- **条件性首期入口**：ADR-001 已将 Electron+TypeScript 选为可修订的安全骨架工程基线，只允许基于 AGENTS.md / docs/09-development-plan.md 开始有证据的 TASK-001 安全实现。
- **尚未完成的前置与发布验收**：用户真实 Tampermonkey/Windows/Chrome 与便携版、用户授权实际失效脚本/业务断言、自动修复和回滚、正式 EXE/ZIP 双包与全部 Stable 门槛。
- 证据矩阵与分阶段准入：`docs/13-predevelopment-admission.md`；最新准入结论：`docs/11-readiness.md`；续接：`docs/12-handoff.md`。

- 开发前 AST PoC 亦已通过：`poc/ast-selector-feasibility.cjs` 使用真实解析器，按源码位置/函数归属区分确定定位器与必须运行时确认的动态表达式；验证 https://github.com/devin930906/userscript-auto-healer/actions/runs/39093951314。此实验不代表程序已实现自动修复。

## 2026-10-18 ZIP 发行格式变更
用户已批准 Windows 正式发行改为 **EXE 安装版 + ZIP 便携版**（I-010 / ADR-004）。REQ-028、TEST-028、TASK-020 及 Stable GATE 已更新；不再依赖 RAR 生产许可证。RAR5 试用 PoC 仅为历史技术研究，不等于已生成或验收 ZIP 产品。目前仍没有正式安装包或便携 ZIP。
