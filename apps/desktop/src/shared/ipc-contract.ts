/** Desktop 主进程持久偏好。 */
export interface DesktopPreferences {
  closeToTray: boolean
  globalShortcut: string | null
  autoLaunch: boolean
  updateChannel: 'stable' | 'beta'
  checkUpdatesAutomatically: boolean
  nativeNotifications: boolean
  notificationSound: boolean
  aiReplyNotifications: boolean
}

/** Desktop 偏好的安全默认值。 */
export const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = Object.freeze({
  closeToTray: true,
  globalShortcut: 'CommandOrControl+Alt+Y',
  autoLaunch: false,
  updateChannel: 'stable',
  checkUpdatesAutomatically: true,
  nativeNotifications: true,
  notificationSound: true,
  aiReplyNotifications: true,
})

/** 桌面应用可安全展示的运行信息。 */
export interface DesktopAppInfo {
  /** 当前安装包版本。 */
  version: string
  /** Electron 所在的操作系统平台。 */
  platform: NodeJS.Platform
}

/** 全局快捷键注册结果。 */
export interface ShortcutStatus {
  /** 当前仍然生效的快捷键；未注册时为 null。 */
  accelerator: string | null
  /** 快捷键是否已由当前应用成功注册。 */
  registered: boolean
  /** 注册失败的可展示原因。 */
  errorCode?: 'CONFLICT' | 'INVALID'
}

/** 允许由主进程打开的固定帮助链接。 */
export type ExternalLinkId = 'documentation' | 'repository' | 'feedback' | 'privacy'

/** IPC 通道名的唯一来源。 */
export const IPC = {
  auth: { get: 'auth:get', set: 'auth:set', remove: 'auth:remove' },
  prefs: { get: 'prefs:get', update: 'prefs:update' },
  runtime: { getConfig: 'runtime:get-config' },
  window: {
    openLogin: 'window:open-login',
    openRegister: 'window:open-register',
    openForgot: 'window:open-forgot',
    openSettings: 'window:open-settings',
    openAbout: 'window:open-about',
  },
  system: {
    getInfo: 'system:get-info',
    setAutoLaunch: 'system:set-auto-launch',
    setGlobalShortcut: 'system:set-global-shortcut',
  },
  shell: { openExternal: 'shell:open-external' },
  events: {
    authChanged: 'event:auth-changed',
    prefsChanged: 'event:prefs-changed',
    deepLink: 'event:deep-link',
    oauthResult: 'event:oauth-result',
    menuCommand: 'event:menu-command',
    artifactInit: 'event:artifact-init',
    notificationNavigate: 'event:notification-navigate',
    updater: 'event:updater',
  },
} as const
