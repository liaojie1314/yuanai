# Desktop Execution Node Acceptance Record

Date: 2026-09-05
Evidence branch: `feature/tools-execution@cd4f675`

## Changes

- `5342a5f fix(desktop): clear cancelled execution approvals`
  removes a pending local approval when the server cancels before acceptance.
- `3a9432c fix(desktop): acknowledge cancelled node jobs`
  sends the protocol ACK for a pre-acceptance cancellation so the gateway can
  mark the cancellation as acknowledged.
- `5b684f6 fix(desktop): resolve auth storage path after user data override`
  resolves `session.enc` from Electron's current `userData` path at operation
  time, so isolated E2E profiles do not read the installed user's session.
- `bf9513d fix(desktop): terminate node socket during shutdown`
  releases an active node WebSocket immediately during Electron shutdown and
  covers the regression in the Desktop unit suite.
- `f7b96f5 fix(backend): enforce tool connection scopes`
  rejects manual execution without an authorized active connection and required
  scopes; this backend change is included in the branch baseline but is not a
  Desktop client change.
- `86d4123 fix(backend): reject jobs for revoked nodes`
  rejects new Desktop jobs for a revoked node before an execution record is created.
- `b983d9b fix(backend): invalidate revoked node sessions`
  refreshes a node's persisted status before WSS delivery and inbound messages,
  so a revoked session cannot return to `online` through a stale identity map.
- `cd4f675 test(desktop): cover execution cancellation and revocation`
  expands the real Electron scenario with cancellation and node-revocation checks.

## Commands

All pnpm commands used Node.js `22.21.1` and pnpm `10.22.0`.

- `pnpm check:runtime`: passed.
- `pnpm --filter @yuanai/desktop test:unit`: passed, 45 files and 303 tests.
- `pnpm --filter @yuanai/desktop test:integration`: passed, 3 files and 8 tests.
- `pnpm --filter @yuanai/desktop typecheck`: passed.
- `pnpm --filter @yuanai/desktop lint`: passed.
- `pnpm --filter @yuanai/desktop build`: passed.
- `pnpm --filter @yuanai/desktop test:e2e`: passed, `1 passed (29s)`.
- `pnpm --filter @yuanai/desktop exec playwright test --list`: found one
  Electron E2E test in `tests/e2e/execution-node.spec.ts`.

No Playwright browser download was run. The E2E harness uses Electron and may
use the system `/usr/bin/google-chrome` or an existing `executablePath` when a
browser binary is required.

## Evidence Boundary

The Desktop unit suite covers safeStorage fail-closed behavior, Ed25519
challenge and terminal signatures, pairing and token renewal, job acceptance,
local cancellation, result ACK and spool replay, reconnect backoff, resource
grants, and IPC allowlisting. The new auth-storage regression test verifies
that changing Electron's `userData` path changes the encrypted session target.

With the real backend already running, an existing local test account, the
verified post-restart X11 display (`:1`), and the user DBus Secret Service, the
E2E passed the safeStorage gate, logged in, created a node that the backend reported as
`online`, and delivered `browser_open_url`. A backend snapshot for the run
reported `status=succeeded`, `nodeDeliveryStatus=acknowledged`, and a populated
`nodeAcknowledgedAt`, which is evidence for the pairing/challenge, approval,
execution, signed result, ACK path, and clean test completion.

The current single E2E covers pairing, WSS challenge, local approval, signed
result delivery, ACK, pre-approval cancellation with a server acknowledgment,
and node revocation on this Linux runtime. After revocation, a new Desktop job
was rejected with HTTP 422 and the already connected client left `online`, which
is real evidence that its WSS session was invalidated. The E2E still does not
exercise a network disconnect followed by replay; that remains covered only by
Desktop unit/integration tests and is not real E2E acceptance. Windows/macOS
packaging and signing were not tested.

The ignored temporary output under `apps/desktop/dist`, `out`, and E2E result
directories was moved to the system trash after the run and was not added to
Git. Dependencies and model caches were preserved.

Unrelated changes observed in `apps/web/` and `backend/` were preserved.

## 2026-09-06 Forced-restart redelivery evidence

Date: 2026-09-06
Evidence branch: `feature/tools-execution@c9b5a1d`

- `c9b5a1d test(desktop): cover forced restart job redelivery` adds a second
  real Electron scenario and fixes both test callbacks to zero-parameter
  signatures (`test.info()`), because the installed Playwright 1.61.1 rejects
  bare first parameters at spec collection.
- With the real backend running through `pnpm dev:real` and the verified X11/DBus
  session, `pnpm --filter @yuanai/desktop test:e2e` passed `2 passed (2.8m)`:
  the original pairing/approval/cancellation/revocation scenario (26.0s) and the
  new forced-restart scenario (2.3m).
- The new scenario kills the Electron process with SIGKILL while a
  `browser_open_url` job is pending local approval, relaunches with the same
  user-data profile, logs back in, waits for the node to return `online`, and
  observes the server re-offering the same job after the delivery staleness
  window. After approval the backend reported the original execution id as
  `status=succeeded`, `nodeDeliveryStatus=acknowledged`, with a populated
  `nodeAcknowledgedAt`, and a later check confirmed no duplicate approval or
  second execution. A post-restart panel screenshot was inspected: node online
  state, certificate validity, capabilities, and grant controls render without
  overlap.
