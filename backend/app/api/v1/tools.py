"""受控工具、MCP、Artifact 与本地执行节点 API。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Response

from app.api.deps import DB, CurrentUser
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
    ExecutionNodeResponse,
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
from app.services.tool_runtime_service import ToolRuntimeError, ToolRuntimeService

router = APIRouter(tags=["tools"])
runtime = ToolRuntimeService()


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
        download_url=f"/api/v1/artifacts/{artifact.id}/content",
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
async def download_artifact(artifact_id: uuid.UUID, current_user: CurrentUser, db: DB) -> Response:
    """鉴权读取 Artifact 内容，避免公开 storage key。"""

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
            endpoint_url=req.endpoint_url,
            enabled_tools=req.enabled_tools,
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
