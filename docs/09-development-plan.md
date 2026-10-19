# 正式开发实施计划

> 状态：Windows CDP、真实 GM 调用、两组 broken/fixed 人工选择器基准及临时 EXE 与历史 RAR5 工具链已有技术实证；现行便携格式改为 ZIP（ZIP 工具链 POC-03C 已有限通过，正式 ZIP 产品验证未执行）。ADR-001 已有条件选择 Electron+TypeScript 首期安全工程基线；TASK-001 可有限准入，目标 Tampermonkey/实机/真实修复与 Stable 均不得提前标注通过。代码路径仍为预计新增。

## 开发阶段
M0：证实 Chrome/管理器/交付可行性；M1：可运行安全入口+导入+静态分析；M2：动态诊断与真实管理器验收；M3：修复/版本/批处理/AI/监控/共享层；M4：风险/性能/集成与 Windows 双包装；M5：全部 Stable 门槛和 Release。未人为指定发布日期。

## 里程碑
M0 退出：系统与独立路径 Chrome/CDP POC-01A/B 已实测，且 POC-02D 在隔离 Windows Chromium/Violentmonkey 2.49.0 对标准 HTTPS 页实测 .user.js 注入及 GM_getValue 实际调用（https://github.com/devin930906/userscript-auto-healer/actions/runs/39092523277）。首选 Tampermonkey 已由 I-011/ADR-005 确认，ADR-001 的 Electron+TypeScript 为 TASK-001 有条件工程决策；真实用户浏览器 POC-02T-LIVE 的 GM_getValue 和人工 broken/fixed 业务断言亦已记录。完整 Windows/Chrome/便携/Profile 支持矩阵及真实失效脚本回归是对应后续开发阶段任务，不能假称已通过。POC-03A 与历史 POC-03B 仅证明相应临时工具链可行；现行 POC-03C 已在 Windows Actions 实测 ZIP 工具链，正式 EXE 与 ZIP 应用包安装/直启属于发布门槛（可晚于初始代码，不得晚于发布）；M1 退出：TEST-001..005/011/026 的可重复结果；M2：CDP+管理器 TEST-006..013/017/018 的真实证据；M3：TEST-014..025；M4：安全恢复及 EXE/ZIP 正式产品测试；M5：所有 GATE 实证通过。

## 任务清单
| 编号 | 目标 | 关联需求 | 优先级 | 前置依赖 | 实施模块 | 预计文件范围 | 具体执行步骤 | 交付结果 | 测试编号 | 完成条件 | 状态 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TASK-001 | 建立已确定技术骨架与安全入口 | REQ-001;REQ-026 | 最优先 | POC-01/02 与 ADR-001 可用 | app/main app/preload app/ui | 预计新增：app/main/index.ts；app/preload/index.ts；app/ui/index.tsx；tests/security/desktop-boundary.test.ts | 创建最小进程隔离与配置验证测试；运行类型与安全测试 | 可受控启动的开发壳 | TEST-026 | 测试有实际通过证据 + 代码审查 + 提交记录 | 已完成并整合 |
| TASK-002 | 脚本导入与路径安全 | REQ-001..003 | 必须实现 | TASK-001 | src/import tests/import | 预计新增：src/import/import-service.ts；tests/import/import-service.test.ts | 写目录/编码/路径负例再实现批量导入 | 原字节保留与文件清单 | TEST-001..003 | 测试有实际通过证据 + 代码审查 + 提交记录 | 已完成并整合（阶段验证） |
| TASK-003 | 元数据与 AST 定位器 | REQ-004;REQ-011 | 必须实现 | TASK-002 | src/analyze tests/analyze | 预计新增：src/analyze/metadata-parser.ts；src/analyze/selector-analyzer.ts；tests/analyze/ast.test.ts | AST 夹具先行，提取匹配/作用域/动态标记 | 静态证据报告 | TEST-004;TEST-011 | 测试有实际通过证据 + 代码审查 + 提交记录 | 已完成并整合（静态分析阶段） |
| TASK-004 | 网站与验证场景登记 | REQ-005 | 必须实现 | TASK-003 | src/scenarios tests/scenarios | 预计新增：src/scenarios/scenario-registry.ts；tests/scenarios/registry.test.ts | 设计登录/操作/断言契约与缺失状态 | 可管理的测试场景 | TEST-005 | 测试有实际通过证据 + 代码审查 + 提交记录 | 已完成并整合（场景契约阶段） |
| TASK-005 | Chrome/Profile/CDP 安全启动 | REQ-006..009 | 必须实现 | TASK-001;POC-01 | src/browser tests/browser | 预计新增：src/browser/chrome-launcher.ts；src/browser/cdp-session.ts；tests/browser/launch.test.ts | 先写默认 Profile/占用/错实例失败测试，再写自管启动与身份核对 | 仅接入授权 Chrome | TEST-006..009 | 测试有实际通过证据 + 代码审查 + 提交记录 | 已完成并整合（签名 Chrome/独立路径阶段验证；最终用户兼容 GATE 仍待验收） |
| TASK-006 | DOM/SPA 动态观测 | REQ-010;REQ-012 | 必须实现 | TASK-005 | src/observe tests/observe | 预计新增：src/observe/dom-observer.ts；tests/observe/dynamic.test.ts | 盲区和延迟/SPA 夹具驱动 CDP 观测 | 可见性快照 | TEST-010;TEST-012 | 测试有实际通过证据 + 代码审查 + 提交记录 | 已完成并整合（阶段验证） |
| TASK-007 | 真实 Tampermonkey 管理器适配 | REQ-017;REQ-018 | 必须实现 | TASK-004..006;POC-02T 或经验证的安全授权加载路径 | src/manager tests/manager | 预计新增：src/manager/tampermonkey-adapter.ts；tests/manager/tampermonkey-e2e.test.ts | 核验真实 Tampermonkey 身份/版本、注入模式、用户授权、脚本安装执行及 GM 调用；其他管理器单独适配 | 可复核 Tampermonkey 运行证据 | TEST-017;TEST-018 | 测试有实际通过证据 + 代码审查 + 提交记录 | 开发中（目标探测、静态预检、临时诊断及独立 DOM 对照已有阶段成果；原生 Chrome/Profile 选择、独立 CDP 启动授权与只读管理器运行目标提示已在 PR #66 整合；新建空 Profile 入口正在阶段验证；；PR #79 已整合；PR #81 补足 document-body / document-end 的严格本机测试夹具选择和延迟 DOM 取证（此为未验证的管理器运行时辅助功能，须核对当前 CI 与合并状态）；真实 Tampermonkey GM／业务验收未完成） |
| TASK-008 | 故障根因与日志中心 | REQ-013 | 必须实现 | TASK-003;TASK-006;TASK-007 | src/diagnostics tests/diagnostics | 预计新增：src/diagnostics/fault-classifier.ts；tests/diagnostics/fault-classifier.test.ts | 分类非 DOM、JS 异常与业务断言；日志脱敏 | 结构化故障证据 | TEST-013 | 测试有实际通过证据 + 代码审查 + 提交记录 | 开发中（分类/安全日志、限定 CDP DOM 诊断及被动网页 JS 异常观察均已有阶段实现；真实 Tampermonkey 诊断源和完整集成待完成） |
| TASK-009 | 本地多级修复 | REQ-014;REQ-019 | 必须实现 | TASK-008 | src/repair tests/repair | 预计新增：src/repair/patch-planner.ts；tests/repair/patch.test.ts | 测试最小选择器修复/拒绝扩权与未知场景 | 可审核补丁候选 | TEST-014;TEST-019 | 测试有实际通过证据 + 代码审查 + 提交记录 | 开发中（AST 定位器候选及稳定多次只读 DOM 诊断关联已实现；输入仍非真实 Tampermonkey/GM/业务验证，缺授权管理器证据、端到端集成和自动应用门控）；新增独立原生只读 DOM 故障→AST 审核→备份/候选暂存→手动导出串联，仍无真实管理器和业务 VERIFIED |
| TASK-010 | 自动验收与门控 | REQ-018;REQ-021 | 必须实现 | TASK-007;TASK-009 | src/acceptance tests/acceptance | 预计新增：src/acceptance/acceptance-gate.ts；tests/acceptance/gate.test.ts | 实现真实证据/业务断言与 UNKNOWN 拦截 | 验收决定和证据链 | TEST-018;TEST-021 | 测试有实际通过证据 + 代码审查 + 提交记录 | 开发中（TEST-021 离线验收前置拒绝门槛已实现并通过 Windows 阶段测试；真实管理器/业务验收与备份后才可继续） |
| TASK-011 | 备份、原子写入、版本和回滚 | REQ-020;REQ-021 | 必须实现 | TASK-002;TASK-010 | src/version tests/version | 预计新增：src/version/version-store.ts；tests/version/rollback.test.ts | 写崩溃/文件锁/冲突测试，再实现备份事务/回滚 | 可恢复版本库 | TEST-020;TEST-021 | 测试有实际通过证据 + 代码审查 + 提交记录 | 开发中（只读源核验、备份-only、恢复来源只读校验与本应用原生协作式文件身份互斥锁已在 PR #44–53 分阶段整合；新增独立备份/候选的非授权持久恢复检查点与负例（仅阶段验证，不等于原子事务或可恢复权限）；仍未实现可恢复事务写入/回滚/真实 Tampermonkey 业务验收；完整 TEST-020/021 和 GATE-007 未通过） |
| TASK-012 | 导出及管理器内版本状态 | REQ-023 | 必须实现 | TASK-007;TASK-011 | src/export tests/export | 预计新增：src/export/script-exporter.ts；tests/export/export-e2e.test.ts | 明确磁盘产物与扩展内更新区分并真实验证 | 导出与更新记录 | TEST-023 | 测试有实际通过证据 + 代码审查 + 提交记录 | 开发中（已增加受限的原生只读复核→独立手动 .user.js 导出；不更新 Tampermonkey 内已安装版本，不提供真实 TEST-023/GATE 验收） |
| TASK-013 | 批处理、取消、限次重试 | REQ-022 | 必须实现 | TASK-008..012 | src/jobs tests/jobs | 预计新增：src/jobs/batch-coordinator.ts；tests/jobs/resume.test.ts | 实现脚本独立状态与中断恢复故障注入 | 隔离任务队列 | TEST-022 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
| TASK-014 | AI 连接、模型发现与成本限制 | REQ-015;REQ-016 | 必须实现 | TASK-009;TASK-013 | src/ai tests/ai | 预计新增：src/ai/model-gateway.ts；tests/ai/gateway.test.ts | 先模拟请求与泄密负例，后实现可选网关 | AI 候选接入 | TEST-015;TEST-016 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
| TASK-015 | 健康监控与历史 | REQ-024 | 必须实现 | TASK-010;TASK-013 | src/health tests/health | 预计新增：src/health/health-registry.ts；tests/health/registry.test.ts | 实现按授权复检和按证据判健康 | 时间线监控 | TEST-024 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
| TASK-016 | 共享兼容层与依赖回归 | REQ-025 | 必须实现 | TASK-009;TASK-010;TASK-015 | src/compat tests/compat | 预计新增：src/compat/compatibility-layer.ts；tests/compat/compat-e2e.test.ts | 实现版本语义/多脚本回归和回退 | 稳定共享层 | TEST-025 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
| TASK-017 | 完整 UI 与批量用户旅程 | REQ-001..025 | 必须实现 | TASK-013..016 | app/ui tests/e2e | 预计新增：app/ui/task-screen.tsx；tests/e2e/main-flow.test.ts | 先主流程/异常/取消验收，再连接实际模块 | 可用交互入口 | TEST-002;TEST-022 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
| TASK-018 | 安全审计与端到端回归 | REQ-001..026 | 必须实现 | TASK-017 | tests/security tests/e2e | 预计新增：tests/security/permissions.test.ts；tests/e2e/tampermonkey-userscript.test.ts | 覆盖严重风险、真实 Tampermonkey、授权/注入模式/回滚负例，Violentmonkey 仅辅助 | 安全/回归证据 | TEST-007;TEST-018;TEST-026 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
| TASK-019 | Windows EXE 安装版 | REQ-027 | 必须实现 | TASK-018;POC-03 | packaging/windows .github/workflows | 预计新增：packaging/windows/installer.iss；.github/workflows/build-windows.yml（预计新增；Inno Setup 候选） | 锁定安装工具/权限/升级测试，Windows 构建验收 | 真实 EXE 安装包 | TEST-027 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
| TASK-020 | 真实 ZIP 便携发行 | REQ-028 | 必须实现 | TASK-018;ZIP 工具可用性验证 | packaging/portable .github/workflows | 预计新增：packaging/portable/create-zip.ps1；.github/workflows/build-windows.yml | 创建真实 ZIP，校验文件头/路径安全/文件哈希/解压/干净 Windows 直启 | 真实 ZIP 包 | TEST-028 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
| TASK-021 | 稳定版最终集成发布验收 | REQ-001..028 | 必须实现 | TASK-019;TASK-020 | docs/release .github/workflows | 预计新增：.github/workflows/release.yml；docs/08-release.md | 跑全部适用 GATE；以同一提交出双包与校验值 | 可追溯 Stable Release | TEST-001..028 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |

