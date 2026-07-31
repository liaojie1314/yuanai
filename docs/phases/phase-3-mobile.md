# Phase 3 — 移动端开发（Expo + React Native）

**前置条件**: Phase 0 完成（Monorepo），Phase 1 完成（后端），Phase 2 完成（`packages/core` 已含全部 stores/hooks/api）
**分支**: `feat/phase-3-mobile`
**执行范围**:

- `apps/mobile/`
- 少量 `packages/core/` 平台适配层改造（见 Step 0）
- `backend/` 新增 Expo Push token 上报接口（Step 9 契约段）
  **目标平台**: iOS 15+、Android 8+（API 26+）。**HarmonyOS 不在 v1 范围**（HarmonyOS 4 及以下可自动运行 APK；HarmonyOS Next 需独立 ArkTS 应用，留待 v2）。

---

## 0. 目标：与 Web 端功能对齐

Phase 2 落地后 Web 端能力已远超最初 v1 目标，Phase 3 需**完整复刻**下列能力，让"移动端"与"Web 端"在核心功能上等价，仅在交互形式上做原生化调整。

### 0.1 完整能力清单

| 能力域            | 具体功能                              | Web 端来源                                     | 移动端策略                                                       |
| ----------------- | ------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **认证**          | 邮箱/密码 登录/注册                   | `apps/web/src/app/(auth)/login,register`       | Expo Router 路由组 `(auth)`                                      |
|                   | 忘记密码 + 验证码                     | `apps/web/src/app/(auth)/forgot-password`      | 复用 `useSendVerifyCode` / `useResetPassword`                    |
|                   | Google OAuth                          | `apps/web/src/app/(auth)/oauth/callback`       | 原生 SDK `@react-native-google-signin/google-signin`             |
|                   | GitHub OAuth                          | 同上                                           | 系统浏览器 + Deep Link 回调（GitHub 无原生 SDK）                 |
|                   | Token 持久化                          | `localStorage`                                 | `expo-secure-store`（access/refresh token）                      |
| **会话**          | 列表 / 分组（置顶/今日/昨日/本周）    | `ChatInterface.groupedConvs`                   | `SectionList` 或 `FlashList` 分组渲染                            |
|                   | 搜索 / 多选 / 批量删除                | 同上                                           | 顶部搜索栏 + 长按进多选态                                        |
|                   | 重命名 / 置顶 / 删除                  | `openCvMenu` 弹层                              | 长按 → `ActionSheetIOS` / Android BottomSheet                    |
|                   | 临时对话 (`temporary chat`)           | `useState<temporary>` + `stream.sendTemporary` | 完全复用 `useStream.sendTemporary`                               |
| **流式对话**      | SSE token 流                          | `useStream.send` + `fetch ReadableStream`      | 需替换底层：Web fetch stream → `react-native-sse`                |
|                   | 思考过程 (`thinking_delta`)           | `ThinkBlock.tsx`                               | 折叠式 `Collapsible` 组件                                        |
|                   | 工具调用 (`tool_call_*`)              | `ToolCallRow.tsx`                              | 原生等价，卡片式展示                                             |
|                   | 中断/停止                             | `stream.stop()`                                | `AbortController` 桥接 `react-native-sse.close()`                |
| **消息交互**      | 用户消息内编辑                        | `UserMessage` inline edit                      | Modal 或 inline TextInput                                        |
|                   | 重新生成 + 多版本切换                 | `versionIdxs` state                            | 左右滑动切换版本（PagerView）                                    |
|                   | 点赞 / 踩 + 反馈弹层                  | `feedbackDialog`                               | BottomSheet + 分类 chip                                          |
|                   | 长按菜单（复制/删除）                 | `AIMessage` context menu                       | 长按 → `ActionSheet`                                             |
|                   | 消息大纲 (`MessageOutline`)           | 右侧悬浮                                       | 手机：抽屉页；平板：右侧悬浮                                     |
|                   | 滚动到底部 FAB                        | `showScrollFab`                                | 复用逻辑，FlashList `onScroll`                                   |
| **Markdown 渲染** | 段落 / 列表 / 表格 / 引用             | `react-markdown + remark-gfm`                  | `react-native-markdown-display`                                  |
|                   | 代码块 + 语言标签 + 复制按钮          | `CodeBlock.tsx`                                | `react-native-syntax-highlighter` + `expo-clipboard`             |
|                   | 思考块折叠                            | `ThinkBlock`                                   | 原生 Collapsible                                                 |
| **Artifacts**     | HTML/JS 沙箱运行                      | `ArtifactPanel` iframe                         | 手机/平板均可：`react-native-webview` 加载 core `buildRunSrcDoc` |
|                   | CodeMirror 编辑                       | `@uiw/react-codemirror`                        | 移动端不提供编辑（只读高亮 + 运行预览）                          |
|                   | JSON 树 / CSV 表格预览                | 自实现                                         | 移动端暂不提供（后续增量）                                       |
|                   | 控制台桥接                            | postMessage 桥                                 | WebView `onMessage` 桥（面板底部日志条）                         |
| **附件**          | 图片 / 文档上传                       | `input[type=file]`                             | `expo-image-picker` + `expo-document-picker`                     |
|                   | 相机拍照                              | `getUserMedia`                                 | `expo-image-picker` `launchCameraAsync`                          |
|                   | ~~截屏~~                              | `getDisplayMedia`                              | **不做**（用户使用系统截屏）                                     |
|                   | 秒传（hash）+ 分片上传                | `uploadFileSmart`                              | 完全复用 `packages/core` 现有实现                                |
|                   | 上传进度条                            | `AttachFile.progress`                          | 完全复用                                                         |
| **语音**          | 语音输入                              | Web Speech API                                 | 原生 STT：`@react-native-voice/voice`                            |
| **模型切换**      | 模型下拉列表                          | `ModelSelector`                                | BottomSheet 列表                                                 |
|                   | 联网搜索 / 思考模式开关               | 输入区图标按钮                                 | 输入区图标按钮                                                   |
| **分享**          | 生成 / 撤销分享链接                   | `ShareDialog`                                  | 复用 `useCreateShareLink`                                        |
|                   | 密码保护 / 过期时间                   | 同上                                           | 复用                                                             |
|                   | 分享出去                              | 复制链接                                       | **系统分享面板**（`Share.share`）                                |
|                   | 打开分享页                            | `/share/[token]`                               | Deep Link `yuanai://share/:token`                                |
| **设置**          | 个人资料（头像/用户名/邮箱）          | `SettingsModal profile`                        | 独立 Screen                                                      |
|                   | 安全（改密/改邮箱/删除账号/清空对话） | `SettingsModal security`                       | 独立 Screen + 系统级二次确认                                     |
|                   | 三方账号解绑                          | `useUnlinkGoogle/Github`                       | 复用                                                             |
|                   | 外观（主题/字号/密度）                | `usePrefsStore`                                | 复用 store                                                       |
|                   | 通知开关                              | `notif_browser/sound/ai`                       | Expo Notifications 权限 + 本地开关                               |
|                   | 语言（i18n）                          | `next-intl`                                    | `i18next`                                                        |
|                   | 关于 / 版本号                         | 静态段                                         | `expo-application` 读取版本                                      |
| **推送**          | Web Push (VAPID)                      | `lib/push.ts`                                  | **Expo Push**（token 上报 `/notifications/expo`）                |
|                   | AI 回复完成通知                       | `triggerAIReplyNotification`                   | 后端在流结束后触发 Expo Push                                     |
|                   | 通知点击回到会话                      | Service Worker `notificationclick`             | `expo-notifications` `addNotificationResponseReceivedListener`   |
| **主题**          | 明/暗/跟随系统                        | `data-theme` 属性                              | `NativeWind` `dark:` + `useColorScheme`                          |
|                   | 用户手动切换                          | `usePrefsStore.theme`                          | 复用 store                                                       |
| **布局**          | 手机（<768）：抽屉                    | Sidebar `md:hidden`                            | Drawer navigator                                                 |
|                   | 平板（≥768）：双栏                    | Sidebar always visible                         | 左侧列表 + 右侧内容                                              |
|                   | 横竖屏切换                            | CSS 自适应                                     | `orientation: default` + `useWindowDimensions`                   |

