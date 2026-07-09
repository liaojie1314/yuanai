# Phase 1 — 后端核心开发

**前置条件**: Phase 0 完成，`docker-compose up -d` 启动了 PostgreSQL / Redis / MinIO  
**分支**: `feat/phase-1-backend`  
**执行范围**: 仅操作 `backend/` 目录

---

## 目标

实现完整的后端 API，包括：

1. 数据库模型 + 迁移
2. 认证系统（注册/登录/JWT/刷新）
3. 会话与消息 CRUD
4. AI 流式对话接口（SSE）
5. 文件上传接口
6. 模型列表接口

---

## Step 1：核心配置（core/）

### `backend/app/core/config.py`

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # App
    app_name: str = "yuanai API"
    debug: bool = False

    # Database
    database_url: str

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # JWT
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30

    # S3
    s3_endpoint_url: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket_name: str = "yuanai-files"
    s3_public_url: str = "http://localhost:9000/yuanai-files"

    # AI Providers
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    deepseek_api_key: str = ""


settings = Settings()  # type: ignore[call-arg]
```

### `backend/app/core/database.py`

```python
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_size=10,
    max_overflow=20,
)

AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
```

### `backend/app/core/security.py`

```python
from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    return jwt.encode(
        {"sub": subject, "exp": expire, "type": "access"},
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


def create_refresh_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        days=settings.refresh_token_expire_days
    )
    return jwt.encode(
        {"sub": subject, "exp": expire, "type": "refresh"},
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


def decode_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]
        )
    except JWTError as e:
        raise ValueError("Invalid token") from e
    return payload
```

### `backend/app/core/redis.py`

```python
from redis.asyncio import Redis

from app.core.config import settings

redis_client: Redis = Redis.from_url(settings.redis_url, decode_responses=True)
```

---

## Step 2：数据库模型（models/）

### `backend/app/models/__init__.py`

```python
from app.models.conversation import Conversation
from app.models.file import File, MessageFile
from app.models.message import Message
from app.models.user import User

__all__ = ["User", "Conversation", "Message", "File", "MessageFile"]
```

### `backend/app/models/user.py`

```python
import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    # 纯 OAuth 注册的用户没有本地密码，允许 NULL
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    # 三方登录关联：GitHub 用户 id（字符串化，唯一）
    github_id: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
```

### `backend/app/models/conversation.py`

```python
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="新对话")
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
```

### `backend/app/models/message.py`

```python
import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class MessageRole(str, enum.Enum):
    user = "user"
    assistant = "assistant"
    system = "system"


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    conv_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[MessageRole] = mapped_column(Enum(MessageRole), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str | None] = mapped_column(String(100))
    tokens_used: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
```

### `backend/app/models/file.py`

```python
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class File(Base):
    __tablename__ = "files"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    s3_key: Mapped[str] = mapped_column(String(500), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class MessageFile(Base):
    __tablename__ = "message_files"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), index=True
    )
    file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
```

---

## Step 3：Pydantic Schemas（schemas/）

### `backend/app/schemas/auth.py`

```python
import re
import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, field_validator


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    username: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("密码至少 8 位")
        if not re.search(r"[A-Za-z]", v) or not re.search(r"\d", v):
            raise ValueError("密码须包含字母和数字")
        return v

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        if not re.match(r"^[a-zA-Z0-9_一-鿿]{2,20}$", v):
            raise ValueError("用户名 2-20 位，支持中英文、数字、下划线")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    username: str
    avatar_url: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserResponse


class UpdateUserRequest(BaseModel):
    username: str | None = None
    avatar_url: str | None = None
```

### `backend/app/schemas/chat.py`

```python
import uuid
from datetime import datetime

from pydantic import BaseModel


class CreateConversationRequest(BaseModel):
    model: str
    title: str = "新对话"


class UpdateConversationRequest(BaseModel):
    title: str | None = None
    model: str | None = None
    is_pinned: bool | None = None


class ConversationResponse(BaseModel):
    id: uuid.UUID
    title: str
    model: str
    is_pinned: bool
    last_message_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageFileResponse(BaseModel):
    id: uuid.UUID
    filename: str
    mime_type: str
    size_bytes: int
    url: str

    model_config = {"from_attributes": True}


