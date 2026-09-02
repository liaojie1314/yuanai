# Agent Runtime Implementation Checklist

This checklist records the locally verified code contracts for the Agent runtime. It is not the
Phase 5 release gate. Automated recovery drill tests now cover five-minute event replay and a
forced exit of a test helper process, and an opt-in external-model drill covers two safe tools.
The phase remains blocked until successful evidence exists for the real external-model two-tool run,
the accepted Worker runtime crash recovery, and the five-minute disconnect recovery described in
`phase-5-agent-runtime.md`.

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

## Deferred Capabilities At The Phase 5 Boundary

The runtime deliberately excludes MCP, cloud sandboxes, Shell, browser
automation, real file writes, Desktop execution nodes, ToolConnection,
Artifact, and SecretStore integrations.

## Commands

Run backend tests serially because the shared PostgreSQL test fixture creates
the schema at session startup. Start dependencies with `pnpm dev:real` before
integration or browser tests.
