import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_DESKTOP_PREFERENCES } from '../../shared/ipc-contract'
import { DesktopSystemService } from './desktop-system'

const system = vi.hoisted(() => ({
  app: {
    getVersion: vi.fn(() => '0.0.1'),
    setLoginItemSettings: vi.fn(),
  },
  globalShortcut: {
    register: vi.fn(),
    unregister: vi.fn(),
    unregisterAll: vi.fn(),
  },
  preferencesStorage: {
    get: vi.fn(),
    update: vi.fn(),
  },
  actionRegistry: { 'toggle-main-window': vi.fn() },
  notifications: {
    isSupported: vi.fn(() => true),
    show: vi.fn(),
  },
}))

function createService(): DesktopSystemService {
  return new DesktopSystemService({
    app: system.app,
    actionRegistry: system.actionRegistry,
    globalShortcut: system.globalShortcut,
    notifications: system.notifications,
    platform: 'linux',
    preferencesStorage: system.preferencesStorage,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  system.globalShortcut.register.mockReturnValue(true)
  system.preferencesStorage.get.mockResolvedValue({ ...DEFAULT_DESKTOP_PREFERENCES })
  system.preferencesStorage.update.mockImplementation(async (patch) => ({
    ...DEFAULT_DESKTOP_PREFERENCES,
    ...patch,
  }))
})

describe('DesktopSystemService', () => {
  it('restores the persisted login item and global shortcut', async () => {
    await createService().restore()

    expect(system.app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false })
    expect(system.globalShortcut.register).toHaveBeenCalledWith(
      'CommandOrControl+Alt+Y',
      expect.any(Function)
    )
  })

  it('keeps the previous shortcut when the requested binding conflicts', async () => {
    const service = createService()
    await service.restore()
    system.globalShortcut.register.mockReturnValueOnce(false)

    await expect(service.setGlobalShortcut('CommandOrControl+Shift+Y')).resolves.toEqual({
      accelerator: 'CommandOrControl+Alt+Y',
      errorCode: 'CONFLICT',
      registered: true,
    })
    expect(system.preferencesStorage.update).not.toHaveBeenCalled()
  })

  it('persists a successfully replaced shortcut and releases it on disposal', async () => {
    const service = createService()
    await service.restore()

    await expect(service.setGlobalShortcut('CommandOrControl+Shift+Y')).resolves.toEqual({
      accelerator: 'CommandOrControl+Shift+Y',
      registered: true,
    })
    expect(system.globalShortcut.unregister).toHaveBeenCalledWith('CommandOrControl+Alt+Y')
    expect(system.preferencesStorage.update).toHaveBeenCalledWith({
      globalShortcut: 'CommandOrControl+Shift+Y',
    })

    service.dispose()
    expect(system.globalShortcut.unregisterAll).toHaveBeenCalledOnce()
  })

  it('runs the registered show-or-hide action when the global shortcut fires', async () => {
    const service = createService()
    await service.restore()
    const registeredCallback = system.globalShortcut.register.mock.calls[0]?.[1]

    registeredCallback?.()

    expect(system.actionRegistry['toggle-main-window']).toHaveBeenCalledOnce()
  })

  it('only sends reply notifications when the persisted notification preferences allow it', async () => {
    const service = createService()
    const payload = { title: '元AI', body: '回复已完成' }

    await expect(service.notifyAiReply(payload)).resolves.toBe(true)
    expect(system.notifications.show).toHaveBeenCalledWith({ ...payload, playSound: true })

    system.preferencesStorage.get.mockResolvedValueOnce({
      ...DEFAULT_DESKTOP_PREFERENCES,
      aiReplyNotifications: false,
    })
    await expect(service.notifyAiReply(payload)).resolves.toBe(false)
    expect(system.notifications.show).toHaveBeenCalledOnce()
  })
})
