"""MCP discovery、显式启用和调用边界集成测试。"""

import json
import uuid

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.approval import ApprovalRequest, ApprovalStatus
from app.models.tool_runtime import (
    McpServerStatus,
    ToolConnection,
    ToolConnectionKind,
    ToolExecutionStatus,
)
from app.services.tool_runtime_service import ToolRuntimeError, ToolRuntimeService


def _mcp_response(*, changed: bool = False) -> dict[str, object]:
    """构造带只读和副作用工具的 MCP schema。"""

    return {
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "tools": [
                {
                    "name": "lookup",
                    "description": "changed" if changed else "read only",
                    "inputSchema": {
                        "type": "object",
                        "properties": {"query": {"type": "string", "minLength": 1}},
                        "required": ["query"],
                        "additionalProperties": False,
                    },
                    "annotations": {"readOnlyHint": True},
                },
                {
                    "name": "publish",
                    "description": "external side effect",
                    "inputSchema": {
                        "type": "object",
                        "properties": {"message": {"type": "string", "minLength": 1}},
                        "required": ["message"],
                        "additionalProperties": False,
                    },
                    "annotations": {"readOnlyHint": False},
                },
            ]
        },
    }


@pytest.mark.asyncio
async def test_mcp_requires_explicit_enablement_and_pauses_on_schema_change(
    db: AsyncSession, test_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """MCP 只能调用已启用工具，schema 变化会清空授权。"""

    monkeypatch.setattr(
        "app.services.tool_runtime_service.validate_public_url", lambda value: value
    )
    discovery_results = [_mcp_response(), _mcp_response(changed=True)]
    calls: list[dict[str, object]] = []

    async def handle(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        calls.append(payload)
        if payload.get("method") == "tools/list":
            return httpx.Response(200, json=discovery_results.pop(0))
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": payload.get("id"),
                "result": {"content": [{"type": "text", "text": "ok"}]},
            },
        )

    transport = httpx.MockTransport(handle)
    service = ToolRuntimeService(mcp_transport=transport)
    connection = ToolConnection(
        user_id=test_user.id,
        kind=ToolConnectionKind.mcp_http,
        provider="example",
        display_name="Example MCP credentials",
        scopes=[],
        metadata_json={},
    )
    db.add(connection)
    await db.commit()
    await db.refresh(connection)
    server = await service.create_mcp_server(
        user_id=test_user.id,
        name="Example MCP",
        endpoint_url="https://example.com/mcp",
        connection_id=connection.id,
        db=db,
    )
    assert server.enabled_tools == []
    await service.discover_mcp_server(server.id, user_id=test_user.id, db=db)

    with pytest.raises(RuntimeError, match="MCP_TOOL_NOT_ENABLED"):
        await service.create_mcp_execution(
            server.id,
            user_id=test_user.id,
            tool_name="lookup",
            arguments={"query": "yuanai"},
            db=db,
        )

    await service.enable_mcp_tools(server.id, user_id=test_user.id, enabled_tools=["lookup"], db=db)
    read_execution = await service.create_mcp_execution(
        server.id,
        user_id=test_user.id,
        tool_name="lookup",
        arguments={"query": "yuanai"},
        db=db,
    )
    assert read_execution.status is ToolExecutionStatus.succeeded
    assert read_execution.execution_location == "mcp_remote"
    assert len(calls) == 2

    await service.enable_mcp_tools(
        server.id, user_id=test_user.id, enabled_tools=["publish"], db=db
    )
    write_execution = await service.create_mcp_execution(
        server.id,
        user_id=test_user.id,
        tool_name="publish",
        arguments={"message": "hello"},
        db=db,
    )
    assert write_execution.status is ToolExecutionStatus.waiting
    assert len(calls) == 2

    changed = await service.discover_mcp_server(server.id, user_id=test_user.id, db=db)
    assert changed.status is McpServerStatus.paused
    assert changed.enabled_tools == []


