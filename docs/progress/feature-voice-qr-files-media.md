# Feature Progress: voice-qr-files-media

Branch: `feature/voice-qr-files-media`
Base: `dev` at `9c9c14c`

## Status

- [x] Provider/model metadata (validated ruff/core/types; backend pytest awaits local PostgreSQL)
- [x] File context and previews (all three clients implemented; Web real API and preview UI verified)
- [x] Voice input fallback
- [x] QR login approval

### 2026-08-15 QR Login Approval

- Plan: `.codex/plans/2026-08-15-qr-login-approval.md`.
- Task 1 RED: `test_create_challenge_persists_only_secret_hashes` failed as expected because
  `app.models.qr_login` did not yet exist. The first run initially revealed PostgreSQL was stopped;
  `pnpm dev:real` restored the prescribed real development stack before the valid RED run.
- Task 1 initial GREEN: the same test now passes against the test PostgreSQL database. The initial
  implementation adds hashed challenge/poll credentials, target metadata, expiry, a PNG data-URI
  QR renderer, and a durable `created` audit event. Approval/exchange lifecycle remains pending.
- Mobile entry decision (2026-08-15): the QR scanner is exposed as an icon-only action in the
  conversation side bar, immediately beside the existing Settings icon, rather than as a Settings
  subpage. It retains the protected review and explicit approve/deny flow.
- Desktop real-UI correction (2026-08-15): the Codex host injected `ELECTRON_RENDERER_URL` and
  occupied port 5175, causing Electron to display a blank 404 surface. `pnpm dev:desktop` now
  invokes `scripts/dev-desktop.mjs`, which removes that inherited value and enables polling on
  Linux when inotify watchers are exhausted. A real Electron login window loaded from its own
  Vite server on port 5173.
- QR visual correction (2026-08-15): Web refresh and password-login actions are vertically
  separated inside `qr-actions`; the real Web page displays the QR, countdown and centered
  password-login action without crowding. Desktop login height is 680 CSS pixels (650x850 at the
  active display scale), with the full login form and QR entry visible and no vertical scrollbar.
- Verification: Web unit 162/162, typecheck and lint; Desktop unit 195/195, typecheck and lint.
  Real Web and Electron screenshots captured after the layout correction.
- Real-device verification: a USB-connected Android device scanned the Web QR flow successfully.
  The initial mobile post-approval state remained stuck even after the backend had consumed the
  challenge; the scanner now reconciles its local request after 750 ms and returns to chat when
  the server reports `approved` or `consumed`. Reopening the sidebar scan action creates a fresh
  route session, so a prior approval, denial, or expiry cannot be reused.
- Final verification: Mobile unit 33/33, typecheck and lint; Core unit 92/92 and typecheck; Web
  unit 163/163 and typecheck; Desktop unit 196/196; backend QR unit/integration tests 9/9 and
  targeted Ruff. Full backend mypy retains 8 unrelated errors in existing email/share/upload
  modules.
- [x] Conversation title generation
- [x] Background conversation streams
- [x] Persistent image/video generation
  - Agnes Image 2.1 Flash and Agnes Video V2.0 run as durable, recoverable task records. Chat, Image and Video composer modes expose only compatible controls; all three clients render task state and result media.
  - Generated images and videos now open in the Web Artifact panel, Electron Artifact window, or Mobile native preview. Desktop image preview supports wheel zoom and drag panning; the video preview has theme-aware controls and direct surface play/pause.
  - Validation: backend media unit 38/38 and integration 5/5; Web unit 169/169; Desktop unit 202/202 and typecheck. Real Web generation and preview were clicked through; user completed Desktop preview validation.
  - Commit: `e70c576 feat(backend,core,web,mobile,desktop): add persistent media generation`.
- [x] Configurable web search
- [x] Remove `TODO.md`

### 2026-08-16 Configurable Web Search

- Search providers are configurable as `auto | searxng | brave | tavily | disabled`.
  `auto` prefers local key-free SearXNG; Brave and Tavily remain explicit API-key options.
  Proxy use is opt-in through `SEARXNG_PROXY_URL`; no source file, example, or default assumes
  a particular local proxy port.
- Search tool calls and sanitized HTTPS sources are rendered inside the assistant thinking block
  on Web, Mobile, and Desktop. The thinking toggle is independent: search can be enabled alone;
  collapsed thinking hides source details, and expanding it reveals source title, snippet and link.
- Added provider/cache/rate-limit tests, SSE source validation tests, and cross-platform renderer
  regression coverage. Backend targeted search tests pass (37), Core useStream search test passes,
  Desktop unit tests pass (204), Mobile unit tests pass (34), and Web search/Thinking tests pass
  (170). All four workspace typechecks pass.
