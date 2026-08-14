import { randomUUID } from 'node:crypto'

import type { WebContents } from 'electron'

import {
  IPC,
  type DesktopMediaPermissionRequest,
  type DesktopMediaPermissionResponse,
} from '../../shared/ipc-contract'
import type { MediaPermissionPrompt, MediaPermissionType } from './permissions'

const PERMISSION_REQUEST_TIMEOUT_MS = 30_000

interface PendingPermissionRequest {
  webContentsId: number
  resolve(granted: boolean): void
  timeout: NodeJS.Timeout
}

/** 通过受信任 renderer 内的确认层完成单次媒体权限请求。 */
export class InAppMediaPermissionPrompt {
  private readonly pending = new Map<string, PendingPermissionRequest>()

  /** 适配 Electron 权限处理器的异步确认函数。 */
  public readonly prompt: MediaPermissionPrompt = (webContents, mediaType) =>
    this.request(webContents, mediaType)

  /** 将权限请求发送给发起请求的同一个受信任 renderer。 */
  public request(webContents: WebContents, mediaType: MediaPermissionType): Promise<boolean> {
    if (webContents.isDestroyed()) return Promise.resolve(false)

    const requestId = randomUUID()
    const request: DesktopMediaPermissionRequest = { requestId, mediaType }
    return new Promise((resolve) => {
      const timeout = setTimeout(
        () => this.complete(requestId, false),
        PERMISSION_REQUEST_TIMEOUT_MS
      )
      this.pending.set(requestId, { webContentsId: webContents.id, resolve, timeout })
      webContents.once('destroyed', () => this.complete(requestId, false))
      webContents.send(IPC.events.mediaPermissionRequested, request)
    })
  }

  /** 只接受请求所属 renderer 对当前一次性标识作出的授权决定。 */
  public respond(webContents: WebContents, response: DesktopMediaPermissionResponse): boolean {
    const pending = this.pending.get(response.requestId)
    if (!pending || pending.webContentsId !== webContents.id) return false
    this.complete(response.requestId, response.granted)
    return true
  }

  /** 在应用退出时拒绝所有未完成的权限请求。 */
  public dispose(): void {
    for (const requestId of Array.from(this.pending.keys())) this.complete(requestId, false)
  }

  private complete(requestId: string, granted: boolean): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    clearTimeout(pending.timeout)
    pending.resolve(granted)
  }
}
