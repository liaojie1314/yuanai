# API 设计规范

**Base URL**: `https://api.yuanai.app/api/v1`（开发环境：`http://localhost:8000/api/v1`）

**所有请求头**:

```
Content-Type: application/json
Authorization: Bearer <access_token>   （除登录/注册/OAuth 外必须携带）
```

---

## 认证接口 `/auth`

### POST `/auth/register` — 注册

**Request:**

```json
{
  "email": "user@example.com",
  "password": "Abcd1234!",
  "username": "yuanai_user"
}
```

**Response 201:**

```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "token_type": "bearer",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "username": "yuanai_user",
    "avatar_url": null,
    "created_at": "2026-01-01T00:00:00Z"
  }
}
```

**Error 409:** `AUTH_EMAIL_EXISTS` 或 `AUTH_USERNAME_EXISTS`

---

### GET `/auth/check-username` — 检查用户名是否可用（无需认证）

注册页面在输入框失焦时实时调用，防止提交后才报错。

**Query params:**

- `username`: string（必须）

**Response 200:**

```json
{
  "available": true
}
```

```json
{
  "available": false
}
```

---

### POST `/auth/login` — 邮箱密码登录

**Request:**

```json
{
  "email": "user@example.com",
  "password": "Abcd1234!",
  "remember_me": false
}
```

`remember_me` 为 `true` 时，`access_token` 有效期延长至 7 天（默认 2 小时）。

**Response 200:** 同注册 201 结构

**Error 401:** `AUTH_INVALID_CREDENTIALS`

---

### POST `/auth/login/phone` — 手机号验证码登录

手机验证码登录，需先调用 `POST /auth/phone/send-code` 获取验证码。

**Request:**

```json
{
  "phone": "13812345678",
  "code": "123456"
}
```

**Response 200:** 同注册 201 结构

**Error 401:** `AUTH_CODE_INVALID` 或 `AUTH_CODE_EXPIRED`

---

### POST `/auth/phone/send-code` — 发送手机验证码（无需认证）

登录页和绑定手机场景均使用此接口。

**Request:**

```json
{
  "phone": "13812345678",
  "purpose": "login"
}
```

`purpose` 枚举：`"login"` | `"bind"`

**Response 200:**

```json
{
  "expires_in": 60
}
```

验证码 60 秒内有效，前端据此显示倒计时按钮。

**Error 429:** `RATE_LIMIT_EXCEEDED`

---

### POST `/auth/qr/create` — 生成扫码登录二维码（无需认证）

Web 端点击二维码登录按钮时调用，轮询扫码状态。

**Response 201:**

```json
{
  "token": "qr_abc123",
  "expires_in": 60
}
```

二维码内容为 `yuanai://qr-login?token=qr_abc123`，由前端渲染为二维码图片。

---

### GET `/auth/qr/:token/status` — 轮询二维码扫描状态（无需认证）

前端每 2 秒轮询一次，直到扫描成功或过期。

**Response 200:**

```json
{
  "status": "pending"
}
```

`status` 枚举：

| 值          | 含义                 |
| ----------- | -------------------- |
| `pending`   | 等待用户扫码         |
| `scanned`   | 用户已扫码，等待确认 |
| `confirmed` | 确认完成，携带 token |
| `expired`   | 已过期               |

`status` 为 `confirmed` 时额外返回认证数据：

```json
{
  "status": "confirmed",
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "token_type": "bearer",
  "user": { "...": "同注册结构" }
}
```

**Error 404:** `AUTH_QR_EXPIRED`（token 不存在或已过期）

---

### GET `/auth/github` — 发起 GitHub OAuth 登录（无需认证）

生成随机 state 写 Redis（TTL 5 分钟），302 重定向到 GitHub 授权页。
scope 固定为 `read:user user:email`。

**Response 302:** 重定向到 `https://github.com/login/oauth/authorize?client_id=...&state=...`

**Error 503:** `OAUTH_NOT_CONFIGURED` — 环境变量 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` 未配置

> 已落地：GitHub、Google（同构端点 `GET /auth/google`、`GET /auth/google/callback`、`DELETE /auth/me/google`；`?mobile=1` 时 callback 302 到 `yuanai://oauth/callback`）。规划中：微信（需企业认证）；Apple 因 $99/年会员成本已从占位列表移除。

---

### GET `/auth/github/callback` — GitHub OAuth 回调（无需认证）

由 GitHub 302 至此。后端校验 state → exchange code → 拉取 profile & primary email → 按 `github_id` → `email` 顺序查找账号：命中直接登录；仅邮箱命中自动补 `github_id` 完成关联；都没有则新建账号（`hashed_password=NULL`）。

**成功时 302 到前端：**

```
{WEB_APP_URL}/oauth/callback?access_token=eyJ...&refresh_token=eyJ...&token_type=bearer&expires_in=900
```

**失败时 302 到前端并携带错误码：**

```
{WEB_APP_URL}/oauth/callback?error=OAUTH_STATE_INVALID&error_description=...
```

**错误码枚举：**

