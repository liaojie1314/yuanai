"""两级记忆范围：用户级共享、助理私有，以及互相提升降级。"""

import pytest
from httpx import AsyncClient


async def _two_assistants(client: AsyncClient, headers: dict[str, str]) -> tuple[str, str]:
    """取默认助理并另建一个，返回两者的 id。"""

    first = (await client.get("/api/v1/agent/assistants", headers=headers)).json()[0]["id"]
    second = (
        await client.post(
            "/api/v1/agent/assistants",
            headers=headers,
            json={"name": "学习搭子", "defaultModel": "deepseek-v4-flash"},
        )
    ).json()["id"]
    return str(first), str(second)


async def _active_memory(
    client: AsyncClient, headers: dict[str, str], assistant_id: str, content: str
) -> str:
    """建一条记忆并确认为 active —— 检索只看 active。"""

    created = await client.post(
        "/api/v1/memories",
        headers=headers,
        json={
            "assistantId": assistant_id,
            "memoryType": "semantic",
            "content": content,
            "sourceType": "manual",
            "sourceId": content,
        },
    )
    assert created.status_code == 201, created.text
    memory_id = created.json()["id"]
    confirmed = await client.patch(
        f"/api/v1/memories/{memory_id}", headers=headers, json={"status": "active"}
    )
    assert confirmed.status_code == 200, confirmed.text
    return str(memory_id)


@pytest.mark.asyncio
async def test_user_level_memory_is_visible_to_both_assistants(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """assistant_id 为空的记忆对该用户的每个助理都可见。"""

    first, second = await _two_assistants(client, auth_headers)
    memory_id = await _active_memory(client, auth_headers, first, "我在东八区")
    promoted = await client.patch(
        f"/api/v1/memories/{memory_id}/scope", headers=auth_headers, json={"scope": "user"}
    )
    assert promoted.status_code == 200, promoted.text
    assert promoted.json()["assistantId"] is None

    for assistant_id in (first, second):
        found = await client.get(
            "/api/v1/memories/search",
            headers=auth_headers,
            params={"assistantId": assistant_id, "query": "东八区"},
        )
        assert found.status_code == 200, found.text
        assert any(item["content"] == "我在东八区" for item in found.json()["results"])


@pytest.mark.asyncio
async def test_private_memory_does_not_leak_across_assistants(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """助理 A 的私有记忆不出现在助理 B 的检索结果中。"""

    first, second = await _two_assistants(client, auth_headers)
    await _active_memory(client, auth_headers, first, "项目代号是夜莺")
    found = await client.get(
        "/api/v1/memories/search",
        headers=auth_headers,
        params={"assistantId": second, "query": "夜莺"},
    )
    assert found.status_code == 200, found.text
    assert all("夜莺" not in item["content"] for item in found.json()["results"])


@pytest.mark.asyncio
async def test_demoting_back_to_assistant_scope_restores_isolation(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """降级回助理私有后，另一个助理再也检索不到。"""

    first, second = await _two_assistants(client, auth_headers)
    memory_id = await _active_memory(client, auth_headers, first, "偏好用 pnpm")
    await client.patch(
        f"/api/v1/memories/{memory_id}/scope", headers=auth_headers, json={"scope": "user"}
    )
    demoted = await client.patch(
        f"/api/v1/memories/{memory_id}/scope",
        headers=auth_headers,
        json={"scope": "assistant", "assistantId": first},
    )
    assert demoted.status_code == 200, demoted.text
    assert demoted.json()["assistantId"] == first

    found = await client.get(
        "/api/v1/memories/search",
        headers=auth_headers,
        params={"assistantId": second, "query": "pnpm"},
    )
    assert all("pnpm" not in item["content"] for item in found.json()["results"])


@pytest.mark.asyncio
async def test_demoting_requires_an_owned_assistant(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """降级必须带上归属于本人的助理，否则 422 / 404 而不是悄悄挪走。"""

    first, _ = await _two_assistants(client, auth_headers)
    memory_id = await _active_memory(client, auth_headers, first, "偏好深色主题")
    await client.patch(
        f"/api/v1/memories/{memory_id}/scope", headers=auth_headers, json={"scope": "user"}
    )
    missing = await client.patch(
        f"/api/v1/memories/{memory_id}/scope", headers=auth_headers, json={"scope": "assistant"}
    )
    assert missing.status_code == 422
    assert missing.json()["detail"] == "MEMORY_SCOPE_ASSISTANT_REQUIRED"


@pytest.mark.asyncio
async def test_promoting_duplicate_to_user_level_is_rejected(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """提升为用户级时撞上已有的用户级同内容，必须拒绝而不是造重复。"""

    first, _ = await _two_assistants(client, auth_headers)
    shared = await _active_memory(client, auth_headers, first, "我偏好夜间工作")
    await client.patch(
        f"/api/v1/memories/{shared}/scope", headers=auth_headers, json={"scope": "user"}
    )
    dup = await _active_memory(client, auth_headers, first, "我偏好夜间工作")
    response = await client.patch(
        f"/api/v1/memories/{dup}/scope", headers=auth_headers, json={"scope": "user"}
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "MEMORY_SCOPE_DUPLICATE"
