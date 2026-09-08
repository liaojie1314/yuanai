# Phase 7 Delivery Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the approved delivery boundary for durable Memory, versioned Skills, and scheduled Automation before writing Phase 7 application code.

**Architecture:** Memory, Skills, and Automation are separate backend domains that expose their own APIs and Web management surfaces. Memory retrieval is injected into the existing `AgentContextBuilder`; Automation creates ordinary `AgentRun` records and therefore reuses the current queue, approval, budget, audit, retry, and execution-node semantics instead of creating a parallel runtime. Skills are versioned declarations that reuse the existing Tool Registry and approval policy, never a second unrestricted Agent implementation.

**Tech Stack:** FastAPI, async SQLAlchemy, Alembic, PostgreSQL, Redis, Pydantic v2, TypeScript, TanStack Query, Next.js, existing Agent Worker/Tool Registry, Vitest, pytest, Playwright.

**Spec:** `docs/phases/phase-7-memory-skills-automation.md`

## Global Constraints

- Current worktree is the user-authorized direct `dev` checkout; do not create a branch or worktree, push, or merge.
- The Phase 7 entry gate remains blocked until the user explicitly accepts a waiver or the Phase 6 document records the remaining security, Browser Worker gray-release, production/deployment, and external-MCP-Web acceptance as closed.
- Implementation is divided into Memory and Context, Skills, and Automation. Each is independently testable and receives its own local Conventional Commit.
- Knowledge Base ingestion is outside this foundation because the request names Memory, Skills, and Automation. It remains a separate future delivery, even though its retrieval interface must not be made incompatible with Memory context assembly.
- Web is the only default management UI. Mobile and Desktop retain existing Chat and Agent protocol compatibility; adding Phase 7 controls to either platform needs an explicit product decision.
- `packages/core` must not import Next.js, Electron, or React Native APIs. Backend routes only parse, authorize, and delegate; services own domain behavior.
- Existing Agent safeguards are mandatory: persist-before-broadcast events, tenant isolation, Tool Registry policy, approval payload hash checks, budgets, queue leases, cancellation, and execution-node delivery/ACK behavior.
- Every new user-visible string goes through the existing Web i18n resources. New UI must use semantic theme tokens and be verified in English and both themes.
- Use Node `22.21.1` and pnpm `10.22.0`; invoke startup, build, packaging, and tests only through existing `package.json` scripts. Do not use `--no-verify`.
- Keep `.codex/task-progress.md` up to date after every code task. It is local execution state and must not be committed.
- Do not add phase-oriented comments to application code.

---

## Decision Record Required Before Implementation

This foundation deliberately does not choose product scope or a data provider on the user's behalf. A new code session must stop before editing production code until all four entries below are recorded in the task progress file and repeated in its first response.

| Decision           | Recommended choice                                                     | Alternative                                       | Consequence                                                                                               |
| ------------------ | ---------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Phase entry        | Keep the formal gate; create only plans until Phase 6 open items close | Explicitly waive the gate for this implementation | A waiver permits code but does not mark Phase 6 acceptance complete                                       |
| Platform scope     | Web management UI only                                                 | Add Mobile/Desktop read-only controls             | The alternative expands i18n, real-device, Electron, and release validation                               |
| Embedding provider | Approve an existing configured provider and model before code          | Approve a new cloud or local provider             | The alternative needs a separate security, cost, privacy, dependency, and deployment decision             |
| Delivery order     | Memory and Context first                                               | Skills or Automation first                        | Memory-first validates the context boundary before reusable procedures and scheduled execution rely on it |

## Delivery Boundaries

| Deliverable        | Includes                                                                                                                               | Reuses                                                                                 | Explicitly excludes                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Memory and Context | Candidate lifecycle, sensitivity policy, deletion, FTS/vector retrieval, token budget, Web Memory Center                               | `AgentContextBuilder`, Agent API auth, PostgreSQL, existing notification UI patterns   | Knowledge Source ingestion, local-node retrieval, new local embedding runtime                   |
| Skills             | Versioned manifest, draft/validation/active lifecycle, Tool Registry requirements, evaluation result, installation scope, Web controls | Tool Registry, policy engine, sandbox/approval contracts, artifact storage conventions | Third-party marketplace, automatic activation, unrestricted executable uploads                  |
| Automation         | One-time and cron triggers, timezone/DST scheduling, idempotency, Run mapping, wait/notification history, Web controls                 | `AgentRun`, queue leases, approval state machine, notification service                 | Connector-event triggers, webhooks, a separate job executor, privilege escalation while waiting |

## Planned File Map

The implementation plans created after the decision record must use these boundaries. Paths marked "new" are domain-local additions, not pre-approved abstractions.

