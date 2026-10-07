"""首问会话标题的降级生成与无竞争持久化。"""

import logging
import re
import uuid
from datetime import UTC, datetime
from typing import TypedDict

from sqlalchemy import update
from sqlalchemy.exc import SQLAlchemyError

import app.services.ai_service as ai_service
from app.core.database import AsyncSessionLocal
from app.models.conversation import Conversation

logger = logging.getLogger(__name__)

FALLBACK_TITLE_MAX_LENGTH = 48
AI_TITLE_MAX_LENGTH = 24


class ConversationTitleResult(TypedDict):
    """可安全发送到客户端的 AI 标题更新。"""

    conversation_id: str
    title: str
    title_source: str
    title_generated_at: str


def _normalize_title(value: str, max_length: int) -> str:
    """移除控制字符并在稳定字符边界截断标题。"""
    normalized = re.sub(r"[\x00-\x1f\x7f]+", " ", value)
    normalized = " ".join(normalized.replace("\u201c", "").replace("\u201d", "").split())
    normalized = normalized.strip(" '\"`，,。；;：:")
    if len(normalized) <= max_length:
        return normalized
    return f"{normalized[: max_length - 1].rstrip()}…"


def fallback_title(question: str) -> str:
    """从首问同步生成不依赖模型的侧栏回退标题。"""
    return _normalize_title(question, FALLBACK_TITLE_MAX_LENGTH) or "新对话"


async def generate_title_for_first_question(question: str) -> str | None:
    """请求 Agnes 标题并清洗结果；无有效结果时返回 ``None``。"""
    result = await ai_service.generate_conversation_title(question)
    if result is None:
        return None
    title = _normalize_title(result, AI_TITLE_MAX_LENGTH)
    return title or None


async def generate_and_store_title(
    conversation_id: uuid.UUID, question: str
) -> ConversationTitleResult | None:
    """在独立数据库会话中保存标题结果，且绝不覆盖手动重命名。

    ``title_source='fallback'`` 是乐观比较条件。用户在生成期间改名会先写入
    ``manual``，此 SQL 更新的 rowcount 变为零，从而自然保留用户标题。

    生成失败时必须把 ``title_source`` 推进到 ``fallback_final``：客户端把
    ``fallback`` 读作「AI 标题还在路上」并据此转圈，停在这个值上等于让转圈
    没有退出条件，一直转到用户重进会话为止。
    """
    title = await generate_title_for_first_question(question)
    generated_at = datetime.now(UTC)
    succeeded = title is not None
    title_source = "ai" if succeeded else "fallback_final"
    values: dict[str, object] = (
        {"title": title, "title_source": title_source, "title_generated_at": generated_at}
        if succeeded
        # 失败时只推进来源：标题文本仍是首问回退值，改写时间戳会谎报「刚刚定下」。
        else {"title_source": title_source}
    )

    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                update(Conversation)
                .where(Conversation.id == conversation_id)
                .where(Conversation.title_source == "fallback")
                .values(**values)
                .returning(Conversation.title, Conversation.title_generated_at)
            )
            row = result.one_or_none()
            if row is None:
                await db.rollback()
                return None
            await db.commit()
    except SQLAlchemyError:
        logger.warning("保存会话标题结果失败 (conversation=%s)", conversation_id)
        return None

    settled_at = row.title_generated_at or generated_at
    return {
        "conversation_id": str(conversation_id),
        "title": row.title,
        "title_source": title_source,
        "title_generated_at": settled_at.isoformat(),
    }
