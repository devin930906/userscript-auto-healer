# 开发前最终准入审查

> 审查日期：2026-10-18；**（4）期末交叉审查与交接完成；开发准入判定为「有条件准入」**，仅允许（7）从 TASK-001 安全骨架开始。全部产品兼容、真实脚本修复及 Stable GATE 均未验收。参见 docs/13-predevelopment-admission.md、docs/12-handoff.md。

## 审查范围
仅本仓库 Userscript Auto Healer 的产品与工程准备，核对原始输入、REQ/NFR/ADR/RISK/TEST/TASK/GATE、Windows EXE 与真实 ZIP 的可执行依据（历史 RAR PoC 仅保留证据），不开发核心产品代码。

## 审查项目
| 项目 | 验收条件 | 状态 | 证据位置 | 阻断原因 | 恢复条件 |
|---|---|---|---|---|---|
| Userscript Auto Healer | 项目身份 | 已确认 | docs/00-intake.md、GitHub 仓库 | 无 | 无 |
| Userscript Auto Healer | 原始需求保留 | 已完成 | docs/00-intake.md | 完整逐字复核仍可加强 | 对照会话原文做最终核对 |
| Userscript Auto Healer | 必须需求可验收 | 已完成 | docs/02-requirements.md；docs/07-testing.md | 真实场景输入尚未提供 | 获取坏/好脚本、场景与断言 |
| Userscript Auto Healer | Stable 范围锁定 | 有条件准入 | docs/01-product.md；docs/adr/ADR-001-application-baseline.md；ADR-004/005 | 必须功能、Tampermonkey 首选与 EXE+ZIP 已定；Windows/Chrome 最低支持版本及管理器兼容细分待后续真实测试 | 不改变原需求，在 TASK-005/007/018 明确可声明的兼容矩阵 |
| Userscript Auto Healer | 核心技术可行 | 有条件实证 | docs/03-feasibility.md；docs/evidence/2026-10-18-tampermonkey-live-browser-qa.md | Chrome/CDP 与 Violentmonkey PoC 分别已有限通过，用户 Chrome+真实 Tampermonkey 5.5.1 也已实测一次性 .user.js/GM_getValue/人工 broken/fixed；产品自动修复、独立云端 Tampermonkey 未通过 | TASK-005/007/018 完成隔离 Profile/扩展云端兼容、真实坏脚本及产品业务断言 |
| Userscript Auto Healer | 架构满足需求 | 有条件工程基线 | docs/04-architecture.md；docs/adr/ADR-001-application-baseline.md | Electron+TypeScript 已作为 TASK-001 的有限安全工程基线；实际管理器/Chrome 兼容待验证 | TASK-001 骨架需真实安全测试；其余模块按各自 TEST 核验 |
| Userscript Auto Healer | 安全风险处理 | 有条件准入（设计受控） | docs/06-security-risk.md；docs/adr/ADR-001-application-baseline.md | 信任边界、拒绝策略、Profile 保护和备份回滚规则已设计；尚无产品可执行的安全负例 | 在 TASK-001 开始实现安全骨架及负例，后续 TEST-007/009/020/026 仍阻断产品安全验收 |
| Userscript Auto Healer | 测试策略完整 | 已完成 | docs/07-testing.md | 无实际测试代码与结果 | 开发后逐项运行并留证 |
| Userscript Auto Healer | Stable 门槛完整 | 已完成 | docs/08-release.md | 无真实发布证据 | 逐项执行 GATE |
| Userscript Auto Healer | Windows EXE 可交付 | 受阻 | docs/03-feasibility.md；docs/08-release.md | 仅 Inno Setup 临时文本安装/卸载通过，产品打包未执行 | 完成 POC-03 与 TEST-027 |
| Userscript Auto Healer | ZIP 便携可交付 | 受阻 | docs/08-release.md；docs/adr/ADR-004-portable-zip.md | POC-03C 原生 ZIP 工具链已通过，但正式应用 ZIP、完整性与干净 Windows 直启验收未执行 | 完成 TASK-020 与 TEST-028 |
| Userscript Auto Healer | 任务可执行 | 首项有条件可执行 | docs/09-development-plan.md；docs/13-predevelopment-admission.md | 真实 GM 与合成 broken/fixed PoC 均已通过，但不等于自动修复 | TASK-001 仅做安全骨架与测试，后续管理器/修复仍有独立验证门槛 |
| Userscript Auto Healer | 工程追踪一致 | 有条件完成（前期范围） | docs/10-traceability.md；.github/scripts/verify-predevelopment.py | REQ/TEST/TASK/GATE 的编号与映射已自动检查，本次复核纠正当前 Tampermonkey、EXE+ZIP 和阶段准入的过期表述；未来改需求须同步更新 | 继续用文档 CI 防回归，实际产品功能仍按对应 TEST/GATE 验收 |
| Userscript Auto Healer | 云端工程可用 | 有条件实证 | docs/08-release.md；Windows POC-01/03C；文档 CI | Windows CDP、临时 Inno Setup 与真实 ZIP 工具链 PoC 已通过；正式产品 EXE/ZIP、配额及发布权限未验证 | TASK-019..021 完成真实应用构建/打包与发布门槛 |
| Userscript Auto Healer | 外部依赖可用合法 | 待确认 | docs/03-feasibility.md；ADR-004 | RAR 生产许可证已不再需要，npm 锁定包和其他依赖许可仍未核验 | 依赖锁定与供应链/许可证审计 |
| Userscript Auto Healer | 下一正式开发起点 | 已确认 | docs/09-development-plan.md；docs/adr/ADR-001-application-baseline.md | 首期技术基线有条件选定且真实扩展/两组合成断言成功 | 可在安全范围内开始 TASK-001；实际管理器覆盖范围和 Stable 另行按门槛验证 |
| Userscript Auto Healer | 正式成果存储 | 已完成 | main 的 docs/ 和 AGENTS.md | 新交接文件提交后的 HEAD 需复核 | 读取 main 确认全部路径 |

