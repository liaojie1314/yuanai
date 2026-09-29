"""记忆管理 API 的认证、租户隔离和生命周期集成测试。"""

import re
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import select

from app.core.security import create_access_token
from app.models.assistant import Assistant
from app.models.memory import Memory, MemoryRelation, MemoryStorageLocation, MemoryType
from app.models.tool_runtime import ExecutionNode, ExecutionNodeStatus
from app.models.user import User
from app.schemas.memory import MEMORY_SEARCH_MAX_QUERY_CHARS
from app.tools.builtin.desktop import MEMORY_SEARCH_SPEC


async def _assistant(db, user_id: uuid.UUID) -> Assistant:
    """创建一个默认助理，记忆必须挂在它下面。"""

    assistant = Assistant(
        user_id=user_id,
        name="测试助理1",
        default_model="test-model",
        is_default=True,
    )
    db.add(assistant)
    await db.commit()
    await db.refresh(assistant)
    return assistant


async def _other_user(db) -> tuple[User, dict[str, str]]:
    """创建第二个租户及其访问凭据。"""

    user = User(
        id=uuid.uuid4(),
        email="memory-api-other@example.com",
        username="memory-api-other",
        hashed_password="x",
    )
    db.add(user)
    await db.commit()
    return user, {"Authorization": f"Bearer {create_access_token(str(user.id))}"}


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
            "sourceId": "msg-1",
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
    assert [item["id"] for item in listed.json()["items"]] == [memory_id]
    assert listed.json()["nextCursor"] is None
    assert listed.json()["localUnavailable"] is False

    search = await client.get(
        "/api/v1/memories/search",
        headers=auth_headers,
        params={"assistantId": str(assistant.id), "query": "高铁"},
    )
    assert search.status_code == 200
    assert search.json()["results"][0]["id"] == memory_id
    assert search.json()["localUnavailable"] is False

    forbidden = await client.get(
        "/api/v1/memories/search",
        headers=auth_headers,
        params={"assistantId": str(uuid.uuid4()), "query": "高铁"},
    )
    assert forbidden.status_code == 200
    assert forbidden.json()["results"] == []

    relation = MemoryRelation(
        memory_id=uuid.UUID(memory_id),
        subject="旅行",
        predicate="优先方式",
        object_value="高铁",
    )
    db.add(relation)
    await db.commit()

    deleted = await client.delete(f"/api/v1/memories/{memory_id}", headers=auth_headers)
    assert deleted.status_code == 204
    assert await db.scalar(select(Memory).where(Memory.id == memory_id)) is None
    assert await db.scalar(select(MemoryRelation).where(MemoryRelation.id == relation.id)) is None


