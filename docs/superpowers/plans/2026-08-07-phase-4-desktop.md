# Phase 4 Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不重构现有 Web 大型组件的前提下，交付与当前 Web 已实现功能对齐、具备 Electron 原生能力并可在 Windows、macOS、Linux 打包的元AI 桌面端。

**Architecture:** Electron 主进程拥有窗口、安全策略、加密存储、协议、系统集成、通知和更新；sandbox preload 只暴露经过参数校验的类型化 IPC；六个 React renderer 入口实现 Desktop 薄壳，复用 `@yuanai/core` 的 API、stores、hooks 和 `@yuanai/ui` tokens。后端只增加 Desktop OAuth 的 PKCE 一次性 code exchange 和鉴权完成事件 SSE，现有 Web 与 Mobile 行为保持不变。

**Tech Stack:** Electron 33.4、electron-vite 2.3、React 19、React Router 7、TanStack Query 5、Zustand 5、Vitest 2、Testing Library 16、Playwright、FastAPI、Redis、electron-builder 25。

## Global Constraints

- 工作分支固定为 `feature/phase-4-desktop`，基线固定为 `origin/dev@90192ed`。
- `docs/` 全部只读；实施计划保存在 `.codex/plans/2026-08-07-phase-4-desktop.md`，且 `.codex/` 仅作本地执行记录，永不 stage 或 commit。
- 每个 Task 都执行 RED -> GREEN -> regression -> local commit；commit 成功后立即继续下一个 Task，仅在存在无法从项目上下文消除的决策或阻塞时询问用户。
- 修改 Desktop 可运行行为的 Task 在 commit 前还要通过 `package.json` 的 `dev` 或 `build:unpack` script 实际启动，操作本 Task 的关键路径并保存临时截图/日志证据；环境无法显示 Electron 时明确记录限制，不用静态检查冒充运行验收。
- 禁止 push，禁止合并到 `dev` 或 `master`，禁止使用 `--no-verify`。
- commit 必须符合 Conventional Commits，scope 只能使用仓库允许的 `desktop`、`backend`、`core`、`types`、`e2e`、`config` 等值。
- 项目启动、构建、预览和安装包生成只能调用 `package.json` scripts；不得在验收命令中直接调用 `electron-vite`、`electron-builder`、`vite` 或 `playwright`。
- `docker-compose*.yml` / `docker-compose*.yaml` 的镜像必须同时使用完整版本标签和 64 位 SHA-256 multi-arch digest。
- 所有导出的 TypeScript 函数、Hook、接口、类型和 React 组件都添加中文 JSDoc；禁止 `any`，不可信输入一律以 `unknown` 进入类型守卫。
- `packages/` 禁止导入 Electron、Next.js 或 React Native API；Desktop 平台代码全部留在 `apps/desktop`。
- Desktop 通过现有 `setPlatformAdapter(desktopAdapter)` 接入 Core；不得实现 Phase 文档中已经过时的 `setAuthStorage`。
- Desktop `yuanai://oauth/callback` 只允许 60 秒一次性 authorization code 或错误字段；access token、refresh token、PKCE verifier 不得进入 Desktop URI、argv、日志或错误消息。现有 `mobile=1` OAuth 契约保持不变。
- Desktop 通知使用 Electron 原生 `Notification` + Bearer 鉴权 SSE；不注册 Service Worker，不复用 Web Push。
- 完成事件 SSE 固定为 `GET /api/v1/notifications/events`，这是为了复用既有 notifications router 对 Phase 文档 `/events` 的有意路径适配。
- 本轮不渲染语音按钮，不申请麦克风权限，不新增 `/files/transcribe`，不新增 `transcribe` IPC。
- 设置窗口固定七区：个人资料、账号安全、外观与主题、通知设置、语言与地区、桌面设置、关于与帮助。
- 图标唯一源文件为 `apps/mobile/assets/icon.png`，生成资源必须可重复。
- Renderer 满足 WCAG 2.2 AA：全键盘可达、可见焦点、对话框焦点陷阱/回收、状态 live region、文本对比度 4.5:1、控件对比度 3:1、最小目标 24x24 px。
- Desktop 布局使用内容断点和容器查询，不按 viewport 缩放字号；1024x700、1440x900、1920x1080 下无横向页面溢出，文本允许换行且不遮挡控件。
- 当前主机只真实验收 Ubuntu 22.04；Windows/macOS 由 release matrix 构建，最终安装、托盘、菜单和签名相关人工验收需在对应平台执行。

---

## File Responsibility Map

### Repository And Build

- `AGENTS.md`: 团队可见的 Phase 4 决策与永久工作流约束。
- `docker-compose.yml`: PostgreSQL、Redis、MinIO 的不可漂移镜像引用。
- `apps/desktop/package.json`: Desktop 启动、构建、测试、资源生成和打包的唯一入口。
- `apps/desktop/electron.vite.config.ts`: main、preload、六个 renderer 的构建入口。
- `apps/desktop/vitest.config.ts`: Node/jsdom 测试环境、aliases 和覆盖率门槛。
- `apps/desktop/playwright.config.ts`: 打包版 Electron E2E 和截图配置。
- `apps/desktop/electron-builder.yml`: 三平台 targets、protocol、resources、publish metadata。
- `.github/workflows/desktop-release.yml`: Windows/macOS/Linux 的 build matrix 和 tag release。

### Main, Preload And Shared Contract

- `apps/desktop/src/shared/ipc-contract.ts`: IPC channel、payload、return type、event 和 `window.yuanai` 的唯一来源。
- `apps/desktop/src/shared/guards.ts`: UUID、URL、artifact、preferences、IPC payload 的无副作用类型守卫。
- `apps/desktop/src/main/storage/*`: safeStorage 会话与普通偏好的原子持久化。
- `apps/desktop/src/main/windows/*`: 命名窗口单例、Artifact 多实例、renderer-ready 消息队列。
- `apps/desktop/src/main/security/*`: CSP、permission、navigation、sender 信任边界。
- `apps/desktop/src/main/ipc/*`: auth、prefs、window、dialog、shell、screen、system、notification、updater handlers。
- `apps/desktop/src/main/protocol/*`: `yuanai://` 注册、严格解析、启动前队列。
- `apps/desktop/src/main/protocol/app-scheme.ts`: 只读 `yuanai-app://renderer` 资源 scheme，替代打包版 `file://`。
- `apps/desktop/src/main/tray/*`, `menu/*`, `shortcuts/*`: 平台原生 shell 能力。
- `apps/desktop/src/main/oauth/*`: PKCE session、一次性 code exchange、结果投递。
- `apps/desktop/src/main/updater/*`: 用户确认下载的 updater 状态机。
- `apps/desktop/src/preload/index.ts`: 白名单 contextBridge，不暴露原始 Electron/Node 对象。

### Renderer

- `apps/desktop/src/renderer/shared/*`: adapter、无竞态 bootstrap、providers、i18n、theme、dialogs、live region、基础样式。
- `apps/desktop/src/renderer/login/*`: 邮箱登录、注册、忘记密码和 OAuth 入口。
- `apps/desktop/src/renderer/main/*`: 会话导航、聊天、SSE 回复、附件、分享和通知导航。
- `apps/desktop/src/renderer/settings/*`: 七个设置分区。
- `apps/desktop/src/renderer/about/*`: 应用/系统版本和外部支持链接。
- `apps/desktop/src/renderer/artifact/*`: 主窗预览和独立隔离运行窗口。
- `apps/desktop/src/renderer/oauth/*`: OAuth 进行中与错误状态。

### Core And Backend

- `packages/core/src/api/client.ts`: 可验证的 runtime API base URL live binding。
- `packages/core/src/hooks/useStream.ts`: 每次发送时读取当前 API URL，Web/Mobile 行为不变。
- `backend/app/services/oauth_service.py`: target-aware state、PKCE challenge、一次性 code 原子消费。
- `backend/app/api/v1/auth.py`: Desktop authorize 参数与 `/auth/desktop/exchange`。
- `backend/app/services/event_service.py`: 每用户 Redis Pub/Sub 完成事件。
- `backend/app/api/v1/notifications.py`: Bearer 鉴权 `/notifications/events` SSE。
- `backend/app/services/notification_service.py`: Web/Expo push 与 Desktop event fan-out 的单一编排入口。

---

### Task 1: Pin Reproducible Infrastructure Images

**Files:**

- Modify: `docker-compose.yml`

**Interfaces:**

- Consumes: Docker Compose image reference grammar `name:tag@sha256:<64 hex>`.
- Produces: three immutable infrastructure image references; no application API changes.

- [x] **Step 1: Prove the current file violates the rule**

Run:

```bash
rg -n 'image: .*:(latest|[0-9]+-alpine)$' docker-compose.yml
```

Expected: matches `postgres:16-alpine`, `redis:7-alpine`, and `minio/minio:latest`.

- [x] **Step 2: Replace only the three image values**

Use exactly:

```yaml
postgres:16.14-alpine@sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229
redis:7.4.9-alpine@sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99
minio/minio:RELEASE.2025-09-07T16-13-09Z@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e
```

Environment variables, ports, commands, volume names and Compose version remain byte-for-byte unchanged.

- [x] **Step 3: Validate without starting containers**

Run:

```bash
docker compose config --images
```

Expected: exit 0 and exactly the three references above. Then run:

```bash
rg -n 'image: .*:(latest|[0-9]+-alpine)(@|$)' docker-compose.yml
```

Expected: exit 1 with no output.

Finally inspect every digest as a manifest list and assert it declares at least `linux/amd64` and `linux/arm64`; do not pull or start a container:

```bash
docker manifest inspect --verbose postgres:16.14-alpine@sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229
docker manifest inspect --verbose redis:7.4.9-alpine@sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99
docker manifest inspect --verbose minio/minio:RELEASE.2025-09-07T16-13-09Z@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e
```

Expected: every response identifies a manifest list/index containing both target architectures. If registry inspection is unavailable, record the exact network/tool error and do not claim multi-architecture verification.

- [x] **Step 4: Commit and continue**

```bash
git add docker-compose.yml
git commit -m "chore(config): pin infrastructure image versions"
```

### Task 2: Establish Desktop Build And Test Harness

**Files:**

- Modify: `.gitignore`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/tsconfig.json`
- Modify: `apps/desktop/electron.vite.config.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `pnpm-lock.yaml`
- Create: `apps/desktop/tsconfig.node.json`
- Create: `apps/desktop/vitest.config.ts`
- Create: `apps/desktop/tests/setup.ts`
- Create: `apps/desktop/src/shared/window-entry.ts`
- Test: `apps/desktop/src/shared/window-entry.test.ts`
- Delete: `apps/desktop/src/renderer/index.html`
- Delete: `apps/desktop/src/renderer/main.tsx`
- Create: `apps/desktop/src/renderer/{main,login,settings,about,artifact,oauth}/index.html`
- Create: `apps/desktop/src/renderer/{main,login,settings,about,artifact,oauth}/entry.tsx`
- Create: `apps/desktop/src/renderer/{main,login,settings,about,artifact,oauth}/App.tsx`

**Interfaces:**

- Consumes: workspace packages `@yuanai/core`, `@yuanai/types`, `@yuanai/ui`.
- Produces: `RENDERER_ENTRIES` and scripts `dev`, `build`, `preview`, `build:unpack`, `package:win`, `package:mac`, `package:linux`, `package:all`, `lint`, `typecheck`, `test`, `test:unit`, `test:integration`, `test:coverage`, `test:e2e`.

- [ ] **Step 1: Install the locked Desktop dependencies through pnpm**

Add the exact new runtime and test versions below so their package.json specifiers and lockfile entries agree without resolution drift. Existing Desktop dependencies remain governed by the frozen workspace lockfile.

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop add --save-exact @tanstack/react-query@5.101.2 react-router-dom@7.0.2 react-i18next@15.7.4 i18next@24.2.3 eventsource-parser@3.0.6 lucide-react@0.460.0 react-markdown@10.1.0 react-syntax-highlighter@16.1.1 react-virtuoso@4.18.10 remark-gfm@4.0.1 remark-math@6.0.0 remark-gemoji@8.0.0 rehype-katex@7.0.1 katex@0.17.0 zod@4.4.3 @uiw/react-codemirror@4.25.11 @codemirror/lang-css@6.3.1 @codemirror/lang-html@6.4.11 @codemirror/lang-javascript@6.2.5 @codemirror/lang-json@6.0.2 @codemirror/lang-markdown@6.5.0
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop add --save-dev --save-exact vitest@2.1.9 @vitest/coverage-v8@2.1.9 @testing-library/react@16.3.2 @testing-library/user-event@14.6.1 @testing-library/jest-dom@6.9.1 jsdom@25.0.1 msw@2.15.0 @playwright/test@1.61.1 @axe-core/playwright@4.10.2 @types/node@22.20.1 @types/react-syntax-highlighter@15.5.13
```

- [ ] **Step 2: Write the renderer entry test**

```typescript
import { describe, expect, it } from 'vitest'

import { RENDERER_ENTRIES } from './window-entry'

describe('RENDERER_ENTRIES', () => {
  it('declares each Phase 4 renderer exactly once', () => {
    expect(RENDERER_ENTRIES).toEqual(['main', 'login', 'settings', 'about', 'artifact', 'oauth'])
    expect(new Set(RENDERER_ENTRIES).size).toBe(RENDERER_ENTRIES.length)
  })
})
```

- [ ] **Step 3: Run the test and observe RED**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit -- src/shared/window-entry.test.ts
```

Expected: FAIL because `window-entry.ts` is absent.

- [ ] **Step 4: Add the constant and real scripts/configuration**

