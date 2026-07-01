# 元AI

多端 AI 聊天应用，功能对标 ChatGPT。支持 Web、Android、iOS、Windows、macOS、Linux，接入 DeepSeek / GPT-4o / Claude 等多种大模型。

## 技术栈

| 层          | 技术                                             |
| ----------- | ------------------------------------------------ |
| Web         | Next.js 15 + shadcn/ui + Tailwind v4             |
| Mobile      | Expo (React Native) + NativeWind                 |
| Desktop     | Electron 33                                      |
| 状态 / 请求 | Zustand 5 + TanStack Query v5                    |
| 后端        | FastAPI 0.115 + SQLAlchemy 2 (async)             |
| 数据库      | PostgreSQL 16 + Redis 7                          |
| AI 接入     | OpenAI 兼容接口（DeepSeek / OpenAI / Anthropic） |
| Monorepo    | Turborepo + pnpm                                 |

## 快速开始

### 方式一：首次克隆后初始化（推荐）

```bash
pnpm setup
```

自动完成：检查工具版本 → 安装全部依赖 → 复制 `.env` 模板 → 可选初始化数据库。  
兼容 macOS / Linux / Windows。

### 方式二：Mock 模式（无需后端，推荐日常 UI 开发）

```bash
pnpm dev:mock
```

打开 [http://localhost:3000](http://localhost:3000)，使用 `demo@yuanai.dev` / `Demo1234!` 登录。  
所有 API 请求由浏览器端 MSW 拦截，无需启动任何后端服务。

### 方式三：全栈模式（真实 AI 接口）

**前提**：已安装 Docker 和 [uv](https://github.com/astral-sh/uv)，并在 `backend/.env` 中填写了至少一个 AI API Key。

```bash
pnpm dev:real
```

自动完成：启动 Docker 基础设施 → 等待 PostgreSQL → 数据库迁移 → 启动后端 → 启动前端。  
首次运行若 `backend/.env` 不存在，会暂停并提示填写 API Key。  
兼容 macOS / Linux / Windows（使用 Node.js 脚本，无需 bash）。

> **推荐 AI 提供商**：[DeepSeek](https://platform.deepseek.com/api_keys)（有免费额度，注册即用）  
> 详见 [AI 大模型接入指南](docs/ai-providers.md)

### 方式四：分步手动启动

详见 [开发运行指南](docs/dev-guide.md)。

## 配置 AI 大模型

编辑 `backend/.env`，填写需要使用的模型的 API Key（留空的模型不会出现在前端）：

```bash
DEEPSEEK_API_KEY=sk-xxxxxxxx    # DeepSeek V3
OPENAI_API_KEY=sk-proj-xxxxxxx  # GPT-4o（可选）
ANTHROPIC_API_KEY=sk-ant-xxxxx  # Claude 3.5 Sonnet（可选）
```

详细说明、各平台注册步骤、新增模型方法见 [AI 大模型接入指南](docs/ai-providers.md)。

## 常用命令

| 命令             | 说明                               |
| ---------------- | ---------------------------------- |
| `pnpm setup`     | 首次初始化（安装依赖 + 复制 .env） |
| `pnpm dev:mock`  | 纯前端 Mock 模式（无需后端）       |
| `pnpm dev:real`  | 一键全栈启动（真实 AI 接口）       |
| `pnpm build`     | 构建全部应用                       |
| `pnpm lint`      | ESLint 检查                        |
| `pnpm typecheck` | TypeScript 类型检查                |
| `pnpm test:unit` | 运行单元测试                       |

## 文档

| 文档                                      | 说明                        |
| ----------------------------------------- | --------------------------- |
| [开发运行指南](docs/dev-guide.md)         | Mock / 全栈模式详细启动步骤 |
| [AI 大模型接入指南](docs/ai-providers.md) | API Key 配置与新增模型      |
| [架构设计](docs/architecture.md)          | 系统架构与数据流            |
| [API 设计](docs/api-design.md)            | 后端接口规范                |
| [UI 规范](docs/ui-spec.md)                | 设计系统与组件规范          |
| [RUNNING.md](RUNNING.md)                  | 完整的从零部署参考手册      |

## 目录结构

```
yuanai/
├── apps/
│   ├── web/        # Next.js 15 Web 端
│   ├── mobile/     # Expo React Native 移动端
│   └── desktop/    # Electron 桌面端
├── packages/
│   ├── ui/         # 共享组件库 (@yuanai/ui)
│   ├── core/       # API Client / Hooks / Store (@yuanai/core)
│   └── types/      # 前后端共享 TS 类型 (@yuanai/types)
├── backend/        # FastAPI 后端
└── scripts/
    ├── _utils.mjs  # 跨平台工具函数（内部使用）
    ├── setup.mjs   # 首次项目初始化
    ├── dev.mjs     # 全栈一键启动（跨平台）
    └── dev.sh      # 全栈一键启动（Unix bash 版）
```