- Real Docker validation: pinned SearXNG starts on `127.0.0.1:8082` and health returns 200. A
  live query returned zero results because the default upstream engines timed out in this network;
  this is recorded as an external connectivity limitation, not represented as a successful search.
- Docs updated with no-key setup, Brave/Tavily key acquisition, optional proxy behavior, and a
  Mermaid provider flow. Remaining before commit: final lint/static audit, real Web click path
  after an authenticated session is available, Desktop launch for user inspection, then one
  search feature commit followed by the separate TODO cleanup commit.

### 2026-08-16 Search Finalization

- Desktop `react-virtuoso` rows now preserve both the outer thinking block and nested
  `search_web` `<details>` state. Expansion is held by message and tool-call IDs outside the
  virtualized row, so scrolling away and back no longer collapses an already opened source list.
- Validation: root TypeScript typecheck; root unit tests (Core 97, Web 171, Desktop 206, Mobile
  34); backend search tests; `ruff check app`; and full `mypy app/` all passed. Full Prettier
  check still reports pre-existing unformatted ignored plans and unrelated source files, while the
  commit hook formatted every staged file successfully.
- Local commit `dc56bbd` — `feat(backend,core,web,mobile,desktop): add configurable web search`.
  It also documents provider setup, runtime behavior, API/SSE contracts, source display, desktop
  release gates, and a Corepack-first pnpm hook fallback for runtimes that lack `corepack`.
- Local commit `130307f` — `chore(config): remove completed TODO list`. The remaining external
  Windows/macOS/Linux release gates are retained in `apps/desktop/README.md`; nothing was pushed
  or merged into `dev`.

### 2026-08-15 Remaining Feature Planning

- User authorized updates under `docs/` and requested planning only; no media/search implementation,
  feature test, feature commit, push, or merge was performed in this planning pass.
- Durable incident records were supplemented in `docs/troubleshooting.md` for package-manager
  version drift, Mobile attachment previews, conversation model/thinking/version state, Agnes
  thinking configuration, and the migration failure that Firefox presented as a CORS error.
- Media execution plan: `docs/superpowers/plans/2026-08-15-persistent-media-generation.md`.
  It specifies durable assistant task cards, Agnes image/video provider normalization, result
  persistence in YuanAI object storage, Web Artifact panel, Desktop Artifact window, Mobile native
  preview, tests, real UI verification, and one feature commit.
- Search execution plan: `docs/superpowers/plans/2026-08-15-configurable-web-search.md`.
  It chooses key-free self-hosted SearXNG as the first healthy `auto` provider, retains explicit
  Brave/Tavily options, pins the SearXNG image and digest, documents credential acquisition without
  recording credentials, and reserves the root TODO deletion for a separate final chore commit.
- Provider-dashboard screenshots require the user's logged-in Brave or Tavily session; pause and
  request login only when that execution step is reached. Public-documentation visuals and the
  SearXNG setup diagram do not require account access.

## Commit Log

Each completed item is tested and committed locally before the next item starts.

## 2026-08-17 Tooling, Performance and Conversation UX Follow-up

User request: pin project runtime/tool versions, add an OS-aware interactive desktop packaging
entry point, remove Mobile chat scrolling jank, stop Web history rows from changing width on
hover, and make Mobile/Desktop defer creating a conversation until the first user message.
The user also requested an independent audit for related defects.

- [x] Runtime/toolchain pinning: exact Node.js, pnpm and Turborepo versions; startup validation;
      setup and developer documentation.
- [x] Interactive desktop packager: a cross-platform Node script that only presents package targets
      supported by the current operating system and invokes existing package scripts.
- [x] Mobile scrolling performance: remove periodic native-layout polling, coalesce follow-to-bottom
      work, reduce scroll-state churn, and virtualize the conversation history list.
- [x] Cross-platform empty-conversation UX: defer Mobile/Desktop persistence until first send and
      preserve selected-model draft state; make Web history action controls layout-stable on hover.

Audit evidence before edits:

- `MessageList` polls FlashList/RecyclerListView geometry every 250ms while mounted, even when no
  message is streaming. This is a continuous JS/native bridge and layout cost on long chats.
- `ConversationList` renders every history row in a `ScrollView`; it is not virtualized and grows
  linearly with conversation count.
- Mobile and Desktop sidebar "new conversation" actions directly call the create-conversation API,
  unlike the Web composer which creates lazily upon its first non-temporary send.
- Web reveals the overflow action with `display: none` -> `display: flex`; keeping the action in the
  row layout with visibility/opacity avoids hover-induced intrinsic-size and text reflow.