```typescript
/** Electron renderer 构建入口，顺序用于构建和契约测试。 */
export const RENDERER_ENTRIES = ['main', 'login', 'settings', 'about', 'artifact', 'oauth'] as const

/** 可创建的 renderer 入口。 */
export type RendererEntry = (typeof RENDERER_ENTRIES)[number]
```

Set package scripts to:

```json
{
  "dev": "electron-vite dev",
  "build": "electron-vite build",
  "preview": "electron-vite preview",
  "build:unpack": "pnpm run build && electron-builder --dir",
  "package:win": "pnpm run build && electron-builder --win",
  "package:mac": "pnpm run build && electron-builder --mac",
  "package:linux": "pnpm run build && electron-builder --linux",
  "package:all": "pnpm run build && electron-builder -mwl",
  "lint": "eslint . --max-warnings 0",
  "typecheck": "tsc --noEmit && tsc -p tsconfig.node.json --noEmit",
  "test": "vitest run --exclude \"tests/e2e/**\"",
  "test:unit": "vitest run --exclude \"tests/integration/**\" --exclude \"tests/e2e/**\"",
  "test:integration": "vitest run tests/integration",
  "test:coverage": "vitest run --coverage",
  "test:e2e": "pnpm run build:unpack && playwright test"
}
```

Vitest uses `jsdom`, `tests/setup.ts`, aliases `@shared` and `@renderer`, and thresholds 70% lines/functions/statements and 65% branches. Configure electron-vite with all six HTML inputs and create a minimal semantic `<main>` root for each entry so every intermediate commit remains buildable. Update the skeleton main process to load only the `main` entry and set `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Ignore `apps/desktop/out`, `apps/desktop/release`, `apps/desktop/test-results` and `apps/desktop/playwright-report`.

- [ ] **Step 5: Run GREEN and quality scripts**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop typecheck
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop lint
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop build
```

Expected: all exit 0, six renderer HTML files are emitted, and no placeholder test output remains. Then start through the script:

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop dev
```

Expected: the Main skeleton window renders nonblank; close it after saving a temporary screenshot and checking the terminal for renderer/main/preload errors.

- [ ] **Step 6: Commit and continue**

```bash
git add .gitignore apps/desktop/package.json apps/desktop/tsconfig.json apps/desktop/tsconfig.node.json apps/desktop/electron.vite.config.ts apps/desktop/vitest.config.ts apps/desktop/tests/setup.ts apps/desktop/src/main/index.ts apps/desktop/src/shared/window-entry.ts apps/desktop/src/shared/window-entry.test.ts apps/desktop/src/renderer pnpm-lock.yaml
git commit -m "chore(desktop): add build and test harness"
```

### Task 3: Support Runtime API Base URLs In Core

**Files:**

- Modify: `packages/core/src/api/client.ts`
- Modify: `packages/core/src/api/index.ts`
- Modify: `packages/core/src/hooks/useStream.ts`
- Test: `packages/core/src/api/__tests__/client.test.ts`
- Test: `packages/core/src/hooks/__tests__/useStream.test.tsx`

**Interfaces:**

- Consumes: environment-derived default URL.
- Produces: mutable live export `API_BASE_URL`, `getApiBaseUrl(): string`, `setApiBaseUrl(value: string): void`.

- [ ] **Step 1: Add failing URL tests**

```typescript
it('updates the live export and axios default after normalization', () => {
  setApiBaseUrl('https://desktop.example/api/v1/')
  expect(getApiBaseUrl()).toBe('https://desktop.example/api/v1')
  expect(API_BASE_URL).toBe('https://desktop.example/api/v1')
  expect(apiClient.defaults.baseURL).toBe('https://desktop.example/api/v1')
})

it.each([
  'file:///tmp/api',
  'https://user:pass@example.com/api/v1',
  'https://example.com/api/v1?token=x',
  'https://example.com/api/v1#fragment',
])('rejects unsafe API URL %s without changing the previous value', (value) => {
  setApiBaseUrl('https://previous.example/api/v1')
  expect(() => setApiBaseUrl(value)).toThrow()
  expect(getApiBaseUrl()).toBe('https://previous.example/api/v1')
})
```

Add a `useStream` test that calls `setApiBaseUrl` after importing the hook and asserts the next stream request uses the new base URL.

- [ ] **Step 2: Observe RED**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/core test:unit -- src/api/__tests__/client.test.ts src/hooks/__tests__/useStream.test.tsx
```

Expected: FAIL because getter/setter exports do not exist.

- [ ] **Step 3: Implement validated live binding**

```typescript
function normalizeApiBaseUrl(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('API base URL must use http or https')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('API base URL must not contain credentials, query, or fragment')
  }
  return url.toString().replace(/\/$/, '')
}

export let API_BASE_URL = normalizeApiBaseUrl(DEFAULT_API_BASE_URL)

/** 返回当前运行时 API base URL。 */
export function getApiBaseUrl(): string {
  return API_BASE_URL
}

/** 校验并更新运行时 API base URL 与 Axios defaults。 */
export function setApiBaseUrl(value: string): void {
  const normalized = normalizeApiBaseUrl(value)
  API_BASE_URL = normalized
  apiClient.defaults.baseURL = normalized
}
```

`useStream` must call `getApiBaseUrl()` inside `sendMessage`, not capture a string at module initialization.

- [ ] **Step 4: Run Core and Web regression scripts**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/core test:unit
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/core typecheck
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/web test:unit
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/web build
```

Expected: all exit 0; Web keeps its environment-derived URL.

- [ ] **Step 5: Commit and continue**

```bash
git add packages/core/src/api/client.ts packages/core/src/api/index.ts packages/core/src/hooks/useStream.ts packages/core/src/api/__tests__/client.test.ts packages/core/src/hooks/__tests__/useStream.test.tsx
git commit -m "feat(core): support runtime api base urls"
```

### Task 4: Add Typed IPC And Encrypted Platform Storage

**Files:**

- Create: `apps/desktop/src/shared/runtime-config.ts`
- Create: `apps/desktop/src/shared/ipc-contract.ts`
- Create: `apps/desktop/src/shared/guards.ts`
- Create: `apps/desktop/src/main/config/runtime-config.ts`
- Create: `apps/desktop/src/main/ipc/guards.ts`
- Create: `apps/desktop/src/main/ipc/auth.ts`
- Create: `apps/desktop/src/main/ipc/prefs.ts`
- Create: `apps/desktop/src/main/ipc/index.ts`
- Create: `apps/desktop/src/main/storage/auth-storage.ts`
- Create: `apps/desktop/src/main/storage/prefs-storage.ts`
- Replace: `apps/desktop/src/preload/index.ts`
- Test: `apps/desktop/src/main/storage/auth-storage.test.ts`
- Test: `apps/desktop/src/main/storage/prefs-storage.test.ts`
- Test: `apps/desktop/src/main/config/runtime-config.test.ts`
- Test: `apps/desktop/src/preload/index.test.ts`

**Interfaces:**

- Consumes: Electron `safeStorage`, `ipcMain`, `contextBridge`, Zustand `StateStorage` serialized strings.
- Produces: `IPC`, `DesktopPreferences`, `AppRuntimeConfig`, `YuanaiApi`, encrypted auth KV and validated preference KV.

- [ ] **Step 1: Define failing storage and preload tests**

```typescript
it('refuses persistence when encryption is unavailable or Linux uses basic_text', async () => {
  safeStorage.isEncryptionAvailable.mockReturnValue(true)
  safeStorage.getSelectedStorageBackend.mockReturnValue('basic_text')
  await expect(authStorage.setItem('yuanai-auth', 'plain-token')).rejects.toThrow(
    'SAFE_STORAGE_UNAVAILABLE'
  )
})

it('writes ciphertext atomically with owner-only mode', async () => {
  safeStorage.isEncryptionAvailable.mockReturnValue(true)
  safeStorage.getSelectedStorageBackend.mockReturnValue('kwallet')
  safeStorage.encryptString.mockReturnValue(Buffer.from('ciphertext'))
  await authStorage.setItem('yuanai-auth', 'plain-token')
  expect(writeFile).toHaveBeenCalledWith(
    expect.stringContaining('.tmp'),
    Buffer.from('ciphertext'),
    {
      mode: 0o600,
    }
  )
  expect(rename).toHaveBeenCalledOnce()
})

it('returns a cleanup function that removes the wrapped Electron listener', () => {
  const off = api.events.onAuthChanged(vi.fn())
  off()
  expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
    IPC.events.authChanged,
    expect.any(Function)
  )
})
```

Also test corrupt files are moved to `.corrupt`, payloads larger than 1 MiB are rejected, preference unknown keys are rejected, and preload exposes no `ipcRenderer`, filesystem path, `process` or raw `send` method.

Runtime-config tests assert main reads `YUANAI_API_URL`, `YUANAI_WEB_URL` and optional comma-separated `YUANAI_ASSET_ORIGINS`, strips one trailing slash, rejects credentials/query/fragment, rejects remote cleartext HTTP while allowing HTTPS and loopback HTTP, canonicalizes asset values to origins, and never returns raw environment values through preload. Defaults are `http://localhost:8000/api/v1`, `http://localhost:3000` and no extra asset origin.

- [ ] **Step 2: Observe RED**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit -- src/main/storage/auth-storage.test.ts src/main/storage/prefs-storage.test.ts src/preload/index.test.ts
```

Expected: FAIL because storage, contract and bridge modules are absent.

- [ ] **Step 3: Define the stable contract**

```typescript
/** Desktop 主进程持久偏好。 */
export interface DesktopPreferences {
  closeToTray: boolean
  globalShortcut: string | null
  autoLaunch: boolean
  updateChannel: 'stable' | 'beta'
  checkUpdatesAutomatically: boolean
  nativeNotifications: boolean
  notificationSound: boolean
  aiReplyNotifications: boolean
}

/** 主进程校验后提供给所有 renderer 的不可变运行时配置。 */
export interface AppRuntimeConfig {
  apiBaseUrl: string
  webBaseUrl: string
  assetOrigins: readonly string[]
}

/** IPC 通道名的唯一来源。 */
export const IPC = {
  auth: { get: 'auth:get', set: 'auth:set', remove: 'auth:remove' },
  storage: { get: 'storage:get', set: 'storage:set', remove: 'storage:remove' },
  prefs: { get: 'prefs:get', update: 'prefs:update' },
  events: {
    authChanged: 'event:auth-changed',
    prefsChanged: 'event:prefs-changed',
    deepLink: 'event:deep-link',
    oauthResult: 'event:oauth-result',
    menuCommand: 'event:menu-command',
    artifactInit: 'event:artifact-init',
    notificationNavigate: 'event:notification-navigate',
    updater: 'event:updater',
  },
} as const
```

The same file defines the later channel groups up front: `runtime`, `window`, `dialog`, `shell`, `screen`, `system`, `theme`, `oauth`, `notifications`, and `updater`. `runtime.getConfig()` returns only a frozen, validated `AppRuntimeConfig`; `theme.get()` exposes the resolved `light | dark` value, `theme.setSource('system' | 'light' | 'dark')` controls `nativeTheme.themeSource`, and `theme.onChanged()` subscribes to resolved changes. Their methods use concrete request/response types; event subscriptions return `() => void`.

- [ ] **Step 4: Implement storage and sender guards**

Auth uses `${userData}/session.enc`; prefs use `${userData}/desktop-prefs.json`. Both write `*.tmp` with `0o600`, fsync, then rename. Reads validate key and size; decryption/JSON/schema failure moves the file to `*.corrupt-<timestamp>` and returns `null` or defaults. Linux rejects `basic_text` even when `isEncryptionAvailable()` reports true. IPC handlers first require `event.senderFrame === event.sender.mainFrame`, then ask an injected trusted-WebContents registry to verify ownership, and finally require an exact configured development origin or `yuanai-app://renderer/<known-entry>/...` URL before validating `unknown` payloads. Task 4 tests the guard through a fake registry; Task 5 wires that registry to WindowManager and tests unmanaged senders are rejected.

- [ ] **Step 5: Expose the minimum preload API**

Use `contextBridge.exposeInMainWorld('yuanai', api)`. Each listener wraps the event, passes only validated payload data, and removes the exact wrapper on unsubscribe. `runtime.getConfig()` invokes the main-process handler; the main process is the only code that reads environment variables. Do not expose `contextBridge`, `ipcRenderer`, Electron classes, Node globals or absolute file paths.

- [ ] **Step 6: Run GREEN and quality scripts**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop typecheck
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop lint
```

Expected: all exit 0; test assertions confirm plaintext token bytes never reach disk writes.

- [ ] **Step 7: Commit and continue**

```bash
git add apps/desktop/src/shared apps/desktop/src/main/config apps/desktop/src/main/ipc apps/desktop/src/main/storage apps/desktop/src/preload
git commit -m "feat(desktop): add typed secure storage bridge"
```

### Task 5: Enforce Security Boundaries And Managed Windows

**Files:**

- Modify: `backend/app/main.py`
- Test: `backend/tests/test_cors.py`
- Replace: `apps/desktop/src/main/index.ts`
- Create: `apps/desktop/src/main/app-state.ts`
- Create: `apps/desktop/src/main/lifecycle.ts`
- Create: `apps/desktop/src/main/security/csp.ts`
- Create: `apps/desktop/src/main/security/permissions.ts`
- Create: `apps/desktop/src/main/security/navigation.ts`
- Create: `apps/desktop/src/main/theme/service.ts`
- Create: `apps/desktop/src/main/windows/config.ts`
- Create: `apps/desktop/src/main/windows/entries.ts`
- Create: `apps/desktop/src/main/windows/manager.ts`
- Create: `apps/desktop/src/main/protocol/parser.ts`
- Create: `apps/desktop/src/main/protocol/register.ts`
- Create: `apps/desktop/src/main/protocol/app-scheme.ts`
- Test: `apps/desktop/src/main/security/security.test.ts`
- Test: `apps/desktop/src/main/theme/service.test.ts`
- Test: `apps/desktop/src/main/windows/manager.test.ts`
- Test: `apps/desktop/src/main/lifecycle.test.ts`
- Test: `apps/desktop/src/main/protocol/parser.test.ts`
- Test: `apps/desktop/src/main/protocol/app-scheme.test.ts`

**Interfaces:**

- Consumes: `RendererEntry`, `IPC`, trusted sender guard and the single validated `AppRuntimeConfig` from Task 4.
- Produces: `WindowManager`, `ParsedDeepLink`, `createWindowOptions()`, `setupSecurity()`, queued `sendWhenReady()`, secure `yuanai-app://renderer` resources and an exact backend CORS allow-origin.

