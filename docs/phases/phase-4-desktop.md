# Phase 4 — 桌面端开发（Electron）

**前置条件**: Phase 0 完成，Phase 1 完成（后端），Phase 2 完成（packages/core，packages/ui）  
**分支**: `feat/phase-4-desktop`  
**执行范围**: `apps/desktop/`，最大化复用 packages/core 和 packages/ui

---

## 目标

1. 基于 Electron + Vite + React 实现桌面端
2. 渲染层最大化复用 Web 端组件
3. 实现桌面端特有功能：系统托盘、原生对话框、本地文件拖拽、自动更新
4. 打包为 Windows (.exe)、macOS (.dmg)、Linux (.AppImage/.deb) 安装包

---

## 架构说明

```
Electron 进程模型:

主进程 (main/index.ts)
  ├── 创建 BrowserWindow（渲染层）
  ├── 系统托盘 (Tray)
  ├── 自动更新 (electron-updater)
  ├── 原生文件对话框 (dialog)
  └── IPC 处理器（响应渲染层请求）

预加载脚本 (preload/index.ts)
  └── 暴露安全的 contextBridge API 给渲染层

渲染层 (renderer/ → React + Vite)
  ├── 复用 packages/ui 组件
  ├── 复用 packages/core stores/hooks
  └── 桌面端专用功能通过 window.electronAPI 调用
```

---

## Step 1：项目结构

```
apps/desktop/
├── src/
│   ├── main/
│   │   ├── index.ts             ← Electron 主进程入口
│   │   ├── tray.ts              ← 系统托盘
│   │   └── updater.ts           ← 自动更新
│   ├── preload/
│   │   └── index.ts             ← Context Bridge
│   └── renderer/
│       ├── index.html
│       ├── src/
│       │   ├── main.tsx         ← React 入口
│       │   ├── App.tsx          ← 路由根组件
│       │   ├── pages/           ← 页面（复用 Web 端逻辑）
│       │   └── components/      ← 桌面端特有组件
├── electron.vite.config.ts
├── electron-builder.yml
└── package.json
```

---

## Step 2：Vite 配置

### `apps/desktop/electron.vite.config.ts`

```typescript
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
      },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
})
```

---

## Step 3：主进程

### `apps/desktop/src/main/index.ts`

```typescript
import { join } from 'path'
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { setupTray } from './tray'
import { setupUpdater } from './updater'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#FAFAF8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // 外部链接在系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// IPC: 原生文件选择对话框
ipcMain.handle('dialog:openFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
      { name: '文档', extensions: ['pdf', 'txt', 'md', 'docx'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  return result.canceled ? [] : result.filePaths
})

// IPC: 获取系统信息
ipcMain.handle('app:getVersion', () => app.getVersion())

app.whenReady().then(() => {
  createWindow()
  setupTray(mainWindow)
  setupUpdater()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

### `apps/desktop/src/main/tray.ts`

```typescript
import { join } from 'path'
import { Tray, Menu, BrowserWindow, nativeImage } from 'electron'

let tray: Tray | null = null

export function setupTray(window: BrowserWindow | null): void {
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/tray-icon.png'))

  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('元AI')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        window?.show()
        window?.focus()
      },
    },
    { type: 'separator' },
    { label: '退出元AI', role: 'quit' },
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    window?.show()
    window?.focus()
  })
}
```

### `apps/desktop/src/main/updater.ts`

```typescript
import { autoUpdater } from 'electron-updater'

export function setupUpdater(): void {
  autoUpdater.autoDownload = false

  autoUpdater.on('update-available', () => {
    // 通知渲染层有更新可用
    // TODO: 通过 IPC 通知前端显示更新提示
  })

  // 生产环境才检查更新
  if (process.env['NODE_ENV'] === 'production') {
    void autoUpdater.checkForUpdates()
  }
}
```

---

## Step 4：预加载脚本（Context Bridge）

### `apps/desktop/src/preload/index.ts`

```typescript
import { contextBridge, ipcRenderer } from 'electron'

// 暴露给渲染层的安全 API
const electronAPI = {
  // 打开文件选择对话框
  openFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:openFiles'),

  // 获取应用版本
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),

  // 平台信息
  platform: process.platform,
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// TypeScript 类型声明（在 renderer/src/types/electron.d.ts 中）
```

### `apps/desktop/src/renderer/src/types/electron.d.ts`

```typescript
interface ElectronAPI {
  openFiles: () => Promise<string[]>
  getVersion: () => Promise<string>
  platform: 'darwin' | 'win32' | 'linux'
}

declare interface Window {
  electronAPI: ElectronAPI
}
```

---

## Step 5：渲染层实现

### `apps/desktop/src/renderer/src/main.tsx`

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import '@yuanai/ui/styles'
import './styles/desktop.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
})

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('#root element not found')

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
)
```

### `apps/desktop/src/renderer/src/App.tsx`

