# 开发前最终准入审查

> **2026-11-22 准入审查快照（优先于下列更早的历史记录）**：本轮文档修订前的主干基准为 `main@1fcd1480d135a12ef5c766115465999bb444514f`。准备 PR [#926](https://github.com/devin930906/userscript-auto-healer/pull/926) 已合并为 `28efdb591969b30ac4d963f0fbe6b634dee863f3`；PR [#927](https://github.com/devin930906/userscript-auto-healer/pull/927) 也已合并；其合并提交即上述本轮文档修订前的主干基准。文末“#926 仍未合并”是合并前的时间性记录，不是当前阻断。无需重建文档或从 TASK-001 重启。
>
> **当前产品实施与依赖**：开放中的 PR [#925](https://github.com/devin930906/userscript-auto-healer/pull/925) HEAD `4babea4f1e49cc799beb72b9013d4e158d185962` 尚未合并，现有实现包括分批导入、只读诊断及受控的手动候选导出，但不等同自动修复与真实 Tampermonkey/业务功能验收。当前开放的对应 Issue 为 [#857](https://github.com/devin930906/userscript-auto-healer/issues/857)（TASK-013）、[#486](https://github.com/devin930906/userscript-auto-healer/issues/486)（TASK-007）、[#510](https://github.com/devin930906/userscript-auto-healer/issues/510)（TASK-005）和 [#610](https://github.com/devin930906/userscript-auto-healer/issues/610)（TASK-021）；按既有依赖和准入条件继续推进。旧版 `docs/12-handoff.md` 顶部的 2026-11-19 “最新”是历史快照，且 PR #925 正在修改该共享文件，必须在合法集成时核对最新内容，不从准备分支覆盖它。
>
> **本轮质量证据边界**：PR #925 HEAD 的31项 GitHub PR checks 为29项成功、2项跳过，不能替代其 PR 描述记录的全量 `npm test` 失败情况，也不能替代真实产品级验收。2026-11-22 GitHub 安全接口核验显示 Dependabot alerts 未启用（403）及 Code Scanning 没有分析结果（404）；Secret Scanning 开放告警查询为空不等于已经证明全面无风险。验证范围、启用条件及处理方式已作为既有 TASK-021 的交接证据写在 [#610 评论](https://github.com/devin930906/userscript-auto-healer/issues/610#issuecomment-7080025505)。**本次仍为有条件准入；所有 Stable GATE 与最终真实环境验收须独立签核。**

> **2026-11-02 有效范围校正**：下方历史有条件准入及当时旧 Issue 认领受阻结论均按原发生时间保留；新版（4）/（7）已取消 Issue 独占锁，旧交接不能阻止已授权且满足其他依赖的产品开发。正式 TEST/GATE 仍须独立验证；见 `docs/19-stable-v7-migration.md`。


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

## （7）已发生的工程进展（不改写（4）历史准入结论）

在（4）的 TASK-001 有条件准入基础上，后续（7）已经实际提交并合并首项安全桌面骨架：PR [#1](https://github.com/devin930906/userscript-auto-healer/pull/1)，main 合并 SHA `083de9db209d00b52183794687f0bb97d04e1e8d`。TASK-001 不需要重做；按 docs/09-development-plan.md 的任务依赖继续安全且不依赖未决真实管理器条件的 TASK-002。先前（4）文档中“尚无正式产品源码”等描述是其历史截面，不得当成目前代码不存在。此项不会将原先“有条件准入”升级为“无条件准入”，也不解除 Tampermonkey/实机/正式 EXE+ZIP 的后续 GATE。

## 2026-11-01：开发执行机制增量准入（不覆盖历史有条件准入）

原（4）准备和当前正式产品开发进度均不重启。首次服务端 Git 引用创建互斥已有真实竞争实证；但新版（4）/（7）额外要求的同一 Issue **安全释放、重新认领、陈旧执行者写入/合并隔离**，尚未对生产 Issue 完成验证。八个开放 Issue 均有旧固定认领/工作分支，须逐项核验历史提交、PR、原归属退出和可安全接管条件；在此之前不得因为历史 PR 已合并就抢占。同仓库互不冲突的治理工作可以继续；不宣称 Stable GATE 已通过。见 `docs/16-cross-session-issue-claims.md` 和 `docs/12-handoff.md`。


## 2026-11-02 新版（4）/（7）无独占认领迁移（现行续接依据）

- PR [#602](https://github.com/devin930906/userscript-auto-healer/pull/602) 合并提交 `617fd3879f7a33ff3a5311868c1164b4e6dfb6fb`，经 Documentation Integrity 和 Required PR Fence 成功验证。此 SHA 只是当时迁移基准，不保证永远是当前 main。
- 新指令取消 Issue 独占锁、创建认领分支、持有者签名轮次和 `HANDOFF_BLOCKED` 开发门槛。旧相关记录仍保留历史与安全证据，不能再阻止符合批准范围、依赖和 PR 规则的独立产品开发。
- 保留原始 REQ/NFR/ADR/RISK/TEST/GATE、TASK-001..021、已经合并的产品代码、PR 与 CI；（4）历史有条件准入不重跑，旧产品阶段不重做。并行工作必须以最新 main SHA、实际文件/接口冲突、分支隔离、PR Required Checks 及合并后回归为依据。
- 新建立已批准 TASK 的分类 Issue 映射：TASK-012→#603；TASK-014→#604；TASK-015→#605；TASK-016→#606；TASK-017→#607；TASK-018→#608；TASK-019→#609；TASK-021→#610。原有 #215/#440/#480/#486/#487/#488/#489/#510 保留，不因建立新 Issue 就认为相关功能已通过。
- 当前仍有真实 Tampermonkey 产品业务、可信自动应用与原子回滚、间歇性 Windows 故障、正式 EXE+ZIP、最终人工验收与全部 GATE 的证据缺口；不得把治理修复当作 Stable 验收。
- 现行执行依据：`AGENTS.md` 2026-11-02 小节及 `docs/19-stable-v7-migration.md`；每次均重新读取远端 GitHub 状态。

## 2026-11-22 增量准备审计（不替换历史准入记录）

> 证据基准：本轮远端 `main@146f9a987e7e633496d723e7f517c68282e1fe07`；该时间点的仓库树、GitHub Issues/PR 与既有正式文档。以下是开发前工程依据及当前续接可用性审计，不是新一轮功能开发、全量代码审查或当前 SHA 的产品测试通过声明。

### 仓库与路线

- 项目身份：`devin930906/userscript-auto-healer`，公开非归档，默认 `main`。已读取已有 `README.md`、`AGENTS.md` 和 `docs/00-intake.md` 至 `docs/12-handoff.md`，以及 `docs/14-stable-work-register.md`。既有 REQ-001..028、TASK-001..021、TEST-001..028、GATE-001..011 继续作为唯一编号体系；不重新编号、重复建立 Issues 或更改产品范围。
- 当前 Open Issues（GitHub Issues 列表，2026-11-22）：[#857](https://github.com/devin930906/userscript-auto-healer/issues/857)（TASK-013 批量端到端闭环）、[#610](https://github.com/devin930906/userscript-auto-healer/issues/610)（TASK-021 Stable 准入/双发行）、[#510](https://github.com/devin930906/userscript-auto-healer/issues/510)（Chrome CDP 偶发启动故障）、[#486](https://github.com/devin930906/userscript-auto-healer/issues/486)（真实 Tampermonkey 业务验证），共 4 项。旧交接文件中“14 个 Open Issues”只可视作当时快照，不是本轮实时数量。
- 当前开放 PR：[#925](https://github.com/devin930906/userscript-auto-healer/pull/925)（TASK-013，`feat/task013-dropped-batch-20261119`，核验 head `4babea4f1e49cc799beb72b9013d4e158d185962`），尚未合并；其测试/修复证据只对精确 SHA 有效。不得将 #925 的导入、只读 DOM 观察和候选导出视为完整自动修复、Tampermonkey 真实安装注入及业务验收已通过。
- 已存在 Electron/TypeScript 桌面源码、GitHub Actions、Windows Candidate 构建工作流、界面设计及测试/发布规格，属于增量审计对象，而非重新从零初始化的空仓库。本轮未触发 Actions、未运行 Windows、未执行 GUI、未取得最终用户验收。

### 工程设计和准入差距

- 产品必须按原始需求支持：指定 Chrome/Chrome++ EXE 与授权 Data/Profile、可配置回环 CDP 端口（默认 9896）、真实 Tampermonkey/脚本安装和验证、AST+动态诊断、逐脚本自动化修复与可信验收、备份回滚、监控、兼容层、可选 AI 双协议、Windows EXE 安装版与真正可直接使用的 ZIP 便携版。尚不具备证据将这些整条链路认定为 Stable 已完成。
- 官方技术约束：Chrome 136 起常规 Chrome 的远程调试须遵循非默认用户数据目录要求（https://developer.chrome.com/blog/remote-debugging-port）；Chrome 138 起用户脚本功能由扩展级 Allow User Scripts 开关管理（https://developer.chrome.com/blog/chrome-userscript）。必须使用对应实际 Chrome/Chrome++ 版本和获授权 Profile 测试，不得绕过用户或浏览器权限。
- 开放 Issue #857 与 PR #925 是当前首要的在制产品链路；继续前先核对 PR 实际 diff、精确 head SHA、最新 checks、依赖与已经合并的子范围，不重复开发同一功能。#486 与 #510 的真实环境不确定性及 #610 的全部 Stable 门槛是保留的准入限制。
- 当前仓库仍有历史 Issue claim/round coordination 文件及工作流。应以 `AGENTS.md` 和 `docs/19-stable-v7-migration.md` 的已批准无独占认领政策为目标，另行核实旧工作流是否实质阻断合法 PR；不要仅凭文件存在判定其正在阻断，也不得未检验即删除历史治理配置。
- UI 以 `docs/05-experience.md` 和现有 Electron renderer/preload/main 为依据，准备阶段只允许静态设计检查；自动化脚本端到端、真实渲染、Windows 安装与最终人工体验不得混作已通过证据。
- Stable 仍须通过当前源提交的持续机器测试、可信真实 Tampermonkey/Chrome 验收、原件保护/可恢复回滚、同源 EXE+ZIP 构建验证以及最后一次集中 Windows 人工验收，不得以历史 Candidate 或先前某个 SHA 的 CI 结果替代。

### 本次准备阶段结果

- **有条件准入（继续既有正式开发，而非重启准备）**：工程文件体系和 Issues 实施入口已经存在，现阶段可以在已确认的模块边界内继续 #857 的未完成工作；任何与真实管理器授权、产品自动应用、外部 Chrome 状态或发布直接相关的步骤仍由对应安全门槛限制。
- 本次仅开展远端只读仓库审计、当前 Issues/PR 对账及文档校正；**未进行**新的依赖安装、真实测试、产品代码提交、PR 合并、Issue 关闭、工作流运行或 Stable 发布。
- 建议下一开发入口为 **TASK-013 / Issue #857**，先完整审阅尚开放的 PR #925 并独立核对其当前检查结果和未满足验收条件；再执行有边界的续接。最终 Stable 发布仍由 TASK-021 / Issue #610 把关。

### 2026-11-22 同一准备分支的二次核验补充

- 再次读取 `main@146f9a987e7e633496d723e7f517c68282e1fe07`、开放 Issues 和 PR，确认当前开放 Issues 仍为 #857/#610/#510/#486；本次准备 PR #926 与原产品 PR #925 都是开放未合并。该结论仅为本次快照，后续需按服务器重新读取。
- 准备 PR #926 的 Documentation Integrity `45020613844`（https://github.com/devin930906/userscript-auto-healer/actions/runs/45020613844）与 Issue Coordination PR Fence `45020613829`（https://github.com/devin930906/userscript-auto-healer/actions/runs/45020613829）均为成功，匹配准备提交 `e1eaaf3ffc9ac177a43e0e5a2fb5b0d8076b71a5`。该证据仅证明该次文档提交的相关检查，不证明全部产品级 TEST/GATE。
- 旧名 `Issue coordination / stale round fence` 依旧作为 required-context 兼容，`.github/workflows/governance-issue-merge-fence.yml` 的现行注释和 checkout/调用路径明确表述：只针对可信 base 的真实 PR 集成安全检查，不执行旧 Issue 独占认领。现行权威为 `AGENTS.md` 2026-11-02 小节及 `docs/19-stable-v7-migration.md`；旧文档、分支和诊断脚本无需为了此轮准备而删除。该审计为工作流源码静态核对及 PR 检查运行结果观察，并非形式化证明所有合并并发情形无冲突。
- `docs/05-experience.md` 已保留经确认的 TASK-017 深色控制台设计：七标签、深靛霓虹令牌、键盘标签导航、原生授权与危险恢复交互。此轮不替换品牌或新建设计体系。由于没有取得真实桌面渲染截图与实际操作结果，窗口缩放、视觉对比、完整键盘旅程和无障碍测试均保持待验证。
- 原产品 PR #925 的最新 head `4babea4f1e49cc799beb72b9013d4e158d185962` 已在 GitHub Actions 取得部分相关成功结果（Application Skeleton、Windows Candidate、Portable Chrome、Documentation Integrity）；TASK-007 官方 Tampermonkey 隔离 Windows 实验于该 head 的 Actions run `45019225183`（https://github.com/devin930906/userscript-auto-healer/actions/runs/45019225183）已成功完成；此证据仅适用于隔离实验，不表示实际用户 Profile 或产品级安装、注入及业务验证通过。必须按 head 完整检查并区分候选/隔离实验和真实用户环境与产品级验收，不能据部分绿色记录关闭 #857/#486/#510/#610。
- **集成状态**：准备分支有未合并 Draft PR #926；不应直接把此分支视为已纳入 `main` 的正式准入更新。正式开发起点仍为有条件续接 TASK-013 / Issue #857，先核对 PR #925 的实际剩余功能和完整 CI；无须另建 Issue 或从 TASK-001 重做。
