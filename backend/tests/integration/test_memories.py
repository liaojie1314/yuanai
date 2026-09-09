"""记忆管理 API 的认证、租户隔离和生命周期集成测试。"""

import uuid

import pytest
from sqlalchemy import select

from app.models.assistant import Assistant
from app.models.memory import Memory
from app.models.user import User


@pytest.mark.asyncio
async def test_memory_lifecycle_is_authenticated_and_tenant_scoped(
    client, db, test_user, auth_headers
):
    """用户可创建、确认、检索和删除自己的记忆，其他租户不可见。"""

    assistant = Assistant(
        user_id=test_user.id,
        name="默认助理",
        default_model="test-model",
        is_default=True,
    )
    other = User(
        id=uuid.uuid4(),
        email="memory-api-other@example.com",
        username="memory-api-other",
        hashed_password="x",
    )
    db.add_all([assistant, other])
    await db.commit()
    await db.refresh(assistant)

    response = await client.post(
        "/api/v1/memories",
        headers=auth_headers,
        json={
            "assistantId": str(assistant.id),
            "memoryType": "preference",
            "content": "旅行优先高铁",
            "sourceType": "user_input",
        },
    )
    assert response.status_code == 201
    memory_id = response.json()["id"]
    assert response.json()["status"] == "candidate"

    update = await client.patch(
        f"/api/v1/memories/{memory_id}",
        headers=auth_headers,
        json={"status": "active"},
    )
    assert update.status_code == 200

    listed = await client.get("/api/v1/memories", headers=auth_headers)
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [memory_id]

    search = await client.get(
        "/api/v1/memories/search",
        headers=auth_headers,
        params={"assistantId": str(assistant.id), "query": "高铁"},
    )
    assert search.status_code == 200
    assert search.json()[0]["id"] == memory_id

    forbidden = await client.get(
        "/api/v1/memories/search",
        headers=auth_headers,
        params={"assistantId": str(uuid.uuid4()), "query": "高铁"},
    )
    assert forbidden.status_code == 200
    assert forbidden.json() == []

    deleted = await client.delete(f"/api/v1/memories/{memory_id}", headers=auth_headers)
    assert deleted.status_code == 204
    assert await db.scalar(select(Memory).where(Memory.id == memory_id)) is None


@pytest.mark.asyncio
async def test_memory_search_requires_authentication(client):
    """检索接口拒绝未认证请求。"""

    response = await client.get(
        "/api/v1/memories/search",
        params={"assistantId": str(uuid.uuid4()), "query": "anything"},
    )
    assert response.status_code == 401
