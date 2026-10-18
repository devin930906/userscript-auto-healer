# ADR-003 — Windows EXE 与真 RAR 双发行

- 编号：ADR-003
- 背景：用户明确固定安装版 .exe 和真 .rar 便携包。
- 关联需求：REQ-027、REQ-028。
- 候选方案：NSIS+便携目录用授权 rar.exe 制作归档；portable EXE 再装进真 RAR；ZIP/7z 改名 RAR（排除）。
- 决策准则：格式真实性、无需开发环境直接运行、创建工具许可证、Windows runner 兼容、可复现。
- 最终决定：条件性设计为 NSIS EXE+独立便携目录经合法授权 rar.exe 制作的真正 RAR，两个产物来自同一提交，分别实测。
- 技术依据：https://www.electron.build/v26/docs/nsis/；https://www.win-rar.com/cmd-shell-mode.html?L=1；https://www.rarlab.com/license.htm
- 主要影响：WinRAR/RAR 试用后商业授权是明确成本与授权阻断，不能擅自捆绑试用工具；清洁 Windows 上真实解压启动与只读路径逻辑必须验证。
- 替代方案：合规可用的其他 RAR 创建器，经独立许可/构建验证后作为 ADR 变更；禁止用 ZIP 冒充。
- 状态：POC-03/许可证未完成。
