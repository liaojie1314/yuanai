# Tools Execution and Music Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first controlled-tool execution foundation described by Phase 6 and add prompt-to-music generation to the existing persistent image/video media workflow on Web, Desktop, and Mobile.

**Architecture:** Phase 6 is documented as incremental Waves: shared contracts and policy first, cloud execution next, then MCP and Desktop execution nodes, with Web as the control center and Mobile remaining compatibility-only. Music is deliberately outside Tool Runtime and extends `MediaGenerationTask` with a `music` kind, a server-side ElevenLabs adapter, object-storage persistence, and native audio playback on all three clients.

**Tech Stack:** FastAPI, async SQLAlchemy, Pydantic v2, HTTPX, S3-compatible storage, TypeScript monorepo packages, Next.js Web, Electron Desktop, Expo React Native, Vitest, pytest, Playwright, pnpm scripts.

---

## Working Rules

- Start from `dev` at `1fa06dd` and work only on `feature/tools-execution`.
- Do not push or merge to `dev`/`master`.
- Keep `.codex/phase-6-tools-execution-progress.md` local-only; update it after every committed feature with status, tests, commit hash, and blockers.
- Every completed feature gets a separate Conventional Commit and passes its focused tests before the next feature starts.
- Use root `package.json` scripts for startup, build, packaging, and JavaScript tests. Use `uv run` for backend checks.
- All AI provider calls remain behind `backend/app/services/ai_service.py`; clients never call ElevenLabs directly.
- Mobile does not implement the Phase 6 control center, MCP management, Desktop node, or local tool execution.

## File Map

| Area                                                                                 | Responsibility                                                                         |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `docs/phases/phase-6-tools-execution.md`                                             | Correct Phase 6 boundaries, Wave order, and independent acceptance gates.              |
| `backend/app/models/media_generation_task.py`                                        | Add the persisted `music` task kind.                                                   |
| `backend/app/schemas/media_generation.py`                                            | Validate and project the shared media task contract.                                   |
| `backend/app/services/ai_service.py`                                                 | ElevenLabs Music API adapter and provider error normalization.                         |
| `backend/app/services/media_generation_service.py`                                   | Music defaults, worker execution, MP3 persistence, status messages, and notifications. |
| `backend/app/core/config.py`, `backend/.env.example`                                 | ElevenLabs key and bounded music timeout/configuration.                                |
| `packages/types/src/index.ts`                                                        | Shared media kind/model/options types.                                                 |
| `packages/core/src/api/media.ts`, media hooks                                        | Reuse the existing task API and polling contract.                                      |
| `apps/web/src/components/chat/ChatInput*`, `MediaTaskCard.tsx`                       | Web music composer mode and audio task card.                                           |
| `apps/desktop/src/renderer/main/MessageContent.tsx`                                  | Desktop audio task card and download behavior.                                         |
| `apps/mobile/src/components/chat/ChatInput.tsx`, `MediaTaskCard.tsx`                 | Mobile music mode and `expo-av` playback.                                              |
| Existing media tests in `backend/tests`, `apps/web`, `apps/desktop`, `packages/core` | Regression and new music contract coverage.                                            |

## Stage 1: Phase 6 Documentation and Music Backend

### Task 1.1: Correct the Phase 6 delivery contract

**Files:**

- Modify: `docs/phases/phase-6-tools-execution.md`
- Test: `git diff --check`

- [ ] Replace `feat/phase-6-tools-execution` with `feature/tools-execution`.
- [ ] State the platform boundary explicitly: Backend owns registry/policy/execution state; Web owns the Agent control center; Desktop owns the signed local execution node; Mobile keeps shared chat compatibility only.
- [ ] Split the current delivery order into six Waves: contracts/artifacts/policy; cloud read-only tools; MCP; Desktop node; Web control center; browser automation/security hardening.
- [ ] Give each Wave its own entry/exit criteria and state that a Wave may be committed and validated independently.
- [ ] Keep cloud shell/code execution outside the FastAPI request process and keep stdio MCP inside an isolated worker or paired Desktop node.
- [ ] Run `git diff --check`; expected output is empty and exit code `0`.
- [ ] Commit only the document change:

```bash
git add docs/phases/phase-6-tools-execution.md
git commit -m "docs(config): split phase 6 tool execution into waves"
```

### Task 1.2: Add the persisted music task contract

**Files:**

- Modify: `backend/app/models/media_generation_task.py`
- Modify: `backend/app/schemas/media_generation.py`
- Modify: `backend/app/services/media_generation_service.py`
- Test: `backend/tests/unit/test_media_generation_service.py`
- Test: `backend/tests/integration/test_media_generation.py`