## 证据
初始化提交 1205776e91ede1cbb122e699acb7fb7805be23cb；需求研究 32830ad793b48ccfa59bdb03eb97699a00635bee；架构风险 dc79b66671f6c888ce21e55967918414f7ed3ec0；测试及计划 df82a2c50b4cdec2faaae676d0141939b9479664；追踪矩阵 e69fe9e115ecc68d6af42a9c86bd6c07be2e0a2d。发布结论必须再读取 main HEAD。

## 发现问题
BLOCK-01 Windows 托管 Chrome 155 与独立解压 Chrome for Testing 154 CDP/进程归属及部分负例已通过，其他用户便携版待验证；BLOCK-02 的“管理器不具备真实脚本注入/GM API 路线”疑虑已在限定场景解除：真实 Violentmonkey 2.49.0 在标准 HTTPS 示例页面完成 .user.js 注入并实际调用 GM_getValue（Actions run 39092523277）；随机端口的本地示例页曾失败，不能推断为全部管理器不兼容。用户现有 Chrome+Tampermonkey 的一次性 GM/人工业务 PoC 已有受限实证（docs/evidence/2026-10-18-tampermonkey-live-browser-qa.md），但云端专项 Tampermonkey、已登录网站和**产品自动修复前后**业务回归仍未验证；BLOCK-03 历史 RAR5 工具链已完成限期评估但已被 ZIP 决策取代；真实 ZIP 与正式应用便携直启未验证；BLOCK-04 GUI 形态、最低系统/Chrome/管理器支持矩阵、业务测试脚本尚未确认；BLOCK-05 Ubuntu 文档 CI 和 Windows CDP PoC 已成功，但正式 EXE+ZIP 构建、依赖许可证和配额缺证据。

## 修复记录
已按官方 Chrome 136+ 限制规定非默认独立 Profile；将页面 DOM 与真实管理器验收区分；将 AI 答案视为候选并默认阻止静默覆盖；随用户新 I-010/ADR-004 将原 RAR 许可阻断改为 ZIP 内容完整性、路径安全和便携运行阻断；已追踪 REQ-001..028 与对应 TEST。均为准备阶段的设计修复，不是实际软件已修复或风险已通过测试。

