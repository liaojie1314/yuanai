import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import type { User } from '@yuanai/types'

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

/**
 * 依据“记住我”标记在 localStorage / sessionStorage 间动态读写的 StateStorage。
 *
 * - 记住我：写 localStorage（关闭浏览器后仍保留），并清掉 sessionStorage 里的旧副本
 * - 不记住：写 sessionStorage（关闭浏览器/标签页即清除），并清掉 localStorage 里的旧副本
 * - 读取时优先 sessionStorage（当前标签页的最新选择），否则回退 localStorage
 */
const dynamicStorage: StateStorage = {
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
      // ignore：隐私模式下 storage 可能不可写
    }
  },
  removeItem: (name) => {
    try {
      getLocalStorage()?.removeItem(name)
      getSessionStorage()?.removeItem(name)
    } catch {
      // ignore
    }
  },
}

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  /** @param remember - 是否“记住我”（默认 true）；决定持久化到 localStorage 还是仅 sessionStorage */
  setAuth: (user: User, accessToken: string, refreshToken: string, remember?: boolean) => void
  /** 仅更新 access token（token 自动刷新场景），沿用当前“记住我”状态写 cookie */
  setAccessToken: (accessToken: string) => void
  clearAuth: () => void
}

/**
 * 认证状态 store（Zustand + persist）
 *
 * - 持久化 `user`、`accessToken`、`refreshToken`；存储位置由 {@link dynamicStorage} 依据
 *   “记住我”标记（`yuanai-remember`）动态决定：记住我存 localStorage，否则存 sessionStorage
 * - 同步写一份 `yuanai-auth` cookie 供中间件做路由保护（SSR/RSC 请求读不到 localStorage）；
 *   记住我时 cookie 有效期 7 天，否则为浏览器会话 cookie（关闭浏览器即失效）
 * - 在 QueryProvider 中调用 `setTokenGetter(() => useAuthStore.getState().accessToken)`
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setAuth: (user, accessToken, refreshToken, remember = true) => {
        try {
          if (remember) {
            getLocalStorage()?.setItem(REMEMBER_KEY, '1')
          } else {
            getLocalStorage()?.removeItem(REMEMBER_KEY)
          }
        } catch {
          // ignore
        }
        set({ user, accessToken, refreshToken })
        writeCookie(accessToken, remember)
      },
      setAccessToken: (accessToken) => {
        set({ accessToken })
        writeCookie(accessToken, isRemembered())
      },
      clearAuth: () => {
        set({ user: null, accessToken: null, refreshToken: null })
        try {
          getLocalStorage()?.removeItem(REMEMBER_KEY)
        } catch {
          // ignore
        }
        const doc = getDocument()
        if (doc) {
          doc.cookie = 'yuanai-auth=; path=/; max-age=0; SameSite=Lax'
        }
      },
    }),
    {
      name: 'yuanai-auth',
      storage: createJSONStorage(() => dynamicStorage),
      partialize: (s) => ({
        user: s.user,
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
      }),
    }
  )
)
