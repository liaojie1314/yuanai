"""Agent Runtime API 的请求与响应 Schema。"""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.models.agent_run import AgentRunStatus, AgentStepKind, AgentStepStatus
from app.models.approval import ApprovalRiskLevel, ApprovalStatus
from app.models.assistant import AssistantAutonomyLevel


class AgentSchema(BaseModel):
    """Agent Schema 的公共序列化配置。"""

    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )


class AssistantCreateRequest(AgentSchema):
    """创建助理请求。"""

    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=500)
    instructions: str = ""
    default_model: str = Field(min_length=1, max_length=100)
    autonomy_level: AssistantAutonomyLevel = AssistantAutonomyLevel.balanced
    is_default: bool = False


class AssistantUpdateRequest(AgentSchema):
    """更新助理请求。"""

    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    instructions: str | None = None
    default_model: str | None = Field(default=None, min_length=1, max_length=100)
    autonomy_level: AssistantAutonomyLevel | None = None
    is_default: bool | None = None


class AssistantResponse(AgentSchema):
    """助理安全响应。"""

    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    description: str
    instructions: str
    default_model: str
    autonomy_level: AssistantAutonomyLevel
    is_default: bool
    created_at: datetime
    updated_at: datetime


class AgentRunCreateRequest(AgentSchema):
    """创建 Agent Run 请求。"""

    assistant_id: uuid.UUID
    goal: str = Field(min_length=1, max_length=20_000)
    model: str | None = Field(default=None, max_length=100)
    conversation_id: uuid.UUID | None = None
    parent_run_id: uuid.UUID | None = None
    max_steps: int = Field(default=12, ge=1, le=30)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=100)


class AgentRunResponse(AgentSchema):
    """Agent Run 安全响应。"""

    id: uuid.UUID
    user_id: uuid.UUID
    assistant_id: uuid.UUID
    conversation_id: uuid.UUID | None
    parent_run_id: uuid.UUID | None
    goal: str
    status: AgentRunStatus
    model: str
    max_steps: int
    current_step: int
    idempotency_key: str | None
    input_tokens: int
    output_tokens: int
    estimated_cost_usd: Decimal
    error_code: str | None
    error_message: str | None
    queued_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    updated_at: datetime


class AgentStepResponse(AgentSchema):
    """Agent Step 响应。"""

    id: uuid.UUID
    run_id: uuid.UUID
    sequence: int
    kind: AgentStepKind
    status: AgentStepStatus
    input_json: dict[str, object] | None
    output_json: dict[str, object] | None
    error_code: str | None
    error_message: str | None
    started_at: datetime | None
    finished_at: datetime | None


class AgentEventResponse(AgentSchema):
    """可用于 SSE 重放的 Agent 事件响应。"""

    id: int
    run_id: uuid.UUID
    sequence: int
    event_type: str
    payload: dict[str, object]
    created_at: datetime


class ApprovalRequestResponse(AgentSchema):
    """审批卡片响应，不包含未脱敏的原始参数。"""

    id: uuid.UUID
    run_id: uuid.UUID | None
    step_id: uuid.UUID | None
    tool_execution_id: uuid.UUID | None
    user_id: uuid.UUID
    tool_name: str
    execution_location: str
    risk_level: ApprovalRiskLevel
    action_summary: str
    arguments_preview: dict[str, object]
    payload_hash: str
    status: ApprovalStatus
    expires_at: datetime
    decided_at: datetime | None
    decision_note: str | None
    created_at: datetime


class ApprovalDecisionRequest(AgentSchema):
    """审批决定请求。"""

    decision: str = Field(pattern="^(approve|deny)$")
    note: str | None = Field(default=None, max_length=500)


class AgentInputRequest(AgentSchema):
    """恢复 waiting_input Run 的用户输入。"""

    input: str = Field(min_length=1, max_length=20_000)