- [ ] Add `MediaGenerationType.music = "music"`; keep the existing non-native SQLAlchemy enum representation and generate a migration only if the configured database schema requires one.
- [ ] Define the only accepted music options as `durationSeconds: 30`; reject image/video options and source files for music.
- [ ] Map music to `elevenlabs-music-v1`, and use provider-independent status text `正在生成音乐`, `音乐生成完成`, `音乐生成失败`, and `已取消音乐生成`.
- [ ] Extend `_MEDIA_EXTENSIONS` with `audio/mpeg: mp3`, and persist audio bytes under `generated/<user_id>/<task_id>.mp3`.
- [ ] Preserve the existing ownership checks, lease, cancel race protection, result URL projection, and notification behavior.
- [ ] Add tests for music defaults, invalid options, rejected image attachments, task creation, cancellation, and a successful `audio/mpeg` result.
- [ ] Run:

```bash
cd backend && uv run pytest tests/unit/test_media_generation_service.py tests/integration/test_media_generation.py -x -q
```

Expected: all selected tests pass with exit code `0`.

### Task 1.3: Add the ElevenLabs provider adapter

**Files:**

- Modify: `backend/app/core/config.py`
- Modify: `backend/.env.example`
- Modify: `backend/app/services/ai_service.py`
- Modify: `backend/app/services/media_generation_service.py`
- Test: `backend/tests/unit/test_ai_service.py`
- Test: `backend/tests/unit/test_media_generation_service.py`

- [ ] Add `elevenlabs_api_key: str = ""`, a bounded music timeout, and an explicit feature configuration that leaves music unavailable when the key is absent.
- [ ] Implement an async `generate_elevenlabs_music(prompt: str, duration_ms: int = 30_000) -> tuple[bytes, str]` provider function in `ai_service.py`.
- [ ] Send `POST https://api.elevenlabs.io/v1/music` with `xi-api-key`, `Content-Type: application/json`, and query `output_format=mp3_44100_128`; body must be exactly constrained to `prompt`, `music_length_ms: 30000`, `model_id: "music_v1"`, and `force_instrumental: true`.
- [ ] Return `audio/mpeg` only for a non-empty successful response; map missing key, timeout, HTTP errors, empty body, and unsupported response MIME to existing media provider domain errors without leaking the API key or provider response body.
- [ ] Call this function only from the media worker, store returned bytes with the existing storage service, set `result_mime_type` and `result_duration_seconds`, then finalize through `_complete_task`.
- [ ] Add HTTP mock tests asserting URL, headers, JSON body, timeout/error mapping, and no provider URL exposure.
- [ ] Run:

```bash
cd backend && uv run pytest tests/unit/test_ai_service.py tests/unit/test_media_generation_service.py -x -q
```

Expected: all selected tests pass with exit code `0`.

- [ ] Commit Stage 1 feature slices separately:

```bash
git add backend/app/models backend/app/schemas backend/app/services backend/app/core/config.py backend/.env.example backend/tests
git commit -m "feat(backend): add prompt to music media tasks"
```

## Stage 2: Shared Contracts and Web Music Experience

### Task 2.1: Extend shared media types without changing API paths

**Files:**

- Modify: `packages/types/src/index.ts`
- Modify: `packages/core/src/api/media.ts` only when response typing requires it
- Modify: existing media query hook only when the new union requires a type guard
- Test: `packages/core/src/api/__tests__/media.test.ts`

- [ ] Extend `MediaGenerationType` to `'image' | 'video' | 'music'`.
- [ ] Add `MediaMusicDurationSeconds = 30` and a music model literal matching the backend response.
- [ ] Keep the existing `MediaGenerationTask` fields and API URLs; do not create a second music API or client-side provider type.
- [ ] Add type-level/runtime tests that a music task is accepted and image/video task behavior remains unchanged.
- [ ] Run:

```bash
pnpm --filter @yuanai/types typecheck
pnpm --filter @yuanai/core test:unit -- packages/core/src/api/__tests__/media.test.ts
```

Expected: typecheck and focused tests pass.

- [ ] Commit:

```bash
git add packages/types packages/core
git commit -m "feat(core,types): support music media task contracts"
```

### Task 2.2: Add the Web music composer and audio task card

**Files:**

- Modify: the existing Web composer file that owns the current image/video mode
- Modify: `apps/web/src/components/chat/MediaTaskCard.tsx`
- Modify: the existing Web media/chat styles beside those components
- Test: `apps/web/src/components/chat/__tests__/MediaTaskCard.test.tsx`
- Test: the existing Web composer test file, or create its colocated test if absent

- [ ] Add a mutually exclusive Music mode next to Image and Video; submitting in Music mode calls the existing `onCreateMediaTask` path with `{ type: "music", options: { durationSeconds: 30 } }`.
- [ ] Hide image/video-only controls and reject attachments while Music mode is active.
- [ ] Render a non-autoplaying audio element for a succeeded music task with `controls`, `preload="metadata"`, accessible label, download action, and the existing cancel/retry states.
- [ ] Keep loading/progress/error/canceled behavior identical to the existing media task card and avoid rendering image/video elements for music.
- [ ] Add tests for mode selection, request payload, audio success, no autoplay, failed retry, cancel, and regression image/video rendering.
- [ ] Run:

```bash
pnpm --filter @yuanai/web test:unit --runInBand
pnpm --filter @yuanai/web typecheck
```