| Deliverable        | Backend                                                                                                                                                                                                                                   | Shared and Web                                                                                                                                                                                                            | Tests                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Memory and Context | New `models/memory.py`, `schemas/memory.py`, `services/memory_service.py`, `services/memory_retrieval.py`, `api/v1/memories.py`, migration; modify `services/agent/context_builder.py`, `main.py`, model exports                          | New `packages/core/src/api/memories.ts`, `packages/core/src/hooks/useMemories.ts`, Web Memory Center route/components and both locale files; modify `packages/types/src/index.ts`                                         | New backend unit/integration memory tests; core hook/API tests; Web component/integration tests; focused Agent context test    |
| Skills             | New `models/skill.py`, `schemas/skill.py`, `services/skill_service.py`, `services/skill_validation.py`, `api/v1/skills.py`, migration; modify Tool Registry integration only where a validated active Skill needs tool requirement checks | New `packages/core/src/api/skills.ts`, `packages/core/src/hooks/useSkills.ts`, Web Skill routes/components and both locale files; modify `packages/types/src/index.ts`                                                    | New manifest/lifecycle/rollback unit tests; tenant and validation integration tests; Web controls and i18n tests               |
| Automation         | New `models/automation.py`, `schemas/automation.py`, `services/automation_service.py`, `services/automation_scheduler.py`, `api/v1/automations.py`, worker entrypoint and migration; modify `main.py` only for route registration         | New `packages/core/src/api/automations.ts`, `packages/core/src/hooks/useAutomations.ts`, Web Automation routes/components and both locale files; modify root `package.json` only to expose the scheduler through a script | New scheduler/idempotency/timezone unit tests; Agent Run mapping and approval-wait integration tests; Web lifecycle/i18n tests |

### Task 1: Record Implementation Decisions

**Files:**

- Modify: `.codex/task-progress.md` (local only, never stage it)
- Read: `docs/phases/phase-6-tools-execution.md`
- Read: `docs/phases/phase-7-memory-skills-automation.md`

**Interfaces:**

- Consumes: The four choices in the Decision Record table.
- Produces: A dated, immutable decision block that every later implementation plan cites.

- [ ] **Step 1: Recheck the Phase 6 entry condition**

Run: `rg -n -C 3 'Phase 7|系统性安全|Browser Worker|生产|外部 MCP' docs/phases/phase-6-tools-execution.md docs/phases/phase-7-memory-skills-automation.md`

Expected: The active entry condition is visible before a waiver is accepted or rejected.

- [ ] **Step 2: Record the user's choices verbatim**

Add a dated block to `.codex/task-progress.md` containing exactly these keys:

```text
phase_7_entry: gate-closed | user-waived
phase_7_platforms: web-only | web-mobile-desktop-controls
phase_7_embedding: decision-required
phase_7_first_delivery: memory-context | skills | automation
```

Replace `decision-required` only with the provider and model explicitly selected by the user.

- [ ] **Step 3: Verify the implementation boundary**

Run: `git status --short -- .codex/task-progress.md docs/superpowers/plans`

Expected: Only the ignored local progress file and explicitly authorized plan files are present; no production code has changed.

### Task 2: Produce the Memory and Context Execution Plan

**Files:**

- Create: `docs/superpowers/plans/2026-09-08-phase-7-memory-context.md`
- Read: `backend/app/services/agent/context_builder.py`
- Read: `backend/app/services/agent/policy.py`
- Read: `backend/app/services/agent/coordinator.py`
- Read: `backend/app/api/v1/agent.py`

**Interfaces:**

- Consumes: The Task 1 decision block and existing `AgentContextBuilder.build(goal, user_instructions, history)`.
- Produces: A task-by-task code plan defining memory models, typed API contracts, source-aware retrieval results, sensitivity/lifecycle transition rules, context token budgets, and a Web-only Memory Center.

- [ ] **Step 1: Trace the existing context path before naming interfaces**

Run: `codebase-memory-mcp cli search_graph '{"project":"home-liaojie1314-code-project-yuanai-codex","name_pattern":".*(AgentContextBuilder|AgentCoordinator|AgentRun).*"}'`

Expected: The execution plan names the actual context builder, worker, coordinator, and API call sites it modifies.

- [ ] **Step 2: Define the write and retrieval contracts before persistence work**

The execution plan must define `MemoryCreateCandidate`, `MemoryUpdate`, `MemorySearchResult`, and `MemoryContextItem` with user, assistant, optional workspace, source, sensitivity, lifecycle status, and provenance fields. It must make active status and tenant/ACL filters mandatory before any retrieval ranking.

- [ ] **Step 3: Define deletion and context invariants**

The execution plan must require a single transactional deletion path that removes memory content, embeddings, cached derived values, and search records. It must place platform policy before user memory, preserve source IDs, mark injected memory as untrusted data, and reserve separate token budgets for explicit user rules and retrieved memories.

- [ ] **Step 4: Split executable commits**

