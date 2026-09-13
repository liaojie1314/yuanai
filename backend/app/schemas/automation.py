"""主动自动化的请求与响应契约。"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

from app.models.agent_run import AgentRunStatus
from app.models.automation import (
    AutomationRunStatus,
    AutomationStatus,
    AutomationTriggerType,
)


class AutomationSchema(BaseModel):
    """自动化 Schema 的公共序列化配置。"""

    model_config = ConfigDict(from_attributes=True, alias_generator=to_camel, populate_by_name=True)


class AutomationTriggerCreate(AutomationSchema):
    """创建一次性或 cron 触发器。"""

    trigger_type: AutomationTriggerType
    scheduled_at: datetime | None = None
    cron_expression: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def validate_shape(self) -> AutomationTriggerCreate:
        """确保触发器字段与触发类型一致。"""

        if self.trigger_type is AutomationTriggerType.once:
            if self.scheduled_at is None or self.cron_expression is not None:
                raise ValueError("一次性触发器需要 scheduledAt 且不能有 cronExpression")
        elif self.cron_expression is None or self.scheduled_at is not None:
            raise ValueError("cron 触发器需要 cronExpression 且不能有 scheduledAt")
        if self.scheduled_at is not None and self.scheduled_at.tzinfo is None:
            raise ValueError("scheduledAt 必须包含时区")
        return self


class AutomationCreateRequest(AutomationSchema):
    """创建自动化请求。"""

    assistant_id: uuid.UUID
    name: str = Field(min_length=1, max_length=120)
    goal: str = Field(min_length=1, max_length=20_000)
    model: str | None = Field(default=None, max_length=100)
    max_steps: int = Field(default=12, ge=1, le=30)
    timezone: str = Field(default="UTC", min_length=1, max_length=64)
    trigger: AutomationTriggerCreate


class AutomationUpdateRequest(AutomationSchema):
    """更新自动化基本信息或暂停状态。"""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    goal: str | None = Field(default=None, min_length=1, max_length=20_000)
    model: str | None = Field(default=None, max_length=100)
    max_steps: int | None = Field(default=None, ge=1, le=30)
    status: AutomationStatus | None = None


class AutomationTriggerResponse(AutomationSchema):
    """触发器安全响应。"""

    id: uuid.UUID
    automation_id: uuid.UUID
    trigger_type: AutomationTriggerType
    cron_expression: str | None
    scheduled_at: datetime | None
    next_run_at: datetime | None
    last_run_at: datetime | None
    occurrence: int


class AutomationRunResponse(AutomationSchema):
    """自动化发生记录及其标准 Agent Run 映射。"""

    id: uuid.UUID
    automation_id: uuid.UUID
    user_id: uuid.UUID
    agent_run_id: uuid.UUID | None
    occurrence_key: str
    scheduled_for: datetime
    status: AutomationRunStatus
    wait_deadline: datetime | None
    wait_reason: str | None
    wait_notified_at: datetime | None
    created_at: datetime
    updated_at: datetime


class AutomationResponse(AutomationSchema):
    """自动化管理响应。"""

    id: uuid.UUID
    user_id: uuid.UUID
    assistant_id: uuid.UUID
    name: str
    goal: str
    model: str | None
    max_steps: int
    timezone: str
    status: AutomationStatus
    trigger: AutomationTriggerResponse
    runs: list[AutomationRunResponse]
    created_at: datetime
    updated_at: datetime


class AutomationRunStatusResponse(AutomationSchema):
    """自动化运行状态与标准 Run 状态的简短响应。"""

    id: uuid.UUID
    automation_id: uuid.UUID
    agent_run_id: uuid.UUID | None
    status: AutomationRunStatus
    agent_status: AgentRunStatus | None = None
    estimated_cost_usd: Decimal | None = None
