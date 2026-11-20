# 正式开发实施计划

> 实际续接使用 [原始需求校准](product-rebaseline.md)，TASK-005 → #856，TASK-013 → #857。历史表保留，不能据此将阶段成果标记为本轮完成。

> 当前需求验收补充（不重编号）：REQ-008 的 CDP 默认 9896、实际 Chrome++/闲置 Profile 与监听归属 → TASK-005 / #856 / TEST-006..009；真实 Tampermonkey 及获授权的扩展/脚本安装 → TASK-007/012 / #486 #603 / TEST-017/018/023；同一受控浏览器的真实业务断言、保守自动修复、备份与可恢复回滚 → TASK-009..013 / #487 #488 #489 #603 #857 / TEST-014/018..023；可选 AI 双接口接入 → TASK-014 / #604 / TEST-015/016；普通用户一次启动的批处理与逐项结果 → TASK-013/017 / #857 #607 / TEST-002/022。现有“已完成并整合”只描述历史子范围，不证明上述产品级增量验收已经完成。

> 最新续接（2026-11-16）：TASK-014 的原生桌面 mock flow 与 review 授权取消竞态测试已随 PR [#895](https://github.com/devin930906/userscript-auto-healer/pull/895) 合并到 `main@d8d0bf7223d128f3839400689b2d1f935e52fe2e`。该增量复用实际 IPC 调用的 main-process 协调器，定向 AI/桌面边界测试 99/99 通过，PR 与合并后 Application Checks 成功。它未接入真实批处理、故障诊断或候选生成；TASK-009/TASK-013 依赖和 TEST-015/016 全范围仍未满足，Issue #604 保持 Open。

> 历史状态快照（2026-10-26）：（4）有条件准入并完成交接，（7）已有 Electron+TypeScript 产品源码、受控 Chrome、AST、手动候选导出、只读持久批处理及 Windows 开发候选 EXE＋ZIP。当日 `main@c3c28451636400a4228688d7354c8f42ba0ccbca` 的应用回归 #40272189600 成功；隔离 Tampermonkey 矩阵 #40270144017 对应历史 SHA `35033f74` 成功。此历史快照不是当前主干状态；当前 Stable 缺口以本文件后续 TASK 记录、`docs/12-handoff.md` 与 `docs/14-stable-work-register.md` 为准。

## 开发阶段
M0：证实 Chrome/管理器/交付可行性；M1：可运行安全入口+导入+静态分析；M2：动态诊断与真实管理器验收；M3：修复/版本/批处理/AI/监控/共享层；M4：风险/性能/集成与 Windows 双包装；M5：全部 Stable 门槛和 Release。未人为指定发布日期。

## 里程碑
M0 退出：系统与独立路径 Chrome/CDP POC-01A/B 已实测，且 POC-02D 在隔离 Windows Chromium/Violentmonkey 2.49.0 对标准 HTTPS 页实测 .user.js 注入及 GM_getValue 实际调用（https://github.com/devin930906/userscript-auto-healer/actions/runs/39092523277）。首选 Tampermonkey 已由 I-011/ADR-005 确认，ADR-001 的 Electron+TypeScript 为 TASK-001 有条件工程决策；真实用户浏览器 POC-02T-LIVE 的 GM_getValue 和人工 broken/fixed 业务断言亦已记录。完整 Windows/Chrome/便携/Profile 支持矩阵及真实失效脚本回归是对应后续开发阶段任务，不能假称已通过。POC-03A 与历史 POC-03B 仅证明相应临时工具链可行；现行 POC-03C 已在 Windows Actions 实测 ZIP 工具链，正式 EXE 与 ZIP 应用包安装/直启属于发布门槛（可晚于初始代码，不得晚于发布）；M1 退出：TEST-001..005/011/026 的可重复结果；M2：CDP+管理器 TEST-006..013/017/018 的真实证据；M3：TEST-014..025；M4：安全恢复及 EXE/ZIP 正式产品测试；M5：所有 GATE 实证通过。

## 任务清单
| 编号 | 目标 | 关联需求 | 优先级 | 前置依赖 | 实施模块 | 预计文件范围 | 具体执行步骤 | 交付结果 | 测试编号 | 完成条件 | 状态 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TASK-001 | 建立已确定技术骨架与安全入口 | REQ-001;REQ-026 | 最优先 | POC-01/02 与 ADR-001 可用 | app/main app/preload app/ui | 预计新增：app/main/index.ts；app/preload/index.ts；app/ui/index.tsx；tests/security/desktop-boundary.test.ts | 创建最小进程隔离与配置验证测试；运行类型与安全测试 | 可受控启动的开发壳 | TEST-026 | 测试有实际通过证据 + 代码审查 + 提交记录 | 已完成并整合 |
| TASK-002 | 脚本导入与路径安全 | REQ-001..003 | 必须实现 | TASK-001 | src/import tests/import | 预计新增：src/import/import-service.ts；tests/import/import-service.test.ts | 写目录/编码/路径负例再实现批量导入 | 原字节保留与文件清单 | TEST-001..003 | 测试有实际通过证据 + 代码审查 + 提交记录 | 已完成并整合（阶段验证；PR #102 补原生跨路径 SHA-256 原字节去重及限定重复文件实际读盘预算；正式整合及 CI 须以 GitHub 记录核实） |
| TASK-003 | 元数据与 AST 定位器 | REQ-004;REQ-011 | 必须实现 | TASK-002 | src/analyze tests/analyze | 预计新增：src/analyze/metadata-parser.ts；src/analyze/selector-analyzer.ts；tests/analyze/ast.test.ts | AST 夹具先行，提取匹配/作用域/动态标记 | 静态证据报告 | TEST-004;TEST-011 | 测试有实际通过证据 + 代码审查 + 提交记录 | 已完成并整合（静态分析阶段） |
| TASK-004 | 网站与验证场景登记 | REQ-005 | 必须实现 | TASK-003 | src/scenarios tests/scenarios | 预计新增：src/scenarios/scenario-registry.ts；tests/scenarios/registry.test.ts | 设计登录/操作/断言契约与缺失状态 | 可管理的测试场景 | TEST-005 | 测试有实际通过证据 + 代码审查 + 提交记录 | 已完成并整合（场景契约阶段） |
| TASK-005 | Chrome/Profile/CDP 安全启动 | REQ-006..009 | 必须实现 | TASK-001;POC-01 | src/browser tests/browser | 预计新增：src/browser/chrome-launcher.ts；src/browser/cdp-session.ts；tests/browser/launch.test.ts | 先写默认 Profile/占用/错实例失败测试，再写自管启动与身份核对 | 仅接入授权 Chrome | TEST-006..009 | 测试有实际通过证据 + 代码审查 + 提交记录 | 已完成并整合（签名 Chrome/独立路径阶段验证；最终用户兼容 GATE 仍待验收） |
| TASK-006 | DOM/SPA 动态观测 | REQ-010;REQ-012 | 必须实现 | TASK-005 | src/observe tests/observe | 预计新增：src/observe/dom-observer.ts；tests/observe/dynamic.test.ts | 盲区和延迟/SPA 夹具驱动 CDP 观测 | 可见性快照 | TEST-010;TEST-012 | 测试有实际通过证据 + 代码审查 + 提交记录 | 已完成并整合（阶段验证） |
| TASK-007 | 真实 Tampermonkey 管理器适配 | REQ-017;REQ-018 | 必须实现 | TASK-004..006;POC-02T 或经验证的安全授权加载路径 | src/manager tests/manager | 预计新增：src/manager/tampermonkey-adapter.ts；tests/manager/tampermonkey-e2e.test.ts | 核验真实 Tampermonkey 身份/版本、注入模式、用户授权、脚本安装执行及 GM 调用；其他管理器单独适配 | 可复核 Tampermonkey 运行证据 | TEST-017;TEST-018 | 测试有实际通过证据 + 代码审查 + 提交记录 | 开发中（目标探测、静态预检、临时诊断及独立 DOM 对照已有阶段成果；原生 Chrome/Profile 选择、独立 CDP 启动授权与只读管理器运行目标提示已在 PR #66 整合；新建空 Profile 入口正在阶段验证；；PR #79 已整合；PR #81 补足 document-body / document-end 的严格本机测试夹具选择和延迟 DOM 取证（此为未验证的管理器运行时辅助功能，须核对当前 CI 与合并状态）；真实 Tampermonkey GM／业务验收未完成）；PR #151 已合并 main 09acca1e46ce0ab8d141809ec7ea04a508a32ca3，修复诊断 DOM CDP 页面套接字在 CONNECTING 阶段未立即响应撤销授权的缺陷；PR 应用检查 #39372158090 与 Windows 候选双包 #39372158077 通过，350 项 349 pass/0 fail/1 skip；仅解决连接期取消，不是 Tampermonkey/GM/业务 VERIFIED，TASK-007 仍开发中 PR #886 merged main@7c02f828ba781677629634b0947c7e729b1c170b；Windows matrix #43822893465 21 Job success，product-candidate/document-idle 22/22 pass。证据仅为 synthetic unpacked CRX metadata hint，真实性/Store/脚本安装注入/GM/业务 flags=false；#486 仍 Open，TEST-017/018 与 GATE-004/005 未通过。用户授权的 Chrome Browser MCP Profile 上另完成本地 ChatGPT Prompt Flow 1.0.51 单条 TXT 导入、发送与预期短句回复样本；文件输入由页面 File 对象触发，非原生选择器；这不是 UAH 产品自动修复/回滚，#486、TEST-017/018 与 GATE-004/005 仍未完成（见 `docs/evidence/2026-11-17-chatgpt-prompt-flow-1.0.51-mcp-acceptance.md`）。 |
| TASK-008 | 故障根因与日志中心 | REQ-013 | 必须实现 | TASK-003;TASK-006;TASK-007 | src/diagnostics tests/diagnostics | 预计新增：src/diagnostics/fault-classifier.ts；tests/diagnostics/fault-classifier.test.ts | 分类非 DOM、JS 异常与业务断言；日志脱敏 | 结构化故障证据 | TEST-013 | 测试有实际通过证据 + 代码审查 + 提交记录 | 开发中（分类/安全日志、限定 CDP DOM 诊断及被动网页 JS 异常观察均已有阶段实现；真实 Tampermonkey 诊断源和完整集成待完成） |
| TASK-009 | 本地多级修复 | REQ-014;REQ-019 | 必须实现 | TASK-008 | src/repair tests/repair | 预计新增：src/repair/patch-planner.ts；tests/repair/patch.test.ts | 测试最小选择器修复/拒绝扩权与未知场景 | 可审核补丁候选 | TEST-014;TEST-019 | 测试有实际通过证据 + 代码审查 + 提交记录 | 开发中（AST 定位器候选及稳定多次只读 DOM 诊断关联已实现；输入仍非真实 Tampermonkey/GM/业务验证，缺授权管理器证据、端到端集成和自动应用门控）；新增独立原生只读 DOM 故障→AST 审核→备份/候选暂存→手动导出串联，仍无真实管理器和业务 VERIFIED |
| TASK-010 | 自动验收与门控 | REQ-018;REQ-021 | 必须实现 | TASK-007;TASK-009 | src/acceptance tests/acceptance | 预计新增：src/acceptance/acceptance-gate.ts；tests/acceptance/gate.test.ts | 实现真实证据/业务断言与 UNKNOWN 拦截 | 验收决定和证据链 | TEST-018;TEST-021 | 测试有实际通过证据 + 代码审查 + 提交记录 | 开发中（TEST-021 离线验收前置拒绝门槛已实现并通过 Windows 阶段测试；真实管理器/业务验收与备份后才可继续） |
| TASK-011 | 备份、原子写入、版本和回滚 | REQ-020;REQ-021 | 必须实现 | TASK-002;TASK-010 | src/version tests/version | 预计新增：src/version/version-store.ts；tests/version/rollback.test.ts | 写崩溃/文件锁/冲突测试，再实现备份事务/回滚 | 可恢复版本库 | TEST-020;TEST-021 | 测试有实际通过证据 + 代码审查 + 提交记录 | 开发中（只读源核验、备份-only、恢复来源只读校验与本应用原生协作式文件身份互斥锁已在 PR #44–53 分阶段整合；新增独立备份/候选的非授权持久恢复检查点与负例（仅阶段验证，不等于原子事务或可恢复权限）；仍未实现可恢复事务写入/回滚/真实 Tampermonkey 业务验收；完整 TEST-020/021 和 GATE-007 未通过）；PR #160：在原生人工候选流程中增加原始版本独立导出，以保留可手动检查/重新安装的原字节脚本；此阶段仍不修改原文件或 Tampermonkey，绝非真实自动回滚；当前 PR 的最终 CI 与整合须独立确认。 |
| TASK-012 | 导出及管理器内版本状态 | REQ-023 | 必须实现 | TASK-007;TASK-011 | src/export tests/export | 预计新增：src/export/script-exporter.ts；tests/export/export-e2e.test.ts | 明确磁盘产物与扩展内更新区分并真实验证 | 导出与更新记录 | TEST-023 | 测试有实际通过证据 + 代码审查 + 提交记录 | 开发中（已增加受限的原生只读复核→独立手动 .user.js 导出；不更新 Tampermonkey 内已安装版本，不提供真实 TEST-023/GATE 验收）；已接入受限只读 DOM 诊断至手动导出的本地服务链，仍未接入正式 UI 或扩展内更新；PR #160：现有桌面已接入的人工导出增加同目录原始恢复文件名及受限回执，仅供人工恢复；真实管理器安装、版本同步及 TEST-023 正式 E2E 仍未完成。 |
| TASK-013 | 批处理、取消、限次重试 | REQ-022 | 必须实现 | TASK-008..012 | src/jobs tests/jobs | 预计新增：src/jobs/batch-coordinator.ts；tests/jobs/resume.test.ts | 实现脚本独立状态与中断恢复故障注入 | 隔离任务队列 | TEST-022 | 测试有实际通过证据 + 代码审查 + 提交记录 | 开发中（内存只读队列、按脚本隔离终态、有限重试、取消及无授权恢复检查点阶段实现；新增仅以原生校验后的有序脚本 SHA-256 列表生成批次指纹，恢复时须匹配同一批次，旧无身份检查点不得直接恢复跳过任务；此指纹不是防伪凭据且不授权任何写入；未接入真实脚本处理、持久事务或 UI，TEST-022 与 GATE-007 尚未最终通过；PR #150 已合并 main 30d716eafe9a97edf05f4ab00558baefeecfa9b0：只读批处理检查点升级为 v2，恢复时必须匹配原有 timeoutMs，旧 v1 与超时策略不匹配的检查点安全拒绝；Windows #39370945409 与候选工作流 #39370945321 成功，共 347 项测试 346 pass / 0 fail / 1 skip；实际持久任务队列/真实用户脚本仍未接入，完整 TEST-022/GATE-007 未通过）；本轮原生文件/文件夹导入接入逐文件只读计数（完成数、接受数、重复数、失败数）及已完成 AST Worker 分段计数；仅供当前窗口的临时进度显示，不是持久任务队列或跨启动恢复，TEST-022/GATE-007 仍未完成。 |
| TASK-014 | AI 连接、模型发现与成本限制 | REQ-015;REQ-016 | 必须实现 | TASK-009;TASK-013 | src/ai tests/ai | 预计新增：src/ai/model-gateway.ts；tests/ai/gateway.test.ts | 先模拟请求与泄密负例，后实现可选网关 | AI 候选接入 | TEST-015;TEST-016 | 测试有实际通过证据 + 代码审查 + 提交记录 | 开发中（可选 AI 网关默认断网，提供 Chat Completions/Responses、模型发现与手动回退、单会话限次/超时/取消、摘要哈希外发及不可信文字输出；PR #883 已接入原生发现/确认路径，PR #893 已使确认框展示与所选协议及自定义 base-path 一致的完整 POST URL，并拒绝空 query/fragment 分隔符。PR head Windows Application Checks #43858568343 与合并后 main@5edebd67 的 #43860109349 成功。实际批处理、诊断和候选生成流程尚未接入；TASK-009/TASK-013 依赖仍在，#604 保持 Open，TEST-015/016 与相关 GATE 未通过） |
| TASK-015 | 健康监控与历史 | REQ-024 | 必须实现 | TASK-010;TASK-013 | src/health tests/health | 预计新增：src/health/health-registry.ts；tests/health/registry.test.ts | 实现按授权复检和按证据判健康 | 时间线监控 | TEST-024 | 测试有实际通过证据 + 代码审查 + 提交记录 | 开发中（只读内存健康历史阶段：最多 32 条脱敏证据摘要、证据过期转不确定、不允许伪造恢复成功；本机独立 Chrome 只读场景检查结果已接入每窗口有限观察历史（仅当前 DOM 与页面异常摘要；异常/缺失保持 INDETERMINATE），已增加仅按已导入且已登记场景 ID 查询最多 32 条脱敏内存时间线并显示在 UI（不暴露脚本哈希或证据哈希），已阶段接入本机脱敏历史归档与主进程场景历史查询，保留最近 32 条时间/状态并拒绝篡改，重启历史只能显示当前未知；真实授权周期复检与可信 Tampermonkey/业务验收仍未接入，TEST-024 未完整通过） |
| TASK-016 | 共享兼容层与依赖回归 | REQ-025 | 必须实现 | TASK-009;TASK-010;TASK-015 | src/compat tests/compat | 预计新增：src/compat/compatibility-layer.ts；tests/compat/compat-e2e.test.ts | 实现版本语义/多脚本回归和回退 | 稳定共享层 | TEST-025 | 测试有实际通过证据 + 代码审查 + 提交记录 | 开发中（新增内存只读兼容映射版本与多使用者离线回归检查；不激活候选版本、不更改任何脚本；完整 Tampermonkey E2E、多脚本真实回归及生产回滚仍未验证） |
| TASK-017 | 完整 UI 与批量用户旅程 | REQ-001..025 | 必须实现 | TASK-013..016 | app/ui tests/e2e | 预计新增：app/ui/task-screen.tsx；tests/e2e/main-flow.test.ts | 先主流程/异常/取消验收，再连接实际模块 | 可用交互入口 | TEST-002;TEST-022 | 测试有实际通过证据 + 代码审查 + 提交记录 | 开发中（PR #99：桌面导入界面新增会话级计数、取消剩余文件、逐文件失败隔离及 Electron 交互回归；阶段测试与整合状态以对应 SHA/Actions/PR 为准。仅为只读导入 UI 增量，完整产品 UI、真实处理队列、TEST-022 与 Stable GATE 未完成；PR #101 将 native 文件／文件夹选择器的批次互斥、请求取消、文件间协作式停止、部分只读结果保留和 Electron/Node 负例接入；CI 与整合须以对应 HEAD/Run 独立核验，该阶段仍非完整生产批处理恢复；PR #102 补跨来源重命名文件按内容去重，保留同名不同字节的真实版本，仍不代表完整 TASK-017/TEST-022）；PR #106 将已实现的 TASK-004 场景契约接入桌面导入后界面，仅限经过本窗口只读导入 SHA-256 的内存场景登记，含保守状态、未授权/未导入拒绝及 Electron UI 回归；没有真实浏览器执行、GM/业务 VERIFIED 或可持久恢复的正式任务队列；PR #107 复用已登记脚本 SHA 场景并以原生授权在应用归属 Chrome 中执行限界只读 DOM 多次采样，添加受限场景 ID IPC、取消和实际 Electron 界面拒绝负例；不执行用户脚本、不提供 Tampermonkey/业务 VERIFIED 或自动修复权限，完整 UI、TEST-005 与 Stable GATE 仍未通过；本轮桌面原生文件/文件夹导入以固定无参数、只读 IPC 轮询显示当前阶段和总量进度，无脚本内容、路径或用户权限传输；取消和最终结果仍由原有真实导入流程决定，完整产品 UI/TEST-022 仍未完成。 |
| TASK-018 | 安全审计与端到端回归 | REQ-001..026 | 必须实现 | TASK-017 | tests/security tests/e2e | 预计新增：tests/security/permissions.test.ts；tests/e2e/tampermonkey-userscript.test.ts | 覆盖严重风险、真实 Tampermonkey、授权/注入模式/回滚负例，Violentmonkey 仅辅助 | 安全/回归证据 | TEST-007;TEST-018;TEST-026 | 测试有实际通过证据 + 代码审查 + 提交记录 | 已完成（PR #837 已合并入 main@507a0b2；新增 tests/security/permissions.test.ts 覆盖 Chrome 边界/沙箱/Fail-Closed 与 tests/e2e/tampermonkey-userscript.test.ts 覆盖全生命周期端到端修复、业务验收门控、原子事务与可逆回滚，全量 1062 测试 100% 绿灯；Issue #608 保持 OPEN 待最终 Stable 人工核验） |
| TASK-019 | Windows EXE 安装版 | REQ-027 | 必须实现 | TASK-018;POC-03 | packaging/windows .github/workflows | 预计新增：packaging/windows/installer.iss；.github/workflows/build-windows.yml（预计新增；Inno Setup 候选） | 锁定安装工具/权限/升级测试，Windows 构建验收 | 真实 EXE 安装包 | TEST-027 | 测试有实际通过证据 + 代码审查 + 提交记录 | 已整合生产规范与候选验证（PR #839 已合并 main@c27ac62；新增 packaging/windows/installer.iss 生产安装脚本规范与 tests/packaging/installer-spec.test.ts 6项规范回归，全量 1068 项测试 100% 绿灯；云端 Candidate Packaging Run #43035037457 验证 147+ 文件哈希、合成升级及卸载数据保留全流程成功；Issue #609 保持 OPEN 待最终 Stable 人工集中签署） |
| TASK-020 | 真实 ZIP 便携发行 | REQ-028 | 必须实现 | TASK-018;ZIP 工具可用性验证 | packaging/portable .github/workflows | 预计新增：packaging/portable/create-zip.ps1；.github/workflows/build-windows.yml | 创建真实 ZIP，校验文件头/路径安全/文件哈希/解压/干净 Windows 直启 | 真实 ZIP 包 | TEST-028 | 测试有实际通过证据 + 代码审查 + 提交记录 | 已整合重定位加固与候选验证（PR #839 已合并 main@c27ac62；加固 test-windows-portable-relocation.ps1、test-windows-candidate-checksums.ps1 与 windows-package-candidate.ps1 路径规范化，支持本地与 CI 环境 8.3 短路径及未绑定 RUNNER_TEMP 安全回退，53项真实锁/重定位回归与 7项清单校验全绿；云端 Candidate Packaging Run #43035037457 真实 ZIP 验证成功；历史 Issue #215 已关闭；TASK-020 的正式 TEST/GATE 仍需在 #610 Stable 范围内完成） |
| TASK-021 | 稳定版最终集成发布验收 | REQ-001..028 | 必须实现 | TASK-019;TASK-020 | docs/release .github/workflows | 预计新增：.github/workflows/release.yml；docs/08-release.md | 跑全部适用 GATE；以同一提交出双包与校验值 | 可追溯 Stable Release | TEST-001..028 | 测试有实际通过证据 + 代码审查 + 提交记录 | 正式发布工作流、生产打包脚本与规格测试已整合；1073 项全量测试与 0.0.1 版本号是历史阶段证据，不代表当前全部门槛通过。GATE-001..011 最终证据尚未齐全，同一最终提交的 EXE+ZIP 与 SHA-256 尚未完成验收，最终集中人工签署未完成；Issue #610 保持 OPEN。 |

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

## （7）TASK-007 / TEST-017 手动 GM 夹具诊断报告导出阶段（2026-10-19）

[PR #93](https://github.com/devin930906/userscript-auto-healer/pull/93) 在既有获授权、自管独立 Chrome/Tampermonkey 手动测试流程中增加原生“保存脱敏测试摘要 JSON”入口。应用仅从本次活动会话收集明确列出的自报 broken/fixed 状态、有限 DOM 对照、注入时机和时间；所有真实性、脚本安装、GM API、业务恢复与自动补丁许可继续固定为 false。通过 Electron 原生“另存为”窗口选路径并二次确认，使用无覆盖创建、有限字节复核和 SHA-256；不包含安装令牌、脚本源码、网站内容或 Chrome/Profile 路径。取消、会话撤销、异常路径、重复文件名或符号链接路径均保守拒绝。不安装或更改 Tampermonkey 扩展及已有脚本。

Windows 源分支 SHA `cd64e0b402b5b3b2a6e1b89b9d198177d8726665` 的 [Application Checks #39189509991](https://github.com/devin930906/userscript-auto-healer/actions/runs/39189509991) 通过 TypeScript、Node 248 项（247 pass、0 fail、1 条件 skip）及真实 Electron 预载与沙箱 smoke；[独立便携 Chrome #39189509990](https://github.com/devin930906/userscript-auto-healer/actions/runs/39189509990) success。以上只证明原生 JSON 报告安全阶段功能，**不能作为实际 Tampermonkey 安装、GM_getValue 成功、业务恢复或 TEST-017/018 完整通过的证据**；PR 整合与主干 CI 仍须按实际记录核验。TASK-007 维持“开发中”，GATE-004/005 及最终 Stable 仍受阻。


## （7）TASK-013／TASK-017 原生批量 AST 预览隔离（2026-10-19）

- 关联：REQ-004、REQ-011、REQ-022；NFR-009；TEST-004/011/022；GATE-007（部分阶段进展）。PR [#111](https://github.com/devin930906/userscript-auto-healer/pull/111) 在已存在的批次静态解析预算（至多 16 份、总计 1 MiB、单份 256 KiB）内，将**原生文件／文件夹选择器完成后的静态 AST 预览**从 Electron 主进程迁移至隔离的 Node worker。仍不执行脚本、访问网站、修改脚本、访问用户 Chrome Profile 或提升修复权限；拖放单份脚本仍沿用已受单文件预算限制的静态解析。
- 为 worker 设置有限内存与 10 秒分析截止时间。用户取消或 worker 失败时，只将静态预览置为 `SKIPPED_CANCELLED` / `ISOLATED_ANALYSIS_FAILED`；此前真实导入的合法文件记录不因分析失败而被伪装成导入失败。新的 Node 真实工作线程测试核对对外回执仅有有限定位点计数、不泄露源码／选择器，且已限制的非分析项不会绕过预算。
- 来源检查：PR Head `373795ddfc03317a29d1e476672fffbd6fa57824` 的 Windows [Application Skeleton Checks #39221140487](https://github.com/devin930906/userscript-auto-healer/actions/runs/39221140487) 已完成并返回 success，包括 Node 回归与真实 Electron shell smoke；修改本进度文档后仍须对**最新** HEAD 及合并后的 main 分别重新验证。
- **TASK-013/017 仍开发中**，本轮是原生只读分析响应性与取消能力的一段功能集成，不是可终止任意恶意脚本代码的沙箱、持久可靠队列、可信真实 Tampermonkey/GM/业务验收、事务性自动应用／回滚，亦不满足全部 TEST-022 或 GATE-007。下一步仍应优先推进 TASK-007 的经许可真实 Tampermonkey 证据和 TASK-010/011 可信恢复路径，最终 EXE/ZIP 以 TASK-019..021 为准。


## （7）TASK-013／TASK-017 拖放静态分析工作线程与取消（2026-10-19）

- 关联：REQ-004、REQ-011、REQ-022；NFR-009；TEST-004/011/022。PR [#112](https://github.com/devin930906/userscript-auto-healer/pull/112) 继承 PR #111 的本机受限工作线程分析，补齐此前仍在 Electron 主进程同步调用 `previewImportedScriptAnalysis` 的 `import:dropped`（包括拖放及文件输入框）路径；静态解析改由现有受限 worker 完成，仍沿用单份 256 KiB、10 秒截止与失效时 fail-closed 的逻辑。主进程仍先按 8 MiB 单文件限制执行只读字节与 SHA-256 校验；无任意文件路径 IPC、用户脚本执行或自动修复权限。

- 后续调整（TASK-003 / TASK-013，TEST-004/011/022）：产品导入使用的隔离 AST worker 单文件上限调整为 512 KiB，覆盖大于 256 KiB 的完整脚本。同步分析与人工修复候选继续使用 256 KiB；每个 worker 仍限 16 份、共 1 MiB，并使用既有超时、内存及取消限制。
- 限定 `import:cancel-dropped` 为当前窗口的一次 read-only AST 分析取消请求；取消前已验证的导入内容和 SHA-256 不被伪报失败，未完成的解析只能产生 `SKIPPED_CANCELLED`。新增原生选择与拖放请求的双向互斥、窗口关闭时撤销分析且禁止写入新窗口会话，以及实际 Electron IPC/Node worker 负例。拖放文件夹枚举或单份 File.arrayBuffer 仍只在当前操作结束时协作式停止，不宣称不可中断的字节读取已经终止。
- 验证与合并状态以 PR #112 最新 HEAD 的 Windows Application Skeleton Checks、实际 Electron smoke 和最终 main SHA 为准；早期提交不能代替最新验证。**TASK-013/017 仍开发中**：本改动不是实际脚本批处理修复/回滚、可信持久任务恢复、真实 Tampermonkey/GM/业务验收，也不满足完整 TEST-022 或 GATE-007。正式 Windows EXE/ZIP 依旧须经 TASK-018..021 与所有适用 GATE。

## （7）TASK-007 / TEST-017 有限 GM 报告的 Chrome 版本追踪（2026-10-19）

- PR [#123](https://github.com/devin930906/userscript-auto-healer/pull/123) 将本应用**已验证归属的 Chrome 进程**提供的四段数字版本加入限定诊断会话与原生 JSON 报告，以便人工 TEST-017 环境追踪。原报告仅包含预设 broken/fixed 自报及有限 DOM 证据，没有所测 Chrome 版本。新增的 `browserVersion` 必须符合严格版本格式，不接收页面/HTTP 自报，不存储 Chrome.exe 路径、Profile、GM 脚本、URL 或令牌。
- 保存格式明确由 `uah-manual-gm-fixture-v1` 变更为 `uah-manual-gm-fixture-v2`，是**新生成报告**的版本升级；旧 v1 历史文件不会自动修改、覆盖或宣称兼容导入（应用本来没有 v1 导入路径）。原生系统二次确认说明新增了 Chrome 版本信息；失效/伪造的版本和旧 schema 均拒绝作为新 v2 文件保存。TEST-017 与受影响 Node/Electron 测试随同 PR 回归。
- 首个代码 SHA `54a4be82adcd7aaab96ab3e74d280765d9850455` 的 Windows [Application Skeleton Checks #39254390625](https://github.com/devin930906/userscript-auto-healer/actions/runs/39254390625) 已完成并成功；**本段文档更新后的最终 HEAD、实际合并及合并后 main CI 仍须分别核验**。版本属于被本应用验证的 Chrome，而非 Tampermonkey 扩展身份/版本证明。真实脚本安装、GM API、业务断言、自动补丁与回滚均未因此获得 VERIFIED；TASK-007、TEST-017/018、GATE-004/005 继续开发/受阻。

## （7）TASK-007 有限 GM 报告的时间线边界修复（2026-10-19）

- 关联 REQ-017/018、TEST-017/026、RISK-003、GATE-004/005/006。源 `src/manager/gm-report.ts` 的 v2 报告此前只检查 ISO 时间戳形状与局部 DOM 一致性；新负例揭示采集时间达到/超过一次性探针到期时，以及 DOM 证据晚于采集时间/到期时间时，格式完整的 JSON 仍可能被导出。现统一在生成与持久保存边界拒绝不可能的时间线，同时允许正常的任意模式访问顺序。
- 保留原生 `wx` 无覆盖保存、SHA-256/字节回读与严格数据白名单；没有用户脚本、扩展权限、Chrome Profile 或原始文件修改，也没有扩大任何自动修复权限。只有授权独立管理器/业务 E2E 证据才可推进 TEST-017/018；真实 Tampermonkey 与 Windows Stable 其余 GATE 不变。
- 最终提交、PR 与 Windows Actions 结论以对应远端运行记录核实，本段本身不是验收通过声明。

## （7）TASK-007 GM 探针半包断连安全收尾（2026-10-19）

- 关联 REQ-017/018、TEST-017/026、GATE-006/007；修复本机一次性 HTTP 诊断接收器在恶意/意外提前关闭连接时缺少请求流 error/aborted 处理的问题（Node.js IncomingMessage 的非监听 error 可能中止 Electron 主进程）。独立处理断开连接并拒绝任何截断回执；原先 token、来源、时间、数据上限及单模式首份回执保护均保留。
- 新增真实 TCP 流中断测试与正常 POST 恢复测试，没有修改现有脚本、浏览器 Profile、扩展权限或安装内容，也不授予自动应用/回滚。真实 Tampermonkey TEST-017/018 和正式 GATE 仍待其他独立证据，本段阶段记录不代表 Stable 完成。

## （7）TASK-017 / TEST-026 导入与浏览器原生授权选择互斥（2026-10-19）

- 现有脚本导入与 Chrome/Profile 原生选择、Profile 创建及启动处理器新增互斥状态校验；旧实现仅在各自局部串行，可能发生并发 OS 对话框、相互竞争或错误选择状态。此项只改变主进程保守 BUSY 拒绝条件，没有扩大 Chrome 权限、脚本导入能力或自动修复范围。
- Windows Electron 真实 renderer/preload IPC smoke 加入双向悬挂选择器及启动拒绝测试；原有独立的浏览器与导入并发检查保留。运行结果以当前 PR HEAD 与合并后 main 的 GitHub Actions 为准。TASK-017 完整用户旅程和正式 Stable GATE 仍未通过。

## （7）TASK-017 / TEST-022/026 手动导出准备取消及文件写入边界（2026-10-19）

已实现的 `scenario:export-manual` 与普通 DOM 检查共用 AbortController，但原有界面仅在普通检查过程中提供取消。现在也允许在人工候选导出的**写入前**准备（原生授权、页面只读观察、目录选择、源文件再核验）阶段请求取消。最终原生写入授权后、启动备份/候选生成前，主进程同步将 `manualExportCommitInProgress` 设为真，`scenario:cancel` 改为返回 `EXPORT_WRITE_ALREADY_STARTED`，不再错误承诺能取消已有新文件。原始用户脚本仍不会被自动覆盖。Windows 真 Electron renderer→preload→IPC smoke 检验了模拟活动阶段中 UI 启用取消、提交前取消信号及文件创建阶段拒绝取消。该 smoke 未实际创建备份文件，不证明真实 Tampermonkey、GM、业务恢复、完整 TEST-022 或 Stable GATE。

## （7）TASK-007：有限 GM 诊断路线变更失效保护（2026-10-20）

- 依据 REQ-017/018、TEST-017/018，PR [#133](https://github.com/devin930906/userscript-auto-healer/pull/133) 续接现有 `src/manager/tampermonkey-gm-probe.ts` 的一次性授权夹具。修复缓存的 `mode` 与后续真实页面地址脱节时继续 DOM 操作和 POST 自报的问题，按 exact `/?mode=broken|fixed` 入口与副作用边界拒绝非授权或变化后的路由；先提供 Windows 失败回归，再提交最小修改。
- 这是只保护未认证的临时 GM 手动诊断夹具，**不是** Tampermonkey 扩展身份、脚本安装、GM 调用、业务恢复或正式自动修复的证据。TASK-007 仍开发中，TASK-010/011/018 与 TEST-017/018、全部适用 GATE、正式 EXE+ZIP 均按原门槛继续。具体修复验收及整合状态必须复核 PR 当前 SHA、Actions 和 main。

## （7）TASK-011 已变化原文件恢复前置复核增量（2026-10-20）

作为原 TASK-011（REQ-020/021、TEST-020/021）的开发中子阶段，新增 native-only changed-source restore preflight，核查更改后的源文件及完整独立旧备份，严格拒绝路径别名、意外修改和未经授权的请求。不实现原文件写入、可恢复事务、用户一键回滚或真实 Tampermonkey 验收。TASK-011 仍为“开发中”，TASK-018～021 与 Stable GATE 均不视为完成。本阶段 PR、CI 和合并 SHA 以 GitHub 当前状态为准。

## （7）2026-10-20 TASK-013 / TEST-022 分段 AST 只读预览超过 64 份的覆盖

PR [#164](https://github.com/devin930906/userscript-auto-healer/pull/164) 复用已有分支，修复原生批量导入最多 1000 份 .user.js、但孤立 AST Worker 只分析前 64 份的覆盖缺口。当前代码按 16 份/每段及 1 MiB/每段串行预览，单 Worker 最长 10 秒，并对全批施加 120 秒总预算；超时或超过导入上限的输入保守返回 `SKIPPED_BATCH_BUDGET`，取消后按 `SKIPPED_CANCELLED` 记录，原脚本字节不修改，不执行用户脚本，所有 Tampermonkey / 业务 / 自动应用权限继续为 false。此处不声称完整 1000 份性能基准或可信持久批处理已经验收。

测试先行源码 `2cbc8941a48d50070311d0c6329d096f7477680c` 的 [Windows CI #39405858361](https://github.com/devin930906/userscript-auto-healer/actions/runs/39405858361) 实际失败：364 项中 361 pass、2 fail、1 skip，两项 TEST-022 均为超过原 64 份界限的断言；修复源码 `001b90f3bc466ac6760667ac6070666f44006e03` 的 [Application Checks #39406194800](https://github.com/devin930906/userscript-auto-healer/actions/runs/39406194800) success：364 项，363 pass、0 fail、1 skip，实际 Windows Electron sandbox/preload smoke 成功。已核验 70 份实际 Worker 预览和预先取消；完整 1000 份用户业务与性能基线尚未测试。

[Windows 开发候选 EXE+ZIP #39406194811](https://github.com/devin930906/userscript-auto-healer/actions/runs/39406194811) 第一次测试因不涉及本次 AST 改动的 Chrome/CDP `CDP_TIMEOUT` 失败，保留失败证据；仅重跑一次后 attempt 2 success：同样 364 项回归、ZIP 138 文件哈希往返、只读路径启动、EXE 138 文件安装完整性、合成升级及卸载数据保留均通过。该候选构建实际 PR 测试合成源码为 `b2a7b1736c514fbb6e11fd648b3b3c3aa4023371`，不是 PR HEAD 或 main；Artifact ID `12257896775`，2026-10-23 到期，明确 CANDIDATE ONLY / NOT STABLE。候选 EXE SHA-256 `c8827b2c209d38da498091614fc63fb178250212a39a63bcc19ef9ed2c5572a5`、候选 ZIP SHA-256 `6ea313e15d7227f66c7d65bd05fa290d26d52e4060a2a796688e41224b9df462`，不能挪用为正式 Release 校验。本轮 TASK-013/TEST-022 仍是开发中，持久恢复、真实 Tampermonkey/GM/业务及最终 Stable GATE 未完成；合并状态及 main SHA 需独立复核。

### （7）TASK-011：受限手动恢复桌面入口续接（2026-10-21）
现有 `src/version/native-restore-transaction.ts` 已实现仅原生可调用的手动原始字节恢复事务；后续开发将 `src/version/manual-restore-selection.ts`、固定且无路径参数的 preload IPC 以及桌面原生文件选择/双重授权确认接入用户界面，并建立原始备份与被替换版本的 SHA/身份复核。新增仅针对 Actions 隔离临时文件的正向恢复、错误备份、重复恢复及源文件变更拒绝回归，严格不读取或修改用户现有文件。最新分支/PR/CI/提交需由 GitHub 实际记录确认。
**TASK-011 保持开发中**：用户真实环境的正向恢复、非协作编辑竞争、断电持久性、来源授权、实际 Tampermonkey/GM/业务验证、自动应用/自动回滚仍没有完整证据；TEST-020/021/026 与 GATE-006/007 不因本阶段通过而自动变成通过。

## 2026-10-24 TASK-015 / REQ-024 / TEST-024 有限脱敏历史跨重启阶段

- 原生受限 `src/health/limited-health-archive.ts` 仅由应用主进程使用 Electron `userData` 下固定目录、按导入脚本及已登记场景的独立 SHA-256 作用域储存至多 32 条时间与只读 DOM 有限状态；不存 URL、脚本源码、文件路径、DOM、错误文本或证据散列。恢复记录的当前健康一律 `INDETERMINATE`，任何旧事件不授予管理器/GM/业务验证、自动补丁或回滚权。
- 写入须先通过现有本机 Chrome 场景访问授权，并在 UI 显示本地归档告知；无 renderer 文件路径入口。新持久文件采用有界读取、身份复核、临时文件 fsync、首次硬链接不覆盖发布及本应用协作式路径互斥；存在未知文件、重解析路径、篡改或无法可靠清理时安全拒绝。不宣称对外部并发修改有 OS 级事务保证。
- [Windows RED #40086563849](https://github.com/devin930906/userscript-auto-healer/actions/runs/40086563849) 为能力未实现的预期 3 失败；[中间运行 #40086990077](https://github.com/devin930906/userscript-auto-healer/actions/runs/40086990077) 与 [#40087238993](https://github.com/devin930906/userscript-auto-healer/actions/runs/40087238993) 保留真实开发/测试夹具失败；[GREEN #40087382259](https://github.com/devin930906/userscript-auto-healer/actions/runs/40087382259) 基于源 SHA `0910d093b3698332a71e403a9b62aa81e950d9b4`，536 项测试中 535 pass / 0 fail / 1 conditional skip，Windows Electron shell smoke 成功。
- 这只满足 TEST-024 的受限本机历史持久化增量：**真实周期复检、Tampermonkey/GM/业务状态、跨真实应用重启的完整 GUI E2E、可信用户数据恢复及所有 Stable GATE 仍未全部验收**；不得据此声称正式健康监控完成、TEST-024/GATE-010 通过或 Stable 已完成。完整结果和整合以对应 PR/main 最新 CI 为准。

## （7）2026-10-26 TASK-007/019/020 阶段续接定位

- 当前已合并主干 `35033f74c52aa6edaca3723ac4ca23165db3d3d5`，查询时无 Open PR；PR #374 的批处理检查点预占竞态修复已整合，不能重复实施。
- TASK-007 / REQ-017/018 / TEST-017/018：隔离真实 Tampermonkey Windows 工作流 [#40270144017](https://github.com/devin930906/userscript-auto-healer/actions/runs/40270144017) 15/15 Job 成功；本机 AST 候选与手动恢复导出可在测试扩展执行，但既未达到生产级管理器身份认证，也未允许自动应用或自动回滚，继续为开发中。
- TASK-019/020 / REQ-027/028 / TEST-027/028：当前主干 Windows 开发候选 [#40270461210](https://github.com/devin930906/userscript-auto-healer/actions/runs/40270461210) 成功；147 文件完整性和阶段性安装/便携验证通过，但正式 Stable 双包与全部实际用户环境 GATE 仍未满足，继续为开发中。
- **下一实际开发方向**：优先补 TASK-007/010/011 的可信管理器/业务证据绑定和自动恢复闭环，基于现有代码增量实现；TASK-018 完整安全 E2E、TASK-019/020 正式产品双包及 TASK-021 GATE 全通过之前不得发布。没有为这一阶段另设 TASK 编号、第二套计划或额外功能。

## （7）2026-10-27 TASK-011 / TEST-020/026 原生恢复暂存文件身份核验（阶段验证）

- **实际缺陷与最小修复**：旧版 `hasInterruptedRestoreStaging` 允许仅根据 `.uah-restore-UUID.pending` 文件名豁免扫描，未核对它是否仍为刚核验的事务暂存 inode；同名文件被替换仍可能被忽略。现在仅在原生调用方提供已核验的 `BigIntStats`、扫描期间与扫描结束后的 `dev/ino`、字节长度、时间戳、模式及单硬链接身份全部一致时豁免；仅凭名称、同名替换、额外硬链接或暂存丢失均保守拒绝。保留原有目录前后身份检查和有限枚举，不宣称 OS 原子排他或避免最终检查之后的外部写入竞争。
- **真实 TDD 证据**：测试先行提交 `b85cccac9cb64ce21263c60cc9231bc8b5a5fd5b`，Windows [RED #40357605794](https://github.com/devin930906/userscript-auto-healer/actions/runs/40357605794) 的 634 项测试为 632 通过、1 失败、1 条件跳过；唯一失败是新增 `TEST-020/026`，旧扫描错误地返回 `false`。实现及正反例提交 `da6a8bddd2d3d027f5ef24226aeefeb62ab338c2`，Windows [GREEN #40358325019](https://github.com/devin930906/userscript-auto-healer/actions/runs/40358325019) 对该 SHA 执行 636 项测试，635 通过、0 失败、1 条件跳过，TypeScript 检查及真实 Electron shell smoke 成功。
- **阶段边界**：改动仅涉及 `src/version/restore-staging-residue.ts`、`src/version/native-restore-transaction.ts` 及其安全测试；实验仅在 Windows 隔离临时文件中执行，不能证明断电级原子回滚、外部非协作编辑者排他、用户实际原文件/真实 Tampermonkey 业务恢复。TASK-011、完整 TEST-020/021/026 及 GATE-006/007、全部 Stable GATE 仍未完成；正式 Windows EXE/ZIP 与 Release 未因此获得发布资格。

## （7）2026-10-27 TASK-008 / TEST-013/026 CDP 导航重放输入安全边界

- **源码范围**：`src/diagnostics/cdp-page-exceptions.ts` 的 `isArmedFrameNavigationReplay` 原直接读取 `params.frame` 及 `frame.id/loaderId/url`，外来 getter 可以返回仿真导航证据并被当作重放，live/revoked Proxy 可以执行陷阱或直接抛出。现对顶层、嵌套 `frame` 和内部 armed identity 先拒绝 Proxy/非纯数据对象，以自己的属性描述符提取字段；仍支持有效普通 CDP JSON 携带的额外数据字段，保留 frame ID、loader ID、URL 三重精确比较。此输入隔离不认证浏览器/CDP 来源、不授予 Tampermonkey 或任何自动修复权。
- **真实 TDD RED**：测试先行提交 `095d08bc3ce7076fd9f4c431776ff1dab320a0f4`；Windows [Application Checks #40361851867](https://github.com/devin930906/userscript-auto-healer/actions/runs/40361851867) 共 638 项，635 pass、2 个预期新失败、1 conditional skip；失败分别为访问器返回 `true`、以及 Proxy 自定义异常外泄（TEST-013/026）。
- **真实 GREEN**：实现提交 `cd984456e112f234c498c2ff555e0948d6a2eaf4`；Windows [Application Checks #40362392539](https://github.com/devin930906/userscript-auto-healer/actions/runs/40362392539) 为 completed/success，638 项中 637 pass、0 fail、1 conditional skip，TypeScript 检查与 Electron 真实 shell smoke 均成功。最终 PR HEAD 和合并后 main 仍需分别核验。
- **验收边界**：仅为 TASK-008/TEST-013/026 的本机 CDP 证据分类安全增量；没有实际证明用户脚本执行、Tampermonkey 来源、GM API、真实业务恢复、自动修复/回滚或全部 TEST/GATE。仍按既有 GATE-001..011 标准推进，Stable EXE/ZIP 不是本轮交付。

## （7）2026-10-27 TASK-009 / TEST-019/026 动态全局 document 别名安全修复

- **修复范围**：`src/repair/patch-planner.ts` 的保守本地修复候选生成，在旧版已阻断 `window.document`/静态全局键变更的基础上，额外识别可能在运行时指向 `document` 的动态 `window[key]`、`globalThis[key]` 或计算表达式：直接赋值/删除/更新、通过不确定对象改写 `querySelector`/`querySelectorAll`/`getElementById`、`Object.defineProperty`/`Object.assign` 等反射式修改。无法静态证明不是 `document` 时保守拒绝候选；已知无关字面键和动态只读访问保持原有本地候选行为。未增改脚本、浏览器、管理器或自动应用权限。
- **TDD RED**：测试先行提交 `666933f8bdb9dde2b5c323f83c13ebfaf3a6106c`；Windows [Application Skeleton Checks #40365611271](https://github.com/devin930906/userscript-auto-healer/actions/runs/40365611271) 共 639 项，637 pass、1 条新增测试失败、1 conditional skip。旧实现对 `const key='document'; window[key]=fakeDocument;` 仍返回 `CANDIDATE_ONLY`，违反 TEST-019/026 对不确定原生 DOM API 的保守安全要求。
- **TDD GREEN**：修复提交 `2adc0dc146657978d41137c163ebf88bca534471`；Windows [Application Skeleton Checks #40366122929](https://github.com/devin930906/userscript-auto-healer/actions/runs/40366122929) completed/success，639 项中 638 pass、0 fail、1 conditional skip，TypeScript 检查与真实 Electron sandbox/preload smoke 均成功。
- **边界**：仅属于 TASK-009/TEST-014/019/026 的候选生成安全阶段增量；不是实际 Tampermonkey 管理器身份认证、真实业务修复、自动应用/回滚或最终 Stable GATE。PR Head/合并后 main 仍须以各自新检查和提交 SHA 独立核验。

## （7）2026-10-27 TASK-007 / TEST-017/026 每模式 GM 自报状态诊断

- **功能增量**：真实桌面测试中，`startApprovedTampermonkeyDiagnostic` 的当前一次性会话新增只读 `modeReportSnapshot()`，对 broken/fixed 独立展示 `NOT_REPORTED`（尚未收到）、`SELF_REPORTED_ONLY`（收到格式合规的自报）及 `REJECTED_REPORT`（格式、来源字段或 Proxy/Getter 不可信）。每模式分别保留 `reportedGmDefaultMatched`、`reportedGmStorageRoundtripMatched` 和 `reportedBusinessAction` 的 true/false/null，不再把另一模式的未执行和实际自报失败合并混淆。经原生 Electron IPC 仅向受信任 renderer 返回无源码、无 URL、无令牌的白名单状态，界面明确写作「自报匹配／自报未匹配」，并保留原有 DOM 独立对照与脱敏 JSON 报告接口。所有管理器/GM/业务验证、自动补丁/回滚授权标志仍为 false。
- **TDD RED**：提交 `135809d93da759e77b151deec2740f42eda262b2`；Windows [Application Checks #40369693086](https://github.com/devin930906/userscript-auto-healer/actions/runs/40369693086) 641 cases：638 pass、2 条新增用例预期失败、1 conditional skip。未实现时，单独 broken 自报被错误地显示为未报告，并且无效/撤销 Proxy 未被标为已拒绝。
- **TDD GREEN**：原生每模式分类提交 `4f431753409588e494d35db873baca0c909e2178`；桌面 IPC/UI 与报告元数据兼容提交 `8a75d908c41ff46813a929ac2984d75c857ad8b2`；Windows [Application Checks #40370576818](https://github.com/devin930906/userscript-auto-healer/actions/runs/40370576818) completed/success，641 cases：640 pass、0 fail、1 conditional skip；TypeScript 类型检查与真实 Electron isolated renderer/preload smoke 成功。
- **持续阻断**：这是对现有 TASK-007 手动测试的可解释诊断信息增强，不认证 Tampermonkey 商店签名/管理器身份，也不证明真实脚本修复、GM API 可用性、业务恢复、自动应用或回滚。完整 TEST-017/018、GATE-004/005 与 Stable 正式发行仍未满足；主分支集成后的 SHA 和检查需重新核实。

## （7）2026-10-27 TASK-003 / TEST-004/026 元数据解析对象与原生字节边界修复

- 已定位：原 `readUserscriptSource` 在检查字节容器真实性前直接读取 `script.bytes`，并允许虚构对象的 `subarray()` 被调用。现从普通对象自有数据属性读取来源，仅接受非 Proxy 的真实 Uint8Array/Buffer，通过原生 TypedArray 内部 Getter 获取字节视图；异常、伪造对象或 Getter 全部返回无效编码，保留只读 BOM/字符集解析。
- RED 测试提交 `339007a66aa68b4b9d303e47071f1ee3abd19bfa`：[Windows #40454762079](https://github.com/devin930906/userscript-auto-healer/actions/runs/40454762079) 642 tests、640 pass、1 fail、1 skip；GREEN 修复 `ad10c62c071b486f7f9dd0398816aea09ec6091c`：[Windows #40455069810](https://github.com/devin930906/userscript-auto-healer/actions/runs/40455069810) 642 tests、641 pass、0 fail、1 skip，真实 Electron smoke success。
- 仅防回归增量，不重启已完成 TASK-003；TASK-007/010/011 的完整可信业务链路、TASK-018 与正式 Stable GATE 仍需各自实证，不以此增量改变原始任务状态。

## （7）2026-10-27 TASK-011 / TEST-020/026 检查点异步验收时间窗修复
- 原有检查点在首次发布字节校验后仍执行异步候选完整性复核，期间外部进程改写 checkpoint JSON、或同名同字节替换 inode，可让原先的 `CHECKPOINT_STAGED_UNVERIFIED` 回执失去现时依据。仅在原有 TASK-011 准许的无自动写入检查点范围内补齐后验：发布 inode 须绑定原 pending inode；在最后候选复核后，重新验证 checkpoint 字节、inode、mtime/ctime、nlink、目录与链接安全。
- 测试提交 `c2f1bf4a0f79ed7744d699b5e3cafb5aff3fbfca` 的 RED [#40457329095](https://github.com/devin930906/userscript-auto-healer/actions/runs/40457329095)：643 总计，641 pass/1 fail/1 skip，旧实现因外部内容修改仍成功而失败。实现提交 `74eb05cf6c971e13a212b87ede93fdcb15d596e9` 的 GREEN [#40457596319](https://github.com/devin930906/userscript-auto-healer/actions/runs/40457596319)：643 总计，642 pass/0 fail/1 skip，Windows Electron smoke 成功。
- 保留 TASK-011 真正跨崩溃事务与可信恢复、TASK-007/010 管理器验收、TASK-018..021 和 GATE-001..011 现有剩余工作；不重新计为完整 TASK-011，也不提升自动补丁或回滚权限。

## 2026-10-29 新版（4）→（7）开发任务与 GitHub Issues 执行索引

> 本节是 `main@e3169fc982c9703e26710eb335b36a41f0812454` 的迁移时点快照，不改写上述原有 21 条固定字段 TASK 表格、阶段计划、历史验证或用户已批准的范围。查询最新状态时先重新读取 GitHub，不能以本快照代替实时事实。权威 Issue 机制见 `docs/15-issue-driven-stable-bridge.md`。

| 正式 TASK 编号 | 对原有记录的阶段判断（非全部 TEST/GATE 验收） | 当前 GitHub Issue 或后续处理 |
| --- | --- | --- |
| `TASK-001` | 阶段成果已整合 | 无需追溯补建 Issue；新回归关联原 TASK 与新证据 |
| `TASK-002` | 阶段成果已整合 | 无需追溯补建 Issue；新回归另行记录 |
| `TASK-003` | 静态分析阶段已整合 | 无需追溯补建 Issue；产品级其它验证另按 GATE |
| `TASK-004` | 场景契约阶段已整合 | 无需追溯补建 Issue；真实业务断言仍依赖后续 TASK |
| `TASK-005` | Chrome/CDP 阶段已整合 | 无需追溯补建 Issue；用户环境矩阵未自动通过 |
| `TASK-006` | DOM/SPA 阶段已整合 | 无需追溯补建 Issue；真实集成未自动通过 |
| `TASK-007` | 产品级验收待完成 | [#486](https://github.com/devin930906/userscript-auto-healer/issues/486) |
| `TASK-008` | 集成未完成；间歇故障 | [#480](https://github.com/devin930906/userscript-auto-healer/issues/480) |
| `TASK-009` | 修复/自动应用闭环未完成 | [#487](https://github.com/devin930906/userscript-auto-healer/issues/487) |
| `TASK-010` | 可信验收门控未闭环 | [#488](https://github.com/devin930906/userscript-auto-healer/issues/488) |
| `TASK-011` | 安全事务及回滚未闭环 | [#489](https://github.com/devin930906/userscript-auto-healer/issues/489) |
| `TASK-012` | 产品级导出/管理器版本同步待验收 | 尚未单独建 Issue；正式计划保留 |
| `TASK-013` | 持久批处理未完成；产品级调用链持续推进 | [#857](https://github.com/devin930906/userscript-auto-healer/issues/857) |
| `TASK-014` | 可选 AI 阶段代码已整合，完整验收待办 | 尚未单独建 Issue；正式计划保留 |
| `TASK-015` | 健康监控阶段代码已整合，完整验收待办 | 尚未单独建 Issue；正式计划保留 |
| `TASK-016` | 共享兼容层阶段代码已整合，真实回归待办 | 尚未单独建 Issue；正式计划保留 |
| `TASK-017` | UI 阶段代码已整合，完整旅程待办 | 尚未单独建 Issue；正式计划保留 |
| `TASK-018` | 整体安全/业务集成验收待执行 | 尚未单独建 Issue；按现有依赖进入 |
| `TASK-019` | 开发候选 EXE 已存在，正式安装验收待办 | 尚未单独建 Issue；按现有依赖进入 |
| `TASK-020` | 开发候选 ZIP 已存在；间歇重定位故障 | [#215](https://github.com/devin930906/userscript-auto-healer/issues/215) |
| `TASK-021` | Stable 发布守卫/候选双包流程阶段已合并；最终 GATE 与同源发行验收未完成 | [#610](https://github.com/devin930906/userscript-auto-healer/issues/610) |

- **编号与粒度**：TASK 编号永久沿用既有正式任务序列；Issue #N 是 GitHub 实际单独编号，不能强制一对一。历史已实现 TASK 不补建无意义 Issue；同一 TASK 可以有多个分阶段 PR，Issue 要求与 PR 的代码变更分开验收。
- **近期执行链**：#486 / TASK-007 的真实 Tampermonkey 支持与业务证据；#480 / TASK-008 的独立 Chrome 间歇失败；#487 / TASK-009 修复候选到可信诊断链；#488 / TASK-010 真实业务门控；#489 / TASK-011 原子备份/恢复；#857 / TASK-013 产品级批处理流程（#440 为已关闭历史 Worker 跟踪）；#215 / TASK-020 便携目录重命名失败。此处不是强制线性顺序，必须以原正式任务依赖与现时风险选择能执行的工作。
- **尚未建 Issue 的已批准任务**：TASK-012/014/015/016/017/018/019/021 保持正式计划中的实际待办与各自完成条件；进入可执行阶段时先查重、再按实际需要建立精确 Issue，不因当前未建 Issue 将其误报为完成或取消。
- **每轮工作**：读取当前 main/分支/PR/Issue/CI；以 TASK、REQ/NFR、TEST/GATE 及 Issue 目标确认范围；完成真正代码修改与测试后经适用 PR 审核合并；仅当 Issue 全部验收满足时关闭或使用 GitHub 默认分支适用的自动关闭语句。将剩余阻断交还 12/14，本工程不通过大量 Issue、提交和 PR 数量计算完成度。
- **Stable 交付仍受阻**：用户真实 Tampermonkey 产品级业务修复/回滚、全量支持矩阵、Windows 正式双包和 GATE-001..011 未取得完整最终证据；单一 PR 或一次 CI 绿灯不能转为 Stable 发布通过。

## 2026-10-31 TASK-013 双并发检查点安全增量（部分完成；Issue #440 未关闭）

- 当前正式基线：PR [#531](https://github.com/devin930906/userscript-auto-healer/pull/531) 已合并至 `main@f7bd2cc0ed89bbf914aac0d02b48bf6a5004c937`。在 `src/jobs/batch-coordinator.ts` 原始检查点状态校验中，`RUNNING` 任务数超过已批准 `concurrency` 时拒绝，不让伪造的第三条运行中任务被重启归一化为合法可恢复任务；回归测试保留两条真实并发中断任务的正常恢复。范围仅为 TASK-013 / REQ-022 / TEST-022/026，不增加修复权限。
- [RED #41173176156](https://github.com/devin930906/userscript-auto-healer/actions/runs/41173176156)：760 项 / 758 通过 / 1 个预期失败 / 1 条条件跳过；[PR GREEN #41173377967](https://github.com/devin930906/userscript-auto-healer/actions/runs/41173377967)、[合并后 main GREEN #41173898572](https://github.com/devin930906/userscript-auto-healer/actions/runs/41173898572)：760 项 / 759 通过 / 0 失败 / 1 条条件跳过，真实 Electron smoke 成功。Windows 候选 [#41173378150](https://github.com/devin930906/userscript-auto-healer/actions/runs/41173378150) 成功，但属于非 Stable 临时双包。
- #440 原来的间歇性隔离 AST Worker 失败仍未找到根因，继续 Open；不能将本次独立检查点修复视为原 Issue 完全解决。TASK-007/009/010/011/018/020/021 与 GATE-001..011 的正式验收边界均未被改变。

## 2026-10-31 TASK-013 / Issue #440 并发重试持久化单调性增量（部分完成）
- [PR #532](https://github.com/devin930906/userscript-auto-healer/pull/532) 已 squash 合并至 `main@08f03a5dc12f2f1f74e37ad3a788063a74961d17`。现有只读队列 `mayPersistOver()` 在旧持久记录为 `QUEUED` 时拒绝同次数 `RUNNING/SUCCEEDED/FAILED` 直接取代它，防止跳过仍应开始的新尝试。合法取消、增加尝试次数的成功、重启归一化为不变 `QUEUED` 均保留。
- 修正后的真实 Windows RED [#41174961316](https://github.com/devin930906/userscript-auto-healer/actions/runs/41174961316)：761 项/759 通过/1 个预期失败/1 跳过；GREEN [#41174965009](https://github.com/devin930906/userscript-auto-healer/actions/runs/41174965009)、PR Application [#41175266262](https://github.com/devin930906/userscript-auto-healer/actions/runs/41175266262)、合并后 main [#41175855520](https://github.com/devin930906/userscript-auto-healer/actions/runs/41175855520)：761 项/760 通过/0 失败/1 条件跳过，Electron smoke 成功。最初测试错误地预期重启 RUNNING 仍维持运行中状态，已明确修正，原失败日志仍保留在 PR。
- Windows [候选双包 #41175266285](https://github.com/devin930906/userscript-auto-healer/actions/runs/41175266285) 成功，PR 合成源 `4c8e52d632c1ffd581c4c7836736b25e659a012d`，**不是正式 Stable RC**。
- 此项为 `TASK-013/REQ-022/TEST-022/026` 单独的持久化防回归修复；#440 原始间歇性 AST Worker 问题未查明，保持 Open；其他 TASK/TEST/GATE 和正式发布门槛不变。

## 2026-10-31 跨会话并行执行补充（仅执行治理）

TASK-001..021、原任务依赖和验收要求保持不变。每次启动正式代码实施，先依 `AGENTS.md` 与 `docs/16-cross-session-issue-claims.md` 核验完整的 Issues/PR/分支/CI 状态并用**服务端创建唯一引用**对实际 Issue 取得可核验独占权；认领失败或历史分支归属不明则跳过。并行候选不是事先批准的分组；必须逐一核验模块、拟改文件、共享类型与工作流、接口/依赖及 PR 集成门槛。未实际验证的并行性记为“无法确认”，不虚构分组或修改 TASK 正式编号。

## 2026-11-01：旧认领与新版跨轮次开发规则

不重新编号 TASK-001..021，不复制需求或新建每个历史 PR 对应的任务。当前开放 #215/#440/#480/#486/#487/#488/#489/#510 的 `work/issue-N` 引用均存在且与 `main@850349001a52326fca09e8c5dccdcfd4ab043cbd` 分叉。执行下一轮前先核对旧 PR、独立提交、原归属退出、真实剩余验收范围与并发资源；没有安全释放证据就标记受阻，不允许自动清理分支。合法释放后保留同一 TASK/Issue 和历史 PR 关联，重新原子认领剩余部分，不因已结束分支存在而永久拒绝续接。具体归属、竞争与核验见 `docs/16-cross-session-issue-claims.md`。


## 2026-11-02 新版（4）/（7）无独占认领迁移（现行续接依据）

- PR [#602](https://github.com/devin930906/userscript-auto-healer/pull/602) 合并提交 `617fd3879f7a33ff3a5311868c1164b4e6dfb6fb`，经 Documentation Integrity 和 Required PR Fence 成功验证。此 SHA 只是当时迁移基准，不保证永远是当前 main。
- 新指令取消 Issue 独占锁、创建认领分支、持有者签名轮次和 `HANDOFF_BLOCKED` 开发门槛。旧相关记录仍保留历史与安全证据，不能再阻止符合批准范围、依赖和 PR 规则的独立产品开发。
- 保留原始 REQ/NFR/ADR/RISK/TEST/GATE、TASK-001..021、已经合并的产品代码、PR 与 CI；（4）历史有条件准入不重跑，旧产品阶段不重做。并行工作必须以最新 main SHA、实际文件/接口冲突、分支隔离、PR Required Checks 及合并后回归为依据。
- 新建立已批准 TASK 的分类 Issue 映射：TASK-012→#603；TASK-014→#604；TASK-015→#605；TASK-016→#606；TASK-017→#607；TASK-018→#608；TASK-019→#609；TASK-021→#610。原有 #215/#440/#480/#486/#487/#488/#489/#510 保留，不因建立新 Issue 就认为相关功能已通过。
- 当前仍有真实 Tampermonkey 产品业务、可信自动应用与原子回滚、间歇性 Windows 故障、正式 EXE+ZIP、最终人工验收与全部 GATE 的证据缺口；不得把治理修复当作 Stable 验收。
- 现行执行依据：`AGENTS.md` 2026-11-02 小节及 `docs/19-stable-v7-migration.md`；每次均重新读取远端 GitHub 状态。


新映射详见 `docs/19-stable-v7-migration.md` 的专门表格；此计划仅保留上方 TASK-001..021 唯一正式任务主表，避免开发计划验证器将追加映射误认为重复 TASK 记录。

注：2026-10-29 旧表是当日历史状态，不重写当时“尚未建 Issue”的真实记录；现行映射以本节和真实 GitHub 为准。

### TASK-005 / TASK-017：已有自定义 Data 外连（2026-11-12）

依用户要求新增正在运行 Chrome 的独立授权连接路径，首阶段支持连接和 Tampermonkey 运行目标只读提示；原有场景诊断、GM 测试与自动修复尚未适配此外部连接。真实 Chrome 原生授权、用户设备和完整业务验收待完成；不得据模拟测试认定 Stable。

## 2026-11-16 PR #883 合并后的历史状态快照（后续更新见文末）

- **TASK-005 / Issue #856 与历史 Windows CDP 故障 #510**：Candidate Packaging #43805989231 在 TEST-006/008/009 的 owned-Chrome CDP 阶段失败：79 次 FETCH_REFUSED 至 t20、CHILD_RUNNING_NO_CDP、state=1/endpointMarker=0。PR #886 合并后的 main Application Checks [#43824662618](https://github.com/devin930906/userscript-auto-healer/actions/runs/43824662618) 与当前 main Candidate Packaging [#43828261977](https://github.com/devin930906/userscript-auto-healer/actions/runs/43828261977) 均在四次初始拒绝后于 t4 解析 CDP。当前成功不确定原失败根因；#510 保持 Open，不提高超时或减弱 PID/监听归属检查。
- **#510 受控全量套件对照（2026-11-16）**：[Windows run #43810123635](https://github.com/devin930906/userscript-auto-healer/actions/runs/43810123635) 在同一 `windows-2025` runner、准确来源 SHA `f2675b9e730a76c67aad760625f04c430828fc1e` 上，以 CPU 压力关闭执行独立 Chrome → 全量套件 → 独立 Chrome 三阶段，分别为 60/60、1126/1126、60/60 通过；首尾阶段 `CDP_VERSION_PARSED` 均为 `t0..t0`，全量套件中 TEST-006/008/009 通过。本次未复现 #510，不能证明根因、消除间歇故障或替代失败的 Candidate Packaging #43805989231；未改产品代码或放宽 20 秒期限/所有权检查，#510 保持 Open.
- **TASK-007 / Issue #486**：PR [#883](https://github.com/devin930906/userscript-auto-healer/pull/883) 已合并 main@bcacd082a3c538e00dfbf481c7221c8e829818ad，新增 app-owned Chrome 管理页只读 Tampermonkey ID/名称/版本/启用状态与 Allow User Scripts 元数据检查。云端实验 [#43806236366](https://github.com/devin930906/userscript-auto-healer/actions/runs/43806236366) 只证明 vendor-hosted Tampermonkey 5.4.1 / Chromium 141 隔离环境的签名 key/runtime ID 匹配、service worker 与合成 broken→candidate 对照；`storeAuthenticityVerified=false`、`gmRoundtrip=false`，不证明真实商店来源、用户 Chrome/Profile、完整 GM、生产业务或自动修复/回滚。TASK-007 仍开发中。
- **TASK-014 / Issue #604**：PR #883 整合可选 AI 模型发现的原生确认边界；当前 Windows Application Checks #43806721310 通过，但完整 AI 双协议、配置与诊断/修复链路仍须按 TEST-015/016 独立验收。TASK-014 不因该 PR 完成。
- **TASK-017 / Issue #607**：PR #883 将手动 GM 场景与手动注册夹具保留在折叠高级区，并将导入结果下一步导航到受控 Chrome 工作区。完整“浏览器配置→批量导入→一次启动→逐脚本进度/结果”主旅程尚未实现；源码静态 UI 审查不替代真实 Electron 渲染、交互或人工体验。TASK-017 仍开发中。
- **整合与测试基线**：PR #883 已合并；main SHA `bcacd082a3c538e00dfbf481c7221c8e829818ad` 的 Application Checks #43806721310 成功（1126 tests：1125 pass、0 fail、1 conditional skip；Electron shell smoke 成功）。Candidate Packaging #43805989231 失败且未产出本轮 EXE/ZIP；故不得推进 TASK-019/020/021 的 Stable 完整验收。
- **依赖执行边界**：TASK-009/#487、TASK-010/#488、TASK-011/#489、TASK-012/#603、TASK-013/#857 仍按真实管理器、业务证据、自动应用门控和事务/回滚依赖推进；不得把合成实验或阶段性代码视为依赖已满足。

## 2026-11-16 PR #886 合并后的 TASK 与同步状态

- **产品代码合并点**：PR [#886](https://github.com/devin930906/userscript-auto-healer/pull/886) 已合并；GitHub main 合并提交 7c02f828ba781677629634b0947c7e729b1c170b。PR HEAD ce81f10124c9a8d8a976ece414ec6978415ad32f；Required Check “Issue coordination / stale round fence” 成功，28 个 PR checks 全部 completed 且无失败；两个可选诊断 check skipped，无未解决 review thread。
- **TASK-007 / Issue #486**：新增 app-owned、test-only Chrome 扩展元数据探测。Windows Tampermonkey 矩阵 [#43822893465](https://github.com/devin930906/userscript-auto-healer/actions/runs/43822893465) 的 21 个 Job 成功；product-candidate/document-idle Job 为 22 tests / 22 pass。metadata hint 只报告隔离测试中 synthetic/signature-key-verified-unpacked-CRX 的 metadata；extensionAuthenticityVerified/storeProvenanceVerified/scriptInstallationVerified/scriptInjectionVerified/gmApiVerified/businessVerified 均为 false。其余 product-candidate 四个 run-at Job 各 5/5，synthetic broken/fixed 注入日志为 injected=yes、GM default=true、roundtrip=false、business missing-target→recovered/done；native-gm 四个 Job 各 5/5、GM roundtrip=true，但 gmApiVerified/businessVerified/managerVerifiedForStable=false。它们仍是隔离合成实验，不能替代真实可信来源、用户授权产品链或回滚验收。Issue #486 保持 Open，TEST-017/018、GATE-004/005 未通过。
- **TASK-005 / Issue #510**：候选运行 [#43822893260](https://github.com/devin930906/userscript-auto-healer/actions/runs/43822893260) 在 Chrome 启动时经历 FETCH_REFUSED=t0..t4 并于 t5 解析出 CDP 版本，候选打包成功。此成功样本未提供此前 #43805989231 的 CDP_TIMEOUT 根因或确定性修复；#510 保持 Open。早先失败仍须保留，不能以这一成功关闭故障。
- **Windows 构建与正式 Release**：main Application Skeleton Checks #43824662618 success（1131 tests / 1129 pass / 0 fail / 2 conditional skip，Electron shell smoke success）；Portable Chrome #43822893326 success。main@d647003f391f9c350e6efb94a3924f604bd80ead 的 Candidate Packaging [#43828261977](https://github.com/devin930906/userscript-auto-healer/actions/runs/43828261977) success，EXE SHA-256 6ac2b0530b0243b3886a9d24d61ff0263ebf69d70423ed1abd0548ec0a63c65b，ZIP SHA-256 7994ad8452cb939beb0270111e5cd0eb4f051767b217a3159a2aeaf6da80f41e，Artifact 14207796979 / 到期 2026-11-19；均为候选包，未完成真实用户验收与 Stable GATE。
- **本地提交与远端同步**：Windows 完整仓库 worktree userscript-auto-healer-task007-worktree 的本地提交 3d484305822541d18e0d11dbae38128220e509ad，tree eed6e9625b859f5986d177fb0b98e8bb4f04dd4c；与远端 PR 分支 ce81f10124c9a8d8a976ece414ec6978415ad32f 的 tree 一致且工作树干净。推送尝试因 SEC_E_NO_CREDENTIALS 未成功；远端文件内容随后通过 GitHub 文件 API 同步，故本地 SHA 不在远端提交历史，也不等于 main 合并 SHA。
- **本地验证（PR #886 合并时点）**：Node v26.12.1 / npm 11.20.0；npm run build 通过；manager adapter 20 pass / 0 fail / 2 intentional skips；owned-chrome pipe focused test 1 pass；git diff --check 通过。该记录时点尚未对 malformed/oversized/timeout/abort pipe responses 添加逐项负向单元测试；后续 PR #891 已部分补入，见下方 TASK-007 进度记录。
- **下一执行入口**：TASK-007 / #486 的真实 Tampermonkey 支持矩阵、授权隔离 Profile、扩展身份/Store 来源、脚本安装注入、GM 往返、真实业务正反断言与失败恢复。需要具备用户授权的测试环境后再执行；当前未操作个人 Chrome/Profile。Issue 占用/认领不是前置条件。
- **Stable 状态**：未通过本轮全部 GATE；没有同一最终候选提交的正式 EXE+ZIP 及最终集中人工验收，没有新 Stable tag/Release。

## 2026-11-16 main@d647003f 的候选包补充

- 当前 main SHA d647003f391f9c350e6efb94a3924f604bd80ead 的 Windows Candidate run #43828261977 通过。回归 1131 tests / 1129 pass / 0 fail / 2 conditional skip；EXE/ZIP 载荷检查、安装启动、userData 保留和便携重定位通过。
- EXE 候选 SHA-256 6ac2b0530b0243b3886a9d24d61ff0263ebf69d70423ed1abd0548ec0a63c65b；ZIP 候选 SHA-256 7994ad8452cb939beb0270111e5cd0eb4f051767b217a3159a2aeaf6da80f41e；Artifact 14207796979，digest sha256:74a54016d4dbf3583a8f9fd7fb254bc4ea201dbc520c59f24f053b6c4cfe7be2，2026-11-19 到期。
- 候选 ZIP relocation 第一轮需要 8 次尝试后通过，后两轮首试通过；记录此次成功重试，不据此推断与 #510 有共同根因。#510 仍 Open，Stable 未通过。

## 2026-11-16 TASK-007 / Issue #486 辅助负向覆盖（不等于验收完成）

- PR [#891](https://github.com/devin930906/userscript-auto-healer/pull/891) 已 squash 合并至 `main@8484b76f6cadd88d106c2d5bd077cece2328cf72`。本次仅补强测试专用 Chrome debugging pipe 在 outgoing `error`/`close` 时的即时失败关闭，并覆盖 malformed/oversized、incoming/outgoing failure、timeout、abort。
- Windows Actions PR head `ebd83800ff0dabbceaac894f50bd793a7b9e94b0` 的隔离 TASK-007 matrix #43843893323 为 21/21 Job success；日志限定为 disposable manager/Chromium synthetic fixture，仍未通过 Chrome Web Store provenance、真实 Profile、真实业务或 Stable manager flags。
- 合并后 main push run [#43846393524](https://github.com/devin930906/userscript-auto-healer/actions/runs/43846393524) 在合并 SHA `8484b76f6cadd88d106c2d5bd077cece2328cf72` 上 success：1132 tests / 1130 pass / 0 fail / 2 conditional skips，Electron renderer/preload IPC smoke success。
- #486 保持 Open；REQ-017/018、TEST-017/018 与 GATE-004/005 的真实授权支持矩阵、Store/扩展身份、脚本安装注入、GM 往返、业务失败恢复仍未闭环。PR #891 不改变已批准范围或 Issue 依赖。

## 2026-11-16 TASK-005 / Issue #510 限时 CPU 压力对照（根因仍未确认）

- 手动 Windows run [#43834078871](https://github.com/devin930906/userscript-auto-healer/actions/runs/43834078871) 使用 `fix/task007-installation-probe-loop-closure-20261116` 精确源码 SHA `f2675b9e730a76c67aad760625f04c430828fc1e`，与失败候选 run [#43805989231](https://github.com/devin930906/userscript-auto-healer/actions/runs/43805989231) 相同。诊断输入开启 `chrome_startup_diagnostic=true`、`chrome_cpu_pressure=true`；两个测试专属 CPU 子进程最多运行 8 秒，不触碰用户 Chrome/Profile，原有 20 秒 CDP deadline、失败关闭和所有权检查未更改。
- 与失败及先前成功运行使用相同 `windows-2025-vs2026` runner image `20261103.298.1`。完整 owned-Chrome 测试文件 60 项为 59 pass / 0 fail / 1 skip，随后 3 个独立启动样本全部通过；CDP 分别于 t4、t1、t1、t1 解析，固定端口标记均为 `state=1 endpointMarker=0`，压力期间记录到的监听器时间线仅为 `t0:0`。同一 run 的常规 Windows 回归为 1126 tests / 1125 pass / 0 fail / 1 conditional skip，Electron shell smoke 成功。
- 限时合成 CPU 压力未复现 `CDP_TIMEOUT`；它不证明或排除更广泛的 runner/resource 时序因素，也没有给出确定根因或修复。该 run 未执行 Candidate Packaging、没有生成 EXE/ZIP；#510 保持 Open，TEST-006/008/009 与 Stable GATE 不因该结果判为通过。

## 2026-11-16 TASK-005 / Issue #510 cold 与预初始化 Profile 对照

- PR [#897](https://github.com/devin930906/userscript-auto-healer/pull/897) 增加一个仅 `workflow_dispatch` 可选的诊断模式；CPU 压力、全套件负载和 Profile 对照互斥。它只改测试与工作流，不改产品启动实现。
- main 合并 SHA `36a8760ade24b7249cead0d369f9e4deb300339a` 的手动 Windows run [#43885592542](https://github.com/devin930906/userscript-auto-healer/actions/runs/43885592542) success。warmup 使用同一签名 Chrome、第二个 disposable Profile、`--dump-dom about:blank` 且无 CDP 参数；退出码 0。之后 cold / warm 两臂都通过原有 20 秒启动及签名、PID、HTTP、WebSocket 所有权校验，并完成进程/listener 清理。
- 单次配对结果：cold `CDP_VERSION_PARSED=t1`，warm `CDP_VERSION_PARSED=t0`；listener 两臂均为 `t0:0,t1:1`，cold Local State 从 `t0:00` 到 `t0:10`，warm 预热后为 `t0:10`。没有复现历史 `CDP_TIMEOUT`。
- **续接判定**：此结果不定位原失败根因，也不足以排除更广泛 runner、profile 或启动时序因素。保留 #510 Open，不重复完全相同的对照；只有出现新的可比较失败证据才继续同类根因诊断。Issue、TASK 与 GATE 验收状态不变；EXE/ZIP、Stable 和最终人工验收仍未完成。

## 2026-11-16 TASK-007 / Issue #486 Chrome Browser MCP 实时复核

- 用户启动 MCP 后，Tampermonkey Service Worker 运行时返回官方扩展 ID、名称、5.5.1 版本和 MV3；唯一临时脚本实际安装、注入、`GM_getValue` 默认值及合成 broken/fixed DOM 对照见 [复核记录](evidence/2026-11-16-tampermonkey-browser-mcp-followup.md)。
- 本次仅验证手工管理器运行链。MCP 不允许访问 `chrome://version`，没有获得活动进程命令行/Profile 目录；指定 Data 路径绑定、Chrome 版本、Web Store 来源和完整支持矩阵仍未确认。脚本经人工修改，未验证产品自动诊断/修复、真实业务站点、GM 写入、备份或回滚。
- 测试脚本已从已安装列表移除并确认不再注入，回收站记录保留以避免全局清空。一次仪表盘快照意外返回其他脚本名称/描述，未打开源码或修改；因此本次证据只作受限观察。#486 保持 Open；TASK-007、TEST-017/018、GATE-004/005 与 Stable 状态不变。


## 2026-11-17 GitHub 当前状态与 TASK 续接

- **GitHub 快照**：`main@674548901ebf1e58b6ef9b66fc681a393a8c99a1`；产品改动 PR #901 合并 SHA `4129a966a2917801fe71f49d7d357f54404b8a77`，PR #902 仅记录该整合结果。当前无 Open PR；最新正式 Release 为 v1.1.3，Stable 未完成。
- **TASK-005 / #856 / #510**：#856 已关闭，其自管 Chrome/Profile 阶段交付仍不消除独立 Open Issue #510；最近 owned-Chrome 候选成功不能单独定位 #510 间歇启动问题。
- **TASK-007 / #486**：用户提供的 Chrome 截图确认其浏览器中已安装 Tampermonkey v5.5.1，并打开了扩展管理页；此前 UAH 状态框报告“未找到官方卡片”。应将此作为探测状态与实际浏览器观测之间的冲突继续核对，不再将其表述为“用户未安装 Tampermonkey”或要求重装。截图不提供进程级 Profile/Data 绑定，也不证明 UAH 产品安装、GM 或业务修复功能。#486 仍 Open。
- **TASK-013**：当前 Issue 为 #857；#440 已关闭历史，不能再当作当前任务的唯一跟踪项或关闭 TASK-013。
- **TASK-019/020/021**：#609/#610 保持 Open；#215 已关闭历史，不代表 TASK-020、GATE-009 或正式 Stable 完成。
- **候选双包**：PR #901 Windows Candidate run #44030158756 在 PR HEAD `408d55c18edb4245e7797bcbc57ed919d00286f1` 成功；候选工件 ID 14304753363，digest `sha256:2e8e90be2b0999dbbee9e224feeeacc3e226e06cf902de42c0a4babc4f30026f`，截至 2026-11-20T06:25:48Z 有效。它不是正式 Stable Release；最终同源发布构建、GATE 与用户验收仍待完成。
- **当前推进顺序**：继续解决 #486 的受控浏览器身份/管理器探测不一致与产品级安装、GM、业务恢复证据；再按真实依赖推进 #487/#488/#489/#857/#603/#604，后续完成 #605..#610 和最终集中人工 Stable 验收。

## 2026-11-19 TASK-013 / Issue #857 — read-only AST worker lifecycle 增量

- **范围**：复用 PR [#907](https://github.com/devin930906/userscript-auto-healer/pull/907) 的 `codex/task013-ast-isolation-20261118` Draft 分支。本轮完成分段与逐文件恢复的 Worker 生命周期修复；PR 仍为 Draft/WIP、未合并，Issue #857 保持 Open。改动不等于 TASK-013 全量的无人值守诊断/修复、浏览器验收或 Stable 完成。
- **实现**：修正 Node 子测试继承 `NODE_TEST_CONTEXT` 后误报通过；恢复时保留当前会话已完成的后续片段 AST 证据；普通队列加入进程级 Worker lease，阻止 progress 回调重入抢占下一段；严格检查 adapter 的 `previews` envelope，并把结构完整但尺寸/行内容错误的响应替换为失败行；把同一个单调全局 deadline 传入 Worker、重试、逐文件恢复及 resumed 展示重算；启动前最后时钟检查、迟到退休结果撤销、挂起 adapter 有界等待、协调器仍有在途任务时禁止恢复/重放、预算和用户取消按首次停止原因分类。
- **本地验证**：`npm run build` 成功；定向 `node --test --test-concurrency=1 dist/tests/analyze/import-preview.test.js dist/tests/jobs/batch-coordinator.test.js dist/tests/jobs/imported-analysis-queue.test.js dist/tests/jobs/native-checkpointed-import.test.js` 为 149/149 通过。完整 `npm test` 为 1,189 total / 1,135 pass / 42 fail / 12 skipped；42 个失败名称与本轮前的 main 基线及本轮前一完整运行完全相同，属于 TEST-003 symlink 与 TASK-011/TASK-018 restore-path 环境失败集。
- **整合边界**：本轮复核时 GitHub `main@c5266490f30ce8f262765728886295f4888a70ba`，#857 为 Open，PR #907 为 Draft。当前源代码与测试同步到 #907 的远端 HEAD 后，才检查该新提交的 Required Checks；本地测试不是 Windows Actions 或真实环境验收。
- **续接**：继续按真实依赖完成 #857/TASK-013 产品级多入口批处理、诊断及授权流程；仍需 TASK-007/#486 的完整真实管理器/业务与失败恢复验收、TASK-009..012 依赖及 TEST/GATE。正式 v1.1.3、同源 EXE/ZIP、所有必要 GATE 和最终集中人工验收仍是独立 Stable 门槛。

## 2026-11-19 TASK-007 / Issue #486 — Tampermonkey native install entrance & localized name support 增量

- **范围**：针对 Issue #486 的原始需求校准（自动检测选定自启 Chrome 的 Tampermonkey 安装与版本；缺失时提供一键安装入口，按 Chrome 正式支持的路径发起并保留其原生确认）以及用户真实 Windows Chrome 扩展管理页与探测状态之间的冲突开展工程增量修复。Issue #486 保持 Open。
- **实现**：
  1. 在 `src/manager/tampermonkey-installation.ts` 中引入官方扩展商店安装入口 `TAMPERMONKEY_WEBSTORE_URL`（基于权威 Extension ID `dhdgffkkebhmkfjojejmpbldmpobfkfo`）。
  2. `NOT_INSTALLED` 状态增加结构化 `installUrl` 字段，使上层调用方/界面在探测未安装时能向用户呈现标准官方商店安装通道。
  3. 扩充扩展名称匹配正则 `TAMPERMONKEY_NAME_PATTERN`，全面支持官方中英文及变体（`Tampermonkey`、`Tampermonkey (篡改猴)`、`篡改猴`、`Tampermonkey®` 等），解决真实中文环境下因本地化名称被硬编码严格拦截的问题；对伪造/非目标扩展名称（`Not Tampermonkey`、`Violentmonkey` 等）继续严格 fail-closed。
  4. 新增 `launchApprovedTampermonkeyInstallation` API，严格验证用户显式授权、受控自启 Chrome 实例、回环端口及 PID 归属，通过受控 CDP 发起官方 Web Store 安装页创建；明确保留 Chrome 原生安装弹窗与人工确认机制（`nativeConfirmationRequired: true`），严禁自动静默代点安装。
- **本地验证**：`npm run typecheck` 成功；`npm run build` 成功；`python .github/scripts/verify-predevelopment.py` 成功通过（28 REQ/TEST, 21 TASK, 11 GATE）；定向执行 `dist/tests/manager/tampermonkey-installation.test.js`（14/14 pass）、`dist/tests/manager/tampermonkey-adapter.test.js`、`dist/tests/manager/tampermonkey-preflight.test.js`、`dist/tests/manager/tampermonkey-diagnostic.test.js`、`dist/tests/manager/tampermonkey-gm-probe.test.js`、`dist/tests/manager/gm-report.test.js`，全部通过（157 项测试通过，0 失败，3 项 Actions 专用跳过）。
- **整合边界**：基线分支为最新 `main`（`66bf7e5`），创建独立开发分支 `feat/task007-tampermonkey-native-install-20261119`；修改范围严格限定于 `src/manager/tampermonkey-installation.ts`、`tests/manager/tampermonkey-installation.test.ts` 及 `docs/09-development-plan.md`，与开放中的 Draft PR #904 无任何文件重叠，符合 issue-merge-fence 协调隔离要求。
- **续接**：继续按依赖推进 TASK-012/Issue #603（批量导入脚本安装与版本确认）及 TASK-009..013、#857、#604..#610，为最终 Windows 真实环境集中人工验收创造充分前置条件。

## 2026-11-19 TASK-012 / Issue #603 — Batch userscript version reconciliation & installation launch 增量

- **范围**：针对 Issue #603 的原始需求校准（自动比对所有已导入脚本是否已安装及其身份、版本与内容；提供一键批量安装缺失脚本，逐项报告成功、取消、拒绝与失败，不仅检查文件是否已导出；复用 #486 的真实自启 Chrome/Tampermonkey）进行工程实现与严格质量门控。Issue #603 保持 Open。
- **实现**：
  1. 在 `src/export/manager-version-state.ts` 新增 `reconcileBatchImportedScriptsVersionState` API，支持批量导入脚本（最多 500 个）与扩展管理器内观测状态（或缺失状态）的原子比对；逐项判断 `INSTALLED_MATCH`、`INSTALLED_VERSION_DIVERGED`、`INSTALLED_HASH_DIVERGED`、`MISSING_NOT_INSTALLED` 与 `INVALID_DESCRIPTOR`，汇总输出缺失脚本列表（`missingScriptIds`）及统计指标，严格保持 fail-closed 权限标志（`automaticInstallAllowed: false, automaticPatchAllowed: false, automaticRollbackAllowed: false`）。
  2. 新增 `launchBatchUserscriptInstallation` API，复用受控 Chrome 实例及回环端口 PID 校验，受控通过 CDP `Target.createTarget` 依次发起各缺失脚本的官方/合法安装通道导航（支持 `http:`, `https:`, `file:` 协议，严格拦截 `javascript:` 等非法协议）；严格设置 `nativeConfirmationRequired: true` 与 `automaticSilentInstallForbidden: true`，逐项报告 `LAUNCHED_PENDING_USER_CONFIRMATION`、`REFUSED`、`CANCELLED` 或 `FAILED`。
  3. 严格防范 Proxy 注入攻击与原型污染：对传入的批次列表、单独描述符、观测凭据与用户选项均执行 strict prototype、isProxy 拦截与 ownPropertyDescriptors 提取，确保不触发任何 Proxy 陷阱。
- **本地验证**：`npm run typecheck` 成功；`npm run build` 成功；`python .github/scripts/verify-predevelopment.py` 成功通过（28 REQ/TEST, 21 TASK, 11 GATE）；定向执行 `dist/tests/export/manager-version-state.test.js`（13/13 pass）、`dist/tests/export/manual-candidate-export.test.js`（15/15 pass，export 模块共 28/28 pass）、`dist/tests/manager/tampermonkey-installation.test.js`（14/14 pass）。
- **整合边界**：基线分支为最新 `main`（`fa33ee6`），工作分支为 `feat/task012-batch-install-version-reconciliation-20261119`；修改范围严格限定于 `src/manager/tampermonkey-installation.ts`、`src/export/manager-version-state.ts`、`tests/export/manager-version-state.test.ts` 及 `docs/09-development-plan.md`，与开放中的 Draft PR #904 无任何文件重叠，符合 issue-merge-fence 协调隔离要求。
- **续接**：继续按依赖推进 TASK-009/Issue #487（保守选择器修复补丁生成）、TASK-010/Issue #488（业务验收与断言门控）、TASK-011/Issue #489（原子事务与版本回滚）及剩余 TASK。

## 2026-11-20 TASK-013 / Issue #857 — renderer dropped-file batch intake 增量

- **范围与基线**：本地 worktree 分支 `feat/task013-dropped-batch-20261119`，父提交 `main@146f9a987e7e633496d723e7f517c68282e1fe07`。本独立工作单元将 renderer 文件选择/拖放入口改为主进程拥有的一次性批次，并复用现有只读 AST 队列；不关闭 #857。
- **实现补充**：首轮把 reload 演练移到既有 renderer 断言之后，并拆开行为 probe 与 preload key inventory 的错误码；其后 PR #925 head `85cb24f05ff500152830ea080779c9c9a403b55e` 的两条 Windows smoke 均报 `SHELL_SMOKE_BEHAVIORAL_PROBE_FAILED`，preload key inventory 检查已通过。复核确认 smoke 在派发文件选择事件后立即取消，早于首个 `File.arrayBuffer()`；取消监听先设置 `cancelRequested`，导入循环因此在读取首个文件前退出，“已完成一份、剩余一份未读”断言不成立。修复 commit `23c9e806f0cc024cdefe86771183a7f84abee797` 为首读加受控门闩：按测试文件名临时包装 `File.prototype.arrayBuffer()`，首读开始时还原原方法，等待取消事件后再释放读取；新增只含布尔值的首读、取消和摘要诊断。旧 run 失败发生在 reload 演练之前。
- **提交与远端同步**：初始 intake `9156b96e2c9070eadbfef1fd87b3089da8e58453`（tree `d2304b2501ea7b47022942c90117cf4e854f3244`）；生命周期修复 `1ed27890b02d13b266a9285c5bd264fcbe4d1a0c`（tree `171261f8ba72479e669a454ecf42032f8e1ce5ed`）；smoke 隔离与诊断 `4b081a6d0883c6772a489df2d8b90fe483a7a8d9`（tree `726372e884637c3f1bf3a0dc461e3dd05f6be442`）；本轮 smoke 时序修复 `23c9e806f0cc024cdefe86771183a7f84abee797` 对应远端 commit `ce62dc41b33e417328581ec2e3fef992d8e1f813`（两者 tree 均为 `69a1d8306950da0dcc44e2ae2d921e75f1529f5c`）。此前本地文档 commit `0162420a7a8f5902688a6ce20abfbb18f7b5624a` 对应 PR head `0f1a2cdc5e29d612d82e996d88058359fa9c39c9`，tree 均为 `7a06f0a39634e451b8b8564608d6f626f5e07ace`；本次最终 Actions 记录正在更新，提交后还需同步这三份文档。
- **本地验证**：本轮 `npm run build`、`npm run typecheck`、desktop-boundary 75/75、predevelopment（28 REQ/TEST、21 TASK、11 GATE）与 `git diff --check` 通过。组合 desktop-boundary/import-service 检查为 111 项中 110 通过、1 失败；唯一失败为本地 Windows sandbox 不允许创建测试 symlink 的既有 TEST-003 `EPERM`。最近一次全量本地 `npm test`（本轮 smoke 时序修复前）为 1,228 total / 1,215 pass / 1 fail / 12 skipped，同一 symlink `EPERM`，不冒充本轮完整本地套件验证。
- **Windows Actions 证据**：前一 PR head `85cb24f05ff500152830ea080779c9c9a403b55e` 的 Application Skeleton [#44572760408](https://github.com/devin930906/userscript-auto-healer/actions/runs/44572760408) 和 Candidate Windows [#44572760311](https://github.com/devin930906/userscript-auto-healer/actions/runs/44572760311) 都因行为 probe 失败。随后 PR source head `0f1a2cdc5e29d612d82e996d88058359fa9c39c9` 的 Application Skeleton [#44576767661](https://github.com/devin930906/userscript-auto-healer/actions/runs/44576767661)（含 boundary 与 Windows shell smoke）及 Candidate Windows [#44576767432](https://github.com/devin930906/userscript-auto-healer/actions/runs/44576767432) 均成功；Candidate Node suite 为 1,228 total / 1,225 pass / 0 fail / 3 skipped，候选打包和校验成功。临时候选 Artifact [14556773161](https://github.com/devin930906/userscript-auto-healer/actions/runs/44576767432/artifacts/14556773161)，上传 ZIP SHA-256 `f18619e66f41dfe91b5965f0bfc1f6065335154ef90ee5968aa4df80140b59f5`，278,093,770 bytes，到期 2026-11-22T17:33:22Z；它不是 Stable Release。Documentation Integrity [#44576768274](https://github.com/devin930906/userscript-auto-healer/actions/runs/44576768274)、Issue Coordination [#44576960099](https://github.com/devin930906/userscript-auto-healer/actions/runs/44576960099) 和隔离 Tampermonkey experiment [#44576767709](https://github.com/devin930906/userscript-auto-healer/actions/runs/44576767709) 成功。隔离实验不是商店来源证明、真实用户验收或最终 Stable GATE。
- **本地 Electron smoke**：下载 pinned Electron 44.9.1 并确认 `electron.exe --version` 成功；`--uahtest-shell-only` 在生成回执前以 `0xC0000005` 退出，无 smoke receipt。此本机结果无法判定 renderer smoke 通过，PR 必须等待 Windows 2025 Application Skeleton Checks。
- **候选基线**：main@146f9a 的 Candidate run [#44555096125](https://github.com/devin930906/userscript-auto-healer/actions/runs/44555096125) 成功，Artifact 14545696747，digest `sha256:31d19dcfbeca8a80bd295228c45d4c3e4f116fdff70c3615a1406283213f4ec8`，到期 2026-11-22T15:36:37Z。它在本增量之前构建，仍是 Candidate，不能代表本分支。
- **仍需完成**：#857 的可恢复持久批处理、逐脚本动态诊断、保守修复候选、可选 AI、同一自启动 CDP Chrome 中真实 Tampermonkey/GM/业务正反断言与失败恢复均未串联或验收；TEST-022/GATE-007 未通过。等待当前 PR head 的 Windows checks 完成后复核，并持续推进 Issue 其余范围。Stable 仍未完成。

## 2026-11-20 TASK-013 / Issue #857 — 所有导入入口共用持久只读 AST 检查点

- **增量范围**：在 PR [#925](https://github.com/devin930906/userscript-auto-healer/pull/925) 的 renderer 文件选择/拖放批次上，接通与原生多选/文件夹相同的主进程只读 AST 检查点流程；原生选择、文件夹、renderer file picker、拖放批次及保留的单文件入口均由主进程以 `app.getPath('userData')` 选择 journal root。renderer 不可传入 journal 路径。
- **安全与恢复边界**：检查点绑定有序脚本字节哈希和编码，只保存有限调度/任务状态，不保存源码、文件名、来源路径、URL 或 AST 正文。重复导入只命中调度提示；仍会对本次导入字节重新运行 Worker AST。journal 失败、非法或取消时保持 `BLOCKED`，不退回无检查点的内存队列，也不改写原始脚本。界面说明检查点不构成网页、GM API、业务验证或修复完成。
- **回归覆盖**：新增 `TASK-013/TEST-022/026`，验证 renderer 导入的新鲜解析、同一有序批次重导入仍重跑 Worker、顺序或字节变化不复用批次身份、journal 不含文件名/URL/源码，以及预先取消不写新检查点。扩展 Windows shell-only smoke，实际拖入合成文件并确认界面显示检查点状态。
- **本地验证**：`npm run build`、`npm run typecheck`、`git diff --check` 与 `.github/scripts/verify-predevelopment.py` 均通过（28 REQ/TEST、21 TASK、11 GATE）；`dist/tests/jobs/native-checkpointed-import.test.js` 为 40/40 通过。完整 `npm test` 为 1,229 项：1,174 pass / 43 fail / 12 skipped。43 个失败按类别为 TASK-011/TEST-020 恢复路径 41 项、TEST-003 symlink 1 项、TASK-018/TEST-018 端到端 1 项；不得将本轮全量套件标为通过。新改动对应的检查点测试通过，其他失败需独立调查。
- **远端状态**：本轮 PR #925 新 HEAD 的 Windows shell smoke、Application Skeleton、Candidate 与文档/Issue checks 尚待复核；旧 HEAD 的绿色结果不替代本轮 CI。#857 保持 Open。
- **后续与 Stable 边界**：这一增量只统一批次导入与只读 AST 调度，不包含逐脚本动态诊断、修复候选、AI、真实 Tampermonkey/GM/业务正反断言与失败恢复。TEST-022/GATE-007 和 Stable 的其他必要 GATE、最终同源 EXE+ZIP、集中人工验收均未完成。

## 2026-11-20 TASK-013 / #857 — Windows shell smoke drop target 回归修正

- **Windows 证据**：PR #925 head `70f022855fd38df81aa4b2fbd0aca46fc6d84937` 的 Candidate Node suite 为 1,229 total / 1,226 pass / 0 fail / 3 skipped；随后其 Electron smoke 失败并报告 `SHELL_SMOKE_DROPPED_BATCH_CHECKPOINT_NOT_VISIBLE`。实际 UI 容器是 `#drop-area`，新 smoke 查询了不存在的 `#drop-zone`，因此没有真正派发 drop 事件。
- **并行独立失败**：同一 HEAD 的 Application Skeleton boundary run [#44749647406](https://github.com/devin930906/userscript-auto-healer/actions/runs/44749647406) 为 1,229 total / 1,225 pass / 1 fail / 3 skipped；唯一失败是既有 `TEST-006/008/009` owned-Chrome 测试收到 `CDP_TIMEOUT`。诊断报告首次启动重试、61 次拒绝连接、3 次 fetch timeout、进程仍运行且监听 PID 匹配；不得归因于本次拖放烟测或将此 Windows 环境超时改写为通过。该失败后 `windows-shell-smoke` job 被跳过。
- **修正与验证**：`app/main/index.ts` smoke 选择器已改为 `#drop-area`；`tests/security/desktop-boundary.test.ts` 新增回归检查，保证 smoke 查询必须与 `app/ui/index.html` 实际容器一致。新增用例 RED 后修复为 GREEN；本地 build 成功，desktop-boundary 76/76 通过。
- **远端状态**：上述 smoke 与 boundary 失败属于精确 PR HEAD `70f022...`。修正提交推送后须检查新 HEAD 的 Application Skeleton shell smoke、Candidate packaging、Documentation Integrity、Issue Coordination 及 Tampermonkey matrix；旧 HEAD 结果不能作为该修正的验证。PR #925 与 Issue #857 均保持 Open，Stable 未完成。

## 2026-11-20 TASK-013 / #857 — 打包拖放烟测 user gesture 修正

- **上一 HEAD 的远端证据**：PR head `2f64903b33468e2c7ff3ec3df5ac1b8d26a2029a` 的 Application Skeleton run [#44751619269](https://github.com/devin930906/userscript-auto-healer/actions/runs/44751619269) 与 `windows-shell-smoke` job 成功；Candidate run [#44751619131](https://github.com/devin930906/userscript-auto-healer/actions/runs/44751619131) 在 Candidate Node suite 1,230 total / 1,227 pass / 0 fail / 3 skipped 后，于提取版 Electron smoke 再次报告 `SHELL_SMOKE_DROPPED_BATCH_CHECKPOINT_NOT_VISIBLE`。因此更正 drop-area 选择器后，候选打包仍未通过。
- **定位与修正**：实际渲染器 drop probe 以 `executeJavaScript(..., true)` 执行；后续独立 checkpoint smoke 漏传 Electron 的 user-gesture 参数。新增回归断言先 RED，要求烟测传入 `true` 后，本地变为 GREEN。该根因判断仍待 Windows 新 HEAD 复核，不能把关联推断当成 CI 已通过。
- **提交与本地验证**：修正提交本地 `d45556acc8c4d948dbbf2d6df6a47e34d1b61856`，同步后 GitHub PR head 为 `a77e1a9991929e2ff33880f364004b0de0c0a107`。`npm run build`、`npm run typecheck`、`.github/scripts/verify-predevelopment.py`、`git diff --check` 均通过；desktop-boundary 为 76/76 通过。
- **最新远端状态**：head `a77e1a9991929e2ff33880f364004b0de0c0a107` 的 Candidate run [#44753751388](https://github.com/devin930906/userscript-auto-healer/actions/runs/44753751388)、Application Skeleton [#44753751412](https://github.com/devin930906/userscript-auto-healer/actions/runs/44753751412)、Documentation Integrity [#44753751559](https://github.com/devin930906/userscript-auto-healer/actions/runs/44753751559) 与隔离 Tampermonkey run [#44753751463](https://github.com/devin930906/userscript-auto-healer/actions/runs/44753751463) 已启动；本记录更新时仍在运行，须以各 run 最终状态为准。PR #925 保持 Open、未合并，Stable 未完成。
