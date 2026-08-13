# Phase 4 — 桌面端开发（Electron）

**前置条件**：Phase 0 完成，Phase 1 完成（后端），Phase 2 完成（web 端 + `packages/core`、`packages/ui`、`packages/types`）
**实施分支**：`feature/phase-4-desktop`（已于 2026-08-13 快进合入 `dev`）
**执行范围**：`apps/desktop/`；同时对 `packages/core`、`packages/types` 做**最小侵入式**改动；`backend/` 补 OAuth desktop 回调 URI 与语音转写接口
**测试目标**：Windows、Linux（Ubuntu）为用户主测平台；macOS 通过 CI + 逻辑保证适配无回归

---

## 目标

1. 基于 **Electron 33 + electron-vite + React 19** 实现桌面端，与 web 端功能对齐
2. 通过 `packages/core` + `packages/ui` **最大化复用** web 端逻辑与 UI，桌面端仅承担平台适配层
3. 交付桌面原生体验：多窗口、系统托盘、全局快捷键、原生菜单栏、深链接、自动更新、开机自启
4. 打包为 Windows（NSIS + Portable + MSI）、macOS（DMG + ZIP）、Linux（AppImage + deb + rpm）
5. 令牌通过 Electron `safeStorage` 加密存盘，替代 web 端 localStorage 明文方案

## 实施状态（2026-08-13）

Phase 4 的实现已合入 `dev`，实现分支最后一个功能提交为 `09f7dec`。实际目录采用桌面薄壳方案：
`apps/desktop` 实现 Electron 主进程、preload 和多 renderer UI，复用
`@yuanai/core` 的 API、认证、会话和 SSE 能力，不跨端直接导入 Next.js 组件。

已完成并在 Ubuntu 开发环境验证：

- 六个 renderer 入口及独立认证窗口：主聊天、登录/注册/忘记密码、设置、关于、
  Artifact 与 OAuth。
- 真实后端认证、桌面 OAuth code exchange、会话 CRUD、流式聊天、临时对话、
  分享、文件/截图附件和消息操作。
- 代码高亮、Markdown/数学公式、JSON/CSV 数据预览、代码运行预览和单一 Artifact
  窗口；长会话虚拟列表与滚动期间高亮降级。
- 用户显示偏好同步、主题和原生标题栏适配；关闭到托盘、托盘菜单、全局快捷键、
  开机自启和 AI 回复原生通知。
- 安全 IPC、`safeStorage` 会话保存、`yuanai-app://` 打包资源协议和受控
  `yuanai-file://` 本地文件协议。

已经通过桌面单元与集成测试、类型检查、lint、生产构建和 `preview` 启动验证。真实
聊天、认证和托盘已在 Ubuntu 本地环境人工验证。Windows/macOS 原生安装、代码签名、
生产自动更新源和三平台打包验收仍是发布前工作；语音转写按已确认范围暂缓。

当前命令、环境变量和打包边界以 [桌面端说明](../../apps/desktop/README.md) 为准。

---

## 关键决策记录（本文档定稿依据）

| #   | 议题         | 决策                                                                                        |
| --- | ------------ | ------------------------------------------------------------------------------------------- |
| D1  | OAuth 回传   | 系统默认浏览器 + 自定义协议 `yuanai://oauth/callback`                                       |
| D2  | 窗口拓扑     | 登录 / 注册 / 忘记密码 / 设置 / 关于 / Artifact / OAuth 中间态 均为独立 BrowserWindow       |
| D3  | 托盘与关闭   | 有托盘；关闭按钮默认最小化到托盘（设置里可切换为"直接退出"）                                |
| D4  | Token 存储   | Electron `safeStorage`（macOS Keychain / Windows DPAPI / Linux Secret Service）加密后写文件 |
| D5  | 语音输入     | MediaRecorder 录制 → 后端 `POST /files/transcribe` → Whisper 转写                           |
| D6  | 分享链接     | `shell.openExternal` 打开系统默认浏览器                                                     |
| D7  | 服务端推送   | 优先复用 Web Push（renderer 轻量 SW）；不可用时 fallback 到 SSE `/events`                   |
| D8  | 自动更新     | `electron-updater` + GitHub Releases，`autoDownload = false` 由用户确认                     |
| D9  | 开机自启     | 支持，默认关，设置页可切换                                                                  |
| D10 | 启动自动登录 | 支持，从 safeStorage 读回上次会话直接进 `/chat`                                             |
| D11 | 深链接范围   | `yuanai://oauth/callback`、`yuanai://chat/{conversationId}`                                 |
| D12 | 快捷键       | 应用内快捷键（Cmd/Ctrl+N/,/K/Enter） + 系统全局唤起 `Ctrl+Alt+Y`（可自定义）                |
| D13 | 菜单栏       | 三端均提供完整原生菜单栏；macOS 强制                                                        |
| D14 | 打包 target  | Win: NSIS + Portable + MSI；macOS: DMG + ZIP；Linux: AppImage + deb + rpm                   |

---

## 架构

### 进程模型

```
主进程 (main/)
  ├── 生命周期编排（whenReady、single instance lock、before-quit）
  ├── 窗口管理器（防止重复创建同名窗口）
  ├── 系统托盘 & 原生菜单栏 & 全局快捷键
  ├── 自定义协议注册与 URL 解析（yuanai://）
  ├── 自动更新（electron-updater）
  ├── safeStorage 加密桥（渲染层通过 IPC 存取 token）
  ├── 原生对话框（文件选择、消息框）
  ├── 权限请求处理（相机、麦克风、通知）
  └── IPC 处理器（响应各渲染窗口请求）

预加载脚本 (preload/)
  └── contextBridge 暴露 window.yuanai 命名空间给所有渲染窗口

渲染层 (renderer/) — 多入口 SPA
  ├── main/    ← 主聊天窗口
  ├── login/   ← 登录 / 注册 / 忘记密码（三合一路由）
  ├── settings/← 设置窗口
  ├── about/   ← 关于窗口
  ├── artifact/← Artifact 独立预览窗口
  └── oauth/   ← OAuth 中间态 loading 窗口
```

多入口不是"多个 SPA"，而是每个窗口独立挂载一个精简的 React root，通过 `@yuanai/ui` + `@yuanai/core` 复用组件与状态。窗口之间通信一律走主进程做中转（避免 renderer 直接持有其他 renderer 的引用）。

**Login / Register / ForgotPassword 三窗口共享同一个 renderer entry（`login/index.html`）**，靠 URL hash 区分渲染哪个页面。这样只维护一份 renderer 打包目标、一份表单组件集合，却能满足"注册和忘记密码各自独立弹窗、可与登录页并存"的 UX 需求。

### 窗口拓扑