### 0.2 显式不做（v1 排除项）

- HarmonyOS Next（留待 v2）
- 截屏功能
- 桌面级"多标签"或多窗口
- 打开外链的独立浏览器视图（用系统浏览器）
- **手机端**的 Artifact 编辑（CodeMirror；运行预览已支持，编辑不做）

---

## 1. 技术选型总表

| 需求                 | 方案                                              | 说明                                      |
| -------------------- | ------------------------------------------------- | ----------------------------------------- |
| Monorepo 集成        | pnpm workspace + Metro `watchFolders`             | Expo 52 已支持                            |
| 导航                 | Expo Router v4                                    | 文件系统路由，与 Next App Router 心智一致 |
| 样式                 | NativeWind v4 + Tailwind CSS                      | 与 Web 共用 Tailwind token                |
| 列表                 | `@shopify/flash-list`                             | 消息 / 会话大列表                         |
| 分页/滚动大纲        | FlashList `viewabilityConfig`                     | 替代 Web 的 `react-virtuoso.rangeChanged` |
| Markdown             | `react-native-markdown-display`                   | 原生渲染                                  |
| 代码高亮             | `react-native-syntax-highlighter`                 | `prism-react-renderer` 后端               |
| 剪贴板               | `expo-clipboard`                                  | 代码块 / 消息复制                         |
| SSE 流               | **`react-native-sse`**                            | 支持 POST body + 自定义 headers           |
| 图片选择             | `expo-image-picker`                               | 相机 + 相册二合一                         |
| 文档选择             | `expo-document-picker`                            | PDF / DOCX / TXT                          |
| 图片展示             | `expo-image`                                      | 内置缓存                                  |
| 安全存储             | `expo-secure-store`                               | access / refresh token                    |
| 本地存储             | `@react-native-async-storage/async-storage`       | Zustand persist / Query cache             |
| 底部安全区           | `react-native-safe-area-context`                  | 全端必备                                  |
| 屏幕方向 / 尺寸      | `useWindowDimensions` + `expo-screen-orientation` | 平板断点 768                              |
| 键盘处理             | `react-native-keyboard-controller`                | iOS/Android 一致                          |
| Haptic               | `expo-haptics`                                    | 发送 / 长按反馈                           |
| 手势                 | `react-native-gesture-handler`                    | 左滑删除、长按                            |
| 动画                 | `react-native-reanimated` v3                      | 消息进场 / 光标闪烁                       |
| BottomSheet          | `@gorhom/bottom-sheet`                            | 模型 / 设置 / 反馈                        |
| WebView（Artifacts） | `react-native-webview`                            | 手机 + 平板运行预览                       |
| 语音输入             | `@react-native-voice/voice`                       | 系统 STT                                  |
| 分享                 | React Native `Share` API                          | 系统分享面板                              |
| Google 登录          | `@react-native-google-signin/google-signin`       | 原生 SDK                                  |
| GitHub 登录          | `expo-web-browser` + `expo-linking`               | Deep Link 回调                            |
| 深链接               | `expo-linking` scheme `yuanai`                    | OAuth / share                             |
| 网络状态             | `@react-native-community/netinfo`                 | SSE 重连策略                              |
| 推送                 | `expo-notifications` + Expo Push Service          | 跨平台                                    |
| i18n                 | `i18next` + `react-i18next` + `expo-localization` | 复用 Web messages                         |
| 崩溃监控             | `@sentry/react-native`                            | Native + JS + release                     |
| 构建                 | EAS Build（云） / `expo prebuild`（本地）         | 两条链路并存                              |
| OTA                  | EAS Update (`expo-updates`)                       | JS/asset 热更                             |
| 应用信息             | `expo-application`                                | 版本号 / bundle id                        |
| 状态管理             | Zustand（复用） / TanStack Query（复用）          | 与 Web 一致                               |
| 语言                 | TypeScript strict                                 | 与 Web 一致                               |

---

## Step 0：`packages/core` 平台适配层改造（必做前置）

Web 端 `useStream` 依赖浏览器 `fetch + ReadableStream`，RN 上不可用。为避免 `packages/mobile` fork 一份，把平台差异抽象出去。

### 0.1 引入平台适配器

在 `packages/core/src/api/` 新增：

```
packages/core/src/api/
├── platform/
│   ├── index.ts              ← 导出 platformStream, platformStorage
│   ├── web.ts                ← Web 实现（fetch + localStorage）
│   └── mobile.ts             ← Mobile 实现（react-native-sse + AsyncStorage/SecureStore）
```

**接口定义（`platform/types.ts`）**：

```ts
export interface StreamRequest {
  url: string
  method: 'POST' | 'GET'
  headers: Record<string, string>
  body?: string
  signal?: AbortSignal
}

export interface StreamHandlers {
  onOpen?: () => void
  onMessage: (raw: string) => void // 一整行 `data: ...`
  onError: (err: Error) => void
  onClose?: () => void
}

export interface PlatformAdapter {
  stream(req: StreamRequest, handlers: StreamHandlers): { close: () => void }
  storage: {
    getItem(key: string): Promise<string | null>
    setItem(key: string, value: string): Promise<void>
    removeItem(key: string): Promise<void>
  }
  secureStorage: {
    getItem(key: string): Promise<string | null>
    setItem(key: string, value: string): Promise<void>
    removeItem(key: string): Promise<void>
  }
}
```

**Web 实现**：直接沿用当前 `useStream.ts` 的 `fetch + reader.read()` 逻辑封装。secureStorage 在 Web 上等价于 localStorage（或 httpOnly cookie，如已实现）。

**Mobile 实现**（骨架）：

```ts
// packages/core/src/api/platform/mobile.ts
import EventSource from 'react-native-sse'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'

export const mobileAdapter: PlatformAdapter = {
  stream(req, handlers) {
    const es = new EventSource(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      pollingInterval: 0, // 一次性长连接
      timeout: 0,
    })
    es.addEventListener('open', () => handlers.onOpen?.())
    es.addEventListener('message', (e) => handlers.onMessage(e.data ?? ''))
    es.addEventListener('error', (e) => handlers.onError(new Error(e.message ?? 'SSE error')))
    es.addEventListener('close', () => handlers.onClose?.())
    return { close: () => es.close() }
  },
  storage: {
    getItem: AsyncStorage.getItem,
    setItem: (k, v) => AsyncStorage.setItem(k, v),
    removeItem: AsyncStorage.removeItem,
  },
  secureStorage: {
    getItem: SecureStore.getItemAsync,
    setItem: (k, v) => SecureStore.setItemAsync(k, v),
    removeItem: SecureStore.deleteItemAsync,
  },
}
```

### 0.2 注入方式

`packages/core` 保留一个 `setAdapter(adapter: PlatformAdapter)` 全局函数：