- This is job-level redelivery evidence: an unapproved job survives a forced
  client restart and completes exactly once. The result-spool replay path
  (a signed terminal result re-sent after reconnect until ACK) is still covered
  only by Desktop unit/integration tests and remains outside real E2E evidence.

## 2026-09-26 Local-memory routing and node-liveness evidence

Date: 2026-09-26
Evidence branch: `feature/memory-extraction-hybrid-search`

A fourth real Electron scenario covers memories whose body lives only on the
node (`storage_location=local_node`), and the node-liveness fix from
`230f72c fix(backend): stop treating closed desktop nodes as online`.

- `serves local memories from the node and reports them unavailable once it
vanishes` pairs a brand-new node inside the case, because `register_node`
  freezes `capabilities` at registration and a node paired before the
  `memory.*` jobs existed can never advertise them. The case asserts the
  backend recorded `memory.search`, `memory.write` and `memory.delete` for the
  new node before using them.
- Four legs, in order:
  1. The node **refuses** the `memory.write` approval. `POST /memories`
     answers `503 {"detail":"LOCAL_MEMORY_NODE_UNAVAILABLE"}` and
     `GET /memories` still lists nothing, so a refused push leaves no
     body-less orphan row behind in the cloud.
  2. The node **accepts** the approval. The created row comes back with
     `content=null`, `storageLocation="local_node"` and `nodeId` equal to the
     paired node, so the cloud kept no copy of the body.
  3. With the node connected, `GET /memories/search` returns the memory with
     the full plaintext and `localUnavailable=false`. The body can only have
     come from the node: the cloud column is `NULL`.
  4. The Electron process is killed with `SIGKILL`, so the server receives no
     goodbye of any kind. The case then polls the same search until it both
     reports `localUnavailable=true` **and** answers quickly, and finally
     asserts the result list is empty — unavailable, not silently absent.
- Leg 4's timing is the point of the case. `memory_node.py` gives a node job
  15 s; before the liveness fix a closed node still read as `online`, so every
  retrieval created an execution and burned that full timeout. Measured on this
  run (assertion temporarily tightened to `< 1 ms` to print the real value):
  the unavailable search returned in **8 ms**. The committed budget is 5 s,
  a third of the job timeout, which keeps the two behaviours far apart without
  being sensitive to machine speed.
- The combined condition only became true roughly 55 s into its 150 s window
  (test total 1.3m, legs 1-3 about 20 s). That is the heartbeat-expiry wait:
  `execution_node_heartbeat_stale_seconds` is 60 s and the client heartbeats
  every 25 s, so for up to a minute after the kill the node is still fresh and
  each attempt takes the 15 s timeout path instead. A regression in
  `node_is_fresh` would leave every attempt on that path and the poll would
  exhaust its window.

## Commands

All pnpm commands used Node.js `22.21.1` and pnpm `10.22.0`.

- `pnpm --filter @yuanai/desktop typecheck`: passed.
- `pnpm --filter @yuanai/desktop lint`: passed.
- `pnpm --filter @yuanai/desktop test:e2e`: passed, `4 passed (4.3m)`:
  - pairing/approval/cancellation/revocation — 25.4s
  - forced-restart redelivery — 2.3m
  - native-selector grant — 13.5s
  - local memory routing and node disappearance — 1.3m
- Repository gates: `pnpm typecheck`, `pnpm lint` and `pnpm test:unit`
  (web 27 files / 211 tests among them) passed. `pnpm format:check` reports 29
  files, all of them untracked notes under `.superpowers/`; every tracked file
  in this change is Prettier-clean.

## Evidence Boundary

- The stack was the real one started by `pnpm dev:real`: FastAPI on `:8000`,
  PostgreSQL on host port 5433, MinIO and Redis from `docker-compose.yml`.
  No AI provider key was configured, so `maybe_embed_text` returns `None` and
  the retrieval vector arm stays off; the keyword arm and the node arm are what
  this evidence covers.
- `node:sweeper` was **not** run during this scenario, and the case
  deliberately asserts nothing about `ExecutionNode.status` flipping to
  `offline`. Routing does not depend on the sweeper: `node_is_fresh` requires a
  recent `last_seen_at`, and `apply_node_message` calls `set_node_online` on
  every inbound message, so a node swept to `offline` returns to `online` on
  its next heartbeat. The sweeper's own transition is covered by
  `backend/tests/unit/test_node_sweeper.py`. What the sweeper still owns in
  production is the _reported_ node status in the UI and API listing; that
  remains outside real E2E evidence.
- Not covered by this case: recovery after the node comes back (no relaunch
  leg), `memory.delete` routing on `DELETE /memories/{id}`, the Memory Center
  UI in `apps/web`, and multi-node selection. `memory.delete` is idempotent on
  the node, so a node-side delete failure can only be produced by refusing the
  approval — the same mechanism leg 1 already exercises for `memory.write`.
- No mobile verification was performed and none was needed: this change set
  touches no file under `apps/mobile/`, so there is nothing an Android device
  or emulator could observe that the desktop and backend checks do not.
  iOS remains untested on this machine, as always.
