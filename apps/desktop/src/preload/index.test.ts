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

  it('uses only fixed preload IPC channels', async () => {
    await api.auth.get()
    await api.auth.set('session')
    await api.auth.remove()
    await api.prefs.get()
    await api.prefs.update({ closeToTray: false })
    await api.clipboard.writeText('元AI')
    await api.dialog.openFiles()
    await api.dialog.listScreenSources()
    await api.window.openLogin()
    await api.window.openRegister()
    await api.window.openForgot()
    await api.window.openSettings()
    await api.window.openAbout()
    await api.window.openArtifact({ title: '代码', lang: 'html', code: '<p>元AI</p>', mode: 'run' })
    await api.system.getInfo()
    await api.system.setGlobalShortcut('CommandOrControl+Alt+Y')
    await api.system.setAutoLaunch(true)
    await api.shell.openExternal('repository')
    await api.oauth.start('github')

    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(1, IPC.auth.get)
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(2, IPC.auth.set, 'session')
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(3, IPC.auth.remove)
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(4, IPC.prefs.get)
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(5, IPC.prefs.update, { closeToTray: false })
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(6, IPC.clipboard.writeText, '元AI')
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(7, IPC.dialog.openFiles)
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(8, IPC.dialog.listScreenSources)
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(9, IPC.window.openLogin)
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(10, IPC.window.openRegister)
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(11, IPC.window.openForgot)
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(12, IPC.window.openSettings)
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(13, IPC.window.openAbout)
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(14, IPC.window.openArtifact, {
      title: '代码',
      lang: 'html',
      code: '<p>元AI</p>',
      mode: 'run',
    })
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(15, IPC.system.getInfo)
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(
      16,
      IPC.system.setGlobalShortcut,
      'CommandOrControl+Alt+Y'
    )
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(17, IPC.system.setAutoLaunch, true)
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(18, IPC.shell.openExternal, 'repository')
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(19, IPC.oauth.start, 'github')
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
