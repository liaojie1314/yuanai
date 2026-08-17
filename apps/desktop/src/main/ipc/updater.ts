import type { IpcMainInvokeEvent } from 'electron'

import { IPC } from '../../shared/ipc-contract'
import { assertNoIpcPayload } from '../../shared/guards'
import type { IpcMainRegistrar } from './auth'
import type { IpcInvocationGuard } from './guards'
import type { DesktopUpdaterService } from '../system/desktop-updater'

/** 安装更新 IPC 所需的受信任主进程依赖。 */
export interface UpdaterIpcOptions {
  ipcMain: IpcMainRegistrar
  guard: IpcInvocationGuard
  updaterService: DesktopUpdaterService
}

/** 注册检查、下载、安装和跳过更新的白名单 IPC。 */
export function registerUpdaterIpcHandlers(options: UpdaterIpcOptions): void {
  options.ipcMain.handle(
    IPC.updater.check,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      options.guard.assertTrusted(event)
      assertNoIpcPayload(args)
      return options.updaterService.check()
    }
  )
  options.ipcMain.handle(
    IPC.updater.download,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      options.guard.assertTrusted(event)
      assertNoIpcPayload(args)
      return options.updaterService.download()
    }
  )
  options.ipcMain.handle(IPC.updater.install, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    options.guard.assertTrusted(event)
    assertNoIpcPayload(args)
    return options.updaterService.install()
  })
  options.ipcMain.handle(
    IPC.updater.skip,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      options.guard.assertTrusted(event)
      assertNoIpcPayload(args)
      return options.updaterService.skip()
    }
  )
}
