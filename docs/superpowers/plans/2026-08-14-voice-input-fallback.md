# Voice Input Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver microphone-to-composer input on Web, Mobile, and Desktop, using on-device/browser speech recognition first and a protected backend Whisper transcription fallback without automatically sending the resulting text.

**Architecture:** The FastAPI voice router validates a short audio upload, extracts its duration with `ffprobe`, and delegates the only provider call to `ai_service.transcribe_audio()`. `@yuanai/core` exposes the browser/Electron multipart API and shared response/error types; each app owns its microphone and recording lifecycle so `packages/` remains free of browser, Electron, and React Native APIs. Browser/Electron record the same user turn alongside Web Speech where possible, then submit the recording only when local recognition is unavailable or fails; Mobile records a persisted native-recognition track when available and otherwise starts a native recorder for the Whisper fallback.

**Tech Stack:** FastAPI, Pydantic v2, async SQLAlchemy dependency injection, OpenAI Python SDK `whisper-1`, `ffprobe`, Axios, React 19, Web Speech API, `MediaRecorder`, Electron Chromium renderer, Expo SDK 52, `expo-speech-recognition@sdk-52` (`1.1.1`), `expo-av@~15.0.2`, Vitest, pytest, Playwright/in-app browser.

---

## Execution State (2026-08-14, resumed)

- [x] **Task 1 - backend contract:** Router, bounded validation, `ffprobe` duration check,
      Whisper provider boundary, unit tests, integration tests, Ruff, and focused mypy have passed.
- [x] **Task 2 - shared contract:** `VoiceTranscriptionResponse`, `VoiceInputStatus`, and the
      multipart Axios client have passed Core type checking and 82 Core unit tests. Removing the
      global JSON content type was required so multipart boundaries remain valid.
- [x] **Task 3a - Web:** Browser recognition plus recording fallback is wired into the composer.
      It covers native result, recoverable-network fallback, permission denial, empty recording,
      cancellation, and unrecoverable recognition failures without auto-send. Web focused tests,
      type checking, and lint passed before this continuation.
- [x] **Task 3b - Desktop:** The renderer-local Chromium hook replaces the disabled mic affordance
      without importing Electron or Web-app source. Its state machine and composer integration tests,
      type checking, and lint passed before this continuation.
- [x] **Task 4 - Mobile:** SDK-52 native dependencies and config plugin are present. The native
      URI upload helper, recognizer/recorder hook, and stateful `ChatInput` control passed type checking,
      lint, and 15 unit tests. iOS must still be physically verified because a persisted native audio
      file can be CAF despite its requested WAV filename.
- [ ] **Task 5 - verification and one commit:** First mechanically reduce `pnpm-lock.yaml` to the
      exact mobile dependency closure. Then run all touched-scope checks, test the real Web and Electron
      interfaces, attempt the real-device Expo flow with the LAN API configuration, update the ignored
      progress record, and create exactly `feat(core,backend,web,mobile,desktop): add voice input fallback`.
      Do not push, merge, or begin QR approval after that commit.

### Task 5a: Desktop microphone permission and non-blocking feedback

**Root-cause evidence:** `apps/desktop/src/main/security/permissions.ts` currently allows only
trusted `media: video` requests and expressly rejects `media: audio`. The renderer then forwards
the resulting `getUserMedia` rejection to `actionError`, which is rendered inside the chat layout.

**Files:**

- Modify: `apps/desktop/src/main/security/permissions.ts`
- Create: `apps/desktop/src/main/security/permission-dialog.ts`
- Modify: `apps/desktop/src/main/security/index.ts`
- Modify: `apps/desktop/src/main/security/security.test.ts`
- Modify: `apps/desktop/src/renderer/main/App.tsx`
- Modify: `apps/desktop/src/renderer/main/App.test.tsx`
- Modify: `apps/desktop/src/renderer/main/chat.css`

- [ ] Add a failing security test proving that only a trusted single audio/video request may reach
      a consent prompt; all other permission types and untrusted renderers remain denied.
- [ ] Implement a session-scoped Electron native `dialog.showMessageBox` confirmation for eligible
      microphone/camera requests. Cache a successful decision by renderer and media kind for the
      current app session; never auto-grant an ineligible request.
- [ ] Add a failing renderer test proving a voice error appears in a top-right toast and not in the
      layout-level `.desktop-chat__alert`; include automatic four-second dismissal.
- [ ] Route `useVoiceInput` errors to that toast, retain message-send errors in `actionError`, and
      add CSS with fixed positioning, a close control, `role=alert`, and no layout impact.
- [ ] Run desktop unit/type/lint checks and repeat Electron's real microphone interaction, retaining
      the result and screenshot path in the ignored progress record before the single voice-feature commit.

