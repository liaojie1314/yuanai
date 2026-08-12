import type { BrowserWindowConstructorOptions } from 'electron'

/** 各 renderer 入口对应的固定窗口尺寸。 */
export const WINDOW_SPECS = {
  main: { width: 1280, height: 820, minWidth: 1280, minHeight: 640, resizable: true },
  login: {
    width: 520,
    height: 600,
    minWidth: 520,
    minHeight: 600,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
  },
  register: {
    width: 520,
    height: 810,
    minWidth: 520,
    minHeight: 810,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
  },
  forgot: {
    width: 520,
    height: 680,
    minWidth: 520,
    minHeight: 680,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
  },
  settings: { width: 960, height: 720, minWidth: 800, minHeight: 600, resizable: true },
  about: { width: 480, height: 360, minWidth: 480, minHeight: 360, resizable: false },
  artifact: { width: 980, height: 720, minWidth: 720, minHeight: 520, resizable: true },
  oauth: { width: 420, height: 260, minWidth: 420, minHeight: 260, resizable: false },
} as const

/** 可创建窗口的尺寸配置键。 */
export type WindowSpecKey = keyof typeof WINDOW_SPECS

/** 创建不暴露 Node 能力、在首帧就绪前保持隐藏的窗口配置。 */
export function createWindowOptions(
  key: WindowSpecKey,
  preloadPath: string,
  platform: NodeJS.Platform
): BrowserWindowConstructorOptions {
  return {
    ...WINDOW_SPECS[key],
    show: false,
    ...(platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
    ...(platform === 'linux' ? { frame: false } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: preloadPath,
    },
  }
}
