# 系统整体架构

> 状态：Chrome/CDP、限定真实 Violentmonkey+GM API、两组合成 broken/fixed 业务断言与临时双格式工具链均有真实 PoC；ADR-001 已有条件选定 Electron+TypeScript 供 TASK-001 安全骨架实施，其余实机支持矩阵和最终 Stable 未验收。

## 整体结构
Windows 用户界面/受限配置入口 → BatchCoordinator → Import/Metadata/Scenario → ChromeLauncher/CDP + ManagerAdapter → Diagnostics → LocalRepair/可选 AIGateway → AcceptanceGate → VersionStore/Export → HealthHistory；CompatibilityLayer 为带版本的共享定位能力。各服务返回类型化结果与证据引用，不能跳过真实验收/备份。

## 模块职责
| 模块 | 职责、输入与输出 | 非职责及依赖 | 错误处理/独立测试 |
|---|---|---|---|
| ImportService | import(paths)→原字节/hash、导入错误清单 | 不执行脚本；依赖有权限文件系统 | 二进制/重名/目录越界 |
| MetadataAst | analyze(source)→元数据、AST、源码行列/函数/作用域/fallback、待运行时列表 | 不声称识别全部动态调用 | 动态拼接/混淆/无效 JS |
| ScenarioRegistry | match(meta,userTarget)→场景 URL、前提、断言 | 不登录、不证明业务行为 | 冲突/缺少场景 |
| ChromeLauncher | launch(executable,profile,port)→OwnedProcess/错误 | 不接管非本工具进程；依赖授权 | 136+ 默认目录/端口占用 |
| CdpSession | attach(ownedProcess,expectedTarget)→VerifiedSession | 不假设有端口即归属本实例 | 版本、目标及端点身份失配 |
| PageObserver | capture(session)→可见 DOM/盲区、SPA 路由、时间状态 | 不绕过安全隔离 | iframe、关闭 Shadow Root |
| ManagerAdapter | preflight/profile + runScenario→GM API、安装/匹配/真实运行证明 | 不将原生 evaluate 当管理器运行 | 运行沙箱和注入时机 |
| DiagnosticService | classify(static,dynamic,logs,assertions)→根因与证据 | 不强制转换成 Selector 问题 | 网络/权限/业务失败 |
| RepairService | propose(rootCause)→最小 diff 与风险标志 | 不直接覆盖原文件 | 无可信候选转待确认 |
| AIGateway | propose(consent,redactedData,model)→不可信候选 | 不默认联网、不验证候选 | 限额/超时/模型发现缺失 |
| AcceptanceGate | check(candidate,managerEvidence,assertions)→VERIFIED/DETECTED_ONLY/FAILED/UNKNOWN | 不允许空断言返回 VERIFIED | 缺扩展/缺运行/缺登录/Chrome 138+ 扩展级 Allow User Scripts 未授权 |
| VersionStore | backup、hash、stage、apply、rollback | 只改授权文件，需互斥锁 | 中断恢复、回滚校验 |
| BatchCoordinator | 任务排队、取消、有限重试、恢复与错误隔离 | 不无限并发 | 重复执行幂等性 |
| HealthHistory | 存诊断/修复/监测及证据 | 历史成功不代表现在成功 | 记录校验与隐私脱敏 |
| CompatibilityLayer | 网站/元素语义映射、版本化定位器 | 不自动更新所有依赖脚本 | 全依赖脚本回归、回滚 |

## 依赖关系
REQ-001/004/005→REQ-006/007/008/009/010/012/017→REQ-013/014/018/019/020/021/023；REQ-016→015；REQ-022/024/025 复用核心闭环。模块共用状态和审计，不以大型微服务或远程数据库为默认架构。

## 运行流程
用户授权导入→静态识别/手动补充目标网页和业务断言→配置独立 Profile→选定 Chrome 启动并验证 CDP 会话→预检真实脚本管理器→观测运行时 DOM→归因→本地候选（可选 AI 候选）→差异检查→真实管理器业务测试→备份、授权与应用→确认版本/导出与历史。缺少任一关键证据则不允许报告完整恢复。

