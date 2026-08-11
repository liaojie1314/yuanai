import type { IpcMainInvokeEvent } from 'electron'

import { IPC } from '../../shared/ipc-contract'
import { readBoundedIpcString } from '../../shared/guards'
import type { IpcMainRegistrar } from './auth'
import type { IpcInvocationGuard } from './guards'

/** 主进程可调用的原生剪贴板最小能力。 */
export interface NativeClipboard {
  /** 将纯文本写入系统剪贴板。 */
  writeText(value: string): void
}

/** 原生剪贴板 IPC 的显式依赖。 */
export interface ClipboardIpcOptions {
  /** IPC 处理器注册器。 */
  ipcMain: IpcMainRegistrar
  /** renderer sender 安全边界。 */
  guard: IpcInvocationGuard
  /** Electron 原生剪贴板能力。 */
  clipboard: NativeClipboard
}

/** 注册仅供可信 renderer 写入纯文本的系统剪贴板 IPC。 */
export function registerClipboardIpcHandlers(options: ClipboardIpcOptions): void {
  options.ipcMain.handle(
    IPC.clipboard.writeText,
    (event: IpcMainInvokeEvent, ...args: unknown[]): void => {
      options.guard.assertTrusted(event)
      options.clipboard.writeText(readBoundedIpcString(args))
    }
  )
}
