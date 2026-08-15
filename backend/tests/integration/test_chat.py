"""会话 CRUD 与流式接口集成测试。

FastAPI HTTPException 格式：{"detail": {"code": ..., "message": ...}}
无 token 时 HTTPBearer 返回 401（FastAPI 0.115+）。
SSE 行格式：event: <name>\ndata: <json>\n\n
"""

import json
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

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
        assert data["titleSource"] == "default"
        assert data["titleGeneratedAt"] is None
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
        assert update_res.json()["titleSource"] == "manual"
        assert update_res.json()["titleGeneratedAt"] is not None

    async def test_update_conversation_model_persists_for_later_clients(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """模型选择必须保存到会话，供切换会话或另一端恢复。"""
        create_res = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o"},
            headers=auth_headers,
        )
        conv_id = create_res.json()["id"]

        update_res = await client.patch(
            f"/api/v1/chat/conversations/{conv_id}",
            json={"model": "agnes-2.5-flash"},
            headers=auth_headers,
        )
        assert update_res.status_code == 200
        assert update_res.json()["model"] == "agnes-2.5-flash"

        list_res = await client.get("/api/v1/chat/conversations", headers=auth_headers)
        persisted = next(item for item in list_res.json()["conversations"] if item["id"] == conv_id)
        assert persisted["model"] == "agnes-2.5-flash"

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
    async def test_first_message_emits_fallback_and_agnes_title(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """首问应先同步更新标题，再在 Agnes 结果可用时通过 SSE 替换。"""
        conv_res = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o"},
            headers=auth_headers,
        )
        conv_id = conv_res.json()["id"]

        async def mock_stream(*args: object, **kwargs: object):  # type: ignore[misc]
            yield ("content", "回复")

        title_result = {
            "conversation_id": conv_id,
            "title": "SQLAlchemy 事务边界",
            "title_source": "ai",
            "title_generated_at": "2026-08-15T12:00:00+00:00",
        }
        with (
            patch("app.api.v1.chat.stream_chat", side_effect=mock_stream),
            patch(
                "app.api.v1.chat.generate_and_store_title",
                new=AsyncMock(return_value=title_result),
            ),
        ):
            async with client.stream(
                "POST",
                "/api/v1/chat/stream",
                json={
                    "conversation_id": conv_id,
                    "model": "gpt-4o",
                    "message": {"content": "解释一下 async SQLAlchemy 的事务边界", "file_ids": []},
                },
                headers=auth_headers,
            ) as response:
                assert response.status_code == 200
                events = [line async for line in response.aiter_lines() if line.strip()]

        title_data = [
            json.loads(line.removeprefix("data: "))
            for line in events
            if line.startswith("data: ") and line != "data: [DONE]"
        ]
        assert any(item.get("title_source") == "fallback" for item in title_data)
        assert any(item.get("title") == "SQLAlchemy 事务边界" for item in title_data)

    async def test_first_message_keeps_fallback_when_agnes_returns_none(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """未配置 Agnes 或调用失败时，首问回退标题仍应保留且聊天成功。"""
        conv_res = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o"},
            headers=auth_headers,
        )
        conv_id = conv_res.json()["id"]

        async def mock_stream(*args: object, **kwargs: object):  # type: ignore[misc]
            yield ("content", "回复")

        with (
            patch("app.api.v1.chat.stream_chat", side_effect=mock_stream),
            patch(
                "app.api.v1.chat.generate_and_store_title",
                new=AsyncMock(return_value=None),
            ),
        ):
            async with client.stream(
                "POST",
                "/api/v1/chat/stream",
                json={
                    "conversation_id": conv_id,
                    "model": "gpt-4o",
                    "message": {"content": "  第一 个\n问题  ", "file_ids": []},
                },
                headers=auth_headers,
            ) as response:
                assert response.status_code == 200
                body = "\n".join([line async for line in response.aiter_lines()])

        assert '"title_source": "fallback"' in body
        conversations_response = await client.get(
            "/api/v1/chat/conversations", headers=auth_headers
        )
        conversation = next(
            item
            for item in conversations_response.json()["conversations"]
            if item["id"] == conv_id
        )
        assert conversation["title"] == "第一 个 问题"
        assert conversation["titleSource"] == "fallback"

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

    async def test_stream_keeps_prior_file_context_for_follow_up(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        conv_res = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o"},
            headers=auth_headers,
        )
        conv_id = conv_res.json()["id"]
        upload = await client.post(
            "/api/v1/files/upload",
            headers=auth_headers,
            files={"file": ("facts.txt", b"yuanai file context", "text/plain")},
        )
        assert upload.status_code == 201
        captured_messages: list[list[dict[str, object]]] = []

        async def mock_stream(
            _model: str, messages: list[dict[str, object]], **_kwargs: object
        ):  # type: ignore[misc]
            captured_messages.append(messages)
            yield ("content", "reply")

        with patch("app.api.v1.chat.stream_chat", side_effect=mock_stream):
            requests = (("请阅读附件", [upload.json()["id"]]), ("附件里写了什么？", []))
            for content, file_ids in requests:
                async with client.stream(
                    "POST",
                    "/api/v1/chat/stream",
                    json={
                        "conversation_id": conv_id,
                        "model": "gpt-4o",
                        "message": {"content": content, "file_ids": file_ids},
                    },
                    headers=auth_headers,
                ) as response:
                    assert response.status_code == 200
                    async for _ in response.aiter_lines():
                        pass

        prior_content = captured_messages[-1][0]["content"]
        assert isinstance(prior_content, list)
        assert any(
            part.get("type") == "text" and "yuanai file context" in str(part.get("text"))
            for part in prior_content
            if isinstance(part, dict)
        )

    async def test_stream_embeds_image_for_vision_models(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        conv_res = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "agnes-2.5-flash"},
            headers=auth_headers,
        )
        upload = await client.post(
            "/api/v1/files/upload",
            headers=auth_headers,
            files={"file": ("pixel.png", b"\x89PNG\r\n\x1a\n", "image/png")},
        )
        captured_messages: list[list[dict[str, object]]] = []

        async def mock_stream(
            _model: str, messages: list[dict[str, object]], **_kwargs: object
        ):  # type: ignore[misc]
            captured_messages.append(messages)
            yield ("content", "image reply")

        with patch("app.api.v1.chat.stream_chat", side_effect=mock_stream):
            async with client.stream(
                "POST",
                "/api/v1/chat/stream",
                json={
                    "conversation_id": conv_res.json()["id"],
                    "model": "agnes-2.5-flash",
                    "message": {"content": "看图", "file_ids": [upload.json()["id"]]},
                },
                headers=auth_headers,
            ) as response:
                assert response.status_code == 200
                async for _ in response.aiter_lines():
                    pass

        content = captured_messages[0][0]["content"]
        assert isinstance(content, list)
        assert any(
            part.get("type") == "image_url"
            and str(part.get("image_url", {}).get("url", "")).startswith("data:image/png;base64,")
            for part in content
            if isinstance(part, dict) and isinstance(part.get("image_url"), dict)
        )

    async def test_stream_returns_user_safe_error_for_text_only_image_model(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """DeepSeek 视觉请求必须返回稳定 SSE 错误，而非 provider 的 image_url 解析错误。"""
        conv_res = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "deepseek-v4-flash"},
            headers=auth_headers,
        )
        upload = await client.post(
            "/api/v1/files/upload",
            headers=auth_headers,
            files={"file": ("pixel.png", b"\x89PNG\r\n\x1a\n", "image/png")},
        )
        assert upload.status_code == 201

        async with client.stream(
            "POST",
            "/api/v1/chat/stream",
            json={
                "conversation_id": conv_res.json()["id"],
                "model": "deepseek-v4-flash",
                "message": {"content": "看图", "file_ids": [upload.json()["id"]]},
            },
            headers=auth_headers,
        ) as response:
            assert response.status_code == 200
            lines = [line async for line in response.aiter_lines()]
        sse = "\n".join(lines)

        assert "MODEL_VISION_UNSUPPORTED" in sse
        error_data = next(
            line.removeprefix("data: ")
            for line in lines
            if line.startswith("data: {") and "MODEL_VISION_UNSUPPORTED" in line
        )
        assert json.loads(error_data)["message"] == (
            "当前模型不支持图片识别，请切换至支持视觉的模型后发送"
        )
        assert "unknown variant" not in sse

    async def test_edit_stream_reuses_user_message_and_replaces_old_answer(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """编辑问题时复用原用户消息，并清除其后基于旧问题生成的回答。"""
        import asyncio

        conv_res = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o"},
            headers=auth_headers,
        )
        conv_id = conv_res.json()["id"]

        async def mock_stream(
            _model: str, messages: list[dict[str, str]], **_kwargs: object
        ):  # type: ignore[misc]
            yield ("content", f"{messages[-1]['content']} 的回答")

        with patch("app.api.v1.chat.stream_chat", side_effect=mock_stream):
            async with client.stream(
                "POST",
                "/api/v1/chat/stream",
                json={
                    "conversation_id": conv_id,
                    "model": "gpt-4o",
                    "message": {"content": "旧问题", "file_ids": []},
                },
                headers=auth_headers,
            ) as response:
                async for _ in response.aiter_lines():
                    pass

            initial_messages = (
                await client.get(
                    f"/api/v1/chat/conversations/{conv_id}/messages", headers=auth_headers
                )
            ).json()["messages"]
            user_message_id = initial_messages[0]["id"]

            async with client.stream(
                "POST",
                "/api/v1/chat/stream",
                json={
                    "conversation_id": conv_id,
                    "model": "gpt-4o",
                    "message": {"content": "新问题", "file_ids": []},
                    "replace_message_id": user_message_id,
                },
                headers=auth_headers,
            ) as response:
                async for _ in response.aiter_lines():
                    pass

        await asyncio.sleep(0.1)
        messages = (
            await client.get(
                f"/api/v1/chat/conversations/{conv_id}/messages", headers=auth_headers
            )
        ).json()["messages"]
        assert len(messages) == 2
        assert messages[0]["id"] == user_message_id
        assert messages[0]["content"] == "新问题"
        assert messages[1]["role"] == "assistant"
        assert messages[1]["content"] == "新问题 的回答"

    async def test_regeneration_persists_explicit_origin_without_merging_repeated_questions(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """相同文本不是版本；只有带来源 ID 的重新生成才可由客户端折叠。"""
        conv_res = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o"},
            headers=auth_headers,
        )
        conv_id = conv_res.json()["id"]

        async def mock_stream(
            _model: str, messages: list[dict[str, str]], **_kwargs: object
        ):  # type: ignore[misc]
            yield ("content", f"{messages[-1]['content']} 的回答")

        async def send_message(regenerate_from_message_id: str | None = None) -> None:
            payload: dict[str, object] = {
                "conversation_id": conv_id,
                "model": "gpt-4o",
                "message": {"content": "相同的问题", "file_ids": []},
            }
            if regenerate_from_message_id is not None:
                payload["regenerate_from_message_id"] = regenerate_from_message_id
            async with client.stream(
                "POST", "/api/v1/chat/stream", json=payload, headers=auth_headers
            ) as response:
                assert response.status_code == 200
                async for _ in response.aiter_lines():
                    pass

        with patch("app.api.v1.chat.stream_chat", side_effect=mock_stream):
            await send_message()
            initial_messages = (
                await client.get(
                    f"/api/v1/chat/conversations/{conv_id}/messages", headers=auth_headers
                )
            ).json()["messages"]
            await send_message()
            await send_message(initial_messages[0]["id"])

        messages = (
            await client.get(
                f"/api/v1/chat/conversations/{conv_id}/messages", headers=auth_headers
            )
        ).json()["messages"]
        assert [message["role"] for message in messages] == ["user", "assistant"] * 3
        assert messages[2]["regeneratedFromMessageId"] is None
        assert messages[4]["regeneratedFromMessageId"] == initial_messages[0]["id"]

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

    async def test_stream_updates_conversation_last_message_at(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """回归：发消息后会话 lastMessageAt 必须更新，否则前端
        「今天/昨天/本周」分组永远停在会话创建时间（web/mobile 同源 bug）。"""
        conv_res = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o"},
            headers=auth_headers,
        )
        conv_id = conv_res.json()["id"]
        # 新建会话还没有消息，lastMessageAt 允许为 null
        assert conv_res.json()["lastMessageAt"] is None

        async def mock_stream(*args: object, **kwargs: object):  # type: ignore[misc]
            yield ("content", "回复")

        with patch("app.api.v1.chat.stream_chat", side_effect=mock_stream):
            async with client.stream(
                "POST",
                "/api/v1/chat/stream",
                json={
                    "conversation_id": conv_id,
                    "model": "gpt-4o",
                    "message": {"content": "更新分组测试", "file_ids": []},
                },
                headers=auth_headers,
            ) as response:
                async for _ in response.aiter_lines():
                    pass

        import asyncio
        await asyncio.sleep(0.1)

        list_res = await client.get("/api/v1/chat/conversations", headers=auth_headers)
        conv = next(c for c in list_res.json()["conversations"] if c["id"] == conv_id)
        assert conv["lastMessageAt"] is not None
        # 与最新消息的 createdAt 一致（分组/排序都以它为准）
        msg_res = await client.get(
            f"/api/v1/chat/conversations/{conv_id}/messages",
            headers=auth_headers,
        )
        latest_msg_at = max(m["createdAt"] for m in msg_res.json()["messages"])
        assert conv["lastMessageAt"] == latest_msg_at

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

    async def test_cancelled_stream_persists_partial_content(
        self,
        client: AsyncClient,
        db: AsyncSession,
        auth_headers: dict[str, str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """回归：用户中途停止（连接取消）后，已生成的部分内容必须落库，
        不能让 assistant 占位永远停留在空串（表现为前端已输出内容消失）。"""
        import asyncio

        import app.api.v1.chat as chat_mod
        from app.api.v1.chat import _generate_sse
        from app.models.message import Message, MessageRole
        from tests.conftest import TestSessionLocal

        # _persist_partial 内部自建 session；测试里换成 NullPool 的工厂，
        # 避免应用默认连接池跨事件循环复用连接
        monkeypatch.setattr(chat_mod, "AsyncSessionLocal", TestSessionLocal)

        conv_res = await client.post(
            "/api/v1/chat/conversations",
            json={"model": "gpt-4o"},
            headers=auth_headers,
        )
        conv_id = uuid.UUID(conv_res.json()["id"])

        user_msg = Message(conv_id=conv_id, role=MessageRole.user, content="数到一千")
        assistant_msg = Message(conv_id=conv_id, role=MessageRole.assistant, content="")
        db.add_all([user_msg, assistant_msg])
        await db.commit()
        await db.refresh(user_msg)
        await db.refresh(assistant_msg)

        async def slow_stream(*args: object, **kwargs: object):  # type: ignore[misc]
            for i in range(1000):
                yield ("content", f"{i + 1}\n")
                await asyncio.sleep(0)

        with patch("app.api.v1.chat.stream_chat", side_effect=slow_stream):
            gen = _generate_sse(
                [{"role": "user", "content": "数到一千"}],
                "gpt-4o",
                assistant_msg.id,
                user_msg.id,
                db,
            )
            # 消费 message_start + 若干 content_delta 后模拟客户端断开
            received = 0
            async for _chunk in gen:
                received += 1
                if received >= 5:
                    break
            with pytest.raises(asyncio.CancelledError):
                await gen.athrow(asyncio.CancelledError())

        # 部分内容应已写入 assistant 占位
        async with TestSessionLocal() as check:
            from sqlalchemy import select

            row = (
                await check.execute(select(Message).where(Message.id == assistant_msg.id))
            ).scalar_one()
            assert row.content.startswith("1\n")
            assert len(row.content) > 0


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
