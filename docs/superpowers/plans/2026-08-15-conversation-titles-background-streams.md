# Conversation Titles and Background Streams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a durable, safe conversation title from the first user question and allow multiple real conversations to continue streaming while users browse other conversations on Web, Mobile, and Desktop.

**Architecture:** The backend writes a deterministic truncated title immediately, then concurrently asks Agnes 2.5 Flash for a compact summary and persists the result only while the conversation remains eligible. The existing SSE stream emits a `conversation_title` event for the completed title and clients mutate their TanStack conversation cache. `packages/core` replaces the singleton stream fields with a keyed stream registry; each conversation owns its UI state, transport handle, buffered deltas, optimistic user message, and stop path.

**Tech Stack:** FastAPI, async SQLAlchemy/Alembic, OpenAI-compatible Agnes client, Server-Sent Events, Zustand, TanStack Query, Next.js, Expo React Native, Electron React, Vitest, pytest, Playwright.

---

## File Structure

- `backend/alembic/versions/b3e7d9a4c1f2_add_conversation_title_metadata.py` adds title source and generation timestamp to `conversations`.
- `backend/app/models/conversation.py` persists the metadata; `backend/app/schemas/chat.py` returns it using camelCase aliases.
- `backend/app/services/ai_service.py` exposes a constrained non-streaming Agnes title call; `backend/app/services/conversation_title_service.py` owns fallback, sanitization, eligibility checks, and independent-session persistence.
- `backend/app/api/v1/chat.py` assigns the fallback before streaming, races title work beside the chat model, and emits `conversation_title` without delaying the first answer token.
- `packages/types/src/index.ts` declares title metadata and `ConversationStreamState` contracts.
- `packages/core/src/stores/chat.store.ts` owns keyed UI stream snapshots; `packages/core/src/hooks/useStream.ts` owns keyed live handles and cache reconciliation.
- `apps/web/src/components/ChatInterface.tsx`, `apps/desktop/src/renderer/main/App.tsx`, and `apps/mobile/app/(main)/chat/[conversationId].tsx` subscribe only to the active conversation stream. Their sidebars render each running conversation and provide a per-conversation stop action.

### Task 1: Record Existing Incidents and Authorization

**Files:**

- Create: `docs/troubleshooting.md`
- Create: `docs/superpowers/plans/2026-08-15-conversation-titles-background-streams.md`
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Document verified incidents without credentials**

Add a table for each of toolchain, Desktop, files, voice, models, QR, and Android. Every row must state the observed behavior, root cause, and exact corrective practice. Include the fixed multipart boundary, `ffprobe` duration fallback, QR recheck/re-mount, Blob download, `yuanai-app://`, Corepack lockfile policy, and LAN-IP Expo connection. Do not include API Keys, passwords, access tokens, signed URLs, or machine-specific IP addresses.

- [ ] **Step 2: Persist the documentation authority**

Replace the previous `docs/` read-only restriction in `AGENTS.md` with this rule:

```markdown
用户已于 2026-08-15 明确授权执行会话维护 `docs/`。实现新功能或修复重要问题时，
应同步更新相关使用说明、排障记录或实施计划；不得在未实现对应行为时宣称已经交付。
```

- [ ] **Step 3: Check documentation and commit it separately**

Run: `git diff --check -- AGENTS.md CLAUDE.md docs`

Expected: no trailing whitespace or malformed Markdown.

Run:

```bash
git add AGENTS.md CLAUDE.md docs/troubleshooting.md \
  docs/superpowers/plans/2026-08-15-conversation-titles-background-streams.md
git commit -m "docs(config): record cross-platform troubleshooting"
```

Expected: a documentation-only local commit; no feature code or existing attachment-preview work is staged.

### Task 2: Persisted First-Question Conversation Titles

**Files:**

