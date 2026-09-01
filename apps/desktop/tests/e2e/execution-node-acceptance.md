# Desktop Execution Node Acceptance Record

Date: 2026-09-01
Baseline: `feature/tools-execution@65ab090`

## Changes

- `5342a5f fix(desktop): clear cancelled execution approvals`
  removes a pending local approval when the server cancels before acceptance.
- `3a9432c fix(desktop): acknowledge cancelled node jobs`
  sends the protocol ACK for a pre-acceptance cancellation so the gateway can
  mark the cancellation as acknowledged.

## Commands

All pnpm commands used Node.js `22.21.1` and pnpm `10.22.0`.

- `pnpm check:runtime`: passed.
- `pnpm --filter @yuanai/desktop test:unit`: passed, 45 files and 302 tests.
- `pnpm --filter @yuanai/desktop test:integration`: passed, 3 files and 8 tests.
- `pnpm --filter @yuanai/desktop typecheck`: passed.
- `pnpm --filter @yuanai/desktop lint`: passed.
- `pnpm --filter @yuanai/desktop build`: passed.
- `pnpm --filter @yuanai/desktop test:e2e`: built the unpacked Electron app, then
  the single Playwright test failed before launch because
  `http://localhost:8000/api/v1/auth/send-verify-code` was refused with
  `ECONNREFUSED 127.0.0.1:8000`.
- `pnpm --filter @yuanai/desktop exec playwright test --list`: found one
  Electron E2E test in `tests/e2e/execution-node.spec.ts`.

## Evidence Boundary

The Desktop unit suite covers safeStorage fail-closed behavior, Ed25519
challenge and terminal signatures, pairing and token renewal, job acceptance,
local cancellation, result ACK and spool replay, reconnect backoff, resource
grants, and IPC allowlisting. The real Electron E2E has not completed pairing,
WSS, approval, execution, signed callback, ACK, reconnect, or revocation in
this environment because the required backend was not running on port 8000.

The real desktop keychain was therefore not accepted as verified by the E2E;
the test's safeStorage gate is reached only after the backend-created test user
step. No backend startup was performed because the repository's
`pnpm dev:real` script also writes `apps/web/.env.local`, outside the requested
Desktop-only write scope. Windows/macOS packaging and signing were not tested.

Unrelated changes observed in `apps/web/` and `backend/` were preserved.
