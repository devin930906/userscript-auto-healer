# ADR-001 — Windows 桌面应用实现基线（有条件选定）

- 编号：ADR-001
- 背景：Windows GUI、本地用户授权 Chrome/CDP、JavaScript AST、Windows 安装 EXE 与真实便携 ZIP；不得在主应用进程执行不可信油猴脚本。
- 关联需求：REQ-001..028，重点 REQ-006..011、REQ-017/018、REQ-026..028。
- 候选比较：A Electron+TypeScript/Node（同语言 DOM/AST/CDP、开发维护边界明确，需严控渲染隔离和打包体积）；B .NET Windows UI+JS 解析器（原生集成好，但多运行时契约复杂）；C Python UI+JS 解析器（打包及异构依赖复杂）。安全能力取决于显式隔离与测试，不会仅因选择 A 自动成立。
- **有条件工程决策**：将 A 作为 `TASK-001` 的首期最小安全骨架技术基线；这不是用户已单独签字同意的最终 GUI 风格，也不是已经发布的软件。若真实实现无法通过安全/兼容测试，单独用新 ADR 复审。
- 不可降级的安全要求：Electron renderer `sandbox=true`、`contextIsolation=true`、`nodeIntegration=false`；preload 只开放白名单类型化 IPC；操作前校验路径与用户授权；Chrome/CDP 自管独立进程+非默认 Profile、127.0.0.1；不可接管非自身管理进程；油猴代码仅在真实隔离浏览器/管理器运行；AI 默认关闭、自动覆盖默认关闭、变更必须备份/回滚。全部须在正式代码中实际测试。
- 已有技术证据：Windows Chrome/CDP 系统和独立目录路径分别通过（https://github.com/devin930906/userscript-auto-healer/actions/runs/39082627685；https://github.com/devin930906/userscript-auto-healer/actions/runs/39088772310）；Windows Chromium + Violentmonkey 2.49.0 实际 `GM_getValue` 调用通过（https://github.com/devin930906/userscript-auto-healer/actions/runs/39092523277）；合成 broken/fixed 选择器结果分别符合预期（https://github.com/devin930906/userscript-auto-healer/actions/runs/39093275851）。
- 尚未验证：目标 Tampermonkey、用户真实 Windows10/11 Chrome 和便携版、实际损坏脚本自动诊断/修复/回滚、Electron 正式构建与安全机制、正式双包运行。实验室 PoC 不替代这些任务验收。
- 打包约束：Inno Setup EXE 为已验证工具链候选；RAR5 试用技术评估属于历史 PoC；现行 ZIP 发行由 ADR-004 定义，ZIP 格式和真实启动仍待验证；二者不能被宣称为已生成的产品安装包。
- 执行入口：对 `TASK-001` 仅允许安全骨架和对应测试，后续 ManagerAdapter/修复/真实业务验收及 Stable 必须按 REQ/TEST/GATE 实证推进。范围与准入解释见 `docs/13-predevelopment-admission.md`。
- 决策状态：**有条件选定用于首期安全工程实现**；不表示最终 UI 风格已经用户确认或正式发布准入完成。