| Code                          | 触发条件                                 |
| ----------------------------- | ---------------------------------------- |
| `OAUTH_PROVIDER_ERROR`        | GitHub 返回 error 参数（如用户拒绝授权） |
| `OAUTH_MISSING_PARAMS`        | 回调缺 code 或 state                     |
| `OAUTH_STATE_INVALID`         | state 不存在于 Redis / 已过期 / 已消费   |
| `OAUTH_TOKEN_EXCHANGE_FAILED` | code 已过期、client_secret 错误等        |
| `OAUTH_EMAIL_UNAVAILABLE`     | GitHub 账号无可用 primary email          |
| `OAUTH_NETWORK_ERROR`         | 后端无法连接 github.com（跨境网络）      |
| `OAUTH_NOT_CONFIGURED`        | 服务端未配置 client_id / secret          |

---

### POST `/auth/google/native` — 原生 Google Sign-In 换 Token（无需认证）

移动端用 `@react-native-google-signin/google-signin` 原生 SDK 拿到 Google ID token 后调用本端点，
无需浏览器跳转、无需 state / code 交换。

**Request:**

```json
{ "idToken": "eyJhbGciOiJSUzI1NiIs..." }
```

服务端校验：RS256 签名（公钥取 Google JWKS 并缓存 1 小时）、`iss` ∈
{`accounts.google.com`, `https://accounts.google.com`}、`exp` 必须存在且未过期、
`aud` 必须命中允许的 client id 集合（`GOOGLE_CLIENT_ID` + `GOOGLE_NATIVE_CLIENT_IDS`，
后者逗号分隔，用于登记 Android / iOS client id）。
通过后按 `google_id` → `email` 顺序关联或新建账号（规则同 GitHub 回调），签发同口径 JWT。

**Response 200:** 与 `POST /auth/login` 相同的 `{ access_token, refresh_token, token_type, expires_in, user }`

| HTTP | Code                      | 触发条件                                                           |
| ---- | ------------------------- | ------------------------------------------------------------------ |
| 422  | —                         | `idToken` 缺失或不是 JWS compact 三段式                            |
| 401  | `OAUTH_ID_TOKEN_INVALID`  | 签名验不过 / `iss` 不对 / 缺 `exp` 或已过期 / `aud` 不在允许集合内 |
| 400  | `OAUTH_EMAIL_UNAVAILABLE` | id_token 无 email 或 `email_verified` 不为 true                    |
| 503  | `OAUTH_NOT_CONFIGURED`    | 允许的 client id 集合为空                                          |
| 503  | `OAUTH_NETWORK_ERROR`     | 拉不到 Google JWKS 验签公钥                                        |

Android OAuth 客户端申请与 `aud` 配置见 [guides/google-android-oauth.md](guides/google-android-oauth.md)。

---

### POST `/auth/refresh` — 刷新 Token

**Request:**

```json
{
  "refresh_token": "eyJ..."
}
```

**Response 200:**

```json
{
  "access_token": "eyJ...",
  "token_type": "bearer"
}
```

---

### POST `/auth/logout` — 登出（需认证）

吊销 refresh_token（从 Redis 删除）。

**Response 200:** `{ "message": "已退出登录" }`

---

### GET `/auth/me` — 获取当前用户（需认证）

