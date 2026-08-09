import type { IpcMainInvokeEvent } from 'electron'

import { IPC } from '../../shared/ipc-contract'
import { assertNoIpcPayload, readBoundedIpcString } from '../../shared/guards'
import type { IpcInvocationGuard, TrustedWebContentsRegistry } from './guards'

const AUTH_STORAGE_KEY = 'yuanai-auth'

/** 提供给认证 IPC 处理器的加密会话存储能力。 */
export interface AuthIpcStorage {
  /** 获取加密会话序列化值。 */
  getItem(key: string): Promise<string | null>
  /** 保存加密会话序列化值。 */
  setItem(key: string, value: string): Promise<void>
  /** 删除加密会话序列化值。 */
  removeItem(key: string): Promise<void>
}

/** 可注册 IPC 调用处理器的最小接口。 */
export interface IpcMainRegistrar {
  /** 注册固定通道的调用处理器。 */
  handle(channel: string, handler: IpcInvokeHandler): void
}

/** 固定 IPC 通道的调用处理器签名。 */
export type IpcInvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

/** 认证 IPC 处理器的显式依赖。 */
export interface AuthIpcOptions {
  /** Electron IPC 注册器。 */
  ipcMain: IpcMainRegistrar
  /** sender 安全边界。 */
  guard: IpcInvocationGuard
  /** 加密认证状态存储。 */
  authStorage: AuthIpcStorage
  /** 接收净化状态事件的受信任窗口。 */
  trustedWebContents: TrustedWebContentsRegistry
}

function broadcastAuthChanged(registry: TrustedWebContentsRegistry, hasSession: boolean): void {
  registry.forEach((webContents) => webContents.send(IPC.events.authChanged, hasSession))
}

/** 注册受 sender 校验保护的认证状态 IPC 处理器。 */
export function registerAuthIpcHandlers(options: AuthIpcOptions): void {
  options.ipcMain.handle(IPC.auth.get, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    options.guard.assertTrusted(event)
    assertNoIpcPayload(args)
    return options.authStorage.getItem(AUTH_STORAGE_KEY)
  })
  options.ipcMain.handle(IPC.auth.set, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    options.guard.assertTrusted(event)
    const value = readBoundedIpcString(args)
    await options.authStorage.setItem(AUTH_STORAGE_KEY, value)
    broadcastAuthChanged(options.trustedWebContents, true)
  })
  options.ipcMain.handle(IPC.auth.remove, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    options.guard.assertTrusted(event)
    assertNoIpcPayload(args)
    await options.authStorage.removeItem(AUTH_STORAGE_KEY)
    broadcastAuthChanged(options.trustedWebContents, false)
  })
}
