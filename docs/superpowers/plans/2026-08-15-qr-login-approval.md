# QR Login Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a secure, explicit-approval QR login flow: Web and Electron create and poll QR challenges, while an authenticated Expo client scans, reviews, and approves the target device before it receives a one-time login code.

**Architecture:** The backend owns challenge lifecycle, hashes every bearer secret before persistence, and records durable audit events. A target device receives a QR payload plus a separate polling secret which is never encoded in the QR; an authenticated mobile scanner may inspect and explicitly approve or deny the challenge. The target then consumes a short-lived authorization code exactly once through the normal `AuthResponse` session creation path. `@yuanai/types` and `@yuanai/core` expose platform-neutral contracts and request functions; Web, Mobile, and Desktop own their QR rendering/scanning UI.

**Tech Stack:** FastAPI, Pydantic v2, async SQLAlchemy, Alembic, Redis, Python `qrcode[pil]`, Axios, React 19, Next.js 15, Electron 33, Expo SDK 52, `expo-camera`, React Native SVG, Vitest, pytest, Playwright/in-app browser, Expo Dev Client.

## Global Constraints

- Work only on `feature/voice-qr-files-media`; do not push, merge, or switch `dev`.
- The user approved the existing recommended QR design: QR contains only a one-time challenge and API address, never access, refresh, polling, or authorization tokens.
- The database stores SHA-256 hashes of the QR challenge, target polling secret, and authorization code; neither values nor QR payloads may be logged.
- Mobile approval requires an authenticated account and an explicit visible confirm/deny action. It must show platform, device name, signed-in account, and expiry before either action.
- Target polling needs the separate polling secret returned only by challenge creation; only a successfully approved target can exchange a one-time code for `AuthResponse`.
- Challenge states are `pending`, `approved`, `denied`, `consumed`, and `expired`; expiration is authoritative and terminal.
- Rate-limit challenge creation and inspection/approval attempts with Redis. Persist an audit event for create, inspect, approve, deny, expire, and consume.
- Routing layers only parse/depend/serialize; all state transitions, hashing, rate limits, audit writes, and token issuance belong in `qr_login_service.py`.
- `packages/` must remain platform-neutral. Every exported TypeScript symbol has Chinese JSDoc; public Python APIs have strict type annotations. No `any`, native system alert, or unguarded external URL.
- Use scripts declared in `package.json` for application startup/build/test. `.codex/` is local-only and must not be staged. Do not alter `docs/`.
- Implement this as one tested feature commit only: `feat(backend,core,web,mobile,desktop): add qr login approval flow`.
- Before device verification, stop and ask the user to connect the Android/iOS device by USB. Do not claim QR mobile validation without the user-confirmed device connection.

---

## File Structure

