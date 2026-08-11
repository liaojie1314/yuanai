import { describe, expect, it, vi } from 'vitest'

import { WindowManager } from './manager'

const ARTIFACT_PAYLOAD = {
  title: '示例代码',
  lang: 'html',
  code: '<h1>元AI</h1>',
  mode: 'run' as const,
}

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
  it('reuses named windows and keeps source and preview in one Artifact window', () => {
    const windows = [createFakeWindow(1), createFakeWindow(2)]
    const manager = new WindowManager({
      createWindow: vi.fn(() => windows.shift() ?? createFakeWindow(4)),
      rendererUrl: undefined,
    })

    expect(manager.open('settings')).toBe(manager.open('settings'))
    expect(manager.openArtifact(ARTIFACT_PAYLOAD)).toBe(manager.openArtifact(ARTIFACT_PAYLOAD))
  })

  it('loads login and registration in isolated windows with their own routes', () => {
    const loginWindow = createFakeWindow(1)
    const registerWindow = createFakeWindow(2)
    const windows = [loginWindow, registerWindow]
    const createWindow = vi.fn(() => {
      const window = windows.shift()
      if (!window) throw new Error('Unexpected named window request')
      return window
    })
    const manager = new WindowManager({
      createWindow,
      rendererUrl: undefined,
    })

    expect(manager.open('login')).not.toBe(manager.open('register'))
    expect(createWindow).toHaveBeenNthCalledWith(1, 'login')
    expect(createWindow).toHaveBeenNthCalledWith(2, 'register')
    expect(loginWindow.loadURL).toHaveBeenCalledWith(
      'yuanai-app://renderer/login/index.html#/login'
    )
    expect(registerWindow.loadURL).toHaveBeenCalledWith(
      'yuanai-app://renderer/login/index.html#/register'
    )
  })

  it('loads renderer entries from a development server without a duplicate path separator', () => {
    const mainWindow = createFakeWindow(1)
    const manager = new WindowManager({
      createWindow: () => mainWindow,
      rendererUrl: 'http://127.0.0.1:5175/',
    })

    manager.open('main')

    expect(mainWindow.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5175/main/index.html')
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

  it('delivers the latest Artifact modes through one window after it has loaded', () => {
    const artifactWindow = createFakeWindow(1)
    let readyListener: (() => void) | undefined
    artifactWindow.webContents.once = (event, listener) => {
      if (event === 'did-finish-load') readyListener = listener
    }
    const manager = new WindowManager({
      createWindow: () => artifactWindow,
      rendererUrl: undefined,
    })

    const viewPayload = { ...ARTIFACT_PAYLOAD, mode: 'view' as const }
    manager.openArtifact(ARTIFACT_PAYLOAD)
    manager.openArtifact(viewPayload)
    expect(artifactWindow.webContents.send).not.toHaveBeenCalled()

    readyListener?.()
    expect(artifactWindow.webContents.send).toHaveBeenNthCalledWith(
      1,
      'event:artifact-init',
      ARTIFACT_PAYLOAD
    )
    expect(artifactWindow.webContents.send).toHaveBeenNthCalledWith(
      2,
      'event:artifact-init',
      viewPayload
    )
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