```ts
// packages/core/src/api/platform/index.ts
let current: PlatformAdapter | null = null
export function setPlatformAdapter(a: PlatformAdapter): void {
  current = a
}
export function getPlatformAdapter(): PlatformAdapter {
  if (!current) throw new Error('PlatformAdapter not set. Call setPlatformAdapter() at app entry.')
  return current
}
```

- `apps/web/src/app/layout.tsx` 顶层调用 `setPlatformAdapter(webAdapter)`
- `apps/mobile/app/_layout.tsx` 顶层调用 `setPlatformAdapter(mobileAdapter)`

### 0.3 改写 `useStream`

`useStream.ts` 把当前 `fetch(...).body.getReader()` 逻辑改为调用 `getPlatformAdapter().stream({...}, {onMessage: parseSseLine, ...})`。上层 API 完全不变，`ChatInterface` 无需修改。

### 0.4 Zustand persist 同理

`packages/core/src/stores/prefs.store.ts` 等 `persist({ name })` 目前默认使用 `localStorage`，需改为：

```ts
persist(..., {
  name: 'yuanai-prefs',
  storage: createJSONStorage(() => ({
    getItem: (k) => getPlatformAdapter().storage.getItem(k),
    setItem: (k, v) => getPlatformAdapter().storage.setItem(k, v),
    removeItem: (k) => getPlatformAdapter().storage.removeItem(k),
  })),
})
```

**验收**：Web 端 `pnpm dev` 无回归；`apps/mobile` 能加载 `packages/core` 且 stream/persist 走 mobile adapter。

---

## Step 1：安装依赖

```bash
cd apps/mobile

# ── Expo 核心 & 原生适配 ─────────────────
npx expo install expo-router expo-secure-store expo-image-picker \
  expo-document-picker expo-image expo-haptics expo-clipboard \
  expo-linking expo-splash-screen expo-status-bar expo-application \
  expo-notifications expo-localization expo-screen-orientation \
  expo-web-browser expo-constants expo-updates \
  react-native-safe-area-context react-native-screens \
  react-native-gesture-handler react-native-reanimated \
  react-native-keyboard-controller

# ── UI / 列表 ────────────────────────────
npx expo install nativewind tailwindcss @shopify/flash-list \
  @gorhom/bottom-sheet react-native-svg

# ── 网络 / 存储 ───────────────────────────
pnpm add react-native-sse @react-native-async-storage/async-storage \
  @react-native-community/netinfo

# ── 三方登录 / 语音 ───────────────────────
pnpm add @react-native-google-signin/google-signin @react-native-voice/voice

# ── Markdown / WebView / 崩溃 ────────────
pnpm add react-native-markdown-display react-native-syntax-highlighter \
  react-native-webview @sentry/react-native

# ── i18n ────────────────────────────────
pnpm add i18next react-i18next

# ── 共享包 ─────────────────────────────
pnpm add @yuanai/types@workspace:* @yuanai/core@workspace:*

# ── 状态（复用 Web 版本） ─────────────────
pnpm add @tanstack/react-query zustand
```

> 说明：`@react-native-voice/voice` 和 `@react-native-google-signin/google-signin` 需要 `expo prebuild` + 原生模块编译，**Expo Go 不支持**。开发时使用 Development Build（`eas build --profile development` 或本地 `expo run:ios / android`）。

---

## Step 2：项目配置

### 2.1 `apps/mobile/app.json`

```jsonc
{
  "expo": {
    "name": "元AI",
    "slug": "yuanai",
    "scheme": "yuanai",
    "version": "1.0.0",
    "orientation": "default",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "icon": "./assets/icon.png",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#FAFAF8",
      "dark": {
        "image": "./assets/splash-dark.png",
        "backgroundColor": "#0F1117",
      },
    },
    "assetBundlePatterns": ["**/*"],
    "updates": {
      "url": "https://u.expo.dev/<eas-project-id>",
      "checkAutomatically": "ON_LOAD",
      "fallbackToCacheTimeout": 0,
    },
    "runtimeVersion": { "policy": "appVersion" },
    "ios": {
      "bundleIdentifier": "com.yuanai.app",
      "supportsTablet": true,
      "buildNumber": "1",
      "infoPlist": {
        "NSCameraUsageDescription": "上传拍照图片时需要访问相机",
        "NSPhotoLibraryUsageDescription": "上传相册中的图片时需要访问相册",
        "NSMicrophoneUsageDescription": "使用语音输入功能时需要访问麦克风",
        "NSSpeechRecognitionUsageDescription": "使用语音输入功能时需要访问语音识别",
        "ITSAppUsesNonExemptEncryption": false,
        "CFBundleAllowMixedLocalizations": true,
      },
      "associatedDomains": ["applinks:yuanai.example.com"],
      "config": {
        "usesNonExemptEncryption": false,
      },
      "googleServicesFile": "./GoogleService-Info.plist",
    },
    "android": {
      "package": "com.yuanai.app",
      "versionCode": 1,
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#6366F1",
      },
      "permissions": [
        "CAMERA",
        "READ_MEDIA_IMAGES",
        "READ_MEDIA_VIDEO",
        "READ_EXTERNAL_STORAGE",
        "RECORD_AUDIO",
        "POST_NOTIFICATIONS",
        "INTERNET",
        "ACCESS_NETWORK_STATE",
      ],
      "googleServicesFile": "./google-services.json",
      "intentFilters": [
        {
          "action": "VIEW",
          "autoVerify": true,
          "data": [{ "scheme": "https", "host": "yuanai.example.com" }],
          "category": ["BROWSABLE", "DEFAULT"],
        },
      ],
    },
    "plugins": [
      "expo-router",
      "expo-secure-store",
      "expo-localization",
      "expo-updates",
      ["expo-splash-screen", { "backgroundColor": "#FAFAF8" }],
      [
        "expo-image-picker",
        {
          "photosPermission": "元AI 需要访问你的相册以上传图片",
          "cameraPermission": "元AI 需要访问你的相机以拍照上传",
        },
      ],
      [
        "expo-notifications",
        {
          "icon": "./assets/notification-icon.png",
          "color": "#6366F1",
          "sounds": [],
        },
      ],
      [
        "@react-native-google-signin/google-signin",
        {
          "iosUrlScheme": "com.googleusercontent.apps.<YOUR_IOS_CLIENT_ID>",
        },
      ],
      [
        "@sentry/react-native/expo",
        {
          "url": "https://sentry.io/",
          "project": "yuanai-mobile",
          "organization": "yuanai",
        },
      ],
    ],
    "extra": {
      "eas": { "projectId": "<eas-project-id>" },
      "apiBaseUrl": "https://api.yuanai.example.com/api/v1",
      "googleWebClientId": "<YOUR_WEB_CLIENT_ID>.apps.googleusercontent.com",
      "githubOauthUrl": "https://api.yuanai.example.com/api/v1/auth/github/authorize",
    },
  },
}
```

### 2.2 `apps/mobile/eas.json`

```jsonc
{
  "cli": { "version": ">= 3.13.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "channel": "development",
      "ios": { "simulator": true },
      "env": { "EXPO_PUBLIC_API_URL": "http://localhost:8000/api/v1" },
    },
    "preview": {
      "distribution": "internal",
      "channel": "preview",
      "android": { "buildType": "apk" },
      "env": { "EXPO_PUBLIC_API_URL": "https://api-staging.yuanai.example.com/api/v1" },
    },
    "production": {
      "channel": "production",
      "autoIncrement": true,
      "env": { "EXPO_PUBLIC_API_URL": "https://api.yuanai.example.com/api/v1" },
    },
  },
  "submit": {
    "production": {
      "ios": { "appleId": "<xx@xx.com>", "ascAppId": "<APP_STORE_CONNECT_ID>" },
      "android": { "serviceAccountKeyPath": "./play-service-account.json", "track": "internal" },
    },
  },
}
```

