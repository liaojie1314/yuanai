import secrets
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DB, CurrentUser
from app.core.security import hash_password, verify_password
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.share import ConversationShare
from app.models.user import User
from app.schemas.chat import (
    CreateShareRequest,
    MessageResponse,
    SharedConversationMetaResponse,
    SharedConversationResponse,
    ShareLinkResponse,
    UnlockShareRequest,
)

router = APIRouter(tags=["share"])


def _generate_token() -> str:
    """生成 URL 安全的 32 字符随机 token"""
    return secrets.token_urlsafe(24)


def _compute_expires_at(days: int | None) -> datetime | None:
    """把 expires_in_days 转成 UTC 时间戳；None/0 表示永久"""
    if not days:
        return None
    return datetime.now(UTC) + timedelta(days=days)


def _to_share_link(share: ConversationShare) -> ShareLinkResponse:
    return ShareLinkResponse(
        share_token=share.share_token,
        title_snapshot=share.title_snapshot,
        created_at=share.created_at,
        expires_at=share.expires_at,
        has_password=bool(share.password_hash),
    )


async def _get_user_conv(
    conv_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession
) -> Conversation:
    result = await db.execute(select(Conversation).where(Conversation.id == conv_id))
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(404, {"code": "CONVERSATION_NOT_FOUND", "message": "会话不存在"})
    if conv.user_id != user_id:
        raise HTTPException(403, {"code": "CONVERSATION_ACCESS_DENIED", "message": "无权访问"})
    return conv


@router.post(
    "/chat/conversations/{conv_id}/share",
    response_model=ShareLinkResponse,
    status_code=201,
)
async def create_share_link(
    conv_id: uuid.UUID,
    req: CreateShareRequest,
    current_user: CurrentUser,
    db: DB,
) -> ShareLinkResponse:
    """为指定会话生成公开分享链接。

    若已存在未撤销的分享，则复用现有 token 并按新参数刷新（有效期/密码/快照标题）。
    """
    conv = await _get_user_conv(conv_id, current_user.id, db)

    existing_result = await db.execute(
        select(ConversationShare)
        .where(ConversationShare.conv_id == conv.id)
        .where(ConversationShare.is_revoked.is_(False))
    )
    existing = existing_result.scalar_one_or_none()

    new_password_hash = hash_password(req.password) if req.password else None
    new_expires_at = _compute_expires_at(req.expires_in_days)

    if existing:
        existing.title_snapshot = conv.title
        existing.expires_at = new_expires_at
        # 只有请求里带了非空密码才更新；密码字段为 None 保持原有（可能是"不改"）
        if req.password is not None:
            existing.password_hash = new_password_hash
        await db.commit()
        await db.refresh(existing)
        return _to_share_link(existing)

    share = ConversationShare(
        conv_id=conv.id,
        user_id=current_user.id,
        share_token=_generate_token(),
        title_snapshot=conv.title,
        expires_at=new_expires_at,
        password_hash=new_password_hash,
    )
    db.add(share)
    await db.commit()
    await db.refresh(share)
    return _to_share_link(share)


