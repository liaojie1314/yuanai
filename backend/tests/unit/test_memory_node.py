"""本地记忆的节点路由、不可用降级与不可信回包处理测试。"""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assistant import Assistant
from app.models.memory import (
    Memory,
    MemoryStatus,
    MemoryStorageLocation,
    MemoryType,
)
from app.models.tool_runtime import ExecutionNode, ExecutionNodeStatus
from app.models.user import User
from app.schemas.memory import MemoryCreateCandidate, MemoryUpdate
from app.services.memory_node import (
    MEMORY_NODE_APPROVAL_TIMEOUT_SECONDS,
    MEMORY_NODE_TIMEOUT_SECONDS,
    LocalMemoryApprovalTimeoutError,
    LocalMemoryUnavailableError,
    drop_local_memory,
    push_local_memory,
    search_local_memories,
)
from app.services.memory_retrieval import search_active_memories
from app.services.memory_service import create_candidate, delete_memory, update_memory
from app.services.tool_runtime_service import NodeJobOutcome

_MEMORY_TOOLS = ["memory.search", "memory.write", "memory.delete"]


def _stub_outcome(outcome: NodeJobOutcome, calls: list[dict[str, object]] | None = None):
    """构造一个记录调用参数、返回固定结果的 run_node_job 替身。"""

    async def _run(**kwargs: object) -> NodeJobOutcome:
        if calls is not None:
            calls.append(kwargs)
        return outcome

    return _run


async def _fixture(db: AsyncSession, user: User) -> tuple[Assistant, ExecutionNode]:
    """建一个助理和一个心跳新鲜、允许三个记忆作业的桌面节点。"""

    assistant = Assistant(user_id=user.id, name="记忆助理", default_model="test-model")
    node = ExecutionNode(
        user_id=user.id,
        name="测试节点1",
        platform="linux",
        app_version="0.1.0",
        capabilities=list(_MEMORY_TOOLS),
        status=ExecutionNodeStatus.online,
        last_seen_at=datetime.now(UTC),
        policy={"allowed_tools": list(_MEMORY_TOOLS)},
    )
    db.add_all([assistant, node])
    await db.flush()
    return assistant, node


def _local_memory(*, user_id: uuid.UUID, assistant_id: uuid.UUID, **overrides: object) -> Memory:
    """构造一条只存节点的 active 记忆元数据行，云端正文恒为 NULL。"""

    fields: dict[str, object] = {
        "user_id": user_id,
        "assistant_id": assistant_id,
        "memory_type": MemoryType.semantic,
        "content": None,
        "source_type": "user_input",
        "source_id": "source-1",
        "storage_location": MemoryStorageLocation.local_node,
        "status": MemoryStatus.active,
    }
    fields.update(overrides)
    return Memory(**fields)


