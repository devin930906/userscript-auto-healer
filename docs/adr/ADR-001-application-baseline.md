# ADR-001 — Windows 应用技术基线

- 编号：ADR-001
- 背景：本地 Chrome/CDP、JS AST、Windows GUI、EXE+RAR 双包；UI 具体形态尚未由用户单独批准。
- 关联需求：REQ-001..028，重点 REQ-006..011、REQ-027、REQ-028。
- 候选方案：Electron/TypeScript；.NET 原生 UI 加 JS AST 服务；Python 桌面工具加 JS AST 服务。
- 决策准则：需求满足程度、兼容性、复杂度、安全性、维护性、云端构建支持、许可成本、主要风险。
- 最终决定：Electron+TypeScript/Node 暂作为待验证技术基线；须 POC-01/02 确认 Chrome 和管理器环境后定案，不可视作已经批准的最终架构。
- 技术依据：https://www.electron.build/v26/docs/nsis/；https://developer.chrome.com/blog/remote-debugging-port
- 主要影响：JS/TS 统一静态分析与 CDP 利于维护，但 Electron 进程安全、扩展自动化和双包体积仍需实证。
- 替代方案：POC 失败则评估 Windows 原生 UI + 独立 Node 解析服务，不因框架偏好牺牲真实油猴验收。
- 状态：待确认。
