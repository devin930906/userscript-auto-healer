# 开发代理约束

## 项目权威资料顺序
用户本次明确批准的目标与 docs/00-intake.md → docs/02-requirements.md → docs/03-feasibility.md 和 docs/adr → docs/04-architecture.md → docs/06-security-risk.md → docs/07-testing.md → docs/08-release.md → docs/09-development-plan.md → docs/10-traceability.md → docs/11-readiness.md → docs/12-handoff.md。相互冲突时明确列出并核验，严禁编造批准。

## 开发边界
当前属于开发前准备；不得提前写产品功能、发布 Stable 或跨仓库混用代码。最小技术 PoC 必须明确入口、失败判据和临时性，不得当成正式功能合并。

## 代码规则
确认 ADR 与兼容矩阵后再固定框架和依赖。按失败测试→最小实现→回归/安全测试→代码复审开发。所有安全敏感接口要求结构化输入、资源归属、限时/取消与不泄密错误；脚本源文件修改以最小范围并留版本。

## 任务续接方式
新会话先读取默认分支、相关开发分支、全部 Open PR、Issues、CI、最新 SHA、官方资料过时情况及 11-readiness；不得无条件重新造一套文档。优先解决真正阻断，不以任务/提交数量评价完成。

## Git 流程
复用主集成流，避免每个细小文档变更单独 PR；遵守可确认的仓库分支保护，禁止强推、删除未知文件或未获授权直接合并。每次提交关联 REQ/TASK/TEST 和实际证据，失败如实记录。

## 测试要求
REQ→TEST，Stable→GATE；不得把普通网页 DOM 检测当管理器下业务行为测试，Windows 构建通过也不代表 EXE/RAR 真实安装便携验收。未运行测试不得声称 pass。

## 云端执行要求
Actions 使用最小 token 权限、锁定第三方依赖、控制外部 PR 权限、避免 Secrets 外泄；云端 runner 与用户真实 Chrome / 已登录扩展分别验证。

## 安全限制
不绕过 Chrome 136+ 默认 Profile 调试保护，不接管或终止外部 Chrome，不将脚本/API Key/DOM 秘密外发，不自动扩大 GM 授权，不执行不可信脚本于高权限应用主进程，无法备份验证时不覆盖原文件。

## 禁止操作
不得将 ZIP/7z 改名为 RAR；不得伪造许可证、跑测记录、构建产物、下载链接或已通过的准入结论；不得扩展到无关产品或擅自自动发布。

## 交接更新规则
任何批准的需求/架构变更同时更新 02/ADR/04/07/08/09/10/11/12；进度只依据实际提交和检查记录；最终 RELEASE 需所有 GATE 获验证。
