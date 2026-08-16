# 元AI — 项目运行指南

> 本文档覆盖从零开始到完整运行所有端的全部操作步骤。  
> 适用对象：初次上手的开发者、CI/CD 环境配置人员。

---

## 目录

- [环境要求](#环境要求)
- [克隆与安装](#克隆与安装)
- [基础设施启动](#基础设施启动（Docker）)
- [环境变量配置](#环境变量配置)
- [启动后端](#启动后端-fastapi)
- [启动 Web 端](#启动-web-端-nextjs-15)
- [启动移动端](#启动移动端-expo)
- [启动桌面端](#启动桌面端-electron)
- [全端同时启动](#全端同时启动（Turborepo）)
- [测试](#测试)
- [代码质量](#代码质量)
- [Git 工作流](#git-工作流)
- [常用命令速查](#常用命令速查)
- [常见问题](#常见问题)

---

## 环境要求

| 工具                | 最低版本   | 验证命令           |
| ------------------- | ---------- | ------------------ |
| Node.js             | 22.x       | `node --version`   |
| pnpm                | 9.x        | `pnpm --version`   |
| Python              | 3.12+      | `python --version` |
| uv（Python 包管理） | 0.5+       | `uv --version`     |
| Docker + Compose    | Docker 24+ | `docker --version` |
| Git                 | 2.x        | `git --version`    |

**安装 pnpm**（如未安装）：

```bash
npm install -g pnpm@latest
```

**安装 uv**（如未安装）：

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows (PowerShell)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

---

## 克隆与安装

```bash
# 克隆仓库
git clone git@github.com:liaojie1314/yuanai.git
cd yuanai

# 安装所有前端依赖（Turborepo + pnpm workspace 一次性安装全部包）
pnpm install

# 安装后端依赖
cd backend
uv sync
cd ..
```

> `pnpm install` 会自动安装 `apps/web`、`apps/mobile`、`apps/desktop`、`packages/` 下所有包的依赖，无需分别进入目录安装。

---

## 基础设施启动（Docker）

后端依赖 **PostgreSQL 16**、**Redis 7**、**MinIO**（S3 兼容对象存储）和本地
**SearXNG**（联网搜索默认 provider）。
根目录已提供 `docker-compose.yml`，一条命令启动全部：

```bash
# 首次运行生成仅供本地 SearXNG 使用的随机密钥
pnpm setup:search

# 启动所有服务（后台运行）
docker compose up -d

# 查看服务状态
docker compose ps

# 查看日志（可选）
docker compose logs -f
```

启动后各服务地址：

| 服务         | 地址             | 说明                                            |
| ------------ | ---------------- | ----------------------------------------------- |
| PostgreSQL   | `localhost:5432` | 数据库 `yuanai`，用户 `yuanai`，密码 `password` |
| Redis        | `localhost:6379` | 无密码                                          |
| MinIO API    | `localhost:9000` | S3 兼容接口                                     |
| MinIO 控制台 | `localhost:9001` | 账号 `minioadmin` / 密码 `minioadmin`           |
| SearXNG      | `127.0.0.1:8082` | 联网搜索的无密钥本地 provider                   |

**停止所有服务**：

```bash
docker compose down
```

**清空数据重新初始化**（慎用）：

```bash
docker compose down -v
```

---

## 环境变量配置

### 后端

```bash
cd backend
cp .env.example .env
```

编辑 `backend/.env`，填入必要项：

```env
# 数据库（Docker 默认值可直接使用）
DATABASE_URL=postgresql+asyncpg://yuanai:password@localhost:5432/yuanai
REDIS_URL=redis://localhost:6379/0

# JWT（本地开发可保持默认，生产环境必须修改）
JWT_SECRET_KEY=change-me-in-production
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=30

# AI 供应商 API Key（至少填一个）
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
DEEPSEEK_API_KEY=sk-...
AGNES_API_KEY=sk-...

# 联网搜索（默认 auto 优先使用本地 SearXNG）
SEARCH_PROVIDER=auto # auto | searxng | brave | tavily | disabled
BRAVE_SEARCH_API_KEY=
TAVILY_API_KEY=

# MinIO（Docker 默认值可直接使用）
S3_ENDPOINT_URL=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET_NAME=yuanai-files
S3_PUBLIC_URL=http://localhost:9000/yuanai-files
```

### Web 端

```bash
cd apps/web
cp .env.example .env.local
```

```env
# apps/web/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
```

### 移动端

```bash
cd apps/mobile
cp .env.example .env.local
```

```env
# apps/mobile/.env.local
EXPO_PUBLIC_API_URL=http://localhost:8000/api/v1
```

> **移动设备注意**：如在真机上调试，`localhost` 需改为开发机的局域网 IP，例如 `http://192.168.1.100:8000/api/v1`。

> **联网搜索说明**：`pnpm dev:real` 会自动生成 SearXNG 密钥并启动该服务；仅手动
> 启动 Compose 时才需要先运行 `pnpm setup:search`。Brave/Tavily 的申请步骤、provider
> 回退顺序与可选代理设置见[AI 大模型接入指南](docs/ai-providers.md#联网搜索)。

---

## 启动后端（FastAPI）

```bash
cd backend

# 执行数据库迁移（首次启动必须执行）
uv run alembic upgrade head

# 启动开发服务器（热重载）
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

验证启动成功：

```bash
curl http://localhost:8000/health
# 预期输出：{"status":"ok"}
```

- **API 文档（Swagger）**：http://localhost:8000/docs
- **API 文档（ReDoc）**：http://localhost:8000/redoc

---

## 启动 Web 端（Next.js 15）

```bash
# 方式一：从根目录启动（推荐，Turborepo 管理）
pnpm dev --filter @yuanai/web

# 方式二：进入目录单独启动
cd apps/web
pnpm dev
```

访问 http://localhost:3000

---

## 启动移动端（Expo）

```bash
# 方式一：从根目录启动
pnpm dev --filter @yuanai/mobile

# 方式二：进入目录单独启动
cd apps/mobile
pnpm dev           # 启动 Expo Dev Server（显示 QR 码）
```

启动后可选择运行目标：

| 命令           | 目标                   |
| -------------- | ---------------------- |
| `pnpm android` | Android 模拟器 / 真机  |
| `pnpm ios`     | iOS 模拟器（仅 macOS） |
| `pnpm web`     | 浏览器中运行           |

**在真机上运行（Expo Go）**：

1. 手机安装 [Expo Go](https://expo.dev/go)
2. 运行 `pnpm dev`，用 Expo Go 扫描终端中的 QR 码

---

## 启动桌面端（Electron）

桌面端使用真实 API，不走 Web 的 MSW Mock。先启动“基础设施”和“后端”，再使用根脚本
启动 Electron：

```bash
pnpm dev:desktop
```

Electron 会自动打开登录窗口或恢复安全存储中的会话。`YUANAI_WEB_URL` 可选，
默认 `http://localhost:3000`，用于分享链接等 Web 跳转；`YUANAI_ASSET_ORIGINS`
可为非默认静态资源域名提供逗号分隔的白名单。

**验证与打包桌面应用**：

```bash
pnpm --filter @yuanai/desktop typecheck
pnpm --filter @yuanai/desktop lint
pnpm --filter @yuanai/desktop test:unit
pnpm --filter @yuanai/desktop test:integration
pnpm --filter @yuanai/desktop build
pnpm --filter @yuanai/desktop preview

# electron-builder 平台打包
pnpm --filter @yuanai/desktop build:unpack
pnpm --filter @yuanai/desktop package:linux
pnpm --filter @yuanai/desktop package:win
pnpm --filter @yuanai/desktop package:mac
```

桌面端包含主聊天、认证、设置、关于、Artifact 和 OAuth renderer；托盘、原生
通知、开机自启与全局快捷键由主进程提供。联网搜索的来源与思考详情会在虚拟消息列表
滚动、回收与重新挂载后维持用户展开状态。平台安装包须在对应操作系统完成安装验收；
当前没有已发布的签名安装包或生产自动更新源。

---

## 全端同时启动（Turborepo）

Turborepo 支持并行启动所有 `dev` 任务：

```bash
# 从根目录启动所有 app（web + mobile + desktop）
pnpm dev
```

> 后端需单独在 `backend/` 目录启动（Python 不在 Turborepo 管理范围内）。

**只启动特定 app**：

```bash
pnpm dev --filter @yuanai/web        # 仅 Web
pnpm dev --filter @yuanai/mobile     # 仅 Mobile
pnpm dev --filter @yuanai/desktop    # 仅 Desktop
```

---

## 测试

### 运行所有前端单元测试

```bash
# 从根目录运行（所有 packages 和 apps）
pnpm test:unit
```

### 运行特定包的测试

```bash
pnpm test:unit --filter @yuanai/core    # 仅 core 包
pnpm test:unit --filter @yuanai/ui      # 仅 ui 包
pnpm test:unit --filter @yuanai/web     # 仅 Web app
pnpm --filter @yuanai/desktop test:unit # 仅 Desktop app
```

### 监听模式（开发中使用）

```bash
cd packages/core && pnpm test:watch
cd apps/web && pnpm test:watch
```

### 覆盖率报告

```bash
pnpm test:coverage
# 报告生成在各包的 coverage/ 目录下，打开 coverage/index.html 查看
```

### 集成测试

```bash
pnpm test:integration
```

### E2E 测试（Playwright）

> E2E 测试需要后端和 Web 端同时运行。

```bash
# 首次使用需安装浏览器驱动
cd apps/web && npx playwright install

# 运行 E2E 测试
pnpm test:e2e --filter @yuanai/web

# 以 UI 模式调试
cd apps/web && npx playwright test --ui
```

### 后端测试（pytest）

```bash
cd backend

# 单元测试（无需数据库）
uv run pytest tests/unit -v

# 集成测试（需要数据库已启动）
uv run pytest tests/integration -v

# 所有测试 + 覆盖率
uv run pytest --cov=app --cov-report=html -v
# 报告在 htmlcov/index.html
```

---

## 代码质量

### 类型检查

```bash
# 检查所有包（TypeScript）
pnpm typecheck

# 检查后端（mypy）
cd backend && uv run mypy app
```

### Lint

```bash
# 前端 ESLint
pnpm lint

# 自动修复
pnpm lint:fix

# 后端 Ruff
cd backend && uv run ruff check app
cd backend && uv run ruff check --fix app
```

### 格式化

```bash
# 格式化所有前端文件（Prettier）
pnpm format

# 仅检查格式（CI 使用）
pnpm format:check

# 格式化后端（Ruff）
cd backend && uv run ruff format app
```

### 一键全量检查（等同于 CI）

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test:unit
```

---

## Git 工作流

### 分支策略

```
main          ← 生产分支（仅接受来自 dev 的 PR）
└── dev       ← 集成分支（功能分支合并到这里）
    ├── feat/xxx
    ├── fix/xxx
    └── ...
```

### 新功能开发流程

```bash
# 1. 从 dev 切出功能分支
git checkout dev
git pull origin dev
git checkout -b feat/your-feature-name

# 2. 开发并提交
git add <files>
git commit -m "feat(web): add login page"

# 3. 推送并创建 PR
git push origin feat/your-feature-name
# 在 GitHub 创建 PR，目标分支为 dev
```

### Commit Message 规范

格式：`<type>(<scope>): <subject>`

| type       | 用途      | 示例                                             |
| ---------- | --------- | ------------------------------------------------ |
| `feat`     | 新功能    | `feat(web): add conversation sidebar`            |
| `fix`      | Bug 修复  | `fix(backend): fix token refresh race condition` |
| `refactor` | 重构      | `refactor(core): simplify useStream hook`        |
| `test`     | 测试      | `test(backend): add auth integration tests`      |
| `chore`    | 构建/配置 | `chore(config): upgrade turbo to 2.3`            |
| `docs`     | 文档      | `docs: update running guide`                     |
| `style`    | 格式调整  | `style(web): fix indentation in ChatInput`       |
| `perf`     | 性能优化  | `perf(web): virtual scroll for message list`     |

**Scope 清单**：`web` | `mobile` | `desktop` | `backend` | `ui` | `core` | `types` | `e2e` | `config`

> commitlint 会在每次 `git commit` 时自动校验格式，不符合规范将被拒绝。

### Git Hooks 说明

| Hook         | 触发时机        | 执行内容                                         |
| ------------ | --------------- | ------------------------------------------------ |
| `pre-commit` | 每次 commit 前  | lint-staged（ESLint + Prettier，仅处理暂存文件） |
| `commit-msg` | 提交 message 时 | commitlint 校验格式                              |
| `pre-push`   | 每次 push 前    | `pnpm typecheck` + `pnpm test:unit`              |

> 紧急情况跳过 hook：`git push --no-verify`（需在 PR 中说明原因）。

---

## 常用命令速查

```bash
# ── 安装 ──────────────────────────────────────────
pnpm install                          # 安装所有前端依赖
cd backend && uv sync                 # 安装后端依赖

# ── 基础设施 ─────────────────────────────────────
docker compose up -d                  # 启动 PG + Redis + MinIO
docker compose down                   # 停止所有服务
docker compose ps                     # 查看服务状态

# ── 后端 ──────────────────────────────────────────
cd backend
uv run alembic upgrade head           # 数据库迁移
uv run uvicorn app.main:app --reload  # 启动后端 (port 8000)
uv run pytest tests/unit -v           # 后端单元测试
uv run ruff check app                 # 后端 lint

# ── 前端（根目录执行）────────────────────────────
pnpm dev                              # 启动所有 app
pnpm dev --filter @yuanai/web         # 仅启动 Web (port 3000)
pnpm --filter @yuanai/desktop dev     # 启动 Electron Desktop
pnpm --filter @yuanai/desktop preview # 预览 Desktop 生产构建
pnpm --filter @yuanai/desktop package:linux # Linux electron-builder 打包
pnpm build                            # 全量构建
pnpm lint                             # ESLint 检查
pnpm typecheck                        # TypeScript 类型检查
pnpm format                           # Prettier 格式化
pnpm format:check                     # 格式检查（不修改文件）
pnpm test:unit                        # 单元测试
pnpm test:integration                 # 集成测试
pnpm test:coverage                    # 覆盖率报告

# ── 特定包操作 ───────────────────────────────────
pnpm <cmd> --filter @yuanai/web       # 对 Web app 执行命令
pnpm <cmd> --filter @yuanai/core      # 对 core 包执行命令
```

---

## 常见问题

### `pnpm install` 报错：peer dependency 警告

**正常现象**，pnpm 默认显示 peer 警告，不影响运行。若需抑制：

```bash
pnpm install --ignore-scripts
```

### 后端启动报错：`FATAL: database "yuanai" does not exist`

Docker 容器未启动或数据库未创建：

```bash
docker compose up -d postgres
# 等待 3-5 秒后再启动后端
```

### 后端迁移报错：`Can't locate revision`

数据库迁移版本不一致，重置迁移：

```bash
cd backend
uv run alembic downgrade base
uv run alembic upgrade head
```

### Web 端启动报错：`Module not found: @yuanai/core`

workspace 包未正确链接，重新安装：

```bash
pnpm install --force
```

### Expo 移动端无法连接后端

真机调试时 `localhost` 指向手机本身，需改为开发机 IP：

```bash
# 查看本机局域网 IP
ifconfig | grep "inet " | grep -v 127.0.0.1   # macOS/Linux
ipconfig                                         # Windows

# 修改 apps/mobile/.env.local
EXPO_PUBLIC_API_URL=http://192.168.x.x:8000/api/v1
```

### Electron 启动报错：`electron-vite: command not found`

```bash
cd apps/desktop
pnpm install
pnpm dev
```

### pre-push Hook 失败：`Type check failed`

修复类型错误后重新 push：

```bash
pnpm typecheck    # 查看具体错误
# 修复错误...
git push
```

### commitlint 拒绝 commit message

确保 message 格式为 `type(scope): subject`，scope 必须是规定值之一：

```bash
# ✅ 正确
git commit -m "feat(web): add login form"

# ❌ 错误（无 scope）
git commit -m "feat: add login form"

# ❌ 错误（scope 不在列表中）
git commit -m "feat(frontend): add login form"
```

---

## 服务端口总览

| 服务                | 端口 | URL                                                  |
| ------------------- | ---- | ---------------------------------------------------- |
| Web（Next.js）      | 3000 | http://localhost:3000                                |
| 后端 API（FastAPI） | 8000 | http://localhost:8000                                |
| API 文档（Swagger） | 8000 | http://localhost:8000/docs                           |
| PostgreSQL          | 5432 | `postgresql://yuanai:password@localhost:5432/yuanai` |
| Redis               | 6379 | `redis://localhost:6379`                             |
| MinIO API           | 9000 | http://localhost:9000                                |
| MinIO 控制台        | 9001 | http://localhost:9001                                |