- [ ] **Step 1: Write failing security, lifecycle and window tests**

```typescript
it('creates every window with the hardened webPreferences', () => {
  expect(createWindowOptions('main').webPreferences).toMatchObject({
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  })
})

it('allows video capture only for a trusted renderer and denies audio', () => {
  expect(permissionDecision(trustedFrame, 'media', { mediaTypes: ['video'] })).toBe(true)
  expect(permissionDecision(trustedFrame, 'media', { mediaTypes: ['audio'] })).toBe(false)
  expect(permissionDecision(untrustedFrame, 'media', { mediaTypes: ['video'] })).toBe(false)
})

it('reuses named windows and isolates artifact instances', () => {
  expect(manager.open('settings')).toBe(manager.open('settings'))
  expect(manager.openArtifact(firstPayload)).not.toBe(manager.openArtifact(secondPayload))
})

it('queues payloads until did-finish-load', () => {
  manager.sendWhenReady('main', IPC.events.deepLink, { type: 'chat', conversationId: UUID })
  expect(webContents.send).not.toHaveBeenCalled()
  webContents.emit('did-finish-load')
  expect(webContents.send).toHaveBeenCalledWith(IPC.events.deepLink, expect.any(Object))
})
```

Parser tests accept `yuanai://chat/<uuid>` and `yuanai://oauth/callback?code=<43-128 url-safe chars>`, accept the documented OAuth error pair, and reject non-UUID chat IDs, duplicate query keys, fragments, credentials, unknown paths and any URL containing `access_token`, `refresh_token` or `code_verifier`.

Lifecycle tests assert single-instance lock failure calls `app.quit`, initial argv is queued before `whenReady`, Windows/Linux `second-instance` and macOS `open-url` use the same parser, a valid encrypted session opens MainWindow while a missing/invalid session opens LoginWindow, `activate` focuses the correct auth/main window, and `will-quit` disposes every registered service once.

App-scheme tests accept only host `renderer`, map percent-decoded paths beneath the configured renderer root, return correct MIME types, and reject traversal (`..`, encoded separators, NUL), unknown hosts, directories and missing files. A backend preflight test sends `Origin: yuanai-app://renderer` and asserts that exact origin is allowed; an unlisted custom origin receives no allow-origin header.

Theme-service tests assert `get()` returns the resolved `light | dark` value, `setSource('system' | 'light' | 'dark')` updates `nativeTheme.themeSource`, `nativeTheme.updated` broadcasts the new resolved value to every ready window, repeated setup does not duplicate listeners, and dispose removes the listener.

- [ ] **Step 2: Observe RED**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit -- src/main/security/security.test.ts src/main/windows/manager.test.ts src/main/lifecycle.test.ts src/main/protocol/parser.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement hardened configuration and exact CSP**

`createWindowOptions(entry)` sets window size/minimum from this table:

```typescript
export const WINDOW_SPECS = {
  main: { width: 1280, height: 820, minWidth: 960, minHeight: 640, resizable: true },
  login: { width: 980, height: 680, minWidth: 760, minHeight: 580, resizable: true },
  settings: { width: 960, height: 720, minWidth: 800, minHeight: 600, resizable: true },
  about: { width: 480, height: 360, minWidth: 480, minHeight: 360, resizable: false },
  artifact: { width: 980, height: 720, minWidth: 720, minHeight: 520, resizable: true },
  oauth: { width: 420, height: 260, minWidth: 420, minHeight: 260, resizable: false },
} as const
```

All windows start hidden and show on `ready-to-show`; macOS uses `hiddenInset`. CSP is built from the validated runtime config: `default-src 'self'`; scripts only `'self'`; styles `'self' 'unsafe-inline'`; images `'self' data: blob: https: <exact-loopback-asset-origins>` so provider avatars and configured local object storage can render; fonts `'self' data:`; connect `'self' <exact-api-origin>`; media `'self' blob:`; frames only `'self' blob:`; objects/base URIs disabled. `connect-src` has no wildcard and no directive allows `file:`. Artifact `srcdoc` includes its own restrictive CSP and remains sandboxed without `allow-same-origin`.

Call `protocol.registerSchemesAsPrivileged([{ scheme: 'yuanai-app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])` at module evaluation before `app.ready`. After ready, `protocol.handle` serves only read-only renderer build assets from an injected root using `Response` bodies, never exposes a filesystem URL, and unregisters during cleanup. Development windows retain the electron-vite dev URL; packaged windows load `yuanai-app://renderer/<entry>/index.html`. Add only the exact `yuanai-app://renderer` origin to backend CORS.

- [ ] **Step 4: Implement WindowManager and lifecycle**

Singleton keys are `main`, `login`, `register`, `forgot`, `settings`, `about`, `oauth`. Login/register/forgot load the same `login` entry with hashes `/login`, `/register`, `/forgot`. Artifact windows are keyed by generated window IDs, not artifact IDs, so the same artifact can be viewed twice. Payloads are delivered only after `did-finish-load`. `setWindowOpenHandler` always returns `{ action: 'deny' }`; `will-navigate` prevents app navigation and approved HTTPS links are opened only through the shell service.

Acquire the single-instance lock before `app.whenReady()`. Register protocol handlers before processing the queued initial argv. Main reads `AppRuntimeConfig` once and passes that same object to CSP, WindowManager, preload runtime IPC and later OAuth services. `ThemeService` owns `nativeTheme`, exposes typed get/set IPC, and broadcasts resolved-theme changes through WindowManager. Startup order is privileged-scheme declaration -> single-instance lock -> ready -> scheme handler -> security -> storage/IPC -> windows/theme -> encrypted-session decision -> queued deep links. Cleanup is idempotent.

- [ ] **Step 5: Run GREEN, build and sandbox scan**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop typecheck
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop lint
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop build
cd backend && PYTHONPATH="" uv run pytest tests/test_cors.py -q
rg -n 'sandbox:\s*false|nodeIntegration:\s*true|contextIsolation:\s*false' apps/desktop/src apps/desktop/out
```

Expected: scripts exit 0; final `rg` exits 1 with no output.

- [ ] **Step 6: Commit and continue**

```bash
git add apps/desktop/src/main apps/desktop/src/shared backend/app/main.py backend/tests/test_cors.py
git commit -m "feat(desktop): enforce secure window lifecycle"
```

### Task 6: Add Controlled Dialog, Shell And Screen Bridges

**Files:**

- Create: `apps/desktop/src/main/ipc/window.ts`
- Create: `apps/desktop/src/main/ipc/dialog.ts`
- Create: `apps/desktop/src/main/ipc/shell.ts`
- Create: `apps/desktop/src/main/ipc/screen.ts`
- Modify: `apps/desktop/src/main/ipc/index.ts`
- Modify: `apps/desktop/src/shared/ipc-contract.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Test: `apps/desktop/src/main/ipc/window.test.ts`
- Test: `apps/desktop/src/main/ipc/dialog.test.ts`
- Test: `apps/desktop/src/main/ipc/shell.test.ts`
- Test: `apps/desktop/src/main/ipc/screen.test.ts`

**Interfaces:**

- Consumes: trusted `WebContents`, `WindowManager`, Electron `dialog`, `shell`, `desktopCapturer`.
- Produces: sender-scoped window controls, fixed HTTPS external links, save/open dialogs without path disclosure, sanitized screen thumbnails.

- [ ] **Step 1: Write failing bridge tests**

```typescript
it('changes only the BrowserWindow that owns event.sender', async () => {
  await handlers.windowMinimize(trustedEvent)
  expect(BrowserWindow.fromWebContents).toHaveBeenCalledWith(trustedEvent.sender)
  expect(senderWindow.minimize).toHaveBeenCalledOnce()
})

it('rejects non-https external URLs and credentials', async () => {
  await expect(handlers.openExternal(trustedEvent, 'file:///etc/passwd')).rejects.toThrow()
  await expect(handlers.openExternal(trustedEvent, 'https://u:p@example.com')).rejects.toThrow()
})

it('returns screen metadata without nativeImage or file paths', async () => {
  const result = await handlers.listScreens(trustedEvent)
  expect(result).toEqual([{ id: 'screen:1:0', name: 'Screen 1', thumbnailDataUrl: PNG_DATA_URL }])
})
```

Dialog tests assert cancel returns `{ canceled: true }`, save data is capped at 10 MiB, a sanitized suggested filename cannot escape the chosen directory, and no absolute path is returned. Screen tests assert at most 16 sources, PNG-only thumbnails, 4 MiB response cap and untrusted sender rejection.

- [ ] **Step 2: Observe RED**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit -- src/main/ipc/window.test.ts src/main/ipc/dialog.test.ts src/main/ipc/shell.test.ts src/main/ipc/screen.test.ts
```

Expected: FAIL because the handlers are absent.

- [ ] **Step 3: Implement fixed capabilities**

`shell.openExternal` allows only `https:` with no credentials; development additionally allows `http://localhost`, `http://127.0.0.1` and `http://[::1]`. File selection uses a native open dialog only when needed by OS integrations, but the chat attachment workflow uses `<input type="file">`; selected absolute paths never cross preload. Save requests carry `{ suggestedName, mimeType, bytes }`, main chooses the destination and writes the bytes.

Screen capture exposes:

```typescript
/** 可供用户选择的屏幕缩略图。 */
export interface ScreenSource {
  id: string
  name: string
  thumbnailDataUrl: string
}
```

The renderer may convert the chosen PNG data URL into a `File`; no arbitrary `file://` or custom local-file protocol is registered.

- [ ] **Step 4: Run GREEN and quality scripts**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop typecheck
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop lint
```

Expected: all exit 0.

- [ ] **Step 5: Commit and continue**

```bash
git add apps/desktop/src/main/ipc apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/preload/index.ts
git commit -m "feat(desktop): add controlled system bridges"
```

### Task 7: Add System Tray Behavior

**Files:**

- Create: `apps/desktop/src/main/tray/index.ts`
- Create: `apps/desktop/src/main/tray/resources.ts`
- Modify: `apps/desktop/src/main/lifecycle.ts`
- Modify: `apps/desktop/src/main/windows/manager.ts`
- Test: `apps/desktop/src/main/tray/index.test.ts`

**Interfaces:**

- Consumes: `WindowManager`, `DesktopPreferences.closeToTray`, platform resource resolver.
- Produces: `TrayService.setup(): void`, `TrayService.dispose(): void`, explicit quitting state.

- [ ] **Step 1: Write failing tray tests**

```typescript
it('hides main on close when closeToTray is enabled', () => {
  prefs.get.mockReturnValue({ ...DEFAULT_PREFS, closeToTray: true })
  const event = { preventDefault: vi.fn() }
  mainWindow.emit('close', event)
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(mainWindow.hide).toHaveBeenCalledOnce()
})

it('allows a real quit from the tray command', () => {
  trayMenu.click('退出元AI')
  expect(appState.isQuitting()).toBe(true)
  expect(app.quit).toHaveBeenCalledOnce()
})
```

Also assert closeToTray=false closes normally, Windows/Linux click focuses main, macOS click does not duplicate the context menu, resource paths resolve from `process.resourcesPath` when packaged, and dispose destroys the Tray once.

- [ ] **Step 2: Observe RED**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit -- src/main/tray/index.test.ts
```

Expected: FAIL because TrayService is absent.

- [ ] **Step 3: Implement tray lifecycle**

Menu items are exactly `打开主界面`, `设置...`, separator, `退出元AI`. Main close reads the latest preference. `before-quit`, menu quit and tray quit all set the same `isQuitting` flag; only that flag bypasses hide-on-close. Resource resolution is centralized and does not use `__dirname` for packaged resources. Before Task 23 generates platform assets, development uses the existing `apps/mobile/assets/icon.png` as an explicit fallback; packaged builds require generated platform resources and fail closed when one is absent.

- [ ] **Step 4: Verify, commit and continue**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop typecheck
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop lint
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop dev
git add apps/desktop/src/main/tray apps/desktop/src/main/lifecycle.ts apps/desktop/src/main/windows/manager.ts
git commit -m "feat(desktop): add system tray behavior"
```

### Task 8: Add Native Application Menus

**Files:**

- Create: `apps/desktop/src/main/menu/index.ts`
- Create: `apps/desktop/src/main/menu/mac.ts`
- Create: `apps/desktop/src/main/menu/win-linux.ts`
- Test: `apps/desktop/src/main/menu/index.test.ts`
- Modify: `apps/desktop/src/main/lifecycle.ts`

**Interfaces:**

- Consumes: `WindowManager.sendWhenReady`, Electron role menu items.
- Produces: typed `MenuCommand = 'new-conversation' | 'find-conversation' | 'toggle-theme'` and platform menu templates.

- [ ] **Step 1: Write failing platform menu tests**

```typescript
it('builds the macOS application menu with standard roles', () => {
  const template = buildMacMenu(deps)
  expect(template[0]?.label).toBe('元AI')
  expect(findRole(template, 'quit')).toBeDefined()
  expect(findAccelerator(template, 'CommandOrControl+,')).toBeDefined()
})

