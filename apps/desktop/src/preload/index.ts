import { contextBridge, ipcRenderer } from 'electron'

import type { DesktopPreferences } from '../shared/ipc-contract'
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
  events: {
    onAuthChanged: (listener: (hasSession: boolean) => void) => () => void
  }
}

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
  events: {
    onAuthChanged: (listener) => {
      const wrappedListener = (_event: unknown, hasSession: boolean): void => listener(hasSession)
      ipcRenderer.on(IPC.events.authChanged, wrappedListener)
      return () => ipcRenderer.removeListener(IPC.events.authChanged, wrappedListener)
    },
  },
}

contextBridge.exposeInMainWorld('yuanai', api)
