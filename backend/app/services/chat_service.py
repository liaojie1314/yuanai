"""持久化聊天流服务。

路由层只负责认证依赖、请求解析和构造响应；消息事务、历史上下文和附件处理
集中在这里，便于后续 Agent Runtime 复用同一套会话边界。
"""

from __future__ import annotations

import asyncio
import base64
import uuid
from collections.abc import AsyncIterable, Awaitable, Callable, Sequence
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.conversation import Conversation
from app.models.file import File, MessageFile
from app.models.message import Message, MessageRole
from app.schemas.chat import SendMessageRequest
from app.services.conversation_title_service import ConversationTitleResult, fallback_title
from app.services.file_extract_service import extract_preview, preview_context
from app.services.storage_service import StorageService, storage


async def get_user_conversation(
    conv_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession
) -> Conversation:
    """校验会话归属并返回会话实体。"""
    result = await db.execute(select(Conversation).where(Conversation.id == conv_id))
    conv = result.scalar_one_or_none()
    if conv is None:
        raise HTTPException(404, {"code": "CONVERSATION_NOT_FOUND", "message": "会话不存在"})
    if conv.user_id != user_id:
        raise HTTPException(403, {"code": "CONVERSATION_ACCESS_DENIED", "message": "无权访问"})
    return conv


async def build_openai_messages(
    history: Sequence[Message],
    files_by_message_id: dict[uuid.UUID, list[File]],
    *,
    storage_service: StorageService = storage,
) -> list[dict[str, object]]:
    """把消息历史和附件转换为 provider-neutral 的 OpenAI 消息结构。"""
    result: list[dict[str, object]] = []
    for message in history:
        message_files = files_by_message_id.get(message.id, [])
        if not message_files:
            result.append({"role": message.role.value, "content": message.content})
            continue
        content_parts: list[dict[str, object]] = [{"type": "text", "text": message.content}]
        for attached_file in message_files:
            data = await storage_service.get_object(attached_file.s3_key)
            if attached_file.mime_type.startswith("image/"):
                if len(data) <= settings.ai_inline_image_max_bytes:
                    encoded = base64.b64encode(data).decode("ascii")
                    content_parts.append(
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{attached_file.mime_type};base64,{encoded}"
                            },
                        }
                    )
                else:
                    content_parts.append(
                        {
                            "type": "text",
                            "text": (
                                f"\n[{attached_file.filename}] 图片已上传，但超过 "
                                "视觉识别大小限制，无法发送给当前模型。"
                            ),
                        }
                    )
                continue
            extracted = extract_preview(data, attached_file.mime_type, attached_file.filename)
            context = preview_context(extracted)
            if context:
                content_parts.append(
                    {"type": "text", "text": f"\n[{attached_file.filename}]\n{context}"}
                )
        result.append({"role": message.role.value, "content": content_parts})
    return result


