"""受控工具运行时 API schema。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import AliasChoices, Field, field_validator

from app.schemas.agent import AgentSchema


class ToolCatalogResponse(AgentSchema):
    """客户端工具目录项；不含任何密钥。"""

    name: str
    version: str = "1.0.0"
    description: str
    input_schema: dict[str, object]
    output_schema: dict[str, object] | None
    risk_level: str
    side_effect: str
    execution_location: str
    execution_locations: list[str]
    required_scopes: list[str]
    timeout_seconds: int
    max_output_bytes: int
    idempotent: bool
    supports_cancel: bool
    tags: list[str]


class ToolConnectionCreateRequest(AgentSchema):
    """创建连接请求；服务端只保存 secret_ref，不接受明文 secret。"""

    kind: str = Field(pattern="^(oauth|api_key|mcp_http|desktop_local)$")
    provider: str = Field(min_length=1, max_length=100)
    display_name: str = Field(min_length=1, max_length=120)
    secret_ref: str | None = Field(default=None, max_length=200)
    scopes: list[str] = Field(default_factory=list, max_length=50)
    metadata: dict[str, object] = Field(default_factory=dict)


class ToolConnectionResponse(AgentSchema):
    """连接安全响应。"""

    id: uuid.UUID
    user_id: uuid.UUID
    kind: str
    provider: str
    display_name: str
    secret_ref: str | None
    scopes: list[str]
    status: str
    metadata: dict[str, object] = Field(
        validation_alias=AliasChoices("metadata_json", "metadata"),
        serialization_alias="metadata",
    )
    last_verified_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ToolExecuteRequest(AgentSchema):
    """手动执行工具请求；外部副作用仍必须走审批。"""

    tool_name: str = Field(min_length=1, max_length=100)
    arguments: dict[str, object] = Field(default_factory=dict)
    execution_location: str = Field(default="cloud", pattern="^(cloud|desktop)$")
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=120)
    run_id: uuid.UUID | None = None


class ToolExecutionResponse(AgentSchema):
    """工具执行审计快照。"""

    id: uuid.UUID
    user_id: uuid.UUID
    run_id: uuid.UUID | None
    step_id: uuid.UUID | None
    tool_name: str
    tool_version: str
    connection_id: uuid.UUID | None
    execution_location: str
    node_id: uuid.UUID | None
    risk_level: str
    side_effect: str
    arguments_preview: dict[str, object]
    arguments_hash: str
    idempotency_key: str | None
    status: str
    result_summary: str | None
    result_json: dict[str, object] | None
    artifact_ids: list[str]
    error_code: str | None
    error_message: str | None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime


class ArtifactResponse(AgentSchema):
    """Artifact 元数据和短期访问地址。"""

    id: uuid.UUID
    user_id: uuid.UUID
    run_id: uuid.UUID | None
    tool_execution_id: uuid.UUID | None
    kind: str
    name: str
    mime_type: str
    size_bytes: int
    sha256: str
    sensitivity: str
    retention_policy: str
    expires_at: datetime | None
    preview: dict[str, object] | None = Field(
        validation_alias=AliasChoices("preview", "preview_json"),
        serialization_alias="preview",
    )
    download_url: str
    created_at: datetime


class ExecutionNodePairRequest(AgentSchema):
    """创建桌面节点配对挑战。"""

    name: str = Field(min_length=1, max_length=120)
    platform: str = Field(min_length=1, max_length=40)
    app_version: str = Field(min_length=1, max_length=40)
    capabilities: list[str] = Field(default_factory=list, max_length=100)


class ExecutionNodeResponse(AgentSchema):
    """桌面节点安全响应。"""

    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    platform: str
    app_version: str
    capabilities: list[str]
    status: str
    last_seen_at: datetime | None
    policy: dict[str, object]
    created_at: datetime
    updated_at: datetime


class ExecutionNodePairResponse(ExecutionNodeResponse):
    """仅创建时返回一次的配对码。"""

    pairing_code: str
    expires_at: datetime


class ResourceGrantCreateRequest(AgentSchema):
    """桌面资源授权元数据；真实路径只保存在节点本地。"""

    node_id: uuid.UUID
    kind: str = Field(pattern="^(file|directory|browser_profile|application)$")
    resource_id: str = Field(min_length=1, max_length=200)
    display_name: str = Field(min_length=1, max_length=200)
    scopes: list[str] = Field(default_factory=list, max_length=50)


class ResourceGrantResponse(AgentSchema):
    """资源授权安全响应。"""

    id: uuid.UUID
    user_id: uuid.UUID
    node_id: uuid.UUID
    kind: str
    resource_id: str
    display_name: str
    scopes: list[str]
    revoked_at: datetime | None
    created_at: datetime


class McpServerCreateRequest(AgentSchema):
    """添加远程 Streamable HTTP MCP Server。"""

    name: str = Field(min_length=1, max_length=120)
    endpoint_url: str = Field(min_length=1, max_length=500)
    enabled_tools: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("endpoint_url")
    @classmethod
    def reject_credentials_in_url(cls, value: str) -> str:
        """拒绝把用户名或密码写进远程 MCP URL。"""

        if "@" in value.split("//", 1)[-1].split("/", 1)[0]:
            raise ValueError("MCP endpoint cannot contain credentials")
        return value


class McpServerResponse(AgentSchema):
    """MCP Server schema 快照。"""

    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    endpoint_url: str
    transport: str
    status: str
    schema_snapshot: dict[str, object] | None
    schema_hash: str | None
    enabled_tools: list[str]
    metadata: dict[str, object] = Field(
        validation_alias=AliasChoices("metadata_json", "metadata"),
        serialization_alias="metadata",
    )
    last_verified_at: datetime | None
    created_at: datetime
    updated_at: datetime


class McpToolExecuteRequest(AgentSchema):
    """调用已验证并明确启用的 MCP 工具。"""

    tool_name: str = Field(min_length=1, max_length=100)
    arguments: dict[str, object] = Field(default_factory=dict)


class McpEnableToolsRequest(AgentSchema):
    """明确启用 MCP 工具列表。"""

    enabled_tools: list[str] = Field(default_factory=list, max_length=100)
