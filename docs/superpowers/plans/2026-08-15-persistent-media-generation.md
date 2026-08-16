# Persistent Image and Video Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow an authenticated user to create durable Agnes image and video generation tasks from any chat client, restore their assistant task cards after reload, and preview/download successful output.

**Architecture:** A `media_generation_tasks` row is created together with an assistant `Message`, making the message list the durable timeline and the task row the state machine. A single backend worker claims durable rows, calls Agnes through `ai_service.py`, copies finished media to existing object storage, and records the normalized task state. The Core API exposes query/mutation hooks; Web, Electron, and Expo render the same state through platform-native presentation.

**Tech Stack:** FastAPI, async SQLAlchemy/Alembic, Redis-backed worker lease, httpx/OpenAI-compatible Agnes APIs, existing S3/MinIO storage, TanStack Query, Zustand streaming state, React 19, Electron 33, Expo SDK 52, Vitest, pytest.

## Global Constraints

- Keep `AGNES_API_KEY` environment-only; never put keys, provider URLs containing secrets, user prompts, or generated signed URLs in source, tests, plans, logs, or commits.
- All Agnes calls remain in `backend/app/services/ai_service.py`; no frontend calls a model provider directly.
- Implement text-to-image, image-to-image, text-to-video, image-to-video and multi-image keyframe workflows. Only image attachments owned by the current user are eligible as media references.
- The composer has mutually exclusive Chat, Image and Video modes. Image/video modes disable text-only web-search and thinking controls, and present validated generation specifications above the draft field.
- Image defaults are `1K` and `1:1`, with Agnes `1K`-`4K` tiers and documented aspect ratios. Video defaults are `1152x768`, `121` frames, and `24` fps; the UI only offers valid `8n + 1` duration presets and documented aspect ratios. Validate all client input server-side.
- Store finished provider output with `storage.put_object`; clients receive YuanAI storage URLs only, never an Agnes result URL.
- Task state is exactly `queued`, `running`, `succeeded`, `failed`, or `canceled`. Cancellation stops local polling and suppresses result persistence because Agnes Video documents no cancellation endpoint.
- Existing chat models stay in normal model selectors; `agnes-image-2.1-flash` and `agnes-video-v2.0` are selected only by this task API.
- Keep package code platform-neutral; browser, Electron, and React Native UI remains under its owning `apps/` directory.
- Use package scripts for all checks and real UI verification. Do not push or merge to `dev`; create exactly one local Conventional Commit after the complete feature passes.

## File Structure

| Path                                                                                                                          | Responsibility                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `backend/app/models/media_generation_task.py`                                                                                 | Durable task ORM model, type/status enums, provider identifiers, lease fields, and result storage metadata.        |
| `backend/alembic/versions/c6d7e8f9a0b1_add_media_generation_tasks.py`                                                         | Creates the task table, indexes, FK constraints, and status check constraint.                                      |
| `backend/app/schemas/media_generation.py`                                                                                     | Camel-case create/update/list response contracts and validated image/video options.                                |
| `backend/app/services/media_generation_service.py`                                                                            | Authorization, state transitions, worker claim/recovery, storage persistence, and notification handoff.            |
| `backend/app/services/ai_service.py`                                                                                          | Agnes request/response normalization for image creation and video create/poll operations.                          |
| `backend/app/api/v1/media.py`                                                                                                 | Thin authenticated routes for create, query, list, and cancel.                                                     |
| `backend/app/main.py` / `backend/app/models/__init__.py`                                                                      | Registers the router/model and starts/stops the worker.                                                            |
| `packages/types/src/index.ts`                                                                                                 | Shared media-task types and the optional message `mediaTask` field.                                                |
| `packages/core/src/api/media.ts`                                                                                              | Typed HTTP client for task endpoints.                                                                              |
| `packages/core/src/hooks/use-chat-queries.ts`                                                                                 | Mutations/query polling with precise message/conversation invalidation.                                            |
| `apps/*/.../MediaTaskCard.*`                                                                                                  | Platform-specific assistant task cards; Web and Desktop offer in-app media preview, Mobile uses the native viewer. |
| `apps/web/src/components/ChatInterface.tsx`, `apps/desktop/src/renderer/main/App.tsx`, `apps/mobile/.../[conversationId].tsx` | Composer generation mode, create action, optimistic task display, errors, and refresh-safe query state.            |

---

### Task 1: Define the durable media-task contract and message projection

**Files:**