## 状态管理
Task: QUEUED→PREFLIGHT→OBSERVING→DIAGNOSED→CANDIDATE→VALIDATING→VERIFIED / DETECTED_ONLY / FAILED / UNKNOWN / BLOCKED；验证成功后才可 STAGED→SAVED / EXPORTED。另有 CANCEL_REQUESTED→CANCELLED 和 RETRYABLE_FAILED。Health: UNTESTED / ELEMENT_FOUND_ONLY / RECOVERED_VERIFIED / BROKEN_VERIFIED / INDETERMINATE。每次记录 taskId、scriptHash、browserVersion、managerVersion、scenarioId、证据、时间、错误码；跨进程重启先校验操作日志防重复写入。

## 接口契约
所有服务使用 Result<T,Error> 类型并携带 error.code / retryable / safeMessage / evidenceRef，外部调用带 AbortSignal、超时策略及幂等 operationId。BrowserConfig: executablePath、userDataDir、remoteDebuggingPort(默认 9223)、bindAddress(127.0.0.1)；拒绝非本机调试监听。BrowserIdentity: 自有进程标识、真实二进制/数据目录、/json/version、页面目标、关联会话；未能绑定归属拒绝执行。ManagerReadiness: manager/version/enabled/scriptStored/scriptEnabled/permissions/userScriptsConsent/userScriptsApiAvailable/loaderRegistered/siteAccessGranted/matchEffective/runAtObserved/actualInjectionEvidence/gmAssertions/preconditions。**扩展 Worker 已注册、扩展存储内脚本 enabled=1、browser.userScripts.getScripts() 有 loader 记录均只是必要条件，不可代替目标网页的实际执行与业务断言。**Patch: fromHash、diff、allowedScope、riskFlags、verificationRefs。TestEvidence: scriptHash、真实扩展/浏览器版本、目标 URL、场景/动作/断言、时间、结果，证据不足不可 VERIFIED。VersionRecord: beforeHash/afterHash/backupPath/operationId/rollbackResult。

## 数据设计
初版拟采用仅本地存储：脚本源文件和备份原字节独立保存，元数据/任务事件/状态可选 JSON+append-only journal 或 SQLite（由写入 PoC 决定），实体 Script / Scenario / Task / Evidence / Patch / Backup / HealthEvent / CredentialReference；不把密钥或登录 cookie 复制到通用存储；变更 schema 应具备版本/迁移/回退。

## 配置设计
chrome.executablePath(需用户指定)；chrome.userDataDir(授权的非默认目录)；chrome.port=9223；chrome.bindAddress=127.0.0.1；repair.mode=local-first；repair.autoApply=false；ai.enabled=false；ai.baseUrl、ai.apiKeyReference、ai.model（用户自定义）；ai.maxRequests（需设置）；privacy.allowedOutboundFields=[]。所有路径规范化、检查目录占用和 symlink，敏感密钥受保护保存，配置迁移失败保留旧版本。

## 异常恢复
CDP 断线→撤销该会话验收；脚本 hash 不匹配→冲突停止；备份失败→禁止任何覆盖；文件中断→操作日志恢复/校验；AI 超时→本地结果保持；扩展或登录前置缺失→UNKNOWN；浏览器由本工具自启才允许关闭该进程。

## 架构限制
普通 Chrome 136+ 调试须非默认用户数据目录。现代正式 Chrome 的扩展侧载/油猴管理器安装不保证能全自动完成。CDP 看得到 DOM 不等于管理器正常执行。Windows runner 中的 CDP/独立 Profile 及原 RAR5 试用已进行历史限定验证（现行 ZIP 发行见 ADR-004），Violentmonkey 2.49.0 的标准 HTTPS 脚本及 GM_getValue 实际调用已通过（POC-02D）；现已另有用户 Chrome+Tampermonkey 5.5.1 的限定 POC-02T-LIVE 真 .user.js/GM/人工 broken/fixed 证据（docs/evidence/2026-10-18-tampermonkey-live-browser-qa.md），**但独立云端 Tampermonkey、产品真正自动修复、所有便携 Chrome 与正式 ZIP 应用便携启动仍未验证**。对非标准端口与脚本匹配必须给出诊断和验证提示，不得把脚本未运行直接归因为选择器故障。相应阻断见 03/11。