| 窗口                     | 触发时机                             | 关闭行为                    | 备注                                                  |
| ------------------------ | ------------------------------------ | --------------------------- | ----------------------------------------------------- |
| **MainWindow**           | app.whenReady 且已登录；或登录成功后 | 隐藏到托盘（默认，可改）    | 唯一常驻窗口                                          |
| **LoginWindow**          | 未登录时启动 / clearAuth 后自动打开  | 关闭时若未登录则退出应用    | 加载 `login/#/login`                                  |
| **RegisterWindow**       | 登录窗内点"注册"，或菜单             | 关闭返回 LoginWindow        | 加载 `login/#/register`；独立窗口避免登录页表单被覆盖 |
| **ForgotPasswordWindow** | 登录窗内点"忘记密码"                 | 关闭返回 LoginWindow        | 加载 `login/#/forgot`；含验证码输入                   |
| **SettingsWindow**       | Cmd/Ctrl+, / 托盘"设置" / 菜单       | 关闭销毁                    | 6 分区，复用 web `SettingsModal` 内容                 |
| **AboutWindow**          | 菜单"关于" / 设置里"关于本应用"      | 关闭销毁                    | 小型窗口（480×360，不可缩放）                         |
| **ArtifactWindow** _(N)_ | 用户在聊天里点"分离到独立窗口"       | 关闭销毁；不影响会话        | 允许多实例（每个 artifact 一个窗口）                  |
| **OAuthLoadingWindow**   | yuanai://oauth/callback 被拦截时     | 拿到 token 后 2s 内自动关闭 | 小型无边框，仅显示 spinner + "正在完成登录…"          |

**后续扩展**（本 Phase 不实现，先留位置）：

- 微信扫码登录：与 LoginWindow 共用同一窗口的"扫码"页签
- 全局搜索：后续可提取为 Cmd+K 独立命令面板窗口

### 目录结构

```
apps/desktop/
├── src/
│   ├── main/
│   │   ├── index.ts                  ← 主进程入口 & 生命周期编排
│   │   ├── windows/
│   │   │   ├── manager.ts            ← 命名窗口管理器（单例语义）
│   │   │   ├── main.ts
│   │   │   ├── login.ts
│   │   │   ├── settings.ts
│   │   │   ├── about.ts
│   │   │   ├── artifact.ts
│   │   │   └── oauth-loading.ts
│   │   ├── ipc/
│   │   │   ├── auth.ts               ← safeStorage 存取
│   │   │   ├── window.ts             ← 打开/关闭/最小化命名窗口
│   │   │   ├── dialog.ts             ← 原生对话框
│   │   │   ├── shell.ts              ← 外部链接
│   │   │   ├── system.ts             ← 平台/版本/开机自启
│   │   │   └── updater.ts            ← 更新事件转发
│   │   ├── protocol/
│   │   │   ├── register.ts           ← setAsDefaultProtocolClient
│   │   │   └── handler.ts            ← 解析 yuanai:// URL 并分发
│   │   ├── tray/
│   │   │   └── index.ts
│   │   ├── menu/
│   │   │   ├── mac.ts
│   │   │   └── win-linux.ts
│   │   ├── shortcuts/
│   │   │   └── global.ts             ← globalShortcut 注册与冲突回退
│   │   ├── updater/
│   │   │   └── index.ts              ← electron-updater 事件桥
│   │   └── security/
│   │       ├── csp.ts                ← 响应头注入
│   │       └── permissions.ts        ← 相机/麦克风/通知
│   ├── preload/
│   │   └── index.ts                  ← contextBridge → window.yuanai
│   ├── renderer/
│   │   ├── shared/                   ← 6 个窗口共用的 provider、theme、storage、i18n
│   │   │   ├── QueryProvider.tsx
│   │   │   ├── I18nProvider.tsx      ← react-i18next（脱离 Next SSR）
│   │   │   ├── ThemeProvider.tsx     ← 复用 web 的 CSS 变量 + data-theme
│   │   │   ├── desktopStorage.ts     ← 注入 auth store 的 StateStorage
│   │   │   └── bootstrap.ts          ← 每个 renderer 入口调用一次
│   │   ├── main/
│   │   │   ├── index.html
│   │   │   ├── entry.tsx
│   │   │   └── App.tsx               ← HashRouter：/ 、/chat/:id
│   │   ├── login/
│   │   │   ├── index.html
│   │   │   └── entry.tsx             ← HashRouter：/login、/register、/forgot
│   │   ├── settings/
│   │   │   ├── index.html
│   │   │   └── entry.tsx
│   │   ├── about/
│   │   │   ├── index.html
│   │   │   └── entry.tsx
│   │   ├── artifact/
│   │   │   ├── index.html
│   │   │   └── entry.tsx
│   │   └── oauth/
│   │       ├── index.html
│   │       └── entry.tsx             ← 极简，仅显示 spinner
│   └── shared/                       ← 主进程 + 预加载 + 渲染层共用类型
│       └── ipc-contract.ts           ← window.yuanai 类型定义与 IPC 通道常量
├── resources/                        ← 应用图标、托盘图标、entitlements
├── electron.vite.config.ts
├── electron-builder.yml
├── tsconfig.json
├── tsconfig.node.json
└── package.json
```

---

## 平台差异清单

| 议题                 | Windows                                                                           | macOS                                                                      | Linux (Ubuntu)                                                                         |
| -------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **单实例锁**         | `requestSingleInstanceLock`；`second-instance` 事件里取 `argv` 末位解析深链       | 同左 + `open-url` 事件                                                     | 同 Windows                                                                             |
| **协议注册（开发）** | `setAsDefaultProtocolClient('yuanai', process.execPath, [path.resolve(argv[1])])` | `setAsDefaultProtocolClient('yuanai')` 简单形式                            | 同 macOS                                                                               |
| **协议注册（打包）** | electron-builder 自动写注册表                                                     | Info.plist `CFBundleURLTypes`                                              | `.desktop` 中 `MimeType=x-scheme-handler/yuanai;`                                      |
| **托盘图标**         | `.ico` 16/32 双尺寸                                                               | `Template.png` @1x @2x，自动跟随亮暗色                                     | `.png` 22/24 双尺寸；GNOME 需 AppIndicator 扩展（deb 依赖 `gir1.2-appindicator3-0.1`） |
| **关闭按钮**         | 拦截 `close` 事件 `e.preventDefault(); hide()`                                    | 同左 + Dock 图标保留                                                       | 同 Windows                                                                             |
| **开机自启**         | `app.setLoginItemSettings({ openAtLogin, path: process.execPath })`               | 同左（自动写 LaunchAgent）                                                 | 写 `~/.config/autostart/yuanai.desktop`，字段：`X-GNOME-Autostart-enabled=true`        |
| **全局快捷键**       | `globalShortcut.register('Ctrl+Alt+Y')`                                           | 同左                                                                       | Wayland 下部分环境不生效；注册失败时降级为托盘菜单提示                                 |
| **权限请求**         | 首次调用系统对话框                                                                | Info.plist 必需 `NSMicrophoneUsageDescription`、`NSCameraUsageDescription` | 直接授予（PulseAudio/PipeWire）                                                        |
| **菜单栏渲染**       | 挂在窗口顶部                                                                      | 全局菜单栏（Cmd+Q、Cmd+, 都从这里走）                                      | 挂在窗口顶部；GNOME 会隐藏，需要点击 Alt                                               |
| **标题栏样式**       | `titleBarStyle: 'default'`                                                        | `titleBarStyle: 'hiddenInset'` + 预留 traffic light                        | 与 Windows 同；GNOME 客户端装饰保留                                                    |
| **主题跟随系统**     | `nativeTheme.themeSource` + `updated` 事件                                        | 同左                                                                       | 同左（GNOME/KDE 均通过 nativeTheme）                                                   |
| **文件拖拽**         | file:// path 直接给到                                                             | 同左                                                                       | 同左                                                                                   |
| **代码签名**         | 需 EV/OV 证书；开发阶段不签，用户会看到 SmartScreen 警告                          | Apple Developer ID + notarize；未签名 arm64 无法运行                       | 无需签名                                                                               |
| **自动更新**         | `latest.yml`，NSIS full/differential                                              | `latest-mac.yml`，走 ZIP                                                   | `latest-linux.yml`；仅 AppImage 支持原地自更新，deb/rpm 走"下载并提示手动安装"         |

