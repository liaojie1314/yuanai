import type { BrowserWindow, IpcMainInvokeEvent, WebContents } from 'electron'

import { IPC } from '../../shared/ipc-contract'
import { assertNoIpcPayload } from '../../shared/guards'
import type { AppRuntimeConfig } from '../../shared/runtime-config'
import { registerAuthIpcHandlers } from './auth'
import type { AuthIpcStorage, IpcMainRegistrar } from './auth'
import { registerAppearanceIpcHandlers } from './appearance'
import { registerClipboardIpcHandlers } from './clipboard'
import type { NativeClipboard } from './clipboard'
import { registerDialogIpcHandlers } from './dialog'
import type { NativeFileDialog } from './dialog'
import type { NativeDesktopCapturer } from './dialog'
import type { IpcInvocationGuard, TrustedWebContentsRegistry } from './guards'
import { registerOAuthIpcHandlers } from './oauth'
import { registerPreferencesIpcHandlers } from './prefs'
import type { PreferencesIpcStorage } from './prefs'
import { registerSystemIpcHandlers } from './system'
import type { ExternalShell } from './system'
import { registerWindowIpcHandlers } from './window'
import type { NamedWindowController } from './window'
import type { SelectedFileRegistry } from '../protocol/selected-file'
import type { DesktopSystemService } from '../system/desktop-system'
import type { DesktopAppearanceService } from '../system/desktop-appearance'

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
  /** 原生系统文件选择器。 */
  dialog: NativeFileDialog
  /** 原生屏幕与窗口缩略图枚举能力。 */
  desktopCapturer: NativeDesktopCapturer
  /** 系统原生剪贴板。 */
  clipboard: NativeClipboard
  /** 将可信 renderer 映射为它所属的主窗口。 */
  getWindow(webContents: WebContents): BrowserWindow | null
  /** 用户选择文件的一次性受控引用表。 */
  selectedFiles: SelectedFileRegistry
  /** 有限的系统设置服务。 */
  systemService: DesktopSystemService
  /** 控制原生窗口外观的服务。 */
  appearanceService: DesktopAppearanceService
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
  registerAppearanceIpcHandlers(options)
  registerClipboardIpcHandlers({
    clipboard: options.clipboard,
    guard: options.guard,
    ipcMain: options.ipcMain,
  })
  registerDialogIpcHandlers({
    dialog: options.dialog,
    desktopCapturer: options.desktopCapturer,
    getWindow: options.getWindow,
    guard: options.guard,
    ipcMain: options.ipcMain,
    selectedFiles: options.selectedFiles,
  })
  registerOAuthIpcHandlers({
    ipcMain: options.ipcMain,
    guard: options.guard,
    runtimeConfig: options.runtimeConfig,
    shell: options.shell,
    windows: options.windows,
  })
  registerPreferencesIpcHandlers(options)
  registerSystemIpcHandlers(options)
  registerWindowIpcHandlers(
    options.ipcMain,
    options.guard,
    options.windows,
    options.getWindow,
    options.runtimeConfig
  )
  options.ipcMain.handle(
    IPC.runtime.getConfig,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      options.guard.assertTrusted(event)
      assertNoIpcPayload(args)
      return copyRuntimeConfig(options.runtimeConfig)
    }
  )
}
