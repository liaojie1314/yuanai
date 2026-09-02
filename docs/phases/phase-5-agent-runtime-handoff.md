# Agent Runtime Handoff

## Stable v1 Contracts

- `AgentRun` is the durable lifecycle record and carries its owning `user_id`.
- `AgentStep` is ordered by `(run_id, sequence)` and records model, tool,
  approval, input, or final work without raw secret material.
- `AgentEvent` is the replay source. The server allocates a monotonic
  per-Run sequence, persists it before broadcast, and serves events after
  `Last-Event-ID`.
- `ApprovalRequest` binds user, Run, Step, tool name, execution location,
  expiration, and a canonical argument hash. A decision and execution marker
  can be consumed only once.
- `ToolSpec` and `ToolRegistry` expose bounded, read-only builtins. Policy
  denies side-effecting tools until approval.
- Redis queue delivery is acknowledged only after a lease is acquired.
  Recovery requeues deliveries and database Runs without a live lease.
- Metrics are structured and redacted: they include Run/Step identifiers and a
  salted hash of the user identifier, never user content or raw arguments.

## Operations

Set `AGENT_ENABLED=false` in production. For internal rollout, set it to
`true` only in an isolated environment or use `AGENT_ALLOWLIST_USER_IDS` with
the exact UUIDs permitted to create Runs. Keep the admin summary allowlist
separate through `AGENT_ADMIN_USER_IDS`.

Start the independent processes with the package scripts:

```text
pnpm agent:worker
pnpm agent:recovery-worker
```

Use the event stream cursor after every reconnect. The event store remains the
source of truth if Redis broadcast is unavailable.

## Known Validation Boundary

Backend integration and browser checks require PostgreSQL, Redis, and the web
server. The local environment record documents service startup failures; do
not treat an unavailable dependency as an application test pass.

The recovery drill tests provide automated evidence for five-minute event
replay and a forced exit of a test helper process. The external-model drill is
opt-in because it sends a billed provider request. Neither test is a release
acceptance of a deployed Worker, an external model, or a production failure
recovery environment; record a successful run with its dependency versions and
logs before checking the Phase 5 gate.
