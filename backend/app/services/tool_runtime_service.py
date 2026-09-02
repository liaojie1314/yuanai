"""工具目录、执行审计、Artifact 和节点资源。"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import re
import secrets
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from pathlib import PurePosixPath
from typing import cast

import httpx
from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from jose import JWTError, jwt
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.agent_run import AgentRun
from app.models.approval import ApprovalRequest, ApprovalRiskLevel, ApprovalStatus
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
from app.services.agent.approval_service import ApprovalService, payload_hash, sanitize_arguments
from app.services.secret_store import SecretStore, SecretStoreUnavailableError
from app.services.storage_service import storage
from app.services.tools.mcp_stdio import (
    StdioMcpError,
    call_stdio_mcp,
    validate_secret_environment_name,
    validate_stdio_command,
)
from app.services.tools.web_security import (
    UrlPolicyError,
    create_pinned_http_transport,
    resolve_public_url,
    validate_public_url,
)
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
    ToolRisk,
    ToolSpec,
    ToolValidationError,
)
from app.tools.registry import ToolRegistry, validate_arguments_against_schema

_NAME_RE = re.compile(r"[^a-zA-Z0-9._-]+")


class ToolRuntimeError(RuntimeError):
    """Tool Runtime 可安全返回给 API 的领域错误。"""


def _canonical_json(value: Mapping[str, object]) -> bytes:
    """生成协议签名使用的稳定 JSON 字节。"""

    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )


def _node_encryption_key() -> bytes:
    """从部署密钥派生固定长度的 AES-GCM 密钥。"""

    source = settings.execution_node_encryption_key or settings.jwt_secret_key
    return hashlib.sha256(source.encode("utf-8")).digest()


def encode_public_key(key: Ed25519PublicKey) -> str:
    """以无填充 Base64 编码保存 Ed25519 公钥。"""

    from cryptography.hazmat.primitives import serialization

    raw = key.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_key(value: str) -> bytes:
    """解析节点发送的无填充 Base64 Ed25519 公钥。"""

    if not value or len(value) > 200:
        raise ValueError("invalid public key")
    padded = value + "=" * (-len(value) % 4)
    raw = base64.urlsafe_b64decode(padded.encode("ascii"))
    if len(raw) != 32:
        raise ValueError("invalid public key")
    return raw


def decode_signature(value: str) -> bytes:
    """解析协议消息中的无填充 Base64 签名。"""

    if not value or len(value) > 200:
        raise ValueError("invalid signature")
    padded = value + "=" * (-len(value) % 4)
    raw = base64.urlsafe_b64decode(padded.encode("ascii"))
    if len(raw) != 64:
        raise ValueError("invalid signature")
    return raw


def encrypt_execution_arguments(execution_id: uuid.UUID, arguments: Mapping[str, object]) -> str:
    """使用 AES-GCM 加密节点任务参数，并绑定 execution ID。"""

    nonce = secrets.token_bytes(12)
    ciphertext = AESGCM(_node_encryption_key()).encrypt(
        nonce,
        _canonical_json(arguments),
        str(execution_id).encode("ascii"),
    )
    return ".".join(
        base64.urlsafe_b64encode(part).decode("ascii").rstrip("=") for part in (nonce, ciphertext)
    )


def decrypt_execution_arguments(execution_id: uuid.UUID, value: str) -> dict[str, object]:
    """解密并校验绑定 execution ID 的节点任务参数。"""

    parts = value.split(".")
    if len(parts) != 2:
        raise ToolRuntimeError("TOOL_ARGUMENTS_UNAVAILABLE")
    try:
        decoded = []
        for part in parts:
            padded = part + "=" * (-len(part) % 4)
            decoded.append(base64.urlsafe_b64decode(padded.encode("ascii")))
        nonce, ciphertext = decoded
        plaintext = AESGCM(_node_encryption_key()).decrypt(
            nonce,
            ciphertext,
            str(execution_id).encode("ascii"),
        )
        result = json.loads(plaintext)
    except (InvalidTag, ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
        raise ToolRuntimeError("TOOL_ARGUMENTS_UNAVAILABLE") from error
    if not isinstance(result, dict):
        raise ToolRuntimeError("TOOL_ARGUMENTS_UNAVAILABLE")
    return cast(dict[str, object], result)


def create_node_token(node: ExecutionNode, *, expires_at: datetime) -> str:
    """为节点签发带版本号和协议版本的短期 JWT。"""

    return str(
        jwt.encode(
            {
                "sub": str(node.id),
                "user_id": str(node.user_id),
                "version": node.token_version,
                "protocol_version": settings.execution_node_protocol_version,
                "type": "execution_node",
                "exp": expires_at,
            },
            settings.jwt_secret_key,
            algorithm=settings.jwt_algorithm,
        )
    )


def sign_server_message(message: Mapping[str, object]) -> str:
    """签署服务端下发的不可变协议消息。"""

    signature = hmac.new(
        settings.jwt_secret_key.encode("utf-8"), _canonical_json(message), hashlib.sha256
    )
    return base64.urlsafe_b64encode(signature.digest()).decode("ascii").rstrip("=")


def verify_node_challenge(node: ExecutionNode, challenge: str, signature: str) -> bool:
    """验证节点私钥对一次性 challenge 的签名。"""

    if node.public_key is None or not challenge or len(challenge) > 200:
        return False
    try:
        key = Ed25519PublicKey.from_public_bytes(decode_key(node.public_key))
        key.verify(decode_signature(signature), challenge.encode("utf-8"))
    except (InvalidSignature, ValueError, TypeError, binascii.Error):
        return False
    return True


def _string_list(value: object) -> list[str]:
    """从 JSON 策略字段提取字符串列表。"""

    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


def create_artifact_download_token(
    artifact_id: uuid.UUID, user_id: uuid.UUID, *, expires_at: datetime
) -> str:
    """为指定租户的 Artifact 生成短期下载签名。"""

    expires = int(expires_at.timestamp())
    payload = f"{artifact_id}:{user_id}:{expires}".encode()
    return hmac.new(settings.jwt_secret_key.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def verify_artifact_download_token(
    artifact_id: uuid.UUID, user_id: uuid.UUID, expires: int, token: str
) -> bool:
    """校验 Artifact 下载签名、租户边界和有效期。"""

    if expires <= int(datetime.now(UTC).timestamp()) or not token:
        return False
    expected = create_artifact_download_token(
        artifact_id,
        user_id,
        expires_at=datetime.fromtimestamp(expires, tz=UTC),
    )
    return hmac.compare_digest(expected, token)


def artifact_download_url(artifact_id: uuid.UUID, user_id: uuid.UUID) -> str:
    """生成带有短期签名的内部 Artifact 下载地址。"""

    expires_at = datetime.now(UTC) + timedelta(
        seconds=max(1, settings.tool_artifact_url_ttl_seconds)
    )
    expires = int(expires_at.timestamp())
    token = create_artifact_download_token(artifact_id, user_id, expires_at=expires_at)
    return f"/api/v1/artifacts/{artifact_id}/content?expires={expires}&signature={token}"


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
        secret_store: SecretStore | None = None,
    ) -> None:
        self.registry = registry or build_phase6_registry()
        self._mcp_transport = mcp_transport
        self._secret_store = secret_store

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

        if (
            connection_model(kind) in {ToolConnectionKind.mcp_http, ToolConnectionKind.mcp_stdio}
            and secret_ref
        ):
            if self._secret_store is None:
                raise ToolRuntimeError("MCP_SECRET_UNAVAILABLE")
            try:
                self._secret_store.assert_ref_allowed(user_id, secret_ref)
            except SecretStoreUnavailableError as error:
                raise ToolRuntimeError("TOOL_SECRET_REF_INVALID") from error
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
        node_id: uuid.UUID | None = None,
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
            node_id=node_id,
            idempotency_key=idempotency_key,
        )
        spec = self.registry.get_spec(tool_name)
        if execution_location == "desktop":
            # 桌面任务由节点本地用户逐次确认，无需云端审批记录。
            execution.node_delivery_status = "pending"
        elif spec.risk_level.value == "read":
            await self.execute(execution, arguments=arguments, db=db)
        else:
            execution.status = ToolExecutionStatus.waiting
            execution.error_code = "TOOL_APPROVAL_REQUIRED"
            approval = await ApprovalService().create_tool_request(
                user_id=user_id,
                tool_execution_id=execution.id,
                tool_name=tool_name,
                arguments=arguments,
                risk_level=self._approval_risk(spec.risk_level),
                execution_location="cloud",
                action_summary=f"执行工具 {tool_name}",
                db=db,
            )
            execution.error_message = f"审批请求 {approval.id} 已创建"
        await db.commit()
        await db.refresh(execution)
        return execution

    async def resume_approved_execution(
        self,
        execution_id: uuid.UUID,
        *,
        user_id: uuid.UUID,
        db: AsyncSession,
    ) -> ToolExecution:
        """执行审批通过后已回到 queued 的云端工具；桌面与 MCP 执行由各自链路处理。"""

        execution = await db.scalar(
            select(ToolExecution).where(
                ToolExecution.id == execution_id,
                ToolExecution.user_id == user_id,
            )
        )
        if execution is None:
            raise ToolRuntimeError("TOOL_EXECUTION_NOT_FOUND")
        if execution.execution_location != "cloud":
            return execution
        if execution.status is not ToolExecutionStatus.queued:
            raise ToolRuntimeError("TOOL_EXECUTION_NOT_STARTABLE")
        if execution.arguments_encrypted is None:
            raise ToolRuntimeError("TOOL_ARGUMENTS_UNAVAILABLE")
        arguments = decrypt_execution_arguments(execution.id, execution.arguments_encrypted)
        return await self.execute(execution, arguments=arguments, db=db, approved=True)

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
            if execution.execution_location == "desktop" and execution.node_id is not None:
                execution.node_delivery_status = "cancel_pending"
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
        if artifact.expires_at is not None and artifact.expires_at <= datetime.now(UTC):
            raise ToolRuntimeError("ARTIFACT_EXPIRED")
        try:
            content = await storage.get_object(artifact.storage_key)
        except (OSError, KeyError, ValueError) as error:
            raise ToolRuntimeError("ARTIFACT_CONTENT_NOT_FOUND") from error
        return artifact, content

    async def delete_artifact(
        self, artifact_id: uuid.UUID, *, user_id: uuid.UUID, db: AsyncSession
    ) -> None:
        """删除当前租户的 Artifact 及其对象存储内容。"""

        artifact = await self.get_artifact(artifact_id, user_id=user_id, db=db)
        try:
            await storage.delete(artifact.storage_key)
        except (OSError, KeyError, ValueError) as error:
            raise ToolRuntimeError("ARTIFACT_DELETE_FAILED") from error
        await db.delete(artifact)
        await db.commit()

    async def purge_expired_artifacts(
        self, *, db: AsyncSession, now: datetime | None = None, limit: int = 100
    ) -> int:
        """删除已过期 Artifact，存储删除失败时保留记录供下次重试。"""

        current_time = now or datetime.now(UTC)
        artifacts = list(
            (
                await db.scalars(
                    select(Artifact)
                    .where(Artifact.expires_at.is_not(None), Artifact.expires_at <= current_time)
                    .order_by(Artifact.expires_at.asc())
                    .limit(max(1, min(limit, 500)))
                )
            ).all()
        )
        removed = 0
        for artifact in artifacts:
            try:
                await storage.delete(artifact.storage_key)
            except (OSError, KeyError, ValueError):
                continue
            await db.delete(artifact)
            removed += 1
        if removed:
            await db.commit()
        return removed

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
        transport: str = "streamable_http",
        endpoint_url: str | None = None,
        command: str | None = None,
        command_args: list[str] | None = None,
        connection_id: uuid.UUID,
        db: AsyncSession,
    ) -> McpServer:
        """添加尚未验证 schema 的远程 HTTP 或受控 stdio MCP Server。"""

        if transport == "streamable_http":
            if endpoint_url is None or command is not None or command_args:
                raise ToolRuntimeError("MCP_ENDPOINT_INVALID")
            try:
                endpoint = validate_public_url(endpoint_url)
            except UrlPolicyError as error:
                raise ToolRuntimeError("MCP_ENDPOINT_INVALID") from error
            connection_kind = ToolConnectionKind.mcp_http
        elif transport == "stdio":
            if endpoint_url is not None or command is None:
                raise ToolRuntimeError("MCP_STDIO_CONFIG_INVALID")
            try:
                validate_stdio_command(command, command_args or [])
            except StdioMcpError as error:
                raise ToolRuntimeError(str(error)) from error
            endpoint = None
            connection_kind = ToolConnectionKind.mcp_stdio
        else:
            raise ToolRuntimeError("MCP_TRANSPORT_INVALID")
        connection = await db.scalar(
            select(ToolConnection).where(
                ToolConnection.id == connection_id,
                ToolConnection.user_id == user_id,
                ToolConnection.kind == connection_kind,
                ToolConnection.status == ToolConnectionStatus.active,
            )
        )
        if connection is None:
            raise ToolRuntimeError("MCP_CONNECTION_NOT_FOUND")
        server = McpServer(
            user_id=user_id,
            name=name,
            endpoint_url=endpoint,
            command=command,
            command_args=list(command_args or []),
            connection_id=connection.id,
            transport=transport,
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
        if server.connection_id is None:
            raise ToolRuntimeError("MCP_CONNECTION_NOT_FOUND")
        try:
            connection = await self._mcp_connection(server, user_id=user_id, db=db)
            if server.transport == "stdio":
                if server.command is None:
                    raise ToolRuntimeError("MCP_STDIO_CONFIG_INVALID")
                payload_value = {
                    "result": await call_stdio_mcp(
                        server.command,
                        server.command_args,
                        method="tools/list",
                        params={},
                        environment=await self._stdio_environment(connection, user_id=user_id),
                    )
                }
            else:
                if server.endpoint_url is None:
                    raise ToolRuntimeError("MCP_ENDPOINT_INVALID")
                if self._mcp_transport is None:
                    endpoint, address = resolve_public_url(server.endpoint_url)
                else:
                    endpoint = validate_public_url(server.endpoint_url)
                    address = None
                headers = await self._mcp_headers(connection, user_id=user_id)
                async with self._mcp_client(endpoint, address=address) as client:
                    response = await client.post(
                        endpoint,
                        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
                        headers={"Accept": "application/json, text/event-stream", **headers},
                    )
                    if response.is_redirect:
                        raise ToolRuntimeError("MCP_REDIRECT_BLOCKED")
                    response.raise_for_status()
                    payload_value = response.json()
        except (httpx.HTTPError, StdioMcpError, TimeoutError, ValueError) as error:
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
        run_id: uuid.UUID | None = None,
        approval_id: uuid.UUID | None = None,
        db: AsyncSession,
    ) -> ToolExecution:
        """调用已启用的 MCP 工具，副作用调用必须消费同一审批记录。"""

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
        if run_id is not None:
            run = await db.scalar(
                select(AgentRun).where(AgentRun.id == run_id, AgentRun.user_id == user_id)
            )
            if run is None:
                raise ToolRuntimeError("AGENT_RUN_NOT_FOUND")
        connection = await self._mcp_connection(server, user_id=user_id, db=db)
        execution: ToolExecution | None = None
        if approval_id is not None:
            approval = await db.scalar(
                select(ApprovalRequest).where(
                    ApprovalRequest.id == approval_id,
                    ApprovalRequest.user_id == user_id,
                    ApprovalRequest.tool_execution_id.is_not(None),
                    ApprovalRequest.tool_name == tool_name,
                )
            )
            if approval is None or approval.tool_execution_id is None:
                raise ToolRuntimeError("MCP_APPROVAL_NOT_FOUND")
            execution = await db.scalar(
                select(ToolExecution).where(
                    ToolExecution.id == approval.tool_execution_id,
                    ToolExecution.user_id == user_id,
                    ToolExecution.mcp_server_id == server.id,
                    ToolExecution.tool_name == tool_name,
                    ToolExecution.arguments_hash == payload_hash(validated_arguments),
                )
            )
            if execution is None:
                raise ToolRuntimeError("MCP_EXECUTION_NOT_FOUND")
            if approval.status is not ApprovalStatus.approved:
                raise ToolRuntimeError("MCP_APPROVAL_NOT_READY")
            try:
                await ApprovalService().authorize_execution(
                    approval.id,
                    user_id=user_id,
                    tool_name=tool_name,
                    arguments=validated_arguments,
                    execution_location="mcp_remote",
                    db=db,
                )
            except RuntimeError as error:
                raise ToolRuntimeError("MCP_APPROVAL_NOT_READY") from error
            execution.status = ToolExecutionStatus.queued
            execution.error_code = None
            execution.error_message = None
        else:
            execution = ToolExecution(
                user_id=user_id,
                run_id=run_id,
                tool_name=tool_name,
                tool_version="mcp-1.0.0",
                execution_location="mcp_remote",
                mcp_server_id=server.id,
                connection_id=connection.id if connection is not None else None,
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
                execution.error_message = "MCP 工具未声明只读，需要审批"
                approval = await ApprovalService().create_tool_request(
                    user_id=user_id,
                    tool_execution_id=execution.id,
                    tool_name=tool_name,
                    arguments=validated_arguments,
                    risk_level="high",
                    execution_location="mcp_remote",
                    action_summary=f"执行 MCP 工具 {tool_name}",
                    db=db,
                )
                execution.error_message = f"审批请求 {approval.id} 已创建"
                await db.commit()
                await db.refresh(execution)
                return execution

        try:
            if server.transport == "stdio":
                if server.command is None:
                    raise ToolRuntimeError("MCP_STDIO_CONFIG_INVALID")
                payload_value = {
                    "result": await call_stdio_mcp(
                        server.command,
                        server.command_args,
                        method="tools/call",
                        params={"name": tool_name, "arguments": validated_arguments},
                        environment=await self._stdio_environment(connection, user_id=user_id),
                    )
                }
            else:
                if server.endpoint_url is None:
                    raise ToolRuntimeError("MCP_ENDPOINT_INVALID")
                if self._mcp_transport is None:
                    endpoint, address = resolve_public_url(server.endpoint_url)
                else:
                    endpoint = validate_public_url(server.endpoint_url)
                    address = None
                headers = await self._mcp_headers(connection, user_id=user_id)
                async with self._mcp_client(endpoint, address=address) as client:
                    response = await client.post(
                        endpoint,
                        json={
                            "jsonrpc": "2.0",
                            "id": str(execution.id),
                            "method": "tools/call",
                            "params": {"name": tool_name, "arguments": validated_arguments},
                        },
                        headers={"Accept": "application/json, text/event-stream", **headers},
                    )
                    if response.is_redirect:
                        raise ToolRuntimeError("MCP_REDIRECT_BLOCKED")
                    response.raise_for_status()
                    payload_value = response.json()
        except ToolRuntimeError:
            raise
        except (httpx.HTTPError, StdioMcpError, TimeoutError, ValueError, UrlPolicyError) as error:
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

    async def _mcp_connection(
        self, server: McpServer, *, user_id: uuid.UUID, db: AsyncSession
    ) -> ToolConnection | None:
        """读取与 MCP Server 同租户的活动连接。"""

        if server.connection_id is None:
            return None
        connection = await db.scalar(
            select(ToolConnection).where(
                ToolConnection.id == server.connection_id,
                ToolConnection.user_id == user_id,
                ToolConnection.kind
                == (
                    ToolConnectionKind.mcp_stdio
                    if server.transport == "stdio"
                    else ToolConnectionKind.mcp_http
                ),
                ToolConnection.status == ToolConnectionStatus.active,
            )
        )
        if connection is None:
            raise ToolRuntimeError("MCP_CONNECTION_NOT_FOUND")
        return connection

    async def _stdio_environment(
        self, connection: ToolConnection | None, *, user_id: uuid.UUID
    ) -> dict[str, str]:
        """只向 stdio 子进程注入租户绑定的单个 Secret 环境变量。"""

        if connection is None or connection.secret_ref is None:
            return {}
        if self._secret_store is None:
            raise ToolRuntimeError("MCP_SECRET_UNAVAILABLE")
        try:
            secret = await self._secret_store.get(user_id, connection.secret_ref)
        except SecretStoreUnavailableError as error:
            raise ToolRuntimeError("MCP_SECRET_UNAVAILABLE") from error
        if not secret:
            raise ToolRuntimeError("MCP_SECRET_UNAVAILABLE")
        name = connection.metadata_json.get("secret_env_name", "MCP_AUTH_TOKEN")
        if not isinstance(name, str):
            raise ToolRuntimeError("MCP_AUTH_CONFIG_INVALID")
        try:
            validate_secret_environment_name(name)
        except StdioMcpError as error:
            raise ToolRuntimeError("MCP_AUTH_CONFIG_INVALID") from error
        return {name: secret}

    async def _mcp_headers(
        self, connection: ToolConnection | None, *, user_id: uuid.UUID
    ) -> dict[str, str]:
        """从租户绑定 SecretStore 解析请求头，不把 secret 写入审计。"""

        if connection is None or connection.secret_ref is None:
            return {}
        if self._secret_store is None:
            raise ToolRuntimeError("MCP_SECRET_UNAVAILABLE")
        try:
            secret = await self._secret_store.get(user_id, connection.secret_ref)
        except SecretStoreUnavailableError as error:
            raise ToolRuntimeError("MCP_SECRET_UNAVAILABLE") from error
        if not secret:
            raise ToolRuntimeError("MCP_SECRET_UNAVAILABLE")
        header_name = connection.metadata_json.get("auth_header", "Authorization")
        auth_prefix = connection.metadata_json.get("auth_prefix", "Bearer ")
        if not isinstance(header_name, str) or not isinstance(auth_prefix, str):
            raise ToolRuntimeError("MCP_AUTH_CONFIG_INVALID")
        if header_name not in {"Authorization", "X-API-Key", "api-key"}:
            raise ToolRuntimeError("MCP_AUTH_CONFIG_INVALID")
        return {header_name: f"{auth_prefix}{secret}"}

    def _mcp_client(self, endpoint_url: str, *, address: str | None = None) -> httpx.AsyncClient:
        """创建 MCP HTTP 客户端，生产请求使用校验阶段的固定 DNS 地址。"""

        if self._mcp_transport is not None:
            return httpx.AsyncClient(
                timeout=15,
                follow_redirects=False,
                transport=self._mcp_transport,
            )
        if address is None:
            raise ToolRuntimeError("MCP_ENDPOINT_INVALID")
        return httpx.AsyncClient(
            timeout=15,
            follow_redirects=False,
            transport=create_pinned_http_transport(address),
            trust_env=False,
        )

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
        node_id: uuid.UUID | None = None,
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
        node: ExecutionNode | None = None
        if execution_location == "desktop":
            if node_id is None:
                raise ToolRuntimeError("EXECUTION_NODE_REQUIRED")
            node = await self.get_node(node_id, user_id=user_id, db=db)
            self._validate_node_tool(node, tool_name)
        elif node_id is not None:
            raise ToolRuntimeError("EXECUTION_NODE_NOT_ALLOWED")
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
                if existing.node_id != node_id or existing.execution_location != execution_location:
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
            arguments_encrypted=None,
            arguments_hash=argument_hash,
            idempotency_key=idempotency_key,
            node_id=node.id if node is not None else None,
            status=ToolExecutionStatus.queued,
            artifact_ids=[],
        )
        db.add(execution)
        await db.flush()
        execution.arguments_encrypted = encrypt_execution_arguments(
            execution.id, validated_arguments
        )
        await db.flush()
        return execution

    async def start_execution(self, execution: ToolExecution, *, db: AsyncSession) -> None:
        """将已获准的审计记录切换为运行中，保留开始时间。"""

        if execution.status not in {ToolExecutionStatus.queued, ToolExecutionStatus.waiting}:
            raise ToolRuntimeError("TOOL_EXECUTION_NOT_STARTABLE")
        started_at = datetime.now(UTC)
        result = await db.execute(
            update(ToolExecution)
            .where(
                ToolExecution.id == execution.id,
                ToolExecution.status.in_({ToolExecutionStatus.queued, ToolExecutionStatus.waiting}),
            )
            .values(status=ToolExecutionStatus.running, started_at=started_at)
            .returning(ToolExecution.id)
        )
        if result.scalar_one_or_none() is None:
            await db.refresh(execution)
            raise ToolRuntimeError("TOOL_EXECUTION_NOT_STARTABLE")
        execution.status = ToolExecutionStatus.running
        execution.started_at = started_at
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
        if (
            execution.status is ToolExecutionStatus.queued
            and spec.risk_level.value != "read"
            and not approved
        ):
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
            policy={
                "allowed_tools": sorted(set(capabilities)),
                "allowed_resource_ids": [],
            },
            pairing_code_hash=hashlib.sha256(code.encode()).hexdigest(),
            pairing_expires_at=now + timedelta(minutes=10),
        )
        db.add(node)
        await db.flush()
        return node, code

    async def register_node(
        self,
        *,
        pairing_code: str,
        public_key: str,
        name: str,
        platform: str,
        app_version: str,
        capabilities: list[str],
        protocol_version: str,
        db: AsyncSession,
    ) -> tuple[ExecutionNode, str, datetime]:
        """用一次性配对码登记节点公钥并签发短期节点令牌。"""

        if protocol_version != settings.execution_node_protocol_version:
            raise ToolRuntimeError("EXECUTION_NODE_UPDATE_REQUIRED")
        try:
            normalized_key = encode_public_key(
                Ed25519PublicKey.from_public_bytes(decode_key(public_key))
            )
        except (ValueError, TypeError, binascii.Error) as error:
            raise ToolRuntimeError("EXECUTION_NODE_PUBLIC_KEY_INVALID") from error
        now = datetime.now(UTC)
        node = await db.scalar(
            select(ExecutionNode)
            .where(
                ExecutionNode.pairing_code_hash
                == hashlib.sha256(pairing_code.encode()).hexdigest(),
                ExecutionNode.pairing_expires_at.is_not(None),
                ExecutionNode.pairing_expires_at > now,
                ExecutionNode.status != ExecutionNodeStatus.revoked,
            )
            .with_for_update()
        )
        if node is None or node.public_key is not None:
            raise ToolRuntimeError("EXECUTION_NODE_PAIRING_INVALID")
        if (node.name, node.platform, node.app_version) != (name, platform, app_version):
            raise ToolRuntimeError("EXECUTION_NODE_METADATA_MISMATCH")
        node.public_key = normalized_key
        node.capabilities = sorted(set(capabilities))[:100]
        node.pairing_code_hash = None
        node.pairing_expires_at = None
        node.policy = {
            "allowed_tools": sorted(
                set(_string_list(node.policy.get("allowed_tools"))) & set(node.capabilities)
            ),
            "allowed_resource_ids": _string_list(node.policy.get("allowed_resource_ids")),
        }
        expires_at = now + timedelta(minutes=max(1, settings.execution_node_token_expire_minutes))
        token = create_node_token(node, expires_at=expires_at)
        await db.flush()
        return node, token, expires_at

    async def authenticate_node(self, token: str, *, db: AsyncSession) -> ExecutionNode:
        """校验节点令牌、版本和撤销状态。"""

        try:
            payload = cast(
                dict[str, object],
                jwt.decode(
                    token,
                    settings.jwt_secret_key,
                    algorithms=[settings.jwt_algorithm],
                ),
            )
            if payload.get("type") != "execution_node":
                raise ValueError("wrong token type")
            node_id = uuid.UUID(str(payload["sub"]))
            raw_token_version = payload["version"]
            if isinstance(raw_token_version, bool) or not isinstance(raw_token_version, int):
                raise ValueError("invalid token version")
            token_version = raw_token_version
        except (JWTError, KeyError, TypeError, ValueError) as error:
            raise ToolRuntimeError("EXECUTION_NODE_TOKEN_INVALID") from error
        node = await db.scalar(select(ExecutionNode).where(ExecutionNode.id == node_id))
        if node is None or node.public_key is None:
            raise ToolRuntimeError("EXECUTION_NODE_TOKEN_INVALID")
        if node.status is ExecutionNodeStatus.revoked or node.token_version != token_version:
            raise ToolRuntimeError("EXECUTION_NODE_REVOKED")
        if payload.get("protocol_version") != settings.execution_node_protocol_version:
            raise ToolRuntimeError("EXECUTION_NODE_UPDATE_REQUIRED")
        return node

    async def renew_node_token(
        self,
        *,
        node_id: uuid.UUID,
        token: str,
        signature: str,
        db: AsyncSession,
    ) -> tuple[ExecutionNode, str, datetime]:
        """校验节点登记私钥对旧令牌的签名后签发新令牌。

        过期令牌允许参与续期：信任根是登记私钥而非令牌时效；令牌版本与撤销
        状态仍必须与数据库一致，版本不匹配按撤销处理。
        """

        node = await db.scalar(select(ExecutionNode).where(ExecutionNode.id == node_id))
        if node is None or node.public_key is None:
            raise ToolRuntimeError("EXECUTION_NODE_TOKEN_INVALID")
        if node.status is ExecutionNodeStatus.revoked:
            raise ToolRuntimeError("EXECUTION_NODE_REVOKED")
        try:
            payload = cast(
                dict[str, object],
                jwt.decode(
                    token,
                    settings.jwt_secret_key,
                    algorithms=[settings.jwt_algorithm],
                    options={"verify_exp": False},
                ),
            )
            if payload.get("type") != "execution_node" or str(payload.get("sub")) != str(node.id):
                raise ValueError("token does not belong to node")
            raw_token_version = payload["version"]
            if isinstance(raw_token_version, bool) or not isinstance(raw_token_version, int):
                raise ValueError("invalid token version")
            if raw_token_version != node.token_version:
                raise ToolRuntimeError("EXECUTION_NODE_REVOKED")
            if payload.get("protocol_version") != settings.execution_node_protocol_version:
                raise ToolRuntimeError("EXECUTION_NODE_UPDATE_REQUIRED")
        except ToolRuntimeError:
            raise
        except (JWTError, KeyError, TypeError, ValueError) as error:
            raise ToolRuntimeError("EXECUTION_NODE_TOKEN_INVALID") from error
        signed_payload: dict[str, object] = {
            "type": "token_renewal",
            "node_id": str(node.id),
            "token": token,
        }
        try:
            public_key = Ed25519PublicKey.from_public_bytes(decode_key(node.public_key))
            public_key.verify(decode_signature(signature), _canonical_json(signed_payload))
        except (InvalidSignature, ValueError, TypeError, binascii.Error) as error:
            raise ToolRuntimeError("EXECUTION_NODE_SIGNATURE_INVALID") from error
        expires_at = datetime.now(UTC) + timedelta(
            minutes=max(1, settings.execution_node_token_expire_minutes)
        )
        return node, create_node_token(node, expires_at=expires_at), expires_at

    def _validate_node_tool(self, node: ExecutionNode, tool_name: str) -> None:
        """确认节点声明并获准执行指定工具。"""

        allowed_tools = node.policy.get("allowed_tools", [])
        if not isinstance(allowed_tools, list) or tool_name not in allowed_tools:
            raise ToolRuntimeError("EXECUTION_NODE_TOOL_NOT_ALLOWED")
        if tool_name not in node.capabilities:
            raise ToolRuntimeError("EXECUTION_NODE_CAPABILITY_MISSING")

    async def list_node_messages(
        self, node: ExecutionNode, *, db: AsyncSession
    ) -> list[tuple[ToolExecution, dict[str, object]]]:
        """返回节点尚未接收或确认的任务消息。"""

        executions = list(
            (
                await db.scalars(
                    select(ToolExecution)
                    .where(
                        ToolExecution.node_id == node.id,
                        ToolExecution.status.in_(
                            {
                                ToolExecutionStatus.queued,
                                ToolExecutionStatus.running,
                                ToolExecutionStatus.succeeded,
                                ToolExecutionStatus.failed,
                                ToolExecutionStatus.cancelled,
                            }
                        ),
                    )
                    .order_by(ToolExecution.created_at.asc())
                    # 节点网关是长会话；取消等状态由其他会话提交，
                    # 必须以数据库最新行为准刷新身份映射中的旧对象。
                    .execution_options(populate_existing=True)
                )
            ).all()
        )
        messages: list[tuple[ToolExecution, dict[str, object]]] = []
        stale_delivery_before = datetime.now(UTC) - timedelta(
            seconds=max(1, settings.execution_node_job_offer_ttl_seconds)
        )
        for execution in executions:
            if (
                execution.status
                in {
                    ToolExecutionStatus.succeeded,
                    ToolExecutionStatus.failed,
                }
                and execution.node_acknowledged_at is None
            ):
                messages.append(
                    (
                        execution,
                        {
                            "type": "result_replay_request",
                            "execution_id": str(execution.id),
                            "status": execution.status.value,
                        },
                    )
                )
                continue
            if execution.status is ToolExecutionStatus.cancelled:
                if execution.node_delivery_status == "cancel_pending":
                    messages.append(
                        (
                            execution,
                            {"type": "cancel_request", "execution_id": str(execution.id)},
                        )
                    )
                continue
            if execution.status is ToolExecutionStatus.queued:
                claimed = await db.execute(
                    update(ToolExecution)
                    .where(
                        ToolExecution.id == execution.id,
                        ToolExecution.node_id == node.id,
                        ToolExecution.status == ToolExecutionStatus.queued,
                        or_(
                            ToolExecution.node_delivery_status.is_(None),
                            ToolExecution.node_delivery_status != "sent",
                            ToolExecution.node_last_delivered_at < stale_delivery_before,
                        ),
                    )
                    .values(
                        node_delivery_status="sent",
                        node_last_delivered_at=datetime.now(UTC),
                    )
                    .returning(ToolExecution.id)
                )
                if claimed.scalar_one_or_none() is None:
                    continue
                execution.node_delivery_status = "sent"
                messages.append((execution, self.build_job_offer(execution, node=node)))
            elif execution.status is ToolExecutionStatus.running:
                messages.append(
                    (
                        execution,
                        {
                            "type": "job_status",
                            "execution_id": str(execution.id),
                            "status": execution.status.value,
                        },
                    )
                )
        return messages

    async def mark_node_offer_sent(self, execution: ToolExecution, *, db: AsyncSession) -> None:
        """记录任务已投递，重连时仍可由执行 ID 恢复。"""

        execution.node_delivery_status = "sent"
        execution.node_last_delivered_at = datetime.now(UTC)
        await db.flush()

    def build_job_offer(
        self, execution: ToolExecution, *, node: ExecutionNode
    ) -> dict[str, object]:
        """构造带服务端完整性签名的节点任务消息。"""

        if execution.arguments_encrypted is None:
            raise ToolRuntimeError("TOOL_ARGUMENTS_UNAVAILABLE")
        arguments = decrypt_execution_arguments(execution.id, execution.arguments_encrypted)
        expires_at = datetime.now(UTC) + timedelta(
            seconds=max(1, settings.execution_node_job_offer_ttl_seconds)
        )
        message: dict[str, object] = {
            "type": "job_offer",
            "protocol_version": settings.execution_node_protocol_version,
            "execution_id": str(execution.id),
            "tool_name": execution.tool_name,
            "tool_version": execution.tool_version,
            "arguments": arguments,
            "arguments_preview": execution.arguments_preview,
            "policy": node.policy,
            "expires_at": expires_at.isoformat(),
        }
        message["signature"] = sign_server_message(message)
        return message

    async def apply_node_message(
        self,
        node: ExecutionNode,
        message: Mapping[str, object],
        *,
        db: AsyncSession,
    ) -> dict[str, object]:
        """校验并应用节点的接受、进度和终态回传。"""

        message_type = message.get("type")
        if message_type == "heartbeat":
            await set_node_online(node, db)
            return {"type": "heartbeat_ack", "timestamp": datetime.now(UTC).isoformat()}
        if message_type == "ack":
            execution_id = message.get("execution_id")
            if not isinstance(execution_id, str):
                raise ToolRuntimeError("EXECUTION_NODE_MESSAGE_INVALID")
            try:
                parsed_id = uuid.UUID(execution_id)
            except ValueError as error:
                raise ToolRuntimeError("EXECUTION_NODE_MESSAGE_INVALID") from error
            await self.acknowledge_node_result(parsed_id, node_id=node.id, db=db)
            return {"type": "acknowledged", "execution_id": execution_id}
        execution_id = message.get("execution_id")
        if not isinstance(execution_id, str):
            raise ToolRuntimeError("EXECUTION_NODE_MESSAGE_INVALID")
        try:
            execution_uuid = uuid.UUID(execution_id)
        except ValueError as error:
            raise ToolRuntimeError("EXECUTION_NODE_MESSAGE_INVALID") from error
        execution = await db.scalar(
            select(ToolExecution).where(
                ToolExecution.id == execution_uuid,
                ToolExecution.node_id == node.id,
            )
        )
        if execution is None:
            raise ToolRuntimeError("TOOL_EXECUTION_NOT_FOUND")
        await set_node_online(node, db)
        if message_type == "accepted":
            if execution.status is ToolExecutionStatus.queued:
                await self.start_execution(execution, db=db)
            if execution.status is not ToolExecutionStatus.running:
                raise ToolRuntimeError("TOOL_EXECUTION_NOT_STARTABLE")
            execution.node_delivery_status = "accepted"
            await db.flush()
            return {"type": "accepted_ack", "execution_id": execution_id}
        if message_type == "rejected":
            if execution.status not in {ToolExecutionStatus.queued, ToolExecutionStatus.running}:
                raise ToolRuntimeError("TOOL_EXECUTION_NOT_STARTABLE")
            await self.fail_execution(
                execution,
                code="TOOL_NODE_REJECTED",
                message="Desktop 节点拒绝执行任务",
                db=db,
            )
            execution.node_delivery_status = "result_pending_ack"
            return {"type": "rejected_ack", "execution_id": execution_id}
        if message_type == "progress":
            progress = message.get("progress")
            if (
                execution.status not in {ToolExecutionStatus.queued, ToolExecutionStatus.running}
                or isinstance(progress, bool)
                or not isinstance(progress, int)
                or not 0 <= progress <= 100
            ):
                raise ToolRuntimeError("EXECUTION_NODE_MESSAGE_INVALID")
            execution.node_progress = progress
            execution.node_delivery_status = "running"
            await db.flush()
            return {"type": "progress_ack", "execution_id": execution_id, "progress": progress}
        if message_type not in {"completed", "failed", "cancelled"}:
            raise ToolRuntimeError("EXECUTION_NODE_MESSAGE_INVALID")
        self._verify_node_result(node, execution, message)
        if execution.status in {
            ToolExecutionStatus.succeeded,
            ToolExecutionStatus.failed,
            ToolExecutionStatus.cancelled,
        }:
            return {"type": "ack", "execution_id": execution_id}
        if execution.status is not ToolExecutionStatus.running:
            raise ToolRuntimeError("TOOL_EXECUTION_NOT_STARTABLE")
        if message_type == "completed":
            result = message.get("result")
            if not isinstance(result, (dict, list)):
                raise ToolRuntimeError("EXECUTION_NODE_RESULT_INVALID")
            await self.complete_success(execution, output=result, db=db)
        elif message_type == "cancelled":
            execution.status = ToolExecutionStatus.cancelled
            execution.error_code = "TOOL_CANCELLED"
            execution.error_message = "Desktop 节点取消了任务"
            execution.finished_at = datetime.now(UTC)
            execution.result_json = _tool_result_payload(
                ToolResult(
                    status="cancelled",
                    summary="工具执行已取消",
                    error=ToolErrorPayload(code="TOOL_CANCELLED", message="工具执行已取消"),
                )
            )
        else:
            await self.fail_execution(
                execution,
                code=str(message.get("error_code") or "TOOL_NODE_FAILED")[:100],
                message="Desktop 节点执行失败",
                db=db,
            )
        execution.node_delivery_status = "result_pending_ack"
        execution.node_acknowledged_at = None
        await db.flush()
        return {"type": "ack", "execution_id": execution_id}

    async def acknowledge_node_result(
        self, execution_id: uuid.UUID, *, node_id: uuid.UUID, db: AsyncSession
    ) -> None:
        """确认节点已收到终态 ACK；未确认结果会在重连时请求重发。"""

        execution = await db.scalar(
            select(ToolExecution).where(
                ToolExecution.id == execution_id,
                ToolExecution.node_id == node_id,
            )
        )
        if execution is None:
            raise ToolRuntimeError("TOOL_EXECUTION_NOT_FOUND")
        if execution.status not in {
            ToolExecutionStatus.succeeded,
            ToolExecutionStatus.failed,
            ToolExecutionStatus.cancelled,
        }:
            raise ToolRuntimeError("TOOL_EXECUTION_NOT_TERMINAL")
        execution.node_acknowledged_at = datetime.now(UTC)
        execution.node_delivery_status = "acknowledged"
        await db.flush()

    def _verify_node_result(
        self,
        node: ExecutionNode,
        execution: ToolExecution,
        message: Mapping[str, object],
    ) -> None:
        """验证节点使用登记公钥签名的结果，并限制回传大小。"""

        signature = message.get("signature")
        if not isinstance(signature, str):
            raise ToolRuntimeError("EXECUTION_NODE_SIGNATURE_INVALID")
        result = message.get("result")
        error_code = message.get("error_code")
        error_message = message.get("error_message")
        signed_payload: dict[str, object] = {
            "type": message.get("type"),
            "execution_id": str(execution.id),
            "result": result,
            "error_code": error_code,
            "error_message": error_message,
            "progress": message.get("progress"),
        }
        encoded_result = _canonical_json(signed_payload)
        if len(encoded_result) > max(1, settings.execution_node_result_max_bytes):
            raise ToolRuntimeError("EXECUTION_NODE_RESULT_TOO_LARGE")
        try:
            public_key = Ed25519PublicKey.from_public_bytes(decode_key(node.public_key or ""))
            public_key.verify(decode_signature(signature), encoded_result)
        except (InvalidSignature, ValueError, TypeError, binascii.Error) as error:
            raise ToolRuntimeError("EXECUTION_NODE_SIGNATURE_INVALID") from error


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
    node.token_version += 1
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
