import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { User } from '@yuanai/types'
import { getMe, login, logout, register, updateMe } from '../api/auth.js'
import { useAuthStore } from '../stores/auth.store.js'

/** 获取当前登录用户信息（需已有 token） */
export function useCurrentUser() {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    enabled: !!accessToken,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

/** 邮箱登录 mutation */
export function useLogin() {
  const { setAuth } = useAuthStore()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      login(email, password),
    onSuccess: (data) => {
      setAuth(data.user, data.access_token, data.refresh_token)
      void qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
}

/** 注册 mutation */
export function useRegister() {
  const { setAuth } = useAuthStore()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      email,
      password,
      username,
    }: {
      email: string
      password: string
      username: string
    }) => register(email, password, username),
    onSuccess: (data) => {
      setAuth(data.user, data.access_token, data.refresh_token)
      void qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
}

/** 退出登录 mutation */
export function useLogout() {
  const { clearAuth } = useAuthStore()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: logout,
    onSettled: () => {
      clearAuth()
      qc.clear()
    },
  })
}

/** 更新用户资料 mutation */
export function useUpdateMe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { username?: string; avatarUrl?: string }) => updateMe(data),
    onSuccess: (updatedUser: User) => {
      qc.setQueryData<User>(['me'], updatedUser)
    },
  })
}
