# 系统架构设计

## 总体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                           客户端层                                    │
│                                                                       │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│   │  Web     │  │  Mobile  │  │  Desktop │  │  Mini Program    │   │
│   │ Next.js  │  │  Expo RN │  │ Electron │  │  Taro (二期)     │   │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬─────────┘   │
│        └─────────────┴─────────────┴─────────────────┘             │
│                              │                                        │
│                    @yuanai/core (共享逻辑)                            │
│              TanStack Query + Zustand + API Client                   │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ HTTPS / SSE
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          后端层 (FastAPI)                             │
│                                                                       │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐   │
│   │  Auth API    │   │  Chat API    │   │   File Upload API    │   │
│   │  /auth/*     │   │  /chat/*     │   │   /files/*           │   │
│   └──────────────┘   └──────┬───────┘   └──────────────────────┘   │
│                             │                                         │
│              ┌──────────────┴──────────────────┐                    │
│              │        AI Service Layer          │                    │
│              │  (openai SDK, 模型路由, 限流)    │                    │
│              └──────────────┬──────────────────┘                    │
└─────────────────────────────┼───────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
   ┌─────────────┐   ┌─────────────┐   ┌──────────────┐
   │ PostgreSQL  │   │    Redis    │   │  S3 Storage  │
   │  主数据库   │   │  会话缓存   │   │  文件存储    │
   └─────────────┘   └─────────────┘   └──────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
   ┌─────────────┐   ┌─────────────┐   ┌──────────────┐
   │   OpenAI    │   │   Claude    │   │  DeepSeek    │
   │    API      │   │    API      │   │    API       │
   └─────────────┘   └─────────────┘   └──────────────┘
```

## 前端架构

### 代码共享策略

```
packages/types/          → 所有端共享的 TypeScript 类型 (接口/枚举/schema)
packages/core/           → 所有端共享的业务逻辑
  ├── api/               → API Client (axios + SSE)
  ├── stores/            → Zustand stores (auth, chat, settings)
  ├── hooks/             → 共享 React hooks (useStream, useChat, useAuth)
  └── utils/             → 工具函数 (格式化、验证等)

packages/ui/             → Web + Desktop 共享组件 (shadcn/ui base)
  ├── components/        → Button, Input, Avatar, MessageBubble 等
  ├── tokens/            → CSS 变量 (颜色、字体、间距)
  └── themes/            → light / dark 主题定义

apps/web/                → Next.js 专用 (SSR, 路由, SEO)
apps/mobile/             → Expo 专用 (导航, 原生 API, 权限)
apps/desktop/            → Electron 专用（主进程、多窗口 renderer、托盘、安全存储）
```

### 状态管理架构

```
Zustand Stores:
├── useAuthStore         → 用户信息、JWT token、登录状态
├── useChatStore         → 当前会话列表、活跃会话 ID
├── useMessageStore      → 当前会话消息（分 session 缓存）
├── useModelStore        → 可用模型列表、当前选中模型
└── useSettingsStore     → 主题、语言、通知等用户偏好

TanStack Query (服务端状态):
├── useConversations     → GET /chat/conversations
├── useMessages          → GET /chat/conversations/:id/messages
├── useModels            → GET /models
└── useUser              → GET /auth/me
```

### 流式对话数据流

```
用户输入
    │
    ▼
packages/core/hooks/useStream.ts
    │  POST /chat/stream (body: {model, messages, conversation_id})
    │
    ▼
EventSource / fetch with ReadableStream
    │
    ▼
onMessage: 解析 SSE data -> token
    │
    ▼
Zustand: useMessageStore.appendToken(conversationId, messageId, token)
    │
    ▼
UI 组件订阅 store，实时渲染流式输出
    │
    ▼
[DONE] 事件 -> 标记消息完成, 触发 TanStack Query 缓存更新
```

## 后端架构

### 目录结构

```
backend/
├── app/
│   ├── main.py                  ← FastAPI app 入口，注册路由和中间件
│   ├── api/
│   │   ├── deps.py              ← 依赖注入 (get_db, get_current_user)
│   │   └── v1/
│   │       ├── auth.py          ← /api/v1/auth/*
│   │       ├── chat.py          ← /api/v1/chat/*
│   │       ├── files.py         ← /api/v1/files/*
│   │       └── models.py        ← /api/v1/models/*
│   ├── models/                  ← SQLAlchemy ORM 模型
│   │   ├── user.py
│   │   ├── conversation.py
│   │   ├── message.py
│   │   └── file.py
│   ├── schemas/                 ← Pydantic v2 请求/响应 schema
│   │   ├── auth.py
│   │   ├── chat.py
│   │   └── file.py
│   ├── services/
│   │   ├── ai_service.py        ← AI 模型调用统一入口
│   │   ├── auth_service.py      ← JWT 签发/验证
│   │   ├── file_service.py      ← S3 上传/下载
│   │   └── stream_service.py    ← SSE 流式响应封装
│   └── core/
│       ├── config.py            ← 环境变量配置 (pydantic-settings)
│       ├── database.py          ← async SQLAlchemy engine + session
│       ├── redis.py             ← Redis 连接
│       └── security.py          ← 密码哈希、JWT 工具
├── alembic/                     ← 数据库迁移
├── tests/                       ← pytest 测试
├── pyproject.toml               ← 依赖管理 (uv)
└── .env.example                 ← 环境变量示例
```

### AI Service 路由逻辑

```python
# ai_service.py 核心逻辑（伪代码）

PROVIDER_MAP = {
    "gpt-4o":          {"provider": "openai",   "base_url": OPENAI_BASE_URL},
    "gpt-4o-mini":     {"provider": "openai",   "base_url": OPENAI_BASE_URL},
    "claude-3-5-sonnet": {"provider": "anthropic", "base_url": ANTHROPIC_BASE_URL},
    "deepseek-chat":   {"provider": "deepseek", "base_url": "https://api.deepseek.com"},
    "qwen-plus":       {"provider": "qwen",     "base_url": DASHSCOPE_BASE_URL},
}

async def stream_chat(model: str, messages: list, ...) -> AsyncGenerator:
    config = PROVIDER_MAP[model]
    client = AsyncOpenAI(
        api_key=get_api_key(config["provider"]),
        base_url=config["base_url"]    # 所有厂商统一走 OpenAI 兼容接口
    )
    async for chunk in client.chat.completions.create(
        model=model, messages=messages, stream=True
    ):
        yield chunk
```

## 数据库设计

### 核心表结构 (ER 图)

```
users
├── id          UUID PK
├── email       VARCHAR(255) UNIQUE NOT NULL
├── username    VARCHAR(50) UNIQUE NOT NULL
├── hashed_pwd  VARCHAR(255) NOT NULL
├── avatar_url  VARCHAR(500)
├── created_at  TIMESTAMP
└── updated_at  TIMESTAMP

conversations
├── id          UUID PK
├── user_id     UUID FK -> users.id
├── title       VARCHAR(200) NOT NULL DEFAULT '新对话'
├── model       VARCHAR(100) NOT NULL         ← 当前使用的模型
├── is_pinned   BOOLEAN DEFAULT false
├── created_at  TIMESTAMP
└── updated_at  TIMESTAMP

messages
├── id          UUID PK
├── conv_id     UUID FK -> conversations.id
├── role        ENUM('user','assistant','system')
├── content     TEXT NOT NULL                 ← markdown 原文
├── model       VARCHAR(100)                  ← assistant 消息记录实际模型
├── tokens_used INTEGER
├── created_at  TIMESTAMP
└── (index: conv_id, created_at)

message_files
├── id          UUID PK
├── message_id  UUID FK -> messages.id
├── file_id     UUID FK -> files.id
└── sort_order  INTEGER

files
├── id          UUID PK
├── user_id     UUID FK -> users.id
├── filename    VARCHAR(255) NOT NULL
├── mime_type   VARCHAR(100) NOT NULL
├── size_bytes  BIGINT NOT NULL
├── s3_key      VARCHAR(500) NOT NULL
├── created_at  TIMESTAMP
```

## 认证流程

```
注册/登录:
  POST /api/v1/auth/register | /login
      → 验证 → 返回 { access_token, refresh_token }
      → access_token: JWT, 15分钟有效
      → refresh_token: Redis 存储, 30天有效

刷新 Token:
  POST /api/v1/auth/refresh
      → 验证 refresh_token (Redis) → 返回新 access_token

前端持久化:
  Web: localStorage / cookie（按 Web 端认证策略）
  Desktop: Electron safeStorage 加密后的会话文件，经受限 IPC 读写
  Mobile: SecureStore (Expo)
```

## 平台适配策略

| 特性     | Web                           | Mobile                            | Desktop                              |
| -------- | ----------------------------- | --------------------------------- | ------------------------------------ |
| 导航     | Next.js App Router            | Expo Router                       | Electron 多窗口 + 各窗口 Hash Router |
| 侧边栏   | 固定展开 (宽屏) / 抽屉 (窄屏) | 底部 Tab                          | 固定侧边栏                           |
| 输入框   | 底部固定，Enter 发送          | 底部安全区，软键盘适配            | 底部固定，Enter 发送                 |
| 文件上传 | input[type=file]              | Expo ImagePicker / DocumentPicker | Electron dialog                      |
| 主题存储 | localStorage                  | AsyncStorage                      | 服务端显示偏好同步 + 主进程本地偏好  |
| 通知     | Web Notification API          | Expo Notifications                | Electron Notification                |
| 深色模式 | prefers-color-scheme          | Appearance API                    | 系统颜色方案                         |

### Desktop 进程边界

桌面端通过 Electron 33 的多 renderer 入口运行：主聊天、认证（登录/注册/忘记密码）、
设置、关于、Artifact 和 OAuth。主进程统一管理窗口、托盘、全局快捷键、原生通知、
开机自启和受控本地文件访问；preload 仅暴露 `window.yuanai` 白名单 IPC。

认证会话使用 `safeStorage` 加密，运行时 API/Web/静态资源地址由主进程校验后再交给
renderer。自定义 `yuanai-app://` 用于打包 renderer，`yuanai-file://` 只读取由原生
选择器一次性授权的文件，避免在页面中暴露本机绝对路径。

### 联网搜索数据流

用户可单独打开联网搜索。前端先读取 `/chat/capabilities`，仅在服务端报告可用 provider
时发送 `enable_web_search=true`；后端按 `auto | searxng | brave | tavily | disabled` 解析
provider，对查询做限流、缓存与结果净化，再由 `ai_service` 的受限工具循环发出 SSE
`tool_call_start`、`tool_call_delta`、`tool_call_end`。来源仅保存为消息工具元数据，三端
在思考区域按需展开，外链由各平台的受控方式打开。

## 构建产物

| 端              | 产物               | 部署方式                 |
| --------------- | ------------------ | ------------------------ |
| Web             | Next.js standalone | Docker / Vercel / nginx  |
| Mobile iOS      | .ipa               | App Store / TestFlight   |
| Mobile Android  | .apk / .aab        | Google Play / 直接分发   |
| Desktop Windows | .exe installer     | 直接分发 / Windows Store |
| Desktop macOS   | .dmg               | 直接分发 / Mac App Store |
| Desktop Linux   | .AppImage / .deb   | 直接分发 / apt           |