@router.get("/chat/conversations/{conv_id}/share", response_model=ShareLinkResponse)
async def get_share_link(
    conv_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> ShareLinkResponse:
    """查询当前会话的活跃分享链接；不存在返回 404。"""
    await _get_user_conv(conv_id, current_user.id, db)

    result = await db.execute(
        select(ConversationShare)
        .where(ConversationShare.conv_id == conv_id)
        .where(ConversationShare.is_revoked.is_(False))
    )
    share = result.scalar_one_or_none()
    if not share:
        raise HTTPException(404, {"code": "SHARE_NOT_FOUND", "message": "尚未创建分享"})
    return _to_share_link(share)


@router.delete("/chat/conversations/{conv_id}/share", status_code=204)
async def revoke_share_link(
    conv_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> None:
    """撤销会话的所有活跃分享链接（不可再访问）。"""
    await _get_user_conv(conv_id, current_user.id, db)

    result = await db.execute(
        select(ConversationShare)
        .where(ConversationShare.conv_id == conv_id)
        .where(ConversationShare.is_revoked.is_(False))
    )
    shares = result.scalars().all()
    for share in shares:
        share.is_revoked = True
    await db.commit()


async def _load_share(share_token: str, db: AsyncSession) -> ConversationShare:
    result = await db.execute(
        select(ConversationShare).where(ConversationShare.share_token == share_token)
    )
    share = result.scalar_one_or_none()
    if not share or share.is_revoked:
        raise HTTPException(404, {"code": "SHARE_NOT_FOUND", "message": "分享链接不存在或已被撤销"})
    if share.expires_at and share.expires_at < datetime.now(UTC):
        raise HTTPException(410, {"code": "SHARE_EXPIRED", "message": "分享链接已过期"})
    return share


@router.get("/share/{share_token}/meta", response_model=SharedConversationMetaResponse)
async def get_shared_meta(share_token: str, db: DB) -> SharedConversationMetaResponse:
    """匿名获取分享链接的元信息（不含消息内容）。

    用于分享页首屏渲染标题 + 判断是否需要密码。
    """
    share = await _load_share(share_token, db)
    author_result = await db.execute(select(User).where(User.id == share.user_id))
    author = author_result.scalar_one_or_none()
    return SharedConversationMetaResponse(
        title=share.title_snapshot,
        author_username=author.username if author else "匿名用户",
        requires_password=bool(share.password_hash),
        expires_at=share.expires_at,
        shared_at=share.created_at,
    )


async def _load_share_conversation(
    share: ConversationShare, db: AsyncSession
) -> SharedConversationResponse:
    conv_result = await db.execute(select(Conversation).where(Conversation.id == share.conv_id))
    conv = conv_result.scalar_one_or_none()
    if not conv:
        raise HTTPException(404, {"code": "CONVERSATION_NOT_FOUND", "message": "原会话已被删除"})

    author_result = await db.execute(select(User).where(User.id == share.user_id))
    author = author_result.scalar_one_or_none()
    author_name = author.username if author else "匿名用户"

    msg_result = await db.execute(
        select(Message)
        .where(Message.conv_id == conv.id)
        .order_by(Message.created_at, Message.id)
        .limit(2000)
    )
    messages = msg_result.scalars().all()

    return SharedConversationResponse(
        title=share.title_snapshot or conv.title,
        model=conv.model,
        messages=[MessageResponse.model_validate(m) for m in messages],
        shared_at=share.created_at,
        author_username=author_name,
        expires_at=share.expires_at,
    )


@router.get("/share/{share_token}", response_model=SharedConversationResponse)
async def get_shared_conversation(share_token: str, db: DB) -> SharedConversationResponse:
    """匿名读取分享会话的完整消息内容。

    此接口 **不需要认证**，是公开只读入口。
    - 分享不存在 / 已撤销 → 404
    - 已过期 → 410
    - 需要密码 → 403（前端应改用 POST /unlock）
    """
    share = await _load_share(share_token, db)
    if share.password_hash:
        raise HTTPException(
            403,
            {"code": "SHARE_PASSWORD_REQUIRED", "message": "该分享需要密码"},
        )
    return await _load_share_conversation(share, db)


@router.post("/share/{share_token}/unlock", response_model=SharedConversationResponse)
async def unlock_shared_conversation(
    share_token: str, req: UnlockShareRequest, db: DB
) -> SharedConversationResponse:
    """校验分享密码，通过后返回完整会话内容。"""
    share = await _load_share(share_token, db)
    if not share.password_hash:
        # 无密码的分享直接返回内容
        return await _load_share_conversation(share, db)
    if not verify_password(req.password, share.password_hash):
        raise HTTPException(
            403,
            {"code": "SHARE_PASSWORD_INVALID", "message": "访问密码错误"},
        )
    return await _load_share_conversation(share, db)