---

## Step 1：项目基础设施

### 1.1 依赖调整（`apps/desktop/package.json`）

在现有骨架基础上补充：

```jsonc
{
  "dependencies": {
    "@yuanai/types": "workspace:*",
    "@yuanai/core": "workspace:*",
    "@yuanai/ui": "workspace:*",
    "electron-updater": "^6.3.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0",
    "@tanstack/react-query": "^5.0.0",
    "zustand": "^5.0.0",
    "axios": "^1.7.0",
    "react-i18next": "^15.0.0",
    "i18next": "^23.0.0",
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "electron-vite": "^2.3.0",
    "@electron-toolkit/preload": "^3.0.0",
    "@electron-toolkit/utils": "^3.0.0",
  },
}
```

不再依赖 `next-intl`——桌面端脱离 Next 环境，改用 `react-i18next` 直接消费 `apps/web/src/i18n/locales/*.json`（复用同一份语言包，避免翻译分叉）。

### 1.2 electron-vite 多渲染入口

替换现有 `electron.vite.config.ts`：

```typescript
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const rendererRoot = resolve(__dirname, 'src/renderer')

const rendererInputs = ['main', 'login', 'settings', 'about', 'artifact', 'oauth'].reduce(
  (acc, name) => {
    acc[name] = resolve(rendererRoot, name, 'index.html')
    return acc
  },
  {} as Record<string, string>
)

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') },
    },
  },
  renderer: {
    root: rendererRoot,
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(rendererRoot),
      },
    },
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: rendererInputs },
    },
  },
})
```

### 1.3 单实例锁 & 深链启动参数

`apps/desktop/src/main/index.ts` 骨架：

```typescript
import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { registerProtocol, handleProtocolUrl } from './protocol/register'
import { openMainWindow, openLoginWindow } from './windows/manager'
import { setupIpc } from './ipc'
import { setupTray } from './tray'
import { setupMenu } from './menu'
import { setupGlobalShortcuts } from './shortcuts/global'
import { setupUpdater } from './updater'
import { setupPermissions } from './security/permissions'
import { setupCsp } from './security/csp'
import { hasStoredSession } from './ipc/auth'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  process.exit(0)
}

app.on('second-instance', (_event, argv) => {
  // Windows/Linux：新启动实例的 argv 末位可能是 yuanai:// URL
  const deepLink = argv.find((a) => a.startsWith('yuanai://'))
  if (deepLink) handleProtocolUrl(deepLink)
  // 无论如何都要把主窗口拉到前
  openMainWindow({ focus: true })
})

// macOS：系统通过 open-url 事件送入
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleProtocolUrl(url)
})

app.whenReady().then(async () => {
  registerProtocol()
  setupCsp()
  setupPermissions()
  setupIpc()
  setupTray()
  setupMenu()
  setupGlobalShortcuts()
  setupUpdater()

  if (await hasStoredSession()) {
    openMainWindow()
  } else {
    openLoginWindow()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow()
  })
})

app.on('before-quit', () => {
  // 允许 tray 图标真正销毁
  ;(global as { isQuitting?: boolean }).isQuitting = true
})
```

### 1.4 CSP 与安全

`src/main/security/csp.ts`：

```typescript
import { session } from 'electron'

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // Tailwind runtime & KaTeX 需要
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:", // 允许连接后端 API 与 Web Push
  "media-src 'self' blob:", // 语音回放
  "worker-src 'self' blob:", // Service Worker + Web Worker
].join('; ')

export function setupCsp(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
      },
    })
  })
}
```

**强制约束**：所有 `BrowserWindow.webPreferences` 必须为 `contextIsolation: true, nodeIntegration: false, sandbox: true`（`sandbox: false` 仅在需要 preload 使用 Node 模块的窗口开启，本项目 preload 依赖 `contextBridge + ipcRenderer` 即可，无需 `sandbox: false`）。

---

## Step 2：窗口管理与主进程骨架

### 2.1 命名窗口管理器

`src/main/windows/manager.ts` 提供单例语义（同名窗口只存在一个，Artifact 除外）：

```typescript
import { BrowserWindow, app } from 'electron'
import path from 'node:path'
import { is } from '@electron-toolkit/utils'

type WindowKey = 'main' | 'login' | 'settings' | 'about' | 'oauth-loading'

const registry = new Map<WindowKey, BrowserWindow>()

interface CommonOpts {
  focus?: boolean
}

function baseConfig() {
  return {
    backgroundColor: '#FAFAF8',
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  }
}

function loadEntry(win: BrowserWindow, entry: string): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${entry}/index.html`)
  } else {
    void win.loadFile(path.join(__dirname, `../renderer/${entry}/index.html`))
  }
}

function makeSingleton(key: WindowKey, factory: () => BrowserWindow): BrowserWindow {
  const existing = registry.get(key)
  if (existing && !existing.isDestroyed()) return existing
  const win = factory()
  registry.set(key, win)
  win.on('closed', () => registry.delete(key))
  return win
}

