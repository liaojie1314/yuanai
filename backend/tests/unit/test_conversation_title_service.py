"""会话首问标题生成服务的单元测试。"""

from unittest.mock import AsyncMock

import pytest

import app.services.ai_service as ai_service
from app.services.conversation_title_service import (
    fallback_title,
    generate_title_for_first_question,
)


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
