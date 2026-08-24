"""Agent 工具审批与用户输入恢复服务。"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime, timedelta
from enum import StrEnum

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent_run import AgentRun, AgentRunStatus, AgentStep, AgentStepKind, AgentStepStatus
from app.models.approval import ApprovalRequest, ApprovalRiskLevel, ApprovalStatus


class ApprovalDecision(StrEnum):
    """允许的单次审批决定。"""

    approve = "approve"
    deny = "deny"


class ApprovalError(RuntimeError):
    """审批请求不可执行或不存在。"""


class ApprovalNotFoundError(ApprovalError):
    """审批请求不存在或不属于请求租户。"""


class ApprovalAlreadyDecidedError(ApprovalError):
    """审批请求已经被决定。"""


class ApprovalPayloadMismatchError(ApprovalError):
    """执行参数与审批时参数不一致。"""


class ApprovalExpiredError(ApprovalError):
    """审批请求已过期。"""


def sanitize_arguments(arguments: dict[str, object]) -> dict[str, object]:
    """递归移除常见凭证字段，并限制审批预览的大小。"""

    sensitive = {"authorization", "api_key", "apikey", "password", "secret", "token", "credential"}

    def clean(value: object, key: str | None = None) -> object:
        if key is not None and key.lower() in sensitive:
            return "[redacted]"
        if isinstance(value, dict):
            return {str(k): clean(v, str(k)) for k, v in value.items()}
        if isinstance(value, list):
            return [clean(item) for item in value[:100]]
        if isinstance(value, str):
            return value[:2000]
        if isinstance(value, (str, int, float, bool)) or value is None:
            return value
        return str(value)[:2000]

    result = clean(arguments)
    return result if isinstance(result, dict) else {}


def payload_hash(arguments: dict[str, object]) -> str:
    """返回规范化原始参数的 SHA-256 哈希，不把凭证写入持久化字段。"""

    encoded = json.dumps(
        arguments, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class ApprovalService:
    """提供租户隔离、单次决定和精确参数绑定的审批操作。"""

    def __init__(self, *, default_ttl_seconds: int = 300) -> None:
        if default_ttl_seconds <= 0:
            raise ValueError("default_ttl_seconds must be positive")
        self.default_ttl_seconds = default_ttl_seconds
        self._memory: dict[uuid.UUID, ApprovalRequest] = {}

    async def create_request(
        self,
        *,
        run: AgentRun,
        step: AgentStep,
        tool_name: str,
        arguments: dict[str, object],
        risk_level: ApprovalRiskLevel | str,
        execution_location: str,
        action_summary: str,
        db: AsyncSession | None = None,
        expires_at: datetime | None = None,
    ) -> ApprovalRequest:
        """创建绑定调用上下文的 pending 审批请求。"""

        safe_args = sanitize_arguments(arguments)
        request = ApprovalRequest(
            id=uuid.uuid4(),
            run_id=run.id,
            step_id=step.id,
            user_id=run.user_id,
            tool_name=tool_name,
            execution_location=execution_location,
            risk_level=ApprovalRiskLevel(risk_level),
            action_summary=action_summary[:500],
            arguments_preview=safe_args,
            payload_hash=payload_hash(arguments),
            status=ApprovalStatus.pending,
            expires_at=expires_at
            or datetime.now(UTC) + timedelta(seconds=self.default_ttl_seconds),
        )
        self._memory[request.id] = request
        if db is not None:
            db.add(request)
            await db.flush()
        return request

    async def decide(
        self,
        approval_id: uuid.UUID,
        *,
        user_id: uuid.UUID,
        decision: ApprovalDecision | str,
        note: str | None = None,
        db: AsyncSession | None = None,
    ) -> ApprovalRequest:
        """执行一次 approve/deny 决定，重复操作始终拒绝。"""

        request = await self._get(approval_id, user_id=user_id, db=db)
        if request.decision_note and request.decision_note.endswith("[consumed]"):
            raise ApprovalAlreadyDecidedError("审批请求已经执行")
        now = datetime.now(UTC)
        if request.status is not ApprovalStatus.pending:
            raise ApprovalAlreadyDecidedError("审批请求已经处理")
        if request.expires_at <= now:
            request.status = ApprovalStatus.expired
            request.decided_at = now
            if db is not None:
                await db.flush()
            raise ApprovalExpiredError("审批请求已过期")
        try:
            resolved = ApprovalDecision(decision)
        except ValueError as error:
            raise ApprovalError("无效审批决定") from error
        request.status = (
            ApprovalStatus.approved
            if resolved is ApprovalDecision.approve
            else ApprovalStatus.denied
        )
        request.decided_at = now
        request.decision_note = note[:500] if note else None
        if db is not None:
            await db.flush()
        return request

    async def approve(
        self,
        approval_id: uuid.UUID,
        *,
        user_id: uuid.UUID,
        note: str | None = None,
        db: AsyncSession | None = None,
    ) -> ApprovalRequest:
        """批准一次 pending 请求。"""

        return await self.decide(
            approval_id, user_id=user_id, decision=ApprovalDecision.approve, note=note, db=db
        )

    async def deny(
        self,
        approval_id: uuid.UUID,
        *,
        user_id: uuid.UUID,
        note: str | None = None,
        db: AsyncSession | None = None,
    ) -> ApprovalRequest:
        """拒绝一次 pending 请求。"""

        return await self.decide(
            approval_id, user_id=user_id, decision=ApprovalDecision.deny, note=note, db=db
        )

    async def expire(
        self, approval_id: uuid.UUID, *, user_id: uuid.UUID, db: AsyncSession | None = None
    ) -> ApprovalRequest:
        """将 pending 请求标记为 expired。"""

        request = await self._get(approval_id, user_id=user_id, db=db)
        if request.status is not ApprovalStatus.pending:
            raise ApprovalAlreadyDecidedError("审批请求已经处理")
        request.status = ApprovalStatus.expired
        request.decided_at = datetime.now(UTC)
        if db is not None:
            await db.flush()
        return request

    async def cancel(
        self, approval_id: uuid.UUID, *, user_id: uuid.UUID, db: AsyncSession | None = None
    ) -> ApprovalRequest:
        """取消 pending 请求；取消也只能发生一次。"""

        request = await self._get(approval_id, user_id=user_id, db=db)
        if request.status is not ApprovalStatus.pending:
            raise ApprovalAlreadyDecidedError("审批请求已经处理")
        request.status = ApprovalStatus.cancelled
        request.decided_at = datetime.now(UTC)
        if db is not None:
            await db.flush()
        return request

    async def authorize_execution(
        self,
        approval_id: uuid.UUID,
        *,
        user_id: uuid.UUID,
        tool_name: str,
        arguments: dict[str, object],
        execution_location: str,
        db: AsyncSession | None = None,
    ) -> ApprovalRequest:
        """消费已批准请求，并拒绝任何参数、工具或执行位置替换。"""

        request = await self._get(approval_id, user_id=user_id, db=db)
        if request.decision_note and request.decision_note.endswith("[consumed]"):
            raise ApprovalAlreadyDecidedError("审批请求已经执行")
        if request.status is not ApprovalStatus.approved:
            if request.status is ApprovalStatus.pending and request.expires_at <= datetime.now(UTC):
                request.status = ApprovalStatus.expired
            raise ApprovalError("审批请求未获批准")
        if (
            request.tool_name != tool_name
            or request.execution_location != execution_location
            or request.payload_hash != payload_hash(arguments)
        ):
            raise ApprovalPayloadMismatchError("审批参数或执行位置不匹配")
        request.decision_note = (request.decision_note or "")[:450] + " [consumed]"
        if db is not None:
            await db.flush()
        return request

    async def submit_input(
        self,
        *,
        run: AgentRun,
        user_id: uuid.UUID,
        answer: str,
        db: AsyncSession | None = None,
    ) -> AgentRun:
        """恢复 waiting_input Run，并记录脱敏后的用户回答。"""

        if run.user_id != user_id:
            raise ApprovalNotFoundError("Run 不属于当前用户")
        if run.status is not AgentRunStatus.waiting_input:
            raise ApprovalError("Run 当前不等待用户输入")
        if not answer.strip():
            raise ApprovalError("用户输入不能为空")
        step = AgentStep(
            id=uuid.uuid4(),
            run_id=run.id,
            sequence=(run.current_step or 0) + 1,
            kind=AgentStepKind.user_input,
            status=AgentStepStatus.succeeded,
            input_json={"answer": answer[:20_000]},
        )
        run.steps.append(step)
        run.current_step = (run.current_step or 0) + 1
        run.status = AgentRunStatus.queued
        if db is not None:
            db.add(step)
            await db.flush()
        return run

    async def _get(
        self, approval_id: uuid.UUID, *, user_id: uuid.UUID, db: AsyncSession | None
    ) -> ApprovalRequest:
        request: ApprovalRequest | None = None
        if db is not None:
            request = await db.scalar(
                select(ApprovalRequest).where(ApprovalRequest.id == approval_id)
            )
        if request is None:
            request = self._memory.get(approval_id)
        if request is None or request.user_id != user_id:
            raise ApprovalNotFoundError("审批请求不存在")
        return request