async def stream_chat_response(
    req: SendMessageRequest,
    *,
    user_id: uuid.UUID,
    db: AsyncSession,
    sse_generator: Callable[..., AsyncIterable[str]],
    title_generator: Callable[[uuid.UUID, str], Awaitable[ConversationTitleResult | None]],
) -> StreamingResponse:
    """准备聊天事务、历史上下文并返回 SSE 响应。"""
    conv = await get_user_conversation(req.conversation_id, user_id, db)
    if req.replace_message_id is not None and req.regenerate_from_message_id is not None:
        raise HTTPException(
            422,
            {"code": "INVALID_MESSAGE_OPERATION", "message": "编辑消息和重新生成不能同时执行"},
        )

    regenerated_id: uuid.UUID | None = None
    if req.regenerate_from_message_id is not None:
        source = await db.execute(
            select(Message.id)
            .where(Message.id == req.regenerate_from_message_id)
            .where(Message.conv_id == conv.id)
            .where(Message.role == MessageRole.user)
        )
        regenerated_id = source.scalar_one_or_none()
        if regenerated_id is None:
            raise HTTPException(404, {"code": "MESSAGE_NOT_FOUND", "message": "消息不存在"})

    now = datetime.now(UTC)
    first_message = False
    if req.replace_message_id is None and conv.title_source == "default":
        existing = await db.execute(
            select(Message.id)
            .where(Message.conv_id == conv.id)
            .where(Message.role == MessageRole.user)
            .limit(1)
        )
        first_message = existing.scalar_one_or_none() is None

    title_fallback: dict[str, str] | None = None
    if req.replace_message_id is None:
        user_msg: Message = Message(
            conv_id=conv.id,
            role=MessageRole.user,
            content=req.message.content,
            regenerated_from_message_id=regenerated_id,
            created_at=now,
        )
        db.add(user_msg)
    else:
        result = await db.execute(
            select(Message)
            .where(Message.id == req.replace_message_id)
            .where(Message.conv_id == conv.id)
            .where(Message.role == MessageRole.user)
            .with_for_update()
        )
        existing_user_msg: Message | None = result.scalar_one_or_none()
        if existing_user_msg is None:
            raise HTTPException(404, {"code": "MESSAGE_NOT_FOUND", "message": "消息不存在"})
        user_msg = existing_user_msg
        await db.execute(
            delete(Message)
            .where(Message.conv_id == conv.id)
            .where(Message.created_at > user_msg.created_at)
        )
        user_msg.content = req.message.content

    assistant_msg = Message(
        conv_id=conv.id,
        role=MessageRole.assistant,
        content="",
        model=req.model,
        created_at=now + timedelta(microseconds=1),
    )
    db.add(assistant_msg)
    conv.last_message_at = assistant_msg.created_at
    if first_message:
        conv.title = fallback_title(req.message.content)
        conv.title_source = "fallback"
        conv.title_generated_at = now
        title_fallback = {
            "conversation_id": str(conv.id),
            "title": conv.title,
            "title_source": conv.title_source,
            "title_generated_at": now.isoformat(),
        }
    await db.commit()
    await db.refresh(user_msg)
    await db.refresh(assistant_msg)

    title_task: asyncio.Task[ConversationTitleResult | None] | None = None
    if first_message:
        title_task = asyncio.ensure_future(title_generator(conv.id, req.message.content))

    attached_files: list[File] = []
    if req.message.file_ids and req.replace_message_id is None:
        file_result = await db.execute(
            select(File).where(File.id.in_(req.message.file_ids)).where(File.user_id == user_id)
        )
        attached_files = list(file_result.scalars().all())
        for index, attached_file in enumerate(attached_files):
            db.add(MessageFile(message_id=user_msg.id, file_id=attached_file.id, sort_order=index))
        await db.commit()
    elif req.replace_message_id is not None:
        file_result = await db.execute(
            select(File)
            .join(MessageFile, MessageFile.file_id == File.id)
            .where(MessageFile.message_id == user_msg.id)
        )
        attached_files = list(file_result.scalars().all())

    history_result = await db.execute(
        select(Message)
        .where(Message.conv_id == conv.id)
        .where(Message.id != assistant_msg.id)
        .order_by(Message.created_at, Message.id)
        .limit(50)
    )
    history = history_result.scalars().all()
    files_by_message_id: dict[uuid.UUID, list[File]] = {}
    if history:
        file_rows = await db.execute(
            select(MessageFile, File)
            .join(File, File.id == MessageFile.file_id)
            .where(MessageFile.message_id.in_([message.id for message in history]))
            .order_by(MessageFile.message_id, MessageFile.sort_order)
        )
        for message_file, attached_file in file_rows.all():
            files_by_message_id.setdefault(message_file.message_id, []).append(attached_file)
    openai_messages = await build_openai_messages(history, files_by_message_id)
    return StreamingResponse(
        sse_generator(
            openai_messages,
            req.model,
            assistant_msg.id,
            user_msg.id,
            db,
            enable_thinking=req.enable_thinking,
            enable_web_search=req.enable_web_search,
            user_id=user_id,
            conv_id=conv.id,
            initial_title_update=title_fallback,
            title_task=title_task,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
