# Memory Extraction and Hybrid Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the memory half of the Phase 7 gap — a background extraction pipeline that turns successful Agent runs into reviewable memories, pgvector-backed hybrid retrieval, and real desktop-node routing for local private memories.

**Architecture:** Extraction runs in its own worker process fed by a Redis list, so a slow or failing model never touches the Agent's critical path. Retrieval filters in SQL first, recalls through two independent arms (PostgreSQL FTS and pgvector ANN), fuses them with Reciprocal Rank Fusion, and reranks with deterministic rules. Memories marked `local_node` keep their content on the user's desktop node and are reached through three new execution-node job types rather than being silently dropped.

**Tech Stack:** FastAPI, async SQLAlchemy 2.0, Alembic, PostgreSQL 16 with pgvector 0.8.6, Redis 7, Pydantic v2, pytest, TypeScript, TanStack Query, Next.js 15, Electron, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-18-memory-extraction-hybrid-search-design.md`

## Global Constraints

- Branch is `feature/memory-extraction-hybrid-search`, cut from `dev`. Do not push, do not merge, do not tag without the user's per-occasion approval.
- One commit per complete logical concern. Not one commit per file, not one commit carrying several concerns.
- Commit messages follow Conventional Commits. Type is one of `feat fix refactor test style chore docs perf ci revert`; scope is one of `web mobile desktop backend ui core types e2e config`. No version-number prefix, no `Co-Authored-By` trailer.
- `ALL_PROXY=socks://…` breaks the Husky hook's corepack pnpm with `Invalid URL protocol`. Commit with `ALL_PROXY= PYTHONPATH= git commit …` on this machine. Never write the proxy or any machine path into a tracked file.
- Never use `--no-verify`.
- Tests are the only licence to move to the next task. Frontend: `pnpm test:unit`. Backend: `cd backend && uv run pytest` — `pnpm test:unit` does not run it.
- All AI calls go through `backend/app/services/ai_service.py`. No new direct provider client anywhere else.
- `packages/` must not import `react-native`, `electron`, or `next/*`.
- Every import must be declared in its own package's `package.json`. Local hoisting hides phantom dependencies that only fail in CI.
- Comments and docstrings are Chinese. Exported TypeScript gets JSDoc; public Python functions get a Chinese docstring plus full type annotations. No progress or phase narration in code comments.
- New user-visible copy goes through the existing i18n resources in both `zh-CN.json` and `en.json`. No hardcoded strings in components.
- Docker images are pinned by tag **and** `sha256` digest. Do not regress to a bare tag.
- New API shapes are mirrored into `packages/types` in the same commit.
- Machine environment problems go to `.codex/environment-issues.md`, never into `docs/`.
- Delivery status is written back to `docs/master-plan.md` §0 in this batch, including debt discovered along the way.

## File Structure

**Backend — new**

| File                                          | Responsibility                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| `backend/app/services/memory_extraction.py`   | Candidate extraction policy: sensitivity, dedup, conflict, activation decision |
| `backend/app/services/memory_queue.py`        | Redis list for extraction jobs; enqueue and dequeue only                       |
| `backend/app/services/memory_node.py`         | Routing of local-node memory reads and writes to the execution node            |
| `backend/app/workers/memory_worker.py`        | Extraction worker process                                                      |
| `backend/app/workers/node_sweeper.py`         | Heartbeat sweeper marking stale nodes offline                                  |
| `backend/tests/support/memory_eval_corpus.py` | Fixed annotated corpus for retrieval evaluation                                |

**Backend — modified**

| File                                                  | Change                                                                                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/app/services/ai_service.py`                  | Gains `embed_text`, `maybe_embed_text`, `extract_memory_candidates`; catalog entries for three Agnes models; image and video model parameterisation |
| `backend/app/services/memory_retrieval.py`            | Two-arm SQL recall, RRF, rule rerank; embedding helpers move out                                                                                    |
| `backend/app/services/memory_service.py`              | Local-node write and delete routing; pagination and export queries                                                                                  |
| `backend/app/services/tool_runtime_service.py`        | Public `run_node_job`, node freshness predicate, `sweep_stale_nodes`                                                                                |
| `backend/app/tools/builtin/desktop.py`                | Three `memory.*` tool specs                                                                                                                         |
| `backend/app/api/v1/memories.py`                      | Cursor pagination, export endpoint                                                                                                                  |
| `backend/app/models/memory.py`, `models/assistant.py` | Vector column, nullable content, `node_id`, `disabled_memory_types`                                                                                 |

**Desktop — new**

| File                                                   | Responsibility                                    |
| ------------------------------------------------------ | ------------------------------------------------- |
| `apps/desktop/src/main/execution-node/memory-store.ts` | Encrypted local memory storage and keyword search |

**Desktop — modified**: `jobs.ts` (three handlers), `service.ts` (capabilities, auto-accept, store wiring), `ExecutionNodeSection.tsx` (capability list).

**Shared and Web — modified**: `packages/types/src/index.ts`, `packages/core/src/api/memories.ts`, `packages/core/src/hooks/useMemories.ts`, `apps/web/src/components/agent/MemoryCenter.tsx`, both locale files.

---

### Task 1: pgvector Image and Vector Columns

Swaps the PostgreSQL image for one carrying the `vector` extension and converts both embedding columns from `JSON` to `vector(1536)` with HNSW indexes. Nothing else in this task; the memory schema changes land in Task 2.

**Files:**

- Modify: `docker-compose.yml:5`
- Modify: `.github/workflows/ci.yml:91`
- Modify: `backend/pyproject.toml` (add `pgvector` dependency)
- Modify: `backend/app/models/memory.py:95`
- Modify: `backend/app/models/knowledge.py:160`
- Create: `backend/alembic/versions/q1a2b3c4d5e6_add_pgvector_columns.py`
- Test: `backend/tests/unit/test_memory_service.py` (existing suite must stay green)

**Interfaces:**

- Consumes: nothing.
- Produces: `Memory.embedding` and `KnowledgeChunk.embedding` typed `Vector(1536)`; migration revision id `q1a2b3c4d5e6` with `down_revision = "p9b1c2d3e4f"`.

- [ ] **Step 1: Pin the new image in both places**

`docker-compose.yml:5` and `.github/workflows/ci.yml:91` both currently name `postgres:16.14-alpine`. Replace with the digest-pinned pgvector image (already pulled and verified locally as pgvector 0.8.6):

```yaml
image: pgvector/pgvector:pg16@sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b
```

The CI service block uses the same value. CI service containers accept a digest-pinned reference.

- [ ] **Step 2: Add the Python dependency**

In `backend/pyproject.toml`, add `"pgvector>=0.3.6"` to the project dependencies, then:

Run: `cd backend && uv sync`
Expected: lockfile updates, `uv run python -c "import pgvector.sqlalchemy"` exits 0.

- [ ] **Step 3: Restart the database on the new image**

Run: `docker compose down postgres && docker compose up -d postgres`
Expected: container healthy. Confirm the extension is installable:
`docker compose exec postgres psql -U yuanai -d yuanai -c "CREATE EXTENSION IF NOT EXISTS vector;"`
Expected: `CREATE EXTENSION`.

- [ ] **Step 4: Write the failing test**

Add to `backend/tests/unit/test_memory_service.py`:

```python
@pytest.mark.asyncio
async def test_embedding_column_round_trips_as_a_pgvector_value(db, test_user: User) -> None:
    """embedding 列迁移到 pgvector 后仍能原样写入和读回。"""

    assistant = await _assistant(db, test_user.id)
    memory = Memory(
        user_id=test_user.id,
        assistant_id=assistant.id,
        memory_type=MemoryType.preference,
        content="向量列往返",
        source_type="user_input",
        embedding=[0.5] * 1536,
    )
    db.add(memory)
    await db.flush()
    db.expire(memory)
    stored = await db.scalar(select(Memory).where(Memory.id == memory.id))
    assert stored is not None
    assert len(list(stored.embedding)) == 1536
```

- [ ] **Step 5: Run it and watch it fail**

Run: `cd backend && uv run pytest tests/unit/test_memory_service.py::test_embedding_column_round_trips_as_a_pgvector_value -v`
Expected: FAIL — the column is still `JSON`, so a 1536-float list round-trips as JSON and the dimension guarantee is untested; after the model change but before the migration it fails with a type mismatch against the live table.

- [ ] **Step 6: Change both model columns**

`backend/app/models/memory.py` — replace the `embedding` mapping:

```python
from pgvector.sqlalchemy import Vector

    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
```

`backend/app/models/knowledge.py:160` takes the identical replacement.

- [ ] **Step 7: Write the migration**

Create `backend/alembic/versions/q1a2b3c4d5e6_add_pgvector_columns.py`:

```python
"""add_pgvector_columns

Revision ID: q1a2b3c4d5e6
Revises: p9b1c2d3e4f
"""

from collections.abc import Sequence

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

from alembic import op

revision: str = "q1a2b3c4d5e6"
down_revision: str | None = "p9b1c2d3e4f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("memories", "knowledge_chunks")


def upgrade() -> None:
    """安装 vector 扩展，把两张表的 embedding 列转成向量列并建 HNSW 索引。"""

    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    for table in _TABLES:
        op.execute(
            f"ALTER TABLE {table} ALTER COLUMN embedding TYPE vector(1536) "
            f"USING CASE WHEN embedding IS NULL THEN NULL "
            f"ELSE (embedding #>> '{{}}')::vector(1536) END"
        )
        op.execute(
            f"CREATE INDEX ix_{table}_embedding_hnsw ON {table} "
            f"USING hnsw (embedding vector_cosine_ops)"
        )


def downgrade() -> None:
    """回退为 JSON 列；扩展本身保留，因为其他对象可能仍在使用。"""

    for table in _TABLES:
        op.execute(f"DROP INDEX IF EXISTS ix_{table}_embedding_hnsw")
        op.execute(
            f"ALTER TABLE {table} ALTER COLUMN embedding TYPE json "
            f"USING CASE WHEN embedding IS NULL THEN NULL "
            f"ELSE to_json(embedding::real[]) END"
        )
```

Rows whose stored JSON array is not 1536 long will abort the migration. That is intentional: silently discarding them would lose user data. If the abort happens, inspect the offending rows before deciding.

- [ ] **Step 8: Apply and verify both directions**

Run: `cd backend && uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head`
Expected: all three succeed. The round trip proves `downgrade` is real rather than decorative.

- [ ] **Step 9: Run the tests**

Run: `cd backend && uv run pytest tests/unit/test_memory_service.py -v`
Expected: PASS, including the new test and every pre-existing one.

Run: `cd backend && uv run pytest`
Expected: PASS. Any knowledge-base test touching embeddings exercises the second migrated column.

- [ ] **Step 10: Commit**

```bash
git add docker-compose.yml .github/workflows/ci.yml backend/pyproject.toml backend/uv.lock \
        backend/app/models/memory.py backend/app/models/knowledge.py \
        backend/alembic/versions/q1a2b3c4d5e6_add_pgvector_columns.py \
        backend/tests/unit/test_memory_service.py
ALL_PROXY= PYTHONPATH= git commit -m "feat(backend): store embeddings in pgvector columns"
```

---

### Task 2: Memory Schema Additions

Adds the three columns the later tasks depend on: nullable `content` for local-node metadata rows, `node_id` naming the owning desktop node, and `disabled_memory_types` on assistants.

**Files:**

- Modify: `backend/app/models/memory.py:72`
- Modify: `backend/app/models/assistant.py:53`
- Modify: `backend/app/schemas/memory.py`
- Modify: `backend/app/schemas/assistant.py`
- Create: `backend/alembic/versions/q2b3c4d5e6f7_add_memory_locality_columns.py`
- Test: `backend/tests/unit/test_memory_service.py`

**Interfaces:**

- Consumes: revision `q1a2b3c4d5e6` from Task 1.
- Produces: `Memory.content: Mapped[str | None]`; `Memory.node_id: Mapped[uuid.UUID | None]`; `Assistant.disabled_memory_types: Mapped[list[str] | None]`; `MemoryResponse.content: str | None`; `AssistantUpdate.disabled_memory_types: list[MemoryType] | None`; migration revision `q2b3c4d5e6f7` with `down_revision = "q1a2b3c4d5e6"`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/unit/test_memory_service.py`:

```python
@pytest.mark.asyncio
async def test_local_node_memory_persists_without_cloud_content(db, test_user: User) -> None:
    """local_node 记忆在云端只留元数据，content 为空并记录归属节点。"""

    assistant = await _assistant(db, test_user.id)
    node_id = uuid.uuid4()
    memory = Memory(
        user_id=test_user.id,
        assistant_id=assistant.id,
        memory_type=MemoryType.profile,
        content=None,
        source_type="user_input",
        storage_location=MemoryStorageLocation.local_node,
        node_id=node_id,
    )
    db.add(memory)
    await db.flush()
    assert memory.content is None
    assert memory.node_id == node_id


@pytest.mark.asyncio
async def test_assistant_can_disable_a_memory_type(db, test_user: User) -> None:
    """助理上的记忆类型开关可持久化，供自动激活策略读取。"""

    assistant = await _assistant(db, test_user.id)
    assistant.disabled_memory_types = [MemoryType.episodic.value]
    await db.flush()
    db.expire(assistant)
    stored = await db.scalar(select(Assistant).where(Assistant.id == assistant.id))
    assert stored is not None
    assert stored.disabled_memory_types == ["episodic"]
```

`MemoryStorageLocation` and `Assistant` need adding to the existing import block at the top of the file.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && uv run pytest tests/unit/test_memory_service.py -k "local_node_memory_persists or disable_a_memory_type" -v`
Expected: FAIL — `content` is `NOT NULL`, and neither `node_id` nor `disabled_memory_types` exists.

- [ ] **Step 3: Change the models**

`backend/app/models/memory.py` — `content` becomes nullable and `node_id` joins it:

```python
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
```

```python
    node_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("execution_nodes.id", ondelete="SET NULL"), nullable=True, index=True
    )
```

The computed `search_vector` currently reads `to_tsvector('simple', content)`; with a nullable column it must coalesce, otherwise the whole vector becomes NULL for local rows:

```python
    search_vector: Mapped[str] = mapped_column(
        TSVECTOR,
        Computed("to_tsvector('simple', coalesce(content, ''))", persisted=True),
        nullable=False,
    )
```

`backend/app/models/assistant.py` gains:

```python
    disabled_memory_types: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