- Create: `backend/alembic/versions/b3e7d9a4c1f2_add_conversation_title_metadata.py`
- Create: `backend/app/services/conversation_title_service.py`
- Create: `backend/tests/unit/test_conversation_title_service.py`
- Modify: `backend/app/models/conversation.py`
- Modify: `backend/app/schemas/chat.py`
- Modify: `backend/app/services/ai_service.py`
- Modify: `backend/app/api/v1/chat.py`
- Modify: `backend/tests/integration/test_chat.py`
- Modify: `packages/types/src/index.ts`
- Modify: `packages/core/src/hooks/useStream.ts`
- Modify: `packages/core/src/hooks/__tests__/useStream.test.tsx`
- Modify: `apps/web/src/components/ChatInterface.tsx`
- Modify: `apps/desktop/src/renderer/main/App.tsx`
- Modify: `apps/mobile/app/(main)/chat/[conversationId].tsx`

- [ ] **Step 1: Write backend title-service failure tests**

Add `test_conversation_title_service.py` with these cases:

```python
async def test_fallback_title_collapses_whitespace_and_truncates() -> None:
    assert fallback_title('  解释一下\n  async SQLAlchemy 的事务边界  ') == '解释一下 async SQLAlchemy 的事务边界'

async def test_generate_title_uses_agnes_and_sanitizes_response(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr(ai_service, 'generate_conversation_title', AsyncMock(return_value='  SQLAlchemy 事务边界  '))
    assert await generate_title_for_first_question('question') == 'SQLAlchemy 事务边界'

async def test_generate_title_keeps_fallback_when_agnes_is_unavailable(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr(ai_service, 'generate_conversation_title', AsyncMock(return_value=None))
    assert await generate_title_for_first_question('question') is None
```

- [ ] **Step 2: Run the new tests before implementing**

Run: `cd backend && uv run pytest tests/unit/test_conversation_title_service.py -x -q`

Expected: FAIL because the service and title helper do not exist.

- [ ] **Step 3: Add metadata and migration**

Define a source union and persist it as non-null `String(16)` values:

```python
title_source: Mapped[str] = mapped_column(String(16), nullable=False, default='default')
title_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

The Alembic upgrade adds both columns with `title_source='default'` for existing rows; downgrade removes them. Add `title_source` and `title_generated_at` to `ConversationResponse`, and add `titleSource` / `titleGeneratedAt` to the shared `Conversation` interface.

- [ ] **Step 4: Implement deterministic fallback and Agnes generation**

`conversation_title_service.py` must normalize first-question whitespace, cap the fallback at 48 visible characters, and append no ellipsis when the input is already shorter. `ai_service.py` must use only `agnes-2.5-flash`, a 12-second timeout, temperature 0, `max_tokens=32`, and this provider prompt:

```text
Summarize the user's first question as a concise title in the same language.
Return only the title, no quotes, emoji, numbering, or punctuation. Maximum 24 characters.
```

Missing `AGNES_API_KEY`, provider timeout, an empty completion, or malformed completion must return `None`; they must never fail the user chat request or fall back to a different paid model. Sanitize line breaks, quotes, and control characters before saving the title.

- [ ] **Step 5: Trigger once, preserve manual titles, and emit SSE**

When `/chat/stream` accepts the first non-edit user message for a conversation with `title_source='default'`, immediately save the deterministic fallback with `title_source='fallback'` and `title_generated_at=now`. Start `generate_and_store_title` concurrently using its own `AsyncSessionLocal`; it updates the row only when `title_source='fallback'`, then returns `{conversation_id, title, title_source, title_generated_at}`. The streaming generator yields exactly one event when the async result is available:

```text
event: conversation_title
data: {"conversation_id":"...","title":"SQLAlchemy 事务边界","title_source":"ai","title_generated_at":"..."}
```

If Agnes returns `None` or times out, retain the saved fallback and emit no misleading AI title. `PATCH /conversations/{id}` must set `title_source='manual'` and `title_generated_at=now`, preventing an in-flight task from overwriting a user rename.

- [ ] **Step 6: Extend client cache handling and pending UI**

In `useStream`, parse `conversation_title`, validate all fields, and update only `['conversations']` cache entry whose `id` matches. Until the backend returns a title source other than `default`, each client sidebar uses the deterministic fallback title plus a small `aria-label="正在生成会话标题"` progress indicator. Do not invalidate all messages or reset the active conversation.

- [ ] **Step 7: Add cross-layer regression tests**

Add backend integration coverage for first message fallback, one successful Agnes title, provider failure, duplicate first-message protection, and manual rename race. Add `useStream` tests for valid and malformed `conversation_title` events. Add Web/Desktop/Mobile component tests asserting the pending title is visible, the cache update changes it to the AI result, and a manual title is never overwritten.

- [ ] **Step 8: Run focused checks and actual UI verification**

Run:

```bash
cd backend && uv run pytest tests/unit/test_conversation_title_service.py tests/integration/test_chat.py -x -q
cd backend && uv run ruff check app/services/conversation_title_service.py app/api/v1/chat.py
pnpm --filter @yuanai/core typecheck && pnpm --filter @yuanai/core test:unit
pnpm --filter @yuanai/web typecheck && pnpm --filter @yuanai/web test:unit
pnpm --filter @yuanai/desktop typecheck && pnpm --filter @yuanai/desktop test:unit
pnpm --filter @yuanai/mobile typecheck && pnpm --filter @yuanai/mobile test:unit
pnpm dev:real
```

With the real app running, create a conversation, send a first question, verify an immediate truncated title, then the Agnes title or fallback remains without blocking the answer. Manually rename a second conversation while generation is pending and verify the manual text survives.

- [ ] **Step 9: Commit only title-generation changes**

```bash
git add backend/alembic/versions/b3e7d9a4c1f2_add_conversation_title_metadata.py \
  backend/app/models/conversation.py backend/app/schemas/chat.py \
  backend/app/services/ai_service.py backend/app/services/conversation_title_service.py \
  backend/app/api/v1/chat.py backend/tests/unit/test_conversation_title_service.py \
  backend/tests/integration/test_chat.py packages/types/src/index.ts \
  packages/core/src/hooks/useStream.ts packages/core/src/hooks/__tests__/useStream.test.tsx \
  apps/web apps/desktop apps/mobile
