# 开发代理约束

## 项目权威资料顺序
用户本次明确批准的目标与 docs/00-intake.md → docs/02-requirements.md → docs/03-feasibility.md 和 docs/adr → docs/04-architecture.md → docs/06-security-risk.md → docs/07-testing.md → docs/08-release.md → docs/09-development-plan.md → docs/10-traceability.md → docs/11-readiness.md → docs/12-handoff.md → docs/13-predevelopment-admission.md。相互冲突时明确列出并核验，严禁编造批准。

## 开发边界
当前执行开发前准备阶段不得提前写产品功能；当后续明确启动正式开发、且满足 docs/11-readiness.md 和 docs/13-predevelopment-admission.md 的阶段准入时，允许按 TASK-001 安全骨架及其验证要求进行实际开发。**此条不得被用作永久禁止开发的理由**。无论阶段如何，禁止虚报 Stable、跨仓库混用代码或把临时 PoC 当正式功能。

## 代码规则
ADR-001 已有条件决定 TASK-001 可使用 Electron+TypeScript 作为首期技术骨架；未来扩大支持范围或更改框架时必须以兼容实证和新 ADR 复审。按失败测试→最小实现→回归/安全测试→代码复审开发。所有安全敏感接口要求结构化输入、资源归属、限时/取消与不泄密错误；脚本源文件修改以最小范围并留版本。

## 任务续接方式
新会话先读取默认分支、相关开发分支、全部 Open PR、Issues、CI、最新 SHA、官方资料过时情况及 11-readiness；不得无条件重新造一套文档。优先解决真正阻断，不以任务/提交数量评价完成。

## Git 流程
复用主集成流，避免每个细小文档变更单独 PR；遵守可确认的仓库分支保护，禁止强推、删除未知文件或未获授权直接合并。每次提交关联 REQ/TASK/TEST 和实际证据，失败如实记录。

## 测试要求
REQ→TEST，Stable→GATE；不得把普通网页 DOM 检测当管理器下业务行为测试，Windows 构建通过也不代表 EXE/ZIP 真实安装便携验收。未运行测试不得声称 pass。

## 云端执行要求
Actions 使用最小 token 权限、锁定第三方依赖、控制外部 PR 权限、避免 Secrets 外泄；云端 runner 与用户真实 Chrome / 已登录扩展分别验证。

## 安全限制
不绕过 Chrome 136+ 默认 Profile 调试保护，不接管或终止外部 Chrome，不将脚本/API Key/DOM 秘密外发，不自动扩大 GM 授权，不执行不可信脚本于高权限应用主进程，无法备份验证时不覆盖原文件。

## 禁止操作
不得将其他格式重命名为 ZIP，不得把 GitHub Actions 外层工件 ZIP 冒充便携产品 ZIP；不得伪造许可证、跑测记录、构建产物、下载链接或已通过的准入结论；不得扩展到无关产品或擅自自动发布。

## 交接更新规则
任何批准的需求/架构变更按影响范围同步更新 02/ADR/04/07/08/09/10/11/12/13；进度只依据实际提交和检查记录；最终 RELEASE 需所有 GATE 获验证。

## 首选管理器与真实验收（I-011）
首选及 Stable 必测管理器为 Tampermonkey；Violentmonkey CI 仅是参考技术 PoC，不得替代 Tampermonkey 的 TEST-017/018、TASK-007 与 GATE-004/005。用户 Chrome 上已存在 Tampermonkey 的只读身份/权限预检，不等于真实脚本注入、GM API 或业务断言成功。必须逐层确认合法授权的管理器与版本、脚本安装/执行、GM API 实际调用、业务场景和回滚结果，并保留证据；无法测试就明示受阻，不能把检查标记为 VERIFIED。不得变更用户已安装脚本或扩展权限，除非有明确授权。决策见 ADR-005。

## 正式发行格式决定
2026-10-18 用户明确将原便携 RAR 改为 **ZIP**，以 I-010 与 ADR-004 为现行决策。正式产物为 EXE 安装版 + ZIP 便携版；历史 RAR PoC 可追溯但不属于当前 Stable 发布门槛。REQ-028/TEST-028/TASK-020/GATE-009/011 编号不变。

## 新版（4）→（7）Issue 驱动开发迁移与持续执行（2026-10-29）

- 本仓库已从旧版（4）的有条件准入进入持续（7）开发；新版（4）不要求重新初始化、重新批准已经确认的需求、重启 TASK-001、重新编号历史 TASK，或把已合并 PR 反向变成虚假的新 Issues。迁移基准与事实快照见 `docs/15-issue-driven-stable-bridge.md`。
- `docs/09-development-plan.md` 的 TASK-001..021 是正式工程任务编号；GitHub `#N` 是 Issues/PR 独立编号，二者不可互换。开发前核对 `TASK ↔ REQ/NFR ↔ TEST/GATE ↔ Issue ↔ PR/commit ↔ CI`，与 `docs/10-traceability.md`、`docs/14-stable-work-register.md` 一致；原有工程文档及 ADR 仍为产品、质量和授权权威。
- 优先续接已有 Open PR 和相应 Issue；无可用 PR 时选择依赖已满足的已批准 TASK；必要时先检查重复、创建范围明确且可验收的 Issue。远期/未定事项保留正式计划，不以 Issue 数量代替覆盖程度。Issue 未创建不使已批准 TASK 自动失效；该 TASK 执行前按实际规则建立/关联追踪。
- 已核验的当前关键 Issues：TASK-007→#486、TASK-008→#480、TASK-009→#487、TASK-010→#488、TASK-011→#489、TASK-013→#440、TASK-020→#215。其他 TASK 以正式任务表和当前仓库实况为准，切勿误判其已完成或无待办。
- 每个代码 PR 记录 TASK、对应 Issue（如有）、相关 REQ/NFR、TEST/GATE、目标 SHA、真实测试证据、剩余阻断及准确目标分支；无需代码变更的验收工作不强造 PR。仅当整个 Issue 的验收已满足且 GitHub 自动关闭条件适用时，使用 `Fixes #N` / `Closes #N`；否则使用 `Refs #N` 并保留 Open。已合并 PR 不自动等于任务完成、Stage 通过或 Stable 发布。
- 已确认的 Issue #215/#440/#480 均属独立间歇性故障，必须保留失败证据；单次绿色重跑不等于根因修复。开发过程中新增故障先查重复；保留原有安全边界，不提高超时/跳过测试/伪造管理器证据以让 CI 变绿。
- 每次开发会话结束同步核验最新 main SHA、Issues/PR、实际提交与 Checks，并**按影响范围**更新 09/10/12/14 及其权威证据；不重新覆盖历史记录。原有 `docs/11-readiness.md` 与 `docs/13-predevelopment-admission.md` 的准入结论是当时的历史阶段结论，不是最新代码的 Stable 质量认证。
- 本治理迁移仅调整任务关联与交接，不自动授予产品代码开发之外的权限、真实用户 Chrome/Tampermonkey 操作、仓库保护更改、正式 EXE/ZIP Release 或 GATE 通过。后续每次必须检查当前有效工具与仓库权限。
