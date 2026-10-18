# 测试策略与验证体系

> 状态：正式产品 TEST-001..028 均未执行（无产品功能源码）；开发前 CDP、真实 Violentmonkey+GM_getValue 与临时打包 PoC 已有限实测，不能与正式 TEST 或 Stable 验收混为一谈。

## 测试范围
REQ-001..028 一一覆盖；NFR-001..012、RISK-001..013 需在主要负面用例中核查。静态样本包括字面/动态 selector、混淆依赖、畸形脚本；真实样本包括 SPA、iframe、管理器 GM API、登录态、CDP 端口冲突、备份失败与修复后功能断言。

## 测试层级
单元：AST、补丁、状态与配置；集成：CDP 假端点、AI mock、持久化、批量协调；E2E：真实 Chrome+管理器与预先获许可的测试网站；回归：共享兼容层及已有修复；安全：恶意脚本/提示注入/文件与网络权限；性能：导入与 DOM 快照的样本基线（不伪造阈值）；安装/便携：干净 Windows VM。

## 测试环境
预期 CI 为 Windows x64 Windows 2025 runner + 锁定 JS 工具链，环境与版本实际部署未验证；真实用户 Chrome / 扩展与登录态只能在授权的专用 Windows 验证环境中实施。不能用 Playwright 普通 evaluate 代替 Tampermonkey 的执行语义。部分场景需要交互式桌面；GitHub runner 能否稳定验证为 POC-02 问题。

