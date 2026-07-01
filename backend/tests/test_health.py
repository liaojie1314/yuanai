"""健康检查接口测试 — 无需数据库即可运行。"""

from httpx import AsyncClient


async def test_health(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_docs_available(client: AsyncClient) -> None:
    response = await client.get("/docs")
    assert response.status_code == 200


async def test_openapi_schema(client: AsyncClient) -> None:
    response = await client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert schema["info"]["title"] == "yuanai API"
    # 确认所有路由都已注册
    paths = schema["paths"]
    assert "/api/v1/auth/register" in paths
    assert "/api/v1/auth/login" in paths
    assert "/api/v1/chat/conversations" in paths
    assert "/api/v1/chat/stream" in paths
    assert "/api/v1/models" in paths
