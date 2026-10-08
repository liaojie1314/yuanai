"""助理的默认实例保障：没有助理的用户在首次访问时自动获得一个。"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assistant import Assistant

DEFAULT_ASSISTANT_NAME = "我的助理"
# 必须是 ai_service.PROVIDER_CONFIG 的键，否则这个助理一开口就路由不到供应商。
DEFAULT_ASSISTANT_MODEL = "deepseek-v4-flash"


async def ensure_default_assistant(*, user_id: uuid.UUID, db: AsyncSession) -> Assistant:
    """返回该用户的默认助理，没有就现建一个。

    懒建而不是挂注册钩子：注册、OAuth、Google 原生、扫码登录是四条建用户的路，
    挂钩子要挂四处，还得为存量用户另写回填迁移。
    并发由 ``uq_assistants_user_default`` 唯一索引兜住，撞了就回滚重查。
    """

    existing = await _pick(user_id=user_id, db=db)
    if existing is not None:
        return existing
    assistant = Assistant(
        user_id=user_id,
        name=DEFAULT_ASSISTANT_NAME,
        default_model=DEFAULT_ASSISTANT_MODEL,
        is_default=True,
    )
    db.add(assistant)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raced = await _pick(user_id=user_id, db=db)
        if raced is None:
            raise
        return raced
    return assistant


async def _pick(*, user_id: uuid.UUID, db: AsyncSession) -> Assistant | None:
    """取默认助理；没有标记默认的就取最早创建的那个。"""

    picked: Assistant | None = await db.scalar(
        select(Assistant)
        .where(Assistant.user_id == user_id)
        .order_by(Assistant.is_default.desc(), Assistant.created_at)
        .limit(1)
    )
    return picked
