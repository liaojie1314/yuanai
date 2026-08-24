# Phase 5 Agent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver durable Agent Runs, bounded model/tool execution, approval and input pause/resume, replayable SSE, Web controls, tenant isolation, and a verified handoff to Phase 6.

**Architecture:** PostgreSQL is the Run/Step/Event/Approval source of truth. Redis provides queueing, broadcast, and 60-second leases; an independent worker executes the coordinator. Provider differences stay inside `ai_service.py`; Web uses a separate `useAgentRun`, while Mobile/Desktop only preserve the existing Chat protocol.

**Tech Stack:** FastAPI, async SQLAlchemy, Alembic, PostgreSQL, Redis, Pydantic, TypeScript, Zustand/TanStack Query, SSE, Vitest, pytest, Playwright.

---

## Scope and fixed decisions

- Branch: `feature/phase-5-agent-runtime`, created from the clean `dev` checkout; no push or merge.
- Scope: `backend/`, `packages/types/`, `packages/core/`, `apps/web/`; Mobile/Desktop only protocol compatibility.
- Worker: independent process exposed through package scripts.
- Rollout: Agent disabled by default; internal allowlist only.
- Run: `conversation_id` is optional; bound Runs write the final answer to existing `Message` history.
- Phase 6 is blocked until every Phase 5 gate and handoff artifact below is complete.

## Task 0: Branch, records, and repository rules

**Files:** `AGENTS.md`, `.codex/phase-5-agent-runtime-progress.md`

- [x] Confirm `git status --short --branch` is clean and record the base SHA.
- [x] Keep `.codex/phase-5-agent-runtime-progress.md` local; after every task record tests, commit SHA, and blockers.
- [x] Keep startup/build/package operations behind existing `package.json` scripts and leave all pinned Compose image tags/digests unchanged.
- [x] Run `pnpm check:runtime` with Node `22.21.1` and pnpm `10.22.0` before frontend hooks.
- [x] Commit: `docs(config): align feature branch convention`.

## Task 1: Extract the existing Chat stream service

**Files:** `backend/app/api/v1/chat.py`, `backend/app/services/chat_service.py`, `backend/tests/unit/test_chat_service.py`, `backend/tests/integration/test_chat.py`

- [x] Write a service test proving message persistence, context construction, and existing SSE event ordering.
- [x] Run `uv run --project backend pytest backend/tests/unit/test_chat_service.py -q`; it must fail before the service exists.
- [x] Move business logic out of the route; leave the route as auth/parse/service/response orchestration.
- [x] Run `uv run --project backend pytest backend/tests/unit/test_chat_service.py backend/tests/integration/test_chat.py -q`; all existing Chat behavior must pass.
- [x] Commit: `refactor(backend): extract chat stream service`.

## Task 2: Add Agent domain models and state machine

**Files:** `backend/app/models/assistant.py`, `backend/app/models/agent_run.py`, `backend/app/models/approval.py`, `backend/app/schemas/agent.py`, `backend/app/services/agent/state_machine.py`, `backend/alembic/versions/*agent_runtime*.py`, `backend/app/models/__init__.py`

- [x] Add `assistants`, `agent_runs`, `agent_steps`, `agent_events`, and `approval_requests` with UUID tenant keys, sequence uniqueness, idempotency uniqueness, indexes, and timestamps.
- [x] Add `RunStateMachine` with only the documented queued/running/waiting/succeeded/failed/cancelled transitions.
- [x] Test valid and invalid transitions, user filtering, cascade behavior, and duplicate idempotency keys.
- [x] Run `uv run --project backend pytest backend/tests/unit/test_agent_state_machine.py -q` and `uv run --project backend alembic check`.
- [x] Commit: `feat(backend): add agent runtime domain models`.

## Task 3: Normalize provider model events

**Files:** `backend/app/services/ai_service.py`, `backend/tests/unit/test_ai_service.py`

- [x] Define provider-neutral thinking/content/tool/usage/completed/failed `ModelEvent` variants.
- [x] Implement `stream_agent(model, messages, tools, enable_thinking=False)` without exposing provider SDK types.
- [x] Keep `stream_chat()` and old Chat SSE output unchanged.
- [x] Test normalization, malformed provider events, timeout, retry, and terminal failure mapping.
- [x] Commit: `feat(backend): normalize agent model events`.

## Task 4: Persist events and run independent workers

**Files:** `backend/app/services/agent/event_service.py`, `backend/app/services/agent/queue.py`, `backend/app/workers/agent_worker.py`, `backend/app/workers/recovery_worker.py`, `scripts/*`, relevant `package.json`

- [x] Implement monotonic Run event sequence and persist-before-broadcast.
- [x] Implement Redis queue, 60-second lease, 20-second renewal, cancellation token, and idempotent dequeue.
- [x] Add independent worker and recovery scripts; never run Agent work in the FastAPI web worker.
- [x] Test lease loss recovery, broadcast loss with database replay, duplicate delivery, cancellation, and shutdown.
- [x] Commit: `feat(backend): add agent event store and workers`.

## Task 5: Add the bounded ToolRegistry

**Files:** `backend/app/tools/contracts.py`, `backend/app/tools/registry.py`, `backend/app/tools/builtin/*.py`, `backend/tests/unit/test_tool_registry.py`

