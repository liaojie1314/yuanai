"""工具目录、执行审计、Artifact 和节点资源。"""

from __future__ import annotations

import hashlib
import json
import re
import secrets
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from pathlib import PurePosixPath
from typing import cast

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent_run import AgentRun
from app.models.tool_runtime import (
    Artifact,
    ArtifactKind,
    ExecutionNode,
    ExecutionNodeStatus,
    McpServer,
    McpServerStatus,
    ResourceGrant,
    ResourceGrantKind,
    ToolConnection,
    ToolConnectionKind,
    ToolConnectionStatus,
    ToolExecution,
    ToolExecutionStatus,
)
from app.services.agent.approval_service import payload_hash, sanitize_arguments
from app.services.storage_service import storage
from app.services.tools.web_security import UrlPolicyError, validate_public_url
from app.tools.builtin import build_phase6_registry
from app.tools.contracts import (
    ArtifactRef,
    Citation,
    ToolContext,
    ToolError,
    ToolErrorPayload,
    ToolMetrics,
    ToolRegistrationError,
    ToolResult,
    ToolSpec,
    ToolValidationError,
)
from app.tools.registry import ToolRegistry, validate_arguments_against_schema

_NAME_RE = re.compile(r"[^a-zA-Z0-9._-]+")


class ToolRuntimeError(RuntimeError):
    """Tool Runtime 可安全返回给 API 的领域错误。"""


def _safe_name(value: str) -> str:
    """把用户可控文件名压缩为不会逃逸 Artifact 前缀的路径片段。"""

    name = _NAME_RE.sub("_", value.strip()).strip("._") or "artifact"
    return str(PurePosixPath(name).name)[:255]


def _artifact_kind(mime_type: str) -> ArtifactKind:
    """根据 MIME 类型选择预览类别。"""

    if mime_type.startswith("image/"):
        return ArtifactKind.image
    if mime_type.startswith("audio/"):
        return ArtifactKind.audio
    if mime_type.startswith("video/"):
        return ArtifactKind.video
    if "spreadsheet" in mime_type or mime_type in {"text/csv", "application/vnd.ms-excel"}:
        return ArtifactKind.spreadsheet
    if "json" in mime_type or mime_type.startswith("text/"):
        return ArtifactKind.document
    return ArtifactKind.archive


def catalog_item(spec: ToolSpec) -> dict[str, object]:
    """把内部 ToolSpec 转成不含 handler 的客户端目录项。"""

    return {
        "name": spec.name,
        "version": "1.0.0",
        "description": spec.description,
        "input_schema": spec.input_schema,
        "output_schema": spec.output_schema,
        "risk_level": spec.risk_level.value,
        "side_effect": spec.side_effect.value,
        "execution_location": spec.execution_location,
        "execution_locations": sorted(spec.execution_locations),
        "required_scopes": sorted(spec.required_scopes),
        "timeout_seconds": spec.timeout_seconds,
        "max_output_bytes": spec.max_output_bytes,
        "idempotent": spec.idempotent,
        "supports_cancel": spec.supports_cancel,
        "tags": sorted(spec.tags),
    }


