import type { Session, WebContents } from 'electron'

import type { DesktopMediaPermissionType } from '../../shared/ipc-contract'
import type { TrustedWebContentsRegistry } from '../ipc/guards'

/** 可由桌面端向用户申请的受控媒体权限。 */
export type MediaPermissionType = DesktopMediaPermissionType

/** 展示本机媒体授权确认框的回调。 */
export interface MediaPermissionPrompt {
  /** 请求某个可信 renderer 的单项媒体权限。 */
  (webContents: WebContents, mediaType: MediaPermissionType): Promise<boolean>
}

function getMediaPermissionType(mediaTypes: readonly string[]): MediaPermissionType | null {
  if (mediaTypes.length !== 1) return null
  const mediaType = mediaTypes[0]
  return mediaType === 'audio' || mediaType === 'video' ? mediaType : null
}

/** 根据可信窗口与权限类型决定是否授予 renderer 权限。 */
export function permissionDecision(
  isTrustedRenderer: boolean,
  permission: string,
  mediaTypes: readonly string[]
): boolean {
  return isTrustedRenderer && permission === 'media' && getMediaPermissionType(mediaTypes) !== null
}

/**
 * 在可信媒体权限请求通过安全校验后，等待用户明确确认。
 * @param isTrustedRenderer 请求窗口是否已被主进程标记为可信。
 * @param permission Electron 请求的权限类别。
 * @param mediaTypes 请求的媒体类型。
 * @param confirm 向用户展示的本机确认回调。
 * @returns 用户是否确认授权。
 */
export async function requestTrustedMediaPermission(
  isTrustedRenderer: boolean,
  permission: string,
  mediaTypes: readonly string[],
  confirm: (mediaType: MediaPermissionType) => Promise<boolean>
): Promise<boolean> {
  const mediaType = getMediaPermissionType(mediaTypes)
  if (!mediaType || !permissionDecision(isTrustedRenderer, permission, mediaTypes)) return false

  try {
    return await confirm(mediaType)
  } catch {
    return false
  }
}

/** 在 Electron Session 上安装默认拒绝的权限请求处理器。 */
export function installPermissionHandler(
  session: Session,
  trustedWebContents: TrustedWebContentsRegistry,
  prompt: MediaPermissionPrompt
): void {
  const grants = new Map<number, Set<MediaPermissionType>>()

  session.setPermissionRequestHandler((webContents: WebContents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : []
    const mediaType = getMediaPermissionType(mediaTypes)
    const isTrustedRenderer = trustedWebContents.has(webContents.id)
    if (!mediaType || !permissionDecision(isTrustedRenderer, permission, mediaTypes)) {
      callback(false)
      return
    }

    const windowGrants = grants.get(webContents.id)
    if (windowGrants?.has(mediaType)) {
      callback(true)
      return
    }

    void requestTrustedMediaPermission(isTrustedRenderer, permission, mediaTypes, (kind) =>
      prompt(webContents, kind)
    ).then((granted) => {
      if (granted) {
        const permissions = grants.get(webContents.id) ?? new Set<MediaPermissionType>()
        permissions.add(mediaType)
        grants.set(webContents.id, permissions)
      }
      callback(granted)
    })
  })
}
