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
| TASK-007 | 真实 Tampermonkey 管理器适配 | REQ-017;REQ-018 | 必须实现 | TASK-004..006;POC-02T 或经验证的安全授权加载路径 | src/manager tests/manager | 预计新增：src/manager/tampermonkey-adapter.ts；tests/manager/tampermonkey-e2e.test.ts | 核验真实 Tampermonkey 身份/版本、注入模式、用户授权、脚本安装执行及 GM 调用；其他管理器单独适配 | 可复核 Tampermonkey 运行证据 | TEST-017;TEST-018 | 测试有实际通过证据 + 代码审查 + 提交记录 | 开发中（目标探测、静态预检、临时诊断及独立 DOM 对照已有阶段成果；真实 Tampermonkey GM／业务验收未完成） |
| TASK-008 | 故障根因与日志中心 | REQ-013 | 必须实现 | TASK-003;TASK-006;TASK-007 | src/diagnostics tests/diagnostics | 预计新增：src/diagnostics/fault-classifier.ts；tests/diagnostics/fault-classifier.test.ts | 分类非 DOM、JS 异常与业务断言；日志脱敏 | 结构化故障证据 | TEST-013 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
| TASK-009 | 本地多级修复 | REQ-014;REQ-019 | 必须实现 | TASK-008 | src/repair tests/repair | 预计新增：src/repair/patch-planner.ts；tests/repair/patch.test.ts | 测试最小选择器修复/拒绝扩权与未知场景 | 可审核补丁候选 | TEST-014;TEST-019 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
| TASK-010 | 自动验收与门控 | REQ-018;REQ-021 | 必须实现 | TASK-007;TASK-009 | src/acceptance tests/acceptance | 预计新增：src/acceptance/acceptance-gate.ts；tests/acceptance/gate.test.ts | 实现真实证据/业务断言与 UNKNOWN 拦截 | 验收决定和证据链 | TEST-018;TEST-021 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
| TASK-011 | 备份、原子写入、版本和回滚 | REQ-020;REQ-021 | 必须实现 | TASK-002;TASK-010 | src/version tests/version | 预计新增：src/version/version-store.ts；tests/version/rollback.test.ts | 写崩溃/文件锁/冲突测试，再实现备份事务/回滚 | 可恢复版本库 | TEST-020;TEST-021 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
| TASK-012 | 导出及管理器内版本状态 | REQ-023 | 必须实现 | TASK-007;TASK-011 | src/export tests/export | 预计新增：src/export/script-exporter.ts；tests/export/export-e2e.test.ts | 明确磁盘产物与扩展内更新区分并真实验证 | 导出与更新记录 | TEST-023 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
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
