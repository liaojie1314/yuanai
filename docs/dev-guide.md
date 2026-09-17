# 开发运行指南

## 固定运行时

所有开发机必须使用 **Node.js 22.21.1** 与 **pnpm 10.22.0**；锁文件对应
**Turborepo 2.10.7**。先切换 Node.js 版本，再运行：

```bash
corepack enable
corepack prepare pnpm@10.22.0 --activate
pnpm check:runtime
pnpm install --frozen-lockfile
```

`.nvmrc`、`.node-version` 与 `package.json` 的 Volta 配置均锁定相同版本。没有 Corepack
时使用 `volta install node@22.21.1 pnpm@10.22.0`，不要用其他 pnpm 主版本重新生成锁文件。

## 两种模式对比

| 特性         | Mock 模式                       | 真实接口模式          |
| ------------ | ------------------------------- | --------------------- |
| 需要启动后端 | ✗ 不需要                        | ✓ 需要                |
| 需要 Docker  | ✗ 不需要                        | ✓ 需要                |
| 数据持久化   | ✗ 刷新后丢失                    | ✓ 持久化到 PostgreSQL |
| 真实 AI 回复 | ✗ 预设文本                      | ✓ 调用真实 AI API     |
| 适合场景     | UI 开发 / 无网络环境            | 功能联调 / 测试       |
| 登录账号     | `demo@yuanai.dev` / `Demo1234!` | 任意注册账号          |

---

## 模式一：Mock 模式（仅前端）