class MessageResponse(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    model: str | None = None
    tokens_used: int | None = None
    files: list[MessageFileResponse] = []
    created_at: datetime

    model_config = {"from_attributes": True}


class SendMessageRequest(BaseModel):
    conversation_id: uuid.UUID
    model: str
    message: "MessageContent"


class MessageContent(BaseModel):
    content: str
    file_ids: list[uuid.UUID] = []
```

---

## Step 4：服务层（services/）

### `backend/app/services/ai_service.py`

```python
from collections.abc import AsyncGenerator

from openai import AsyncOpenAI

from app.core.config import settings

PROVIDER_CONFIG: dict[str, dict[str, str]] = {
    "gpt-4o":                    {"provider": "openai",    "base_url": "https://api.openai.com/v1"},
    "gpt-4o-mini":               {"provider": "openai",    "base_url": "https://api.openai.com/v1"},
    "claude-3-5-sonnet-20241022":{"provider": "anthropic", "base_url": "https://api.anthropic.com/v1"},
    "deepseek-chat":             {"provider": "deepseek",  "base_url": "https://api.deepseek.com/v1"},
    "qwen-plus":                 {"provider": "qwen",      "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1"},
}

API_KEYS: dict[str, str] = {
    "openai":    settings.openai_api_key,
    "anthropic": settings.anthropic_api_key,
    "deepseek":  settings.deepseek_api_key,
    "qwen":      "",  # 通过 DASHSCOPE_API_KEY 环境变量
}

AVAILABLE_MODELS = [
    {
        "id": "gpt-4o",
        "name": "GPT-4o",
        "provider": "openai",
        "description": "OpenAI 最强多模态模型",
        "supports_vision": True,
        "supports_files": True,
        "context_length": 128000,
        "is_default": True,
    },
    {
        "id": "claude-3-5-sonnet-20241022",
        "name": "Claude 3.5 Sonnet",
        "provider": "anthropic",
        "description": "Anthropic 旗舰推理模型",
        "supports_vision": True,
        "supports_files": True,
        "context_length": 200000,
        "is_default": False,
    },
    {
        "id": "deepseek-chat",
        "name": "DeepSeek V4",
        "provider": "deepseek",
        "description": "高性价比国产大模型",
        "supports_vision": False,
        "supports_files": False,
        "context_length": 64000,
        "is_default": False,
    },
]


async def stream_chat(
    model: str,
    messages: list[dict[str, object]],
) -> AsyncGenerator[str, None]:
    config = PROVIDER_CONFIG.get(model)
    if not config:
        raise ValueError(f"Unsupported model: {model}")

    client = AsyncOpenAI(
        api_key=API_KEYS[config["provider"]],
        base_url=config["base_url"],
    )

    stream = await client.chat.completions.create(
        model=model,
        messages=messages,  # type: ignore[arg-type]
        stream=True,
    )

    async for chunk in stream:
        delta = chunk.choices[0].delta if chunk.choices else None
        if delta and delta.content:
            yield delta.content
```

### `backend/app/services/auth_service.py`

```python
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis import redis_client
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.schemas.auth import AuthResponse, RegisterRequest, UserResponse


async def register(req: RegisterRequest, db: AsyncSession) -> AuthResponse:
    # 检查邮箱/用户名唯一性
    existing = await db.execute(
        select(User).where(
            (User.email == req.email) | (User.username == req.username)
        )
    )
    if existing.scalar_one_or_none():
        raise ValueError("EMAIL_OR_USERNAME_EXISTS")

    user = User(
        email=req.email,
        username=req.username,
        hashed_password=hash_password(req.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _build_auth_response(user)


async def login(email: str, password: str, db: AsyncSession) -> AuthResponse:
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(password, user.hashed_password):
        raise ValueError("INVALID_CREDENTIALS")
    return _build_auth_response(user)


async def refresh_token(refresh_token: str) -> str:
    payload = decode_token(refresh_token)
    if payload.get("type") != "refresh":
        raise ValueError("Invalid token type")

    user_id = payload["sub"]
    stored = await redis_client.get(f"refresh:{user_id}")
    if stored != refresh_token:
        raise ValueError("Refresh token revoked")

    return create_access_token(str(user_id))


async def logout(user_id: uuid.UUID) -> None:
    await redis_client.delete(f"refresh:{user_id!s}")


def _build_auth_response(user: User) -> AuthResponse:
    access_token = create_access_token(str(user.id))
    refresh_token = create_refresh_token(str(user.id))

    # 异步存储 refresh token 到 Redis（此处简化，实际需 await）
    import asyncio

    async def _store() -> None:
        from app.core.config import settings

        await redis_client.setex(
            f"refresh:{user.id}",
            settings.refresh_token_expire_days * 86400,
            refresh_token,
        )

    asyncio.create_task(_store())

    return AuthResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserResponse.model_validate(user),
    )
```

### `backend/app/services/oauth_service.py`

三方登录（GitHub 已落地，Google / 微信 规划中）。以 GitHub 为例：

- **`build_github_authorize_url()`** — 生成随机 state 写 Redis（TTL 5 分钟），返回 GitHub authorize URL。
- **`_exchange_code_for_token(code)`** — POST `github.com/login/oauth/access_token` 换 access_token；`httpx.RequestError` → 抛 `OAuthFlowError("OAUTH_NETWORK_ERROR")` 避免跨境网络失败裸露成 500。
- **`_fetch_github_profile(token)`** — GET `/user` + `/user/emails` 拿 primary email；无邮箱 → `OAUTH_EMAIL_UNAVAILABLE`。
- **`_link_or_create_user(profile, db)`** — 按 `github_id → email` 查找账号：命中 → 直接返回；仅 email 命中 → 补写 `github_id` 完成关联；都没有 → 新建（`hashed_password=NULL`），username 从 GitHub `login` 生成，冲突加数字后缀。
- **`complete_github_callback(code, state, db)`** — 编排以上四步 + 复用 `auth_service.build_auth_response` 签发 JWT。
- **`build_frontend_redirect(resp)` / `build_frontend_error_redirect(code, msg)`** — 拼 `{WEB_APP_URL}/oauth/callback?...` 供 302。

state 一次性消费 + `_verify_state` 立即 `DELETE` Redis key，防止重放。

配置见 `docs-internal/oauth-setup.md`。

---

## Step 5：路由层（api/v1/）

### `backend/app/api/deps.py`

```python
import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import User

security = HTTPBearer()


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    token = credentials.credentials
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise ValueError("Wrong token type")
        user_id = uuid.UUID(str(payload["sub"]))
    except (ValueError, KeyError) as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "AUTH_TOKEN_INVALID", "message": "Token 无效"},
        ) from e

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "AUTH_TOKEN_INVALID", "message": "用户不存在"},
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]
```

### `backend/app/api/v1/auth.py`

```python
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, DB
from app.schemas.auth import (
    AuthResponse,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    UpdateUserRequest,
    UserResponse,
)
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(req: RegisterRequest, db: DB) -> AuthResponse:
    try:
        return await auth_service.register(req, db)
    except ValueError as e:
        code = str(e)
        if code == "EMAIL_OR_USERNAME_EXISTS":
            raise HTTPException(409, {"code": code, "message": "邮箱或用户名已被注册"}) from e
        raise HTTPException(500, {"code": "INTERNAL_ERROR", "message": "注册失败"}) from e


