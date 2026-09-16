# YuanAI Tools Execution and Music Progress

## Coordination Checkpoint (2026-09-02, latest)

- Current branch is `feature/tools-execution`; current HEAD is `f7b96f5`.
  `dev` and `origin/dev` remain at `1fa06dd`; no merge or push has happened.
- The `required_scopes` boundary is now enforced for manual tool execution:
  an active same-tenant connection is required when a tool declares scopes, and
  missing or revoked scopes fail closed. Its focused security suite passed 16 tests,
  with Ruff, mypy, and diff checks passing; commit `f7b96f5`.
- Real services were started by `pnpm dev:real`: Docker dependencies, FastAPI on
  `:8000`, and Web on `:3000` became ready; `/health` returned `200`.
- Authenticated Web validation used the existing local test account through the
  password form. `/chat` and `/agent/tools` loaded successfully; the Tool Control
  Center catalog rendered 18 tools, with no visible overlap or clipping in the
  captured 1600x900 view. This is real authenticated UI evidence, not complete
  application acceptance.
- Desktop E2E was rerun through its package script with the existing account and
  `DISPLAY=:0`. Electron built successfully and the test reached the execution-node
  scenario, but Playwright timed out after 240 seconds during teardown. Full Desktop
  E2E acceptance remains open; the generated `apps/desktop/dist` output is ignored
  temporary build output and is pending cleanup after final checks.
- The documentation review found and corrected the distinction between real provider
  smoke evidence, simulated integration coverage, and deployed runtime acceptance.
  Phase 5, Phase 6, and Phase 7 formal checkboxes remain intentionally unchecked.

## Coordination Checkpoint (2026-09-02, verification continuation)

- Current branch is `feature/tools-execution`; current HEAD is `6023b21`. `dev` and
  `origin/dev` remain at `1fa06dd`; no merge or push has happened.
- Local commits completed in this continuation: `a8653cc` execution race-window
  protection, `5d3f01f` isolated backend test sessions, `bf9513d` desktop node
  shutdown cleanup, and `6023b21` backend test formatting. Each commit passed its
  own hook and remains unmerged.
- Backend unit and integration suites passed serially. Backend Ruff check and mypy
  passed; the full Ruff format check still reports only the pre-existing
  `alembic/versions/j3d4e5f6a7b_mcp_connection_binding.py` formatting difference.
- Root `pnpm check:runtime`, `pnpm typecheck`, `pnpm test:unit`, `pnpm format:check`,
  and `pnpm lint` passed with Node `22.21.1` and pnpm `10.22.0`. Web unit is
  `188/188`, Desktop unit is `303/303`, and Web integration is `15/15`.
- The external MCP read-only protocol check passed against DeepWiki: initialize,
  tool discovery, and `read_wiki_structure` completed successfully. This does not
  prove the authenticated YuanAI connection-management flow.
- Browser acceptance is waiting at the local login page for action-time approval
  before entering the previously supplied test password. No password is recorded
  here or in project/Vault documentation.
- Phase 5 and Phase 6 acceptance checkboxes remain intentionally unchecked. The
  remaining blockers are real external-model and Worker recovery evidence, the
  authenticated Web walkthrough, complete Desktop teardown E2E, Browser Worker
  security/fault-injection evidence, and final release checks.

## Coordination Checkpoint (2026-09-02, resumed)

- Current branch is `feature/tools-execution`; `HEAD` is `d0c8242`. `dev` and
  `origin/dev` remain at `1fa06dd`; no merge or push has happened.
- The real stack is available: Docker PostgreSQL/Redis/MinIO/SearXNG, FastAPI
  on `:8000`, and Web on `:3000`; `/health` returned `200`.
- The Desktop agent is finishing an isolated `apps/desktop/` auth-storage fix.
  Its earlier real Electron run was blocked by an unavailable backend; this
  checkpoint does not count the earlier unit/build result as real E2E evidence.
- A new `gpt-5.6-luna` security agent is reviewing and repairing only the
  backend tool-worker boundary. Its write scope excludes Desktop, Web, docs,
  and this ledger. Each independent repair must have its own local commit.
- Parent work is limited to acceptance evidence, tests, documentation, cleanup,
  branch integration, and release decisions. No Phase 5 or Phase 6 checkbox is
  promoted to passed until its required real-runtime evidence exists.
