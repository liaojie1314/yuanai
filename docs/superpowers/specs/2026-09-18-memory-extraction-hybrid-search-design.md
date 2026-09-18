# Memory Extraction and Hybrid Search Design

**Date:** 2026-09-18
**Batch:** B1 of the Phase 1-7 completion program
**Branch:** `feature/memory-extraction-hybrid-search`
**Phase spec:** `docs/phases/phase-7-memory-skills-automation.md` §4, §5, §11.2
**Status source of truth:** `docs/master-plan.md` §0

## 1. Why This Exists

`docs/master-plan.md` §3.1 records that Phase 7 delivered a control plane — models, CRUD APIs,
shared hooks, Web UI — while the mechanisms the phase document actually describes were never
built. This batch closes the memory half of that gap.

Items closed: **M1** (MemoryExtractor write pipeline), **M2** (pgvector migration, RRF hybrid
retrieval, rerank), **S2** (local-node routing), **S3** (MemoryCenter three-layer tests),
**S4** (cursor pagination, memories endpoints only), **S5** (memory export), **S12** (retrieval
evaluation set).

Out of scope, staying in §0 for later batches: knowledge ingestion (M3), webhooks (M4), skill
evaluation gating (M5), persona (M6), and cursor pagination for the knowledge/skill/automation
list endpoints (rest of S4).

## 2. Decisions Taken

These were decided by the user before this document was written. They are not open for
re-litigation during implementation.

| #   | Decision            | Chosen                                                                   | Consequence                                                                                  |
| --- | ------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| D1  | Extraction trigger  | Background worker + LLM via `ai_service.py`                              | New worker process; extraction failure never touches the run's critical path                 |
| D2  | Vector storage      | `pgvector/pgvector:pg16` image, `vector(1536)`, HNSW cosine              | Container image changes in `docker-compose.yml` and `.github/workflows/ci.yml`               |
| D3  | Embedding call site | Move `embed_text` into `ai_service.py`                                   | Closes the CLAUDE.md violation where memory retrieval called OpenAI directly                 |
| D4  | Rerank              | Deterministic rules                                                      | No extra model round trip on the Agent hot path; keeps §7 evaluation reproducible            |
| D5  | Local-node memories | Full routing: `memory.search` + `memory.write` + `memory.delete` jobs    | Cloud stores metadata only for `local_node` rows; content lives on the desktop node          |
| D6  | Node liveness       | New heartbeat sweeper worker that writes `offline`                       | Fixes a repo-wide defect: nothing ever moved a node out of `online`                          |
| D7  | Read-job approval   | Read-risk jobs auto-accept on the node                                   | Memory retrieval sits on the Agent context-assembly path; per-job clicking makes it unusable |
| D8  | Memory-type opt-out | New `assistants.disabled_memory_types` column plus Memory Center toggles | All five §4.1 auto-activation conditions become enforceable instead of four                  |
| D9  | Extraction model    | `agnes-2.5-flash`, the model `generate_conversation_title` already uses  | Cheap, bounded, and gives the §7 evaluation set a stable baseline                            |

## 3. Architecture

### 3.1 Write path (M1)

```text
AgentRun reaches a terminal success state
  -> agent_worker enqueues {run_id, tenant_id} on Redis after the run transaction commits
  -> memory_worker dequeues
       -> builds an extraction prompt from run goal + step summaries
       -> ai_service.extract_memory_candidates()   agnes-2.5-flash, timeout, None on failure
       -> sensitivity classification (rules)
       -> deduplication against existing memories
       -> conflict detection against active memories on the same subject
       -> policy decides: discard / candidate / auto-activate
       -> persists; superseded predecessors keep their source chain
```

Enqueue happens strictly after the run's own commit, so a crash in extraction can never roll
back or delay the run. A failed or unavailable model yields zero candidates rather than a
partial write.

**Auto-activation** requires every condition in phase doc §4.1 to hold: not
sensitive/restricted, the fact was stated explicitly at least once, no conflict with an active
memory, the content is a stable preference or identity fact rather than transient state, and
the memory type is not disabled on the owning assistant. Anything else becomes a `candidate`
for review in the Memory Center. Ambiguity resolves toward `candidate`, never toward
activation.

The last condition needs somewhere to live: there is no settings model, no settings API, and no
policy field on `assistants`. A nullable `assistants.disabled_memory_types` column backs it,
edited from the Memory Center. Without it the condition would be unenforceable and §4.1 would
be satisfied only four conditions out of five.

**Conflict handling** follows §4.2: a new fact does not overwrite its predecessor. The older
memory moves to `superseded` and retains `source_type` / `source_id` / `source_excerpt`, so the
provenance chain stays walkable.

### 3.2 Read path (M2)

`search_active_memories` currently loads every accessible row and scores it in Python. It is
replaced by a two-arm SQL recall:

