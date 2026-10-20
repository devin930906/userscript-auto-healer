# Stable 剩余工作登记（基线快照）

> 快照日期：2026-10-21（MYT）；仓库：`devin930906/userscript-auto-healer`；最近已核对的产品集成基线：`7868dc28510fc0f4958804414e11937c7d4496e7`（PR #198 squash 合并；此前 PR #197 为 `c058e37c148bbc29d1a7e670aab261c396eeea1e`）。只登记未完成的正式 TASK，不重做 TASK-001..006；前述阶段实证不等于 Stable 产品完整验收。

## 状态判断

- 已实现但未充分验证：阶段代码已经存在或进入 main，但缺正式真实环境、产品级测试或要求中的可靠性证明；不得用文件存在代替验收。
- 已验证但未整合：本次核查开放 PR 为 0，未确认有可直接整合的独立完整成果；旧分支不自动视为有效。
- 已整合但未通过 Stable 发布门槛：Windows 候选 EXE/ZIP 和多项阶段模块已有合并/CI 记录，全部 GATE 尚未通过。
- 已完成 TASK-001..006 按 `docs/09-development-plan.md` 保留历史，不在本表重复施工；任何新发现的回归缺陷必须关联原编号。
- 工程完成百分比：**无法确认**，禁止由任务数量或历史提交数倒推。

## 剩余任务（每项九字段）