## 任务依赖
POC-01/02、ADR-001/002 先行→TASK-001→002/003/005→004/006/007→008/009/010/011→012/013/014/015/016→017/018→019/020→021。修复/安全与真实验收必须协作，不允许绕过测试门控。

## 优先级
影响用户安全和核心真实验收的路径优先；功能完整性与产品交付形式都属 Stable 必要项。不得因额外可选功能拖延最终验收。

## 实施范围
从单用户 Windows 本地处理、可选 AI 网关到EXE+ZIP 双包，非必要 Web 服务/云同步/其他 OS 不纳入。每项开发采用先失败测试→最小实现→复测→独立评审与符合仓库策略的整合。

## 验证条件
测试指令将随 Node lockfile、脚手架与 Windows runner 落地；当前没有 npm test、build 或实际运行输出，禁止复制拟定命令伪称已验证。

## 完成条件
各任务需保留代码路径、提交SHA、关联 TEST 和 CI/真实环境证据；最终 GATE 按 08 原类别逐项判断，不能以任务数代替工程进度。

## 下一任务

在当前有限工程准入下，下一首要任务为 **TASK-001：最小安全桌面骨架及其安全负例**。按 ADR-001 的 Electron/TypeScript 条件基线实现 renderer sandbox/contextIsolation/无 Node Integration、白名单 preload IPC、路径/配置验证与错误处理，真正运行适用测试并提交可追溯源码；**本准备阶段没有实际开发这些产品功能**。

后续 TASK-007/018 的 Tampermonkey 与用户实际便携 Chrome、真正损坏脚本、授权登录与完整业务断言尚须单独验证；本轮 POC-04A 的两组 `broken/fixed` 由人手预设，仅证明验收方法可重复（https://github.com/devin930906/userscript-auto-healer/actions/runs/39093275851），绝不代表自动修复或回滚已开发。正式 ZIP 构建与解压验证、真实应用双包与稳定发布留给 TASK-019..021 的硬门槛，不能无期限拖延也不能假装已解决。详细见 docs/13-predevelopment-admission.md。

## 开发前 AST 技术验证（POC-04B）

真实验证 Acorn 对选择器字面值、拼接/计算成员、嵌套函数与源码行列的解析和未知标记可行：https://github.com/devin930906/userscript-auto-healer/actions/runs/39093951314。因此 TASK-003 可采用可审计 AST 测试先行，但必须补全真实 .user.js 元数据、作用域/封装分析、备用定位器、动态运行时二次确认与失败样本。该 PoC 的三处动态/未知调用**不得**自动修复，亦不表示已交付 TASK-003。

