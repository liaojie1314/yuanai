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
