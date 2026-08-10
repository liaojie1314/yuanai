import { describe, expect, it, vi } from 'vitest'

import type { IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron'

import { DEFAULT_DESKTOP_PREFERENCES, IPC } from '../../shared/ipc-contract'
import type { AppRuntimeConfig } from '../../shared/runtime-config'
import { createIpcInvocationGuard, createTrustedWebContentsRegistry } from './guards'
import { setupIpc } from './index'
import type { DesktopSystemService } from '../system/desktop-system'

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function createWebContents(id: number): WebContents {
  return {
    id,
    isDestroyed: () => false,
    once: vi.fn(),
    send: vi.fn(),
  } as unknown as WebContents
}

function createEvent(sender: WebContents): IpcMainInvokeEvent {
  const mainFrame = { url: 'http://localhost:5173/main/index.html' } as WebFrameMain
  Object.assign(sender, { mainFrame })
  return { sender, senderFrame: mainFrame } as IpcMainInvokeEvent
}

function setupTestIpc(): {
  handlers: Map<string, InvokeHandler>
  sender: WebContents
  authStorage: {
    getItem: ReturnType<typeof vi.fn>
    setItem: ReturnType<typeof vi.fn>
    removeItem: ReturnType<typeof vi.fn>
  }
  preferencesStorage: {
    get: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  onSessionChanged: ReturnType<typeof vi.fn>
  systemService: DesktopSystemService
  shell: { openExternal: ReturnType<typeof vi.fn> }
  windows: {
    openLogin: ReturnType<typeof vi.fn>
    openRegister: ReturnType<typeof vi.fn>
    openForgot: ReturnType<typeof vi.fn>
    openSettings: ReturnType<typeof vi.fn>
    openAbout: ReturnType<typeof vi.fn>
    openOAuth: ReturnType<typeof vi.fn>
    closeOAuth: ReturnType<typeof vi.fn>
  }
} {
  const handlers = new Map<string, InvokeHandler>()
  const sender = createWebContents(1)
  const trustedWebContents = createTrustedWebContentsRegistry()
  trustedWebContents.add(sender)
  const guard = createIpcInvocationGuard({
    trustedWebContents,
    developmentRendererUrl: 'http://localhost:5173/',
  })
  const authStorage = {
    getItem: vi.fn<() => Promise<string | null>>().mockResolvedValue('encrypted-session'),
    setItem: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    removeItem: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }
  const preferencesStorage = {
    get: vi.fn<() => Promise<typeof DEFAULT_DESKTOP_PREFERENCES>>().mockResolvedValue({
      ...DEFAULT_DESKTOP_PREFERENCES,
    }),
    update: vi.fn<() => Promise<typeof DEFAULT_DESKTOP_PREFERENCES>>().mockResolvedValue({
      ...DEFAULT_DESKTOP_PREFERENCES,
      closeToTray: false,
    }),
  }
  const onSessionChanged = vi.fn<(hasSession: boolean) => void>()
  const windows = {
    openLogin: vi.fn(),
    openRegister: vi.fn(),
    openForgot: vi.fn(),
    openSettings: vi.fn(),
    openAbout: vi.fn(),
    openOAuth: vi.fn(),
    closeOAuth: vi.fn(),
  }
  const runtimeConfig: AppRuntimeConfig = Object.freeze({
    apiBaseUrl: 'https://api.example.com/api/v1',
    webBaseUrl: 'https://yuanai.example.com',
    assetOrigins: Object.freeze(['https://cdn.example.com']),
  })
  const systemService = {
    getInfo: vi.fn(),
    setAutoLaunch: vi.fn(),
    setGlobalShortcut: vi.fn(),
  } as unknown as DesktopSystemService

  const shell = { openExternal: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) }

  setupIpc({
    ipcMain: {
      handle(channel: string, handler: InvokeHandler): void {
        handlers.set(channel, handler)
      },
    },
    guard,
    trustedWebContents,
    authStorage,
    onSessionChanged,
    preferencesStorage,
    runtimeConfig,
    shell,
    systemService,
    windows,
  })

  return {
    handlers,
    sender,
    authStorage,
    preferencesStorage,
    onSessionChanged,
    systemService,
    shell,
    windows,
  }
}

function getHandler(handlers: Map<string, InvokeHandler>, channel: string): InvokeHandler {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`Missing handler for ${channel}`)
  return handler
}

