import json
import time
import uuid
from collections.abc import AsyncGenerator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DB, CurrentUser
from app.models.conversation import Conversation
from app.models.file import File, MessageFile
from app.models.message import Message, MessageRole
from app.schemas.chat import (
    ConversationResponse,
    CreateConversationRequest,
    MessageResponse,
    SendMessageRequest,
    UpdateConversationRequest,
)
from app.services.ai_service import stream_chat

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("/conversations", response_model=ConversationResponse, status_code=201)
async def create_conversation(
    req: CreateConversationRequest, current_user: CurrentUser, db: DB
) -> ConversationResponse:
    conv = Conversation(user_id=current_user.id, model=req.model, title=req.title)
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return ConversationResponse.model_validate(conv)


@router.get("/conversations")
async def list_conversations(current_user: CurrentUser, db: DB) -> dict[str, object]:
    result = await db.execute(
        select(Conversation)
        .where(Conversation.user_id == current_user.id)
        .order_by(Conversation.is_pinned.desc(), Conversation.updated_at.desc())
        .limit(50)
    )
    conversations = result.scalars().all()
    return {
        "conversations": [ConversationResponse.model_validate(c) for c in conversations],
        "next_cursor": None,
        "has_more": False,
    }


@router.patch("/conversations/{conv_id}", response_model=ConversationResponse)
async def update_conversation(
    conv_id: uuid.UUID, req: UpdateConversationRequest, current_user: CurrentUser, db: DB
) -> ConversationResponse:
    conv = await _get_user_conv(conv_id, current_user.id, db)
    if req.title is not None:
        conv.title = req.title
    if req.model is not None:
        conv.model = req.model
    if req.is_pinned is not None:
        conv.is_pinned = req.is_pinned
    await db.commit()
    await db.refresh(conv)
    return ConversationResponse.model_validate(conv)


