# 正式开发实施计划

> 状态：Windows CDP、真实 GM 调用、两组 broken/fixed 人工选择器基准及临时 EXE/RAR5 工具链均有实证。ADR-001 已有条件选择 Electron+TypeScript 首期安全工程基线；TASK-001 可有限准入，目标 Tampermonkey/实机/真实修复与 Stable 均不得提前标注通过。代码路径仍为预计新增。

## 开发阶段
M0：证实 Chrome/管理器/交付可行性；M1：可运行安全入口+导入+静态分析；M2：动态诊断与真实管理器验收；M3：修复/版本/批处理/AI/监控/共享层；M4：风险/性能/集成与 Windows 双包装；M5：全部 Stable 门槛和 Release。未人为指定发布日期。

## 里程碑
M0 退出：系统与独立路径 Chrome/CDP POC-01A/B 已实测，且 POC-02D 在隔离 Windows Chromium/Violentmonkey 2.49.0 对标准 HTTPS 页实测 .user.js 注入及 GM_getValue 实际调用（https://github.com/devin930906/userscript-auto-healer/actions/runs/39092523277）。在准入 TASK-001 前仍须定案首选管理器、可承诺 Windows/Chrome 版本矩阵、至少一个真实故障/功能断言样本、条件性 ADR-001。POC-03A/B 证明临时 EXE 与真 RAR5 格式可行，但生产 RAR 许可证、正式应用包安装/直启属于发布门槛（可晚于初始代码，不得晚于发布）；M1 退出：TEST-001..005/011/026 的可重复结果；M2：CDP+管理器 TEST-006..013/017/018 的真实证据；M3：TEST-014..025；M4：安全恢复及 EXE/RAR 测试；M5：所有 GATE 实证通过。

## 任务清单
| 编号 | 目标 | 关联需求 | 优先级 | 前置依赖 | 实施模块 | 预计文件范围 | 具体执行步骤 | 交付结果 | 测试编号 | 完成条件 | 状态 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TASK-001 | 建立已确定技术骨架与安全入口 | REQ-001;REQ-026 | 最优先 | POC-01/02 与 ADR-001 可用 | app/main app/preload app/ui | 预计新增：app/main/index.ts；app/preload/index.ts；app/ui/index.tsx；tests/security/desktop-boundary.test.ts | 创建最小进程隔离与配置验证测试；运行类型与安全测试 | 可受控启动的开发壳 | TEST-026 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
| TASK-002 | 脚本导入与路径安全 | REQ-001..003 | 必须实现 | TASK-001 | src/import tests/import | 预计新增：src/import/import-service.ts；tests/import/import-service.test.ts | 写目录/编码/路径负例再实现批量导入 | 原字节保留与文件清单 | TEST-001..003 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
| TASK-003 | 元数据与 AST 定位器 | REQ-004;REQ-011 | 必须实现 | TASK-002 | src/analyze tests/analyze | 预计新增：src/analyze/metadata-parser.ts；src/analyze/selector-analyzer.ts；tests/analyze/ast.test.ts | AST 夹具先行，提取匹配/作用域/动态标记 | 静态证据报告 | TEST-004;TEST-011 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
| TASK-004 | 网站与验证场景登记 | REQ-005 | 必须实现 | TASK-003 | src/scenarios tests/scenarios | 预计新增：src/scenarios/scenario-registry.ts；tests/scenarios/registry.test.ts | 设计登录/操作/断言契约与缺失状态 | 可管理的测试场景 | TEST-005 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
| TASK-005 | Chrome/Profile/CDP 安全启动 | REQ-006..009 | 必须实现 | TASK-001;POC-01 | src/browser tests/browser | 预计新增：src/browser/chrome-launcher.ts；src/browser/cdp-session.ts；tests/browser/launch.test.ts | 先写默认 Profile/占用/错实例失败测试，再写自管启动与身份核对 | 仅接入授权 Chrome | TEST-006..009 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
| TASK-006 | DOM/SPA 动态观测 | REQ-010;REQ-012 | 必须实现 | TASK-005 | src/observe tests/observe | 预计新增：src/observe/dom-observer.ts；tests/observe/dynamic.test.ts | 盲区和延迟/SPA 夹具驱动 CDP 观测 | 可见性快照 | TEST-010;TEST-012 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
| TASK-007 | 真实油猴管理器适配 | REQ-017;REQ-018 | 必须实现 | TASK-004..006;POC-02 | src/manager tests/manager | 预计新增：src/manager/manager-adapter.ts；tests/manager/manager-e2e.test.ts | 先构建用户许可 Profile 初始化和管理器预检，后验实际脚本运行/GM断言 | 可复核真实运行证据 | TEST-017;TEST-018 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
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
| TASK-018 | 安全审计与端到端回归 | REQ-001..026 | 必须实现 | TASK-017 | tests/security tests/e2e | 预计新增：tests/security/permissions.test.ts；tests/e2e/browser-userscript.test.ts | 覆盖严重风险、真实扩展及资源负例 | 安全/回归证据 | TEST-007;TEST-018;TEST-026 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
| TASK-019 | Windows EXE 安装版 | REQ-027 | 必须实现 | TASK-018;POC-03 | packaging/windows .github/workflows | 预计新增：packaging/windows/installer.iss；.github/workflows/build-windows.yml（预计新增；Inno Setup 候选） | 锁定安装工具/权限/升级测试，Windows 构建验收 | 真实 EXE 安装包 | TEST-027 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
| TASK-020 | 真 RAR 便携发行 | REQ-028 | 必须实现 | TASK-018;POC-03 | packaging/portable .github/workflows | 预计新增：packaging/portable/create-rar.ps1；.github/workflows/build-windows.yml | 合法 RAR 创建与魔数/解压/直启验证 | 真实 RAR 包 | TEST-028 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |
| TASK-021 | 稳定版最终集成发布验收 | REQ-001..028 | 必须实现 | TASK-019;TASK-020 | docs/release .github/workflows | 预计新增：.github/workflows/release.yml；docs/08-release.md | 跑全部适用 GATE；以同一提交出双包与校验值 | 可追溯 Stable Release | TEST-001..028 | 测试有实际通过证据 + 代码审查 + 提交记录 | 未开始 |