export function openMainWindow(opts: CommonOpts = {}): BrowserWindow {
  const win = makeSingleton('main', () => {
    const w = new BrowserWindow({
      ...baseConfig(),
      width: 1280,
      height: 820,
      minWidth: 960,
      minHeight: 640,
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    })
    w.on('ready-to-show', () => w.show())
    w.on('close', (e) => {
      const quitting = (global as { isQuitting?: boolean }).isQuitting
      const closeToTray = readMainPref('closeToTray') ?? true
      if (!quitting && closeToTray) {
        e.preventDefault()
        w.hide()
      }
    })
    loadEntry(w, 'main')
    return w
  })
  if (opts.focus) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  return win
}

// 其余窗口按相同模式：openLoginWindow / openSettingsWindow / openAboutWindow / openOAuthLoadingWindow / openArtifactWindow
```

Artifact 窗口需要 **多实例**：不进 registry，直接每次 `new BrowserWindow`，用 `Map<artifactId, BrowserWindow>` 单独跟踪。

### 2.2 系统托盘

`src/main/tray/index.ts`：

```typescript
import { Tray, Menu, nativeImage, app } from 'electron'
import path from 'node:path'
import { openMainWindow, openSettingsWindow } from '../windows/manager'

let tray: Tray | null = null

export function setupTray(): void {
  const iconPath = getTrayIconPath()
  const image = nativeImage.createFromPath(iconPath)
  if (process.platform === 'darwin') image.setTemplateImage(true)

  tray = new Tray(image)
  tray.setToolTip('元AI')

  const menu = Menu.buildFromTemplate([
    { label: '打开主界面', click: () => openMainWindow({ focus: true }) },
    { label: '设置…', accelerator: 'CmdOrCtrl+,', click: () => openSettingsWindow() },
    { type: 'separator' },
    {
      label: '退出元AI',
      click: () => {
        ;(global as { isQuitting?: boolean }).isQuitting = true
        app.quit()
      },
    },
  ])
  tray.setContextMenu(menu)

  // Windows/Linux 用单击唤起；macOS 遵循右键出菜单、左键也出菜单
  tray.on('click', () => {
    if (process.platform !== 'darwin') openMainWindow({ focus: true })
  })
}

function getTrayIconPath(): string {
  const base = path.join(__dirname, '../../resources/tray')
  if (process.platform === 'win32') return path.join(base, 'tray.ico')
  if (process.platform === 'darwin') return path.join(base, 'trayTemplate.png')
  return path.join(base, 'tray-linux.png') // 22×22 PNG，AppIndicator 使用
}
```

**Linux 托盘落地注意**：AppImage 依赖 host 已装 `libappindicator3`；deb 打包时在 `linux.deb.depends` 中显式声明依赖（见 Step 5）。

### 2.3 原生菜单栏

`src/main/menu/mac.ts` 与 `src/main/menu/win-linux.ts` 分别构造，加载入口 `src/main/menu/index.ts`：

```typescript
import { Menu } from 'electron'
import { buildMacMenu } from './mac'
import { buildWinLinuxMenu } from './win-linux'

export function setupMenu(): void {
  const template = process.platform === 'darwin' ? buildMacMenu() : buildWinLinuxMenu()
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
```

菜单五组：文件（新建会话 Cmd+N）、编辑（撤销/剪切/复制/粘贴）、视图（重载/开发者工具/主题）、窗口（设置 Cmd+,、关于、最小化）、帮助（官网、报 bug、开源）。macOS 首项为应用菜单（元AI → 关于、偏好设置、隐藏、退出）。

### 2.4 全局快捷键

`src/main/shortcuts/global.ts`：

```typescript
import { globalShortcut } from 'electron'
import { openMainWindow } from '../windows/manager'

const DEFAULT_ACCELERATOR = 'CommandOrControl+Alt+Y'

export function setupGlobalShortcuts(): void {
  const accelerator = readMainPref('globalShortcut') ?? DEFAULT_ACCELERATOR
  if (!accelerator) return
  const ok = globalShortcut.register(accelerator, () => openMainWindow({ focus: true }))
  if (!ok) {
    // 与其他应用冲突：写入日志，UI 层轮询查询 status 后提示用户去设置里换一个
    console.warn(`[shortcut] 注册全局快捷键失败：${accelerator}`)
  }
}
```

`app.on('will-quit', () => globalShortcut.unregisterAll())` 在 index.ts 里挂上。

### 2.5 权限处理器

`src/main/security/permissions.ts`：

```typescript
import { session } from 'electron'

const ALLOWED = new Set(['media', 'mediaKeySystem', 'notifications', 'clipboard-read'])

export function setupPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED.has(permission))
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED.has(permission))
}
```

macOS 需要在 `resources/entitlements.mac.plist` 中声明相机/麦克风入口（见 Step 5）。

---

## Step 3：IPC 契约、safeStorage 桥、协议处理

### 3.0 主进程偏好持久化（`src/main/prefs/index.ts`）

主进程需要在窗口创建、快捷键注册等**早于 renderer 加载**的时机读取用户偏好（关闭到托盘开关、全局快捷键、开机自启、更新通道等）。这些不能走 renderer 的 zustand persist；直接读一份小 JSON：

```typescript
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

interface MainPrefs {
  closeToTray?: boolean
  globalShortcut?: string | null
  autoLaunch?: boolean
  updateChannel?: 'stable' | 'beta'
}

let cached: MainPrefs | null = null
const file = (): string => path.join(app.getPath('userData'), 'main-prefs.json')

function load(): MainPrefs {
  if (cached) return cached
  try {
    cached = JSON.parse(fs.readFileSync(file(), 'utf-8')) as MainPrefs
  } catch {
    cached = {}
  }
  return cached
}

export function readMainPref<K extends keyof MainPrefs>(key: K): MainPrefs[K] {
  return load()[key]
}

export function writeMainPref<K extends keyof MainPrefs>(key: K, value: MainPrefs[K]): void {
  const prefs = { ...load(), [key]: value }
  cached = prefs
  fs.writeFileSync(file(), JSON.stringify(prefs, null, 2), { mode: 0o600 })
}
```

Renderer 通过 `window.yuanai.system.*` 相关 IPC 修改偏好；主进程侧写入后广播 `system:prefsChanged` 让所有窗口同步。凡是 `readMainPref` 出现的地方均由此提供。

### 3.1 IPC 通道常量与类型契约（`src/shared/ipc-contract.ts`）

```typescript
export const IPC = {
  auth: {
    load: 'auth:load', // () => Promise<StoredSession | null>
    save: 'auth:save', // (session: StoredSession) => Promise<void>
    clear: 'auth:clear', // () => Promise<void>
  },
  window: {
    openSettings: 'window:openSettings',
    openAbout: 'window:openAbout',
    openLogin: 'window:openLogin',
    openArtifact: 'window:openArtifact', // (artifactId, initialData)
    close: 'window:close',
    minimize: 'window:minimize',
    maximize: 'window:maximize',
  },
  dialog: {
    openFiles: 'dialog:openFiles',
    saveFile: 'dialog:saveFile',
  },
  shell: {
    openExternal: 'shell:openExternal',
  },
  system: {
    getInfo: 'system:getInfo',
    setAutoLaunch: 'system:setAutoLaunch',
    getAutoLaunch: 'system:getAutoLaunch',
  },
  updater: {
    check: 'updater:check',
    quitAndInstall: 'updater:quitAndInstall',
    onEvent: 'updater:event', // main → renderer 单向广播
  },
  deepLink: {
    onNavigate: 'deeplink:navigate', // main → renderer 单向广播
  },
  oauth: {
    tokenReady: 'oauth:tokenReady', // main → renderer 单向广播
  },
} as const