## 未解决事项
POC-01A/B 已在 Windows runner 通过限定场景（https://github.com/devin930906/userscript-auto-healer/actions/runs/39082627685；https://github.com/devin930906/userscript-auto-healer/actions/runs/39088772310）；POC-02A 扩展加载与确认已验证，POC-02C 随机端口测试曾失败（https://github.com/devin930906/userscript-auto-healer/actions/runs/39091275121）；POC-02D 的标准 HTTPS 目标已实际通过 .user.js 注入和 GM_getValue 调用（https://github.com/devin930906/userscript-auto-healer/actions/runs/39092523277）；POC-03A Inno 临时 EXE 与 POC-03B 试用真 RAR5 归档测试通过（https://github.com/devin930906/userscript-auto-healer/actions/runs/39089013574；https://github.com/devin930906/userscript-auto-healer/actions/runs/39089224242）。最新文档完整性工作流对关键 Markdown 文件、编号、记录字段宽度和需求测试对应关系已成功（https://github.com/devin930906/userscript-auto-healer/actions/runs/39092836797）；不是产品运行测试。尚无产品源码、真实损坏脚本自动修复及回滚、正式产品在 Tampermonkey 中的 GM/业务验收、正式 Windows EXE+ZIP 应用双包，也没有经用户确定的应用 LICENSE；**仅用户现有 Tampermonkey 5.5.1 的临时脚本 GM/人工业务验证有受限实证**。旧 RAR 创建器已退出现行发布范围，不再要求其生产许可证。

## 准入结果

**有限工程准入：TASK-001 安全骨架的开发前技术准备具备条件。** Chrome/CDP、真实 Violentmonkey 2.49.0 的 `GM_getValue` 调用以及两个独立 `broken/fixed` 已知选择器状态有真实 Windows 实测；后者是提前人工准备的脚本版本，并未开发自动诊断、自动修复或回滚。证据：https://github.com/devin930906/userscript-auto-healer/actions/runs/39093275851。工程架构仅将 Electron+TypeScript 有条件选作首项安全基础（ADR-001）。

**全部开发前置仍未完成**：用户连接的真实 Chrome 155 和 Tampermonkey 5.5.1 已完成只读身份/API/权限预检，但 Windows 10/11 精确系统版本、真实 Chrome.exe/便携路径、CDP 端口/Profile 归属、Tampermonkey 的**一次性测试脚本 GM/人工 broken/fixed** 已有后续限定实证（见本文件末尾）；真实用户失效脚本、管理器适配器、复杂登录场景、正式自动修复/回滚与完整兼容性仍无充分证据。没有用户授权的真实环境不得声称已测试，后续 TASK-007、TEST-018、全量实机验收仍受阻。

**Stable 发布门槛尚未达到**：产品源码/单元测试与 28 项 TEST、实际 Electron EXE、正式便携 ZIP 的安全解压与运行、真实安全/兼容/回滚测试与全部 GATE 尚未完成。试验性的 EXE/RAR 工具链不等于可发布产品；发布门槛不是初步安全骨架开发的先决全部条件。

## 准入阻断

首期 `TASK-001` 只能实施最小可信桌面安全入口和失败测试，**不能宣称已经具备油猴脚本修复能力**。管理器兼容、用户实际 Chrome/Profile/脚本、页面业务断言在后续实机验证里补齐；不支持的状态应明确标记 UNKNOWN/DETECTED_ONLY。正式发布需补真实应用双包运行、ZIP 归档和便携验收及全部 Stable GATE。按阶段门控，不再反复把已通过的基础 PoC 写为阻断。

本轮新增的 POC-04A 证据：真实 Violentmonkey `broken` 预设旧定位器的业务失败与 `fixed` 预设新定位器的业务成功均得到独立 Windows CI 验证：https://github.com/devin930906/userscript-auto-healer/actions/runs/39093275851。详细授权、支持矩阵及剩余条件见 docs/13-predevelopment-admission.md。

## AST 可行性补充记录

POC-04B 在 Ubuntu runner 真正执行 Acorn 的静态 JavaScript AST 样本，成功识别三处确定定位器与三处运行时待确认动态/计算调用，记录源码位置与函数归属（https://github.com/devin930906/userscript-auto-healer/actions/runs/39093951314）。结论只用于技术选型，不能作为正式 TASK-003/REQ-011 实现完成或自动修复验收。其余实机 Tampermonkey、真实脚本和正式双包阻断照旧。

## 发行格式更正（2026-10-18，I-010）
用户已改为 EXE 安装版 + ZIP 便携版。原 RAR5 试用 PoC 仍是历史证据，但 RAR 生产许可证不再属于 Stable 阻断。正式 ZIP 格式、内容完整性、路径安全、干净 Windows 解压/直启分别按 TASK-020、TEST-028、GATE-009/011 验证。当前仅 TASK-001 有条件准入不变；本文件历史研发记录不得被解释为仍需 RAR。

