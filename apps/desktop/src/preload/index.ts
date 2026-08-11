import { contextBridge, ipcRenderer } from 'electron'

import type {
  DesktopAppInfo,
  DesktopArtifactPayload,
  DesktopOAuthProvider,
  DesktopOAuthResult,
  DesktopPreferences,
  DesktopSelectedFile,
  DesktopScreenSource,
  ExternalLinkId,
  ShortcutStatus,
} from '../shared/ipc-contract'
import { IPC } from '../shared/ipc-contract'
import type { AppRuntimeConfig } from '../shared/runtime-config'

/** Renderer 可调用的最小安全 Electron API。 */
export interface YuanaiApi {
  auth: {
    get: () => Promise<string | null>
    set: (value: string) => Promise<void>
    remove: () => Promise<void>
  }
  prefs: {
    get: () => Promise<DesktopPreferences>
    update: (value: Partial<DesktopPreferences>) => Promise<DesktopPreferences>
  }
  runtime: {
    getConfig: () => Promise<AppRuntimeConfig>
  }
  dialog: {
    openFiles: () => Promise<DesktopSelectedFile[]>
    listScreenSources: () => Promise<DesktopScreenSource[]>
  }
  window: {
    openLogin: () => Promise<void>
    openRegister: () => Promise<void>
    openForgot: () => Promise<void>
    openSettings: () => Promise<void>
    openAbout: () => Promise<void>
    openArtifact: (payload: DesktopArtifactPayload) => Promise<void>
  }
  system: {
    getInfo: () => Promise<DesktopAppInfo>
    setGlobalShortcut: (accelerator: string | null) => Promise<ShortcutStatus>
    setAutoLaunch: (enabled: boolean) => Promise<DesktopPreferences>
  }
  shell: {
    openExternal: (link: ExternalLinkId) => Promise<void>
  }
  oauth: {
    start: (provider: DesktopOAuthProvider) => Promise<void>
  }
  events: {
    onAuthChanged: (listener: (hasSession: boolean) => void) => () => void
    onOAuthResult: (listener: (result: DesktopOAuthResult) => void) => () => void
    onArtifactInit: (listener: (payload: DesktopArtifactPayload) => void) => () => void
  }
}

const oauthResultListeners = new Set<(result: DesktopOAuthResult) => void>()
let pendingOAuthResult: DesktopOAuthResult | null = null
const artifactListeners = new Set<(payload: DesktopArtifactPayload) => void>()
let pendingArtifact: DesktopArtifactPayload | null = null

ipcRenderer.on(IPC.events.oauthResult, (_event: unknown, result: DesktopOAuthResult) => {
  if (oauthResultListeners.size === 0) {
    pendingOAuthResult = result
    return
  }
  oauthResultListeners.forEach((listener) => listener(result))
})

ipcRenderer.on(IPC.events.artifactInit, (_event: unknown, payload: DesktopArtifactPayload) => {
  if (artifactListeners.size === 0) {
    pendingArtifact = payload
    return
  }
  artifactListeners.forEach((listener) => listener(payload))
})

/** 通过 contextBridge 暴露给 renderer 的受限 API 实现。 */
export const api: YuanaiApi = {
  auth: {
    get: () => ipcRenderer.invoke(IPC.auth.get),
    set: (value) => ipcRenderer.invoke(IPC.auth.set, value),
    remove: () => ipcRenderer.invoke(IPC.auth.remove),
  },
  prefs: {
    get: () => ipcRenderer.invoke(IPC.prefs.get),
    update: (value) => ipcRenderer.invoke(IPC.prefs.update, value),
  },
  runtime: {
    getConfig: () => ipcRenderer.invoke(IPC.runtime.getConfig),
  },
  dialog: {
    openFiles: () => ipcRenderer.invoke(IPC.dialog.openFiles),
    listScreenSources: () => ipcRenderer.invoke(IPC.dialog.listScreenSources),
  },
  window: {
    openLogin: () => ipcRenderer.invoke(IPC.window.openLogin),
    openRegister: () => ipcRenderer.invoke(IPC.window.openRegister),
    openForgot: () => ipcRenderer.invoke(IPC.window.openForgot),
    openSettings: () => ipcRenderer.invoke(IPC.window.openSettings),
    openAbout: () => ipcRenderer.invoke(IPC.window.openAbout),
    openArtifact: (payload) => ipcRenderer.invoke(IPC.window.openArtifact, payload),
  },
  system: {
    getInfo: () => ipcRenderer.invoke(IPC.system.getInfo),
    setGlobalShortcut: (accelerator) =>
      ipcRenderer.invoke(IPC.system.setGlobalShortcut, accelerator),
    setAutoLaunch: (enabled) => ipcRenderer.invoke(IPC.system.setAutoLaunch, enabled),
  },
  shell: {
    openExternal: (link) => ipcRenderer.invoke(IPC.shell.openExternal, link),
  },
  oauth: {
    start: (provider) => ipcRenderer.invoke(IPC.oauth.start, provider),
  },
  events: {
    onAuthChanged: (listener) => {
      const wrappedListener = (_event: unknown, hasSession: boolean): void => listener(hasSession)
      ipcRenderer.on(IPC.events.authChanged, wrappedListener)
      return () => ipcRenderer.removeListener(IPC.events.authChanged, wrappedListener)
    },
    onOAuthResult: (listener) => {
      oauthResultListeners.add(listener)
      if (pendingOAuthResult) {
        const result = pendingOAuthResult
        pendingOAuthResult = null
        queueMicrotask(() => listener(result))
      }
      return () => oauthResultListeners.delete(listener)
    },
    onArtifactInit: (listener) => {
      artifactListeners.add(listener)
      if (pendingArtifact) {
        const payload = pendingArtifact
        pendingArtifact = null
        queueMicrotask(() => listener(payload))
      }
      return () => artifactListeners.delete(listener)
    },
  },
}

contextBridge.exposeInMainWorld('yuanai', api)