## 测试用例
| 编号 | 对应需求 | 测试层级 | 测试环境 | 前置条件 | 测试输入 | 执行步骤 | 预期结果 | 失败判据 | 自动化方式 | 状态 |
|---|---|---|---|---|---|---|---|---|---|---|
| TEST-001 | REQ-001 | 单元/集成 | Node/Windows | 授权目录 | 有效/畸形脚本 | 输入安全与批量导入：导入、比对哈希/错误 | 有效保留原字节、畸形独立拒绝 | 畸形脚本执行或修改原文件 | 单元+集成 | 阶段自动化通过；待 Stable 集成复核 |
| TEST-002 | REQ-002 | 集成 | Windows GUI | 界面可用 | 3 个 .user.js 与重复文件 | 拖放与路径选择：拖放/多选，核对列表 | 全部独立导入且去重可见 | 丢文件或越界 | UI 集成 | 阶段自动化通过；真实文件夹拖放待验收 |
| TEST-003 | REQ-003 | 单元/集成 | Windows FS | 目录已授权 | 嵌套、软链接、非 JS | 目录扫描边界：递归扫描 | 仅处理允许路径及匹配后缀 | 无限递归、越界 | 单元 | 阶段自动化通过；待 Stable 集成复核 |
| TEST-004 | REQ-004 | 单元/集成 | Node JS Parser | 样本夹具已创建 | @match/@grant/@run-at/@require | 元数据解析：分析并对比原头 | 正确解析且不改原字节 | 字段缺失/改写 | 单元 | 静态单元阶段验证通过；待产品集成复核 |
| TEST-005 | REQ-005 | 集成 | Windows UI | 脚本元数据 | 登录前提、URL、动作断言 | 目标网站与场景：注册/运行预检 | 缺前置则标 UNKNOWN | 没登录判成功 | 集成 | 阶段自动化通过；真实浏览器场景执行待验收 |
| TEST-006 | REQ-006 | 端到端 | Windows 真实 Chrome | 获用户许可 | 两个 Chrome.exe | 便携 Chrome 路径：分别启动并确认路径版本 | 完全使用所选程序 | 默默使用默认 Chrome | 真实 E2E | 已规划 |
| TEST-007 | REQ-007 | 端到端 | Chrome 136+ Windows | 准备专用目录 | 默认/在用/新 Profile | Chrome Profile 安全：分别检查并启动 | 默认和在用拒绝，新路径可验证 | 修改原 Profile | 真实 E2E | 已规划 |
| TEST-008 | REQ-008 | 端到端 | Windows Chrome | 自管浏览器 | 9223 与占用端口 | CDP 启动端口：启动与监听检查 | 启动后可连接，冲突安全失败 | 误接管旧实例 | 真实 E2E | 已规划 |
| TEST-009 | REQ-009 | 端到端 | Windows CDP | 可同时运行两个实例 | 伪 /json/version 与目标页 | CDP 会话归属：核对实例/目标 | 错误实例拒绝 | 只按端口判成功 | 真实 E2E | 已规划 |
| TEST-010 | REQ-010 | 端到端 | 真实 Chrome | 测试 iframe/Shadow | 跨域 iframe/closed root | 受限 DOM 边界：快照并审查 blind spots | 可见性明确，不伪称完整 | 绕过隔离或误报 | 真实 E2E | Windows 自管 Chrome 阶段自动化通过；用户环境及完整发布回归待验收 |
| TEST-011 | REQ-011 | 单元/集成 | Node | 正常与动态 AST | 字面/拼接/封装/备用选择器 | AST 源码定位：分析行列作用域 | 动态待确认、字面来源正确 | 误报全覆盖 | 单元 | 静态单元阶段验证通过；待产品集成复核 |
| TEST-012 | REQ-012 | 端到端 | Chrome 测试页 | 事件/路由夹具 | 路由与延迟渲染 | SPA 动态诊断：切换路由后监控 | 等待与时序证据正确 | 加载竞态错误归因 | 真实 E2E | Windows 自管 Chrome 阶段自动化通过；用户环境及完整发布回归待验收 |
| TEST-013 | REQ-013 | 单元/集成 | 诊断模拟器 | 受控错误夹具 | 网络、权限、异常、断言 | 故障根因分类：逐项分类 | 不将非 DOM 强行改选择器 | 误分类强改 | 单元+集成 | 已规划 |
| TEST-014 | REQ-014 | 单元/集成 | Patch 夹具 | 可确认原意 | 坏定位器/不确定候选 | 本地修复规则：生成 diff | 只做最小变更 | 删功能或越权修改 | 单元 | 已规划 |
| TEST-015 | REQ-015 | 集成 | Mock AI | 用户同意 | 含恶意 patch/敏感占位符 | AI 候选保护：网络调用及候选审查 | 仅候选；不发送禁止字段 | 直接采用或泄密 | 集成+抓包 | 已规划 |
| TEST-016 | REQ-016 | 集成 | Mock API | Base URL 已允许 | /models 不存在及手填 | 自定义 AI 兼容：探测/手填/限额测试 | 失败有安全 fallback | 无限重试/明文Key | 集成 | 已规划 |
| TEST-017 | REQ-017 | 端到端 | Chrome+真实 Tampermonkey | 已授权的隔离测试 Profile | 扩展缺失/错误管理器/缺许可/不同注入模式/GM 无权限 | 核对 Tampermonkey 身份版本、Chrome 权限、脚本安装启用、@match/@grant/@run-at、站点权限与注入模式 | Tampermonkey 前置条件全部满足，否则拒绝 VERIFIED | 仅 CDP/Violentmonkey 通过冒充 Tampermonkey | 独立 Tampermonkey E2E | 仅运行目标探测与拒绝负例已阶段执行；真实 Tampermonkey 安装/授权/GM/业务验收仍未执行 |
| TEST-018 | REQ-018 | 端到端 | Chrome+真实 Tampermonkey | 真实 Tampermonkey/测试脚本已安装并授权，场景已定义 | 失效/已修脚本、GM API、不同注入时机 | 在 Tampermonkey 中实际注入，调用 GM API、执行业务断言与回归，记录扩展和浏览器版本及运行证据 | 真实 Tampermonkey 的业务断言满足才 VERIFIED | Violentmonkey/原生 DOM/人工修正版冒充产品自动修复 | 独立 Tampermonkey E2E | 已规划 |
| TEST-019 | REQ-019 | 单元/集成 | Diff 审核引擎 | 原脚本及候选 | 扩增 @grant/无关变动 | 补丁与权限审查：计算变更与策略 | 自动应用被阻断 | 权限静默变化 | 单元 | 已规划 |
| TEST-020 | REQ-020 | 可靠性 | Windows NTFS | 可修改测试文件 | 成功/磁盘满/文件锁 | 版本备份回滚：应用、模拟中断、回滚 | 原字节 hash 恢复 | 原文件损坏 | 故障注入 | 已规划 |
| TEST-021 | REQ-021 | 单元/集成 | Windows FS | 候选+证据 | VERIFIED / UNKNOWN | 自动应用策略：分别执行门控 | UNKNOWN 原文件不变 | 无证据覆盖 | 单元+集成 | 已规划 |
| TEST-022 | REQ-022 | 集成 | Batch 测试环境 | 多份脚本 | 一成功、一失败、一取消 | 批量取消与恢复：执行/重启/重试 | 隔离终态、无重复应用 | 单错拖垮全部 | 集成 | 已规划 |
| TEST-023 | REQ-023 | 端到端 | Chrome 管理器 | 本地修复产物 | 本地与已安装不同版本 | 导出与扩展更新：分别验证两个状态 | 保存与浏览器内更新不同步时显式显示 | 假称已安装 | 真实 E2E | 已规划 |
| TEST-024 | REQ-024 | 单元/集成 | 本地状态库 | 多次有证据运行 | 过去成功当前未知 | 健康监控与历史：查询健康时间线 | 显示当前未知且保留历史证据 | 继承过时成功 | 单元 | 已规划 |
| TEST-025 | REQ-025 | 端到端 | 多个测试脚本 | 共享映射场景 | 定位器版本前后 | 共享层版本回归：升级/运行回归/回退 | 使用者均验证或阻止应用 | 一次升级连锁破坏 | 集成+真实 E2E | 已规划 |
| TEST-026 | REQ-026 | 安全 | Windows sandbox | 恶意 JS 夹具 | 文件和网络探针 | 不可信脚本隔离：导入/执行并观测权限 | 无法越权访问应用主进程 | 任意主进程执行 | 安全 E2E | 已规划 |
| TEST-027 | REQ-027 | 端到端 | 干净 Windows VM | 候选安装包 | 安装、升级、卸载 | EXE 安装卸载：执行全流程 | 正常启动，数据保留符合说明 | 缺依赖/卸载损坏 | 真实 VM | 已规划 |
| TEST-028 | REQ-028 | 端到端 | 干净 Windows VM | 同源提交的真实 ZIP 已构建 | ZIP 文件头/清单/安全解压/只读与移动路径/校验值 | 校验 PK ZIP 类型与条目安全，解压后直接启动并运行核心功能、读写和退出 | 真实 ZIP 完整、无路径穿越、可启动且数据路径安全 | 假 ZIP、损坏、遗漏依赖、危险条目或无法运行 | 云端构建+真实 VM | 已规划 |

