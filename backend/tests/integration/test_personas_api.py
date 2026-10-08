"""人格读写、版本递增、回滚与预览。"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models.user import User


async def _assistant_id(client: AsyncClient, headers: dict[str, str]) -> str:
    """取当前用户的默认助理 id。"""

    response = await client.get("/api/v1/agent/assistants", headers=headers)
    return str(response.json()[0]["id"])


@pytest.fixture
async def other_auth_headers(db: AsyncSession) -> dict[str, str]:
    """第二个租户的访问凭据，用于验证归属校验不泄漏存在性。"""

    user = User(
        id=uuid.uuid4(),
        email="persona-api-other@example.com",
        username="persona-other",
        hashed_password="x",
    )
    db.add(user)
    await db.commit()
    return {"Authorization": f"Bearer {create_access_token(str(user.id))}"}


@pytest.mark.asyncio
async def test_get_persona_returns_defaults(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """没编辑过的助理返回一份默认人格，而不是 404。"""

    aid = await _assistant_id(client, auth_headers)
    response = await client.get(f"/api/v1/agent/assistants/{aid}/persona", headers=auth_headers)
    assert response.status_code == 200, response.text
    assert response.json()["tone"] == "concise"
    assert response.json()["version"] == 1


@pytest.mark.asyncio
async def test_put_persona_bumps_version_and_records_snapshot(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """每次保存版本号递增并留下一条快照。"""

    aid = await _assistant_id(client, auth_headers)
    first = await client.put(
        f"/api/v1/agent/assistants/{aid}/persona",
        headers=auth_headers,
        json={"tone": "patient", "greeting": "早上好"},
    )
    assert first.status_code == 200, first.text
    assert first.json()["version"] == 2
    versions = await client.get(
        f"/api/v1/agent/assistants/{aid}/persona/versions", headers=auth_headers
    )
    assert [item["version"] for item in versions.json()] == [2, 1]
    assert versions.json()[0]["changeReason"] == "manual"


@pytest.mark.asyncio
async def test_rollback_creates_new_version_with_old_payload(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """回滚是「用旧内容生成新版本」，版本号继续递增。"""

    aid = await _assistant_id(client, auth_headers)
    await client.put(
        f"/api/v1/agent/assistants/{aid}/persona",
        headers=auth_headers,
        json={"tone": "patient", "greeting": "早上好"},
    )
    rolled = await client.post(
        f"/api/v1/agent/assistants/{aid}/persona/versions/1/rollback", headers=auth_headers
    )
    assert rolled.status_code == 200, rolled.text
    assert rolled.json()["version"] == 3
    assert rolled.json()["tone"] == "concise"
    assert rolled.json()["greeting"] == ""


@pytest.mark.asyncio
async def test_rollback_to_missing_version_is_404(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """回滚到不存在的版本返回 404，不是 500。"""

    aid = await _assistant_id(client, auth_headers)
    response = await client.post(
        f"/api/v1/agent/assistants/{aid}/persona/versions/99/rollback", headers=auth_headers
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_other_users_assistant_is_404(
    client: AsyncClient, auth_headers: dict[str, str], other_auth_headers: dict[str, str]
) -> None:
    """拿别人的助理 id 读人格一律 404，不泄漏存在性。"""

    aid = await _assistant_id(client, auth_headers)
    response = await client.get(
        f"/api/v1/agent/assistants/{aid}/persona", headers=other_auth_headers
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_rollback_of_other_users_assistant_is_404(
    client: AsyncClient, auth_headers: dict[str, str], other_auth_headers: dict[str, str]
) -> None:
    """回滚别人助理的版本同样 404，不能借版本号探测归属。"""

    aid = await _assistant_id(client, auth_headers)
    await client.put(
        f"/api/v1/agent/assistants/{aid}/persona",
        headers=auth_headers,
        json={"tone": "patient"},
    )
    response = await client.post(
        f"/api/v1/agent/assistants/{aid}/persona/versions/1/rollback",
        headers=other_auth_headers,
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_preview_returns_assembled_fragment(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """预览返回后端真实装配结果，和注入链路同一份逻辑。"""

    aid = await _assistant_id(client, auth_headers)
    await client.put(
        f"/api/v1/agent/assistants/{aid}/persona",
        headers=auth_headers,
        json={"greeting": "早上好", "addressUser": "老板"},
    )
    response = await client.get(
        f"/api/v1/agent/assistants/{aid}/persona/preview", headers=auth_headers
    )
    assert response.status_code == 200, response.text
    assert "早上好" in response.json()["fragment"]
    assert "老板" in response.json()["fragment"]
    assert response.json()["truncated"] is False


@pytest.mark.asyncio
async def test_forbidden_topics_are_capped(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """禁止话题有条数与单条长度上限，否则不参与截断的它会顶爆预算。"""

    aid = await _assistant_id(client, auth_headers)
    response = await client.put(
        f"/api/v1/agent/assistants/{aid}/persona",
        headers=auth_headers,
        json={"forbiddenTopics": [f"话题{i}" for i in range(50)]},
    )
    assert response.status_code == 422
    too_long = await client.put(
        f"/api/v1/agent/assistants/{aid}/persona",
        headers=auth_headers,
        json={"forbiddenTopics": ["长" * 200]},
    )
    assert too_long.status_code == 422
