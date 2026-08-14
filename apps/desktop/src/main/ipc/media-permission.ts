import type { IpcMainInvokeEvent } from 'electron'

import type { DesktopMediaPermissionResponse } from '../../shared/ipc-contract'
import { IPC } from '../../shared/ipc-contract'
import { readSingleIpcPayload } from '../../shared/guards'
import type { IpcMainRegistrar } from './auth'
import type { IpcInvocationGuard } from './guards'
import type { InAppMediaPermissionPrompt } from '../security/in-app-permission-prompt'

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isMediaPermissionResponse(value: unknown): value is DesktopMediaPermissionResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const response = value as Record<string, unknown>
  return (
    Object.keys(response).length === 2 &&
    typeof response['requestId'] === 'string' &&
    REQUEST_ID_PATTERN.test(response['requestId']) &&
    typeof response['granted'] === 'boolean'
  )
}

/** 媒体权限结果 IPC 注册所需的受限依赖。 */
export interface MediaPermissionIpcOptions {
  /** 固定通道注册器。 */
  ipcMain: IpcMainRegistrar
  /** renderer sender 安全边界。 */
  guard: IpcInvocationGuard
  /** 管理单次应用内媒体授权请求。 */
  mediaPermissionPrompt: InAppMediaPermissionPrompt
}

/** 注册只允许原始请求 renderer 回传的媒体授权结果通道。 */
export function registerMediaPermissionIpcHandlers(options: MediaPermissionIpcOptions): void {
  options.ipcMain.handle(
    IPC.permissions.respond,
    (event: IpcMainInvokeEvent, ...args: unknown[]): boolean => {
      options.guard.assertTrusted(event)
      const payload = readSingleIpcPayload(args)
      if (!isMediaPermissionResponse(payload)) throw new Error('IPC_PAYLOAD_INVALID')
      return options.mediaPermissionPrompt.respond(event.sender, payload)
    }
  )
}