### Resumption Checklist

- [ ] Compare `/tmp/yuanai-voice-lock-base.yaml` and `/tmp/yuanai-voice-lock-generated.yaml`.
      Retain only the Mobile importer updates and the transitive closure for `expo-av@15.0.2`,
      `expo-speech-recognition@1.1.1`, `react-test-renderer@18.3.1`,
      `@types/react-test-renderer@18.3.1`, `react-shallow-renderer@16.15.0`, and
      `scheduler@0.23.2`; replace the Mobile test renderer peer snapshot. Reject all unrelated
      root/importer, Turbo, ESLint, and formatting drift. `corepack pnpm install --frozen-lockfile`
      must pass after the edit.
- [ ] Run the exact automated commands in Task 5 Step 1. A failing unrelated global backend check
      is not a pass; only the focused voice file list may be used to classify pre-existing failures.
- [ ] Run actual UIs through Task 5 Steps 2-4. Web and Electron need successful draft-only native
      or fallback behavior. Android needs a rebuilt development client because the config plugin changes
      native configuration; capture the factual outcome if a connected device or provider key is absent.
- [ ] Update `.codex/progress/feature-voice-qr-files-media.md` with commands, screenshots/log paths,
      limits, and the commit hash. Keep `.codex/` ignored, run the final diff/staging review, and make
      one Conventional Commit only.

## Global Constraints

- Work only on `feature/voice-qr-files-media`; do not push, merge, or alter `dev`.
- The user-approved flow is local recognition first, then backend Whisper fallback. A result is appended to the composer and is **never** sent automatically.
- A microphone permission denial cannot produce audio; show a persistent actionable failure instead of claiming Whisper fallback ran.
- Accept only `audio/webm`, `audio/ogg`, `audio/wav`, `audio/mpeg`, `audio/mp4`, `audio/x-m4a`, and `audio/aac`; reject files exceeding `VOICE_MAX_UPLOAD_BYTES` (25 MiB) or `VOICE_MAX_DURATION_SECONDS` (300 s).
- All AI-provider calls stay inside `backend/app/services/ai_service.py`; routes only validate input, call a service, and serialize a response.
- API keys come exclusively from ignored `.env` variables. Never print, test, document, or commit any key.
- Every exported TypeScript item has Chinese JSDoc. Python public functions have strict type annotations. No `any`, bare `except`, or platform-specific imports in `packages/`.
- All application start/build commands use existing `package.json` scripts. `.codex/` is local-only and must not be staged.
- One commit covers the complete, tested voice feature: `feat(core,backend,web,mobile,desktop): add voice input fallback`. Do not create component-level commits.
- No `docs/` changes. Update `.codex/progress/feature-voice-qr-files-media.md` with real command output, visual-test evidence, and the final hash after the commit.

---

## File Structure