- [x] Define `ToolSpec` with name, description, schemas, risk, execution location, timeout, and idempotency.
- [x] Register exactly `get_current_time`, `calculate`, and `inspect_uploaded_file_metadata`.
- [x] Validate input before execution; enforce timeout; wrap errors in stable codes; reject duplicate registrations.
- [x] Test valid/invalid schemas, timeout, exceptions, output limits, metadata, and file ownership.
- [x] Commit: `feat(backend): add bounded builtin tool registry`.

## Task 6: Implement the bounded coordinator and policy

**Files:** `backend/app/services/agent/coordinator.py`, `backend/app/services/agent/context_builder.py`, `backend/app/services/agent/policy.py`, `backend/app/services/agent/errors.py`, `backend/tests/unit/test_agent_coordinator.py`

- [x] Implement the model/tool loop with default 12 steps and hard 30-step limit.
- [x] Enforce 60-second model timeout, 30-second tool timeout, token/cost/time budgets, and three identical tool-call loop detection.
- [x] Keep system policy above user instructions; treat tool output as untrusted data.
- [x] On final response optionally persist a Message; on cancel stop future model calls.
- [x] Test final answer, two-tool task, loop detection, budget stop, retry exhaustion, cancellation, and Message compatibility.
- [x] Commit: `feat(backend): add bounded agent coordinator`.

## Task 7: Add approval and clarification pause/resume

**Files:** `backend/app/services/agent/approval_service.py`, `backend/app/services/agent/coordinator.py`, `backend/tests/unit/test_agent_approval.py`, `backend/tests/integration/test_agent_approval.py`

- [x] Bind approval to tool, sanitized arguments, argument hash, execution location, and expiry.
- [x] Implement one-decision-only approve/deny/expire/cancel behavior.
- [x] Implement `waiting_input` with an answer that requeues the Run.
- [x] Test parameter substitution rejection, duplicate clicks, expiry, denial, user isolation, and approved resume.
- [x] Commit: `feat(backend): add agent approval and input recovery`.

## Task 8: Expose Agent API and `useAgentRun`

**Files:** `backend/app/api/v1/agent.py`, `backend/app/api/v1/admin_agent.py`, `backend/app/main.py`, `packages/types/src/index.ts`, `packages/core/src/api/agent.ts`, `packages/core/src/hooks/useAgentRun.ts`, package tests

- [x] Add assistant CRUD, Run create/list/detail/steps/events/cancel/input, approval decision, and redacted operator endpoints.
- [x] Add AgentRun/Step/Event/Approval and Agent SSE types with `snake_case` fields.
- [x] Implement `useAgentRun` separately from `useStream`; support 202 creation, Last-Event-ID replay, reconnect, dedupe, cancel, and terminal state.
- [x] Test authorization, idempotent create, SSE encoding, replay without duplicates, and tenant isolation.
- [x] Commit: `feat(core,types,backend): expose agent run api`.

## Task 9: Build Web Agent controls

**Files:** `apps/web/src/components/ChatInterface.tsx`, `apps/web/src/components/agent/*`, `apps/web/src/app/(main)/agent/*`, `apps/web/src/app/(main)/settings/agent/*`, `apps/web/src/app/(main)/admin/agent-runs/*`

- [x] Add Chat/Agent switch with Chat default, immediate queued Run card, timeline, tool details, approval, clarification, cancel, and refresh recovery.
- [x] Add settings, Run history, approvals, and redacted operator diagnostics pages.
- [x] Test Run creation/timeline, approval states, clarification, cancel, refresh recovery, and unchanged Chat mode with Vitest and Playwright.
- [x] Commit: `feat(web): add agent run controls and timeline`.

## Task 10: Verification, gray release, and Phase 6 handoff

**Files:** `docs/phases/phase-5-agent-runtime-implementation-todo.md`, `docs/phases/phase-5-agent-runtime-handoff.md`, `.codex/phase-5-agent-runtime-progress.md`, metrics/logging files

- [x] Add default-off feature flag and structured metrics carrying `run_id`, `step_id`, and hashed user ID.
- [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, backend unit/integration pytest, and `pnpm test:e2e`.
- [x] Run fault tests for worker crash recovery, five-minute SSE replay, approval parameter replacement, budget stop, and user A/B isolation.
- [x] Record stable v1 contracts for Run/Step/Event/Approval, ToolSpec, queue/lease/idempotency, and Last-Event-ID behavior.
- [x] Explicitly list Phase 6-only work: MCP, cloud sandbox, real file writes, browser automation, Shell, Desktop execution nodes, ToolConnection, Artifact, and SecretStore.
- [x] Mark Phase 5 complete only when every acceptance item has test evidence and no unexplained TODO/blocker remains.
- [x] Commit: `test(e2e,backend,web): verify agent runtime recovery and isolation`.

## Phase 5 completion gate before Phase 6

Phase 6 may not start in a new session until Run creation returns 202 within 500ms; five-minute event replay works; worker crash recovery is idempotent; a two-tool task passes; unapproved high-risk simulation never runs; all budgets stop predictably; tenant isolation passes; diagnostics are redacted; existing Chat/auth/file/share integration tests pass; lint, typecheck, unit, integration, and E2E checks pass; TODO and handoff documents are updated; and every independent feature has a local commit. No push or merge is included.