```

with `JSON` added to the SQLAlchemy import line.

- [ ] **Step 4: Write the migration**

Create `backend/alembic/versions/q2b3c4d5e6f7_add_memory_locality_columns.py`:

```python
"""add_memory_locality_columns

Revision ID: q2b3c4d5e6f7
Revises: q1a2b3c4d5e6
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "q2b3c4d5e6f7"
down_revision: str | None = "q1a2b3c4d5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """放开 content 非空约束，登记归属节点与助理的记忆类型开关。"""

    op.alter_column("memories", "content", existing_type=sa.Text(), nullable=True)
    op.execute(
        "ALTER TABLE memories DROP COLUMN search_vector, "
        "ADD COLUMN search_vector tsvector "
        "GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED"
    )
    op.create_index("ix_memories_search_vector", "memories", ["search_vector"], postgresql_using="gin")
    op.add_column("memories", sa.Column("node_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_memories_node_id", "memories", "execution_nodes", ["node_id"], ["id"], ondelete="SET NULL"
    )
    op.create_index("ix_memories_node_id", "memories", ["node_id"])
    op.add_column("assistants", sa.Column("disabled_memory_types", sa.JSON(), nullable=True))


def downgrade() -> None:
    """恢复非空约束前先确认没有仅存元数据的本地记忆。"""

    remaining = op.get_bind().scalar(sa.text("SELECT count(*) FROM memories WHERE content IS NULL"))
    if remaining:
        raise RuntimeError(
            f"{remaining} 条本地记忆没有云端 content，回滚会丢数据；请先导出或改为 cloud 存储"
        )
    op.drop_column("assistants", "disabled_memory_types")
    op.drop_index("ix_memories_node_id", table_name="memories")
    op.drop_constraint("fk_memories_node_id", "memories", type_="foreignkey")
    op.drop_column("memories", "node_id")
    op.execute(
        "ALTER TABLE memories DROP COLUMN search_vector, "
        "ADD COLUMN search_vector tsvector "
        "GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED"
    )
    op.create_index("ix_memories_search_vector", "memories", ["search_vector"], postgresql_using="gin")
    op.alter_column("memories", "content", existing_type=sa.Text(), nullable=False)
```

Dropping and recreating the generated column is the only way to change its expression; PostgreSQL has no `ALTER … SET EXPRESSION` for stored generated columns in 16.

- [ ] **Step 5: Update the schemas**

`backend/app/schemas/memory.py` — `MemoryResponse.content` becomes `str | None`, and `MemoryResponse` gains `node_id: uuid.UUID | None`. `MemoryCreateCandidate.content` stays required: a user creating a memory always supplies text, even when it is destined for the node.

`backend/app/schemas/assistant.py` — `AssistantResponse` and `AssistantUpdate` both gain:

```python
    disabled_memory_types: list[MemoryType] | None = None
```

- [ ] **Step 6: Apply and verify both directions**

Run: `cd backend && uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head`
Expected: all three succeed on a database with no local-node rows.

- [ ] **Step 7: Run the tests**

Run: `cd backend && uv run pytest`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/models/memory.py backend/app/models/assistant.py \
        backend/app/schemas/memory.py backend/app/schemas/assistant.py \
        backend/alembic/versions/q2b3c4d5e6f7_add_memory_locality_columns.py \
        backend/tests/unit/test_memory_service.py
ALL_PROXY= PYTHONPATH= git commit -m "feat(backend): allow memories to live on a desktop node"
```

---

### Task 3: Move Embedding Generation Into ai_service

`embed_text` currently builds its own `AsyncOpenAI` client inside `memory_retrieval.py`, which breaks the rule that every AI call goes through `ai_service.py`. This moves it with no behaviour change, so the later retrieval work starts from a clean call site.

**Files:**

- Modify: `backend/app/services/ai_service.py`
- Modify: `backend/app/services/memory_retrieval.py:24-53`
- Modify: `backend/app/services/memory_service.py:14`
- Modify: `backend/app/services/knowledge_service.py:27`
- Modify: `backend/app/api/v1/memories.py:17`
- Modify: `backend/app/services/agent/coordinator.py:58`
- Test: `backend/tests/unit/test_ai_service.py`

**Interfaces:**

- Consumes: nothing.
- Produces: `ai_service.EMBEDDING_MODEL: str`; `ai_service.EmbeddingUnavailableError`; `async ai_service.embed_text(text: str) -> list[float]`; `async ai_service.maybe_embed_text(text: str) -> list[float] | None`. `memory_retrieval` re-exports nothing — every caller imports from `ai_service`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/unit/test_ai_service.py`:

```python
@pytest.mark.asyncio
async def test_embed_text_refuses_to_run_without_an_approved_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """没有 OpenAI 密钥时必须显式失败，不得降级到其他模型。"""

    monkeypatch.setattr(ai_service.settings, "openai_api_key", "  ")
    with pytest.raises(ai_service.EmbeddingUnavailableError):
        await ai_service.embed_text("记住我偏好中文")


@pytest.mark.asyncio
async def test_maybe_embed_text_returns_none_instead_of_raising(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """maybe_embed_text 在 provider 不可用时返回 None，让检索退化为关键词。"""

    monkeypatch.setattr(ai_service.settings, "openai_api_key", "")
    assert await ai_service.maybe_embed_text("记住我偏好中文") is None
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && uv run pytest tests/unit/test_ai_service.py -k embed_text -v`
Expected: FAIL with `AttributeError: module 'app.services.ai_service' has no attribute 'embed_text'`.

- [ ] **Step 3: Move the code**

Cut `EMBEDDING_MODEL`, `EmbeddingUnavailableError`, `embed_text`, and `maybe_embed_text` out of `backend/app/services/memory_retrieval.py:24-53` and paste them into `backend/app/services/ai_service.py` next to `generate_conversation_title`, unchanged apart from reusing the module's existing `AsyncOpenAI` import:

```python
EMBEDDING_MODEL = "text-embedding-3-small"


class EmbeddingUnavailableError(Exception):
    """未配置或不可用的 embedding provider 不得降级到其他模型。"""


async def embed_text(text: str) -> list[float]:
    """调用已批准的 OpenAI embedding 模型；缺少密钥时显式失败。"""

    if not settings.openai_api_key.strip():
        raise EmbeddingUnavailableError("OPENAI_API_KEY 未配置")
    try:
        async with AsyncOpenAI(api_key=settings.openai_api_key) as client:
            response = await client.embeddings.create(input=text, model=EMBEDDING_MODEL)
    except OpenAIError as error:
        raise EmbeddingUnavailableError("embedding provider 不可用") from error
    if not response.data or not response.data[0].embedding:
        raise EmbeddingUnavailableError("embedding provider 返回空向量")
    return list(response.data[0].embedding)


async def maybe_embed_text(text: str) -> list[float] | None:
    """仅使用已批准的 provider 生成向量；不可用时保留关键词检索。"""

    try:
        return await embed_text(text)
    except EmbeddingUnavailableError:
        return None
```

- [ ] **Step 4: Repoint every caller**

Five import sites move from `app.services.memory_retrieval` to `app.services.ai_service`:

- `backend/app/services/memory_service.py:14`
- `backend/app/services/knowledge_service.py:27`
- `backend/app/api/v1/memories.py:17` (leave `search_active_memories` importing from `memory_retrieval`)
- `backend/app/services/agent/coordinator.py:58`
- `backend/app/services/memory_retrieval.py` itself, which now imports `maybe_embed_text` only if it still needs it

Run: `cd backend && uv run python -c "import app.main"` to catch a circular import early. `ai_service` must not import `memory_retrieval`.

- [ ] **Step 5: Run the tests**

Run: `cd backend && uv run pytest && uv run ruff check . && uv run mypy .`
Expected: PASS on all three. Existing tests that monkeypatch `memory_retrieval.maybe_embed_text` now patch the wrong module and must be repointed — fix them as part of this task rather than leaving them green by accident.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/ai_service.py backend/app/services/memory_retrieval.py \
        backend/app/services/memory_service.py backend/app/services/knowledge_service.py \
        backend/app/api/v1/memories.py backend/app/services/agent/coordinator.py \
        backend/tests/
ALL_PROXY= PYTHONPATH= git commit -m "refactor(backend): route embedding generation through ai_service"
```

---

### Task 4: Hybrid Retrieval with RRF and Rule Rerank

Replaces the in-process full scan with two SQL recall arms fused by Reciprocal Rank Fusion, then reranked by deterministic rules. This is the M2 payoff and the reason Task 1 existed.

**Files:**

- Modify: `backend/app/services/memory_retrieval.py:56-159`
- Modify: `backend/app/schemas/memory.py`
- Modify: `backend/app/api/v1/memories.py:57-76`
- Modify: `backend/app/services/agent/coordinator.py:530-548`
- Test: `backend/tests/unit/test_memory_retrieval.py` (new file)

**Interfaces:**

- Consumes: `ai_service.maybe_embed_text` (Task 3); `Vector(1536)` columns (Task 1).
- Produces:
  - `MemorySearchOutcome(results: list[MemorySearchResult], local_unavailable: bool)` in `app/schemas/memory.py`
  - `async search_active_memories(*, user_id, assistant_id, query, db, workspace_id=None, query_embedding=None, limit=8, now=None) -> MemorySearchOutcome`
  - `fuse_rankings(*ranked_id_lists: Sequence[uuid.UUID], k: int = 60) -> dict[uuid.UUID, float]`
  - `apply_rule_rerank(scored: Sequence[tuple[float, Memory]], *, now: datetime) -> list[tuple[float, Memory]]`
  - `RRF_K: int = 60`

The return-type change from `list[MemorySearchResult]` to `MemorySearchOutcome` is breaking. Both callers are updated here. `local_unavailable` is always `False` until Task 9 wires node routing.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_memory_retrieval.py`:

```python
"""混合检索的融合、重排与召回边界测试。"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.models.assistant import Assistant
from app.models.memory import Memory, MemorySensitivity, MemoryStatus, MemoryType
from app.models.user import User
from app.services.memory_retrieval import (
    RRF_K,
    apply_rule_rerank,
    fuse_rankings,
    search_active_memories,
)


def test_fuse_rankings_rewards_agreement_between_arms() -> None:
    """两路都排在前面的文档必须压过只有单路命中的文档。"""

    both = uuid.uuid4()
    keyword_only = uuid.uuid4()
    vector_only = uuid.uuid4()
    fused = fuse_rankings([both, keyword_only], [both, vector_only])
    assert fused[both] == pytest.approx(2 / (RRF_K + 1))
    assert fused[both] > fused[keyword_only]
    assert fused[keyword_only] == pytest.approx(1 / (RRF_K + 2))


def test_fuse_rankings_ignores_an_empty_arm() -> None:
    """没有 embedding 时向量臂为空，融合结果等价于纯关键词排序。"""

    first, second = uuid.uuid4(), uuid.uuid4()
    fused = fuse_rankings([first, second], [])
    assert fused[first] > fused[second]


def test_rule_rerank_prefers_confident_and_recently_used_memories() -> None:
    """同样的融合分下，置信度高且近期用过的记忆排在前面。"""

    now = datetime.now(UTC)
    stale = Memory(
        id=uuid.uuid4(),
        memory_type=MemoryType.preference,
        content="旧偏好",
        source_type="run",
        confidence=0.2,
        last_used_at=now - timedelta(days=200),
        created_at=now - timedelta(days=200),
    )
    fresh = Memory(
        id=uuid.uuid4(),
        memory_type=MemoryType.profile,
        content="新身份事实",
        source_type="run",
        confidence=0.9,
        last_used_at=now - timedelta(hours=1),
        created_at=now - timedelta(hours=1),
    )
    ranked = apply_rule_rerank([(0.5, stale), (0.5, fresh)], now=now)
    assert [memory.id for _, memory in ranked] == [fresh.id, stale.id]


@pytest.mark.asyncio
async def test_search_filters_sensitive_and_foreign_memories_in_sql(
    db, test_user: User
) -> None:
    """敏感记忆和其他助理的记忆不得进入召回集合。"""

    assistant = Assistant(user_id=test_user.id, name="记忆", default_model="test-model")
    other = Assistant(user_id=test_user.id, name="另一个", default_model="test-model")
    db.add_all([assistant, other])
    await db.flush()
    db.add_all(
        [
            Memory(
                user_id=test_user.id,
                assistant_id=assistant.id,
                memory_type=MemoryType.preference,
                content="用户偏好中文输出",
                source_type="run",
                status=MemoryStatus.active,
            ),
            Memory(
                user_id=test_user.id,
                assistant_id=assistant.id,
                memory_type=MemoryType.profile,
                content="用户的中文护照号",
                source_type="run",
                status=MemoryStatus.active,
                sensitivity=MemorySensitivity.sensitive,
            ),
            Memory(
                user_id=test_user.id,
                assistant_id=other.id,
                memory_type=MemoryType.preference,
                content="中文",
                source_type="run",
                status=MemoryStatus.active,
            ),
        ]
    )
    await db.flush()
    outcome = await search_active_memories(
        user_id=test_user.id, assistant_id=assistant.id, query="中文", db=db
    )
    assert [result.content for result in outcome.results] == ["用户偏好中文输出"]
    assert outcome.local_unavailable is False
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && uv run pytest tests/unit/test_memory_retrieval.py -v`
Expected: FAIL — `fuse_rankings`, `apply_rule_rerank`, `RRF_K` do not exist, and `search_active_memories` returns a list with no `.results`.

- [ ] **Step 3: Add the outcome schema**

In `backend/app/schemas/memory.py`:

```python
class MemorySearchOutcome(MemorySchema):
    """检索结果及本地节点可用性，供上下文组装区分空结果与不可用。"""

    results: list[MemorySearchResult]
    local_unavailable: bool = False
```

- [ ] **Step 4: Rewrite the retrieval module**

Replace the body of `backend/app/services/memory_retrieval.py` below the imports:

```python
RRF_K = 60
_RECALL_MULTIPLIER = 4
_HALF_LIFE_DAYS = 90.0
_TYPE_WEIGHTS: dict[MemoryType, float] = {
    MemoryType.profile: 1.15,
    MemoryType.preference: 1.10,
    MemoryType.semantic: 1.0,
    MemoryType.episodic: 0.9,
}


def _accessible_filters(
    *,
    user_id: uuid.UUID,
    assistant_id: uuid.UUID,
    workspace_id: uuid.UUID | None,
    current_time: datetime,
) -> list[ColumnElement[bool]]:
    """构造租户、助理、生命周期与时效的 SQL 过滤条件。

    权限过滤必须下推到 SQL：先跨租户召回再在应用层过滤是被明确禁止的。
    """

    filters: list[ColumnElement[bool]] = [
        Memory.user_id == user_id,
        Memory.assistant_id == assistant_id,
        Memory.status == MemoryStatus.active,
        Memory.sensitivity.not_in((MemorySensitivity.sensitive, MemorySensitivity.restricted)),
        Memory.valid_from.is_(None) | (Memory.valid_from <= current_time),
        Memory.valid_until.is_(None) | (Memory.valid_until > current_time),
        Memory.storage_location == MemoryStorageLocation.cloud,
    ]
    if workspace_id is not None:
        filters.append(or_(Memory.workspace_id == workspace_id, Memory.workspace_id.is_(None)))
    else:
        filters.append(Memory.workspace_id.is_(None))
    return filters


def fuse_rankings(*ranked_id_lists: Sequence[uuid.UUID], k: int = RRF_K) -> dict[uuid.UUID, float]:
    """按 Reciprocal Rank Fusion 合并多路召回的排名。

    RRF 只消费名次，因此关键词分数与向量距离这两种不可比的量纲永远不会混算。
    """

    fused: dict[uuid.UUID, float] = {}
    for ranked in ranked_id_lists:
        for rank, identifier in enumerate(ranked, start=1):
            fused[identifier] = fused.get(identifier, 0.0) + 1.0 / (k + rank)
    return fused