- Create: `backend/app/models/media_generation_task.py`
- Create: `backend/alembic/versions/c6d7e8f9a0b1_add_media_generation_tasks.py`
- Create: `backend/app/schemas/media_generation.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/models/message.py`
- Modify: `backend/app/schemas/chat.py`
- Modify: `backend/app/api/v1/chat.py`
- Modify: `packages/types/src/index.ts`
- Test: `backend/tests/unit/test_media_generation_service.py`
- Test: `backend/tests/integration/test_media_generation.py`

**Interfaces:**

```python
class MediaGenerationType(StrEnum):
    image = "image"
    video = "video"

class MediaGenerationStatus(StrEnum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    canceled = "canceled"

class MediaGenerationTask(Base):
    id: Mapped[uuid.UUID]
    user_id: Mapped[uuid.UUID]
    conversation_id: Mapped[uuid.UUID]
    message_id: Mapped[uuid.UUID]
    kind: Mapped[MediaGenerationType]
    model: Mapped[str]
    prompt: Mapped[str]
    request_options: Mapped[dict[str, object]]
    status: Mapped[MediaGenerationStatus]
    progress: Mapped[int]
    provider_task_id: Mapped[str | None]
    provider_video_id: Mapped[str | None]
    result_s3_key: Mapped[str | None]
    result_mime_type: Mapped[str | None]
    result_width: Mapped[int | None]
    result_height: Mapped[int | None]
    result_duration_seconds: Mapped[float | None]
    error_code: Mapped[str | None]
    error_message: Mapped[str | None]
    lease_expires_at: Mapped[datetime | None]
```

```typescript
export type MediaGenerationType = 'image' | 'video'
export type MediaGenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'

export interface MediaGenerationTask {
  id: string
  conversationId: string
  messageId: string
  type: MediaGenerationType
  model: 'agnes-image-2.1-flash' | 'agnes-video-v2.0'
  prompt: string
  status: MediaGenerationStatus
  progress: number
  resultUrl: string | null
  resultMimeType: string | null
  resultWidth: number | null
  resultHeight: number | null
  resultDurationSeconds: number | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 1: Write failing persistence and serialization tests**

```python
async def test_created_image_task_has_assistant_message_and_no_provider_url(client, auth_headers):
    response = await client.post(
        "/api/v1/media/tasks",
        headers=auth_headers,
        json={"conversationId": CONVERSATION_ID, "type": "image", "prompt": "A red kite"},
    )
    assert response.status_code == 201
    task = response.json()
    assert task["status"] == "queued"
    assert task["messageId"]
    assert task["resultUrl"] is None

    messages = await client.get(
        f"/api/v1/chat/conversations/{CONVERSATION_ID}/messages", headers=auth_headers
    )
    assert messages.json()["messages"][-1]["mediaTask"]["id"] == task["id"]
```

- [ ] **Step 2: Run the focused test and verify the missing contract fails**

Run: `cd backend && uv run pytest tests/integration/test_media_generation.py::test_created_image_task_has_assistant_message_and_no_provider_url -q`

Expected: FAIL because `/media/tasks` and `MessageResponse.media_task` do not exist.

- [ ] **Step 3: Add the model, migration, and response projection**

Use a PostgreSQL enum or `String` constrained by the migration consistently; store `request_options` as JSON and constrain `progress` to `0..100`. Add unique `message_id`, indexes on `(user_id, status)` and `(status, lease_expires_at)`, and `ON DELETE CASCADE` on user/conversation/message FKs. Create the assistant message with `role=assistant`, a stable non-provider-facing content fallback such as `正在生成图片`, and the selected media model. Extend `MessageResponse` with `media_task: MediaGenerationTaskResponse | None`; in `list_messages`, load all tasks by `message_id` in one query and attach only the matching task.

```python
task_rows = await db.execute(
    select(MediaGenerationTask).where(MediaGenerationTask.message_id.in_([item.id for item in messages]))
)
tasks_by_message = {task.message_id: MediaGenerationTaskResponse.from_task(task, storage) for task in task_rows.scalars()}
for item in items:
    item.media_task = tasks_by_message.get(item.id)