export interface StoredSession {
  user: unknown // 与 packages/types User 保持结构一致
  accessToken: string
  refreshToken: string
}

export interface SystemInfo {
  platform: 'darwin' | 'win32' | 'linux'
  arch: string
  version: string
  isPackaged: boolean
}
```

### 3.2 safeStorage 桥（`src/main/ipc/auth.ts`）

```typescript
import { app, ipcMain, safeStorage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { IPC, type StoredSession } from '../../shared/ipc-contract'

function sessionFile(): string {
  return path.join(app.getPath('userData'), 'session.enc')
}

export async function hasStoredSession(): Promise<boolean> {
  try {
    await fs.access(sessionFile())
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function setupAuthIpc(): void {
  ipcMain.handle(IPC.auth.load, async (): Promise<StoredSession | null> => {
    if (!safeStorage.isEncryptionAvailable()) return null
    try {
      const encrypted = await fs.readFile(sessionFile())
      const json = safeStorage.decryptString(encrypted)
      return JSON.parse(json) as StoredSession
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.auth.save, async (_e, session: StoredSession) => {
    if (!safeStorage.isEncryptionAvailable()) return
    const encrypted = safeStorage.encryptString(JSON.stringify(session))
    await fs.writeFile(sessionFile(), encrypted, { mode: 0o600 })
  })

  ipcMain.handle(IPC.auth.clear, async () => {
    await fs.rm(sessionFile(), { force: true })
  })
}
```

**注意**：Linux 上 safeStorage 默认走 `Secret Service`（gnome-keyring / kwallet），无桌面钥匙串时会退化为明文 base64（Electron 已在 `isEncryptionAvailable` 中体现）。在 UI 层：`isEncryptionAvailable = false` 时提示用户"未检测到系统钥匙串，登录状态无法持久化，请手动登录"，且**拒绝**保存以免落盘明文。

### 3.3 协议处理（`src/main/protocol/handler.ts`）

```typescript
import { BrowserWindow } from 'electron'
import { openMainWindow, openOAuthLoadingWindow, closeOAuthLoadingWindow } from '../windows/manager'
import { IPC } from '../../shared/ipc-contract'

/**
 * 深链形态：
 *   yuanai://oauth/callback?access_token=xxx&refresh_token=yyy
 *   yuanai://oauth/callback?error=xxx&error_description=yyy
 *   yuanai://chat/{conversationId}
 */
export function handleProtocolUrl(rawUrl: string): void {
  const url = safeParse(rawUrl)
  if (!url) return

  if (url.host === 'oauth' && url.pathname === '/callback') {
    handleOAuthCallback(url)
    return
  }

  if (url.host === 'chat') {
    const conversationId = url.pathname.replace(/^\//, '')
    if (!conversationId) return
    broadcastDeepLink({ type: 'chat', conversationId })
    return
  }
}

function handleOAuthCallback(url: URL): void {
  const accessToken = url.searchParams.get('access_token')
  const refreshToken = url.searchParams.get('refresh_token')
  const error = url.searchParams.get('error')

  // 关闭 loading 窗（若尚未打开则忽略）
  closeOAuthLoadingWindow()

  const target = openMainWindow({ focus: true })
  target.webContents.send(IPC.oauth.tokenReady, {
    accessToken,
    refreshToken,
    error,
    errorDescription: url.searchParams.get('error_description'),
  })
}

function broadcastDeepLink(payload: { type: 'chat'; conversationId: string }): void {
  const win = openMainWindow({ focus: true })
  win.webContents.send(IPC.deepLink.onNavigate, payload)
}

function safeParse(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}
```

### 3.4 协议注册（`src/main/protocol/register.ts`）

```typescript
import { app } from 'electron'
import path from 'node:path'

export function registerProtocol(): void {
  const scheme = 'yuanai'
  if (process.defaultApp) {
    // 开发模式：需要把当前 argv[1]（入口 JS 路径）传入以便重启时能定位到正确的 Electron
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(scheme, process.execPath, [path.resolve(process.argv[1]!)])
    }
  } else {
    app.setAsDefaultProtocolClient(scheme)
  }
}
```

打包配置里 `protocols` 段声明 `yuanai`（见 Step 5）。

### 3.5 Preload（`src/preload/index.ts`）

```typescript
import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type StoredSession, type SystemInfo } from '../shared/ipc-contract'

const api = {
  platform: process.platform as 'darwin' | 'win32' | 'linux',

  auth: {
    load: (): Promise<StoredSession | null> => ipcRenderer.invoke(IPC.auth.load),
    save: (session: StoredSession): Promise<void> => ipcRenderer.invoke(IPC.auth.save, session),
    clear: (): Promise<void> => ipcRenderer.invoke(IPC.auth.clear),
  },

  window: {
    openSettings: () => ipcRenderer.invoke(IPC.window.openSettings),
    openAbout: () => ipcRenderer.invoke(IPC.window.openAbout),
    openLogin: () => ipcRenderer.invoke(IPC.window.openLogin),
    openArtifact: (artifactId: string, initialData: unknown) =>
      ipcRenderer.invoke(IPC.window.openArtifact, { artifactId, initialData }),
    close: () => ipcRenderer.invoke(IPC.window.close),
    minimize: () => ipcRenderer.invoke(IPC.window.minimize),
    maximize: () => ipcRenderer.invoke(IPC.window.maximize),
  },

  dialog: {
    openFiles: (): Promise<string[]> => ipcRenderer.invoke(IPC.dialog.openFiles),
  },

  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.shell.openExternal, url),
  },

  system: {
    getInfo: (): Promise<SystemInfo> => ipcRenderer.invoke(IPC.system.getInfo),
    setAutoLaunch: (enabled: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC.system.setAutoLaunch, enabled),
    getAutoLaunch: (): Promise<boolean> => ipcRenderer.invoke(IPC.system.getAutoLaunch),
  },

  updater: {
    check: () => ipcRenderer.invoke(IPC.updater.check),
    quitAndInstall: () => ipcRenderer.invoke(IPC.updater.quitAndInstall),
    onEvent: (cb: (payload: { type: string; data?: unknown }) => void) => {
      const listener = (_e: unknown, payload: { type: string; data?: unknown }) => cb(payload)
      ipcRenderer.on(IPC.updater.onEvent, listener)
      return () => ipcRenderer.off(IPC.updater.onEvent, listener)
    },
  },

  deepLink: {
    onNavigate: (cb: (payload: { type: 'chat'; conversationId: string }) => void) => {
      const listener = (_e: unknown, payload: { type: 'chat'; conversationId: string }) =>
        cb(payload)
      ipcRenderer.on(IPC.deepLink.onNavigate, listener)
      return () => ipcRenderer.off(IPC.deepLink.onNavigate, listener)
    },
  },

  oauth: {
    onTokenReady: (
      cb: (payload: {
        accessToken: string | null
        refreshToken: string | null
        error: string | null
        errorDescription: string | null
      }) => void
    ) => {
      const listener = (_e: unknown, payload: Parameters<typeof cb>[0]) => cb(payload)
      ipcRenderer.on(IPC.oauth.tokenReady, listener)
      return () => ipcRenderer.off(IPC.oauth.tokenReady, listener)
    },
  },
} as const

contextBridge.exposeInMainWorld('yuanai', api)

export type YuanaiApi = typeof api
```

Renderer 侧 `src/renderer/shared/global.d.ts`：

```typescript
import type { YuanaiApi } from '../../preload/index'
declare global {
  interface Window {
    readonly yuanai: YuanaiApi
  }
}
export {}
```

---

## Step 4：Renderer 层实现

### 4.1 `packages/core` 的兼容改动（唯一被动的共享包修改）

`auth.store.ts` 目前把 `dynamicStorage`（web 端 localStorage / sessionStorage 双轨）硬编码到 zustand `createJSONStorage` 里，桌面端需要注入 IPC-backed 存储。改造思路：

- 保持 web 端行为不变（默认导出仍走 `dynamicStorage`）
- 新增 `createAuthStore(customStorage: StateStorage)` 工厂
- 桌面端在 `src/renderer/shared/bootstrap.ts` 里调用工厂并把返回的 hook 覆盖到 `useAuthStore` 导出（或在 desktopStorage.ts 中挂载全局）

**最小改动方案（推荐）**：给 `packages/core` 增加一个 `setAuthStorage(storage: StateStorage)` setter，在 store 创建前调用一次即可覆盖。web 端不调用则保持现有行为。这样对 web 零风险。

`packages/core/src/stores/auth.store.ts` 新增（伪代码）：

```typescript
let injectedStorage: StateStorage | null = null

export function setAuthStorage(storage: StateStorage): void {
  injectedStorage = storage
}

// createJSONStorage(() => injectedStorage ?? dynamicStorage)
```

桌面端 renderer 在 `bootstrap.ts` 里：

```typescript
import { setAuthStorage } from '@yuanai/core/stores'
import { desktopStorage } from './desktopStorage'
setAuthStorage(desktopStorage)
```

`desktopStorage` 内部把 zustand persist 的 `getItem/setItem/removeItem` 转成对 `window.yuanai.auth` 的调用（load 一次缓存到内存，setItem 时批量落盘）。

### 4.2 API 客户端环境变量

`packages/core/src/api/client.ts` 已经通过 `getEnv('NEXT_PUBLIC_API_URL')` 兜底其他前缀。桌面端 `electron-vite` 需在 `renderer/shared/bootstrap.ts` 里执行：

```typescript
import { setApiBaseUrl } from '@yuanai/core/api'
setApiBaseUrl(import.meta.env['VITE_API_URL'] ?? 'http://localhost:8000/api/v1')
```

这需要在 `packages/core/src/api/client.ts` 追加一个 `setApiBaseUrl(url: string)` setter（改动量：1 个函数 + 修改 `apiClient.defaults.baseURL`）。

### 4.3 每个 renderer 入口的启动模板

`src/renderer/main/entry.tsx`：

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HashRouter } from 'react-router-dom'
import { bootstrap } from '../shared/bootstrap'
import { I18nProvider } from '../shared/I18nProvider'
import { ThemeProvider } from '../shared/ThemeProvider'
import { App } from './App'
import '@yuanai/ui/styles'
import '../shared/desktop.css'

void bootstrap({ window: 'main' })

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <HashRouter>
            <App />
          </HashRouter>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>
)
```

其他 5 个入口（`login/`, `settings/`, `about/`, `artifact/`, `oauth/`）复用同一模板，仅根组件与路由不同。

### 4.4 复用 web 端组件的策略

Web 端组件目前放在 `apps/web/src/components/**`，桌面端**不**跨 monorepo import（会引入 next-intl、next/navigation 等平台依赖）。分三档处理：

- **无平台依赖的纯组件** → 迁移到 `packages/ui` 或 `packages/core`，两端共用（ChatInterface 内的 `MessageList`、`AIMessage`、`UserMessage`、`CodeBlock`、`ArtifactPanel`、`ShareDialog` 等纯 UI）
- **有 Next 依赖但逻辑可抽的组件** → 拆成"逻辑 hook + 纯 UI 组件"，逻辑放 `packages/core/hooks`，UI 桌面端重写薄壳
- **强 Next 依赖组件**（如 OAuth 回调页依赖 `useSearchParams`） → 桌面端不复用，重写一个基于 `window.yuanai.oauth.onTokenReady` 的最小实现

**本 Phase 的最小目标**：不重构 web 端组件，仅新增 `packages/ui` 下的抽象。凡桌面端和 web 端有分歧的组件，桌面端先复制到 `apps/desktop/src/renderer/main/components/` 独立维护，二期再收敛。

### 4.5 OAuth 前端流程

用户在 LoginWindow 点击"用 GitHub 登录"：

1. Renderer 调 `window.yuanai.shell.openExternal(oauthAuthorizeUrl)` 打开系统浏览器
2. 同时 Renderer 调 `window.yuanai.window.openOAuthLoading()` 弹出 OAuth 中间态窗口（loading spinner）
3. 用户在浏览器完成授权后，后端 302 到 `yuanai://oauth/callback?access_token=…`
4. 系统拉起 Electron（可能启动新实例，通过 single instance lock 转发到已有实例）
5. `handleProtocolUrl` 解析 → 关闭 OAuth loading 窗 → 主窗口 `webContents.send(IPC.oauth.tokenReady, ...)`
6. Renderer 收到后写入 auth store → 主进程通过 safeStorage 落盘 → 跳转 `/chat`

### 4.6 深链接（chat）

Renderer 在启动时注册：

```typescript
window.yuanai.deepLink.onNavigate(({ type, conversationId }) => {
  if (type === 'chat') navigate(`/chat/${conversationId}`)
})
```

### 4.7 通知与 Web Push

Electron 默认支持 Web Push（Chromium 内置），但 FCM/APNs 需要 `applicationServerKey`。方案：

1. 先按 web 端相同逻辑走 Web Push（`ensurePushSubscribed`）
2. 主进程在 `session.defaultSession` 上启用 Push（Electron ≥33 已默认开启）
3. renderer 的 SW 逻辑与 web 完全一致（复用 `apps/web/public/sw.js` 拷贝一份到 `apps/desktop/src/renderer/public/sw.js`）
4. 若 subscribe 失败（endpoint 拿不到），fallback 到 SSE `/events`（需后端新增，见 Step 6）

前台通知走 Electron 原生 `new Notification()`（在 renderer 内可直接调用，Electron 内会转成原生系统通知）。

### 4.8 语音输入

复用 web 端 `useSpeechRecognition` 抽象**不可行**（依赖 Web Speech）。桌面端在 `apps/desktop/src/renderer/main/hooks/useDesktopVoice.ts` 内：

- `navigator.mediaDevices.getUserMedia({ audio: true })` 拿 MediaStream
- `MediaRecorder` 录制为 webm/opus
- 停止时 POST FormData 到 `POST /files/transcribe`（后端新增）
- 返回文本插入输入框

同一交互（按住说话 / 点击说话）由 UI 层抽象为 `useVoiceInput`（放 `packages/core/hooks`），桌面端和 web 端各自提供实现。

### 4.9 文件上传

Renderer 里 `<input type="file">` 在 Electron 内可直接得到 File 对象。为体验更好，附件按钮同时提供"从系统选择"：

```typescript
const paths = await window.yuanai.dialog.openFiles()
for (const p of paths) {
  const res = await fetch(`file://${p}`)
  const blob = await res.blob()
  // 走 packages/core/api/files.ts 已有 upload
}
```

`file://` 协议默认被 CSP 挡住，需在 `security/csp.ts` 的 `img-src`/`media-src` 加入 `file:`（或在主进程里注册 `custom-protocol` 中转）。**推荐做法**：主进程 `protocol.handle('yuanai-file', ...)` 提供本地文件读取，避免全局放开 `file://`。

---

## Step 5：打包、更新与 CI

### 5.1 `apps/desktop/electron-builder.yml`

```yaml
appId: com.yuanai.app
productName: 元AI
copyright: Copyright © 2026 yuanai
directories:
  output: release/${version}
  buildResources: resources

files:
  - out/**/*
  - '!out/**/*.map'

protocols:
  - name: yuanai
    schemes: [yuanai]

asar: true
compression: maximum

win:
  target:
    - target: nsis
      arch: [x64, arm64]
    - target: portable
      arch: [x64]
    - target: msi
      arch: [x64]
  icon: resources/icon.ico
  requestedExecutionLevel: asInvoker
  signAndEditExecutable: false # 待接入代码签名证书后置 true

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: 元AI
  installerIcon: resources/installer.ico
  uninstallerIcon: resources/uninstaller.ico
  installerHeaderIcon: resources/installer.ico
  deleteAppDataOnUninstall: false

portable:
  artifactName: yuanai-${version}-portable-${arch}.${ext}

msi:
  oneClick: false
  perMachine: true

mac:
  target:
    - target: dmg
      arch: [x64, arm64]
    - target: zip
      arch: [x64, arm64]
  icon: resources/icon.icns
  category: public.app-category.productivity
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: resources/entitlements.mac.plist
  entitlementsInherit: resources/entitlements.mac.plist
  extendInfo:
    NSCameraUsageDescription: 元AI 需要访问相机以支持拍照上传。
    NSMicrophoneUsageDescription: 元AI 需要访问麦克风以支持语音输入。
    LSApplicationCategoryType: public.app-category.productivity

dmg:
  contents:
    - x: 130
      y: 220
    - x: 410
      y: 220
      type: link
      path: /Applications
  window:
    width: 540
    height: 380

linux:
  target:
    - target: AppImage
      arch: [x64]
    - target: deb
      arch: [x64]
    - target: rpm
      arch: [x64]
  icon: resources/icons/linux # 目录，内含 512x512.png / 256x256.png / 128x128.png
  category: Network;Chat;
  synopsis: 智能 AI 聊天助手
  description: yuanai — 多端 AI 聊天应用，支持 GPT-4o、Claude、DeepSeek 等多种模型
  desktop:
    entry:
      MimeType: x-scheme-handler/yuanai;
      StartupWMClass: 元AI

deb:
  depends:
    - libnss3
    - libnotify4
    - libxtst6
    - libatspi2.0-0
    - libuuid1
    - libsecret-1-0
    - gir1.2-appindicator3-0.1

rpm:
  depends:
    - libXtst
    - libnotify
    - libuuid
    - libsecret

appImage:
  license: LICENSE
  artifactName: yuanai-${version}-${arch}.${ext}

publish:
  provider: github
  owner: <TO_FILL> # 用户自行填写，或从 gh-token 与 repo url 推断
  repo: yuanai
  releaseType: draft
```

### 5.2 自动更新

`src/main/updater/index.ts`：

```typescript
import { autoUpdater } from 'electron-updater'
import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-contract'

export function setupUpdater(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  const broadcast = (type: string, data?: unknown): void => {
    BrowserWindow.getAllWindows().forEach((w) =>
      w.webContents.send(IPC.updater.onEvent, { type, data })
    )
  }

  autoUpdater.on('checking-for-update', () => broadcast('checking'))
  autoUpdater.on('update-available', (info) => broadcast('available', info))
  autoUpdater.on('update-not-available', () => broadcast('none'))
  autoUpdater.on('download-progress', (p) => broadcast('progress', p))
  autoUpdater.on('update-downloaded', (info) => broadcast('downloaded', info))
  autoUpdater.on('error', (err) => broadcast('error', String(err)))

  if (!process.env['NODE_ENV']?.includes('development')) {
    void autoUpdater.checkForUpdates().catch(() => {
      /* 忽略首次静默失败 */
    })
  }
}
```

设置窗口的"关于本应用"分区提供"检查更新"按钮与"发现新版本"提示。

### 5.3 资源文件清单（`apps/desktop/resources/`）

| 文件                                | 规格                           | 用途                                   |
| ----------------------------------- | ------------------------------ | -------------------------------------- |
| `icon.icns`                         | macOS 图标（含所有尺寸）       | 应用图标                               |
| `icon.ico`                          | Windows 图标 256×256 多分辨率  | 应用图标                               |
| `icons/linux/`                      | 512/256/128/64/48/32/24/16 PNG | electron-builder 自动生成 desktop file |
| `tray/tray.ico`                     | Windows 托盘 16/32             | 系统托盘（亮/暗自动切换）              |
| `tray/trayTemplate.png` @1x @2x     | macOS 模板图                   | 自动跟随菜单栏亮暗色                   |
| `tray/tray-linux.png`               | 22×22 PNG                      | Linux AppIndicator                     |
| `installer.ico` / `uninstaller.ico` | Windows NSIS 图标              | 安装/卸载器                            |
| `entitlements.mac.plist`            | Xcode entitlements             | 麦克风、相机、网络访问                 |

`entitlements.mac.plist` 内容：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key><true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
    <key>com.apple.security.cs.disable-library-validation</key><true/>
    <key>com.apple.security.device.audio-input</key><true/>
    <key>com.apple.security.device.camera</key><true/>
    <key>com.apple.security.network.client</key><true/>
  </dict>
</plist>
```

### 5.4 `apps/desktop/package.json` scripts

```jsonc
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "build:unpack": "electron-vite build && electron-builder --dir",
    "package:win": "electron-vite build && electron-builder --win",
    "package:mac": "electron-vite build && electron-builder --mac",
    "package:linux": "electron-vite build && electron-builder --linux",
    "package:all": "electron-vite build && electron-builder -mwl",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run",
  },
}
```

### 5.5 CI（可选，本 Phase 只留位置）

在 `.github/workflows/desktop-release.yml` 中：

- 触发条件：tag `v*.*.*`
- Matrix：`ubuntu-latest` / `macos-latest` / `windows-latest` 分别产出对应平台安装包
- macOS：需注入 `CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_ID` / `APPLE_ID_PASSWORD` / `APPLE_TEAM_ID`（未接入前跳过 notarize）
- 上传 artifact 到 GitHub Release（`GH_TOKEN`）

---

## Step 6：后端配合的新增/调整

以下改动写入 `backend/` 但不属于本 Phase 主线；建议在 Phase 4 开始时同步 kick off，避免联调阻塞：

1. **OAuth desktop 回调 URI**
   - GitHub: 允许 `yuanai://oauth/callback` 作为白名单
   - Google: 桌面 OAuth 走 `loopback` 或 `custom URI scheme`；本项目选后者，`Authorized redirect URIs` 加入 `yuanai://oauth/callback`
   - 后端在 `/auth/{provider}/authorize` 支持 `?redirect=desktop` 参数（区分 web 与 desktop 回调），最终 302 到 `yuanai://oauth/callback?access_token=…`
