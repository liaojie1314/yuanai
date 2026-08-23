import type { StateStorage } from 'zustand/middleware'
import type { PlatformAdapter, StreamHandle, StreamHandlers, StreamRequest } from './types.js'

const REMEMBER_KEY = 'yuanai-remember'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any

function getDocument(): { cookie: string } | undefined {
  return g.document as { cookie: string } | undefined
}
function getLocalStorage(): Storage | undefined {
  return g.localStorage as Storage | undefined
}
function getSessionStorage(): Storage | undefined {
  return g.sessionStorage as Storage | undefined
}

function isRemembered(): boolean {
  try {
    return getLocalStorage()?.getItem(REMEMBER_KEY) === '1'
  } catch {
    return false
  }
}

function writeCookie(accessToken: string, remembered: boolean): void {
  const doc = getDocument()
  if (!doc) return
  doc.cookie = remembered
    ? `yuanai-auth=${encodeURIComponent(accessToken)}; path=/; max-age=604800; SameSite=Lax`
    : `yuanai-auth=${encodeURIComponent(accessToken)}; path=/; SameSite=Lax`
}

/** 普通 localStorage 直存 —— 供偏好/缓存等非敏感数据使用 */
const localStorageBacked: StateStorage = {
  getItem: (name) => {
    try {
      return getLocalStorage()?.getItem(name) ?? null
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      getLocalStorage()?.setItem(name, value)
    } catch {
      /* 隐私模式忽略 */
    }
  },
  removeItem: (name) => {
    try {
      getLocalStorage()?.removeItem(name)
    } catch {
      /* 隐私模式忽略 */
    }
  },
}

/**
 * 依据「记住我」标记在 localStorage / sessionStorage 间动态读写的 StateStorage。
 *
 * - 记住我：写 localStorage（关闭浏览器后仍保留），并清掉 sessionStorage 里的旧副本
 * - 不记住：写 sessionStorage（关闭浏览器/标签页即清除），并清掉 localStorage 里的旧副本
 * - 读取时优先 sessionStorage（当前标签页的最新选择），否则回退 localStorage
 */
const dynamicAuthStorage: StateStorage = {
  getItem: (name) => {
    try {
      return getSessionStorage()?.getItem(name) ?? getLocalStorage()?.getItem(name) ?? null
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      if (isRemembered()) {
        getLocalStorage()?.setItem(name, value)
        getSessionStorage()?.removeItem(name)
      } else {
        getSessionStorage()?.setItem(name, value)
        getLocalStorage()?.removeItem(name)
      }
    } catch {
      /* 隐私模式忽略 */
    }
  },
  removeItem: (name) => {
    try {
      getLocalStorage()?.removeItem(name)
      getSessionStorage()?.removeItem(name)
    } catch {
      /* 隐私模式忽略 */
    }
  },
}

/**
 * Web 侧 SSE 传输：用 `fetch` + `ReadableStream` 逐字节解码，
 * 自行按行拆分并组装 event/data 对后回调给上层。
 */
function webStream(req: StreamRequest, handlers: StreamHandlers): StreamHandle {
  const controller = new AbortController()
  let opened = false

  void (async () => {
    try {
      const response = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        ...(req.body !== undefined ? { body: req.body } : {}),
        signal: controller.signal,
      })
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${String(response.status)}`)
      }
      opened = true
      handlers.onOpen?.()

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = ''
      let currentId: string | undefined

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('id: ')) {
            currentId = line.slice(4).trim()
          } else if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ') && currentEvent) {
            handlers.onMessage({
              event: currentEvent,
              data: line.slice(6),
              ...(currentId === undefined ? {} : { id: currentId }),
            })
            currentEvent = ''
            currentId = undefined
          } else if (line === '' && currentEvent) {
            // 有 event 但空 data 行，视为结束该事件，避免残留
            currentEvent = ''
            currentId = undefined
          }
        }
      }
      handlers.onClose?.()
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // 主动 close 不视作错误
        if (opened) handlers.onClose?.()
        return
      }
      handlers.onError(err instanceof Error ? err : new Error(String(err)))
    }
  })()

  return { close: () => controller.abort() }
}

/** Web 平台适配器：默认注册在 `@yuanai/core`，Web 端无需显式调用 `setPlatformAdapter` */
export const webAdapter: PlatformAdapter = {
  stream: webStream,
  storage: localStorageBacked,
  secureStorage: localStorageBacked,
  authStorage: dynamicAuthStorage,
  setAuthRemembered: (remembered) => {
    try {
      if (remembered) {
        getLocalStorage()?.setItem(REMEMBER_KEY, '1')
      } else {
        getLocalStorage()?.removeItem(REMEMBER_KEY)
      }
    } catch {
      /* 隐私模式忽略 */
    }
  },
  isAuthRemembered: isRemembered,
  writeAuthCookie: writeCookie,
  clearAuthCookie: () => {
    const doc = getDocument()
    if (!doc) return
    doc.cookie = 'yuanai-auth=; path=/; max-age=0; SameSite=Lax'
  },
}
