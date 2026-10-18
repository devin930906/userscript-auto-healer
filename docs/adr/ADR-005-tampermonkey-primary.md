# ADR-005 — Tampermonkey 是首选与 Stable 必测的油猴管理器

- 日期：2026-10-18。来源：I-011 用户确认使用 Tampermonkey（篡改猴），指出历史 GitHub Actions 的 Violentmonkey 测试不是目标扩展。
- 决策：**Tampermonkey 为首要兼容和 Stable 必须验收的管理器**。其他管理器可在独立实测后附加支持，不得替代 Tampermonkey。未实测不指定最低 Chrome/Windows/Tampermonkey 兼容版本。
- 关联：REQ-017/018、TEST-017/018、TASK-007/010/018、RISK-003、GATE-004/005。TASK-001 有条件准入和 EXE+ZIP 交付不受影响。
- 已有证据：POC-02D/04A 只验证 **Violentmonkey MV3 2.49.0 + 隔离 Chromium**，并非 Tampermonkey，且不是产品自动修复/回滚。不得转记成 Tampermonkey 的 TEST/GATE 通过。
- 开发前专项 PoC：**POC-02T（尚未执行、未通过）**。经 Tampermonkey 官方渠道取得合法真实 MV3 扩展，核实发行来源、扩展 ID/版本、SHA-256、Actions run；对托管 Chromium 与正式 Chrome 分别核验是否可合法、安全安装（不假设可侧载）。使用隔离 Profile，禁止动用或复制用户原 Profile/账号/脚本、绕过授权或再分发扩展包。
- 受限 PoC 的通过条件：用户级 Chrome 138+ Allow User Scripts 获得真实授权；真实 Tampermonkey 安装/启用测试 .user.js；记录 @match/@grant/@run-at、Content Script/UserScripts API/UserScripts API Dynamic 具体使用模式；实际调用 GM_getValue 并验证返回值；使用独立 broken/fixed 合成夹具验证业务断言。Chrome 152+ 不能再假设点击 .user.js URL 会自动安装，依据官方当前安装流程验证。必须记录 browser/manager/version/mode/run/SHA；任何缺项即 BLOCKED/UNKNOWN。
- 正式产品验收：后续 TASK-007/TEST-017/018 检验真实应用适配器、真实管理器下的 GM API 与业务结果、安装到浏览器的脚本更新；GATE-004/005 必须对声明的 Windows/Chrome/便携版支持矩阵取得真实证据。不能用纯 CDP/DOM、Violentmonkey 或人工预先修改好的脚本证明产品自动修复。
- 官方依据：https://www.tampermonkey.net/faq.php?q=Q406；https://www.tampermonkey.net/faq.php?q=Q209；https://www.tampermonkey.net/documentation.php?q=content_script_api；https://www.tampermonkey.net/changelog.php?locale=en；https://developer.chrome.com/docs/extensions/reference/api/userScripts；https://playwright.dev/docs/chrome-extensions。
- 状态：**用户选择已确认；Tampermonkey 真实云端 PoC、产品兼容与 Stable 验收均未通过。**

## 2026-10-18 后续真实浏览器限定实测
`POC-02T-LIVE` 已在用户连接的 Chrome 中使用**真实 Tampermonkey 5.5.1** 创建、执行、人工改动和删除单独命名的临时测试脚本。真实 `GM_getValue`、预设 broken/fixed 业务动作均得到页面断言，停止注入也已验证。脱敏证据 docs/evidence/2026-10-18-tampermonkey-live-browser-qa.md。此结果不等于本 ADR 早先所称需要在**隔离 GitHub Actions** 中实施的 POC-02T 已通过，亦不等于产品正式 TEST-017/018、受支持全部注入模式或 Stable 发布验证。状态更新：**真实用户浏览器上的限定 GM/业务 PoC 已通过；独立云端和完整正式产品验收仍待完成**。