class ToolRuntimeService:
    """统一执行入口，保证策略、审计和大结果外置存储不被路由绕过。"""

    def __init__(
        self,
        registry: ToolRegistry | None = None,
        *,
        mcp_transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.registry = registry or build_phase6_registry()
        self._mcp_transport = mcp_transport

    def catalog(self) -> list[dict[str, object]]:
        """返回稳定排序的内置工具目录。"""

        return [catalog_item(spec) for spec in self.registry.list_specs()]

    async def create_connection(
        self,
        *,
        user_id: uuid.UUID,
        kind: str,
        provider: str,
        display_name: str,
        secret_ref: str | None,
        scopes: list[str],
        metadata: dict[str, object],
        db: AsyncSession,
    ) -> ToolConnection:
        """创建用户连接元数据，永远不接收明文凭证。"""

        connection = ToolConnection(
            user_id=user_id,
            kind=connection_model(kind),
            provider=provider,
            display_name=display_name,
            secret_ref=secret_ref,
            scopes=sorted(set(scopes)),
            status=ToolConnectionStatus.active,
            metadata_json=metadata,
        )
        db.add(connection)
        await db.commit()
        await db.refresh(connection)
        return connection

    async def list_connections(
        self, *, user_id: uuid.UUID, db: AsyncSession
    ) -> list[ToolConnection]:
        """列出当前租户连接。"""

        return list(
            (
                await db.scalars(
                    select(ToolConnection)
                    .where(ToolConnection.user_id == user_id)
                    .order_by(ToolConnection.created_at.desc())
                )
            ).all()
        )

    async def revoke_connection(
        self, connection_id: uuid.UUID, *, user_id: uuid.UUID, db: AsyncSession
    ) -> ToolConnection:
        """撤销当前租户连接并保留审计历史。"""

        connection = await db.scalar(
            select(ToolConnection).where(
                ToolConnection.id == connection_id, ToolConnection.user_id == user_id
            )
        )
        if connection is None:
            raise ToolRuntimeError("TOOL_CONNECTION_NOT_FOUND")
        await disconnect_connection(connection, db)
        await db.commit()
        await db.refresh(connection)
        return connection

    async def create_manual_execution(
        self,
        *,
        user_id: uuid.UUID,
        tool_name: str,
        arguments: dict[str, object],
        execution_location: str,
        idempotency_key: str | None,
        run_id: uuid.UUID | None,
        db: AsyncSession,
    ) -> ToolExecution:
        """登记并执行手动工具请求，副作用工具保持等待审批。"""

        if run_id is not None:
            run = await db.scalar(
                select(AgentRun).where(AgentRun.id == run_id, AgentRun.user_id == user_id)
            )
            if run is None:
                raise ToolRuntimeError("AGENT_RUN_NOT_FOUND")
        execution = await self.create_execution(
            user_id=user_id,
            tool_name=tool_name,
            arguments=arguments,
            execution_location=execution_location,
            db=db,
            run_id=run_id,
            idempotency_key=idempotency_key,
        )
        spec = self.registry.get_spec(tool_name)
        if spec.risk_level.value == "read":
            await self.execute(execution, arguments=arguments, db=db)
        else:
            execution.status = ToolExecutionStatus.waiting
            execution.error_code = "TOOL_APPROVAL_REQUIRED"
            execution.error_message = "工具执行需要审批"
        await db.commit()
        await db.refresh(execution)
        return execution

    async def list_executions(
        self, *, user_id: uuid.UUID, limit: int, db: AsyncSession
    ) -> list[ToolExecution]:
        """按时间倒序列出当前租户执行审计。"""

        return list(
            (
                await db.scalars(
                    select(ToolExecution)
                    .where(ToolExecution.user_id == user_id)
                    .order_by(ToolExecution.created_at.desc())
                    .limit(max(1, min(limit, 100)))
                )
            ).all()
        )

    async def cancel_execution(
        self, execution_id: uuid.UUID, *, user_id: uuid.UUID, db: AsyncSession
    ) -> ToolExecution:
        """取消当前租户尚未完成的执行。"""

        execution = await db.scalar(
            select(ToolExecution).where(
                ToolExecution.id == execution_id, ToolExecution.user_id == user_id
            )
        )
        if execution is None:
            raise ToolRuntimeError("TOOL_EXECUTION_NOT_FOUND")
        if execution.status in {
            ToolExecutionStatus.queued,
            ToolExecutionStatus.running,
            ToolExecutionStatus.waiting,
        }:
            execution.status = ToolExecutionStatus.cancelled
            execution.error_code = "TOOL_CANCELLED"
            execution.finished_at = datetime.now(UTC)
            execution.result_json = _tool_result_payload(
                ToolResult(
                    status="cancelled",
                    summary="工具执行已取消",
                    error=ToolErrorPayload(code="TOOL_CANCELLED", message="工具执行已取消"),
                )
            )
            await db.commit()
            await db.refresh(execution)
        return execution

    async def list_artifacts(self, *, user_id: uuid.UUID, db: AsyncSession) -> list[Artifact]:
        """列出当前租户 Artifact 元数据。"""

        return list(
            (
                await db.scalars(
                    select(Artifact)
                    .where(Artifact.user_id == user_id)
                    .order_by(Artifact.created_at.desc())
                )
            ).all()
        )

    async def read_artifact_content(
        self, artifact_id: uuid.UUID, *, user_id: uuid.UUID, db: AsyncSession
    ) -> tuple[Artifact, bytes]:
        """按租户读取 Artifact 内容，存储 key 不对外暴露。"""

        artifact = await self.get_artifact(artifact_id, user_id=user_id, db=db)
        try:
            content = await storage.get_object(artifact.storage_key)
        except (OSError, KeyError, ValueError) as error:
            raise ToolRuntimeError("ARTIFACT_CONTENT_NOT_FOUND") from error
        return artifact, content

    async def get_node(
        self, node_id: uuid.UUID, *, user_id: uuid.UUID, db: AsyncSession
    ) -> ExecutionNode:
        """按租户读取桌面节点。"""

        node = await db.scalar(
            select(ExecutionNode).where(
                ExecutionNode.id == node_id, ExecutionNode.user_id == user_id
            )
        )
        if node is None:
            raise ToolRuntimeError("EXECUTION_NODE_NOT_FOUND")
        return node

    async def list_nodes(self, *, user_id: uuid.UUID, db: AsyncSession) -> list[ExecutionNode]:
        """列出当前租户桌面节点。"""

        return list(
            (
                await db.scalars(
                    select(ExecutionNode)
                    .where(ExecutionNode.user_id == user_id)
                    .order_by(ExecutionNode.created_at.desc())
                )
            ).all()
        )

    async def heartbeat_node(
        self, node_id: uuid.UUID, *, user_id: uuid.UUID, db: AsyncSession
    ) -> ExecutionNode:
        """更新节点心跳，撤销节点不可恢复为在线。"""

        node = await self.get_node(node_id, user_id=user_id, db=db)
        if node.status is ExecutionNodeStatus.revoked:
            raise ToolRuntimeError("EXECUTION_NODE_REVOKED")
        await set_node_online(node, db)
        await db.commit()
        await db.refresh(node)
        return node

    async def revoke_execution_node(
        self, node_id: uuid.UUID, *, user_id: uuid.UUID, db: AsyncSession
    ) -> ExecutionNode:
        """撤销节点并取消尚未执行的任务。"""

        node = await self.get_node(node_id, user_id=user_id, db=db)
        await revoke_node(node, db)
        await db.commit()
        await db.refresh(node)
        return node

    async def create_resource_grant(
        self,
        *,
        user_id: uuid.UUID,
        node_id: uuid.UUID,
        kind: str,
        resource_id: str,
        display_name: str,
        scopes: list[str],
        db: AsyncSession,
    ) -> ResourceGrant:
        """保存桌面原生选择器授予的资源 ID，不接收真实路径。"""

        node = await self.get_node(node_id, user_id=user_id, db=db)
        if node.status is ExecutionNodeStatus.revoked:
            raise ToolRuntimeError("EXECUTION_NODE_REVOKED")
        grant = ResourceGrant(
            user_id=user_id,
            node_id=node.id,
            kind=grant_kind(kind),
            resource_id=resource_id,
            display_name=display_name,
            scopes=sorted(set(scopes)),
        )
        db.add(grant)
        await db.commit()
        await db.refresh(grant)
        return grant

    async def list_resource_grants(
        self, *, user_id: uuid.UUID, db: AsyncSession
    ) -> list[ResourceGrant]:
        """列出当前租户仍有效的资源授权。"""

        return list(
            (
                await db.scalars(
                    select(ResourceGrant)
                    .where(ResourceGrant.user_id == user_id, ResourceGrant.revoked_at.is_(None))
                    .order_by(ResourceGrant.created_at.desc())
                )
            ).all()
        )

    async def create_mcp_server(
        self,
        *,
        user_id: uuid.UUID,
        name: str,
        endpoint_url: str,
        enabled_tools: list[str],
        db: AsyncSession,
    ) -> McpServer:
        """添加尚未验证 schema 的远程 MCP Server。"""

        try:
            endpoint = validate_public_url(endpoint_url)
        except UrlPolicyError as error:
            raise ToolRuntimeError("MCP_ENDPOINT_INVALID") from error
        server = McpServer(
            user_id=user_id,
            name=name,
            endpoint_url=endpoint,
            transport="streamable_http",
            status=McpServerStatus.pending,
            enabled_tools=[],
            metadata_json={},
        )
        db.add(server)
        await db.commit()
        await db.refresh(server)
        return server

    async def get_mcp_server(
        self, server_id: uuid.UUID, *, user_id: uuid.UUID, db: AsyncSession
    ) -> McpServer:
        """按租户读取 MCP Server。"""

        server = await db.scalar(
            select(McpServer).where(McpServer.id == server_id, McpServer.user_id == user_id)
        )
        if server is None:
            raise ToolRuntimeError("MCP_SERVER_NOT_FOUND")
        return server

    async def list_mcp_servers(self, *, user_id: uuid.UUID, db: AsyncSession) -> list[McpServer]:
        """列出当前租户 MCP Server。"""

        return list(
            (
                await db.scalars(
                    select(McpServer)
                    .where(McpServer.user_id == user_id)
                    .order_by(McpServer.created_at.desc())
                )
            ).all()
        )

    async def discover_mcp_server(
        self, server_id: uuid.UUID, *, user_id: uuid.UUID, db: AsyncSession
    ) -> McpServer:
        """读取 MCP schema 快照，变化时暂停并清空已启用工具。"""

        server = await self.get_mcp_server(server_id, user_id=user_id, db=db)
        try:
            async with httpx.AsyncClient(
                timeout=15, follow_redirects=False, transport=self._mcp_transport
            ) as client:
                response = await client.post(
                    server.endpoint_url,
                    json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
                    headers={"Accept": "application/json, text/event-stream"},
                )
                response.raise_for_status()
                payload_value = response.json()
        except (httpx.HTTPError, TimeoutError, ValueError) as error:
            server.status = McpServerStatus.error
            await db.commit()
            raise ToolRuntimeError("MCP_DISCOVERY_FAILED") from error
        if not isinstance(payload_value, dict):
            raise ToolRuntimeError("MCP_SCHEMA_INVALID")
        result_value = payload_value.get("result")
        tools_value = result_value.get("tools") if isinstance(result_value, dict) else None
        if not isinstance(tools_value, list):
            raise ToolRuntimeError("MCP_SCHEMA_INVALID")
        snapshot_tools: list[dict[str, object]] = []
        for item in tools_value:
            if not isinstance(item, dict) or not isinstance(item.get("name"), str):
                continue
            input_schema = item.get("inputSchema", {})
            snapshot_tools.append(
                {
                    "name": item["name"],
                    "description": str(item.get("description", ""))[:500],
                    "inputSchema": input_schema if isinstance(input_schema, dict) else {},
                    "annotations": (
                        {
                            key: value
                            for key, value in item["annotations"].items()
                            if key in {"readOnlyHint", "destructiveHint", "idempotentHint"}
                            and isinstance(value, bool)
                        }
                        if isinstance(item.get("annotations"), Mapping)
                        else {}
                    ),
                }
            )
        snapshot: dict[str, object] = {"tools": snapshot_tools}
        schema_hash = hashlib.sha256(
            json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        if server.schema_hash is not None and server.schema_hash != schema_hash:
            server.status = McpServerStatus.paused
            server.enabled_tools = []
        else:
            available = {str(item["name"]) for item in snapshot_tools}
            server.status = McpServerStatus.active
            server.enabled_tools = sorted(set(server.enabled_tools).intersection(available))
        server.schema_snapshot = snapshot
        server.schema_hash = schema_hash
        server.last_verified_at = datetime.now(UTC)
        await db.commit()
        await db.refresh(server)
        return server

    async def enable_mcp_tools(
        self,
        server_id: uuid.UUID,
        *,
        user_id: uuid.UUID,
        enabled_tools: list[str],
        db: AsyncSession,
    ) -> McpServer:
        """仅启用已验证 schema 中用户明确选择的 MCP 工具。"""

        server = await self.get_mcp_server(server_id, user_id=user_id, db=db)
        snapshot = server.schema_snapshot or {}
        tools_value = snapshot.get("tools") if isinstance(snapshot, Mapping) else None
        available = (
            {
                str(item.get("name"))
                for item in tools_value
                if isinstance(item, dict) and isinstance(item.get("name"), str)
            }
            if isinstance(tools_value, list)
            else set()
        )
        requested = set(enabled_tools)
        if not requested.issubset(available):
            raise ToolRuntimeError("MCP_TOOL_NOT_VERIFIED")
        server.enabled_tools = sorted(requested)
        server.status = McpServerStatus.active
        await db.commit()
        await db.refresh(server)
        return server

    async def create_mcp_execution(
        self,
        server_id: uuid.UUID,
        *,
        user_id: uuid.UUID,
        tool_name: str,
        arguments: dict[str, object],
        db: AsyncSession,
    ) -> ToolExecution:
        """调用已发现且明确启用的 MCP 工具，并为副作用调用保留审批状态。"""

        server = await self.get_mcp_server(server_id, user_id=user_id, db=db)
        if server.status is not McpServerStatus.active or tool_name not in server.enabled_tools:
            raise ToolRuntimeError("MCP_TOOL_NOT_ENABLED")
        snapshot = server.schema_snapshot or {}
        tools_value = snapshot.get("tools") if isinstance(snapshot, Mapping) else None
        schema_item = (
            next(
                (
                    item
                    for item in tools_value
                    if isinstance(item, dict) and item.get("name") == tool_name
                ),
                None,
            )
            if isinstance(tools_value, list)
            else None
        )
        if not isinstance(schema_item, dict):
            raise ToolRuntimeError("MCP_TOOL_NOT_VERIFIED")
        input_schema = schema_item.get("inputSchema", {})
        if not isinstance(input_schema, Mapping):
            raise ToolRuntimeError("MCP_SCHEMA_INVALID")
        try:
            validated_arguments = validate_arguments_against_schema(arguments, input_schema)
        except ToolValidationError as error:
            raise ToolRuntimeError("MCP_TOOL_INVALID_INPUT") from error

        annotations = schema_item.get("annotations")
        read_only = isinstance(annotations, Mapping) and annotations.get("readOnlyHint") is True
        execution = ToolExecution(
            user_id=user_id,
            tool_name=tool_name,
            tool_version="mcp-1.0.0",
            execution_location="mcp_remote",
            risk_level="read" if read_only else "external_side_effect",
            side_effect="none" if read_only else "external",
            arguments_preview=sanitize_arguments(validated_arguments),
            arguments_hash=payload_hash(validated_arguments),
            status=ToolExecutionStatus.queued,
            artifact_ids=[],
        )
        db.add(execution)
        await db.flush()
        if not read_only:
            execution.status = ToolExecutionStatus.waiting
            execution.error_code = "TOOL_APPROVAL_REQUIRED"
            execution.error_message = "MCP 工具未声明只读，需要 Agent 审批后执行"
            await db.commit()
            await db.refresh(execution)
            return execution

        try:
            endpoint = validate_public_url(server.endpoint_url)
            async with httpx.AsyncClient(
                timeout=15, follow_redirects=False, transport=self._mcp_transport
            ) as client:
                response = await client.post(
                    endpoint,
                    json={
                        "jsonrpc": "2.0",
                        "id": str(execution.id),
                        "method": "tools/call",
                        "params": {"name": tool_name, "arguments": validated_arguments},
                    },
                    headers={"Accept": "application/json, text/event-stream"},
                )
                if response.is_redirect:
                    raise ToolRuntimeError("MCP_REDIRECT_BLOCKED")
                response.raise_for_status()
                payload_value = response.json()
        except ToolRuntimeError:
            raise
        except (httpx.HTTPError, TimeoutError, ValueError, UrlPolicyError) as error:
            execution.status = ToolExecutionStatus.failed
            execution.error_code = "MCP_CALL_FAILED"
            execution.error_message = "MCP 工具调用失败"
            execution.finished_at = datetime.now(UTC)
            execution.result_json = _tool_result_payload(
                ToolResult(
                    status="failed",
                    summary="MCP 工具调用失败",
                    error=ToolErrorPayload(code="MCP_CALL_FAILED", message="MCP 工具调用失败"),
                )
            )
            await db.commit()
            await db.refresh(execution)
            raise ToolRuntimeError("MCP_CALL_FAILED") from error
        if not isinstance(payload_value, dict):
            raise ToolRuntimeError("MCP_RESPONSE_INVALID")
        if payload_value.get("error") is not None:
            execution.status = ToolExecutionStatus.failed
            execution.error_code = "MCP_TOOL_FAILED"
            execution.error_message = "MCP 工具返回错误"
        else:
            result_value = payload_value.get("result")
            if not isinstance(result_value, dict):
                raise ToolRuntimeError("MCP_RESPONSE_INVALID")
            encoded = json.dumps(result_value, ensure_ascii=False, separators=(",", ":"))
            if len(encoded.encode("utf-8")) > 32 * 1024:
                execution.status = ToolExecutionStatus.failed
                execution.error_code = "TOOL_OUTPUT_TOO_LARGE"
                execution.error_message = "MCP 工具结果超过大小限制"
                execution.result_json = _tool_result_payload(
                    ToolResult(
                        status="failed",
                        summary="MCP 工具结果超过大小限制",
                        error=ToolErrorPayload(
                            code="TOOL_OUTPUT_TOO_LARGE", message="MCP 工具结果超过大小限制"
                        ),
                    )
                )
            else:
                execution.result_json = result_value
                execution.result_summary = "MCP 只读工具执行完成"
                execution.status = ToolExecutionStatus.succeeded
        execution.started_at = execution.started_at or datetime.now(UTC)
        execution.finished_at = datetime.now(UTC)
        if execution.status is ToolExecutionStatus.succeeded:
            output_bytes = len(encoded.encode("utf-8"))
            execution.result_json = _tool_result_payload(
                ToolResult(
                    status="succeeded",
                    summary="MCP 只读工具执行完成",
                    data=result_value,
                    metrics=ToolMetrics(output_bytes=output_bytes),
                )
            )
        await db.commit()
        await db.refresh(execution)
        return execution

    async def create_execution(
        self,
        *,
        user_id: uuid.UUID,
        tool_name: str,
        arguments: dict[str, object],
        execution_location: str,
        db: AsyncSession,
        run_id: uuid.UUID | None = None,
        step_id: uuid.UUID | None = None,
        idempotency_key: str | None = None,
    ) -> ToolExecution:
        """校验工具并创建 queued 审计记录；不执行未授权的位置。"""

        try:
            spec = self.registry.get_spec(tool_name)
            validated_arguments = self.registry.validate_arguments(tool_name, arguments)
        except ToolRegistrationError as error:
            raise ToolRuntimeError("TOOL_NOT_FOUND") from error
        except ToolValidationError as error:
            raise ToolRuntimeError("TOOL_INVALID_INPUT") from error
        if execution_location not in {"cloud", "desktop"}:
            raise ToolRuntimeError("EXECUTION_LOCATION_INVALID")
        if spec.execution_location != "either" and execution_location != spec.execution_location:
            raise ToolRuntimeError("EXECUTION_LOCATION_NOT_ALLOWED")
        argument_hash = payload_hash(validated_arguments)
        if idempotency_key:
            existing = await db.scalar(
                select(ToolExecution).where(
                    ToolExecution.user_id == user_id,
                    ToolExecution.idempotency_key == idempotency_key,
                )
            )
            if existing is not None:
                if existing.arguments_hash != argument_hash:
                    raise ToolRuntimeError("TOOL_IDEMPOTENCY_CONFLICT")
                return existing
        execution = ToolExecution(
            user_id=user_id,
            run_id=run_id,
            step_id=step_id,
            tool_name=tool_name,
            tool_version="1.0.0",
            execution_location=execution_location,
            risk_level=spec.risk_level.value,
            side_effect=spec.side_effect.value,
            arguments_preview=sanitize_arguments(validated_arguments),
            arguments_hash=argument_hash,
            idempotency_key=idempotency_key,
            status=ToolExecutionStatus.queued,
            artifact_ids=[],
        )
        db.add(execution)
        await db.flush()
        return execution

    async def start_execution(self, execution: ToolExecution, *, db: AsyncSession) -> None:
        """将已获准的审计记录切换为运行中，保留开始时间。"""

        if execution.status not in {ToolExecutionStatus.queued, ToolExecutionStatus.waiting}:
            raise ToolRuntimeError("TOOL_EXECUTION_NOT_STARTABLE")
        execution.status = ToolExecutionStatus.running
        execution.started_at = datetime.now(UTC)
        await db.flush()

    async def execute(
        self,
        execution: ToolExecution,
        *,
        arguments: dict[str, object],
        db: AsyncSession,
        approved: bool = False,
    ) -> ToolExecution:
        """执行已登记调用，保存结构化结果和 Artifact 引用。"""

        spec = self.registry.get_spec(execution.tool_name)
        self.registry.validate_arguments(execution.tool_name, arguments)
        if payload_hash(arguments) != execution.arguments_hash:
            raise ToolRuntimeError("TOOL_ARGUMENTS_CHANGED")
        if execution.status is ToolExecutionStatus.waiting and not approved:
            raise ToolRuntimeError("TOOL_APPROVAL_REQUIRED")
        if execution.status not in {ToolExecutionStatus.queued, ToolExecutionStatus.waiting}:
            raise ToolRuntimeError("TOOL_EXECUTION_NOT_STARTABLE")
        if execution.status is ToolExecutionStatus.queued and spec.risk_level.value != "read":
            raise ToolRuntimeError("TOOL_APPROVAL_REQUIRED")
        await self.start_execution(execution, db=db)
        try:
            output = await self.registry.execute(
                execution.tool_name,
                arguments,
                context=ToolContext(user_id=execution.user_id, db=db),
            )
            await self.complete_success(execution, output=output, db=db)
        except ToolError as error:
            await self.fail_execution(execution, code=error.code.value, message=str(error), db=db)
        except ToolRuntimeError as error:
            await self.fail_execution(execution, code=str(error), message=str(error), db=db)
        except (OSError, RuntimeError, ValueError, TypeError) as error:
            await self.fail_execution(
                execution, code="TOOL_EXECUTION_FAILED", message=str(error), db=db
            )
        execution.finished_at = datetime.now(UTC)
        await db.flush()
        return execution

    async def complete_success(
        self,
        execution: ToolExecution,
        *,
        output: dict[str, object] | list[object],
        db: AsyncSession,
    ) -> None:
        """保存成功结果，并将工作区文件内容转成 Artifact。"""

        result_json: dict[str, object]
        if isinstance(output, list):
            result_json = {"items": output}
        else:
            result_json = dict(output)
        artifact_ids: list[str] = []
        artifact_refs: list[ArtifactRef] = []
        content = result_json.pop("content", None)
        if isinstance(content, str) and result_json.get("workspace") is True:
            name = str(result_json.get("name", "artifact.txt"))
            mime_type = str(result_json.get("mime_type", "text/plain"))
            artifact = await self.create_artifact(
                user_id=execution.user_id,
                data=content.encode("utf-8"),
                name=name,
                mime_type=mime_type,
                db=db,
                run_id=execution.run_id,
                tool_execution_id=execution.id,
                preview={"text": content[:2_000]},
            )
            artifact_ids.append(str(artifact.id))
            artifact_refs.append(
                ArtifactRef(
                    id=str(artifact.id),
                    name=artifact.name,
                    kind=artifact.kind.value,
                    mime_type=artifact.mime_type,
                    size_bytes=artifact.size_bytes,
                    sha256=artifact.sha256,
                )
            )
            result_json["artifact_id"] = str(artifact.id)
            result_json.pop("workspace", None)
        execution.result_json = result_json
        execution.artifact_ids = artifact_ids
        execution.result_summary = _summary(result_json)
        execution.status = ToolExecutionStatus.succeeded
        execution.finished_at = datetime.now(UTC)
        result_data: dict[str, object] | list[object]
        if isinstance(output, list):
            result_data = result_json
        else:
            result_data = result_json
        encoded = json.dumps(result_data, ensure_ascii=False, separators=(",", ":"))
        duration_ms = _duration_ms(execution.started_at)
        execution.result_json = _tool_result_payload(
            ToolResult(
                status="succeeded",
                summary=execution.result_summary,
                data=result_data,
                artifacts=artifact_refs,
                citations=_citations_from_data(result_json),
                metrics=ToolMetrics(
                    duration_ms=duration_ms,
                    output_bytes=len(encoded.encode("utf-8")),
                ),
            )
        )
        await db.flush()

    async def fail_execution(
        self,
        execution: ToolExecution,
        *,
        code: str,
        message: str,
        db: AsyncSession,
    ) -> None:
        """保存稳定错误码和终止时间。"""

        execution.status = ToolExecutionStatus.failed
        execution.error_code = code[:100]
        execution.error_message = message[:500]
        execution.finished_at = datetime.now(UTC)
        execution.result_json = _tool_result_payload(
            ToolResult(
                status="failed",
                summary="工具执行失败",
                error=ToolErrorPayload(code=code[:100], message=message[:500]),
            )
        )
        await db.flush()

    async def create_artifact(
        self,
        *,
        user_id: uuid.UUID,
        data: bytes,
        name: str,
        mime_type: str,
        db: AsyncSession,
        run_id: uuid.UUID | None = None,
        tool_execution_id: uuid.UUID | None = None,
        preview: dict[str, object] | None = None,
    ) -> Artifact:
        """写入对象存储并保存不可猜测的 Artifact 元数据。"""

        artifact_id = uuid.uuid4()
        safe_name = _safe_name(name)
        key = f"artifacts/{user_id}/{artifact_id}/{safe_name}"
        await storage.put_object(key, data, mime_type)
        artifact = Artifact(
            id=artifact_id,
            user_id=user_id,
            run_id=run_id,
            tool_execution_id=tool_execution_id,
            kind=_artifact_kind(mime_type),
            name=safe_name,
            mime_type=mime_type[:120],
            size_bytes=len(data),
            storage_key=key,
            sha256=hashlib.sha256(data).hexdigest(),
            sensitivity="normal",
            retention_policy="standard",
            preview_json=preview,
        )
        db.add(artifact)
        await db.flush()
        return artifact

    async def get_artifact(
        self, artifact_id: uuid.UUID, *, user_id: uuid.UUID, db: AsyncSession
    ) -> Artifact:
        """按用户边界读取 Artifact，避免猜测 storage key 越权。"""

        artifact = await db.scalar(
            select(Artifact).where(Artifact.id == artifact_id, Artifact.user_id == user_id)
        )
        if artifact is None:
            raise ToolRuntimeError("ARTIFACT_NOT_FOUND")
        return artifact

    async def create_pairing(
        self,
        *,
        user_id: uuid.UUID,
        name: str,
        platform: str,
        app_version: str,
        capabilities: list[str],
        db: AsyncSession,
    ) -> tuple[ExecutionNode, str]:
        """创建 10 分钟一次性桌面节点配对码。"""

        code = secrets.token_urlsafe(24)
        now = datetime.now(UTC)
        node = ExecutionNode(
            user_id=user_id,
            name=name,
            platform=platform,
            app_version=app_version,
            capabilities=sorted(set(capabilities))[:100],
            status=ExecutionNodeStatus.offline,
            policy={"allowed_tools": [], "allowed_resource_ids": []},
            pairing_code_hash=hashlib.sha256(code.encode()).hexdigest(),
            pairing_expires_at=now + timedelta(minutes=10),
        )
        db.add(node)
        await db.flush()
        return node, code


def _summary(value: dict[str, object]) -> str:
    """构造不超过 1000 字符的结果摘要，不记录大正文。"""

    if "sources" in value and isinstance(value["sources"], list):
        return f"返回 {len(value['sources'])} 条来源"
    if "stdout" in value:
        return "代码执行完成"
    if "artifact_id" in value:
        return "已生成 Artifact"
    return str({key: item for key, item in value.items() if key not in {"text", "content"}})[:1000]


def _tool_result_payload(result: ToolResult) -> dict[str, object]:
    """把统一结果序列化为可安全写入 JSON 列的普通字典。"""

    return cast(dict[str, object], result.model_dump(mode="json"))


def _duration_ms(started_at: datetime | None) -> int:
    """计算不包含敏感信息的执行耗时。"""

    if started_at is None:
        return 0
    return max(0, int((datetime.now(UTC) - started_at).total_seconds() * 1_000))


def _citations_from_data(value: Mapping[str, object]) -> list[Citation]:
    """从搜索工具的结构化来源中提取统一引用。"""

    sources = value.get("sources")
    if not isinstance(sources, list):
        return []
    citations: list[Citation] = []
    for source in sources:
        if not isinstance(source, Mapping):
            continue
        title = source.get("title")
        url = source.get("url")
        snippet = source.get("snippet", "")
        if isinstance(title, str) and isinstance(url, str):
            citations.append(
                Citation(
                    title=title[:500],
                    url=url[:2_000],
                    snippet=snippet[:1_000] if isinstance(snippet, str) else "",
                )
            )
    return citations


def connection_model(kind: str) -> ToolConnectionKind:
    """把 API 字符串转为严格枚举。"""

    try:
        return ToolConnectionKind(kind)
    except ValueError as error:
        raise ToolRuntimeError("CONNECTION_KIND_INVALID") from error


def grant_kind(kind: str) -> ResourceGrantKind:
    """把 API 字符串转为严格资源类型。"""

    try:
        return ResourceGrantKind(kind)
    except ValueError as error:
        raise ToolRuntimeError("RESOURCE_KIND_INVALID") from error


async def disconnect_connection(connection: ToolConnection, db: AsyncSession) -> None:
    """撤销连接但不触碰外部凭证。"""

    connection.status = ToolConnectionStatus.revoked
    await db.flush()


async def revoke_node(node: ExecutionNode, db: AsyncSession) -> None:
    """立即让节点停止接受任务。"""

    node.status = ExecutionNodeStatus.revoked
    node.pairing_code_hash = None
    node.pairing_expires_at = None
    await db.execute(
        update(ToolExecution)
        .where(
            ToolExecution.node_id == node.id,
            ToolExecution.status.in_({ToolExecutionStatus.queued, ToolExecutionStatus.waiting}),
        )
        .values(
            status=ToolExecutionStatus.cancelled,
            error_code="TOOL_NODE_REVOKED",
            error_message="执行节点已撤销",
            finished_at=datetime.now(UTC),
        )
    )
    await db.flush()


async def set_node_online(node: ExecutionNode, db: AsyncSession) -> None:
    """更新节点心跳和在线状态。"""

    node.status = ExecutionNodeStatus.online
    node.last_seen_at = datetime.now(UTC)
    await db.flush()
