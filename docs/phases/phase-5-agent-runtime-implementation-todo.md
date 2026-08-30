# Agent Runtime Implementation Checklist

This checklist records the locally verified code contracts for the Agent runtime. It is not the
Phase 5 release gate: the phase remains blocked until the real external-model two-tool run,
real Worker-crash recovery, and 5-minute disconnect recovery drills in
`phase-5-agent-runtime.md` have evidence.

## Verification

- [x] Agent creation returns `202` and is idempotent by `(user_id, idempotency_key)`.
- [x] Production Agent access is disabled unless `AGENT_ENABLED=true` or the
      user ID is present in `AGENT_ALLOWLIST_USER_IDS`.
- [x] Run, Step, Event, and Approval records are tenant-scoped.
- [x] Events are persisted before Redis broadcast and replayed by `Last-Event-ID`.
- [x] Queue delivery, lease renewal, cancellation, and recovery are idempotent.
- [x] Coordinator enforces step, model, tool, token, cost, duration, and loop bounds.
- [x] High-risk tools pause for approval; approval binds tool, location, and
      canonical argument hash.
- [x] Runtime metrics contain `run_id`, `step_id`, and a salted `user_id_hash`;
      prompts, goals, credentials, files, and raw tool arguments are excluded.
- [x] Existing Chat, auth, file, and sharing contracts remain covered by their
      existing test suites.

## Deferred Capabilities

The runtime deliberately excludes MCP, cloud sandboxes, Shell, browser
automation, real file writes, Desktop execution nodes, ToolConnection,
Artifact, and SecretStore integrations.

## Commands

Run backend tests serially because the shared PostgreSQL test fixture creates
the schema at session startup. Start dependencies with `pnpm dev:real` before
integration or browser tests.
