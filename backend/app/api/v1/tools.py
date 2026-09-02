"""受控工具、MCP、Artifact 与本地执行节点 API。"""

from __future__ import annotations

import asyncio
import secrets
import uuid

from fastapi import APIRouter, HTTPException, Response, WebSocket, WebSocketDisconnect

from app.api.deps import DB, CurrentUser
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.tool_runtime import (
    Artifact,
    ExecutionNode,
    McpServer,
    ResourceGrant,
    ToolConnection,
    ToolExecution,
)
from app.schemas.tool_runtime import (
    ArtifactResponse,
    ExecutionNodePairRequest,
    ExecutionNodePairResponse,
    ExecutionNodeRegisterRequest,
    ExecutionNodeRegisterResponse,
    ExecutionNodeResponse,
    ExecutionNodeTokenRenewalRequest,
    ExecutionNodeTokenResponse,
    McpEnableToolsRequest,
    McpServerCreateRequest,
    McpServerResponse,
    McpToolExecuteRequest,
    ResourceGrantCreateRequest,
    ResourceGrantResponse,
    ToolCatalogResponse,
    ToolConnectionCreateRequest,
    ToolConnectionResponse,
    ToolExecuteRequest,
    ToolExecutionResponse,
)
from app.services.secret_store import TenantSecretStore
from app.services.tool_runtime_service import (
    ToolRuntimeError,
    ToolRuntimeService,
    artifact_download_url,
    verify_artifact_download_token,
    verify_node_challenge,
)

router = APIRouter(tags=["tools"])
runtime = ToolRuntimeService(secret_store=TenantSecretStore())


def _artifact_response(artifact: Artifact, user_id: uuid.UUID) -> ArtifactResponse:
    """把 Artifact ORM 转成鉴权下载地址。"""

    return ArtifactResponse(
        id=artifact.id,
        user_id=user_id,
        run_id=artifact.run_id,
        tool_execution_id=artifact.tool_execution_id,
        kind=artifact.kind.value,
        name=artifact.name,
        mime_type=artifact.mime_type,
        size_bytes=artifact.size_bytes,
        sha256=artifact.sha256,
        sensitivity=artifact.sensitivity,
        retention_policy=artifact.retention_policy,
        expires_at=artifact.expires_at,
        preview=artifact.preview_json,
        download_url=artifact_download_url(artifact.id, user_id),
        created_at=artifact.created_at,
    )


@router.get("/tools/catalog", response_model=list[ToolCatalogResponse])
async def list_tool_catalog(_current_user: CurrentUser) -> list[dict[str, object]]:
    """返回不含凭证的内置工具目录。"""

    return runtime.catalog()


@router.post("/tool-connections", response_model=ToolConnectionResponse, status_code=201)
async def create_tool_connection(
    req: ToolConnectionCreateRequest, current_user: CurrentUser, db: DB
) -> ToolConnection:
    """保存用户连接元数据，不接受也不记录明文 secret。"""

    try:
        return await runtime.create_connection(
            user_id=current_user.id,
            kind=req.kind,
            provider=req.provider,
            display_name=req.display_name,
            secret_ref=req.secret_ref,
            scopes=req.scopes,
            metadata=req.metadata,
            db=db,
        )
    except ToolRuntimeError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/tool-connections", response_model=list[ToolConnectionResponse])
async def list_tool_connections(current_user: CurrentUser, db: DB) -> list[ToolConnection]:
    """列出当前用户连接，永不跨租户返回。"""

    return await runtime.list_connections(user_id=current_user.id, db=db)