describe('secure IPC handlers', () => {
  it('registers fixed auth, preference, runtime, system, and window channels', () => {
    const { handlers } = setupTestIpc()

    expect(Array.from(handlers.keys()).sort()).toEqual(
      [
        IPC.auth.get,
        IPC.auth.remove,
        IPC.auth.set,
        IPC.oauth.start,
        IPC.prefs.get,
        IPC.prefs.update,
        IPC.runtime.getConfig,
        IPC.shell.openExternal,
        IPC.system.getInfo,
        IPC.system.setAutoLaunch,
        IPC.system.setGlobalShortcut,
        IPC.window.openAbout,
        IPC.window.openForgot,
        IPC.window.openLogin,
        IPC.window.openRegister,
        IPC.window.openSettings,
      ].sort()
    )
  })

  it('persists authenticated state and broadcasts only its presence', async () => {
    const { handlers, sender, authStorage, onSessionChanged } = setupTestIpc()
    const event = createEvent(sender)

    await expect(getHandler(handlers, IPC.auth.get)(event)).resolves.toBe('encrypted-session')
    await expect(
      getHandler(handlers, IPC.auth.set)(event, '{"accessToken":"secret"}')
    ).resolves.toBeUndefined()
    await expect(getHandler(handlers, IPC.auth.remove)(event)).resolves.toBeUndefined()

    expect(authStorage.getItem).toHaveBeenCalledWith('yuanai-auth')
    expect(authStorage.setItem).toHaveBeenCalledWith('yuanai-auth', '{"accessToken":"secret"}')
    expect(authStorage.removeItem).toHaveBeenCalledWith('yuanai-auth')
    expect(sender.send).toHaveBeenNthCalledWith(1, IPC.events.authChanged, true)
    expect(sender.send).toHaveBeenNthCalledWith(2, IPC.events.authChanged, false)
    expect(sender.send).not.toHaveBeenCalledWith(
      IPC.events.authChanged,
      expect.stringContaining('secret')
    )
    expect(onSessionChanged).toHaveBeenNthCalledWith(1, true)
    expect(onSessionChanged).toHaveBeenNthCalledWith(2, false)
  })

  it('rejects malformed and oversized auth requests before reaching encrypted storage', async () => {
    const { handlers, sender, authStorage } = setupTestIpc()
    const handler = getHandler(handlers, IPC.auth.set)

    await expect(handler(createEvent(sender), { token: 'secret' })).rejects.toThrow(
      'IPC_PAYLOAD_INVALID'
    )
    await expect(handler(createEvent(sender), 'x'.repeat(1024 * 1024 + 1))).rejects.toThrow(
      'IPC_PAYLOAD_TOO_LARGE'
    )
    expect(authStorage.setItem).not.toHaveBeenCalled()
  })

  it('does not switch windows when encrypted session persistence fails', async () => {
    const { handlers, sender, authStorage, onSessionChanged } = setupTestIpc()
    authStorage.setItem.mockRejectedValueOnce(new Error('SAFE_STORAGE_UNAVAILABLE'))

    await expect(
      getHandler(handlers, IPC.auth.set)(createEvent(sender), '{"accessToken":"secret"}')
    ).rejects.toThrow('SAFE_STORAGE_UNAVAILABLE')

    expect(onSessionChanged).not.toHaveBeenCalled()
    expect(sender.send).not.toHaveBeenCalledWith(IPC.events.authChanged, true)
  })

  it('updates only valid preference patches and broadcasts a sanitized copy', async () => {
    const { handlers, sender, preferencesStorage } = setupTestIpc()
    const result = await getHandler(handlers, IPC.prefs.update)(createEvent(sender), {
      closeToTray: false,
    })

    expect(preferencesStorage.update).toHaveBeenCalledWith({ closeToTray: false })
    expect(result).toEqual({ ...DEFAULT_DESKTOP_PREFERENCES, closeToTray: false })
    expect(sender.send).toHaveBeenCalledWith(IPC.events.prefsChanged, {
      ...DEFAULT_DESKTOP_PREFERENCES,
      closeToTray: false,
    })
    await expect(
      getHandler(handlers, IPC.prefs.update)(createEvent(sender), { unknown: true })
    ).rejects.toThrow('PREFERENCES_INVALID')
    expect(preferencesStorage.update).toHaveBeenCalledTimes(1)
  })

  it('refuses an invalid storage response before it can cross the IPC boundary', async () => {
    const { handlers, sender, preferencesStorage } = setupTestIpc()
    preferencesStorage.get.mockResolvedValue({ unknown: true })

    await expect(getHandler(handlers, IPC.prefs.get)(createEvent(sender))).rejects.toThrow(
      'PREFERENCES_INVALID'
    )
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('returns only the validated runtime configuration and rejects extra getter payloads', async () => {
    const { handlers, sender } = setupTestIpc()

    await expect(getHandler(handlers, IPC.runtime.getConfig)(createEvent(sender))).resolves.toEqual(
      {
        apiBaseUrl: 'https://api.example.com/api/v1',
        webBaseUrl: 'https://yuanai.example.com',
        assetOrigins: ['https://cdn.example.com'],
      }
    )
    await expect(
      getHandler(handlers, IPC.runtime.getConfig)(createEvent(sender), 'unexpected')
    ).rejects.toThrow('IPC_PAYLOAD_INVALID')
  })

  it('opens named windows only for trusted senders with no payload', async () => {
    const { handlers, sender, windows } = setupTestIpc()

    await expect(
      getHandler(handlers, IPC.window.openLogin)(createEvent(sender))
    ).resolves.toBeUndefined()
    await expect(
      getHandler(handlers, IPC.window.openRegister)(createEvent(sender))
    ).resolves.toBeUndefined()
    await expect(
      getHandler(handlers, IPC.window.openForgot)(createEvent(sender))
    ).resolves.toBeUndefined()
    await expect(
      getHandler(handlers, IPC.window.openSettings)(createEvent(sender))
    ).resolves.toBeUndefined()
    await expect(
      getHandler(handlers, IPC.window.openAbout)(createEvent(sender))
    ).resolves.toBeUndefined()
    await expect(
      getHandler(handlers, IPC.window.openRegister)(createEvent(sender), 'unexpected')
    ).rejects.toThrow('IPC_PAYLOAD_INVALID')

    expect(windows.openLogin).toHaveBeenCalledOnce()
    expect(windows.openRegister).toHaveBeenCalledOnce()
    expect(windows.openForgot).toHaveBeenCalledOnce()
    expect(windows.openSettings).toHaveBeenCalledOnce()
    expect(windows.openAbout).toHaveBeenCalledOnce()
  })

  it('opens a loading window and starts desktop OAuth only for supported providers', async () => {
    const { handlers, sender, shell, windows } = setupTestIpc()
    const handler = getHandler(handlers, IPC.oauth.start)

    await expect(handler(createEvent(sender), 'github')).resolves.toBeUndefined()

    expect(windows.openOAuth).toHaveBeenCalledOnce()
    expect(shell.openExternal).toHaveBeenCalledWith(
      'https://api.example.com/api/v1/auth/github?desktop=1'
    )

    await expect(handler(createEvent(sender), 'unknown')).rejects.toThrow('IPC_PAYLOAD_INVALID')
    expect(windows.openOAuth).toHaveBeenCalledOnce()
  })

  it('closes the loading window when the system browser cannot open', async () => {
    const { handlers, sender, shell, windows } = setupTestIpc()
    shell.openExternal.mockRejectedValueOnce(new Error('BROWSER_UNAVAILABLE'))

    await expect(
      getHandler(handlers, IPC.oauth.start)(createEvent(sender), 'google')
    ).rejects.toThrow('BROWSER_UNAVAILABLE')

    expect(windows.openOAuth).toHaveBeenCalledOnce()
    expect(windows.closeOAuth).toHaveBeenCalledOnce()
  })
})
