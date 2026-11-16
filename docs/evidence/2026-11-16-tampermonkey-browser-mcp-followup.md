# 2026-11-16 — Chrome Browser MCP Tampermonkey 受限实时复核

> 证据级别：用户启动的 Chrome Browser MCP 会话中的手工受限复核。它补充真实管理器运行观察，不等于产品 TEST-017/018 完成，也不支持 Stable GATE 通过。

## 会话与管理器身份

- 在用户重启 Chrome Browser MCP 后，`list_pages` 可用；Tampermonkey 扩展 Service Worker 可执行 `chrome.runtime.getManifest()`，返回 ID `dhdgffkkebhmkfjojejmpbldmpobfkfo`、名称「篡改猴」、版本 `5.5.1`、Manifest V3。Tampermonkey 选项页也显示 v5.5.1。
- `list_extensions` 返回 `No unpacked extensions found`；此接口的结果不用于推断已安装商店扩展缺失。Service Worker 运行信息证明该扩展在连接会话中运行，但不证明 Chrome Web Store 来源。
- 用户指定 Codex Chrome Data 路径为目标，但本次执行只能确认 Chrome Browser MCP 连接会话。Administrator 下的只读进程查询看到 102 个 `chrome.exe`，其中 0 个 `--user-data-dir` 参数精确匹配指定目录；MCP 工具也没有提供会话对应进程 ID。Chrome Browser MCP 拒绝导航到 `chrome://version`。因此不能认定此次脚本测试发生在指定 Data 目录，也未确认 Chrome 版本。扩展商店来源未验证。

## 临时脚本与页面断言

- 通过 Tampermonkey 新建并保存唯一临时脚本 `UAH-Tampermonkey-Temporary-QA-20261116-486-01`。范围为 `https://example.net/*`、`@run-at document-idle`、`@noframes`，只请求 `GM_getValue`，不做网络请求或 GM 持久化写入。
- v0.0.1 实际注入并调用 `GM_getValue`，返回预期默认值 `gm-default-ok`；预设不存在的目标得到 `missing-target`，动作值为 `none`。
- 手工将临时脚本的选择器由不存在的选择器改为示例页的 `p`，版本更新为 v0.0.2。重载后实际 `GM_getValue` 仍返回预期默认值，DOM 标记为 `recovered`，目标元素的测试动作属性为 `done`。
- 这只是 Tampermonkey 上人工保存和人工更改的合成页面夹具；没有运行 Userscript Auto Healer 的故障诊断、候选生成、备份、自动修改或回滚，也不是用户真实业务网站的验收。

## 清理、范围与判定

- 只按唯一临时脚本名称删除该脚本；Tampermonkey 已安装列表中不再出现它。重载示例页后，测试标记和目标动作属性均消失。
- Tampermonkey 将该脚本留在回收站；当前界面仅提供「删除全部」操作。为免影响其他回收站项目，没有执行全局清空。该脚本已不安装、不注入，但临时回收站记录仍在。
- 导航过程中有一次管理器仪表盘快照意外返回了其他脚本的名称/描述元数据；没有打开其源码或更改任何已有脚本。此会话不作为符合完整隔离要求的正式验收，只保留为受限观察记录。
- 本次补充真实观察到连接会话中的 Tampermonkey 运行时、临时脚本安装/注入、`GM_getValue` 默认值及合成 DOM 的 broken/fixed 对照。Store 来源、指定 Data 路径的进程级绑定、完整支持矩阵、用户真实业务脚本、产品级自动修复与恢复仍未验证。Issue #486 保持 Open；TEST-017/018 与 GATE-004/005 未通过，Stable 未完成。