@router.delete("/tool-connections/{connection_id}", status_code=204)
async def delete_tool_connection(
    connection_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> Response:
    """撤销连接并保留审计记录。"""

    try:
        await runtime.revoke_connection(connection_id, user_id=current_user.id, db=db)
    except ToolRuntimeError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return Response(status_code=204)


@router.post("/tool-executions", response_model=ToolExecutionResponse, status_code=202)
async def create_tool_execution(
    req: ToolExecuteRequest, current_user: CurrentUser, db: DB
) -> ToolExecution:
    """登记并执行低风险工具；有副作用工具只进入 waiting，不会绕过审批。"""

    try:
        return await runtime.create_manual_execution(
            user_id=current_user.id,
            tool_name=req.tool_name,
            arguments=req.arguments,
            execution_location=req.execution_location,
            db=db,
            run_id=req.run_id,
            node_id=req.node_id,
            idempotency_key=req.idempotency_key,
        )
    except ToolRuntimeError as error:
        status_code = 404 if str(error) == "AGENT_RUN_NOT_FOUND" else 422
        raise HTTPException(status_code=status_code, detail=str(error)) from error


@router.get("/tool-executions", response_model=list[ToolExecutionResponse])
async def list_tool_executions(
    current_user: CurrentUser, db: DB, limit: int = 50
) -> list[ToolExecution]:
    """列出当前用户工具执行审计记录。"""

    return await runtime.list_executions(user_id=current_user.id, limit=limit, db=db)


@router.post("/tool-executions/{execution_id}/cancel", response_model=ToolExecutionResponse)
async def cancel_tool_execution(
    execution_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> ToolExecution:
    """取消尚未完成的执行；执行器在安全检查点读取此状态。"""

    try:
        return await runtime.cancel_execution(execution_id, user_id=current_user.id, db=db)
    except ToolRuntimeError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/artifacts", response_model=list[ArtifactResponse])
async def list_artifacts(current_user: CurrentUser, db: DB) -> list[ArtifactResponse]:
    """列出当前用户 Artifact 元数据。"""

    artifacts = await runtime.list_artifacts(user_id=current_user.id, db=db)
    return [_artifact_response(item, current_user.id) for item in artifacts]


@router.get("/artifacts/{artifact_id}", response_model=ArtifactResponse)
async def get_artifact(
    artifact_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> ArtifactResponse:
    """按租户返回 Artifact 详情。"""

    try:
        artifact = await runtime.get_artifact(artifact_id, user_id=current_user.id, db=db)
    except ToolRuntimeError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return _artifact_response(artifact, current_user.id)


@router.get("/artifacts/{artifact_id}/content")
async def download_artifact(
    artifact_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    expires: int | None = None,
    signature: str | None = None,
) -> Response:
    """鉴权读取 Artifact 内容，避免公开 storage key。"""

    if (
        expires is None
        or signature is None
        or not verify_artifact_download_token(artifact_id, current_user.id, expires, signature)
    ):
        raise HTTPException(status_code=403, detail="ARTIFACT_SIGNATURE_INVALID")
    try:
        artifact, content = await runtime.read_artifact_content(
            artifact_id, user_id=current_user.id, db=db
        )
    except ToolRuntimeError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return Response(
        content=content,
        media_type=artifact.mime_type,
        headers={"Content-Disposition": f'attachment; filename="{artifact.name}"'},
    )


@router.delete("/artifacts/{artifact_id}", status_code=204)
async def delete_artifact(artifact_id: uuid.UUID, current_user: CurrentUser, db: DB) -> Response:
    """删除当前用户的 Artifact 及其存储对象。"""

    try:
        await runtime.delete_artifact(artifact_id, user_id=current_user.id, db=db)
    except ToolRuntimeError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return Response(status_code=204)


@router.post("/execution-nodes/pair", response_model=ExecutionNodePairResponse, status_code=201)
async def pair_execution_node(
    req: ExecutionNodePairRequest, current_user: CurrentUser, db: DB
) -> ExecutionNodePairResponse:
    """创建仅显示一次的桌面节点配对挑战。"""

    node, code = await runtime.create_pairing(
        user_id=current_user.id,
        name=req.name,
        platform=req.platform,
        app_version=req.app_version,
        capabilities=req.capabilities,
        db=db,
    )
    await db.commit()
    await db.refresh(node)
    if node.pairing_expires_at is None:
        raise HTTPException(status_code=500, detail="Pairing challenge is incomplete")
    return ExecutionNodePairResponse(
        id=node.id,
        user_id=node.user_id,
        name=node.name,
        platform=node.platform,
        app_version=node.app_version,
        capabilities=node.capabilities,
        status=node.status.value,
        last_seen_at=node.last_seen_at,
        policy=node.policy,
        created_at=node.created_at,
        updated_at=node.updated_at,
        pairing_code=code,
        expires_at=node.pairing_expires_at,
    )


@router.post(
    "/execution-nodes/register",
    response_model=ExecutionNodeRegisterResponse,
    status_code=201,
)
async def register_execution_node(
    req: ExecutionNodeRegisterRequest, db: DB
) -> ExecutionNodeRegisterResponse:
    """使用一次性配对码登记 Desktop 节点。"""

    try:
        node, token, expires_at = await runtime.register_node(
            pairing_code=req.pairing_code,
            public_key=req.public_key,
            name=req.name,
            platform=req.platform,
            app_version=req.app_version,
            capabilities=req.capabilities,
            protocol_version=req.protocol_version,
            db=db,
        )
        await db.commit()
    except ToolRuntimeError as error:
        status_code = 426 if str(error) == "EXECUTION_NODE_UPDATE_REQUIRED" else 422
        raise HTTPException(status_code=status_code, detail=str(error)) from error
    return ExecutionNodeRegisterResponse(
        node_id=node.id,
        user_id=node.user_id,
        node_token=token,
        expires_at=expires_at,
        protocol_version=req.protocol_version,
    )


@router.post("/execution-nodes/token", response_model=ExecutionNodeTokenResponse)
async def renew_execution_node_token(
    req: ExecutionNodeTokenRenewalRequest, db: DB
) -> ExecutionNodeTokenResponse:
    """节点凭登记私钥签署旧令牌换取新的短期会话凭证。"""

    try:
        node, token, expires_at = await runtime.renew_node_token(
            node_id=req.node_id, token=req.token, signature=req.signature, db=db
        )
        await db.commit()
    except ToolRuntimeError as error:
        detail = str(error)
        if detail == "EXECUTION_NODE_REVOKED":
            status_code = 403
        elif detail == "EXECUTION_NODE_UPDATE_REQUIRED":
            status_code = 426
        else:
            status_code = 401
        raise HTTPException(status_code=status_code, detail=detail) from error
    return ExecutionNodeTokenResponse(
        node_id=node.id,
        node_token=token,
        expires_at=expires_at,
        protocol_version=settings.execution_node_protocol_version,
    )


@router.websocket("/execution-nodes/ws")
async def execution_node_socket(websocket: WebSocket, token: str) -> None:
    """为已登记节点提供 challenge、任务投递和结果确认通道。"""

    await websocket.accept()
    async with AsyncSessionLocal() as db:
        try:
            node = await runtime.authenticate_node(token, db=db)
        except ToolRuntimeError:
            await websocket.close(code=1008, reason="node authentication failed")
            return
        challenge = secrets.token_urlsafe(24)
        await websocket.send_json(
            {
                "type": "challenge",
                "challenge": challenge,
                "protocol_version": settings.execution_node_protocol_version,
            }
        )
        try:
            response = await asyncio.wait_for(
                websocket.receive_json(),
                timeout=max(1, settings.execution_node_challenge_timeout_seconds),
            )
        except (TimeoutError, ValueError, WebSocketDisconnect):
            await websocket.close(code=1008, reason="challenge timeout")
            return
        if (
            not isinstance(response, dict)
            or response.get("type") != "challenge_response"
            or not isinstance(response.get("signature"), str)
            or not verify_node_challenge(node, challenge, response["signature"])
        ):
            await websocket.close(code=1008, reason="challenge invalid")
            return
        await runtime.heartbeat_node(node.id, user_id=node.user_id, db=db)
        await db.commit()
        try:
            while True:
                for execution, message in await runtime.list_node_messages(node, db=db):
                    await websocket.send_json(message)
                    if message.get("type") == "job_offer":
                        await runtime.mark_node_offer_sent(execution, db=db)
                await db.commit()
                try:
                    incoming = await asyncio.wait_for(websocket.receive_json(), timeout=5)
                except TimeoutError:
                    continue
                if not isinstance(incoming, dict):
                    raise ToolRuntimeError("EXECUTION_NODE_MESSAGE_INVALID")
                response_message = await runtime.apply_node_message(node, incoming, db=db)
                await db.commit()
                await websocket.send_json(response_message)
        except WebSocketDisconnect:
            return
        except (ToolRuntimeError, ValueError, TypeError):
            await db.rollback()
            await websocket.close(code=1008, reason="node message rejected")


@router.get("/execution-nodes", response_model=list[ExecutionNodeResponse])
async def list_execution_nodes(current_user: CurrentUser, db: DB) -> list[ExecutionNode]:
    """列出当前用户桌面节点。"""

    return await runtime.list_nodes(user_id=current_user.id, db=db)


@router.post("/execution-nodes/{node_id}/heartbeat", response_model=ExecutionNodeResponse)
async def execution_node_heartbeat(
    node_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> ExecutionNode:
    """更新已登录用户节点的在线状态。"""

    try:
        return await runtime.heartbeat_node(node_id, user_id=current_user.id, db=db)
    except ToolRuntimeError as error:
        status_code = 409 if str(error) == "EXECUTION_NODE_REVOKED" else 404
        raise HTTPException(status_code=status_code, detail=str(error)) from error


@router.post("/execution-nodes/{node_id}/revoke", response_model=ExecutionNodeResponse)
async def revoke_execution_node(
    node_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> ExecutionNode:
    """撤销节点并使未执行任务失效。"""

    try:
        return await runtime.revoke_execution_node(node_id, user_id=current_user.id, db=db)
    except ToolRuntimeError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("/resource-grants", response_model=ResourceGrantResponse, status_code=201)
async def create_resource_grant(
    req: ResourceGrantCreateRequest, current_user: CurrentUser, db: DB
) -> ResourceGrant:
    """记录 Desktop 原生选择器授予的资源 ID，拒绝上传真实路径。"""

    try:
        return await runtime.create_resource_grant(
            user_id=current_user.id,
            node_id=req.node_id,
            kind=req.kind,
            resource_id=req.resource_id,
            display_name=req.display_name,
            scopes=req.scopes,
            db=db,
        )
    except ToolRuntimeError as error:
        status_code = 409 if str(error) == "EXECUTION_NODE_REVOKED" else 404
        raise HTTPException(status_code=status_code, detail=str(error)) from error


@router.get("/resource-grants", response_model=list[ResourceGrantResponse])
async def list_resource_grants(current_user: CurrentUser, db: DB) -> list[ResourceGrant]:
    """列出当前用户资源授权。"""

    return await runtime.list_resource_grants(user_id=current_user.id, db=db)


@router.post("/mcp-servers", response_model=McpServerResponse, status_code=201)
async def create_mcp_server(
    req: McpServerCreateRequest, current_user: CurrentUser, db: DB
) -> McpServer:
    """添加尚未发现 schema 的远程 MCP Server。"""

    try:
        return await runtime.create_mcp_server(
            user_id=current_user.id,
            name=req.name,
            transport=req.transport,
            endpoint_url=req.endpoint_url,
            command=req.command,
            command_args=req.command_args,
            connection_id=req.connection_id,
            db=db,
        )
    except ToolRuntimeError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/mcp-servers", response_model=list[McpServerResponse])
async def list_mcp_servers(current_user: CurrentUser, db: DB) -> list[McpServer]:
    """列出当前用户 MCP Server。"""

    return await runtime.list_mcp_servers(user_id=current_user.id, db=db)


@router.post("/mcp-servers/{server_id}/discover", response_model=McpServerResponse)
async def discover_mcp_server(server_id: uuid.UUID, current_user: CurrentUser, db: DB) -> McpServer:
    """发现 MCP schema；变更时自动暂停，避免静默扩大权限。"""

    try:
        return await runtime.discover_mcp_server(server_id, user_id=current_user.id, db=db)
    except ToolRuntimeError as error:
        status_code = 502 if str(error) in {"MCP_DISCOVERY_FAILED", "MCP_SCHEMA_INVALID"} else 404
        raise HTTPException(status_code=status_code, detail=str(error)) from error


@router.post("/mcp-servers/{server_id}/tools", response_model=McpServerResponse)
async def enable_mcp_tools(
    server_id: uuid.UUID,
    req: McpEnableToolsRequest,
    current_user: CurrentUser,
    db: DB,
) -> McpServer:
    """仅启用 schema 快照中用户明确选择的 MCP 工具。"""

    try:
        return await runtime.enable_mcp_tools(
            server_id,
            user_id=current_user.id,
            enabled_tools=req.enabled_tools,
            db=db,
        )
    except ToolRuntimeError as error:
        status_code = 422 if str(error) == "MCP_TOOL_NOT_VERIFIED" else 404
        raise HTTPException(status_code=status_code, detail=str(error)) from error


@router.post(
    "/mcp-servers/{server_id}/execute",
    response_model=ToolExecutionResponse,
    status_code=202,
)
async def execute_mcp_tool(
    server_id: uuid.UUID,
    req: McpToolExecuteRequest,
    current_user: CurrentUser,
    db: DB,
) -> ToolExecution:
    """调用明确启用的 MCP 工具；未声明只读的工具只登记为 waiting。"""

    try:
        return await runtime.create_mcp_execution(
            server_id,
            user_id=current_user.id,
            tool_name=req.tool_name,
            arguments=req.arguments,
            run_id=req.run_id,
            approval_id=req.approval_id,
            db=db,
        )
    except ToolRuntimeError as error:
        status_code = (
            404
            if str(error)
            in {"MCP_SERVER_NOT_FOUND", "MCP_TOOL_NOT_ENABLED", "MCP_TOOL_NOT_VERIFIED"}
            else 422
        )
        raise HTTPException(status_code=status_code, detail=str(error)) from error
