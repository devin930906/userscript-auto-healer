# 2026-11-17 — 用户授权的 ChatGPT Prompt Flow 1.0.51 实时业务样本

> 证据级别：用户授权的 Chrome Browser MCP 当前 Profile 中，对用户指定本地脚本进行的一次真实 ChatGPT 临时会话操作。只证明该单一用户脚本功能样本；不等于 Userscript Auto Healer 的 TEST-017/018、GATE-004/005 或 Stable 验收通过。

## 来源与浏览器环境

- 用户指定的本地 Prompt Flow 脚本版本为 `1.0.51`。本机记录的原文件哈希在测试前后相同，原件没有修改；为保护本机信息，公开记录不包含本地完整路径或哈希值。
- Chrome Browser MCP 连接到用户授权的当前 Profile。已观察 Tampermonkey 扩展 ID `dhdgffkkebhmkfjojejmpbldmpobfkfo`、版本 `5.5.1`、MV3。用户先前指定的 Codex Chrome 数据目录仍未与此 MCP Profile 建立进程级绑定；不据此声称使用了该路径，Chrome Web Store 来源也未独立核验。
- 为避免与 Profile 中原有 `ChatGPT Prompt Flow` v1.0.53 同名冲突，临时副本仅改了元数据 `@name` 为 `ChatGPT Prompt Flow QA 1.0.51 20261116`，脚本代码保持与用户指定源文件一致；公开记录不包含本机临时副本的哈希值。
- 测试前已安装的同名脚本在测试期间暂时停用；安装页出现两份重复请求后，先删除多余副本并核实只剩一份 QA 副本，再继续测试。测试结束后，临时脚本从启用列表移除，原脚本恢复到测试前状态并再次核实。

## 测试步骤与结果

- 在单独的 `?temporary-chat=true` ChatGPT 页面确认输入框为空，且页面出现 Prompt Flow 悬浮按钮与面板；另一个带有未发送草稿的页面没有被覆盖或发送。
- 创建一条本地 TXT 测试提示：`请只回复以下文字，不要加任何其他内容：UAH QA PASS 1.0.51`。Chrome Browser MCP 的文件上传接口拒绝工作区路径（该路径不在该接口允许的文件根目录内），因此未打开系统原生文件选择器；改用页面中的 `File` + `DataTransfer` 对象触发 Prompt Flow 文件输入事件，实际经过脚本文件读取、导入与队列处理流程。
- 面板初始显示 0 条；导入后显示 `已导入 1 个 Prompt`、准确的测试文件名和可用的“运行”按钮。确认 ChatGPT 输入框仍为空后，仅运行一次。
- ChatGPT 创建临时对话并收到该条提示。回复节点中的文本与要求的短句 `UAH QA PASS 1.0.51` 完全一致；Prompt Flow 面板状态变为 `全部完成`，`running=false`。

## 清理与限制

- 完成后原 v1.0.53 为启用状态，唯一临时 QA 名称在已安装列表中为 0 条；临时 `.user.js` 副本和 TXT 文件均已从本地工作区删除，测试临时对话页已关闭。原脚本 SHA-256 仍与开始时一致。
- Tampermonkey 可能将已删除的临时 QA 脚本保留在回收站；没有执行“删除全部”，避免影响其他回收站内容。该脚本不在启用列表中，也没有注入。
- 本次未测试系统原生文件选择器、用户脚本 `GM` 读写往返、不同 `@run-at`/权限矩阵、坏脚本与修复候选对照、Userscript Auto Healer 的自动诊断/修复、备份、原脚本修改或回滚。
- 因此此项只是对用户指定外部脚本的真实业务动作样本；#486 仍 Open，TEST-017/018 与 GATE-004/005 未通过，Stable 仍未完成。


## 2026-11-17 — UAH 静态导入预检

- 在 Windows 本地 `main@ad34e61` 工作区中，对用户指定的 `ChatGPT-Prompt-Flow.user.js` 字节调用 UAH 的只读导入解析器和隔离 Worker AST 预览。导入解析接受该文件：351,133 字节、UTF-8 BOM；元数据状态为 `OK`。
- Worker 预览结果为 `STATIC_ANALYSIS_ONLY`，记录 40 个选择器调用点（32 个字面值、8 个需运行时确认）。`tampermonkeyVerified`、`businessVerified` 和 `automaticPatchAllowed` 均为 `false`。
- 预检只读取并解析源码，没有执行脚本、访问浏览器或更改源文件。它没有使用 UAH 窗口的原生文件选择器；用户提供的窗口截图显示当时尚未选择文件，因此桌面界面导入仍待用户操作。此结果不证明管理器身份、注入、GM、业务修复或回滚，也不完成 TEST-017/018 或 GATE-004/005。
- 本地完整路径及源文件哈希不写入此公开记录。
