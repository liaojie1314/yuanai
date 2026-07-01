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
      setAuth: (user, accessToken, refreshToken) => set({ user, accessToken, refreshToken }),
      clearAuth: () => set({ user: null, accessToken: null, refreshToken: null }),
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