| Path                                                   | Responsibility                                                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `backend/app/core/config.py`                           | Bounded voice upload, duration, `ffprobe`, and provider timeout settings.                                                         |
| `backend/app/services/voice_service.py`                | MIME/size/duration validation and stable domain errors; it calls `ai_service.transcribe_audio`.                                   |
| `backend/app/services/ai_service.py`                   | OpenAI Whisper request, missing-key handling, provider timeout/error conversion.                                                  |
| `backend/app/api/v1/voice.py`                          | Thin authenticated `POST /voice/transcriptions` endpoint and camelCase response model.                                            |
| `backend/app/main.py`                                  | Registers the voice router under `/api/v1`.                                                                                       |
| `backend/tests/unit/test_voice_service.py`             | Unit coverage for type, byte, duration, timeout, and provider-error paths.                                                        |
| `backend/tests/unit/test_ai_service.py`                | Mocks the OpenAI SDK audio endpoint and verifies `whisper-1`/timeout/missing-key behavior.                                        |
| `backend/tests/integration/test_voice.py`              | Authenticated multipart endpoint contract and user-safe response tests.                                                           |
| `packages/types/src/index.ts`                          | Shared `VoiceTranscriptionResponse` and `VoiceInputStatus` API/UI contract.                                                       |
| `packages/core/src/api/voice.ts`                       | Browser/Electron multipart transcription client using the existing authenticated Axios client.                                    |
| `packages/core/src/api/index.ts`                       | Re-exports the voice client.                                                                                                      |
| `packages/core/src/api/__tests__/voice.test.ts`        | MSW-backed multipart request and error propagation coverage.                                                                      |
| `apps/web/src/hooks/useSpeechRecognition.ts`           | Adds structured failure reasons so caller code can decide whether to use audio fallback.                                          |
| `apps/web/src/hooks/useVoiceInput.ts`                  | Owns Web Speech + `getUserMedia`/`MediaRecorder` lifecycle and calls Core only after fallback.                                    |
| `apps/web/src/hooks/useVoiceInput.test.ts`             | Covers browser result, unsupported fallback, network fallback, cancel, empty recording, and upload failure.                       |
| `apps/web/src/components/ChatInterface.tsx`            | Replaces direct speech use with the unified voice hook and accessible stateful mic control.                                       |
| `apps/desktop/src/renderer/main/useVoiceInput.ts`      | Electron renderer counterpart using Chromium APIs and Core API.                                                                   |
| `apps/desktop/src/renderer/main/useVoiceInput.test.ts` | Covers the desktop renderer recording/recognition state machine.                                                                  |
| `apps/desktop/src/renderer/main/App.tsx`               | Replaces the disabled voice button with the working stateful control and appends transcript to composer.                          |
| `apps/desktop/src/renderer/main/App.test.tsx`          | Replaces the disabled-placeholder assertion with user-visible voice state/result assertions.                                      |
| `apps/mobile/app.json`                                 | Registers the Expo speech-recognition config plugin and keeps existing microphone/speech permission copy.                         |
| `apps/mobile/package.json` / `pnpm-lock.yaml`          | Pins Expo SDK 52-compatible speech recognition and recording packages.                                                            |
| `apps/mobile/src/lib/mobileVoiceTranscription.ts`      | Sends a native `{ uri, name, type }` `FormData` audio part to the protected voice endpoint.                                       |
| `apps/mobile/src/hooks/useVoiceInput.ts`               | Owns native recognition events, persisted audio, recorder fallback, permission state, cleanup, and transcript insertion callback. |
| `apps/mobile/src/hooks/useVoiceInput.test.ts`          | Mocks recognition/recorder/network modules and covers result, fallback, denial, cancel, empty recording, and timeout.             |
| `apps/mobile/src/components/chat/ChatInput.tsx`        | Replaces the placeholder mic with the cross-state control and inserts text without invoking `onSend`.                             |

## Contracts

```python
# backend/app/services/ai_service.py
async def transcribe_audio(
    *, filename: str, content: bytes, mime_type: str
) -> str: ...

# backend/app/services/voice_service.py
async def transcribe_upload(
    *, filename: str, content: bytes, mime_type: str
) -> VoiceTranscription: ...
```

```typescript
/** 后端成功转写的统一响应。 */
export interface VoiceTranscriptionResponse {
  text: string
  language: string | null
  durationSeconds: number
}

/** 语音输入 UI 的互斥状态。 */
export type VoiceInputStatus = 'idle' | 'listening' | 'recording' | 'transcribing' | 'error'

/** 浏览器和 Electron 发送录音的共享 API。 */
export function transcribeAudio(
  file: File,
  options?: { signal?: AbortSignal }
): Promise<VoiceTranscriptionResponse>
```

`POST /api/v1/voice/transcriptions` accepts authenticated `multipart/form-data` containing a required `file` part and returns:

```json
{ "text": "识别出的文本", "language": "zh", "durationSeconds": 2.4 }
```

It returns stable structured errors with `detail.code`: `VOICE_TRANSCRIPTION_UNAVAILABLE` (503), `VOICE_UNSUPPORTED_MEDIA_TYPE` (415), `VOICE_FILE_TOO_LARGE` (413), `VOICE_AUDIO_TOO_LONG` (413), `VOICE_DURATION_UNREADABLE` (422), `VOICE_TRANSCRIPTION_TIMEOUT` (504), and `VOICE_TRANSCRIPTION_FAILED` (502).

### Task 1: Build the bounded backend Whisper contract

**Files:**

- Create: `backend/app/api/v1/voice.py`
- Create: `backend/app/services/voice_service.py`
- Create: `backend/tests/unit/test_voice_service.py`
- Create: `backend/tests/integration/test_voice.py`
- Modify: `backend/app/core/config.py`
- Modify: `backend/app/services/ai_service.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/unit/test_ai_service.py`

**Consumes:** Existing `CurrentUser`, `DB`, `AsyncOpenAI`, `settings.openai_api_key`, and FastAPI multipart upload handling.

**Produces:** A protected, schema-stable `POST /api/v1/voice/transcriptions` endpoint and `transcribe_audio`/`transcribe_upload` service interfaces for all three clients.

- [ ] **Step 1: Write failing backend unit and integration tests.**

```python
# backend/tests/unit/test_voice_service.py
@pytest.mark.asyncio
async def test_transcribe_upload_rejects_webm_longer_than_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(voice_service, "probe_duration_seconds", AsyncMock(return_value=301.0))
    with pytest.raises(voice_service.VoiceAudioTooLongError):
        await voice_service.transcribe_upload(
            filename="voice.webm", content=b"audio", mime_type="audio/webm"
        )

# backend/tests/integration/test_voice.py
@pytest.mark.asyncio
async def test_voice_transcription_requires_auth(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/voice/transcriptions",
        files={"file": ("voice.webm", b"audio", "audio/webm")},
    )
    assert response.status_code == 403
```

