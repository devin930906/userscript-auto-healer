# 开发前最终准入审查

> 审查日期：2026-10-18；结论：**仅 TASK-001 安全骨架的有条件工程准入**。全范围开发前置、真实设备兼容与 Stable 验收尚未全部完成。参见 docs/13-predevelopment-admission.md。

## 审查范围
仅本仓库 Userscript Auto Healer 的产品与工程准备，核对原始输入、REQ/NFR/ADR/RISK/TEST/TASK/GATE、Windows EXE 与真实 ZIP 的可执行依据（历史 RAR PoC 仅保留证据），不开发核心产品代码。

## 审查项目
| 项目 | 验收条件 | 状态 | 证据位置 | 阻断原因 | 恢复条件 |
|---|---|---|---|---|---|
| Userscript Auto Healer | 项目身份 | 已确认 | docs/00-intake.md、GitHub 仓库 | 无 | 无 |
| Userscript Auto Healer | 原始需求保留 | 已完成 | docs/00-intake.md | 完整逐字复核仍可加强 | 对照会话原文做最终核对 |
| Userscript Auto Healer | 必须需求可验收 | 已完成 | docs/02-requirements.md；docs/07-testing.md | 真实场景输入尚未提供 | 获取坏/好脚本、场景与断言 |
| Userscript Auto Healer | Stable 范围锁定 | 待确认 | docs/01-product.md | GUI 形态、最低系统与扩展矩阵待确认 | 形成有证据的受支持范围 |
| Userscript Auto Healer | 核心技术可行 | 有条件实证 | docs/03-feasibility.md | POC-01A/B CDP、POC-02D 真实 Violentmonkey .user.js 注入及实际 GM_getValue 调用已在限定 Windows Chromium 场景通过；Tampermonkey/目标 Chrome 与真实损坏脚本回归待验证 | Chrome/Profile/CDP 与扩展真实 PoC |
| Userscript Auto Healer | 架构满足需求 | 有条件工程基线 | docs/04-architecture.md；docs/adr/ADR-001-application-baseline.md | Electron+TypeScript 已作为 TASK-001 的有限安全工程基线；实际管理器/Chrome 兼容待验证 | TASK-001 骨架需真实安全测试；其余模块按各自 TEST 核验 |
| Userscript Auto Healer | 安全风险处理 | 受阻 | docs/06-security-risk.md | 只有威胁模型，缺安全负例 | 执行 TEST-007/009/020/026 |
| Userscript Auto Healer | 测试策略完整 | 已完成 | docs/07-testing.md | 无实际测试代码与结果 | 开发后逐项运行并留证 |
| Userscript Auto Healer | Stable 门槛完整 | 已完成 | docs/08-release.md | 无真实发布证据 | 逐项执行 GATE |
| Userscript Auto Healer | Windows EXE 可交付 | 受阻 | docs/03-feasibility.md；docs/08-release.md | 仅 Inno Setup 临时文本安装/卸载通过，产品打包未执行 | 完成 POC-03 与 TEST-027 |
| Userscript Auto Healer | ZIP 便携可交付 | 受阻 | docs/08-release.md；docs/adr/ADR-004-portable-zip.md | 尚无正式应用 ZIP，未执行完整性、安全解压和真实启动验收 | 执行 ZIP PoC（POC-03C）及 TEST-028 |
| Userscript Auto Healer | 任务可执行 | 首项有条件可执行 | docs/09-development-plan.md；docs/13-predevelopment-admission.md | 真实 GM 与合成 broken/fixed PoC 均已通过，但不等于自动修复 | TASK-001 仅做安全骨架与测试，后续管理器/修复仍有独立验证门槛 |
| Userscript Auto Healer | 工程追踪一致 | 待确认 | docs/10-traceability.md | 结构编号检查已通过，但跨文件语义与引用尚未自动全检 | 扩展引用验证并人工复核 |
| Userscript Auto Healer | 云端工程可用 | 待确认 | docs/08-release.md；Actions 既有 PoC | Ubuntu 文档/Windows CDP/Inno 已有限验证；旧 RAR5 为历史 PoC，正式 ZIP 构建、配额和发布权限仍未验证 | Windows EXE+ZIP 构建/发行验证 |
| Userscript Auto Healer | 外部依赖可用合法 | 待确认 | docs/03-feasibility.md；ADR-004 | RAR 生产许可证已不再需要，npm 锁定包和其他依赖许可仍未核验 | 依赖锁定与供应链/许可证审计 |
| Userscript Auto Healer | 下一正式开发起点 | 已确认 | docs/09-development-plan.md；docs/adr/ADR-001-application-baseline.md | 首期技术基线有条件选定且真实扩展/两组合成断言成功 | 可在安全范围内开始 TASK-001；实际管理器覆盖范围和 Stable 另行按门槛验证 |
| Userscript Auto Healer | 正式成果存储 | 已完成 | main 的 docs/ 和 AGENTS.md | 新交接文件提交后的 HEAD 需复核 | 读取 main 确认全部路径 |

## 证据
初始化提交 1205776e91ede1cbb122e699acb7fb7805be23cb；需求研究 32830ad793b48ccfa59bdb03eb97699a00635bee；架构风险 dc79b66671f6c888ce21e55967918414f7ed3ec0；测试及计划 df82a2c50b4cdec2faaae676d0141939b9479664；追踪矩阵 e69fe9e115ecc68d6af42a9c86bd6c07be2e0a2d。发布结论必须再读取 main HEAD。

