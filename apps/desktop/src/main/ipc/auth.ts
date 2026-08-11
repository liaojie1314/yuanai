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
  /** 加密会话成功写入或移除后执行的主进程编排。 */
  onSessionChanged(hasSession: boolean): void
}

function broadcastAuthChanged(registry: TrustedWebContentsRegistry, hasSession: boolean): void {
  registry.forEach((webContents) => webContents.send(IPC.events.authChanged, hasSession))
}

/** 判断 Zustand 持久化的认证载荷是否仍包含可用 access token。 */
function hasPersistedSession(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || !('state' in parsed)) return false

    const state = parsed.state
    return (
      typeof state === 'object' &&
      state !== null &&
      'accessToken' in state &&
      typeof state.accessToken === 'string' &&
      state.accessToken.length > 0
    )
  } catch {
    return false
  }
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
    const hasSession = hasPersistedSession(value)
    if (hasSession) {
      await options.authStorage.setItem(AUTH_STORAGE_KEY, value)
    } else {
      await options.authStorage.removeItem(AUTH_STORAGE_KEY)
    }
    broadcastAuthChanged(options.trustedWebContents, hasSession)
    options.onSessionChanged(hasSession)
  })
  options.ipcMain.handle(IPC.auth.remove, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    options.guard.assertTrusted(event)
    assertNoIpcPayload(args)
    await options.authStorage.removeItem(AUTH_STORAGE_KEY)
    broadcastAuthChanged(options.trustedWebContents, false)
    options.onSessionChanged(false)
  })
}