### 2.3 `apps/mobile/tailwind.config.js`

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 与 packages/ui 的 CSS 变量语义对齐
        brand: { from: '#6366F1', to: '#8B5CF6', solid: '#7C3AED', light: '#EDE9FE' },
        bg: { base: '#FAFAF8', surface: '#FFFFFF', elevated: '#F4F4F2' },
        text: { primary: '#1A1A2E', secondary: '#6B7280', muted: '#9CA3AF' },
        border: { default: '#E5E7EB', focus: '#6366F1' },
        // Dark
        'bg-dark': { base: '#0F1117', surface: '#171A22', elevated: '#20242E' },
      },
      borderRadius: { chat: '18px' },
    },
  },
}
```

### 2.4 `apps/mobile/babel.config.js`

```js
module.exports = function (api) {
  api.cache(true)
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    plugins: ['react-native-reanimated/plugin'], // 必须在最后
  }
}
```

### 2.5 `apps/mobile/.env.example`

```
EXPO_PUBLIC_API_URL=http://localhost:8000/api/v1
EXPO_PUBLIC_SENTRY_DSN=
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=
```

### 2.6 Metro monorepo 配置 `metro.config.js`

```js
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)
config.watchFolders = [monorepoRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
]
config.resolver.disableHierarchicalLookup = true

module.exports = config
```

---

## Step 3：原生适配基线（**关键**）

Web 端不需要处理这些，但移动端必须在 Step 4-13 开发前铺好底座。

### 3.1 SafeArea（刘海 / 动态岛 / Home Indicator / Android 手势条）

`react-native-safe-area-context` 是**所有屏幕**都要用的基础库。

**规则**：

- 顶层 Provider 在 `_layout.tsx` 挂载
- 所有全屏页面用 `<SafeAreaView edges={['top']}>` 或手动 `useSafeAreaInsets()`
- 底部输入区 `paddingBottom: insets.bottom + 8`（避免和 Home Indicator 重叠）
- 键盘弹起时用 `react-native-keyboard-controller` 覆盖，**不再依赖** insets.bottom
- 刘海 / 动态岛：`edges={['top']}` 自动避让
- Android：`edgeToEdge: true`（Expo SDK 52 已默认），系统栏透明化，需手动加 `insets.top` 和 `insets.bottom`

**常见坑**：

- ❌ 不要把 `<SafeAreaView>` 包在 `<KeyboardAvoidingView>` 内层，顺序错了 keyboard 会顶到内容遮挡
- ✅ 顺序：`<SafeAreaProvider>` → `<KeyboardProvider>` → 页面 → `<SafeAreaView>`
- ❌ 不要用旧版 `react-native` 自带的 `SafeAreaView`，只支持 iOS 且行为不一致

### 3.2 键盘策略

统一用 `react-native-keyboard-controller`，替代传统 `KeyboardAvoidingView`（后者 Android 表现不稳）：

```tsx
// _layout.tsx
import { KeyboardProvider } from 'react-native-keyboard-controller'

;<KeyboardProvider statusBarTranslucent navigationBarTranslucent>
  {/* ... */}
</KeyboardProvider>
```

**输入区聊天页**用 `<KeyboardAvoidingView behavior="padding">` 或 `<KeyboardStickyView offset={{ closed: 0, opened: 0 }}>`（在键盘上方粘住）。

**iOS 特殊**：把输入 focus 时 `Keyboard.addListener('keyboardDidShow')` 里调用 FlashList 的 `scrollToIndex('LAST')`，避免键盘弹起时看不到最新消息。

**Android 特殊**：`android:windowSoftInputMode` 交给 `keyboard-controller` 管理，不要在 `AndroidManifest.xml` 里手写 `adjustResize`。

### 3.3 Splash 屏

用 `expo-splash-screen`，**手动控制隐藏时机**（等首屏关键数据就绪后再隐藏，防白闪）：

```tsx
// _layout.tsx
import * as SplashScreen from 'expo-splash-screen'
SplashScreen.preventAutoHideAsync()  // 顶层同步调用

export default function RootLayout() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    void (async () => {
      // 1. 恢复 token
      const token = await SecureStore.getItemAsync('access_token')
      if (token) useAuthStore.getState().setToken(token)
      // 2. 恢复 prefs（Zustand persist 会自动 hydrate，等它一次）
      await new Promise((r) => setTimeout(r, 50))
      // 3. Sentry init
      Sentry.init({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN, ... })
      setReady(true)
      await SplashScreen.hideAsync()
    })()
  }, [])
  if (!ready) return null
  return /* ... */
}
```

### 3.4 深色模式

三方数据源：

1. **系统外观**：`useColorScheme()`（`react-native`）
2. **用户偏好**：`usePrefsStore((s) => s.theme)`（`auto | light | dark`）
3. **推导结果**：`theme === 'auto' ? systemScheme : theme`

在 `_layout.tsx` 顶层：

```tsx
import { vars, useColorScheme } from 'nativewind'
import { useEffect } from 'react'
import { StatusBar } from 'expo-status-bar'

function ThemeShell({ children }) {
  const { colorScheme, setColorScheme } = useColorScheme()
  const theme = usePrefsStore((s) => s.theme)
  useEffect(() => {
    setColorScheme(theme === 'auto' ? null : theme)
  }, [theme])
  return (
    <>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      {children}
    </>
  )
}
```

### 3.5 深链接（Deep Link）

`scheme: yuanai`（`app.json` 中定义），支持：

| 路径                                                         | 触发时机                                    | 目标屏                  |
| ------------------------------------------------------------ | ------------------------------------------- | ----------------------- |
| `yuanai://oauth/callback?access_token=...&refresh_token=...` | GitHub OAuth 后端 302 回调                  | `(auth)/oauth-callback` |
| `yuanai://share/<token>`                                     | 用户点击别人分享的链接                      | `share/[token]`         |
| `https://yuanai.example.com/share/<token>`                   | Universal Link（iOS）/ App Links（Android） | 同上                    |

**Universal Link 校验文件**：

- iOS: `https://yuanai.example.com/.well-known/apple-app-site-association`
- Android: `https://yuanai.example.com/.well-known/assetlinks.json`

由 `apps/web` 提供路由，由后端或 CDN 保证 `Content-Type: application/json`。

**Expo Router 集成**：`expo-router` 自动使用 scheme + 文件路由映射，无需手写 Linking config。测试：

```bash
# iOS
xcrun simctl openurl booted "yuanai://share/abc123"
# Android
adb shell am start -W -a android.intent.action.VIEW -d "yuanai://share/abc123" com.yuanai.app
```

### 3.6 权限请求 UX

**原则**：所有敏感权限（相机 / 相册 / 麦克风 / 通知）**首次进入功能前"预授权页"引导**，而不是应用启动时批量申请。

模板（相机为例）：