## 任务依赖
POC-01/02、ADR-001/002 先行→TASK-001→002/003/005→004/006/007→008/009/010/011→012/013/014/015/016→017/018→019/020→021。修复/安全与真实验收必须协作，不允许绕过测试门控。

## 优先级
影响用户安全和核心真实验收的路径优先；功能完整性与产品交付形式都属 Stable 必要项。不得因额外可选功能拖延最终验收。

## 实施范围
从单用户 Windows 本地处理、可选 AI 网关到真实 .rar 双包，非必要 Web 服务/云同步/其他 OS 不纳入。每项开发采用先失败测试→最小实现→复测→独立评审与符合仓库策略的整合。

## 验证条件
测试指令将随 Node lockfile、脚手架与 Windows runner 落地；当前没有 npm test、build 或实际运行输出，禁止复制拟定命令伪称已验证。

## 完成条件
各任务需保留代码路径、提交SHA、关联 TEST 和 CI/真实环境证据；最终 GATE 按 08 原类别逐项判断，不能以任务数代替工程进度。

## 下一任务

在当前有限工程准入下，下一首要任务为 **TASK-001：最小安全桌面骨架及其安全负例**。按 ADR-001 的 Electron/TypeScript 条件基线实现 renderer sandbox/contextIsolation/无 Node Integration、白名单 preload IPC、路径/配置验证与错误处理，真正运行适用测试并提交可追溯源码；**本准备阶段没有实际开发这些产品功能**。

后续 TASK-007/018 的 Tampermonkey 与用户实际便携 Chrome、真正损坏脚本、授权登录与完整业务断言尚须单独验证；本轮 POC-04A 的两组 `broken/fixed` 由人手预设，仅证明验收方法可重复（https://github.com/devin930906/userscript-auto-healer/actions/runs/39093275851），绝不代表自动修复或回滚已开发。RAR 生产许可、真实应用双包与稳定发布留给 TASK-019..021 的硬门槛，不能无期限拖延也不能假装已解决。详细见 docs/13-predevelopment-admission.md。
