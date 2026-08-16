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

# 错误事件
event: error
data: {"code":"MODEL_QUOTA_EXCEEDED","message":"模型调用额度不足"}

# 流结束
data: [DONE]
```

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

### 频率限制

| 接口                    | 限制             |
| ----------------------- | ---------------- |
| `/auth/login`           | 10 次/分钟/IP    |
| `/auth/login/phone`     | 10 次/分钟/IP    |
| `/auth/register`        | 5 次/小时/IP     |
| `/auth/phone/send-code` | 3 次/分钟/手机号 |
| `/auth/me/email-code`   | 3 次/分钟/用户   |
| `/auth/me/phone-code`   | 3 次/分钟/用户   |
| `/chat/stream`          | 30 次/分钟/用户  |
| `/files/upload`         | 20 次/分钟/用户  |
| 其他 GET 接口           | 120 次/分钟/用户 |