1. **Filter first.** Tenant, assistant, status, sensitivity, validity window, workspace, and
   storage location are SQL predicates. Phase doc §6.3 forbids recalling across tenants and
   filtering afterwards; pushing filters down is what makes ANN recall safe.
2. **Keyword arm.** `search_vector @@ plainto_tsquery('simple', :query)` ordered by `ts_rank`.
   The column and its GIN index already exist.
3. **Vector arm.** `embedding <=> :query_embedding` ordered ascending, HNSW-backed. Skipped
   entirely when no embedding is available, leaving keyword-only results rather than an error.
4. **Reciprocal Rank Fusion.** `score = Σ 1/(k + rank_i)` with `k = 60`, merging the two ranked
   lists. RRF needs only ranks, so the two arms' incomparable score scales never mix.
5. **Rule rerank.** Deterministic adjustment by confidence, recency, `last_used_at`, and memory
   type, then truncate to `limit`. Phase doc §5.1 forbids ranking on embedding distance alone;
   this satisfies it without a second model call.

Retrieval results keep carrying source IDs, and `MemoryContextItem.untrusted` stays `True`.

### 3.3 Local-node routing (S2)

Phase doc §5.3 says a `local_node` memory keeps only encrypted index metadata and a node ID in
the cloud. Today `memories.content` is `NOT NULL` and holds the text regardless of storage
location, and `search_active_memories` silently drops local rows. Three job types close this:

| Job             | Direction     | Trigger                                    |
| --------------- | ------------- | ------------------------------------------ |
| `memory.search` | cloud -> node | Retrieval when the user has local memories |
| `memory.write`  | cloud -> node | Create or update of a `local_node` memory  |
| `memory.delete` | cloud -> node | Delete of a `local_node` memory            |

The node keeps content in an encrypted store built on the existing `encrypted-file.ts` helpers
(Electron `safeStorage`, OS keychain custody, `0o600` atomic writes) — the same construction
`grants.ts` already uses. `memories.content` becomes nullable; for `local_node` rows the cloud
holds metadata only.

When no fresh node is online, creation and deletion fail with a clear error, and retrieval
returns an explicit "local private memories are unavailable" marker instead of silently
dropping rows or falling back to a cloud copy. Silence is the specific behaviour §5.3 forbids.

Job dispatch reuses the existing offer/accept/progress/terminal protocol. `tool_name` is a free
string validated only by `^[a-z][a-z0-9_.-]{0,99}$`, so dotted names are legal and
`EXECUTION_NODE_PROTOCOL_VERSION` stays `"1"`. Raising it would break every paired node, since
version checks are exact-equality and `update_required` is never assigned.

### 3.4 Node liveness (D6)

Nothing in the repository ever moves an `ExecutionNode` back to `offline`. `set_node_online`
writes `online`; `last_seen_at` is written and displayed but participates in no decision. A
closed desktop app therefore still looks online, and `_select_desktop_node` keeps choosing it
until the job times out.

A heartbeat sweeper worker marks nodes whose `last_seen_at` is older than a configured
threshold as `offline`. It follows `automation_scheduler.py`'s shape: a polling loop with a
`package.json` script entry. This fixes desktop tool routing generally, not only memory.

### 3.5 Read-job auto-accept (D7)

Every job today waits for a click in the desktop settings page. Read-risk jobs on an explicit
allow-list are accepted automatically by the node; write and delete jobs keep requiring
confirmation. The distinction is risk, not convenience: a read the user implicitly requested by
asking a question gains nothing from a modal, whereas a write to local storage does.

## 4. Data Model Changes

One migration, in this order:

1. `CREATE EXTENSION IF NOT EXISTS vector`
2. `memories.embedding`: `JSON` -> `vector(1536)`, existing rows converted in place
3. `knowledge_chunks.embedding`: `JSON` -> `vector(1536)`, same conversion
4. HNSW indexes with `vector_cosine_ops` on both columns
5. `memories.content`: `NOT NULL` -> nullable, for local-node metadata rows
6. `memories.node_id`: new nullable column referencing the owning execution node
7. `assistants.disabled_memory_types`: new nullable JSON column (D8)

The knowledge column is migrated here because it shares the extension and the conversion
helper. The knowledge **ingestion pipeline** stays in batch B2; only the column type moves now.

Downgrade converts vectors back to JSON and restores the `NOT NULL` constraint, failing loudly
if local-node rows without content exist rather than silently deleting them.

## 5. Interface Changes

| Surface                | Change                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `GET /memories`        | Cursor pagination: `{items, nextCursor}` replaces a bare array (S4)                                   |
| `GET /memories/export` | New; full export of the caller's memories (S5)                                                        |
| `packages/types`       | Paginated list response, export payload, local-node availability marker, assistant memory-type policy |
| `packages/core`        | `listMemories` and `useMemories` become cursor-aware                                                  |
| Web Memory Center      | Consumes the paginated shape; surfaces the local-unavailable state; memory-type toggles               |
| Desktop node           | Three new job handlers, one new encrypted store, capability list entry                                |

