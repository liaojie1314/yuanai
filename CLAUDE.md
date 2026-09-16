# 元AI (yuanai) — 项目总文档

## 项目概述

yuanai 是一个多端 AI 聊天应用，功能对标 ChatGPT，支持 Android、iOS、平板、Windows、macOS、Linux、Web 端，微信小程序为二期计划。

**本文件是所有开发会话的入口，执行任何任务前必须先读本文件。**

## 快速导航

| 文档                                                                            | 说明                                  |
| ------------------------------------------------------------------------------- | ------------------------------------- |
| [**文档索引**](docs/README.md)                                                  | **⬅ 文档总入口**，全部文档从这里找    |
| [**交付状态总表**](docs/master-plan.md)                                         | **单一真源**：做到哪了、还差什么      |
| [**开发运行指南**](docs/dev-guide.md)                                           | **⬅ 新人先读** Mock/真实模式启动命令  |
| [**AI 大模型接入指南**](docs/ai-providers.md)                                   | DeepSeek/OpenAI/Claude API Key 配置   |
| [架构设计](docs/architecture.md)                                                | 系统架构、数据流、组件关系            |
| [API 设计](docs/api-design.md)                                                  | 后端接口完整规范                      |
| [UI 规范](docs/ui-spec.md)                                                      | 设计系统、颜色、组件规范              |
| [页面设计](docs/page-design.md)                                                 | OpenDesign 原型设计规范               |
| [开发规范](docs/dev-standards.md)                                               | ESLint/Prettier/Husky/Git/提交规范    |
| [测试规范](docs/testing-standards.md)                                           | **必读** 单元/集成/E2E 测试规范与用例 |
| [部署指南](docs/deployment.md)                                                  | 服务器选型、配置推荐、域名与 HTTPS    |
| [跨端排障记录](docs/troubleshooting.md)                                         | 已解决问题、环境限制与真机调试方法    |
| [Phase 0 — 脚手架](docs/phases/phase-0-scaffold.md)                             | Monorepo 初始化（**先执行此项**）     |
| [Phase 1 — 后端](docs/phases/phase-1-backend.md)                                | FastAPI 后端核心开发                  |
| [Phase 2 — Web 端](docs/phases/phase-2-web.md)                                  | Next.js Web 端完整实现                |
| [Phase 3 — 移动端](docs/phases/phase-3-mobile.md)                               | Expo React Native 移动端              |
| [Phase 4 — 桌面端](docs/phases/phase-4-desktop.md)                              | Electron 桌面端                       |
| [Phase 5 — Agent 运行时](docs/phases/phase-5-agent-runtime.md)                  | Agent 运行时与任务状态机              |
| [Phase 6 — 工具与执行](docs/phases/phase-6-tools-execution.md)                  | 工具系统、MCP、沙箱、执行节点         |
| [Phase 7 — 记忆与自动化](docs/phases/phase-7-memory-skills-automation.md)       | 记忆、知识库、Skills、自动化、人格    |
| [Phase 8 — 治理与可观测](docs/phases/phase-8-governance-admin-observability.md) | 治理、运营后台、可观测性              |
| [Phase 9 — 空间与连接器](docs/phases/phase-9-life-work-connectors.md)           | 生活/学习/工作空间与连接器            |
| [Phase 10 — 自主与评测](docs/phases/phase-10-autonomy-delegation-evals.md)      | 自主性、委派与评测                    |
| [Phase 11 — 数字孪生](docs/phases/phase-11-personal-digital-twin.md)            | 个人数字孪生与助手形象                |
| [Phase 12 — 开放生态](docs/phases/phase-12-open-ecosystem.md)                   | 开放生态与跨渠道机器人                |

## 技术栈

### 前端

| 层               | 技术                     | 版本                 |
| ---------------- | ------------------------ | -------------------- |
| Monorepo         | Turborepo + pnpm         | turbo 2.x / pnpm 9.x |
| Web              | Next.js App Router       | 15.x                 |
| Mobile           | React Native + Expo      | SDK 52+              |
| Desktop          | Electron                 | 33+                  |
| UI (Web/Desktop) | shadcn/ui + Tailwind CSS | tailwind v4          |
| UI (Mobile)      | NativeWind + 自定义      | v4                   |
| 状态管理         | Zustand                  | 5.x                  |
| 数据请求         | TanStack Query           | v5                   |
| 语言             | TypeScript strict        | 5.x                  |

### 后端

| 层       | 技术                       | 版本   |
| -------- | -------------------------- | ------ |
| 框架     | FastAPI                    | 0.115+ |
| 语言     | Python                     | 3.12+  |
| ORM      | SQLAlchemy async           | 2.0+   |
| 数据库   | PostgreSQL                 | 16     |
| 缓存     | Redis                      | 7      |
| 迁移     | Alembic                    | latest |
| 认证     | JWT (python-jose) + bcrypt | —      |
| 文件存储 | S3 兼容 (boto3)            | —      |
| AI 接入  | openai Python SDK          | 1.x    |
| 规范     | Ruff + mypy                | —      |