- [ ] **Step 2: Run the focused tests and confirm the route/service are absent.**

Run: `cd backend && uv run pytest tests/unit/test_voice_service.py tests/integration/test_voice.py -x -q`

Expected: collection/import failure naming the missing voice service or route.

- [ ] **Step 3: Add explicit configuration and typed service errors.**

Add these settings to `Settings`, adjacent to the existing AI provider block:

```python
voice_max_upload_bytes: int = 25 * 1024 * 1024
voice_max_duration_seconds: int = 300
voice_transcription_timeout_seconds: int = 60
voice_ffprobe_path: str = "ffprobe"
```

In `voice_service.py`, keep validation in the service. Use `asyncio.create_subprocess_exec(settings.voice_ffprobe_path, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", temp_path, stdout=PIPE, stderr=PIPE)` within `asyncio.timeout(5)`, parse one finite positive float, delete the `NamedTemporaryFile(delete=False)` in `finally`, and raise `VoiceDurationUnreadableError` for process, parse, or timeout failures. The route must never call subprocesses or provider SDKs.

- [ ] **Step 4: Implement the AI-provider boundary and thin route.**

Add `VoiceTranscriptionUnavailableError`, `VoiceTranscriptionTimeoutError`, and `VoiceTranscriptionProviderError` to `ai_service.py`. `transcribe_audio` must reject a missing OpenAI key before constructing a client, call `client.with_options(timeout=settings.voice_transcription_timeout_seconds).audio.transcriptions.create(model="whisper-1", file=(filename, content, mime_type))`, strip the returned text, and reject an empty result as `VoiceTranscriptionProviderError`. Map `APITimeoutError` only to the timeout error; map known OpenAI API failures to the provider error without returning provider content.

The route body must be no more than read file -> call `transcribe_upload` -> return `VoiceTranscriptionResponse`. Use `UploadFile`, `CurrentUser` only to require authentication, and an explicit exception-to-`HTTPException` mapper that emits the contract codes above. Include `voice.router` in `main.py` alongside the existing API routers.

- [ ] **Step 5: Extend backend tests through success and all public failures.**

Add tests asserting: `audio/webm` success returns trimmed text/language/duration; `text/plain` is 415; 25 MiB + 1 byte is 413 without probing; 300.01 seconds is 413; unreadable duration is 422; absent OpenAI key is 503; `APITimeoutError` is 504; and a provider exception becomes 502 with no original exception text. Mock the `ffprobe` helper and OpenAI client, not FastAPI route business logic.

- [ ] **Step 6: Run focused backend quality checks.**

Run: `cd backend && uv run ruff check app/api/v1/voice.py app/services/voice_service.py app/services/ai_service.py tests/unit/test_voice_service.py tests/unit/test_ai_service.py tests/integration/test_voice.py`

Run: `cd backend && uv run mypy app/api/v1/voice.py app/services/voice_service.py app/services/ai_service.py`

Run: `cd backend && uv run pytest tests/unit/test_voice_service.py tests/unit/test_ai_service.py tests/integration/test_voice.py -x -q`

Expected: all focused checks pass. Record any known global-only backend lint/type failures separately; do not misreport them as this feature's failures.

### Task 2: Publish the shared voice client contract

**Files:**

- Modify: `packages/types/src/index.ts`
- Create: `packages/core/src/api/voice.ts`
- Modify: `packages/core/src/api/index.ts`
- Create: `packages/core/src/api/__tests__/voice.test.ts`

**Consumes:** Task 1's endpoint response and the existing authenticated `apiClient`.

**Produces:** `VoiceTranscriptionResponse`, `VoiceInputStatus`, and `transcribeAudio(file, { signal })` for Web and Desktop.

- [ ] **Step 1: Write the failing API test.**

```typescript
it('posts a named audio file to the protected voice endpoint', async () => {
  server.use(
    http.post(`${API_BASE_URL}/voice/transcriptions`, async ({ request }) => {
      const body = await request.formData()
      expect(body.get('file')).toBeInstanceOf(File)
      return HttpResponse.json({ text: '测试语音', language: 'zh', durationSeconds: 1.2 })
    })
  )

  const file = new File(['audio'], 'voice.webm', { type: 'audio/webm' })
  await expect(transcribeAudio(file)).resolves.toEqual({
    text: '测试语音',
    language: 'zh',
    durationSeconds: 1.2,
  })
})
```