```

`MediaGenerationTaskResponse.from_task` must derive `result_url` only from `storage.get_url(result_s3_key)`, return `None` for non-success states, and never serialize a provider task/result URL.

- [ ] **Step 4: Add the shared TypeScript types and API-message decoding test**

Add `mediaTask?: MediaGenerationTask | null` to `Message`. Keep ordinary assistant `messageParts` unchanged; a media task is a first-class task card rather than a fabricated `MediaPart` while it is pending.

```typescript
expect(toMessage(rawMessage)).toMatchObject({
  id: 'assistant-1',
  mediaTask: { id: 'task-1', type: 'video', status: 'running', progress: 42 },
})
```

- [ ] **Step 5: Run the persistence regression set**

Run:

```bash
cd backend && uv run alembic upgrade head
cd backend && uv run pytest tests/unit/test_media_generation_service.py tests/integration/test_media_generation.py tests/integration/test_chat.py -x -q
cd backend && uv run ruff check app/models/media_generation_task.py app/schemas/media_generation.py app/api/v1/chat.py
```

Expected: migration applies cleanly; message history returns a task card for the owner and 404 for another user.

### Task 2: Implement Agnes execution, durable recovery, and authenticated task routes

**Files:**

- Create: `backend/app/services/media_generation_service.py`
- Create: `backend/app/api/v1/media.py`
- Modify: `backend/app/services/ai_service.py`
- Modify: `backend/app/core/config.py`
- Modify: `backend/.env.example`
- Modify: `backend/app/main.py`
- Modify: `backend/app/models/__init__.py`
- Test: `backend/tests/unit/test_ai_service.py`
- Test: `backend/tests/unit/test_media_generation_service.py`
- Test: `backend/tests/integration/test_media_generation.py`

**Interfaces:**

```python
async def create_media_task(
    *, user_id: uuid.UUID, conversation_id: uuid.UUID, request: CreateMediaGenerationRequest, db: AsyncSession
) -> MediaGenerationTask: ...

async def run_media_generation_worker(stop_event: asyncio.Event) -> None: ...

async def generate_agnes_image(prompt: str, *, size: str, ratio: str) -> AgnesImageResult: ...
async def create_agnes_video(prompt: str, *, width: int, height: int, num_frames: int, frame_rate: int) -> AgnesVideoSnapshot: ...
async def get_agnes_video(video_id: str) -> AgnesVideoSnapshot: ...
```

- [ ] **Step 1: Write failing provider-normalization tests**

```python
async def test_generate_agnes_image_uses_documented_response_format(httpx_mock):
    httpx_mock.add_response(
        json={"data": [{"url": "https://provider.example/output.png"}]}
    )
    result = await generate_agnes_image("A red kite", size="1K", ratio="1:1")
    request = httpx_mock.get_requests()[0]
    assert request.url.path == "/v1/images/generations"
    assert request.json()["extra_body"] == {"response_format": "url"}
    assert result.url == "https://provider.example/output.png"

async def test_video_snapshot_maps_completed_metadata_url(httpx_mock):
    httpx_mock.add_response(json={"status": "completed", "progress": 100, "metadata": {"url": "https://provider.example/result.mp4"}})
    snapshot = await get_agnes_video("video-1")
    assert snapshot.status == "succeeded"
    assert snapshot.result_url == "https://provider.example/result.mp4"
```

- [ ] **Step 2: Run unit tests and verify the provider functions are absent**

Run: `cd backend && uv run pytest tests/unit/test_ai_service.py -k 'agnes_image or agnes_video' -q`

Expected: FAIL because the media functions and result dataclasses do not exist.

- [ ] **Step 3: Implement documented Agnes requests in `ai_service.py`**

Use `AsyncOpenAI(api_key=settings.agnes_api_key, base_url="https://apihub.agnes-ai.com/v1")` for the documented image endpoint, with `model="agnes-image-2.1-flash"`, a validated tier/ratio, and `extra_body={"response_format": "url"}`. Use a bounded `httpx.AsyncClient` for `POST https://apihub.agnes-ai.com/v1/videos` and `GET /agnesapi?video_id=...`, because the video endpoints are not represented by the OpenAI chat interface. Normalize provider `queued`/`in_progress`/`completed`/`failed` into the five application statuses and map only safe public error code/message text.

```python
response = await client.post(
    "/v1/videos",
    headers={"Authorization": f"Bearer {settings.agnes_api_key}"},
    json={"model": "agnes-video-v2.0", "prompt": prompt, "width": width, "height": height,
          "num_frames": num_frames, "frame_rate": frame_rate},
)
response.raise_for_status()
payload = response.json()
return AgnesVideoSnapshot(
    provider_task_id=str(payload["task_id"]),
    video_id=str(payload["video_id"]),
    status=normalize_agnes_video_status(str(payload.get("status", "failed"))),
    progress=min(100, max(0, int(payload.get("progress", 0)))),
    result_url=None,
    width=None,
    height=None,
    duration_seconds=parse_optional_seconds(payload.get("seconds")),
)
```

