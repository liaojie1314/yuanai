import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
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
    """注册新用户，检查邮箱/用户名唯一性。"""
    existing = await db.execute(
        select(User).where((User.email == req.email) | (User.username == req.username))
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
    return await _build_auth_response(user)


async def login(email: str, password: str, db: AsyncSession) -> AuthResponse:
    """邮箱 + 密码登录，返回 token 对。"""
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(password, user.hashed_password):
        raise ValueError("INVALID_CREDENTIALS")
    return await _build_auth_response(user)


async def refresh_token(token: str) -> str:
    """用 refresh token 换取新的 access token。"""
    payload = decode_token(token)
    if payload.get("type") != "refresh":
        raise ValueError("Invalid token type")

    user_id = payload["sub"]
    stored = await redis_client.get(f"refresh:{user_id}")
    if stored != token:
        raise ValueError("Refresh token revoked")

    return create_access_token(str(user_id))


async def logout(user_id: uuid.UUID) -> None:
    """撤销 refresh token，使当前设备会话失效。"""
    await redis_client.delete(f"refresh:{user_id!s}")


async def _build_auth_response(user: User) -> AuthResponse:
    """构建 AuthResponse 并将 refresh token 存入 Redis。"""
    access_token = create_access_token(str(user.id))
    token = create_refresh_token(str(user.id))

    await redis_client.setex(
        f"refresh:{user.id}",
        settings.refresh_token_expire_days * 86400,
        token,
    )

    return AuthResponse(
        access_token=access_token,
        refresh_token=token,
        user=UserResponse.model_validate(user),
    )
