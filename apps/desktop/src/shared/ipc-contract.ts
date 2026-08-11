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

/** 由系统文件选择器授予、可一次性读取的本地文件描述。 */
export interface DesktopSelectedFile {
  /** 不包含本机绝对路径的显示文件名。 */
  name: string
  /** 仅对本次选择有效的受控本地文件 URL。 */
  url: string
}

/** 用户可选择插入对话的已缩略化屏幕或窗口快照。 */
export interface DesktopScreenSource {
  /** Electron 提供的仅用于本次选择的屏幕或窗口标识。 */
  id: string
  /** 系统显示的屏幕或窗口名称。 */
  name: string
  /** PNG data URL 缩略图，不包含本机文件路径。 */
  thumbnailDataUrl: string
}

/** 由主窗口显式提交给独立 Artifact 窗口的代码内容。 */
export interface DesktopArtifactPayload {
  /** Artifact 窗口标题。 */
  title: string
  /** 代码语言。 */
  lang: string
  /** 仅由用户点击消息中的代码块操作传递的文本内容。 */
  code: string
  /** 只读查看或受限运行。 */
  mode: 'view' | 'run'
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

/** 支持从桌面端发起授权的第三方 OAuth provider。 */
export type DesktopOAuthProvider = 'github' | 'google'

/** 主进程解析后可安全转发给 OAuth 窗口的结果。 */
export type DesktopOAuthResult =
  | { type: 'oauth'; code: string }
  | { type: 'oauth-error'; error: string; description: string | null }

/** IPC 通道名的唯一来源。 */
export const IPC = {
  auth: { get: 'auth:get', set: 'auth:set', remove: 'auth:remove' },
  prefs: { get: 'prefs:get', update: 'prefs:update' },
  runtime: { getConfig: 'runtime:get-config' },
  dialog: {
    openFiles: 'dialog:open-files',
    listScreenSources: 'dialog:list-screen-sources',
  },
  oauth: { start: 'oauth:start' },
  window: {
    openLogin: 'window:open-login',
    openRegister: 'window:open-register',
    openForgot: 'window:open-forgot',
    openSettings: 'window:open-settings',
    openAbout: 'window:open-about',
    openArtifact: 'window:open-artifact',
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