| 任务编号 | 关联需求 | 当前状态 | 实际缺口 | 影响范围 | 前置依赖 | 已有证据 | 下一执行动作 | 完成条件 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-007 | REQ-017/018；TEST-017/018 | 四种声明 `@run-at` 模式的真实 Tampermonkey 合成脚本/GM 阶段测试，以及一对真实管理器中执行的产品生成/审计候选与原版对照，已完成并整合；完整产品级验收仍受阻 | CRX 解包扩展运行 ID 不等于商店官方 ID，缺商店签名身份；部分 `readyState` 记录不支持精确注入时机承诺；现有产品候选对照仅在无真实用户数据的合成站点完成，缺可信支持矩阵、产品自动安全应用、真实修复回归与失败恢复 | 管理器适配；GATE-004/005 | TASK-004..006；独立授权测试环境；真实补丁应用需要 TASK-010/011 | PR #194/#196/#197 均已合并；#39502515449 的四种 `@run-at` 各自 Job success；PR #197 HEAD `a13550b51a0312385e7c1f809de81ce7e7c13e35`，Actions #39503655317 六 Job success，`product-original` 与 `product-candidate` 同一原版 SHA `f564a76620d1aee7b80b12ddea3a92de27cdc6e0eb16e634451ef6d173694103`、候选 SHA `69c1079ef37e55c987bc81fd1696c836e45d50dfb480d5cd3bd831de4f4f0ac4`，原版目标存在时 `missing-target`、审计候选 `recovered/done`，`automaticPatchAllowed=false`；main 合并 `c058e37c148bbc29d1a7e670aab261c396eeea1e` | 确认可信商店 Tampermonkey 身份与注入时序，接通经授权真实业务场景、备份门控及产品实际修复/回滚；不得将合成候选成功升格为自动修复 VERIFIED | TEST-017/018 在正式支持矩阵内的真实产品正反与失败恢复完整通过，GATE-004/005 另行验收 |
| TASK-008 | REQ-013；TEST-013 | 阶段代码已整合，集成未完成 | 只读 DOM/JS 信号已存在，但可信 Tampermonkey 故障归因与完整日志链未验证 | 故障诊断与后续修复 | TASK-007 | docs/09-development-plan.md；src/diagnostics/ | 以实际失败脚本场景完成归因、误判和脱敏验证 | TEST-013 产品级正反例与回归证据通过 |
| TASK-009 | REQ-014/019；TEST-014/019 | 阶段代码已整合，单一真实管理器合成候选验证通过，完整自动修复仍受阻 | PR #197 中现有 AST 补丁引擎已实际生成单一选择器 `CANDIDATE_ONLY`、独立审计 `REVIEWABLE_ONLY` 并在隔离 Tampermonkey 合成页面恢复业务；但不是产品诊断证据绑定、用户脚本自动应用、独立备份/回滚或正式真实网站回归 | 核心修复 | TASK-007/008/010/011 | PR #197；Actions #39503655317（六 Job success，两个产品对照 Job 保持原版/候选 SHA 一致），源 HEAD `a13550b51a0312385e7c1f809de81ce7e7c13e35`；src/repair/patch-planner.ts | 在经批准的真实端到端场景验证候选与诊断证据的一致性，连接备份、独立验收、显式用户授权及安全原子应用／回滚 | 经可信证据与安全备份实际执行修复，拒绝扩权和失败恢复测试通过；目前不得自动应用 |
| TASK-010 | REQ-018/021；TEST-018/021 | 阶段代码已整合，产品门槛未完成 | 离线审计与阻断逻辑不提供可信管理器/业务/备份证明 | 自动验收 | TASK-007/009/011 | src/acceptance/；docs/09-development-plan.md | 增加独立真实业务前后验收及可信备份绑定 | 可信正反证据可重演且未知状态安全拒绝 |
| TASK-011 | REQ-020/021；TEST-020/021 | 阶段代码已整合，事务能力未完成 | 原字节备份/只读恢复检查与候选暂存已实现；未完成安全原子应用和真实回滚事务 | 源脚本完整性与恢复；GATE-007 | TASK-009/010 | src/version/；docs/09-development-plan.md | 设计且测试原子提交、崩溃/锁/冲突注入与完整回滚 | 真实文件恢复一致，受阻绝不覆盖 |
| TASK-012 | REQ-023；TEST-023 | 阶段代码已整合，管理器同步未验证 | 只读复核/手动导出不等于 Tampermonkey 已安装版本变更 | 用户升级与导出 | TASK-007/011 | src/export/；docs/09-development-plan.md | 验证授权导出、扩展内版本状态与失配恢复 | TEST-023 在真实 Tampermonkey 环境通过 |
| TASK-013 | REQ-022；TEST-022 | 阶段代码已整合，持久流程未完成 | 内存队列/只读检查点/会话进度存在；缺真实批处理持久事务与跨启动恢复 | 任务可靠性；GATE-007 | TASK-008..012 | src/jobs/；docs/09-development-plan.md | 连接真实作业并测试崩溃、重复、取消与一致性 | TEST-022 持久恢复和隔离回归通过 |
| TASK-014 | REQ-015/016；TEST-015/016/026 | AI 网关阶段代码及输入 Proxy 边界修复已完成并整合；产品级验收未完成 | 本轮 `record()` 对配置／授权／证据反射前增加 `node:util.types.isProxy` 拒绝；严格负例防止触发恶意 Proxy 陷阱及未授权网络调用；尚缺正式可选 AI 接入范围与全量安全/产品实测 | 可选 AI 本地输入边界、安全与可靠性；GATE-006 | 既有可选网关，无新增生产依赖 | PR #195 已合并 main `a51bc8feafbb0e315d58c78c3e53174bc2055c50`；红 CI #39500069104（2 项新增测试失败）；绿 CI #39500385626（408 总计，407 通过、0 失败、1 条条件跳过）；Windows 候选 #39500385634 成功，但不属正式 Stable；main 合并后文档 #39501431043 成功 | 结合 TASK-018 核对全量 AI 网络/隐私安全及可选能力产品实测，不重复本轮已通过的 Proxy 负例 | 已有阶段安全边界修复保持通过；所有关联真实产品与安全 GATE 要求均取得独立验证证据 |
| TASK-015 | REQ-024；TEST-024 | 阶段代码已整合，正式监控未验证 | 会话内短历史已实现；缺已授权周期复检、持久记录和管理器业务真实性 | 健康监控 | TASK-010/013 | src/health/；docs/09-development-plan.md | 验证明确同意的复检计划、数据生命周期与真实业务信号 | TEST-024 完整正反例和过期恢复通过 |
| TASK-016 | REQ-025；TEST-025 | 阶段代码已整合，真实兼容回归未验证 | 只读内存兼容层不能证明真实多脚本替换/回滚 | 共享兼容行为 | TASK-009/010/015 | src/compat/；docs/09-development-plan.md | 在独立 Tampermonkey 样本中复核多脚本冲突与回退 | TEST-025 真实多脚本不回归 |
| TASK-017 | REQ-001..025；TEST-002/022 | 阶段 UI 已整合，完整用户旅程未完成 | 导入/场景/只读检查/手动导出为局部旅程；缺可信修复/批处理/恢复端到端 | 完整 GUI 用户路径 | TASK-013..016 | app/ui/；docs/09-development-plan.md | 组合受支持场景，覆盖异常、取消及权限拒绝 | 完整实际用户流程与关联测试通过 |
| TASK-018 | REQ-001..026；TEST-007/018/026 | 正式整合安全审计未开始 | 已有组件负例与 Electron smoke，但缺正式全量安全、Tampermonkey E2E、隐私与供应链验收 | GATE-003..007 | TASK-017 和可信管理器矩阵 | docs/09-development-plan.md；docs/06-security-risk.md | 完整威胁复核与真实 Windows+管理器 E2E | 所有高严重度风险受控，要求的真实测试证据齐全 |
| TASK-019 | REQ-027；TEST-027 | 候选构建已整合，正式发布未通过 | 候选 EXE 已验证局部安装/卸载/哈希；缺升级、清洁用户环境、业务与数据持久性正式验收 | GATE-008/011 | TASK-018；正式版本与签名策略 | docs/08-release.md；scripts/windows-package-candidate.ps1 | 从最终来源提交构建正式安装器，检查安装/升级/卸载数据 | TEST-027 与 GATE-008/011 完整通过 |
| TASK-020 | REQ-028；TEST-028 | 候选构建已整合，正式发布未通过 | 真实候选 ZIP/哈希/只读路径有限通过；缺完整用户便携/首次运行/配置迁移验收 | GATE-009/011 | TASK-018；正式版本 | docs/08-release.md；.github/workflows/windows-candidate-packages.yml | 以最终同源提交重新构建完整 ZIP、解压运行并实测数据策略 | TEST-028 与 GATE-009/011 完整通过 |
| TASK-021 | REQ-001..028；TEST-001..028 | 未开始最终发布验收 | 11 项 GATE 无完整合格证据；未发现 GitHub Release | 最终 Stable；GATE-001..011 | TASK-018..020 和全部适用需求 | docs/08-release.md；GitHub releases（2026-10-21 返回空） | 汇总各项可复核证据、同 SHA 双包构建验签/校验并审查授权 | 全部 GATE 通过、版本/提交/真实双包/SHA256/发行说明一致 |