```tsx
async function ensureCameraPermission(): Promise<boolean> {
  const { status, canAskAgain } = await ImagePicker.getCameraPermissionsAsync()
  if (status === 'granted') return true
  if (canAskAgain) {
    const req = await ImagePicker.requestCameraPermissionsAsync()
    return req.status === 'granted'
  }
  // 用户之前拒绝且勾选"不再询问"，只能引导去系统设置
  Alert.alert('相机权限', '请到系统设置开启相机权限', [
    { text: '取消', style: 'cancel' },
    { text: '去设置', onPress: () => Linking.openSettings() },
  ])
  return false
}
```

**通知权限特殊**：Android 13+ 需要 `POST_NOTIFICATIONS` 运行时权限；`expo-notifications` 的 `requestPermissionsAsync()` 会处理，直接调用即可。

### 3.7 网络状态 & SSE 重连

用 `@react-native-community/netinfo` 监听网络切换：

```tsx
NetInfo.addEventListener((state) => {
  if (!state.isConnected) {
    // 正在流式时提示 & 缓存"下次自动重发"标记
    useChatStore.getState().stopStreaming()
    toast.warning('网络断开，已停止接收')
  }
})
```

**后台切 SSE 处理**：

- `AppState.addEventListener('change', (state) => { if (state === 'background') stream.stop() })`
- 前台恢复时**不自动续传**（后端并没有实现 last-event-id 断点续传），提示用户手动重新生成

### 3.8 横竖屏

`app.json` `orientation: default` 允许全部方向；不锁定，靠 `useWindowDimensions()` 响应式布局。

**iPad**：iOS 强制要求支持所有方向，`supportsTablet: true` 已开启。

**Android 平板/折叠屏**：`configChanges` 声明写在 Expo prebuild 生成的 Manifest 里（Expo 已默认加了 `orientation | screenSize | keyboardHidden`），无需手改。

### 3.9 手机 / 平板断点

统一常量：

```ts
// packages/core/src/utils/breakpoints.ts (新增)
export const TABLET_MIN_WIDTH = 768 // 与 Web `md:` 一致
export const DESKTOP_MIN_WIDTH = 1024
```

在移动端组件里：

```tsx
const { width } = useWindowDimensions()
const isTablet = width >= TABLET_MIN_WIDTH
```

---

## Step 4：Expo Router 路由结构

```
apps/mobile/app/
├── _layout.tsx                       ← 根：Provider 树 + Splash + 平台适配器注入
├── index.tsx                         ← 未登录跳 (auth)/login；已登录跳 (main)
├── (auth)/
│   ├── _layout.tsx                   ← 认证栈（headerShown: false）
│   ├── login.tsx
│   ├── register.tsx
│   ├── forgot-password.tsx
│   └── oauth-callback.tsx            ← 处理 yuanai://oauth/callback
└── (main)/
    ├── _layout.tsx                   ← 平板双栏 / 手机 Drawer
    ├── chat/
    │   ├── index.tsx                 ← 空状态 / 新建会话引导
    │   └── [conversationId].tsx      ← 聊天页
    ├── settings/
    │   ├── index.tsx                 ← 设置根（个人资料）
    │   ├── security.tsx
    │   ├── appearance.tsx
    │   ├── notifications.tsx
    │   ├── language.tsx
    │   └── about.tsx
    ├── share/
    │   └── [token].tsx               ← 匿名/密码分享页
    └── outline.tsx                   ← 手机端消息大纲（模态展开）
```

### 4.1 `_layout.tsx` 顶层（示意）

```tsx
import 'react-native-gesture-handler'
import * as SplashScreen from 'expo-splash-screen'
import * as Sentry from '@sentry/react-native'
import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet'
import { setPlatformAdapter } from '@yuanai/core/api'
import { mobileAdapter } from '@/lib/mobileAdapter'
import { ThemeShell } from '@/components/ThemeShell'
import { I18nProvider } from '@/i18n/provider'
import { useHydrateAuth } from '@/hooks/useHydrateAuth'
import { useLinkingHandler } from '@/hooks/useLinkingHandler'

SplashScreen.preventAutoHideAsync()
setPlatformAdapter(mobileAdapter) // 必须在任何 packages/core 调用之前
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enableAutoSessionTracking: true,
  tracesSampleRate: 0.2,
})

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
})

function RootLayoutInner() {
  const authReady = useHydrateAuth()
  useLinkingHandler() // 深链接处理

  useEffect(() => {
    if (authReady) void SplashScreen.hideAsync()
  }, [authReady])

  if (!authReady) return null
  return <Stack screenOptions={{ headerShown: false }} />
}

export default Sentry.wrap(function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
          <QueryClientProvider client={queryClient}>
            <BottomSheetModalProvider>
              <I18nProvider>
                <ThemeShell>
                  <RootLayoutInner />
                </ThemeShell>
              </I18nProvider>
            </BottomSheetModalProvider>
          </QueryClientProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
})
```

---

## Step 5：认证 & OAuth

### 5.1 邮箱/密码 + 忘记密码

复用 `packages/core` 的 `useLogin`、`useRegister`、`useResetPassword`、`useSendVerifyCode`。UI 骨架参考 `apps/web/src/app/(auth)/login/page.tsx`，但用 RN 组件（`TextInput`、`Pressable`、`ActivityIndicator`）。

**表单验证**：`react-hook-form` + `zod`，与 Web 一致。

**Token 存储**：登录成功后写入 SecureStore：

```tsx
const onLoginSuccess = async ({ access_token, refresh_token, user }) => {
  await SecureStore.setItemAsync('access_token', access_token)
  await SecureStore.setItemAsync('refresh_token', refresh_token)
  setAuth(user, access_token, refresh_token, true)
  router.replace('/(main)/chat')
}
```

### 5.2 Google Sign-In（原生 SDK）

**前置配置**：

1. Google Cloud Console 创建 iOS OAuth Client（Bundle ID: `com.yuanai.app`）→ 得到 `iosClientId`
2. 创建 Web OAuth Client → 得到 `webClientId`（Android 也用这个作 serverClientId）
3. `iosClientId` 反向的 URL Scheme 加进 `app.json` 的 `iosUrlScheme`
4. 下载 `GoogleService-Info.plist` / `google-services.json` 放到 `apps/mobile/` 根目录

**代码**：

```tsx
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin'

GoogleSignin.configure({
  webClientId: Constants.expoConfig.extra.googleWebClientId,
  offlineAccess: true, // 拿 serverAuthCode 送后端换 access_token
})

async function loginWithGoogle() {
  try {
    await GoogleSignin.hasPlayServices()
    const { idToken, serverAuthCode } = await GoogleSignin.signIn()
    // 送后端换我们自己的 JWT
    const res = await apiClient.post('/auth/google/native', { idToken, serverAuthCode })
    await onLoginSuccess(res.data)
  } catch (e) {
    if (e.code === statusCodes.SIGN_IN_CANCELLED) return
    toast.error('Google 登录失败')
  }
}
```

**后端需要新增契约**：`POST /api/v1/auth/google/native`，接收 `idToken`，验证 Google JWT，找到/创建用户，返回 `{ access_token, refresh_token, user }`。这是**后端 Phase 3 的关联任务**，需在 `docs/api-design.md` 上补。

### 5.3 GitHub（系统浏览器 + Deep Link）

GitHub 无移动端 SDK，走系统浏览器：

```tsx
import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'

async function loginWithGithub() {
  const authUrl = `${API_BASE}/auth/github/authorize?redirect_uri=${encodeURIComponent(
    'yuanai://oauth/callback'
  )}`
  const result = await WebBrowser.openAuthSessionAsync(authUrl, 'yuanai://oauth/callback')
  // result.type === 'success' 时 result.url 已含 tokens；也可由 (auth)/oauth-callback 屏统一处理
}
```

