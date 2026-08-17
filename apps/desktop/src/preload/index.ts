import { contextBridge, ipcRenderer } from 'electron'

import type {
  DesktopAppInfo,
  DesktopAppearanceState,
  DesktopArtifactPayload,
  DesktopMediaPermissionRequest,
  DesktopMediaPermissionResponse,
  DesktopRendererPreferences,
  DesktopOAuthProvider,
  DesktopOAuthResult,
  DesktopNotificationPayload,
  DesktopPreferences,
  DesktopSelectedFile,
  DesktopThemeChoice,
  DesktopScreenSource,
  DesktopUpdateStatus,
  ExternalLinkId,
  ShortcutStatus,
} from '../shared/ipc-contract'
import { IPC } from '../shared/ipc-contract'
import type { AppRuntimeConfig } from '../shared/runtime-config'

/** Renderer 可调用的最小安全 Electron API。 */
export interface YuanaiApi {
  /** 当前运行的桌面平台。 */
  platform: NodeJS.Platform
  auth: {
    get: () => Promise<string | null>
    set: (value: string) => Promise<void>
    remove: () => Promise<void>
  }
  prefs: {
    get: () => Promise<DesktopPreferences>
    update: (value: Partial<DesktopPreferences>) => Promise<DesktopPreferences>
  }
  appearance: {
    get: () => Promise<DesktopAppearanceState>
    apply: (choice: DesktopThemeChoice) => Promise<DesktopAppearanceState>
    syncPreferences: (preferences: DesktopRendererPreferences) => Promise<void>
  }
  runtime: {
    getConfig: () => Promise<AppRuntimeConfig>
  }
  dialog: {
    openFiles: () => Promise<DesktopSelectedFile[]>
    listScreenSources: () => Promise<DesktopScreenSource[]>
  }
  clipboard: {
    writeText: (value: string) => Promise<void>
  }
  permissions: {
    respond: (response: DesktopMediaPermissionResponse) => Promise<boolean>
  }
  window: {
    openLogin: () => Promise<void>
    openRegister: () => Promise<void>
    openForgot: () => Promise<void>
    openSettings: () => Promise<void>
    openAbout: () => Promise<void>
    openArtifact: (payload: DesktopArtifactPayload) => Promise<void>
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<boolean>
    close: () => Promise<void>
  }
  system: {
    getInfo: () => Promise<DesktopAppInfo>
    setGlobalShortcut: (accelerator: string | null) => Promise<ShortcutStatus>
    setAutoLaunch: (enabled: boolean) => Promise<DesktopPreferences>
    notify: (payload: Omit<DesktopNotificationPayload, 'playSound'>) => Promise<boolean>
  }
  updater: {
    check: () => Promise<DesktopUpdateStatus>
    download: () => Promise<DesktopUpdateStatus>
    install: () => Promise<DesktopUpdateStatus>
    skip: () => Promise<DesktopUpdateStatus>
  }
  shell: {
    openExternal: (link: ExternalLinkId) => Promise<void>
    /** 使用主进程校验后的 HTTPS 来源在默认浏览器中打开。 */
    openExternalUrl: (url: string) => Promise<void>
  }
  oauth: {
    start: (provider: DesktopOAuthProvider) => Promise<void>
  }
  events: {
    onAuthChanged: (listener: (hasSession: boolean) => void) => () => void
    onOAuthResult: (listener: (result: DesktopOAuthResult) => void) => () => void
    onArtifactInit: (listener: (payload: DesktopArtifactPayload) => void) => () => void
    onAppearanceChanged: (listener: (state: DesktopAppearanceState) => void) => () => void
    onDisplayPreferencesChanged: (
      listener: (preferences: DesktopRendererPreferences) => void
    ) => () => void
    onMediaPermissionRequested: (
      listener: (request: DesktopMediaPermissionRequest) => void
    ) => () => void
    onUpdater: (listener: (status: DesktopUpdateStatus) => void) => () => void
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
  platform: process.platform,
  auth: {
    get: () => ipcRenderer.invoke(IPC.auth.get),
    set: (value) => ipcRenderer.invoke(IPC.auth.set, value),
    remove: () => ipcRenderer.invoke(IPC.auth.remove),
  },
  prefs: {
    get: () => ipcRenderer.invoke(IPC.prefs.get),
    update: (value) => ipcRenderer.invoke(IPC.prefs.update, value),
  },
  appearance: {
    get: () => ipcRenderer.invoke(IPC.appearance.get),
    apply: (choice) => ipcRenderer.invoke(IPC.appearance.apply, choice),
    syncPreferences: (preferences) =>
      ipcRenderer.invoke(IPC.appearance.syncPreferences, preferences),
  },
  runtime: {
    getConfig: () => ipcRenderer.invoke(IPC.runtime.getConfig),
  },
  dialog: {
    openFiles: () => ipcRenderer.invoke(IPC.dialog.openFiles),
    listScreenSources: () => ipcRenderer.invoke(IPC.dialog.listScreenSources),
  },
  clipboard: {
    writeText: (value) => ipcRenderer.invoke(IPC.clipboard.writeText, value),
  },
  permissions: {
    respond: (response) => ipcRenderer.invoke(IPC.permissions.respond, response),
  },
  window: {
    openLogin: () => ipcRenderer.invoke(IPC.window.openLogin),
    openRegister: () => ipcRenderer.invoke(IPC.window.openRegister),
    openForgot: () => ipcRenderer.invoke(IPC.window.openForgot),
    openSettings: () => ipcRenderer.invoke(IPC.window.openSettings),
    openAbout: () => ipcRenderer.invoke(IPC.window.openAbout),
    openArtifact: (payload) => ipcRenderer.invoke(IPC.window.openArtifact, payload),
    minimize: () => ipcRenderer.invoke(IPC.window.minimize),
    toggleMaximize: () => ipcRenderer.invoke(IPC.window.toggleMaximize),
    close: () => ipcRenderer.invoke(IPC.window.close),
  },
  system: {
    getInfo: () => ipcRenderer.invoke(IPC.system.getInfo),
    setGlobalShortcut: (accelerator) =>
      ipcRenderer.invoke(IPC.system.setGlobalShortcut, accelerator),
    setAutoLaunch: (enabled) => ipcRenderer.invoke(IPC.system.setAutoLaunch, enabled),
    notify: (payload) => ipcRenderer.invoke(IPC.system.notify, payload),
  },
  updater: {
    check: () => ipcRenderer.invoke(IPC.updater.check),
    download: () => ipcRenderer.invoke(IPC.updater.download),
    install: () => ipcRenderer.invoke(IPC.updater.install),
    skip: () => ipcRenderer.invoke(IPC.updater.skip),
  },
  shell: {
    openExternal: (link) => ipcRenderer.invoke(IPC.shell.openExternal, link),
    openExternalUrl: (url) => ipcRenderer.invoke(IPC.shell.openExternalUrl, url),
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
    onAppearanceChanged: (listener) => {
      const wrappedListener = (_event: unknown, state: DesktopAppearanceState): void =>
        listener(state)
      ipcRenderer.on(IPC.events.appearanceChanged, wrappedListener)
      return () => ipcRenderer.removeListener(IPC.events.appearanceChanged, wrappedListener)
    },
    onDisplayPreferencesChanged: (listener) => {
      const wrappedListener = (_event: unknown, preferences: DesktopRendererPreferences): void =>
        listener(preferences)
      ipcRenderer.on(IPC.events.displayPreferencesChanged, wrappedListener)
      return () => ipcRenderer.removeListener(IPC.events.displayPreferencesChanged, wrappedListener)
    },
    onMediaPermissionRequested: (listener) => {
      const wrappedListener = (_event: unknown, request: DesktopMediaPermissionRequest): void =>
        listener(request)
      ipcRenderer.on(IPC.events.mediaPermissionRequested, wrappedListener)
      return () => ipcRenderer.removeListener(IPC.events.mediaPermissionRequested, wrappedListener)
    },
    onUpdater: (listener) => {
      const wrappedListener = (_event: unknown, status: DesktopUpdateStatus): void =>
        listener(status)
      ipcRenderer.on(IPC.events.updater, wrappedListener)
      return () => ipcRenderer.removeListener(IPC.events.updater, wrappedListener)
    },
  },
}

contextBridge.exposeInMainWorld('yuanai', api)
