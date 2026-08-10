import { describe, expect, it, vi } from 'vitest'

import type { IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron'

import { DEFAULT_DESKTOP_PREFERENCES, IPC } from '../../shared/ipc-contract'
import type { AppRuntimeConfig } from '../../shared/runtime-config'
import { createIpcInvocationGuard, createTrustedWebContentsRegistry } from './guards'
import { setupIpc } from './index'

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
  const runtimeConfig: AppRuntimeConfig = Object.freeze({
    apiBaseUrl: 'https://api.example.com/api/v1',
    webBaseUrl: 'https://yuanai.example.com',
    assetOrigins: Object.freeze(['https://cdn.example.com']),
  })

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
  })

  return { handlers, sender, authStorage, preferencesStorage, onSessionChanged }
}

function getHandler(handlers: Map<string, InvokeHandler>, channel: string): InvokeHandler {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`Missing handler for ${channel}`)
  return handler
}

describe('secure IPC handlers', () => {
  it('registers fixed auth, preference, and runtime channels', () => {
    const { handlers } = setupTestIpc()

    expect(Array.from(handlers.keys()).sort()).toEqual(
      [
        IPC.auth.get,
        IPC.auth.remove,
        IPC.auth.set,
        IPC.prefs.get,
        IPC.prefs.update,
        IPC.runtime.getConfig,
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
})
