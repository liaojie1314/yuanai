import asyncio
import base64
import json
import logging
import time
import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DB, CurrentUser
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.conversation import Conversation
from app.models.file import File, MessageFile
from app.models.media_generation_task import MediaGenerationTask
from app.models.message import Message, MessageRole
from app.schemas.chat import (
    ConversationResponse,
    CreateConversationRequest,
    MessageFileResponse,
    MessageResponse,
    SendMessageRequest,
    TemporaryChatRequest,
    UpdateConversationRequest,
)
from app.schemas.media_generation import MediaGenerationTaskResponse
from app.services.ai_service import ModelVisionUnsupportedError, stream_chat
from app.services.conversation_title_service import (
    ConversationTitleResult,
    fallback_title,
    generate_and_store_title,
)
from app.services.file_extract_service import extract_preview, preview_context
from app.services.push_service import send_to_user
from app.services.storage_service import storage

logger = logging.getLogger(__name__)

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
        # 活跃时间倒序：有消息的按 last_message_at，新建空会话回退 created_at
        .order_by(
            Conversation.is_pinned.desc(),
            func.coalesce(Conversation.last_message_at, Conversation.created_at).desc(),
        )
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
        conv.title_source = "manual"
        conv.title_generated_at = datetime.now(UTC)
    if req.model is not None:
        conv.model = req.model
    if req.is_pinned is not None:
        conv.is_pinned = req.is_pinned
    await db.commit()
    await db.refresh(conv)
    return ConversationResponse.model_validate(conv)


@router.delete("/conversations/{conv_id}", status_code=204)
async def delete_conversation(conv_id: uuid.UUID, current_user: CurrentUser, db: DB) -> None:
    conv = await _get_user_conv(conv_id, current_user.id, db)
    await db.delete(conv)
    await db.commit()


@router.delete("/conversations", status_code=200)
async def delete_all_conversations(current_user: CurrentUser, db: DB) -> dict[str, int]:
    """一次性删除当前用户的所有会话（含消息，通过 ondelete=CASCADE 级联）。"""
    result = await db.execute(delete(Conversation).where(Conversation.user_id == current_user.id))
    await db.commit()
    return {"deleted": int(result.rowcount or 0)}  # type: ignore[attr-defined]


@router.get("/conversations/{conv_id}/messages")
async def list_messages(conv_id: uuid.UUID, current_user: CurrentUser, db: DB) -> dict[str, object]:
    await _get_user_conv(conv_id, current_user.id, db)
    result = await db.execute(
        select(Message)
        .where(Message.conv_id == conv_id)
        # 旧数据中可能有同一时间戳的成对消息。优先用户消息可修复 UUID
        # 二级排序把媒体任务卡置于其提问前面，随后仍以 ID 保证顺序稳定。
        .order_by(
            Message.created_at,
            case((Message.role == MessageRole.user, 0), else_=1),
            Message.id,
        )
        .limit(200)
    )
    messages = result.scalars().all()

    # 批量联查消息附件（Message 模型上无 relationship，这里手动组装 files）
    files_by_msg: dict[uuid.UUID, list[MessageFileResponse]] = {}
    tasks_by_message: dict[uuid.UUID, MediaGenerationTaskResponse] = {}
    if messages:
        from app.services.storage_service import storage

        mf_rows = await db.execute(
            select(MessageFile, File)
            .join(File, File.id == MessageFile.file_id)
            .where(MessageFile.message_id.in_([m.id for m in messages]))
            .order_by(MessageFile.sort_order)
        )
        for mf, f in mf_rows.all():
            files_by_msg.setdefault(mf.message_id, []).append(
                MessageFileResponse(
                    id=f.id,
                    filename=f.filename,
                    mime_type=f.mime_type,
                    size_bytes=f.size_bytes,
                    url=storage.get_url(f.s3_key),
                )
            )
        task_rows = await db.execute(
            select(MediaGenerationTask).where(
                MediaGenerationTask.message_id.in_([message.id for message in messages])
            )
        )
        tasks_by_message = {
            task.message_id: MediaGenerationTaskResponse.from_task(task, storage)
            for task in task_rows.scalars()
        }

    items: list[MessageResponse] = []
    for m in messages:
        item = MessageResponse.model_validate(m)
        item.files = files_by_msg.get(m.id, [])
        item.media_task = tasks_by_message.get(m.id)
        items.append(item)
    return {
        "messages": items,
        "next_cursor": None,
        "has_more": False,
    }


