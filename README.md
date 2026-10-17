# Userscript Auto Healer

> 状态：开发前工程准备阶段；**没有正式产品功能、没有已验证构建、没有 Stable 发布**。

## 项目用途
针对目标网站 DOM、Selector 和页面运行机制变化导致的 `.user.js` 油猴脚本失效，设计 Windows 本地优先、CDP 诊断、保守自动修复与可验证回滚的工具。用户可指定 Chrome/便携版路径、专用调试 Profile、默认 9223 端口，批量导入脚本，必要时启用自定义 AI 服务。

## 核心功能与支持环境
拟支持静态 AST、真实浏览器动态诊断、脚本管理器环境验证、多级修复、差异/备份/回滚、批处理、健康记录、共享兼容层及受控 AI。目标交付 Windows `.exe` 安装程序与真实 `.rar` 便携发行包；**开发、兼容性、打包及签名均未验证**。

## 准备成果与开发入口
见 [docs/00-intake.md](docs/00-intake.md)、[docs/11-readiness.md](docs/11-readiness.md)、[docs/12-handoff.md](docs/12-handoff.md)。需求权威来源为 `docs/00-intake.md` 与 `docs/02-requirements.md`；任务位于 `docs/09-development-plan.md`；架构与发布证据分别在 `docs/04-architecture.md`、`docs/08-release.md`。

## 运行与发布状态
尚无应用入口、安装程序、便携包或正式 Release。不得将本准备文件当作可执行软件。
