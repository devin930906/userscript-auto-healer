# 开发前准入边界、首期验证矩阵及剩余外部条件

> 核验日期：2026-10-18（MYT）。状态：**前期工程技术路线和实验室可用性已具备证据；全范围开发前置未全部完成，正式 Stable 发布更未完成。** 本文件是现有 docs/00..12 的准入补充，不代替需求、测试、ADR 或发布 Gate。不含正式产品代码。

## 证据级别及已实测边界

| 编号 | 验证目标 | 真实结论 | 证据与约束 |
|---|---|---|---|
| POC-01A | Windows 2025 托管 Chrome 155/CDP/独立 Profile | 已通过受限方案 | https://github.com/devin930906/userscript-auto-healer/actions/runs/39082627685；非实际 Windows 10/11 用户设备 |
| POC-01B | 独立解压的 Chrome for Testing 154/CDP 实例归属/错误 Profile | 已通过受限方案 | https://github.com/devin930906/userscript-auto-healer/actions/runs/39088772310；不等于所有第三方便携版 |
| POC-02D | 真 Violentmonkey 2.49.0 的 .user.js 注入与 GM_getValue 实际调用 | **通过** | https://github.com/devin930906/userscript-auto-healer/actions/runs/39092523277；Playwright bundled Chromium、独立测试 Profile、标准 HTTPS |
| POC-04A | 真 Violentmonkey 中两个**人工准备**的已知选择器状态 | **故障与修正后两项通过** | https://github.com/devin930906/userscript-auto-healer/actions/runs/39093275851；broken 与 fixed 各独立 Windows Job；**不是自动修复引擎** |
| POC-04B | 真 Acorn AST：字面 selector 与动态表达式区分、源码行列/所属函数 | **通过静态解析 PoC** | https://github.com/devin930906/userscript-auto-healer/actions/runs/39093951314；三处字面、三处未知；未生成修复补丁、未执行输入脚本 |
| POC-03A | Inno Setup 6 临时 Windows 安装器生成、安装、卸载 | 已通过工具链 PoC | https://github.com/devin930906/userscript-auto-healer/actions/runs/39089013574；不是正式应用安装包 |
| POC-03B | 官方试用 WinRAR 真 RAR5 创建、校验、解压 | 已通过限期评估 | https://github.com/devin930906/userscript-auto-healer/actions/runs/39089224242；长期生产使用许可证**未落实** |
| POC-03C | Windows 原生 ZIP 创建/解压/哈希往返 | **已通过工具链 PoC** | https://github.com/devin930906/userscript-auto-healer/actions/runs/39095747797；不等于正式应用便携 ZIP 或 GATE 通过 |

### POC-04A 人工故障/修正场景：可复用基准

脚本管理器：真实 Violentmonkey MV3 v2.49.0；浏览器：Playwright 隔离 Chromium，Windows 2025；安装源：临时 loopback .user.js 文件；目标网页：`https://example.com/` 标准 HTTPS；独立 Chrome Profile 中用户级扩展权限开启。Playwright 只在自己的测试页预先插入 `#poc-new-anchor`，不修改远端网站，也不包含用户真实账号或私人油猴脚本。

| 样本 | 脚本中的定位器 | 运行时业务断言 | 预期 |
|---|---|---|---|
| `broken` | `#poc-obsolete-anchor`（页面不存在） | `userscriptFixture=executed`、GM_getValue 默认值读取成功，`selectorOutcome=missing-target` 且无目标动作 | **脚本本身执行成功，业务明确失败** |
| `fixed` | `#poc-new-anchor`（页面实际存在） | 脚本/GM 同样成功，`selectorOutcome=recovered`、目标节点 `data-fixture-clicked=yes` | **业务恢复** |

测试源：`poc/windows-manager-extension.cjs`；Windows 工作流：`.github/workflows/windows-manager-extension-poc.yml`，固定 `scenario: [broken, fixed]` 两个独立测试任务。缺少目标业务断言、扩展用户脚本运行或 GM API 成功时该任务必须失败。脚本差异是**事先人工设定**，不得写作“产品能够诊断、自动修复或回滚”。该项目还需要开发中的 REQ/TEST、真实损坏脚本样本及登录等前置条件才能验证真正自动修复。

## 静态 AST POC-04B 的结果与限制

隔离 Ubuntu 2024 GitHub Actions（临时安装 `acorn@8.14.0`、禁止 npm install scripts）解析预设 JavaScript，得到六处定位器或计算成员方法调用的源码行列和所在函数。三处字面选择器可静态确定，三处拼接/动态方法只能标记为 `needs-runtime-confirmation`；必须用后续授权运行时诊断核实，不可自动改动。代码 `poc/ast-selector-feasibility.cjs`，工作流 `.github/workflows/ast-selector-feasibility.yml`，真实通过记录：https://github.com/devin930906/userscript-auto-healer/actions/runs/39093951314。