Treat a missing key as `MediaProviderUnavailableError`, use a 90-second image request timeout and 20-second video poll timeout, and log only task IDs plus normalized error codes.

- [ ] **Step 4: Implement claim, recovery, and result persistence**

At startup, start one `run_media_generation_worker(stop_event)` task from `lifespan`; set the stop event and await it on shutdown. In each tick, atomically claim one eligible row with `SELECT ... FOR UPDATE SKIP LOCKED`: `queued`, or `running` with expired lease. Set a 60-second lease and commit before contacting Agnes. On image success or video completion, download the media through bounded `httpx`, validate `image/*`/`video/mp4` and maximum configured output size, write `generated/{user_id}/{task_id}.{ext}` with `storage.put_object`, then transition atomically to `succeeded` and progress `100`.

```python
if task.status is MediaGenerationStatus.canceled:
    return
task.result_s3_key = await persist_generated_media(task, provider_url)
task.status = MediaGenerationStatus.succeeded
task.progress = 100
task.lease_expires_at = None
await db.commit()
```

On an upstream failure, use `failed`; on a restart, an expired image lease is retried once and then fails with `MEDIA_WORKER_RECOVERY_EXHAUSTED`. Never change a user-canceled row after the upstream call returns. Call the existing `send_to_user` completion pathway only after a successful state transition.

- [ ] **Step 5: Add thin routes and lifecycle tests**

Create these authenticated routes; each route first verifies the conversation belongs to `current_user`:

```text
POST   /api/v1/media/tasks
GET    /api/v1/media/tasks/{task_id}
GET    /api/v1/chat/conversations/{conv_id}/media-tasks
POST   /api/v1/media/tasks/{task_id}/cancel
```

The create request accepts only `type`, `prompt`, and an optional `options` object. Reject whitespace prompts, prompts over the configured limit, unknown options, image model overrides, and video dimensions/frame values outside the documented ranges. Cancel transitions only `queued` or `running` to `canceled`; terminal tasks respond 409 `MEDIA_TASK_NOT_CANCELABLE`.

- [ ] **Step 6: Run backend validation**

Run:

```bash
cd backend && uv run pytest tests/unit/test_ai_service.py tests/unit/test_media_generation_service.py tests/integration/test_media_generation.py -x -q
cd backend && uv run ruff check app/core/config.py app/services/ai_service.py app/services/media_generation_service.py app/api/v1/media.py
cd backend && uv run mypy app/services/ai_service.py app/services/media_generation_service.py app/api/v1/media.py
```

Expected: mocked image/video responses move through the correct states; cancellation wins races; restart recovery does not duplicate stored output; owner isolation passes.

### Task 3: Expose media creation and durable task cards on Web, Desktop, and Mobile

**Files:**

- Create: `packages/core/src/api/media.ts`
- Modify: `packages/core/src/api/index.ts`
- Modify: `packages/core/src/hooks/use-chat-queries.ts`
- Modify: `apps/web/src/components/ChatInterface.tsx`
- Create: `apps/web/src/components/chat/MediaTaskCard.tsx`
- Create: `apps/web/src/components/chat/__tests__/MediaTaskCard.test.tsx`
- Modify: `apps/desktop/src/renderer/main/App.tsx`
- Modify: `apps/desktop/src/renderer/main/MessageContent.tsx`
- Create: `apps/desktop/src/renderer/main/MediaTaskCard.tsx`
- Create: `apps/desktop/src/renderer/main/MediaTaskCard.test.tsx`
- Modify: `apps/mobile/app/(main)/chat/[conversationId].tsx`
- Modify: `apps/mobile/src/components/chat/ChatInput.tsx`
- Create: `apps/mobile/src/components/chat/MediaTaskCard.tsx`
- Create: `apps/mobile/src/components/chat/MediaTaskCard.test.tsx`

**Interfaces:**

```typescript
export interface CreateMediaGenerationTaskInput {
  conversationId: string
  type: 'image' | 'video'
  prompt: string
  options?: Record<string, string | number>
}

export function useCreateMediaGenerationTask(): UseMutationResult<
  MediaGenerationTask,
  Error,
  CreateMediaGenerationTaskInput
>
export function useMediaGenerationTasks(
  conversationId: string
): UseQueryResult<MediaGenerationTask[]>
```

