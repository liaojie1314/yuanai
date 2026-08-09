import type { BrowserWindowConstructorOptions } from 'electron'

import type { RendererEntry } from '../../shared/window-entry'

/** 各 renderer 入口对应的固定窗口尺寸。 */
export const WINDOW_SPECS = {
  main: { width: 1280, height: 820, minWidth: 960, minHeight: 640, resizable: true },
  login: { width: 980, height: 680, minWidth: 760, minHeight: 580, resizable: true },
  settings: { width: 960, height: 720, minWidth: 800, minHeight: 600, resizable: true },
  about: { width: 480, height: 360, minWidth: 480, minHeight: 360, resizable: false },
  artifact: { width: 980, height: 720, minWidth: 720, minHeight: 520, resizable: true },
  oauth: { width: 420, height: 260, minWidth: 420, minHeight: 260, resizable: false },
} as const

/** 创建不暴露 Node 能力、在首帧就绪前保持隐藏的窗口配置。 */
export function createWindowOptions(
  entry: RendererEntry,
  preloadPath: string,
  platform: NodeJS.Platform
): BrowserWindowConstructorOptions {
  return {
    ...WINDOW_SPECS[entry],
    show: false,
    ...(platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: preloadPath,
    },
  }
}
