import type { WebContents } from 'electron'

/** 禁止 renderer 创建新窗口或将主 frame 导航到非应用资源。 */
export function lockRendererNavigation(webContents: WebContents): void {
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  webContents.on('will-navigate', (event) => event.preventDefault())
}
