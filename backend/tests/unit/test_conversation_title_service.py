"""会话首问标题生成服务的单元测试。"""

import uuid
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.services.ai_service as ai_service
import app.services.conversation_title_service as title_service
from app.models.conversation import Conversation
from app.models.user import User
from app.services.conversation_title_service import (
    fallback_title,
    generate_and_store_title,
    generate_title_for_first_question,
)
from tests.conftest import TestSessionLocal


async def _create_pending_conversation(db: AsyncSession, user: User) -> Conversation:
    """创建一个正等待 AI 标题的会话（title_source 为 fallback）。"""
    conversation = Conversation(
        user_id=user.id,
        title="解释一下会话标题",
        model="agnes-2.5-flash",
        title_source="fallback",
    )
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)
    return conversation


async def _reload(db: AsyncSession, conversation_id: uuid.UUID) -> Conversation:
    """重新读取会话，避免 identity map 遮蔽服务独立事务的写入。"""
    db.expire_all()
    result = await db.execute(select(Conversation).where(Conversation.id == conversation_id))
    return result.scalar_one()


def test_fallback_title_collapses_whitespace_and_truncates() -> None:
    """首问标题应立即可用，保留语义并避免侧栏溢出。"""
    assert (
        fallback_title("  解释一下\n  async SQLAlchemy 的事务边界  ")
        == "解释一下 async SQLAlchemy 的事务边界"
    )
    assert fallback_title("a" * 60) == f"{'a' * 47}…"


async def test_generate_title_uses_agnes_result_after_sanitizing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Agnes 结果应去除引号、换行和多余空白后才允许持久化。"""
    generate = AsyncMock(return_value='  "SQLAlchemy\n事务边界"  ')
    monkeypatch.setattr(ai_service, "generate_conversation_title", generate)

    title = await generate_title_for_first_question("解释一下 async SQLAlchemy 的事务边界")

    assert title == "SQLAlchemy 事务边界"
    generate.assert_awaited_once_with("解释一下 async SQLAlchemy 的事务边界")


async def test_generate_title_returns_none_when_agnes_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """缺失密钥或 provider 故障不能让聊天请求失败。"""
    monkeypatch.setattr(ai_service, "generate_conversation_title", AsyncMock(return_value=None))

    assert await generate_title_for_first_question("解释一下会话标题") is None


async def test_store_title_marks_terminal_state_when_generation_fails(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """生成失败必须推进到 fallback_final，否则客户端的标题转圈没有退出条件。"""
    conversation = await _create_pending_conversation(db, test_user)
    monkeypatch.setattr(title_service, "AsyncSessionLocal", TestSessionLocal)
    monkeypatch.setattr(ai_service, "generate_conversation_title", AsyncMock(return_value=None))

    result = await generate_and_store_title(conversation.id, "解释一下会话标题")

    assert result is not None
    assert result["title_source"] == "fallback_final"
    # 标题文本必须仍是首问回退值：失败不该改写用户已经看到的标题。
    assert result["title"] == "解释一下会话标题"
    stored = await _reload(db, conversation.id)
    assert stored.title_source == "fallback_final"
    assert stored.title == "解释一下会话标题"


async def test_store_title_keeps_manual_rename(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """生成期间用户改名后，失败终态也不能覆盖 manual。"""
    conversation = await _create_pending_conversation(db, test_user)
    conversation.title_source = "manual"
    conversation.title = "用户自己的标题"
    await db.commit()
    monkeypatch.setattr(title_service, "AsyncSessionLocal", TestSessionLocal)
    monkeypatch.setattr(ai_service, "generate_conversation_title", AsyncMock(return_value=None))

    assert await generate_and_store_title(conversation.id, "解释一下会话标题") is None

    stored = await _reload(db, conversation.id)
    assert stored.title_source == "manual"
    assert stored.title == "用户自己的标题"
