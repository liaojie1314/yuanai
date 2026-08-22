"""聊天流服务单元测试。"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.models.message import MessageRole
from app.services.chat_service import build_openai_messages


@pytest.mark.asyncio
async def test_build_openai_messages_preserves_history_file_context() -> None:
    """上下文构建应保留消息顺序、角色和已上传文件的预览文本。"""
    message_id = uuid.uuid4()
    history = [
        SimpleNamespace(id=message_id, role=MessageRole.user, content="请总结附件"),
        SimpleNamespace(id=uuid.uuid4(), role=MessageRole.assistant, content="好的"),
    ]
    attachment = SimpleNamespace(
        mime_type="text/plain", filename="notes.txt", s3_key="files/notes.txt"
    )
    storage = SimpleNamespace(get_object=AsyncMock(return_value="关键内容".encode()))

    messages = await build_openai_messages(
        history,
        {message_id: [attachment]},
        storage_service=storage,
    )

    assert [message["role"] for message in messages] == ["user", "assistant"]
    assert messages[0]["content"][0]["text"] == "请总结附件"
    assert "关键内容" in messages[0]["content"][1]["text"]
    storage.get_object.assert_awaited_once_with("files/notes.txt")