The `GET /memories` shape change is breaking. Every caller lives in this repository and is
updated in the same commit.

## 6. Error Handling

| Failure                                   | Behaviour                                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| Embedding provider unavailable            | Keyword-only retrieval; no error surfaced to the Agent                                   |
| Extraction model unavailable or malformed | Zero candidates; run already committed and unaffected                                    |
| No fresh node for a local memory          | Retrieval returns the unavailable marker; write and delete fail with a stable error code |
| Node result exceeds the size ceiling      | Rejected by the existing gate; retrieval degrades to cloud-only results                  |
| Extraction worker crashes                 | Redis entry stays queued for redelivery; extraction is idempotent through deduplication  |

## 7. Testing

| Layer                      | Coverage                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend unit               | Extraction policy table (discard / candidate / auto-activate), sensitivity classification, deduplication, conflict supersession, RRF fusion, rule rerank, node-freshness selection, sweeper transitions |
| Backend integration        | Full write pipeline against real PostgreSQL with pgvector; hybrid retrieval ranking; cursor pagination; export; tenant isolation on every new endpoint                                                  |
| Retrieval evaluation (S12) | Fixed annotated corpus with Recall@K, MRR, and citation accuracy, run as a test so regressions fail CI                                                                                                  |
| Desktop unit               | Encrypted memory store, three job handlers, size ceiling, cancellation                                                                                                                                  |
| Web (S3)                   | MemoryCenter component, `useMemories` hook, and memories API — the three layers the other three Centers already have                                                                                    |
| Desktop E2E                | Pair, write a local memory, search it, then disconnect the node and assert the unavailable marker arrives promptly instead of hanging                                                                   |

The E2E disconnect case is the only place the node-liveness fix is observable end to end.

## 8. Known Debt Created

Registered in `docs/master-plan.md` §0 as part of this batch:

- Server-to-node job offers are signed with an HMAC the node cannot verify; node trust rests
  entirely on WSS plus the bearer token.
- Terminal-message signatures carry no nonce or timestamp. Replay protection is idempotency in
  the execution state machine, not cryptography.
- `_select_desktop_node` picks the first matching row with no ordering, so multi-node users get
  a non-deterministic node.
- `execution_node_min_protocol_version` exists in config and is referenced nowhere; the
  effective rule is exact-version equality.

## 9. Bundled Work: Agnes Model Catalog

Requested mid-design and delivered on this branch as its own commit, because it edits
`ai_service.py` and would conflict with a parallel branch. It shares no other file with the
memory work.

Three models join the catalog. Source: `https://www.agnes-ai.com/en/docs/`, base URL
`https://apihub.agnes-ai.com/v1` for all three.

### 9.1 `agnes-3.0-flash` (text)

OpenAI-compatible chat completions, so it needs only a `PROVIDER_CONFIG` entry and an
`AVAILABLE_MODELS` entry — the generic chat path already covers it. 512K context, 65,536 max
output, text and image-URL input, tool calling, thinking mode.

It becomes the **default model**: `get_available_models()` marks the first surviving catalog
entry as default, so the entry goes at the head of `AVAILABLE_MODELS`. This changes behaviour
for every existing session that never pinned a model explicitly.

`_chat_extra_body` already sends `chat_template_kwargs.enable_thinking` for the `agnes`
provider. Whether 3.0 accepts the same toggle is unverified from the documentation and must be
confirmed against the live API before the thinking switch is claimed to work.

### 9.2 `agnes-image-2.5-flash` (image)

`generate_agnes_image()` hardcodes the 2.1 model ID in both the config lookup and the request
body. It gains a model parameter; callers pass the selected model. The request shape is
unchanged — resolution tier (`1K`/`2K`/`3K`/`4K`) plus `ratio`, `response_format: url`.

### 9.3 `agnes-video-2.5-flash` (video)

The largest of the three: the request schema differs from the V2.0 path already implemented.

| Aspect    | `agnes-video-v2.0` (current)                  | `agnes-video-2.5-flash` (new)                      |
| --------- | --------------------------------------------- | -------------------------------------------------- |
| Sizing    | `width`, `height`, `num_frames`, `frame_rate` | `seconds`, `size`, `aspect_ratio`                  |
| Mode      | Implied by image count                        | Explicit `mode`: `text` / `keyframe` / `reference` |
| Retrieval | `GET /agnesapi?video_id=`                     | Same plus a required `model_name=`                 |

Flash-specific validation, rejected before task creation so nothing is queued or billed:
`size` must be exactly `"720P"`, at most 5 reference images, at most 3 reference audios, and
reference video input is unsupported. These are enforced backend-side as well, so an invalid
request never reaches the provider.

The V2.0 path stays intact; the two schemas live side by side rather than one being contorted
into the other.

### 9.4 Testing

Catalog entries are covered by existing `get_available_models` tests extended for the new IDs
and the default-model change. The video request builder and its four validation rules get unit
tests. No integration test calls the live provider.
