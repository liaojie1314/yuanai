"""主动自动化的持久化、调度和标准 Agent Run 映射服务。"""

from __future__ import annotations

import re
import uuid
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from redis.exceptions import RedisError
from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.agent_run import AgentRun, AgentRunStatus
from app.models.approval import ApprovalRequest, ApprovalStatus
from app.models.assistant import Assistant
from app.models.automation import (
    Automation,
    AutomationRun,
    AutomationRunStatus,
    AutomationStatus,
    AutomationTrigger,
    AutomationTriggerType,
)
from app.schemas.automation import AutomationCreateRequest, AutomationUpdateRequest
from app.services.agent.access import is_agent_enabled_for
from app.services.agent.event_service import EventStore
from app.services.agent.queue import AgentQueue
from app.services.push_service import send_to_user


class AutomationNotFoundError(RuntimeError):
    """目标自动化不属于当前用户。"""


class AutomationValidationError(ValueError):
    """自动化时区或 cron 规则无效。"""


class AutomationStateError(RuntimeError):
    """自动化当前状态不允许请求的操作。"""


class AgentUnavailableError(RuntimeError):
    """当前用户不允许创建新的 Agent Run。"""


_CRON_RANGES = ((0, 59), (0, 23), (1, 31), (1, 12), (0, 7))
_CRON_TOKEN = re.compile(r"^(\*|\d+(?:-\d+)?)(?:/(\d+))?$")
WAITING_INPUT_TIMEOUT = timedelta(hours=24)


def validate_timezone(name: str) -> ZoneInfo:
    """校验并返回用户请求的 IANA 时区。"""

    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError as error:
        raise AutomationValidationError("TIMEZONE_INVALID") from error


def _parse_cron_field(value: str, minimum: int, maximum: int) -> tuple[set[int], bool]:
    """解析 cron 的一个字段，返回允许值和是否为通配符。"""

    if not value:
        raise AutomationValidationError("CRON_INVALID")
    values: set[int] = set()
    wildcard = False
    for part in value.split(","):
        match = _CRON_TOKEN.fullmatch(part)
        if match is None:
            raise AutomationValidationError("CRON_INVALID")
        base, step_text = match.groups()
        step = int(step_text or "1")
        if step <= 0:
            raise AutomationValidationError("CRON_INVALID")
        if base == "*":
            wildcard = True
            start, end = minimum, maximum
        elif "-" in base:
            start_text, end_text = base.split("-", 1)
            start, end = int(start_text), int(end_text)
            if end < start:
                raise AutomationValidationError("CRON_INVALID")
        else:
            start = end = int(base)
        if start < minimum or end > maximum:
            raise AutomationValidationError("CRON_INVALID")
        values.update(range(start, end + 1, step))
    if not values:
        raise AutomationValidationError("CRON_INVALID")
    return values, wildcard


def _parse_cron(expression: str) -> tuple[tuple[set[int], bool], ...]:
    """解析标准五字段 cron 表达式。"""

    fields = expression.split()
    if len(fields) != 5:
        raise AutomationValidationError("CRON_INVALID")
    return tuple(
        _parse_cron_field(value, minimum, maximum)
        for value, (minimum, maximum) in zip(fields, _CRON_RANGES, strict=True)
    )


def _cron_matches(candidate: datetime, parsed: tuple[tuple[set[int], bool], ...]) -> bool:
    """判断本地时间是否命中 cron；遵循 cron 的 DOM/DOW OR 语义。"""

    minute, hour, day, month, weekday = parsed
    if candidate.minute not in minute[0] or candidate.hour not in hour[0]:
        return False
    if candidate.month not in month[0]:
        return False
    day_match = candidate.day in day[0]
    cron_weekday = (candidate.weekday() + 1) % 7
    weekday_match = cron_weekday in weekday[0] or (cron_weekday == 0 and 7 in weekday[0])
    if day[1] and weekday[1]:
        return day_match or weekday_match
    if day[1]:
        return weekday_match
    if weekday[1]:
        return day_match
    return day_match or weekday_match


def _resolve_local_time(local: datetime, timezone: ZoneInfo, after: datetime) -> list[datetime]:
    """返回 DST 重复时间的有效 UTC 候选，跳过不存在的本地时间。"""

    results: list[datetime] = []
    for fold in (0, 1):
        candidate = local.replace(tzinfo=timezone, fold=fold)
        roundtrip = candidate.astimezone(UTC).astimezone(timezone).replace(tzinfo=None)
        if roundtrip != local:
            continue
        utc_candidate = candidate.astimezone(UTC)
        if utc_candidate > after and utc_candidate not in results:
            results.append(utc_candidate)
    return results