## 证据与跨会话续接规则

1. 本表是基于上述 main SHA、`docs/09-development-plan.md`、`docs/07-testing.md`、`docs/08-release.md`、公开 Actions 与 Release 现状整理的检查点；若与后续提交冲突，以更新的实际 GitHub SHA、Actions 运行、PR 合并结果为准。
2. 测试证据每条必须保存：TEST 编号、环境、执行命令/工作流、源码 SHA、运行 ID、结果、证据 URL；尚未实际运行标记为「未执行」，依赖不满足标记为「受阻」。
3. TASK-014 历史 HTTP 资源清理已整合（PR #184）。2026-10-21 新增 Proxy 输入反射安全修复 PR #195 并合并 main `a51bc8feafbb0e315d58c78c3e53174bc2055c50`：修复前同分支 CI #39500069104 新增两条负例真实失败，修复后 PR HEAD `f684dd2ad8f20c953fc892805f2d5139e6900751` 的 Windows 应用 CI #39500385626 两 Job success、407 pass/0 fail/1 conditional skip；文档 CI #39500385605、便携 Chrome CI #39500385652 与候选 EXE/ZIP #39500385634 success。合并后 main 的应用 CI #39501430909 须按其最终运行结论单独复核，以上候选和负例验证绝非正式 Stable GATE 完成。
4. TASK-007 真管理器四声明模式专项证据：PR #196 合并 main `dc62043be15c4732b1b60484b8338ae709fa5acf`；PR HEAD `426a851d5b3a8d4eca6cffc40d28ec210c093145` 的 Windows Actions #39502515449 有 4 个独立 Job `success`（`document-start/body/end/idle`），均在隔离 Chromium 141.0.7390.37 与官方站点下载、解包运行的 Tampermonkey MV3 5.4.1 中完成临时脚本、GM_getValue、合成 broken/fixed。扩展 ID `dkifgonlhleafnmllomljghfcbgaojkl` 非商店正式 ID `dhdgffkkebhmkfjojejmpbldmpobfkfo`，不构成商店签名认证；`document-start` 的 broken/fixed 实际 readyState 为 `complete/interactive`，未确认预期最早注入时机，不能将通过的合成行为称作准确时序或产品自动修复。正式 TEST-017/018、GATE-004/005 仍受阻。
5. TASK-007/009 产品 AST 候选受控真实管理器对照：PR #197 已合并 main `c058e37c148bbc29d1a7e670aab261c396eeea1e`；PR HEAD `a13550b51a0312385e7c1f809de81ce7e7c13e35` 的 Windows Actions #39503655317 六个独立 Job 均成功（保留四种声明 `@run-at` 基线、另加 `product-original`/`product-candidate` 两份独立 Profile）。产品原始源码经 `analyzeSelectors`、`proposeLiteralSelectorPatch`、`auditProposedLiteralSelectorPatch` 仅改一处 AST 字面选择器并通过原版/候选 SHA 绑定；在同一类型合成目标存在页面上原版 `missing-target`，候选 `recovered/done` 且真实调用 `GM_getValue`；没有对用户文件的写入/安装或自动应用，原 `automaticPatchAllowed=false`。厂商站点解包 Tampermonkey ID 非商店签名身份、缺真实用户业务和安全回滚，正式 TEST/GATE 均未通过。
6. 不新建与原任务重叠的正式 TASK；缺陷按现有 REQ/TEST/GATE 关联。当前无开放 PR，未来需遵守单一主 PR 原则，不自动清理未知历史分支。
7. 完整原始决策、旧合并历史、测试细节仍保留在原 docs/09、07、08、10；本登记不替代它们或声称旧证明失效。

