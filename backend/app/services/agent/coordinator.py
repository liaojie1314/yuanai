"""有界 Agent model/tool coordinator。"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from collections.abc import AsyncGenerator, Awaitable, Callable, Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent_run import (
    AgentRun,
    AgentRunStatus,
    AgentStep,
    AgentStepKind,
    AgentStepStatus,
)
from app.models.approval import ApprovalRiskLevel
from app.models.conversation import Conversation
from app.models.message import Message, MessageRole
from app.models.tool_runtime import ToolExecution, ToolExecutionStatus
from app.services import ai_service
from app.services.agent.approval_service import (
    ApprovalError,
    ApprovalPayloadMismatchError,
    ApprovalService,
)
from app.services.agent.context_builder import AgentContextBuilder
from app.services.agent.errors import AgentCoordinatorError, AgentErrorCode
from app.services.agent.event_service import EventStore
from app.services.agent.metrics import AgentMetrics
from app.services.agent.policy import PolicyEngine
from app.services.ai_service import (
    ContentDelta,
    ModelEvent,
    ModelFailed,
    ToolCallArgumentsDelta,
    ToolCallEnd,
    ToolCallStart,
    UsageDelta,
)
from app.services.tool_runtime_service import ToolRuntimeError, ToolRuntimeService
from app.tools.contracts import (
    ToolContext,
    ToolError,
    ToolErrorCode,
    ToolRegistrationError,
    ToolRisk,
    ToolSpec,
)
from app.tools.registry import ToolRegistry

HARD_MAX_STEPS = 30
DEFAULT_MAX_STEPS = 12
MODEL_TIMEOUT_SECONDS = 60.0
DEFAULT_TOOL_TIMEOUT_SECONDS = 30.0


class ModelStream(Protocol):
    """可注入的 provider-neutral 模型流函数。"""

    def __call__(
        self,
        model: str,
        messages: list[dict[str, object]],
        tools: list[dict[str, object]],
        *,
        enable_thinking: bool = False,
    ) -> AsyncGenerator[ModelEvent, None]: ...


@dataclass(frozen=True, slots=True)
class CoordinatorBudget:
    """一次 Run 的 token、成本和墙钟时间预算。"""

    max_tokens: int | None = None
    max_cost_usd: Decimal | None = None
    max_duration_seconds: float | None = 300.0


@dataclass(frozen=True, slots=True)
class CoordinatorResult:
    """coordinator 的稳定结果。"""

    status: AgentRunStatus
    content: str = ""
    error_code: AgentErrorCode | None = None
    error_message: str | None = None


@dataclass
class _PendingToolCall:
    """在一次模型流中聚合工具调用参数。"""

    tool_call_id: str
    name: str
    arguments: str = ""
    ended: bool = False


class AgentCoordinator:
    """执行有界模型/工具循环，不暴露任何 provider SDK 类型。"""

    def __init__(
        self,
        *,
        model_stream: ModelStream | None = None,
        tool_registry: ToolRegistry,
        context_builder: AgentContextBuilder | None = None,
        policy: PolicyEngine | None = None,
        event_store: EventStore | None = None,
        budget: CoordinatorBudget | None = None,
        max_model_retries: int = 2,
        model_timeout_seconds: float = MODEL_TIMEOUT_SECONDS,
        tool_timeout_seconds: float = DEFAULT_TOOL_TIMEOUT_SECONDS,
        approval_service: ApprovalService | None = None,
        metrics: AgentMetrics | None = None,
    ) -> None:
        if max_model_retries < 0:
            raise ValueError("max_model_retries must be non-negative")
        self._model_stream = model_stream or ai_service.stream_agent
        self._tool_registry = tool_registry
        self._policy = policy or PolicyEngine()
        self._context_builder = context_builder or AgentContextBuilder(self._policy)
        self._event_store = event_store
        self._budget = budget or CoordinatorBudget()
        self._max_model_retries = max_model_retries
        self._model_timeout_seconds = model_timeout_seconds
        self._tool_timeout_seconds = tool_timeout_seconds
        self._approval_service = approval_service or ApprovalService()
        self._metrics = metrics or AgentMetrics()
        self._tool_runtime = ToolRuntimeService(tool_registry)

    async def run(
        self,
        run: AgentRun,
        *,
        db: AsyncSession | None = None,
        user_instructions: str = "",
        history: Sequence[dict[str, object]] = (),
        cancellation: asyncio.Event | Callable[[], Awaitable[bool]] | None = None,
        enable_thinking: bool = False,
        approval_id: uuid.UUID | None = None,
    ) -> CoordinatorResult:
        """运行一次 bounded loop，并按需写回兼容的 assistant Message。"""

        if run.status in {
            AgentRunStatus.succeeded,
            AgentRunStatus.failed,
            AgentRunStatus.cancelled,
        }:
            return self._failure(run, AgentErrorCode.RUN_NOT_EXECUTABLE, "Run 已经结束")
        if await self._is_cancelled(cancellation):
            return self._finish(run, AgentRunStatus.cancelled, AgentErrorCode.AGENT_CANCELLED)

        max_steps = min(run.max_steps or DEFAULT_MAX_STEPS, HARD_MAX_STEPS)
        run.current_step = run.current_step or 0
        run.input_tokens = run.input_tokens or 0
        run.output_tokens = run.output_tokens or 0
        run.estimated_cost_usd = run.estimated_cost_usd or Decimal("0")
        if max_steps <= 0:
            return self._failure(run, AgentErrorCode.AGENT_STEP_LIMIT_EXCEEDED, "Step 预算已耗尽")
        run.status = AgentRunStatus.running
        await self._emit(run, "run_started", {"model": run.model, "max_steps": max_steps})
        messages = self._context_builder.build(
            goal=run.goal,
            user_instructions=user_instructions,
            history=history,
        )
        tools = [self._tool_definition(spec) for spec in self._tool_registry.list_specs()]
        started = time.monotonic()
        content = ""
        thinking = ""
        recent_calls: list[tuple[str, str]] = []
        total_tokens = 0
        tool_calls_summary: list[dict[str, object]] = []

        while True:
            if await self._is_cancelled(cancellation):
                return self._finish(run, AgentRunStatus.cancelled, AgentErrorCode.AGENT_CANCELLED)
            budget_error = self._budget_error(started, total_tokens, run.estimated_cost_usd)
            if budget_error is not None:
                return self._failure(run, budget_error, "Agent 预算已耗尽")
            if run.current_step >= max_steps:
                return self._failure(
                    run, AgentErrorCode.AGENT_STEP_LIMIT_EXCEEDED, "Step 预算已耗尽"
                )

            run.current_step += 1
            self._add_step(run, AgentStepKind.model, {"message_count": len(messages)})
            await self._emit(run, "step_started", {"sequence": run.current_step, "kind": "model"})
            try:
                events = await self._collect_model_events(
                    run.model,
                    messages,
                    tools,
                    cancellation=cancellation,
                    enable_thinking=enable_thinking,
                )
            except AgentCoordinatorError as error:
                return self._finish(run, AgentRunStatus.cancelled, error.code, error.message)
            if not events:
                return self._failure(run, AgentErrorCode.MODEL_FAILED, "模型未返回事件")
            pending: dict[str, _PendingToolCall] = {}
            round_content = ""
            round_thinking = ""
            round_tokens = 0
            for event in events:
                if isinstance(event, ContentDelta):
                    round_content += event.token
                elif event.__class__.__name__ == "ThinkingDelta":
                    round_thinking += getattr(event, "token", "")
                elif isinstance(event, UsageDelta):
                    round_tokens += event.total_tokens
                    run.input_tokens += event.input_tokens
                    run.output_tokens += event.output_tokens
                elif isinstance(event, ToolCallStart):
                    pending[event.tool_call_id] = _PendingToolCall(event.tool_call_id, event.name)
                elif isinstance(event, ToolCallArgumentsDelta):
                    call = pending.get(event.tool_call_id)
                    if call is None:
                        return self._failure(
                            run,
                            AgentErrorCode.INVALID_TOOL_CALL,
                            "工具调用缺少开始事件",
                        )
                    call.arguments += event.args_chunk
                elif isinstance(event, ToolCallEnd):
                    call = pending.get(event.tool_call_id)
                    if call is not None:
                        call.ended = True
                elif isinstance(event, ModelFailed):
                    if event.retryable:
                        return self._failure(run, AgentErrorCode.MODEL_FAILED, event.message)
                    return self._failure(run, self._model_error_code(event.code), event.message)
            total_tokens += round_tokens
            budget_error = self._budget_error(started, total_tokens, run.estimated_cost_usd)
            if budget_error is not None:
                return self._failure(run, budget_error, "Agent 预算已耗尽")
            if round_content:
                content += round_content
            if round_thinking:
                thinking += round_thinking

            if not pending:
                await self._write_message(run, content, thinking, tool_calls_summary, db)
                await self._emit(
                    run,
                    "run_completed",
                    {"status": AgentRunStatus.succeeded.value, "content": content},
                )
                return self._finish(run, AgentRunStatus.succeeded, content=content)

            messages.append(
                {
                    "role": "assistant",
                    "content": round_content or None,
                    "tool_calls": [
                        {
                            "id": call.tool_call_id,
                            "type": "function",
                            "function": {
                                "name": call.name,
                                "arguments": call.arguments,
                            },
                        }
                        for call in pending.values()
                    ],
                }
            )
            for call in pending.values():
                try:
                    arguments = json.loads(call.arguments)
                except (TypeError, ValueError, json.JSONDecodeError) as error:
                    return self._failure(
                        run, AgentErrorCode.INVALID_TOOL_CALL, "工具参数不是有效 JSON", error
                    )
                if not isinstance(arguments, dict):
                    return self._failure(
                        run,
                        AgentErrorCode.INVALID_TOOL_CALL,
                        "工具参数必须是对象",
                    )
                signature = (
                    call.name,
                    json.dumps(arguments, sort_keys=True, separators=(",", ":")),
                )
                recent_calls.append(signature)
                if len(recent_calls) >= 3 and recent_calls[-3:] == [signature] * 3:
                    return self._failure(
                        run, AgentErrorCode.AGENT_LOOP_DETECTED, "检测到重复工具调用"
                    )
                if run.current_step >= max_steps:
                    return self._failure(
                        run, AgentErrorCode.AGENT_STEP_LIMIT_EXCEEDED, "Step 预算已耗尽"
                    )
                try:
                    spec = self._tool_registry.get_spec(call.name)
                except ToolRegistrationError as error:
                    return self._failure(run, AgentErrorCode.TOOL_FAILED, error.code.value, error)
                execution_location = (
                    "cloud" if spec.execution_location == "either" else spec.execution_location
                )
                execution: ToolExecution | None = None
                if db is not None:
                    try:
                        execution = await self._tool_runtime.create_execution(
                            user_id=run.user_id,
                            tool_name=call.name,
                            arguments=arguments,
                            execution_location=execution_location,
                            db=db,
                            run_id=run.id,
                            step_id=run.steps[-1].id,
                        )
                    except ToolRuntimeError as error:
                        return self._failure(run, AgentErrorCode.TOOL_FAILED, str(error), error)
                decision = self._policy.decide(spec)
                if not decision.allowed:
                    if approval_id is None:
                        approval_step = AgentStep(
                            id=uuid.uuid4(),
                            run_id=run.id,
                            sequence=run.current_step + 1,
                            kind=AgentStepKind.approval,
                            status=AgentStepStatus.waiting,
                            input_json={
                                "name": call.name,
                                "execution_location": execution_location,
                            },
                        )
                        run.current_step += 1
                        run.steps.append(approval_step)
                        await self._approval_service.create_request(
                            run=run,
                            step=approval_step,
                            tool_name=call.name,
                            arguments=arguments,
                            risk_level=self._approval_risk(spec.risk_level),
                            execution_location=execution_location,
                            action_summary=f"执行工具 {call.name}",
                            db=db,
                        )
                        if execution is not None and db is not None:
                            execution.status = ToolExecutionStatus.waiting
                            execution.error_code = AgentErrorCode.TOOL_APPROVAL_REQUIRED.value
                            execution.error_message = "工具执行需要审批"
                            await db.flush()
                        run.status = AgentRunStatus.waiting_approval
                        await self._emit(
                            run,
                            "approval_required",
                            {"tool_name": call.name, "execution_location": execution_location},
                        )
                        return CoordinatorResult(
                            status=AgentRunStatus.waiting_approval,
                            error_code=AgentErrorCode.TOOL_APPROVAL_REQUIRED,
                            error_message="工具执行需要审批",
                        )
                    try:
                        await self._approval_service.authorize_execution(
                            approval_id,
                            user_id=run.user_id,
                            tool_name=call.name,
                            arguments=arguments,
                            execution_location=execution_location,
                            db=db,
                        )
                    except ApprovalPayloadMismatchError as error:
                        return self._failure(
                            run, AgentErrorCode.APPROVAL_PAYLOAD_MISMATCH, str(error), error
                        )
                    except ApprovalError as error:
                        return self._failure(run, AgentErrorCode.APPROVAL_DENIED, str(error), error)
                run.current_step += 1
                self._add_step(run, AgentStepKind.tool, {"name": call.name, "arguments": arguments})
                if execution is not None and db is not None:
                    try:
                        await self._tool_runtime.start_execution(execution, db=db)
                    except ToolRuntimeError as error:
                        return self._failure(run, AgentErrorCode.TOOL_FAILED, str(error), error)
                await self._emit(
                    run,
                    "step_started",
                    {"sequence": run.current_step, "kind": "tool", "name": call.name},
                )
                try:
                    remaining = self._remaining_duration(started)
                    timeout = min(self._tool_timeout_seconds, float(spec.timeout_seconds))
                    if remaining is not None:
                        timeout = min(timeout, remaining)
                    output = await asyncio.wait_for(
                        self._tool_registry.execute(
                            call.name,
                            arguments,
                            context=ToolContext(user_id=run.user_id, db=db),
                        ),
                        timeout=timeout,
                    )
                except TimeoutError as error:
                    if execution is not None and db is not None:
                        await self._tool_runtime.fail_execution(
                            execution,
                            code=AgentErrorCode.TOOL_TIMEOUT.value,
                            message="工具执行超时",
                            db=db,
                        )
                    return self._failure(run, AgentErrorCode.TOOL_TIMEOUT, "工具执行超时", error)
                except ToolError as error:
                    if execution is not None and db is not None:
                        await self._tool_runtime.fail_execution(
                            execution, code=error.code.value, message=str(error), db=db
                        )
                    code = (
                        AgentErrorCode.TOOL_TIMEOUT
                        if error.code is ToolErrorCode.TIMEOUT
                        else AgentErrorCode.TOOL_FAILED
                    )
                    return self._failure(run, code, error.code.value, error)
                if execution is not None and db is not None:
                    await self._tool_runtime.complete_success(execution, output=output, db=db)
                output_text = json.dumps(output, ensure_ascii=False, separators=(",", ":"))
                tool_calls_summary.append(
                    {"name": call.name, "arguments": arguments, "output": output}
                )
                await self._emit(
                    run,
                    "tool_completed",
                    {"name": call.name, "status": "succeeded"},
                )
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.tool_call_id,
                        "name": call.name,
                        "content": output_text,
                    }
                )

    async def _emit(self, run: AgentRun, event_type: str, payload: dict[str, object]) -> None:
        """通过可选 EventStore 持久化脱敏的运行事件。"""

        step_id = run.steps[-1].id if run.steps else None
        self._metrics.emit(
            event_type,
            run_id=run.id,
            step_id=step_id,
            user_id=run.user_id,
        )

        if self._event_store is not None:
            await self._event_store.append(
                run.id,
                event_type,
                payload,
                tenant_id=run.user_id,
            )

    async def _collect_model_events(
        self,
        model: str,
        messages: list[dict[str, object]],
        tools: list[dict[str, object]],
        *,
        cancellation: asyncio.Event | Callable[[], Awaitable[bool]] | None,
        enable_thinking: bool,
    ) -> list[ModelEvent]:
        """在 60 秒单次调用边界内收集一轮模型事件。"""

        for attempt in range(self._max_model_retries + 1):
            if await self._is_cancelled(cancellation):
                raise AgentCoordinatorError(AgentErrorCode.AGENT_CANCELLED)
            events: list[ModelEvent] = []
            try:
                async with asyncio.timeout(self._model_timeout_seconds):
                    async for event in self._model_stream(
                        model, messages, tools, enable_thinking=enable_thinking
                    ):
                        events.append(event)
            except TimeoutError:
                if attempt < self._max_model_retries and not events:
                    continue
                return [ModelFailed(code="MODEL_TIMEOUT", message="模型调用超时")]
            except (OSError, RuntimeError, TypeError, ValueError):
                if attempt < self._max_model_retries and not events:
                    continue
                return [ModelFailed(code="MODEL_PROVIDER_ERROR", message="模型调用失败")]
            if (
                events
                and isinstance(events[-1], ModelFailed)
                and events[-1].retryable
                and attempt < self._max_model_retries
            ):
                continue
            return events
        return [ModelFailed(code="MODEL_PROVIDER_ERROR", message="模型调用失败")]

    @staticmethod
    def _tool_definition(spec: ToolSpec) -> dict[str, object]:
        """将 ToolSpec 转为 provider-neutral function 定义。"""

        return {
            "type": "function",
            "function": {
                "name": spec.name,
                "description": spec.description,
                "parameters": spec.input_schema,
            },
        }

    @staticmethod
    def _approval_risk(risk: ToolRisk) -> ApprovalRiskLevel:
        """将工具风险归一为审批模型可持久化的等级。"""
        value = risk.value
        if value in {ToolRisk.read.value, ToolRisk.low.value}:
            return ApprovalRiskLevel.low
        if value in {ToolRisk.local_write.value, ToolRisk.reversible_write.value}:
            return ApprovalRiskLevel.medium
        if value == ToolRisk.external_side_effect.value:
            return ApprovalRiskLevel.high
        return ApprovalRiskLevel.critical

    @staticmethod
    def _add_step(run: AgentRun, kind: AgentStepKind, input_json: dict[str, object]) -> None:
        """将单步记录挂到 Run，供 worker 或调用方持久化。"""

        run.steps.append(
            AgentStep(
                run_id=run.id,
                sequence=run.current_step,
                kind=kind,
                status=AgentStepStatus.succeeded,
                input_json=input_json,
            )
        )

    async def _write_message(
        self,
        run: AgentRun,
        content: str,
        thinking: str,
        tool_calls: list[dict[str, object]],
        db: AsyncSession | None,
    ) -> None:
        """仅当 Run 绑定会话时写回现有 assistant Message。"""

        if db is None or run.conversation_id is None:
            return
        conversation = await db.get(Conversation, run.conversation_id)
        if conversation is None or conversation.user_id != run.user_id:
            raise AgentCoordinatorError(AgentErrorCode.RUN_NOT_EXECUTABLE, "会话归属不匹配")
        message = Message(
            conv_id=conversation.id,
            role=MessageRole.assistant,
            content=content,
            thinking_content=thinking or None,
            tool_calls=tool_calls or None,
            model=run.model,
            tokens_used=run.input_tokens + run.output_tokens,
        )
        db.add(message)
        conversation.last_message_at = message.created_at
        await db.flush()

    def _budget_error(
        self, started: float, total_tokens: int, cost: Decimal
    ) -> AgentErrorCode | None:
        """返回当前首个耗尽的预算错误码。"""

        if self._budget.max_tokens is not None and total_tokens >= self._budget.max_tokens:
            return AgentErrorCode.AGENT_TOKEN_BUDGET_EXCEEDED
        if self._budget.max_cost_usd is not None and cost >= self._budget.max_cost_usd:
            return AgentErrorCode.AGENT_COST_BUDGET_EXCEEDED
        if (
            self._budget.max_duration_seconds is not None
            and time.monotonic() - started >= self._budget.max_duration_seconds
        ):
            return AgentErrorCode.AGENT_TIME_BUDGET_EXCEEDED
        return None

    def _remaining_duration(self, started: float) -> float | None:
        """返回本次 Run 的剩余墙钟预算。"""

        if self._budget.max_duration_seconds is None:
            return None
        return max(0.0, self._budget.max_duration_seconds - (time.monotonic() - started))

    @staticmethod
    async def _is_cancelled(
        cancellation: asyncio.Event | Callable[[], Awaitable[bool]] | None,
    ) -> bool:
        """兼容 Event 和 Worker cancellation token 风格的取消检查。"""

        if cancellation is None:
            return False
        if isinstance(cancellation, asyncio.Event):
            return cancellation.is_set()
        return await cancellation()

    @staticmethod
    def _model_error_code(code: str) -> AgentErrorCode:
        """把 ai_service 的终态错误归一为 coordinator 错误码。"""

        if code == "MODEL_TIMEOUT":
            return AgentErrorCode.MODEL_TIMEOUT
        return AgentErrorCode.MODEL_FAILED

    @staticmethod
    def _finish(
        run: AgentRun,
        status: AgentRunStatus,
        error_code: AgentErrorCode | None = None,
        error_message: str | None = None,
        *,
        content: str = "",
    ) -> CoordinatorResult:
        """更新 Run 终态并返回稳定结果。"""

        run.status = status
        run.error_code = error_code.value if error_code else None
        run.error_message = error_message
        return CoordinatorResult(
            status=status,
            content=content,
            error_code=error_code,
            error_message=error_message,
        )

    @classmethod
    def _failure(
        cls,
        run: AgentRun,
        code: AgentErrorCode,
        message: str,
        cause: BaseException | None = None,
    ) -> CoordinatorResult:
        """统一处理可预测失败；保留 cause 仅用于异常链。"""

        del cause
        result = cls._finish(run, AgentRunStatus.failed, code, message)
        return result