**后端契约调整**：`GET /api/v1/auth/github/authorize` 需支持 `redirect_uri` 白名单，允许 `yuanai://oauth/callback`；`GET /api/v1/auth/github/callback` 完成后 302 到该 URI，token 拼在 query（与 Web 现有回调等价）。

### 5.4 `(auth)/oauth-callback.tsx`

复用 Web 版逻辑（`getMeWithToken` → `setAuth` → replace），把 `useSearchParams` 换成 `useLocalSearchParams`。

---

## Step 6：主布局（平板双栏 / 手机 Drawer）

`app/(main)/_layout.tsx`：

```tsx
import { Drawer } from 'expo-router/drawer'
import { useWindowDimensions, View } from 'react-native'
import { Slot } from 'expo-router'
import { ConversationList } from '@/components/ConversationList'
import { TABLET_MIN_WIDTH } from '@yuanai/core/utils'

export default function MainLayout() {
  const { width } = useWindowDimensions()
  const isTablet = width >= TABLET_MIN_WIDTH
  if (isTablet) {
    return (
      <View className="bg-bg-base dark:bg-bg-dark-base flex-1 flex-row">
        <View className="border-border-default w-[280px] border-r">
          <ConversationList />
        </View>
        <View className="flex-1">
          <Slot />
        </View>
      </View>
    )
  }
  return (
    <Drawer
      drawerContent={() => <ConversationList />}
      screenOptions={{
        drawerType: 'slide',
        headerShown: false,
        drawerStyle: { width: '82%' },
        swipeEnabled: true,
      }}
    />
  )
}
```

**ConversationList 组件要点**（对齐 Web `ChatInterface` 侧边栏功能）：

- 顶部：Logo、新建对话、临时对话切换（`Ghost` 图标）
- 搜索：`TextInput` + 清除按钮
- 分组列表：置顶 / 今日 / 昨日 / 本周（`SectionList` 或 FlashList section header）
- 会话项：头像、标题、右滑操作（`Swipeable`）、长按弹菜单
- 底部：用户信息 + 头像 + 设置入口

---

## Step 7：聊天页

### 7.1 结构

```tsx
// app/(main)/chat/[conversationId].tsx
export default function ChatScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>()
  const insets = useSafeAreaInsets()
  const listRef = useRef<FlashList<MsgPair>>(null)
  const { data: apiMessages } = useMessages(conversationId)
  const pairs = useMemo(() => buildPairs(apiMessages.map(apiMsgToMock)), [apiMessages])
  return (
    <View className="bg-bg-base dark:bg-bg-dark-base flex-1" style={{ paddingTop: insets.top }}>
      <ChatHeader onOpenDrawer={openDrawer} onOpenShare={openShare} title={title} />
      <ModelSelectorSheet />
      <MessageList ref={listRef} pairs={pairs} />
      <ChatInput onSend={handleSend} bottomInset={insets.bottom} />
      <ArtifactSurface /> {/* 全屏 pageSheet：代码高亮 + WebView 预览 */}
    </View>
  )
}
```

### 7.2 MessageList（`FlashList`）

- `estimatedItemSize={80}`
- `onScroll` → 计算是否显示"回到底部"FAB
- `viewabilityConfig` → 上报 `outlineActiveIdx`（等价 Web `rangeChanged`）
- 长按 → 展示 `ActionSheet`（复制 / 重新生成 / 编辑）
- 用户消息编辑走 Modal（原生 TextInput）
- 版本切换：`PagerView` 或者左右滑手势（`react-native-gesture-handler`）

### 7.3 MessageItem 组成

- **UserMessage**：右对齐渐变气泡（`LinearGradient`）
- **AIMessage**：左对齐 + AI 头像 + Markdown 渲染
  - `react-native-markdown-display` 的 `rules` 覆盖代码块为自定义 `CodeBlock`
  - 表格使用 `ScrollView horizontal` 承载
- **ThinkBlock**：折叠 → 展开显示 reasoning 文字
- **ToolCallRow**：显示 tool name + args JSON（可长按查看完整 JSON）
- **流式光标**：`Animated.View` 闪烁动画

### 7.4 CodeBlock

```tsx
<View>
  <View className="flex-row items-center justify-between px-3 py-2">
    <Text>{language}</Text>
    <Pressable onPress={onCopy}>
      <Text>复制</Text>
    </Pressable>
    {isRunnable(language) && (
      <Pressable onPress={() => openArtifactRun({ lang: language, code })}>
        <Text>运行</Text>
      </Pressable>
    )}
  </View>
  <SyntaxHighlighter language={language} style={dark ? atomOneDark : atomOneLight}>
    {code}
  </SyntaxHighlighter>
</View>
```

### 7.5 ChatInput

- 附件按钮 → `BottomSheet` 弹出「上传文件 / 拍照 / 从相册」
- 语音按钮 → 按住说话，`Voice.start('zh-CN')`，onSpeechResults 追加 text
- 联网 / 思考 / 模型切换：同 Web 逻辑
- 发送/停止按钮
- **键盘策略**：`<KeyboardStickyView>` 包裹输入区
- **底部 insets**：`paddingBottom = keyboardVisible ? 0 : insets.bottom`

### 7.6 Artifact 面板

**手机 / 平板统一实现**（`ArtifactSurface`）：

```tsx
// 代码 tab：HighlightedCode（hljs atom-one，随主题）
// 预览 tab：可运行语言用 WebView 加载 core buildRunSrcDoc 产物
<Modal presentationStyle="pageSheet">
  <WebView
    originWhitelist={['*']}
    javaScriptEnabled
    domStorageEnabled={false}
    source={{ html: buildRunSrcDoc(lang, code, { dark }) }}
    onMessage={(e) => appendConsoleLine(JSON.parse(e.nativeEvent.data))}
  />
</Modal>
```

沙箱模板与控制台桥来自 `@yuanai/core`（`packages/core/src/utils/artifactRuntimes.ts`），
Web iframe 与 RN WebView 共用一份；桥在 RN 环境走
`window.ReactNativeWebView.postMessage`，日志渲染在面板底部。
不做：CodeMirror 编辑、JSON/CSV 数据预览（后续增量）。

**安全**：WebView 加载的 `srcDoc` 完全内嵌，不允许跨域；`onShouldStartLoadWithRequest` 拦截所有导航（除 `about:blank`）。

---

## Step 8：设置面板

采用 Expo Router 的**独立 Screen** 而非 Modal（复用 Web `SettingsModal` 的功能划分为 6 个子屏）：

| 屏                               | 复用的 Hook                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings/index.tsx`（个人资料） | `useCurrentUser`, `useUpdateMe`, `useUploadAvatar`                                                                                          |
| `settings/security.tsx`          | `useChangePassword`, `useChangeEmail`, `useSendVerifyCode`, `useDeleteMe`, `useClearAllConversations`, `useUnlinkGoogle`, `useUnlinkGithub` |
| `settings/appearance.tsx`        | `usePrefsStore`（theme / fontSize / density）                                                                                               |
| `settings/notifications.tsx`     | 本地开关 + Expo Notifications 权限申请 + 后端 token 上报                                                                                    |
| `settings/language.tsx`          | `i18next.changeLanguage`                                                                                                                    |
| `settings/about.tsx`             | `expo-application` 版本号 / 用户协议 / 隐私政策                                                                                             |

**危险操作二次确认**：删除账号 / 清空对话使用系统 `Alert.alert`（原生弹窗），不要用自定义 Modal（更权威）。

---

## Step 9：推送通知（Expo Push）

### 9.1 前端

```tsx
// app/(main)/_layout.tsx 或 useHydrateAuth 内
import * as Notifications from 'expo-notifications'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false, // 由用户偏好控制
    shouldSetBadge: false,
  }),
})

