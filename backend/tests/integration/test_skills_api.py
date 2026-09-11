"""Skill 生命周期、安装范围和租户隔离的 API 覆盖。"""

import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, hash_password
from app.models.user import User


def _manifest(version: str, *, tool: str = "calculate@^1") -> str:
    return f"""id: yuanai.research.brief
version: {version}
name: Research Brief
description: Build a cited brief
entrypoint: SKILL.md
required_tools:
  - {tool}
risk_ceiling: read
"""


def _draft(version: str, *, tool: str = "calculate@^1") -> dict[str, str]:
    return {
        "manifest": _manifest(version, tool=tool),
        "skillMd": "# Research Brief\nUse citations.",
    }


async def _create_assistant(client: AsyncClient, headers: dict[str, str]) -> str:
    response = await client.post(
        "/api/v1/agent/assistants",
        headers=headers,
        json={"name": "Research", "defaultModel": "deepseek-chat"},
    )
    assert response.status_code == 201
    return response.json()["id"]


async def test_skill_api_validates_activates_installs_and_rolls_back(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """一个用户可以完成草稿到安装及历史版本回滚的闭环。"""

    created = await client.post("/api/v1/skills", headers=auth_headers, json=_draft("1.0.0"))
    assert created.status_code == 201
    skill = created.json()
    skill_id = skill["id"]
    first_version = skill["versions"][0]["id"]
    assert skill["versions"][0]["status"] == "draft"

    validated = await client.post(
        f"/api/v1/skills/{skill_id}/versions/{first_version}/validate", headers=auth_headers
    )
    assert validated.status_code == 200
    assert validated.json()["status"] == "validated"

    active = await client.post(
        f"/api/v1/skills/{skill_id}/versions/{first_version}/activate", headers=auth_headers
    )
    assert active.status_code == 200
    assert active.json()["currentVersionId"] == first_version

    global_install = await client.put(
        f"/api/v1/skills/{skill_id}/installations",
        headers=auth_headers,
        json={"scope": "global"},
    )
    assert global_install.status_code == 200
    assert global_install.json()["assistantId"] is None

    assistant_id = await _create_assistant(client, auth_headers)
    assistant_install = await client.put(
        f"/api/v1/skills/{skill_id}/installations",
        headers=auth_headers,
        json={"scope": "assistant", "assistantId": assistant_id},
    )
    assert assistant_install.status_code == 200
    assert assistant_install.json()["assistantId"] == assistant_id

    second = await client.post(
        f"/api/v1/skills/{skill_id}/versions", headers=auth_headers, json=_draft("1.1.0")
    )
    assert second.status_code == 201
    second_version = next(item for item in second.json()["versions"] if item["version"] == "1.1.0")[
        "id"
    ]
    assert (
        await client.post(
            f"/api/v1/skills/{skill_id}/versions/{second_version}/validate", headers=auth_headers
        )
    ).json()["status"] == "validated"
    assert (
        await client.post(
            f"/api/v1/skills/{skill_id}/versions/{second_version}/activate", headers=auth_headers
        )
    ).json()["currentVersionId"] == second_version

    rolled_back = await client.post(
        f"/api/v1/skills/{skill_id}/versions/{first_version}/rollback", headers=auth_headers
    )
    assert rolled_back.status_code == 200
    versions = {item["id"]: item["status"] for item in rolled_back.json()["versions"]}
    assert rolled_back.json()["currentVersionId"] == first_version
    assert versions == {first_version: "active", second_version: "deprecated"}


async def test_skill_api_rejects_invalid_tool_and_hides_other_tenant(
    client: AsyncClient,
    db: AsyncSession,
    auth_headers: dict[str, str],
) -> None:
    """验证失败不能激活，另一用户也不能读取或操作该 Skill。"""

    created = await client.post(
        "/api/v1/skills", headers=auth_headers, json=_draft("1.0.0", tool="unknown@^1")
    )
    skill_id = created.json()["id"]
    version_id = created.json()["versions"][0]["id"]
    rejected = await client.post(
        f"/api/v1/skills/{skill_id}/versions/{version_id}/validate", headers=auth_headers
    )
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"
    assert rejected.json()["validationErrors"] == ["SKILL_TOOL_NOT_FOUND"]
    denied_activation = await client.post(
        f"/api/v1/skills/{skill_id}/versions/{version_id}/activate", headers=auth_headers
    )
    assert denied_activation.status_code == 409

    other = User(
        id=uuid.uuid4(),
        email="skills-other@example.com",
        username="skills-other",
        hashed_password=hash_password("Test1234!"),
    )
    db.add(other)
    await db.commit()
    other_headers = {"Authorization": f"Bearer {create_access_token(str(other.id))}"}
    assert (await client.get("/api/v1/skills", headers=other_headers)).json() == []
    assert (
        await client.post(
            f"/api/v1/skills/{skill_id}/versions/{version_id}/validate", headers=other_headers
        )
    ).status_code == 404
