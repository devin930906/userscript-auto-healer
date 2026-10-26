# 发布策略与最终 Stable 门槛

> 状态（2026-10-26 当前主干）：已有 Windows 开发候选 EXE＋真实 ZIP，历史 main 双包运行 #40272068615 的源 SHA 为 `4acd806936e64da4ebe11d56aa433160efcc2b23` 且成功；最新 main `c3c28451636400a4228688d7354c8f42ba0ccbca` 的应用检查 #40272189600 成功，但本记录未证明同一最新 SHA 已完成正式双包验收。安装文件完整性、只读解压运行、合成升级及卸载保留为阶段证据；真实用户环境、产品自动修复/回滚及 GATE-001..011 未完成。正式交付仍仅 EXE＋ZIP，历史 RAR 只作归档。

## 支持平台
目标 Windows x64（起始支持建议，不表示用户确认最低 Windows/Chrome 版本）；应用运行依赖外部所选 Chrome 和授权的真实油猴管理器，Chrome 多便携版兼容范围由 POC-01/02 建立矩阵，不能保证任意 Chrome。

## 最低环境
最终最低 Windows、Chrome、管理器及 GM API 兼容版本：待 POC 和用户认可的矩阵确认；示例只用 Windows 2025 runner 作为构建环境，不是最终用户 Windows 最低系统版本。

## 版本规则
采用语义化版本候选，提交 SHA 为不可变来源；正式 tag 与 Release 必须指向通过 GATE 的同一个源提交，Release 不提前发布。

## 云端构建
计划 push/PR 触发文档与代码检查，release 需显式 workflow_dispatch 或受保护 tag，最小 GITHUB_TOKEN permissions（读 contents，独立发布 Job 写 contents）；GitHub 托管 Windows x64 runner 推荐 windows-2025，独立 job 完成 lockfile 安装、类型检查、测试、构建、已实证存在的 Inno Setup 候选安装器（NSIS 可保留备选）与 Windows/PowerShell 原生 ZIP 压缩步骤；禁止在外部 PR 获 Secrets，Actions 凭据、计费/用量与第三方依赖许可证仍未实核。CI 采用缓存版本/依赖 lock hash、超时/取消/并发策略、失败日志脱敏、工件保留策略。文档审查与正式构建必须不同工作流；目前仅新增候选双包构建工作流，Stable 正式签名、发布及全量验收流程仍未完成。

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
正式 Stable 发布产物仍为“未提供”；2026-10-20 Windows 开发候选 EXE/ZIP 的实算 SHA-256 与构建来源另见下节，不能挪用作最终 Release 校验。

## 2026-10-20 Windows 开发候选双包阶段记录（非 Stable）