## 发现问题
BLOCK-01 Windows 托管 Chrome 155 与独立解压 Chrome for Testing 154 CDP/进程归属及部分负例已通过，其他用户便携版待验证；BLOCK-02 的“管理器不具备真实脚本注入/GM API 路线”疑虑已在限定场景解除：真实 Violentmonkey 2.49.0 在标准 HTTPS 示例页面完成 .user.js 注入并实际调用 GM_getValue（Actions run 39092523277）；随机端口的本地示例页曾失败，不能推断为全部管理器不兼容。目标 Tampermonkey 与用户 Chrome、登录网站业务断言及故障修复回归仍未验证；BLOCK-03 历史 RAR5 工具链已完成限期评估但已被 ZIP 决策取代；真实 ZIP 与正式应用便携直启未验证；BLOCK-04 GUI 形态、最低系统/Chrome/管理器支持矩阵、业务测试脚本尚未确认；BLOCK-05 Ubuntu 文档 CI 和 Windows CDP PoC 已成功，但正式 EXE+ZIP 构建、依赖许可证和配额缺证据。

## 修复记录
已按官方 Chrome 136+ 限制规定非默认独立 Profile；将页面 DOM 与真实管理器验收区分；将 AI 答案视为候选并默认阻止静默覆盖；随用户新 I-010/ADR-004 将原 RAR 许可阻断改为 ZIP 内容完整性、路径安全和便携运行阻断；已追踪 REQ-001..028 与对应 TEST。均为准备阶段的设计修复，不是实际软件已修复或风险已通过测试。

## 未解决事项
POC-01A/B 已在 Windows runner 通过限定场景（https://github.com/devin930906/userscript-auto-healer/actions/runs/39082627685；https://github.com/devin930906/userscript-auto-healer/actions/runs/39088772310）；POC-02A 扩展加载与确认已验证，POC-02C 随机端口测试曾失败（https://github.com/devin930906/userscript-auto-healer/actions/runs/39091275121）；POC-02D 的标准 HTTPS 目标已实际通过 .user.js 注入和 GM_getValue 调用（https://github.com/devin930906/userscript-auto-healer/actions/runs/39092523277）；POC-03A Inno 临时 EXE 与 POC-03B 试用真 RAR5 归档测试通过（https://github.com/devin930906/userscript-auto-healer/actions/runs/39089013574；https://github.com/devin930906/userscript-auto-healer/actions/runs/39089224242）。最新文档完整性工作流对关键 Markdown 文件、编号、记录字段宽度和需求测试对应关系已成功（https://github.com/devin930906/userscript-auto-healer/actions/runs/39092836797）；不是产品运行测试。尚无产品源码、真实损坏脚本修复前后回归与选定 Tampermonkey 兼容矩阵、正式 Windows 产品包和长期 RAR 许可实测结果，也没有经过用户选择的应用 LICENSE。

## 准入结果

**有限工程准入：TASK-001 安全骨架的开发前技术准备具备条件。** Chrome/CDP、真实 Violentmonkey 2.49.0 的 `GM_getValue` 调用以及两个独立 `broken/fixed` 已知选择器状态有真实 Windows 实测；后者是提前人工准备的脚本版本，并未开发自动诊断、自动修复或回滚。证据：https://github.com/devin930906/userscript-auto-healer/actions/runs/39093275851。工程架构仅将 Electron+TypeScript 有条件选作首项安全基础（ADR-001）。

**全部开发前置仍未完成**：用户实际目标 Tampermonkey、Windows 10/11、真实 Chrome 便携版、真实失效脚本/登录条件及修复前后业务验证暂无充分证据。没有用户授权的真实环境不得声称已测试，后续 TASK-007、TEST-018、全量实机验收仍受阻。

**Stable 发布门槛尚未达到**：产品源码/单元测试与 28 项 TEST、实际 Electron EXE、正式便携 ZIP 的安全解压与运行、真实安全/兼容/回滚测试与全部 GATE 尚未完成。试验性的 EXE/RAR 工具链不等于可发布产品；发布门槛不是初步安全骨架开发的先决全部条件。

## 准入阻断

首期 `TASK-001` 只能实施最小可信桌面安全入口和失败测试，**不能宣称已经具备油猴脚本修复能力**。管理器兼容、用户实际 Chrome/Profile/脚本、页面业务断言在后续实机验证里补齐；不支持的状态应明确标记 UNKNOWN/DETECTED_ONLY。正式发布需补真实应用双包运行、ZIP 归档和便携验收及全部 Stable GATE。按阶段门控，不再反复把已通过的基础 PoC 写为阻断。

本轮新增的 POC-04A 证据：真实 Violentmonkey `broken` 预设旧定位器的业务失败与 `fixed` 预设新定位器的业务成功均得到独立 Windows CI 验证：https://github.com/devin930906/userscript-auto-healer/actions/runs/39093275851。详细授权、支持矩阵及剩余条件见 docs/13-predevelopment-admission.md。

## AST 可行性补充记录

POC-04B 在 Ubuntu runner 真正执行 Acorn 的静态 JavaScript AST 样本，成功识别三处确定定位器与三处运行时待确认动态/计算调用，记录源码位置与函数归属（https://github.com/devin930906/userscript-auto-healer/actions/runs/39093951314）。结论只用于技术选型，不能作为正式 TASK-003/REQ-011 实现完成或自动修复验收。其余实机 Tampermonkey、真实脚本和正式双包阻断照旧。

## 发行格式更正（2026-10-18，I-010）
用户已改为 EXE 安装版 + ZIP 便携版。原 RAR5 试用 PoC 仍是历史证据，但 RAR 生产许可证不再属于 Stable 阻断。正式 ZIP 格式、内容完整性、路径安全、干净 Windows 解压/直启分别按 TASK-020、TEST-028、GATE-009/011 验证。当前仅 TASK-001 有条件准入不变；本文件历史研发记录不得被解释为仍需 RAR。
