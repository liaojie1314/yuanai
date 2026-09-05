# 元AI

多端 AI 聊天应用，功能对标 ChatGPT。支持 Web、Android、iOS、Windows、macOS、Linux，
接入 DeepSeek、Agnes、OpenAI 与 Anthropic 等模型，并提供文件理解、语音输入、图片/视频/音乐
生成和可配置联网搜索。

## 技术栈

| 层          | 技术                                             |
| ----------- | ------------------------------------------------ |
| Web         | Next.js 15 + shadcn/ui + Tailwind v4             |
| Mobile      | Expo (React Native) + NativeWind                 |
| Desktop     | Electron 33 + electron-vite + React 19           |
| 状态 / 请求 | Zustand 5 + TanStack Query v5                    |
| 后端        | FastAPI 0.115 + SQLAlchemy 2 (async)             |
| 数据库      | PostgreSQL 16 + Redis 7                          |
| AI 接入     | OpenAI 兼容接口（DeepSeek / OpenAI / Anthropic） |
| Monorepo    | Turborepo + pnpm                                 |

## 快速开始

### 固定开发运行时

本仓库锁定 **Node.js 22.21.1**、**pnpm 10.22.0** 与 **Turborepo 2.10.7**。首次安装
或切换分支后，先执行：

```bash
corepack enable
corepack prepare pnpm@10.22.0 --activate
pnpm check:runtime
pnpm install --frozen-lockfile
```

`.nvmrc` 和 `.node-version` 供 nvm、asdf 等版本管理器读取；已使用 Volta 的开发者可执行：

```bash
volta install node@22.21.1 pnpm@10.22.0
```

若系统没有 `corepack`，请安装 Volta 后执行上面的 Volta 命令。开发、初始化和打包入口会在
版本不一致时停止并给出修复提示，避免不同 pnpm 主版本改写锁文件。

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

自动完成：生成本地 SearXNG 密钥 → 启动 Docker 基础设施（含 SearXNG）→ 等待 PostgreSQL
→ 数据库迁移 → 启动后端 → 启动前端。
首次运行若 `backend/.env` 不存在，会暂停并提示填写 API Key。  
兼容 macOS / Linux / Windows（使用 Node.js 脚本，无需 bash）。

> 详见 [AI 大模型接入指南](docs/ai-providers.md)

### 方式四：分步手动启动

详见 [开发运行指南](docs/dev-guide.md)。

### 桌面端开发与预览

桌面端复用真实后端 API；先按“全栈模式”启动基础设施和 FastAPI，再通过根脚本启动
Electron：

```bash
pnpm dev:desktop
```

生产构建后的本地预览使用：

```bash
pnpm preview:desktop
```

根据当前操作系统交互式选择可用安装包：

```bash
pnpm package:desktop
```