- Remaining gates are: Phase 5 external-model two-tool run, deployed Worker
  crash recovery, five-minute disconnect recovery; Phase 6 external MCP and
  Browser Worker runtime/security checks, Web real-data flow, Desktop real E2E,
  fault injection, and final CI.

## Coordination Checkpoint (2026-09-01)

- Resumed `feature/tools-execution` at `65ab090`; the branch and `dev`/`origin/dev` were
  verified before any new work. No merge or push has occurred in this checkpoint.
- Coordination-only split: Browser Worker (Wave 6), isolated stdio MCP Worker (Wave 3),
  Desktop execution-node end-to-end validation (Wave 4), Phase 5 fault-recovery drills, and
  Web Tool Control Center real-data validation (Wave 5) each have separate agents and disjoint
  implementation scopes. The coordinator owns this ledger, test evidence, documentation,
  final review, integration, and release decisions only.
- `codebase-memory-mcp` is absent from the current shell PATH. The environment issue is recorded
  in `.codex/environment-issues.md`; current repository source, Git state, specifications, and
  the project Vault are used until the required CLI becomes available.
- Ruling: do not mark Phase 5 or Phase 6 acceptance items from mock-only, component-only, or
  build-only evidence. The cost if wrong is allowing Phase 7 to begin on an unproven recovery or
  execution-security contract.
- Remaining acceptance evidence is tracked by the owning agent reports; after their commits are
  integrated, run branch-wide code review, full local CI, real-stack checks, and documentation/
  Vault reconciliation before any local `dev` merge or remote push.
- Desktop validation commits `5342a5f`, `3a9432c`, `8a26a55`, and `b256fb4` add cancelled-job
  cleanup/ACK handling and reproducible test records. Runtime/typecheck/lint/build plus 302 unit
  and 8 integration tests passed. The packaged Electron E2E found the real backend unavailable on
  port 8000, so pairing, safeStorage, WSS, signed callback, ACK, reconnect, and revocation remain
  unaccepted until the real stack is started and the E2E is rerun.
- Phase 5 recovery evidence commit `de1b9d4` adds a real crashing Worker subprocess, Redis lease
  recovery, a persisted idempotency ledger, and an explicitly enabled external-model two-tool
  drill. Its focused suites and static checks passed. The five-minute disconnect test preserves
  timestamps across a simulated five-minute gap rather than waiting five minutes, so that strict
  runtime acceptance item remains open.
- Wave 3 stdio commit `9e380ca` moves the actual MCP subprocess, bubblewrap isolation, JSON-RPC
  lifecycle, Secret environment injection, limits, and process-group cleanup to a one-shot worker
  process. Focused local fixture tests passed; HTTP MCP is unchanged. A third-party MCP service
  has not yet been exercised, so external MCP acceptance remains open. Full pytest has five
  unrelated asyncpg event-loop/lifecycle failures, and full formatting is blocked by an unrelated
  pre-existing migration outside this agent's write scope.
- Wave 5 commits `9a8e3ac` and `18afaaf` distinguish failed versus empty API states, refresh the
  approval view, surface execution summaries, and add three route-level Playwright scenarios for
  catalog/connection/MCP/node/execution, Artifact/approval, and empty/error states. Web
  typecheck/lint, 188 unit tests, 15 integration tests and the three system-Chrome scenarios pass.
  Screenshot review found no clipping or overlap. This is mock-backed UI evidence only; real API
  validation will be repeated after starting `pnpm dev:real` with the verified absolute `uv` path.
- Branch-wide review dispatch was attempted with the previously allowed reviewer model, but the
  model gateway returned `502 Bad Gateway` before producing a report. Per user instruction, do not
  retry or dispatch a higher model in this checkpoint; resume the review in a later session using
  at most `gpt-5.6-luna` or `gpt-5.6-terra`.

## Checkpoint (2026-08-28)

- Context resumed on `feature/tools-execution`; no merge or push has been performed.
- Phase 5 approval recovery is now locally committed as `19a4f65`: approved requests requeue the
  Run, denied requests terminate it, the Worker passes the approved request into the coordinator,
  SSE terminal callbacks are deduplicated, and an integration regression test verifies that a
  resumed approval reuses the original waiting execution record.
