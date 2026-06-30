import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@yuanai/types'

/** 认证 store 的状态与 action 定义 */
interface AuthState {
  /** 当前登录用户；未登录时为 null */
  user: User | null
  /** JWT 访问令牌；未登录时为 null */
  accessToken: string | null
  /**
   * 登录/注册成功后写入用户信息和 token
   * @param user - 服务端返回的用户对象
   * @param token - JWT access_token
   */
  setAuth: (user: User, token: string) => void
  /** 退出登录：清空 user 和 accessToken */
  clearAuth: () => void
}

/**
 * 认证状态 store（Zustand + persist）
 *
 * - 持久化策略：仅 `user` 和 `accessToken` 写入 localStorage（key: `yuanai-auth`）
 * - 后端接入时，在 apiClient 请求拦截器中读取：
 *   ```ts
 *   setTokenGetter(() => useAuthStore.getState().accessToken)
 *   ```
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      setAuth: (user, accessToken) => set({ user, accessToken }),
      clearAuth: () => set({ user: null, accessToken: null }),
    }),
    {
      name: 'yuanai-auth',
      partialize: (s) => ({ user: s.user, accessToken: s.accessToken }),
    }
  )
)