@pytest.mark.asyncio
async def test_mcp_credentials_are_tenant_bound_and_side_effect_requires_approval(
    client, db: AsyncSession, test_user, auth_headers, monkeypatch: pytest.MonkeyPatch
) -> None:
    """MCP 凭证按租户注入，副作用必须批准后才能消费执行。"""

    monkeypatch.setattr(
        "app.services.tool_runtime_service.validate_public_url", lambda value: value
    )
    requests: list[httpx.Request] = []

    async def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        payload = json.loads(request.content)
        if payload.get("method") == "tools/list":
            return httpx.Response(200, json=_mcp_response())
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": payload.get("id"),
                "result": {"content": [{"type": "text", "text": "published"}]},
            },
        )

    class FakeSecretStore:
        async def get(self, owner_id: uuid.UUID, ref: str) -> str:
            assert owner_id == test_user.id
            assert ref == "secret://example"
            return "test-token"

    service = ToolRuntimeService(
        mcp_transport=httpx.MockTransport(handle), secret_store=FakeSecretStore()
    )
    connection = ToolConnection(
        user_id=test_user.id,
        kind=ToolConnectionKind.mcp_http,
        provider="example",
        display_name="Example MCP",
        secret_ref="secret://example",
        scopes=[],
        metadata_json={"auth_header": "Authorization", "auth_prefix": "Bearer "},
    )
    db.add(connection)
    await db.commit()
    await db.refresh(connection)
    server = await service.create_mcp_server(
        user_id=test_user.id,
        name="Example MCP",
        endpoint_url="https://example.com/mcp",
        connection_id=connection.id,
        db=db,
    )
    await service.discover_mcp_server(server.id, user_id=test_user.id, db=db)
    await service.enable_mcp_tools(
        server.id, user_id=test_user.id, enabled_tools=["lookup", "publish"], db=db
    )

    waiting = await service.create_mcp_execution(
        server.id,
        user_id=test_user.id,
        tool_name="publish",
        arguments={"message": "hello"},
        db=db,
    )
    approval = await db.scalar(
        select(ApprovalRequest).where(ApprovalRequest.tool_execution_id == waiting.id)
    )
    assert approval is not None
    assert approval.status is ApprovalStatus.pending
    assert requests[-1].headers["Authorization"] == "Bearer test-token"

    approved = await client.post(
        f"/api/v1/agent/approvals/{approval.id}",
        headers=auth_headers,
        json={"decision": "approve"},
    )
    assert approved.status_code == 200, approved.text
    await db.refresh(waiting)
    assert waiting.status is ToolExecutionStatus.queued

    completed = await service.create_mcp_execution(
        server.id,
        user_id=test_user.id,
        tool_name="publish",
        arguments={"message": "hello"},
        approval_id=approval.id,
        db=db,
    )
    assert completed.status is ToolExecutionStatus.succeeded
    await db.refresh(approval)
    assert approval.decision_note is not None
    assert approval.decision_note.endswith("[consumed]")
    assert requests[-1].headers["Authorization"] == "Bearer test-token"

    denied_waiting = await service.create_mcp_execution(
        server.id,
        user_id=test_user.id,
        tool_name="publish",
        arguments={"message": "deny me"},
        db=db,
    )
    denied_approval = await db.scalar(
        select(ApprovalRequest).where(ApprovalRequest.tool_execution_id == denied_waiting.id)
    )
    assert denied_approval is not None
    denied = await client.post(
        f"/api/v1/agent/approvals/{denied_approval.id}",
        headers=auth_headers,
        json={"decision": "deny", "note": "not now"},
    )
    assert denied.status_code == 200, denied.text
    await db.refresh(denied_waiting)
    assert denied_waiting.status is ToolExecutionStatus.cancelled
    assert denied_waiting.error_code == "TOOL_APPROVAL_DENIED"


@pytest.mark.asyncio
async def test_mcp_approval_rejects_parameter_substitution(
    db: AsyncSession, test_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """批准后替换 MCP 参数不得消费原审批或触发远端调用。"""

    monkeypatch.setattr(
        "app.services.tool_runtime_service.validate_public_url", lambda value: value
    )
    calls: list[dict[str, object]] = []

    async def handle(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        calls.append(payload)
        if payload.get("method") == "tools/list":
            return httpx.Response(200, json=_mcp_response())
        return httpx.Response(200, json={"result": {"content": []}})

    service = ToolRuntimeService(mcp_transport=httpx.MockTransport(handle))
    connection = ToolConnection(
        user_id=test_user.id,
        kind=ToolConnectionKind.mcp_http,
        provider="example",
        display_name="Example MCP",
        scopes=[],
        metadata_json={},
    )
    db.add(connection)
    await db.commit()
    await db.refresh(connection)
    server = await service.create_mcp_server(
        user_id=test_user.id,
        name="Example MCP",
        endpoint_url="https://example.com/mcp",
        connection_id=connection.id,
        db=db,
    )
    await service.discover_mcp_server(server.id, user_id=test_user.id, db=db)
    await service.enable_mcp_tools(
        server.id, user_id=test_user.id, enabled_tools=["publish"], db=db
    )
    waiting = await service.create_mcp_execution(
        server.id,
        user_id=test_user.id,
        tool_name="publish",
        arguments={"message": "approved message"},
        db=db,
    )
    approval = await db.scalar(
        select(ApprovalRequest).where(ApprovalRequest.tool_execution_id == waiting.id)
    )
    assert approval is not None
    approval.status = ApprovalStatus.approved
    await db.commit()
    with pytest.raises(ToolRuntimeError, match="MCP_EXECUTION_NOT_FOUND"):
        await service.create_mcp_execution(
            server.id,
            user_id=test_user.id,
            tool_name="publish",
            arguments={"message": "substituted message"},
            approval_id=approval.id,
            db=db,
        )
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_mcp_rejects_cross_tenant_server_and_connection(db: AsyncSession, test_user) -> None:
    """MCP Server 和凭证连接不能跨租户拼接。"""

    other = type(test_user)(
        email="other-mcp@example.com",
        username="other-mcp",
        hashed_password=test_user.hashed_password,
    )
    db.add(other)
    await db.commit()
    await db.refresh(other)
    connection = ToolConnection(
        user_id=test_user.id,
        kind=ToolConnectionKind.mcp_http,
        provider="example",
        display_name="Example MCP",
        scopes=[],
        metadata_json={},
    )
    db.add(connection)
    await db.commit()
    await db.refresh(connection)
    service = ToolRuntimeService()
    server = await service.create_mcp_server(
        user_id=test_user.id,
        name="Example MCP",
        endpoint_url="https://example.com/mcp",
        connection_id=connection.id,
        db=db,
    )
    with pytest.raises(ToolRuntimeError, match="MCP_SERVER_NOT_FOUND"):
        await service.create_mcp_execution(
            server.id,
            user_id=other.id,
            tool_name="lookup",
            arguments={"query": "yuanai"},
            db=db,
        )
    with pytest.raises(ToolRuntimeError, match="MCP_CONNECTION_NOT_FOUND"):
        await service.create_mcp_server(
            user_id=other.id,
            name="Cross-tenant MCP",
            endpoint_url="https://example.com/mcp",
            connection_id=connection.id,
            db=db,
        )