- Fresh focused verification passed: 26 Agent unit/API tests, Ruff, format check, mypy, Prettier,
  and `git diff --check`.
- Phase 5 remains blocked by the documented real external-model two-tool run, Worker crash
  recovery drill, and five-minute disconnect recovery drill.
- Next implementation checkpoint is Phase 6 Wave 1; do not mark any Wave acceptance item until
  its contract, security, integration, and runtime evidence exists.

- Branch: `feature/tools-execution`
- Base: `dev` at `1fa06dd`
- Remote publication: not authorized; no push or merge
- Current state: music delivery is complete; Phase 5 and Phase 6 Tool Runtime remain in progress

## Current Work (2026-08-28)

- Real stack: restarted through `pnpm dev:real`; PostgreSQL, Redis, MinIO, FastAPI and Web are running.
- Phase 5: the documented SSE contract now matches the implemented `/agent/runs/{id}/stream`
  SSE endpoint and `/events` JSON replay endpoint, but the Phase 5 license remains blocked until
  a real two-tool model run, Worker-crash recovery and five-minute disconnect recovery are exercised.
- Phase 6 Wave 1: uncommitted backend implementation exists for Tool Runtime models, migration,
  contracts, registry, audit service and API. Its first static verification is failing (Ruff and
  mypy); approval-path audit creation is also covered by a newly identified regression to fix.
  No Phase 6 Wave or Phase 7 acceptance criterion is satisfied by this work yet.
- Next checkpoint: add focused Wave 1 contract/integration tests, repair the implementation,
  rerun static checks plus pytest, then create one local Wave 1 commit. Do not push or merge.

## Checkpoint (2026-08-29)

- Context resumed on `feature/tools-execution`; no merge or push has been performed.
- Wave 1 Worker integration was repaired and committed as `111f8ee`: the production Agent Worker
  now injects `build_phase6_registry()` instead of the basic registry. A regression test covers
  the production execution entry point.
- Verification passed: focused Worker, Coordinator, Tool Runtime, registry, tools API and MCP
  tests (`48` passed), Ruff, format check, mypy and `git diff --check`.
- Existing uncommitted README/docs changes remain intentionally outside the commit.
- Next checkpoint: audit and complete the remaining Wave 1 ToolResult and Artifact contract gates;
  do not mark the Wave accepted until structured result persistence and short-lived Artifact
  access/retention evidence exists.

## Checkpoint (2026-08-29, continued)

- Wave 1 Worker registry integration is committed as `111f8ee`.
- Wave 1 structured ToolResult persistence and Artifact lifecycle protection are committed as
  `d4d6bee`: terminal executions persist status/data/artifacts/citations/metrics/error, Artifact
  downloads use tenant-bound short-lived signatures, expired content is rejected, and delete/
  purge paths remove stored objects and metadata.
- Verification passed for both slices with focused backend tests, Ruff, format checks, mypy and
  diff checks. No merge or push has been performed.
- Next checkpoint: exercise the full cloud multi-tool chain and harden the sandbox boundary before
  declaring Wave 2 complete.

## Checkpoint (2026-08-30)

- Wave 2 cloud chain verification is now locally committed as `e99c236`: the Agent Worker
  preloads `AgentRun.steps`, and the integration test verifies search -> extraction -> isolated
  Python analysis -> Markdown Artifact with five model rounds and persisted tool executions.
- Verification passed: 25 focused pytest cases, Ruff, format check, mypy, and `git diff --check`.
- The initial long-running test was traced to stopped PostgreSQL dependencies after the previous
  pause; the integration test also had a test-double bug that yielded a list as one model event.
  Both were corrected without changing production event persistence semantics.
- No merge or push has been performed. Phase 5 remains blocked by real external-model and fault
  recovery drills. Phase 6 Waves 3-6 and the final Phase 6 exit evidence remain incomplete.

## Decisions