无需后端服务，所有 API 请求由 [MSW](https://mswjs.io/) 在浏览器中拦截并返回 mock 数据。

### 启动步骤

```bash
# 安装依赖（首次）
pnpm install

# 一键启动 mock 模式
pnpm dev:mock
```

> 等价于 `NEXT_PUBLIC_MOCK=true pnpm --filter @yuanai/web dev`

访问 [http://localhost:3000](http://localhost:3000)

### mock 账号

| 字段 | 值                |
| ---- | ----------------- |
| 邮箱 | `demo@yuanai.dev` |
| 密码 | `Demo1234!`       |

### mock 数据说明

- 预置 4 条会话（置顶、今天、昨天、本周各一条）
- 前两条会话有历史消息
- 发送消息会触发流式输出（30ms/字符，随机选用 3 条预设回复）
- **数据仅存在于当次 Service Worker 的内存中，刷新页面后 session 保留，但重开标签后重置**

---

## 模式二：真实接口模式（全栈）

### 前提条件

- Docker Desktop 已安装并运行
- 已在 `backend/.env` 中配置至少一个 AI 提供商的 API Key → 详见 [AI 大模型接入指南](ai-providers.md)
- 音乐生成默认使用本机 MusicGen；歌词歌曲需另外启动本机 ACE-Step 服务。两种模式都固定
  30 秒，任务默认只读已缓存模型并有界超时，安装、GPU/CPU 配置、ACE-Step 启动和远程实验
  方案见 [媒体生成与音乐配置](media-generation.md)

### 环境变量

```bash
cd backend
cp .env.example .env
```

`backend/.env` 的关键项（Docker 默认值可直接使用，**生产环境必须改掉 JWT 密钥与所有默认凭据**）：

```env
# 数据库（注意宿主机端口是 5433，不是 5432）
DATABASE_URL=postgresql+asyncpg://yuanai:password@localhost:5433/yuanai
REDIS_URL=redis://localhost:6379/0

# JWT（本地开发可保持默认，生产环境必须修改）
JWT_SECRET_KEY=change-me-in-production
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=30

# AI 供应商 API Key（至少填一个）→ 详见 ai-providers.md
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
DEEPSEEK_API_KEY=sk-...
AGNES_API_KEY=sk-...

# 联网搜索（默认 auto 优先使用本地 SearXNG）
SEARCH_PROVIDER=auto # auto | searxng | brave | tavily | disabled
BRAVE_SEARCH_API_KEY=
TAVILY_API_KEY=

# MinIO / S3（Docker 默认值可直接使用）
S3_ENDPOINT_URL=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET_NAME=yuanai-files
S3_PUBLIC_URL=http://localhost:9000/yuanai-files
```

前端各 app 的 env 见下方[切换模式](#切换模式)；存储配置见[文件上传与对象存储](#文件上传与对象存储)。

### 启动步骤

```bash
# 一键启动 Docker Compose 基础设施、迁移、FastAPI 和 Web
pnpm dev:real
```

`pnpm dev:real` 会启动 PostgreSQL（宿主机 `5433`）、Redis、MinIO 和 SearXNG，然后执行
迁移并启动后端和 Web。后端集成测试使用同一个 Compose PostgreSQL 中的 `yuanai_test` 数据库；
测试前先让真实栈运行，不要把连接地址改回宿主机 `5432`。歌词音乐还需要另开终端执行
`ACE_STEP_DIR=/absolute/path/to/ACE-Step-1.5 pnpm dev:ace-step`。低显存 GPU 无法完成 ACE-Step
推理时，不要反复重试同一任务；改用[媒体生成与音乐配置](media-generation.md#设备与低显存配置)
中的 CPU-only 启动命令。

### 启动移动端

保持基础设施与后端运行，另开终端：

```bash
pnpm dev:mobile          # 启动 Expo Dev Server（显示 QR 码）
pnpm dev:mobile:mock     # 不需要后端的 mock 模式
```

进入 `apps/mobile` 后可选择运行目标：

| 命令           | 目标                   |
| -------------- | ---------------------- |
| `pnpm android` | Android 模拟器 / 真机  |
| `pnpm ios`     | iOS 模拟器（仅 macOS） |
| `pnpm web`     | 浏览器中运行           |

**真机运行（Expo Go）**：手机安装 [Expo Go](https://expo.dev/go)，运行 `pnpm dev:mobile`
后用 Expo Go 扫描终端 QR 码。真机连接后端需把 `apps/mobile/.env.local` 的 API 地址改成
本机局域网 IP（`hostname -I` 查看），`localhost` 在真机上指向手机自己。

排障见[移动端排障](guides/mobile-troubleshooting.md)。

### 启动桌面端

桌面端不使用浏览器 MSW；它通过 Electron 主进程读取经过校验的运行时配置并请求
真实 FastAPI。保持上述基础设施与后端运行，在另一个终端执行：

```bash
# macOS / Linux
YUANAI_API_URL=http://localhost:8000/api/v1 pnpm --filter @yuanai/desktop dev

# Windows PowerShell
$env:YUANAI_API_URL = 'http://localhost:8000/api/v1'
pnpm --filter @yuanai/desktop dev
```

桌面端默认 API 地址已是 `http://localhost:8000/api/v1`，显式设置有助于区分本地、
测试和生产环境。`YUANAI_WEB_URL` 默认 `http://localhost:3000`；只有在使用其他
Web 域名生成分享链接时才需要修改。非回环 API 或 Web 地址必须使用 HTTPS。

生产资源验证与针对性测试：

```bash
pnpm --filter @yuanai/desktop build
pnpm --filter @yuanai/desktop preview
pnpm --filter @yuanai/desktop test:unit
pnpm --filter @yuanai/desktop test:integration
```

桌面执行节点的真实 Electron E2E 还需要后端 API 在 `YUANAI_API_URL`（默认
`http://localhost:8000/api/v1`）可用、测试账号可创建或已配置登录凭据，以及 Linux 上已解锁且
可用的桌面钥匙串。使用项目脚本运行，不要直接调用底层 Electron 或 Playwright 启动器：

```bash
pnpm --filter @yuanai/desktop test:e2e
```

截至 2026-09-05，当前分支的真实 Linux 运行记录为 `1 passed (29s)`，覆盖配对、WSS challenge、
本地审批、签名回调、ACK、取消确认和节点撤销。该单个 E2E 仍不覆盖断线重连/重放；该项不能仅凭
Desktop 单元/集成测试记录为真实验收。后端不可达、safeStorage 不可用或测试被 skip 时均不是通过。
重启后必须先验证可用的 X11 会话；本次使用 `DISPLAY=:1`，而不是历史 `:0`。完整边界见
[执行节点验收记录](../apps/desktop/tests/e2e/execution-node-acceptance.md)。

Browser Worker 的浏览器二进制必须来自已有系统安装或显式 `executablePath`，优先使用
`/usr/bin/google-chrome`；不要运行 `playwright install` 下载浏览器。系统 Chrome 不存在时，记录
环境阻塞并保留依赖与模型缓存。

### 访问地址

| 服务               | 地址                                                                      |
| ------------------ | ------------------------------------------------------------------------- |
| Web 前端           | [http://localhost:3000](http://localhost:3000)                            |
| 后端 API           | [http://localhost:8000](http://localhost:8000)                            |
| API 文档 (Swagger) | [http://localhost:8000/docs](http://localhost:8000/docs)                  |
| API 文档 (ReDoc)   | [http://localhost:8000/redoc](http://localhost:8000/redoc)                |
| MinIO 控制台       | [http://localhost:9001](http://localhost:9001)（minioadmin / minioadmin） |

### 基础设施端口

| 服务          | 主机端口 | 容器端口 |
| ------------- | -------- | -------- |
| PostgreSQL    | 5433     | 5432     |
| Redis         | 6379     | 6379     |
| MinIO S3      | 9000     | 9000     |
| MinIO Console | 9001     | 9001     |

> **注意**：PostgreSQL 映射到宿主机 5433 端口（非标准 5432），以避免与本机已有的 PostgreSQL 实例冲突。

### 注册第一个账号

直接访问 [http://localhost:3000/register](http://localhost:3000/register) 注册。  
密码规则：最少 8 位，需含大写字母、小写字母、数字。

---

## 文件上传与对象存储

### 存储后端选择

`backend/.env` 中的 `STORAGE_BACKEND` 决定文件（头像、聊天附件）的落盘位置：

| 值      | 用途            | 说明                                                                   |
| ------- | --------------- | ---------------------------------------------------------------------- |
| `s3`    | 默认（推荐）    | 走 `docker compose` 起的 MinIO，兼容 AWS S3；分片上传使用 S3 multipart |
| `local` | 无 MinIO / 测试 | 直接写 `LOCAL_UPLOADS_DIR`（默认 `./uploads`），后端挂载到 `/uploads`  |

集成测试固定用 `local`（在 `backend/tests/conftest.py` 设置），无需 MinIO。

### S3 / MinIO 相关配置

```dotenv
STORAGE_BACKEND=s3
S3_ENDPOINT_URL=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET_NAME=yuanai-files
S3_PUBLIC_URL=http://localhost:9000/yuanai-files

# 大小限制（可选，均有默认值）
MAX_UPLOAD_SIZE_BYTES=524288000        # 500 MB，分片上传总大小上限
MAX_DIRECT_UPLOAD_BYTES=10485760       # 10 MB，超过则必须走分片
UPLOAD_CHUNK_SIZE_BYTES=5242880        # 5 MB，S3 多段上传要求 ≥ 5 MB
```

### bucket 公开读策略（AccessDenied 排查）

MinIO / S3 的 bucket **默认拒绝匿名 GET**，导致 `<img src="…/avatars/…">` 报：

```xml
<Error>
  <Code>AccessDenied</Code>
  <Message>Access Denied.</Message>
  ...
</Error>
```

后端在 `lifespan` 启动阶段会自动调用 `storage.ensure_bucket()`，
除 `HeadBucket` / `CreateBucket` 之外，还会 `PutBucketPolicy` 授予
`avatars/*` 与 `files/*` 前缀匿名 GET 权限（见
`backend/app/services/storage_service.py:_PUBLIC_READ_PREFIXES`）。

如果启动时策略写入失败（权限不足、后端未就绪等），可通过 MinIO 客户端 `mc` 手动配置：

```bash
# 一次性：安装 mc 客户端后
mc alias set local http://localhost:9000 minioadmin minioadmin
mc anonymous set-json - local/yuanai-files <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {"AWS": ["*"]},
      "Action": ["s3:GetObject"],
      "Resource": [
        "arn:aws:s3:::yuanai-files/avatars/*",
        "arn:aws:s3:::yuanai-files/files/*"
      ]
    }
  ]
}
JSON
```

或在 MinIO 控制台（[http://localhost:9001](http://localhost:9001)） →
Buckets → yuanai-files → Access Rules，添加：

| Prefix     | Access   |
| ---------- | -------- |
| `avatars/` | readonly |
| `files/`   | readonly |

> ⚠️ 生产环境私有文件应使用签名 URL 而非公开读；当前策略适合 MVP。

### 分片上传 / 断点续传 / 秒传

前端 `packages/core/src/hooks/useFileUpload.ts` 的 `uploadFileSmart(file)` 会自动：

1. 计算 SHA-256 → `POST /files/check-hash` 命中则秒传返回
2. 文件 ≤ 10 MB → `POST /files/upload` 直传
3. 否则按 5 MB 切片；localStorage 记录 `hash → sessionId`，下次同 hash
   自动 `GET /files/upload-session/{id}` 拉回已上传分片续传
4. 全部分片就绪后 `POST /complete` 触发 S3 multipart 合并

后端会话表：`file_upload_sessions`（迁移 `e7f2b3d4c5a6`）。

---

## 切换模式

### 从真实模式切换到 mock 模式

```bash
echo "NEXT_PUBLIC_MOCK=true" > apps/web/.env.local
# 重启 Next.js 开发服务器使 env 生效
```

### 从 mock 模式切换到真实模式

```bash
echo "NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1" > apps/web/.env.local
# 确保 docker compose up -d 和后端已启动
# 重启 Next.js 开发服务器
```

---

## 运行测试

```bash
# 后端：单元 + 集成测试（需 docker compose up -d）
cd backend
PYTHONPATH="" uv run pytest tests/ -v -p no:launch_testing

# 后端：lint + type check
PYTHONPATH="" uv run ruff check app/ tests/
PYTHONPATH="" uv run mypy app/ --ignore-missing-imports

# 前端：单元测试
pnpm test:unit

# 全部测试（从根目录）
pnpm test
```

### 桌面端打包

桌面安装包只能通过 `apps/desktop/package.json` 脚本生成：

```bash
pnpm --filter @yuanai/desktop build:unpack
pnpm --filter @yuanai/desktop package:linux
pnpm --filter @yuanai/desktop package:win
pnpm --filter @yuanai/desktop package:mac
pnpm package:desktop
```

`pnpm package:desktop` 会根据当前操作系统只列出本机可执行的目标，并复用根目录中
已有的 `package:desktop:linux`、`package:desktop:win` 或 `package:desktop:mac` 脚本。
打包结果须在目标操作系统安装验证。Electron 发布包会随安装包上传对应的更新源元数据：
Windows 为 `latest.yml` 与 NSIS `.exe.blockmap`，macOS 为 `latest-mac.yml`，Linux
AppImage 为 `latest-linux.yml`。Windows 的签名嵌入 `.exe`，不会生成独立 `.sig`；签名证书
和目标平台安装验收不是本地开发启动的前置条件。

### 发版与 CI/CD

版本与跨平台构建流程见 [发版与 CI/CD](release.md)。正式发版前必须先在本地完成
`pnpm release:dry` 和 Linux 打包，确认后再按维护者授权合并到 `master` 并执行 release-it；
GitHub Actions 会在 `v*` tag 上构建 Web 与 Electron 安装包，Android 使用本机
`pnpm package:mobile:android` 构建后通过 `pnpm release:upload:android -- v<version>` 上传。

---

## 常见问题

**Q: `docker compose up -d` 后后端报 "Connection refused"**  
A: PostgreSQL 启动需要几秒钟。等待约 5 秒后再启动后端，或用 `docker compose ps` 确认 postgres 状态为 `healthy`。

**Q: mock 模式下发送消息没有流式效果**  
A: 确认浏览器 DevTools → Application → Service Workers 中已注册 `mockServiceWorker`。首次访问可能需要刷新一次页面。

**Q: 想修改 mock 数据或回复内容**  
A: 编辑 `apps/web/src/mocks/handlers.ts` 中的 `MOCK_RESPONSES` 和初始 `conversations` / `messages` 对象，无需重启（Next.js 热重载会重新加载 handlers）。

**Q: 后端端口冲突**  
A: 编辑 `docker-compose.yml` 修改 `5433:5432` 中的宿主机端口，同步更新 `backend/.env` 中的 `DATABASE_URL`。
