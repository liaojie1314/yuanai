import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { StateStorage } from 'zustand/middleware'
import type { User } from '@yuanai/types'
import { getPlatformAdapter } from '../platform/index.js'

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  /** @param remember - 是否"记住我"（默认 true）；决定持久化到 localStorage 还是仅 sessionStorage */
  setAuth: (user: User, accessToken: string, refreshToken: string, remember?: boolean) => void
  /** 仅更新 access token（token 自动刷新场景），沿用当前"记住我"状态写 cookie */
  setAccessToken: (accessToken: string) => void
  clearAuth: () => void
}

/**
 * 认证状态 store（Zustand + persist）
 *
 * 通过 {@link getPlatformAdapter} 桥接平台差异：
 * - **Web**：`authStorage` 依"记住我"标记动态选择 localStorage / sessionStorage；
 *   `writeAuthCookie` 同步一份 `yuanai-auth` cookie 供 Next.js middleware 做 SSR 路由保护。
 * - **Mobile**：`authStorage` 走 SecureStore，无 cookie 概念（回调为 no-op）。
 *
 * 在 QueryProvider 中调用 `setTokenGetter(() => useAuthStore.getState().accessToken)`。
 */
/**
 * 每次读写都从当前 adapter 取 authStorage 的转发层。
 *
 * createJSONStorage 在【模块加载时】立即执行工厂并把返回值捕获进闭包；
 * store 模块 import 早于 app 入口的 setPlatformAdapter(mobileAdapter)，
 * 直接写 `() => getPlatformAdapter().authStorage` 会把 Web 版 localStorage
 * 实现（RN 上是 no-op）永久钉死 —— 移动端 token 永远落不了盘，
 * 表现为冷启动始终回到登录页。
 */
const lazyAuthStorage: StateStorage = {
  getItem: (name) => getPlatformAdapter().authStorage.getItem(name),
  setItem: (name, value) => getPlatformAdapter().authStorage.setItem(name, value),
  removeItem: (name) => getPlatformAdapter().authStorage.removeItem(name),
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setAuth: (user, accessToken, refreshToken, remember = true) => {
        const adapter = getPlatformAdapter()
        // 先记录"记住我"，再 set()，让 persist 的 storage 依据最新标记落盘
        adapter.setAuthRemembered?.(remember)
        set({ user, accessToken, refreshToken })
        adapter.writeAuthCookie?.(accessToken, remember)
      },
      setAccessToken: (accessToken) => {
        const adapter = getPlatformAdapter()
        set({ accessToken })
        const remembered = adapter.isAuthRemembered?.() ?? true
        adapter.writeAuthCookie?.(accessToken, remembered)
      },
      clearAuth: () => {
        const adapter = getPlatformAdapter()
        set({ user: null, accessToken: null, refreshToken: null })
        adapter.setAuthRemembered?.(false)
        adapter.clearAuthCookie?.()
      },
    }),
    {
      name: 'yuanai-auth',
      storage: createJSONStorage(() => lazyAuthStorage),
      partialize: (s) => ({
        user: s.user,
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
      }),
    }
  )
)
