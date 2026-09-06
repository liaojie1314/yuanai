import type {
  DesktopAppInfo,
  DesktopNotificationPayload,
  DesktopPreferences,
  ShortcutStatus,
} from '../../shared/ipc-contract'
import type { PreferencesIpcStorage } from '../ipc/prefs'
import type { DesktopActionRegistry } from '../actions/registry'

const MAX_SHORTCUT_LENGTH = 128

/** 主进程实际需要的 Electron 应用能力。 */
export interface DesktopSystemApp {
  /** 读取应用版本。 */
  getVersion(): string
  /** 设置系统登录项。 */
  setLoginItemSettings(settings: { openAtLogin: boolean }): void
}

/** 主进程实际需要的全局快捷键能力。 */
export interface GlobalShortcutApi {
  /** 注册全局快捷键，成功时返回 true。 */
  register(accelerator: string, callback: () => void): boolean
  /** 释放单个全局快捷键。 */
  unregister(accelerator: string): void
  /** 释放本进程注册的所有全局快捷键。 */
  unregisterAll(): void
}

/** Electron 原生通知的最小能力。 */
export interface DesktopNotificationApi {
  /** 当前系统是否可显示原生通知。 */
  isSupported(): boolean
  /** 显示一个已经校验的通知。 */
  show(payload: DesktopNotificationPayload): void
}

/** 桌面系统服务的显式依赖。 */
export interface DesktopSystemOptions {
  /** Electron 应用实例。 */
  app: DesktopSystemApp
  /** 全局快捷键实现。 */
  globalShortcut: GlobalShortcutApi
  /** 已校验的桌面偏好存储。 */
  preferencesStorage: PreferencesIpcStorage
  /** 系统级快捷键可调用的已登记动作。 */
  actionRegistry: DesktopActionRegistry
  /** 当前 Electron 平台。 */
  platform: NodeJS.Platform
  /** 构建期注入的 package.json 版本号；缺失时退回 Electron 运行时版本。 */
  appVersion?: string
  /** 可选的原生通知实现。 */
  notifications?: DesktopNotificationApi
}

function normalizeShortcut(value: string | null): string | null {
  if (value === null) return null
  const normalized = value.trim()
  if (!normalized) return null
  if (normalized.length > MAX_SHORTCUT_LENGTH) throw new Error('SHORTCUT_INVALID')
  return normalized
}

/** 管理可持久化的全局快捷键和开机自启设置。 */
export class DesktopSystemService {
  private activeShortcut: string | null = null

  /** 创建桌面系统服务。 */
  public constructor(private readonly options: DesktopSystemOptions) {}

  /** 恢复已保存的系统级设置，不重写偏好文件。 */
  public async restore(): Promise<void> {
    const preferences = await this.options.preferencesStorage.get()
    this.options.app.setLoginItemSettings({ openAtLogin: preferences.autoLaunch })
    this.registerStoredShortcut(preferences.globalShortcut)
  }

  /** 获取可安全发送给 renderer 的应用信息。 */
  public getInfo(): DesktopAppInfo {
    return {
      platform: this.options.platform,
      version: this.options.appVersion ?? this.options.app.getVersion(),
    }
  }

  /** 替换全局快捷键，仅在注册成功后写入偏好。 */
  public async setGlobalShortcut(value: string | null): Promise<ShortcutStatus> {
    let accelerator: string | null
    try {
      accelerator = normalizeShortcut(value)
    } catch {
      return this.status('INVALID')
    }

    if (accelerator === this.activeShortcut) return this.status()
    const previous = this.activeShortcut
    if (accelerator === null) {
      if (previous) this.options.globalShortcut.unregister(previous)
      this.activeShortcut = null
      try {
        await this.options.preferencesStorage.update({ globalShortcut: null })
      } catch (error: unknown) {
        this.restoreShortcut(previous)
        throw error
      }
      return this.status()
    }

    try {
      if (!this.options.globalShortcut.register(accelerator, () => this.runGlobalAction())) {
        return this.status('CONFLICT')
      }
    } catch {
      return this.status('INVALID')
    }

    if (previous) this.options.globalShortcut.unregister(previous)
    this.activeShortcut = accelerator
    try {
      await this.options.preferencesStorage.update({ globalShortcut: accelerator })
    } catch (error: unknown) {
      this.options.globalShortcut.unregister(accelerator)
      this.restoreShortcut(previous)
      throw error
    }
    return this.status()
  }

  /** 更新开机自启设置，并在持久化失败时恢复原状态。 */
  public async setAutoLaunch(enabled: boolean): Promise<DesktopPreferences> {
    const current = await this.options.preferencesStorage.get()
    this.options.app.setLoginItemSettings({ openAtLogin: enabled })
    try {
      return await this.options.preferencesStorage.update({ autoLaunch: enabled })
    } catch (error: unknown) {
      this.options.app.setLoginItemSettings({ openAtLogin: current.autoLaunch })
      throw error
    }
  }

  /** 根据已持久化的三项通知偏好展示一次 AI 回复完成提醒。 */
  public async notifyAiReply(
    payload: Omit<DesktopNotificationPayload, 'playSound'>
  ): Promise<boolean> {
    const preferences = await this.options.preferencesStorage.get()
    if (!preferences.nativeNotifications || !preferences.aiReplyNotifications) return false
    const notifications = this.options.notifications
    if (!notifications?.isSupported()) return false
    notifications.show({ ...payload, playSound: preferences.notificationSound })
    return true
  }

  /** 释放应用注册的系统资源。 */
  public dispose(): void {
    this.options.globalShortcut.unregisterAll()
    this.activeShortcut = null
  }

  private registerStoredShortcut(value: string | null): void {
    let accelerator: string | null
    try {
      accelerator = normalizeShortcut(value)
    } catch {
      return
    }
    if (!accelerator) return
    try {
      if (this.options.globalShortcut.register(accelerator, () => this.runGlobalAction())) {
        this.activeShortcut = accelerator
      }
    } catch {
      // 无效的历史快捷键仅在本次启动中跳过，保留给用户在设置中修正。
    }
  }

  private restoreShortcut(value: string | null): void {
    this.activeShortcut = null
    if (!value) return
    try {
      if (this.options.globalShortcut.register(value, () => this.runGlobalAction())) {
        this.activeShortcut = value
      }
    } catch {
      // 恢复失败时不向 renderer 暴露底层 Electron 错误信息。
    }
  }

  private status(errorCode?: 'CONFLICT' | 'INVALID'): ShortcutStatus {
    if (errorCode) {
      return {
        accelerator: this.activeShortcut,
        errorCode,
        registered: this.activeShortcut !== null,
      }
    }
    return { accelerator: this.activeShortcut, registered: this.activeShortcut !== null }
  }

  private runGlobalAction(): void {
    this.options.actionRegistry['toggle-main-window']()
  }
}
