# ADR-003 — Windows EXE 与真 RAR 双发行

- 编号：ADR-003
- 背景：用户明确固定安装版 .exe 和真 .rar 便携包。
- 关联需求：REQ-027、REQ-028。
- 候选方案：Inno Setup 6 安装版 + 便携目录用获授权 rar.exe 打包（NSIS 仍是备选）；portable EXE 再装进真 RAR；ZIP/7z 改名 RAR（排除）。
- 决策准则：格式真实性、无需开发环境直接运行、创建工具许可证、Windows runner 兼容、可复现。
- 最终决定：依据实际 Windows runner PoC，优先考虑 Inno Setup EXE + 获正式合法使用许可的 rar.exe 打包便携目录。只验证过临时安装器及 RAR5 测试归档，不代表已经验证产品双包；产物必须同提交且分别通过真实环境测试。
- 技术依据：https://www.electron.build/v26/docs/nsis/；https://www.win-rar.com/cmd-shell-mode.html?L=1；https://www.rarlab.com/license.htm
- 主要影响：WinRAR/RAR 试用后商业授权是明确成本与授权阻断，不能擅自捆绑试用工具；清洁 Windows 上真实解压启动与只读路径逻辑必须验证。
- 替代方案：合规可用的其他 RAR 创建器，经独立许可/构建验证后作为 ADR 变更；禁止用 ZIP 冒充。
- 状态：POC-03A 临时 EXE 编译/安装/卸载通过（https://github.com/devin930906/userscript-auto-healer/actions/runs/39089013574）；POC-03B 试用真 RAR5 创建/解压/校验通过（https://github.com/devin930906/userscript-auto-healer/actions/runs/39089224242）。RAR 正式生产授权、产品实际打包、签名和 Windows 直启测试仍未完成。


## 后续决策（2026-10-18）
**本 ADR 的 RAR 发行决定已被 ADR-004 取代。** 本文件保留当时的候选方案、许可证分析和 POC-03B 历史结果以便追溯；现行正式发行采用 EXE 安装版 + ZIP 便携版，不再要求 RAR 创建器或 RAR 生产许可证，所有现行 REQ-028、TEST-028、TASK-020、GATE-009/011 以 ADR-004 为准。