2. **语音转写**
   - 新增 `POST /files/transcribe`，multipart（audio/webm 或 audio/wav），走 `openai.audio.transcriptions`（Whisper） 或本地 provider
   - 返回 `{ text: string, durationMs: number }`
   - `packages/types` 追加 `TranscribeResponse`
3. **推送 fallback（SSE）**
   - 若 Web Push 在桌面端不可用，新增 `GET /events` SSE，事件类型 `ai_reply_completed`；桌面 renderer 建立长连接
   - 首版可先不做，观察 Web Push 在 Electron 33 的表现

---

## Step 7：验收标准

**运行时**

- [ ] `pnpm --filter @yuanai/desktop dev` 三端（Windows/Ubuntu/macOS 虚拟机）启动无错，六个 renderer 入口均可打开
- [ ] 未登录首启显示 LoginWindow，登录成功切换到 MainWindow
- [ ] 邮箱登录 + "记住我" 重启应用后自动进入 `/chat`（safeStorage 生效）
- [ ] Cmd/Ctrl+, 打开独立 SettingsWindow；6 分区所有开关与 web 端一致
- [ ] GitHub 或 Google 登录：系统浏览器打开 → `yuanai://` 拉起应用 → OAuth loading 窗一闪即关 → 主窗口登录成功
- [ ] 深链接 `yuanai://chat/{已有会话id}` 从浏览器地址栏输入能唤起应用并跳转对应会话
- [ ] 关闭主窗口后应用隐藏到托盘；托盘图标 + 右键菜单可显示/退出；单击（Win/Linux）或菜单（macOS）唤起
- [ ] 设置里切换"关闭时直接退出" 后关闭主窗口应用真正退出
- [ ] Ctrl+Alt+Y 从任意应用唤起 yuanai 主窗口；快捷键冲突时设置里可改
- [ ] 麦克风首次使用弹出系统权限对话框；授权后语音输入走 MediaRecorder → 后端转写
- [ ] AI 回复完成弹出系统通知；点击通知唤起窗口并聚焦到对应会话
- [ ] Artifact 点"分离到独立窗口" 可开一个专属预览窗口，关闭不影响主聊天
- [ ] Cmd+Q / 主菜单退出 → 真正退出（不进托盘）