def apply_rule_rerank(
    scored: Sequence[tuple[float, Memory]], *, now: datetime
) -> list[tuple[float, Memory]]:
    """用置信度、新鲜度和记忆类型做确定性重排。

    阶段文档禁止只按 embedding 距离排序；规则重排在不引入第二次模型调用的前提下满足该要求。
    """

    adjusted: list[tuple[float, Memory]] = []
    for score, memory in scored:
        reference = memory.last_used_at or memory.created_at
        age_days = max((now - reference).total_seconds() / 86400.0, 0.0) if reference else 0.0
        recency = 0.5 ** (age_days / _HALF_LIFE_DAYS)
        confidence = 0.5 + 0.5 * max(0.0, min(1.0, memory.confidence))
        weight = _TYPE_WEIGHTS.get(memory.memory_type, 1.0)
        adjusted.append((score * confidence * weight * (0.6 + 0.4 * recency), memory))
    return sorted(adjusted, key=lambda item: item[0], reverse=True)


async def search_active_memories(
    *,
    user_id: uuid.UUID,
    assistant_id: uuid.UUID,
    query: str,
    db: AsyncSession,
    workspace_id: uuid.UUID | None = None,
    query_embedding: Sequence[float] | None = None,
    limit: int = 8,
    now: datetime | None = None,
) -> MemorySearchOutcome:
    """先过滤后召回，融合关键词与向量两路并重排，返回可进入上下文的记忆。"""

    if limit < 1:
        return MemorySearchOutcome(results=[], local_unavailable=False)
    current_time = now or datetime.now(UTC)
    filters = _accessible_filters(
        user_id=user_id,
        assistant_id=assistant_id,
        workspace_id=workspace_id,
        current_time=current_time,
    )
    recall = limit * _RECALL_MULTIPLIER

    fts_query = func.plainto_tsquery("simple", query)
    keyword_rows = await db.execute(
        select(Memory.id)
        .where(*filters, Memory.search_vector.op("@@")(fts_query))
        .order_by(func.ts_rank(Memory.search_vector, fts_query).desc(), Memory.updated_at.desc())
        .limit(recall)
    )
    keyword_ids = [row[0] for row in keyword_rows]

    vector_ids: list[uuid.UUID] = []
    if query_embedding is not None:
        vector_rows = await db.execute(
            select(Memory.id)
            .where(*filters, Memory.embedding.is_not(None))
            .order_by(Memory.embedding.cosine_distance(list(query_embedding)))
            .limit(recall)
        )
        vector_ids = [row[0] for row in vector_rows]

    fused = fuse_rankings(keyword_ids, vector_ids)
    if not fused:
        return MemorySearchOutcome(results=[], local_unavailable=False)
    memories = {
        memory.id: memory
        for memory in (await db.scalars(select(Memory).where(Memory.id.in_(fused)))).all()
    }
    ranked = apply_rule_rerank(
        [(score, memories[identifier]) for identifier, score in fused.items() if identifier in memories],
        now=current_time,
    )[:limit]
    for _, memory in ranked:
        memory.last_used_at = current_time
    await db.flush()
    return MemorySearchOutcome(
        results=[
            MemorySearchResult(
                id=memory.id,
                assistant_id=memory.assistant_id,
                workspace_id=memory.workspace_id,
                memory_type=memory.memory_type,
                content=memory.content or "",
                source_type=memory.source_type,
                source_id=memory.source_id,
                source_excerpt=memory.source_excerpt,
                confidence=memory.confidence,
                sensitivity=memory.sensitivity,
                status=memory.status,
                score=score,
            )
            for score, memory in ranked
        ],
        local_unavailable=False,
    )
```

Imports at the top of the module become: `uuid`, `Sequence` from `collections.abc`, `UTC`/`datetime` from `datetime`, `func`/`or_`/`select` and `ColumnElement` from SQLAlchemy, the four memory enums plus `MemoryType`, and `MemorySearchOutcome` alongside the existing schema imports. `math`, `re`, the `_TOKEN_PATTERN`, `_terms`, `_score`, and `_cosine_similarity` are all deleted — the fusion replaces them.

- [ ] **Step 5: Update both callers**

`backend/app/api/v1/memories.py` — the search endpoint returns `MemorySearchOutcome` now:

```python
@router.get("/search", response_model=MemorySearchOutcome)
async def search_memories(...) -> MemorySearchOutcome:
    """检索可安全进入当前助理上下文的 active 记忆。"""

    return await search_active_memories(...)
```

`backend/app/services/agent/coordinator.py:538` unwraps it:

```python
            outcome = await search_active_memories(...)
        except SQLAlchemyError:
            return []
        return to_context_items(outcome.results)
```

- [ ] **Step 6: Run the tests**

Run: `cd backend && uv run pytest tests/unit/test_memory_retrieval.py tests/unit/test_memory_service.py tests/integration/test_memories.py -v`
Expected: PASS. Fix any pre-existing test that asserted on the old list return.

Run: `cd backend && uv run pytest && uv run ruff check . && uv run mypy .`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/memory_retrieval.py backend/app/schemas/memory.py \
        backend/app/api/v1/memories.py backend/app/services/agent/coordinator.py \
        backend/tests/
ALL_PROXY= PYTHONPATH= git commit -m "feat(backend): rank memories with RRF over FTS and vector recall"
```

---

### Task 5: Extraction Model Call

Adds the single `ai_service` entry point the extraction worker needs. It follows `generate_conversation_title` exactly: one fixed model, a hard timeout, and `None` on every failure path so the caller never has to distinguish provider problems from an empty result.

**Files:**

- Modify: `backend/app/services/ai_service.py`
- Test: `backend/tests/unit/test_ai_service.py`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `@dataclass(frozen=True) ExtractedMemory` with fields `memory_type: str`, `content: str`, `subject: str`, `confidence: float`, `explicit: bool`, `stable: bool`
  - `async extract_memory_candidates(*, goal: str, transcript: str) -> list[ExtractedMemory] | None`
  - `MEMORY_EXTRACTION_MODEL = "agnes-2.5-flash"`, `MEMORY_EXTRACTION_TIMEOUT_SECONDS = 20`

`None` means "the model could not be consulted". An empty list means "consulted, nothing worth remembering". The worker treats both as no-op but the distinction is logged.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/unit/test_ai_service.py`:

```python
@pytest.mark.asyncio
async def test_extract_memory_candidates_returns_none_without_a_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """未配置 Agnes 密钥时不得抛出，抽取只是静默跳过。"""

    monkeypatch.setattr(ai_service.settings, "agnes_api_key", "")
    assert await ai_service.extract_memory_candidates(goal="订机票", transcript="") is None


@pytest.mark.asyncio
async def test_extract_memory_candidates_parses_the_model_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """模型返回的 JSON 被解析成结构化候选，未知字段按默认值兜底。"""

    payload = (
        '{"memories": [{"memoryType": "preference", "content": "偏好靠窗座位", '
        '"subject": "座位偏好", "confidence": 0.8, "explicit": true, "stable": true}]}'
    )
    monkeypatch.setattr(ai_service.settings, "agnes_api_key", "test-key")
    monkeypatch.setattr(ai_service, "_get_client", lambda *_: _StubChatClient(payload))
    candidates = await ai_service.extract_memory_candidates(goal="订机票", transcript="我要靠窗")
    assert candidates is not None
    assert candidates[0].content == "偏好靠窗座位"
    assert candidates[0].memory_type == "preference"
    assert candidates[0].explicit is True