@pytest.mark.asyncio
async def test_memory_search_requires_authentication(client):
    """检索接口拒绝未认证请求。"""

    response = await client.get(
        "/api/v1/memories/search",
        params={"assistantId": str(uuid.uuid4()), "query": "anything"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_memory_list_pages_through_a_stable_cursor(client, db, test_user, auth_headers):
    """游标分页必须覆盖全部记忆且不重不漏。"""

    assistant = await _assistant(db, test_user.id)
    for index in range(5):
        created = await client.post(
            "/api/v1/memories",
            headers=auth_headers,
            json={
                "assistantId": str(assistant.id),
                "memoryType": "preference",
                "content": f"记忆内容{index}",
                "sourceType": "user_input",
                "sourceId": f"msg-{index}",
            },
        )
        assert created.status_code == 201

    seen: list[str] = []
    cursor: str | None = None
    for _ in range(5):
        params = {"limit": 2} | ({"cursor": cursor} if cursor else {})
        page = (await client.get("/api/v1/memories", headers=auth_headers, params=params)).json()
        assert len(page["items"]) <= 2
        seen.extend(item["id"] for item in page["items"])
        cursor = page["nextCursor"]
        if cursor is None:
            break
    assert cursor is None
    assert len(seen) == 5
    assert len(set(seen)) == 5


@pytest.mark.asyncio
async def test_memory_list_rejects_a_forged_cursor(client, auth_headers):
    """畸形游标按参数错误拒绝，不会退化成返回第一页。"""

    response = await client.get(
        "/api/v1/memories", headers=auth_headers, params={"cursor": "not-a-cursor"}
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_memory_export_returns_every_memory_of_the_caller_only(
    client, db, test_user, auth_headers
):
    """导出只包含调用者自己的记忆。"""

    assistant = await _assistant(db, test_user.id)
    _, other_headers = await _other_user(db)
    created = await client.post(
        "/api/v1/memories",
        headers=auth_headers,
        json={
            "assistantId": str(assistant.id),
            "memoryType": "preference",
            "content": "记忆内容A",
            "sourceType": "user_input",
            "sourceId": "msg-1",
        },
    )
    assert created.status_code == 201

    mine = (await client.get("/api/v1/memories/export", headers=auth_headers)).json()
    theirs = (await client.get("/api/v1/memories/export", headers=other_headers)).json()
    assert [item["content"] for item in mine["items"]] == ["记忆内容A"]
    assert mine["exportedAt"]
    assert theirs["items"] == []


async def _local_memory(db, *, user_id: uuid.UUID, fresh_node: bool) -> None:
    """插入一条本地记忆及其承载节点，节点心跳按参数决定是否新鲜。"""

    assistant = await _assistant(db, user_id)
    node = ExecutionNode(
        user_id=user_id,
        name="测试节点1",
        platform="linux",
        app_version="0.0.1",
        capabilities=["memory.search"],
        policy={"allowed_tools": ["memory.search"]},
        status=ExecutionNodeStatus.online if fresh_node else ExecutionNodeStatus.offline,
        last_seen_at=datetime.now(UTC) if fresh_node else None,
    )
    db.add(node)
    await db.flush()
    db.add(
        Memory(
            user_id=user_id,
            assistant_id=assistant.id,
            memory_type=MemoryType.preference,
            content=None,
            source_type="user_input",
            source_id="msg-1",
            storage_location=MemoryStorageLocation.local_node,
            node_id=node.id,
        )
    )
    await db.commit()


@pytest.mark.asyncio
async def test_memory_page_reports_local_content_unreachable_without_a_fresh_node(
    client, db, test_user, auth_headers
):
    """节点离线时，带本地记忆的页面必须如实报告正文读不到。"""

    await _local_memory(db, user_id=test_user.id, fresh_node=False)
    page = (await client.get("/api/v1/memories", headers=auth_headers)).json()
    assert len(page["items"]) == 1
    assert page["localUnavailable"] is True


@pytest.mark.asyncio
async def test_memory_page_stays_available_while_the_node_is_fresh(
    client, db, test_user, auth_headers
):
    """节点在线时不得因为云端 content 为空就报告不可用。"""

    await _local_memory(db, user_id=test_user.id, fresh_node=True)
    page = (await client.get("/api/v1/memories", headers=auth_headers)).json()
    assert page["items"][0]["content"] is None
    assert page["localUnavailable"] is False


@pytest.mark.asyncio
async def test_over_long_search_query_is_rejected_as_invalid_input(
    client, db, test_user, auth_headers
):
    """超长查询必须当场判为非法入参并说出真实上限。

    放行后它会在节点侧失败，对用户显示成「本地记忆不可用」——
    把参数问题伪装成节点故障，让人去排查一台好机器。
    """

    assistant = await _assistant(db, test_user.id)
    at_limit = "查" * MEMORY_SEARCH_MAX_QUERY_CHARS
    accepted = await client.get(
        "/api/v1/memories/search",
        headers=auth_headers,
        params={"assistantId": str(assistant.id), "query": at_limit},
    )
    assert accepted.status_code == 200

    rejected = await client.get(
        "/api/v1/memories/search",
        headers=auth_headers,
        params={"assistantId": str(assistant.id), "query": at_limit + "查"},
    )
    assert rejected.status_code == 422
    # 报错必须点出真实上限，否则用户只知道"不行"而不知道多少才行
    assert str(MEMORY_SEARCH_MAX_QUERY_CHARS) in rejected.text


def test_cloud_declares_the_same_query_ceiling_as_the_node() -> None:
    """云端工具契约声明的查询上限必须与节点的 runMemorySearch 一致。

    节点是唯一真正拦住过长查询的地方；云端声明得更宽，超限查询就会被放行到节点上
    才失败。这条用例在两个数字再次分叉时失败。
    """

    query_schema = MEMORY_SEARCH_SPEC.input_schema["properties"]["query"]
    assert query_schema["maxLength"] == MEMORY_SEARCH_MAX_QUERY_CHARS
    node_jobs = Path(__file__).resolve().parents[3] / "apps/desktop/src/main/execution-node/jobs.ts"
    assert node_jobs.is_file(), "节点任务执行器路径变了，这条跨端约束必须跟着改而不是静默跳过"
    node_source = node_jobs.read_text(encoding="utf-8")
    declared = re.search(r"MAX_MEMORY_SEARCH_QUERY_CHARS = (\d+)", node_source)
    assert declared is not None
    assert int(declared.group(1)) == MEMORY_SEARCH_MAX_QUERY_CHARS


@pytest.mark.asyncio
async def test_export_says_why_local_bodies_are_missing(client, db, test_user, auth_headers):
    """导出必须说明本机正文为何为空，否则用户拿到的是一份没有解释的空壳。"""

    assistant = await _assistant(db, test_user.id)
    db.add(
        Memory(
            user_id=test_user.id,
            assistant_id=assistant.id,
            memory_type=MemoryType.semantic,
            content=None,
            source_type="user_input",
            source_id="source-1",
            storage_location=MemoryStorageLocation.local_node,
        )
    )
    await db.commit()

    exported = await client.get("/api/v1/memories/export", headers=auth_headers)
    assert exported.status_code == 200
    assert exported.json()["localUnavailable"] is True

    node = ExecutionNode(
        user_id=test_user.id,
        name="导出测试节点1",
        platform="linux",
        app_version="0.1.0",
        status=ExecutionNodeStatus.online,
        capabilities=["memory.search"],
        policy={"allowed_tools": ["memory.search"]},
        last_seen_at=datetime.now(UTC),
    )
    db.add(node)
    await db.commit()

    with_node = await client.get("/api/v1/memories/export", headers=auth_headers)
    assert with_node.json()["localUnavailable"] is False


@pytest.mark.asyncio
async def test_cloud_only_export_never_claims_local_trouble(client, db, test_user, auth_headers):
    """只有云端记忆时不得挂上本地不可用标记，也不得为此去查节点。"""

    assistant = await _assistant(db, test_user.id)
    db.add(
        Memory(
            user_id=test_user.id,
            assistant_id=assistant.id,
            memory_type=MemoryType.semantic,
            content="记忆内容A",
            source_type="user_input",
            source_id="source-2",
        )
    )
    await db.commit()

    exported = await client.get("/api/v1/memories/export", headers=auth_headers)
    assert exported.status_code == 200
    assert exported.json()["localUnavailable"] is False