## 需求映射
TEST-001..028 对应 REQ-001..028；NFR 安全对应 007/009/015/020/026，兼容对应 006/017/018，完整性 020/022，安装与便携 027/028。每次实施后更新用例对应文件/运行号/证据位置。

## 自动化验证
规划次序：checkout → 固定工具链与依赖 → format/lint/typecheck → 单元与集成 → 构建 → Windows 文件系统负例 → 安全检查 → 条件式 E2E → 工件归档。具体命令待脚手架产生后确定，目前不存在可执行的测试命令；不能填写成功记录。

## 真实环境验证
报告必须记录脚本和网页版本/Hash、Chrome 可执行文件真实路径、Profile、端口、扩展版本和安装状态、@grant、页面前置状态、执行步骤、断言与截图/日志（全部脱敏）。管理器兼容测试的必要证据应分层记录：扩展 Worker、用户脚本授权、浏览器内脚本存储与启用、@match、注册的 loader 和站点权限、目标页面脚本真实注入、GM API、业务断言。**只满足前六项不能判定 TEST-018 通过**；2026-10-18 非标准本地动态端口 POC 曾注册但不执行（https://github.com/devin930906/userscript-auto-healer/actions/runs/39091275121），在标准 HTTPS 的 IANA 保留示例网址上，**真实 Violentmonkey .user.js 注入、调用 GM_getValue 的默认值断言已通过**（https://github.com/devin930906/userscript-auto-healer/actions/runs/39092523277）。这一实证仅是准备阶段的可行性验证，不包含修复后回归，不可直接标记产品 TEST-018 通过。目标兼容矩阵应同时覆盖标准/非标准端口的合法 @match、扩展授权/沙箱、真实浏览器差异。CI 不能启动交互式 Chrome 管理器时另由获授权 Windows VM 验证，不得替代为模拟结果。

