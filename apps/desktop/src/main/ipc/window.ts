import type { BrowserWindow, IpcMainInvokeEvent, WebContents } from 'electron'

import { IPC } from '../../shared/ipc-contract'
import type { DesktopArtifactPayload } from '../../shared/ipc-contract'
import { assertNoIpcPayload } from '../../shared/guards'
import type { IpcMainRegistrar } from './auth'
import type { IpcInvocationGuard } from './guards'

/** 可由受信任 renderer 请求打开的命名桌面窗口。 */
export interface NamedWindowController {
  /** 打开并聚焦登录窗口。 */
  openLogin(): void
  /** 打开并聚焦注册窗口。 */
  openRegister(): void
  /** 打开并聚焦找回密码窗口。 */
  openForgot(): void
  /** 打开并聚焦设置窗口。 */
  openSettings(): void
  /** 打开并聚焦关于窗口。 */
  openAbout(): void
  /** 打开并聚焦 OAuth 加载窗口。 */
  openOAuth(): void
  /** 关闭 OAuth 加载窗口。 */
  closeOAuth(): void
  /** 在独立窗口中展示消息内的代码 Artifact。 */
  openArtifact(payload: DesktopArtifactPayload): void
}

/** 可信 renderer 当前所属原生窗口的有限控制能力。 */
export interface RendererWindowControls {
  /** 最小化当前窗口。 */
  minimize(): void
  /** 判断当前窗口是否已最大化。 */
  isMaximized(): boolean
  /** 最大化当前窗口。 */
  maximize(): void
  /** 退出最大化状态。 */
  unmaximize(): void
  /** 关闭当前窗口。 */
  close(): void
}

function isDesktopArtifactPayload(value: unknown): value is DesktopArtifactPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>
  const theme = payload.theme
  return (
    typeof payload.title === 'string' &&
    payload.title.length > 0 &&
    payload.title.length <= 200 &&
    typeof payload.lang === 'string' &&
    payload.lang.length <= 80 &&
    typeof payload.code === 'string' &&
    payload.code.length <= 2 * 1024 * 1024 &&
    (payload.mode === 'view' || payload.mode === 'run') &&
    (theme === undefined || theme === 'light' || theme === 'dark')
  )
}

/** 注册用于打开命名窗口的最小 IPC 能力。 */
export function registerWindowIpcHandlers(
  ipcMain: IpcMainRegistrar,
  guard: IpcInvocationGuard,
  windows: NamedWindowController,
  getWindow: (webContents: WebContents) => BrowserWindow | null
): void {
  function getCurrentWindow(event: IpcMainInvokeEvent): RendererWindowControls {
    const window = getWindow(event.sender)
    if (!window || window.isDestroyed()) throw new Error('IPC_WINDOW_UNAVAILABLE')
    return window
  }

  ipcMain.handle(
    IPC.window.openLogin,
    async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<void> => {
      guard.assertTrusted(event)
      assertNoIpcPayload(args)
      windows.openLogin()
    }
  )
  ipcMain.handle(
    IPC.window.openRegister,
    async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<void> => {
      guard.assertTrusted(event)
      assertNoIpcPayload(args)
      windows.openRegister()
    }
  )
  ipcMain.handle(
    IPC.window.openForgot,
    async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<void> => {
      guard.assertTrusted(event)
      assertNoIpcPayload(args)
      windows.openForgot()
    }
  )
  ipcMain.handle(
    IPC.window.openSettings,
    async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<void> => {
      guard.assertTrusted(event)
      assertNoIpcPayload(args)
      windows.openSettings()
    }
  )
  ipcMain.handle(
    IPC.window.openAbout,
    async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<void> => {
      guard.assertTrusted(event)
      assertNoIpcPayload(args)
      windows.openAbout()
    }
  )
  ipcMain.handle(
    IPC.window.openArtifact,
    async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<void> => {
      guard.assertTrusted(event)
      const [payload] = args
      if (args.length !== 1 || !isDesktopArtifactPayload(payload)) {
        throw new Error('IPC_PAYLOAD_INVALID')
      }
      windows.openArtifact(payload)
    }
  )
  ipcMain.handle(
    IPC.window.minimize,
    async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<void> => {
      guard.assertTrusted(event)
      assertNoIpcPayload(args)
      getCurrentWindow(event).minimize()
    }
  )
  ipcMain.handle(
    IPC.window.toggleMaximize,
    async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<boolean> => {
      guard.assertTrusted(event)
      assertNoIpcPayload(args)
      const window = getCurrentWindow(event)
      if (window.isMaximized()) {
        window.unmaximize()
        return false
      }
      window.maximize()
      return true
    }
  )
  ipcMain.handle(
    IPC.window.close,
    async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<void> => {
      guard.assertTrusted(event)
      assertNoIpcPayload(args)
      getCurrentWindow(event).close()
    }
  )
}
