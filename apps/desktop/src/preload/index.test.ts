import { afterEach, describe, expect, it, vi } from 'vitest'

const { contextBridge, ipcRenderer } = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: {
    invoke: vi.fn<() => Promise<unknown>>(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}))

vi.mock('electron', () => ({ contextBridge, ipcRenderer }))

import { IPC } from '../shared/ipc-contract'
import { api } from './index'

afterEach(() => {
  vi.clearAllMocks()
})

describe('preload API', () => {
  it('exposes only the typed yuanai API', () => {
    expect(contextBridge.exposeInMainWorld).toHaveBeenCalledWith('yuanai', api)
    expect(api).not.toHaveProperty('ipcRenderer')
    expect(api).not.toHaveProperty('send')
    expect(api).not.toHaveProperty('process')
  })

  it('uses the fixed runtime config channel', async () => {
    await api.runtime.getConfig()

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IPC.runtime.getConfig)
  })

  it('uses only the fixed auth and preference channels', async () => {
    await api.auth.get()
    await api.auth.set('session')
    await api.auth.remove()
    await api.prefs.get()
    await api.prefs.update({ closeToTray: false })

    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(1, IPC.auth.get)
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(2, IPC.auth.set, 'session')
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(3, IPC.auth.remove)
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(4, IPC.prefs.get)
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(5, IPC.prefs.update, { closeToTray: false })
  })

  it('removes the exact wrapped listener on unsubscribe', () => {
    const listener = vi.fn()
    const off = api.events.onAuthChanged(listener)

    off()

    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      IPC.events.authChanged,
      expect.any(Function)
    )
  })
})
