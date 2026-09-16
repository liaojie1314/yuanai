# Phase 5 Agent Runtime Progress

## Coordination Checkpoint (2026-09-02, verification continuation)

- Current authoritative checkout is `/home/liaojie1314/code/project/yuanai-codex` on
  `feature/tools-execution`; the Phase 5 implementation history is preserved here for
  cross-session tracking. No merge or push has happened.
- Root runtime, TypeScript, frontend unit/integration, backend unit/integration, Ruff
  check, and mypy checks passed in the current continuation.
- The opt-in `test_agent_external_model_drill.py` completed once with the configured
  external DeepSeek provider and verified the two safe tool calls in order. This is
  real model evidence, but not evidence of a deployed Worker.
- The recovery and five-minute replay tests remain automated evidence: the forced exit
  uses a test helper subprocess, and the five-minute gap is represented by timestamps.
  Real deployed Worker crash recovery and a real five-minute network disconnect remain
  open; keep the formal acceptance criteria unchecked.

- Branch: `feature/phase-5-agent-runtime`
- Base: `dev`; do not push or merge.
- Plan: `docs/superpowers/plans/2026-08-22-phase-5-agent-runtime.md`
- Status: Task 10 complete; all implementation tasks complete. No push or merge.

| Task | Status   | Commit                          | Verification                                                                                                                                                                                                                             | Notes                                                                                                                                                                                                                                                                                            |
| ---- | -------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | complete | `9b6023c`                       | `pnpm check:runtime`; hook passed with fixed PATH                                                                                                                                                                                        | branch/rules/records                                                                                                                                                                                                                                                                             |
| 1    | complete | `f84eed9` (plus `f739e0a`)      | `uv run --project backend pytest tests/unit/test_chat_service.py tests/integration/test_chat.py -q` -> 30 passed; Ruff/mypy/git diff --check passed                                                                                      | Chat service extraction; initial DB test blocked until `pnpm dev:real`, then passed                                                                                                                                                                                                              |
| 2    | complete | `062ec26`                       | `uv run --project backend pytest tests/unit/test_agent_state_machine.py -q` -> 6 passed; Ruff/mypy/runtime/diff check passed; `alembic upgrade head` passed and one head remains                                                         | `alembic check` still reports pre-existing media/QR index drift after upgrade; no unrelated migration changes made                                                                                                                                                                               |
| 3    | complete | `6234eab`, `9802dbe`            | `uv run pytest tests/unit -q` passed; AI/Chat unit+integration passed; changed-file Ruff/mypy/runtime/diff checks passed                                                                                                                 | Added provider-neutral ModelEvent and bounded Agent model streaming; `chat.py` has unrelated pre-existing format drift; backend pytest must run serially because shared PostgreSQL schema initialization races when parallelized                                                                 |
| 4    | complete | `e20e2e1`, `aa13fa7`, `ad3cf15` | `uv run pytest tests/unit -q` -> 100% passed; focused worker tests 14 passed; changed-file Ruff/format, mypy, runtime and diff checks passed                                                                                             | EventStore persist-before-broadcast/replay, Redis queue with processing delivery ack/recovery, queued retry without pending marker, 60s lease/20s renewal, cancellation, independent worker and recovery worker; full format check still reports pre-existing `backend/app/api/v1/chat.py` drift |
| 5    | complete | `7295fc8`, `4df7f5a`            | `uv run pytest tests/unit/test_tool_registry.py -q` -> 8 passed; `uv run pytest tests/unit -q` -> all passed; changed-file Ruff/format/mypy/runtime/diff checks passed                                                                   | Bounded ToolRegistry; sync/async timeout enforcement, bounded arithmetic, three read-only builtins; file metadata is user-scoped and redacted; no Phase 6 execution capabilities                                                                                                                 |
| 6    | complete | `3fb9299`                       | `uv run pytest tests/unit/test_agent_coordinator.py -q` -> 10 passed; `uv run pytest tests/unit -q` -> all passed; changed-scope Ruff/format/mypy/diff checks passed                                                                     | Bounded model/tool loop, 12 default/30 hard step bound, model/tool timeouts, token/cost/time budgets, loop detection, cancellation, policy/context isolation, optional Message write-back; comments contain no stage labels                                                                      |
| 7    | complete | `9569ee3`                       | `uv run pytest tests/unit/test_agent_approval.py tests/integration/test_agent_approval.py -q` -> 6 passed; `uv run pytest tests/unit -q` -> all passed; changed-scope Ruff/format/mypy/diff checks passed                                | Approval binding, one-time decisions, tenant isolation, expiry, input requeue                                                                                                                                                                                                                    |
| 8    | complete | `0b12d56`                       | Backend unit/integration suites passed; Agent API integration passed; `@yuanai/types` and `@yuanai/core` typecheck passed; core unit -> 97 passed; `pnpm lint` passed; Ruff/mypy/diff checks passed                                      | Assistant CRUD, Run lifecycle, SSE replay, tenant isolation, admin redaction, shared types and reconnecting hook                                                                                                                                                                                 |
| 9    | complete | `3508808`                       | Web typecheck passed; Web unit -> 171 passed; Web lint passed; Agent API integration passed; Ruff/mypy/diff checks passed; `@yuanai/types`/`@yuanai/core` typecheck and core unit -> 97 passed                                           | Chat-default Agent switch, Run workspace/timeline, approval/input/cancel/refresh, settings, admin redacted view                                                                                                                                                                                  |
| 10   | complete | `5db2e27`                       | Backend unit/integration 100%; Ruff/mypy passed; root lint/typecheck/unit/integration passed; Web E2E 60/60 passed; Desktop build/unpack passed but script reports no discoverable Playwright tests; no phase-label code comments remain | Feature flag, redacted metrics, recovery/long-disconnect/approval/budget/isolation verification, checklist and handoff                                                                                                                                                                           |

Record non-project failures in `.codex/environment-issues.md` before continuing.

Task 10 validation evidence (2026-08-24): backend unit/integration suites, changed-scope
Ruff/mypy, root lint/typecheck/unit/integration, runtime check, and diff check passed.
Web E2E passed 60/60 after a targeted rerun of the one transient detached-element case.
Desktop E2E built/unpacked successfully but exited `No tests found`; Desktop unit and
integration suites passed. Environment boundaries are recorded separately.

Post-review fix (2026-08-24): commit `162f99b` keeps the Agent SSE client recovering
after a replay stream sends `[DONE]` while the Run is still non-terminal. The client
checks Run status, reconnects with `Last-Event-ID` after a one-second backoff, and
stops on succeeded/failed/cancelled. Core typecheck and 97 core unit tests passed;
pre-commit lint-staged hooks passed.

Final acceptance rerun (2026-08-24): fixed-runtime root lint, typecheck, unit, and
integration scripts passed; backend unit and integration pytest passed from the
`backend` working directory; Web Playwright passed 60/60; root `pnpm build` passed
for Web and Desktop. The aggregate E2E script still reports the documented Desktop
Playwright discovery/CommonJS boundary, while the Web suite passes independently.
Real browser verification covered login tab interaction and rendered the redacted
admin run page without an error overlay. Acceptance checkboxes in the plan are all
checked.

Publication (2026-08-24): feature branch merged locally into `dev` as
`1fa06dd` (`chore(config): merge agent runtime into dev`). The `dev` pre-push hook
passed typecheck and unit tests, then `origin/dev` advanced to the same SHA. No
release was created; local Web/Desktop build success was confirmed before push.
