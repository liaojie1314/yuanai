import type { IpcMainInvokeEvent, WebContents } from 'electron'

import { RENDERER_ENTRIES } from '../../shared/window-entry'

/** 已由主进程创建并允许调用 IPC 的 WebContents 注册表。 */
export interface TrustedWebContentsRegistry {
  /** 注册窗口的 WebContents，并在销毁后自动撤销信任。 */
  add(webContents: WebContents): () => void
  /** 判断 WebContents ID 当前是否仍处于受信任注册表内。 */
  has(webContentsId: number): boolean
  /** 对所有仍存活的受信任窗口执行操作。 */
  forEach(callback: (webContents: WebContents) => void): void
}

/** 主进程 IPC 调用的 sender 校验器。 */
export interface IpcInvocationGuard {
  /** 确认调用来自受信任窗口的主 frame 与允许的 renderer URL。 */
  assertTrusted(event: IpcMainInvokeEvent): void
}

/** 创建 IPC sender 校验器时所需的主进程可信配置。 */
export interface IpcInvocationGuardOptions {
  /** 由窗口管理器所有的 WebContents 注册表。 */
  trustedWebContents: TrustedWebContentsRegistry
  /** Electron Vite 开发服务器 URL；打包环境不提供该值。 */
  developmentRendererUrl: string | undefined
}

function parseDevelopmentOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('IPC_DEVELOPMENT_URL_INVALID')
  }
  if (url.username || url.password) throw new Error('IPC_DEVELOPMENT_URL_INVALID')
  return url.origin
}

function isPackagedRendererUrl(url: URL): boolean {
  if (
    url.protocol !== 'yuanai-app:' ||
    url.hostname !== 'renderer' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return false
  }
  return RENDERER_ENTRIES.some((entry) => url.pathname.startsWith(`/${entry}/`))
}

function isAllowedRendererUrl(value: string, developmentOrigin: string | undefined): boolean {
  try {
    const url = new URL(value)
    return url.origin === developmentOrigin || isPackagedRendererUrl(url)
  } catch {
    return false
  }
}

/** 创建主进程拥有的 WebContents 信任注册表。 */
export function createTrustedWebContentsRegistry(): TrustedWebContentsRegistry {
  const trustedContents = new Map<number, WebContents>()

  const remove = (webContents: WebContents): void => {
    if (trustedContents.get(webContents.id) === webContents) {
      trustedContents.delete(webContents.id)
    }
  }

  return {
    add(webContents): () => void {
      if (webContents.isDestroyed()) return () => undefined
      trustedContents.set(webContents.id, webContents)
      const dispose = (): void => remove(webContents)
      webContents.once('destroyed', dispose)
      return dispose
    },
    has(webContentsId): boolean {
      const webContents = trustedContents.get(webContentsId)
      if (!webContents) return false
      if (!webContents.isDestroyed()) return true
      remove(webContents)
      return false
    },
    forEach(callback): void {
      for (const webContents of Array.from(trustedContents.values())) {
        if (webContents.isDestroyed()) {
          remove(webContents)
          continue
        }
        callback(webContents)
      }
    },
  }
}

/** 创建只允许受信任顶层 renderer 调用的 IPC 守卫。 */
export function createIpcInvocationGuard(options: IpcInvocationGuardOptions): IpcInvocationGuard {
  const developmentOrigin = parseDevelopmentOrigin(options.developmentRendererUrl)

  return {
    assertTrusted(event): void {
      if (event.senderFrame !== event.sender.mainFrame) {
        throw new Error('IPC_UNTRUSTED_FRAME')
      }
      if (!options.trustedWebContents.has(event.sender.id)) {
        throw new Error('IPC_UNTRUSTED_SENDER')
      }
      if (!isAllowedRendererUrl(event.senderFrame.url, developmentOrigin)) {
        throw new Error('IPC_UNTRUSTED_ORIGIN')
      }
    },
  }
}