it('sends renderer commands only through the ready queue', () => {
  runMenuCommand('new-conversation')
  expect(manager.sendWhenReady).toHaveBeenCalledWith('main', IPC.events.menuCommand, {
    command: 'new-conversation',
  })
})
```

Test Windows/Linux File/Edit/View/Window/Help groups, macOS app menu, standard undo/cut/copy/paste/selectAll/minimize/close roles, `CmdOrCtrl+N`, `CmdOrCtrl+K`, `CmdOrCtrl+,`, and fixed GitHub repository/issues HTTPS links.

- [ ] **Step 2: Observe RED**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit -- src/main/menu/index.test.ts
```

Expected: FAIL because menu builders are absent.

- [ ] **Step 3: Implement, verify, commit and continue**

Menu callbacks call typed services only; no renderer-supplied URL or command reaches Electron. Run:

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop typecheck
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop lint
git add apps/desktop/src/main/menu apps/desktop/src/main/lifecycle.ts
git commit -m "feat(desktop): add native application menus"
```

### Task 9: Add Configurable Global Shortcut

**Files:**

- Create: `apps/desktop/src/main/shortcuts/global.ts`
- Test: `apps/desktop/src/main/shortcuts/global.test.ts`
- Modify: `apps/desktop/src/main/ipc/prefs.ts`
- Modify: `apps/desktop/src/main/lifecycle.ts`
- Modify: `apps/desktop/src/shared/ipc-contract.ts`

**Interfaces:**

- Consumes: `DesktopPreferences.globalShortcut`, `WindowManager.focusMain()`.
- Produces: `ShortcutStatus { accelerator: string | null; registered: boolean; errorCode?: 'CONFLICT' | 'INVALID' }`.

- [ ] **Step 1: Write failing registration tests**

```typescript
it('keeps the old binding when a replacement conflicts', () => {
  globalShortcut.register.mockReturnValueOnce(true).mockReturnValueOnce(false)
  service.bind('CommandOrControl+Alt+Y')
  expect(service.bind('CommandOrControl+Shift+Y')).toEqual({
    accelerator: 'CommandOrControl+Alt+Y',
    registered: true,
    errorCode: 'CONFLICT',
  })
  expect(globalShortcut.register).toHaveBeenLastCalledWith(
    'CommandOrControl+Alt+Y',
    expect.any(Function)
  )
})
```

Also test invalid/empty accelerators, successful replacement unregisters old after the new probe succeeds, callback restores/focuses main, setup is idempotent, and `will-quit` unregisters all.

- [ ] **Step 2: Observe RED**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit -- src/main/shortcuts/global.test.ts
```

Expected: FAIL because ShortcutService is absent.

- [ ] **Step 3: Implement, verify, commit and continue**

Default accelerator is `CommandOrControl+Alt+Y`. Preference update returns the actual status; on conflict the persisted value remains the old binding. Run:

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop typecheck
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop lint
git add apps/desktop/src/main/shortcuts apps/desktop/src/main/ipc/prefs.ts apps/desktop/src/main/lifecycle.ts apps/desktop/src/shared/ipc-contract.ts
git commit -m "feat(desktop): add configurable global shortcut"
```

### Task 10: Add Cross-Platform Auto Launch

**Files:**

- Create: `apps/desktop/src/main/system/auto-launch.ts`
- Test: `apps/desktop/src/main/system/auto-launch.test.ts`
- Create: `apps/desktop/src/main/ipc/system.ts`
- Modify: `apps/desktop/src/main/ipc/index.ts`
- Modify: `apps/desktop/src/shared/ipc-contract.ts`
- Modify: `apps/desktop/src/preload/index.ts`

**Interfaces:**

- Consumes: Electron `app`, platform, owned autostart path.
- Produces: `getAutoLaunch(): Promise<boolean>`, `setAutoLaunch(enabled: boolean): Promise<boolean>`, `getSystemInfo(): SystemInfo`.

- [ ] **Step 1: Write failing platform tests**

```typescript
it.each(['win32', 'darwin'] as const)('uses login item settings on %s', async (platform) => {
  const service = createAutoLaunchService({ platform, app, fs })
  await service.set(true)
  expect(app.setLoginItemSettings).toHaveBeenCalledWith(
    expect.objectContaining({ openAtLogin: true, path: process.execPath })
  )
})

it('writes only the owned Linux desktop entry with mode 0600', async () => {
  await linuxService.set(true)
  expect(writeFile).toHaveBeenCalledWith(
    expect.stringMatching(/\.config\/autostart\/yuanai\.desktop$/),
    expect.stringContaining('X-GNOME-Autostart-enabled=true'),
    { mode: 0o600 }
  )
})
```

Test disable removes only `yuanai.desktop`, Linux Exec quoting, corrupt/foreign files are not overwritten, system info contains only platform/arch/appVersion/Electron/Chrome/isPackaged, and untrusted senders are rejected.

- [ ] **Step 2: Observe RED**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit -- src/main/system/auto-launch.test.ts
```

Expected: FAIL because auto-launch service is absent.

- [ ] **Step 3: Implement, verify, commit and continue**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop typecheck
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop lint
git add apps/desktop/src/main/system apps/desktop/src/main/ipc/system.ts apps/desktop/src/main/ipc/index.ts apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/preload/index.ts
git commit -m "feat(desktop): add cross-platform auto launch"
```

### Task 11: Bootstrap Six Renderer Entries Without Storage Races

**Files:**

- Modify: `apps/desktop/electron.vite.config.ts`
- Create: `apps/desktop/src/renderer/shared/bootstrap.ts`
- Create: `apps/desktop/src/renderer/shared/desktop-adapter.ts`
- Create: `apps/desktop/src/renderer/shared/api-url.ts`
- Create: `apps/desktop/src/renderer/shared/RendererRoot.tsx`
- Create: `apps/desktop/src/renderer/shared/QueryProvider.tsx`
- Create: `apps/desktop/src/renderer/shared/I18nProvider.tsx`
- Create: `apps/desktop/src/renderer/shared/ThemeProvider.tsx`
- Create: `apps/desktop/src/renderer/shared/LiveAnnouncer.tsx`
- Create: `apps/desktop/src/renderer/shared/desktop.css`
- Create: `apps/desktop/src/renderer/shared/locales/en.json`
- Create: `apps/desktop/src/renderer/shared/locales/zh-CN.json`
- Modify: `apps/desktop/src/renderer/{main,login,settings,about,artifact,oauth}/index.html`
- Modify: `apps/desktop/src/renderer/{main,login,settings,about,artifact,oauth}/entry.tsx`
- Modify: `apps/desktop/src/renderer/{main,login,settings,about,artifact,oauth}/App.tsx`
- Test: `apps/desktop/src/renderer/shared/bootstrap.test.ts`
- Test: `apps/desktop/src/renderer/shared/ThemeProvider.test.tsx`
- Test: `apps/desktop/src/renderer/shared/I18nProvider.test.tsx`
- Test: `apps/desktop/tests/integration/renderer-entrypoints.test.ts`

**Interfaces:**

- Consumes: `setPlatformAdapter`, `setApiBaseUrl`, token callbacks, `window.yuanai` bridge, Web locale JSON.
- Produces: `bootstrapDesktop(): Promise<DesktopBootstrap>`, `desktopAdapter: PlatformAdapter`, six buildable roots.

- [ ] **Step 1: Write failing bootstrap and provider tests**

```typescript
it('registers adapter and API URL before importing stores or mounting React', async () => {
  const events: string[] = []
  await bootstrapDesktop({
    setAdapter: () => events.push('adapter'),
    setApiUrl: () => events.push('api'),
    importStores: async () => {
      events.push('stores')
      return stores
    },
    mount: () => events.push('mount'),
  })
  expect(events).toEqual(['adapter', 'api', 'stores', 'mount'])
})

it.each([
  'https://api.example.com/api/v1',
  'http://localhost:8000/api/v1',
  'http://127.0.0.1:8000/api/v1',
  'http://[::1]:8000/api/v1',
])('accepts safe Desktop API URL %s', (url) => {
  expect(validateDesktopApiBaseUrl(url)).toBe(url)
})

it('rejects cleartext remote Desktop API URLs', () => {
  expect(() => validateDesktopApiBaseUrl('http://api.example.com/api/v1')).toThrow()
})
```

Theme tests cover auto/light/dark, initial system theme from `window.yuanai.theme.get()`, main-process `nativeTheme` change broadcasts through `window.yuanai.theme.onChanged`, unsubscribe cleanup, fixed small/medium/large font tokens, compact/standard/loose density and reduced motion. I18n tests merge Web `en.json`/`zh-CN.json` with Desktop-only keys, switch immediately across windows and persist through adapter storage. Entry tests assert Vite input has the exact six key/path mappings, every HTML file has exactly one `#root`, and its module script points to the `entry.tsx` in the same entry directory.

- [ ] **Step 2: Observe RED**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit -- src/renderer/shared/bootstrap.test.ts src/renderer/shared/ThemeProvider.test.tsx src/renderer/shared/I18nProvider.test.tsx
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:integration -- renderer-entrypoints.test.ts
```

Expected: FAIL because the shared providers and race-free bootstrap are absent from the Task 2 entry skeletons.

- [ ] **Step 3: Implement Desktop adapter semantics**

`desktopAdapter.stream` uses authenticated fetch plus `eventsource-parser`; abort closes cleanly and never treats user abort as error. `storage` delegates to validated preference KV. `authStorage` stores in encrypted IPC when remembered, otherwise `sessionStorage`; changing remembered to false removes the encrypted copy before the next persist. `secureStorage` always uses encrypted IPC. Cookie callbacks are omitted.

```typescript
/** Desktop 平台适配器，将 Core 的存储和流接口桥接到安全 preload API。 */
export const desktopAdapter: PlatformAdapter = {
  stream: desktopStream,
  storage: desktopStorage,
  secureStorage: desktopSecureStorage,
  authStorage: desktopAuthStorage,
  setAuthRemembered,
  isAuthRemembered,
}
```

- [ ] **Step 4: Implement race-free bootstrap and roots**

`entry.tsx` imports only `bootstrapDesktop`; the App module is dynamically imported after adapter registration. Bootstrap first awaits `window.yuanai.runtime.getConfig()`, validates the returned `AppRuntimeConfig` again at the trust boundary, registers the adapter, sets that config's API URL, dynamically imports `useAuthStore` and `usePrefsStore`, registers token/refresh/failure callbacks, awaits both `persist.rehydrate()` promises, then mounts. Auth failure clears state and asks main to open/focus LoginWindow. Each root includes a skip link, one semantic `<main id="main-content">`, providers and live announcer.

CSS uses `minmax(0, 1fr)`, `overflow-wrap: anywhere`, fixed token font sizes and `@container` layout changes; it contains `prefers-reduced-motion` and visible `:focus-visible`. It must not contain `font-size: *vw`, negative letter spacing or global horizontal overflow hiding.

- [ ] **Step 5: Run GREEN, build and entry scan**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:integration
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop typecheck
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop lint
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop build
```

Expected: all exit 0; `apps/desktop/out/renderer` contains `main`, `login`, `settings`, `about`, `artifact`, `oauth` HTML entries.

- [ ] **Step 6: Commit and continue**

```bash
git add apps/desktop/electron.vite.config.ts apps/desktop/src/renderer apps/desktop/tests/integration/renderer-entrypoints.test.ts
git commit -m "feat(desktop): bootstrap six renderer entries"
```

### Task 12: Implement Email Authentication Windows

**Files:**

- Replace: `apps/desktop/src/renderer/login/App.tsx`
- Create: `apps/desktop/src/renderer/login/pages/LoginPage.tsx`
- Create: `apps/desktop/src/renderer/login/pages/RegisterPage.tsx`
- Create: `apps/desktop/src/renderer/login/pages/ForgotPasswordPage.tsx`
- Create: `apps/desktop/src/renderer/login/components/AuthShell.tsx`
- Create: `apps/desktop/src/renderer/login/components/PasswordInput.tsx`
- Create: `apps/desktop/src/renderer/login/components/StrengthBar.tsx`
- Create: `apps/desktop/src/renderer/login/components/OtpInput.tsx`
- Create: `apps/desktop/src/renderer/login/auth.css`
- Modify: `apps/desktop/src/renderer/shared/locales/en.json`
- Modify: `apps/desktop/src/renderer/shared/locales/zh-CN.json`
- Test: `apps/desktop/src/renderer/login/pages/LoginPage.test.tsx`
- Test: `apps/desktop/src/renderer/login/pages/RegisterPage.test.tsx`
- Test: `apps/desktop/src/renderer/login/pages/ForgotPasswordPage.test.tsx`
- Test: `apps/desktop/tests/integration/auth-flow.test.tsx`

**Interfaces:**

- Consumes: Core `useLogin`, `useRegister`, `useSendVerifyCode`, `useResetPassword`; window bridge.
- Produces: hash routes `/login`, `/register`, `/forgot`; successful auth opens MainWindow and closes the sender window.

- [ ] **Step 1: Write failing page behavior tests**

```typescript
it('persists the remember choice and opens main after login', async () => {
  renderLogin()
  await user.type(screen.getByLabelText('邮箱'), 'test@example.com')
  await user.type(screen.getByLabelText('密码'), 'Test1234!')
  await user.click(screen.getByRole('checkbox', { name: /记住我/ }))
  await user.click(screen.getByRole('button', { name: '登录' }))
  await waitFor(() =>
    expect(login).toHaveBeenCalledWith(expect.objectContaining({ remember: true }))
  )
  expect(window.yuanai.window.openMain).toHaveBeenCalledOnce()
})

it('pastes six digits and announces resend countdown', async () => {
  renderRegister()
  await user.click(screen.getByRole('button', { name: '发送验证码' }))
  await user.paste('123456')
  expect(screen.getByLabelText('验证码')).toHaveValue('123456')
  expect(screen.getByRole('status')).toHaveTextContent(/秒后重发/)
})
```