Completion evidence (2026-08-17):

- `3172794 perf(mobile): optimize chat scrolling and conversation lists` completed the Mobile
  Markdown scroll fix, requestAnimationFrame follow-to-bottom behavior, virtualized history list,
  and deferred draft conversation persistence. USB real-device verification was completed before
  the user disconnected the device; no further Mobile device action is pending.
- `e1a0726 fix(web,desktop): defer conversation creation and stabilize sidebar` completed the
  Desktop draft conversation behavior and Web hover width stabilization. Desktop real UI was
  launched through `pnpm dev:desktop` and user verification reported no issues.
- Validation after the final changes: Desktop typecheck/lint and 38 files with 206 unit tests;
  Web typecheck/lint and 19 files with 171 unit tests. All passed with Node 22.21.1 and pnpm
  10.22.0.

Validation plan:

- Each independent task receives focused unit/type/lint checks and one local Conventional Commit.
- Web and Desktop receive real application interaction checks after their fixes.
- Before claiming Mobile scrolling performance complete, ask the user to connect USB, then use the
  `pnpm dev:mobile` project script for a real-device long-chat scroll check.

## 2026-08-17 Android Release Packaging Validation

- Added `pnpm package:mobile:android`, which runs Expo prebuild and local Gradle `assembleRelease`
  only through package scripts. The initial script unit test exposed a Node ESM type annotation and
  unintended Gradle side effect on import; both are fixed, with direct-run guarding and a pure
  signing-argument test.
- Initial APK verification exposed that Expo's generated release variant still used the Android
  debug certificate. The package script now reads only the private
  `~/.yuanai-secrets/yuanai-android-release.json` material created by `pnpm signing:android` and
  passes it to Gradle's injected signing parameters. No key, password, base64 data or private path
  is committed or logged.
- Real local build: `JAVA_HOME=/usr/local/java/bellsoft-jdk17.0.11` with the installed Android SDK
  and `pnpm@10.22.0 package:mobile:android` completed successfully. It produced
  `apps/mobile/android/app/build/outputs/apk/release/app-release.apk` (131,178,133 bytes).
- Artifact checks passed: APK Signature Scheme v2, one 4096-bit `CN=YuanAI` self-signed signer,
  zipalign verification, package `com.yuanai.app`, version `0.1.0` / code `1`, min SDK 24 and
  target SDK 34. Script tests passed 16/16.
- `adb devices -l` found no USB device after packaging, so true-device install/launch remains the
  next verification step once a device is connected. The APK itself is ignored and no release,
  push, merge, tag or publish has occurred.

- `08baeec` `fix(backend,core,web,desktop,mobile): align chat model catalog and search shortcuts`
- `7945fe9` `fix(web,backend): keep auth feedback unobtrusive`
- `a034e49` `feat(backend,core,web,mobile,desktop): support file context and previews`
- `389b736` `feat(backend,core,web,mobile,desktop): add QR login approval flow`
- `5c0c163` `docs(config): record cross-platform troubleshooting`
- `bbb02ee` `feat(core,web,mobile,desktop): keep conversation streams running`
- `e70c576` `feat(backend,core,web,mobile,desktop): add persistent media generation`

## 2026-08-15 Conversation Titles and Background Streams

- User explicitly authorized maintenance of `docs/`; the durable incident record is
  `docs/troubleshooting.md`, and the implementation plan is
  `docs/superpowers/plans/2026-08-15-conversation-titles-background-streams.md`.
- Execution order: complete and commit persisted Agnes-backed conversation titles first; then
  complete and commit the per-conversation background stream registry. Neither commit may include
  the already-pending Mobile attachment-preview or development-startup work.

### Conversation title generation validation in progress

- Implemented pending commit: migration `b3e7d9a4c1f2`, title source metadata, immediate
  48-character fallback, atomic Agnes replacement, `conversation_title` SSE cache updates and
  cross-platform sidebar indicators. Manual renames change the source to `manual`, so an
  in-flight background title request cannot overwrite the user.
- Agnes verification found that its reasoning tokens consumed the original 32-token title budget.
  Official API guidance requires a larger budget on `finish_reason=length`; title calls now use a
  concise user-level instruction, a 128-token first attempt, and one 256-token retry. A real
  Agnes request returned a non-empty title without exposing credentials.
- Checks passed after this correction: backend 55 targeted unit/integration tests, targeted Ruff
  and mypy; Core typecheck + 93 unit tests; Web typecheck + 163 unit tests; Desktop typecheck +
  196 unit tests; Mobile typecheck + 33 unit tests.
