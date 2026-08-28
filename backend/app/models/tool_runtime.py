"""受控工具运行时的租户隔离持久化模型。"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import JSON, BigInteger, DateTime, Enum, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

if TYPE_CHECKING:
    pass


class ToolConnectionKind(StrEnum):
    """用户连接的凭证或服务类型。"""

    oauth = "oauth"
    api_key = "api_key"
    mcp_http = "mcp_http"
    desktop_local = "desktop_local"


class ToolConnectionStatus(StrEnum):
    """连接生命周期状态。"""

    active = "active"
    expired = "expired"
    revoked = "revoked"
    error = "error"


class ToolExecutionStatus(StrEnum):
    """工具执行生命周期状态。"""

    queued = "queued"
    running = "running"
    waiting = "waiting"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class ExecutionNodeStatus(StrEnum):
    """桌面执行节点状态。"""

    offline = "offline"
    online = "online"
    revoked = "revoked"
    update_required = "update_required"


class ResourceGrantKind(StrEnum):
    """本机资源授权类型。"""

    file = "file"
    directory = "directory"
    browser_profile = "browser_profile"
    application = "application"


class ArtifactKind(StrEnum):
    """Artifact 的可预览类别。"""

    document = "document"
    spreadsheet = "spreadsheet"
    image = "image"
    code = "code"
    archive = "archive"
    browser_snapshot = "browser_snapshot"
    log = "log"
    audio = "audio"
    video = "video"


class McpServerStatus(StrEnum):
    """MCP Server 连接状态。"""

    pending = "pending"
    active = "active"
    paused = "paused"
    error = "error"
    revoked = "revoked"


class ToolConnection(Base):
    """用户拥有的连接元数据；secret_ref 永远不保存明文凭证。"""

    __tablename__ = "tool_connections"
    __table_args__ = (Index("ix_tool_connections_user_status", "user_id", "status"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[ToolConnectionKind] = mapped_column(
        Enum(ToolConnectionKind, native_enum=False, length=20), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(100), nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    secret_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)
    scopes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    status: Mapped[ToolConnectionStatus] = mapped_column(
        Enum(ToolConnectionStatus, native_enum=False, length=12),
        nullable=False,
        default=ToolConnectionStatus.active,
    )
    metadata_json: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
    last_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ToolExecution(Base):
    """每次工具调用的审计快照，参数仅保存脱敏预览和哈希。"""

    __tablename__ = "tool_executions"
    __table_args__ = (
        Index("ix_tool_executions_user_status", "user_id", "status"),
        Index("ix_tool_executions_run_created", "run_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=True, index=True
    )
    step_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_steps.id", ondelete="SET NULL"), nullable=True, index=True
    )
    tool_name: Mapped[str] = mapped_column(String(100), nullable=False)
    tool_version: Mapped[str] = mapped_column(String(30), nullable=False, default="1.0.0")
    connection_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tool_connections.id", ondelete="SET NULL"), nullable=True
    )
    execution_location: Mapped[str] = mapped_column(String(20), nullable=False)
    node_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("execution_nodes.id", ondelete="SET NULL"), nullable=True
    )
    risk_level: Mapped[str] = mapped_column(String(30), nullable=False)
    side_effect: Mapped[str] = mapped_column(String(30), nullable=False, default="none")
    arguments_preview: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
    arguments_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[ToolExecutionStatus] = mapped_column(
        Enum(ToolExecutionStatus, native_enum=False, length=12),
        nullable=False,
        default=ToolExecutionStatus.queued,
    )
    result_summary: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    result_json: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    artifact_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    error_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ExecutionNode(Base):
    """与单个用户绑定的桌面执行节点。"""

    __tablename__ = "execution_nodes"
    __table_args__ = (Index("ix_execution_nodes_user_status", "user_id", "status"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    platform: Mapped[str] = mapped_column(String(40), nullable=False)
    app_version: Mapped[str] = mapped_column(String(40), nullable=False)
    public_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    capabilities: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    status: Mapped[ExecutionNodeStatus] = mapped_column(
        Enum(ExecutionNodeStatus, native_enum=False, length=20),
        nullable=False,
        default=ExecutionNodeStatus.offline,
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    policy: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
    pairing_code_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    pairing_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ResourceGrant(Base):
    """本机资源授权元数据，不把真实路径上传到云端。"""

    __tablename__ = "resource_grants"
    __table_args__ = (Index("ix_resource_grants_user_node", "user_id", "node_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    node_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("execution_nodes.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[ResourceGrantKind] = mapped_column(
        Enum(ResourceGrantKind, native_enum=False, length=20), nullable=False
    )
    resource_id: Mapped[str] = mapped_column(String(200), nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    scopes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Artifact(Base):
    """大结果的外置存储引用和租户边界。"""

    __tablename__ = "artifacts"
    __table_args__ = (Index("ix_artifacts_user_run_created", "user_id", "run_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=True, index=True
    )
    tool_execution_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tool_executions.id", ondelete="SET NULL"), nullable=True
    )
    kind: Mapped[ArtifactKind] = mapped_column(
        Enum(ArtifactKind, native_enum=False, length=24), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    sensitivity: Mapped[str] = mapped_column(String(20), nullable=False, default="normal")
    retention_policy: Mapped[str] = mapped_column(String(40), nullable=False, default="standard")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    preview_json: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class McpServer(Base):
    """用户级 MCP Server schema 快照和明确启用的工具集合。"""

    __tablename__ = "mcp_servers"
    __table_args__ = (Index("ix_mcp_servers_user_status", "user_id", "status"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    endpoint_url: Mapped[str] = mapped_column(String(500), nullable=False)
    transport: Mapped[str] = mapped_column(String(20), nullable=False, default="streamable_http")
    status: Mapped[McpServerStatus] = mapped_column(
        Enum(McpServerStatus, native_enum=False, length=12),
        nullable=False,
        default=McpServerStatus.pending,
    )
    schema_snapshot: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    schema_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    enabled_tools: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    metadata_json: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
    last_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