- [ ] **Step 2: Run the test and confirm the export does not exist.**

Run: `corepack pnpm --filter @yuanai/core test:unit -- src/api/__tests__/voice.test.ts`

Expected: FAIL with an import/export error for `transcribeAudio`.

- [ ] **Step 3: Add types and the minimal client.**

Define the two exported types exactly as declared in **Contracts**. `transcribeAudio` builds `FormData`, appends `file`, posts to `/voice/transcriptions` with `Content-Type` left unset so Axios supplies its multipart boundary, passes `signal`, validates that `data.text` is a non-empty string and `data.durationSeconds` is a number, then returns the typed response. Keep API error responses as Axios errors so the caller can show retryable UI correctly.

- [ ] **Step 4: Add error/abort coverage and run Core checks.**

Add tests for a 413 backend response and an aborted request. Run:

`corepack pnpm --filter @yuanai/core typecheck`

`corepack pnpm --filter @yuanai/core lint`

`corepack pnpm --filter @yuanai/core test:unit -- src/api/__tests__/voice.test.ts`

Expected: all pass.

### Task 3: Implement Web and Electron renderer recording fallback

**Files:**

- Modify: `apps/web/src/hooks/useSpeechRecognition.ts`
- Create: `apps/web/src/hooks/useVoiceInput.ts`
- Create: `apps/web/src/hooks/useVoiceInput.test.ts`
- Modify: `apps/web/src/components/ChatInterface.tsx`
- Create: `apps/desktop/src/renderer/main/useVoiceInput.ts`
- Create: `apps/desktop/src/renderer/main/useVoiceInput.test.ts`
- Modify: `apps/desktop/src/renderer/main/App.tsx`
- Modify: `apps/desktop/src/renderer/main/App.test.tsx`

**Consumes:** Task 2's `transcribeAudio`, `VoiceInputStatus`, and the existing browser speech hook.

**Produces:** Working visible mic controls in Web and Desktop. Both append only final transcript text, expose recording/transcribing/cancel/error states, and clean every stream/recorder/object URL on completion or unmount.

- [ ] **Step 1: Write failing Web and Desktop state-machine tests.**

```typescript
it('falls back to Whisper when Web Speech is unavailable and appends the result without sending', async () => {
  mockSpeechRecognitionUnavailable()
  mockMediaRecorderBlob(new Blob(['audio'], { type: 'audio/webm' }))
  vi.mocked(transcribeAudio).mockResolvedValue({
    text: '稍后发送',
    language: 'zh',
    durationSeconds: 1,
  })
  const onTranscript = vi.fn()
  const { result } = renderHook(() => useVoiceInput({ onTranscript }))

  await act(async () => result.current.start())
  await act(async () => result.current.stop())
  expect(onTranscript).toHaveBeenCalledWith('稍后发送')
  expect(result.current.status).toBe('idle')
})
```

In `App.test.tsx`, replace the old disabled placeholder expectation with a test that clicks `语音输入`, sees `停止语音输入`/`取消语音输入` according to status, simulates the hook callback, and confirms the composer contains text while `stream.send` was not called.

- [ ] **Step 2: Run the focused tests and verify they fail.**

Run: `corepack pnpm --filter @yuanai/web test:unit -- src/hooks/useVoiceInput.test.ts`

Run: `corepack pnpm --filter @yuanai/desktop test:unit -- src/renderer/main/useVoiceInput.test.ts src/renderer/main/App.test.tsx`

Expected: missing hook tests fail before production changes, and the old Desktop assertion proves the current button is disabled.

- [ ] **Step 3: Make `useSpeechRecognition` classify fallback-safe errors.**

Change its error callback to receive `{ code, message, canFallback }`. `canFallback` is `true` for `network`, `service-not-allowed`, `language-not-supported`, and unavailable constructors; it is `false` for `not-allowed`, `audio-capture`, `no-speech`, and explicit user abort. Preserve Chinese user messages and never start a second recognition session while one is active.

- [ ] **Step 4: Implement the browser renderer hook.**

`useVoiceInput({ onTranscript, lang? })` returns `{ status, error, isAvailable, start, stop, cancel }`.

1. On `start`, clear stale error, call `navigator.mediaDevices.getUserMedia({ audio: true })`, select a supported `MediaRecorder` MIME in order `audio/webm;codecs=opus`, `audio/webm`, `audio/ogg;codecs=opus`, `audio/ogg`, and begin collecting non-empty chunks.
2. Start Web Speech if available. If a final local transcript arrives, stop the recorder, discard the Blob, append the transcript, and return to `idle`.
3. If there is no recognizer, or it returns a `canFallback` error, stop the recorder, construct `new File([blob], 'voice.<extension>', { type: blob.type })`, set `status='transcribing'`, call Core, append the non-empty Whisper text, then return to `idle`.
4. `stop` ends local speech and the recorder; when only a recorder is active it transcribes. `cancel` aborts recognition, stops tracks, abandons the Blob, aborts an in-flight request, and does not append text.
5. If permission is denied, recording emits no data, or upload fails, retain the composer and set `status='error'` with a direct retry message.

