import { webAdapter } from '@yuanai/core/platform'
import type { PlatformAdapter } from '@yuanai/core/platform'
import type { StateStorage } from 'zustand/middleware'

import type { YuanaiApi } from '../../preload'

/** 基于 preload 固定通道的加密认证状态存储。 */
export function createDesktopAuthStorage(api: YuanaiApi): StateStorage {
  return {
    getItem: () => api.auth.get(),
    setItem: async (_key, value) => api.auth.set(value),
    removeItem: async () => api.auth.remove(),
  }
}

/** 创建复用 Web SSE 传输、但将认证状态交给 Electron safeStorage 的平台适配器。 */
export function createDesktopAdapter(api: YuanaiApi): PlatformAdapter {
  const authStorage = createDesktopAuthStorage(api)
  return {
    stream: webAdapter.stream,
    storage: webAdapter.storage,
    secureStorage: authStorage,
    authStorage,
    setAuthRemembered: () => undefined,
    isAuthRemembered: () => true,
    writeAuthCookie: () => undefined,
    clearAuthCookie: () => undefined,
  }
}
