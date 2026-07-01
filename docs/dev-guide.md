# 开发运行指南

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
# 1. 创建 mock 专用 env 文件
echo "NEXT_PUBLIC_MOCK=true" > apps/web/.env.local

# 2. 安装依赖（首次）
pnpm install

# 3. 启动 Web 开发服务器
pnpm --filter @yuanai/web dev
# 或从仓库根目录只启动 web
pnpm dev --filter @yuanai/web
```

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
- 已在 `backend/.env` 中配置 API Key（OpenAI / Anthropic / DeepSeek）

### 启动步骤

```bash
# 1. 启动基础设施（PostgreSQL + Redis + MinIO）
docker compose up -d

# 2. 进入后端目录
cd backend

# 3. 安装 Python 依赖（首次）
uv sync

# 4. 执行数据库迁移（首次或新版本后执行）
uv run alembic upgrade head

# 5. 启动后端（开发模式，支持热重载）
uv run uvicorn app.main:app --reload --port 8000

# 6. 另开终端，启动 Web 前端
cd ..
echo "NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1" > apps/web/.env.local
pnpm --filter @yuanai/web dev
```

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