Use the same implementation shape in `apps/desktop/src/renderer/main/useVoiceInput.ts`; it only relies on Chromium renderer APIs and Core, not Electron Node APIs. Do not place this hook in `packages/core`.

- [ ] **Step 5: Wire accessible UI states.**

Web's mic must remain visible for a logged-in user even when Web Speech is unsupported because Whisper recording remains usable. Update its title/`aria-label`/`aria-pressed` by state: `语音输入`, `停止语音输入`, `正在转写`, and `取消语音输入`; disable only during `transcribing`. Feed `onTranscript` through the current append-and-resize composer routine. Surface errors through the existing top-right toast.

Desktop replaces the disabled button with the same labels and state. It appends to the existing `input` state, never calls submit, and reuses the renderer's non-blocking notice/toast convention for denied microphone, empty audio, and backend errors.

- [ ] **Step 6: Run the browser/Electron code checks.**

Run: `corepack pnpm --filter @yuanai/web typecheck`

Run: `corepack pnpm --filter @yuanai/web lint`

Run: `corepack pnpm --filter @yuanai/web test:unit -- src/hooks/useSpeechRecognition.test.ts src/hooks/useVoiceInput.test.ts`

Run: `corepack pnpm --filter @yuanai/desktop typecheck`

Run: `corepack pnpm --filter @yuanai/desktop lint`

Run: `corepack pnpm --filter @yuanai/desktop test:unit -- src/renderer/main/useVoiceInput.test.ts src/renderer/main/App.test.tsx`

Expected: all checks pass, including unsupported API, native result, fallback upload, user cancellation, denied permission, empty recording, timeout, and no-auto-send paths.

### Task 4: Implement Expo native recognition and recording fallback

**Files:**

- Modify: `apps/mobile/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/mobile/app.json`
- Create: `apps/mobile/src/lib/mobileVoiceTranscription.ts`
- Create: `apps/mobile/src/lib/mobileVoiceTranscription.test.ts`
- Create: `apps/mobile/src/hooks/useVoiceInput.ts`
- Create: `apps/mobile/src/hooks/useVoiceInput.test.ts`
- Modify: `apps/mobile/src/components/chat/ChatInput.tsx`

**Consumes:** Task 1's endpoint/response contract, existing `API_BASE_URL` and auth store, and Task 2's shared types.

**Produces:** Expo SDK 52 development-client voice input that requests microphone/speech permissions, uses native recognizer results when possible, uploads a recorded fallback, and only changes the draft text.

- [ ] **Step 1: Add the exact compatible native dependencies and plugin configuration.**

Use the SDK 52 dist-tag, not `latest`:

`corepack pnpm --filter @yuanai/mobile add expo-speech-recognition@sdk-52 expo-av@~15.0.2`

In `app.json`, append this config-plugin entry without removing the existing iOS microphone/speech descriptions or Android `RECORD_AUDIO` permission:

```json
[
  "expo-speech-recognition",
  {
    "microphonePermission": "允许元AI使用麦克风进行语音输入。",
    "speechRecognitionPermission": "允许元AI使用语音识别将语音转换为文字。",
    "androidSpeechServicePackages": [
      "com.google.android.googlequicksearchbox",
      "com.google.android.tts"
    ]
  }
]
```

- [ ] **Step 2: Write failing native helper/hook tests.**

```typescript
it('uploads the recorded native URI with the authenticated multipart contract', async () => {
  mockFetchJson({ text: '移动端语音', language: 'zh', durationSeconds: 1.8 })
  await expect(
    transcribeMobileAudio({ uri: 'file:///cache/voice.m4a', mimeType: 'audio/mp4' })
  ).resolves.toMatchObject({ text: '移动端语音' })
  expect(fetch).toHaveBeenCalledWith(
    `${API_BASE_URL}/voice/transcriptions`,
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer token' }),
    })
  )
})
```

Add hook tests that mock `ExpoSpeechRecognitionModule` and `Audio.Recording`: permission denial displays `error` without calling fetch; native `result` appends text without fetch; `network` with a persisted URI calls `transcribeMobileAudio`; absent persisted recording switches to `Audio.Recording`; `cancel` neither calls `onTranscript` nor `onSend`; an empty backend text is an error.

- [ ] **Step 3: Run the native focused tests and confirm red.**