## POC-03C ZIP 工具链验证记录
Windows GitHub Actions 已通过原生 ZIP 临时文件头/解压/安全相对路径/SHA-256 往返测试：https://github.com/devin930906/userscript-auto-healer/actions/runs/39095747797。TASK-020/TEST-028 仍为未开始，正式便携软件未生成。

## I-011 Tampermonkey 验收实施顺序
独立 POC-02T：取得官方合法可信的 Tampermonkey MV3→隔离授权 Profile→核对身份/版本→Chrome 授权→兼容的安装机制→GM_getValue 真实调用→独立 broken/fixed 业务断言→Actions run/SHA 证据。当前 **未执行/未通过**；不能由 POC-02D/04A 的 Violentmonkey 成果代替。TASK-001 安全骨架的有限准入不受阻断；TASK-007、010、018、TEST-017/018、GATE-004/005 必须证明真实 Tampermonkey 兼容，不允许静默以其他管理器替代。

## Tampermonkey POC-02T-LIVE 后续结果
用户连接 Chrome 上已完成真实 Tampermonkey 5.5.1 一次性脚本安装、GM_getValue、人工预设 broken/fixed 业务动作与临时测试清理。证据：docs/evidence/2026-10-18-tampermonkey-live-browser-qa.md。独立 GitHub Actions Tampermonkey POC-02T 仍未执行；TASK-001 有条件准入不变；TASK-007 与正式 TEST-017/018 必须在产品实现后实测。

## （4）前置准备工程收口与（7）入口（2026-10-18）

- （4）按仓库证据完成需求/架构/测试/任务交叉审查，结论为**有条件准入**；没有产品功能代码，**下一任务 TASK-001**。不得继续无限扩写准备文档，也不得把 PoC 通过等同正式 TEST/GATE 通过。
- 已锁定本阶段决策：Tampermonkey 为主要且 Stable 必测管理器（I-011/ADR-005）；Electron+TypeScript 为首项安全骨架有条件基线（ADR-001）；Windows 正式交付为 EXE+ZIP（I-010/ADR-004）。
- 证据层级分开：POC-02T-LIVE 是用户现有 Chrome 上的真实 Tampermonkey 5.5.1 一次性脚本、GM_getValue、**人工** broken/fixed 和清理（docs/evidence/2026-10-18-tampermonkey-live-browser-qa.md）；POC-02T 独立 GitHub Actions 真 Tampermonkey **尚未执行**；产品 TEST-017/018 与 GATE-004/005 **尚未通过**。
- 剩余关键条件转至（7）各阶段：TASK-001 首先做 sandbox/IPC 与安全负例；TASK-005 核验浏览器 exe、独立 Profile、CDP 端口及实例归属；TASK-007/010 与 TASK-018 完成真 Tampermonkey 适配、云端和现实支持矩阵；TASK-009..011 验证真实脚本补丁与备份回滚；TASK-019..021 完成正式 EXE+ZIP、许可证/安全审计和 Stable GATE。
- 未获实际授权的用户原脚本、已登录网页或 Chrome Profile 不得擅自读取、改写或迁移。任何阻断按相关 TASK/TEST/GATE 记录；不是返回（4）从头准备的理由。

## （7）开发事实记录：TASK-001（2026-10-18）

已从经确认的 Electron+TypeScript 决策创建安全桌面开发骨架（app/main、app/preload、app/ui、src/security）及负例测试。Windows Actions `39100320005` 在提交 `244f853fae7e5f7443f86a69b5804bc14b7883aa` 上报告 TypeScript 类型检查与 11 项安全/配置测试通过（https://github.com/devin930906/userscript-auto-healer/actions/runs/39100320005）。该记录仅代表编译期和纯逻辑安全测试，**未完成 Electron 进程实际桌面启动、IPC 运行时测试或完整 TEST-026/GATE-006 验收**；这是 `244f853` 阶段的历史判断，不能取代后续真实 Electron 运行证据。npm 依赖锁应保存在仓库，后续通过锁文件重复验证。对应的 Windows Electron 运行测试已在后续提交通过，TASK-001 目前等待 PR 整合。

## （7）TASK-001 Windows 真正运行验证与 PR 待整合（2026-10-18）

在提交 `5f2830d52d349ab19583740dc177427e1652e355` 上，Windows Actions https://github.com/devin930906/userscript-auto-healer/actions/runs/39100881800 成功完成锁定依赖安装、TypeScript 类型检查、11 项安全配置自动化测试、正式 Electron 运行文件下载、桌面进程实际启动、sandbox preload 的隔离状态读取以及白名单 IPC 正反输入检查。用户真实 Windows 设备、完整跨域/恶意 iframe 攻击、浏览器 Profile/CDP 和 Tampermonkey 产品验收不属于这次成功结论，完整 TEST-026/GATE-006 仍须后续安全审计。当前 TASK-001 实现与验证已达到其骨架交付条件，**PR #1 合并前仍标记已完成未整合**；后续需在核对 PR、Required Checks/审核后整合，再按依赖进入 TASK-002。不得将骨架测试算作 Stable 通过。

## （7）TASK-001 实际合并完成（2026-10-18）

