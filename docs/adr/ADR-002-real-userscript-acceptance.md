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
- 状态：原则已确认；POC-02A 在隔离 Windows Chromium 中加载 Violentmonkey MV3 并进入真实脚本安装确认流程（https://github.com/devin930906/userscript-auto-healer/actions/runs/39089315021），但 POC-02B 没有 GM API/脚本注入行为证据。Chrome 138+ 扩展详情的「Allow User Scripts」由用户主动授权，不能以扩展 Worker 或 DOM 可见性代替授权与功能验收。