Run: `corepack pnpm --filter @yuanai/mobile test:unit -- src/lib/mobileVoiceTranscription.test.ts src/hooks/useVoiceInput.test.ts`

Expected: module import failures for the new native helper/hook.

- [ ] **Step 4: Implement authenticated native transcription.**

`transcribeMobileAudio({ uri, mimeType, filename? })` obtains the current access token from `useAuthStore.getState()`, builds React Native `FormData` using `{ uri, name: filename ?? 'voice.m4a', type: mimeType }`, posts with `fetch` to `${API_BASE_URL}/voice/transcriptions`, reads structured error JSON safely, validates `text`, and returns `VoiceTranscriptionResponse`. It must not set multipart `Content-Type` manually, because React Native adds the boundary.

- [ ] **Step 5: Implement the Mobile hook.**

`useVoiceInput({ onTranscript, language? })` registers recognition events exactly once and returns the same `VoiceInputStatus`/operations as Web/Desktop.

1. Request recognition/microphone permissions with `ExpoSpeechRecognitionModule.requestPermissionsAsync()`. If denied, set an actionable error and do not attempt recording/upload.
2. Start native recognition with `interimResults: false`, `continuous: false`, device locale, and `recordingOptions: { persist: true, outputFileName: 'yuanai-voice.wav' }` when `supportsRecording()` is true.
3. On a final native result, append trimmed text, discard the persisted recording, and return to `idle`.
4. On unsupported/network/service recognition failure, use the persisted `audioend` URI. If the platform supplies no recording URI, request microphone permission, use `Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY)`, then on `stop` call `stopAndUnloadAsync()` and upload its URI as `audio/mp4` on iOS or `audio/m4a`/the recorder-reported MIME on Android.
5. Use `status='recording'` while Whisper fallback is capturing and `status='transcribing'` during upload. `cancel` calls `abort`, stops/unloads recording, deletes no user files outside the app cache, and never inserts a result.
6. Convert platform error codes to Chinese messages and distinguish no-speech/empty-audio (retry) from permission denial (open system settings guidance).

- [ ] **Step 6: Wire `ChatInput` and enforce no auto-send.**

Replace the `notReady(t('chat.voice'))` press handler with the hook. Render `Mic`, `Square`, or an activity indicator based on status; preserve the 34x34 button dimensions; set `accessibilityRole="button"`, state-aware labels, `accessibilityState={{ busy: status === 'transcribing', selected: status === 'listening' || status === 'recording' }}`, and status text announced through an existing dialog/toast mechanism. In `onTranscript`, call `setValue(previous => appendWithSpace(previous, text))` only. Do not call `handleSend`, clear attachments, or alter `streaming`.

- [ ] **Step 7: Run Mobile static and unit checks.**

Run: `corepack pnpm --filter @yuanai/mobile typecheck`

Run: `corepack pnpm --filter @yuanai/mobile lint`

Run: `corepack pnpm --filter @yuanai/mobile test:unit`

Expected: all pass. Inspect `git diff -- pnpm-lock.yaml` and keep only the mobile dependency closure introduced by this task.

### Task 5: Verify real interfaces, run feature regression, commit, and update progress

**Files:**

- Modify (local only): `.codex/progress/feature-voice-qr-files-media.md`

**Consumes:** Completed Tasks 1-4.

**Produces:** Evidence-backed, one-commit voice feature. The progress record stays untracked.

- [ ] **Step 1: Run full touched-scope automated checks.**

Run:

```bash
cd backend && uv run ruff check app/api/v1/voice.py app/services/voice_service.py app/services/ai_service.py tests/unit/test_voice_service.py tests/unit/test_ai_service.py tests/integration/test_voice.py
cd backend && uv run mypy app/api/v1/voice.py app/services/voice_service.py app/services/ai_service.py
cd backend && uv run pytest tests/unit/test_voice_service.py tests/unit/test_ai_service.py tests/integration/test_voice.py -x -q
corepack pnpm --filter @yuanai/core typecheck
corepack pnpm --filter @yuanai/core lint
corepack pnpm --filter @yuanai/core test:unit
corepack pnpm --filter @yuanai/web typecheck
corepack pnpm --filter @yuanai/web lint
corepack pnpm --filter @yuanai/web test:unit
corepack pnpm --filter @yuanai/desktop typecheck
corepack pnpm --filter @yuanai/desktop lint
corepack pnpm --filter @yuanai/desktop test:unit
corepack pnpm --filter @yuanai/mobile typecheck
corepack pnpm --filter @yuanai/mobile lint
corepack pnpm --filter @yuanai/mobile test:unit
```

Expected: the changed scopes pass. If the known pre-existing global backend mypy/Ruff failures appear only in untouched migration/email/share modules, record their paths and retain the successful focused result.