```tsx
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@yuanai/core/stores'
import { setTokenGetter } from '@yuanai/core/api'
import { LoginPage } from './pages/LoginPage'
import { MainLayout } from './layouts/MainLayout'
import { ChatPage } from './pages/ChatPage'
import { EmptyPage } from './pages/EmptyPage'
import { useEffect } from 'react'

export function App() {
  const { accessToken } = useAuthStore()

  useEffect(() => {
    setTokenGetter(() => accessToken)
  }, [accessToken])

  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={!accessToken ? <LoginPage /> : <Navigate to="/" />} />
        <Route path="/" element={accessToken ? <MainLayout /> : <Navigate to="/login" />}>
          <Route index element={<EmptyPage />} />
          <Route path="chat/:conversationId" element={<ChatPage />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
```

### 桌面端特有样式 `apps/desktop/src/renderer/src/styles/desktop.css`

```css
/* macOS 标题栏拖拽区域 */
.titlebar-drag {
  -webkit-app-region: drag;
}
.titlebar-no-drag {
  -webkit-app-region: no-drag;
}

/* macOS traffic light 按钮留空 */
body[data-platform='darwin'] .sidebar-header {
  padding-top: 28px;
}

/* 隐藏系统默认滚动条（Electron 使用自定义滚动条）*/
* {
  scrollbar-width: thin;
  scrollbar-color: var(--border-default) transparent;
}

/* 禁用文字选中（非输入区域）*/
.no-select {
  user-select: none;
  -webkit-user-select: none;
}
```

### 侧边栏 `apps/desktop/src/renderer/src/components/DesktopSidebar.tsx`

在 Web 端侧边栏基础上，添加：

- macOS 风格标题栏区域（`-webkit-app-region: drag`）
- traffic light 按钮留空
- 底部版本号显示（`window.electronAPI.getVersion()`）

### 文件上传（使用原生对话框）

```tsx
// 替换 Web 端的 input[type=file]
const handleAttach = async () => {
  const filePaths = await window.electronAPI.openFiles()
  if (filePaths.length === 0) return

  // 读取文件并上传到后端
  for (const filePath of filePaths) {
    const formData = new FormData()
    // Electron 渲染层可以使用 fetch API 读取 file:// 路径
    const response = await fetch(filePath)
    const blob = await response.blob()
    formData.append('file', blob, filePath.split('/').pop() ?? 'file')
    formData.append('purpose', 'chat')

    const uploadRes = await apiClient.post('/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    // 获取 file_id 用于发送消息
  }
}
```

---

## Step 6：打包配置

### `apps/desktop/electron-builder.yml`

```yaml
appId: com.yuanai.app
productName: 元AI
directories:
  output: release/${version}
  buildResources: resources

files:
  - out/**/*
  - '!out/main/chunks/*.map'

win:
  target:
    - target: nsis
      arch: [x64, arm64]
  icon: resources/icon.ico

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  installerIcon: resources/installer-icon.ico
  uninstallerIcon: resources/uninstaller-icon.ico
  installerHeaderIcon: resources/installer-icon.ico
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: 元AI

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

dmg:
  contents:
    - x: 130
      y: 220
    - x: 410
      y: 220
      type: link
      path: /Applications

linux:
  target:
    - target: AppImage
      arch: [x64]
    - target: deb
      arch: [x64]
  icon: resources/icon.png
  category: Network
  synopsis: 智能 AI 聊天助手
  description: yuanai — 多端 AI 聊天应用，支持多模型切换

publish:
  provider: github
  owner: your-github-org
  repo: yuanai
```

### `apps/desktop/package.json` scripts 更新

```json
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "package:win": "pnpm build && electron-builder --win",
    "package:mac": "pnpm build && electron-builder --mac",
    "package:linux": "pnpm build && electron-builder --linux",
    "package:all": "pnpm build && electron-builder --win --mac --linux"
  }
}
```

---

## Step 7：资源文件

在 `apps/desktop/resources/` 下准备：

| 文件                 | 规格         | 用途             |
| -------------------- | ------------ | ---------------- |
| `icon.icns`          | macOS 图标   | macOS 应用图标   |
| `icon.ico`           | Windows 图标 | Windows 应用图标 |
| `icon.png`           | 512x512 PNG  | Linux 应用图标   |
| `tray-icon.png`      | 16x16 PNG    | 系统托盘图标     |
| `installer-icon.ico` | Windows 图标 | NSIS 安装器图标  |

---

## 验收标准

1. `pnpm dev` 启动 Electron，窗口正常显示
2. 登录后进入主界面，侧边栏/聊天区布局正确
3. macOS：标题栏可拖动，traffic light 按钮可用
4. Windows：窗口缩放/最大化/最小化正常
5. 点击附件图标弹出原生文件选择对话框
6. 文件选择后正常上传并在输入框显示预览
7. 发送消息，流式 AI 回复正常显示
8. 系统托盘图标可见，右键菜单可用，点击唤起窗口
9. `pnpm package:win`（或对应平台）打包无报错，安装包可安装运行
10. `pnpm typecheck` 无报错
