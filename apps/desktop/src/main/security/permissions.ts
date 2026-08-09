import type { Session, WebContents } from 'electron'

import type { TrustedWebContentsRegistry } from '../ipc/guards'

/** 根据可信窗口与权限类型决定是否授予 renderer 权限。 */
export function permissionDecision(
  isTrustedRenderer: boolean,
  permission: string,
  mediaTypes: readonly string[]
): boolean {
  return (
    isTrustedRenderer &&
    permission === 'media' &&
    mediaTypes.length === 1 &&
    mediaTypes[0] === 'video'
  )
}

/** 在 Electron Session 上安装默认拒绝的权限请求处理器。 */
export function installPermissionHandler(
  session: Session,
  trustedWebContents: TrustedWebContentsRegistry
): void {
  session.setPermissionRequestHandler((webContents: WebContents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : []
    callback(permissionDecision(trustedWebContents.has(webContents.id), permission, mediaTypes))
  })
}