| Path                                                                                                                                           | Responsibility                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `backend/app/models/qr_login.py`                                                                                                               | Challenge state, hashed bearer data, target metadata, user approval and durable event ORM models.                                   |
| `backend/alembic/versions/<revision>_add_qr_login_challenges.py`                                                                               | Creates `qr_login_challenges` and `qr_login_events` with indexes and foreign keys.                                                  |
| `backend/app/schemas/qr_login.py`                                                                                                              | Camel-case Pydantic request/response contracts; secrets are target-only response fields.                                            |
| `backend/app/services/qr_login_service.py`                                                                                                     | State machine, secret generation/hashing, Redis rate limits, QR SVG/data URI generation, audit rows, and one-time session exchange. |
| `backend/app/api/v1/qr_login.py`                                                                                                               | Thin `/auth/qr-login/*` route layer using `CurrentUser` where approval requires identity.                                           |
| `backend/app/api/v1/auth.py`, `backend/app/main.py`, `backend/app/models/__init__.py`                                                          | Registers the router and ORM metadata.                                                                                              |
| `backend/app/core/config.py`, `backend/.env.example`, `backend/pyproject.toml`                                                                 | QR TTL/rate-limit settings and explicit `qrcode[pil]` dependency; no secrets.                                                       |
| `backend/tests/unit/test_qr_login_service.py`                                                                                                  | Hashing, state transition, expiry, rate-limit, audit, and one-time consumption tests.                                               |
| `backend/tests/integration/test_qr_login.py`                                                                                                   | Full authenticated approval and unauthenticated target exchange API tests.                                                          |
| `packages/types/src/index.ts`                                                                                                                  | Shared QR platform/state/request/response contracts.                                                                                |
| `packages/core/src/api/qr-login.ts`, `packages/core/src/api/index.ts`                                                                          | Platform-neutral API client and QR payload parser.                                                                                  |
| `packages/core/src/api/__tests__/qr-login.test.ts`                                                                                             | MSW contracts for create, status, inspect, approve, and exchange.                                                                   |
| `apps/web/src/components/auth/QrLoginPanel.tsx`                                                                                                | QR target UI, expiry timer, strict polling cleanup, and session installation.                                                       |
| `apps/web/src/components/auth/QrLoginPanel.test.tsx`                                                                                           | QR rendering, approval transition, expiry refresh, cleanup and exchange tests.                                                      |
| `apps/web/src/app/(auth)/login/page.tsx`, `apps/web/src/app/(auth)/auth.css`                                                                   | Replaces demo QR state with the real target panel and preserves keyboard-accessible back navigation.                                |
| `apps/desktop/src/renderer/login/QrLoginPanel.tsx`                                                                                             | Electron target QR UI using Core APIs and the renderer's auth store.                                                                |
| `apps/desktop/src/renderer/login/QrLoginPanel.test.tsx`, `apps/desktop/src/renderer/login/App.tsx`, `apps/desktop/src/renderer/login/auth.css` | Login-shell integration, focus-safe rendering and client tests.                                                                     |
| `apps/mobile/src/components/auth/QrLoginScanner.tsx`                                                                                           | Camera permission, bounded QR parser, inspect/review/approve/deny UI, with no token handling in route code.                         |
| `apps/mobile/src/components/auth/QrLoginScanner.test.tsx`                                                                                      | Permission denied, malformed payload, inspect, confirm, deny, expiry and duplicate scan coverage.                                   |
| `apps/mobile/app/(main)/qr-login.tsx`, `apps/mobile/src/components/main/ConversationList.tsx`, `apps/mobile/app/_layout.tsx`                   | Protected scanner route and the side-bar entry immediately beside the Settings control.                                             |
| `apps/mobile/package.json`, `apps/mobile/app.json`, `pnpm-lock.yaml`                                                                           | Pins Expo SDK 52-compatible `expo-camera` and declares camera permission text.                                                      |

## Contracts

```python
class QRLoginCreateRequest(BaseModel):
    target_platform: Literal["web", "desktop"]
    device_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]

class QRLoginCreateResponse(BaseModel):
    challenge: str
    poll_secret: str
    qr_data_uri: str
    expires_at: datetime
    poll_after_ms: int

class QRLoginInspectResponse(BaseModel):
    challenge: str
    target_platform: Literal["web", "desktop"]
    device_name: str
    expires_at: datetime
    status: Literal["pending", "approved", "denied", "consumed", "expired"]

class QRLoginStatusResponse(BaseModel):
    status: Literal["pending", "approved", "denied", "consumed", "expired"]
    expires_at: datetime
    authorization_code: str | None = None

class QRLoginExchangeRequest(BaseModel):
    challenge: str
    poll_secret: str
    authorization_code: str
```

