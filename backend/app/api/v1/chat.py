import asyncio
import json
import logging
import time
import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DB, CurrentUser
from app.core.database import AsyncSessionLocal
from app.models.conversation import Conversation
from app.models.file import File, MessageFile
from app.models.media_generation_task import MediaGenerationTask
from app.models.message import Message, MessageRole
from app.schemas.chat import (
    ChatCapabilitiesResponse,
    ConversationResponse,
    CreateConversationRequest,
    MessageFileResponse,
    MessageResponse,
    SearchCapabilityResponse,
    SendMessageRequest,
    TemporaryChatRequest,
    UpdateConversationRequest,
)
from app.schemas.media_generation import MediaGenerationTaskResponse
from app.services.ai_service import ModelVisionUnsupportedError, stream_chat
from app.services.chat_service import stream_chat_response
from app.services.conversation_title_service import (
    ConversationTitleResult,
    generate_and_store_title,
)
from app.services.push_service import send_to_user
from app.services.tools.search import get_search_capability

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])


@router.get("/capabilities", response_model=ChatCapabilitiesResponse)
async def get_chat_capabilities(_current_user: CurrentUser) -> ChatCapabilitiesResponse:
    """返回当前账户可用的聊天扩展能力，不暴露 provider 配置和密钥。"""
    capability = await get_search_capability()
    return ChatCapabilitiesResponse(
        web_search=SearchCapabilityResponse(
            enabled=capability.enabled,
            provider=capability.provider,
            reason=capability.reason,
        )
    )


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
    """认证、参数解析和响应编排；聊天事务由 chat_service 负责。"""
    return await stream_chat_response(
        req,
        user_id=current_user.id,
        db=db,
        sse_generator=_generate_sse,
        title_generator=generate_and_store_title,
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
        _generate_temp_sse(
            openai_messages,
            req.model,
            enable_thinking=req.enable_thinking,
            enable_web_search=req.enable_web_search,
            user_id=current_user.id,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _generate_temp_sse(
    messages: list[dict[str, object]],
    model: str,
    *,
    enable_thinking: bool = False,
    enable_web_search: bool = False,
    user_id: uuid.UUID | None = None,
) -> AsyncGenerator[str, None]:
    """临时对话专用 SSE 生成器：与 `_generate_sse` 事件协议一致，但无 DB 依赖。"""
    payload = json.dumps({"model": model, "temporary": True})
    yield f"event: message_start\ndata: {payload}\n\n"

    thinking_start_at: float | None = None
    thinking_duration_ms: int | None = None
    try:
        async for event_type, value in stream_chat(
            model,
            messages,
            enable_thinking=enable_thinking,
            enable_web_search=enable_web_search,
            user_id=user_id,
        ):
            if event_type == "thinking":
                if not isinstance(value, str):
                    continue
                if thinking_start_at is None:
                    thinking_start_at = time.monotonic()
                delta = json.dumps({"token": value}, ensure_ascii=False)
                yield f"event: thinking_delta\ndata: {delta}\n\n"
            elif event_type == "content":
                if not isinstance(value, str):
                    continue
                if thinking_start_at is not None and thinking_duration_ms is None:
                    thinking_duration_ms = int((time.monotonic() - thinking_start_at) * 1000)
                delta = json.dumps({"token": value}, ensure_ascii=False)
                yield f"event: content_delta\ndata: {delta}\n\n"
            elif event_type in {"tool_call_start", "tool_call_delta", "tool_call_end"}:
                if isinstance(value, dict):
                    yield f"event: {event_type}\ndata: {json.dumps(value, ensure_ascii=False)}\n\n"

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
    tool_calls: list[dict[str, object]],
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
            if tool_calls:
                msg.tool_calls = tool_calls
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
    enable_web_search: bool = False,
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
    tool_calls: dict[str, dict[str, object]] = {}
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
        async for event_type, value in stream_chat(
            model,
            messages,
            enable_thinking=enable_thinking,
            enable_web_search=enable_web_search,
            user_id=user_id,
        ):
            title_update = take_title_update()
            if title_update is not None:
                title_update_sent = True
                yield (
                    "event: conversation_title\n"
                    f"data: {json.dumps(title_update, ensure_ascii=False)}\n\n"
                )
            if event_type == "thinking":
                if not isinstance(value, str):
                    continue
                if thinking_start_at is None:
                    thinking_start_at = time.monotonic()
                full_thinking += value
                delta = json.dumps({"token": value}, ensure_ascii=False)
                yield f"event: thinking_delta\ndata: {delta}\n\n"
            elif event_type == "content":
                if not isinstance(value, str):
                    continue
                # 首个正文 token 到达时，思考内容结束——记录耗时
                if thinking_start_at is not None and thinking_duration_ms is None:
                    thinking_duration_ms = int((time.monotonic() - thinking_start_at) * 1000)
                full_content += value
                delta = json.dumps({"token": value}, ensure_ascii=False)
                yield f"event: content_delta\ndata: {delta}\n\n"
            elif event_type == "tool_call_start" and isinstance(value, dict):
                tool_call_id = value.get("tool_call_id")
                name = value.get("name")
                if isinstance(tool_call_id, str) and isinstance(name, str):
                    tool_calls[tool_call_id] = {
                        "id": tool_call_id,
                        "name": name,
                        "arguments": "",
                        "status": "running",
                    }
                    data = json.dumps(value, ensure_ascii=False)
                    yield f"event: tool_call_start\ndata: {data}\n\n"
            elif event_type == "tool_call_delta" and isinstance(value, dict):
                tool_call_id = value.get("tool_call_id")
                args_chunk = value.get("args_chunk")
                call = tool_calls.get(tool_call_id) if isinstance(tool_call_id, str) else None
                if call is not None and isinstance(args_chunk, str):
                    call["arguments"] = str(call["arguments"]) + args_chunk
                    data = json.dumps(value, ensure_ascii=False)
                    yield f"event: tool_call_delta\ndata: {data}\n\n"
            elif event_type == "tool_call_end" and isinstance(value, dict):
                tool_call_id = value.get("tool_call_id")
                call = tool_calls.get(tool_call_id) if isinstance(tool_call_id, str) else None
                if call is not None:
                    for key in ("status", "result", "error", "duration_ms", "sources"):
                        if key in value:
                            call[key] = value[key]
                    yield f"event: tool_call_end\ndata: {json.dumps(value, ensure_ascii=False)}\n\n"

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
        if tool_calls:
            msg.tool_calls = list(tool_calls.values())
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
        if full_content or full_thinking or tool_calls:
            await asyncio.shield(
                _persist_partial(
                    assistant_msg_id,
                    full_content,
                    full_thinking,
                    thinking_duration_ms,
                    list(tool_calls.values()),
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
        if full_content or full_thinking or tool_calls:
            try:
                await _persist_partial(
                    assistant_msg_id,
                    full_content,
                    full_thinking,
                    thinking_duration_ms,
                    list(tool_calls.values()),
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
