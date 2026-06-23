# API 设计规范

**Base URL**: `https://api.yuanai.app/api/v1`（开发环境：`http://localhost:8000/api/v1`）

**所有请求头**:

```
Content-Type: application/json
Authorization: Bearer <access_token>   （除登录/注册外必须携带）
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

**Error 409:** 邮箱/用户名已存在

---

### POST `/auth/login` — 登录

**Request:**

```json
{
  "email": "user@example.com",
  "password": "Abcd1234!"
}
```

**Response 200:** 同注册 201 结构

**Error 401:** 邮箱或密码错误

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

吊销 refresh_token（从 Redis 删除）

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

---

### PATCH `/auth/me` — 更新用户信息（需认证）

**Request:**

```json
{
  "username": "new_name", // 可选
  "avatar_url": "https://..." // 可选
}
```

**Response 200:** 更新后的用户对象

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
      "name": "DeepSeek V3",
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
  "title": "新对话" // 可选，默认"新对话"
}
```

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

### POST `/chat/stream` — 流式对话（SSE，需认证）

这是核心接口，返回 Server-Sent Events 流。

**Request:**

```json
{
  "conversation_id": "uuid", // 已有会话 ID
  "model": "gpt-4o", // 本次使用的模型（可覆盖会话默认）
  "message": {
    "content": "请解释什么是 RAG",
    "file_ids": ["uuid1", "uuid2"] // 可选，本次消息附带的文件
  }
}
```

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

# 消息结束（包含完整统计）
event: message_end
data: {"tokens_used":256,"finish_reason":"stop"}

# 错误事件
event: error
data: {"code":"MODEL_QUOTA_EXCEEDED","message":"模型调用额度不足"}

# 流结束
data: [DONE]
```

**Error 400:** conversation_id 不存在或不属于当前用户

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

| Code                         | HTTP | 描述             |
| ---------------------------- | ---- | ---------------- |
| `AUTH_TOKEN_INVALID`         | 401  | Token 无效       |
| `AUTH_TOKEN_EXPIRED`         | 401  | Token 已过期     |
| `AUTH_EMAIL_EXISTS`          | 409  | 邮箱已注册       |
| `AUTH_USERNAME_EXISTS`       | 409  | 用户名已注册     |
| `AUTH_INVALID_CREDENTIALS`   | 401  | 邮箱或密码错误   |
| `CONVERSATION_NOT_FOUND`     | 404  | 会话不存在       |
| `CONVERSATION_ACCESS_DENIED` | 403  | 无权访问该会话   |
| `MODEL_NOT_AVAILABLE`        | 400  | 模型不可用       |
| `MODEL_QUOTA_EXCEEDED`       | 429  | 模型调用额度超限 |
| `FILE_TOO_LARGE`             | 400  | 文件超过大小限制 |
| `FILE_TYPE_NOT_SUPPORTED`    | 400  | 文件类型不支持   |
| `RATE_LIMIT_EXCEEDED`        | 429  | 请求频率超限     |
| `INTERNAL_ERROR`             | 500  | 服务器内部错误   |

### 频率限制

| 接口             | 限制             |
| ---------------- | ---------------- |
| `/auth/login`    | 10 次/分钟/IP    |
| `/auth/register` | 5 次/小时/IP     |
| `/chat/stream`   | 30 次/分钟/用户  |
| `/files/upload`  | 20 次/分钟/用户  |
| 其他 GET 接口    | 120 次/分钟/用户 |
