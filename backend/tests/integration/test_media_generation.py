"""持久化图片/视频生成任务 API 集成测试。"""

import uuid
from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import Conversation
from app.models.media_generation_task import (
    MediaGenerationStatus,
    MediaGenerationTask,
    MediaGenerationType,
)
from app.models.message import Message, MessageRole
from app.models.user import User


async def _create_conversation(client: AsyncClient, headers: dict[str, str]) -> str:
    """创建供媒体任务使用的持久化会话。"""
    response = await client.post(
        "/api/v1/chat/conversations",
        headers=headers,
        json={"model": "agnes-2.5-flash", "title": "媒体任务测试"},
    )
    assert response.status_code == 201
    return str(response.json()["id"])


async def _upload_reference_image(client: AsyncClient, headers: dict[str, str]) -> str:
    """上传一个归属于测试用户的图片，作为媒体任务参考输入。"""
    response = await client.post(
        "/api/v1/files/upload",
        headers=headers,
        files={"file": ("reference.png", b"test-image", "image/png")},
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


class TestMediaGenerationTasks:
    """媒体任务应作为 assistant 消息卡持久化在会话时间线中。"""

    async def test_created_image_task_has_assistant_message_and_no_provider_url(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """创建任务返回可恢复的卡片，消息列表投影同一份服务端任务。"""
        conversation_id = await _create_conversation(client, auth_headers)

        response = await client.post(
            "/api/v1/media/tasks",
            headers=auth_headers,
            json={
                "conversationId": conversation_id,
                "type": "image",
                "prompt": "一只在风中飞翔的红色风筝",
            },
        )

        assert response.status_code == 201, response.text
        task = response.json()
        assert task["status"] == "queued"
        assert task["messageId"]
        assert task["resultUrl"] is None
        assert task["resultPosterUrl"] is None
        assert "agnes-ai.com" not in str(task)

        messages = await client.get(
            f"/api/v1/chat/conversations/{conversation_id}/messages",
            headers=auth_headers,
        )
        assert messages.status_code == 200
        timeline = messages.json()["messages"]
        assert timeline[-2]["role"] == "user"
        assert timeline[-2]["content"] == "一只在风中飞翔的红色风筝"
        card = timeline[-1]["mediaTask"]
        assert card["id"] == task["id"]
        assert card["messageId"] == task["messageId"]
        assert card["sourceMessageId"] == timeline[-2]["id"]
        assert card["resultUrl"] is None
        assert card["resultPosterUrl"] is None

    async def test_created_music_task_uses_fixed_contract(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """音乐任务 API 固定模型、时长和任务卡文案。"""
        conversation_id = await _create_conversation(client, auth_headers)
        response = await client.post(
            "/api/v1/media/tasks",
            headers=auth_headers,
            json={"conversationId": conversation_id, "type": "music", "prompt": "舒缓钢琴"},
        )
        assert response.status_code == 201, response.text
        task = response.json()
        assert task["type"] == "music"
        assert task["model"] == "elevenlabs-music-v1"
        assert task["options"] == {"durationSeconds": 30}

        invalid = await client.post(
            "/api/v1/media/tasks",
            headers=auth_headers,
            json={
                "conversationId": conversation_id,
                "type": "music",
                "prompt": "舒缓钢琴",
                "options": {"durationSeconds": 5},
            },
        )
        assert invalid.status_code == 422
        assert invalid.json()["detail"]["code"] == "MEDIA_TASK_INVALID"

    async def test_media_timeline_keeps_user_before_task_for_legacy_equal_timestamps(
        self,
        client: AsyncClient,
        db: AsyncSession,
        test_user: User,
        auth_headers: dict[str, str],
    ) -> None:
        """历史同时间戳数据也必须稳定显示为提问后紧跟对应任务卡。"""
        conversation = Conversation(
            user_id=test_user.id,
            title="历史媒体任务",
            model="agnes-2.5-flash",
        )
        db.add(conversation)
        await db.flush()
        timestamp = datetime.now(UTC)
        # 让 assistant 的 UUID 刻意更小，证明排序不是偶然依赖 UUID。
        assistant_message = Message(
            id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
            conv_id=conversation.id,
            role=MessageRole.assistant,
            content="图片生成完成",
            model="agnes-image-2.1-flash",
            created_at=timestamp,
        )
        user_message = Message(
            id=uuid.UUID("ffffffff-ffff-ffff-ffff-ffffffffffff"),
            conv_id=conversation.id,
            role=MessageRole.user,
            content="生成一张日落海报",
            created_at=timestamp,
        )
        db.add_all([assistant_message, user_message])
        await db.flush()
        task = MediaGenerationTask(
            user_id=test_user.id,
            conversation_id=conversation.id,
            message_id=assistant_message.id,
            kind=MediaGenerationType.image,
            model="agnes-image-2.1-flash",
            prompt=user_message.content,
            request_options={"size": "1K", "ratio": "1:1"},
            source_file_ids=[],
            status=MediaGenerationStatus.succeeded,
            progress=100,
        )
        db.add(task)
        await db.commit()

        response = await client.get(
            f"/api/v1/chat/conversations/{conversation.id}/messages",
            headers=auth_headers,
        )

        assert response.status_code == 200, response.text
        timeline = response.json()["messages"]
        assert [message["role"] for message in timeline] == ["user", "assistant"]
        assert timeline[0]["content"] == "生成一张日落海报"
        assert timeline[1]["mediaTask"]["id"] == str(task.id)

    async def test_image_task_keeps_validated_options_and_owned_image_references(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """图片任务可持久化官方规格和当前用户上传的参考图片，不暴露存储路径。"""
        conversation_id = await _create_conversation(client, auth_headers)
        image_id = await _upload_reference_image(client, auth_headers)

        response = await client.post(
            "/api/v1/media/tasks",
            headers=auth_headers,
            json={
                "conversationId": conversation_id,
                "type": "image",
                "prompt": "把参考图转换成复古旅行海报",
                "options": {"size": "2K", "ratio": "16:9"},
                "sourceFileIds": [image_id],
            },
        )

        assert response.status_code == 201, response.text
        task = response.json()
        assert task["options"] == {"size": "2K", "ratio": "16:9"}
        assert task["sourceFileIds"] == [image_id]
        assert "files/" not in str(task)

        messages = await client.get(
            f"/api/v1/chat/conversations/{conversation_id}/messages",
            headers=auth_headers,
        )
        assert messages.status_code == 200
        assert [item["id"] for item in messages.json()["messages"][-2]["files"]] == [image_id]

    async def test_media_task_rejects_non_image_reference(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """媒体模式只能引用图片，文档和任意文件都不能进入提供商请求。"""
        conversation_id = await _create_conversation(client, auth_headers)
        uploaded = await client.post(
            "/api/v1/files/upload",
            headers=auth_headers,
            files={"file": ("notes.txt", b"not an image", "text/plain")},
        )
        assert uploaded.status_code == 201, uploaded.text

        response = await client.post(
            "/api/v1/media/tasks",
            headers=auth_headers,
            json={
                "conversationId": conversation_id,
                "type": "video",
                "prompt": "让参考图动起来",
                "sourceFileIds": [uploaded.json()["id"]],
            },
        )

        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "MEDIA_TASK_INVALID"

    async def test_list_and_cancel_owned_queued_task(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """取消只能影响当前用户任务，并在消息卡和会话任务列表中持久化。"""
        conversation_id = await _create_conversation(client, auth_headers)
        created = await client.post(
            "/api/v1/media/tasks",
            headers=auth_headers,
            json={
                "conversationId": conversation_id,
                "type": "video",
                "prompt": "雨后城市的慢镜头",
            },
        )
        assert created.status_code == 201
        task_id = created.json()["id"]

        listed = await client.get(
            f"/api/v1/chat/conversations/{conversation_id}/media-tasks",
            headers=auth_headers,
        )
        assert listed.status_code == 200, listed.text
        assert [task["id"] for task in listed.json()["tasks"]] == [task_id]

        canceled = await client.post(f"/api/v1/media/tasks/{task_id}/cancel", headers=auth_headers)
        assert canceled.status_code == 200, canceled.text
        assert canceled.json()["status"] == "canceled"
        assert canceled.json()["resultUrl"] is None

        fetched = await client.get(f"/api/v1/media/tasks/{task_id}", headers=auth_headers)
        assert fetched.status_code == 200
        assert fetched.json()["status"] == "canceled"