## 开发前 POC-04A：已知选择器失效与人工修正回归

GitHub Windows 2025 的两个**独立**真实 Violentmonkey MV3 v2.49.0 任务（`.github/workflows/windows-manager-extension-poc.yml` 中的 `broken/fixed` matrix）已通过：https://github.com/devin930906/userscript-auto-healer/actions/runs/39093275851。

- `broken`：真实油猴脚本与 GM_getValue 仍可执行，但脚本定位 `#poc-obsolete-anchor`，目标 DOM 只有 `#poc-new-anchor`，业务断言 `missing-target` 且无目标动作。
- `fixed`：提前人工修改为 `#poc-new-anchor`，真实油猴脚本与 GM API 执行，业务断言 `recovered`，目标元素动作标记存在。
- 这组样本由测试代码人工预置/更改定位器，不实现自动故障分类、补丁推导、原始文件覆盖、回滚。只能证明**方法能在真实管理器中区分功能失败与恢复**，未来 TEST-013/014/018/020/021 仍需在实际产品中实现与验证。
- 如果只检测到元素、只注册 userScripts loader、脚本没有运行或 GM API 调用未成功，不能把 POC、TEST-018 或产品判为 VERIFIED。真实受支持范围另见 docs/13-predevelopment-admission.md。

## 回归要求
任何影响诊断规则、脚本元数据、回滚、Chrome 连接或共享层的变更，必须运行相关反例；共享层更新还需全部使用者回归。修复后仅 TEST-018 类真断言合格才可声称功能恢复。

## 阻断规则
文件损坏、未经授权 Profile 修改、CDP 错实例、AI 泄密、未验证自动覆盖、严重安全负例、正式安装包与 ZIP 便携真实验收缺失均阻断 Stable。

## Tampermonkey 专项验收差异（I-011）
POC-02T 是尚未执行的 Tampermonkey 云端可行性实验，并非正式 TEST-017/018。正式用例覆盖扩展真实版本、Chrome 138+ Allow User Scripts、Chrome 152+ .user.js 安装机制、Content Script/UserScripts API/UserScripts API Dynamic 的实际支持模式、@grant/@run-at/@match、GM API 与真实业务断言。授权/安装/加载/GM 调用失败时应 BLOCKED/UNKNOWN，不可借 Violentmonkey 结果填补。每个正式结果须关联目标代码提交、版本与运行证据。

## 真实 Tampermonkey 5.5.1 预检与功能验收分界（2026-10-18）

通过已连接的 Chrome Browser MCP，在用户真实 Chrome 155.0.8059.40 上仅执行**只读**扩展身份、API 和权限检查：Tampermonkey 5.5.1、MV3、userScripts API 调用成功、注册记录 2、含 userScripts 权限及示例站点原点访问许可。此为 `TEST-017` 中的一部分**先验条件**，不能把完整 TEST-017 或 TEST-018 标记通过。此会话没有安装临时脚本、访问已有脚本源码/私密存储或验证真实 GM 行为。

剩余 `TEST-017/018` 的真实测试须在用户认可的独立 Profile/测试页面内：1) 明确测试脚本范围及所需 `@grant`、安装/启用与 `@match`；2) 在真实 Tampermonkey 注入并调用 GM API，记录真实业务动作和失败场景；3) 比较人为预设坏/好与**产品真正生成的补丁**，将用户数据和权限限制列为未达门槛；4) 在不影响已安装脚本的前提下保存最小化脱敏证据。若无授权或工具无法安全安装测试脚本，返回 `UNKNOWN/NOT_VERIFIED`，不得用纯 DOM 断言填补。参见 docs/13-predevelopment-admission.md。

