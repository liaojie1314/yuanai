import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@yuanai/types'

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  setAuth: (user: User, accessToken: string, refreshToken: string) => void
  clearAuth: () => void
}

/**
 * 认证状态 store（Zustand + persist）
 *
 * - 持久化 `user`、`accessToken`、`refreshToken` 到 localStorage（key: `yuanai-auth`）
 * - 在 QueryProvider 中调用 `setTokenGetter(() => useAuthStore.getState().accessToken)`
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setAuth: (user, accessToken, refreshToken) => {
        set({ user, accessToken, refreshToken })
        // middleware reads this cookie for route protection (SSR/RSC requests can't see localStorage)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const doc = (globalThis as any).document as { cookie: string } | undefined
        if (doc) {
          doc.cookie = `yuanai-auth=${encodeURIComponent(accessToken)}; path=/; max-age=86400; SameSite=Lax`
        }
      },
      clearAuth: () => {
        set({ user: null, accessToken: null, refreshToken: null })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const doc = (globalThis as any).document as { cookie: string } | undefined
        if (doc) {
          doc.cookie = 'yuanai-auth=; path=/; max-age=0; SameSite=Lax'
        }
      },
    }),
    {
      name: 'yuanai-auth',
      partialize: (s) => ({
        user: s.user,
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
      }),
    }
  )
)