**Response 200:**

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "username": "yuanai_user",
  "avatar_url": "https://...",
  "created_at": "2026-01-01T00:00:00Z"
}
```

> **v1 范围说明：** `bio`、`phone`、`plan`、`linked_providers` 字段已规划，将在 v2 阶段随对应功能（手机绑定、订阅、OAuth 解绑）一同实现。

---

### PATCH `/auth/me` — 更新用户基本信息（需认证）

**Request:**（字段均可选）

```json
{
  "username": "new_name",
  "avatar_url": "https://..."
}
```

**Response 200:** 更新后的用户对象（同 `GET /auth/me` 结构）

---

### GET `/auth/me/stats` — 获取使用统计（需认证）

个人资料页「使用统计」卡片数据来源。

**Response 200:**

```json
{
  "conversation_count": 128,
  "total_tokens": 42300,
  "file_count": 17
}
```

---

### POST `/auth/me/email-code` — 发送邮箱更换验证码（需认证）

在设置页「更换邮箱」弹窗中，用户输入新邮箱后点击「发送验证码」调用。

**Request:**

```json
{
  "new_email": "newemail@example.com"
}
```

**Response 200:**

```json
{
  "expires_in": 60
}
```

**Error 409:** `AUTH_EMAIL_EXISTS`（新邮箱已被其他账号使用）

---

### PATCH `/auth/me/email` — 更换邮箱（需认证）

**Request:**

```json
{
  "new_email": "newemail@example.com",
  "code": "123456"
}
```

**Response 200:** 更新后的用户对象

**Error 401:** `AUTH_CODE_INVALID` 或 `AUTH_CODE_EXPIRED`

---

### PATCH `/auth/me/password` — 修改密码（需认证）

设置页「修改密码」弹窗，需提供当前密码。

**Request:**

```json
{
  "old_password": "OldPass123!",
  "new_password": "NewPass456!"
}
```

**Response 200:** `{ "message": "密码已修改" }`

**Error 401:** `AUTH_INVALID_CREDENTIALS`（旧密码错误）

---

### POST `/auth/me/phone-code` — 发送手机绑定验证码（需认证）

设置页绑定手机号流程。

**Request:**

```json
{
  "phone": "13812345678"
}
```

**Response 200:**

```json
{
  "expires_in": 60
}
```

**Error 409:** `AUTH_PHONE_EXISTS`

---

### POST `/auth/me/phone` — 绑定手机号（需认证）

**Request:**

```json
{
  "phone": "13812345678",
  "code": "123456"
}
```

**Response 200:** 更新后的用户对象

**Error 401:** `AUTH_CODE_INVALID` 或 `AUTH_CODE_EXPIRED`

---

### 绑定第三方登录 — 复用 `GET /auth/github`

设置页「账号安全 → 第三方登录」的「绑定」按钮直接跳到 `GET /auth/github` 走完整 OAuth 流程；后端 callback 时按邮箱命中当前账号后自动写入 `github_id`（见 `_link_or_create_user`）。不再需要独立的 `/link` 端点。

Google 已按同一模式落地；未来接入微信时继续复用。

---

### DELETE `/auth/me/github` — 解绑 GitHub（需认证）

设置页「账号安全 → 第三方登录」→ GitHub 行「解绑」。

**Response 200:** 返回更新后的 `User`（`githubId: null`）

**Error 400:** `OAUTH_ONLY_ACCOUNT` — 当前账号 `hashed_password IS NULL`（纯 OAuth 用户），解绑会让账号失去所有登录途径；要求用户先通过「忘记密码」流程走一次邮箱验证码补设本地密码，再解绑

---

### DELETE `/auth/me` — 注销账号（需认证）

设置页「危险操作」区域，用户在前端输入「删除账号」确认文字后提交（确认校验由前端完成）。后端永久删除账号及所有关联数据（会话、消息、文件，由数据库 CASCADE 处理）。

**Response 200:** `{ "message": "账号已注销" }`

**Error 400:** `AUTH_DELETE_CONFIRMATION_INVALID`（确认文本不匹配）

---

## 模型接口 `/models`

### GET `/models` — 获取可用模型列表（需认证）

**Response 200:**

```json
{
  "models": [
    {
      "id": "gpt-4o",
      "name": "GPT-4o",
      "provider": "openai",
      "description": "OpenAI 最强多模态模型",
      "supports_vision": true,
      "supports_files": true,
      "context_length": 128000,
      "is_default": true
    },
    {
      "id": "claude-3-5-sonnet-20241022",
      "name": "Claude 3.5 Sonnet",
      "provider": "anthropic",
      "description": "Anthropic 最新旗舰模型",
      "supports_vision": true,
      "supports_files": true,
      "context_length": 200000,
      "is_default": false
    },
    {
      "id": "deepseek-chat",
      "name": "DeepSeek V4",
      "provider": "deepseek",
      "description": "高性价比国产大模型",
      "supports_vision": false,
      "supports_files": false,
      "context_length": 64000,
      "is_default": false
    }
  ]
}
```

---

## 会话接口 `/chat`

### GET `/chat/conversations` — 获取会话列表（需认证）

**Query params:**

- `limit`: int, default 20, max 100
- `cursor`: string（cursor-based 分页，上次返回的 `next_cursor`）

**Response 200:**

```json
{
  "conversations": [
    {
      "id": "uuid",
      "title": "如何学习 Rust",
      "title_source": "ai",
      "title_generated_at": "2026-01-01T10:00:02Z",
      "model": "gpt-4o",
      "is_pinned": false,
      "last_message_at": "2026-01-01T12:00:00Z",
      "created_at": "2026-01-01T10:00:00Z"
    }
  ],
  "next_cursor": "eyJ...",
  "has_more": true
}
```

#### `title_source` 的五个取值

标题由首问同步回退、后台 AI 生成或用户改名三条路径确定，客户端靠这个字段判断
当前标题是不是最终结果：

| 值               | 含义                    | 客户端表现             |
| ---------------- | ----------------------- | ---------------------- |
| `default`        | 新建空会话，还没有首问  | 不提示                 |
| `fallback`       | 首问截断的临时标题      | **显示「标题生成中」** |
| `fallback_final` | AI 生成失败，回退即最终 | 不提示                 |
| `ai`             | AI 生成成功             | 不提示                 |
| `manual`         | 用户手动改名            | 不提示                 |

`fallback` 与 `fallback_final` 必须分开：只有一个「fallback」时，**终态和进行中共用
同一个值**，客户端的「生成中」提示就没有退出条件，生成一失败便永久转圈。
后端在生成失败时负责推进到 `fallback_final`，客户端不得自行超时猜测。

AI 标题生成绝不覆盖 `manual`：落库用 `WHERE title_source = 'fallback'` 作乐观条件，
用户在生成期间改名会让该更新的 rowcount 变为零，从而自然保留用户标题。

---

### POST `/chat/conversations` — 创建会话（需认证）

**Request:**

```json
{
  "model": "gpt-4o",
  "title": "新对话"
}
```

`title` 可选，默认 `"新对话"`。

**Response 201:**

```json
{
  "id": "uuid",
  "title": "新对话",
  "model": "gpt-4o",
  "is_pinned": false,
  "created_at": "2026-01-01T00:00:00Z"
}
```

---

### PATCH `/chat/conversations/:id` — 更新会话（需认证）

**Request:**（字段均可选）

```json
{
  "title": "新标题",
  "model": "claude-3-5-sonnet-20241022",
  "is_pinned": true
}
```

**Response 200:** 更新后的会话对象

---

### DELETE `/chat/conversations/:id` — 删除会话（需认证）

**Response 204:** No Content

---

### GET `/chat/conversations/:id/messages` — 获取消息列表（需认证）

**Query params:**

- `limit`: int, default 50, max 200
- `cursor`: string（分页）

**Response 200:**

```json
{
  "messages": [
    {
      "id": "uuid",
      "role": "user",
      "content": "你好，请解释什么是 RAG",
      "files": [
        {
          "id": "uuid",
          "filename": "document.pdf",
          "mime_type": "application/pdf",
          "size_bytes": 102400,
          "url": "https://..."
        }
      ],
      "created_at": "2026-01-01T12:00:00Z"
    },
    {
      "id": "uuid",
      "role": "assistant",
      "content": "RAG（检索增强生成）是...",
      "model": "gpt-4o",
      "tokens_used": 256,
      "files": [],
      "created_at": "2026-01-01T12:00:05Z"
    }
  ],
  "next_cursor": null,
  "has_more": false
}
```

---

### GET `/chat/capabilities` — 获取聊天扩展能力（需认证）

客户端在渲染输入区前调用。响应只说明用户可用能力，不返回搜索 provider 的 URL、
代理地址或任何密钥。

**Response 200:**

```json
{
  "webSearch": {
    "enabled": true,
    "provider": "searxng",
    "reason": null
  }
}
```

`enabled` 为 `false` 时，`reason` 为 `"disabled"` 或 `"unavailable"`；客户端必须禁用
联网搜索开关，而不是猜测 provider 配置。

`unavailable` 只说明「探测没通过」，不区分原因。SearXNG 的探测固定走环回地址且
**不读环境代理变量** —— httpx 的 `no_proxy` 不认 `127.0.0.0/8` 这类网段写法，
设了 `HTTP_PROXY` 的机器上本机请求会被发往代理并失败，表现为能力恒为 `false`
且没有任何报错。Brave / Tavily 是真外部服务，仍尊重用户的代理设置。

---

### POST `/chat/stream` — 流式对话（SSE，需认证）

这是核心接口，返回 Server-Sent Events 流。

**Request:**

```json
{
  "conversation_id": "uuid",
  "model": "gpt-4o",
  "enable_thinking": false,
  "enable_web_search": true,
  "message": {
    "content": "请解释什么是 RAG",
    "file_ids": ["uuid1", "uuid2"]
  }
}
```

`file_ids` 可选，引用已通过 `POST /files/upload` 上传的文件 ID。`enable_web_search`
仅在 `/chat/capabilities` 报告 `webSearch.enabled=true` 时可用，并可独立于
`enable_thinking` 打开。

**Response Headers:**

```
Content-Type: text/event-stream
Cache-Control: no-cache
X-Accel-Buffering: no
```

**SSE 事件格式:**

```
# 消息开始（携带本次 user 消息和 assistant 消息的 ID）
event: message_start
data: {"user_message_id":"uuid","assistant_message_id":"uuid","model":"gpt-4o"}