**平台特有**

- [ ] Windows：任务栏图标正确；SmartScreen 提示"未知发布者"（预期，待签名）；关闭到托盘后托盘图标可见
- [ ] macOS：标题栏 traffic light 位置正确、可拖动区域正常；关闭红点不退出，Dock 图标保留
- [ ] Linux (Ubuntu GNOME)：AppIndicator 扩展已装时托盘可见；未装时 UI 提示用户安装；`.desktop` 文件注册 `yuanai://` 处理器成功

**打包**

- [ ] `pnpm --filter @yuanai/desktop package:win` 产出 NSIS installer + Portable + MSI，安装、启动、卸载全流程无错
- [ ] `pnpm --filter @yuanai/desktop package:linux` 产出 AppImage + deb + rpm；AppImage 双击可跑；deb 在 Ubuntu 22.04 可 `sudo dpkg -i` 安装
- [ ] `pnpm --filter @yuanai/desktop package:mac` 产出 DMG + ZIP；DMG 拖入 Applications 可运行（未签名时需手动允许）

**自动更新**

- [ ] 用测试 GitHub Release（版本 `v0.0.2`）+ 本地跑 `v0.0.1` 打包版，能收到 "update-available" 事件并可下载 → 提示重启安装

**代码质量**

- [ ] `pnpm --filter @yuanai/desktop typecheck` 通过
- [ ] `pnpm --filter @yuanai/desktop lint` 通过
- [ ] `packages/core` 的改动通过原有 `pnpm --filter @yuanai/core test:unit`（保证 web 端零回归）
- [ ] Web 端 `pnpm --filter @yuanai/web build` 与 `test` 无回归

---

## 后续二期占位

以下条目**不在** Phase 4 交付范围，仅在此登记以免遗漏：

- 微信扫码登录：LoginWindow 内新增"扫码"页签，与账号密码共存
- 全局 Cmd+K 命令面板：独立轻量窗口，聚合会话检索 / 快捷动作
- 代码签名与公证：Windows EV 证书 + macOS notarize 打通 CI
- Widget / 灵动岛（macOS Sonoma+）与 Windows 11 Widgets
- 离线草稿：断网时聊天消息本地缓存，恢复后重发