def next_cron_occurrence(expression: str, after: datetime, timezone_name: str) -> datetime:
    """计算用户时区下严格晚于 `after` 的下一次 cron 时间。"""

    if after.tzinfo is None:
        raise AutomationValidationError("DATETIME_TIMEZONE_REQUIRED")
    timezone = validate_timezone(timezone_name)
    parsed = _parse_cron(expression)
    after_utc = after.astimezone(UTC)
    local = after_utc.astimezone(timezone).replace(tzinfo=None, second=0, microsecond=0)
    for _ in range(366 * 24 * 60 * 2):
        if _cron_matches(local, parsed):
            candidates = _resolve_local_time(local, timezone, after_utc)
            if candidates:
                return min(candidates)
        local += timedelta(minutes=1)
    raise AutomationValidationError("CRON_NO_OCCURRENCE")


def occurrence_key(automation_id: uuid.UUID, scheduled_for: datetime) -> str:
    """生成稳定且可用于 AgentRun 唯一约束的触发幂等键。"""

    instant = scheduled_for.astimezone(UTC).isoformat(timespec="minutes").replace("+00:00", "Z")
    return f"automation:{automation_id}:{instant}"


def _automation_query() -> Select[tuple[Automation]]:
    """构造带触发器和历史的自动化查询。"""

    return select(Automation).options(
        selectinload(Automation.assistant),
        selectinload(Automation.trigger),
        selectinload(Automation.runs),
    )


async def create_automation(
    *, user_id: uuid.UUID, request: AutomationCreateRequest, db: AsyncSession
) -> Automation:
    """创建自动化定义并计算首个触发时间。"""

    assistant = await db.scalar(
        select(Assistant).where(Assistant.id == request.assistant_id, Assistant.user_id == user_id)
    )
    if assistant is None:
        raise AutomationNotFoundError()
    timezone = validate_timezone(request.timezone)
    now = datetime.now(UTC)
    trigger_request = request.trigger
    if trigger_request.trigger_type is AutomationTriggerType.once:
        if trigger_request.scheduled_at is None:
            raise AutomationValidationError("SCHEDULED_AT_REQUIRED")
        next_run_at = trigger_request.scheduled_at.astimezone(UTC)
        scheduled_at = next_run_at
    else:
        if trigger_request.cron_expression is None:
            raise AutomationValidationError("CRON_REQUIRED")
        _parse_cron(trigger_request.cron_expression)
        scheduled_at = None
        next_run_at = next_cron_occurrence(trigger_request.cron_expression, now, timezone.key)
    automation = Automation(
        user_id=user_id,
        assistant_id=assistant.id,
        name=request.name,
        goal=request.goal,
        model=request.model,
        max_steps=request.max_steps,
        timezone=timezone.key,
        status=AutomationStatus.active,
        trigger=AutomationTrigger(
            trigger_type=trigger_request.trigger_type,
            cron_expression=trigger_request.cron_expression,
            scheduled_at=scheduled_at,
            next_run_at=next_run_at,
        ),
    )
    db.add(automation)
    await db.commit()
    return await get_automation(automation.id, user_id=user_id, db=db)


async def list_automations(*, user_id: uuid.UUID, db: AsyncSession) -> list[Automation]:
    """列出当前用户的自动化及运行历史。"""

    return list(
        (await db.scalars(_automation_query().where(Automation.user_id == user_id))).unique().all()
    )


async def get_automation(
    automation_id: uuid.UUID, *, user_id: uuid.UUID, db: AsyncSession
) -> Automation:
    """按租户读取单个自动化。"""

    automation: Automation | None = await db.scalar(
        _automation_query().where(Automation.id == automation_id, Automation.user_id == user_id)
    )
    if automation is None:
        raise AutomationNotFoundError()
    return automation


async def update_automation(
    automation_id: uuid.UUID,
    *,
    user_id: uuid.UUID,
    request: AutomationUpdateRequest,
    db: AsyncSession,
) -> Automation:
    """更新自动化定义并支持暂停或恢复。"""

    automation = await get_automation(automation_id, user_id=user_id, db=db)
    changes = request.model_dump(exclude_unset=True)
    requested_status = changes.get("status")
    if (
        requested_status is AutomationStatus.active
        and automation.status is AutomationStatus.completed
    ):
        raise AutomationStateError("AUTOMATION_COMPLETED")
    for field, value in changes.items():
        setattr(automation, field, value)
    await db.commit()
    return await get_automation(automation_id, user_id=user_id, db=db)


async def delete_automation(
    automation_id: uuid.UUID, *, user_id: uuid.UUID, db: AsyncSession
) -> None:
    """删除当前用户的自动化定义及其历史。"""

    automation = await get_automation(automation_id, user_id=user_id, db=db)
    await db.delete(automation)
    await db.commit()


