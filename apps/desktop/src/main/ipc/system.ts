import type { IpcMainInvokeEvent } from 'electron'

import type { ExternalLinkId } from '../../shared/ipc-contract'
import { IPC } from '../../shared/ipc-contract'
import { assertNoIpcPayload, readSingleIpcPayload } from '../../shared/guards'
import type { IpcMainRegistrar } from './auth'
import type { IpcInvocationGuard } from './guards'
import type { DesktopSystemService } from '../system/desktop-system'

const EXTERNAL_LINKS: Readonly<Record<ExternalLinkId, string>> = Object.freeze({
  documentation: 'https://github.com/liaojie1314/yuanai#readme',
  repository: 'https://github.com/liaojie1314/yuanai',
  feedback: 'https://github.com/liaojie1314/yuanai/issues',
  privacy: 'https://github.com/liaojie1314/yuanai/blob/dev/PRIVACY.md',
})

/** 受控打开外部 HTTPS 链接的最小能力。 */
export interface ExternalShell {
  /** 由系统默认浏览器打开经过白名单的 URL。 */
  openExternal(url: string): Promise<void>
}

/** 系统 IPC 处理器的显式依赖。 */
export interface SystemIpcOptions {
  /** IPC 处理器注册器。 */
  ipcMain: IpcMainRegistrar
  /** renderer sender 安全边界。 */
  guard: IpcInvocationGuard
  /** 仅含安全系统操作的服务。 */
  systemService: DesktopSystemService
  /** 系统外部浏览器调用能力。 */
  shell: ExternalShell
}

function readBooleanPayload(args: readonly unknown[]): boolean {
  const value = readSingleIpcPayload(args)
  if (typeof value !== 'boolean') throw new Error('IPC_PAYLOAD_INVALID')
  return value
}

function readShortcutPayload(args: readonly unknown[]): string | null {
  const value = readSingleIpcPayload(args)
  if (value === null) return null
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > 128) {
    throw new Error('IPC_PAYLOAD_INVALID')
  }
  return value
}

function readExternalLink(args: readonly unknown[]): ExternalLinkId {
  const value = readSingleIpcPayload(args)
  if (
    value === 'documentation' ||
    value === 'repository' ||
    value === 'feedback' ||
    value === 'privacy'
  ) {
    return value
  }
  throw new Error('IPC_PAYLOAD_INVALID')
}

/** 注册只暴露固定动作的桌面系统 IPC。 */
export function registerSystemIpcHandlers(options: SystemIpcOptions): void {
  options.ipcMain.handle(
    IPC.system.getInfo,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      options.guard.assertTrusted(event)
      assertNoIpcPayload(args)
      return options.systemService.getInfo()
    }
  )
  options.ipcMain.handle(
    IPC.system.setGlobalShortcut,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      options.guard.assertTrusted(event)
      return options.systemService.setGlobalShortcut(readShortcutPayload(args))
    }
  )
  options.ipcMain.handle(
    IPC.system.setAutoLaunch,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      options.guard.assertTrusted(event)
      return options.systemService.setAutoLaunch(readBooleanPayload(args))
    }
  )
  options.ipcMain.handle(
    IPC.shell.openExternal,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      options.guard.assertTrusted(event)
      await options.shell.openExternal(EXTERNAL_LINKS[readExternalLink(args)])
    }
  )
}