## 2026-10-18 实时浏览器 Tampermonkey 限定测试增量
后续在**同一浏览器连接**执行了独立临时脚本安装、真实 `GM_getValue`、人工预设 broken/fixed 两阶段业务断言及删除后不再注入的验证；完整步骤与实际返回见 docs/evidence/2026-10-18-tampermonkey-live-browser-qa.md。此结果与上文更早的只读预检不同，标记为 `POC-02T-LIVE: LIMITED_POC_PASS`。不是独立 Windows GitHub Actions 的 POC-02T，也没有正式产品代码或测试套件，所以 **TEST-017、TEST-018 仍为“已规划/未正式执行”**。

## （7）TASK-001 初期自动化执行证据（2026-10-18）

提交 `244f853fae7e5f7443f86a69b5804bc14b7883aa` 的 Windows GitHub Actions run `39100320005`：TypeScript 类型检查成功，11 项 Node 自动化安全/配置负例全部通过（https://github.com/devin930906/userscript-auto-healer/actions/runs/39100320005）。**仅是 TEST-026 的局部安全边界覆盖**；尚未在真实 Electron 桌面进程验证 preload、IPC frame 拦截、沙箱、导航与权限阻断，TEST-026 保持未完成；TEST-001 与其余产品正式 TEST 仍未执行。产品自动化验证不等于此前开发前 PoC。证据对应原始 commit，不可直接转用于后续新提交。

## （7）TASK-001 Windows 实际 Electron 运行结果（2026-10-18）