@router.post("/login", response_model=AuthResponse)
async def login(req: LoginRequest, db: DB) -> AuthResponse:
    try:
        return await auth_service.login(req.email, req.password, db)
    except ValueError as e:
        raise HTTPException(
            401, {"code": "AUTH_INVALID_CREDENTIALS", "message": "邮箱或密码错误"}
        ) from e


@router.post("/refresh")
async def refresh(req: RefreshRequest) -> dict[str, str]:
    try:
        access_token = await auth_service.refresh_token(req.refresh_token)
        return {"access_token": access_token, "token_type": "bearer"}
    except ValueError as e:
        raise HTTPException(
            401, {"code": "AUTH_TOKEN_INVALID", "message": "Refresh token 无效"}
        ) from e


@router.post("/logout", status_code=200)
async def logout(current_user: CurrentUser) -> dict[str, str]:
    await auth_service.logout(current_user.id)
    return {"message": "已退出登录"}


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: CurrentUser) -> UserResponse:
    return UserResponse.model_validate(current_user)


# ── 三方登录：GitHub OAuth ──────────────────────────────────
# 完整流程见 backend/app/services/oauth_service.py 与
# docs-internal/oauth-setup.md
@router.get("/github")
async def github_authorize() -> RedirectResponse:
    """302 到 GitHub 授权页；state 写 Redis 供 callback 校验。"""
    url = await oauth_service.build_github_authorize_url()
    return RedirectResponse(url, status_code=302)