- [ ] **Step 2: Perform real Web UI verification against the real API.**

1. Start the supported real stack with `corepack pnpm dev:real`.
2. In a separate terminal, confirm `/health` returns JSON; do not place an API key in the command line.
3. Open the actual Web app in the in-app browser, log in with the local ignored test account, click the visible microphone, grant microphone permission, speak a short phrase, stop it, and verify text is appended but the send button is still idle and no assistant message is created.
4. In a Firefox/unsupported-recognition session, repeat the interaction. Verify it records, shows `正在转写`, receives text from the real endpoint when OpenAI is configured, or reports the precise unavailable-key failure when it is not. Capture a screenshot and request/response logs with sensitive data removed.

- [ ] **Step 3: Perform real Electron UI verification.**

1. Start with `YUANAI_API_URL=http://localhost:8000/api/v1 corepack pnpm --filter @yuanai/desktop dev`.
2. Sign in to the running Electron window, click `语音输入`, verify microphone permission/state changes, speak/stop, and verify draft-only insertion.
3. Temporarily simulate unsupported local recognition by launching the renderer test double or using a Chromium profile where Web Speech is unavailable; verify recording fallback surfaces its progress and never auto-sends. Capture the rendered Electron result and preserve a non-sensitive log excerpt in the progress record.

- [ ] **Step 4: Build and run the Expo development client on a real device.**

1. Determine the host LAN address with `hostname -I`; choose the non-loopback Wi-Fi IPv4 address.
2. Start the real backend and expose it on the host interface using the repository's real-dev script/runtime configuration. Confirm the phone can reach `http://<host-lan-ip>:8000/health` through its browser and the firewall permits TCP 8000.
3. Start Metro only via `EXPO_PUBLIC_API_URL=http://<host-lan-ip>:8000/api/v1 corepack pnpm --filter @yuanai/mobile start`.
4. Because the speech config plugin adds native code, rebuild/install the current Development Client with the existing package script `corepack pnpm --filter @yuanai/mobile android` (or `ios` on macOS), then connect it to Metro on the same Wi-Fi.
5. Grant microphone and speech recognition permissions, speak a phrase, verify native result is appended without send; disable/deny the native recognizer service to exercise recorded Whisper fallback; cancel a recording and verify the draft stays unchanged. Save device screenshots and factual results in the local progress file.

- [ ] **Step 5: Review before committing.**

Run: `git diff --check`

Run: `git status --short`

Review changed runtime code for unfinished-work markers, `console.log`, API keys, raw provider error strings, accidental `.codex` staging, and unbounded audio collection. Confirm no `docs/` files changed and all Compose image references remain unchanged/pinned.

- [ ] **Step 6: Update local progress and make one commit.**

Update `.codex/progress/feature-voice-qr-files-media.md` with exact checks, real UI paths, fallback outcome, known environment limits, and the eventual hash. Keep it untracked. Stage only feature source, tests, `apps/mobile/package.json`, and `pnpm-lock.yaml`; then commit:

```bash
git add backend packages apps pnpm-lock.yaml
git commit -m "feat(core,backend,web,mobile,desktop): add voice input fallback"
```

Expected: Husky and commitlint pass. Do not push, merge, or start QR login until the user explicitly directs the next Feature Progress item.

## Self-Review

### Spec Coverage

| Required behavior                                                                | Plan task                     |
| -------------------------------------------------------------------------------- | ----------------------------- |
| Backend Whisper endpoint with MIME/size/duration/timeout constraints             | Task 1                        |
| AI call only through `ai_service.py`                                             | Task 1                        |
| Browser/Electron Web Speech first, recorded Whisper fallback                     | Task 3                        |
| Expo native recognition first, recorded Whisper fallback and permission handling | Task 4                        |
| Transcript inserts into composer and does not auto-send                          | Tasks 3 and 4                 |
| Three-platform unit/static tests                                                 | Tasks 1-4 and Task 5          |
| Real Web, Electron, and phone UI verification                                    | Task 5                        |
| One scoped local commit, no push/merge, ignored progress                         | Task 5 and Global Constraints |

No approved voice requirement is omitted. QR approval, titles, background streams, media tasks, search, and TODO deletion deliberately remain outside this single-feature plan.

### Placeholder Scan

Searched for incomplete-work placeholder phrases and vague error-handling instructions. This plan contains none as implementation instructions.

### Type Consistency

The backend provider function is `transcribe_audio`, the bounded service function is `transcribe_upload`, and all TypeScript clients consume `VoiceTranscriptionResponse`. UI state is consistently `VoiceInputStatus`; the Web/Desktop `File` client and Mobile URI client are deliberately separate to preserve package platform isolation.