## POC-03C 工具链验收补充
Windows Actions https://github.com/devin930906/userscript-auto-healer/actions/runs/39095747797 已成功通过临时原生 ZIP 创建、PK 文件头、安全单一相对路径、解压与 SHA-256 一致性检查。结论仅解除“标准云端运行器能否制作普通 ZIP”的工具链疑虑，**不解除正式产品 ZIP 的 TEST-028 / GATE-009/011 阻断**。

## 用户连接的真实浏览器核验增量（2026-10-18）

Chrome Browser MCP 实际读取用户已连接 Windows x64 Chrome **155.0.8059.40**，并在真实 `Tampermonkey/篡改猴` **5.5.1（MV3）** Extension Service Worker 中只读调用 `chrome.userScripts.getScripts()` 成功（2 条 API 注册，非脚本数量）；`chrome.permissions.getAll()` 含 `userScripts`，测试用途的 `https://example.com/*` 和 `http://127.0.0.1/*` 原点均获权限。没有读取用户脚本或其持久化资料，亦没有安装/改写/删除脚本。当前会话插件回传为原始证据；详细范围见 docs/13-predevelopment-admission.md。

**严守阶段范围**：上文较早的只读阶段仅可标记 `TampermonkeyPresenceAndPermission = CHECKED`；后续 POC-02T-LIVE 已获得指定临时脚本的有限 GM/人工业务实证，但**不能**把完整产品 `TampermonkeyInjection/GM/Business = VERIFIED`；亦不能证明用户 Chrome.exe、9223 端口、自管调试 Profile 或修复逻辑通过。现行 EXE+ZIP，POC-03C Windows ZIP 工具链已实测通过（https://github.com/devin930906/userscript-auto-healer/actions/runs/39095747797），正式 ZIP 应用包仍未制作。

## POC-02T-LIVE — 真 Tampermonkey 运行时补充（2026-10-18）
用户连接的真实 Tampermonkey 5.5.1 经 Chrome Browser MCP 已完成**新增**限定实测：专名临时 `.user.js` 在 `https://example.net/` 注入，`GM_getValue` 返回 `gm-default-ok`，预设无效旧 selector 时 `missing-target/none`，人工改成 `p` 后 `recovered/done` 且目标节点确有动作标记；删掉专名临时脚本和回收站副本后，重新载入无脚本标记/动作。见 docs/evidence/2026-10-18-tampermonkey-live-browser-qa.md。该结果可以证明**当前浏览器上的指定 GM 和业务动作**，不等于 GitHub Actions 云端 POC-02T、正式 TASK-007/TEST-017/018、真实失效脚本的自动修复/回滚，或 GATE-004/005。先前只读预检的 `GM/Business 未验证` 是早前阶段快照，已由本次**有限**功能 PoC 补充；未支持/未测环境仍受阻。TASK-001 有条件准入不变。

## （4）最终三项收口审查（2026-10-18）

| 收口事项 | 状态 | 已执行的核对与证据 | （7）仍需处理但不阻止 TASK-001 的条件 |
|---|---|---|---|
| 文档一致性复核 | 已完成（开发前范围） | 复核需求 REQ-001..028、TEST-001..028、TASK-001..021、GATE-001..011、ADR-001..005；统一 Tampermonkey POC-02T-LIVE 的**限定成功**和 POC-02T 云端未执行；开发计划 M4 更正为 EXE+ZIP；执行 .github/scripts/verify-predevelopment.py 和文档 CI | 后续实际代码和功能变化仍须同步维护规格与测试矩阵 |
| 准入结论确认 | **有条件准入** | 真实 Chrome/CDP、管理器真脚本/GM、人工失败/恢复测试、AST、Windows Inno/ZIP 工具链具有限定可行性证据；仍无正式产品代码或完整 TEST | TASK-005/007/018/019..021 按真实设备、权限、兼容性、安全与 Stable 发布门槛分别验收 |
| （7）交接资料整理 | 已完成（提交后复核） | AGENTS.md、docs/09-development-plan.md、docs/12-handoff.md、docs/13-predevelopment-admission.md 指向 TASK-001；GitHub main 保存、无须重做（4） | 从最新 main/PR/CI 恢复，只在确认的任务边界开发，未取得实测证据不可标通过 |

**准入原则**：本阶段技术依据与有限安全设计足以开始 TASK-001，不代表全部（4）潜在真实环境条件在现在已实现；非阻断的未来验收必须按分配的 TASK/TEST/GATE 执行，不得借“开发前尚有实测”无限延长（4）。**（4）阶段停止条件已达到：有条件准入并完成交接，下一步由用户明确启动（7）**。不自动开发或发布软件。
