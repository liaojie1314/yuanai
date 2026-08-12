import type { DesktopPreferences } from '../../shared/ipc-contract'

/** 主窗口关闭时需要的有限 BrowserWindow 能力。 */
export interface CloseAwareMainWindow {
  /** 监听窗口关闭请求。 */
  on(event: 'close', listener: (event: { preventDefault(): void }) => void): this
  /** 隐藏窗口但保持 renderer 和应用进程存活。 */
  hide(): void
  /** 再次请求关闭窗口。 */
  close(): void
}

/** 用于读取关闭行为偏好的存储能力。 */
export interface CloseToTrayPreferencesStorage {
  /** 读取当前已校验的桌面偏好。 */
  get(): Promise<DesktopPreferences>
}

/** 安装主窗口关闭时最小化到托盘的依赖。 */
export interface CloseToTrayOptions {
  /** 主窗口实例。 */
  window: CloseAwareMainWindow
  /** 已校验的桌面偏好存储。 */
  preferencesStorage: CloseToTrayPreferencesStorage
  /** 当前是否正由系统或托盘菜单执行彻底退出。 */
  isQuitting(): boolean
  /** 执行彻底退出，关闭所有窗口和应用进程。 */
  onQuit(): void
}

/**
 * 根据用户偏好拦截主窗口关闭：默认隐藏到托盘，关闭该偏好后才销毁窗口。
 * @param options 主窗口、偏好存储和退出状态。
 */
export function installCloseToTrayBehavior(options: CloseToTrayOptions): void {
  let resolvingPreference = false
  let allowClose = false

  options.window.on('close', (event) => {
    if (allowClose || options.isQuitting()) return
    event.preventDefault()
    if (resolvingPreference) return
    resolvingPreference = true

    void options.preferencesStorage
      .get()
      .then((preferences) => {
        if (preferences.closeToTray) {
          options.window.hide()
          return
        }
        allowClose = true
        options.onQuit()
      })
      .catch(() => {
        // 读取偏好失败时采用默认的隐藏行为，避免用户意外退出应用。
        options.window.hide()
      })
      .finally(() => {
        resolvingPreference = false
      })
  })
}
