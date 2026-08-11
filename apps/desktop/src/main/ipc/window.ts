import type { IpcMainInvokeEvent } from 'electron'

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
  windows: NamedWindowController
): void {
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
}