@router.get("/github/callback")
async def github_callback(
    db: DB, code: str | None = None, state: str | None = None
) -> RedirectResponse:
    """GitHub 302 回此。失败 → 前端 /oauth/callback?error=...；成功 → 前端 /oauth/callback?access_token=..."""
    resp = await oauth_service.complete_github_callback(code, state, db)
    return RedirectResponse(oauth_service.build_frontend_redirect(resp), 302)


@router.delete("/me/github", response_model=UserResponse)
async def unlink_github(current_user: CurrentUser, db: DB) -> UserResponse:
    """解绑；纯 OAuth 用户（无 hashed_password）拒绝，避免账号失去所有登录途径。"""
    ...
```

### `backend/app/api/v1/chat.py`（关键流式接口）

```python
import json
import uuid
from collections.abc import AsyncGenerator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.api.deps import CurrentUser, DB
from app.models.conversation import Conversation
from app.models.message import Message, MessageRole
from app.schemas.chat import (
    ConversationResponse,
    CreateConversationRequest,
    MessageResponse,
    SendMessageRequest,
    UpdateConversationRequest,
)
from app.services.ai_service import stream_chat

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("/conversations", response_model=ConversationResponse, status_code=201)
async def create_conversation(
    req: CreateConversationRequest, current_user: CurrentUser, db: DB
) -> ConversationResponse:
    conv = Conversation(user_id=current_user.id, model=req.model, title=req.title)
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return ConversationResponse.model_validate(conv)


@router.get("/conversations", response_model=dict)
async def list_conversations(current_user: CurrentUser, db: DB) -> dict:
    result = await db.execute(
        select(Conversation)
        .where(Conversation.user_id == current_user.id)
        .order_by(Conversation.is_pinned.desc(), Conversation.updated_at.desc())
        .limit(50)
    )
    conversations = result.scalars().all()
    return {
        "conversations": [ConversationResponse.model_validate(c) for c in conversations],
        "next_cursor": None,
        "has_more": False,
    }


@router.patch("/conversations/{conv_id}", response_model=ConversationResponse)
async def update_conversation(
    conv_id: uuid.UUID, req: UpdateConversationRequest, current_user: CurrentUser, db: DB
) -> ConversationResponse:
    conv = await _get_user_conv(conv_id, current_user.id, db)
    if req.title is not None:
        conv.title = req.title
    if req.model is not None:
        conv.model = req.model
    if req.is_pinned is not None:
        conv.is_pinned = req.is_pinned
    await db.commit()
    await db.refresh(conv)
    return ConversationResponse.model_validate(conv)


