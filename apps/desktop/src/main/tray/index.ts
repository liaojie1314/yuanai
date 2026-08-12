import type { NativeImage, Tray } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

/** 原生托盘菜单的最小构建能力。 */
export interface TrayMenuBuilder {
  /** 基于受控菜单项创建原生菜单。 */
  buildFromTemplate(template: MenuItemConstructorOptions[]): Electron.Menu
}

/** Electron 原生托盘的最小能力集合。 */
export interface NativeTray extends Pick<Tray, 'destroy' | 'setContextMenu' | 'setToolTip'> {
  /** 监听托盘图标点击。 */
  on(event: 'click', listener: () => void): this
}

/** 创建元AI 系统托盘所需的可替换依赖。 */
export interface TrayControllerOptions {
  /** 创建原生托盘图标。 */
  createTray(icon: NativeImage): NativeTray
  /** 用于原生托盘的应用图标。 */
  icon: NativeImage
  /** 创建原生上下文菜单。 */
  menu: TrayMenuBuilder
  /** 显示并聚焦主窗口。 */
  onShowMain(): void
  /** 打开独立设置窗口。 */
  onOpenSettings(): void
  /** 请求彻底退出应用。 */
  onQuit(): void
}

/** 可释放的元AI 系统托盘控制器。 */
export interface TrayController {
  /** 释放原生托盘图标。 */
  dispose(): void
}

/**
 * 创建常驻的元AI 系统托盘。
 * @param options 原生托盘依赖和窗口操作。
 * @returns 用于应用退出时释放原生资源的控制器。
 */
export function createTrayController(options: TrayControllerOptions): TrayController {
  const tray = options.createTray(options.icon)
  tray.setToolTip('元AI')
  tray.setContextMenu(
    options.menu.buildFromTemplate([
      { label: '显示元AI', click: options.onShowMain },
      { label: '打开设置', click: options.onOpenSettings },
      { type: 'separator' },
      { label: '退出元AI', click: options.onQuit },
    ])
  )
  tray.on('click', options.onShowMain)

  return {
    dispose: () => tray.destroy(),
  }
}