git commit -m "feat(backend,core,web,mobile,desktop): generate conversation titles"
```

Expected: title feature only; do not include pending attachment-preview or startup-script changes.

### Task 3: Per-Conversation Background Stream Registry

**Files:**

- Create: `packages/core/src/streams/conversation-stream-registry.ts`
- Create: `packages/core/src/streams/conversation-stream-registry.test.ts`
- Modify: `packages/core/src/stores/chat.store.ts`
- Modify: `packages/core/src/hooks/useStream.ts`
- Modify: `packages/core/src/hooks/__tests__/useStream.test.tsx`
- Modify: `apps/web/src/components/ChatInterface.tsx`
- Modify: `apps/web/src/components/chat/MessageList.tsx`
- Modify: `apps/desktop/src/renderer/main/App.tsx`
- Modify: `apps/mobile/app/(main)/chat/[conversationId].tsx`
- Modify: `apps/mobile/src/components/main/ConversationList.tsx`

- [ ] **Step 1: Write registry failure tests**

Create two independent fake `StreamHandle`s and assert that their deltas never mix:

```typescript
it('keeps two conversations live after active view changes', async () => {
  await registry.send(params('conv-a'))
  await registry.send(params('conv-b'))
  emit('conv-a', 'content_delta', { token: 'A' })
  emit('conv-b', 'content_delta', { token: 'B' })
  expect(getStream('conv-a')?.content).toBe('A')
  expect(getStream('conv-b')?.content).toBe('B')
})