```typescript
/** 可扫码登录的目标平台。 */
export type QrLoginTargetPlatform = 'web' | 'desktop'
/** 二维码挑战的服务端终态或等待态。 */
export type QrLoginStatus = 'pending' | 'approved' | 'denied' | 'consumed' | 'expired'

/** 目标端创建的二维码挑战。`pollSecret` 绝不能嵌入二维码或日志。 */
export interface QrLoginChallenge {
  challenge: string
  pollSecret: string
  qrDataUri: string
  expiresAt: string
  pollAfterMs: number
}

/** Mobile 扫描的 URL；解析仅接受 yuanai://qr-login?challenge=...&api=...。 */
export interface ParsedQrLoginPayload {
  challenge: string
  apiBaseUrl: string
}
```

`POST /api/v1/auth/qr-login/challenges` creates a target challenge. `GET /.../status` requires an `X-QR-Poll-Secret` header. `GET /.../inspect`, `POST /.../approve`, and `POST /.../deny` require normal Bearer authentication; approval is idempotent only for the approving user. `POST /.../exchange` accepts all three target-held secrets and returns the existing `AuthResponse` once.

### Task 1: Persistent secure QR challenge state machine

**Files:**

- Create: `backend/app/models/qr_login.py`
- Create: `backend/alembic/versions/<revision>_add_qr_login_challenges.py`
- Create: `backend/app/schemas/qr_login.py`
- Create: `backend/app/services/qr_login_service.py`
- Create: `backend/tests/unit/test_qr_login_service.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/core/config.py`
- Modify: `backend/.env.example`
- Modify: `backend/pyproject.toml`

**Consumes:** `Base`, async `AsyncSession`, `redis_client`, `auth_service.build_auth_response`, and the existing `User` ORM model.

**Produces:** A tested state machine used by the route layer:

```python
async def create_challenge(
    *, request: QRLoginCreateRequest, request_key: str, db: AsyncSession
) -> QRLoginCreateResponse: ...
async def inspect_challenge(*, challenge: str, user: User, db: AsyncSession) -> QRLoginInspectResponse: ...
async def approve_challenge(*, challenge: str, user: User, db: AsyncSession) -> None: ...
async def deny_challenge(*, challenge: str, user: User, db: AsyncSession) -> None: ...
async def get_target_status(*, challenge: str, poll_secret: str, db: AsyncSession) -> QRLoginStatusResponse: ...
async def exchange_challenge(*, request: QRLoginExchangeRequest, db: AsyncSession) -> AuthResponse: ...
```

- [x] **Step 1: Add failing service tests for secret persistence and target metadata.**

```python
async def test_create_challenge_persists_only_hashes(db: AsyncSession) -> None:
    result = await create_challenge(
        request=QRLoginCreateRequest(target_platform="desktop", device_name="Ubuntu desktop"),
        request_key="127.0.0.1",
        db=db,
    )
    stored = (await db.execute(select(QRLoginChallenge))).scalar_one()
    assert stored.challenge_hash != result.challenge
    assert stored.poll_secret_hash != result.poll_secret
    assert stored.target_platform == "desktop"
    assert "challenge=" in decode_qr_data_uri(result.qr_data_uri)
    assert result.poll_secret not in decode_qr_data_uri(result.qr_data_uri)
```

- [x] **Step 2: Run the red test.**

Run: `cd backend && uv run pytest tests/unit/test_qr_login_service.py::test_create_challenge_persists_only_hashes -q`

Expected: FAIL because QR challenge models and `create_challenge` do not exist.

- [x] **Step 3: Add ORM, Alembic migration and settings.**

```python
class QRLoginChallenge(Base):
    __tablename__ = "qr_login_challenges"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    challenge_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    poll_secret_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    authorization_code_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    target_platform: Mapped[str] = mapped_column(String(16), nullable=False)
    device_name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    approved_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
```

Add `QRLoginEvent` with challenge FK, optional actor-user FK, action and timestamp. Set `qr_login_ttl_seconds = 90`, `qr_login_create_limit = 5`, `qr_login_attempt_limit = 12`, and explicit rate-limit window settings. Add `qrcode[pil]>=7.4.2` and an empty config example only; never add keys.

- [x] **Step 4: Implement the minimal state machine.**