- [ ] **Step 1: Write failing Core and Web task-card tests**

```typescript
it('polls only while a task is non-terminal and refreshes message cards', async () => {
  renderHook(() => useMediaGenerationTasks('conv-1'), { wrapper })
  await waitFor(() => expect(server).toHaveReceived('/media/tasks/task-1'))
  expect(queryClient.getQueryData(['messages', 'conv-1'])).toEqual(expect.any(Array))
})

it('shows progress, result preview, retryable failure, and no raw provider URL', () => {
  render(<MediaTaskCard task={runningVideoTask} />)
  expect(screen.getByText('42%')).toBeVisible()
  expect(screen.queryByText(/agnes-ai\.com/)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run focused client tests and verify they fail**

Run:

```bash
pnpm --filter @yuanai/core test:unit -- --run src/hooks/__tests__/use-chat-queries.test.tsx
pnpm --filter @yuanai/web test:unit -- --run src/components/chat/__tests__/MediaTaskCard.test.tsx
```

Expected: FAIL because the media client/hook/card do not exist.

- [ ] **Step 3: Add Core client/query integration**

Implement `createMediaGenerationTask`, `getMediaGenerationTask`, `cancelMediaGenerationTask`, and `listMediaGenerationTasks` in `api/media.ts`. The create mutation appends the returned assistant message/task to `['messages', conversationId]`, invalidates only that conversation's media query, and calls `invalidateQueries({ queryKey: ['conversations'] })`. `useMediaGenerationTasks` uses `refetchInterval` only while any row is `queued` or `running`, at 2 seconds foreground / 10 seconds background if the platform adapter exposes visibility; terminal lists do not poll.

```typescript
refetchInterval: (query) =>
  query.state.data?.some((task) => task.status === 'queued' || task.status === 'running')
    ? 2_000
    : false,