- Music is independent from Phase 6 Tool Runtime.
- Music is an extension of `MediaGenerationTask`, not a second task system.
- Provider: 本机 Hugging Face `facebook/musicgen-small`，远程 provider 仅作实验入口。
- First release: fixed 30 seconds, MP3, Web/Mobile/Desktop; pure music uses MusicGen and lyric songs use local ACE-Step.
- Deferred: independent vocal controls, selectable duration, stems, waveform/cover, Mobile Agent control center, Desktop full Agent control center.
- Cleanup constraint: temporary startup, test, build, and model-download caches are cleaned promptly after use; user data, dependency caches, and active model caches are preserved.
- Real Web acceptance account: `yuanyuanblog@163.com`; use the password-login flow. Its password is treated as a local secret: never write it to repository docs, the Vault, command output, or commits.

## Music Delivery Status

| Stage                             | Status    | Commit                                  | Verification                                                                                                                                             |
| --------------------------------- | --------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Phase 6 docs + music backend   | completed | `4ffe2d1`                               | 58 focused pytest passed; Ruff/mypy/Alembic/diff checks passed                                                                                           |
| 2. Shared contracts + Web         | completed | `a46779e`                               | `pnpm check:runtime`; types/core/web typecheck; core 103 tests; Web 176 tests; `git diff --check`                                                        |
| 3. Desktop + Mobile + integration | completed | `cf475c8` (Desktop), `e72398d` (Mobile) | Root typecheck/unit/integration/build passed; backend unit/integration passed; real stack health passed; no ElevenLabs key available for live generation |

## Execution Log

