"""Skill 管理 API 的输入输出契约。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.models.skill import SkillInstallationScope, SkillVersionStatus
from app.tools.contracts import ToolRisk


class SkillSchema(BaseModel):
    """Skill Schema 的公共序列化配置。"""

    model_config = ConfigDict(from_attributes=True, alias_generator=to_camel, populate_by_name=True)


class SkillDraftCreate(SkillSchema):
    """创建稳定 Skill 和其首个不可变草稿版本。"""

    manifest: str = Field(min_length=1, max_length=20_000)
    skill_md: str = Field(min_length=1, max_length=100_000)


class SkillVersionDraftCreate(SkillSchema):
    """为已有 Skill 追加一个不可变草稿版本。"""

    manifest: str = Field(min_length=1, max_length=20_000)
    skill_md: str = Field(min_length=1, max_length=100_000)


class SkillInstallationUpdate(SkillSchema):
    """为已激活 Skill 设置用户可见范围。"""

    scope: SkillInstallationScope
    assistant_id: uuid.UUID | None = None


class SkillVersionResponse(SkillSchema):
    """Skill 版本内容及其可审计验证状态。"""

    id: uuid.UUID
    skill_id: uuid.UUID
    version: str
    manifest_text: str
    skill_md: str
    content_hash: str
    required_tools: list[str]
    risk_ceiling: ToolRisk
    status: SkillVersionStatus
    validation_result: dict[str, object] | None
    validation_errors: list[str]
    created_at: datetime
    validated_at: datetime | None


class SkillInstallationResponse(SkillSchema):
    """Skill 安装范围的安全表示。"""

    id: uuid.UUID
    skill_id: uuid.UUID
    scope: SkillInstallationScope
    assistant_id: uuid.UUID | None
    created_at: datetime


class SkillResponse(SkillSchema):
    """Skill 与其版本、安装范围的完整管理快照。"""

    id: uuid.UUID
    user_id: uuid.UUID
    slug: str
    name: str
    description: str
    current_version_id: uuid.UUID | None
    versions: list[SkillVersionResponse]
    installations: list[SkillInstallationResponse]
    created_at: datetime
    updated_at: datetime