async function registerForPushNotifications() {
  const { status: existing } = await Notifications.getPermissionsAsync()
  let status = existing
  if (existing !== 'granted') {
    const req = await Notifications.requestPermissionsAsync()
    status = req.status
  }
  if (status !== 'granted') return
  const projectId = Constants.expoConfig?.extra?.eas?.projectId
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data
  // 上报后端
  await apiClient.post('/notifications/expo', { token, platform: Platform.OS })
}
```

### 9.2 处理通知点击

```tsx
Notifications.addNotificationResponseReceivedListener((response) => {
  const convId = response.notification.request.content.data?.convId
  if (convId) router.push(`/(main)/chat/${convId}`)
})
```

### 9.3 后端契约（新增）

| 端点                                                                                                               | 说明                                                                 |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `POST /api/v1/notifications/expo` body `{ token, platform }`                                                       | 保存 Expo Push token 到 users 的 push_tokens 表（与 Web VAPID 并列） |
| `DELETE /api/v1/notifications/expo/{token}`                                                                        | 移除设备 token                                                       |
| 后端：AI 回复完成 → 若有 Expo token → POST `https://exp.host/--/api/v2/push/send` body `{ to, title, body, data }` | 由 `stream_service` 结束回调触发                                     |

### 9.4 前台屏蔽（避免打扰）

前台收到通知直接在应用内 Toast 显示，不弹系统横幅：

```tsx
Notifications.addNotificationReceivedListener((n) => {
  if (AppState.currentState === 'active') {
    Notifications.dismissNotificationAsync(n.request.identifier)
    toast.info(n.request.content.body)
  }
})
```

---

## Step 10：分享（系统分享面板）

```tsx
import { Share } from 'react-native'
import { useCreateShareLink } from '@yuanai/core/hooks'

async function onShare(convId: string) {
  const { mutateAsync: createShare } = useCreateShareLink()
  const { token, expiresAt } = await createShare({ convId, needPassword: false, expiresIn: 604800 })
  const url = `https://yuanai.example.com/share/${token}`
  await Share.share({ message: `快看看我和元AI的对话：${url}`, url }, { dialogTitle: '分享对话' })
}
```

**密码保护**用一次分享前的 BottomSheet 让用户选择"是否加密码 / 过期时间"，然后再调 `createShare`。

---

## Step 11：Sentry 崩溃监控

`app/_layout.tsx` 顶层已初始化。补充：

- **Release 标签**：EAS Build 自动注入 `EXPO_UPDATES_MANIFEST_JSON` → 用 `runtimeVersion + updateId` 组合当 release
- **User scope**：登录后 `Sentry.setUser({ id: user.id, email: user.email })`，退出后 `Sentry.setUser(null)`
- **面包屑**：API client 拦截器上报请求 / SSE 事件类型
- **Source map**：EAS Build 会自动上传，无需手动（前提 `app.json` 里已配 `@sentry/react-native/expo` plugin）

---

## Step 12：i18n

### 12.1 目录结构

```
apps/mobile/i18n/
├── index.ts                ← i18next init
├── provider.tsx            ← <I18nProvider>
└── locales/
    ├── zh-CN.json          ← 复用 apps/web 现有 messages（软链或拷贝）
    └── en-US.json
```

### 12.2 骨架

```ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import * as Localization from 'expo-localization'
import zhCN from './locales/zh-CN.json'
import enUS from './locales/en-US.json'