Expected: Web unit tests and typecheck pass.

- [ ] Commit:

```bash
git add apps/web packages/types packages/core
git commit -m "feat(web): add music generation composer and player"
```

## Stage 3: Desktop/Mobile Playback and Full Verification

### Task 3.1: Add Desktop audio task rendering

**Files:**

- Modify: `apps/desktop/src/renderer/main/App.tsx`
- Modify: `apps/desktop/src/renderer/main/MessageContent.tsx`
- Modify: the colocated Desktop chat styles if required
- Test: `apps/desktop/src/renderer/main/App.test.tsx`
- Test: `apps/desktop/src/renderer/main/MessageContent.test.tsx`

- [ ] Add a mutually exclusive Music mode beside the existing Image and Video composer modes; submit through the existing `createMediaTask` path with `{ type: "music", options: { durationSeconds: 30 } }`, disable image/video-only attachments and controls, and show the ElevenLabs Music model label.
- [ ] Add a music branch to the existing `MediaTaskCard` with native audio controls, stable layout dimensions, download behavior, failure/retry, cancel, and accessible labels.
- [ ] Keep Desktop artifact opening behavior for image/video and do not add a Phase 6 control center or local tool execution UI.
- [ ] Test music mode payload and attachment boundary, succeeded/running/failed/canceled/download states, and image/video regression states.
- [ ] Run:

```bash
pnpm --filter @yuanai/desktop test:unit
pnpm --filter @yuanai/desktop typecheck
```

Expected: Desktop unit tests and typecheck pass.

- [ ] Commit:

```bash
git add apps/desktop
git commit -m "feat(desktop): add music task playback"
```

### Task 3.2: Add Mobile music mode and `expo-av` playback

**Files:**

- Modify: `apps/mobile/src/components/chat/ChatInput.tsx`
- Modify: `apps/mobile/src/components/chat/MediaTaskCard.tsx`
- Test: colocated Mobile component tests or the existing Mobile chat test suite

- [ ] Extend `ComposerMode` to include `music`; send the fixed 30-second music options and disable attachments in that mode.
- [ ] Use the existing `expo-av` dependency, not a new native audio package, for play/pause/position/status.
- [ ] Unload the sound when the card unmounts or the source changes; show a retryable error when loading fails; keep controls accessible to screen readers.
- [ ] Test mode payload, succeeded playback setup, pause/resume state, unmount cleanup, failed retry, cancel, and image/video regression.
- [ ] Run:

```bash
pnpm --filter @yuanai/mobile test:unit
pnpm --filter @yuanai/mobile typecheck
```

Expected: Mobile unit tests and typecheck pass.

- [ ] Commit:

```bash
git add apps/mobile
git commit -m "feat(mobile): add music generation playback"
```

### Task 3.3: Cross-platform integration and release gate

**Files:**

- Modify: `.codex/phase-6-tools-execution-progress.md` (local-only)
- Modify: `docs/phases/phase-6-tools-execution.md` only if verification exposes a documentation mismatch
- Test: existing backend integration, Web integration/E2E, Desktop tests, Mobile tests

- [ ] Start the real stack only through `pnpm dev:real`; start Desktop and Mobile only through `pnpm dev:desktop` and `pnpm dev:mobile`.
- [ ] With a configured `ELEVENLABS_API_KEY`, submit one 30-second prompt from each client and verify the same stored result is playable after refresh; without the key, verify the provider-unavailable state and no raw credential/URL leakage.
- [ ] Run the full project checks:

```bash
pnpm check:runtime
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
cd backend && uv run pytest tests/unit -x -q
cd backend && uv run pytest tests/integration -x -q
```

Expected: every command exits `0`; any pre-existing environment failure is recorded in `.codex/environment-issues.md` before further diagnosis.

- [ ] Confirm `git diff --check`, `git status --short`, and `git log --oneline --decorate -8`; verify no push or merge occurred.
- [ ] Update the local progress file with each feature commit, exact test output summary, real API evidence, remaining deferred capabilities, and final branch/remote status.
- [ ] Do not create a release package or publish it unless separately requested; if packaging is later requested, use only `pnpm package:desktop:*` scripts.

## Deferred Roadmap

The current branch intentionally excludes structured lyrics, vocal controls, selectable 10/30/60-second duration, stems, waveform/cover generation, provider fallback, and Mobile/ Desktop Phase 6 tool execution. These require separate product and provider decisions after the fixed 30-second instrumental path is verified.

## Plan Self-Review

- Spec coverage: Phase 6 platform boundaries, Wave decomposition, provider choice, fixed-duration music, three clients, API/storage security, tests, scripts, progress tracking, local commits, and no push/merge are all mapped above.
- Placeholder scan: no implementation step relies on an unspecified function, unbounded provider parameter, direct frontend provider call, or generic “write tests” instruction.
- Type consistency: `music` is the shared/backend task kind; `durationSeconds: 30`, `audio/mpeg`, `elevenlabs-music-v1`, and the existing `/media/tasks` contract are used consistently across all stages.