- TASK-019/TASK-020 经 [PR #146](https://github.com/devin930906/userscript-auto-healer/pull/146) 合并至 main：`e42b6e620bba3ca72f595880c21b27bf6d85345a`。引入 `scripts/windows-package-candidate.ps1` 和 `.github/workflows/windows-candidate-packages.yml`，不执行任何 GitHub Release 发布。
- [Windows 候选构建运行 39365266655](https://github.com/devin930906/userscript-auto-healer/actions/runs/39365266655) 成功；该 pull_request CI 实际检出的**测试合成提交**为 `7daf063caa9382bfdd52eb5ea5a32613e35a376a`，**不是**合并后 main 提交。原有 [Application Skeleton Checks 39365266617](https://github.com/devin930906/userscript-auto-healer/actions/runs/39365266617) 在此 PR HEAD 也成功。正式发行前必须以最终选定的 main/release 提交重新构建双包并重新验收。
- Windows CI 已验证：带 Electron 运行时/编译应用/Acorn 依赖的暂存目录实际启动、真 ZIP 的文件头/条目路径、解压后重要文件 SHA-256、解压目录启动、Inno Setup EXE 编译、无声安装启动及卸载。仅验证了脚本预设 `--uahtest-shell-only` 的 sandbox/preload/IPC 安全 smoke；未在真实用户 Chrome/Tampermonkey 下执行完整脚本业务功能。
- 候选 EXE SHA-256：`908fa0f4553d2af0ce33eeecbcec240d2ba2718ac55318c259bfa8d83981ddc8`，候选 ZIP SHA-256：`654885152defdf5d275467d2e981aa55412ed9022ece23e20c90f845fa61c1b2`（来自同次构建日志和 `SHA256SUMS.txt`，不适用于未来重新构建）。
- 候选文件暂存于 [GitHub Actions Artifact 12238554892 所属运行](https://github.com/devin930906/userscript-auto-healer/actions/runs/39365266655)，留存期限仅 3 日；这是 **Actions 外层打包工件**，不是 GitHub Releases，也不是可长期引用的 Stable 下载地址。内部 ZIP 文件已单独通过实际 ZIP 格式检查。
- TASK-018 的真实产品业务验证尚未完成；TEST-027/028 的全部升级/只读目录/数据持久化/用户 Windows 环境矩阵、GATE-008/009/011 仍未通过；全部 GATE-001..011 的 Stable 最终判定仍保持未完成。不可用候选烟测取代这些门槛。签名、许可证决策及正式对外发布仍受独立条件约束。

## 2026-10-20 候选安装隔离与完整 ZIP 复核（TASK-019/020）

- [PR #147](https://github.com/devin930906/userscript-auto-healer/pull/147) 已合并，main 合并提交 `f5ad55ce7fda0f9c3319c1547f6394305b3bac42`。此前候选安装器 `AppId` 和默认安装目录接近正式应用，存在与未来 Stable 安装/卸载命名空间冲突风险。本轮将候选 Inno Setup AppId、默认目录、快捷方式以及内置 Electron 应用 `name/productName` 改为独立开发候选身份；仍未实施正式版升级策略。
- [Windows CI 39366563301](https://github.com/devin930906/userscript-auto-healer/actions/runs/39366563301) 的实际 PR 测试合成源码 `712d6ff95ec097910a1df6f58812b54426e98e22`：全部 138 个 ZIP 文件以相对路径逐一 SHA-256 与解压后文件校验，拒绝条目重复、条目路径不安全、数量或内容不符；候选 Inno EXE 实际安装／启动／卸载及 ZIP 解压启动通过。独立 [Application Skeleton Checks 39366563208](https://github.com/devin930906/userscript-auto-healer/actions/runs/39366563208) 成功，npm 测试 345 项中 344 通过、0 失败、1 跳过。
- 此次开发候选 EXE SHA-256 `c68a38e39f2b0a7929116c283cb51ee688a1378954cbe1fa0d85117bba537e7a`；开发候选 ZIP SHA-256 `95015e017bdc032232cb10f2485193084842dcd74b8ba4007352c122b5918b02`。Artifact `12239458338`（3 日留存），位于同次工作流。上述两个 SHA-256 仅适用于该临时合成提交的构建产物，**不是 main 正式 Stable 发行**。
- TASK-019/020 仍为开发中；完整 TEST-027/028、最低系统矩阵、升级及数据保留、真实 Tampermonkey/业务修复、签名与 GATE-001..011 仍待独立验收。不得因本轮安装隔离或完整 ZIP 哈希通过而发正式 Release。

## 2026-10-20 候选安装内容完整性复核（TASK-019/TEST-027）

- [PR #148](https://github.com/devin930906/userscript-auto-healer/pull/148) 已通过成功的 Windows 验证合并到 `main`，合并 SHA `e885e72cec2de903531c6d65ced39f9cbabad69f`；仅修改 `scripts/windows-package-candidate.ps1`，为候选 Inno Setup 静默安装后的每个应用文件增加原始暂存文件 SHA-256 对照，发现缺失或不一致就拒绝候选打包。
- [候选打包运行 39367606351](https://github.com/devin930906/userscript-auto-healer/actions/runs/39367606351) 为 success；实际构建源码是 PR 测试合成提交 `3a285557231a55be16d4d0673f8beb68043656c3`，与 PR head `abeb2d6da59e7afd8e627a0a0a52df3ff260c00f`、合并后的 main SHA **不同**。日志确认 138 个 ZIP 文件及 138 个安装后的应用文件各自 SHA-256 完整比对通过，暂存／解压／安装 Electron smoke、安装与卸载检查通过。
- 同一 PR head 的 [Application Skeleton Checks 39367606357](https://github.com/devin930906/userscript-auto-healer/actions/runs/39367606357) 成功：Node 345 项，344 pass、0 fail、1 conditional skip，Windows Electron sandbox/preload IPC smoke 成功。临时 Artifact `12240217885` 仅为 Actions 开发候选归档（到期 2026-10-23 UTC），并非 GitHub Release。
- 此次候选安装 EXE 的 SHA-256：`1aacb997a23d6fb1cea3b4ed65d179da67ba1fcbb3cea9c8116614a984849e52`；候选便携 ZIP 的 SHA-256：`88ce3ff0662ef183e9bbc640256fc5cc87bfbcadce8f471102928ee90f1080c4`。两项校验值只对应前述 PR 合成源码的临时构建，**不可作为正式 main Stable 双包校验**。
- TASK-019/020 与 TEST-027/028 仍未完整验收；独立真实用户 Windows、Chrome/Tampermonkey/业务断言、升级／配置保留、只读便携路径、完整 GATE 与候选主干重新构建仍是发布阻断。没有正式 Stable Release。

## 2026-10-20 TASK-019/020 候选用户数据隔离与卸载保留实测

- [PR #149](https://github.com/devin930906/userscript-auto-healer/pull/149) 已合并至 main SHA `d090ea074143e4e0ed31832281b134cd796500ac`。测试用 Electron `--uahtest-shell-only` 回执增加 `app.getPath('userData')`，仅供临时 Windows runner 校验；正式渲染器 IPC 不暴露该字段。候选 Windows 打包脚本核验运行器原生 Roaming AppData 下的独立 `candidate` 用户数据目录，使用合成内容哨兵验证暂存版、ZIP 解压版及安装版启动均对应同一用户数据身份，且 Inno Setup 卸载后哨兵文件内容不变；**不是**正式版本升级／完整业务数据持久化验收。
- 最新 [Windows Candidate EXE and ZIP 运行 #39369480855](https://github.com/devin930906/userscript-auto-healer/actions/runs/39369480855) success，真实构建检出 PR **测试合成源码** `28ff09c93324aa244e700ed241d25c150c854029`，不是 PR HEAD `1260a0a7d1e1e197657861c6144032250876ca22`，亦不是 main merge SHA。日志显示 344 pass / 0 fail / 1 conditional skip、实际 ZIP 138 文件逐一 SHA-256 一致、安装后 138 文件逐一 SHA-256 一致、候选用户数据身份与卸载保留成功，并完成开发候选暂存/解压/安装 Electron smoke、卸载流程。相同 PR HEAD 的 [Application Skeleton Checks #39369480904](https://github.com/devin930906/userscript-auto-healer/actions/runs/39369480904) 亦 success。
- 保留失败证据：[#39369061023](https://github.com/devin930906/userscript-auto-healer/actions/runs/39369061023) attempt 1 曾在真 Chrome/CDP 负例返回 `CDP_FAILED`（同 SHA 的独立应用回归成功，按环境时序异常处理）；attempt 2 通过 Node 回归，但实际候选用户数据路径未位于进程临时覆盖的 APPDATA 下，暴露 Windows Known Folder 验证假设不可靠；后续改为检查真实 Windows runner AppData，最终 #39369480855 success，未删除任何失败记录。
- 本轮临时候选 EXE SHA-256：`7e0c9e41b87d5c5e225fb22f6e078a1b00696f9d7a6fb48881dd96ae80b51eec`；真实便携 ZIP SHA-256：`91ff610ec11aad484e971b1fa866d965417e18b962eec85253b06f8f76bb22e1`。Actions Artifact `12240308520`（有效期至 2026-10-23 04:29 UTC）；这些只是短期开发候选及 PR 合成提交证据，**不是**正式 Stable 双包或 Release。
- TASK-019/020、TEST-027/028 和 GATE-008/009/011 保持未完整通过：尚缺升级、真实用户业务与完整数据持久化、只读目录、支持矩阵、真实 Tampermonkey E2E 与正式候选源提交复建/发行文件下载验收。GATE-001..011 均不得因该有限候选成功而被判通过。

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

## 2026-10-20 Windows ZIP 只读数据写入权限阶段验证（TASK-020/TEST-028）

- [PR #152](https://github.com/devin930906/userscript-auto-healer/pull/152) 已合并 main `961a5d8c230c748d7c12f4aeb8b854c8fc306157`。开发候选 [Windows CI #39373670565](https://github.com/devin930906/userscript-auto-healer/actions/runs/39373670565) 成功，实际检出的 **PR 合成源码** `0e7494233eab668da8d09723213277794ca88142` 不是 main Stable 发布候选。真实 Windows NTFS 继承 ACL 限制 `WD`（文件数据写入/在目录中新建文件）：在 ZIP 解压目录写测试文件被拒绝，Electron `--uahtest-shell-only` 仍可启动且实际 `userData` 在独立 Windows Roaming AppData 目录，合成哨兵保持原样；138 文件的 ZIP 全量 SHA-256 与 138 文件实际安装后 SHA-256 对照均通过。
- 保留有意义的失败记录：[运行 #39373022139](https://github.com/devin930906/userscript-auto-healer/actions/runs/39373022139) 在对整个目录递归应用 `(W)` ACL 时拒绝访问；[运行 #39373382713](https://github.com/devin930906/userscript-auto-healer/actions/runs/39373382713) 根目录通用 `(W)` ACL 导致 Windows `Start-Process` 拒绝启动。最终通过的方案仅限定禁止写入文件数据／新建文件（`WD`），**不证明阻止修改文件元数据、重命名或删除，也不等于完整只读 filesystem 安全模型**。绝不能把失败记录删除或修改判据以制造通过。
- 本次独立开发候选 EXE SHA-256 `4f25593c11c3a46d4fb55c8d40fa84afd00d7a79fefe8876d1fa08a4472924f8`、真实 ZIP SHA-256 `05a0df227b108a5bd2d249412d914fc2b20fa98527d51fb823792a4bd0cdf7bd`，仅适用于上述 PR 合成源码临时候选。Actions Artifact `12242089996`，有效期至 2026-10-23 05:16:28 UTC；不是正式 Release。
- TEST-028、TASK-020、GATE-009 仍**未完成完整验收**：缺真实用户数据持久性/选择路径、完整 Windows 用户／Chrome/Tampermonkey 业务与兼容性矩阵、升级替换、正式同 SHA 双包构建/发行检查及正式用户授权。GATE-001..011 无一可凭此候选检查直接宣布通过。

## （7）2026-10-26 相同主干 Windows 候选双包核验（非 Stable）

- **来源提交**：`35033f74c52aa6edaca3723ac4ca23165db3d3d5`；对应 [Windows Candidate EXE and ZIP #40270461210](https://github.com/devin930906/userscript-auto-healer/actions/runs/40270461210)，Job `candidate-windows-packaging` 成功。
- **同次自动化事实**：599 项 Node 测试（598 `pass`、0 `fail`、1 条件 `skip`）；147 个真正 ZIP 内部应用文件的 manifest/解压哈希比对成功；搬移至含 Unicode 与空格的路径后 Electron 可启动；三轮便携目录迁移均对照完整 SHA-256 与重新启动；实际 Windows ACL 只读提取树中启动成功，用户数据保留于外部目录。
- **EXE 候选事实**：147 个已安装应用文件逐项 SHA-256 与暂存构建内容一致；合成旧版 Inno 安装器覆盖升级到当前开发候选并保留测试 AppData；卸载保持隔离用户数据。不是对真实历史稳定版本的升级兼容担保。
- **产物身份**：临时 GitHub Actions Artifact `12628621628`，名称 `userscript-auto-healer-windows-CANDIDATE`（Actions 外层归档，不是正式 ZIP 便携包，也不是公开 GitHub Release）；仅可将其中经过脚本验证的产品 ZIP 视为**开发候选**。不得将 Actions 外层 ZIP 的 SHA-256 或 Artifact ID 当作最终 EXE/ZIP 发布文件校验值。
- **正式 Release**：截至本轮查询尚无已发布 Release。没有确定全部 GATE 通过、正式签名策略与必要授权，不创建 Stable tag，不公开发布，不复用候选校验和为 Stable 校验。
