# 测试策略与验证体系

> 状态（2026-10-26 当前主干）：Electron+TypeScript 产品源码与自动化测试已经存在；最新 `main@c3c28451636400a4228688d7354c8f42ba0ccbca` 的 Windows 应用回归 #40272189600（603 项：602 通过、0 失败、1 条件跳过；Electron smoke 成功），隔离 Windows Tampermonkey 专项 #40270144017 在较早源码 `35033f74` 上 15/15 Job 成功。这些都是阶段证据，不是对所有 TEST-001..028 或任何 Stable GATE 的完整验收；实际用户 Chrome/网站、产品自动修复和回滚仍有缺口。

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
| TEST-002 | REQ-002 | 集成 | Windows GUI | 界面可用 | 3 个 .user.js 与重复文件 | 拖放与路径选择：拖放/多选，核对列表 | 全部独立导入且去重可见 | 丢文件或越界 | UI 集成 | 已有阶段自动化；PR #101 补原生选择器取消／批次互斥及 Electron 运行验证（实际 CI 以对应 SHA 为准）；PR #102 增加重命名同字节脚本去重／同名不同字节版本保留及 Electron 实测（须核验当前 HEAD 的 CI）；真实文件夹拖放仍待验收 |
| TEST-003 | REQ-003 | 单元/集成 | Windows FS | 目录已授权 | 嵌套、软链接、非 JS | 目录扫描边界：递归扫描 | 仅处理允许路径及匹配后缀 | 无限递归、越界 | 单元 | 阶段自动化已有成果；PR #102 增补目录中不同路径相同字节去重回归与源文件不变证明（以 CI 实际结果为准）；待 Stable 集成复核 |
| TEST-004 | REQ-004 | 单元/集成 | Node JS Parser | 样本夹具已创建 | @match/@grant/@run-at/@require | 元数据解析：分析并对比原头 | 正确解析且不改原字节 | 字段缺失/改写 | 单元 | 静态单元阶段验证通过；待产品集成复核 |
| TEST-005 | REQ-005 | 集成 | Windows UI | 脚本元数据 | 登录前提、URL、动作断言 | 目标网站与场景：注册/运行预检 | 缺前置则标 UNKNOWN | 没登录判成功 | 集成 | 阶段自动化通过；真实浏览器场景执行待验收；PR #106 增加桌面本机会话场景登记、已导入 SHA-256 绑定、非法网址/未登录前置/输入拒绝负例及 Electron 表单回归；只表示 STAGED_RUNTIME_UNVERIFIED，真实网站、Tampermonkey 和业务断言仍未运行；PR #107 在现有会话登记后增设仅针对无登录、单 CSS 存在性断言的独立 Chrome 原生二次授权 DOM 多次只读取证及取消，返回限定信号而非真实用户脚本、GM 或业务认证；对应 Windows CI/合并状态按当前 SHA 核验 |
| TEST-006 | REQ-006 | 端到端 | Windows 真实 Chrome | 获用户许可 | 两个 Chrome.exe | 便携 Chrome 路径：分别启动并确认路径版本 | 完全使用所选程序 | 默默使用默认 Chrome | 真实 E2E | 已规划 |
| TEST-007 | REQ-007 | 端到端 | Chrome 136+ Windows | 准备专用目录 | 默认/在用/新 Profile | Chrome Profile 安全：分别检查并启动 | 默认和在用拒绝，新路径可验证 | 修改原 Profile | 真实 E2E | 已规划 |
| TEST-008 | REQ-008 | 端到端 | Windows Chrome | 自管浏览器 | 9223 与占用端口 | CDP 启动端口：启动与监听检查 | 启动后可连接，冲突安全失败 | 误接管旧实例 | 真实 E2E | 已规划 |
| TEST-009 | REQ-009 | 端到端 | Windows CDP | 可同时运行两个实例 | 伪 /json/version 与目标页 | CDP 会话归属：核对实例/目标 | 错误实例拒绝 | 只按端口判成功 | 真实 E2E | 已规划 |
| TEST-010 | REQ-010 | 端到端 | 真实 Chrome | 测试 iframe/Shadow | 跨域 iframe/closed root | 受限 DOM 边界：快照并审查 blind spots | 可见性明确，不伪称完整 | 绕过隔离或误报 | 真实 E2E | Windows 自管 Chrome 阶段自动化通过；用户环境及完整发布回归待验收；PR #151 在受限 CDP DOM 页面 WebSocket 的连接阶段加入立即取消、迟到 OPEN 拒绝及正常连接回归；Windows #39372158090 成功 350 项（349 通过/0 失败/1 跳过），未替代完整真实环境验收 |
| TEST-011 | REQ-011 | 单元/集成 | Node | 正常与动态 AST | 字面/拼接/封装/备用选择器 | AST 源码定位：分析行列作用域 | 动态待确认、字面来源正确 | 误报全覆盖 | 单元 | 静态单元阶段验证通过；待产品集成复核 |
| TEST-012 | REQ-012 | 端到端 | Chrome 测试页 | 事件/路由夹具 | 路由与延迟渲染 | SPA 动态诊断：切换路由后监控 | 等待与时序证据正确 | 加载竞态错误归因 | 真实 E2E | Windows 自管 Chrome 阶段自动化通过；用户环境及完整发布回归待验收 |
| TEST-013 | REQ-013 | 单元/集成 | 诊断模拟器 | 受控错误夹具 | 网络、权限、异常、断言 | 故障根因分类：逐项分类 | 不将非 DOM 强行改选择器 | 误分类强改 | 单元+集成 | 阶段单元测试通过（9 项；真实数据接入及集成验收未完成） |
| TEST-014 | REQ-014 | 单元/集成 | Patch 夹具 | 可确认原意 | 坏定位器/不确定候选 | 本地修复规则：生成 diff | 只做最小变更 | 删功能或越权修改 | 单元 | 已规划 |
| TEST-015 | REQ-015 | 集成 | Mock AI | 用户同意 | 含恶意 patch/敏感占位符 | AI 候选保护：网络调用及候选审查 | 仅候选；不发送禁止字段 | 直接采用或泄密 | 集成+抓包 | 开发中：本机 mock HTTP 外发字段审查、响应不可信、失败隔离与恶意输入负例已编码，待 Windows CI；真实用户许可、原生授权及自动修复端到端未验证 |
| TEST-016 | REQ-016 | 集成 | Mock API | Base URL 已允许 | /models 不存在及手填 | 自定义 AI 兼容：探测/手填/限额测试 | 失败有安全 fallback | 无限重试/明文Key | 集成 | 开发中：自定义 Base URL、模型发现失败回退、限次、取消、超时及密钥不回显负例已编码，待 Windows CI；用户自定义服务及凭据受保护保存仍待集成 |
| TEST-017 | REQ-017 | 端到端 | Chrome+真实 Tampermonkey | 已授权的隔离测试 Profile | 扩展缺失/错误管理器/缺许可/不同注入模式/GM 无权限 | 核对 Tampermonkey 身份版本、Chrome 权限、脚本安装启用、@match/@grant/@run-at、站点权限与注入模式 | Tampermonkey 前置条件全部满足，否则拒绝 VERIFIED | 仅 CDP/Violentmonkey 通过冒充 Tampermonkey | 独立 Tampermonkey E2E | 仅运行目标探测与拒绝负例已阶段执行；PR #79 已提供 document-start/document-idle；PR #81 增加 document-body/document-end 的受控手动夹具、DOMContentLoaded 处理、IPC 与界面选择及测试（须依当前提交 CI 和合并记录确认）；真实 Tampermonkey 安装/授权/GM/业务验收仍未执行；PR #151 补临时管理器诊断页面的 CDP 连接期撤销权限边界，候选 Windows #39372158077 成功；只读传输层测试不认证 Tampermonkey、GM API 或业务结果 |
| TEST-018 | REQ-018 | 端到端 | Chrome+真实 Tampermonkey | 真实 Tampermonkey/测试脚本已安装并授权，场景已定义 | 失效/已修脚本、GM API、不同注入时机 | 在 Tampermonkey 中实际注入，调用 GM API、执行业务断言与回归，记录扩展和浏览器版本及运行证据 | 真实 Tampermonkey 的业务断言满足才 VERIFIED | Violentmonkey/原生 DOM/人工修正版冒充产品自动修复 | 独立 Tampermonkey E2E | 已规划 |
| TEST-019 | REQ-019 | 单元/集成 | Diff 审核引擎 | 原脚本及候选 | 扩增 @grant/无关变动 | 补丁与权限审查：计算变更与策略 | 自动应用被阻断 | 权限静默变化 | 单元 | 部分实现并验证：TASK-009 的独立只读候选复核、元数据与伪造输入拒绝在 Windows Actions #39142638654 通过；PR #156 已合并 main 07c9b4b10f74bd755cce818625ce4b4be3ad3c8a，新增 TEST-019/026：iframe、可见 Shadow DOM 和跨源 iframe 范围未覆盖时拦截 CANDIDATE_ONLY，默认闭合 Shadow Root 不确定标记单独存在时不破坏人工审核候选；红灯 Windows #39379795677 为 355 tests、353 pass/1 fail/1 skip，绿灯 #39380039664 第 2 次 354 pass/0 fail/1 skip（第一次真实 Chrome/CDP=CDP_FAILED、记录保留），开发候选双包 #39380039677 success；仅为离线审核候选的覆盖范围门槛，完整端到端集成、自动应用门控与真实 Tampermonkey 业务验收未完成 |
| TEST-020 | REQ-020 | 可靠性 | Windows NTFS | 可修改测试文件 | 成功/磁盘满/文件锁 | 版本备份回滚：应用、模拟中断、回滚 | 原字节 hash 恢复 | 原文件损坏 | 故障注入 | 局部验证（PR #44–53 包含只读源核验、备份-only、恢复来源验证、跨脚本身份拒绝和原生协作式文件互斥；Windows CI #39154527043 成功；新增独立备份/候选的持久检查点阶段用例（非授权记录，不证明断电持久性）；PR #155 已合并 main 7dd950f695579c7b46c5c6c56141f505c3f0bcd4，Windows #39378078806 的 353 项回归为 352 pass/0 fail/1 skip：验证源硬链接与祖先 Junction 均由现有原生锁拒绝，并正确映射为 INVALID_PATH；原始测试 #39377816631 对应 2 项预期失败已保留；实际原子应用、断电恢复及回滚仍未执行）；PR #160 新增手动原始恢复文件与 SHA 原字节一致性、唯一无覆盖输出的开发阶段测试；仅为受限人工恢复导出，不涉及实际原文件回滚或断电事务，GATE-007 仍受阻。 |
| TEST-021 | REQ-021 | 单元/集成 | Windows FS | 候选+证据 | VERIFIED / UNKNOWN | 自动应用策略：分别执行门控 | UNKNOWN 原文件不变 | 无证据覆盖 | 单元+集成 | TEST-021 离线拒绝负例已在 Windows #39146248924 验证；真实 Tampermonkey/业务证据、受信任源哈希、备份与自动应用集成仍未执行 |
| TEST-022 | REQ-022 | 集成 | Batch 测试环境 | 多份脚本 | 一成功、一失败、一取消 | 批量取消与恢复：执行/重启/重试 | 隔离终态、无重复应用 | 单错拖垮全部 | 集成 | 已有只读协调器安全及恢复阶段测试；新增批次 SHA-256 身份顺序绑定和跨批次错误恢复拒绝负例，旧无身份快照禁止直接续跑，此功能仍不构成可信持久事务或脚本恢复；PR #101 补原生 UI 文件间取消与文件不变负例；真实批处理工作流、可信持久恢复和端到端验收仍未完成；PR #150 增补恢复检查点 timeoutMs 精确匹配、v1 旧结构拒绝、访问器/伪造时限拒绝的 Windows TEST-022/NFR-009/TEST-026 回归，#39370945409 和 #39370945321 success；不代表真实持久化与端到端恢复通过；原生导入计数与隔离 AST 分段进度新增回归：真实原生文件成功/重复/错误、取消后未处理、文件夹回传计数、36 文件跨 Worker 完成进度；不包含文件名或路径，正式 1000 脚本持久化工作队列/崩溃恢复、GATE-007 仍未验收。 |
| TEST-023 | REQ-023 | 端到端 | Chrome 管理器 | 本地修复产物 | 本地与已安装不同版本 | 导出与扩展更新：分别验证两个状态 | 保存与浏览器内更新不同步时显式显示 | 假称已安装 | 真实 E2E | 开发中：独立导出候选及文件安全负例纳入 Windows CI；真实 Tampermonkey 导入/更新、状态同步与业务验收仍未执行，正式 TEST-023 未通过；新增源/备份/候选到独立导出的综合负例，不能替代 Tampermonkey E2E；PR #160 的原生人工候选导出同时携带独立人工原版恢复文件，保留候选和原件不同步的显式界面提示；Windows CI/主干整合以对应 PR 记录为准，未验证 Tampermonkey 内已安装版本。 |
| TEST-024 | REQ-024 | 单元/集成 | 本地状态库 | 多次有证据运行 | 过去成功当前未知 | 健康监控与历史：查询健康时间线 | 显示当前未知且保留历史证据 | 继承过时成功 | 单元 | 开发中：限定本机只读历史与证据过期/隔离/不可信输入负例已经编码，待 Windows CI；真实 Tampermonkey 复检、完整跨重启 GUI 业务 E2E 与正式产品集成验收仍未完成；本机脱敏归档有有限 Windows 自动化证据 |
| TEST-025 | REQ-025 | 端到端 | 多个测试脚本 | 共享映射场景 | 定位器版本前后 | 共享层版本回归：升级/运行回归/回退 | 使用者均验证或阻止应用 | 一次升级连锁破坏 | 集成+真实 E2E | 已规划 |
| TEST-026 | REQ-026 | 安全 | Windows sandbox | 恶意 JS 夹具 | 文件和网络探针 | 不可信脚本隔离：导入/执行并观测权限 | 无法越权访问应用主进程 | 任意主进程执行 | 安全 E2E | 已规划 |
| TEST-027 | REQ-027 | 端到端 | 干净 Windows VM | 候选安装包 | 安装、升级、卸载 | EXE 安装卸载：执行全流程 | 正常启动，数据保留符合说明 | 缺依赖/卸载损坏 | 真实 VM | 开发中（PR #149：Windows 临时候选 Inno 安装/启动/卸载及 138 文件 SHA-256 完整性验证；隔离候选 Electron userData 的合成哨兵卸载后完整，Actions #39369480855 通过；PR #154 已合并 main df8bec1e6f962785a3f351bc33cabd659f4e2dac：Windows 候选 #39376523388 实际安装同一隔离 AppId 的合成旧版本 0.0.0，再以当前 0.0.1-dev 开发候选覆盖升级、启动与核对旧版 AppData 哨兵，138 个安装文件 SHA-256 对照及卸载后哨兵保留均成功；模拟旧版不是任何真实历史 Release，真实历史版本迁移、用户配置/数据、最低 Windows 支持矩阵和完整 GATE-008 仍未验收） |
| TEST-028 | REQ-028 | 端到端 | 干净 Windows VM | 同源提交的真实 ZIP 已构建 | ZIP 文件头/清单/安全解压/只读与移动路径/校验值 | 校验 PK ZIP 类型与条目安全，解压后直接启动并运行核心功能、读写和退出 | 真实 ZIP 完整、无路径穿越、可启动且数据路径安全 | 假 ZIP、损坏、遗漏依赖、危险条目或无法运行 | 云端构建+真实 VM | 开发中（PR #149：临时候选真 ZIP 138 文件路径/哈希/解压与 Electron 启动通过，解压版和安装版在 Windows runner 保留相同候选 userData 身份；只读目录、真实业务数据持久化、最终用户环境与 GATE-009/011 尚未验收）；PR #152 阶段验证：Windows 候选 #39373670565 (PR 合成 SHA 0e7494233eab668da8d09723213277794ca88142) 对 ZIP 解压目录施加可继承 WD 写入拒绝 ACL，实际新建文件被拒、Electron 可启动且独立用户数据保持一致；138 文件哈希匹配，完整真用户数据迁移/支持矩阵/只读故障提示仍未验证 |

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