# 内容 token（逐个字符/词组）
event: content_delta
data: {"token":"RAG"}

event: content_delta
data: {"token":"（检索增强生成）"}

# 思考内容（模型或工具执行过程，可选）
event: thinking_delta
data: {"token":"检索可靠来源…"}

# 联网搜索工具调用（可选；完整来源写入 assistant 消息 tool_calls）
event: tool_call_start
data: {"tool_call_id":"search-1","name":"search_web"}

event: tool_call_delta
data: {"tool_call_id":"search-1","args_chunk":"{\"query\":\"RAG\"}"}

event: tool_call_end
data: {"tool_call_id":"search-1","status":"done","result":"已检索 3 条来源","sources":[{"title":"...","url":"https://...","snippet":"...","provider":"searxng"}]}

# 消息结束（包含完整统计）
event: message_end
data: {"tokens_used":256,"finish_reason":"stop"}

# 首问的 AI 标题结果（可选；仅首条消息，且仅在标题任务赶上流结束时发出）
event: conversation_title
data: {"conversation_id":"uuid","title":"学习 Rust 的路径","title_source":"ai","title_generated_at":"2026-01-01T10:00:02Z"}

# 错误事件
event: error
data: {"code":"MODEL_QUOTA_EXCEEDED","message":"模型调用额度不足"}