Login tests also cover an unchecked “记住我” submitting `remember: false`, invalid email, password visibility, loading/401 error and independent register/forgot windows. Register tests cover username, terms, password confirmation/strength, six-digit OTP, countdown cleanup and server errors. Forgot tests cover reset OTP, two-step validation, success returning to LoginWindow and expired code. Closing Register/Forgot focuses LoginWindow; closing LoginWindow while unauthenticated exits, while an authenticated transition cannot accidentally quit. Integration tests use MSW for login success/failure, register, send-code and reset-password.

- [ ] **Step 2: Observe RED**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit -- src/renderer/login
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:integration -- auth-flow.test.tsx
```

Expected: FAIL because auth pages do not exist.

- [ ] **Step 3: Implement accessible auth forms**

Every input has label, autocomplete and `aria-describedby`; invalid fields set `aria-invalid`; submit loading sets `aria-busy`; error summary uses `role="alert"` and focuses the first invalid input. Login/register/forgot links invoke named window methods rather than mutate the current hash. OAuth controls are not rendered in this task; Task 14 adds them only when the system-browser flow is functional.

- [ ] **Step 4: Run GREEN, regression and build**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:integration
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop typecheck
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop lint
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop build
```

Expected: all exit 0.

- [ ] **Step 5: Commit and continue**

```bash
git add apps/desktop/src/renderer/login apps/desktop/src/renderer/shared/locales
git commit -m "feat(desktop): implement email authentication windows"
```

### Task 13: Add PKCE-Protected One-Time Desktop OAuth Codes

**Files:**

- Modify: `backend/app/schemas/auth.py`
- Modify: `backend/app/services/oauth_service.py`
- Modify: `backend/app/api/v1/auth.py`
- Modify: `packages/types/src/index.ts`
- Test: `backend/tests/integration/test_oauth.py`
- Test: `backend/tests/integration/test_oauth_google.py`

**Interfaces:**

- Consumes: `redirect=desktop`, `code_challenge`, `code_challenge_method=S256`; existing GitHub/Google provider callback.
- Produces: `yuanai://oauth/callback?code=<one-time-code>` or `yuanai://oauth/callback?error=<stable-code>`, and `POST /api/v1/auth/desktop/exchange { code, codeVerifier } -> AuthResponse`; Python keeps the internal field name `code_verifier` with alias `codeVerifier`, while `packages/types` exports the browser-to-server request type.

- [ ] **Step 1: Add failing GitHub and Google security tests**

```python
@pytest.mark.asyncio
async def test_desktop_callback_contains_only_one_time_code(client: AsyncClient) -> None:
    authorize = await client.get(
        "/api/v1/auth/github",
        params={
            "redirect": "desktop",
            "code_challenge": VALID_CHALLENGE,
            "code_challenge_method": "S256",
        },
        follow_redirects=False,
    )
    callback = await complete_mock_provider_callback(client, authorize)
    location = callback.headers["location"]
    assert location.startswith("yuanai://oauth/callback?code=")
    assert "access_token" not in location
    assert "refresh_token" not in location
    assert "code_verifier" not in location


@pytest.mark.asyncio
async def test_desktop_exchange_is_single_use(client: AsyncClient) -> None:
    code = await issue_desktop_code(client, VALID_CHALLENGE)
    first = await client.post(
        "/api/v1/auth/desktop/exchange",
        json={"code": code, "codeVerifier": VALID_VERIFIER},
    )
    replay = await client.post(
        "/api/v1/auth/desktop/exchange",
        json={"code": code, "codeVerifier": VALID_VERIFIER},
    )
    assert first.status_code == 200
    assert replay.status_code == 400
    assert replay.json()["detail"]["code"] == "OAUTH_CODE_INVALID"
```

Add tests for missing/non-S256 challenge, malformed verifier, 60-second expiry, wrong verifier consuming the code, two concurrent exchanges yielding exactly one success, Redis keys containing only SHA-256(code), sanitized captured logs, Web callback tokens unchanged and `mobile=1` deep-link tokens unchanged. A provider denial or provider API failure with a valid Desktop state consumes that state and returns only `yuanai://oauth/callback?error=access_denied` or `?error=oauth_failed`; an expired or malformed state returns a safe HTTP 400 rather than trusting a callback parameter to choose a custom-protocol target.

- [ ] **Step 2: Observe RED**

```bash
cd backend && PYTHONPATH="" uv run pytest tests/integration/test_oauth.py tests/integration/test_oauth_google.py -q
```

Expected: FAIL because Desktop target and exchange endpoint are absent.

- [ ] **Step 3: Implement target-aware state and atomic code exchange**

```python
class DesktopOAuthExchangeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    code: Annotated[str, StringConstraints(min_length=43, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")]
    code_verifier: Annotated[
        str,
        StringConstraints(min_length=43, max_length=128, pattern=r"^[A-Za-z0-9._~-]+$"),
    ] = Field(alias="codeVerifier")
```

OAuth state is JSON `{target, code_challenge}` with a 300-second TTL and is consumed by Redis `GETDEL`. `mobile=1` and `redirect=desktop` together return 422. Provider callback creates 32 random bytes, encodes URL-safe without padding, hashes the code for Redis key material, and stores `{auth_response, code_challenge}` for 60 seconds. Exchange performs `GETDEL` before verifier comparison, computes base64url-without-padding SHA-256(verifier), then returns the stored `AuthResponse`. A known Desktop state with a provider error is atomically consumed before returning the stable custom-protocol error code; missing/expired state never decides a redirect. No branch logs state, code, verifier or tokens.

- [ ] **Step 4: Run focused and backend quality regressions**

```bash
cd backend && PYTHONPATH="" uv run pytest tests/integration/test_oauth.py tests/integration/test_oauth_google.py -q
cd backend && PYTHONPATH="" uv run ruff check app tests
cd backend && PYTHONPATH="" uv run mypy app
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/types typecheck
```

Expected: all exit 0; Web and Mobile OAuth cases remain green.

- [ ] **Step 5: Commit and continue**

```bash
git add backend/app/schemas/auth.py backend/app/services/oauth_service.py backend/app/api/v1/auth.py backend/tests/integration/test_oauth.py backend/tests/integration/test_oauth_google.py packages/types/src/index.ts
git commit -m "feat(backend): add secure desktop oauth exchange"
```

### Task 14: Handle OAuth And Chat Deep Links In Desktop

**Files:**

- Create: `apps/desktop/src/main/oauth/pkce.ts`
- Create: `apps/desktop/src/main/oauth/session.ts`
- Create: `apps/desktop/src/main/oauth/service.ts`
- Create: `apps/desktop/src/main/ipc/oauth.ts`
- Modify: `apps/desktop/src/main/ipc/index.ts`
- Modify: `apps/desktop/src/main/lifecycle.ts`
- Modify: `apps/desktop/src/main/protocol/parser.ts`
- Modify: `apps/desktop/src/main/windows/manager.ts`
- Modify: `apps/desktop/src/shared/ipc-contract.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/login/pages/LoginPage.tsx`
- Replace: `apps/desktop/src/renderer/oauth/App.tsx`
- Test: `apps/desktop/src/main/oauth/session.test.ts`
- Test: `apps/desktop/src/main/oauth/service.test.ts`
- Test: `apps/desktop/src/main/protocol/parser.test.ts`
- Test: `apps/desktop/src/renderer/login/OAuthFlow.test.tsx`

**Interfaces:**

- Consumes: backend Desktop authorize/exchange contract, parsed deep-link queue.
- Produces: `startOAuth(provider)`, one in-memory `OAuthSession`, one delivered `OAuthResult`, main/chat focus routing.

- [ ] **Step 1: Write failing PKCE and protocol tests**

```typescript
it('opens an authorize URL with challenge but never verifier or tokens', async () => {
  await service.start('github')
  const opened = new URL(shell.openExternal.mock.calls[0]?.[0])
  expect(opened.searchParams.get('redirect')).toBe('desktop')
  expect(opened.searchParams.get('code_challenge_method')).toBe('S256')
  expect(opened.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(opened.href).not.toContain('code_verifier')
  expect(opened.href).not.toContain('token')
})

it('exchanges a callback exactly once and queues the result for a ready renderer', async () => {
  await service.start('google')
  await service.handleCallback({ type: 'oauth', code: ONE_TIME_CODE })
  await service.handleCallback({ type: 'oauth', code: ONE_TIME_CODE })
  expect(fetch).toHaveBeenCalledOnce()
  expect(manager.sendWhenReady).toHaveBeenCalledWith(
    'login',
    IPC.events.oauthResult,
    expect.objectContaining({ status: 'success' })
  )
})
```

Test initial argv, second-instance and open-url paths; duplicate callbacks; callback without active session; wrong host/path; token-bearing URL rejection; `access_denied`/`oauth_failed` renderer error presentation; exchange 400/network errors; OAuth loading close; successful `setAuth(..., remember=true)` and main focus; chat deep link focuses/navigates main only after authentication.

- [ ] **Step 2: Observe RED**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit -- src/main/oauth src/main/protocol/parser.test.ts src/renderer/login/OAuthFlow.test.tsx
```

Expected: FAIL because PKCE session and OAuth IPC are absent.

- [ ] **Step 3: Implement main-process PKCE ownership**

Generate verifier with `crypto.randomBytes(32)`, keep it only in main memory, derive S256 challenge, open the system browser and OAuth window. Callback code is exchanged by main against `runtimeConfig.apiBaseUrl` with JSON body `{ code, codeVerifier }`; response is structurally validated before IPC. The session is cleared before network exchange to prevent duplicates. Error objects contain stable codes and user-safe messages only.

Renderer adds the two accessible GitHub/Google controls only in this task. It receives one `OAuthResult`, calls Core auth store, opens MainWindow, closes Login/OAuth windows and removes its listener. StrictMode mount/unmount cannot cause a second exchange because exchange ownership is in main.

- [ ] **Step 4: Run GREEN and regression scripts**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop typecheck
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop lint
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop build
rg -n 'access_token|refresh_token|code_verifier' apps/desktop/src/main/protocol apps/desktop/src/main/lifecycle.ts
```

Expected: scripts exit 0; final scan finds only explicit rejection test strings, never URL construction or logging.

- [ ] **Step 5: Commit and continue**

```bash
git add apps/desktop/src/main/oauth apps/desktop/src/main/ipc apps/desktop/src/main/lifecycle.ts apps/desktop/src/main/protocol apps/desktop/src/main/windows apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/login apps/desktop/src/renderer/oauth
git commit -m "feat(desktop): handle secure oauth deep links"
```

### Task 15: Implement Conversation Workspace And Streaming Chat

**Files:**

- Replace: `apps/desktop/src/renderer/main/App.tsx`
- Create: `apps/desktop/src/renderer/main/ChatWorkspace.tsx`
- Create: `apps/desktop/src/renderer/main/components/Sidebar.tsx`
- Create: `apps/desktop/src/renderer/main/components/ConversationItem.tsx`
- Create: `apps/desktop/src/renderer/main/components/ChatToolbar.tsx`
- Create: `apps/desktop/src/renderer/main/components/Composer.tsx`
- Create: `apps/desktop/src/renderer/main/components/MessageList.tsx`
- Create: `apps/desktop/src/renderer/main/components/UserMessage.tsx`
- Create: `apps/desktop/src/renderer/main/components/AIMessage.tsx`
- Create: `apps/desktop/src/renderer/main/components/ConfirmDialog.tsx`
- Create: `apps/desktop/src/renderer/main/hooks/useDesktopNavigation.ts`
- Create: `apps/desktop/src/renderer/main/utils/chat.ts`
- Create: `apps/desktop/src/renderer/main/chat.css`
- Modify: `apps/desktop/src/renderer/shared/locales/en.json`
- Modify: `apps/desktop/src/renderer/shared/locales/zh-CN.json`
- Test: `apps/desktop/src/renderer/main/ChatWorkspace.test.tsx`
- Test: `apps/desktop/src/renderer/main/components/Sidebar.test.tsx`
- Test: `apps/desktop/src/renderer/main/components/Composer.test.tsx`
- Test: `apps/desktop/tests/integration/chat-flow.test.tsx`

**Interfaces:**

- Consumes: Core conversation hooks, model hook, auth/chat stores and `useStream`.
- Produces: routes `/` and `/chat/:conversationId`, CRUD workspace, temporary chat, one active stream.

- [ ] **Step 1: Write failing workspace tests**

```typescript
it('creates a conversation before streaming its first message', async () => {
  renderWorkspace({ route: '/' })
  await user.type(screen.getByRole('textbox', { name: '输入消息' }), '你好')
  await user.keyboard('{Enter}')
  await waitFor(() => expect(createConversation).toHaveBeenCalledOnce())
  expect(sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ conversationId: CREATED_ID, content: '你好' })
  )
})

it('stops only the active stream and announces cancellation', async () => {
  renderWorkspace({ streaming: true })
  await user.click(screen.getByRole('button', { name: '停止生成' }))
  expect(stop).toHaveBeenCalledOnce()
  expect(screen.getByRole('status')).toHaveTextContent('已停止生成')
})
```

Sidebar tests cover cursor list loading, today/yesterday/week/pinned grouping, search, select, inline rename, pin/unpin, single delete, multi-select delete and empty/error/loading states. Composer tests cover Enter send, Shift+Enter newline, IME composition, model selection, web-search/thinking pressed state, disabled auth/loading states and temporary-chat attachment prohibition. `useDesktopNavigation` tests consume the typed Task 8 `menuCommand` event: `new` creates/focuses the empty route, `find` focuses conversation search, and `toggle-theme` switches the current light/dark setting. Integration test loads list -> opens conversation -> creates conversation -> receives `message_start`, deltas, `message_end`, `[DONE]` from MSW.