Use `secrets.token_urlsafe(32)` and `hashlib.sha256(value.encode()).hexdigest()`. Generate an `authorization_code` only after successful approval; update status conditionally in the same transaction. Before every state read, call a private `expire_if_needed` helper so expired pending rows become `expired` and receive a single `expire` audit event. Redis keys must use `qr-login:create:<request-key>` and `qr-login:attempt:<hashed-challenge>:<user-id>` with `INCR` and `EXPIRE` only on first increment. The QR payload must be:

```text
yuanai://qr-login?challenge=<urlencoded-challenge>&api=<urlencoded-api-v1-base>
```

The target `poll_secret` is not included in this string, in `QRLoginEvent.metadata`, or in exceptions.

- [x] **Step 5: Add failing lifecycle tests, then implement transitions.**

```python
async def test_only_approver_can_repeat_approval_and_exchange_is_single_use(
    db: AsyncSession, user_a: User, user_b: User
) -> None:
    created = await create_challenge(..., db=db)
    await approve_challenge(challenge=created.challenge, user=user_a, db=db)
    with pytest.raises(QRLoginForbiddenError):
        await approve_challenge(challenge=created.challenge, user=user_b, db=db)
    status = await get_target_status(..., db=db)
    response = await exchange_challenge(request=QRLoginExchangeRequest(...), db=db)
    assert response.user.id == str(user_a.id)
    with pytest.raises(QRLoginConsumedError):
        await exchange_challenge(request=QRLoginExchangeRequest(...), db=db)
```

Cover reject, expiry, invalid QR/poll secret, creation and attempt limits, and one durable event for each action. `build_auth_response` is called only after consuming the database code in the same transaction; failure rolls the transaction back and leaves the code unconsumed.

- [x] **Step 6: Run focused backend verification.**

Run:

```bash
cd backend && uv run pytest tests/unit/test_qr_login_service.py -x -q
cd backend && uv run ruff check app/models/qr_login.py app/schemas/qr_login.py app/services/qr_login_service.py tests/unit/test_qr_login_service.py
cd backend && uv run mypy app/models/qr_login.py app/schemas/qr_login.py app/services/qr_login_service.py
```

Expected: all focused tests, Ruff and mypy pass.

### Task 2: Auth route contract and integration coverage

**Files:**

- Create: `backend/app/api/v1/qr_login.py`
- Create: `backend/tests/integration/test_qr_login.py`
- Modify: `backend/app/api/v1/auth.py`
- Modify: `backend/app/main.py`

**Consumes:** Task 1’s schemas/service APIs and `CurrentUser` / `DB` dependencies.

**Produces:** Stable routes under `/api/v1/auth/qr-login` with normal `AuthResponse` exchange.

- [ ] **Step 1: Write a failing complete API-flow test.**

```python
async def test_mobile_approval_logs_target_in_once(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    created = await client.post(
        "/api/v1/auth/qr-login/challenges",
        json={"targetPlatform": "web", "deviceName": "Firefox on Ubuntu"},
    )
    assert created.status_code == 201
    payload = created.json()
    inspected = await client.get(
        f"/api/v1/auth/qr-login/challenges/{payload['challenge']}/inspect",
        headers=auth_headers,
    )
    assert inspected.json()["deviceName"] == "Firefox on Ubuntu"
    assert (await client.post(
        f"/api/v1/auth/qr-login/challenges/{payload['challenge']}/approve",
        headers=auth_headers,
    )).status_code == 204
    status = await client.get(
        f"/api/v1/auth/qr-login/challenges/{payload['challenge']}/status",
        headers={"X-QR-Poll-Secret": payload["pollSecret"]},
    )
    exchanged = await client.post("/api/v1/auth/qr-login/exchange", json={
        "challenge": payload["challenge"], "pollSecret": payload["pollSecret"],
        "authorizationCode": status.json()["authorizationCode"],
    })
    assert exchanged.status_code == 200
    assert "access_token" in exchanged.json()
```

