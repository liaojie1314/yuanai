"""MCP discovery、显式启用和调用边界集成测试。"""

import json

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tool_runtime import McpServerStatus, ToolExecutionStatus
from app.services.tool_runtime_service import ToolRuntimeService


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
                    "inputSchema": {"type": "object", "additionalProperties": False},
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
    server = await service.create_mcp_server(
        user_id=test_user.id,
        name="Example MCP",
        endpoint_url="https://example.com/mcp",
        enabled_tools=["lookup"],
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
        arguments={},
        db=db,
    )
    assert write_execution.status is ToolExecutionStatus.waiting
    assert len(calls) == 2

    changed = await service.discover_mcp_server(server.id, user_id=test_user.id, db=db)
    assert changed.status is McpServerStatus.paused
    assert changed.enabled_tools == []