- [ ] **Step 2: Observe RED**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit -- src/renderer/main/ChatWorkspace.test.tsx src/renderer/main/components/Sidebar.test.tsx src/renderer/main/components/Composer.test.tsx
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:integration -- chat-flow.test.tsx
```

Expected: FAIL because workspace components are absent.

- [ ] **Step 3: Implement conversation and stream state**

Use Core query cache as server state and Zustand only for active/streaming UI state. An unsaved first message waits for create success, seeds the empty messages cache and then streams. Optimistic user/assistant messages deduplicate against returned IDs. Route/deep-link changes stop the old stream before switching. Temporary mode calls Core temporary stream, never creates history and clears when exited.

- [ ] **Step 4: Implement responsive, keyboard-first shell**

Main layout tracks are `sidebar minmax(0, 1fr) optional-artifact`; sidebar is 260 px at wide widths. The main workspace is an inline-size container: at widths below 1100 px, the sidebar becomes a focus-trapped drawer and the optional Artifact panel becomes an overlay; at 1100 px or wider, the multi-column layout is restored. Tests exercise both 960 px and 1024 px container widths so this branch remains reachable despite MainWindow's 960 px minimum. Conversation list uses semantic navigation/list markup; toolbar buttons use Lucide icons plus tooltips and accessible names; composer controls have stable dimensions. Streaming content uses `aria-live="polite"` and announces only phase-level updates (started/completed/stopped/error), never the full message again for every token.

- [ ] **Step 5: Run GREEN and regressions**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:integration
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop typecheck
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop lint
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop build
```

Expected: all exit 0.

- [ ] **Step 6: Commit and continue**

```bash
git add apps/desktop/src/renderer/main apps/desktop/src/renderer/shared/locales
git commit -m "feat(desktop): implement streaming chat workspace"
```

### Task 16: Add Rich Messages, Actions And Sharing

**Files:**

- Create: `apps/desktop/src/renderer/main/components/MarkdownContent.tsx`
- Create: `apps/desktop/src/renderer/main/components/CodeBlock.tsx`
- Create: `apps/desktop/src/renderer/main/components/CodeHighlight.tsx`
- Create: `apps/desktop/src/renderer/main/components/ThinkBlock.tsx`
- Create: `apps/desktop/src/renderer/main/components/ToolCallRow.tsx`
- Create: `apps/desktop/src/renderer/main/components/MediaPart.tsx`
- Create: `apps/desktop/src/renderer/main/components/MessageOutline.tsx`
- Create: `apps/desktop/src/renderer/main/components/ShareDialog.tsx`
- Create: `apps/desktop/src/renderer/main/components/FeedbackDialog.tsx`
- Modify: `apps/desktop/src/renderer/main/components/AIMessage.tsx`
- Modify: `apps/desktop/src/renderer/main/components/UserMessage.tsx`
- Modify: `apps/desktop/src/renderer/main/components/MessageList.tsx`
- Modify: `apps/desktop/src/renderer/main/ChatWorkspace.tsx`
- Modify: `apps/desktop/src/renderer/main/chat.css`
- Test: `apps/desktop/src/renderer/main/components/MarkdownContent.test.tsx`
- Test: `apps/desktop/src/renderer/main/components/CodeBlock.test.tsx`
- Test: `apps/desktop/src/renderer/main/components/AIMessage.test.tsx`
- Test: `apps/desktop/src/renderer/main/components/ShareDialog.test.tsx`

**Interfaces:**

- Consumes: Core share hooks, regenerate/edit stream paths, validated `VITE_WEB_URL`, shell/save bridges.
- Produces: GFM/KaTeX/emoji messages, code copy/download, reasoning/tool rows, versions, share lifecycle.

- [ ] **Step 1: Write failing rich-content tests**

```typescript
it('renders safe markdown but never raw executable HTML', () => {
  render(<MarkdownContent content={'[link](https://example.com)\n<script>alert(1)</script>'} />)
  expect(screen.getByRole('link', { name: 'link' })).toBeInTheDocument()
  expect(document.querySelector('script')).toBeNull()
})

it('copies and saves code through controlled capabilities', async () => {
  render(<CodeBlock language="typescript" code="const value = 1" />)
  await user.click(screen.getByRole('button', { name: '复制代码' }))
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('const value = 1')
  await user.click(screen.getByRole('button', { name: '下载代码' }))
  expect(window.yuanai.dialog.saveFile).toHaveBeenCalledWith(
    expect.objectContaining({ suggestedName: 'snippet.ts' })
  )
})
```

Tests cover lazy syntax language loading, GFM tables, KaTeX, emoji, external-link shell routing, collapsed reasoning, tool start/delta/end, media alt text, copy/feedback, edit-and-resend, regenerate, version arrows, outline navigation, share create/update/revoke, expiry/password, clipboard URL and browser open.

- [ ] **Step 2: Observe RED**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit -- src/renderer/main/components
```

Expected: FAIL because rich message modules are absent.

- [ ] **Step 3: Implement renderer-safe rich content**

React Markdown enables `remark-gfm`, `remark-math`, `remark-gemoji`, `rehype-katex`; raw HTML remains disabled. External anchors prevent default and use `shell.openExternal`; internal app links use the hash router. Code highlighting uses async light language registration. Message actions are buttons with stable 32x32 minimum hit areas and tooltips. Share URL is `${validatedWebUrl}/share/${token}` and never a `file://` location.

- [ ] **Step 4: Run GREEN, Web parity regression, commit and continue**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop typecheck
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop lint
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop build
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/web test:unit
git add apps/desktop/src/renderer/main
git commit -m "feat(desktop): add rich messages and sharing"
```

### Task 17: Add File, Camera And Screen Attachments

**Files:**

- Create: `apps/desktop/src/renderer/main/hooks/useAttachments.ts`
- Create: `apps/desktop/src/renderer/main/components/AttachmentMenu.tsx`
- Create: `apps/desktop/src/renderer/main/components/AttachmentTray.tsx`
- Create: `apps/desktop/src/renderer/main/components/CameraModal.tsx`
- Create: `apps/desktop/src/renderer/main/components/ScreenSourceDialog.tsx`
- Create: `apps/desktop/src/renderer/shared/media-capture.ts`
- Modify: `apps/desktop/src/renderer/main/components/Composer.tsx`
- Modify: `apps/desktop/src/renderer/main/ChatWorkspace.tsx`
- Modify: `apps/desktop/src/renderer/main/chat.css`
- Test: `apps/desktop/src/renderer/main/hooks/useAttachments.test.ts`
- Test: `apps/desktop/src/renderer/main/components/AttachmentTray.test.tsx`
- Test: `apps/desktop/src/renderer/main/components/CameraModal.test.tsx`
- Test: `apps/desktop/src/renderer/main/components/ScreenSourceDialog.test.tsx`
- Test: `apps/desktop/tests/integration/file-chat-flow.test.tsx`

**Interfaces:**

- Consumes: Core `useFileUpload`/smart upload, `<input type="file">`, camera media stream, screen bridge.
- Produces: attachment queue with `localId`, preview URL, progress/error state and uploaded `fileId`.

- [ ] **Step 1: Write failing queue and capture tests**

```typescript
it('sends only successfully uploaded file IDs', async () => {
  const { result } = renderHook(() => useAttachments())
  await act(() => result.current.add([IMAGE_FILE, PDF_FILE]))
  upload.mockResolvedValueOnce({ id: 'file-image' }).mockRejectedValueOnce(new Error('failed'))
  await act(() => result.current.uploadAll())
  expect(result.current.readyFileIds).toEqual(['file-image'])
  expect(result.current.items[1]?.status).toBe('error')
})

it('stops every camera track when the modal closes', async () => {
  render(<CameraModal open onCapture={vi.fn()} onClose={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: '关闭相机' }))
  expect(videoTrack.stop).toHaveBeenCalledOnce()
})
```

Test object URL cleanup, duplicate/oversize/type rejection, upload progress, retry/remove/cancel, image/document states, camera permission denial, one-frame JPEG capture, screen source selection and data URL conversion. Integration test asserts stream receives successful `fileIds`, failed/pending uploads block send, and temporary chat disables the menu.

- [ ] **Step 2: Observe RED**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit -- src/renderer/main/hooks/useAttachments.test.ts src/renderer/main/components/AttachmentTray.test.tsx src/renderer/main/components/CameraModal.test.tsx src/renderer/main/components/ScreenSourceDialog.test.tsx
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:integration -- file-chat-flow.test.tsx
```

Expected: FAIL because attachment workflow is absent.

- [ ] **Step 3: Implement attachments without local path exposure**

The hidden multiple file input invokes the OS picker and supplies browser `File` objects directly. Camera uses video-only `getUserMedia`; screen uses sanitized thumbnails returned by the bridge. Queue respects Core file limits and uses existing smart upload for instant/direct/multipart paths. No `fetch(file://...)`, path IPC, microphone request or voice control is introduced.

- [ ] **Step 4: Verify absence of deferred speech scope, commit and continue**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:integration
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop typecheck
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop lint
rg -n 'transcribe|MediaRecorder|getUserMedia\(\{\s*audio' apps/desktop/src backend/app
```

Expected: scripts exit 0; scan has no new Desktop/backend speech implementation.

```bash
git add apps/desktop/src/renderer/main apps/desktop/src/renderer/shared/media-capture.ts apps/desktop/tests/integration/file-chat-flow.test.tsx
git commit -m "feat(desktop): add chat attachment workflows"
```

### Task 18: Add Embedded And Detached Artifact Preview

**Files:**

- Create: `apps/desktop/src/renderer/main/components/ArtifactPanel.tsx`
- Modify: `apps/desktop/src/renderer/main/components/CodeBlock.tsx`
- Modify: `apps/desktop/src/renderer/main/ChatWorkspace.tsx`
- Modify: `apps/desktop/src/renderer/main/chat.css`
- Replace: `apps/desktop/src/renderer/artifact/App.tsx`
- Create: `apps/desktop/src/renderer/artifact/ArtifactView.tsx`
- Create: `apps/desktop/src/renderer/artifact/artifact.css`
- Create: `apps/desktop/src/renderer/shared/artifact-message.ts`
- Modify: `apps/desktop/src/shared/guards.ts`
- Modify: `apps/desktop/src/main/windows/manager.ts`
- Test: `apps/desktop/src/renderer/main/components/ArtifactPanel.test.tsx`
- Test: `apps/desktop/src/renderer/artifact/ArtifactView.test.tsx`
- Test: `apps/desktop/src/renderer/shared/artifact-message.test.ts`
- Test: `apps/desktop/src/renderer/main/components/CodeBlock.test.tsx`

**Interfaces:**

- Consumes: Core `ArtifactPayload`, `buildRunSrcDoc`, `isRunnableLang`; queued artifact IPC.
- Produces: embedded view/run/data modes and multi-instance detached windows.

- [ ] **Step 1: Write failing artifact tests**

```typescript
it('runs generated content only in a sandboxed iframe', () => {
  render(<ArtifactPanel payload={HTML_PAYLOAD} />)
  const frame = screen.getByTitle('Artifact 运行预览')
  expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms')
  expect(frame.getAttribute('allow') ?? '').not.toContain('camera')
})

it('rejects malformed or oversized detached payloads', () => {
  expect(parseArtifactInit({ artifactId: 'x', code: 'a'.repeat(2_000_001) })).toBeNull()
  expect(parseArtifactInit(VALID_ARTIFACT)).toEqual(VALID_ARTIFACT)
})
```

Test source editing, copy, view/run switch, JSON tree, CSV table, console capture, fullscreen, panel close retaining last payload for exit animation, detach command, `did-finish-load` delivery, two windows with isolated payloads and cleanup.

- [ ] **Step 2: Observe RED**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit -- src/renderer/main/components/ArtifactPanel.test.tsx src/renderer/artifact/ArtifactView.test.tsx src/renderer/shared/artifact-message.test.ts
```

Expected: FAIL because Artifact Desktop components are absent.

- [ ] **Step 3: Implement isolated preview and payload validation**

Artifact payload accepts only known language/mode strings, a UUID/window nonce and at most 2 MiB source. `postMessage` console entries are accepted only from the exact iframe `contentWindow`, exact origin semantics and validated `{level,args}` structure with per-entry and total caps. Detached payload never enters URL/query/hash.

