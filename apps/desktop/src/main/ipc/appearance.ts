import type { IpcMainInvokeEvent } from 'electron'

import type {
  DesktopAppearanceState,
  DesktopRendererPreferences,
  DesktopThemeChoice,
} from '../../shared/ipc-contract'
import { IPC } from '../../shared/ipc-contract'
import { assertNoIpcPayload, readSingleIpcPayload } from '../../shared/guards'
import type { IpcMainRegistrar } from './auth'
import type { IpcInvocationGuard, TrustedWebContentsRegistry } from './guards'
import type { DesktopAppearanceService } from '../system/desktop-appearance'

/** 外观 IPC 处理器的显式依赖。 */
export interface AppearanceIpcOptions {
  /** IPC 注册器。 */
  ipcMain: IpcMainRegistrar
  /** renderer sender 安全边界。 */
  guard: IpcInvocationGuard
  /** 主进程唯一的外观服务。 */
  appearanceService: DesktopAppearanceService
  /** 接收净化显示偏好的可信 renderer。 */
  trustedWebContents: TrustedWebContentsRegistry
}

function readThemeChoice(args: readonly unknown[]): DesktopThemeChoice {
  const value = readSingleIpcPayload(args)
  if (value === 'auto' || value === 'light' || value === 'dark') return value
  throw new Error('IPC_PAYLOAD_INVALID')
}

function isDesktopRendererPreferences(value: unknown): value is DesktopRendererPreferences {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const preferences = value as Record<string, unknown>
  return (
    Object.keys(preferences).length === 6 &&
    (preferences.theme === 'auto' ||
      preferences.theme === 'light' ||
      preferences.theme === 'dark') &&
    (preferences.fontSize === 'small' ||
      preferences.fontSize === 'medium' ||
      preferences.fontSize === 'large') &&
    (preferences.density === 'compact' ||
      preferences.density === 'standard' ||
      preferences.density === 'loose') &&
    (preferences.timeFormat === '24h' || preferences.timeFormat === '12h') &&
    (preferences.dateFormat === 'ymd' ||
      preferences.dateFormat === 'mdy' ||
      preferences.dateFormat === 'dmy') &&
    typeof preferences.language === 'string' &&
    preferences.language.length > 0 &&
    preferences.language.length <= 64
  )
}

/** 注册读取和修改当前桌面主题的最小 IPC 接口。 */
export function registerAppearanceIpcHandlers(options: AppearanceIpcOptions): void {
  options.ipcMain.handle(
    IPC.appearance.get,
    async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<DesktopAppearanceState> => {
      options.guard.assertTrusted(event)
      assertNoIpcPayload(args)
      return options.appearanceService.get()
    }
  )
  options.ipcMain.handle(
    IPC.appearance.apply,
    async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<DesktopAppearanceState> => {
      options.guard.assertTrusted(event)
      return options.appearanceService.apply(readThemeChoice(args))
    }
  )
  options.ipcMain.handle(
    IPC.appearance.syncPreferences,
    async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<void> => {
      options.guard.assertTrusted(event)
      const preferences = readSingleIpcPayload(args)
      if (!isDesktopRendererPreferences(preferences)) throw new Error('IPC_PAYLOAD_INVALID')
      options.trustedWebContents.forEach((webContents) =>
        webContents.send(IPC.events.displayPreferencesChanged, { ...preferences })
      )
    }
  )
}
