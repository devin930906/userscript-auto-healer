# 发布策略与最终 Stable 门槛

> 状态：Windows runner 的 CDP、Inno Setup 临时 EXE 构建/安装/卸载及官方 WinRAR 限期评估真 RAR5 创建/解压已通过工具链 PoC；**正式应用 EXE+ZIP 双包、签名及真实运行仍未执行/满足**；既有 RAR5 试用 PoC 为历史证据，已被 ZIP 发行决策取代，不能冒称已发布。

## 支持平台
目标 Windows x64（起始支持建议，不表示用户确认最低 Windows/Chrome 版本）；应用运行依赖外部所选 Chrome 和授权的真实油猴管理器，Chrome 多便携版兼容范围由 POC-01/02 建立矩阵，不能保证任意 Chrome。

## 最低环境
最终最低 Windows、Chrome、管理器及 GM API 兼容版本：待 POC 和用户认可的矩阵确认；示例只用 Windows 2025 runner 作为构建环境，不是最终用户 Windows 最低系统版本。

## 版本规则
采用语义化版本候选，提交 SHA 为不可变来源；正式 tag 与 Release 必须指向通过 GATE 的同一个源提交，Release 不提前发布。

## 云端构建
计划 push/PR 触发文档与代码检查，release 需显式 workflow_dispatch 或受保护 tag，最小 GITHUB_TOKEN permissions（读 contents，独立发布 Job 写 contents）；GitHub 托管 Windows x64 runner 推荐 windows-2025，独立 job 完成 lockfile 安装、类型检查、测试、构建、已实证存在的 Inno Setup 候选安装器（NSIS 可保留备选）与 Windows/PowerShell 原生 ZIP 压缩步骤；禁止在外部 PR 获 Secrets，Actions 凭据、计费/用量与第三方依赖许可证仍未实核。CI 采用缓存版本/依赖 lock hash、超时/取消/并发策略、失败日志脱敏、工件保留策略。文档审查与正式构建必须不同工作流；未创建工作流也未运行。

## EXE 安装版
候选 Inno Setup 6 生成真实 .exe 安装程序（仅临时文本安装/卸载已通过：https://github.com/devin930906/userscript-auto-healer/actions/runs/39089013574）；Electron+electron-builder NSIS 作为待验证备选（见 ADR-001/003）。计划每用户安装优先且不强求管理员权限；应用可执行入口/运行资源随包携带，用户选择的 Chrome 外置；可自选安装位置与桌面/开始菜单快捷方式，升级向后兼容，卸载保留用户数据默认应提示并可明确选删除。具体安装器许可/签名方案待核定；未签名文件不得称已签名。干净 Windows VM 实际安装、启动、核心场景、升级、卸载和数据完整性为必备验收。

## ZIP 便携版
必须是真实的 `.zip` 归档，来自与 EXE 安装版相同源提交的完整 Windows 便携应用目录及运行依赖。优先使用 Windows GitHub Actions 中可验证的 PowerShell `Compress-Archive` 创建 ZIP，并通过文件头、归档条目清单、解压文件哈希、路径安全与实际启动验证证明格式及内容正确；不得通过重命名扩展名伪造 ZIP。不得将 GitHub Actions 自动提供的工件容器 ZIP 当作已经验证的产品便携包。
便携包中须包含完整应用入口与必要资源，不要求用户安装 Node/npm，不假设用户 Chrome 已内置于包中。配置与历史默认存放于允许的用户数据位置；若选择便携目录，遇只读目录必须提示并安全降级到获用户同意的路径；凭据及迁移策略须实测。需检查 ZIP 条目相对路径、拒绝绝对路径与 `../` 路径穿越并避免解压覆盖，完整性校验 SHA-256；在干净 Windows VM 中解压至非构建目录，验证首次启动、核心功能、退出、数据保留和多路径运行。当前尚无正式便携应用，因此以上均为发布验收要求，**不是已通过结果**。原先 RAR5 试用技术 PoC 只保留历史记录，RAR 创建器及其生产许可证不再是正式发布依赖。

## 发布产物
预期 Userscript-Auto-Healer-vX.Y.Z-Setup.exe、Userscript-Auto-Healer-vX.Y.Z-Portable.zip、SHA256SUMS.txt、发行说明；具体文件名非实际产物。构建须记录版本、commitSHA、runner image、lockfile SHA、tool version、dependency/license audit，上传 GitHub Releases 的是 .exe/.zip 产品文件本体；下载后校验 SHA-256 与大小。签名证书未提供、成本/授权待核查，正式签名策略必须确定或明确披露未签名风险（不宣称已签）。