@router.delete("/conversations/{conv_id}", status_code=204)
async def delete_conversation(
    conv_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> None:
    conv = await _get_user_conv(conv_id, current_user.id, db)
    await db.delete(conv)
    await db.commit()


@router.delete("/conversations", status_code=200)
async def delete_all_conversations(
    current_user: CurrentUser, db: DB
) -> dict[str, int]:
    """一次性删除当前用户的所有会话（含消息，通过 ondelete=CASCADE 级联）。"""
    result = await db.execute(
        delete(Conversation).where(Conversation.user_id == current_user.id)
    )
    await db.commit()
    return {"deleted": int(result.rowcount or 0)}


@router.get("/conversations/{conv_id}/messages")
async def list_messages(conv_id: uuid.UUID, current_user: CurrentUser, db: DB) -> dict[str, object]:
    await _get_user_conv(conv_id, current_user.id, db)
    result = await db.execute(
        select(Message)
        .where(Message.conv_id == conv_id)
        .order_by(Message.created_at)
        .limit(200)
    )
    messages = result.scalars().all()
    return {
        "messages": [MessageResponse.model_validate(m) for m in messages],
        "next_cursor": None,
        "has_more": False,
    }


@router.post("/stream")
async def stream_chat_endpoint(
    req: SendMessageRequest, current_user: CurrentUser, db: DB
) -> StreamingResponse:
    conv = await _get_user_conv(req.conversation_id, current_user.id, db)

    # 保存用户消息
    user_msg = Message(
        conv_id=conv.id,
        role=MessageRole.user,
        content=req.message.content,
    )
    db.add(user_msg)

    # 创建 assistant 消息占位（流式填充内容）
    assistant_msg = Message(
        conv_id=conv.id,
        role=MessageRole.assistant,
        content="",
        model=req.model,
    )
    db.add(assistant_msg)
    await db.commit()
    await db.refresh(user_msg)
    await db.refresh(assistant_msg)

    # 关联文件（若有）
    attached_files: list[File] = []
    if req.message.file_ids:
        file_results = await db.execute(
            select(File)
            .where(File.id.in_(req.message.file_ids))
            .where(File.user_id == current_user.id)
        )
        attached_files = list(file_results.scalars().all())
        for i, f in enumerate(attached_files):
            db.add(MessageFile(message_id=user_msg.id, file_id=f.id, sort_order=i))
        await db.commit()

    # 构建历史消息（最多 50 条，排除刚创建的空 assistant 占位）
    history_result = await db.execute(
        select(Message)
        .where(Message.conv_id == conv.id)
        .where(Message.id != assistant_msg.id)  # 排除空占位，避免模型误以为已回复
        .order_by(Message.created_at)
        .limit(50)
    )
    history = history_result.scalars().all()

    # 构造 OpenAI 格式消息列表；最新一条若有图片附件则转为多模态格式
    openai_messages: list[dict] = []
    for m in history:
        if m.id == user_msg.id and attached_files:
            # 带附件的用户消息：组装 content 数组（视觉模型格式）
            content_parts: list[dict] = [{"type": "text", "text": m.content}]
            for af in attached_files:
                if af.mime_type.startswith("image/"):
                    content_parts.append(
                        {"type": "image_url", "image_url": {"url": af.s3_key}}
                    )
            openai_messages.append({"role": m.role.value, "content": content_parts})
        else:
            openai_messages.append({"role": m.role.value, "content": m.content})

    return StreamingResponse(
        _generate_sse(
            openai_messages, req.model, assistant_msg.id, user_msg.id, db,
            enable_thinking=req.enable_thinking,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _generate_sse(
    messages: list[dict[str, str]],
    model: str,
    assistant_msg_id: uuid.UUID,
    user_msg_id: uuid.UUID,
    db: AsyncSession,
    *,
    enable_thinking: bool = False,
) -> AsyncGenerator[str, None]:
    payload = json.dumps(
        {"user_message_id": str(user_msg_id), "assistant_message_id": str(assistant_msg_id), "model": model}  # noqa: E501
    )
    yield f"event: message_start\ndata: {payload}\n\n"

    full_content = ""
    full_thinking = ""
    # 思考耗时统计：首个 reasoning token → 首个 content token 之间的间隔（毫秒）
    thinking_start_at: float | None = None
    thinking_duration_ms: int | None = None
    try:
        async for event_type, token in stream_chat(model, messages, enable_thinking=enable_thinking):  # type: ignore[arg-type]
            if event_type == "thinking":
                if thinking_start_at is None:
                    thinking_start_at = time.monotonic()
                full_thinking += token
                delta = json.dumps({"token": token}, ensure_ascii=False)
                yield f"event: thinking_delta\ndata: {delta}\n\n"
            else:
                # 首个正文 token 到达时，思考阶段结束——记录耗时
                if thinking_start_at is not None and thinking_duration_ms is None:
                    thinking_duration_ms = int((time.monotonic() - thinking_start_at) * 1000)
                full_content += token
                delta = json.dumps({"token": token}, ensure_ascii=False)
                yield f"event: content_delta\ndata: {delta}\n\n"

        # 极端场景：只有思考没有正文（模型异常提前结束），也补记耗时
        if thinking_start_at is not None and thinking_duration_ms is None:
            thinking_duration_ms = int((time.monotonic() - thinking_start_at) * 1000)

        # 更新 assistant 消息内容（含思考内容 + 耗时）
        result = await db.execute(select(Message).where(Message.id == assistant_msg_id))
        msg = result.scalar_one()
        msg.content = full_content
        if full_thinking:
            msg.thinking_content = full_thinking
        if thinking_duration_ms is not None:
            msg.thinking_duration_ms = thinking_duration_ms
        await db.commit()

        yield (
            f"event: message_end\n"
            f"data: {json.dumps({'tokens_used': 0, 'finish_reason': 'stop'})}\n\n"
        )
    except Exception as e:
        yield (
            f"event: error\n"
            f"data: {json.dumps({'code': 'STREAM_ERROR', 'message': str(e)})}\n\n"
        )

    yield "data: [DONE]\n\n"


async def _get_user_conv(
    conv_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession
) -> Conversation:
    result = await db.execute(select(Conversation).where(Conversation.id == conv_id))
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(404, {"code": "CONVERSATION_NOT_FOUND", "message": "会话不存在"})
    if conv.user_id != user_id:
        raise HTTPException(403, {"code": "CONVERSATION_ACCESS_DENIED", "message": "无权访问"})
    return conv