## （7）TEST-013 阶段性独立故障信号分类（2026-10-18）

TASK-007 的真实 Tampermonkey 专项前提仍未满足，本阶段仅在 TASK-008 的**不依赖真实扩展**的纯本地部分落实 REQ-013：以严格白名单和有限证据 ID 接收结构化事件，将权限、网络、JavaScript 异常、选择器缺失与业务断言失败分开。多个不同故障类别、未知状态或畸形信息均不得确认单一根因；即使只有一种失败，也只返回信号类别，不给出自动修复许可、Tampermonkey 验证或业务恢复证明。内存日志仅保留类别、状态、合规证据 ID 与时间/序号，拒绝携带原始错误文本、URL、脚本、DOM 和秘密的额外字段，设置固定最大容量。新增 TEST-013 单元负例覆盖冲突信号、网络/权限误归 DOM、数据脱敏与容量界限。此为待关联 GitHub Actions 真实执行记录的阶段实现，不是完整日志中心、真实根因确认、TEST-013 集成/正式验收通过，也不意味着 TASK-007 或 TASK-008 完成。


### TASK-008 阶段实现已整合的真实验证记录（2026-10-18）

PR [#21](https://github.com/devin930906/userscript-auto-healer/pull/21) 已以合并 SHA `5832953a2980f65512bbac233dd67f218d896bac` 进入 main；分支源 SHA `fe1a4760017cdac22de5963852136e4ee36214d2` 的 [Application Skeleton Checks #39128955413](https://github.com/devin930906/userscript-auto-healer/actions/runs/39128955413) 为 success：TypeScript 类型检查、99 项 Node 测试（98 pass、0 fail、1 平台条件 skip；新增 9 项 TEST-013 单元负例全部 pass）、Windows Electron smoke 均通过；[Documentation Integrity #39128955367](https://github.com/devin930906/userscript-auto-healer/actions/runs/39128955367) 与 [TASK-005 便携 Chrome 专项 #39128955370](https://github.com/devin930906/userscript-auto-healer/actions/runs/39128955370) 同为 success。该结果仅证明离线故障信号分类与安全内存日志实现的代码测试，不能作为真实 Tampermonkey 运行时、TEST-013 集成验收、自动修复或 Stable GATE 完成证据。


## （7）TASK-008 / TEST-013 场景合约与自管 CDP 故障诊断接入（2026-10-18）

新增 `src/diagnostics/scenario-dom-diagnostic.ts`：沿用 TASK-004 的已授权场景预检、TASK-005/006 自管 Chrome/CDP 目标归属与只读观察、TASK-008 故障信号分类器；仅接受无需登录/主动步骤、最多 8 个唯一顶层 CSS `selector-present` 断言的场景。真实观察的选择器缺失只能生成 `SELECTOR_ASSERTION` 限定信号，全部存在只代表当前 DOM 未观察到缺失，不能证明油猴脚本成功。浏览器/CDP 失败、SPA 路由变化、输入异常、权限不符均返回 BLOCKED/UNKNOWN；不执行脚本、点击、持久化或自动改文件，不传出 URL/DOM/脚本 Hash。新增 Windows 真 Chrome+无扩展的独立负例，并加入 npm 测试。**此为待 CI 核验的部分诊断集成**，不满足完整 TEST-013、TEST-017/018 和 GATE；真实 Tampermonkey 与业务断言仍受阻。

## （7）2026-10-18 TEST-013 与 TEST-018 阶段性 Windows 验证补充

TEST-018 范围内的**临时夹具证据处理负例**：源 `e05933d3850761c337605d7a4321b90928596245`，[Actions #39132321986](https://github.com/devin930906/userscript-auto-healer/actions/runs/39132321986) 成功（108 个 Node case 中 107 pass、0 fail、1 skip，真实 Windows Electron smoke 通过），PR #25 已合并。覆盖缺失/混入选择器、畸形节点计数、无效路由与时间戳；结果只证明拒绝机制及有限 DOM 观察，不证明真实管理器、脚本执行、GM 或修复恢复。正式 TEST-017/018 继续未通过。

TEST-013 范围内的**稳定观察诊断阶段集成**：源 `b68c528cee076bc89c0e7544dc0fc23c16fcf498`，[Actions #39132694315](https://github.com/devin930906/userscript-auto-healer/actions/runs/39132694315) 成功（110 个 Node case 中 109 pass、0 fail、1 skip，真实 Windows Chrome 只读多次采样与 Electron smoke 均通过），PR #26 已合并。数据在采样窗口内变化时保守阻断；结果始终不授权脚本修改。未来仍须把可信故障源、真实 Tampermonkey 运行、业务断言和根因联动纳入完整 TEST-013/017/018；全部 Stable GATE 继续独立验收。


## （7）TEST-020 原文件只读核验阶段结果（2026-10-19）

PR #44 增加三项只读源文件校验负例，源 SHA `31a31f111a7e6dbd35dbe454305d99431c1ad954` 的 [Windows 应用检查 #39147314079](https://github.com/devin930906/userscript-auto-healer/actions/runs/39147314079) 成功运行包含这三项在内的 151 项用例（150 pass、0 fail、1 条件 skip），另经 Electron 运行检查成功。该结果仅证明读取时的 SHA-256、文件类型与身份检查，**并未执行备份/原子写入/故障注入/回滚**，不能把 TEST-020 或 GATE-007 标为通过。

## （7）TEST-020 安全备份副本阶段用例（2026-10-19）

[PR #45](https://github.com/devin930906/userscript-auto-healer/pull/45) 在先前只读原文件身份检查基础上增加三类备份-only Windows Node 用例：副本字节哈希/唯一名称/原脚本不变；未授权、过期源哈希、恶意配置安全拒绝；超大/重定向文件与备份目录符号链接拒绝。模块限定在受信任原生调用，不对外开放用户路径 IPC；CI 结果以当前 PR SHA 的 Windows Actions 为准。**TEST-020 仍为局部验证**：文件锁、断电、原子应用、恢复日志和实际回滚验证未执行，GATE-007 未通过。

## （7）TEST-020 恢复来源只读校验阶段（2026-10-19）

[PR #46](https://github.com/devin930906/userscript-auto-healer/pull/46) 新增只读 `verifyBackupRecoverySource`，供未来事务回滚前独立检查指定备份副本的文件身份、SHA-256、字节长度、硬链接别名/符号链接风险与目录替换。不以调用方 `userApproved` 布尔值冒充已认证授权，要求后续受信任原生界面建立授权。Windows 单元测试对真实临时文件验证正常读回、篡改/丢失、越权字段、路径穿越、硬链接伪装及符号链接拒绝。测试的当前主分支 SHA 和结论须以实际 Actions 记录为准。

**范围：TEST-020 仍未完整通过**。本模块不返回文件原文、不编辑或恢复脚本、不授予自动回滚、不代表持久文件锁、故障日志或断电恢复已完成；完整 TEST-020/021、TASK-010、真实 Tampermonkey/业务断言与 GATE-007 仍为发布阻断。

## （7）TEST-019／020／021 本地审核至恢复来源的集成负例（2026-10-19）

[PR #48](https://github.com/devin930906/userscript-auto-healer/pull/48) 新增只针对受信任原生调用方的 `prepareReviewedLocalBackupOnly` 和四项 Windows Node 集成用例；同一请求中复核候选补丁、当前磁盘源指纹、独立备份副本 SHA-256 与只读恢复来源，并在返回前重新读取源文件。验证与失败结果均不授予自动修改/回滚，不泄露路径或脚本内容。源 SHA `3ef164150d66eea542bc741e27e1802181fc5227` 的 [应用 CI #39151296629](https://github.com/devin930906/userscript-auto-healer/actions/runs/39151296629) 已 success（164 cases：163 pass、0 fail、1 条件 skip；Electron smoke 通过），[便携 Chrome 专项 #39151296637](https://github.com/devin930906/userscript-auto-healer/actions/runs/39151296637) success。**仅为 TEST-019/020/021 局部集成**：仍无可信真实 Tampermonkey/GM/业务来源、独立授权令牌、事务锁、写入故障注入或回滚，完整 TEST 与 GATE 保持未完成。

## （7）TEST-020 原生备份来源互斥验证（2026-10-19）

PR [#53](https://github.com/devin930906/userscript-auto-healer/pull/53) 增加六项互斥与来源身份回归：同脚本并发拒绝且不产生备份、回调失败清理锁、执行中源变化阻断、硬链接与符号链接拒绝、独立来源并行互不影响、遗留锁保持拒绝直至专人处理。连同 PR #51/#52 的长名称与同名跨目录身份拒绝，均由提交 `3694c9529475ff0ccf015ad65ee347ed781ee005` 的 [Windows Application Checks #39154527043](https://github.com/devin930906/userscript-auto-healer/actions/runs/39154527043) 实际执行：173 cases，172 pass、0 fail、1 skip，TypeScript 与真实 Electron smoke 成功。主干合并 SHA `b53350ad64773a732b3625a5dfc7651fa24e7637` 的单独验证应以其工作流结果为准。

**TEST-020 依旧未完整通过**：现有锁只协调本产品原生流程，不能阻止外部程序编辑脚本；没有持久崩溃恢复日志、事务性候选写入、故障注入后恢复原字节及正式回滚成功证据。TEST-021 的独立运行来源、真实 Tampermonkey GM/业务与 GATE-007 仍保持发布阻断。

## TASK-007 / TEST-017 一次性 URL 导入测试边界（2026-10-19）

`src/manager/tampermonkey-gm-probe.ts` 的隔离回环服务现支持短时 `/install.user.js?key=<随机令牌>`，用于**真实 Tampermonkey 中由测试者主动尝试的手动 URL 导入**。自动化负例覆盖错误/缺失令牌、额外参数、非 GET、非授权跨来源、关闭后的监听拒绝及 GET 不产生运行回执；仍需真实扩展安装授权、版本、GM_getValue、脚本执行业务前后断言与产品修复验证。此测试不是 Tampermonkey 云端 PoC 成功证据，不能提升 TEST-017/018 或 GATE-004/005 状态。


## （7）TASK-007 / TEST-017 临时 Tampermonkey 脚本运行时到期保护（2026-10-19）

临时隔离 GM 诊断 HTTP 服务原有 TTL，但用户**已经安装**的 `.user.js` 可以在服务关闭后继续留存，若本地端口后来被复用，旧脚本仍可能执行 DOM/GM/网络操作。新增 TEST-017 的 Node VM 隔离运行回归，用实际生成的临时脚本对比授权到期前、到期时与到期后的脚本副作用。先在测试提交 `0c2e0065ad4ca14baa9e17a420f047abebb9ea38` 的 [Windows CI #39158174162](https://github.com/devin930906/userscript-auto-healer/actions/runs/39158174162) 证明失败（177 cases：175 pass、1 fail、1 skip），确认到期后仍发生一次 DOM 查询、属性修改、GM 模拟调用和网络调用；随后修复生成器，将一次性绝对到期时间嵌入脚本并在任何脚本副作用前阻断执行。代码提交 `46880b3ae2a1b72f260ef07bd5caaed32dcae619` 的 [Windows CI #39158298596](https://github.com/devin930906/userscript-auto-healer/actions/runs/39158298596) 通过：177 cases，176 pass、0 fail、1 skip；TypeScript 与真实 Electron IPC smoke 均成功。

此项是**本地临时脚本安全门槛**，不是正式 Tampermonkey 扩展内 GM/注入/业务执行的独立验收：VM 中的 GM 函数是假实现，测试用户仍需主动卸载临时脚本；系统时间可能被调整，不能把客户端时间检查当成撤销扩展授权的机制。TEST-017/018、TASK-007 与 GATE-004/005 仍未全部通过。

## （7）TEST-017 本机手动诊断报告阶段回归（2026-10-19）

PR [#93](https://github.com/devin930906/userscript-auto-healer/pull/93) 增加 `tests/manager/gm-report.test.ts`：对报告白名单、未认证标志、错误/缺失证据、敏感脚本源码与本机令牌隔离、用户否决、无覆盖 JSON 文件写入、SHA-256、字节回读、目录重定向与路径规范化负例进行 Windows 回归。源 SHA `cd64e0b402b5b3b2a6e1b89b9d198177d8726665` 的 [Windows App #39189509991](https://github.com/devin930906/userscript-auto-healer/actions/runs/39189509991) success，248 项测试、247 pass、0 fail、1 skip，Electron smoke success；仅限报告服务与 IPC 安全边界。**未经真实 Tampermonkey 扩展/GM 行为认证，不能升级 TEST-017 或 TEST-018 正式验收状态；无需为取得此 JSON 安装或修改用户已有脚本。**

## （7）TASK-007 / TEST-017 Chrome 版本绑定报告测试增量（2026-10-19）

PR [#123](https://github.com/devin930906/userscript-auto-healer/pull/123) 将本应用校验过的 Chrome 版本值传入短时手动诊断会话，写入仅供人工核对的 `uah-manual-gm-fixture-v2` JSON。回归检查通过的限定要求为：正常四段版本能被导出且仍是 `NOT_VERIFIED`；缺失、畸形、注入式版本以及旧 v1 结构均不能成为新输出；输出继续禁止脚本源码、Profile 路径、URL/token 和任何 Tampermonkey/GM/业务 VERIFIED 断言。旧 v1 文件只保留为历史，不实施自动升级。

Windows 源 SHA `54a4be82adcd7aaab96ab3e74d280765d9850455` 的 [Application Skeleton Checks #39254390625](https://github.com/devin930906/userscript-auto-healer/actions/runs/39254390625) 已通过；本说明提交后须检查最新 HEAD 与 main 独立 CI。上述测试仍仅覆盖原生可信环境元数据传递与拒绝负例，**不是**完整 TEST-017/018、真实扩展内 GM API 与业务恢复、GATE-004/005 或正式 Stable 验收。

## （7）TASK-007 / TEST-017/026 诊断报告时间线一致性负例（2026-10-19）

沿用现有 `uah-manual-gm-fixture-v2` 合同，不修改 JSON schema 或权限。新增独立拒绝测试：报告采集时间必须在一次性测试服务截止时间之前；每个有限只读 DOM 观察时间不得晚于报告采集时间，也不得到达/超过测试截止时间。手动 broken/fixed 打开顺序不限，避免把正常逆序访问误判失败。对原生生成和持久保存两层同时检查，不允许格式合法却发生在未来或到期后的报告时间线进入文件。所有证据仍是未经认证的夹具摘要，绝不授权 Tampermonkey 安装、GM/业务 VERIFIED、自动修改或回滚。

源码及当前提交验证记录以本轮对应 PR/Actions 为准；这项改动不代表完整 TEST-017/018、TEST-026、GATE-004/005/006 或最终 Stable 验收通过。

## （7）TASK-007 / TEST-017/026 临时本机 GM 测试请求中断可靠性（2026-10-19）

实际服务 `src/manager/tampermonkey-gm-probe.ts` 的 POST /receipt 流此前未处理客户端在完整 HTTP 头部后、请求体未收齐时的 IncomingMessage aborted/error 事件。增加断连清空部分数据、阻止晚到 end 接纳以及不泄露报错的错误监听。新增真实 loopback TCP 半包中断测试，确认断连后无回执、服务仍然响应正常 GET 与后续合法 POST，且任何回执仍恒为 `SELF_REPORTED_FIXTURE_ONLY`。此项仅验证本机临时测试服务韧性，**不**构成独立 Tampermonkey 身份、脚本安装、GM API、业务恢复或 Stable GATE 的证明。

## （7）TASK-017 / TEST-026 原生选择器跨模块互斥回归（2026-10-19）

现有 Electron 主窗口已分别序列化 Chrome/Profile 选择与原生脚本导入，但两个入口没有共同检查相互持有的忙碌状态，允许 import/drag-drop 在 Chrome 选择器或启动授权期间并行发起，或相反。现在主进程 IPC 同时检查导入、拖放、浏览器选择器、Profile 创建及启动流程的互斥状态；在尚未完成的选择期间拒绝跨模块入口，不读取另一路径、不打开第二个原生选择器、不启动 Chrome。新增 Windows 真实 Electron renderer→preload→IPC smoke：Chrome 选择器悬挂时拒绝文件/拖放导入，文件选择器悬挂时拒绝 Chrome/Profile 选择和启动，结束后正常功能仍可用。没有向 renderer 开放任意文件路径或任何脚本写入接口。TEST-026 此阶段并发负例不代表完整 TASK-017/TEST-022/GATE 通过。

## （7）TASK-017 / TEST-022/026 手动导出准备取消及文件写入边界（2026-10-19）

已实现的 `scenario:export-manual` 与普通 DOM 检查共用 AbortController，但原有界面仅在普通检查过程中提供取消。现在也允许在人工候选导出的**写入前**准备（原生授权、页面只读观察、目录选择、源文件再核验）阶段请求取消。最终原生写入授权后、启动备份/候选生成前，主进程同步将 `manualExportCommitInProgress` 设为真，`scenario:cancel` 改为返回 `EXPORT_WRITE_ALREADY_STARTED`，不再错误承诺能取消已有新文件。原始用户脚本仍不会被自动覆盖。Windows 真 Electron renderer→preload→IPC smoke 检验了模拟活动阶段中 UI 启用取消、提交前取消信号及文件创建阶段拒绝取消。该 smoke 未实际创建备份文件，不证明真实 Tampermonkey、GM、业务恢复、完整 TEST-022 或 Stable GATE。

## （7）TEST-017/018：一次性 GM 夹具跨路由错误归属回归（2026-10-20）

- [PR #133](https://github.com/devin930906/userscript-auto-healer/pull/133) 在 `tests/manager/tampermonkey-gm-probe.test.ts` 增加非规范测试 URL、延迟 DOMReady 后切换 `broken/fixed` 模式、DOM 读取过程及属性写入过程发生路由变化时的安全失败负例。原实现只在入口读取一次 `mode`，后续仍可在不属于原始授权页面的路由上产生 DOM 操作或自报；回归先于修复在 Windows [#39348815661](https://github.com/devin930906/userscript-auto-healer/actions/runs/39348815661) 观察到新用例失败。
- 修复限定在受控的一次性测试脚本：入口和 GM 后、DOM 回调、DOM 查询后、属性写入后与回报前再次匹配完整原始 `/?mode=broken|fixed` URL。测试与最终合并需按 PR 最新 HEAD 及对应 Windows Actions 核验；没有授予任意页面脚本执行、自动补丁、回滚或管理器认证权。完整真实 Tampermonkey 注入、GM API/业务断言与 TEST-017/018、GATE-004/005 仍未验收。

## （7）TASK-011 / TEST-020：已变化源文件的恢复前置复核（2026-10-20）

新增 `src/version/changed-source-restore-preflight.ts` 与 `tests/version/changed-source-restore-preflight.test.ts`。当已选择的本地 `.user.js` 字节发生变化时，以当前预期 SHA-256 和历史备份的预期 SHA-256/长度分别对真实磁盘内容进行有界只读复核，拒绝伪造授权、恶意 Getter/Proxy、损坏备份、外部改动与硬链接别名。测试只在临时夹具运行；不会改变用户真实脚本。结果始终拒绝自动应用/回滚或 Tampermonkey/业务认证。TEST-020/021 仍缺事务替换、断电恢复、真实回滚及产品 E2E。CI、SHA 和整合状态须以现行 GitHub 记录核验。

## （7）TASK-015/017 · TEST-024 本地有限 DOM 健康观察接入（2026-10-20）

在原有 `LimitedHealthRegistry` 的最多 32 条内存历史基础上，将桌面场景完成原生授权、自有 Chrome 的只读 DOM 连续采样与限定页面 JavaScript 异常观察后取得的**安全摘要**送入独立 `recordLimitedScenarioInspection` 映射；只有所有已批准选择器在检查窗口均存在、且窗口未观察到页面异常时才记录 `ELEMENT_FOUND_ONLY`，其他已完成但存在缺失/异常的结果均为 `INDETERMINATE`。阻断、取消、来源变化的结果不新增记录，主进程容量/时钟失败不伪报健康。证据散列只来自本地缩减摘要，不含 URL/脚本源码、路径、页面异常正文或凭据；关闭窗口即清除。可见 UI 明确提示不代表 Tampermonkey/GM/业务或自动修复验证。

新增 `tests/health/scenario-inspection.test.ts` 的正常、异常、过期、容量边界及恶意 getter/Proxy 拒绝回归，并加入 Windows `npm test`；实际测试通过状态必须读取对应 Commit SHA 的 Actions，不能仅因文件存在即认定通过。**TEST-024 仍未完整完成**：缺真实授权周期性复检、持久历史/数据恢复方案与真正 Tampermonkey 业务验收；全部 Stable GATE 保持未通过。

## （7）TASK-015/017 · TEST-024/026 有限观察历史可见性（2026-10-20）

继续在既有会话记录上加入只读原生 `scenario:history` IPC：renderer 只能传递先前已导入且已登记、符合只读资格的场景 ID；主进程独立解析对应脚本身份，最多返回 32 条观察时间与 `ELEMENT_FOUND_ONLY`／`INDETERMINATE`，不回传 SHA、脚本源码、URL、文件路径、DOM、凭据和证据原文，不支持任意路径／散列查找，不触发网页访问或系统文件更改。独立窗口仍有独立历史，关闭即清除。新增历史查询安全单测及实际 Electron sandbox/preload/renderer 交互回归，并将 IPC 纳入严格通道白名单；测试结果以最新 PR/Actions/main SHA 核验，不冒充真实 Tampermonkey/业务验证。

**TEST-024 仍为部分实现**：真实管理员确认后的周期复检与持久化、真实脚本/业务验收尚未具备；GATE-004/005/007/010 等保持未完成。

## （7）TASK-019/020 / TEST-027/028 候选双包安全增量（2026-10-20）

[PR #147](https://github.com/devin930906/userscript-auto-healer/pull/147) 在现有候选 Windows 打包脚本上隔离 Inno 安装标识、默认目录、快捷方式及 Electron 用户数据命名，并扩展便携 ZIP 校验至 138 个条目的完整文件集。Windows [Actions #39366563301](https://github.com/devin930906/userscript-auto-healer/actions/runs/39366563301) 在 PR 合成提交 `712d6ff95ec097910a1df6f58812b54426e98e22` 完成实际候选 Electron 启动、安装、ZIP 解压和卸载回归（全部文件 SHA-256 逐一对比）；345 个 npm case 为 344 pass、0 fail、1 skip。相应应用检查 [#39366563208](https://github.com/devin930906/userscript-auto-healer/actions/runs/39366563208) 成功，合并 SHA `f5ad55ce7fda0f9c3319c1547f6394305b3bac42`。**这仍非正式 Stable 或全量 TEST-027/028 通过**，最低 Windows、升级数据、完整便携只读行为、Tampermonkey 业务回归与 GATE-008/009/011 未验证。

## 2026-10-21 TASK-007 四种 `@run-at` 声明模式 Windows 实证增量（仍非正式验收）

- 已合并 [PR #196](https://github.com/devin930906/userscript-auto-healer/pull/196) 到 main `dc62043be15c4732b1b60484b8338ae709fa5acf`；源 HEAD `426a851d5b3a8d4eca6cffc40d28ec210c093145`。独立 Windows 2025 云端矩阵 [Actions #39502515449](https://github.com/devin930906/userscript-auto-healer/actions/runs/39502515449) 的四项工作均为 `success`：`document-start`、`document-body`、`document-end`、`document-idle`。
- 实际环境限于隔离 Chromium 141.0.7390.37、Tampermonkey 官方站点 CRX 下载后解包加载的 MV3 5.4.1、临时 Profile 和合成网页。每组独立管理器安装临时 `.user.js`，按该组 `@run-at` 声明执行真实 `GM_getValue` 默认值检查，并分别返回 `missing-target`（没有按钮）与 `recovered`／`done`（按钮存在）的合成业务结果。该成功与普通网页 `evaluate` 不同，但**仍然没有任何产品生成或应用补丁**。
- 实际注入时刻观测并未由此证明符合精确模式语义：`document-start` 的 broken/fixed 页面记录 `readyState=complete/interactive`；`document-body` 为 `loading/interactive`；`document-end` 为 `complete/complete`；`document-idle` 为 `complete/complete`。该值可能受受测目标加载、管理器调度及 Chromium 环境影响，不得将单次 `@run-at` 声明通过转换成精确时序 VERIFIED。
- 解包扩展运行 ID 为 `dkifgonlhleafnmllomljghfcbgaojkl`，**不同于官方商店扩展 ID** `dhdgffkkebhmkfjojejmpbldmpobfkfo`；厂商站点下载不能代替官方商店安装身份或签名验证。其他正式 Chrome/便携版版本、真实用户环境、权限矩阵、安装恢复、失败回滚及脚本真正自动修复前后回归仍待实施。
- 证据来源：`TEST-017/018` 的有限阶段性真实管理器运行；四 Job 结果、运行时 ID／版本、`@run-at` 声明、`GM_getValue` 与业务输出均在 #39502515449 的独立日志。**正式 TEST-017/018 仍受阻；GATE-004/005 未通过；GATE-001..011 均不应由此判定满足**。

## 2026-10-21 TASK-007/009 产品 AST 审核候选的真实 Tampermonkey 合成业务对照（阶段实证）

- PR [#197](https://github.com/devin930906/userscript-auto-healer/pull/197) 已合并 main `c058e37c148bbc29d1a7e670aab261c396eeea1e`；源 HEAD `a13550b51a0312385e7c1f809de81ce7e7c13e35`。隔离 Windows 2025 [Actions #39503655317](https://github.com/devin930906/userscript-auto-healer/actions/runs/39503655317) 的六个 Job 全部返回 `success`：保留四种不同声明 `@run-at` 的真实管理器基线，再增加两份独立 `document-idle` Profile 进行原版／产品候选对照。
- 本轮**使用了项目已有产品代码** `src/analyze/selector-analyzer.ts`、`src/repair/patch-planner.ts`，实际执行 `analyzeSelectors` → `proposeLiteralSelectorPatch`（`CANDIDATE_ONLY`）→ `auditProposedLiteralSelectorPatch`（`REVIEWABLE_ONLY`）；只修改一处经过 AST 定位的 `document.querySelector` 字面选择器，保留元数据与剩余代码不变。独立两个 Job 均记录原版 SHA-256 `f564a76620d1aee7b80b12ddea3a92de27cdc6e0eb16e634451ef6d173694103`，候选 SHA-256 `69c1079ef37e55c987bc81fd1696c836e45d50dfb480d5cd3bd831de4f4f0ac4`；`automaticPatchAllowed=false`。
- 原版在合成按钮实际存在的网页上调用真实 `GM_getValue` 成功，但由于失效选择器返回 `missing-target`、动作标记不存在；产品审核候选在同种页面调用 `GM_getValue` 后返回 `recovered/done`，目标按钮具有预期动作标记。没有通过 Playwright `evaluate` 直接运行用户脚本来冒充 Tampermonkey；管理器中真正安装了受控临时脚本。
- **证据限制**：仍使用 Chromium 141.0.7390.37 与从厂商网站下载、解包的 Tampermonkey MV3 5.4.1，不是经商店 ID 签名认证的正式安装，也未取得真实用户已登录网站、真正生产故障诊断证据、完整自动应用/事务备份/回滚或跨 Chrome/便携版支持矩阵。此实验只证明单个已审计的**离线候选**在合成业务场景可执行且有效，原文件与用户扩展均未被自动修改。**TEST-017/018/019 尚未完整通过，GATE-001..011 均仍未完整验收**。

## （7）2026-10-21 TASK-011/TEST-020/026 暂存候选 Proxy 反射安全回归（阶段验证）

[PR #211](https://github.com/devin930906/userscript-auto-healer/pull/211) 已合并至 `main`，合并 SHA `b80f1df3450c41225a6ebfd38d0196f073308c39`。原生只读暂存候选复核 `src/version/staged-candidate-recheck.ts` 的 `record()` 曾在排除不可信 `Proxy` 前调用 `Object.getPrototypeOf` 与自身属性描述符反射。新增 `TEST-020/026` 回归要求恶意活 Proxy 的选项及回执均被拒绝、反射陷阱执行次数为零，并确保已撤销 Proxy 安全拒绝；生产端只增加 `node:util.types.isProxy` 前置守卫，没有新增文件写入、恢复、Chrome/Tampermonkey 或 IPC 权限。

- **RED 实证**：测试提交 `518e1edd87898df608ddbbeac804387526e4facc` 的 [Windows Application Checks #39529409462](https://github.com/devin930906/userscript-auto-healer/actions/runs/39529409462) 失败，447 项用例中 445 pass、1 fail、1 skip；唯一失败为新增用例，实际触发 2 次 Proxy 陷阱（预期 0）。
- **GREEN 实证**：修复提交 `751305f6ee702164c502f49d14b9e4e0a00822da` 的 [Windows Application Checks #39529701522](https://github.com/devin930906/userscript-auto-healer/actions/runs/39529701522) success：447 项 446 pass、0 fail、1 skip，TypeScript 和真实 Electron sandbox/preload smoke 均通过。
- **候选双包回归**：[Windows Candidate EXE+ZIP #39529701493](https://github.com/devin930906/userscript-auto-healer/actions/runs/39529701493) success，构建执行源为 PR 合成提交 `7917eed658e41c31d9c8252671dc578309627b1b`，不是合并后的 main；142 项安装内容逐文件 SHA-256 一致、真实 ZIP 解压启动、安装版启动、合成升级与卸载用户数据保留均有受限证据。Artifact `12314643465` 为 **CANDIDATE ONLY / NOT STABLE**，不得作为正式 EXE/ZIP 或 Release 附件。

本增量只证明不可信输入反射边界的负例修复和候选打包回归；**TASK-011 仍开发中，TEST-020/026 未完成全部发布层验收，GATE-006/007 未通过**。原子事务、崩溃回滚、真实 Tampermonkey/GM/业务恢复、用户 Windows 设备矩阵及 GATE-001..011 的正式 Stable 验收均必须另行核验。

## （7）2026-10-21 TASK-007/TEST-017/026 子框架隔离真实 Tampermonkey 阶段验证

- [PR #212](https://github.com/devin930906/userscript-auto-healer/pull/212) 已合并 `main`，合并提交 `b438b2c9b38910fd3054a19027dfa2f913719fce`。在现有 `poc/windows-tampermonkey-cloud.cjs` 六个独立 Windows 云端 Tampermonkey 场景中，新增同源、匹配 `@match` 的**独立 iframe**（由测试框架本地响应，不访问或修改真实用户数据）及零注入／零 GM／零 DOM 动作负例，并为一次性测试脚本添加与现有产品短期 GM 探针一致的 `@noframes` 元数据。既有四种 `@run-at`、产品 AST 原版／审核候选成功与失败对照保留；仅更改隔离云端测试夹具，无产品源脚本自动应用功能或扩展权限变更。
- **夹具误差留痕**：初次 [#39531157842](https://github.com/devin930906/userscript-auto-healer/actions/runs/39531157842) 的两个基础 Job 因父页面 `addInitScript` 在子框架重复添加同 ID 测试按钮触发 Playwright strict locator 错误；此结果不是已确认的 iframe 注入失败。修正测试辅助代码仅在顶层添加父页面按钮后重新运行。
- **有效 RED 证据**：测试提交 `82a3a89dc6859e006b162d76091c9b2545ca730a` 的 [#39531320005](https://github.com/devin930906/userscript-auto-healer/actions/runs/39531320005) 中，`document-start` 与 `document-body` 两个 Windows Job 各自观察到 iframe `{"injected":"yes","gm":"true","action":"done"}`，违反此受控诊断脚本的顶层授权边界；剩余 Job 随下一提交的并发取消而取消。此红灯是真实测试脚本在扩展管理器中的执行，而不是原业务应用已发生安全事故。
- **GREEN 证据**：添加 `@noframes` 的提交 `4f1b081712ef10a2f66878222a4481a2e7ff94ae` 在 [Windows #39531485731](https://github.com/devin930906/userscript-auto-healer/actions/runs/39531485731) 六个 Job 全部 `success`。每组子框架都记录 `{"injected":null,"gm":null,"action":null}`，同时主文档的真实 `GM_getValue`／合成业务断言仍通过。产品 AST 原版 `missing-target`、仅本地审核候选 `recovered/done`，候选仍然 `automaticPatchAllowed=false`。原版 SHA-256 `9a4c3d9f7abf11c26974a4c8ea6ce611e29241156c305d34ff3d7e45d90fb42f`；候选 SHA-256 `e669c080c75493e6523cc2d01200e631423cdd81d3b034b6667eacfe4e42c5ec`。
- **适用范围**：Windows 2025 GitHub runner、隔离 Chromium `141.0.7390.37`、Tampermonkey 厂商托管解包版 MV3 `5.4.1`，运行扩展 ID `enpfkadlbafpholepfimepaikhenfcji` 与 Chrome 商店正式 ID 不同，未核验商店签名／完整用户浏览器身份。**TEST-017/018/026 只获得此有限阶段证据；TASK-007 仍开发中，GATE-004/005/006 仍未全部通过。** 未验证生产脚本、已登录目标、真实设备版本矩阵、自动补丁应用、事务回滚或 Stable EXE/ZIP，绝不能将本次合成测试升级为最终发布验收。

## （7）2026-10-21 TASK-007/TEST-018/026 受控 GM DOM 嵌套覆盖拒绝（阶段验证）

- [PR #213](https://github.com/devin930906/userscript-auto-healer/pull/213) 已合并到 `main`，合并 SHA `6d8413c28b38880580e206a6e541c03192618d82`。现有 `summarizeFixtureDomEvidence` 原生限界报告曾检查 `summary.iframeCount` 和 `summary.visibleShadowRoots` 是否为合法非负整数，却在两个计数实际大于零时仍可以给受控顶层 GM 测试页面返回 `fixtureDomMatchesExpected:true`。该有限 CDP 选择器观测不能涵盖 iframe 文档和可见 Shadow DOM；现仅对此预先定义为**无嵌套结构的测试夹具**要求实际观察计数为零，否则 `INVALID_FIXTURE_OBSERVATION`。不改变通用网页的 DOM 诊断，也不将报告提升为管理器／GM／业务验真。通用 `CLOSED_SHADOW_ROOT_UNKNOWN` 标记是默认未知而非实际发现 Shadow Root，仍容许受控正常夹具。
- **初次测试编译错误**：`ba8b578ad3ab22423b582c9702a81924d1ce253a` 的 [Windows #39532468907](https://github.com/devin930906/userscript-auto-healer/actions/runs/39532468907) 因新测试的 `blindSpots` 类型被推断成 `string[]` 而在 TypeScript 检查失败；已只对测试增加 `as const` 修复类型，没有冒充行为红灯。
- **有效 RED 实证**：测试-only `6320adc31211d1f89015a15d5bcbb4f2cfe75fdc` 的 [Windows #39532552285](https://github.com/devin930906/userscript-auto-healer/actions/runs/39532552285) 448 个 Node case 为 446 pass、1 fail、1 skip；唯一失败是新增的 TEST-018/026，实际在 `iframeCount=1` 时返回 `ok:true`、`fixtureDomMatchesExpected:true`，预期为 `INVALID_FIXTURE_OBSERVATION`。
- **GREEN 实证**：修复提交 `aad6a0d869498228258ab85adebe5e97c381b35f` 的 [Windows Application #39532750597](https://github.com/devin930906/userscript-auto-healer/actions/runs/39532750597) 已 `success`，448 case 为 447 pass、0 fail、1 skip；Windows TypeScript 检查与真实 Electron renderer/preload smoke 成功。对应 [Windows Candidate #39532750607](https://github.com/devin930906/userscript-auto-healer/actions/runs/39532750607) `success`，验证 142 项安装包完整性、真实 ZIP 解压和 Electron 启动、合成旧版升级及用户数据保留；构建采用 PR 合成源码 `707dd93e801860c81e689a94f3c2e5dfdf022183`，不是合并后 `main` 或正式发布候选。候选 Setup SHA-256 `29eb906a0f4b1005523a51d4da4971d8b11bcd78ab44b2da67bec19d4776fd25`，候选 Portable ZIP SHA-256 `a864716c22f7415e82c2413dbccd98ecd485fd0c0e3a892fd38b3fc3d2707ae5`；Actions Artifact ID `12316366457` 是 **CANDIDATE ONLY / NOT STABLE**，不得当正式 Release 附件或正式产物校验值。
- **残余范围**：本项只在受控 GM 夹具 DOM 汇总层排除了已知但未纳入观测的嵌套文档／Shadow DOM 成功假象；不证明真实 Tampermonkey 身份、GM 调用、用户业务恢复、脚本自动修复、原子回滚、正式 Windows EXE/ZIP 或任何最终 Stable GATE 已通过。TASK-007 和 TEST-018/026 的完整要求仍开发中，GATE-004/005/006/007 保留必要验收阻断。

### （7）TEST-020/021/026：原生手动恢复用户路径阶段测试（2026-10-21）
受限恢复流程要求：完全没有 renderer 路径、来源字节或同意标记输入；Electron 主进程校验可信主框架，使用两个系统文件选择器与两次显式确认。独立原版备份必须与当前脚本完整路径绑定，源/备份哈希与文件身份在原生事务执行时再次校验；任何失效/变更应拒绝覆盖。实际有权限的临时 Windows 夹具需要证明点击桌面按钮→系统模拟授权→本地原版恢复→被替换字节单独备份→恢复意图记录；同一原版不应重复恢复。成功仍不得声明业务/GM 已恢复。
以上测试仅适用于隔离 CI 夹具，须以实际 Windows Actions 日志确定通过/失败状态。尚未完成真实用户来源授权、真实外部文件锁与断电恢复、Tampermonkey 安装版本更新/GM/业务端到端、最终 TEST-020/021/026 和 GATE-006/007。

## 2026-10-24 TASK-015 / REQ-024 / TEST-024 有限脱敏历史跨重启阶段

- 原生受限 `src/health/limited-health-archive.ts` 仅由应用主进程使用 Electron `userData` 下固定目录、按导入脚本及已登记场景的独立 SHA-256 作用域储存至多 32 条时间与只读 DOM 有限状态；不存 URL、脚本源码、文件路径、DOM、错误文本或证据散列。恢复记录的当前健康一律 `INDETERMINATE`，任何旧事件不授予管理器/GM/业务验证、自动补丁或回滚权。
- 写入须先通过现有本机 Chrome 场景访问授权，并在 UI 显示本地归档告知；无 renderer 文件路径入口。新持久文件采用有界读取、身份复核、临时文件 fsync、首次硬链接不覆盖发布及本应用协作式路径互斥；存在未知文件、重解析路径、篡改或无法可靠清理时安全拒绝。不宣称对外部并发修改有 OS 级事务保证。
- [Windows RED #40086563849](https://github.com/devin930906/userscript-auto-healer/actions/runs/40086563849) 为能力未实现的预期 3 失败；[中间运行 #40086990077](https://github.com/devin930906/userscript-auto-healer/actions/runs/40086990077) 与 [#40087238993](https://github.com/devin930906/userscript-auto-healer/actions/runs/40087238993) 保留真实开发/测试夹具失败；[GREEN #40087382259](https://github.com/devin930906/userscript-auto-healer/actions/runs/40087382259) 基于源 SHA `0910d093b3698332a71e403a9b62aa81e950d9b4`，536 项测试中 535 pass / 0 fail / 1 conditional skip，Windows Electron shell smoke 成功。
- 这只满足 TEST-024 的受限本机历史持久化增量：**真实周期复检、Tampermonkey/GM/业务状态、跨真实应用重启的完整 GUI E2E、可信用户数据恢复及所有 Stable GATE 仍未全部验收**；不得据此声称正式健康监控完成、TEST-024/GATE-010 通过或 Stable 已完成。完整结果和整合以对应 PR/main 最新 CI 为准。

## 2026-10-24 TASK-015 / TEST-024/026 · 拒绝未来时间归档污染（局部防护）

- 只读健康历史归档的旧数据若格式正确但带有明显超前的 `observedAtMs`，原实现会把它展示为历史记录，并可能跳过后续真实观察；非真实、畸形或时间异常的历史均不得成为当前脚本健康证明。
- 对本机已存记录及本次原生状态快照增加一致的时间上界（相对当前系统时间允许不超过五分钟的容差）；超过界限时只返回 `BLOCKED`，不得覆盖原归档、伪造成功记录或扩大自动修复权。此校验不能证明本机 JSON 记录的作者身份，不应宣称防篡改认证；本地系统时钟严重漂移时需人工检查，不自动重写历史。
- Windows TDD RED：[Actions #40090211582](https://github.com/devin930906/userscript-auto-healer/actions/runs/40090211582)，修复前源码 `380d05977d266016952e8471516d61be18f53618`，538 tests / 535 passed / **2 新增失败** / 1 conditional skip。GREEN：[Actions #40090483982](https://github.com/devin930906/userscript-auto-healer/actions/runs/40090483982)，修复源码 `66e3264192151b8da4013650045ce88650f961ca`，538 tests / **537 passed / 0 failed** / 1 conditional skip，真实 Windows Electron sandbox/preload IPC smoke 通过。
- 这仅为 TASK-015/TEST-024/026 时间序列安全增量，真实授权周期复检、Tampermonkey/GM/业务状态、跨真实用户 Windows 安装重启/迁移及完整 TEST-024、全部 GATE 仍未通过。

## （7）2026-10-26 最新主干 TEST 阶段证据（非正式 Stable）

- **目标提交**：`35033f74c52aa6edaca3723ac4ca23165db3d3d5`，不是历史 PoC SHA、PR 合成检出提交或发布标签。
- **Windows 产品代码与安全回归**：Application Skeleton Checks [#40270063756](https://github.com/devin930906/userscript-auto-healer/actions/runs/40270063756) 为 `success`；599 项 Node 测试中 598 `pass`、0 `fail`、1 条件 `skip`，Windows Electron shell smoke 通过。它不单独证明真实脚本自动修复成功。
- **首选管理器专项**：TASK-007 Official Tampermonkey isolated Windows experiment [#40270144017](https://github.com/devin930906/userscript-auto-healer/actions/runs/40270144017) 为 `success`，15/15 Job 成功，包含四种 `@run-at` 基线、原生 GM 和产品生成的 `querySelector` / `getElementById` 手动候选、原版失效／候选恢复、人工安装版本恢复与负向子框架断言。实际日志显示隔离 Chromium `141.0.7390.37`、厂商托管解包 Tampermonkey MV3 `5.4.1`、`GM_getValue` 和 `GM_setValue` 往返；运行时扩展 ID 不等于商店正式 ID (`officialStoreIdMatch=false`)。**不能称为商店身份认证，也不能推广至用户 Tampermonkey 5.5.1/Chrome 155 或所有生产网站**；原件、候选和恢复路径均为隔离测试，自动应用／自动回滚仍为 false。
- **TASK-019/020 开发候选**：[Windows Candidate EXE and ZIP #40270461210](https://github.com/devin930906/userscript-auto-healer/actions/runs/40270461210) 为 `success`，同一 `main` SHA 下 599 项中 598 通过、0 失败、1 跳过；147 个 ZIP 与 EXE 安装文件的内容 SHA-256 对照通过，附带限定搬移、只读目录启动、合成升级及卸载保留测试。这仅是开发候选，非 TEST-027/028 的完整正式验收。
- **未解除的正式门槛**：真实目标网站与真实失效脚本、用户授权环境兼容矩阵、自动应用及原子回滚、异常断电恢复、完整端到端业务断言、正式双包签名/发布策略与 GATE-001..011。不要因多项 Job `success` 将整个 TEST-017/018、TEST-020/021/022、TEST-027/028 或 GATE 自动设为通过。

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

## （7）2026-10-27 TASK-003 / TEST-004/026 不可信元数据字节输入隔离

- **回归目标**：`readUserscriptSource` / `parseUserscriptMetadata` 是导入后的只读解析入口；伪造的字节对象、Getter、活跃/已撤销 Proxy 不得在特权进程执行任意外来 JavaScript。保留合法 Uint8Array/Buffer、UTF-8、UTF-8 BOM、UTF-16 LE/BE BOM、显式 GB18030 的既有解码行为，不读取、更改或执行实际用户脚本。
- **TDD RED**：测试先行 `339007a66aa68b4b9d303e47071f1ee3abd19bfa`；[Windows #40454762079](https://github.com/devin930906/userscript-auto-healer/actions/runs/40454762079) 共 642 项，640 pass、1 fail（新增用例以 `PRIVATE_METADATA_INPUT_EXECUTED` 证明旧代码调用外来 Getter）、1 skip，类型检查成功。
- **TDD GREEN**：`ad10c62c071b486f7f9dd0398816aea09ec6091c`；[Windows #40455069810](https://github.com/devin930906/userscript-auto-healer/actions/runs/40455069810) completed/success，642 项中 641 pass、0 fail、1 conditional skip，Windows Electron sandbox/preload smoke 同样成功。
- **验收边界**：这是 TASK-003 已整合模块的一项 TEST-004/026 安全回归补丁，未改变需求或管理器能力；真正 Tampermonkey、可信自动修复/回滚、正式 TEST/GATE、EXE/ZIP Stable 验收仍独立受阻。分支是否完成 PR 集成须按实时 GitHub 状态复核。

## （7）2026-10-27 TASK-011 / TEST-020/026 恢复检查点最终回执的磁盘身份复核
- **边界与风险**：原生 `stageRecoveryCheckpointOnly` 原先校验发布后的 JSON，然后异步重新验证原始源码/备份/候选。外部进程能在后续 I/O 时间窗改写已发布检查点，或用相同字节替换文件 inode，但旧代码仍返回 `CHECKPOINT_STAGED_UNVERIFIED`。这是无授权的“回执陈旧”风险；本函数始终禁止自动应用、自动回滚及 Tampermonkey/业务已验证声明。
- **真实 RED**：新增 `tests/version/recovery-checkpoint.test.ts` 的 TEST-020/026 两种磁盘故障注入，源码 `c2f1bf4a0f79ed7744d699b5e3cafb5aff3fbfca`；Windows [#40457329095](https://github.com/devin930906/userscript-auto-healer/actions/runs/40457329095) 643 tests，641 pass、1 fail（内容被外部修改后仍错误返回成功）、1 conditional skip；TypeScript 检查成功。
- **真实 GREEN**：实现 `74eb05cf6c971e13a212b87ede93fdcb15d596e9`，记录原暂存 inode 对应的已发布文件对象，在末次候选复核后再次验证检查点原始字节、inode、时间戳、单硬链及父目录身份；失败保留文件供人工核对、不覆盖源脚本。[Windows #40457596319](https://github.com/devin930906/userscript-auto-healer/actions/runs/40457596319) 643 tests，642 pass、0 fail、1 conditional skip，类型检查和实际 Electron shell smoke 成功。
- **未解除的发布门槛**：属于 TASK-011 本地检查点阶段的安全回归，不提供操作系统排他锁或断电原子性证明，不实现可信 Tampermonkey 业务验收、源脚本自动修复/回滚，也不代表 TEST-020/021/026 全量、GATE-006/007 或 Stable 发布通过。PR 整合及主线验证须独立复核。