- 2026-08-24: Created `feature/tools-execution` from `dev` at `1fa06dd`.
- 2026-08-24: Added Phase 6 platform boundaries and six Wave delivery gates; added `music` media tasks with fixed 30-second instrumental MP3 generation through ElevenLabs, server-side object-storage persistence, and provider error redaction. Commit `4ffe2d1`.
- Verification: `cd backend && uv run pytest tests/unit/test_ai_service.py tests/unit/test_media_generation_service.py tests/integration/test_media_generation.py -x -q` -> `58 passed`.
- Verification: targeted `uv run ruff check`, `uv run ruff format --check`, `uv run mypy app/models/media_generation_task.py app/core/config.py app/services/ai_service.py app/services/media_generation_service.py`, `uv run alembic heads`, and `git diff --check` passed.
- Environment issue recorded: shell initially resolved Node `v24.19.0` / pnpm `11.19.0`; fixed PATH uses Node `22.21.1` / pnpm `10.22.0`.
- 2026-08-25: Independently verified Stage 2 commit `a46779e`: `pnpm check:runtime` passed; `@yuanai/types` and `@yuanai/core` typecheck passed; Core unit suite passed with 103 tests; Web unit suite passed with 176 tests; Web/Core typecheck passed; `git diff --check` passed.
- 2026-08-25: Began Stage 3. No push or merge performed.
- 2026-08-25: Desktop slice committed as `cf475c8`: music composer mode with fixed 30-second payload and attachment boundary, native non-autoplay audio playback/download, and existing image/video artifact behavior retained. Independent Desktop unit suite passed with 211 tests and Desktop typecheck passed.
- 2026-08-25: Mobile slice committed as `e72398d`: music composer mode with fixed 30-second payload and attachment boundary, Expo AV playback/progress/lifecycle cleanup/retry, and existing image/video/cancel behavior retained. Mobile unit suite passed with 44 tests; Mobile lint, typecheck, Prettier, and diff checks passed.
- 2026-08-25: Stage 3 final verification passed: `pnpm check:runtime`, root `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, and `pnpm build` all exited 0; `cd backend && uv run pytest tests/unit -x -q` and `uv run pytest tests/integration -x -q` both exited 0 after `pnpm dev:real` started the real stack. `/health` returned `{"status":"ok"}`. `ELEVENLABS_API_KEY` was absent from shell and backend/.env, so no live provider generation was attempted.
- 2026-08-25: Final branch audit: worktree clean; `dev` and `origin/dev` are six commits behind `feature/tools-execution`; no push or merge performed.
- 2026-08-25 continuation audit: reran `pnpm check:runtime`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, and `pnpm build`; all exited `0`. Unit totals were Core 103, Web 176, Desktop 211, and Mobile 44. Backend `uv run pytest tests/unit -x -q` and `uv run pytest tests/integration -x -q` both exited `0`; integration emitted only the existing FastAPI deprecation warning. `pnpm dev:real` started the real stack, `/health` returned `200` with `{"status":"ok"}`, and `docker compose down` cleaned up the project containers afterward.
- 2026-08-25 continuation audit: `git diff --check` passed; worktree is clean; `feature/tools-execution` is ahead of `dev` and `origin/dev` by 6 commits; no push or merge occurred. `ELEVENLABS_API_KEY` remains unset, so live provider generation remains unverified and intentionally deferred.
- 2026-08-25 Phase 5 review repair: the review found the production worker still defaulted to a no-op handler and the Agent SSE route ended after one replay. Wired the default worker to `execute_agent_run`, made SSE poll through the public EventStore status API, and added regression coverage for post-connect events. Focused worker and Agent API tests passed; real external-model and crash-recovery evidence remain unverified.
- 2026-08-25 live music check: `backend/.env` contains an ElevenLabs key without exposing its value. Web login, Music mode, fixed 30-second prompt submission, attachment-disabled state, and redacted provider failure UI were exercised. Direct `/v1/music` verification returned HTTP 402 Payment Required; no audio result was produced, so live generation remains blocked by the account's provider entitlement/credits rather than application code.
- 2026-08-25 UI regression: real Web inspection showed React Strict Mode could overwrite restored `music` mode with the initial `chat` value; fixed with explicit hydration state. Removed the fixed music duration status row so it no longer shifts the composer layout, and made the selected music button visually explicit.
- 2026-08-25 progress regression: local MusicGen tasks reported `running/0%` because local generation has no provider percentage. Added an indeterminate animated progress bar with `aria-valuetext="正在生成"` and a bounded local model timeout; focused Web tests passed (`177/177`).
- 2026-08-25 local model runtime: the real worker log showed Transformers retrying Hugging Face network requests without the local proxy. Added `MEDIA_MUSIC_LOCAL_FILES_ONLY=true` by default and documented temporary proxy-based cache warmup without adding `MEDIA_MUSIC_PROXY_URL` to project configuration.
- 2026-08-25 real generation verification: with a one-time local `HTTP_PROXY`/`HTTPS_PROXY=http://127.0.0.1:7890` cache warmup, real `facebook/musicgen-small` generated a 29.94-second WAV; through `pnpm dev:real`, Web submitted a task that completed as `succeeded/100`, persisted an MP3 in MinIO, rendered an audio control showing `0:00 / 0:29`, and exposed the download link. Refresh retained the completed result and `aria-pressed=true` music mode. Browser console had no app errors or warnings.
- 2026-08-25 environment guard: the first post-fix live attempt used a missing local model cache and was stopped; the task was canceled, not left running. The project default now fails fast on missing cache instead of entering unbounded Hugging Face retries.
- 2026-08-26 closeout: repository docs now state explicitly that MusicGen is limited to lyric-free instrumental music; vocal/lyric generation is out of scope. Phase 6 Wave acceptance remains unchecked because the six Tool Runtime Waves are not implemented in this branch; Phase 7 remains blocked until those gates and the unresolved Phase 5 real-runtime drills are completed.
- 2026-08-26: Docker Compose was confirmed running with PostgreSQL on `5433`, and the `yuanai_test` database was present in the same PostgreSQL container. The focused backend media suite passed `67` tests. The remaining documentation/code closeout corrected the WAV-to-MP3 storage MIME contract and documented ACE-Step lyric startup and MusicGen fallback behavior. The new cleanup constraint is recorded in `AGENTS.md` and the project knowledge base.
- 2026-08-27 lyric-song live verification: a real Web submission created task `6868d6df-743d-4f75-88d5-2a33f6999ba2` and reached 8%, but no audio was produced. The persisted task is terminal `failed` with `MEDIA_PROVIDER_POLL_FAILED`; direct ACE-Step status shows the actual cause is CUDA OOM while loading `acestep-v15-turbo` on the 4 GB RTX 3050. This is not an accepted lyrics-generation result. The ACE-Step REST server is healthy but reports `models_initialized=false`; inspect and retry its documented low-VRAM configuration before any acceptance update.
- 2026-08-27 ACE-Step CPU verification: official low-VRAM GPU offload could load the model but still OOM while moving the DiT to the 4 GB GPU for inference. Restarted only the ACE-Step service through `pnpm dev:ace-step` with documented CPU-only shell variables. A direct request matching the YuanAI backend contract (Chinese lyrics, 30 seconds, `text2music`, 8 steps, batch 1) completed successfully in about 102 seconds. The returned file passed `file` and `ffprobe`: MPEG Layer III, 48 kHz, 128 kbps, 30.024 seconds. This verifies the local lyrics provider, but does not yet prove YuanAI's full backend persistence or Web playback path.
- 2026-08-27 error classification: terminal ACE-Step failure now raises a distinct redacted domain error rather than being retried as a temporary poll failure. Commit `04fe096` passed 62 focused backend unit tests, Ruff, formatting, and mypy.
- 2026-08-27 documentation: README, development guide, and media-generation guide now state the low-memory hardware boundary and exact CPU-only command; commit `8105c34` passed `pnpm format:check` and diff checks.
- 2026-08-27 live acceptance setup: browser restart cleared the local Web session. The password-login page was prepared for `yuanyuanblog@163.com`; the existing local secret was verified without recording it. Generated temporary audio remains eligible for cleanup after the broader closeout; preserve ACE-Step checkpoints and active model cache.
- 2026-08-27 real lyrics Web acceptance: the local-only credential for `yuanyuanblog@163.com` authenticated through the password flow. Submitted lyrics task `23779a5d-ffdb-4909-aacd-bda27d864333`; its persisted task used `ace-step-v15-local` with the submitted lyrics and completed `succeeded/100`, `audio/mpeg`, 30 seconds. The Web card exposed playback, seek, download, and survived refresh; the user confirmed the rendered MP3 audibly contains lyrics.
- 2026-08-27 Web state correction: task-creation navigation had remounted the composer and reverted the lyrics sub-mode to instrumental, while the music card labeled every MP3 as MusicGen. Persisted the non-sensitive lyrics/instrumental selector only and derive its provider label from task lyrics. Commit `216cbc2` passed runtime check, Web typecheck, 178 Web unit tests, format and diff checks. A real refresh retained the lyrics textarea and `ACE-Step（本机）`; the completed lyric card now displays `ACE-Step`.
- 2026-08-27 Web terminology: changed the compact selector heading from `音乐` to `音乐：` without changing its layout or state. Commit `c8eac37` passed Web typecheck, format and diff checks; verified in the real lyric-song page.
- 2026-08-27 quality retrospective: music delivery incorrectly treated functional generation as sufficient and omitted two baseline cross-client completion gates: localized user-visible copy and readable light/dark presentation. Root cause was an implementation/test plan that listed API, playback, and task-state checks but no explicit per-client i18n/theme acceptance rows. Corrective action: add those rows to the committed testing standard, replace music hardcoded strings in Web/Mobile/Desktop with each client’s existing i18n mechanism, replace component-level raw state colors with semantic theme tokens, and add English-rendering/theme-token regression assertions before committing the corrective slice. This gate applies to every subsequent feature before merge or push.
- 2026-08-27 cross-client baseline correction: localized image, video, and music composer labels, state controls, and media task actions in Web, Mobile, and Desktop; error state colors now use semantic theme tokens. Added English resource assertions and stable Mobile translation mocks. Web (`179`), Mobile (`45`), and Desktop (`211`) unit suites plus all three typechecks passed. `apps/mobile/app.json` has an unrelated Prettier-only worktree difference and is intentionally excluded from the feature commit.
- 2026-08-27 corrective slice committed as `bb7c7a2` (`fix(web,mobile,desktop): localize media generation controls`). Husky lint-staged completed ESLint and Prettier successfully. A local temporary Corepack forwarding wrapper was required only because Codex fallback Corepack ignores the pinned runtime; it was removed immediately after the commit.

