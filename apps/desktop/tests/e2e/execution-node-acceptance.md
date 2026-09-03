# Desktop Execution Node Acceptance Record

Date: 2026-09-03
Baseline: `feature/tools-execution@6bfe811`

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

## Commands

All pnpm commands used Node.js `22.21.1` and pnpm `10.22.0`.

- `pnpm check:runtime`: passed.
- `pnpm --filter @yuanai/desktop test:unit`: passed, 45 files and 303 tests.
- `pnpm --filter @yuanai/desktop test:integration`: passed, 3 files and 8 tests.
- `pnpm --filter @yuanai/desktop typecheck`: passed.
- `pnpm --filter @yuanai/desktop lint`: passed.
- `pnpm --filter @yuanai/desktop build`: passed.
- `pnpm --filter @yuanai/desktop test:e2e`: passed, `1 passed (26.5s)`.
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

With the real backend already running, existing test credentials, the current
X11 display (`:0`), and the user DBus Secret Service, the E2E passed the
safeStorage gate, logged in, created a node that the backend reported as
`online`, and delivered `browser_open_url`. A backend snapshot for the run
reported `status=succeeded`, `nodeDeliveryStatus=acknowledged`, and a populated
`nodeAcknowledgedAt`, which is evidence for the pairing/challenge, approval,
execution, signed result, ACK path, and clean test completion.

The current single E2E covers pairing, WSS challenge, local approval, signed
result delivery, ACK, and clean teardown on this Linux runtime. It does not
exercise cancellation, reconnect/replay, or node revocation; those remain
covered only by Desktop unit/integration tests and are not real E2E acceptance.
Windows/macOS packaging and signing were not tested.

The E2E packaging directory generated during this run remains an ignored
temporary output under `apps/desktop/dist`; it was not added to Git. The
existing `apps/desktop/out` build output, dependencies, and model caches were
preserved.

Unrelated changes observed in `apps/web/` and `backend/` were preserved.