详细的环境变量、测试和平台打包命令见 [桌面端说明](apps/desktop/README.md) 与
[运行指南](RUNNING.md#启动桌面端electron)。发版、签名和 GitHub Actions 说明见
[发版与 CI/CD](docs/release.md)。Android release 在本机运行 `pnpm package:mobile:android`
构建后，通过 `pnpm release:upload:android -- v<version>` 上传到 GitHub Release，不走 EAS
云端构建。

## 配置 AI 大模型

编辑 `backend/.env`，填写需要使用的模型的 API Key（留空的模型不会出现在前端）：

```bash
DEEPSEEK_API_KEY=sk-xxxxxxxx    # DeepSeek V4
AGNES_API_KEY=sk-xxxxxxxx       # Agnes 2.5 Flash / Image 2.1 Flash / Video V2.0
OPENAI_API_KEY=sk-proj-xxxxxxx  # GPT-4o（可选）
ANTHROPIC_API_KEY=sk-ant-xxxxx  # Claude 3.5 Sonnet（可选）
```

详细说明、各平台注册步骤、新增模型方法见 [AI 大模型接入指南](docs/ai-providers.md)。

### 配置 AI 音乐生成

音乐生成默认使用本机 Hugging Face MusicGen，不需要 API Token：

```dotenv
# backend/.env
MEDIA_MUSIC_PROVIDER=local
MEDIA_MUSIC_LOCAL_MODEL=facebook/musicgen-small
MEDIA_MUSIC_LOCAL_DEVICE=auto
```

本机 GPU 会优先用于纯音乐生成；没有 CUDA 时可以改为 `cpu`，但速度会明显变慢。音乐支持
固定 30 秒的纯音乐和歌词歌曲：纯音乐使用本机 MusicGen，歌词歌曲使用独立的本机 ACE-Step
服务。模型安装、三端使用方式、远程失败降级和 provider 注意事项见
[媒体生成与音乐配置](docs/media-generation.md)。未配置 `HF_TOKEN` 或 `ELEVENLABS_API_KEY`
时，图片、视频和普通聊天仍可使用，默认本机 MusicGen 也不依赖第三方 Key；歌词模式需要
ACE-Step 服务运行。Hugging Face 远程 provider 和 ElevenLabs 仅作为显式配置的实验/备用
方案，其中 ElevenLabs 不保证包含免费 Music API 额度。ACE-Step 建议使用至少 6 GB
可用显存；4 GB 显卡不能稳定完成歌词推理，可按媒体配置文档使用 CPU-only 启动回退。

## 联网搜索

聊天输入框的“联网搜索”可以独立于“思考”开关使用。已检索的来源保存在该次回复的
工具调用记录中，三端都在思考块内展示可展开的来源标题、摘要和安全外链；不会拼接到
回答正文。默认 `auto` 使用无密钥的本地 SearXNG，也可显式配置 Brave 或 Tavily Key。

```bash
# 仅在手动启动 SearXNG 前需要；pnpm dev:real 会自动执行
pnpm setup:search
docker compose up -d searxng
```

获取第三方 Key、选择 provider 和可选代理设置见[联网搜索配置](docs/ai-providers.md#联网搜索)。

## 三方登录（可选）

已落地 **GitHub OAuth** 与 **Google OAuth**（Web 回跳 + 移动端 `yuanai://` deep link）。首次启用需：

1. 在 [GitHub OAuth Apps](https://github.com/settings/developers) / [Google Cloud Console](https://console.cloud.google.com/apis/credentials) 创建应用，Callback URL 分别填 `http://localhost:8000/api/v1/auth/github/callback` 与 `http://localhost:8000/api/v1/auth/google/callback`
2. 把 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`、`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 写入 `backend/.env`
3. `cd backend && uv run alembic upgrade head`

完整步骤见 [OAuth 配置指南](docs-internal/oauth-setup.md)。微信规划中；Apple 因 $99/年会员费不列入路线。

## 常用命令

| 命令                                        | 说明                               |
| ------------------------------------------- | ---------------------------------- |
| `pnpm setup`                                | 首次初始化（安装依赖 + 复制 .env） |
| `pnpm check:runtime`                        | 验证锁定的 Node.js 与 pnpm 版本    |
| `pnpm dev:mock`                             | 纯前端 Mock 模式（无需后端）       |
| `pnpm dev:real`                             | 一键全栈启动（真实 AI 接口）       |
| `pnpm dev:desktop`                          | 启动 Electron 开发窗口             |
| `pnpm dev:mobile`                           | 启动 Expo 真机/模拟器开发服务      |
| `pnpm setup:search`                         | 生成本地 SearXNG 必需的随机密钥    |
| `pnpm build`                                | 构建全部应用                       |
| `pnpm package:mobile:android`               | 本机构建签名 Android release APK   |
| `pnpm release:upload:android -- v<version>` | 上传本地 APK 到 GitHub Release     |
| `pnpm lint`                                 | ESLint 检查                        |
| `pnpm typecheck`                            | TypeScript 类型检查                |
| `pnpm test:unit`                            | 运行单元测试                       |
| `pnpm preview:desktop`                      | 预览生产构建的 Electron 应用       |

## 文档

| 文档                                                                      | 说明                                     |
| ------------------------------------------------------------------------- | ---------------------------------------- |
| [开发运行指南](docs/dev-guide.md)                                         | Mock / 全栈模式详细启动步骤              |
| [AI 大模型接入指南](docs/ai-providers.md)                                 | API Key 配置与新增模型                   |
| [媒体生成与音乐配置](docs/media-generation.md)                            | 图片、视频、音乐任务与本机 MusicGen 配置 |
| [架构设计](docs/architecture.md)                                          | 系统架构与数据流                         |
| [API 设计](docs/api-design.md)                                            | 后端接口规范                             |
| [UI 规范](docs/ui-spec.md)                                                | 设计系统与组件规范                       |
| [Phase 4 — 桌面端](docs/phases/phase-4-desktop.md)                        | 桌面端实施状态与验收边界                 |
| [Phase 5 — Agent Runtime](docs/phases/phase-5-agent-runtime.md)           | Agent 运行时与验收证据                   |
| [Phase 6 — 工具与执行](docs/phases/phase-6-tools-execution.md)            | 六个 Wave 与进入 Phase 7 的门槛          |
| [Phase 7 — 记忆与自动化](docs/phases/phase-7-memory-skills-automation.md) | 后续阶段入口条件                         |
| [桌面端说明](apps/desktop/README.md)                                      | Electron 启动、测试与打包                |
| [发版与 CI/CD](docs/release.md)                                           | release-it、Secrets 与 Actions           |
| [跨端排障记录](docs/troubleshooting.md)                                   | 已解决问题和真机调试方法                 |
| [RUNNING.md](RUNNING.md)                                                  | 完整的从零部署参考手册                   |

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

## Agent 阶段边界

- 截至 2026-09-05，Phase 5 Agent Runtime 的代码合同、自动化测试和恢复故障注入演练已通过本地门禁；
  真实 provider 两工具演练有记录，但已部署 Worker 崩溃恢复和五分钟真实断线恢复仍未完成，不能仅凭测试入口或构建结果放行。
- Phase 6 六个 Wave 已有不同程度的实现和测试：隔离 stdio Worker、受控 Browser Worker、Desktop
  执行节点和 Web 工具控制中心均已进入代码/测试证据阶段。已通过 YuanAI 认证 API 连接真实公共
  Streamable HTTP MCP，完成工具发现、显式启用、审批和文档只读调用；这不是 Web 控制中心 UI 验收。
  完整 Web 控制中心链路、Desktop 取消/重连/撤销、故障注入稳定性和系统性 Browser Worker 安全验收仍阻塞。当前分支的 Chromium
  Web E2E 为 33/33、Tool Control Center E2E 为 3/3，均使用受控路由 mock，只是自动化回归证据。真实
  Desktop E2E 最新一次为 `1 passed (2m42s)`，当前边界见[执行节点验收记录](apps/desktop/tests/e2e/execution-node-acceptance.md)。
- Phase 7 尚未开始；可新开会话的前置条件仍未满足，必须先完成 Phase 5/6 的真实运行与安全验收。
- 音乐生成是独立媒体能力，不计入 Phase 6 的 Wave 或进入 Phase 7 的许可证。

详见 [Phase 5](docs/phases/phase-5-agent-runtime.md)、[Phase 6](docs/phases/phase-6-tools-execution.md)
和 [Phase 7](docs/phases/phase-7-memory-skills-automation.md)。
