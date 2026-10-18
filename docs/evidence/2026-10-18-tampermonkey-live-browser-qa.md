# 2026-10-18 — Tampermonkey 真实浏览器临时脚本验证

> 证据级别：**真实 Chrome Browser MCP 会话中的一次性受限 PoC 已通过**。来源为本次用户授权的浏览器连接，不是 GitHub Actions、正式产品自动化测试或 Release 验收。没有可核验的 GitHub Actions run ID；本报告是脱敏手工执行收据，原始工具返回位于发起测试的会话。

## 执行环境及边界

- 用户已连接 Chrome 浏览器，先前只读预检记录为 Chrome 155.0.8059.40（Windows x64）；本轮在同一浏览器连接的真实 Tampermonkey Service Worker 核验扩展 ID `dhdgffkkebhmkfjojejmpbldmpobfkfo`、显示名 `篡改猴`、版本 `5.5.1`、Manifest V3。
- `chrome.permissions.getAll()` 返回含 `userScripts`；`chrome.userScripts.getScripts()` API 可用且返回两条加载注册记录（不等于两份已安装用户脚本），world `USER_SCRIPT`。
- 测试页：`https://example.net/?userscript_auto_healer_tm_poc=20261018`，一处无登录的公共示例页面。只对这个页面进行测试，不访问用户原有业务站点、不读取真实脚本源码、Cookie、密码、扩展存储或用户密钥。
- 测试脚本由 Tampermonkey 自己的“新建用户脚本 → 编辑器 → 保存”界面真正创建，唯一名称：`UAH-Tampermonkey-Temporary-QA-20261018`，`@match https://example.net/*`、`@run-at document-idle`、`@grant GM_getValue`。使用的是用户当前浏览器 Profile，**不是独立的 GitHub Actions Windows runner 或全新隔离 Chrome Profile**。只操作该临时测试脚本，不改动原有脚本或 Tampermonkey 全局设置。
- 两阶段都调用 `GM_getValue('uah_qa_unset_20261018', 'gm-default-ok')`，将返回值和选择器结果以带唯一 ID 的隐藏 DOM 测试标记回报；不调用 GM_setValue，不向服务器发送数据。

## 实际测试结果

| 阶段 | 实际操作 | 浏览器读取的可复核字段 | 结论 |
|---|---|---|---|
| 安装与启用 | Tampermonkey 编辑器保存临时脚本 v0.0.1，仪表盘按精确脚本名称确认已安装 | 匹配页刷新后 `markerPresent: true` | **已通过：真实脚本安装及注入** |
| GM API | 真实 `GM_getValue` 返回默认值 | `gmValue: "gm-default-ok"` | **已通过：限定 GM_getValue 调用** |
| broken | v0.0.1 使用预设不存在的 `#uah_missing_old_selector_20261018` | `selectorOutcome: "missing-target"`、`businessAction: "none"` | **已通过：预设旧定位器造成业务动作缺失** |
| fixed | 在同一个临时脚本中人工将定位器改为 `p`，版本设为 0.0.2，保存并刷新 | `markerPresent: true`、`gmValue: "gm-default-ok"`、`selectorOutcome: "recovered"`、`businessAction: "done"`、`targetAction: "done"` | **已通过：人工预设修正后的真实管理器业务动作** |
| 清理 | 只对精确匹配的临时测试脚本操作“删除”，并再次从回收站永久删除；关闭测试页和 Tampermonkey 临时标签页 | `remainingNamedRows: 0`；重新载入测试页面后 `temporaryScriptMarkerAbsent: true` 且 `temporaryBusinessMutationAbsent: true` | **已验证临时脚本不再注入** |

## 可重现脚本的最小逻辑

两个版本均使用相同的 `@name`、`@namespace`、`@match`、`@run-at`、`@grant GM_getValue`，并且只在预先指定的测试页运行。实际逻辑核心为：

```javascript
const gm = GM_getValue('uah_qa_unset_20261018', 'gm-default-ok');
const target = document.querySelector(selector); // broken: #uah_missing_old_selector_20261018; fixed: p
if (target) target.setAttribute('data-uah-tm-qa-action', 'done');
// 在专用隐藏 DOM 标记中报告 gmValue / selectorOutcome / businessAction。
```

**不应误读**：脚本编辑、定位器替换由测试者人工完成，**不是 userscript-auto-healer 产品自动发现故障、生成最小补丁、备份、更新管理器、自动验收或回滚**。这个测试也没有覆盖新 Profile 初始化、Chrome CDP 9223/进程归属、其他 Tampermonkey/Chrome/Windows 版本、复杂 GM API、沙箱/iframe/SPA、登录网站及正式 Windows EXE/ZIP 应用。

## 对既有工程准入的影响

- 可以独立记录 `TampermonkeyLiveFixtureInstall = LIMITED_POC_PASS`、`TampermonkeyGMGetValue = LIMITED_POC_PASS`、`TampermonkeyBrokenFixedBusiness = LIMITED_POC_PASS`、`DisposableScriptCleanup = CHECKED`。
- 原单独云端 Windows Actions 的 `POC-02T`（要求在其环境依法安装与运行真 Tampermonkey）**仍未执行 / 无 CI 通过证据**；本次可称为 `POC-02T-LIVE`。已有 Violentmonkey POC-02D/04A 仍作为独立历史证据，不混用。
- `TEST-017`、`TEST-018`、`TASK-007`、`GATE-004` 与 `GATE-005` **仍未达到正式产品验收**；这些要求可运行的正式管理器适配器、更多声明的系统矩阵、用户脚本真实修复工作流和全部安全/业务回归。
- `TASK-001` 的有条件工程准入不变，绝不将本 PoC 宣称为 Stable Release 或功能代码完成。
