# 2026-11-02 新版（4）/（7）Stable 指令迁移与开发交接

> 目标仓库：https://github.com/devin930906/userscript-auto-healer。本文件是当前执行规则与实证迁移记录；每次新对话须重新核实 GitHub 远端状态，不得以本文件的历史 SHA 冒充当前 HEAD。

## 迁移依据与保留范围

旧（4）前期阶段的有条件准入、原（7）持续开发以及既有代码、测试、PR、Actions、Windows 开发候选均保留。REQ/NFR、ADR、RISK、TEST、GATE、TASK-001..021 的编号和正式需求、Windows EXE＋ZIP Stable 门槛均不重建、不降低。历史阶段完成不代表当前 Stable 验收完成。

用户提供的新版（4）/（7）明确取消 Issue 独占认领、历史任务锁、签名持有者轮次与释放机制。Issue 作为分类任务和 PR 追踪入口，而非锁；多个对话可在同 Issue 的安全隔离范围持续开发。历史 work/issue-*、coord/issue-* refs 与 docs/16..18、旧治理脚本和测试工作流保留为审计资料，不删除、重置或强制覆盖。

## 已实际执行的仓库迁移

- [PR #602](https://github.com/devin930906/userscript-auto-healer/pull/602) 已通过 Documentation Integrity [#41447142782](https://github.com/devin930906/userscript-auto-healer/actions/runs/41447142782) 和旧 required context [#41447143227](https://github.com/devin930906/userscript-auto-healer/actions/runs/41447143227) 后合并，合并 SHA 为 617fd3879f7a33ff3a5311868c1164b4e6dfb6fb（历史迁移检查点）。
- 现行 AGENTS.md 2026-11-02 小节优先于旧版认领段落。旧 Issue #565 代表已经退出新版开发必经流程的治理任务。
- [Ruleset #26307718](https://github.com/devin930906/userscript-auto-healer/rules/26307718) 仍要求名为 Issue coordination / stale round fence 的状态检查。此名称为兼容已生效规则集而保留，PR #602 改写可信 main 上的检查脚本为无 Issue 锁的 PR SHA、目标和开放 PR 同文件检查，**不是继续认证 Issue 所有权**。
- [Ruleset #26308886](https://github.com/devin930906/userscript-auto-healer/rules/26308886) 保留对旧协调 ref 的 non-fast-forward 保护；该保护不是开发者必须继续取得 Issue 锁的条件。

## GitHub Issues 新补全的原有 Stable 工作

| TASK | GitHub Issue | 关联需求 | TEST/GATE | 剩余工作方向 |
|---|---|---|---|---|
| TASK-012 | [#603](https://github.com/devin930906/userscript-auto-healer/issues/603) | REQ-023 | TEST-023 | 脚本导出及管理器版本状态 |
| TASK-014 | [#604](https://github.com/devin930906/userscript-auto-healer/issues/604) | REQ-015/016 | TEST-015/016 | 可选 AI 与隐私预算 |
| TASK-015 | [#605](https://github.com/devin930906/userscript-auto-healer/issues/605) | REQ-024 | TEST-024 | 健康监控及历史 |
| TASK-016 | [#606](https://github.com/devin930906/userscript-auto-healer/issues/606) | REQ-025 | TEST-025 | 共享兼容层 |
| TASK-017 | [#607](https://github.com/devin930906/userscript-auto-healer/issues/607) | REQ-001..025 | TEST-002/022 | Windows UI 与用户旅程 |
| TASK-018 | [#608](https://github.com/devin930906/userscript-auto-healer/issues/608) | REQ-001..026 | TEST-007/018/026 | 安全审计及产品 E2E |
| TASK-019 | [#609](https://github.com/devin930906/userscript-auto-healer/issues/609) | REQ-027 | TEST-027; GATE-008/011 | Windows EXE 安装验收 |
| TASK-021 | [#610](https://github.com/devin930906/userscript-auto-healer/issues/610) | REQ-001..028 | TEST-001..028; GATE-001..011 | Stable 最终发行验收 |

现有产品与缺陷 Issues #215、#440、#480、#486、#487、#488、#489、#510 均保留。以上八个新建 Issues 是已有任务的剩余工作入口，不是新的产品功能要求。没有为 TASK-001..006 历史已完成阶段重复补建 Issue；已有开放故障仍以原 TASK 关联。

## 后续新对话实际执行流程

1. 读取最新 main SHA、Issues、所有开放 PR、改动分支、CI 和 AGENTS/09/10/11/12/14 文件；识别当次已完成与剩余可实施内容。
2. 按真实依赖与用户已批准的 TASK 选可独立实施工作。可在同 Issue 中并行不同范围，但要核对目标文件、共享接口、基准 SHA、当前远程 blob SHA 与正在进行的 PR。
3. 使用独立分支和 PR；远端变化时不得盲写或强推。Required Checks、正式 PR 审核、最新差异与合并后测试必须真实完成。
4. 旧分支与旧认领的释放状态不再作为开发准入门槛；但遇到同文件、共享接口或历史未合并成果冲突时仍必须避让、核查或修复，不可覆盖未知有效成果。
5. 保持原有 Windows 安装 EXE、真正便携 ZIP、真实 Tampermonkey 业务验收、事务备份/回滚以及全部 GATE 的正式验证和最终集中人工测试。未证明之前仍非 Stable，不得发布或宣称已交付。

## 证据边界

PR #602 是治理迁移，不是产品代码功能完成。新 PR 文件冲突检查属于尽力而为的路径级检查，不保证两次验证之间不存在竞争、不代替语义/接口审查。历史 Actions 成功不自动证明今日所有测试通过；无法用目前资料为总体 Stable 完成度给出可验证百分比。
