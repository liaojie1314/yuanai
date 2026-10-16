"""主聊天链路的 system 层注入。"""

import pytest

from app.services.chat_service import build_openai_messages
from app.services.persona_service import CHAT_SYSTEM_POLICY


@pytest.mark.asyncio
async def test_messages_start_with_chat_policy() -> None:
    """即便没有人格，聊天也必须带上安全前置。"""

    messages = await build_openai_messages([], {}, persona=None)
    assert messages[0] == {"role": "system", "content": CHAT_SYSTEM_POLICY}
    assert len(messages) == 1