## 目录结构

```
yuanai/
├── CLAUDE.md                    ← 入口文档（本文件）
├── docs/
│   ├── architecture.md
│   ├── api-design.md
│   ├── ui-spec.md
│   ├── dev-standards.md
│   └── phases/
│       ├── phase-0-scaffold.md
│       ├── phase-1-backend.md
│       ├── phase-2-web.md
│       ├── phase-3-mobile.md
│       └── phase-4-desktop.md
├── apps/
│   ├── web/                     ← Next.js 15
│   ├── mobile/                  ← Expo (React Native)
│   └── desktop/                 ← Electron
├── packages/
│   ├── ui/                      ← @yuanai/ui 共享组件库
│   ├── core/                    ← @yuanai/core API Client / Hooks / Store
│   └── types/                   ← @yuanai/types 前后端共享 TS 类型
└── backend/                     ← FastAPI Python 后端
    ├── app/
    │   ├── api/
    │   ├── models/
    │   ├── services/
    │   └── core/
    ├── alembic/
    ├── tests/
    └── pyproject.toml
```

## 核心原则

1. **类型安全**: 前端 TS strict mode，后端 Pydantic v2 + mypy，禁止 `any` / `object`
2. **单一数据源**: 后端是唯一真相源，前端通过 TanStack Query 管理缓存
3. **流式优先**: AI 响应统一使用 SSE (Server-Sent Events)，前端统一封装 streaming hook
4. **平台隔离**: 共享业务逻辑放 `packages/core`，平台专用 UI 各自在 `apps/` 实现，`packages/` 禁止引入平台 API
5. **主题系统**: CSS 变量驱动双主题，颜色 token 定义在 `packages/ui`

## v1 功能范围

- [x] 用户账户系统（注册 / 登录 / JWT / 多设备同步）
- [x] 会话管理（创建 / 重命名 / 删除 / 历史列表）
- [x] 多模型切换（OpenAI / Claude / DeepSeek 等）
- [x] 流式对话（SSE streaming）
- [x] Markdown 渲染 + 代码语法高亮 + 一键复制
- [x] 文件 / 图片上传（多模态）
- [x] 明暗主题切换
- [x] 全平台 UI 适配（Web / Mobile / Desktop / Tablet）

## 当前交付状态

**交付状态的唯一真源是 [交付状态总表](docs/master-plan.md)**，本节只给一句话概览，
详细的阶段状态、未关闭验收项、真实运行证据和技术债一律以该文件为准，不在此处重复维护。

截至 2026-09-16：Phase 0-3 已交付；Phase 4 桌面端、Phase 5 Agent 运行时、Phase 6 工具与执行
均已合入 `dev` 且远程 CI 全绿，但各自仍有未关闭的验收项（安装包签名、生产部署验收、系统性安全
测试、Browser Worker 安全灰度）；**Phase 7 记忆/知识库/Skills/自动化的代码与自动化测试已落地**；
Phase 8-12 仅有阶段文档，尚未开工。

以上均为本地真实运行时证据，**不构成生产部署放行**。

## 开发铁律

- 执行任何 Phase 前，**完整阅读**对应 phase 文档 + `dev-standards.md` + `testing-standards.md`
- `docs/phases/*.md` 的阶段设计由规划会话维护，实现会话**不得擅自改写阶段设计**；
  但**交付状态必须当次回写** [`docs/master-plan.md`](docs/master-plan.md) —— 别的会话不知道本
  会话发现了什么，漏登记等于永久丢失
- **功能上线后必须扫全仓文档**，不止 `docs/`：`README.md`、`CLAUDE.md`、`AGENTS.md` 里的能力
  清单与「未做」表述都要同步，否则读 README 的人会得出「这个功能不存在」的结论（已发生过：
  Phase 7 早已实现，三份文档仍写着「尚未开始」）
- 本机环境问题（PATH、依赖缺失、临时服务不可用）记 `.codex/environment-issues.md`，**不写进 `docs/`**
- **测试通过是进入下一功能的唯一许可证**：写完功能必须先跑测试，全部通过才能继续
- **后端接口必须通过集成测试才能进行前后端联调**
- 提交前必须通过 `pnpm lint && pnpm typecheck && pnpm test:unit`。
  注意 Husky `pre-push` **只强制 `typecheck` + `test:unit`**，`lint`、`format:check`
  与后端 Ruff/mypy/pytest 没有本地门禁，必须自己跑，否则只能等 CI 报红
- Commit message 必须符合 Conventional Commits 格式（commitlint 强制校验）
- API 接口新增/变更必须同步更新 `packages/types` 中的类型定义
- 禁止在 `packages/` 中引入任何平台专用 API（`react-native`, `electron`, `next/navigation` 等）
- 所有 AI 调用必须经过 `backend/app/services/ai_service.py`，禁止前端直接调用 AI API
- 禁止 `--no-verify` 跳过 Husky hook（紧急情况需在 PR 中说明原因）