- [ ] **Step 2: Run the red integration test.**

Run: `cd backend && uv run pytest tests/integration/test_qr_login.py::test_mobile_approval_logs_target_in_once -q`

Expected: FAIL with 404 before the router is registered.

- [ ] **Step 3: Implement only thin route handlers.**

```python
@router.post("/challenges", response_model=QRLoginCreateResponse, status_code=201)
async def create_qr_challenge(req: QRLoginCreateRequest, request: Request, db: DB) -> QRLoginCreateResponse:
    return await qr_login_service.create_challenge(
        request=req, request_key=request.client.host if request.client else "unknown", db=db
    )
```

Create status/inspect/approve/deny/exchange handlers and translate only service-specific errors to structured `HTTPException` codes: `QR_LOGIN_NOT_FOUND`, `QR_LOGIN_EXPIRED`, `QR_LOGIN_FORBIDDEN`, `QR_LOGIN_RATE_LIMITED`, and `QR_LOGIN_CONSUMED`. Add the router in `app.main`; do not place state transitions in `auth.py`.

- [ ] **Step 4: Extend integration coverage.**

Add separate tests for unauthenticated inspect/approve/deny, wrong polling secret, user B approval after user A, denial without tokens, expiration, repeated exchange, rate-limit 429, QR response not containing `pollSecret` in `qrDataUri`, and audit rows. Use a fixed clock rather than sleeps.

- [ ] **Step 5: Run backend integration and migration verification.**

Run:

```bash
cd backend && uv run alembic upgrade head
cd backend && uv run pytest tests/integration/test_qr_login.py -x -q
cd backend && uv run ruff check app/api/v1/qr_login.py app/api/v1/auth.py app/main.py tests/integration/test_qr_login.py
cd backend && uv run mypy app/api/v1/qr_login.py app/services/qr_login_service.py
```

Expected: migration applies cleanly; integration, lint, and type checks pass.

### Task 3: Shared QR API and type boundary

**Files:**

- Create: `packages/core/src/api/qr-login.ts`
- Create: `packages/core/src/api/__tests__/qr-login.test.ts`
- Modify: `packages/core/src/api/index.ts`
- Modify: `packages/types/src/index.ts`

**Consumes:** Task 2 endpoint shapes and the existing authenticated Axios client.

**Produces:** `createQrLoginChallenge`, `getQrLoginStatus`, `inspectQrLoginChallenge`, `approveQrLoginChallenge`, `denyQrLoginChallenge`, `exchangeQrLoginChallenge`, and `parseQrLoginPayload` for every platform.

- [ ] **Step 1: Add failing Core contract tests.**

```typescript
it('keeps the polling secret out of the generated QR payload', async () => {
  const challenge = await createQrLoginChallenge({
    targetPlatform: 'web',
    deviceName: 'Firefox on Ubuntu',
  })
  expect(challenge.qrDataUri).not.toContain(challenge.pollSecret)
})

it('rejects a scanner payload with a non-HTTPS non-loopback API host', () => {
  expect(() =>
    parseQrLoginPayload('yuanai://qr-login?challenge=x&api=http://example.com/api/v1')
  ).toThrow('QR_LOGIN_INVALID_PAYLOAD')
})
```

- [ ] **Step 2: Run the red tests.**

Run: `pnpm --filter @yuanai/core test:unit -- qr-login.test.ts`

Expected: FAIL because the module and types do not exist.

- [ ] **Step 3: Implement the API module and parser.**

Use the existing `apiClient`. Pass `X-QR-Poll-Secret` only to status. `parseQrLoginPayload` accepts exactly `yuanai:` URLs, a 32+ character challenge, `/api/v1` API path, HTTPS for non-loopback addresses, and no username/password/query/fragment in the API URL. It may accept `http://<LAN-IP>:8000/api/v1` for USB/LAN Expo development, but rejects every other insecure remote host.

- [ ] **Step 4: Run shared checks.**

