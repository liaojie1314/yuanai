/** 可由桌面系统级快捷键触发的稳定动作标识。 */
export type DesktopActionId = 'toggle-main-window'

/** 桌面动作注册表的运行时实现。 */
export type DesktopActionRegistry = Readonly<Record<DesktopActionId, () => void>>

/** 创建桌面全局动作注册表，后续动作只需在此登记即可复用快捷键管道。 */
export function createDesktopActionRegistry(options: {
  /** 显示或隐藏元AI 主窗口。 */
  toggleMainWindow(): void
}): DesktopActionRegistry {
  return Object.freeze({ 'toggle-main-window': options.toggleMainWindow })
}
