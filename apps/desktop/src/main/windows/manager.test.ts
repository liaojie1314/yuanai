import { describe, expect, it, vi } from 'vitest'

import { WindowManager } from './manager'

interface FakeWindow {
  readonly id: number
  readonly webContents: {
    isDestroyed: () => boolean
    once: (event: string, listener: () => void) => void
    send: ReturnType<typeof vi.fn>
  }
  isDestroyed: () => boolean
  loadURL: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  restore: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

function createFakeWindow(id: number): FakeWindow {
  const listeners = new Map<string, () => void>()
  return {
    id,
    webContents: {
      isDestroyed: () => false,
      once: (event, listener) => listeners.set(event, listener),
      send: vi.fn(),
    },
    isDestroyed: () => false,
    loadURL: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    restore: vi.fn(),
    close: vi.fn(),
  }
}

describe('WindowManager', () => {
  it('reuses named windows but creates isolated artifact instances', () => {
    const windows = [createFakeWindow(1), createFakeWindow(2), createFakeWindow(3)]
    const manager = new WindowManager({
      createWindow: vi.fn(() => windows.shift() ?? createFakeWindow(4)),
      rendererUrl: undefined,
    })

    expect(manager.open('settings')).toBe(manager.open('settings'))
    expect(manager.openArtifact()).not.toBe(manager.openArtifact())
  })

  it('queues messages until the target renderer has finished loading', () => {
    const mainWindow = createFakeWindow(1)
    let readyListener: (() => void) | undefined
    mainWindow.webContents.once = (event, listener) => {
      if (event === 'did-finish-load') readyListener = listener
    }
    const manager = new WindowManager({
      createWindow: () => mainWindow,
      rendererUrl: undefined,
    })

    manager.open('main')
    manager.sendWhenReady('main', 'event:deep-link', { type: 'chat' })
    expect(mainWindow.webContents.send).not.toHaveBeenCalled()

    readyListener?.()
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('event:deep-link', { type: 'chat' })
  })

  it('closes only an existing named window', () => {
    const loginWindow = createFakeWindow(1)
    const manager = new WindowManager({
      createWindow: () => loginWindow,
      rendererUrl: undefined,
    })

    manager.close('login')
    expect(loginWindow.close).not.toHaveBeenCalled()

    manager.open('login')
    manager.close('login')
    expect(loginWindow.close).toHaveBeenCalledOnce()
  })
})