# 流结束
data: [DONE]
```

`conversation_title` 的 `title_source` 可能是 `ai`（生成成功）或 `fallback_final`
（生成失败，回退标题即最终标题），取值含义见上文「`title_source` 的五个取值」。
标题任务在流结束时只等 0.25 秒：它不会延迟首个回复 token，超时后任务继续独立落库，
客户端在下次会话列表刷新时读到最终标题。**客户端解析该事件时若用白名单校验
`title_source`，必须让新增取值编译失败而不是静默丢弃事件** —— 丢弃的后果是界面
停在上一个状态且无任何报错。

**Error 400:** `CONVERSATION_NOT_FOUND` 或 `CONVERSATION_ACCESS_DENIED`

---

## 文件接口 `/files`

### POST `/files/upload` — 上传文件（需认证）

**Request:** `multipart/form-data`

- `file`: 文件二进制
- `purpose`: `"chat"` | `"avatar"`

**限制:**

- 图片：最大 20MB，支持 jpg/png/gif/webp
- 文档：最大 50MB，支持 pdf/txt/md/docx
- 单次最多上传 5 个文件

**Response 201:**

```json
{
  "id": "uuid",
  "filename": "photo.jpg",
  "mime_type": "image/jpeg",
  "size_bytes": 204800,
  "url": "https://storage.yuanai.app/files/uuid/photo.jpg",
  "created_at": "2026-01-01T00:00:00Z"
}
```

---

### DELETE `/files/:id` — 删除文件（需认证）

**Response 204:** No Content

---

## 知识库接口 `/knowledge-bases`

> **字段风格**：`/auth`、`/chat`、`/files` 使用 snake_case；本节及以下各节的请求与响应
> **一律是 camelCase**（Pydantic `alias_generator=to_camel`）。跨节复制字段名前先确认风格。

### POST `/knowledge-bases` — 创建知识库（需认证）

**Request:**

```json
{ "name": "产品手册", "spaceId": null }
```

**Response 201:** `{ "id", "ownerId", "name", "spaceId", "createdAt", "updatedAt" }`

---

### GET `/knowledge-bases` — 列出可访问知识库（需认证）

**Response 200:** 上述对象的数组（自己拥有的 + 被授予成员身份的）。

---

### GET `/knowledge-bases/:id/sources` — 列出来源及其版本（需认证）

**Response 200:**

```json
[
  {
    "id": "uuid",
    "knowledgeBaseId": "uuid",
    "name": "产品手册.pdf",
    "sourceType": "file",
    "sourceUri": null,
    "createdAt": "2026-10-03T00:00:00Z",
    "documents": [
      {
        "id": "uuid",
        "sourceId": "uuid",
        "version": 1,
        "contentHash": "sha256:...",
        "parser": "pdf",
        "status": "published",
        "createdAt": "2026-10-03T00:00:00Z",
        "publishedAt": "2026-10-03T00:01:00Z"
      }
    ]
  }
]
```

`status`: `staged`（已构建未公开）| `published`（可检索）| `superseded` | `failed`。

**Error 404:** `KNOWLEDGE_BASE_NOT_FOUND`

---

### PUT `/knowledge-bases/:id/members` — 授予成员权限（需认证，仅所有者）

**Request:** `{ "userId": "uuid", "role": "viewer" }`，`role` 为 `viewer` | `editor`。

**Response 200:** `{ "id", "knowledgeBaseId", "userId", "role", "createdAt" }`

**Error 404:** `KNOWLEDGE_BASE_NOT_FOUND`　**Error 422:** 权限约束被违反（如给所有者重复授权）

---

### POST `/knowledge-bases/:id/sources/text` — 创建文本来源（需认证）

**Request:**

```json
{ "name": "发布说明", "content": "……", "sourceUri": null }
```

`content` 最大 200,000 字符。创建出的首个版本是 `staged`，**必须显式发布后才能被检索**。

**Response 201:** `KnowledgeDocument`（同上 `documents[]` 元素结构）

**Error 403:** `KNOWLEDGE_BASE_WRITE_FORBIDDEN`　**Error 404:** `KNOWLEDGE_BASE_NOT_FOUND`

---

### POST `/knowledge-bases/:id/sources/:sourceId/documents/text` — 追加文本版本（需认证）

**Request:** `{ "content": "……" }`

**Response 201:** 新的 `staged` 版本。**Error 404:** `KNOWLEDGE_SOURCE_NOT_FOUND`

---

### POST `/knowledge-bases/:id/sources/file` — 文件入库流水线（需认证）

把一个已通过 `POST /files/upload` 上传的文件送入「解析 → 质量检查 → 分块 → 向量化」流水线。

**Request:**

```json
{
  "fileId": "uuid",
  "name": "产品手册.pdf",
  "sourceUri": null,
  "sourceId": null
}
```

`sourceId` 为空时新建来源；传入时为该来源追加一个待发布版本（重新摄取）。

**Response 201:** 返回**作业**而不是文档：

```json
{
  "id": "uuid",
  "knowledgeBaseId": "uuid",
  "sourceId": "uuid",
  "documentId": "uuid",
  "fileId": "uuid",
  "status": "completed",
  "stage": "embed",
  "parser": "pdf",
  "ocrUsed": false,
  "errorCode": null,
  "errorDetail": null,
  "warnings": ["SHORT_CONTENT"],
  "chunkCount": 42,
  "charCount": 18234,
  "createdAt": "2026-10-03T00:00:00Z",
  "finishedAt": "2026-10-03T00:00:06Z"
}
```

**解析失败、格式不支持、OCR 不可用一律返回 201**，失败信息写在 `status` / `stage` /
`errorCode` 上。作业是需要留存的审计记录，用 HTTP 错误码会把它丢掉——调用方必须读
`status` 判断成败，不能只看 HTTP 状态码。

- `status`: `pending` | `running` | `completed` | `degraded`（产出可用但有能力缺失）| `failed`
- `stage`（失败时停在哪一步）: `fetch` | `parse` | `quality_check` | `chunk` | `embed`
- `errorCode`（`failed` / `degraded` 时）: `SOURCE_FETCH_FAILED` | `UNSUPPORTED_FORMAT` |
  `EMPTY_CONTENT` | `GARBLED_CONTENT`
- `warnings`（不阻断发布，由用户决定）: `PARTIALLY_GARBLED` | `SHORT_CONTENT` |
  `OCR_UNAVAILABLE` | `DUPLICATE_CONTENT`

缺少 OCR 依赖导致正文为空时，`status` 是 `degraded` 而非 `failed`：这是本机能力降级，
装上 `ocr` extra 重试即可，不是文档本身有问题。

**Error 403:** `KNOWLEDGE_BASE_WRITE_FORBIDDEN`　**Error 404:** `KNOWLEDGE_INGEST_TARGET_NOT_FOUND`

---

### GET `/knowledge-bases/:id/ingestion-jobs` — 列出入库作业（需认证）

**Response 200:** 最近的 `IngestionJob` 数组，用于展示失败原因与质量告警。

**Error 404:** `KNOWLEDGE_BASE_NOT_FOUND`

---

### POST `/knowledge-bases/:id/sources/:sourceId/documents/:documentId/publish` — 发布版本（需认证）

原子地把 `staged` 版本切为 `published`，同来源旧版本转 `superseded`。

**Response 200:** 发布后的文档。**Error 404:** `KNOWLEDGE_DOCUMENT_NOT_FOUND`

---

### POST `/knowledge-bases/:id/search` — 检索（需认证）

**Request:** `{ "query": "如何导出报表", "limit": 8 }`（`limit` 1–20，默认 8）

**Response 200:** 可定位回源的引用数组：

```json
[
  {
    "knowledgeBaseId": "uuid",
    "sourceId": "uuid",
    "documentId": "uuid",
    "sourceName": "产品手册.pdf",
    "sourceUri": null,
    "documentVersion": 2,
    "chunkIndex": 7,
    "section": "三、导出",
    "charStart": 1820,
    "charEnd": 2240,
    "content": "……",
    "score": 0.82
  }
]
```

只检索 `published` 版本。

---

## Skill 接口 `/skills`

Skill = 不可变版本 + 可审计验证 + 评测门禁 + 安装范围。版本一经创建**内容不可修改**，
修订只能追加新版本。

> **当前限制**：Skill 没有运行时消费者，评测是**静态契约重放**而非真实执行，
> 因此 `estimatedCostUsd` 与 `avgSteps` 恒为 `null`。见
> [交付状态总表](master-plan.md) 的 M13。

### GET `/skills` — 列出 Skill（需认证）

**Response 200:**

```json
[
  {
    "id": "uuid",
    "userId": "uuid",
    "slug": "demo.weekly.rollup",
    "name": "Weekly Rollup",
    "description": "Roll up demo numbers into one summary",
    "currentVersionId": "uuid",
    "versions": [
      {
        "id": "uuid",
        "skillId": "uuid",
        "version": "1.1.0",
        "manifestText": "id: demo.weekly.rollup\n……",
        "skillMd": "# Weekly Rollup\n……",
        "contentHash": "sha256:...",
        "requiredTools": ["calculate@^1"],
        "riskCeiling": "privileged",
        "status": "validated",
        "validationResult": { "tools": ["calculate@1.0.0"] },
        "validationErrors": [],
        "createdAt": "2026-10-03T00:00:00Z",
        "validatedAt": "2026-10-03T00:00:01Z",
        "latestEvaluation": {
          "id": "uuid",
          "skillId": "uuid",
          "versionId": "uuid",
          "status": "failed",
          "mode": "static_contract",
          "caseResults": [
            { "name": "manifest_contract", "status": "passed", "detail": "" },
            {
              "name": "risk_ceiling_not_escalated",
              "status": "failed",
              "detail": "风险上限由 read 抬高到 privileged"
            }
          ],
          "totalCases": 6,
          "passedCases": 5,
          "passRate": "0.8333",
          "estimatedCostUsd": null,
          "avgSteps": null,
          "durationMs": 3,
          "createdAt": "2026-10-03T00:00:02Z"
        }
      }
    ],
    "installations": [
      {
        "id": "uuid",
        "skillId": "uuid",
        "scope": "global",
        "assistantId": null,
        "createdAt": "2026-10-03T00:00:03Z"
      }
    ],
    "createdAt": "2026-10-03T00:00:00Z",
    "updatedAt": "2026-10-03T00:00:03Z"
  }
]
```

`version.status`: `draft` → `validating` → `validated` → `active`，另有 `rejected` /
`deprecated`。

---

### GET `/skills/suggestions` — 从经验生成 Skill 候选（需认证）

扫描当前用户最近的成功 Run，按目标文本相似度聚类，对出现 **≥3 次**的模式归纳候选。
**纯读接口，不写库**；候选需用户确认后 `POST /skills` 才进入草稿流程。

**Response 200:**

```json
[
  {
    "slug": "experience.calculate.3f9a1c2d",
    "name": "统计第 N 周演示数值并汇总",
    "description": "已成功完成 3 次的重复任务",
    "occurrences": 3,
    "runIds": ["uuid", "uuid", "uuid"],
    "steps": ["调用 calculate"],
    "parameters": ["第 {1} 周"],
    "requiredTools": ["calculate@^1"],
    "riskCeiling": "read",
    "manifest": "id: experience.calculate.3f9a1c2d\n……",
    "skillMd": "# 统计第 N 周演示数值并汇总\n……"
  }
]
```

`manifest` 与 `skillMd` 已自检通过，可原样提交给 `POST /skills`。已存在同 slug 的 Skill 不再建议。

---

### POST `/skills` — 创建 Skill 及首个草稿版本（需认证）

**Request:** `{ "manifest": "…(≤20000 字符)", "skillMd": "…(≤100000 字符)" }`

**Response 201:** `Skill`

**Error 422:** manifest 解析失败，`detail` 是错误数组
**Error 409:** `SKILL_SLUG_ALREADY_EXISTS`

---

### POST `/skills/:id/versions` — 追加草稿版本（需认证）

**Request:** 同上。**Response 201:** `Skill`

**Error 404:** `SKILL_NOT_FOUND`
**Error 409:** `SKILL_VERSION_ALREADY_EXISTS` | `SKILL_MANIFEST_ID_MISMATCH`

---

### POST `/skills/:id/versions/:versionId/validate` — 验证版本（需认证）

校验声明的工具是否存在、版本区间是否匹配、`riskCeiling` 是否覆盖所需工具的风险。

**Response 200:** `SkillVersion`（`status` 变为 `validated` 或 `rejected`，失败原因在 `validationErrors`）

**Error 404:** `SKILL_VERSION_NOT_FOUND`　**Error 409:** `SKILL_VERSION_NOT_VALIDATABLE`

---

### POST `/skills/:id/versions/:versionId/evaluate` — 评测版本（需认证）

同步重放 6 条静态契约用例：`manifest_contract`、`content_integrity`、`tool_contract`、
`declared_tool_coverage`、`risk_ceiling_not_escalated`、`secret_scan`。

manifest 无法解析时，依赖它的用例**判失败而非跳过**——门禁 fail closed，不让通过率被跳过的用例抬高。
`secret_scan` 的 `detail` 只报命中的规则名，**不回显命中的内容**。

**Response 200:** `SkillEvaluation`（结构见 `GET /skills` 的 `latestEvaluation`）

**Error 404:** `SKILL_VERSION_NOT_FOUND`

---

### POST `/skills/:id/versions/:versionId/activate` — 激活版本（需认证）

**替换已有 active 版本时强制评测门禁**：该版本必须有一条 `passed` 评测。
首次激活不设门禁（没有可被弄坏的生产版本）。

**Response 200:** `Skill`

**Error 404:** `SKILL_VERSION_NOT_FOUND`
**Error 409:** `SKILL_VERSION_NOT_VALIDATED` | `SKILL_VERSION_EVALUATION_REQUIRED`（从未评测）|
`SKILL_VERSION_EVALUATION_FAILED`（最近一次评测未通过）

---

### POST `/skills/:id/versions/:versionId/rollback` — 回滚到历史版本（需认证）

**不设评测门禁**：回滚是评测回退时的恢复手段，再加门禁会把唯一的退路也堵上。

**Response 200:** `Skill`

**Error 404:** `SKILL_VERSION_NOT_FOUND`　**Error 409:** `SKILL_VERSION_NOT_ROLLBACKABLE`

---

### PUT `/skills/:id/installations` — 设置可用范围（需认证）

**Request:** `{ "scope": "assistant", "assistantId": "uuid" }`，`scope` 为 `global` | `assistant`。

**Response 200:** `SkillInstallation`

**Error 404:** `SKILL_OR_ASSISTANT_NOT_FOUND`
**Error 409:** `SKILL_ACTIVE_VERSION_REQUIRED` | `SKILL_ASSISTANT_REQUIRED` |
`SKILL_GLOBAL_INSTALLATION_CANNOT_TARGET_ASSISTANT`

---

## Webhook 接口

公网入口 `/webhooks/:publicId` 与管理接口 `/automations/:id/webhook` 分开：
**前者没有任何认证依赖**，身份完全由 HMAC 签名证明；后者走普通用户认证。

### POST `/webhooks/:publicId` — 接收第三方事件（**无认证**）

触发一次标准 Agent Run。

**Request Headers:**

```
X-YuanAi-Timestamp: 1759449600          # Unix 秒
X-YuanAi-Signature: <hex sha256 hmac>
```

**签名算法：**

```
signature = HMAC-SHA256(secret, f"{timestamp}.{raw_body}").hexdigest()
```

签名覆盖的是**原始请求体字节**。调用方不得重新序列化 JSON——键序或空格变化都会使签名失效。

**Request Body:** 任意 JSON 对象，最大 64 KB。内容作为上下文注入 Run，截断到 2000 字符。

**Response 202:**

```json
{ "automationRunId": "uuid", "status": "queued" }
```

响应体只回最小信息，**不回显 payload**，避免把外部数据变成反射面。

**校验顺序与错误：** 签名、时间戳窗口（默认 ±300 秒）、重放登记、限流（默认 60 次/分钟）
全部在创建 Run **之前**完成，任何一步失败都不创建 Run。守卫存储或密钥存储不可用时
**fail closed 返回 503**，而不是放行。

| HTTP | Code                                                       | 说明                               |
| ---- | ---------------------------------------------------------- | ---------------------------------- |
| 404  | `WEBHOOK_ENDPOINT_NOT_FOUND`                               | publicId 不存在或入口已删除        |
| 401  | `WEBHOOK_SIGNATURE_REQUIRED`                               | 缺签名或时间戳头                   |
| 401  | `WEBHOOK_TIMESTAMP_INVALID`                                | 时间戳格式错或超出容差窗口         |
| 401  | `WEBHOOK_SIGNATURE_INVALID`                                | 签名不匹配                         |
| 409  | `WEBHOOK_REPLAY_DETECTED`                                  | 同一签名已被使用过                 |
| 413  | `WEBHOOK_PAYLOAD_TOO_LARGE`                                | 请求体超过 64 KB                   |
| 422  | `WEBHOOK_PAYLOAD_INVALID`                                  | 请求体不是 JSON 对象               |
| 429  | `WEBHOOK_RATE_LIMITED`                                     | 超过该入口的分钟限流               |
| 503  | `WEBHOOK_GUARD_UNAVAILABLE` / `WEBHOOK_SECRET_UNAVAILABLE` | 守卫/密钥存储不可用（fail closed） |

---

### POST `/automations/:id/webhook` — 创建入口（需认证）

仅 webhook 触发型自动化可创建。

**Request（可选）:** `{ "rateLimitPerMinute": 60 }`，范围 1–600；省略请求体时取全局配置默认值。

**Response 201:**

```json
{
  "id": "uuid",
  "automationId": "uuid",
  "publicId": "wh_3f9a1c2d…",
  "secretPrefix": "whsec_3f9a",
  "isActive": true,
  "rateLimitPerMinute": 60,
  "lastUsedAt": null,
  "createdAt": "2026-10-03T00:00:00Z",
  "rotatedAt": null,
  "secret": "whsec_……"
}
```

**`secret` 明文只在创建与轮换的响应中出现一次**，此后无法再读取。

**Error 404:** `AUTOMATION_NOT_FOUND`　**Error 409:** 该自动化不是 webhook 触发型或入口已存在

---

### GET `/automations/:id/webhook` — 读取入口元数据（需认证）

**Response 200:** 同上但**没有 `secret`**，只有用于辨认的 `secretPrefix`。

**Error 404:** `AUTOMATION_NOT_FOUND` | `WEBHOOK_ENDPOINT_NOT_FOUND`

---

### POST `/automations/:id/webhook/rotate` — 轮换签名密钥（需认证）

旧密钥**立即失效**，用于泄漏后的应急轮换。

**Response 200:** 含一次性 `secret` 的完整对象。

---

### DELETE `/automations/:id/webhook` — 删除入口（需认证）

`publicId` 立即失效，后续投递返回 404。

**Response 204:** No Content

---

## 通用约定

### 分页规范

所有列表接口使用 cursor-based 分页（不使用 offset）：

```json
{
  "items": [...],
  "next_cursor": "base64编码的游标（null 表示没有更多）",
  "has_more": true
}
```

### 错误格式

```json
{
  "code": "CONVERSATION_NOT_FOUND",
  "message": "会话不存在或已被删除",
  "detail": null
}
```

### 错误码列表

| Code                               | HTTP | 描述                         |
| ---------------------------------- | ---- | ---------------------------- |
| `AUTH_TOKEN_INVALID`               | 401  | Token 无效                   |
| `AUTH_TOKEN_EXPIRED`               | 401  | Token 已过期                 |
| `AUTH_EMAIL_EXISTS`                | 409  | 邮箱已注册                   |
| `AUTH_USERNAME_EXISTS`             | 409  | 用户名已注册                 |
| `AUTH_PHONE_EXISTS`                | 409  | 手机号已绑定其他账号         |
| `AUTH_INVALID_CREDENTIALS`         | 401  | 邮箱或密码错误               |
| `AUTH_CODE_INVALID`                | 401  | 验证码错误                   |
| `AUTH_CODE_EXPIRED`                | 401  | 验证码已过期                 |
| `AUTH_QR_EXPIRED`                  | 404  | 二维码不存在或已过期         |
| `AUTH_PROVIDER_ALREADY_LINKED`     | 409  | 该第三方账号已绑定其他用户   |
| `AUTH_PROVIDER_NOT_LINKED`         | 400  | 该第三方账号未绑定，无法解绑 |
| `AUTH_DELETE_CONFIRMATION_INVALID` | 400  | 注销确认文本不匹配           |
| `CONVERSATION_NOT_FOUND`           | 404  | 会话不存在                   |
| `CONVERSATION_ACCESS_DENIED`       | 403  | 无权访问该会话               |
| `MODEL_NOT_AVAILABLE`              | 400  | 模型不可用                   |
| `MODEL_QUOTA_EXCEEDED`             | 429  | 模型调用额度超限             |
| `FILE_TOO_LARGE`                   | 400  | 文件超过大小限制             |
| `FILE_TYPE_NOT_SUPPORTED`          | 400  | 文件类型不支持               |
| `RATE_LIMIT_EXCEEDED`              | 429  | 请求频率超限                 |
| `INTERNAL_ERROR`                   | 500  | 服务器内部错误               |

知识库、Skill 与 Webhook 的错误码只在对应接口出现，列在各节内：
[知识库](#知识库接口-knowledge-bases)（`KNOWLEDGE_*`）、[Skill](#skill-接口-skills)（`SKILL_*`）、
[Webhook](#webhook-接口)（`WEBHOOK_*`）。入库作业的失败原因**不是 HTTP 错误码**，
而是 `IngestionJob.errorCode`，见 `POST /knowledge-bases/:id/sources/file`。

### 频率限制

| 接口                    | 限制                                  |
| ----------------------- | ------------------------------------- |
| `/auth/login`           | 10 次/分钟/IP                         |
| `/auth/login/phone`     | 10 次/分钟/IP                         |
| `/auth/register`        | 5 次/小时/IP                          |
| `/auth/phone/send-code` | 3 次/分钟/手机号                      |
| `/auth/me/email-code`   | 3 次/分钟/用户                        |
| `/auth/me/phone-code`   | 3 次/分钟/用户                        |
| `/chat/stream`          | 30 次/分钟/用户                       |
| `/files/upload`         | 20 次/分钟/用户                       |
| `/webhooks/:publicId`   | 60 次/分钟/入口（可按入口配置 1–600） |
| 其他 GET 接口           | 120 次/分钟/用户                      |