```

- [ ] **Step 4: Add a mode control and task-card rendering in every client**

Each composer receives a compact segmented mode control with `Chat`, `Image`, and `Video`. The Image and Video choices are visible only for persisted conversations and disabled while file uploads or a media task creation mutation is pending. A media submission creates a task with the text currently in the draft, clears that draft only after HTTP 201, and never opens an SSE chat stream. The normal chat send path remains unchanged.

Render `MediaTaskCard` inside every completed assistant message when `message.mediaTask` exists. Its states are:

```text
queued/running: type icon, prompt, determinate progress, icon-only cancel control
succeeded: image thumbnail or video poster/play control, dimensions/duration, preview and download actions
failed: concise sanitized error plus retry action that creates a new task with the same type/prompt/options
canceled: static canceled state and retry action
```

Web opens successful output in the existing controlled Artifact panel. Desktop sends an `DesktopArtifactPayload` to the existing single Artifact window, not a browser tab. Mobile opens an authenticated local copy with the platform image/video viewer. All external provider links remain absent.

- [ ] **Step 5: Add accessibility and platform regression tests**

Web and Desktop tests must assert semantic mode selection, task progress text, a title/accessible label on icon-only controls, focus retention after cancel/retry, and that the task card survives a message cache refetch. Mobile tests must assert `accessibilityRole="tab"`, progress announcement, cancel/retry labels, and native preview invocation. Tests must cover one image and one video task in the same conversation, a failed task retry, cancel while polling, and a refreshed/re-entered conversation showing the server task state.

- [ ] **Step 6: Run focused frontend verification**

Run:

```bash
pnpm --filter @yuanai/core typecheck && pnpm --filter @yuanai/core test:unit
pnpm --filter @yuanai/web typecheck && pnpm --filter @yuanai/web lint && pnpm --filter @yuanai/web test:unit
pnpm --filter @yuanai/desktop typecheck && pnpm --filter @yuanai/desktop lint && pnpm --filter @yuanai/desktop test:unit
pnpm --filter @yuanai/mobile typecheck && pnpm --filter @yuanai/mobile lint && pnpm --filter @yuanai/mobile test:unit
```

Expected: cards render the same task state from query cache after a route change without a second provider request.

### Task 4: Perform real API/UI verification and create the one feature commit

**Files:**

- Modify: `backend/.env.example`
- Modify: `apps/desktop/README.md`
- Modify: `docs/troubleshooting.md`
- Test: `backend/tests/integration/test_media_generation.py`

- [ ] **Step 1: Verify local configuration without exposing credentials**

Confirm `AGNES_API_KEY` is present only in ignored `backend/.env`; add only an empty `AGNES_API_KEY=` sample and media limits to `backend/.env.example`. Do not print environment contents. Apply the migration through the project toolchain:

```bash
cd backend && uv run alembic upgrade head
pnpm dev:real
```

Expected: health check is available and the worker starts with no queued task error.

- [ ] **Step 2: Exercise a real image task through the Web UI**

Sign in with an existing local test account, create a persisted conversation, select Image mode, submit a harmless prompt, and verify queued/running then succeeded task card. Reload the conversation and verify it is still present; open it in the Artifact panel, download it, and verify the displayed URL is a YuanAI storage URL. Cancel a second queued/running task and verify it stays canceled after refresh.

- [ ] **Step 3: Exercise the video lifecycle with a provider-safe test**

Use the real API only if the configured Agnes account permits video creation. Otherwise, execute the full mocked integration lifecycle and record the provider/account limitation in `docs/troubleshooting.md` without claiming real video completion. When real creation is permitted, create a short default video, verify task polling reaches a terminal state, desktop preview uses the Artifact window, and Mobile uses the native viewer.

- [ ] **Step 4: Start the Electron and Expo clients from package scripts**

Run:

```bash
pnpm dev:desktop
pnpm --filter @yuanai/mobile start
```

On Electron, create and cancel a task then reopen the conversation to verify the separate preview window. On the connected Expo device, create/retry a task, verify progress does not block normal chat navigation, and open a successful image/video with the native viewer. Capture local screenshots as ignored evidence only.

- [ ] **Step 5: Run the final feature checks**

Run:

```bash
git diff --check
cd backend && uv run pytest tests/unit/test_ai_service.py tests/unit/test_media_generation_service.py tests/integration/test_media_generation.py tests/integration/test_chat.py -x -q
cd backend && uv run ruff check .
cd backend && uv run mypy app/
pnpm typecheck
pnpm test:unit
```

Expected: all feature checks pass. Report any pre-existing full-repository failures separately and do not attribute them to the feature.

- [ ] **Step 6: Commit the complete media feature once**

```bash
git add backend/app/models/media_generation_task.py backend/app/schemas/media_generation.py \
  backend/app/services/media_generation_service.py backend/app/services/ai_service.py \
  backend/app/api/v1/media.py backend/app/api/v1/chat.py backend/app/core/config.py \
  backend/app/main.py backend/app/models/__init__.py backend/alembic/versions \
  backend/.env.example backend/tests/unit/test_ai_service.py \
  backend/tests/unit/test_media_generation_service.py backend/tests/integration/test_media_generation.py \
  packages/types/src/index.ts packages/core/src/api/media.ts packages/core/src/api/index.ts \
  packages/core/src/hooks/use-chat-queries.ts apps/web/src/components/ChatInterface.tsx \
  apps/web/src/components/chat/MediaTaskCard.tsx apps/web/src/components/chat/__tests__/MediaTaskCard.test.tsx \
  apps/desktop/src/renderer/main/App.tsx apps/desktop/src/renderer/main/MessageContent.tsx \
  apps/desktop/src/renderer/main/MediaTaskCard.tsx apps/desktop/src/renderer/main/MediaTaskCard.test.tsx \
  'apps/mobile/app/(main)/chat/[conversationId].tsx' apps/mobile/src/components/chat/ChatInput.tsx \
  apps/mobile/src/components/chat/MediaTaskCard.tsx apps/mobile/src/components/chat/MediaTaskCard.test.tsx \
  apps/desktop/README.md docs/troubleshooting.md
git commit -m "feat(backend,core,web,mobile,desktop): add persistent media generation tasks"
```

Expected: one local feature commit with no `.codex/` content, no push, and no merge to `dev`.

## Plan Review

- Spec coverage: durable DB state, task recovery, Agnes Image and Video API contracts, status transitions, cancellation, owned storage output, cross-device message restoration, notifications, all three client UIs, tests, and real verification are covered by Tasks 1-4.
- Placeholder scan: every request route, type, provider endpoint, transition, test command, and commit boundary is defined; no task defers a validation or implementation choice.
- Type consistency: `MediaGenerationTask` maps from backend camel-case response to `Message.mediaTask`; the same five status values control worker claims, API routes, polling, cards, and cancellation.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-15-persistent-media-generation.md`. Two execution options:

1. Subagent-Driven (recommended) - Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints.