@router.delete("/conversations/{conv_id}", status_code=204)
async def delete_conversation(
    conv_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> None:
    conv = await _get_user_conv(conv_id, current_user.id, db)
    await db.delete(conv)
    await db.commit()


@router.get("/conversations/{conv_id}/messages")
async def list_messages(conv_id: uuid.UUID, current_user: CurrentUser, db: DB) -> dict:
    await _get_user_conv(conv_id, current_user.id, db)
    result = await db.execute(
        select(Message)
        .where(Message.conv_id == conv_id)
        .order_by(Message.created_at)
        .limit(200)
    )
    messages = result.scalars().all()
    return {
        "messages": [MessageResponse.model_validate(m) for m in messages],
        "next_cursor": None,
        "has_more": False,
    }


@router.post("/stream")
async def stream_chat_endpoint(
    req: SendMessageRequest, current_user: CurrentUser, db: DB
) -> StreamingResponse:
    conv = await _get_user_conv(req.conversation_id, current_user.id, db)

    # 保存用户消息
    user_msg = Message(
        conv_id=conv.id,
        role=MessageRole.user,
        content=req.message.content,
    )
    db.add(user_msg)

    # 创建 assistant 消息占位
    assistant_msg = Message(
        conv_id=conv.id,
        role=MessageRole.assistant,
        content="",
        model=req.model,
    )
    db.add(assistant_msg)
    await db.commit()
    await db.refresh(user_msg)
    await db.refresh(assistant_msg)

    # 构建历史消息
    history_result = await db.execute(
        select(Message)
        .where(Message.conv_id == conv.id)
        .order_by(Message.created_at)
        .limit(50)
    )
    history = history_result.scalars().all()
    openai_messages = [{"role": m.role.value, "content": m.content} for m in history]

    return StreamingResponse(
        _generate_sse(openai_messages, req.model, assistant_msg.id, user_msg.id, db),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _generate_sse(
    messages: list[dict],
    model: str,
    assistant_msg_id: uuid.UUID,
    user_msg_id: uuid.UUID,
    db: DB,
) -> AsyncGenerator[str, None]:
    yield f"event: message_start\ndata: {json.dumps({'user_message_id': str(user_msg_id), 'assistant_message_id': str(assistant_msg_id), 'model': model})}\n\n"

    full_content = ""
    try:
        async for token in stream_chat(model, messages):
            full_content += token
            yield f"event: content_delta\ndata: {json.dumps({'token': token})}\n\n"

        # 更新 assistant 消息内容
        result = await db.execute(select(Message).where(Message.id == assistant_msg_id))
        msg = result.scalar_one()
        msg.content = full_content
        await db.commit()

        yield f"event: message_end\ndata: {json.dumps({'tokens_used': 0, 'finish_reason': 'stop'})}\n\n"
    except Exception as e:
        yield f"event: error\ndata: {json.dumps({'code': 'STREAM_ERROR', 'message': str(e)})}\n\n"

    yield "data: [DONE]\n\n"


async def _get_user_conv(conv_id: uuid.UUID, user_id: uuid.UUID, db: DB) -> Conversation:
    result = await db.execute(select(Conversation).where(Conversation.id == conv_id))
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(404, {"code": "CONVERSATION_NOT_FOUND", "message": "会话不存在"})
    if conv.user_id != user_id:
        raise HTTPException(403, {"code": "CONVERSATION_ACCESS_DENIED", "message": "无权访问"})
    return conv
```

### `backend/app/api/v1/models.py`

```python
from fastapi import APIRouter

from app.api.deps import CurrentUser
from app.services.ai_service import AVAILABLE_MODELS

router = APIRouter(prefix="/models", tags=["models"])


@router.get("")
async def list_models(current_user: CurrentUser) -> dict:
    return {"models": AVAILABLE_MODELS}
```

---

## Step 6：注册路由（更新 main.py）

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import auth, chat, models

app = FastAPI(title="yuanai API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(chat.router, prefix="/api/v1")
app.include_router(models.router, prefix="/api/v1")


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}
```

---

## Step 7：数据库迁移（Alembic）

```bash
cd backend
uv run alembic init alembic

# 编辑 alembic/env.py，添加 target_metadata：
# from app.models import Base  (导入所有模型触发注册)
# target_metadata = Base.metadata

uv run alembic revision --autogenerate -m "initial schema"
uv run alembic upgrade head
```

---

## Step 8：基础测试

创建 `backend/tests/test_auth.py`：

```python
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def test_health(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_register(client: AsyncClient) -> None:
    response = await client.post("/api/v1/auth/register", json={
        "email": "test@example.com",
        "password": "Test1234!",
        "username": "testuser",
    })
    assert response.status_code == 201
    data = response.json()
    assert "access_token" in data
    assert data["user"]["email"] == "test@example.com"
```

运行测试：

```bash
cd backend
uv run pytest tests/ -v
```

---

## 验收标准

1. `GET /health` → `{"status": "ok"}`
2. `POST /api/v1/auth/register` → 返回 tokens + user
3. `POST /api/v1/auth/login` → 返回 tokens + user
4. `GET /api/v1/models` → 返回模型列表（需 Bearer token）
5. `POST /api/v1/chat/conversations` → 创建会话
6. `POST /api/v1/chat/stream` → 返回 SSE 流（可用 curl 测试）
7. `uv run pytest tests/ -v` → 全部通过