it('stops only the requested conversation and keeps partial output', () => {
  registry.stop('conv-a')
  expect(handleA.close).toHaveBeenCalledOnce()
  expect(getStream('conv-b')?.status).toBe('streaming')
})
```

- [ ] **Step 2: Run core failure tests**

Run: `pnpm --filter @yuanai/core test:unit -- conversation-stream-registry`

Expected: FAIL because the registry and keyed snapshots do not exist.

- [ ] **Step 3: Replace singleton stream state with keyed snapshots**

Define a `ConversationStreamState` per conversation:

```typescript
interface ConversationStreamState {
  conversationId: string
  status: 'streaming' | 'stopped' | 'failed'
  content: string
  thinking: string
  toolCalls: ToolCall[]
  optimisticUserMessage: string | null
  optimisticFiles: MessageFile[]
  startedAt: number
}
```

`chat.store.ts` stores `streams: Record<string, ConversationStreamState>` and exposes every mutation with a `conversationId` parameter. Export a selector helper that returns a stable empty snapshot when a conversation has no stream. Retain `TEMPORARY_CONV_ID` as a separate keyed stream so temporary chat remains behaviorally identical.

- [ ] **Step 4: Move live handles and buffers into the registry**

`conversation-stream-registry.ts` owns `Map<string, ActiveConversationStream>` where each entry contains its `StreamHandle`, buffered content/thinking deltas, server message IDs, stopped flag, timer, and `QueryClient`. A route unmount must not close this map. `useStream()` becomes a thin React adapter around registry `send`, `sendTemporary`, `stop(conversationId)`, `isStreaming(conversationId)`, and `activeConversationIds()`.

On normal close, flush only that conversation, refetch only `['messages', conversationId]` and `['conversations']`, then remove only that entry. On stop, write its optimistic user and partial assistant messages into that conversation's query cache before closing its handle. Auth refresh retries only the failed entry, never replays another conversation.

- [ ] **Step 5: Render per-conversation state in all clients**

Use the active conversation selector in the Web `ChatInterface`, Electron main renderer, and Expo `[conversationId]` route so only the open conversation's message list receives token re-renders. In Web, Electron, and Mobile conversation lists, derive `Object.keys(streams)` to render a compact progress indicator and an icon-only stop control for every running conversation. The stop control calls `stream.stop(conversation.id)`, has an accessible label that includes the conversation title, and does not navigate away from the current screen.

- [ ] **Step 6: Add view-level regressions**

Extend core hook tests for switching views without aborting a stream, concurrent tokens, independent error completion, partial-message persistence, and re-entry after a completed stream. Add Web, Desktop, and Mobile tests that start a background stream, select another conversation, verify the source row shows a running icon, return to it, and stop that exact row while a second stream remains active.

- [ ] **Step 7: Run focused checks and actual UI verification**

Run:

```bash
pnpm --filter @yuanai/core typecheck && pnpm --filter @yuanai/core test:unit
pnpm --filter @yuanai/web typecheck && pnpm --filter @yuanai/web test:unit
pnpm --filter @yuanai/desktop typecheck && pnpm --filter @yuanai/desktop test:unit
pnpm --filter @yuanai/mobile typecheck && pnpm --filter @yuanai/mobile test:unit
pnpm dev:real
pnpm --filter @yuanai/desktop dev
pnpm --filter @yuanai/mobile start
```

Use the real API to start a response in conversation A, switch to B before completion, confirm A retains a running indicator, start B, then stop A. Return to A and confirm partial output persists while B continues. Repeat the switch in Electron and on the connected Expo device.

- [ ] **Step 8: Commit only background-stream changes**

```bash
git add packages/core/src/streams packages/core/src/stores/chat.store.ts \
  packages/core/src/hooks/useStream.ts packages/core/src/hooks/__tests__/useStream.test.tsx \
  apps/web/src/components/ChatInterface.tsx apps/web/src/components/chat/MessageList.tsx \
  apps/desktop/src/renderer/main/App.tsx \
  'apps/mobile/app/(main)/chat/[conversationId].tsx' \
  apps/mobile/src/components/main/ConversationList.tsx
git commit -m "feat(core,web,mobile,desktop): keep conversation streams running"
```

Expected: one local stream-registry commit; no push or merge to `dev`.

## Plan Review

- Spec coverage: Task 1 records all verified prior incidents and the explicit documentation authorization. Task 2 implements Agnes-first title generation with an immediate fallback, persistence, SSE, cache update, all three clients, and manual-rename protection. Task 3 provides concurrent background streams, per-row status/stop controls, and real cross-platform verification.
- Placeholder scan: every task names files, tests, events, metadata, expected command output, and commit boundary; no unspecified fallback provider or ambiguous stop behavior remains.
- Type consistency: `Conversation.titleSource` / `titleGeneratedAt` come from the backend response and SSE payload; `ConversationStreamState.conversationId` keys the store, registry, message cache, sidebar status, and stop operation.
