# 发布策略与最终 Stable 门槛

> 状态：发行路径已设计但尚未在 Windows/CI 实际运行；任何双包构建或真实验收均不得冒称完成。

## 支持平台
目标 Windows x64（起始支持建议，不表示用户确认最低 Windows/Chrome 版本）；应用运行依赖外部所选 Chrome 和授权的真实油猴管理器，Chrome 多便携版兼容范围由 POC-01/02 建立矩阵，不能保证任意 Chrome。

## 最低环境
最终最低 Windows、Chrome、管理器及 GM API 兼容版本：待 POC 和用户认可的矩阵确认；示例只用 Windows 2025 runner 作为构建环境，不是最终用户 Windows 最低系统版本。

## 版本规则
采用语义化版本候选，提交 SHA 为不可变来源；正式 tag 与 Release 必须指向通过 GATE 的同一个源提交，Release 不提前发布。

## 云端构建
计划 push/PR 触发文档与代码检查，release 需显式 workflow_dispatch 或受保护 tag，最小 GITHUB_TOKEN permissions（读 contents，独立发布 Job 写 contents）；GitHub 托管 Windows x64 runner 推荐 windows-2025，独立 job 完成 lockfile 安装、类型检查、测试、构建、NSIS 包装和 RAR 命令行包装；禁止在外部 PR 获 Secrets，Actions 凭据、计费/用量和许可证供应仍未实核。CI 采用缓存版本/依赖 lock hash、超时/取消/并发策略、失败日志脱敏、工件保留策略。文档审查与正式构建必须不同工作流；未创建工作流也未运行。

## EXE 安装版
候选 Electron+electron-builder NSIS 创建真实 .exe 安装程序（见 ADR-001/003）。计划每用户安装优先且不强求管理员权限；应用可执行入口/运行资源随包携带，用户选择的 Chrome 外置；可自选安装位置与桌面/开始菜单快捷方式，升级向后兼容，卸载保留用户数据默认应提示并可明确选删除。具体安装器许可/签名方案待核定；未签名文件不得称已签名。干净 Windows VM 实际安装、启动、核心场景、升级、卸载和数据完整性为必备验收。

## RAR 便携版
必须是真实 RAR 格式，源自相同版本的便携程序目录及运行依赖，使用获合法授权的 RAR/WinRAR rar.exe 命令行创建（参考 https://www.win-rar.com/cmd-shell-mode.html?L=1）。RAR EULA: https://www.rarlab.com/license.htm；试用后需购买许可证，不擅自捆绑第三方创建器。便携包需保留入口与使用说明，默认在便携根目录的允许子目录保存配置/历史，遇只读目录必须清楚告知并经用户同意更换数据根；凭据可携性策略需按 Windows 实际实现审查。不依赖用户安装 Node/npm，不假设 Chrome 自带在包里。文件格式验证、rar t/解包、哈希、干净 Windows 直接启动、核心功能及退出数据检查均为门槛。普通 GitHub Actions 下载 ZIP 仅是工件容器，绝非 RAR 文件本体。

## 发布产物
预期 Userscript-Auto-Healer-vX.Y.Z-Setup.exe、Userscript-Auto-Healer-vX.Y.Z-Portable.rar、SHA256SUMS.txt、发行说明；具体文件名非实际产物。构建须记录版本、commitSHA、runner image、lockfile SHA、tool version、license evidence，上传 GitHub Releases 的是 .exe/.rar 本体；下载后校验 SHA-256 与大小。签名证书未提供、成本/授权待核查，正式签名策略必须确定或明确披露未签名风险（不宣称已签）。

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
| GATE-004 | 真实环境验证 | REQ-006..012,017,018,023 | 所声明 Chrome+管理器组合真实运行、目标行为断言通过 | 有证据的 Windows 实机/VM 检查 | 受保护实测报告 | 阻断 | 未完成 |
| GATE-005 | 兼容性 | REQ-006..010,017,018 | 支持矩阵中的 Chrome、便携版、GM API/注入时机回归合格 | 跨版本真实测试 | 矩阵结果文件 | 阻断 | 未完成 |
| GATE-006 | 安全性 | REQ-007,015,019..021,026 | 严重风险已实测受控；无未经授权修改或秘密外传 | 负例、供应链、隐私与权限测试 | security 测试报告 | 阻断 | 未完成 |
| GATE-007 | 可靠性 | REQ-020..025 | 故障注入、取消/恢复、备份/回滚、多任务隔离通过 | 注入与恢复审计 | 恢复/回归报告 | 阻断 | 未完成 |
| GATE-008 | 安装部署 | REQ-027 | 干净 Windows 安装、启动、升级、卸载并保留数据策略 | 真实安装与卸载记录 | VM 验证报告及 .exe | 阻断 | 未完成 |
| GATE-009 | 便携运行 | REQ-028 | 真 RAR 解压直接启动、路径只读处理、数据存取可用 | RAR 魔数/测试命令/解压 VM | RAR 测试报告及 .rar | 阻断 | 未完成 |
| GATE-010 | 文档完整性 | REQ-001..028 | 入口/架构/配置/使用/许可/测试/发布/回滚文档一致 | 交叉追踪与独立审阅 | docs/11-readiness.md | 阻断 | 未完成 |
| GATE-011 | 发布产物完整性 | REQ-027,REQ-028 | 同一 commit 的 EXE 与 RAR、版本与 SHA-256、下载与溯源一致 | Release 附件重新下载验证 | Releases/校验清单 | 阻断 | 未完成 |

## 最终发布机制
先测试/锁版本/可复现构建→真实安装/便携/油猴扩展回归→受控签名/合规确认→生成两份文件与哈希→创建正式 Release→重新下载比对哈希、运行证据归档。关键 RAR 商业授权、真实浏览器测试和 Windows runner 运行未解决前处于发布阻断状态。
