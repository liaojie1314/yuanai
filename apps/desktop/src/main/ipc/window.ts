import type { IpcMainInvokeEvent } from 'electron'

import { IPC } from '../../shared/ipc-contract'
import { assertNoIpcPayload } from '../../shared/guards'
import type { IpcMainRegistrar } from './auth'
import type { IpcInvocationGuard } from './guards'

/** 可由受信任 renderer 请求打开的命名桌面窗口。 */
export interface NamedWindowController {
  /** 打开并聚焦设置窗口。 */
  openSettings(): void
  /** 打开并聚焦关于窗口。 */
  openAbout(): void
}

/** 注册用于打开命名窗口的最小 IPC 能力。 */
export function registerWindowIpcHandlers(
  ipcMain: IpcMainRegistrar,
  guard: IpcInvocationGuard,
  windows: NamedWindowController
): void {
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
}
