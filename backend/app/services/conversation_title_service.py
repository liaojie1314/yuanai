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
    """在独立数据库会话中保存 AI 标题，且绝不覆盖手动重命名。

    ``title_source='fallback'`` 是乐观比较条件。用户在生成期间改名会先写入
    ``manual``，此 SQL 更新的 rowcount 变为零，从而自然保留用户标题。
    """
    title = await generate_title_for_first_question(question)
    if title is None:
        return None

    generated_at = datetime.now(UTC)
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                update(Conversation)
                .where(Conversation.id == conversation_id)
                .where(Conversation.title_source == "fallback")
                .values(
                    title=title,
                    title_source="ai",
                    title_generated_at=generated_at,
                )
                .returning(Conversation.id)
            )
            if result.scalar_one_or_none() is None:
                await db.rollback()
                return None
            await db.commit()
    except SQLAlchemyError:
        logger.warning("保存会话 AI 标题失败 (conversation=%s)", conversation_id)
        return None

    return {
        "conversation_id": str(conversation_id),
        "title": title,
        "title_source": "ai",
        "title_generated_at": generated_at.isoformat(),
    }
