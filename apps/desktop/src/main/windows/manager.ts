import type { RendererEntry } from '../../shared/window-entry'
import { IPC } from '../../shared/ipc-contract'
import type { DesktopArtifactPayload } from '../../shared/ipc-contract'
import type { WindowSpecKey } from './config'

/** 可由窗口管理器控制的最小 BrowserWindow 能力集合。 */
export interface ManagedWindow {
  /** Electron WebContents 对应的稳定窗口标识。 */
  readonly id: number
  /** 当前窗口的 renderer 内容。 */
  readonly webContents: {
    isDestroyed(): boolean
    once(event: 'did-finish-load' | 'destroyed', listener: () => void): void
    send(channel: string, payload: unknown): void
  }
  /** 判断窗口是否已销毁。 */
  isDestroyed(): boolean
  /** 加载 renderer URL。 */
  loadURL(url: string): Promise<void>
  /** 显示窗口。 */
  show(): void
  /** 置顶并聚焦窗口。 */
  focus(): void
  /** 恢复最小化窗口。 */
  restore(): void
  /** 请求关闭窗口。 */
  close(): void
}

/** 可复用的命名窗口键。 */
export type ManagedWindowKey =
  'main' | 'login' | 'register' | 'forgot' | 'settings' | 'about' | 'oauth'

/** WindowManager 创建窗口与定位 renderer 所需的依赖。 */
export interface WindowManagerOptions {
  /** 基于窗口规格创建已经加固的窗口。 */
  createWindow(key: WindowSpecKey): ManagedWindow
  /** Electron Vite 开发服务器地址；打包环境为 undefined。 */
  rendererUrl: string | undefined
}

interface WindowRoute {
  entry: RendererEntry
  hash?: string
}

const WINDOW_ROUTES: Readonly<Record<ManagedWindowKey, WindowRoute>> = {
  main: { entry: 'main' },
  login: { entry: 'login', hash: '/login' },
  register: { entry: 'login', hash: '/register' },
  forgot: { entry: 'login', hash: '/forgot' },
  settings: { entry: 'settings' },
  about: { entry: 'about' },
  oauth: { entry: 'oauth' },
}

function rendererEntryUrl(
  entry: RendererEntry,
  hash: string | undefined,
  rendererUrl: string | undefined
): string {
  const baseUrl = rendererUrl
    ? new URL(`${entry}/index.html`, `${rendererUrl}/`).toString()
    : `yuanai-app://renderer/${entry}/index.html`
  return hash ? `${baseUrl}#${hash}` : baseUrl
}

/** 管理命名窗口、Artifact 多实例和 renderer 就绪前的消息投递。 */
export class WindowManager {
  private readonly namedWindows = new Map<ManagedWindowKey, ManagedWindow>()
  private readonly readyWindowIds = new Set<number>()
  private readonly pendingMessages = new Map<number, Array<{ channel: string; payload: unknown }>>()

  /** 使用已校验的窗口工厂和 renderer 地址创建管理器。 */
  public constructor(private readonly options: WindowManagerOptions) {}

  /** 打开或复用命名窗口。 */
  public open(key: ManagedWindowKey): ManagedWindow {
    const existing = this.namedWindows.get(key)
    if (existing && !existing.isDestroyed()) {
      existing.restore()
      existing.show()
      existing.focus()
      return existing
    }
    const route = WINDOW_ROUTES[key]
    const window = this.create(key, route)
    this.namedWindows.set(key, window)
    return window
  }

  /** 创建彼此隔离的 Artifact 窗口实例。 */
  public openArtifact(payload: DesktopArtifactPayload): ManagedWindow {
    const window = this.create('artifact', { entry: 'artifact' })
    this.sendToWindowWhenReady(window, IPC.events.artifactInit, payload)
    return window
  }

  /** 聚焦主窗口，并在尚未创建时建立它。 */
  public focusMain(): void {
    this.open('main')
  }

  /** 关闭已创建的命名窗口；不存在或已销毁时保持幂等。 */
  public close(key: ManagedWindowKey): void {
    const window = this.namedWindows.get(key)
    if (!window || window.isDestroyed()) return
    window.close()
  }

  /** 在目标 renderer 加载完成后发送内部事件。 */
  public sendWhenReady(key: ManagedWindowKey, channel: string, payload: unknown): void {
    const window = this.open(key)
    this.sendToWindowWhenReady(window, channel, payload)
  }

  private sendToWindowWhenReady(window: ManagedWindow, channel: string, payload: unknown): void {
    if (this.readyWindowIds.has(window.id)) {
      window.webContents.send(channel, payload)
      return
    }
    const pending = this.pendingMessages.get(window.id) ?? []
    pending.push({ channel, payload })
    this.pendingMessages.set(window.id, pending)
  }

  private create(key: WindowSpecKey, route: WindowRoute): ManagedWindow {
    const window = this.options.createWindow(key)
    window.webContents.once('did-finish-load', () => this.flushPendingMessages(window))
    window.webContents.once('destroyed', () => this.clearWindow(window))
    void window.loadURL(rendererEntryUrl(route.entry, route.hash, this.options.rendererUrl))
    return window
  }

  private flushPendingMessages(window: ManagedWindow): void {
    this.readyWindowIds.add(window.id)
    const pending = this.pendingMessages.get(window.id) ?? []
    this.pendingMessages.delete(window.id)
    for (const message of pending) {
      if (!window.webContents.isDestroyed())
        window.webContents.send(message.channel, message.payload)
    }
  }

  private clearWindow(window: ManagedWindow): void {
    this.readyWindowIds.delete(window.id)
    this.pendingMessages.delete(window.id)
    for (const [key, currentWindow] of Array.from(this.namedWindows.entries())) {
      if (currentWindow === window) this.namedWindows.delete(key)
    }
  }
}
