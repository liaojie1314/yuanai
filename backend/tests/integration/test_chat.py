"""会话 CRUD 与流式接口集成测试。

FastAPI HTTPException 格式：{"detail": {"code": ..., "message": ...}}
无 token 时 HTTPBearer 返回 401（FastAPI 0.115+）。
SSE 行格式：event: <name>\ndata: <json>\n\n
"""

import uuid
from unittest.mock import patch

from httpx import AsyncClient

from app.core.security import create_access_token


class TestConversation:
    async def test_create_conversation(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o", "title": "测试对话"},
            headers=auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["title"] == "测试对话"
        assert data["model"] == "gpt-4o"
        assert data["isPinned"] is False
        assert "id" in data

    async def test_create_conversation_default_title(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o"},
            headers=auth_headers,
        )
        assert response.status_code == 201
        assert response.json()["title"] == "新对话"

    async def test_list_conversations_empty(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get("/api/v1/chat/conversations", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "conversations" in data
        assert isinstance(data["conversations"], list)

    async def test_list_conversations_shows_created(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o", "title": "列表测试"},
            headers=auth_headers,
        )
        response = await client.get("/api/v1/chat/conversations", headers=auth_headers)
        assert response.status_code == 200
        titles = [c["title"] for c in response.json()["conversations"]]
        assert "列表测试" in titles

    async def test_update_conversation_title(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        create_res = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o", "title": "原标题"},
            headers=auth_headers,
        )
        conv_id = create_res.json()["id"]

        update_res = await client.patch(
            f"/api/v1/chat/conversations/{conv_id}",
            json={"title": "新标题"},
            headers=auth_headers,
        )
        assert update_res.status_code == 200
        assert update_res.json()["title"] == "新标题"

    async def test_pin_conversation(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        create_res = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o"},
            headers=auth_headers,
        )
        conv_id = create_res.json()["id"]

        pin_res = await client.patch(
            f"/api/v1/chat/conversations/{conv_id}",
            json={"isPinned": True},
            headers=auth_headers,
        )
        assert pin_res.status_code == 200
        assert pin_res.json()["isPinned"] is True

    async def test_delete_conversation(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        create_res = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o", "title": "待删除"},
            headers=auth_headers,
        )
        conv_id = create_res.json()["id"]

        delete_res = await client.delete(
            f"/api/v1/chat/conversations/{conv_id}",
            headers=auth_headers,
        )
        assert delete_res.status_code == 204

        list_res = await client.get("/api/v1/chat/conversations", headers=auth_headers)
        ids = [c["id"] for c in list_res.json()["conversations"]]
        assert conv_id not in ids

    async def test_get_nonexistent_conversation(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        fake_id = str(uuid.uuid4())
        response = await client.get(
            f"/api/v1/chat/conversations/{fake_id}/messages",
            headers=auth_headers,
        )
        assert response.status_code == 404

    async def test_cannot_access_other_users_conversation(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        create_res = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o"},
            headers=auth_headers,
        )
        conv_id = create_res.json()["id"]

        other_token = create_access_token(str(uuid.uuid4()))
        other_headers = {"Authorization": f"Bearer {other_token}"}
        response = await client.get(
            f"/api/v1/chat/conversations/{conv_id}/messages",
            headers=other_headers,
        )
        assert response.status_code in (401, 403, 404)

    async def test_conversations_require_auth(self, client: AsyncClient) -> None:
        response = await client.get("/api/v1/chat/conversations")
        assert response.status_code in (401, 403)


class TestMessages:
    async def test_list_messages_empty(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        create_res = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o"},
            headers=auth_headers,
        )
        conv_id = create_res.json()["id"]

        response = await client.get(
            f"/api/v1/chat/conversations/{conv_id}/messages",
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["messages"] == []
        assert data["has_more"] is False


class TestStream:
    async def test_stream_returns_sse(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        conv_res = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o"},
            headers=auth_headers,
        )
        conv_id = conv_res.json()["id"]

        async def mock_stream(*args: object, **kwargs: object):  # type: ignore[misc]
            yield ("content", "你好")
            yield ("content", "！")

        with patch("app.api.v1.chat.stream_chat", side_effect=mock_stream):
            async with client.stream(
                "POST",
                "/api/v1/chat/stream",
                json={
                    "conversation_id": conv_id,
                    "model": "gpt-4o",
                    "message": {"content": "你好", "file_ids": []},
                },
                headers=auth_headers,
            ) as response:
                assert response.status_code == 200
                assert "text/event-stream" in response.headers["content-type"]

                # 收集所有行（包括 event: 和 data: 行）
                lines: list[str] = []
                async for line in response.aiter_lines():
                    if line.strip():
                        lines.append(line)

                # SSE 格式: event: <type> 和 data: <json>，分别是独立行
                all_text = "\n".join(lines)
                assert "message_start" in all_text
                assert "content_delta" in all_text
                assert "你好" in all_text

    async def test_stream_saves_messages(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        conv_res = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o"},
            headers=auth_headers,
        )
        conv_id = conv_res.json()["id"]

        async def mock_stream(*args: object, **kwargs: object):  # type: ignore[misc]
            yield ("content", "测试回复")

        with patch("app.api.v1.chat.stream_chat", side_effect=mock_stream):
            async with client.stream(
                "POST",
                "/api/v1/chat/stream",
                json={
                    "conversation_id": conv_id,
                    "model": "gpt-4o",
                    "message": {"content": "测试消息", "file_ids": []},
                },
                headers=auth_headers,
            ) as response:
                async for _ in response.aiter_lines():
                    pass

        import asyncio
        await asyncio.sleep(0.1)

        msg_res = await client.get(
            f"/api/v1/chat/conversations/{conv_id}/messages",
            headers=auth_headers,
        )
        messages = msg_res.json()["messages"]
        roles = [m["role"] for m in messages]
        assert "user" in roles
        assert "assistant" in roles

    async def test_stream_message_order_user_before_assistant(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """回归：user 与 assistant 必须严格保序（user 先于 assistant），
        避免前端 buildPairs 把 assistant 错挂到上一个 pair 上。"""
        conv_res = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o"},
            headers=auth_headers,
        )
        conv_id = conv_res.json()["id"]

        async def mock_stream(*args: object, **kwargs: object):  # type: ignore[misc]
            yield ("content", "回复")

        with patch("app.api.v1.chat.stream_chat", side_effect=mock_stream):
            for content in ("问题一", "问题二", "问题三"):
                async with client.stream(
                    "POST",
                    "/api/v1/chat/stream",
                    json={
                        "conversation_id": conv_id,
                        "model": "gpt-4o",
                        "message": {"content": content, "file_ids": []},
                    },
                    headers=auth_headers,
                ) as response:
                    async for _ in response.aiter_lines():
                        pass

        import asyncio
        await asyncio.sleep(0.1)

        msg_res = await client.get(
            f"/api/v1/chat/conversations/{conv_id}/messages",
            headers=auth_headers,
        )
        messages = msg_res.json()["messages"]
        roles = [m["role"] for m in messages]
        # 严格 user/assistant 交替，共 6 条
        assert roles == ["user", "assistant"] * 3, roles

    async def test_stream_invalid_conversation(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        fake_id = str(uuid.uuid4())
        response = await client.post(
            "/api/v1/chat/stream",
            json={
                "conversation_id": fake_id,
                "model": "gpt-4o",
                "message": {"content": "你好", "file_ids": []},
            },
            headers=auth_headers,
        )
        assert response.status_code == 404


class TestTemporaryChat:
    async def test_stream_temporary_returns_sse(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """临时对话应返回 SSE 且不落库、不创建 conversation。"""

        async def mock_stream(*args: object, **kwargs: object):  # type: ignore[misc]
            yield ("content", "临时")
            yield ("content", "回复")

        conv_before = (
            await client.get("/api/v1/chat/conversations", headers=auth_headers)
        ).json()["conversations"]

        with patch("app.api.v1.chat.stream_chat", side_effect=mock_stream):
            async with client.stream(
                "POST",
                "/api/v1/chat/stream/temporary",
                json={
                    "model": "gpt-4o",
                    "messages": [{"role": "user", "content": "你好"}],
                },
                headers=auth_headers,
            ) as response:
                assert response.status_code == 200
                assert "text/event-stream" in response.headers["content-type"]
                lines: list[str] = []
                async for line in response.aiter_lines():
                    if line.strip():
                        lines.append(line)
                all_text = "\n".join(lines)
                assert "message_start" in all_text
                assert "content_delta" in all_text
                assert "临时" in all_text
                assert "temporary" in all_text

        # 会话列表数量不变（未落库）
        conv_after = (
            await client.get("/api/v1/chat/conversations", headers=auth_headers)
        ).json()["conversations"]
        assert len(conv_after) == len(conv_before)

    async def test_stream_temporary_requires_auth(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/v1/chat/stream/temporary",
            json={"model": "gpt-4o", "messages": [{"role": "user", "content": "hi"}]},
        )
        assert response.status_code in (401, 403)


class TestModels:
    async def test_list_models_requires_auth(self, client: AsyncClient) -> None:
        response = await client.get("/api/v1/models")
        assert response.status_code in (401, 403)

    async def test_list_models(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get("/api/v1/models", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "models" in data
        assert len(data["models"]) > 0
        default_models = [m for m in data["models"] if m["is_default"]]
        assert len(default_models) == 1