async def claim_due_automations(
    *, now: datetime, db: AsyncSession, limit: int = 100
) -> list[AutomationRun]:
    """以行锁认领到期触发器，并在同一事务创建唯一 Agent Run。"""

    now_utc = now.astimezone(UTC)
    triggers = list(
        (
            await db.scalars(
                select(AutomationTrigger)
                .join(Automation)
                .options(
                    selectinload(AutomationTrigger.automation).selectinload(Automation.assistant)
                )
                .where(
                    Automation.status == AutomationStatus.active,
                    AutomationTrigger.next_run_at.is_not(None),
                    AutomationTrigger.next_run_at <= now_utc,
                )
                .order_by(AutomationTrigger.next_run_at)
                .with_for_update(skip_locked=True)
                .limit(max(1, min(limit, 500)))
            )
        ).all()
    )
    claimed: list[AutomationRun] = []
    for trigger in triggers:
        scheduled_for = trigger.next_run_at
        if scheduled_for is None:
            continue
        automation = trigger.automation
        if not is_agent_enabled_for(automation.user_id):
            continue
        key = occurrence_key(automation.id, scheduled_for)
        existing = await db.scalar(
            select(AutomationRun).where(
                AutomationRun.automation_id == automation.id,
                AutomationRun.occurrence_key == key,
            )
        )
        if existing is not None:
            _advance_trigger(trigger, automation, scheduled_for)
            continue
        agent_run = AgentRun(
            user_id=automation.user_id,
            assistant_id=automation.assistant_id,
            goal=automation.goal,
            model=automation.model or automation.assistant.default_model,
            max_steps=automation.max_steps,
            idempotency_key=key,
        )
        automation_run = AutomationRun(
            automation_id=automation.id,
            user_id=automation.user_id,
            agent_run=agent_run,
            occurrence_key=key,
            scheduled_for=scheduled_for,
            status=AutomationRunStatus.queued,
        )
        db.add(automation_run)
        _advance_trigger(trigger, automation, scheduled_for)
        claimed.append(automation_run)
    await db.commit()
    return claimed


def _advance_trigger(
    trigger: AutomationTrigger, automation: Automation, scheduled_for: datetime
) -> None:
    """推进已认领触发器，确保同一 occurrence 不会再次被选中。"""

    trigger.last_run_at = scheduled_for
    trigger.occurrence += 1
    if trigger.trigger_type is AutomationTriggerType.once:
        trigger.next_run_at = None
        automation.status = AutomationStatus.completed
        return
    if trigger.cron_expression is None:
        raise AutomationValidationError("CRON_INVALID")
    trigger.next_run_at = next_cron_occurrence(
        trigger.cron_expression, scheduled_for, automation.timezone
    )


async def enqueue_claimed_runs(
    runs: Iterable[AutomationRun], *, queue: AgentQueue | None = None
) -> int:
    """将已提交的标准 Agent Run 放入现有队列，重复入队保持幂等。"""

    agent_queue = queue or AgentQueue()
    enqueued = 0
    for automation_run in runs:
        if automation_run.agent_run_id is None and automation_run.agent_run is None:
            continue
        run_id = automation_run.agent_run_id
        if run_id is None:
            linked_run = automation_run.agent_run
            if linked_run is None:
                continue
            run_id = linked_run.id
        if await agent_queue.enqueue(automation_run.user_id, run_id):
            enqueued += 1
    return enqueued


async def run_due_automations(
    *, now: datetime, db: AsyncSession, queue: AgentQueue | None = None, limit: int = 100
) -> int:
    """认领并入队到期自动化，返回本轮新增的 Run 数。"""

    claimed = await claim_due_automations(now=now, db=db, limit=limit)
    return await enqueue_claimed_runs(claimed, queue=queue)


async def run_automation_now(
    automation_id: uuid.UUID,
    *,
    user_id: uuid.UUID,
    db: AsyncSession,
    queue: AgentQueue | None = None,
) -> AutomationRun:
    """立即创建一次标准 Agent Run，不改变原有时间触发器。"""

    automation = await get_automation(automation_id, user_id=user_id, db=db)
    if automation.status is AutomationStatus.completed:
        raise AutomationStateError("AUTOMATION_COMPLETED")
    if not is_agent_enabled_for(user_id):
        raise AgentUnavailableError("AGENT_UNAVAILABLE")
    now = datetime.now(UTC)
    agent_run = AgentRun(
        user_id=user_id,
        assistant_id=automation.assistant_id,
        goal=automation.goal,
        model=automation.model or automation.assistant.default_model,
        max_steps=automation.max_steps,
        idempotency_key=f"automation:{automation.id}:manual:{uuid.uuid4()}",
    )
    automation_run = AutomationRun(
        automation_id=automation.id,
        user_id=user_id,
        agent_run=agent_run,
        occurrence_key=f"manual:{uuid.uuid4()}",
        scheduled_for=now,
        status=AutomationRunStatus.queued,
    )
    db.add(automation_run)
    await db.commit()
    try:
        await enqueue_claimed_runs([automation_run], queue=queue)
    except (OSError, RuntimeError, RedisError):
        pass
    return automation_run


