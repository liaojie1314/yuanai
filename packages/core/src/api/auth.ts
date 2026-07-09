import type { AuthResponse, User, UserStats } from '@yuanai/types'
import { apiClient } from './client.js'

/** 邮箱登录 */
export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await apiClient.post<AuthResponse>('/auth/login', { email, password })
  return res.data
}

/** 注册新账号 */
export async function register(
  email: string,
  password: string,
  username: string,
  verifyCode: string
): Promise<AuthResponse> {
  const res = await apiClient.post<AuthResponse>('/auth/register', {
    email,
    password,
    username,
    verifyCode,
  })
  return res.data
}

/** 邮箱验证码使用场景 */
export type VerifyCodeScene = 'register' | 'reset_password' | 'change_email'

/** 请求向邮箱发送 6 位数字验证码 */
export async function sendVerifyCode(
  email: string,
  scene: VerifyCodeScene = 'register'
): Promise<void> {
  await apiClient.post('/auth/send-verify-code', { email, scene })
}

/** 用邮箱验证码重置密码 */
export async function resetPassword(
  email: string,
  verifyCode: string,
  newPassword: string
): Promise<void> {
  await apiClient.post('/auth/reset-password', { email, verifyCode, newPassword })
}

/** 退出登录 */
export async function logout(): Promise<void> {
  await apiClient.post('/auth/logout')
}

/** 刷新 access_token */
export async function refreshAccessToken(token: string): Promise<{ access_token: string }> {
  const res = await apiClient.post<{ access_token: string }>('/auth/refresh', {
    refresh_token: token,
  })
  return res.data
}

/** 获取当前用户信息 */
export async function getMe(): Promise<User> {
  const res = await apiClient.get<User>('/auth/me')
  return res.data
}

/**
 * 用显式 token 拉取用户信息 —— 供 OAuth 回调页在还没写入 auth store 前，
 * 用刚拿到的 access_token 补齐 user 数据。
 */
export async function getMeWithToken(accessToken: string): Promise<User> {
  const res = await apiClient.get<User>('/auth/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  return res.data
}

/** 更新当前用户资料 */
export async function updateMe(data: {
  username?: string
  avatarUrl?: string
  bio?: string
}): Promise<User> {
  const res = await apiClient.patch<User>('/auth/me', data)
  return res.data
}

/** 用户偏好设置 */
export interface UserPreferences {
  theme: 'auto' | 'light' | 'dark'
  fontSize: 'small' | 'medium' | 'large'
  density: 'compact' | 'standard' | 'loose'
  timeFormat: '24h' | '12h'
  dateFormat: 'ymd' | 'mdy' | 'dmy'
  language: string
}

/** 获取当前用户偏好设置 */
export async function getMyPreferences(): Promise<UserPreferences> {
  const res = await apiClient.get<UserPreferences>('/auth/me/preferences')
  return res.data
}

/** 更新当前用户偏好设置（任意子集） */
export async function updateMyPreferences(
  data: Partial<UserPreferences>
): Promise<UserPreferences> {
  const res = await apiClient.patch<UserPreferences>('/auth/me/preferences', data)
  return res.data
}

/** 修改邮箱（需要新邮箱验证码） */
export async function changeEmail(newEmail: string, verifyCode: string): Promise<User> {
  const res = await apiClient.patch<User>('/auth/me/email', {
    newEmail,
    verifyCode,
  })
  return res.data
}

/** 一次清空当前用户的所有会话 */
export async function clearAllConversations(): Promise<{ deleted: number }> {
  const res = await apiClient.delete<{ deleted: number }>('/chat/conversations')
  return res.data
}

/** 获取当前用户使用统计（后端 pydantic to_camel → 直接返回 camelCase） */
export async function getMyStats(): Promise<UserStats> {
  const res = await apiClient.get<UserStats>('/auth/me/stats')
  return res.data
}

/** 修改密码 */
export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await apiClient.patch('/auth/me/password', {
    old_password: oldPassword,
    new_password: newPassword,
  })
}

/** 注销账号 */
export async function deleteMe(): Promise<void> {
  await apiClient.delete('/auth/me')
}

/** 解绑当前账号的 GitHub 关联；返回更新后的用户信息 */
export async function unlinkGithub(): Promise<User> {
  const res = await apiClient.delete<User>('/auth/me/github')
  return res.data
}

/** 上传头像，返回更新后的用户信息 */
export async function uploadAvatar(file: File): Promise<User> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await apiClient.post<User>('/auth/me/avatar', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}