@pytest.mark.asyncio
async def test_extract_memory_candidates_returns_none_on_malformed_json(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """模型返回非 JSON 时视为不可用，绝不写入半成品候选。"""

    monkeypatch.setattr(ai_service.settings, "agnes_api_key", "test-key")
    monkeypatch.setattr(ai_service, "_get_client", lambda *_: _StubChatClient("not json at all"))
    assert await ai_service.extract_memory_candidates(goal="订机票", transcript="我要靠窗") is None
```

`_StubChatClient` is a small helper at the top of the test file:

```python
class _StubChatClient:
    """返回固定 completion 内容的最小 chat 客户端替身。"""

    def __init__(self, content: str) -> None:
        message = SimpleNamespace(content=content)
        choice = SimpleNamespace(message=message, finish_reason="stop")
        completion = SimpleNamespace(choices=[choice])
        self.chat = SimpleNamespace(
            completions=SimpleNamespace(create=AsyncMock(return_value=completion))
        )
```

with `from types import SimpleNamespace` and `from unittest.mock import AsyncMock` imported.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && uv run pytest tests/unit/test_ai_service.py -k extract_memory -v`
Expected: FAIL with `AttributeError: … has no attribute 'extract_memory_candidates'`.

- [ ] **Step 3: Implement it**

Add to `backend/app/services/ai_service.py`, beside `generate_conversation_title`:

```python
MEMORY_EXTRACTION_MODEL = "agnes-2.5-flash"
MEMORY_EXTRACTION_TIMEOUT_SECONDS = 20
MEMORY_EXTRACTION_MAX_TOKENS = 1024
MEMORY_EXTRACTION_PROMPT = (
    "你是记忆抽取器。阅读用户与助理的一次任务记录，只提取值得长期记住的用户事实。"
    "只输出 JSON，形如 {\"memories\": [...]}，每项包含 memoryType"
    "（profile/preference/semantic/episodic 之一）、content（一句中文陈述）、"
    "subject（该事实所描述的对象，用于冲突检测）、confidence（0 到 1）、"
    "explicit（用户是否明确说过）、stable（是否长期稳定而非临时状态）。"
    "没有值得记住的内容时输出 {\"memories\": []}。不要输出解释。"
)


@dataclass(frozen=True)
class ExtractedMemory:
    """模型抽取出的单条候选记忆。"""

    memory_type: str
    content: str
    subject: str
    confidence: float
    explicit: bool
    stable: bool


def _parse_extracted_memories(content: str) -> list[ExtractedMemory] | None:
    """解析抽取模型的 JSON 输出，结构不符时整体作废。"""

    try:
        payload = json.loads(content)
    except (TypeError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    items = payload.get("memories")
    if not isinstance(items, list):
        return None
    parsed: list[ExtractedMemory] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        text = item.get("content")
        memory_type = item.get("memoryType")
        if not isinstance(text, str) or not text.strip():
            continue
        if memory_type not in {"profile", "preference", "semantic", "episodic"}:
            continue
        subject = item.get("subject")
        confidence = item.get("confidence")
        parsed.append(
            ExtractedMemory(
                memory_type=memory_type,
                content=text.strip(),
                subject=subject.strip() if isinstance(subject, str) and subject.strip() else text.strip(),
                confidence=min(1.0, max(0.0, float(confidence))) if isinstance(confidence, int | float) else 0.0,
                explicit=bool(item.get("explicit")),
                stable=bool(item.get("stable")),
            )
        )
    return parsed


async def extract_memory_candidates(
    *, goal: str, transcript: str
) -> list[ExtractedMemory] | None:
    """从一次成功的 Run 中抽取候选记忆；不可用或输出异常时返回 ``None``。

    返回 ``None`` 表示模型没能给出结果，空列表表示模型认为没有值得记住的内容。
    调用方对两者都不写库，但日志需要区分。
    """

    if not settings.agnes_api_key or not goal.strip():
        return None
    config = PROVIDER_CONFIG[MEMORY_EXTRACTION_MODEL]
    client = _get_client(config["provider"], config["base_url"])
    messages = cast(
        list[ChatCompletionMessageParam],
        [
            {"role": "system", "content": MEMORY_EXTRACTION_PROMPT},
            {"role": "user", "content": f"任务目标：{goal.strip()}\n\n任务记录：\n{transcript.strip()}"},
        ],
    )
    try:
        async with asyncio.timeout(MEMORY_EXTRACTION_TIMEOUT_SECONDS):
            completion = await client.chat.completions.create(
                model=MEMORY_EXTRACTION_MODEL,
                messages=messages,
                temperature=0,
                max_tokens=MEMORY_EXTRACTION_MAX_TOKENS,
                extra_body={"chat_template_kwargs": {"enable_thinking": False}},
            )
    except (TimeoutError, OpenAIError, httpx.HTTPError, TypeError, ValueError):
        return None
    if not completion.choices:
        return None
    content = completion.choices[0].message.content
    if not isinstance(content, str):
        return None
    return _parse_extracted_memories(content)
```

`json` and `dataclass` are already imported by the module; confirm before adding duplicates.

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/unit/test_ai_service.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/ai_service.py backend/tests/unit/test_ai_service.py
ALL_PROXY= PYTHONPATH= git commit -m "feat(backend): add the memory extraction model call"
```

---

### Task 6: Extraction Policy Service

The decision layer between the model's raw candidates and the database: sensitivity grading, deduplication, conflict detection, and the five-condition activation gate. Pure policy, no I/O beyond the session, so every branch is unit-testable.

**Files:**

- Create: `backend/app/services/memory_extraction.py`
- Test: `backend/tests/unit/test_memory_extraction.py` (new file)

**Interfaces:**

- Consumes: `ai_service.ExtractedMemory`, `ai_service.extract_memory_candidates`, `ai_service.maybe_embed_text` (Tasks 3 and 5); `Assistant.disabled_memory_types` (Task 2).
- Produces:
  - `classify_sensitivity(content: str) -> MemorySensitivity`
  - `async find_duplicate(*, user_id, assistant_id, content, db) -> Memory | None`
  - `async find_conflict(*, user_id, assistant_id, subject, db) -> Memory | None`
  - `decide_status(candidate: ExtractedMemory, *, sensitivity: MemorySensitivity, conflict: Memory | None, disabled_types: set[str]) -> MemoryStatus | None`
  - `async extract_from_run(*, run_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession) -> list[Memory]`
  - `SENSITIVE_PATTERNS: tuple[re.Pattern[str], ...]`

`decide_status` returning `None` means discard.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_memory_extraction.py`:

```python
"""记忆抽取的分级、去重、冲突与激活策略测试。"""

import uuid

import pytest

from app.models.assistant import Assistant
from app.models.memory import Memory, MemorySensitivity, MemoryStatus, MemoryType
from app.models.user import User
from app.services.ai_service import ExtractedMemory
from app.services.memory_extraction import (
    classify_sensitivity,
    decide_status,
    find_conflict,
    find_duplicate,
)


def _candidate(**overrides: object) -> ExtractedMemory:
    """构造一条默认满足全部自动激活条件的候选。"""

    values: dict[str, object] = {
        "memory_type": "preference",
        "content": "偏好靠窗座位",
        "subject": "座位偏好",
        "confidence": 0.9,
        "explicit": True,
        "stable": True,
    }
    values.update(overrides)
    return ExtractedMemory(**values)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        ("偏好靠窗座位", MemorySensitivity.personal),
        ("身份证号是 110101199003077777", MemorySensitivity.sensitive),
        ("银行卡号 6222021234567890123", MemorySensitivity.sensitive),
        ("邮箱是 someone@example.com", MemorySensitivity.sensitive),
        ("手机号 13800138000", MemorySensitivity.sensitive),
    ],
)
def test_classify_sensitivity_flags_personally_identifying_content(
    content: str, expected: MemorySensitivity
) -> None:
    """含身份证、银行卡、邮箱或手机号的内容必须升级为 sensitive。"""

    assert classify_sensitivity(content) is expected


def test_decide_status_auto_activates_only_when_every_condition_holds() -> None:
    """五个条件全部满足才自动激活。"""

    assert (
        decide_status(
            _candidate(), sensitivity=MemorySensitivity.personal, conflict=None, disabled_types=set()
        )
        is MemoryStatus.active
    )


@pytest.mark.parametrize(
    ("candidate", "sensitivity", "conflict", "disabled"),
    [
        (_candidate(explicit=False), MemorySensitivity.personal, None, set()),
        (_candidate(stable=False), MemorySensitivity.personal, None, set()),
        (_candidate(), MemorySensitivity.sensitive, None, set()),
        (_candidate(), MemorySensitivity.personal, Memory(id=uuid.uuid4()), set()),
        (_candidate(), MemorySensitivity.personal, None, {"preference"}),
    ],
)
def test_decide_status_falls_back_to_candidate_when_any_condition_fails(
    candidate: ExtractedMemory,
    sensitivity: MemorySensitivity,
    conflict: Memory | None,
    disabled: set[str],
) -> None:
    """任一条件不满足都只能进入 candidate，歧义一律不自动激活。"""

    status = decide_status(
        candidate, sensitivity=sensitivity, conflict=conflict, disabled_types=disabled
    )
    assert status is MemoryStatus.candidate


def test_decide_status_discards_a_disabled_type_that_cannot_even_be_reviewed() -> None:
    """用户关闭的记忆类型连候选都不产生。"""

    assert (
        decide_status(
            _candidate(memory_type="episodic"),
            sensitivity=MemorySensitivity.personal,
            conflict=None,
            disabled_types={"episodic"},
        )
        is None
    )


@pytest.mark.asyncio
async def test_find_duplicate_matches_normalized_content(db, test_user: User) -> None:
    """标点和空白差异不应产生重复记忆。"""

    assistant = Assistant(user_id=test_user.id, name="记忆", default_model="test-model")
    db.add(assistant)
    await db.flush()
    db.add(
        Memory(
            user_id=test_user.id,
            assistant_id=assistant.id,
            memory_type=MemoryType.preference,
            content="偏好靠窗座位",
            source_type="run",
            status=MemoryStatus.active,
        )
    )
    await db.flush()
    found = await find_duplicate(
        user_id=test_user.id, assistant_id=assistant.id, content=" 偏好靠窗座位。 ", db=db
    )
    assert found is not None


@pytest.mark.asyncio
async def test_find_conflict_only_looks_at_active_memories_on_the_same_subject(
    db, test_user: User
) -> None:
    """冲突检测按 subject 匹配，且只与 active 记忆比较。"""

    assistant = Assistant(user_id=test_user.id, name="记忆", default_model="test-model")
    db.add(assistant)
    await db.flush()
    db.add_all(
        [
            Memory(
                user_id=test_user.id,
                assistant_id=assistant.id,
                memory_type=MemoryType.preference,
                content="偏好过道座位",
                structured_data={"subject": "座位偏好"},
                source_type="run",
                status=MemoryStatus.active,
            ),
            Memory(
                user_id=test_user.id,
                assistant_id=assistant.id,
                memory_type=MemoryType.preference,
                content="偏好前排座位",
                structured_data={"subject": "座位偏好"},
                source_type="run",
                status=MemoryStatus.rejected,
            ),
        ]
    )
    await db.flush()
    conflict = await find_conflict(
        user_id=test_user.id, assistant_id=assistant.id, subject="座位偏好", db=db
    )
    assert conflict is not None
    assert conflict.content == "偏好过道座位"
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && uv run pytest tests/unit/test_memory_extraction.py -v`
Expected: FAIL — `app.services.memory_extraction` does not exist.

- [ ] **Step 3: Implement the policy module**

Create `backend/app/services/memory_extraction.py`:

```python
"""从成功的 Agent Run 抽取候选记忆，并决定其敏感度与生命周期。"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.agent_run import AgentRun
from app.models.assistant import Assistant
from app.models.memory import (
    Memory,
    MemorySensitivity,
    MemoryStatus,
    MemoryType,
)
from app.services.ai_service import (
    ExtractedMemory,
    extract_memory_candidates,
    maybe_embed_text,
)

logger = logging.getLogger(__name__)

SENSITIVE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\b\d{17}[\dXx]\b"),                      # 身份证
    re.compile(r"\b\d{16,19}\b"),                          # 银行卡
    re.compile(r"\b1[3-9]\d{9}\b"),                        # 中国大陆手机号
    re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"),               # 邮箱
    re.compile(r"(?:密码|口令|密钥|token|secret)", re.I),   # 凭据字样
)
_PUNCTUATION = re.compile(r"[\s，。；、,.;!?！？　]+")
TRANSCRIPT_STEP_LIMIT = 20
TRANSCRIPT_CHAR_LIMIT = 6000


def classify_sensitivity(content: str) -> MemorySensitivity:
    """按 PII 与凭据特征给内容定级；命中任一模式即为 sensitive。"""

    for pattern in SENSITIVE_PATTERNS:
        if pattern.search(content):
            return MemorySensitivity.sensitive
    return MemorySensitivity.personal


def _normalize(content: str) -> str:
    """去掉空白与中英文标点，用于判断两条记忆是否实质相同。"""

    return _PUNCTUATION.sub("", content).lower()


async def find_duplicate(
    *, user_id: uuid.UUID, assistant_id: uuid.UUID, content: str, db: AsyncSession
) -> Memory | None:
    """查找同一助理下内容实质相同的记忆，避免反复写入同一事实。"""

    target = _normalize(content)
    existing = await db.scalars(
        select(Memory).where(
            Memory.user_id == user_id,
            Memory.assistant_id == assistant_id,
            Memory.status.in_((MemoryStatus.active, MemoryStatus.candidate)),
        )
    )
    for memory in existing:
        if memory.content and _normalize(memory.content) == target:
            return memory
    return None


async def find_conflict(
    *, user_id: uuid.UUID, assistant_id: uuid.UUID, subject: str, db: AsyncSession
) -> Memory | None:
    """查找同一主题上已生效的记忆，作为新事实的被取代对象。"""

    if not subject.strip():
        return None
    return await db.scalar(
        select(Memory)
        .where(
            Memory.user_id == user_id,
            Memory.assistant_id == assistant_id,
            Memory.status == MemoryStatus.active,
            Memory.structured_data["subject"].astext == subject,
        )
        .order_by(Memory.updated_at.desc())
    )


def decide_status(
    candidate: ExtractedMemory,
    *,
    sensitivity: MemorySensitivity,
    conflict: Memory | None,
    disabled_types: set[str],
) -> MemoryStatus | None:
    """按阶段文档 §4.1 的五个条件决定丢弃、候选还是自动激活。

    返回 ``None`` 表示丢弃。任何一个条件不满足都退回 candidate 交用户确认，
    歧义一律不自动激活。
    """

    if candidate.memory_type in disabled_types:
        return None
    if sensitivity in {MemorySensitivity.sensitive, MemorySensitivity.restricted}:
        return MemoryStatus.candidate
    if not candidate.explicit or not candidate.stable or conflict is not None:
        return MemoryStatus.candidate
    return MemoryStatus.active


def _build_transcript(run: AgentRun) -> str:
    """把 Run 的步骤压成一段有界文本，供抽取模型阅读。"""

    lines: list[str] = []
    for step in list(run.steps)[:TRANSCRIPT_STEP_LIMIT]:
        summary = getattr(step, "summary", None) or getattr(step, "output_text", None)
        if isinstance(summary, str) and summary.strip():
            lines.append(summary.strip())
    return "\n".join(lines)[:TRANSCRIPT_CHAR_LIMIT]


async def extract_from_run(
    *, run_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession
) -> list[Memory]:
    """读取一次成功的 Run，抽取候选并按策略落库，返回新建的记忆。"""

    run = await db.scalar(
        select(AgentRun)
        .options(selectinload(AgentRun.steps))
        .where(AgentRun.id == run_id, AgentRun.user_id == user_id)
    )
    if run is None:
        return []
    assistant = await db.scalar(
        select(Assistant).where(Assistant.id == run.assistant_id, Assistant.user_id == user_id)
    )
    if assistant is None:
        return []
    candidates = await extract_memory_candidates(
        goal=run.goal or "", transcript=_build_transcript(run)
    )
    if candidates is None:
        logger.info("记忆抽取不可用，Run %s 本次不产生候选", run_id)
        return []
    disabled = {str(item) for item in (assistant.disabled_memory_types or [])}
    now = datetime.now(UTC)
    created: list[Memory] = []
    for candidate in candidates:
        if await find_duplicate(
            user_id=user_id, assistant_id=assistant.id, content=candidate.content, db=db
        ):
            continue
        sensitivity = classify_sensitivity(candidate.content)
        conflict = await find_conflict(
            user_id=user_id, assistant_id=assistant.id, subject=candidate.subject, db=db
        )
        status = decide_status(
            candidate, sensitivity=sensitivity, conflict=conflict, disabled_types=disabled
        )
        if status is None:
            continue
        memory = Memory(
            user_id=user_id,
            assistant_id=assistant.id,
            workspace_id=run.workspace_id if hasattr(run, "workspace_id") else None,
            memory_type=MemoryType(candidate.memory_type),
            content=candidate.content,
            structured_data={"subject": candidate.subject},
            source_type="agent_run",
            source_id=str(run.id),
            source_excerpt=(run.goal or "")[:2000],
            confidence=candidate.confidence,
            sensitivity=sensitivity,
            status=status,
        )
        if status is MemoryStatus.active:
            memory.embedding = await maybe_embed_text(candidate.content)
            memory.valid_from = now
            if conflict is not None:
                conflict.status = MemoryStatus.superseded
        db.add(memory)
        created.append(memory)
    await db.flush()
    return created
```

`decide_status` marks the conflicting predecessor `superseded` only when the new memory actually activates — a candidate awaiting review must not retire the fact it might never replace.

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/unit/test_memory_extraction.py -v`
Expected: PASS.

Note: if `AgentRun` has no `workspace_id` attribute, drop the `hasattr` guard and pass `None` — verify against `backend/app/models/agent_run.py` rather than guessing.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/memory_extraction.py backend/tests/unit/test_memory_extraction.py
ALL_PROXY= PYTHONPATH= git commit -m "feat(backend): decide memory candidate lifecycle from run extraction"
```

---

### Task 7: Extraction Queue and Worker

Wires the policy service to the runtime: the Agent worker enqueues after its own commit, a dedicated process consumes.

**Files:**

- Create: `backend/app/services/memory_queue.py`
- Create: `backend/app/workers/memory_worker.py`
- Modify: `backend/app/workers/agent_worker.py:109-116`
- Modify: `package.json` (scripts)
- Test: `backend/tests/unit/test_memory_worker.py` (new file)

**Interfaces:**

- Consumes: `memory_extraction.extract_from_run` (Task 6).
- Produces:
  - `MEMORY_EXTRACTION_QUEUE_KEY = "memory:extract"`
  - `async enqueue_extraction(*, user_id: uuid.UUID, run_id: uuid.UUID, client: Redis | None = None) -> None`
  - `async dequeue_extraction(*, client: Redis | None = None, timeout: int = 5) -> tuple[uuid.UUID, uuid.UUID] | None`
  - `class MemoryWorker` with `async run(stop_event: asyncio.Event | None = None) -> None` and `async run_once() -> bool`
  - `package.json` script `memory:worker`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_memory_worker.py`:

```python
"""记忆抽取队列与 worker 的投递、消费和容错测试。"""

import asyncio
import uuid

import pytest

from app.services.memory_queue import (
    MEMORY_EXTRACTION_QUEUE_KEY,
    dequeue_extraction,
    enqueue_extraction,
)
from app.workers.memory_worker import MemoryWorker


class _StubRedis:
    """记录 push 并按 FIFO 弹出的最小 Redis 替身。"""

    def __init__(self) -> None:
        self.items: list[str] = []

    async def lpush(self, key: str, value: str) -> int:
        assert key == MEMORY_EXTRACTION_QUEUE_KEY
        self.items.insert(0, value)
        return len(self.items)

    async def brpop(self, key: str, timeout: int = 0) -> tuple[str, str] | None:
        assert key == MEMORY_EXTRACTION_QUEUE_KEY
        if not self.items:
            return None
        return (key, self.items.pop())


@pytest.mark.asyncio
async def test_enqueue_then_dequeue_round_trips_both_identifiers() -> None:
    """投递的租户与 Run 标识必须原样取回。"""

    client = _StubRedis()
    user_id, run_id = uuid.uuid4(), uuid.uuid4()
    await enqueue_extraction(user_id=user_id, run_id=run_id, client=client)
    assert await dequeue_extraction(client=client) == (user_id, run_id)


@pytest.mark.asyncio
async def test_dequeue_returns_none_on_an_empty_queue() -> None:
    """队列为空时返回 None，worker 据此进入下一轮等待。"""

    assert await dequeue_extraction(client=_StubRedis()) is None


@pytest.mark.asyncio
async def test_dequeue_discards_a_malformed_entry() -> None:
    """脏数据不得让 worker 崩溃，直接丢弃继续消费。"""

    client = _StubRedis()
    client.items.append("not-a-json-payload")
    assert await dequeue_extraction(client=client) is None


@pytest.mark.asyncio
async def test_worker_keeps_consuming_after_an_extraction_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """单条抽取失败只记录日志，不得毒死 worker 进程。"""

    client = _StubRedis()
    await enqueue_extraction(user_id=uuid.uuid4(), run_id=uuid.uuid4(), client=client)

    async def _boom(**_: object) -> list[object]:
        raise RuntimeError("extraction exploded")

    monkeypatch.setattr("app.workers.memory_worker.extract_from_run", _boom)
    worker = MemoryWorker(client=client)
    assert await worker.run_once() is True
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && uv run pytest tests/unit/test_memory_worker.py -v`
Expected: FAIL — neither module exists.

- [ ] **Step 3: Implement the queue**

Create `backend/app/services/memory_queue.py`:

```python
"""记忆抽取任务的 Redis 队列，只负责投递与取出。"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from app.core.redis import redis_client

logger = logging.getLogger(__name__)

MEMORY_EXTRACTION_QUEUE_KEY = "memory:extract"


async def enqueue_extraction(
    *, user_id: uuid.UUID, run_id: uuid.UUID, client: Any | None = None
) -> None:
    """把一次成功的 Run 投递给抽取 worker。

    必须在 Run 自身事务提交之后调用：抽取失败不能回滚或拖慢主链路。
    """

    payload = json.dumps({"userId": str(user_id), "runId": str(run_id)})
    await (client or redis_client).lpush(MEMORY_EXTRACTION_QUEUE_KEY, payload)


async def dequeue_extraction(
    *, client: Any | None = None, timeout: int = 5
) -> tuple[uuid.UUID, uuid.UUID] | None:
    """取出一条抽取任务；队列为空或数据损坏时返回 ``None``。"""

    item = await (client or redis_client).brpop(MEMORY_EXTRACTION_QUEUE_KEY, timeout=timeout)
    if not item:
        return None
    try:
        payload = json.loads(item[1])
        return uuid.UUID(payload["userId"]), uuid.UUID(payload["runId"])
    except (TypeError, ValueError, KeyError):
        logger.warning("丢弃损坏的记忆抽取任务")
        return None
```

- [ ] **Step 4: Implement the worker**

Create `backend/app/workers/memory_worker.py`, mirroring `automation_scheduler.py`'s process shape:

```python
"""独立记忆抽取 worker：消费 Run 并写入候选记忆。"""

from __future__ import annotations

import asyncio
import logging
import signal
from typing import Any

from sqlalchemy.exc import SQLAlchemyError

from app.core.database import AsyncSessionLocal
from app.services.memory_extraction import extract_from_run
from app.services.memory_queue import dequeue_extraction

logger = logging.getLogger(__name__)


class MemoryWorker:
    """消费抽取队列并把候选记忆写入数据库的循环。"""

    def __init__(self, *, client: Any | None = None, poll_timeout: int = 5) -> None:
        self._client = client
        self._poll_timeout = poll_timeout

    async def run_once(self) -> bool:
        """处理至多一条任务，返回是否取到了任务。"""

        item = await dequeue_extraction(client=self._client, timeout=self._poll_timeout)
        if item is None:
            return False
        user_id, run_id = item
        try:
            async with AsyncSessionLocal() as db:
                created = await extract_from_run(run_id=run_id, user_id=user_id, db=db)
                await db.commit()
            logger.info("Run %s 抽取出 %d 条记忆", run_id, len(created))
        except (OSError, RuntimeError, SQLAlchemyError, ValueError):
            # 单条任务失败不能毒死 worker 进程；记录后继续消费后续任务。
            logger.exception("Run %s 的记忆抽取失败", run_id)
        return True

    async def run(self, stop_event: asyncio.Event | None = None) -> None:
        """持续消费直到收到停止事件。"""

        shutdown = stop_event or asyncio.Event()
        while not shutdown.is_set():
            await self.run_once()


def _install_signal_handlers(stop_event: asyncio.Event) -> None:
    """在支持的平台安装安全退出信号。"""

    loop = asyncio.get_running_loop()
    for name in ("SIGINT", "SIGTERM"):
        signal_name = getattr(signal, name, None)
        if signal_name is None:
            continue
        try:
            loop.add_signal_handler(signal_name, stop_event.set)
        except (NotImplementedError, RuntimeError, ValueError):
            continue


async def main() -> None:
    """启动独立记忆抽取 worker 进程。"""

    stop_event = asyncio.Event()
    _install_signal_handlers(stop_event)
    await MemoryWorker().run(stop_event)


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 5: Enqueue from the Agent worker**

In `backend/app/workers/agent_worker.py`, `execute_agent_run` currently ends at `await db.commit()` (line 116). Append the enqueue **after** that commit:

```python
        await db.commit()
        if run.status is AgentRunStatus.succeeded:
            await enqueue_extraction(user_id=item.tenant_id, run_id=run.id)
```

Import `enqueue_extraction` from `app.services.memory_queue` and `AgentRunStatus` from `app.models.agent_run`. Confirm the actual success enum member name in that model before writing it — do not guess.

- [ ] **Step 6: Register the script**

In the root `package.json`, beside `automation:scheduler`:

```json
    "memory:worker": "uv --directory backend run python -m app.workers.memory_worker",
```

- [ ] **Step 7: Run the tests**

Run: `cd backend && uv run pytest tests/unit/test_memory_worker.py tests/unit/test_agent_runtime_workers.py -v`
Expected: PASS.

Run: `cd backend && uv run pytest && uv run ruff check . && uv run mypy .`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/memory_queue.py backend/app/workers/memory_worker.py \
        backend/app/workers/agent_worker.py package.json backend/tests/unit/test_memory_worker.py
ALL_PROXY= PYTHONPATH= git commit -m "feat(backend): extract memories from successful runs in a worker"
```

---

### Task 8: Node Liveness and a Reusable Node RPC

Two defects block local-node memory before a single memory job exists. First, nothing ever writes an `ExecutionNode` back to `offline`, so a closed desktop app still looks online and every job to it burns the full timeout. Second, the only "dispatch a job and await its result" code is `AgentCoordinator._await_desktop_execution`, a private method whose return type is entangled with Agent run semantics. This task fixes the first and promotes the second.

**Files:**

- Modify: `backend/app/core/config.py:119-125`
- Modify: `backend/app/services/tool_runtime_service.py`
- Modify: `backend/app/services/agent/coordinator.py:728-788`
- Create: `backend/app/workers/node_sweeper.py`
- Modify: `package.json` (scripts)
- Test: `backend/tests/unit/test_agent_desktop_routing.py`
- Test: `backend/tests/unit/test_node_sweeper.py` (new file)

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `settings.execution_node_heartbeat_stale_seconds: int = 60`
  - `node_is_fresh(now: datetime) -> ColumnElement[bool]` in `tool_runtime_service`
  - `async select_fresh_node(*, user_id, tool_name, db, now=None) -> ExecutionNode | None`
  - `async run_node_job(*, user_id, tool_name, arguments, db, timeout_seconds, now=None) -> NodeJobOutcome`
  - `@dataclass(frozen=True) NodeJobOutcome` with `status: Literal["succeeded", "unavailable", "timeout", "failed"]` and `data: dict[str, object] | None`
  - `async sweep_stale_nodes(*, now: datetime, db: AsyncSession) -> int`
  - `class NodeSweeper` with `async run(stop_event)` and `async run_once() -> int`
  - `package.json` script `node:sweeper`

`_select_desktop_node` in the coordinator is replaced by a call to `select_fresh_node`; the coordinator keeps its own result handling.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/unit/test_agent_desktop_routing.py` (it already builds offline/forbidden/allowed/other-user nodes — extend that fixture):

```python
@pytest.mark.asyncio
async def test_stale_heartbeat_node_is_not_selected(db, test_user: User) -> None:
    """心跳过期的节点即使 status 仍是 online 也不得被选中。"""

    now = datetime.now(UTC)
    node = ExecutionNode(
        user_id=test_user.id,
        name="陈旧节点",
        status=ExecutionNodeStatus.online,
        capabilities=["read_granted_file"],
        policy={"allowed_tools": ["read_granted_file"]},
        last_seen_at=now - timedelta(seconds=600),
    )
    db.add(node)
    await db.flush()
    assert (
        await select_fresh_node(
            user_id=test_user.id, tool_name="read_granted_file", db=db, now=now
        )
        is None
    )


@pytest.mark.asyncio
async def test_run_node_job_reports_unavailable_without_a_fresh_node(
    db, test_user: User
) -> None:
    """没有可用节点时立即返回 unavailable，不排队也不等超时。"""

    outcome = await run_node_job(
        user_id=test_user.id,
        tool_name="memory.search",
        arguments={"query": "中文"},
        db=db,
        timeout_seconds=5,
    )
    assert outcome.status == "unavailable"
    assert outcome.data is None
```

Create `backend/tests/unit/test_node_sweeper.py`:

```python
"""执行节点心跳清扫的状态迁移测试。"""

from datetime import UTC, datetime, timedelta

import pytest

from app.models.tool_runtime import ExecutionNode, ExecutionNodeStatus
from app.models.user import User
from app.services.tool_runtime_service import sweep_stale_nodes


@pytest.mark.asyncio
async def test_sweep_marks_only_stale_online_nodes_offline(db, test_user: User) -> None:
    """只有心跳过期的 online 节点被置 offline，revoked 与新鲜节点不受影响。"""

    now = datetime.now(UTC)
    stale = ExecutionNode(
        user_id=test_user.id, name="陈旧", status=ExecutionNodeStatus.online,
        capabilities=[], policy={}, last_seen_at=now - timedelta(seconds=600),
    )
    fresh = ExecutionNode(
        user_id=test_user.id, name="新鲜", status=ExecutionNodeStatus.online,
        capabilities=[], policy={}, last_seen_at=now - timedelta(seconds=5),
    )
    revoked = ExecutionNode(
        user_id=test_user.id, name="已撤销", status=ExecutionNodeStatus.revoked,
        capabilities=[], policy={}, last_seen_at=now - timedelta(seconds=600),
    )
    db.add_all([stale, fresh, revoked])
    await db.flush()

    assert await sweep_stale_nodes(now=now, db=db) == 1
    assert stale.status is ExecutionNodeStatus.offline
    assert fresh.status is ExecutionNodeStatus.online
    assert revoked.status is ExecutionNodeStatus.revoked


@pytest.mark.asyncio
async def test_sweep_is_idempotent(db, test_user: User) -> None:
    """重复清扫不得反复计数已经 offline 的节点。"""

    now = datetime.now(UTC)
    db.add(
        ExecutionNode(
            user_id=test_user.id, name="陈旧", status=ExecutionNodeStatus.online,
            capabilities=[], policy={}, last_seen_at=now - timedelta(seconds=600),
        )
    )
    await db.flush()
    assert await sweep_stale_nodes(now=now, db=db) == 1
    assert await sweep_stale_nodes(now=now, db=db) == 0
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && uv run pytest tests/unit/test_node_sweeper.py tests/unit/test_agent_desktop_routing.py -v`
Expected: FAIL — `sweep_stale_nodes`, `select_fresh_node`, and `run_node_job` do not exist.

- [ ] **Step 3: Add the config key**

In `backend/app/core/config.py`, inside the execution-node block:

```python
    # 节点只会被写成 online，从不自动回落；心跳超过该阈值即视为离线。
    execution_node_heartbeat_stale_seconds: int = 60
```

The WebSocket loop heartbeats every 5 seconds, so 60 tolerates a dozen missed beats before declaring a node gone.

- [ ] **Step 4: Add the freshness predicate and node selection**

In `backend/app/services/tool_runtime_service.py`:

```python
def node_is_fresh(now: datetime) -> ColumnElement[bool]:
    """构造「心跳未过期」的 SQL 条件。

    ``ExecutionNode.status`` 只会被写成 online，没有任何代码让它回落，
    因此单看 status 会把已关闭的桌面端当成在线节点。
    """

    threshold = now - timedelta(seconds=settings.execution_node_heartbeat_stale_seconds)
    return and_(
        ExecutionNode.status == ExecutionNodeStatus.online,
        ExecutionNode.last_seen_at.is_not(None),
        ExecutionNode.last_seen_at >= threshold,
    )


async def select_fresh_node(
    *,
    user_id: uuid.UUID,
    tool_name: str,
    db: AsyncSession,
    now: datetime | None = None,
) -> ExecutionNode | None:
    """选出当前用户下心跳新鲜、且策略允许该工具的节点。

    多节点时取心跳最新的一个，避免原先「数据库返回顺序」带来的不确定选择。
    """

    current_time = now or datetime.now(UTC)
    nodes = await db.scalars(
        select(ExecutionNode)
        .where(ExecutionNode.user_id == user_id, node_is_fresh(current_time))
        .order_by(ExecutionNode.last_seen_at.desc())
    )
    for node in nodes:
        allowed = node.policy.get("allowed_tools", []) if isinstance(node.policy, dict) else []
        if tool_name in allowed and tool_name in (node.capabilities or []):
            return node
    return None
```

- [ ] **Step 5: Add the reusable job runner**

Still in `tool_runtime_service.py`, generalising `_await_desktop_execution`'s three moves — commit so the gateway session can see the row, poll, then fail on timeout:

```python
@dataclass(frozen=True)
class NodeJobOutcome:
    """一次节点作业的归一化结果。"""

    status: Literal["succeeded", "unavailable", "timeout", "failed"]
    data: dict[str, object] | None = None
    error_code: str | None = None


NODE_JOB_POLL_INTERVAL_SECONDS = 0.5


async def run_node_job(
    *,
    user_id: uuid.UUID,
    tool_name: str,
    arguments: dict[str, object],
    db: AsyncSession,
    timeout_seconds: float,
    now: datetime | None = None,
) -> NodeJobOutcome:
    """向用户的在线节点派发一个作业并等待终态。

    没有新鲜节点时立刻返回 ``unavailable``，不排队也不空等，
    这样调用方可以直接给出「本地功能暂不可用」而不是让用户等满超时。
    """

    node = await select_fresh_node(user_id=user_id, tool_name=tool_name, db=db, now=now)
    if node is None:
        return NodeJobOutcome(status="unavailable")
    execution = await create_execution(
        user_id=user_id,
        node=node,
        tool_name=tool_name,
        arguments=arguments,
        db=db,
    )
    await db.commit()
    deadline = time.monotonic() + max(1.0, timeout_seconds)
    while time.monotonic() < deadline:
        await db.refresh(execution)
        if execution.status is ToolExecutionStatus.succeeded:
            payload = execution.result_json or {}
            data = payload.get("data") if isinstance(payload, dict) else None
            return NodeJobOutcome(
                status="succeeded", data=data if isinstance(data, dict) else None
            )
        if execution.status in {ToolExecutionStatus.failed, ToolExecutionStatus.cancelled}:
            return NodeJobOutcome(status="failed", error_code=execution.error_code)
        await asyncio.sleep(NODE_JOB_POLL_INTERVAL_SECONDS)
    await fail_execution(execution=execution, error_code="TOOL_TIMEOUT", db=db)
    await db.commit()
    return NodeJobOutcome(status="timeout", error_code="TOOL_TIMEOUT")
```

`create_execution` and `fail_execution` already exist in this module — match their real signatures rather than the sketch above if they differ.

- [ ] **Step 6: Repoint the coordinator**

In `backend/app/services/agent/coordinator.py`, delete `_select_desktop_node` (line 728) and call `select_fresh_node` instead. The coordinator's own `_await_desktop_execution` stays as it is: it returns `CoordinatorResult` on failure, which `run_node_job` deliberately does not. Two callers, two shapes, one shared node-selection rule.

- [ ] **Step 7: Write the sweeper**

In `tool_runtime_service.py`:

```python
async def sweep_stale_nodes(*, now: datetime, db: AsyncSession) -> int:
    """把心跳过期的 online 节点置为 offline，返回本轮变更条数。"""

    threshold = now - timedelta(seconds=settings.execution_node_heartbeat_stale_seconds)
    result = await db.execute(
        update(ExecutionNode)
        .where(
            ExecutionNode.status == ExecutionNodeStatus.online,
            or_(
                ExecutionNode.last_seen_at.is_(None),
                ExecutionNode.last_seen_at < threshold,
            ),
        )
        .values(status=ExecutionNodeStatus.offline)
    )
    return int(getattr(result, "rowcount", 0) or 0)
```

Create `backend/app/workers/node_sweeper.py` following the `automation_scheduler.py` template exactly — same `_install_signal_handlers`, same `run`/`main` shape — with:

```python
POLL_INTERVAL_SECONDS = 30.0


class NodeSweeper:
    """周期性把心跳过期的执行节点标记为离线。"""

    def __init__(self, *, poll_interval: float = POLL_INTERVAL_SECONDS) -> None:
        if poll_interval <= 0:
            raise ValueError("poll_interval must be positive")
        self.poll_interval = poll_interval

    async def run_once(self) -> int:
        """执行一轮清扫并返回被标记离线的节点数。"""

        async with AsyncSessionLocal() as db:
            swept = await sweep_stale_nodes(now=datetime.now(UTC), db=db)
            await db.commit()
        return swept
```

- [ ] **Step 8: Register the script**

In the root `package.json`:

```json
    "node:sweeper": "uv --directory backend run python -m app.workers.node_sweeper",
```

- [ ] **Step 9: Run the tests**

Run: `cd backend && uv run pytest tests/unit/test_node_sweeper.py tests/unit/test_agent_desktop_routing.py tests/unit/test_execution_node_protocol.py -v`
Expected: PASS.

Run: `cd backend && uv run pytest && uv run ruff check . && uv run mypy .`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/app/core/config.py backend/app/services/tool_runtime_service.py \
        backend/app/services/agent/coordinator.py backend/app/workers/node_sweeper.py \
        package.json backend/tests/
ALL_PROXY= PYTHONPATH= git commit -m "fix(backend): stop treating closed desktop nodes as online"
```

---

### Task 9: Memory Job Specs and Cloud-Side Routing

Declares the three `memory.*` tools and routes local-node memory operations through them. After this task the backend side of S2 is complete; the desktop side follows in Tasks 10 and 11.

**Files:**

- Modify: `backend/app/tools/builtin/desktop.py:181-186`
- Create: `backend/app/services/memory_node.py`
- Modify: `backend/app/services/memory_service.py`
- Modify: `backend/app/services/memory_retrieval.py`
- Test: `backend/tests/unit/test_desktop_tools.py`
- Test: `backend/tests/unit/test_memory_node.py` (new file)

**Interfaces:**

- Consumes: `run_node_job`, `NodeJobOutcome` (Task 8); `MemorySearchOutcome` (Task 4).
- Produces:
  - Tool names `memory.search`, `memory.write`, `memory.delete`, all `execution_location="desktop"`, `memory.search` at `ToolRisk.read`
  - `async search_local_memories(*, user_id, assistant_id, query, limit, db) -> tuple[list[MemorySearchResult], bool]` — the bool is `unavailable`
  - `async push_local_memory(*, memory: Memory, content: str, db) -> None`
  - `async drop_local_memory(*, memory: Memory, db) -> None`
  - `LocalMemoryUnavailableError`
  - `MEMORY_NODE_TIMEOUT_SECONDS = 15`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/unit/test_desktop_tools.py`, following the existing parameterised style at `:35` and `:52`:

```python
@pytest.mark.parametrize("tool_name", ["memory.search", "memory.write", "memory.delete"])
def test_memory_tools_execute_on_the_desktop_node(tool_name: str) -> None:
    """三个记忆作业都必须声明在桌面节点执行。"""

    spec = next(item for item in DESKTOP_BUILTINS if item.name == tool_name)
    assert spec.execution_location == "desktop"


def test_memory_search_is_a_read_risk_tool() -> None:
    """只读检索才允许节点侧自动接受，风险等级必须是 read。"""

    spec = next(item for item in DESKTOP_BUILTINS if item.name == "memory.search")
    assert spec.risk_level is ToolRisk.read


@pytest.mark.parametrize("tool_name", ["memory.write", "memory.delete"])
def test_memory_mutation_tools_are_not_read_risk(tool_name: str) -> None:
    """写入与删除不得被自动接受，风险等级必须高于 read。"""

    spec = next(item for item in DESKTOP_BUILTINS if item.name == tool_name)
    assert spec.risk_level is not ToolRisk.read
```

Create `backend/tests/unit/test_memory_node.py`:

```python
"""本地记忆的节点路由与不可用降级测试。"""

import uuid

import pytest

from app.services.memory_node import (
    LocalMemoryUnavailableError,
    drop_local_memory,
    push_local_memory,
    search_local_memories,
)
from app.services.tool_runtime_service import NodeJobOutcome


@pytest.mark.asyncio
async def test_search_reports_unavailable_instead_of_dropping_results(
    db, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """节点不在线时必须显式告知不可用，不得静默过滤掉本地记忆。"""

    async def _unavailable(**_: object) -> NodeJobOutcome:
        return NodeJobOutcome(status="unavailable")

    monkeypatch.setattr("app.services.memory_node.run_node_job", _unavailable)
    results, unavailable = await search_local_memories(
        user_id=test_user.id, assistant_id=uuid.uuid4(), query="中文", limit=8, db=db
    )
    assert results == []
    assert unavailable is True


@pytest.mark.asyncio
async def test_write_fails_loudly_when_no_node_is_online(
    db, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """写入本地记忆时节点不可用必须报错，不能退回云端存储。"""

    async def _unavailable(**_: object) -> NodeJobOutcome:
        return NodeJobOutcome(status="unavailable")

    monkeypatch.setattr("app.services.memory_node.run_node_job", _unavailable)
    memory = Memory(
        user_id=test_user.id,
        assistant_id=uuid.uuid4(),
        memory_type=MemoryType.profile,
        content=None,
        source_type="user_input",
        storage_location=MemoryStorageLocation.local_node,
    )
    with pytest.raises(LocalMemoryUnavailableError):
        await push_local_memory(memory=memory, content="本地私密事实", db=db)
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && uv run pytest tests/unit/test_memory_node.py tests/unit/test_desktop_tools.py -v`
Expected: FAIL — module and tool specs missing.

- [ ] **Step 3: Declare the three tool specs**

In `backend/app/tools/builtin/desktop.py`, follow the existing `read_granted_file` spec at `:51` and its fail-closed handler at `:84`. Each handler raises `DESKTOP_TOOL_REQUIRES_NODE`; the real work happens on the node. Input schemas:

- `memory.search`: `{query: string, limit: integer}` — returns `{memories: [{id, content, score}]}`
- `memory.write`: `{memoryId: string, content: string, memoryType: string}` — returns `{stored: true}`
- `memory.delete`: `{memoryId: string}` — returns `{deleted: true}`

Append all three to `DESKTOP_BUILTINS` at `:181`. `builtin/__init__.py:30` registers them automatically; no change needed there.

- [ ] **Step 4: Implement the routing module**

Create `backend/app/services/memory_node.py`:

```python
"""把 storage_location=local_node 的记忆读写路由到用户的桌面节点。"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.memory import Memory
from app.schemas.memory import MemorySearchResult
from app.services.tool_runtime_service import run_node_job

MEMORY_NODE_TIMEOUT_SECONDS = 15


class LocalMemoryUnavailableError(Exception):
    """桌面节点不在线时写入或删除本地记忆的稳定错误。"""


async def search_local_memories(
    *,
    user_id: uuid.UUID,
    assistant_id: uuid.UUID,
    query: str,
    limit: int,
    db: AsyncSession,
) -> tuple[list[MemorySearchResult], bool]:
    """向在线节点请求本地记忆检索。

    第二个返回值为 ``True`` 表示本地记忆暂不可用。阶段文档明确禁止静默改用
    云端副本，也禁止把本地记忆直接过滤掉当作不存在。
    """

    outcome = await run_node_job(
        user_id=user_id,
        tool_name="memory.search",
        arguments={"query": query, "limit": limit},
        db=db,
        timeout_seconds=MEMORY_NODE_TIMEOUT_SECONDS,
    )
    if outcome.status != "succeeded" or outcome.data is None:
        return [], True
    ...
```

The remainder maps the node payload into `MemorySearchResult` values, pairing each returned id with the cloud metadata row so sensitivity and type come from the database rather than from the node's reply. Content from the node is untrusted input: cap its length and never interpolate it into a prompt outside the existing `MemoryContextItem.untrusted` envelope.

`push_local_memory` and `drop_local_memory` call `run_node_job` with `memory.write` / `memory.delete` and raise `LocalMemoryUnavailableError` on any status other than `succeeded`.

- [ ] **Step 5: Wire the service and retrieval layers**

`memory_service.create_candidate` and `update_memory`: when `storage_location is MemoryStorageLocation.local_node`, call `push_local_memory` with the submitted content, set `memory.node_id` from the outcome, and store `content=None` in the cloud row. `delete_memory` calls `drop_local_memory` before deleting the metadata row, so a node that rejects the delete blocks the cloud delete rather than orphaning content on disk.

`memory_retrieval.search_active_memories`: after the cloud arms produce their results, if the user has any `local_node` memories for this assistant, call `search_local_memories`, merge its results, and set `MemorySearchOutcome.local_unavailable` from the returned flag.

- [ ] **Step 6: Run the tests**

Run: `cd backend && uv run pytest && uv run ruff check . && uv run mypy .`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/tools/builtin/desktop.py backend/app/services/memory_node.py \
        backend/app/services/memory_service.py backend/app/services/memory_retrieval.py \
        backend/tests/
ALL_PROXY= PYTHONPATH= git commit -m "feat(backend): route local memories to the desktop node"
```

---

### Task 10: Desktop Encrypted Memory Store

The node side of local memories. Mirrors `grants.ts` exactly — same encrypted-file helpers, same hydrate-and-cache shape — so there is no new crypto and no new file-format decision.

**Files:**

- Create: `apps/desktop/src/main/execution-node/memory-store.ts`
- Test: `apps/desktop/src/main/execution-node/memory-store.test.ts` (new file)

**Interfaces:**

- Consumes: `readEncryptedFile`, `writeEncryptedFile`, `assertEncryptionAvailable` from `./encrypted-file.js`.
- Produces:
  - `interface LocalMemoryRecord { id: string; content: string; memoryType: string; updatedAt: string }`
  - `class LocalMemoryStore` with `hydrate(): Promise<void>`, `put(record: LocalMemoryRecord): Promise<void>`, `remove(id: string): Promise<boolean>`, `search(query: string, limit: number): LocalMemoryRecord[]`
  - `MAX_LOCAL_MEMORY_BYTES = 512 * 1024`
  - File name `execution-node-memory.enc` under `app.getPath('userData')`

`search` is synchronous and keyword-based: normalise, split into terms, score by term overlap, return the top `limit`. No embeddings on the node — the cloud already carries the vector arm, and shipping a model into Electron is not in this batch.

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/main/execution-node/memory-store.test.ts`, mirroring `grants.test.ts`'s fs-mock setup:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fsMock = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn(),
}))
vi.mock('node:fs/promises', () => ({ default: fsMock, ...fsMock }))

import { LocalMemoryStore, type LocalMemoryRecord } from './memory-store.js'

const record = (id: string, content: string): LocalMemoryRecord => ({
  id,
  content,
  memoryType: 'profile',
  updatedAt: '2026-09-18T00:00:00.000Z',
})

describe('LocalMemoryStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsMock.readFile.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
  })

  it('本地没有存储文件时以空集合启动', async () => {
    const store = createStore()
    await store.hydrate()
    expect(store.search('任何内容', 8)).toEqual([])
  })

  it('写入后能按关键词检索回来', async () => {
    const store = createStore()
    await store.hydrate()
    await store.put(record('m1', '我的家庭住址在杭州西湖区'))
    expect(store.search('杭州', 8).map((item) => item.id)).toEqual(['m1'])
  })

  it('同一 id 重复写入是更新而非追加', async () => {
    const store = createStore()
    await store.hydrate()
    await store.put(record('m1', '旧内容杭州'))
    await store.put(record('m1', '新内容杭州'))
    const found = store.search('杭州', 8)
    expect(found).toHaveLength(1)
    expect(found[0]?.content).toBe('新内容杭州')
  })

  it('删除不存在的记忆返回 false 而不抛错', async () => {
    const store = createStore()
    await store.hydrate()
    expect(await store.remove('missing')).toBe(false)
  })

  it('检索结果按关键词命中数排序并受 limit 截断', async () => {
    const store = createStore()
    await store.hydrate()
    await store.put(record('m1', '杭州 西湖'))
    await store.put(record('m2', '杭州'))
    expect(store.search('杭州 西湖', 1).map((item) => item.id)).toEqual(['m1'])
  })
})
```

`createStore()` is a local helper building a `LocalMemoryStore` with a stub `safeStorage` whose `encryptString`/`decryptString` are identity transforms over `Buffer`, matching how `grants.test.ts` fakes it.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/desktop && pnpm vitest run src/main/execution-node/memory-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `apps/desktop/src/main/execution-node/memory-store.ts` following `grants.ts:82-100` for path construction and hydration, `:193` for persistence. Keep the file under 200 lines; it holds one responsibility.

- [ ] **Step 4: Run the tests**

Run: `cd apps/desktop && pnpm vitest run src/main/execution-node/memory-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/execution-node/memory-store.ts \
        apps/desktop/src/main/execution-node/memory-store.test.ts
ALL_PROXY= PYTHONPATH= git commit -m "feat(desktop): store local memories in an encrypted node file"
```

---

### Task 11: Desktop Job Handlers and Read-Job Auto-Accept

Connects the store to the protocol and removes the click that would otherwise make memory retrieval unusable.

**Files:**

- Modify: `apps/desktop/src/main/execution-node/jobs.ts:42-51`, `:333-348`
- Modify: `apps/desktop/src/main/execution-node/service.ts:18-23`, `:95-115`
- Modify: `apps/desktop/src/renderer/settings/components/ExecutionNodeSection.tsx:10-13`
- Test: `apps/desktop/src/main/execution-node/jobs.test.ts`
- Test: `apps/desktop/src/main/execution-node/service.test.ts`

**Interfaces:**

- Consumes: `LocalMemoryStore` (Task 10); tool names from Task 9.
- Produces:
  - `DesktopJobsExecutorOptions` gains `memoryStore: LocalMemoryStore`
  - `EXECUTION_NODE_CAPABILITIES` gains `'memory.search'`, `'memory.write'`, `'memory.delete'`
  - `AUTO_ACCEPT_TOOLS: ReadonlySet<string>` in `service.ts`, containing `'memory.search'` only

`EXECUTION_NODE_PROTOCOL_VERSION` stays `'1'`. `tool_name` carries no whitelist in `protocol.ts:399`, and the backend gates on capabilities, so a new job type needs no version bump — raising it would fail authentication for every already-paired node, because the backend compares versions for exact equality and never assigns `update_required`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/desktop/src/main/execution-node/jobs.test.ts`, reusing its `createExecutor` / `createInput` / `expectToolFailure` helpers:

```typescript
it('memory.search 返回本地命中的记忆', async () => {
  const executor = createExecutor({ memoryStore: stubStore([{ id: 'm1', content: '杭州' }]) })
  const result = await executor.executeJob(
    createInput('memory.search', { query: '杭州', limit: 8 })
  )
  expect(result.memories).toEqual([expect.objectContaining({ id: 'm1' })])
})

it('memory.search 没有命中时返回空列表而不是失败', async () => {
  const executor = createExecutor({ memoryStore: stubStore([]) })
  const result = await executor.executeJob(
    createInput('memory.search', { query: '杭州', limit: 8 })
  )
  expect(result.memories).toEqual([])
})

it('memory.write 写入后可被 memory.search 找到', async () => {
  const store = stubStore([])
  const executor = createExecutor({ memoryStore: store })
  await executor.executeJob(
    createInput('memory.write', { memoryId: 'm1', content: '杭州', memoryType: 'profile' })
  )
  expect(store.search('杭州', 8)).toHaveLength(1)
})

it('memory.delete 删除不存在的记忆是幂等成功', async () => {
  const executor = createExecutor({ memoryStore: stubStore([]) })
  const result = await executor.executeJob(createInput('memory.delete', { memoryId: 'missing' }))
  expect(result.deleted).toBe(true)
})

it('memory.search 结果超过大小上限时失败而不是截断', async () => {
  const huge = 'x'.repeat(70_000)
  const executor = createExecutor({ memoryStore: stubStore([{ id: 'm1', content: huge }]) })
  await expectToolFailure(
    executor.executeJob(createInput('memory.search', { query: 'x', limit: 8 })),
    'TOOL_OUTPUT_TOO_LARGE'
  )
})
```

Add to `apps/desktop/src/main/execution-node/service.test.ts`:

```typescript
it('只读的 memory.search 作业自动接受，不进入待确认列表', async () => {
  const { service, client } = createService()
  await service.handleJobOffer(offer('memory.search'))
  expect(client.acceptJob).toHaveBeenCalledWith(
    expect.objectContaining({ toolName: 'memory.search' })
  )
  expect(service.getState().pendingJob).toBeNull()
})

it('memory.write 仍然需要用户确认', async () => {
  const { service, client } = createService()
  await service.handleJobOffer(offer('memory.write'))
  expect(client.acceptJob).not.toHaveBeenCalled()
  expect(service.getState().pendingJob?.toolName).toBe('memory.write')
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/desktop && pnpm vitest run src/main/execution-node/`
Expected: FAIL — handlers and auto-accept do not exist.

- [ ] **Step 3: Add the handlers**

In `jobs.ts`, add `runMemorySearch`, `runMemoryWrite`, `runMemoryDelete`, and three `case` arms in the `executeJob` switch at `:333`. Every handler returns through the existing `assertResultSize` gate at `:349`, whose ceiling is `MAX_JOB_RESULT_BYTES = 60_000` — below the backend's 64 KB limit, so oversize results fail on the node with a clear code rather than being rejected after transfer.

- [ ] **Step 4: Add capabilities and auto-accept**

In `service.ts`, extend `EXECUTION_NODE_CAPABILITIES` with the three names, inject the store when constructing `DesktopJobsExecutor` at `:95`, and add the auto-accept branch in `onJobOffer` at `:107`:

```typescript
/** 只读作业由节点自动接受：检索是用户当次提问的必经步骤，逐次弹窗没有安全收益。 */
const AUTO_ACCEPT_TOOLS: ReadonlySet<string> = new Set(['memory.search'])
```

Write and delete deliberately stay out of the set.

In `ExecutionNodeSection.tsx:10-13`, add the three names to `NODE_CAPABILITIES`. This list is submitted at pairing time, so **an already-paired node must be re-paired to gain the new capabilities** — `register_node` writes capabilities once, at registration. Note this in the E2E task's setup.

Check `apps/desktop/src/main/ipc/execution-node.ts:71`: it rejects more than 8 capabilities. Four existing plus three new is seven, so it still passes — but confirm the current count rather than trusting this sentence.

- [ ] **Step 5: Run the tests**

Run: `cd apps/desktop && pnpm vitest run && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/execution-node/jobs.ts \
        apps/desktop/src/main/execution-node/service.ts \
        apps/desktop/src/renderer/settings/components/ExecutionNodeSection.tsx \
        apps/desktop/src/main/execution-node/jobs.test.ts \
        apps/desktop/src/main/execution-node/service.test.ts
ALL_PROXY= PYTHONPATH= git commit -m "feat(desktop): serve memory jobs from the execution node"
```

---

### Task 12: Cursor Pagination and Export API

Closes S4 for the memories endpoints and S5 outright.

**Files:**

- Modify: `backend/app/api/v1/memories.py:46-55`
- Modify: `backend/app/services/memory_service.py:94-102`
- Modify: `backend/app/schemas/memory.py`
- Test: `backend/tests/integration/test_memories.py`

**Interfaces:**

- Consumes: nothing new.
- Produces:
  - `MemoryPage(items: list[MemoryResponse], next_cursor: str | None)`
  - `MemoryExport(exported_at: datetime, items: list[MemoryResponse])`
  - `async list_memories(*, user_id, db, status=None, cursor=None, limit=50) -> tuple[list[Memory], str | None]`
  - `async export_memories(*, user_id, db) -> list[Memory]`
  - `GET /memories?cursor=&limit=` returning `MemoryPage`
  - `GET /memories/export` returning `MemoryExport`

The cursor is an opaque base64 of `updated_at` plus `id`, keeping the existing `updated_at DESC` order stable across pages when timestamps tie.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/integration/test_memories.py`:

```python
@pytest.mark.asyncio
async def test_memory_list_pages_through_a_stable_cursor(
    client: AsyncClient, auth_headers: dict[str, str], db
) -> None:
    """游标分页必须覆盖全部记忆且不重不漏。"""

    assistant_id = await _create_assistant(client, auth_headers)
    for index in range(5):
        await client.post(
            "/api/v1/memories",
            headers=auth_headers,
            json={
                "assistantId": assistant_id,
                "memoryType": "preference",
                "content": f"偏好 {index}",
                "sourceType": "user_input",
            },
        )
    seen: list[str] = []
    cursor: str | None = None
    for _ in range(5):
        params = {"limit": 2} | ({"cursor": cursor} if cursor else {})
        page = (await client.get("/api/v1/memories", headers=auth_headers, params=params)).json()
        seen.extend(item["id"] for item in page["items"])
        cursor = page["nextCursor"]
        if cursor is None:
            break
    assert len(seen) == 5
    assert len(set(seen)) == 5


@pytest.mark.asyncio
async def test_memory_export_returns_every_memory_of_the_caller_only(
    client: AsyncClient, auth_headers: dict[str, str], other_auth_headers: dict[str, str]
) -> None:
    """导出只包含调用者自己的记忆。"""

    assistant_id = await _create_assistant(client, auth_headers)
    await client.post(
        "/api/v1/memories",
        headers=auth_headers,
        json={
            "assistantId": assistant_id,
            "memoryType": "preference",
            "content": "只属于我",
            "sourceType": "user_input",
        },
    )
    mine = (await client.get("/api/v1/memories/export", headers=auth_headers)).json()
    theirs = (await client.get("/api/v1/memories/export", headers=other_auth_headers)).json()
    assert [item["content"] for item in mine["items"]] == ["只属于我"]
    assert theirs["items"] == []
```

If the suite has no `other_auth_headers` fixture, add one alongside the existing `auth_headers` in `backend/tests/conftest.py:189` registering a second user. Tenant isolation is not optional on a new endpoint.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && uv run pytest tests/integration/test_memories.py -k "cursor or export" -v`
Expected: FAIL — `GET /memories` returns a bare array with no `items`, and `/memories/export` is 404.

- [ ] **Step 3: Implement service and schemas, then the routes**

`list_memories` gains `cursor` and `limit`, decodes the cursor into `(updated_at, id)`, applies `(updated_at, id) < (cursor_updated_at, cursor_id)` as a row-value comparison, orders by `updated_at DESC, id DESC`, fetches `limit + 1` rows, and returns the extra row's cursor as `next_cursor`.

`GET /memories/export` reuses `export_memories`, which is `list_memories` without pagination. It must be declared **before** `GET /memories/{memory_id}` if such a route exists, otherwise `export` is parsed as an id.

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/integration/test_memories.py -v && uv run pytest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/memories.py backend/app/services/memory_service.py \
        backend/app/schemas/memory.py backend/tests/
ALL_PROXY= PYTHONPATH= git commit -m "feat(backend): paginate and export the memory list"
```

---

### Task 13: Shared Types and Core Client

Mirrors the new backend shapes so the Web layer compiles against them.

**Files:**

- Modify: `packages/types/src/index.ts:901`
- Modify: `packages/core/src/api/memories.ts`
- Modify: `packages/core/src/hooks/useMemories.ts`
- Test: `packages/core/src/api/__tests__/memories.test.ts` (new file)

**Interfaces:**

- Consumes: Task 12's response shapes.
- Produces:
  - `Memory.content: string | null`, `Memory.nodeId: string | null`
  - `MemoryPage`, `MemoryExport`, `MemorySearchOutcome`
  - `Assistant.disabledMemoryTypes: MemoryType[] | null`
  - `listMemories(params?: { status?; cursor?; limit? }): Promise<MemoryPage>`
  - `exportMemories(): Promise<MemoryExport>`
  - `useMemories(status?)` backed by `useInfiniteQuery`
  - `useExportMemories()`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/api/__tests__/memories.test.ts` following the conventions of the sibling tests in that directory: mock `apiClient`, assert the request path and params, assert the parsed return shape. Cover `listMemories` passing `cursor` through, `listMemories` returning `nextCursor: null` on the last page, `exportMemories` hitting `/memories/export`, and `searchMemories` surfacing `localUnavailable`.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/core && pnpm vitest run src/api/__tests__/memories.test.ts`
Expected: FAIL — `listMemories` still returns `Memory[]`.

- [ ] **Step 3: Update types, api, and hooks**

`useMemories` moves to `useInfiniteQuery` with `getNextPageParam: (page) => page.nextCursor ?? undefined`. Keep the `enabled: Boolean(accessToken)` guard and the `['memories', status]` key prefix so the existing `invalidateQueries` calls in the mutation hooks still match.

- [ ] **Step 4: Run the tests**

Run: `pnpm test:unit && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/index.ts packages/core/src/api/memories.ts \
        packages/core/src/hooks/useMemories.ts packages/core/src/api/__tests__/memories.test.ts
ALL_PROXY= PYTHONPATH= git commit -m "feat(core): expose memory pagination, export and local availability"
```

---

### Task 14: Memory Center UI and Its Three Test Layers

Closes S3 and gives D8 a surface. `MemoryCenter` is the only one of the four Agent centres with no tests at all.

**Files:**

- Modify: `apps/web/src/components/agent/MemoryCenter.tsx`
- Modify: `apps/web/src/components/agent/memories.css`
- Modify: `apps/web/src/i18n/locales/zh-CN.json`, `en.json`
- Test: `apps/web/src/components/__tests__/MemoryCenter.test.tsx` (new file)

**Interfaces:**

- Consumes: `useMemories` (Task 13), `MemoryPage`, `Assistant.disabledMemoryTypes`.
- Produces: no exported API beyond the default component.

- [ ] **Step 1: Add the copy**

Both locale files gain, under `memories`: `loadMore`, `localUnavailable`, `export`, `exporting`, `typeToggles`, `typeEnabled`, `typeDisabled`. The `locale-parity` test enforces key-set equality, so neither file may lag.

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/components/__tests__/MemoryCenter.test.tsx`, following `KnowledgeCenter.test.tsx`'s structure for provider setup and mocking:

```typescript
it('渲染当前页的记忆列表', async () => {
  /* … */
})
it('点击加载更多时请求下一页并追加结果', async () => {
  /* … */
})
it('最后一页不显示加载更多按钮', async () => {
  /* … */
})
it('本地记忆不可用时显示提示而不是静默少几条', async () => {
  /* … */
})
it('确认候选记忆会发出 active 状态更新', async () => {
  /* … */
})
it('关闭某个记忆类型会更新助理设置', async () => {
  /* … */
})
it('导出按钮触发导出请求', async () => {
  /* … */
})
it('英文资源下关键控件文案来自 i18n 而非硬编码', async () => {
  /* … */
})
it('状态徽标颜色取自主题 token', async () => {
  /* … */
})
```

The last two are required by `docs/testing-standards.md` §十 for any new user-visible capability: one assertion on English copy, one on theme-token colour.

- [ ] **Step 3: Run them and watch them fail**

Run: `cd apps/web && pnpm vitest run src/components/__tests__/MemoryCenter.test.tsx`
Expected: FAIL — file under test has no pagination, no unavailable banner, no toggles.

- [ ] **Step 4: Implement the UI**

Add to `MemoryCenter.tsx`: a "load more" button driven by `hasNextPage`, a banner rendered when any page reports `localUnavailable`, a memory-type toggle row patching the assistant, and an export button. Flatten `data.pages` when mapping the list. All colours come from existing semantic tokens in `memories.css`; no raw hex.

- [ ] **Step 5: Run the tests**

Run: `pnpm test:unit && pnpm lint && pnpm typecheck`
Expected: PASS, including `locale-parity`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/agent/MemoryCenter.tsx apps/web/src/components/agent/memories.css \
        apps/web/src/i18n/locales/zh-CN.json apps/web/src/i18n/locales/en.json \
        apps/web/src/components/__tests__/MemoryCenter.test.tsx
ALL_PROXY= PYTHONPATH= git commit -m "feat(web): paginate memories and expose local availability"
```

---

### Task 15: Retrieval Evaluation Set

Closes S12. A fixed annotated corpus plus three metrics, run as a test so a retrieval regression fails CI rather than being noticed months later.

**Files:**

- Create: `backend/tests/support/memory_eval_corpus.py`
- Create: `backend/tests/integration/test_memory_retrieval_eval.py`

**Interfaces:**

- Consumes: `search_active_memories` (Task 4).
- Produces:
  - `EVAL_MEMORIES: tuple[EvalMemory, ...]` — at least 30 memories across all four types
  - `EVAL_QUERIES: tuple[EvalQuery, ...]` — at least 15 queries, each with `relevant_ids: frozenset[str]`
  - `recall_at_k(ranked_ids, relevant_ids, k) -> float`
  - `mean_reciprocal_rank(rankings) -> float`
  - `citation_accuracy(results) -> float`
  - `RECALL_AT_5_FLOOR = 0.70`, `MRR_FLOOR = 0.60`, `CITATION_FLOOR = 1.0`

Floors are a ratchet: set them from the first measured run, rounded down, then never lower them without recording why in `docs/master-plan.md`.

- [ ] **Step 1: Write the corpus**

`EvalMemory` carries `key`, `memory_type`, `content`, `confidence`, and an optional `subject`. Content is in Chinese, matching real usage, and deliberately includes near-duplicates and topic-adjacent distractors so keyword-only retrieval cannot score perfectly.

- [ ] **Step 2: Write the failing evaluation test**

```python
@pytest.mark.asyncio
async def test_retrieval_meets_the_recall_and_ranking_floors(db, test_user: User) -> None:
    """检索质量不得低于既定下限，任何回退都要在 master-plan 里留痕。"""

    assistant = await _seed_corpus(db, test_user)
    recalls: list[float] = []
    rankings: list[list[str]] = []
    for query in EVAL_QUERIES:
        outcome = await search_active_memories(
            user_id=test_user.id, assistant_id=assistant.id, query=query.text, db=db, limit=5
        )
        ranked = [str(result.id) for result in outcome.results]
        recalls.append(recall_at_k(ranked, query.relevant_ids, k=5))
        rankings.append([identifier for identifier in ranked])
    assert sum(recalls) / len(recalls) >= RECALL_AT_5_FLOOR
    assert mean_reciprocal_rank(rankings) >= MRR_FLOOR


@pytest.mark.asyncio
async def test_every_result_carries_a_resolvable_source(db, test_user: User) -> None:
    """引用准确率必须是 1.0：结果必须能回到原文位置。"""

    assistant = await _seed_corpus(db, test_user)
    outcome = await search_active_memories(
        user_id=test_user.id, assistant_id=assistant.id, query="住址", db=db, limit=5
    )
    assert citation_accuracy(outcome.results) == CITATION_FLOOR
```

- [ ] **Step 3: Run, read the numbers, set the floors**

Run: `cd backend && uv run pytest tests/integration/test_memory_retrieval_eval.py -v -s`

The first run establishes the baseline. If a measured metric is below the floor written above, **do not lower the floor to make the test green** — investigate the ranking first. Lowering a floor is a deliberate, recorded decision, not a way past a red test. If the measurement genuinely warrants a different floor, record the number and the reason in `docs/master-plan.md`.

These tests need embeddings to exercise the vector arm. With no `OPENAI_API_KEY` configured they run keyword-only, which is a legitimate configuration — assert the floors hold in that mode too, since CI has no key.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/support/memory_eval_corpus.py \
        backend/tests/integration/test_memory_retrieval_eval.py
ALL_PROXY= PYTHONPATH= git commit -m "test(backend): gate memory retrieval on recall and ranking floors"
```

---

### Task 16: Agnes Text and Image Models

Adds `agnes-3.0-flash` as the new default and `agnes-image-2.5-flash` beside the 2.1 image model. Spec §9.1 and §9.2.

**Files:**

- Modify: `backend/app/services/ai_service.py:145-172`, `:480-530`, `:650-683`
- Modify: `backend/app/api/v1/media.py` (image model selection)
- Test: `backend/tests/unit/test_ai_service.py`
- Test: `backend/tests/unit/test_media_generation_service.py`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `PROVIDER_CONFIG` entries for `agnes-3.0-flash` (`kind: "chat"`) and `agnes-image-2.5-flash` (`kind: "image"`)
  - `AVAILABLE_MODELS` entry for `agnes-3.0-flash` at index 0
  - `generate_agnes_image(prompt, *, size, ratio, image_urls=(), model="agnes-image-2.1-flash")`

- [ ] **Step 1: Write the failing tests**

```python
def test_agnes_3_flash_is_the_default_when_its_key_is_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """配置 Agnes 密钥后，默认模型是 agnes-3.0-flash。"""

    monkeypatch.setitem(ai_service.API_KEYS, "agnes", "test-key")
    models = ai_service.get_available_models()
    assert models[0]["id"] == "agnes-3.0-flash"
    assert models[0]["is_default"] is True


def test_agnes_3_flash_declares_vision_and_its_real_context_window() -> None:
    """目录里的能力声明必须与供应商文档一致：512K 上下文、支持图片输入。"""

    entry = next(item for item in ai_service.AVAILABLE_MODELS if item["id"] == "agnes-3.0-flash")
    assert entry["supports_vision"] is True
    assert entry["context_length"] == 512_000


def test_only_one_model_is_marked_default(monkeypatch: pytest.MonkeyPatch) -> None:
    """列表中有且只有一个默认模型。"""

    monkeypatch.setitem(ai_service.API_KEYS, "agnes", "test-key")
    defaults = [item for item in ai_service.get_available_models() if item["is_default"]]
    assert len(defaults) == 1


@pytest.mark.asyncio
async def test_generate_agnes_image_uses_the_requested_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """图片生成必须把选中的模型传给供应商，而不是永远用 2.1。"""

    captured: dict[str, object] = {}

    async def _generate(**kwargs: object) -> object:
        captured.update(kwargs)
        return SimpleNamespace(data=[SimpleNamespace(url="https://example.invalid/a.png")])

    monkeypatch.setattr(ai_service.settings, "agnes_api_key", "test-key")
    monkeypatch.setattr(
        ai_service, "_get_client",
        lambda *_: SimpleNamespace(images=SimpleNamespace(generate=_generate)),
    )
    await ai_service.generate_agnes_image(
        "一只猫", size="2K", ratio="16:9", model="agnes-image-2.5-flash"
    )
    assert captured["model"] == "agnes-image-2.5-flash"
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && uv run pytest tests/unit/test_ai_service.py -k agnes -v`
Expected: FAIL — the catalog has neither model and `generate_agnes_image` takes no `model`.

- [ ] **Step 3: Implement**

Catalog entries, both at `https://apihub.agnes-ai.com/v1`. The `agnes-3.0-flash` entry goes **first** in `AVAILABLE_MODELS`, since `get_available_models` marks index 0 as default. `context_length: 512_000`, `supports_vision: True`, `supports_files: True`.

`generate_agnes_image` gains a keyword-only `model` parameter defaulting to `agnes-image-2.1-flash`, used for both the `PROVIDER_CONFIG` lookup and the request body. Its docstring stops naming 2.1 specifically.

- [ ] **Step 4: Verify the thinking toggle against the live API**

`_chat_extra_body` sends `chat_template_kwargs.enable_thinking` for every `agnes` model. The documentation does not confirm 3.0 accepts it.

Run a single real request with a configured key and both toggle states. If the provider rejects the field, branch `_chat_extra_body` on the model rather than the provider, and record the finding. Do not ship an untested claim that the thinking switch works.

- [ ] **Step 5: Run the tests**

Run: `cd backend && uv run pytest && uv run ruff check . && uv run mypy .`
Expected: PASS. Existing tests asserting a different default model must be updated — that is the intended behaviour change, not an accident.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/ai_service.py backend/app/api/v1/media.py backend/tests/
ALL_PROXY= PYTHONPATH= git commit -m "feat(backend): add agnes 3.0 flash and image 2.5 flash models"
```

---

### Task 17: Agnes Video 2.5 Flash

Spec §9.3. This model's request schema differs from the implemented V2.0 path, so it gets its own builder rather than being forced through the existing one.

**Files:**

- Modify: `backend/app/services/ai_service.py:1177-1214`
- Modify: `backend/app/api/v1/media.py`
- Test: `backend/tests/unit/test_media_generation_service.py`

**Interfaces:**

- Consumes: `_agnes_video_request`, `_video_snapshot` (existing).
- Produces:
  - `AGNES_VIDEO_FLASH_MODEL = "agnes-video-2.5-flash"`
  - `class AgnesVideoValidationError(ValueError)`
  - `build_video_flash_body(*, prompt, seconds, mode, size, aspect_ratio, image_urls=(), audio_urls=()) -> dict[str, object]`
  - `async create_agnes_video_flash(...) -> AgnesVideoSnapshot`
  - `get_agnes_video(video_id, *, model_name: str | None = None)`

| Aspect    | V2.0 (existing, unchanged)                    | 2.5 Flash (new)                            |
| --------- | --------------------------------------------- | ------------------------------------------ |
| Sizing    | `width`, `height`, `num_frames`, `frame_rate` | `seconds`, `size`, `aspect_ratio`          |
| Mode      | Inferred from image count                     | Explicit `text` / `keyframe` / `reference` |
| Retrieval | `GET /agnesapi?video_id=`                     | Same plus required `model_name=`           |

- [ ] **Step 1: Write the failing tests**

```python
def test_video_flash_rejects_a_size_other_than_720p() -> None:
    """Flash 只支持 720P，非法尺寸必须在本地拦下，不发请求也不计费。"""

    with pytest.raises(ai_service.AgnesVideoValidationError, match="720P"):
        ai_service.build_video_flash_body(
            prompt="一只猫", seconds="5", mode="text", size="1080P", aspect_ratio="16:9"
        )


def test_video_flash_rejects_more_than_five_reference_images() -> None:
    """参考图上限 5 张。"""

    with pytest.raises(ai_service.AgnesVideoValidationError):
        ai_service.build_video_flash_body(
            prompt="一只猫", seconds="5", mode="reference", size="720P",
            aspect_ratio="16:9", image_urls=tuple(f"https://example.invalid/{i}.png" for i in range(6)),
        )


def test_video_flash_rejects_more_than_three_reference_audios() -> None:
    """参考音频上限 3 条。"""

    with pytest.raises(ai_service.AgnesVideoValidationError):
        ai_service.build_video_flash_body(
            prompt="一只猫", seconds="5", mode="reference", size="720P",
            aspect_ratio="16:9", audio_urls=("a", "b", "c", "d"),
        )


def test_video_flash_body_carries_the_flash_schema() -> None:
    """请求体使用 seconds/mode/size/aspect_ratio，而不是 V2.0 的宽高帧率。"""

    body = ai_service.build_video_flash_body(
        prompt="一只猫", seconds="5", mode="text", size="720P", aspect_ratio="16:9"
    )
    assert body["model"] == "agnes-video-2.5-flash"
    assert body["seconds"] == "5"
    assert "width" not in body and "num_frames" not in body


@pytest.mark.asyncio
async def test_get_agnes_video_sends_model_name_for_flash_tasks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """非 text 模式的 Flash 任务必须带 model_name 才能查到结果。"""

    captured: dict[str, object] = {}

    async def _request(method: str, path: str, **kwargs: object) -> dict[str, object]:
        captured.update(kwargs)
        return {"video_id": "v1", "status": "completed"}

    monkeypatch.setattr(ai_service, "_agnes_video_request", _request)
    await ai_service.get_agnes_video("v1", model_name="agnes-video-2.5-flash")
    assert captured["params"] == {"video_id": "v1", "model_name": "agnes-video-2.5-flash"}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && uv run pytest tests/unit/test_media_generation_service.py -k flash -v`
Expected: FAIL — none of these exist.

- [ ] **Step 3: Implement**

Validation runs inside `build_video_flash_body` and raises before any network call, mirroring the provider's own "validated before task creation, queueing, billing and inference" guarantee. `get_agnes_video` gains an optional `model_name` appended to `params` when present, leaving V2.0 callers untouched.

Add the `PROVIDER_CONFIG` and `AVAILABLE_MODELS` entries with `capability: "video_generation"`, and let the media API select between the two video models.

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest && uv run ruff check . && uv run mypy .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/ai_service.py backend/app/api/v1/media.py \
        backend/tests/unit/test_media_generation_service.py
ALL_PROXY= PYTHONPATH= git commit -m "feat(backend): add agnes video 2.5 flash generation"
```

---

### Task 18: Desktop E2E and Real-Device Verification

The node-liveness fix and the unavailable marker are only observable end to end. This is also where the Web and Android checks the user requires happen.

**Files:**

- Modify: `apps/desktop/tests/e2e/execution-node.spec.ts`
- Modify: `apps/desktop/tests/e2e/execution-node-acceptance.md`

**Interfaces:** consumes everything above.

- [ ] **Step 1: Start the real stack**

Run: `pnpm dev:real`
Expected: backend on `:8000`, Web on `:3000`, PostgreSQL on `:5433`. Also start `pnpm memory:worker` and `pnpm node:sweeper` — the new behaviour is invisible without them.

- [ ] **Step 2: Write the E2E case**

Follow the existing first test at `execution-node.spec.ts:150`: `createTestUser` at `:37`, `launchApp` at `:92`, the safeStorage skip gate at `:157`, UI pairing at `:174`.

**Pairing must be fresh.** `register_node` writes capabilities once, at registration, so a node paired before Task 11 will never advertise `memory.*`. The test pairs a new node inside the case.

```typescript
test('本地记忆经节点检索，节点断开后明确报告不可用', async () => {
  // 1. 配对新节点，capabilities 含三个 memory.* 作业
  // 2. 经 REST 创建一条 storage_location=local_node 的记忆
  // 3. 经 REST 检索，断言命中该记忆，且 localUnavailable 为 false
  // 4. 关闭 Electron 应用
  // 5. 等待超过 execution_node_heartbeat_stale_seconds，让清扫器把节点置 offline
  // 6. 再次检索，断言 localUnavailable 为 true，且在远短于作业超时的时间内返回
})
```

Step 6's timing assertion is the point of the whole task: before Task 8 this path burned the full job timeout because a closed node still read as `online`.

- [ ] **Step 3: Run the desktop E2E**

Run: `cd apps/desktop && pnpm test:e2e`
Expected: PASS, including the three pre-existing cases. Record the real output — pass counts, duration, skips — do not paraphrase it.

- [ ] **Step 4: Verify on Web with playwright-cli**

Exercise the Memory Center: list pagination, load more, the local-unavailable banner, candidate confirmation, a memory-type toggle, and export. Check light and dark themes and both locales.

Run: `pnpm --filter @yuanai/web test:e2e`
Expected: PASS.

- [ ] **Step 5: Verify on Android**

**Ask the user to connect the device over USB before this step; do not assume one is attached.**

Run: `adb devices` to confirm, then launch the mobile app against the real backend and confirm chat still works with `agnes-3.0-flash` as the new default model. Mobile has no Phase 7 control surface (that is S14, batch B6), so the check is limited to the default-model change reaching mobile.

If no device is connected, say so plainly and mark the Android result unverified rather than inferring it. iOS is not verifiable on this machine at all and every iOS statement stays marked untested.

- [ ] **Step 6: Update the acceptance record**

Append the new scenario and its real measured output to `apps/desktop/tests/e2e/execution-node-acceptance.md`.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/tests/e2e/execution-node.spec.ts \
        apps/desktop/tests/e2e/execution-node-acceptance.md
ALL_PROXY= PYTHONPATH= git commit -m "test(e2e): verify local memory routing and node offline reporting"
```

- [ ] **Step 8: Shut the stack down**

There is no `dev:stop` script. Free ports 3000, 8000, and 5433 by hand, and stop both new workers.

---

### Task 19: Status Write-Back and Documentation Sweep

The batch is not done until `docs/master-plan.md` tells the next session the truth.

**Files:**

- Modify: `docs/master-plan.md`
- Modify: `README.md`, `CLAUDE.md`, `AGENTS.md` (only where they claim these features are missing)
- Modify: `docs/dev-guide.md` (two new worker processes)

- [ ] **Step 1: Mark the closed items in §0**

M1, M2, S2, S3, S5, S12 move to done. S4 becomes partial — memories endpoints paginate, the knowledge, skill, and automation lists do not.

- [ ] **Step 2: Register the debt this batch created or uncovered**

New §0 rows, each stating what is wrong rather than only naming it:

- Embedding generation still calls OpenAI `text-embedding-3-small` directly from `ai_service`; it is inside the approved module now but is not routed by the same model-selection logic as chat.
- Server-to-node job offers are signed with an HMAC the node cannot verify; node trust rests on WSS plus the bearer token alone.
- Terminal-message signatures carry no nonce or timestamp; replay is prevented by execution-state idempotency, not cryptography.
- `execution_node_min_protocol_version` is referenced nowhere; the effective rule is exact-version equality, and `ExecutionNodeStatus.update_required` is still never assigned (this is S7, still open).
- The desktop node searches local memories by keyword only — no vector arm on the node side.
- Mobile and Desktop still have no Phase 7 control surface (S14).

- [ ] **Step 3: Sweep the capability claims**

Grep `README.md`, `CLAUDE.md`, and `AGENTS.md` for statements that memory extraction, hybrid retrieval, or local-node memory do not exist. This has bitten the project before: Phase 7 shipped while three documents still said "not started".

- [ ] **Step 4: Document the new processes**

`docs/dev-guide.md` gains `pnpm memory:worker` and `pnpm node:sweeper` beside the existing worker commands, each with one line on what breaks when it is not running.

- [ ] **Step 5: Commit**

```bash
git add docs/ README.md CLAUDE.md AGENTS.md
ALL_PROXY= PYTHONPATH= git commit -m "docs(config): record memory batch delivery and new debt"
```

---

## Before Merging

- [ ] Full local CI: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test:unit && pnpm test:coverage`
- [ ] Backend gate: `cd backend && uv run ruff check . && uv run mypy . && uv run pytest`
- [ ] Web E2E and Desktop E2E both green against the real stack
- [ ] Android verified on a connected device, or explicitly recorded as unverified
- [ ] Coverage ratchets not regressed
- [ ] **Ask the user before merging.** The merge is `--no-ff` into `dev`; squash is forbidden. Pushing `dev` to the remote needs its own approval and a re-run of local CI immediately beforehand.

## Self-Review Notes

Spec coverage check, section by section:

| Spec section              | Task                       |
| ------------------------- | -------------------------- |
| §3.1 write path           | 5, 6, 7                    |
| §3.2 read path            | 4                          |
| §3.3 local-node routing   | 9, 10, 11                  |
| §3.4 node liveness        | 8                          |
| §3.5 read-job auto-accept | 11                         |
| §4 data model             | 1, 2                       |
| §5 interface changes      | 12, 13, 14                 |
| §6 error handling         | 4, 7, 9, 11                |
| §7 testing                | every task, plus 15 and 18 |
| §8 known debt             | 19                         |
| §9 model catalog          | 16, 17                     |

Two things an executor must verify rather than trust from this plan: the `AgentRunStatus` success member name used in Task 7 Step 5, and the exact signatures of `create_execution` / `fail_execution` used in Task 8 Step 5. Both are sketched from surrounding code, not copied from it.
