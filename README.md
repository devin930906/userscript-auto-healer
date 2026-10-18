# Userscript Auto Healer

> 状态：（7）正式开发中：TASK-001..006 已有阶段性实现并整合；TASK-007 真 Tampermonkey 产品级验收、TASK-008 完整诊断联动仍在开发中（最新阶段增量见 PR #25/#26）；**没有正式完整自动修复成品、没有经过完整桌面验收的发行构建、没有 Stable 发布**。

## 项目用途
针对目标网站 DOM、Selector 和页面运行机制变化导致的 `.user.js` 油猴脚本失效，设计 Windows 本地优先、CDP 诊断、保守自动修复与可验证回滚的工具。用户可指定 Chrome/便携版路径、专用调试 Profile、默认 9223 端口，批量导入脚本，必要时启用自定义 AI 服务。

## 核心功能与支持环境
拟支持静态 AST、真实浏览器动态诊断、脚本管理器环境验证、多级修复、差异/备份/回滚、批处理、健康记录、共享兼容层及受控 AI。目标交付 Windows `.exe` 安装程序与真实 `.zip` 便携发行包；**正式产品开发、真实用户设备兼容、正式应用双包及签名均未验收**；开发前 Chrome/CDP、GM API、AST 和打包工具链 PoC 的通过结果单独列于下方。

## 准备成果与开发入口
见 [docs/00-intake.md](docs/00-intake.md)、[docs/11-readiness.md](docs/11-readiness.md)、[docs/12-handoff.md](docs/12-handoff.md)。需求权威来源为 `docs/00-intake.md` 与 `docs/02-requirements.md`；任务位于 `docs/09-development-plan.md`；架构与发布证据分别在 `docs/04-architecture.md`、`docs/08-release.md`。

## 运行与发布状态
已有 Electron+TypeScript 开发入口、11 项自动化安全配置测试，并在 Windows runner 完成真实 Electron 桌面启动及受限 IPC 验证（仍非完整功能验收）；尚无安装程序、便携包或正式 Release。不得将开发骨架当作已交付软件。

## 2026-10-18 开发前实测状态

Windows GitHub Actions 已实际验证 Chrome/CDP、真实 Violentmonkey v2.49.0 注入与 `GM_getValue` 调用，及**人工预设**的 `broken`/ `fixed` 选择器业务断言（https://github.com/devin930906/userscript-auto-healer/actions/runs/39093275851）。这并不代表自动修复功能已开发。

- **条件性首期入口**：ADR-001 已将 Electron+TypeScript 选为可修订的安全骨架工程基线，只允许基于 AGENTS.md / docs/09-development-plan.md 开始有证据的 TASK-001 安全实现。
- **尚未完成的前置与发布验收**：用户真实 Tampermonkey/Windows/Chrome 与便携版、用户授权实际失效脚本/业务断言、自动修复和回滚、正式 EXE/ZIP 双包与全部 Stable 门槛。
- 证据矩阵与分阶段准入：`docs/13-predevelopment-admission.md`；最新准入结论：`docs/11-readiness.md`；续接：`docs/12-handoff.md`。

- 开发前 AST PoC 亦已通过：`poc/ast-selector-feasibility.cjs` 使用真实解析器，按源码位置/函数归属区分确定定位器与必须运行时确认的动态表达式；验证 https://github.com/devin930906/userscript-auto-healer/actions/runs/39093951314。此实验不代表程序已实现自动修复。

## 2026-10-18 ZIP 发行格式变更
用户已批准 Windows 正式发行改为 **EXE 安装版 + ZIP 便携版**（I-010 / ADR-004）。REQ-028、TEST-028、TASK-020 及 Stable GATE 已更新；不再依赖 RAR 生产许可证。RAR5 试用 PoC 仅为历史技术研究，不等于已生成或验收 ZIP 产品。目前仍没有正式安装包或便携 ZIP。

- **POC-03C 已通过（限于工具链）**：Windows Actions 使用原生 ZIP 压缩，验证文件头、相对路径、解压及 SHA-256 一致性（https://github.com/devin930906/userscript-auto-healer/actions/runs/39095747797）；仍无正式产品 ZIP、真实运行或 Stable 验收。