void i18n.use(initReactI18next).init({
  resources: { 'zh-CN': { translation: zhCN }, 'en-US': { translation: enUS } },
  lng: Localization.getLocales()[0]?.languageTag ?? 'zh-CN',
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
})
```

用户手动切换语言写入 AsyncStorage 优先于系统 locale。

### 12.3 与 Web 共享 messages（可选优化）

如未来做 `packages/i18n`：把 `apps/web/messages/*.json` 挪进去，两端 import 同一份。v1 可先拷贝，v2 抽包。

---

## Step 13：构建 / 分发 / OTA

### 13.1 开发

```bash
# 本地 dev（首次需要 prebuild + 原生模块编译）
cd apps/mobile
npx expo prebuild --clean
npx expo run:ios       # macOS + Xcode
npx expo run:android   # Android SDK + 模拟器 or 真机
```

**推荐 workflow**：`eas build --profile development` 造一个 Development Build，之后本地跑 `npx expo start --dev-client` 即可（不需要每次改 native 都重编）。

### 13.2 EAS Build（云）

```bash
# 首次登录 & 关联
npx eas login
npx eas build:configure

# 云构建
npx eas build -p android --profile preview     # 出 APK 内测
npx eas build -p ios --profile preview          # TestFlight
npx eas build -p all --profile production       # 上架版本
```

### 13.3 EAS Update（OTA）

```bash
# 发布一次 OTA 到 preview channel
npx eas update --branch preview --message "fix: 键盘遮挡"
```

- **仅能推送 JS/assets 变更**；原生依赖（新增/升级模块、修改 `app.json plugins`）改动必须重新打包
- OTA 生效时机：`checkAutomatically: ON_LOAD`（下次冷启动生效）
- 回滚：`eas update:rollback --branch preview`

### 13.4 分发

- **Android**：`.apk` 拖到设备 / Play Store 内测轨道
- **iOS**：TestFlight → 用户收到邀请后从 TestFlight app 安装

---

## 14. 常见适配问题速查表

| 问题                             | 症状                        | 解法                                                                     |
| -------------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| iOS 刘海遮挡状态栏               | 顶部内容被切                | `<SafeAreaView edges={['top']}>`                                         |
| Android 手势条与内容重叠         | 底部 Home 手势条覆盖按钮    | `insets.bottom` + `KeyboardStickyView`                                   |
| iOS 键盘弹起遮挡输入框           | 输入框看不到                | `react-native-keyboard-controller` `<KeyboardAvoidingView>`              |
| Android 键盘 layout 抖动         | 键盘弹起时视图闪跳          | 不改 `windowSoftInputMode`，让 controller 接管                           |
| FlashList 流式打字滚动跳变       | 底部反复自动滚              | onEndReached 期间 `disableAutoScroll`                                    |
| Splash 白闪                      | 从 splash 到首屏之间白屏    | `preventAutoHideAsync` + 首屏就绪后手动 `hideAsync`                      |
| iOS Dark Mode 未跟随             | 系统切黑 UI 未变            | `userInterfaceStyle: automatic` + `<StatusBar style="auto">`             |
| Deep Link 首次冷启动丢失         | 点分享链接 App 打开后没跳转 | 用 `Linking.getInitialURL()` 在 `useLinkingHandler` 里补捕               |
| SSE 后台自动断开                 | App 切后台 30s SSE 死掉     | 监听 `AppState`，主动 `stream.stop()`；前台恢复不自动续                  |
| WebView 内嵌 `srcDoc` 空白       | Android 白屏                | 用 `source={{ html }}` 而不是 `source={{ uri: 'data:...' }}`             |
| iOS 上传超大图片崩溃             | 内存 OOM                    | `expo-image-picker` `quality: 0.7` + `resize` 到 2048                    |
| Google Sign-In `DEVELOPER_ERROR` | Android 登录报错            | SHA-1 未加进 Firebase 项目；`webClientId` 与 Google Cloud 不匹配         |
| Android 13 通知无弹窗            | 权限已给但通知不弹          | `POST_NOTIFICATIONS` 运行时权限 + 通道创建 `setNotificationChannelAsync` |
| iOS 分享面板缺项                 | 没有微信 / Slack            | 需在 `Info.plist` 加 `LSApplicationQueriesSchemes`                       |
| Zustand persist SSR mismatch     | 无 —— RN 无 SSR             | ✅ 不适用                                                                |
| TanStack Query 后台变旧          | 前台恢复列表旧              | `focusManager` + `AppState` 触发 refetch                                 |
| Fastlane / Xcode 15 iOS 17 兼容  | 编译报错                    | 用 Expo SDK 52+，自动匹配最新 pods                                       |
| `react-native-reanimated` 未生效 | 动画不跑                    | `babel.config.js` `plugins` 数组**最后**放 `reanimated/plugin`           |
| Metro 找不到 `@yuanai/core`      | `Unable to resolve module`  | `metro.config.js` `watchFolders` + `nodeModulesPaths` 已配               |

---

## 15. 测试清单

### 15.1 环境矩阵

| 平台           | 设备                               | 必测                            |
| -------------- | ---------------------------------- | ------------------------------- |
| iOS            | iPhone 15 Pro（灵动岛）            | 顶部安全区、Face ID 不冲突      |
| iOS            | iPhone SE（无刘海小屏）            | 输入区不遮挡键盘                |
| iOS            | iPad Air（10.9"）                  | 平板双栏、Artifact WebView 运行 |
| Android        | Pixel 6（手势导航）                | 底部手势条避让                  |
| Android        | Android 8.1 老机 / Android 14 新机 | 权限 flow、通知权限             |
| Android 模拟器 | Android 13 / 14                    | Deep Link、通知点击             |

### 15.2 手动测试用例（覆盖 Web 端所有能力对应场景）

- [ ] 首次冷启动 Splash 无白闪；已登录直接进 `/chat`
- [ ] 邮箱登录 / 注册 / 忘记密码全流程
- [ ] Google 登录：安装、卸载、切账号、失败重试
- [ ] GitHub 登录：网页跳回 App，token 正确落到 SecureStore
- [ ] Deep Link 冷启动：杀死 App 后点分享链接能正确落到 share 页
- [ ] 深色模式：系统黑 / 白 / 手动锁定各 1 次
- [ ] 键盘：输入区始终可见；发送后光标停留正确
- [ ] 流式对话：token 逐字出现；中途点停止；断网切网络
- [ ] 后台切回：SSE 断开有提示；不自动续
- [ ] 附件：相册选图（多选）、拍照、文档，超 10MB 分片，网络中断秒传恢复
- [ ] 语音输入：连续说话文字追加；权限拒绝有引导
- [ ] Artifact：手机/平板 WebView 运行 HTML/CSS/JS，面板底部控制台条有输出；代码 tab 高亮
- [ ] Markdown / 代码块 / 表格 / 复制
- [ ] 消息编辑 / 重新生成 / 版本切换 / 点赞踩
- [ ] 会话列表：搜索、分组、置顶、重命名、删除、多选批量删
- [ ] 临时对话：切换后消息不落库；退出后消息丢失
- [ ] 分享：生成链接 → 系统分享面板 → 收到方点击回 App 或用浏览器打开
- [ ] 设置：改密、改邮箱（含验证码）、解绑三方、清空对话、删除账号
- [ ] 主题 / 字号 / 密度切换全局生效
- [ ] 语言切换（zh / en）刷新所有文案
- [ ] 通知：AI 回复完成后台弹通知；点击通知回到会话；前台不弹
- [ ] 权限被拒后引导系统设置
- [ ] 崩溃：手动 `throw new Error()` 上报 Sentry 有数据
- [ ] OTA：`eas update` 后重新冷启动能生效

### 15.3 单元 / 集成测试

- `packages/core` 的 `mobileAdapter.stream` 单测（模拟 EventSource）
- `apps/mobile/hooks/useHydrateAuth` 单测（SecureStore mock）
- `apps/mobile/components/ChatInput` 单测（发送/停止/上传状态）
- Detox（可选，v1 不强求）：端到端 Login → 发消息 → 收到 → 断言 UI

---

## 16. 验收标准

1. `npx expo start --dev-client` 无报错，iOS Simulator / Android 模拟器均能启动
2. 登录 / 注册 / OAuth（Google 原生 + GitHub 浏览器） 全部可用；token 落 SecureStore
3. 深链接 `yuanai://share/*` 冷启动 + 热启动都能正确路由
4. 会话列表、临时对话、搜索、分组、多选批量删、置顶、重命名、删除 全部正常
5. 新建对话 → 发送 → 流式 token 逐字出现 → 可中断 → Markdown/代码块正确渲染 → 复制可用
6. 思考过程、工具调用可折叠展示
7. 附件：图片（相机/相册）、文档、秒传、分片 全部正常，附带上传进度
8. 语音输入：按下说话文字自动追加，权限拒绝有引导
9. Artifact：手机/平板均可 WebView 运行 HTML/CSS/JS + 代码高亮，暗色主题适配
10. 分享：`Share.share` 弹出系统分享面板；分享链接可回落到 App
11. 设置：6 个子屏功能完整；改密 / 改邮箱 / 删除账号 / 解绑三方 全部对齐 Web
12. 通知：Expo Push token 上报后端；后台 AI 回复完成可收到并点击返回会话
13. 主题（明/暗/跟随系统）+ 字号 + 密度实时生效
14. i18n（zh-CN / en-US）切换即时生效
15. Sentry 能捕获手动 throw 的错误
16. iPad 显示双栏；iPhone SE 至 15 Pro Max 全尺寸键盘不遮挡输入
17. Android 8-14 权限流全部走通
18. `pnpm typecheck` `pnpm lint` 在 `apps/mobile` 和 `packages/core` 无报错
19. EAS Build preview channel 出内测包（APK + TestFlight）能安装运行
20. 上述所有"常见适配问题速查表"逐条覆盖

---

## 17. 后端联动改动清单（Phase 1 或 Phase 3 后端补丁）

以下端点是移动端**新增依赖**的后端能力，需要在 Phase 1 已完成后端上做增量：

| 端点                                                          | 说明                       | 移动端用途 |
| ------------------------------------------------------------- | -------------------------- | ---------- |
| `POST /auth/google/native` body `{ idToken, serverAuthCode }` | 原生 Google Sign-In 换 JWT | Step 5.2   |
| `GET /auth/github/authorize?redirect_uri=...`                 | 支持 `yuanai://` 白名单    | Step 5.3   |
| `POST /notifications/expo` body `{ token, platform }`         | 保存 Expo push token       | Step 9.3   |
| `DELETE /notifications/expo/{token}`                          | 退订                       | Step 9.3   |
| `stream_service` 结束回调 → 推送 Expo push                    | AI 完成后台通知            | Step 9.3   |

这些在 `docs/api-design.md` 里需补齐 schema（本 Phase 不改文档，落地时由 Phase 1 补丁承接）。

---

## 附录：与 Web 端功能对齐一览

若需快速核对是否所有 Web 端能力已在 Phase 3 覆盖，见 §0.1 "完整能力清单"表格。表格中每一行都有对应的 Step 编号或组件位置。