## Checkpoint (2026-08-30, Wave 3)

- Wave 3 MCP connection binding and approval closure are implemented in the current worktree.
  MCP Servers require an active same-tenant `mcp_http` ToolConnection; credentials are resolved
  through the SecretStore boundary and never copied into execution previews or audit fields.
- Remote MCP calls now reuse the IP resolved during public URL validation, reject redirects, and
  keep the original host for HTTP Host/TLS SNI. MCP schema snapshots continue to pause the server
  and clear enabled tools when the fingerprint changes.
- Side-effect MCP calls create a waiting ToolExecution plus a bound ApprovalRequest. Approve moves
  the execution to queued for an explicit `approval_id` execution; deny cancels it. Approval
  consumption verifies tenant, server, tool, execution location, and exact argument hash.
- Migration `j3d4e5f6a7b` upgrades the local database successfully from `i2c3d4e5f6a7` and adds
  nullable run/step approval links, the ToolExecution foreign key, MCP connection binding, and
  MCP execution server binding.
- Verification passed: 18 focused Agent/MCP/tools integration tests, Ruff, format check, mypy,
  Python compile, Alembic upgrade, and `git diff --check`. Wave 3 was committed locally as
  `9f17da3` (`feat(backend): bind MCP tools to tenant connections`); no merge or push has been
  performed.