- [ ] **Step 4: Run GREEN, build, commit and continue**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop typecheck
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop lint
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop build
git add apps/desktop/src/renderer/main apps/desktop/src/renderer/artifact apps/desktop/src/renderer/shared/artifact-message.ts apps/desktop/src/shared/guards.ts apps/desktop/src/main/windows/manager.ts
git commit -m "feat(desktop): add detached artifact previews"
```

### Task 19: Implement Seven Settings Sections And About Window

**Files:**

- Replace: `apps/desktop/src/renderer/settings/App.tsx`
- Create: `apps/desktop/src/renderer/settings/components/SettingsShell.tsx`
- Create: `apps/desktop/src/renderer/settings/components/ProfileSection.tsx`
- Create: `apps/desktop/src/renderer/settings/components/SecuritySection.tsx`
- Create: `apps/desktop/src/renderer/settings/components/AppearanceSection.tsx`
- Create: `apps/desktop/src/renderer/settings/components/NotificationSection.tsx`
- Create: `apps/desktop/src/renderer/settings/components/LanguageSection.tsx`
- Create: `apps/desktop/src/renderer/settings/components/DesktopSection.tsx`
- Create: `apps/desktop/src/renderer/settings/components/AboutSection.tsx`
- Create: `apps/desktop/src/renderer/settings/components/SettingsDialogs.tsx`
- Create: `apps/desktop/src/renderer/settings/settings.css`
- Replace: `apps/desktop/src/renderer/about/App.tsx`
- Create: `apps/desktop/src/renderer/about/about.css`
- Modify: `apps/desktop/src/renderer/shared/locales/en.json`
- Modify: `apps/desktop/src/renderer/shared/locales/zh-CN.json`
- Test: `apps/desktop/src/renderer/settings/App.test.tsx`
- Test: `apps/desktop/src/renderer/settings/components/DesktopSection.test.tsx`
- Test: `apps/desktop/src/renderer/settings/components/AppearanceSection.test.tsx`
- Test: `apps/desktop/src/renderer/settings/components/LanguageSection.test.tsx`
- Test: `apps/desktop/src/renderer/about/App.test.tsx`
- Test: `apps/desktop/tests/integration/settings-flow.test.tsx`

**Interfaces:**

- Consumes: Core profile/security/preferences/stats hooks, persisted Desktop preferences, shortcut/auto-launch/system/shell bridges. Task 22 adds updater controls to the already-created Desktop section.
- Produces: exactly seven settings sections and standalone AboutWindow.

- [ ] **Step 1: Write failing settings tests**

```typescript
it('renders exactly the seven approved sections', () => {
  renderSettings()
  const labels = [
    '个人资料',
    '账号安全',
    '外观与主题',
    '通知设置',
    '语言与地区',
    '桌面设置',
    '关于与帮助',
  ]
  expect(screen.getAllByRole('tab')).toHaveLength(labels.length)
  for (const label of labels) {
    expect(screen.getByRole('tab', { name: label })).toHaveAccessibleName(label)
  }
})

it('rolls back a shortcut field when registration conflicts', async () => {
  window.yuanai.system.setGlobalShortcut.mockResolvedValue(CONFLICT_STATUS)
  render(<DesktopSection />)
  await user.clear(screen.getByLabelText('全局唤起快捷键'))
  await user.type(screen.getByLabelText('全局唤起快捷键'), 'CommandOrControl+Shift+Y')
  await user.click(screen.getByRole('button', { name: '应用快捷键' }))
  expect(screen.getByLabelText('全局唤起快捷键')).toHaveValue('CommandOrControl+Alt+Y')
  expect(screen.getByRole('alert')).toHaveTextContent('快捷键已被其他应用占用')
})
```

Tests cover avatar/profile/bio/stats; email/password; GitHub/Google unlink; clear conversations/account deletion confirmations; theme/font/density; native/sound/AI-reply switches; language/time/date; close-to-tray; shortcut; auto-launch; version; fixed documentation/repository/issues links. Task 22 adds update preference/state tests together with the updater implementation. Integration uses MSW for profile/security/preferences and mocked IPC for Desktop settings.

- [ ] **Step 2: Observe RED**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit -- src/renderer/settings src/renderer/about
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:integration -- settings-flow.test.tsx
```

Expected: FAIL because settings and about implementations are absent.

- [ ] **Step 3: Implement seven-section accessible settings**

Desktop section order is fixed. Tabs implement roving tabindex with ArrowUp/ArrowDown/Home/End; narrow windows use a select menu rather than horizontally overflowing tabs. Destructive dialogs use `role="alertdialog"`, trap focus, Escape cancel and restore focus. Preference changes update local UI immediately, broadcast to all windows and persist to backend where a matching Web preference exists; Desktop-only values remain in main prefs.

About reads version from system IPC and opens only fixed HTTPS URLs through shell IPC. No in-app marketing panel is added.