Run:

```bash
pnpm --filter @yuanai/types typecheck
pnpm --filter @yuanai/core typecheck
pnpm --filter @yuanai/core test:unit -- qr-login.test.ts
```

Expected: all pass with no platform import in `packages/`.

### Task 4: Web and Electron target QR login surfaces

**Files:**

- Create: `apps/web/src/components/auth/QrLoginPanel.tsx`
- Create: `apps/web/src/components/auth/QrLoginPanel.test.tsx`
- Modify: `apps/web/src/app/(auth)/login/page.tsx`
- Modify: `apps/web/src/app/(auth)/auth.css`
- Create: `apps/desktop/src/renderer/login/QrLoginPanel.tsx`
- Create: `apps/desktop/src/renderer/login/QrLoginPanel.test.tsx`
- Modify: `apps/desktop/src/renderer/login/App.tsx`
- Modify: `apps/desktop/src/renderer/login/auth.css`

**Consumes:** Task 3’s Core APIs and the existing Web/Desktop auth stores.

**Produces:** Real QR login experiences that do not display a demo asset or persist target-only secrets after completion/close.

- [ ] **Step 1: Write failing Web panel tests.**

```tsx
it('refreshes an expired QR challenge and installs the exchanged session only once', async () => {
  render(<QrLoginPanel targetPlatform="web" deviceName="Firefox on Ubuntu" onBack={vi.fn()} />)
  expect(await screen.findByRole('img', { name: '扫码登录二维码' })).toHaveAttribute(
    'src',
    'data:image/png;base64,test'
  )
  await advanceUntilStatus('approved')
  expect(exchangeQrLoginChallenge).toHaveBeenCalledOnce()
  expect(router.replace).toHaveBeenCalledWith('/chat')
})
```

- [ ] **Step 2: Run the Web test red.**

Run: `pnpm --filter @yuanai/web test:unit -- QrLoginPanel.test.tsx`

Expected: FAIL because the panel does not exist and the login page still references `qr-demo.svg`.

- [ ] **Step 3: Implement the Web panel.**

Use the returned `qrDataUri` as a labelled image. Start a single `window.setInterval` after creation using bounded `pollAfterMs`; clear it on unmount, back, expiry, denial, network terminal failure and successful exchange. Display a textual countdown, explicit refresh control, and `aria-live="polite"` status. On approved status, exchange once, call the existing auth-store `setAuth`, then `router.replace(from ?? '/chat')`. Replace only the fake `showQr` timer branch, preserving email/OAuth flows and the existing top-right toast for errors.

- [ ] **Step 4: Add and run desktop red tests.**

```tsx
it('renders a real QR and exchanges an approved target without exposing pollSecret', async () => {
  render(<App />)
  await user.click(screen.getByRole('button', { name: '扫码登录' }))
  expect(await screen.findByRole('img', { name: '扫码登录二维码' })).toBeVisible()
  await advanceDesktopQrStatus('approved')
  expect(exchangeQrLoginChallenge).toHaveBeenCalledTimes(1)
})
```

Implement the same lifecycle in a dedicated desktop panel, using renderer-local device text `元AI桌面端` and existing hash-router/login success behavior. Do not route desktop QR through OAuth IPC or Electron deep-link handlers; it is an ordinary API flow through Core.

- [ ] **Step 5: Run Web/Desktop automated checks.**

Run:

```bash
pnpm --filter @yuanai/web typecheck
pnpm --filter @yuanai/web lint
pnpm --filter @yuanai/web test:unit -- QrLoginPanel.test.tsx
pnpm --filter @yuanai/desktop typecheck
pnpm --filter @yuanai/desktop lint
pnpm --filter @yuanai/desktop test:unit -- QrLoginPanel.test.tsx App.test.tsx
```

Expected: Web and desktop target flows test passing QR rendering, poll cleanup, expiry refresh, rejection, exchange failure and success.

