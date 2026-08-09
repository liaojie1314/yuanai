import type { IpcMainInvokeEvent } from 'electron'

import type { DesktopPreferences } from '../../shared/ipc-contract'
import { IPC } from '../../shared/ipc-contract'
import {
  assertNoIpcPayload,
  copyDesktopPreferences,
  isDesktopPreferences,
  isDesktopPreferencesPatch,
  readSingleIpcPayload,
} from '../../shared/guards'
import type { IpcInvocationGuard, TrustedWebContentsRegistry } from './guards'
import type { IpcMainRegistrar } from './auth'

/** 提供给桌面偏好 IPC 处理器的持久化能力。 */
export interface PreferencesIpcStorage {
  /** 读取完整桌面偏好。 */
  get(): Promise<DesktopPreferences>
  /** 更新已校验的桌面偏好增量，并返回完整偏好。 */
  update(value: Partial<DesktopPreferences>): Promise<DesktopPreferences>
}

/** 桌面偏好 IPC 处理器的显式依赖。 */
export interface PreferencesIpcOptions {
  /** Electron IPC 注册器。 */
  ipcMain: IpcMainRegistrar
  /** sender 安全边界。 */
  guard: IpcInvocationGuard
  /** 桌面偏好持久化存储。 */
  preferencesStorage: PreferencesIpcStorage
  /** 接收净化偏好事件的受信任窗口。 */
  trustedWebContents: TrustedWebContentsRegistry
}

function broadcastPreferencesChanged(
  registry: TrustedWebContentsRegistry,
  preferences: DesktopPreferences
): void {
  registry.forEach((webContents) =>
    webContents.send(IPC.events.prefsChanged, copyDesktopPreferences(preferences))
  )
}

function sanitizePreferences(preferences: DesktopPreferences): DesktopPreferences {
  if (!isDesktopPreferences(preferences)) throw new Error('PREFERENCES_INVALID')
  return copyDesktopPreferences(preferences)
}

/** 注册受 sender 校验保护的桌面偏好 IPC 处理器。 */
export function registerPreferencesIpcHandlers(options: PreferencesIpcOptions): void {
  options.ipcMain.handle(IPC.prefs.get, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    options.guard.assertTrusted(event)
    assertNoIpcPayload(args)
    return sanitizePreferences(await options.preferencesStorage.get())
  })
  options.ipcMain.handle(
    IPC.prefs.update,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      options.guard.assertTrusted(event)
      const value = readSingleIpcPayload(args)
      if (!isDesktopPreferencesPatch(value)) throw new Error('PREFERENCES_INVALID')
      const preferences = await options.preferencesStorage.update(value)
      const sanitizedPreferences = sanitizePreferences(preferences)
      broadcastPreferencesChanged(options.trustedWebContents, sanitizedPreferences)
      return sanitizedPreferences
    }
  )
}
