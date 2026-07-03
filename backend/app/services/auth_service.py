import uuid

from sqlalchemy import func, select
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
from app.models.conversation import Conversation
from app.models.file import File
from app.models.message import Message, MessageRole
from app.models.user import User
from app.schemas.auth import (
    AuthResponse,
    RegisterRequest,
    ResetPasswordRequest,
    UserResponse,
    UserStatsResponse,
)
from app.services import verify_code_service


async def register(req: RegisterRequest, db: AsyncSession) -> AuthResponse:
    """注册新用户，先校验邮箱验证码，再检查邮箱/用户名唯一性。

    Raises:
        VerifyCodeError: 验证码错误或已过期
        ValueError("EMAIL_OR_USERNAME_EXISTS"): 唯一性冲突
    """
    # 先校验验证码；失败时不写库
    await verify_code_service.verify_code(req.email, req.verify_code, scene="register")

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


async def get_stats(user_id: uuid.UUID, db: AsyncSession) -> UserStatsResponse:
    """获取用户使用统计：对话数、消耗 token 总量、上传文件数。"""
    conv_count_row = await db.execute(
        select(func.count()).select_from(Conversation).where(Conversation.user_id == user_id)
    )
    conversation_count = conv_count_row.scalar_one()

    token_row = await db.execute(
        select(func.coalesce(func.sum(Message.tokens_used), 0))
        .join(Conversation, Message.conv_id == Conversation.id)
        .where(Conversation.user_id == user_id, Message.role == MessageRole.assistant)
    )
    total_tokens = token_row.scalar_one()

    file_count_row = await db.execute(
        select(func.count()).select_from(File).where(File.user_id == user_id)
    )
    file_count = file_count_row.scalar_one()

    return UserStatsResponse(
        conversation_count=conversation_count,
        total_tokens=int(total_tokens),
        file_count=file_count,
    )


async def change_password(
    user: User, old_password: str, new_password: str, db: AsyncSession
) -> None:
    """验证旧密码后更新为新密码。"""
    if not verify_password(old_password, user.hashed_password):
        raise ValueError("OLD_PASSWORD_WRONG")
    user.hashed_password = hash_password(new_password)
    await db.commit()


async def reset_password(req: ResetPasswordRequest, db: AsyncSession) -> None:
    """通过邮箱验证码重置密码。

    Raises:
        VerifyCodeError: 验证码错误或已过期
        ValueError("EMAIL_NOT_FOUND"): 邮箱未注册
    """
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    if not user:
        raise ValueError("EMAIL_NOT_FOUND")

    # 校验验证码（一次性，通过后立即删除）
    await verify_code_service.verify_code(req.email, req.verify_code, scene="reset_password")

    user.hashed_password = hash_password(req.new_password)
    await db.commit()

    # 密码变更后同时撤销所有 refresh token，强制其他设备重新登录
    await redis_client.delete(f"refresh:{user.id}")


async def delete_account(user: User, db: AsyncSession) -> None:
    """永久删除账号及所有关联数据（CASCADE 处理关联表）。"""
    await db.delete(user)
    await db.commit()


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