8. TASK-009 / REQ-014/019 / TEST-019/026 的本地 AST 审核 Proxy 输入边界已以 [PR #198](https://github.com/devin930906/userscript-auto-healer/pull/198) 追加回归并整合 `main`（squash SHA `7868dc28510fc0f4958804414e11937c7d4496e7`）。先行测试提交 `994477d47f45be0da10c49e111b776921f34508c` 的 [Windows Actions #39505218979](https://github.com/devin930906/userscript-auto-healer/actions/runs/39505218979) 真实失败（409 tests：407 pass / 1 fail / 1 skip，恶意 request Proxy get trap 被触发 1 次）；修复源提交 `43232d7101a36ddb5e460568430209556316468d` 的 [应用工作流 #39505474855](https://github.com/devin930906/userscript-auto-healer/actions/runs/39505474855) 通过（409 tests：408 pass / 0 fail / 1 conditional skip，Electron smoke success），[Windows 候选双包 #39505474830](https://github.com/devin930906/userscript-auto-healer/actions/runs/39505474830) success，仅为开发候选。修复对请求、回执和嵌套 change Proxy 在属性探针前拒绝，保持 `automaticPatchAllowed=false`；**不授予自动修改原脚本或 Tampermonkey 安装权限，不代表完整 TEST-019/026、TASK-009 或 Stable GATE 通过**。合并后的 main 当前 SHA 与文档 CI 须按 GitHub 最新记录重新核验。