async def sync_automation_runs(*, now: datetime, db: AsyncSession) -> int:
    """把自动化历史同步为标准 Agent Run 状态并记录审批等待期限。"""

    rows = list(
        (
            await db.scalars(
                select(AutomationRun)
                .join(AgentRun, AutomationRun.agent_run_id == AgentRun.id)
                .where(
                    AutomationRun.status.not_in(
                        [
                            AutomationRunStatus.succeeded,
                            AutomationRunStatus.failed,
                            AutomationRunStatus.cancelled,
                        ]
                    )
                )
            )
        ).all()
    )
    changed = 0
    for item in rows:
        if item.agent_run_id is None:
            continue
        agent_run = await db.scalar(select(AgentRun).where(AgentRun.id == item.agent_run_id))
        if agent_run is None:
            continue
        target = AutomationRunStatus(agent_run.status.value)
        if item.status is not target:
            item.status = target
            changed += 1
        if agent_run.status is AgentRunStatus.waiting_approval:
            approval = await db.scalar(
                select(ApprovalRequest)
                .where(
                    ApprovalRequest.run_id == agent_run.id,
                    ApprovalRequest.status == ApprovalStatus.pending,
                )
                .order_by(ApprovalRequest.expires_at)
            )
            if approval is not None:
                reset_notification = item.wait_reason != "approval"
                if item.wait_deadline != approval.expires_at or reset_notification:
                    changed += 1
                item.wait_deadline = approval.expires_at
                item.wait_reason = "approval"
                if reset_notification:
                    item.wait_notified_at = None
        elif agent_run.status is AgentRunStatus.waiting_input:
            if item.wait_reason != "input" or item.wait_deadline is None:
                item.wait_deadline = now.astimezone(UTC) + WAITING_INPUT_TIMEOUT
                item.wait_reason = "input"
                item.wait_notified_at = None
                changed += 1
    if changed:
        await db.commit()
    return changed


async def notify_waiting_automation_runs(*, db: AsyncSession) -> int:
    """通过既有推送服务通知尚未通知的审批等待。"""

    rows = list(
        (
            await db.scalars(
                select(AutomationRun)
                .where(
                    AutomationRun.status.in_(
                        [AutomationRunStatus.waiting_approval, AutomationRunStatus.waiting_input]
                    ),
                    AutomationRun.wait_notified_at.is_(None),
                )
                .with_for_update(skip_locked=True)
            )
        ).all()
    )
    notified = 0
    for item in rows:
        await send_to_user(
            db,
            item.user_id,
            {
                "title": "自动化需要你的确认",
                "body": item.wait_reason or "自动化正在等待输入",
                "automationRunId": str(item.id),
            },
        )
        item.wait_notified_at = datetime.now(UTC)
        notified += 1
    if notified:
        await db.commit()
    return notified


async def expire_waiting_automation_runs(
    *, now: datetime, db: AsyncSession, queue: AgentQueue | None = None
) -> int:
    """取消超过审批期限的标准 Run，不以更高权限替代等待。"""

    rows = list(
        (
            await db.scalars(
                select(AutomationRun).where(
                    AutomationRun.status.in_(
                        [AutomationRunStatus.waiting_approval, AutomationRunStatus.waiting_input]
                    ),
                    AutomationRun.wait_deadline.is_not(None),
                    AutomationRun.wait_deadline <= now.astimezone(UTC),
                )
            )
        ).all()
    )
    agent_queue = queue or AgentQueue()
    events = EventStore(queue=agent_queue)
    expired = 0
    for item in rows:
        if item.agent_run_id is None:
            continue
        run = await db.scalar(select(AgentRun).where(AgentRun.id == item.agent_run_id))
        if run is None or run.status in {
            AgentRunStatus.succeeded,
            AgentRunStatus.failed,
            AgentRunStatus.cancelled,
        }:
            continue
        run.status = AgentRunStatus.cancelled
        item.status = AutomationRunStatus.cancelled
        await agent_queue.cancel(item.user_id, run.id)
        await events.append(
            run.id,
            "run_cancelled",
            {"status": AgentRunStatus.cancelled.value, "reason": "automation_wait_expired"},
            tenant_id=item.user_id,
        )
        expired += 1
    if expired:
        await db.commit()
    return expired


# 兼容调度器与测试对“trigger”命名的调用。
claim_due_triggers = claim_due_automations