- Remaining Wave 3 scope is stdio MCP execution inside an isolated Worker or paired Desktop node;
  it is intentionally not claimed by this checkpoint. Waves 4-6 and the Phase 6 exit license remain
  incomplete. Phase 7 remains unstarted.

## Checkpoint (2026-08-30, Wave 4 backend protocol)

- Wave 4 backend protocol is implemented locally: one-time pairing, Ed25519 node registration and
  challenge verification, versioned node JWTs, AES-GCM execution arguments, capability/policy checks,
  signed result verification, size limits, progress, cancellation, ACK and reconnect replay.
- Revoking a node increments `token_version`; terminal callbacks are rejected until the execution is
  `running`; policy JSON and JWT version parsing are type-checked fail-closed.
- Added migration `k4e5f6a7b8c9` for encrypted arguments, delivery state, progress, ACK timestamps and
  token version. Local database upgraded from `j3d4e5f6a7b` to the new head successfully.
- Added seven focused protocol tests. The Wave 4 protocol and existing tool-runtime security suites
  passed (`18` tests), Ruff, format check, mypy and Python compile passed. No merge or push performed.
- Wave 4 was committed locally as `ec153d0` (`feat(backend): add desktop execution node protocol`).
  The commit is the stopping point for this session. Desktop Electron client integration,
  Web control center, browser automation, Phase 5/6 final acceptance and Phase 7 remain unstarted or
  incomplete for the next session.

## Checkpoint (2026-08-31, Desktop execution node)

- Desktop Electron execution-node integration is now locally committed as `fc9b760`:
  the main process uses the Node `ws` implementation, Linux safeStorage test runs explicitly use
  the libsecret backend, and the E2E selects the uniquely created node instead of a stale offline
  node from the same account.
- The real `apps/desktop` E2E script passed under an isolated D-Bus/Xvfb session with the existing
  local test account: login, settings navigation, pairing/register, WebSocket challenge, online
  status, approval prompt, execution, signed result and server ACK all completed successfully.
- Desktop lint, typecheck and 45 unit-test files (`300` tests) passed. An unrelated test timing
  issue in localized window titles was repaired separately as `8cd6327` by synchronizing
  `document.title` with the rendered title and awaiting i18n cleanup.
- No Phase 6 Wave is marked accepted by this checkpoint. Remaining work starts with Wave 3 stdio
  MCP isolation and SecretStore persistence, followed by Wave 5/6 runtime acceptance and the
  unresolved Phase 5 real-model/fault-recovery drills. Phase 7 remains unstarted.

## Checkpoint (2026-09-01, SecretStore and stdio MCP)

- SecretStore persistence is locally committed as `a99d22c`: PostgreSQL migration, tenant-bound
  AES-GCM records, `db://` references, environment compatibility, and integration tests passed.
- Wave 3 stdio MCP implementation is currently uncommitted: strict complete-command allowlist,
  argument validation, bubblewrap namespace isolation, newline JSON-RPC initialize/discovery/call,
  timeout/output limits, process-group cleanup, and SecretStore environment injection are wired
  through the existing MCP schema and approval path.
- stdio unit tests, MCP integration tests, Ruff, format, mypy, compile and Alembic upgrade passed
  when run serially. A parallel pytest attempt against the shared `yuanai_test` database caused a
  PostgreSQL enum creation race; all database-backed pytest commands must run serially.
- No Phase 6 Wave is accepted yet. Wave 3 still needs the final focused commit and external/runtime
  evidence; Wave 5/6 and Phase 5 real-runtime evidence remain incomplete. Phase 7 remains unstarted.