- [ ] **Step 4: Run GREEN, regression, commit and continue**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:integration
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop typecheck
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop lint
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop build
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/web test:unit
git add apps/desktop/src/renderer/settings apps/desktop/src/renderer/about apps/desktop/src/renderer/shared/locales
git commit -m "feat(desktop): implement settings and about windows"
```

### Task 20: Add Authenticated AI Completion Event Stream

**Files:**

- Create: `backend/app/services/event_service.py`
- Create: `backend/app/services/notification_service.py`
- Modify: `backend/app/services/push_service.py`
- Modify: `backend/app/api/v1/notifications.py`
- Modify: `backend/app/schemas/notifications.py`
- Modify: `backend/app/api/v1/chat.py`
- Modify: `packages/types/src/index.ts`
- Test: `backend/tests/unit/test_event_service.py`
- Test: `backend/tests/integration/test_notifications.py`
- Test: `backend/tests/integration/test_chat.py`

**Interfaces:**

- Consumes: authenticated current user, committed non-temporary assistant message, Redis Pub/Sub.
- Produces: `GET /api/v1/notifications/events` with SSE event `ai_reply_completed` and shared `DesktopReplyCompletedEvent` type.

- [ ] **Step 1: Add failing isolation and delivery tests**

```python
@pytest.mark.asyncio
async def test_events_require_auth(client: AsyncClient) -> None:
    response = await client.get("/api/v1/notifications/events")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_event_stream_is_user_isolated(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    stream = await subscribe_for_test(client, auth_headers)
    await event_service.publish(OTHER_USER_ID, REPLY_EVENT)
    await event_service.publish(TEST_USER_ID, REPLY_EVENT)
    event = await stream.next_event()
    assert event.name == "ai_reply_completed"
    assert event.data["conversationId"] == str(CONVERSATION_ID)
```

Test exact payload keys `eventId`, `conversationId`, `messageId`, `title`, `body`, `createdAt`; `text/event-stream`; 15-second `: heartbeat`; disconnect unsubscribe/close; one publish after successful DB commit; no publish on error/cancel/temporary conversation; Redis failure logs a code-only warning and leaves chat `message_end` unchanged; Web/Expo push still sends once.

- [ ] **Step 2: Observe RED**

```bash
cd backend && PYTHONPATH="" uv run pytest tests/unit/test_event_service.py tests/integration/test_notifications.py tests/integration/test_chat.py -q
```

Expected: FAIL because event service and SSE route are absent.

- [ ] **Step 3: Implement per-user Pub/Sub and one fan-out service**

```python
class ReplyCompletedEvent(BaseModel):
    event_id: UUID
    conversation_id: UUID
    message_id: UUID
    title: str
    body: str
    created_at: datetime

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
```

Redis channel is derived only from authenticated `user_id`. Event JSON is validated both before publish and after subscribe. StreamingResponse catches disconnect/cancel, unsubscribes and closes pubsub in `finally`. `notification_service.notify_reply_completed` fans out to existing push and Desktop event after the assistant message transaction commits; each downstream failure is isolated.

- [ ] **Step 4: Run backend and shared-type quality checks**

```bash
cd backend && PYTHONPATH="" uv run pytest tests/unit/test_event_service.py tests/integration/test_notifications.py tests/integration/test_chat.py -q
cd backend && PYTHONPATH="" uv run ruff check app tests
cd backend && PYTHONPATH="" uv run mypy app
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/types typecheck
```

Expected: all exit 0.

- [ ] **Step 5: Commit and continue**

```bash
git add backend/app/services/event_service.py backend/app/services/notification_service.py backend/app/services/push_service.py backend/app/api/v1/notifications.py backend/app/schemas/notifications.py backend/app/api/v1/chat.py backend/tests/unit/test_event_service.py backend/tests/integration/test_notifications.py backend/tests/integration/test_chat.py packages/types/src/index.ts
git commit -m "feat(backend): add authenticated completion events"
```

### Task 21: Show Native Reply Notifications

**Files:**

- Create: `apps/desktop/src/main/notifications/service.ts`
- Create: `apps/desktop/src/main/ipc/notifications.ts`
- Modify: `apps/desktop/src/main/ipc/index.ts`
- Modify: `apps/desktop/src/main/lifecycle.ts`
- Modify: `apps/desktop/src/main/windows/manager.ts`
- Modify: `apps/desktop/src/shared/ipc-contract.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/src/renderer/main/hooks/useDesktopEvents.ts`
- Create: `apps/desktop/src/renderer/shared/reconnecting-events.ts`
- Modify: `apps/desktop/src/renderer/main/ChatWorkspace.tsx`
- Modify: `apps/desktop/src/renderer/settings/components/NotificationSection.tsx`
- Test: `apps/desktop/src/main/notifications/service.test.ts`
- Test: `apps/desktop/src/renderer/shared/reconnecting-events.test.ts`
- Test: `apps/desktop/src/renderer/main/hooks/useDesktopEvents.test.tsx`
- Test: `apps/desktop/tests/integration/native-notifications.test.tsx`

**Interfaces:**

- Consumes: Bearer-authenticated completion SSE, notification preferences, `DesktopReplyCompletedEvent`.
- Produces: deduplicated Electron Notification; click focuses and navigates MainWindow.

- [ ] **Step 1: Write failing subscription and native notification tests**

```typescript
it('puts Authorization in the request header and never in the URL', async () => {
  connectEvents({ apiBaseUrl: API_URL, accessToken: 'secret-token', onEvent })
  expect(fetch).toHaveBeenCalledWith(`${API_URL}/notifications/events`, {
    headers: { Accept: 'text/event-stream', Authorization: 'Bearer secret-token' },
    signal: expect.any(AbortSignal),
  })
  expect(fetch.mock.calls[0]?.[0]).not.toContain('secret-token')
})

it('focuses and navigates when a native notification is clicked', () => {
  service.show(REPLY_EVENT)
  notification.emit('click')
  expect(manager.focusMain).toHaveBeenCalledOnce()
  expect(manager.sendWhenReady).toHaveBeenCalledWith('main', IPC.events.notificationNavigate, {
    conversationId: REPLY_EVENT.conversationId,
  })
})
```

Test only `ai_reply_completed` is accepted; malformed/oversize events ignored; duplicate event/message IDs ignored; focused main suppresses banners; hidden/minimized main shows; unsupported Notification is a no-op; preference off never connects/shows; sound maps to `silent`; logout/unmount aborts; 401 refreshes once; reconnect uses 1/2/4/8/16/30-second capped backoff and resets after a valid event; only one subscription exists.

- [ ] **Step 2: Observe RED**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit -- src/main/notifications src/renderer/shared/reconnecting-events.test.ts src/renderer/main/hooks/useDesktopEvents.test.tsx
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:integration -- native-notifications.test.tsx
```

Expected: FAIL because notification services are absent.

- [ ] **Step 3: Implement authenticated reconnect and main-owned Notification**

Renderer parses SSE with `eventsource-parser`, validates payloads and sends a sanitized event to main. Main creates `new Notification({ title, body, silent })`; renderer never imports Electron and never calls browser Notification. Deduplication cache is bounded to the latest 256 IDs. Notification click uses only the validated conversation UUID.

- [ ] **Step 4: Verify no Web Push integration, commit and continue**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:integration
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop typecheck
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop lint
rg -n 'serviceWorker|PushManager|pushManager|Notification\.requestPermission' apps/desktop/src
```

Expected: scripts exit 0; scan exits 1 with no output.

```bash
git add apps/desktop/src/main/notifications apps/desktop/src/main/ipc apps/desktop/src/main/lifecycle.ts apps/desktop/src/main/windows/manager.ts apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/main apps/desktop/src/renderer/shared/reconnecting-events.ts apps/desktop/src/renderer/settings/components/NotificationSection.tsx apps/desktop/tests/integration/native-notifications.test.tsx
git commit -m "feat(desktop): add native reply notifications"
```

### Task 22: Add Controlled Automatic Updates

**Files:**

- Create: `apps/desktop/src/main/updater/state.ts`
- Create: `apps/desktop/src/main/updater/service.ts`
- Create: `apps/desktop/src/main/ipc/updater.ts`
- Modify: `apps/desktop/src/main/ipc/index.ts`
- Modify: `apps/desktop/src/main/lifecycle.ts`
- Modify: `apps/desktop/src/shared/ipc-contract.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/settings/components/DesktopSection.tsx`
- Test: `apps/desktop/src/main/updater/service.test.ts`
- Test: `apps/desktop/src/renderer/settings/components/DesktopSection.test.tsx`

**Interfaces:**

- Consumes: `electron-updater`, packaged state, update channel preference.
- Produces: `UpdaterState` discriminated union and commands `check`, `download`, `install`.

- [ ] **Step 1: Write failing updater state-machine tests**

```typescript
it('never contacts update servers in an unpackaged app', async () => {
  app.isPackaged = false
  await service.setup()
  await expect(service.check()).resolves.toMatchObject({ status: 'disabled' })
  expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
})

it('requires user download and a completed payload before install', async () => {
  expect(autoUpdater.autoDownload).toBe(false)
  await expect(service.install()).rejects.toThrow('UPDATE_NOT_DOWNLOADED')
  autoUpdater.emit('update-downloaded', SAFE_INFO)
  await service.install()
  expect(autoUpdater.quitAndInstall).toHaveBeenCalledOnce()
})
```

Test stable/beta mapping, automatic-check preference, check available/none/error, explicit download progress, install gate, sanitized errors without local paths, exact one listener set after repeated setup, broadcast to ready windows and complete dispose.

- [ ] **Step 2: Observe RED**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit -- src/main/updater/service.test.ts src/renderer/settings/components/DesktopSection.test.tsx
```

Expected: FAIL because updater state machine is absent.

- [ ] **Step 3: Implement controlled updater**

`autoDownload=false`, `autoInstallOnAppQuit=true`. Setup does nothing network-related unless `app.isPackaged`; automatic checks obey preference. `downloadUpdate()` is called only from user command. Renderer sees only version, percent, bytes-per-second and stable error codes; file paths and stack traces remain in main and are not logged with credentials.

- [ ] **Step 4: Run GREEN, build, commit and continue**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop typecheck
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop lint
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop build
git add apps/desktop/src/main/updater apps/desktop/src/main/ipc/updater.ts apps/desktop/src/main/ipc/index.ts apps/desktop/src/main/lifecycle.ts apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/settings/components/DesktopSection.tsx
git commit -m "feat(desktop): add controlled automatic updates"
```

### Task 23: Generate Deterministic Desktop Resources

**Files:**

- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/desktop/scripts/generate-assets.mjs`
- Create: `apps/desktop/scripts/check-assets.mjs`
- Test: `apps/desktop/scripts/generate-assets.test.mjs`
- Create: `apps/desktop/resources/icon.ico`
- Create: `apps/desktop/resources/icon.icns`
- Create: `apps/desktop/resources/icons/linux/{16x16,24x24,32x32,48x48,64x64,128x128,256x256,512x512}.png`
- Create: `apps/desktop/resources/tray/tray.ico`
- Create: `apps/desktop/resources/tray/trayTemplate.png`
- Create: `apps/desktop/resources/tray/trayTemplate@2x.png`
- Create: `apps/desktop/resources/tray/tray-linux.png`
- Create: `apps/desktop/resources/installer.ico`
- Create: `apps/desktop/resources/uninstaller.ico`
- Create: `apps/desktop/resources/entitlements.mac.plist`

**Interfaces:**

- Consumes: `apps/mobile/assets/icon.png`, `sharp@0.34.5`, `png2icons@2.0.1`.
- Produces: checked platform resources and scripts `assets:generate`, `assets:check`.

- [ ] **Step 1: Install exact generators and write failing deterministic tests**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop add --save-dev --save-exact sharp@0.34.5 png2icons@2.0.1
```

```javascript
test('generates byte-identical resources from the mobile icon', async () => {
  const first = await generateInto(await mkdtemp(join(tmpdir(), 'yuanai-assets-a-')))
  const second = await generateInto(await mkdtemp(join(tmpdir(), 'yuanai-assets-b-')))
  assert.deepEqual(await hashes(first), await hashes(second))
})
```

Add assertions for PNG dimensions, ICO header `00 00 01 00`, ICNS header `icns`, alpha-bearing monochrome macOS template pixels, all required filenames and source hash recorded in a generated manifest.

- [ ] **Step 2: Observe RED**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit -- scripts/generate-assets.test.mjs
```

Expected: FAIL because generator is absent.

- [ ] **Step 3: Implement deterministic generation and checks**

Normalize input to sRGB 8-bit RGBA, strip timestamps/metadata, use fixed resize kernels and write in sorted order. Tray templates derive a monochrome alpha mask rather than shrinking the colored icon. macOS entitlements contain network client and camera only; microphone/audio-input keys are absent because speech is excluded.

Add scripts:

```json
{
  "assets:generate": "node scripts/generate-assets.mjs",
  "assets:check": "node scripts/check-assets.mjs"
}
```

- [ ] **Step 4: Generate through scripts, verify, commit and continue**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop assets:generate
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop assets:check
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit
git add apps/desktop/package.json apps/desktop/scripts apps/desktop/resources pnpm-lock.yaml
git commit -m "chore(desktop): generate deterministic app resources"
```

### Task 24: Configure Cross-Platform Packages And Package Verification

**Files:**

- Create: `apps/desktop/electron-builder.yml`
- Create: `apps/desktop/scripts/verify-package.mjs`
- Test: `apps/desktop/scripts/builder-config.test.mjs`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/electron.vite.config.ts`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: built `out/`, generated resources, `electron-builder` package scripts.
- Produces: Windows NSIS/portable/MSI, macOS DMG/ZIP, Linux AppImage/deb/rpm, unpacked package verification.

- [ ] **Step 1: Write failing builder contract tests**

```javascript
test('declares all required targets and protocol metadata', async () => {
  const config = await readBuilderConfig()
  assert.equal(config.appId, 'com.yuanai.app')
  assert.deepEqual(targets(config.win), ['nsis:x64,arm64', 'portable:x64', 'msi:x64'])
  assert.deepEqual(targets(config.mac), ['dmg:x64,arm64', 'zip:x64,arm64'])
  assert.deepEqual(targets(config.linux), ['AppImage:x64', 'deb:x64', 'rpm:x64'])
  assert.deepEqual(config.protocols[0].schemes, ['yuanai'])
})
```

Test `asar: true`, maps excluded, exact GitHub publisher `liaojie1314/yuanai`, `identity: null`, required Linux dependencies, `extraResources`, no microphone usage description, and package scripts always invoke `pnpm run build` first. Package verifier checks `app.asar`, main/preload bundle, six renderer HTML entries, icons/tray files and absence of `.map`.

- [ ] **Step 2: Observe RED**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit -- scripts/builder-config.test.mjs
```

Expected: FAIL because builder config and verifier are absent.

- [ ] **Step 3: Implement exact builder configuration**

Use `appId: com.yuanai.app`, `productName: 元AI`, `directories.output: release/${version}`, GitHub owner/repo `liaojie1314/yuanai`, protocol `yuanai`, maximum compression and `extraResources: resources -> resources`. Runtime resources resolve from `process.resourcesPath/resources` when packaged. macOS is explicitly unsigned (`identity: null`); release notes must state Gatekeeper/manual allow behavior.

Add `verify:package: "node scripts/verify-package.mjs"`; retain all packaging commands as package scripts and ensure they call `pnpm run build` before builder.

- [ ] **Step 4: Build and inspect the current-platform unpacked package**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:unit
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop build:unpack
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop verify:package
```

Expected: all exit 0; unpacked Linux app contains required runtime files and no source maps.

- [ ] **Step 5: Commit and continue**

```bash
git add apps/desktop/electron-builder.yml apps/desktop/scripts/verify-package.mjs apps/desktop/scripts/builder-config.test.mjs apps/desktop/package.json apps/desktop/electron.vite.config.ts .gitignore
git commit -m "chore(desktop): configure cross-platform packages"
```

### Task 25: Add Packaged Electron E2E And Visual Checks

**Files:**

- Create: `apps/desktop/playwright.config.ts`
- Create: `apps/desktop/tests/e2e/mock-api.mjs`
- Create: `apps/desktop/tests/e2e/fixtures.ts`
- Create: `apps/desktop/tests/e2e/auth.spec.ts`
- Create: `apps/desktop/tests/e2e/chat.spec.ts`
- Create: `apps/desktop/tests/e2e/windows.spec.ts`
- Create: `apps/desktop/tests/e2e/responsive.spec.ts`
- Modify: `apps/desktop/package.json`

**Interfaces:**

- Consumes: unpacked Electron package and local mock API started through a package script.
- Produces: packaged auth/chat/window journeys, nonblank screenshots and accessibility scans.

- [ ] **Step 1: Write E2E specifications before application assertions pass**

```typescript
test('login opens the main chat window', async ({ electronApp }) => {
  const login = await electronApp.firstWindow()
  await login.getByLabel('邮箱').fill('test@example.com')
  await login.getByLabel('密码').fill('Test1234!')
  await login.getByRole('button', { name: '登录' }).click()
  const main = await waitForWindow(electronApp, 'main')
  await expect(main.getByRole('textbox', { name: '输入消息' })).toBeVisible()
})
```

Auth spec covers login success/failure and encrypted remembered restart. Chat spec covers list -> new conversation -> SSE reply -> share URL. Windows spec covers Settings/About/Artifact single/multi-instance, tray-close state via test seam and chat deep link. Responsive spec captures the app viewports 1024x700, 1440x900 and 1920x1080 plus minimum window sizes main 960x640, login 760x580, settings 800x600 and artifact 720x520; settings at 800 px must use its narrow selector and main at 960/1024 px must use its drawer layout. Every viewport asserts `scrollWidth <= clientWidth`, important controls are in bounds, and screenshot luminance variance proves nonblank rendering.

Accessibility runs axe with zero violations in both light and dark themes, verifies 200% zoom/reflow without two-dimensional page scrolling, follows the principal workflow with Tab and Shift+Tab, closes dialogs with Escape, checks focus trap and focus restoration, confirms the live region does not update for individual stream tokens, and measures every primary interactive target at least 24x24 CSS px. Automated checks supplement, but do not claim to replace, final VoiceOver/NVDA checks on their native platforms.

- [ ] **Step 2: Add script-owned mock API and runner**

Mock API binds only `127.0.0.1` on an assigned port, emits the real SSE protocol and resets per test. Package scripts are:

```json
{
  "e2e:api": "node tests/e2e/mock-api.mjs",
  "test:e2e": "pnpm run build:unpack && playwright test"
}
```

Playwright `webServer.command` calls `pnpm run e2e:api`; tests never launch a server with a raw CLI command. The mock script prints its selected loopback API URL to a machine-readable readiness file. The Electron fixture reads that file and launches the unpacked app with `YUANAI_API_URL` set to the URL, so the packaged process, preload runtime config and renderer use one deterministic dynamic port.

- [ ] **Step 3: Run packaged E2E and inspect screenshots**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:e2e
```

Expected: all journeys pass on Ubuntu; screenshots are nonblank, in bounds and free of incoherent overlap.

- [ ] **Step 4: Commit and continue**

```bash
git add apps/desktop/playwright.config.ts apps/desktop/tests/e2e apps/desktop/package.json
git commit -m "test(e2e): cover packaged desktop journeys"
```

### Task 26: Add Cross-Platform Release Matrix And Scope Guards

**Files:**

- Create: `.github/workflows/desktop-release.yml`
- Create: `scripts/check-desktop-workflow.mjs`
- Test: `scripts/check-desktop-workflow.test.mjs`
- Modify: `package.json`

**Interfaces:**

- Consumes: Desktop package scripts and GitHub tag/manual events.
- Produces: Ubuntu/Windows/macOS artifacts; tag-only draft release; static policy checks.

- [ ] **Step 1: Write failing workflow policy tests**

```javascript
test('builds every platform through package scripts and releases only tags', async () => {
  const workflow = await readWorkflow()
  assert.match(workflow, /ubuntu-latest/)
  assert.match(workflow, /windows-latest/)
  assert.match(workflow, /macos-latest/)
  assert.match(workflow, /pnpm --filter @yuanai\/desktop package:linux/)
  assert.match(workflow, /pnpm --filter @yuanai\/desktop package:win/)
  assert.match(workflow, /pnpm --filter @yuanai\/desktop package:mac/)
  assert.match(workflow, /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/)
})
```

Test Node 22, pnpm 10.22.0, frozen lockfile, unit/typecheck/lint/assets/package verification on each runner, artifact upload v4, `contents: read` default, `contents: write` only release job, `GH_TOKEN` only release step, manual dispatch never publishes, unsigned macOS flag and expected artifact extensions. Add a source guard asserting Desktop preload/IPC and backend files have no `transcribe` capability or `/files/transcribe` route.

- [ ] **Step 2: Observe RED**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm run test:desktop-ci
```

Expected: FAIL because workflow/checker are absent.

- [ ] **Step 3: Implement matrix and root check script**

Workflow triggers `v*.*.*` and `workflow_dispatch`. Build matrix uploads platform artifacts; a separate tag-only release job downloads them and creates a draft GitHub Release. macOS sets `CSC_IDENTITY_AUTO_DISCOVERY=false`; no unavailable signing secrets are required. Every build/start/package command is an existing package script.

Root script is:

```json
{
  "test:desktop-ci": "node --test scripts/check-desktop-workflow.test.mjs"
}
```

- [ ] **Step 4: Run final static and current-platform verification**

```bash
/home/liaojie1314/.local/share/pnpm/pnpm run test:desktop-ci
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/core test:unit
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop assets:check
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop test:integration
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop typecheck
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop lint
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop build
/home/liaojie1314/.local/share/pnpm/pnpm --filter @yuanai/desktop verify:package
```

Expected: all exit 0 on Ubuntu. Remote Windows/macOS jobs are not run because this branch is not pushed; their final native UX acceptance remains explicit.

- [ ] **Step 5: Commit and continue**

```bash
git add .github/workflows/desktop-release.yml scripts/check-desktop-workflow.mjs scripts/check-desktop-workflow.test.mjs package.json
git commit -m "ci(desktop): add cross-platform release matrix"
```

---

## Final Requirement Trace

| Requirement                                                 | Task |
| ----------------------------------------------------------- | ---- |
| Immutable Compose images                                    | 1    |
| Real Desktop scripts/tests                                  | 2    |
| Runtime API URL and Core regressions                        | 3    |
| safeStorage, IPC isolation, preload whitelist               | 4    |
| Six secure windows, single instance, deep links             | 5    |
| Dialog/shell/screen capabilities                            | 6    |
| Tray and close behavior                                     | 7    |
| Native menus                                                | 8    |
| Global shortcut                                             | 9    |
| Auto launch                                                 | 10   |
| Six renderer roots, themes, i18n, responsive foundation     | 11   |
| Login/register/forgot password                              | 12   |
| One-time PKCE backend exchange                              | 13   |
| OAuth system-browser flow                                   | 14   |
| Conversation CRUD, temporary chat, streaming                | 15   |
| Markdown/code/reasoning/media/share                         | 16   |
| File/camera/screen attachments                              | 17   |
| Embedded/detached Artifact                                  | 18   |
| Six Web settings sections plus Desktop section              | 19   |
| Authenticated completion SSE                                | 20   |
| Native Notification and click navigation                    | 21   |
| User-controlled updater                                     | 22   |
| Icons/tray/entitlements                                     | 23   |
| Win/macOS/Linux installers                                  | 24   |
| Packaged journeys, accessibility and responsive screenshots | 25   |
| Cross-platform release CI and speech-scope guard            | 26   |

## Explicitly Excluded From This Plan

- Voice input, microphone permission, MediaRecorder audio capture and `POST /files/transcribe` are excluded because Web has not delivered backend transcription and the user approved deferral.
- WeChat QR login, a standalone global Cmd+K command palette, Windows/macOS signing/notarization, widgets and offline drafts remain outside Phase 4.
- No push or branch merge is part of execution.
