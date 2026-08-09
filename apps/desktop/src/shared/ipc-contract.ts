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

/** IPC 通道名的唯一来源。 */
export const IPC = {
  auth: { get: 'auth:get', set: 'auth:set', remove: 'auth:remove' },
  prefs: { get: 'prefs:get', update: 'prefs:update' },
  runtime: { getConfig: 'runtime:get-config' },
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