@router.post("/stream")
async def stream_chat_endpoint(
    req: SendMessageRequest, current_user: CurrentUser, db: DB
) -> StreamingResponse:
    conv = await _get_user_conv(req.conversation_id, current_user.id, db)

    if req.replace_message_id is not None and req.regenerate_from_message_id is not None:
        raise HTTPException(
            422,
            {
                "code": "INVALID_MESSAGE_OPERATION",
                "message": "编辑消息和重新生成不能同时执行",
            },
        )

    regenerated_from_message_id: uuid.UUID | None = None
    if req.regenerate_from_message_id is not None:
        source_result = await db.execute(
            select(Message.id)
            .where(Message.id == req.regenerate_from_message_id)
            .where(Message.conv_id == conv.id)
            .where(Message.role == MessageRole.user)
        )
        regenerated_from_message_id = source_result.scalar_one_or_none()
        if regenerated_from_message_id is None:
            raise HTTPException(404, {"code": "MESSAGE_NOT_FOUND", "message": "消息不存在"})

    now = datetime.now(UTC)
    is_first_user_message = False
    if req.replace_message_id is None and conv.title_source == "default":
        existing_user_message = await db.execute(
            select(Message.id)
            .where(Message.conv_id == conv.id)
            .where(Message.role == MessageRole.user)
            .limit(1)
        )
        is_first_user_message = existing_user_message.scalar_one_or_none() is None

    title_fallback: dict[str, str] | None = None
    if req.replace_message_id is None:
        # 用显式时间戳强制 user 早于 assistant，避免同一事务下 server_default=func.now()
        # 让两条记录拿到完全相同的 created_at，导致 order_by(created_at) 顺序不确定，
        # 进而在前端 buildPairs 中把 assistant 归到上一个用户消息下（表现为回复错位/丢失）。
        user_msg = Message(
            conv_id=conv.id,
            role=MessageRole.user,
            content=req.message.content,
            regenerated_from_message_id=regenerated_from_message_id,
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
        existing_user_msg = result.scalar_one_or_none()
        if existing_user_msg is None:
            raise HTTPException(404, {"code": "MESSAGE_NOT_FOUND", "message": "消息不存在"})
        user_msg = existing_user_msg
        # 编辑历史问题会使后续上下文失效，因此保留编辑消息本身，删除其后的旧分支。
        await db.execute(
            delete(Message)
            .where(Message.conv_id == conv.id)
            .where(Message.created_at > user_msg.created_at)
        )
        user_msg.content = req.message.content

    # 创建 assistant 消息占位（流式填充内容）
    assistant_msg = Message(
        conv_id=conv.id,
        role=MessageRole.assistant,
        content="",
        model=req.model,
        created_at=now + timedelta(microseconds=1),
    )
    db.add(assistant_msg)
    # 同步推进会话活跃时间：前端分组/排序以 last_message_at 为准；
    # 取 assistant 占位的 created_at，与 list_messages 里的最新一条一致。
    conv.last_message_at = assistant_msg.created_at
    if is_first_user_message:
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
    if is_first_user_message:
        title_task = asyncio.create_task(generate_and_store_title(conv.id, req.message.content))

    # 新消息关联上传文件；编辑既有消息时保留其原附件。
    attached_files: list[File] = []
    if req.message.file_ids and req.replace_message_id is None:
        file_results = await db.execute(
            select(File)
            .where(File.id.in_(req.message.file_ids))
            .where(File.user_id == current_user.id)
        )
        attached_files = list(file_results.scalars().all())
        for i, f in enumerate(attached_files):
            db.add(MessageFile(message_id=user_msg.id, file_id=f.id, sort_order=i))
        await db.commit()
    elif req.replace_message_id is not None:
        file_results = await db.execute(
            select(File)
            .join(MessageFile, MessageFile.file_id == File.id)
            .where(MessageFile.message_id == user_msg.id)
        )
        attached_files = list(file_results.scalars().all())

    # 构建历史消息（最多 50 条，排除刚创建的空 assistant 占位）
    history_result = await db.execute(
        select(Message)
        .where(Message.conv_id == conv.id)
        .where(Message.id != assistant_msg.id)  # 排除空占位，避免模型误以为已回复
        .order_by(Message.created_at, Message.id)
        .limit(50)
    )
    history = history_result.scalars().all()

    files_by_message_id: dict[uuid.UUID, list[File]] = {}
    if history:
        history_file_result = await db.execute(
            select(MessageFile, File)
            .join(File, File.id == MessageFile.file_id)
            .where(MessageFile.message_id.in_([message.id for message in history]))
            .order_by(MessageFile.message_id, MessageFile.sort_order)
        )
        for message_file, file in history_file_result.all():
            files_by_message_id.setdefault(message_file.message_id, []).append(file)

    # 构造 OpenAI 格式消息列表；每条带附件的历史用户消息均保留文件上下文。
    openai_messages: list[dict[str, object]] = []
    for m in history:
        message_files = files_by_message_id.get(m.id, [])
        if message_files:
            # 带附件的用户消息：组装内容数组，避免后续追问丢失文件上下文。
            content_parts: list[dict[str, object]] = [{"type": "text", "text": m.content}]
            for af in message_files:
                if af.mime_type.startswith("image/"):
                    image_data = await storage.get_object(af.s3_key)
                    if len(image_data) <= settings.ai_inline_image_max_bytes:
                        encoded = base64.b64encode(image_data).decode("ascii")
                        content_parts.append(
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{af.mime_type};base64,{encoded}",
                                },
                            }
                        )
                    else:
                        content_parts.append(
                            {
                                "type": "text",
                                "text": (
                                    f"\n[{af.filename}] 图片已上传，但超过 "
                                    "视觉识别大小限制，无法发送给当前模型。"
                                ),
                            }
                        )
                else:
                    extracted = extract_preview(
                        await storage.get_object(af.s3_key), af.mime_type, af.filename
                    )
                    context = preview_context(extracted)
                    if context:
                        content_parts.append(
                            {"type": "text", "text": f"\n[{af.filename}]\n{context}"}
                        )
            openai_messages.append({"role": m.role.value, "content": content_parts})
        else:
            openai_messages.append({"role": m.role.value, "content": m.content})

    return StreamingResponse(
        _generate_sse(
            openai_messages,
            req.model,
            assistant_msg.id,
            user_msg.id,
            db,
            enable_thinking=req.enable_thinking,
            user_id=current_user.id,
            conv_id=conv.id,
            initial_title_update=title_fallback,
            title_task=title_task,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/stream/temporary")
async def stream_temporary_chat(
    req: TemporaryChatRequest, current_user: CurrentUser
) -> StreamingResponse:
    """临时对话流式接口。

    与 `/stream` 的差异：
    - 不落库、无 conversation_id、无附件；历史由前端在请求体 `messages` 中维护
    - 不产生 message / user_message_id / assistant_message_id
    - SSE 事件序列与 `/stream` 完全一致（`message_start`/`content_delta`/
      `thinking_delta`/`message_end`），前端 `useStream` 无需分叉
    - 会话结束即遗忘，不出现在会话列表和用户统计中
    """
    # 转换为 OpenAI 消息格式；限长防滥用（前端也会做，但服务端兜底）
    openai_messages: list[dict[str, object]] = [
        {"role": m.role, "content": m.content} for m in req.messages[-50:]
    ]
    return StreamingResponse(
        _generate_temp_sse(openai_messages, req.model, enable_thinking=req.enable_thinking),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _generate_temp_sse(
    messages: list[dict[str, object]],
    model: str,
    *,
    enable_thinking: bool = False,
) -> AsyncGenerator[str, None]:
    """临时对话专用 SSE 生成器：与 `_generate_sse` 事件协议一致，但无 DB 依赖。"""
    payload = json.dumps({"model": model, "temporary": True})
    yield f"event: message_start\ndata: {payload}\n\n"

    thinking_start_at: float | None = None
    thinking_duration_ms: int | None = None
    try:
        async for event_type, token in stream_chat(
            model, messages, enable_thinking=enable_thinking
        ):
            if event_type == "thinking":
                if thinking_start_at is None:
                    thinking_start_at = time.monotonic()
                delta = json.dumps({"token": token}, ensure_ascii=False)
                yield f"event: thinking_delta\ndata: {delta}\n\n"
            else:
                if thinking_start_at is not None and thinking_duration_ms is None:
                    thinking_duration_ms = int((time.monotonic() - thinking_start_at) * 1000)
                delta = json.dumps({"token": token}, ensure_ascii=False)
                yield f"event: content_delta\ndata: {delta}\n\n"

        end_payload: dict[str, object] = {"tokens_used": 0, "finish_reason": "stop"}
        if thinking_duration_ms is not None:
            end_payload["thinking_duration_ms"] = thinking_duration_ms
        yield f"event: message_end\ndata: {json.dumps(end_payload)}\n\n"
    except ModelVisionUnsupportedError as e:
        payload = json.dumps({"code": "MODEL_VISION_UNSUPPORTED", "message": str(e)})
        yield f"event: error\ndata: {payload}\n\n"
    except Exception as e:
        yield (f"event: error\ndata: {json.dumps({'code': 'STREAM_ERROR', 'message': str(e)})}\n\n")

    yield "data: [DONE]\n\n"


async def _persist_partial(
    assistant_msg_id: uuid.UUID,
    content: str,
    thinking: str,
    thinking_duration_ms: int | None,
) -> None:
    """客户端中途断开时，把已生成的部分内容写入 assistant 占位消息。

    用独立 session：调用点所在任务正在被取消，请求作用域的 session 随时会被
    关闭，不能再用。仅在占位仍为空时写入，避免与正常收尾路径竞态双写。
    """
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Message).where(Message.id == assistant_msg_id))
            msg = result.scalar_one_or_none()
            if msg is None or msg.content:
                return
            msg.content = content
            if thinking:
                msg.thinking_content = thinking
            if thinking_duration_ms is not None:
                msg.thinking_duration_ms = thinking_duration_ms
            await db.commit()
    except Exception as e:  # noqa: BLE001 - 收尾兜底，任何异常只记日志
        logger.warning("部分内容落库失败 (msg=%s): %s", assistant_msg_id, e)


async def _generate_sse(
    messages: list[dict[str, object]],
    model: str,
    assistant_msg_id: uuid.UUID,
    user_msg_id: uuid.UUID,
    db: AsyncSession,
    *,
    enable_thinking: bool = False,
    user_id: uuid.UUID | None = None,
    conv_id: uuid.UUID | None = None,
    initial_title_update: dict[str, str] | None = None,
    title_task: asyncio.Task[ConversationTitleResult | None] | None = None,
) -> AsyncGenerator[str, None]:
    payload = json.dumps(
        {
            "user_message_id": str(user_msg_id),
            "assistant_message_id": str(assistant_msg_id),
            "model": model,
        }  # noqa: E501
    )
    yield f"event: message_start\ndata: {payload}\n\n"
    if initial_title_update is not None:
        yield (
            "event: conversation_title\n"
            f"data: {json.dumps(initial_title_update, ensure_ascii=False)}\n\n"
        )

    full_content = ""
    full_thinking = ""
    # 思考耗时统计：首个 reasoning token → 首个 content token 之间的间隔（毫秒）
    thinking_start_at: float | None = None
    thinking_duration_ms: int | None = None
    title_update_sent = False

    def take_title_update() -> ConversationTitleResult | None:
        """读取已完成标题任务，标题失败绝不能影响聊天 SSE。"""
        if title_task is None or not title_task.done() or title_update_sent:
            return None
        try:
            return title_task.result()
        except (OSError, RuntimeError):
            logger.warning("会话标题后台任务异常 (conversation=%s)", conv_id)
            return None

    try:
        async for event_type, token in stream_chat(
            model, messages, enable_thinking=enable_thinking
        ):
            title_update = take_title_update()
            if title_update is not None:
                title_update_sent = True
                yield (
                    "event: conversation_title\n"
                    f"data: {json.dumps(title_update, ensure_ascii=False)}\n\n"
                )
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

        # 回复很快结束时留一个极短窗口给标题任务。它不会延迟首个回复 token；
        # 若仍未完成，任务继续独立落库，常规会话缓存刷新会读到最终标题。
        if title_task is not None and not title_task.done():
            try:
                await asyncio.wait_for(asyncio.shield(title_task), timeout=0.25)
            except TimeoutError:
                pass
        title_update = take_title_update()
        if title_update is not None:
            title_update_sent = True
            yield (
                "event: conversation_title\n"
                f"data: {json.dumps(title_update, ensure_ascii=False)}\n\n"
            )

        # 更新 assistant 消息内容（含思考内容 + 耗时）
        result = await db.execute(select(Message).where(Message.id == assistant_msg_id))
        msg = result.scalar_one()
        msg.content = full_content
        if full_thinking:
            msg.thinking_content = full_thinking
        if thinking_duration_ms is not None:
            msg.thinking_duration_ms = thinking_duration_ms
        await db.commit()

        # AI 回复落库后，向该用户推送「回复完成」通知（Web Push + Expo Push）。
        # 标签页/App 在前台时前端会跳过弹窗；未配置 VAPID 时 Web 通道 no-op。
        # 推送失败不影响已完成的回复，故整体包一层 try 兜底。
        if user_id is not None:
            try:
                await send_to_user(
                    db,
                    user_id,
                    {
                        "title": "元AI",
                        "body": "AI 回复已完成",
                        "url": f"/chat/{conv_id}" if conv_id is not None else "/chat",
                        # 移动端通知点击用 convId 直接路由到会话
                        "convId": str(conv_id) if conv_id is not None else None,
                        "tag": "yuanai-ai-reply",
                    },
                )
            except Exception:  # noqa: BLE001 - 推送为尽力而为，任何异常都不应打断响应
                pass

        yield (
            f"event: message_end\n"
            f"data: {json.dumps({'tokens_used': 0, 'finish_reason': 'stop'})}\n\n"
        )
    except asyncio.CancelledError:
        # 客户端中途断开（用户点了停止 / 杀进程）：StreamingResponse 取消本生成器。
        # 把已生成的部分内容落库（shield 防止落库操作本身也被取消），再继续抛出
        # 让取消语义正常传播。
        if full_content or full_thinking:
            await asyncio.shield(
                _persist_partial(
                    assistant_msg_id, full_content, full_thinking, thinking_duration_ms
                )
            )
        raise
    except ModelVisionUnsupportedError as e:
        payload = json.dumps({"code": "MODEL_VISION_UNSUPPORTED", "message": str(e)})
        yield f"event: error\ndata: {payload}\n\n"
    except Exception as e:
        logger.exception("stream_chat failed for assistant_msg=%s", assistant_msg_id)
        # 与 CancelledError 分支一致：把已收到的部分内容落库，避免 DB 里留一条空 assistant
        # 记录。上游 SDK 冷启动/连接抖动等偶发异常也能保住部分回复给用户看。
        if full_content or full_thinking:
            try:
                await _persist_partial(
                    assistant_msg_id, full_content, full_thinking, thinking_duration_ms
                )
            except Exception:  # noqa: BLE001 - 落库失败不应遮蔽原始错误
                logger.exception(
                    "persist partial on error failed for assistant_msg=%s", assistant_msg_id
                )
        yield (f"event: error\ndata: {json.dumps({'code': 'STREAM_ERROR', 'message': str(e)})}\n\n")

    yield "data: [DONE]\n\n"


async def _get_user_conv(conv_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession) -> Conversation:
    result = await db.execute(select(Conversation).where(Conversation.id == conv_id))
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(404, {"code": "CONVERSATION_NOT_FOUND", "message": "会话不存在"})
    if conv.user_id != user_id:
        raise HTTPException(403, {"code": "CONVERSATION_ACCESS_DENIED", "message": "无权访问"})
    return conv