- Remaining before the title commit: real signed-in browser verification of fallback-to-AI update
  and manual-rename protection. Browser password entry requires the user's immediate approval.

### Conversation title generation complete pending commit

- Real Web verification used the local test account through `pnpm dev:real`: a new first question
  first showed its normalized fallback title plus the pending indicator, then became Agnes'
  `async SQLAlchemy 事务边界` without a page error. Existing conversations no longer show a false
  pending state after migration `b4f8c2d6e0a3` backfilled populated legacy rows.
- The second real test conversation accepted `手动标题不应被覆盖`; it remained visible after the
  model response settled. The stronger in-flight race remains covered by the backend atomic
  `WHERE title_source = 'fallback'` integration test.
- Deleted both exact test conversations after verification; no test chat data remains in the local
  account. Ready to stage only title files and commit
  `feat(backend,core,web,mobile,desktop): generate conversation titles`.

### Conversation title generation committed

- Local commit `29d9e9c` — `feat(backend,core,web,mobile,desktop): generate conversation titles`.
- Commit contains only title metadata migrations, Agnes title generation and fallback, SSE cache
  updates, cross-platform sidebar state, and regression tests. No push or `dev` merge occurred.
- Next independent task: per-conversation background stream registry.

### Background conversation streams committed

- Local commit `bbb02ee` — `feat(core,web,mobile,desktop): keep conversation streams running`.
- Per-conversation stream registry retains independent SSE handles, incremental content, thinking,
  tool calls and optimistic messages while the user switches sessions. Web, Desktop and Mobile
  sidebars show a running indicator and can stop the exact background session.
- Verification: Core 90 unit tests, Web 163 unit tests, Desktop 197 unit tests, Mobile 33 unit
  tests, and all four workspace typechecks. Real Web verification started an Agnes stream,
  switched to another persisted conversation, confirmed the sidebar state and returned while the
  first stream was still active; it later completed normally with its generated title and thought
  block visible.
- Pending coherent follow-up: persist a selected model per conversation, show historical thought
  blocks independently of the current composer setting, use an explicit regeneration origin for
  answer versions, and send Agnes its documented thinking toggle.

### 2026-08-15 Conversation state follow-up

- Implemented as one coherent pending fix: changing a model now persists it to the active
  conversation and restores it when revisiting; stored thought blocks always render regardless of
  the current composer switch; only `regeneratedFromMessageId` creates answer versions, so equal
  user text remains separate rounds; Agnes chat requests pass the documented
  `chat_template_kwargs.enable_thinking` value for the current turn.
- Validation passed: backend unit 63/63, targeted chat integration, Ruff and mypy; Core 92 unit
  tests and typecheck; Web 165 unit tests, typecheck and lint; Mobile 33 unit tests, typecheck
  and lint; Desktop 197 unit tests, typecheck and lint; root `pnpm typecheck` and
  `pnpm test:unit`.
- Real verification: a temporary local API conversation persisted `agnes-2.5-flash` through
  create, PATCH and list/reload, then was deleted. The local database initially remained at
  migration `b4f8c2d6e0a3`, so the live message endpoint returned 500 without CORS headers and
  Firefox reported it as a cross-origin failure. Applied the additive migration
  `b5c9d4e7f2a1`; the original conversation now returns its message list through the real API.
- Local commit `409cc19` — `fix(core,backend,web,mobile,desktop): preserve conversation state`.
  No push or merge was performed.

### 2026-08-15 Remaining working-tree commits

- Local commit `6bae652` — `fix(mobile): improve attachment previews`: root-level image gallery,
  authenticated image download source, extension-aware type handling and Lucide file icons.
  Mobile typecheck, lint and 33 unit tests passed; user also completed real-device UI validation.
- Local commit `97422c9` — `fix(config): stabilize development startup`: exposes the protected
  desktop launcher through `pnpm dev:desktop`, clears host-injected renderer state and enables
  Linux polling when needed. `node --check`, shell syntax validation and a real Electron startup
  through the package script passed before the process was stopped normally.
- Working tree is clean. The branch is 13 commits ahead of `dev`; no push or merge was performed.

## 2026-08-13

- Provider registry now includes Agnes chat/image/video model IDs and environment-only key loading.
- DeepSeek V4 metadata reflects official 0731/0813 pricing and 1M context documentation.
- File previews support PNG/JPEG/WebP/GIF, PDF, TXT/MD, JSON/CSV, DOCX/XLSX. Unsupported
  formats remain uploadable and downloadable. Backend parser/integration checks passed (27),
  Web unit checks passed (148), Desktop unit checks passed (178), and all modified workspaces
  typecheck successfully. Desktop image/PDF previews use a validated, separate Artifact window.
