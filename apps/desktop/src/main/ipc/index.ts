import type { IpcMainInvokeEvent } from 'electron'

import { IPC } from '../../shared/ipc-contract'
import { assertNoIpcPayload } from '../../shared/guards'
import type { AppRuntimeConfig } from '../../shared/runtime-config'
import { registerAuthIpcHandlers } from './auth'
import type { AuthIpcStorage, IpcMainRegistrar } from './auth'
import type { IpcInvocationGuard, TrustedWebContentsRegistry } from './guards'
import { registerPreferencesIpcHandlers } from './prefs'
import type { PreferencesIpcStorage } from './prefs'
import { registerSystemIpcHandlers } from './system'
import type { ExternalShell } from './system'
import { registerWindowIpcHandlers } from './window'
import type { NamedWindowController } from './window'
import type { DesktopSystemService } from '../system/desktop-system'

/** 安装第一批安全 IPC 处理器所需的主进程依赖。 */
export interface SetupIpcOptions {
  /** Electron IPC 注册器。 */
  ipcMain: IpcMainRegistrar
  /** sender 安全边界。 */
  guard: IpcInvocationGuard
  /** 已托管窗口注册表。 */
  trustedWebContents: TrustedWebContentsRegistry
  /** 加密认证状态存储。 */
  authStorage: AuthIpcStorage
  /** 加密会话成功写入或移除后执行的主进程编排。 */
  onSessionChanged(hasSession: boolean): void
  /** 已校验的桌面偏好存储。 */
  preferencesStorage: PreferencesIpcStorage
  /** 主进程唯一读取并校验后的运行时配置。 */
  runtimeConfig: AppRuntimeConfig
  /** 有限的系统设置服务。 */
  systemService: DesktopSystemService
  /** 系统默认浏览器调用能力。 */
  shell: ExternalShell
  /** 命名窗口的受限打开能力。 */
  windows: NamedWindowController
}

function copyRuntimeConfig(config: AppRuntimeConfig): AppRuntimeConfig {
  return Object.freeze({
    apiBaseUrl: config.apiBaseUrl,
    webBaseUrl: config.webBaseUrl,
    assetOrigins: Object.freeze([...config.assetOrigins]),
  })
}

/** 安装认证、偏好和运行时配置的固定 IPC 通道。 */
export function setupIpc(options: SetupIpcOptions): void {
  registerAuthIpcHandlers(options)
  registerPreferencesIpcHandlers(options)
  registerSystemIpcHandlers(options)
  registerWindowIpcHandlers(options.ipcMain, options.guard, options.windows)
  options.ipcMain.handle(
    IPC.runtime.getConfig,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      options.guard.assertTrusted(event)
      assertNoIpcPayload(args)
      return copyRuntimeConfig(options.runtimeConfig)
    }
  )
}