## 验证规则
GATE 执行按类别分离 CI build 和真实 Windows+管理器复现，全部阻断项满足前禁止发布 Stable。测试数据、API Key 和登录资料严禁进入公开 Release 工件。

## 校验值
尚无产物，SHA-256 为“未提供”；仅在真实生成每份文件时计算并记录，不能编造。

## Stable 准入条件
| 编号 | 验收类别 | 对应需求 | 必要条件 | 验证方法 | 证据位置 | 阻断等级 | 状态 |
|---|---|---|---|---|---|---|---|
| GATE-001 | 功能完整性 | REQ-001..028 | 全部 Stable 必需模块在受支持矩阵内交付 | 对应测试、代码/提交、人工复核 | 测试报告与提交记录 | 阻断 | 未完成 |
| GATE-002 | 需求符合性 | REQ-001..028 | 每项行为契约符合原始输入，异常/否定约束无例外 | 需求追踪逐行复核 | docs/10-traceability.md 与报告 | 阻断 | 未完成 |
| GATE-003 | 自动化测试 | REQ-001..028;NFR-001..012 | 适用自动化用例与 CI 全部通过，不允许忽略失败 | 测试执行报告、CI 结论 | Actions runs / tests | 阻断 | 未完成 |
| GATE-004 | 真实环境验证 | REQ-006..012,017,018,023 | 所声明 Chrome+真实 Tampermonkey 组合必须完成扩展授权、GM API 与业务断言；其他管理器独立测试 | 有证据的 Windows 实机/VM 检查 | 受保护实测报告 | 阻断 | 未完成 |
| GATE-005 | 兼容性 | REQ-006..010,017,018 | Tampermonkey 主支持矩阵内 Chrome/便携版、GM API 与注入时机回归合格，Violentmonkey 不能替代 | 跨版本真实测试 | 矩阵结果文件 | 阻断 | 未完成 |
| GATE-006 | 安全性 | REQ-007,015,019..021,026 | 严重风险已实测受控；无未经授权修改或秘密外传 | 负例、供应链、隐私与权限测试 | security 测试报告 | 阻断 | 未完成 |
| GATE-007 | 可靠性 | REQ-020..025 | 故障注入、取消/恢复、备份/回滚、多任务隔离通过 | 注入与恢复审计 | 恢复/回归报告 | 阻断 | 未完成 |
| GATE-008 | 安装部署 | REQ-027 | 干净 Windows 安装、启动、升级、卸载并保留数据策略 | 真实安装与卸载记录 | VM 验证报告及 .exe | 阻断 | 未完成 |
| GATE-009 | 便携运行 | REQ-028 | 真实 ZIP 完整、条目路径安全、解压直接启动、只读路径与数据存取可用 | ZIP 文件头/清单/解压哈希/干净 VM 运行 | ZIP 测试报告及 .zip | 阻断 | 未完成 |
| GATE-010 | 文档完整性 | REQ-001..028 | 入口/架构/配置/使用/许可/测试/发布/回滚文档一致 | 交叉追踪与独立审阅 | docs/11-readiness.md | 阻断 | 未完成 |
| GATE-011 | 发布产物完整性 | REQ-027,REQ-028 | 同一 commit 的 EXE 与 ZIP、版本与 SHA-256、下载与溯源一致 | Release 附件重新下载验证 | Releases/校验清单 | 阻断 | 未完成 |

## 最终发布机制
先测试/锁版本/可复现构建→真实安装/便携/油猴扩展回归→受控签名/合规确认→生成两份文件与哈希→创建正式 Release→重新下载比对哈希、运行证据归档。真实 ZIP 便携应用验收、真实损坏脚本修复/回归、正式 Windows 安装与便携应用运行验证未解决前仍阻断 Stable。限定环境 Violentmonkey+Chromium 的真实 .user.js 注入、GM_getValue 调用 PoC 已通过（https://github.com/devin930906/userscript-auto-healer/actions/runs/39092523277），**但它不是任何正式产品构建、修复验证或 Stable 验收**。

## Tampermonkey 正式发布硬门槛（I-011）
正式 Stable 必须证明声明支持的真实 Tampermonkey 环境通过 TEST-017/018 与 GATE-004/005。必要证据包括官方扩展身份/版本、浏览器与 Profile、权限、脚本安装及执行、GM API 调用、业务断言、失败回滚和运行记录。Violentmonkey 既有 PoC 仅用于研究。受阻则不得宣布 Stable；EXE+ZIP 发行不变。