- Corrected the chat model catalog: GPT-4o and Claude 3.5 Sonnet are legacy routing-only models;
  normal selectors now expose DeepSeek V4 Flash-0731, DeepSeek V4 Pro-0813 and Agnes 2.5 Flash.
  Agnes Image 2.1 Flash and Agnes Video V2.0 remain hidden from chat selectors for their future
  dedicated task flows. The Web and Desktop "联网搜索" empty-state shortcuts now explicitly enable
  the composer search switch. Verification passed: backend ruff/mypy/pytest (19), Core typecheck
  and unit tests (78), Web typecheck/lint/unit tests (148), Desktop typecheck/lint/unit tests (179),
  Mobile typecheck/lint/unit tests (7). Web UI was manually verified at localhost:3000; the
  Electron app was launched through its dev script and its rendered window confirmed the Agnes
  model catalog and online-search shortcut UI.
- Real Web verification now runs against `pnpm dev:real`. Browser CORS for
  `http://127.0.0.1:3000` is explicitly allowed alongside `localhost` so the in-app browser can
  access the local API. Registration request feedback is a top-right global Toast; its real-page
  position and four-second auto-dismiss were verified.

## 2026-08-14

- File feature complete: attachments appear with the optimistic user message before an AI reply;
  the backend extracts supported document context; Web uses compact cards plus a right Artifact
  panel, Desktop opens a separate Artifact window, and Mobile uses native/system previews.
- Real Web verification covered a text-only DeepSeek model rejecting image recognition with a
  top-right Toast, without creating a stream; wide/tall image cards, text preview, normal
  attachment navigation, image-only lightbox navigation, and wheel zoom from 100% to 125%.
  The lightbox now supports 25% to 400% zoom and skips non-image files when moving between images.
- Source download uses the authenticated backend attachment response and a delayed Blob URL revoke
  for Firefox compatibility. The in-app browser retained the current chat URL after activation;
  its automation layer did not emit a download event for the asynchronous Blob link.
- Verification: Core typecheck + 80 unit tests; Web typecheck/lint + 152 unit tests; Desktop
  typecheck/lint + 179 unit tests; Mobile typecheck/lint + 7 unit tests; touched backend mypy,
  Ruff, 41 unit tests, and integration tests. Global backend Ruff and mypy still have pre-existing
  migration/email/share failures outside this feature.
- Local real-API account (preserve; `.codex` is ignored): `yuanyuanblog@163.com`
  (`yuanyuanblog`), password `Test1234!`.

## 2026-08-14 Voice input fallback

- Three clients append recognition text to the draft only; they never auto-send. Web and Desktop
  prefer the browser recognition API, while Mobile prefers the Expo native recognition module.
  All three record an audio fallback when their preferred recognizer is unavailable or fails.
- `packages/core` now sends audio with multipart FormData. The API client no longer applies a
  global JSON content type, which previously removed the multipart boundary and caused FastAPI
  to return 422 for a valid Web recording.
- Browser-created WebM may omit the container `duration`; backend duration validation now falls
  back to ffprobe audio-packet timestamps before rejecting a recording. Unit and integration tests
  cover both duration paths.
- The backend fallback uses AssemblyAI Pre-recorded STT: upload, create transcript task, then poll
  `queued` / `processing` until `completed` or `error`. `ASSEMBLYAI_API_KEY` is present only in
  ignored `backend/.env`; `.env.example` has an empty placeholder. A real authenticated WAV upload
  returned HTTP 200 and the expected AssemblyAI transcript. No token, API key, upload URL, or task
  ID was logged.
- Electron media permission now uses an application-owned, accessible allow/reject dialog through
  a guarded, one-time IPC request. It has focus recovery, Tab trapping, Escape-to-deny, 30-second
  timeout, trusted-sender validation, and no `showMessageBox` permission path. Electron was
  launched via its `dev` package script and its real chat window rendered successfully; renderer,
  IPC, security, and preload dialog behavior are covered by 193 Desktop unit tests.
- Verification: Core typecheck + 84 unit tests; Web typecheck/lint + 159 unit tests; Mobile
  typecheck/lint + 15 unit tests; Desktop typecheck/lint + 193 unit tests; backend Ruff, mypy,
  and 33 focused unit/integration tests. Real API: authenticated `POST /voice/transcriptions`
  with a generated WAV returned HTTP 200 and a non-empty AssemblyAI transcript.
- Local commit: `c1ee7ab` `feat(core,backend,web,mobile,desktop): add voice input fallback`.
