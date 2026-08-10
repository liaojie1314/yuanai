import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { User, UserStats } from '@yuanai/types'
import {
  changeEmail,
  changePassword,
  clearAllConversations,
  deleteMe,
  exchangeDesktopOAuthCode,
  getMe,
  getMyPreferences,
  getMyStats,
  login,
  logout,
  register,
  resetPassword,
  sendVerifyCode,
  unlinkGithub,
  unlinkGoogle,
  updateMe,
  updateMyPreferences,
  uploadAvatar,
  type UserPreferences,
  type VerifyCodeScene,
} from '../api/auth.js'
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
    mutationFn: ({ email, password }: { email: string; password: string; remember?: boolean }) =>
      login(email, password),
    onSuccess: (data, variables) => {
      setAuth(data.user, data.access_token, data.refresh_token, variables.remember)
      void qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
}

/** 注册 mutation（携带邮箱验证码） */
export function useRegister() {
  const { setAuth } = useAuthStore()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      email,
      password,
      username,
      verifyCode,
    }: {
      email: string
      password: string
      username: string
      verifyCode: string
    }) => register(email, password, username, verifyCode),
    onSuccess: (data) => {
      setAuth(data.user, data.access_token, data.refresh_token)
      void qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
}

/** 请求发送邮箱验证码 mutation */
export function useSendVerifyCode() {
  return useMutation({
    mutationFn: ({ email, scene = 'register' }: { email: string; scene?: VerifyCodeScene }) =>
      sendVerifyCode(email, scene),
  })
}

/** 通过邮箱验证码重置密码 mutation */
export function useResetPassword() {
  return useMutation({
    mutationFn: ({
      email,
      verifyCode,
      newPassword,
    }: {
      email: string
      verifyCode: string
      newPassword: string
    }) => resetPassword(email, verifyCode, newPassword),
  })
}

/** 使用桌面 OAuth 一次性授权码写入认证状态。 */
export function useDesktopOAuthExchange() {
  const { setAuth } = useAuthStore()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: exchangeDesktopOAuthCode,
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
    mutationFn: (data: { username?: string; avatarUrl?: string; bio?: string }) => updateMe(data),
    onSuccess: (updatedUser: User) => {
      qc.setQueryData<User>(['me'], updatedUser)
    },
  })
}

/** 获取当前用户偏好设置 */
export function useMyPreferences() {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery<UserPreferences>({
    queryKey: ['me', 'preferences'],
    queryFn: getMyPreferences,
    enabled: !!accessToken,
    staleTime: 5 * 60 * 1000,
  })
}

/** 更新用户偏好设置 mutation（乐观更新） */
export function useUpdateMyPreferences() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<UserPreferences>) => updateMyPreferences(data),
    onSuccess: (prefs) => {
      qc.setQueryData<UserPreferences>(['me', 'preferences'], prefs)
    },
  })
}

/** 修改邮箱 mutation */
export function useChangeEmail() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ newEmail, verifyCode }: { newEmail: string; verifyCode: string }) =>
      changeEmail(newEmail, verifyCode),
    onSuccess: (updatedUser: User) => {
      qc.setQueryData<User>(['me'], updatedUser)
    },
  })
}

/** 一次清空所有会话 mutation。清空后会话数归零，需同步失效 ``['me','stats']``。 */
export function useClearAllConversations() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: clearAllConversations,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversations'] })
      void qc.invalidateQueries({ queryKey: ['me', 'stats'] })
    },
  })
}

/** 获取当前用户使用统计 */
export function useMyStats() {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery<UserStats>({
    queryKey: ['me', 'stats'],
    queryFn: getMyStats,
    enabled: !!accessToken,
    staleTime: 60 * 1000,
  })
}

/** 修改密码 mutation */
export function useChangePassword() {
  return useMutation({
    mutationFn: ({ oldPassword, newPassword }: { oldPassword: string; newPassword: string }) =>
      changePassword(oldPassword, newPassword),
  })
}

/** 注销账号 mutation */
export function useDeleteMe() {
  const { clearAuth } = useAuthStore()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteMe,
    onSuccess: () => {
      clearAuth()
      qc.clear()
    },
  })
}

/** 解绑 GitHub 三方登录 mutation */
export function useUnlinkGithub() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: unlinkGithub,
    onSuccess: (updatedUser: User) => {
      qc.setQueryData<User>(['me'], updatedUser)
    },
  })
}

/** 解绑 Google 三方登录 mutation */
export function useUnlinkGoogle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: unlinkGoogle,
    onSuccess: (updatedUser: User) => {
      qc.setQueryData<User>(['me'], updatedUser)
    },
  })
}

/** 上传头像 mutation */
export function useUploadAvatar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => uploadAvatar(file),
    onSuccess: (updatedUser) => {
      qc.setQueryData<User>(['me'], updatedUser)
    },
  })
}