The execution plan must end with one local commit for the Memory backend/context contract and one local commit for the Web Memory Center. It must give each commit its exact test commands and an explicit real authenticated Web acceptance procedure.

### Task 3: Produce the Skills Execution Plan

**Files:**

- Create: `docs/superpowers/plans/2026-09-08-phase-7-skills.md`
- Read: `backend/app/tools/contracts.py`
- Read: `backend/app/tools/registry.py`
- Read: `backend/app/services/agent/policy.py`
- Read: `backend/app/services/tools/sandbox.py`

**Interfaces:**

- Consumes: The Task 1 decision block and existing Tool Registry/policy/approval contracts.
- Produces: A task-by-task code plan defining immutable `SkillVersion` content, manifest validation, evaluation records, activation/rollback transitions, tool requirement checks, and Web installation controls.

- [ ] **Step 1: Trace every existing tool execution and approval entry point**

Run: `codebase-memory-mcp cli search_graph '{"project":"home-liaojie1314-code-project-yuanai-codex","name_pattern":".*(ToolRegistry|ToolSpec|Approval|PolicyEngine).*"}'`

Expected: The execution plan reuses existing trust boundaries and does not create a second tool executor.

- [ ] **Step 2: Define immutable version boundaries**

The execution plan must define a stable Skill identity plus append-only versions. A version contains manifest text, `SKILL.md`, asset hashes, required tool versions/scopes, risk ceiling, input/output schema references, and evaluation references. An active version is replaced only after validation and explicit activation; rollback selects a prior passing version.

- [ ] **Step 3: Define activation and execution invariants**

The execution plan must require draft as the creation state, validation before activation, tenant-scoped installation checks before availability, and a policy rejection when a Skill's risk ceiling or tool requirement exceeds the requested Run. It must prohibit the Agent from changing an active Skill in place.

- [ ] **Step 4: Split executable commits**

The execution plan must end with one local commit for the Skills domain/validation contract and one local commit for the Web Skill controls. Each must include manifest, rollback, isolation, i18n, and real Web acceptance checks.

### Task 4: Produce the Automation Execution Plan

**Files:**

- Create: `docs/superpowers/plans/2026-09-08-phase-7-automation.md`
- Read: `backend/app/models/agent_run.py`
- Read: `backend/app/services/agent/queue.py`
- Read: `backend/app/services/agent/approval_service.py`
- Read: `backend/app/api/v1/notifications.py`
- Read: `backend/app/workers/agent_worker.py`

**Interfaces:**

- Consumes: The Task 1 decision block and standard `AgentRun`/approval/notification behavior.
- Produces: A task-by-task code plan defining trigger persistence, due-claim locking, idempotency, timezone/DST calculation, waiting status, notification rules, and Web automation controls.

- [ ] **Step 1: Trace standard Run creation and terminal-state handling**

Run: `codebase-memory-mcp cli search_graph '{"project":"home-liaojie1314-code-project-yuanai-codex","name_pattern":".*(AgentRun|AgentQueue|ApprovalRequest|Notification).*"}'`

Expected: The execution plan maps each automation trigger to an existing Run lifecycle rather than a custom task state machine.

- [ ] **Step 2: Define scheduler correctness rules**

The execution plan must use a database due-claim transaction (`FOR UPDATE SKIP LOCKED` or PostgreSQL advisory lock), persist one idempotency key per scheduled occurrence, calculate future occurrences in the user's IANA timezone, and make duplicate local clock times deterministic. The scheduler only creates a standard Run after the claim succeeds.

- [ ] **Step 3: Define wait and notification behavior**

The execution plan must retain standard approval and desktop-node waits, persist the deadline and reason, notify through existing configured channels, and cancel after expiry. It must never replace an unavailable desktop resource with a cloud action or raise permissions to finish.

- [ ] **Step 4: Split executable commits**

The execution plan must end with one local commit for scheduler/domain correctness and one local commit for Web automation controls. Each must include due-claim, DST, crash recovery, duplicate trigger, Agent approval wait, tenant isolation, i18n, and real Web acceptance checks.

## Foundation Completion Checks

- [ ] The four decision values are recorded and no implementation began before they were settled.
- [ ] Each of the three execution plans starts with the required writing-plans header, contains concrete interfaces, direct file paths, failing-test steps, package-script commands, and local commit commands.
- [ ] The Memory plan does not silently implement Knowledge Base ingestion or local-node retrieval.
- [ ] The Skills plan reuses the Tool Registry and policy/approval boundaries.
- [ ] The Automation plan creates standard Agent Runs and reuses the queue, approval, audit, and notification contracts.
- [ ] Run `git diff --check` before the documentation commit.

## Execution Handoff

The foundation is complete once the user selects the four decisions. The new code session must implement only the selected first delivery, not all three domains at once. It must create local commits after each independently testable deliverable, run the relevant package-script checks only at those completion points, and stop before the next domain until the user authorizes it.
