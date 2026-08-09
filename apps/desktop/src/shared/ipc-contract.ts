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
