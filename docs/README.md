# 元AI 文档索引

本目录是项目全部文档的唯一入口。`docs-internal/` 与 `.codex/` 中的项目文档已于 2026-09-15
并入本目录，不再分散存放。

> **交付状态的唯一真源是 [master-plan.md](master-plan.md)。**
> 「某功能做完没有」「下一步做什么」一律以它为准，不以 README、CLAUDE.md 或会话记忆为准。

## 新人路线

| 顺序 | 文档                                 | 说明                                 |
| ---- | ------------------------------------ | ------------------------------------ |
| 1    | [开发运行指南](dev-guide.md)         | Mock / 全栈模式启动命令，先读这份    |
| 2    | [AI 大模型接入指南](ai-providers.md) | DeepSeek / OpenAI / Claude Key 配置  |
| 3    | [开发规范](dev-standards.md)         | ESLint / Prettier / Husky / 提交规范 |
| 4    | [测试规范](testing-standards.md)     | 单元 / 集成 / E2E 规范与用例         |

## 核心参考

| 文档                                      | 说明                               |
| ----------------------------------------- | ---------------------------------- |
| [交付状态总表](master-plan.md)            | **单一真源**：阶段状态与待办       |
| [架构设计](architecture.md)               | 系统架构、数据流、组件关系         |
| [API 设计](api-design.md)                 | 后端接口完整规范                   |
| [UI 规范](ui-spec.md)                     | 设计系统、颜色、组件规范           |
| [页面设计](page-design.md)                | OpenDesign 原型设计规范            |
| [媒体生成与音乐配置](media-generation.md) | 图片、视频、音乐任务与本机模型     |
| [部署指南](deployment.md)                 | 服务器选型、配置推荐、域名与 HTTPS |
| [发版与 CI/CD](release.md)                | release-it、Secrets 与 Actions     |
| [跨端排障记录](troubleshooting.md)        | 已解决问题与真机调试方法           |

## 分阶段实施文档

见 [phases/](phases/)。阶段状态不写在阶段文档里，统一看 [master-plan.md](master-plan.md)。

| 阶段                                                        | 主题                               |
| ----------------------------------------------------------- | ---------------------------------- |
| [Phase 0](phases/phase-0-scaffold.md)                       | Monorepo 脚手架                    |
| [Phase 1](phases/phase-1-backend.md)                        | FastAPI 后端核心                   |
| [Phase 2](phases/phase-2-web.md)                            | Next.js Web 端                     |
| [Phase 3](phases/phase-3-mobile.md)                         | Expo React Native 移动端           |
| [Phase 4](phases/phase-4-desktop.md)                        | Electron 桌面端                    |
| [Phase 5](phases/phase-5-agent-runtime.md)                  | Agent 运行时与任务状态机           |
| [Phase 6](phases/phase-6-tools-execution.md)                | 工具系统、MCP、沙箱与执行节点      |
| [Phase 7](phases/phase-7-memory-skills-automation.md)       | 记忆、知识库、Skills、自动化、人格 |
| [Phase 8](phases/phase-8-governance-admin-observability.md) | 治理、控制中心、运营后台、可观测性 |
| [Phase 9](phases/phase-9-life-work-connectors.md)           | 生活/学习/工作空间与连接器         |
| [Phase 10](phases/phase-10-autonomy-delegation-evals.md)    | 自主性、委派与评测                 |
| [Phase 11](phases/phase-11-personal-digital-twin.md)        | 个人数字孪生与助手形象             |
| [Phase 12](phases/phase-12-open-ecosystem.md)               | 开放生态与跨渠道机器人             |

## 开发者专项指南

| 文档                                           | 说明                     |
| ---------------------------------------------- | ------------------------ |
| [OAuth 配置](guides/oauth-setup.md)            | 三方登录 Client 配置步骤 |
| [移动端排障](guides/mobile-troubleshooting.md) | Expo / Android 真机问题  |
| [通知测试](guides/notifications-testing.md)    | 推送与本地通知验证方法   |

## 过程记录

- [plans/](superpowers/plans/) — 各功能的实施计划，按 `YYYY-MM-DD-<slug>.md` 命名。
  计划是**一次性执行脚本**，写完即用于执行，勾选框不回填；状态一律回写 master-plan。
- [progress/](progress/) — 阶段与功能的交付过程记录（Phase 5/6/7 检查点、任务进度）。

> 与本机环境相关的记录（运行时 PATH、依赖缺失、临时服务不可用）不入库，
> 保存在仓库根目录被 Git 忽略的 `.codex/`：`runtime-toolchain.md`、`environment-issues.md`。
> 历史 plan/progress 文件中出现的 `.codex/plans/`、`.codex/*-progress.md` 路径为当时的真实记录，
> 这些文件现已迁入 `docs/superpowers/plans/` 与 `docs/progress/`，历史表述保持原样不改写。

## 文档维护规则

1. 所有项目文档统一放 `docs/`，禁止新建 `docs-internal/` 之类的平行目录。
2. **功能上线后必须扫全仓所有文档**，不止 `docs/`：`README.md`、`CLAUDE.md`、`AGENTS.md`
   里的能力清单与「未做」表述都要同步，否则读 README 的人会得出「这个功能不存在」的结论。
3. `package.json` scripts、环境变量、`docker-compose` 服务、构建配置的任何变更，
   必须同步 [dev-guide.md](dev-guide.md)。
4. 阶段状态与新发现的待办**当次回写** [master-plan.md](master-plan.md)：
   别的会话不知道本会话发现了什么，漏登记等于永久丢失。
5. 本机环境问题记 `.codex/environment-issues.md`，不写进 `docs/`。
