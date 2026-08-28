"""Tool Runtime API 的租户和安全边界集成测试。"""

import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, hash_password
from app.models.user import User
from app.services.tool_runtime_service import ToolRuntimeService


async def test_catalog_and_read_execution_are_available(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """目录不含 handler，低风险工具能通过统一运行入口完成。"""

    catalog = await client.get("/api/v1/tools/catalog", headers=auth_headers)
    assert catalog.status_code == 200
    assert "calculate" in {item["name"] for item in catalog.json()}
    assert all("handler" not in item for item in catalog.json())

    execution = await client.post(
        "/api/v1/tool-executions",
        headers=auth_headers,
        json={"tool_name": "calculate", "arguments": {"expression": "2 + 3"}},
    )
    assert execution.status_code == 202
    payload = execution.json()
    assert payload["status"] == "succeeded"
    assert payload["resultJson"]["result"] == 5
    assert payload["argumentsHash"] != "2 + 3"


async def test_connection_and_artifact_access_are_tenant_scoped(
    client: AsyncClient,
    db: AsyncSession,
    test_user,
    auth_headers: dict[str, str],
) -> None:
    """连接与 Artifact 不能跨用户读取或下载。"""

    other = User(
        email="other-tools-api@example.com",
        username="other-tools-api",
        hashed_password=hash_password("Test1234!"),
    )
    db.add(other)
    await db.commit()
    await db.refresh(other)

    connection = await client.post(
        "/api/v1/tool-connections",
        headers=auth_headers,
        json={
            "kind": "api_key",
            "provider": "test",
            "display_name": "Test Connection",
            "secret_ref": "secret-store://test",
            "scopes": ["files.read"],
            "metadata": {"account": "demo"},
        },
    )
    assert connection.status_code == 201
    assert connection.json()["secretRef"] == "secret-store://test"
    own_connections = await client.get("/api/v1/tool-connections", headers=auth_headers)
    assert len(own_connections.json()) == 1

    service = ToolRuntimeService()
    artifact = await service.create_artifact(
        user_id=test_user.id,
        data=b"tenant report",
        name="tenant-report.txt",
        mime_type="text/plain",
        db=db,
    )
    own_artifact = await client.get(
        f"/api/v1/artifacts/{artifact.id}/content", headers=auth_headers
    )
    assert own_artifact.status_code == 200
    assert own_artifact.content == b"tenant report"

    other_headers = {"Authorization": f"Bearer {create_access_token(str(other.id))}"}
    forbidden_artifact = await client.get(
        f"/api/v1/artifacts/{artifact.id}/content", headers=other_headers
    )
    assert forbidden_artifact.status_code == 404


async def test_node_pairing_heartbeat_and_resource_grant(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """节点配对不会暴露哈希，资源授权只接受稳定资源 ID。"""

    pairing = await client.post(
        "/api/v1/execution-nodes/pair",
        headers=auth_headers,
        json={
            "name": "Test Desktop",
            "platform": "linux",
            "app_version": "0.1.0",
            "capabilities": ["files.read"],
        },
    )
    assert pairing.status_code == 201
    pairing_payload = pairing.json()
    assert pairing_payload["pairingCode"]
    assert "pairingCodeHash" not in pairing_payload

    node_id = pairing_payload["id"]
    heartbeat = await client.post(
        f"/api/v1/execution-nodes/{node_id}/heartbeat", headers=auth_headers
    )
    assert heartbeat.status_code == 200
    assert heartbeat.json()["status"] == "online"

    grant = await client.post(
        "/api/v1/resource-grants",
        headers=auth_headers,
        json={
            "node_id": node_id,
            "kind": "directory",
            "resource_id": str(uuid.uuid4()),
            "display_name": "Agent workspace",
            "scopes": ["files.read"],
        },
    )
    assert grant.status_code == 201
    assert "path" not in grant.json()


async def test_mcp_endpoint_requires_public_https(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """MCP 连接不能指向本机地址或携带凭证。"""

    response = await client.post(
        "/api/v1/mcp-servers",
        headers=auth_headers,
        json={"name": "unsafe", "endpoint_url": "https://localhost/mcp"},
    )
    assert response.status_code == 422