@pytest.mark.asyncio
async def test_search_reports_unavailable_instead_of_dropping_results(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """节点不在线时必须显式告知不可用，不得静默过滤掉本地记忆。"""

    monkeypatch.setattr(
        "app.services.memory_node.run_node_job",
        _stub_outcome(NodeJobOutcome(status="unavailable")),
    )
    results, unavailable = await search_local_memories(
        user_id=test_user.id, assistant_id=uuid.uuid4(), query="记忆内容A", limit=8, db=db
    )
    assert results == []
    assert unavailable is True


@pytest.mark.asyncio
async def test_search_takes_content_from_the_node_and_metadata_from_the_cloud(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """正文来自节点，敏感度与类型必须来自云端元数据行，节点无法自报身份。"""

    assistant, _node = await _fixture(db, test_user)
    memory = _local_memory(
        user_id=test_user.id, assistant_id=assistant.id, memory_type=MemoryType.profile
    )
    db.add(memory)
    await db.flush()
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(
        "app.services.memory_node.run_node_job",
        _stub_outcome(
            NodeJobOutcome(
                status="succeeded",
                data={
                    "memories": [
                        {"id": str(memory.id), "content": "记忆内容A", "score": 0.9},
                        {"id": str(uuid.uuid4()), "content": "别人的记忆", "score": 1.0},
                    ]
                },
            ),
            calls,
        ),
    )

    results, unavailable = await search_local_memories(
        user_id=test_user.id, assistant_id=assistant.id, query="记忆内容A", limit=8, db=db
    )
    assert unavailable is False
    assert [(result.id, result.content) for result in results] == [(memory.id, "记忆内容A")]
    assert results[0].memory_type is MemoryType.profile
    assert calls[0]["tool_name"] == "memory.search"
    assert calls[0]["arguments"] == {"query": "记忆内容A", "limit": 8}


@pytest.mark.asyncio
async def test_search_truncates_untrusted_node_content(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """节点回传的正文是不可信输入，长度必须被截断而不是原样进入上下文。"""

    assistant, _node = await _fixture(db, test_user)
    memory = _local_memory(user_id=test_user.id, assistant_id=assistant.id)
    db.add(memory)
    await db.flush()
    monkeypatch.setattr(
        "app.services.memory_node.run_node_job",
        _stub_outcome(
            NodeJobOutcome(
                status="succeeded",
                data={"memories": [{"id": str(memory.id), "content": "占" * 20_000}]},
            )
        ),
    )

    results, _unavailable = await search_local_memories(
        user_id=test_user.id, assistant_id=assistant.id, query="占", limit=8, db=db
    )
    assert len(results[0].content) == 10_000
    assert results[0].score == 0.0


@pytest.mark.asyncio
async def test_search_treats_a_malformed_reply_as_unavailable(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """回包形状不对时既拿不到正文也不能假装本地没有记忆。"""

    monkeypatch.setattr(
        "app.services.memory_node.run_node_job",
        _stub_outcome(NodeJobOutcome(status="succeeded", data={"memories": "不是数组"})),
    )
    results, unavailable = await search_local_memories(
        user_id=test_user.id, assistant_id=uuid.uuid4(), query="记忆内容A", limit=8, db=db
    )
    assert results == []
    assert unavailable is True


@pytest.mark.asyncio
async def test_write_fails_loudly_when_no_node_is_online(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """写入本地记忆时节点不可用必须报错，不能退回云端存储。"""

    monkeypatch.setattr(
        "app.services.memory_node.run_node_job",
        _stub_outcome(NodeJobOutcome(status="unavailable")),
    )
    memory = _local_memory(user_id=test_user.id, assistant_id=uuid.uuid4())
    with pytest.raises(LocalMemoryUnavailableError):
        await push_local_memory(memory=memory, content="本地正文A", db=db)


@pytest.mark.asyncio
async def test_delete_fails_when_the_node_rejects_it(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """节点删除失败必须抛错，否则云端删掉元数据后正文永远留在用户磁盘上。"""

    monkeypatch.setattr(
        "app.services.memory_node.run_node_job",
        _stub_outcome(NodeJobOutcome(status="failed", error_code="TOOL_EXECUTION_FAILED")),
    )
    memory = _local_memory(user_id=test_user.id, assistant_id=uuid.uuid4())
    with pytest.raises(LocalMemoryUnavailableError, match="TOOL_EXECUTION_FAILED"):
        await drop_local_memory(memory=memory, db=db)


@pytest.mark.asyncio
async def test_approval_timeout_is_not_reported_as_an_unavailable_node(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """用户没按时批准时必须报审批超时，节点是好的，不能说成节点不可用。"""

    monkeypatch.setattr(
        "app.services.memory_node.run_node_job",
        _stub_outcome(
            NodeJobOutcome(status="approval_timeout", error_code="TOOL_APPROVAL_TIMEOUT")
        ),
    )
    memory = _local_memory(user_id=test_user.id, assistant_id=uuid.uuid4())
    with pytest.raises(LocalMemoryApprovalTimeoutError):
        await drop_local_memory(memory=memory, db=db)


@pytest.mark.asyncio
async def test_approval_wait_does_not_share_the_transport_budget(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """需要人点确认的两个作业必须各自带上独立的审批预算。

    两个预算一旦合成一个，用户手慢就会从健康节点收到「节点不可用」；
    这条用例在它们被重新合并时立刻失败。
    """

    assistant, _node = await _fixture(db, test_user)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(
        "app.services.memory_node.run_node_job",
        _stub_outcome(NodeJobOutcome(status="succeeded", data={"stored": True}), calls),
    )
    memory = _local_memory(user_id=test_user.id, assistant_id=assistant.id)

    await push_local_memory(memory=memory, content="本地正文A", db=db)
    await drop_local_memory(memory=memory, db=db)

    assert len(calls) == 2
    for call in calls:
        assert call["timeout_seconds"] == MEMORY_NODE_TIMEOUT_SECONDS
        assert call["approval_timeout_seconds"] == MEMORY_NODE_APPROVAL_TIMEOUT_SECONDS
    # 人做决定的尺度必须显著大于投递与执行的尺度，否则这个字段等于没拆
    assert MEMORY_NODE_APPROVAL_TIMEOUT_SECONDS > MEMORY_NODE_TIMEOUT_SECONDS * 2


@pytest.mark.asyncio
async def test_create_candidate_keeps_local_content_off_the_cloud(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """local_node 候选的正文只推给节点，云端行只留元数据并记下承载节点。"""

    assistant, node = await _fixture(db, test_user)
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(
        "app.services.memory_node.run_node_job",
        _stub_outcome(NodeJobOutcome(status="succeeded", data={"stored": True}), calls),
    )

    memory = await create_candidate(
        user_id=test_user.id,
        request=MemoryCreateCandidate(
            assistant_id=assistant.id,
            memory_type=MemoryType.semantic,
            content="本地正文A",
            source_type="user_input",
            source_id="source-1",
            storage_location=MemoryStorageLocation.local_node,
        ),
        db=db,
    )
    assert memory.content is None
    assert memory.node_id == node.id
    assert calls[0]["arguments"] == {
        "memoryId": str(memory.id),
        "content": "本地正文A",
        "memoryType": "semantic",
    }


@pytest.mark.asyncio
async def test_create_candidate_leaves_no_row_when_the_node_refuses(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """推送失败不得留下一条没有正文的孤儿元数据行。"""

    assistant, _node = await _fixture(db, test_user)
    monkeypatch.setattr(
        "app.services.memory_node.run_node_job",
        _stub_outcome(NodeJobOutcome(status="timeout", error_code="TOOL_TIMEOUT")),
    )

    with pytest.raises(LocalMemoryUnavailableError):
        await create_candidate(
            user_id=test_user.id,
            request=MemoryCreateCandidate(
                assistant_id=assistant.id,
                memory_type=MemoryType.semantic,
                content="本地正文A",
                source_type="user_input",
                source_id="source-1",
                storage_location=MemoryStorageLocation.local_node,
            ),
            db=db,
        )
    assert (await db.scalars(select(Memory).where(Memory.user_id == test_user.id))).all() == []


@pytest.mark.asyncio
async def test_update_pushes_the_new_content_and_blanks_the_cloud_row(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """改本地记忆正文时新内容进节点，云端仍不落正文也不生成 embedding。"""

    assistant, _node = await _fixture(db, test_user)
    memory = _local_memory(user_id=test_user.id, assistant_id=assistant.id)
    db.add(memory)
    await db.flush()
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(
        "app.services.memory_node.run_node_job",
        _stub_outcome(NodeJobOutcome(status="succeeded", data={"stored": True}), calls),
    )

    updated = await update_memory(
        memory_id=memory.id,
        user_id=test_user.id,
        request=MemoryUpdate(content="本地正文B"),
        db=db,
    )
    assert updated.content is None
    assert updated.embedding is None
    assert calls[0]["arguments"]["content"] == "本地正文B"


@pytest.mark.asyncio
async def test_delete_keeps_the_cloud_row_when_the_node_is_unavailable(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """节点不可用时云端元数据必须原样保留，避免正文成为无人认领的孤儿。"""

    assistant, _node = await _fixture(db, test_user)
    memory = _local_memory(user_id=test_user.id, assistant_id=assistant.id)
    db.add(memory)
    await db.flush()
    monkeypatch.setattr(
        "app.services.memory_node.run_node_job",
        _stub_outcome(NodeJobOutcome(status="unavailable")),
    )

    with pytest.raises(LocalMemoryUnavailableError):
        await delete_memory(memory_id=memory.id, user_id=test_user.id, db=db)
    assert await db.get(Memory, memory.id) is not None


@pytest.mark.asyncio
async def test_retrieval_merges_local_hits_with_the_cloud_arms(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """检索结果必须同时包含云端与节点上的记忆。"""

    assistant, _node = await _fixture(db, test_user)
    cloud = Memory(
        user_id=test_user.id,
        assistant_id=assistant.id,
        memory_type=MemoryType.semantic,
        content="记忆内容A",
        source_type="run",
        status=MemoryStatus.active,
    )
    local = _local_memory(user_id=test_user.id, assistant_id=assistant.id)
    db.add_all([cloud, local])
    await db.flush()
    monkeypatch.setattr(
        "app.services.memory_node.run_node_job",
        _stub_outcome(
            NodeJobOutcome(
                status="succeeded",
                data={"memories": [{"id": str(local.id), "content": "记忆内容B", "score": 9.0}]},
            )
        ),
    )

    outcome = await search_active_memories(
        user_id=test_user.id, assistant_id=assistant.id, query="记忆内容A", db=db
    )
    assert outcome.local_unavailable is False
    assert {result.content for result in outcome.results} == {"记忆内容A", "记忆内容B"}


@pytest.mark.asyncio
async def test_retrieval_reports_local_unavailable_without_hiding_cloud_results(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """节点掉线时云端结果照常返回，但必须带上本地不可用标记。"""

    assistant, _node = await _fixture(db, test_user)
    cloud = Memory(
        user_id=test_user.id,
        assistant_id=assistant.id,
        memory_type=MemoryType.semantic,
        content="记忆内容A",
        source_type="run",
        status=MemoryStatus.active,
    )
    db.add_all([cloud, _local_memory(user_id=test_user.id, assistant_id=assistant.id)])
    await db.flush()
    monkeypatch.setattr(
        "app.services.memory_node.run_node_job",
        _stub_outcome(NodeJobOutcome(status="unavailable")),
    )

    outcome = await search_active_memories(
        user_id=test_user.id, assistant_id=assistant.id, query="记忆内容A", db=db
    )
    assert [result.content for result in outcome.results] == ["记忆内容A"]
    assert outcome.local_unavailable is True


@pytest.mark.asyncio
async def test_retrieval_skips_the_node_when_there_are_no_local_memories(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """没有本地记忆的用户不该为一次云端检索付出节点往返的代价。"""

    assistant, _node = await _fixture(db, test_user)
    db.add(
        Memory(
            user_id=test_user.id,
            assistant_id=assistant.id,
            memory_type=MemoryType.semantic,
            content="记忆内容A",
            source_type="run",
            status=MemoryStatus.active,
        )
    )
    await db.flush()
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(
        "app.services.memory_node.run_node_job",
        _stub_outcome(NodeJobOutcome(status="unavailable"), calls),
    )

    outcome = await search_active_memories(
        user_id=test_user.id, assistant_id=assistant.id, query="记忆内容A", db=db
    )
    assert calls == []
    assert outcome.local_unavailable is False
    assert [result.content for result in outcome.results] == ["记忆内容A"]
