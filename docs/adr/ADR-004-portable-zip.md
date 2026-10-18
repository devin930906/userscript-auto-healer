# ADR-004 — 将 Windows 便携发行格式由 RAR 改为 ZIP

- 编号：ADR-004
- 背景：用户于 2026-10-18 明确要求 userscript-auto-healer 正式便携发行改用 ZIP，避免原 RAR 创建器在持续 GitHub Actions 构建中的生产授权依赖。保留 EXE 安装版与便携版双交付。
- 关联来源及需求：I-010；REQ-028、NFR-011、TEST-028、TASK-020、GATE-009、GATE-011；REQ-027 安装 EXE 不变。
- 候选方案：A GitHub Windows runner 中使用 PowerShell `Compress-Archive` 创建真实 ZIP；B 使用已核验许可和供应链的其他 ZIP 创建器；原 RAR 方案见历史 ADR-003。
- 决策准则：无需独立购买 RAR 创建许可证、Windows 原生解压、云端可重复构建、完整运行依赖、文件完整性及安全路径处理。
- 最终决定：选择 A 作为计划的默认方案。目标产物为 `Userscript-Auto-Healer-vX.Y.Z-Setup.exe` 与 `Userscript-Auto-Healer-vX.Y.Z-Portable.zip`，必须来自同一发布源提交；只允许在完整便携应用产物经必要测试后发布。ZIP 压缩工具免费不代表 CI 使用、第三方依赖、软件签名或其他运行资源一律免费。
- 技术边界：真实 ZIP 文件头/内容清单、无绝对路径和路径穿越、文件哈希一致、解压至干净 Windows 的非开发目录后正常启动、配置持久化和只读目录安全行为。禁止将外层 GitHub Actions 工件压缩包、空示例归档或重命名的其他格式冒充正式便携 ZIP。
- 影响：删除正式 RAR 创建器及生产许可证发行阻断；将 RISK-004 转为 ZIP 安全/完整性风险；保持 REQ/TEST/TASK/GATE 编号不变，更新范围、追踪和交接。旧 RAR5 评估记录是历史 PoC，不能作为 ZIP 验证或正式发行证据。
- 验证：计划使用 Windows runner 建立单独的 ZIP 工具链 smoke test（POC-03C）；正式 ZIP 的全量自动化与真实环境测试在 TASK-020/TEST-028 执行。现阶段无可发行的 ZIP 或 EXE 产品。
- 状态：用户已批准格式变更；技术方案已规划，产品 ZIP 构建及正式验收 **未完成**。替代 ADR-003 的发行格式决定。