- **连接真实浏览器的只读预检**：用户 Chrome 155.0.8059.40、Tampermonkey/篡改猴 5.5.1（MV3）的 userScripts API/权限和注册查询已实际通过；未安装/改动现有油猴脚本，也未验证实际 Tampermonkey GM/业务执行。检查详情见 docs/13-predevelopment-admission.md。

- **POC-02T-LIVE 一次性真实 Tampermonkey 功能实测已通过（2026-10-18）**：在用户连接的 Tampermonkey 5.5.1 中安装独立临时测试脚本，真实 `GM_getValue` 返回预期默认值，预设坏定位器 `missing-target`，人工改为有效定位器后业务动作为 `recovered/done`；脚本随后删除并验证不再注入。这不是 GitHub Actions 云端 POC-02T，也不是软件自动修复或完整 TEST/GATE，通过范围见 [实测记录](docs/evidence/2026-10-18-tampermonkey-live-browser-qa.md)。

## （4）末期准入及（7）直接交接（2026-10-18）

已完成（4）的前期文档一致性审查、有限证据审查与正式交接，结论是**有条件准入 TASK-001**，而非全部产品 TEST/GATE 已通过。下一阶段开始前不需要从零生成文档，直接读取 docs/11-readiness.md、docs/12-handoff.md、docs/09-development-plan.md 和 AGENTS.md；首项实施 Electron+TypeScript 的安全骨架和对应负例。用户原脚本、真实 Profile 与已登录网站保持未授权不修改；GitHub Actions 真 Tampermonkey、完整 Chrome/便携版矩阵、正式 EXE+ZIP 等作为（7）的阶段门槛完成。

## （7）正式开发首项成果（2026-10-18）

TASK-001 安全桌面骨架已提交至 `feat/stable-development`，在 Windows runner 的 [Actions 39100881800](https://github.com/devin930906/userscript-auto-healer/actions/runs/39100881800) 通过完整应用工作流与实际 Electron/preload IPC smoke。此处只证明该隔离开发骨架在 CI 的运行及测试，不代表脚本导入、真正自动修复、用户 Tampermonkey 支持或 EXE/ZIP 发布完成。整合情况见 PR [#1](https://github.com/devin930906/userscript-auto-healer/pull/1)，任务与剩余缺口见 docs/09-development-plan.md。

## （7）TASK-002 合并与继续开发（2026-10-18）

已在 [PR #2](https://github.com/devin930906/userscript-auto-healer/pull/2) 合并只读文件/文件夹/拖放导入、字节哈希校验、编码和路径安全负例、重复识别、批次大小控制。Windows [Actions 39103414900](https://github.com/devin930906/userscript-auto-healer/actions/runs/39103414900) 在源 SHA `f238366` 上通过 Node/真实 Electron 自动化。main 合并提交 `0a8b8ff1033fc99a01cc0c24978c092a016e7c7a`。**不包含自动修复**；用户实机 GUI 交互、真实管理器/Chrome、备份回滚及正式 EXE+ZIP 仍未完整验收。下一任务为 TASK-003 的元数据与 AST 静态分析。

## （7）TASK-003 静态分析入库（2026-10-18）

[TASK-003 PR #3](https://github.com/devin930906/userscript-auto-healer/pull/3) 已合并（main `cc15da038ecf01c4c03001e7165b7698eecab4d5`）；[Windows Actions 39104178253](https://github.com/devin930906/userscript-auto-healer/actions/runs/39104178253) 完成静态元数据/AST 单元和 Electron 安全回归。本阶段不运行导入脚本，不做自动补丁或覆盖；动态 DOM 与 Tampermonkey 实际恢复另行验收。下一开发任务为 TASK-004 场景契约。

## （7）TASK-004 场景契约入库（2026-10-18）

[PR #4](https://github.com/devin930906/userscript-auto-healer/pull/4) 已合并（SHA `dc088797220f9a3d7efa5b1d89dede6ff0ae657c`），Node 30/30 与 Windows 真 Electron smoke 在 [Actions 39104629620](https://github.com/devin930906/userscript-auto-healer/actions/runs/39104629620) 全部通过。项目已具备只读导入、静态元数据/AST 与业务测试场景登记基础，**尚不具备自动修复/验证完成的能力**；下一项 TASK-005 为独立 Chrome/Profile/CDP 安全启动。
