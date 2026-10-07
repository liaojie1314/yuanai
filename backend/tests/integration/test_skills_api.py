"""Skill 生命周期、评测门禁、安装范围和租户隔离的 API 覆盖。"""

import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, hash_password
from app.models.agent_run import AgentRun, AgentRunStatus, AgentStep, AgentStepKind, AgentStepStatus
from app.models.assistant import Assistant
from app.models.user import User


def _manifest(version: str, *, tool: str = "calculate@^1", risk: str = "read") -> str:
    return f"""id: yuanai.research.brief
version: {version}
name: Research Brief
description: Build a cited brief
entrypoint: SKILL.md
required_tools:
  - {tool}
risk_ceiling: {risk}
"""


def _draft(version: str, *, tool: str = "calculate@^1", risk: str = "read") -> dict[str, str]:
    return {
        "manifest": _manifest(version, tool=tool, risk=risk),
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
    # 替换已有 active 版本必须先过评测门禁，首次激活不需要。
    evaluated = await client.post(
        f"/api/v1/skills/{skill_id}/versions/{second_version}/evaluate", headers=auth_headers
    )
    assert evaluated.status_code == 200
    assert evaluated.json()["status"] == "passed"
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


async def test_skill_activation_gate_blocks_unevaluated_and_failed_versions(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """替换 active 版本必须有通过的评测；未评测和评测失败都不得替换。"""

    created = await client.post("/api/v1/skills", headers=auth_headers, json=_draft("1.0.0"))
    skill_id = created.json()["id"]
    first_version = created.json()["versions"][0]["id"]
    await client.post(
        f"/api/v1/skills/{skill_id}/versions/{first_version}/validate", headers=auth_headers
    )
    # 首次激活没有可被弄坏的生产版本，不需要评测。
    assert (
        await client.post(
            f"/api/v1/skills/{skill_id}/versions/{first_version}/activate", headers=auth_headers
        )
    ).status_code == 200

    # 抬高风险上限的新版本：验证能过（工具风险仍在上限内），但评测判定为静默扩权。
    escalated = await client.post(
        f"/api/v1/skills/{skill_id}/versions",
        headers=auth_headers,
        json=_draft("1.1.0", risk="privileged"),
    )
    second_version = next(
        item for item in escalated.json()["versions"] if item["version"] == "1.1.0"
    )["id"]
    assert (
        await client.post(
            f"/api/v1/skills/{skill_id}/versions/{second_version}/validate", headers=auth_headers
        )
    ).json()["status"] == "validated"

    missing = await client.post(
        f"/api/v1/skills/{skill_id}/versions/{second_version}/activate", headers=auth_headers
    )
    assert missing.status_code == 409
    assert missing.json()["detail"] == "SKILL_VERSION_EVALUATION_REQUIRED"

    evaluated = await client.post(
        f"/api/v1/skills/{skill_id}/versions/{second_version}/evaluate", headers=auth_headers
    )
    assert evaluated.status_code == 200
    body = evaluated.json()
    assert body["status"] == "failed"
    assert body["mode"] == "static_contract"
    # 静态契约评测没有执行面，成本与平均 Step 必须留空而不是填 0。
    assert body["estimatedCostUsd"] is None
    assert body["avgSteps"] is None
    assert body["totalCases"] == len(body["caseResults"])
    escalation = next(
        case for case in body["caseResults"] if case["name"] == "risk_ceiling_not_escalated"
    )
    assert escalation["status"] == "failed"

    denied = await client.post(
        f"/api/v1/skills/{skill_id}/versions/{second_version}/activate", headers=auth_headers
    )
    assert denied.status_code == 409
    assert denied.json()["detail"] == "SKILL_VERSION_EVALUATION_FAILED"

    listed = (await client.get("/api/v1/skills", headers=auth_headers)).json()[0]
    assert listed["currentVersionId"] == first_version
    statuses = {item["id"]: item["status"] for item in listed["versions"]}
    assert statuses == {first_version: "active", second_version: "validated"}
    blocked = next(item for item in listed["versions"] if item["id"] == second_version)
    assert blocked["latestEvaluation"]["status"] == "failed"


async def test_skill_suggestions_require_three_similar_successful_runs(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str], test_user: User
) -> None:
    """相似任务成功三次才提出候选，且候选可直接提交为草稿。"""

    assistant = Assistant(user_id=test_user.id, name="Research", default_model="deepseek-chat")
    db.add(assistant)
    await db.flush()
    for index in range(2):
        await _succeeded_run(db, assistant, f"统计第 {index} 周销售额并汇总", str(index))
    await db.commit()
    assert (await client.get("/api/v1/skills/suggestions", headers=auth_headers)).json() == []

    await _succeeded_run(db, assistant, "统计第 9 周销售额并汇总", "9")
    await db.commit()
    suggestions = (await client.get("/api/v1/skills/suggestions", headers=auth_headers)).json()
    assert len(suggestions) == 1
    suggestion = suggestions[0]
    assert suggestion["occurrences"] == 3
    assert suggestion["steps"] == ["calculate"]
    assert suggestion["requiredTools"] == ["calculate@^1"]
    assert suggestion["parameters"] == ["calculate.expression"]
    assert len(suggestion["runIds"]) == 3

    accepted = await client.post(
        "/api/v1/skills",
        headers=auth_headers,
        json={"manifest": suggestion["manifest"], "skillMd": suggestion["skillMd"]},
    )
    assert accepted.status_code == 201
    assert accepted.json()["slug"] == suggestion["slug"]
    assert accepted.json()["versions"][0]["status"] == "draft"
    # 已保存的候选不再重复提示。
    assert (await client.get("/api/v1/skills/suggestions", headers=auth_headers)).json() == []


async def _succeeded_run(
    db: AsyncSession, assistant: Assistant, goal: str, expression: str
) -> AgentRun:
    """构造一次调用过 calculate 的成功 Run，供经验归纳读取。"""

    run = AgentRun(
        user_id=assistant.user_id,
        assistant_id=assistant.id,
        goal=goal,
        status=AgentRunStatus.succeeded,
        model="deepseek-chat",
    )
    db.add(run)
    await db.flush()
    db.add(
        AgentStep(
            run_id=run.id,
            sequence=1,
            kind=AgentStepKind.tool,
            status=AgentStepStatus.succeeded,
            input_json={"name": "calculate", "arguments": {"expression": expression}},
        )
    )
    await db.flush()
    return run
