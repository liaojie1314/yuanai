"""从成功的 Agent Run 抽取候选记忆，并决定其敏感度与生命周期。"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.agent_run import AgentRun, AgentStepKind
from app.models.assistant import Assistant
from app.models.memory import (
    Memory,
    MemorySensitivity,
    MemoryStatus,
    MemoryType,
)
from app.models.message import Message
from app.services.ai_service import (
    ExtractedMemory,
    extract_memory_candidates,
    maybe_embed_text,
)

logger = logging.getLogger(__name__)

SENSITIVE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\b\d{17}[\dXx]\b"),  # 证件号
    re.compile(r"\b\d{16,19}\b"),  # 银行卡号
    re.compile(r"\b1[3-9]\d{9}\b"),  # 中国大陆手机号
    re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"),  # 邮箱
    re.compile(r"(?:密码|口令|密钥|token|secret)", re.I),  # 凭据字样
)
_PUNCTUATION = re.compile(r"[\s，。；、,.;!?！？　]+")
TRANSCRIPT_STEP_LIMIT = 20
TRANSCRIPT_MESSAGE_LIMIT = 20
TRANSCRIPT_CHAR_LIMIT = 6000


def classify_sensitivity(content: str) -> MemorySensitivity:
    """按 PII 与凭据特征给内容定级；命中任一模式即为 sensitive。"""

    for pattern in SENSITIVE_PATTERNS:
        if pattern.search(content):
            return MemorySensitivity.sensitive
    return MemorySensitivity.personal


def _normalize(content: str) -> str:
    """去掉空白与中英文标点，用于判断两条记忆是否实质相同。"""

    return _PUNCTUATION.sub("", content).lower()


async def find_duplicate(
    *, user_id: uuid.UUID, assistant_id: uuid.UUID, content: str, db: AsyncSession
) -> Memory | None:
    """查找同一助理下内容实质相同的记忆，避免反复写入同一事实。

    归一化比较在 Python 侧完成：``to_tsvector('simple', …)`` 会把整句中文压成单个
    lexeme，数据库全文匹配无法判断中文子串是否相同，因此这里不走 ``search_vector``。
    """

    # ponytail: 逐条拉取同助理的 active/candidate 记忆做归一化比较，
    # 单助理记忆量级上千后需改为落库归一化列 + 唯一索引。
    target = _normalize(content)
    existing = await db.scalars(
        select(Memory).where(
            Memory.user_id == user_id,
            Memory.assistant_id == assistant_id,
            Memory.status.in_((MemoryStatus.active, MemoryStatus.candidate)),
        )
    )
    for memory in existing:
        if memory.content and _normalize(memory.content) == target:
            return memory
    return None


async def find_conflict(
    *, user_id: uuid.UUID, assistant_id: uuid.UUID, subject: str, db: AsyncSession
) -> Memory | None:
    """查找同一主题上已生效的记忆，作为新事实的被取代对象。

    按 ``structured_data['subject']`` 做精确相等匹配，不依赖全文检索，
    因此中文主题同样可靠。
    """

    if not subject.strip():
        return None
    latest: Memory | None = await db.scalar(
        select(Memory)
        .where(
            Memory.user_id == user_id,
            Memory.assistant_id == assistant_id,
            Memory.status == MemoryStatus.active,
            Memory.structured_data["subject"].as_string() == subject,
        )
        .order_by(Memory.updated_at.desc())
    )
    return latest


def decide_status(
    candidate: ExtractedMemory,
    *,
    sensitivity: MemorySensitivity,
    conflict: Memory | None,
    disabled_types: set[str],
) -> MemoryStatus | None:
    """按阶段文档 §4.1 的五个条件决定丢弃、候选还是自动激活。

    返回 ``None`` 表示丢弃。任何一个条件不满足都退回 candidate 交用户确认，
    歧义一律不自动激活。
    """

    if candidate.memory_type in disabled_types:
        return None
    if sensitivity in {MemorySensitivity.sensitive, MemorySensitivity.restricted}:
        return MemoryStatus.candidate
    if not candidate.explicit or not candidate.stable or conflict is not None:
        return MemoryStatus.candidate
    return MemoryStatus.active


async def _build_transcript(run: AgentRun, db: AsyncSession) -> str:
    """把 Run 的任务记录压成一段有界文本，供抽取模型阅读。

    优先使用 Run 所属会话的消息 —— 用户事实只出现在自然语言里；Run 未绑定会话时
    退化为工具调用记录。``AgentStep`` 只持久化 ``input_json``，没有自然语言字段。
    """

    if run.conversation_id is not None:
        messages = await db.scalars(
            select(Message)
            .where(Message.conv_id == run.conversation_id)
            .order_by(Message.created_at)
            .limit(TRANSCRIPT_MESSAGE_LIMIT)
        )
        lines = [f"{message.role.value}：{message.content.strip()}" for message in messages]
        return "\n".join(lines)[:TRANSCRIPT_CHAR_LIMIT]
    tool_lines = [
        f"工具 {step.input_json.get('name')}：{step.input_json.get('arguments')}"
        for step in list(run.steps)[:TRANSCRIPT_STEP_LIMIT]
        if step.kind is AgentStepKind.tool and step.input_json
    ]
    return "\n".join(tool_lines)[:TRANSCRIPT_CHAR_LIMIT]


async def extract_from_run(
    *, run_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession
) -> list[Memory]:
    """读取一次成功的 Run，抽取候选并按策略落库，返回新建的记忆。"""

    run = await db.scalar(
        select(AgentRun)
        .options(selectinload(AgentRun.steps))
        .where(AgentRun.id == run_id, AgentRun.user_id == user_id)
    )
    if run is None:
        return []
    assistant = await db.scalar(
        select(Assistant).where(Assistant.id == run.assistant_id, Assistant.user_id == user_id)
    )
    if assistant is None:
        return []
    candidates = await extract_memory_candidates(
        goal=run.goal, transcript=await _build_transcript(run, db)
    )
    if candidates is None:
        logger.info("记忆抽取不可用，Run %s 本次不产生候选", run_id)
        return []
    disabled = {str(item) for item in (assistant.disabled_memory_types or [])}
    now = datetime.now(UTC)
    created: list[Memory] = []
    for candidate in candidates:
        if await find_duplicate(
            user_id=user_id, assistant_id=assistant.id, content=candidate.content, db=db
        ):
            continue
        sensitivity = classify_sensitivity(candidate.content)
        conflict = await find_conflict(
            user_id=user_id, assistant_id=assistant.id, subject=candidate.subject, db=db
        )
        status = decide_status(
            candidate, sensitivity=sensitivity, conflict=conflict, disabled_types=disabled
        )
        if status is None:
            continue
        memory = Memory(
            user_id=user_id,
            assistant_id=assistant.id,
            memory_type=MemoryType(candidate.memory_type),
            content=candidate.content,
            structured_data={"subject": candidate.subject},
            source_type="agent_run",
            source_id=str(run.id),
            source_excerpt=run.goal[:2000],
            confidence=candidate.confidence,
            sensitivity=sensitivity,
            status=status,
        )
        if status is MemoryStatus.active:
            memory.embedding = await maybe_embed_text(candidate.content)
            memory.valid_from = now
            if conflict is not None:
                conflict.status = MemoryStatus.superseded
        db.add(memory)
        created.append(memory)
    await db.flush()
    return created
