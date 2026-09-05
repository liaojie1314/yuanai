# 元AI (yuanai) — 项目总文档

## 项目概述

yuanai 是一个多端 AI 聊天应用，功能对标 ChatGPT，支持 Android、iOS、平板、Windows、macOS、Linux、Web 端，微信小程序为二期计划。

**本文件是所有开发会话的入口，执行任何任务前必须先读本文件。**

## 快速导航

| 文档                                                | 说明                                  |
| --------------------------------------------------- | ------------------------------------- |
| [**开发运行指南**](docs/dev-guide.md)               | **⬅ 新人先读** Mock/真实模式启动命令  |
| [**AI 大模型接入指南**](docs/ai-providers.md)       | DeepSeek/OpenAI/Claude API Key 配置   |
| [架构设计](docs/architecture.md)                    | 系统架构、数据流、组件关系            |
| [API 设计](docs/api-design.md)                      | 后端接口完整规范                      |
| [UI 规范](docs/ui-spec.md)                          | 设计系统、颜色、组件规范              |
| [页面设计](docs/page-design.md)                     | OpenDesign 原型设计规范               |
| [开发规范](docs/dev-standards.md)                   | ESLint/Prettier/Husky/Git/提交规范    |
| [测试规范](docs/testing-standards.md)               | **必读** 单元/集成/E2E 测试规范与用例 |
| [跨端排障记录](docs/troubleshooting.md)             | 已解决问题、环境限制与真机调试方法    |
| [Phase 0 — 脚手架](docs/phases/phase-0-scaffold.md) | Monorepo 初始化（**先执行此项**）     |
| [Phase 1 — 后端](docs/phases/phase-1-backend.md)    | FastAPI 后端核心开发                  |
| [Phase 2 — Web 端](docs/phases/phase-2-web.md)      | Next.js Web 端完整实现                |
| [Phase 3 — 移动端](docs/phases/phase-3-mobile.md)   | Expo React Native 移动端              |
| [Phase 4 — 桌面端](docs/phases/phase-4-desktop.md)  | Electron 桌面端                       |

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

## 当前交付状态（2026-09-05）

Phase 4 Electron 桌面端已合入 `dev`：包含多窗口认证与聊天、真实后端 API、
安全会话存储、Artifact、设置、托盘、快捷键和原生通知。Ubuntu 开发环境已完成
功能与生产预览验证；Windows/macOS 安装包、签名、自动更新源和目标平台安装验收
仍在发布前清单中。运行与验证方式见 [桌面端说明](apps/desktop/README.md)。

本地自动化门禁已重新通过：根级运行时、类型、单元、集成、lint、格式、脚本和构建检查，后端串行
pytest、mypy 与 Ruff，以及 Chromium Web E2E 33/33 和 Tool Control Center E2E 3/3。后两项使用
受控路由 mock，只能证明 UI 回归。Phase 5/6 收尾验收仍未全部放行：当前分支的真实 Linux Desktop
E2E 为 `1 passed (2m42s)`，覆盖配对、WSS challenge、本地审批、签名回调、ACK 和正常收尾，但不覆盖
取消、重连/重放或节点撤销。YuanAI 认证 API 到真实公共 Streamable HTTP MCP 的连接、发现、显式启用、审批
与文档只读调用已有后端证据，但不构成 Web 控制中心 UI 验收。部署 Worker 崩溃恢复、五分钟真实断线恢复、
完整认证 Web 控制中心链路、系统性 Browser Worker 安全测试及故障注入稳定性仍未验收。Phase 7 尚未开始，其前置
条件仍未满足。

## 开发铁律

- 执行任何 Phase 前，**完整阅读**对应 phase 文档 + `dev-standards.md` + `testing-standards.md`
- 不得修改 `docs/` 目录内容（文档由规划会话维护，实现会话只读）
- **测试通过是进入下一功能的唯一许可证**：写完功能必须先跑测试，全部通过才能继续
- **后端接口必须通过集成测试才能进行前后端联调**
- 提交前必须通过 `pnpm lint && pnpm typecheck && pnpm test:unit`（Husky pre-push 自动强制）
- Commit message 必须符合 Conventional Commits 格式（commitlint 强制校验）
- API 接口新增/变更必须同步更新 `packages/types` 中的类型定义
- 禁止在 `packages/` 中引入任何平台专用 API（`react-native`, `electron`, `next/navigation` 等）
- 所有 AI 调用必须经过 `backend/app/services/ai_service.py`，禁止前端直接调用 AI API
- 禁止 `--no-verify` 跳过 Husky hook（紧急情况需在 PR 中说明原因）