PR [#1](https://github.com/devin930906/userscript-auto-healer/pull/1) 已实际合并至 main，GitHub 返回合并 SHA `083de9db209d00b52183794687f0bb97d04e1e8d`，其 HEAD `230354e67f9ed9833b1713baaf9600f32cf57de9` 的 Windows 应用完整验证 [39101063472](https://github.com/devin930906/userscript-auto-healer/actions/runs/39101063472) 及文档检查 [39101063490](https://github.com/devin930906/userscript-auto-healer/actions/runs/39101063490) 均为 success。TASK-001 现为 **已完成并整合**；此状态仅指安全桌面骨架，不能代替完整 TEST-026、其它 REQ/TEST 或 Stable GATE。下一个依赖满足且可有限开展的独立任务为 **TASK-002**，须按已确认计划先开发脚本导入、原字节保留和路径安全负例；Tampermonkey/真实 Chrome 条件尚未达到的功能继续受相关门槛限制。

## （7）TASK-002 实际完成与后续任务（2026-10-18）

PR [#2](https://github.com/devin930906/userscript-auto-healer/pull/2) 已合并到 main，合并提交 `0a8b8ff1033fc99a01cc0c24978c092a016e7c7a`。TASK-002（REQ-001..003）提供只读 `.user.js` 字节保留/编码和 SHA-256 验证、独立错误、限制递归目录扫描、原生文件/文件夹选择，以及受限制的拖放文件和文件夹；增加同文件名同哈希跨入口去重和每批 128 MiB 上限。Windows Actions [39103414900](https://github.com/devin930906/userscript-auto-healer/actions/runs/39103414900) 在源 HEAD `f238366e4d436a7d245e8ae609e8704b25b4b1fc` 的 `boundary` 与 `windows-shell-smoke` 均成功，包含 Node 导入负例和真实 Electron 渲染器中的合成拖放重复案例。没有执行真实用户设备的文件夹拖放/大量文件交互测试；TEST-002 的完整实机交互和 GATE 仍待后续集成验收。

TASK-001/002 均已合并；后续优先开展 **TASK-003**（REQ-004、REQ-011：元数据/AST 解析与静态证据），可独立准备 **TASK-005**（经授权 Chrome/Profile/CDP 安全启动）。此阶段没有自动修复、真实 Tampermonkey 产品适配、正式 EXE/ZIP 或 Stable Release；不得将早期 PoC 与产品验收混淆。

## （7）TASK-003 AST 与元数据静态证据（2026-10-18）

[TASK-003 PR #3](https://github.com/devin930906/userscript-auto-healer/pull/3) 已合并，main merge commit `cc15da038ecf01c4c03001e7165b7698eecab4d5`。新增 `src/analyze/metadata-parser.ts`、`src/analyze/selector-analyzer.ts`、`tests/analyze/`，引入具有锁文件 SHA-512 完整性记录的 Acorn 8.14.0；按 REQ-004/011 保守提取元数据行序/重复及未知标记、AST 字面定位器与动态待确认项、源位置/函数范围和候选 fallback。Windows [Actions 39104178253](https://github.com/devin930906/userscript-auto-healer/actions/runs/39104178253) 对 PR HEAD `534f97b464384d18559d0c61127de7c6b3abc9c0` 的 `boundary` 和 `windows-shell-smoke` 均通过。此阶段只提供静态分析 API，不代表 UI 全流程或自动修复已经完成；TS/AST 动态未知一律需要后续真实环境复核。下一项依赖满足的顺序任务为 **TASK-004**（REQ-005/TEST-005：场景契约）；TASK-005（REQ-006..009）也是独立可执行路线。

## （7）TASK-004 场景登记阶段交付（2026-10-18）

[PR #4](https://github.com/devin930906/userscript-auto-healer/pull/4) 已合并，main commit `dc088797220f9a3d7efa5b1d89dede6ff0ae657c`。新增 `src/scenarios/scenario-registry.ts` 和 `tests/scenarios/registry.test.ts`，实现 REQ-005/TEST-005 的本地场景合约、显式授权网址/登录前提/业务步骤及断言预检，元数据规则仅为站点提示，严禁自动认定登录/实际业务验证成功。Windows [Actions 39104629620](https://github.com/devin930906/userscript-auto-healer/actions/runs/39104629620) 在源 SHA `a39004f973a1c72469ffa620bfa6f01a517570ab` 的 Node 测试 30/30、TypeScript 类型检查、真实 Electron smoke 全部成功。**READY_TO_TEST 仅表示静态场景条件具备，不代表运行或修复通过**；真实场景 E2E 留给 TASK-007/010/018。

按照正式计划，下一优先任务为 **TASK-005：Chrome 可执行路径、隔离 Profile、CDP 端口与安全进程归属**（REQ-006..009、TEST-006..009）。此前限定 Windows runner 的 CDP 技术 PoC 可复用，但不能代替正式模块或最终真实 Tampermonkey 兼容矩阵。


## （7）TASK-006 合并与 TASK-007 续接（2026-10-18）

[TASK-006 PR #7](https://github.com/devin930906/userscript-auto-healer/pull/7) 已合并到 main（合并 SHA `ee360dbdd936b92cc44609e7680d551fe364289d`；源 HEAD `824f9c89f673e0d05adbaf3084fd609f8e20eca0`）。正式实现 `src/observe/dom-observer.ts` 的受授权、自管 Chrome CDP DOM/iframe/shadow 可见性摘要、CSS 选择器命中数、同源 SPA 路由及异步 DOM 多次采样，保守标记未知区域和管理器功能未验证。增加 Page.getFrameTree 主框架来源在读取前后的核对，防止跨源导航被误当获准观察。Windows [Application Checks 39110563542](https://github.com/devin930906/userscript-auto-healer/actions/runs/39110563542) 对源 HEAD 的 58 项 Node 测试为 57 通过、0 失败、1 专项跳过，且真实 Electron smoke 成功；[Chrome 专项 39110563531](https://github.com/devin930906/userscript-auto-healer/actions/runs/39110563531) 与 [文档检查 39110563515](https://github.com/devin930906/userscript-auto-healer/actions/runs/39110563515) 均 success。此前安全加固引发的初始化竞态失败 [39110333660](https://github.com/devin930906/userscript-auto-healer/actions/runs/39110333660) 已通过先观察真实初始页面、再触发异步 SPA 测试夹具的最小修复解决，失败记录保留。

本阶段仅满足 TASK-006 的限定开发/Windows 验证，不等于完整用户网页与 Tampermonkey 脚本功能的 TEST/GATE 通过。当前优先进入 **TASK-007（REQ-017/018；TEST-017/018）真实 Tampermonkey 管理器适配与安全前置校验**。TASK-008..021、真脚本诊断修复与回滚、EXE+ZIP 及全量 Stable GATE 尚待执行。


## （7）TASK-007 第一阶段管理器探测并整合（2026-10-18）

[TASK-007 PR #9](https://github.com/devin930906/userscript-auto-healer/pull/9) 已合并至 main：`ca573cfc6a83d934b10d1de349d83311267ed642`（源 HEAD `f09e0e68fcb67c3dbdeb4b2b8fc48af250614bb0`）。新增 `src/manager/tampermonkey-adapter.ts` 与 `tests/manager/tampermonkey-adapter.test.ts`，在用户显式授权、应用自启动 Chrome 会话、回环端口/PID 验证下，以只读 CDP `Target.getTargets` 取得真实运行目标的**线索**。仅识别 Tampermonkey 扩展 ID 对应的 service_worker/background target，并明确将安装真实性、版本、脚本注入、GM API、业务断言全部标记未验证；未发现活跃扩展目标不能证明扩展未安装。没有安装/变更扩展或用户脚本。

[Windows Application Checks 39111259895](https://github.com/devin930906/userscript-auto-healer/actions/runs/39111259895) 已在源 HEAD 的 64 项 Node 测试中通过 63 项，0 失败，1 项专用 Chrome 路径检查跳过，真实隔离 Windows Chrome `Target.getTargets` 查询与 Electron smoke 均成功；[Chrome 专项 39111259835](https://github.com/devin930906/userscript-auto-healer/actions/runs/39111259835) success。此前一次测试夹具错误失败 [39111077113](https://github.com/devin930906/userscript-auto-healer/actions/runs/39111077113) 保留历史。**TASK-007 仍开发中**：安装/权限/版本核验与真实 Tampermonkey `GM_getValue`、脚本业务断言没有得到当前产品专项通过；TEST-017/018、后续 TASK-008..021 以及 Stable GATE 均尚有必要工作。

## （7）TASK-007 只读元数据前置检查增量（2026-10-18）

现有 `src/manager/tampermonkey-adapter.ts` 只能在受控 Chrome/CDP 下取得管理器运行目标线索，并不证明扩展已安装、已授权或 GM/业务动作成功。本轮 PR [#11](https://github.com/devin930906/userscript-auto-healer/pull/11) 续做 TASK-007 / REQ-017 / TEST-017：新增 `src/manager/tampermonkey-preflight.ts`，只校验用户显式同意、目标线索、*报告的* Tampermonkey ID/版本、启用和 userScripts 条件，以及静态元数据 `@grant GM_getValue` 与可保守确认的精确来源 `@match`；通配主机、排除规则和不确定路径一律阻断。新增 `tests/manager/tampermonkey-preflight.test.ts`，并入 `npm test`。成功结果仅为 `METADATA_ELIGIBLE_ONLY`，真实性、脚本实际安装、GM 调用与业务效果均保持 false；绝不能由用户可伪造的报告直接生成 VERIFIED。

代码源提交 `ab250732165b8635c88e68a52ffee8d371aa1e7a` 经过 [Windows Application Checks 39114195987](https://github.com/devin930906/userscript-auto-healer/actions/runs/39114195987)（72 个 Node 测试：71 通过、0 失败、1 专用路径跳过；真实 Electron smoke 成功），并经 [TASK-005 独立 Chrome 专项 39114195971](https://github.com/devin930906/userscript-auto-healer/actions/runs/39114195971) 成功验证。此前源提交 `14a9879` 的两项工作流因测试夹具 TypeScript 字面量类型错误而失败，已修复且保留历史。**TASK-007 仍开发中**，下一步仍须在授权独立 Tampermonkey 环境实际证实版本、安装、权限、脚本注入、GM_getValue 和业务断言；TEST-017/018 和全部 Stable GATE 尚未完成。PR #11 的实际合并状态需按 GitHub 实时核验。


## （7）TASK-007 临时 GM 证据交叉核对与路由竞态修复（2026-10-18）

本阶段复用已存在的 [PR #19](https://github.com/devin930906/userscript-auto-healer/pull/19)，在原本的临时自报 HTTP 与只读 DOM 观察之上增加保守的 `consistencySnapshot()` / `correlateManualFixtureEvidence()`：缺少任一浏览器访问、自报、DOM 样本，或两者业务动作矛盾／DOM 证据畸形时，禁止将一致性判为成功；即使两种证据吻合，也**只能**返回 `CONSISTENT_UNVERIFIED_FIXTURE_ONLY`，扩展真伪、脚本安装、GM API、业务恢复标志全部保持 false。重新观察前会撤销此前该模式的 DOM 快照，避免失败读数沿用旧阳性。

同次修复 `src/observe/dom-observer.ts` 原先仅按顶层网页来源确认 DOM 快照的缺口：先后读取的顶层 CDP URL 必须一致，若同源 SPA 导航发生于一个 DOM 采样窗口内则拒绝快照；只有稳定快照才能将实际最新 URL 与期望路由比较。分次观测的合法 SPA 路由变化仍可继续记录。测试包含假阳性自报、损坏样本、缺失样本与真实 Windows Chrome SPA 回归。

最新源 SHA `3b4585b0e6ec802b64624b39badff5dba42a6457` 的 [Windows Application Checks 39127069957](https://github.com/devin930906/userscript-auto-healer/actions/runs/39127069957) 状态 `success`，TypeScript 类型检查成功，Node 测试 90 项中 89 通过、0 失败、1 项环境条件跳过，真实 Windows Electron sandbox/preload smoke 成功。首次路由加固源 `0fa4838` 的 CI 因 TypeScript 可空帧判断失败，已在此 SHA 修复并完整复测；历史失败如实保留。**PR #19 仍须核对审核与正式合并，不能提前算作 main 已整合。** 本阶段完全没有安装真 Tampermonkey、没有验证实际 GM 调用或自动修复；TASK-007、TEST-017/018、GATE-004/005 仍未完整通过，TASK-008..021、正式 EXE+ZIP 均尚待按门槛开发。


## （7）TASK-007 目标元素动作归属校验（2026-10-18）

在既有 PR #19 已合并后的 TASK-007 限定取证路径中，继续收紧 TEST-018 阶段性 DOM 证据：除了 `#current-target` 唯一存在及 `[data-uah-probe-action="done"]` 动作计数，还要求复合选择器 `#current-target[data-uah-probe-action="done"]` 与动作计数严格一致。防止其他 DOM 元素被设置动作属性时误将其归属到唯一目标。新增错误归属及畸形计数的拒绝测试，并在隔离 Windows Chrome 负例中实际查询复合选择器。该修改仍不证明 Tampermonkey 身份、脚本注入、真实 GM API 或自动修复；TEST-017/018 与 GATE-004/005 仍未通过，正式测试须以对应提交的 Actions 实测结果为准。


## （7）TASK-008 故障分类与安全日志的独立阶段实现（2026-10-18）

由于 TASK-007 的真实 Tampermonkey 专项验收仍缺少获授权隔离环境证据，仅开展 TASK-008 不依赖前置真扩展的可隔离部分：新增 `src/diagnostics/fault-classifier.ts` 与对应 TEST-013 单元测试，并纳入已有 Windows Application Skeleton Checks 的 npm 测试命令。分类输入仅允许安全的信号代码和短证据 ID；不同故障类型同时存在返回 UNKNOWN，网络/权限/脚本异常绝不自动转为 DOM 修复。日志只在内存中存放结构化白名单字段并限制容量，不能处理原始脚本、凭据或页面数据。分类结果永不授权自动补丁或宣称真实 Tampermonkey / 业务恢复。**TASK-008 保持开发中**，待 TASK-007 完整验证后，仍需接入真实可验证诊断源及完成 TEST-013 的集成验证；TASK-009 不能视为已获准自动修复。此处不声明 CI 测试已通过，以最终 Actions 的实际执行为准。


### TASK-008 阶段实现已整合的真实验证记录（2026-10-18）

PR [#21](https://github.com/devin930906/userscript-auto-healer/pull/21) 已以合并 SHA `5832953a2980f65512bbac233dd67f218d896bac` 进入 main；分支源 SHA `fe1a4760017cdac22de5963852136e4ee36214d2` 的 [Application Skeleton Checks #39128955413](https://github.com/devin930906/userscript-auto-healer/actions/runs/39128955413) 为 success：TypeScript 类型检查、99 项 Node 测试（98 pass、0 fail、1 平台条件 skip；新增 9 项 TEST-013 单元负例全部 pass）、Windows Electron smoke 均通过；[Documentation Integrity #39128955367](https://github.com/devin930906/userscript-auto-healer/actions/runs/39128955367) 与 [TASK-005 便携 Chrome 专项 #39128955370](https://github.com/devin930906/userscript-auto-healer/actions/runs/39128955370) 同为 success。该结果仅证明离线故障信号分类与安全内存日志实现的代码测试，不能作为真实 Tampermonkey 运行时、TEST-013 集成验收、自动修复或 Stable GATE 完成证据。


## （7）TASK-008 / TEST-013 场景合约与自管 CDP 故障诊断接入（2026-10-18）

新增 `src/diagnostics/scenario-dom-diagnostic.ts`：沿用 TASK-004 的已授权场景预检、TASK-005/006 自管 Chrome/CDP 目标归属与只读观察、TASK-008 故障信号分类器；仅接受无需登录/主动步骤、最多 8 个唯一顶层 CSS `selector-present` 断言的场景。真实观察的选择器缺失只能生成 `SELECTOR_ASSERTION` 限定信号，全部存在只代表当前 DOM 未观察到缺失，不能证明油猴脚本成功。浏览器/CDP 失败、SPA 路由变化、输入异常、权限不符均返回 BLOCKED/UNKNOWN；不执行脚本、点击、持久化或自动改文件，不传出 URL/DOM/脚本 Hash。新增 Windows 真 Chrome+无扩展的独立负例，并加入 npm 测试。**此为待 CI 核验的部分诊断集成**，不满足完整 TEST-013、TEST-017/018 和 GATE；真实 Tampermonkey 与业务断言仍受阻。

## （7）TASK-008 / TEST-013 观察证据完整性加固并合并（2026-10-18）

[PR #24](https://github.com/devin930906/userscript-auto-healer/pull/24) 已合并到 `main`，合并提交 `843510150d18dec390519e69d0cc7decfd23d84c`。本轮仅收紧已有只读场景 DOM 故障分类：缺少明确的 `routeChanged:false`、存在未批准的额外选择器计数、DOM 节点总数无效或选择器数量超过节点总数，均拒绝接受为有效诊断观察。增加三组 TEST-013 负例，不执行脚本安装、文件修改或自动修复。首轮 CI [39131443350](https://github.com/devin930906/userscript-auto-healer/actions/runs/39131443350) 因测试夹具 TypeScript 联合类型访问错误失败，随后修复；源提交 `681ab55967e16181e17998703af5819a85eaa397` 的完整 Windows 应用检查 [39131544473](https://github.com/devin930906/userscript-auto-healer/actions/runs/39131544473) 已成功（TypeScript 通过；Node 共 107 项，106 pass、0 fail、1 环境条件 skip；真实 Windows Electron/IPC smoke 通过）。本记录不代表合并后 `main` 的 CI 自动通过，也不代表 TASK-008、正式 TEST-013、真实 Tampermonkey 或 Stable GATE 已完成。下一优先仍是 TASK-007 真实管理器/业务取证的阻断解除，并继续 TASK-008 后续真实故障根因集成。

## （7）2026-10-18 TASK-007 / TEST-018 真实管理器诊断的证据拒绝加固已整合

[PR #25](https://github.com/devin930906/userscript-auto-healer/pull/25) 在 `src/manager/tampermonkey-diagnostic.ts` 和 `tests/manager/tampermonkey-diagnostic.test.ts` 中收紧临时测试夹具的只读 DOM 样本入口：缺失/额外选择器计数、路由状态未明确、无效节点汇总与时间戳、畸形输入不再被认可为有效测试证据，且异常输入必须安全拒绝。源 HEAD `e05933d3850761c337605d7a4321b90928596245` 的 [Windows Actions #39132321986](https://github.com/devin930906/userscript-auto-healer/actions/runs/39132321986) success（108 项：107 pass、0 fail、1 skip；真正 Windows Electron/IPC smoke 成功）；合并至 main `836c39385f2306ed03ce5d357432d79adeb0af07`，该 SHA 的 [应用工作流 #39132472768](https://github.com/devin930906/userscript-auto-healer/actions/runs/39132472768) success。此项是阶段性证据安全修复，不验证真实 Tampermonkey 扩展/GM/业务，也不完成 TASK-007、TEST-017/018 或 GATE-004/005。

## （7）2026-10-18 TASK-008 / TEST-013 稳定多次 DOM 采样诊断已整合

[PR #26](https://github.com/devin930906/userscript-auto-healer/pull/26) 在 `src/diagnostics/scenario-dom-diagnostic.ts` 和 `tests/diagnostics/scenario-dom-diagnostic.test.ts` 中接入既有 TASK-006 自管 Chrome/CDP 多次观察：增加纯汇总与实际隔离浏览器采样入口，对短暂元素缺失、SPA 路由、DOM 数量、选择器数量、时间倒退和不可信汇总标记进行独立核对；变化中的证据返回阻断，而稳定样本仅给出 LIMITED_DOM_SIGNAL_ONLY。测试覆盖合成正/反例及 Windows Chrome 无扩展的真实只读多次采样。源 HEAD `b68c528cee076bc89c0e7544dc0fc23c16fcf498` 的 [Windows Actions #39132694315](https://github.com/devin930906/userscript-auto-healer/actions/runs/39132694315) success（110 项：109 pass、0 fail、1 skip；Windows Electron/IPC smoke 成功）。[PR #26](https://github.com/devin930906/userscript-auto-healer/pull/26) 已合并至 main `46be9e33775238caa942a47e1a346339d17b45a4`；合并后的 main SHA `46be9e33775238caa942a47e1a346339d17b45a4` 已在 [Application Skeleton Checks #39132821886](https://github.com/devin930906/userscript-auto-healer/actions/runs/39132821886) 成功（110 项 Node 测试，109 pass、0 fail、1 skip；Windows Electron/IPC smoke 成功）。真实 Tampermonkey 故障原因、TEST-013 完整集成、产品自动修复/回滚、正式 EXE+ZIP 和全部 Stable GATE 仍未完成。

## （7）TASK-009 / TEST-019 候选完整性独立复核（2026-10-18）

在现有保守 AST 定位器候选基础上增加 `auditProposedLiteralSelectorPatch`，面对序列化后可能被修改的候选重新计算唯一允许的修改，严格检查源版本 SHA-256、候选 SHA-256、修改前后坐标和文本、诊断 ID、完整源码以及不可自动应用的标志。拒绝额外权限字段、变化的 `@grant`、不可信访问器、伪造对象与过期输入；审阅收据仅返回不含源码的 `REVIEWABLE_ONLY` 或 `BLOCKED`，绝不授予写入、GM 验证或业务恢复认证。

开发源 HEAD `265503a107977928df737b1dabe5ca21c916a4d5` 的 [Windows Application Skeleton Checks #39142638654](https://github.com/devin930906/userscript-auto-healer/actions/runs/39142638654) 已完成 success：TypeScript 通过、Node 141 项中 140 pass / 0 fail / 1 条件 skip，实际 Windows Electron/preload 启动检查通过。关联 [PR #39](https://github.com/devin930906/userscript-auto-healer/pull/39)；合并及合并后主干的最新结果仍需以 GitHub 实际记录核验。此处仅为 TEST-019 单元阶段成果，TASK-007/008/009 尚未正式完成，TEST-017/018、TASK-010/011、自动写入/回滚、EXE+ZIP 和所有 Stable GATE 均未通过。

## （7）TASK-010 离线验收前置门槛阶段增量（2026-10-19）

[PR #43](https://github.com/devin930906/userscript-auto-healer/pull/43) 新增 `src/acceptance/acceptance-gate.ts` 和 `tests/acceptance/acceptance-gate.test.ts` 并纳入现有 Windows 应用回归。对受信任操作之前的只读候选，独立重建 AST 定位修改、比对源版本 SHA、拒绝未同意的操作、伪造管理器/GM/业务通过声明、任意扩展字段及篡改候选。只会返回 `AWAITING_TRUSTED_RUNTIME_AND_BACKUP` 或 `BLOCKED`，`automaticPatchAllowed/tampermonkeyVerified/businessRecoveredVerified` 固定 false，且回执不含脚本源码。源代码提交 `219757e6d78b9e6e80b2f41cbc375edb724f2709` 在 [Windows Application Checks #39146248924](https://github.com/devin930906/userscript-auto-healer/actions/runs/39146248924) 中已完成 TypeScript/Node 测试及真实 Electron smoke，且 [Chrome 专项 #39146248899](https://github.com/devin930906/userscript-auto-healer/actions/runs/39146248899) 成功。本记录为该已测试的源提交，不预判后续文档提交与合并后的 main 检查。

**限制**：`diskSourceSha256` 和 `userApproved` 在当前纯函数仍是调用方提供的初步声明，不能独立证明磁盘状态或真实同意。TASK-010 仅为**开发中**，未实现可信 Tampermonkey/GM/真实业务来源、备份事务及自动应用许可；TEST-018/021 的产品集成与 GATE 仍未通过。TASK-007/008/009 未完成的真实集成条件没有改变，后续应首先补齐可认证的真实运行证据，不能用本阶段纯逻辑测试替代。


## （7）TASK-011 / TEST-020 只读源文件身份阶段实现（2026-10-19）

PR [#44](https://github.com/devin930906/userscript-auto-healer/pull/44) 在 `src/version/source-snapshot.ts` 中增加独立的只读原文件一致性预检：必须获得来自受信任原生文件选择器的明确路径与调用方初步同意，拒绝符号链接、非 `.user.js`、越限长度、过期 SHA-256、异常输入及采样前后文件身份变化。新增 `tests/version/source-snapshot.test.ts` 以临时文件验证原字节不修改、无路径泄露与负面安全用例，并接入既有 Windows CI。源 SHA `31a31f111a7e6dbd35dbe454305d99431c1ad954` 的 [Application Skeleton Checks #39147314079](https://github.com/devin930906/userscript-auto-healer/actions/runs/39147314079) 为 success：TypeScript、151 项 Node 用例（150 pass / 0 fail / 1 skip）、真实 Electron 沙箱与 IPC smoke 通过；[独立便携 Chrome 检查 #39147314150](https://github.com/devin930906/userscript-auto-healer/actions/runs/39147314150) success。文件名/审批旗标并非可信授权令牌，本模块也不锁定后续写操作；未来写入必须在受信任事务中重新核对身份、备份、验证与原子提交。**PR 合并状态必须独立复核；TASK-011 整体仍开发中，完整 TEST-020、TASK-010 真管理器/业务验收和 Stable GATE 仍未完成。**

## （7）TASK-011 / TEST-020 备份-only 阶段增量（2026-10-19）

[PR #45](https://github.com/devin930906/userscript-auto-healer/pull/45) 在已整合的原脚本只读指纹检查之后新增 `src/version/verified-backup.ts` 与 `tests/version/verified-backup.test.ts`：仅对受信任原生选择与初步授权的 `.user.js`，重新读取并校验文件身份/字节 SHA-256，在用户选定的目录创建随机唯一名称的私有暂存副本、`fsync`、验证暂存哈希，再以无覆盖硬链接发布并复核内容；若文件系统不支持必要操作则保守拒绝。未知授权、过期源文件、超限脚本、符号链接与异常输入均拒绝，原脚本永不被此模块写入。Windows CI 结果须以 PR 当前 SHA 和 Actions 实际状态为准。

**TASK-011 仍为开发中**：该阶段备份副本不代表崩溃恢复版本库、原子应用、回滚、独立确认的用户授权或 Tampermonkey/GM/业务验收；不向 renderer 暴露任意文件路径接口。TEST-020 的真正写入中断/冲突/文件锁/回滚、TEST-021、TASK-010 可信运行门槛、EXE/ZIP 与 Stable GATE 均未完成。

## （7）TASK-011 恢复来源核验增量（2026-10-19）

继 [PR #45](https://github.com/devin930906/userscript-auto-healer/pull/45) 已合并的备份-only 阶段，新增 [PR #46](https://github.com/devin930906/userscript-auto-healer/pull/46) 的 `src/version/recovery-source.ts` 与 `tests/version/recovery-source.test.ts`。在真实隔离测试文件上，按明确指定的备份名/目录、预期 SHA-256/长度只读核查副本，并拒绝伪造硬链接、符号链接、篡改副本及不可信输入。该收据只能证明当前观察时的恢复来源完整性，**不是可信授权、不能代替事务锁、自动写入或回滚许可**；文件可能在检查后再次变化。CI 实际执行结果以 PR 和目标提交 Actions 为准。

**TASK-011 继续开发中**；剩余：经独立核实的文件选择和授权、排他锁、原子/可恢复写入、操作日志、冲突恢复、真实失败回滚及同版业务验收。TASK-007/010、TEST-017/018/020/021 与正式 EXE/ZIP/GATE 均未因此解除。

## （7）TASK-010／TASK-011 本地审核与备份链路集成（2026-10-19）

[PR #48](https://github.com/devin930906/userscript-auto-healer/pull/48) 复用已存在的候选 AST/diff 审查、磁盘原字节 SHA-256 指纹、仅备份副本和只读恢复来源检查，在 `src/acceptance/local-backup-preflight.ts` 中增加受信任原生调用方专用的串行预备流程：先审核候选与源版本，再从磁盘独立校验相同原文，写入不覆盖的备份，重新校验备份副本与源文件。新增 `tests/acceptance/local-backup-preflight.test.ts` 并纳入 npm 测试。测试涵盖真实临时磁盘文件、外部修改的过期原文、伪造候选/授权字段、恶意访问器、符号链接备份目录。源提交 `3ef164150d66eea542bc741e27e1802181fc5227` 的 [Windows 应用 CI #39151296629](https://github.com/devin930906/userscript-auto-healer/actions/runs/39151296629) 已完成 success（164 项：163 pass／0 fail／1 条件 skip；Windows Electron 沙箱与 IPC smoke 通过）；[独立便携 Chrome CI #39151296637](https://github.com/devin930906/userscript-auto-healer/actions/runs/39151296637) success。此证据仅对应所列源 SHA；PR 合并及后续 main CI 以 GitHub 新记录为准。

**TASK-010／011 仍开发中**：该流程只是有实际磁盘副本的本地审核准备，不是独立身份认证、持久事务锁、崩溃恢复日志、自动应用、真实回滚、Tampermonkey 扩展/GM/业务验收；任意正向回执仍然将自动写入与回滚许可固定为 false。完整 TEST-017/018/020/021、GATE-004..007 与正式 EXE+ZIP/GATE-008/009/011 均未通过。下一阶段仍须优先取得可信真实 Tampermonkey 业务证据，再在独立安全事务设计下实施与验证写入/回滚；不得基于本回执写原脚本。

## （7）TASK-011 / TEST-020 原生同源互斥与来源绑定阶段（2026-10-19）

- PR [#51](https://github.com/devin930906/userscript-auto-healer/pull/51) 和 [#52](https://github.com/devin930906/userscript-auto-healer/pull/52) 修正备份名称只按截断源文件名、同名跨目录识别可能混淆的问题；以完整原生选择的来源路径哈希在备份名中绑定来源，旧命名备份保留但不自动受信。`main` 合并 SHA 分别为 `a50919b235bf8507e877a278cc39e2bc99d7898e`、`09b43d65e2231c38c7bf3c5eb323aae871d05533`。
- PR [#53](https://github.com/devin930906/userscript-auto-healer/pull/53) 新增 `src/version/native-source-lock.ts`，在受信任原生调用者发起备份-only 时以原文件系统 dev/ino 身份创建排他目录锁，碰到并发或遗留锁时拒绝，不自动回收；检查来源身份并在完成或异常时有条件清理自身的空锁目录。新增 `tests/version/native-source-lock.test.ts` 和真实备份调用互斥负例。源 HEAD `3694c9529475ff0ccf015ad65ee347ed781ee005` 的 [Windows Application Checks #39154527043](https://github.com/devin930906/userscript-auto-healer/actions/runs/39154527043) 通过 173 项 Node 测试（172 pass、0 fail、1 skip）、TypeScript 和 Electron smoke；[便携 Chrome 专项 #39154527118](https://github.com/devin930906/userscript-auto-healer/actions/runs/39154527118) 成功。PR #53 合并到 `main` 为 `b53350ad64773a732b3625a5dfc7651fa24e7637`；合并提交须以独立主干 CI 复核。
- **仍为开发中，未达完整 TEST-020/021/GATE-007**：此为本应用协作式锁，不是第三方编辑器强制文件锁；尚未具备独立原生授权、正式持久事务日志、原子候选应用、崩溃恢复、实际字节回滚及 Tampermonkey/GM/业务验收。没有授予自动补丁或自动恢复写入权限，也没有生成 EXE/ZIP 正式发行包。

## （7）TASK-007 / TEST-017 独立测试脚本导入地址增量（2026-10-19）

在现有 `startIsolatedTampermonkeyGmProbe` 的短时、本机回环测试服务上，增加具有独立随机 256-bit URL 令牌的 `installUrl`，仅向该地址以 GET 返回与 `source` 一致的临时测试 .user.js；对错误令牌、额外参数、非 GET、无关 Origin 和过期/已关闭会话拒绝提供脚本。Tampermonkey 可由获授权测试人员在**独立 Profile 中手动尝试“从 URL 导入”**；是否被真实 Tampermonkey 接受、安装与执行必须另行真实取证。URL 本身包含短时保密令牌，不得上传日志或分享；下载成功不能证明扩展真实安装、GM API 调用或业务恢复。测试代码位于 `tests/manager/tampermonkey-gm-probe.test.ts`。**TASK-007 依然开发中，TEST-017/018 与 GATE-004/005 不因此通过；不得将此接口暴露为自动安装脚本的 renderer IPC。**


## （7）TASK-007 一次性脚本运行时到期门槛增量（2026-10-19）

在既有 `src/manager/tampermonkey-gm-probe.ts` 生成的授权短期诊断脚本中增加 **客户端运行时到期拒绝**：服务过期不再是唯一停用机制，临时脚本即使遗留在测试管理器中，也会在正常系统时间达到已核实的绝对过期时间时，在 GM、DOM 与网络副作用之前直接退出。回归位于 `tests/manager/tampermonkey-gm-probe.test.ts`。先见 [测试先行红灯 CI #39158174162](https://github.com/devin930906/userscript-auto-healer/actions/runs/39158174162)，再见代码提交 `46880b3ae2a1b72f260ef07bd5caaed32dcae619` 的 [Windows 绿灯 CI #39158298596](https://github.com/devin930906/userscript-auto-healer/actions/runs/39158298596)。关联 PR [#58](https://github.com/devin930906/userscript-auto-healer/pull/58)，实际合并及后续 main 复核以 GitHub 记录为准。**TASK-007 继续开发中**：本项不证明 Tampermonkey 本体、GM_getValue 真实执行、真正业务恢复、产品自动修复/回滚或完整 TEST/GATE；原 TASK/REQ/TEST 编号和任务依赖保持不变。

## （7）TASK-008 / TEST-013 自管 Chrome 被动网页异常信号（2026-10-19）

[PR #62](https://github.com/devin930906/userscript-auto-healer/pull/62) 已实际 squash 合并至 `main`（`a92b202cd6c6d2857dd41f6896b60395f58d282b`）。新增 `src/diagnostics/cdp-page-exceptions.ts` 与 `tests/diagnostics/cdp-page-exceptions.test.ts`，在应用自管、当前验证归属的 Chrome/CDP 页面上按用户同意限定采样时间被动接收 `Runtime.exceptionThrown`。观察期间发生页面导航、身份/授权失败、超量或畸形事件一律保守拒绝；仅留故障类别和不含网页内容的有限证据 ID，不保存异常文本、堆栈、源码、完整 URL，也不执行注入脚本、修改文件或开启自动补丁。采样期间无异常只代表窗口没有记录异常，绝不判断产品健康。

Windows 源 SHA `14c51715435da5ec02ff07347f37d772f0bf70b6` 的 [应用工作流 #39161618594](https://github.com/devin930906/userscript-auto-healer/actions/runs/39161618594) 在第二次、仅失败 Job 的复测成功（Node 187 项、186 pass、0 fail、1 条件 skip；真实 Electron smoke 通过）；[独立便携 Chrome #39161618348](https://github.com/devin930906/userscript-auto-healer/actions/runs/39161618348) success。第一次应用工作流因新测试初始路由时序未稳定失败，增加保守起始帧就绪预检；第二次首次执行又遭原有 TEST-018 Chrome/CDP DOM 负例瞬时失败，复测正常，该失败仍保留在 Actions 历史。[合并后 main 工作流 #39161972219](https://github.com/devin930906/userscript-auto-healer/actions/runs/39161972219) success，验证对象为上述合并 SHA。

**TASK-008 继续开发中，TEST-013 仅为有限网页异常诊断的阶段性实证**：异常来自被授权观察的网站页面，无法独立归因 Tampermonkey 或油猴脚本；未建立真正管理器安装、GM API、业务断言、自动修复或回滚可信证据。TASK-007/008/010、TEST-017/018 与 GATE-004/005 等正式门槛仍受阻；EXE/ZIP 正式产物未形成。

## （7）TASK-009 / TEST-019 外部元数据候选拒绝（2026-10-19）

[PR #69](https://github.com/devin930906/userscript-auto-healer/pull/69) 已合并至 `main`，合并 SHA `13d02d544f8779732df02160115ca14abbe9dd46`。修复 `src/repair/scenario-candidate.ts`：即使 @match 与授权场景一致，携带未核实的 `@require`、`@resource`、`@connect`、`@updateURL`、`@downloadURL` 或未识别元数据的脚本，也不能仅凭只读 DOM 样本生成修复候选；无源码、私密页面内容或自动操作写入。

先行测试提交 `3b56e1d93aed2401975e161a48889219cbb44ec7` 的 [Windows CI #39167672723](https://github.com/devin930906/userscript-auto-healer/actions/runs/39167672723) 因真实复现 `@require` 不当返回 `CANDIDATE_ONLY` 而失败；修复提交 `5a645676176f815a45d1e599778be43386e8ba49` 的 [Windows CI #39167770757](https://github.com/devin930906/userscript-auto-healer/actions/runs/39167770757) 已完成成功：TypeScript、195 项 Node（194 pass、0 fail、1 条件 skip）、真实 Electron sandbox/preload IPC smoke。合并后主干 CI 需要按最终 SHA 重新复核。本修复仅推进 TEST-019 安全负例，不代表 TASK-009 完结；可信 Tampermonkey/GM/业务验收、自动补丁应用与回滚、TASK-019/020 EXE+ZIP 以及全部 Stable GATE 仍未完成。

## （7）TASK-007 / TEST-017 临时 GM 夹具桌面入口（2026-10-19）

[PR #70](https://github.com/devin930906/userscript-auto-healer/pull/70) 已合并至 `main`，合并 SHA `8c9e1ca71d4008254457234ad2bf40a19634f4b7`。应用窗口现在可在实际本程序拥有的独立 Chrome/CDP 会话成立后，经独立原生同意对话启动已有 `startIsolatedTampermonkeyGmProbe` 的最长五分钟回环夹具，显示供测试员自行在隔离 Tampermonkey 中“从 URL 导入”的一次性地址和固定 broken/fixed 测试页，并查看有限、自报、不可信的 HTTP 回执或主动关闭夹具；独立 Chrome 停止/窗口退出时请求关闭测试服务。临时脚本**不会自动安装或清理**，测试后需手动移除。应用没有公开任意脚本读写、URL 导航、权限提升或自动补丁入口。

阶段证据：PR 源 SHA `ffb78005c991805ec019cf542917a727d2a5b722` 的 [Windows Application Skeleton Checks #39168605006](https://github.com/devin930906/userscript-auto-healer/actions/runs/39168605006) 已成功完成 TypeScript、Node 全部适用回归与真实 Electron sandbox/preload IPC smoke（含未启动独立 Chrome 时新增 GM 控件的拒绝）。合并后 `main` 的 CI 需另行读取，不能凭来源 CI 宣称合并基线已再次测试。此次没有在 CI 正式加载 Tampermonkey、安装临时脚本、实际调用 `GM_getValue`、取得独立 GM/业务证据、生成自动修复/回滚或 Windows EXE/ZIP 发行包；用户手动正向界面路径亦尚未实测。完整 TASK-007/TEST-017/018、GATE-004/005 及最终 Stable 依旧受阻。

## （7）TASK-009／TASK-010／TASK-011：已审核候选脚本独立暂存（2026-10-19）

沿用既有的 AST 保守候选审核和本地原文件哈希／备份-only 链路，新增 `src/version/staged-candidate.ts`、`tests/version/staged-candidate.test.ts`，并加入现有 `npm test`。仅在原生调用方已选择来源/备份路径、候选经过独立审核、原字节和备份可重检的前提下，使用来源文件互斥锁，安全发布独立的 `*.candidate.user.js` 文件。候选与原始备份分开，使用唯一名称、无覆盖硬链接发布与读回 SHA-256；原始 `.user.js` 完全不写入。无效审批声明、伪造候选、过期源文件、硬链接和锁冲突均有拒绝用例。

新旧 TASK/REQ/TEST 编号不变：关联 TASK-009/010/011、REQ-019/020/021、TEST-019/020/021。受并行 PR #74 影响，本阶段已把路径边界改动合入开发分支重新验证，应用工作流 [#39173202396](https://github.com/devin930906/userscript-auto-healer/actions/runs/39173202396) 在源 SHA `14d6871a7b8783d75490c3519e24927e28a3b525` 通过 TypeScript、206 项 Node 测试（205 pass／0 fail／1 条件 skip）、真实 Windows Electron smoke；便携 Chrome 专项 [#39173202380](https://github.com/devin930906/userscript-auto-healer/actions/runs/39173202380) 为 success。本结果是**候选文件真实暂存与拒绝安全测试的有限阶段成果**，不是自动修复、来源真实独立授权、Tampermonkey/GM/业务验收、恢复事务或 GATE 通过。自动修改、自动回滚、Tampermonkey/业务 Verified 仍固定为 false；中断后可能保留等待人工核验的独立候选或备份文件，正式崩溃恢复/原子应用另行实现。PR #75 是否整合需以 GitHub 合并记录为准。
