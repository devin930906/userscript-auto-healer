# ADR-002 — CDP 观测与真实油猴验收分层

- 编号：ADR-002
- 背景：CDP 原生 JS/DOM 仅能证明网页观测，不证明 Tampermonkey 等管理器中的 @grant/GM API、注入时机和业务功能。
- 关联需求：REQ-009..013、REQ-017、REQ-018、REQ-023。
- 候选方案：仅 CDP/DOM；仅 AST；CDP+静态诊断+真实管理器运行+业务断言。
- 决策准则：误报风险、真实兼容性、用户权限、可重复验收。
- 最终决定：检测结果与功能验证分层；只有实际安装且运行于受支持管理器、通过场景断言时才标记 VERIFIED；其余 DETECTED_ONLY/UNKNOWN/FAILED。
- 技术依据：https://www.tampermonkey.net/documentation.php；https://playwright.dev/docs/chrome-extensions；https://chromedevtools.github.io/devtools-protocol/；https://developer.chrome.com/docs/extensions/reference/api/userScripts
- 主要影响：Profile 初始化、脚本安装状态/GM API/登录前置条件必须成为显式门控；无法自动加载时可提供用户授权流程而非假装自动成功。
- 替代方案：仅交付静态与部分 CDP 诊断并保留不确定，禁止完整自动成功标记。
- 状态：**分层验收原则已确认，真实用户脚本执行路线在限定测试环境下有正向证据。** 2026-10-18 在 Windows 托管 Chromium 的隔离临时 Profile 里，通过官方发布的 Violentmonkey MV3 2.49.0 完成权限授权、真实 .user.js 安装、标准 HTTPS 示例页 `https://example.com/` 注入，并实际调用 `GM_getValue("__poc_fixture_unset__", "poc-default")`，返回值符合预期。证据：https://github.com/devin930906/userscript-auto-healer/actions/runs/39092523277。此前随机端口 localhost 的失败与直接 Chrome userScripts 成功对照为兼容性负例（https://github.com/devin930906/userscript-auto-healer/actions/runs/39092114413），不再代表所有 POC-02B 测试失败。
- 边界：此实证**不验证真实损坏脚本修复/业务断言**，亦不覆盖 Tampermonkey、用户选定实际 Chrome 或网站登录状态。ManagerReadiness 必须按管理器安装/权限、@match、站点授权、loader 注册、实际注入、GM API 调用、业务断言逐层记录；真实修复成功状态仅由最终真实功能回归决定。

## I-011 补充决定
用户明确首选 Tampermonkey（非 Violentmonkey），独立决策见 ADR-005。分层验收原则不变，声称“Tampermonkey 已验证”必须来自实际 Tampermonkey/GM API/业务断言证据；原 POC-02D/04A 仅是 Violentmonkey 的历史可行性记录。