**不可混淆**：这是一个受限合成 AST 技术验证，不是完整 .user.js 多文件/混淆/依赖分析器，没有动态选择器求值、代码语义证明、自动修复或自动验收；TASK-003 仍须先写测试再实施正式功能。

## 受支持范围：已验证、拟验证、不可承诺三层

| 维度 | 实证通过的实验室组合 | 正式产品目标（仍待矩阵测试） | 不得现在宣称支持 |
|---|---|---|---|
| Windows | Windows 2025 GitHub 托管运行器 | Windows 10/11 x64，依据实际设备与可执行包测试确认最低版本 | 任何未经测试的 Windows 版本、所有硬件 |
| 浏览器/CDP | 托管 Chrome 155、独立 Chrome for Testing 154 的 CDP；bundled Chromium 能跑扩展 | 用户选择 Google Chrome 和部分便携 Chrome；`--remote-debugging-address=127.0.0.1`、默认端口 9223、独立非默认 Profile | 所有便携版、接管正在使用的默认 Profile、自动获取未授权登录 |
| 油猴管理器 | Violentmonkey MV3 2.49.0 真安装、GM_getValue、已知选择器对照 | Tampermonkey 等按管理器单独适配，优先确认用户实际在用版本与 GM API 范围 | 预先宣布 Tampermonkey 所有版本、所有 GM API 和沙箱/注入组合已经通过 |
| 脚本网站 | 标准 HTTPS `example.com` 的无账户合成场景 | 用户授权实际目标 URL、SPA、异步 DOM、业务断言 | 任意网站、无权访问/登录受控页面；不以“元素找到”当业务成功 |
| Windows 双包 | 临时 EXE 已验证；历史 RAR5 PoC 不能作为 ZIP 证据 | 稳定版正式 Inno Setup EXE + 原生工具真实 ZIP；同源提交、双包独立验收 | 已生成正式 EXE/ZIP、干净 Windows 直启及升级/卸载验收 |

## 决策边界：开发准入不等于发布准入

**仅供开发阶段的工程基线**：选择 `Electron + TypeScript/Node` 作为首个 Windows 桌面程序的可修订实现路线（ADR-001）；main / preload / renderer 明确信任边界；渲染层禁用 Node Integration、启用 contextIsolation/sandbox 和类型化 IPC；真实不可信油猴脚本只能在隔离 Chrome+脚本管理器环境运行，不得进入高权限应用主进程。现阶段只允许据此准备或实施经批准的安全骨架与测试，不把框架选择宣称为用户已经单独签字确认。

**开始 TASK-001 的必要事项**：候选架构及预期安全契约确认（ADR-001）、能够说明适用的首期测试组合（以上矩阵）、约定真实脚本安装与用户授权的明确边界、确定 TASK-001 的安全失败测试。已得到 CDP/真实脚本/GM API 的一个可行受限组合；可针对上述有限组合进行安全骨架的前置审查。**不得因此提前宣布完整兼容、正式自动修复通过或 Stable 合格。**

**尚未完成的全面开发准入/后续任务前置**：
1. 以用户实际使用的 Tampermonkey 和 Chrome（含真实便携版）确认目标范围、最低支持版本、授权与 Profile 策略；若无法访问实际设备/登录，不得虚构实测，明示需在授权环境完成。
2. 用用户授权的真实失效脚本或可公开复现的复杂场景建立“损坏→诊断证据→最小补丁→安装到管理器→业务断言→回滚”合同。当前 POC-04A 只是**合成回归夹具**。
3. 依后续 TASK-007/018 覆盖 GM API、沙箱、SPA、iframe、登录条件、功能测试；未经实测的场景返回 UNKNOWN/DETECTED_ONLY。
4. 正式依赖锁定、Windows 安装/便携、签名及 ZIP 内容完整性与真实运行验证为**相应开发里程碑和 Stable 发布**硬门槛，不应不合理地阻止项目最初的安全骨架开发，也不能忽略到发布时。

## 恢复执行入口

最新进度以每次重新读取 `main`、PR/Issues、CI 为准，不使用固定 SHA 假设。若本文件与 `docs/11-readiness.md` 结论冲突，应基于真实 GitHub Actions 记录同步修订，不得以纯文字或临时工具链 PoC 代替产品验收。完成准入事项后，由 `docs/09-development-plan.md` 进入 TASK-001；继续遵守 `AGENTS.md`，原则上复用现有主集成路径，不积累重复 PR/分支。

## 2026-10-18 便携发行格式更新
依据用户新决定 I-010 / ADR-004，正式 Stable 必需文件现为 EXE 安装版与 ZIP 便携版。旧 RAR5 试用 PoC 仅是历史记录，不再需要为正式 ZIP 购买 RAR 生产许可证。ZIP 工具链 POC-03C 已在云端有限通过，正式 TASK-020 / TEST-028 仍需执行；TASK-001 有条件准入状态不变。
