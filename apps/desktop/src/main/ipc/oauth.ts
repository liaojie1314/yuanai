import type { IpcMainInvokeEvent } from 'electron'

import type { DesktopOAuthProvider } from '../../shared/ipc-contract'
import { IPC } from '../../shared/ipc-contract'
import type { AppRuntimeConfig } from '../../shared/runtime-config'
import { readBoundedIpcString } from '../../shared/guards'
import type { IpcMainRegistrar } from './auth'
import type { IpcInvocationGuard } from './guards'
import type { ExternalShell } from './system'

/** 启动桌面 OAuth 登录所需的主进程能力。 */
export interface OAuthIpcOptions {
  /** Electron IPC 注册器。 */
  ipcMain: IpcMainRegistrar
  /** renderer sender 安全边界。 */
  guard: IpcInvocationGuard
  /** 已在主进程校验的 API 地址。 */
  runtimeConfig: AppRuntimeConfig
  /** 系统默认浏览器调用能力。 */
  shell: ExternalShell
  /** OAuth 加载窗口控制器。 */
  windows: {
    openOAuth(): void
    closeOAuth(): void
  }
}

function readOAuthProvider(args: readonly unknown[]): DesktopOAuthProvider {
  const provider = readBoundedIpcString(args)
  if (provider === 'github' || provider === 'google') return provider
  throw new Error('IPC_PAYLOAD_INVALID')
}

function buildDesktopOAuthUrl(apiBaseUrl: string, provider: DesktopOAuthProvider): string {
  const url = new URL(`auth/${provider}`, `${apiBaseUrl}/`)
  url.searchParams.set('desktop', '1')
  return url.toString()
}

/** 注册受控 OAuth 启动 IPC，禁止 renderer 自由打开外部 URL。 */
export function registerOAuthIpcHandlers(options: OAuthIpcOptions): void {
  options.ipcMain.handle(
    IPC.oauth.start,
    async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<void> => {
      options.guard.assertTrusted(event)
      const provider = readOAuthProvider(args)
      options.windows.openOAuth()
      try {
        await options.shell.openExternal(
          buildDesktopOAuthUrl(options.runtimeConfig.apiBaseUrl, provider)
        )
      } catch (error: unknown) {
        options.windows.closeOAuth()
        throw error
      }
    }
  )
}