### Task 5: Mobile scan, review, explicit approval, and route

**Files:**

- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/app.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/mobile/src/components/auth/QrLoginScanner.tsx`
- Create: `apps/mobile/src/components/auth/QrLoginScanner.test.tsx`
- Create: `apps/mobile/app/(main)/qr-login.tsx`
- Modify: `apps/mobile/src/components/main/ConversationList.tsx`
- Modify: `apps/mobile/app/_layout.tsx`

**Consumes:** Task 3 parser/API contracts and the authenticated mobile auth store.

**Produces:** A mobile-only camera scanner reached from a dedicated side-bar control immediately beside Settings; scan does not authorize until the visible confirmation button is pressed.

- [ ] **Step 1: Install the Expo SDK-compatible camera dependency and add a failing component test.**

Use Expo’s package resolver so the lockfile matches SDK 52:

```bash
pnpm --filter @yuanai/mobile exec expo install expo-camera
```

Then add a mock-backed test:

```tsx
it('requires confirmation after a valid scan before approving', async () => {
  render(<QrLoginScanner />)
  fireCameraBarcode({
    data: 'yuanai://qr-login?challenge=valid-challenge&api=http%3A%2F%2F10.0.0.8%3A8000%2Fapi%2Fv1',
  })
  expect(await screen.findByText('正在登录到 Firefox on Ubuntu')).toBeTruthy()
  expect(approveQrLoginChallenge).not.toHaveBeenCalled()
  await user.press(screen.getByRole('button', { name: '确认登录' }))
  expect(approveQrLoginChallenge).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run the mobile red test.**

Run: `pnpm --filter @yuanai/mobile test:unit -- QrLoginScanner.test.tsx`

Expected: FAIL because the camera component and QR scanner route do not exist.

- [ ] **Step 3: Implement the scanner as a three-state UI.**

1. `camera`: request `CameraView` permission, provide a non-native explanation plus button to retry/open system settings after a denial, and ignore duplicate detections while inspecting.
2. `review`: parse only valid QR payloads, use the scanned LAN/production API base for the Core request, and show signed-in `user.email`, target platform/device and localised expiry. `确认登录` calls approve; `拒绝登录` calls deny; neither button leaks secrets.
3. `result`: show success/denial/expiry with a button back to Settings. Camera is unmounted while review/result is visible.

`QrLoginScanner` must accept an optional `apiBaseUrl` for the LAN API encoded by the target QR and replace Core client base only for its own request scope; it must not persist or globally mutate API configuration. Add a side-bar icon-only `ScanLine` control immediately before the existing Settings icon, with an accessible `扫码登录` label and a protected Expo route. Register a `cameraPermission` message in `app.json`.

- [ ] **Step 4: Extend test coverage.**

Cover camera permission denied, malformed/non-yuanai QR, insecure remote API rejection, expired inspection response, deny request, same scan emitted twice, failed approval retry, and camera unmount before request completion. Assert no approval call occurs before `确认登录`.

- [ ] **Step 5: Run mobile checks.**

Run:

```bash
pnpm --filter @yuanai/mobile typecheck
pnpm --filter @yuanai/mobile lint
pnpm --filter @yuanai/mobile test:unit -- QrLoginScanner.test.tsx
```

Expected: all checks pass; `pnpm-lock.yaml` contains only Expo camera’s required closure.

### Task 6: Real API, UI, USB-device verification, progress, and one commit

**Files:**

- Modify (ignored): `.codex/progress/feature-voice-qr-files-media.md`

**Consumes:** Tasks 1-5 and the existing local real-API account recorded in the ignored progress file.

**Produces:** Evidence that Web/Desktop target UI works against FastAPI, and a USB-gated real-device verification request before mobile approval is claimed.

- [ ] **Step 1: Run backend and cross-package automated regression checks.**

Run:

```bash
cd backend && uv run pytest tests/unit/test_qr_login_service.py tests/integration/test_qr_login.py -x -q
cd backend && uv run ruff check app/models/qr_login.py app/schemas/qr_login.py app/services/qr_login_service.py app/api/v1/qr_login.py tests/unit/test_qr_login_service.py tests/integration/test_qr_login.py
cd backend && uv run mypy app/models/qr_login.py app/schemas/qr_login.py app/services/qr_login_service.py app/api/v1/qr_login.py
pnpm --filter @yuanai/types typecheck
pnpm --filter @yuanai/core typecheck && pnpm --filter @yuanai/core test:unit
pnpm --filter @yuanai/web typecheck && pnpm --filter @yuanai/web lint && pnpm --filter @yuanai/web test:unit
pnpm --filter @yuanai/desktop typecheck && pnpm --filter @yuanai/desktop lint && pnpm --filter @yuanai/desktop test:unit
pnpm --filter @yuanai/mobile typecheck && pnpm --filter @yuanai/mobile lint && pnpm --filter @yuanai/mobile test:unit
```

- [ ] **Step 2: Verify Web and desktop target UIs against the real API.**

Run `pnpm dev:real`, open Web with the actual login page, generate a QR and confirm countdown/refresh/approved state using a controlled API approval call only for this pre-device check. Run `pnpm dev:desktop`, generate a desktop QR, confirm no token appears in renderer DOM/console, and retain a screenshot or factual local log path in the ignored progress file. Do not use mocks for this verification.

- [ ] **Step 3: Stop for the USB checkpoint.**

Ask the user exactly: `二维码登录的自动化测试和 Web/Desktop 真实界面验证已通过。请将已登录元AI的手机通过 USB 连接电脑，启用开发者选项和 USB 调试（Android）或信任此电脑（iOS），然后回复“已连接”。`

Do not start an Expo client, scan, approve, or claim real-device success before the user replies.

- [ ] **Step 4: After user confirmation, perform the real-device QR flow.**

1. Find the computer LAN IPv4 address and set the target Web/Desktop API URL to `http://<computer-lan-ip>:8000/api/v1` only for the local test.
2. Start the existing `pnpm dev:mobile` script, verify USB device recognition, and launch the development client.
3. Sign in using the existing local test account already recorded in `.codex/progress/feature-voice-qr-files-media.md`; never print the password in terminal, app logs, commit, or final response.
4. From the side-bar control beside Settings, open `扫码登录`, accept camera permission, scan the Web target QR, verify the review data, press `确认登录`, and verify target navigation to `/chat` with the same account.
5. Repeat with `拒绝登录`; target must show denial and receive no tokens. Record commands, device model/OS only if user has made them visible, screenshots/log paths, and test outcome in the ignored progress file.

- [ ] **Step 5: Commit the completed feature.**

```bash
git status --short
git add backend apps packages pnpm-lock.yaml
git restore --staged .codex
git diff --cached --check
git commit -m "feat(backend,core,web,mobile,desktop): add qr login approval flow"
git status --short --branch
```

Expected: only QR feature files and dependency lock changes are committed; `.codex/`, `backend/.env`, test credentials, generated artifacts and `docs/` are absent. Do not push or merge.

## Plan Self-Review

- **Coverage:** backend schema/storage/state machine/audit/rate-limit/one-time exchange map to Tasks 1-2; shared contracts map to Task 3; Web and desktop targets map to Task 4; explicit Mobile scanning/permission/review maps to Task 5; real Web/Electron UI plus USB device gateway maps to Task 6.
- **Security:** target-only polling secret is separate from QR; database hash-only persistence and exchange-code one-time use are specified and tested; approval requires `CurrentUser` and is owner-protected after first approval.
- **Testability:** every task starts with a failing focused test, calls exact commands, and ends with an observable pass condition. The only manual requirement is deliberately isolated at the USB checkpoint.
- **Scope:** no unrelated Phase 5+ work, docs edits, TODO deletion, media/search/title/background-stream tasks, or desktop release work is included.
