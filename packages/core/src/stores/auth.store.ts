import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@yuanai/types'

interface AuthState {
  user: User | null
  accessToken: string | null
  setAuth: (user: User, token: string) => void
  clearAuth: () => void
}

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