对应提交 `5f2830d52d349ab19583740dc177427e1652e355` 的 [Application Skeleton Checks run 39100881800](https://github.com/devin930906/userscript-auto-healer/actions/runs/39100881800) 通过：typecheck、11 项 Node 安全配置测试、Electron 下载及构建、隔离渲染进程加载、通过受限 preload 的真实 IPC、拒绝无效配置输入。测试在 GitHub Windows 2025 runner 运行，不构成 Windows 10/11 真实用户 Profile、任意网页脚本运行或完整 TEST-026 的证明。对应 TEST-026 的其他危险输入/完整权限边界将于 TASK-018 继续验证。


## （7）TEST-010/012 阶段实测收据（2026-10-18）

源 HEAD `824f9c89f673e0d05adbaf3084fd609f8e20eca0` 的 [Windows Application Checks 39110563542](https://github.com/devin930906/userscript-auto-healer/actions/runs/39110563542) 已完成真实签名 Chrome、自管隔离 Profile 和授权 CDP 页面上的 DOM、跨来源 iframe 可见性盲区、延迟元素、同源 `history.pushState` SPA 路由检测，另含主框架跨源/畸形输入的拒绝测试。58 项 Node 测试中 57 通过、0 失败、1 项独立便携 Chrome 测试由 [39110563531](https://github.com/devin930906/userscript-auto-healer/actions/runs/39110563531) 覆盖；相同 SHA 的 Electron sandbox smoke 和文档检查通过。早期 [39110333660](https://github.com/devin930906/userscript-auto-healer/actions/runs/39110333660) 失败仍保留：页面导航初始化竞态导致 `CDP_FAILED`，测试夹具已修复并重新验证。该记录证明 TASK-006 阶段行为，不包含真实 Tampermonkey 的安装/GM API/业务恢复、用户 Windows 完整兼容或 Stable GATE。


## （7）TEST-017 部分只读探测证据（2026-10-18）

源 HEAD `f09e0e68fcb67c3dbdeb4b2b8fc48af250614bb0` 的 [Windows Application Checks 39111259895](https://github.com/devin930906/userscript-auto-healer/actions/runs/39111259895) 已实测产品适配器在独立 Windows Chrome 中只读调用浏览器 CDP `Target.getTargets`，并检验拒绝非目标管理器、网页冒充、畸形响应、伪造会话及未授权输入。64 项 Node 测试中 63 通过、0 失败、1 专用路径跳过；真实 Electron smoke 成功。返回仅能是 `RUNTIME_TARGET_HINT_ONLY` 或 `RUNTIME_NOT_OBSERVED` 等有限结果，**不是 Tampermonkey 产品 TEST-017 完整通过**。未实测真实 Tampermonkey 的该适配器安装/启用/版本/权限、GM 和业务断言，TEST-018 未执行；正式产品跨版本矩阵仍待独立证据。

## （7）TEST-017 静态前置检查增量（2026-10-18）

PR [#11](https://github.com/devin930906/userscript-auto-healer/pull/11) 新增 Tampermonkey 测试准备信息的失败关闭检查：未经授权、错误管理器、未声明 GM 授权、没有明确站点匹配、报告安装/启用状态不满足、通配或排除规则不可独立确认时拒绝；真实源元数据解析器参与回归。源 `ab250732165b8635c88e68a52ffee8d371aa1e7a` 的 [Application Checks 39114195987](https://github.com/devin930906/userscript-auto-healer/actions/runs/39114195987) 与 [Chrome 专项 39114195971](https://github.com/devin930906/userscript-auto-healer/actions/runs/39114195971) 已通过。这里只验证**对外部报告与静态元数据的保守检查逻辑**，报告数据本身未进行可信实时浏览器证明，也没有真实 Tampermonkey 安装、GM_getValue 或业务恢复测试。因此 TEST-017 仍部分执行、TEST-018 未完成，GATE-004/005 继续阻断。

## （7）TASK-007 独立 DOM 对照取证接口（阶段性 Windows 验证）
新增安全诊断会话的 `observe(mode, explicitUserApproved)` 与 `domSnapshot()`，在显式授权、自有 Chrome/CDP 会话、已确认的专用测试页目标和同源重核后，使用只读 `DOM.querySelectorAll` 比对 `#current-target` 与 `[data-uah-probe-action="done"]`。该证据仅为 `LIMITED_FIXTURE_DOM_ONLY`，不能证明脚本由 Tampermonkey 注入，也不能证明 `GM_getValue`、安装/权限、真实业务恢复或 TEST-018/GATE-004/005 通过。必要 E2E 仍依赖独立真实 Tampermonkey 及经许可的修复场景。任何失败/路由变化拒绝被当作通过；源提交 `2cf1b9ec031e58b049231de60c86c0030c3f8d72` 的 [Windows Application Checks 39125313780](https://github.com/devin930906/userscript-auto-healer/actions/runs/39125313780) 已通过（88 个 Node 测试：87 通过、0 失败、1 专项跳过；真实 Electron shell smoke 成功）。新增测试在真正 Windows 签名 Chrome 的独立 Profile 中访问本地测试页，**没有安装用户脚本**时应读到目标 DOM 存在、动作标记缺失且不得上报恢复；它是独立 CDP 负例，不是 Tampermonkey 真脚本 GM/业务恢复或完整 TEST-018 通过。


## （7）TASK-007／TEST-018 非验证性证据交叉核对（2026-10-18）

针对 `src/manager/tampermonkey-diagnostic.ts` 的 PR #19，新增临时 GM 夹具 HTTP 自报与受控 CDP DOM 标记的交叉核对，并在每次重读前使旧 DOM 快照失效；针对 `src/observe/dom-observer.ts` 只读 CDP 样本新增同一采样前、中、后顶层 URL 一致性校验，避免同源 SPA 导航中旧节点误归属新路由。来源 SHA `3b4585b0e6ec802b64624b39badff5dba42a6457` 的 [Windows Application Checks 39127069957](https://github.com/devin930906/userscript-auto-healer/actions/runs/39127069957) 已成功运行类型检查、90 项 Node 测试（89 pass、0 fail、1 skip）和真实 Electron smoke。

判定仅限 `CONSISTENT_UNVERIFIED_FIXTURE_ONLY`，明确不得因此提升扩展身份、真实脚本安装、GM API、真实业务或自动修复的验证标志。独立 Tampermonkey 安装/授权/真实 `GM_getValue`、产品真正生成补丁的业务断言与失败回滚仍属于未完成的 TEST-017/018、后续 TEST-014/020/021、GATE-004/005/006/007。PR #19 未合并前，本段记录的是**开发分支的测试结果**而非 main 的完整产品验收。
