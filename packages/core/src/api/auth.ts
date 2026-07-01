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
  username: string
): Promise<AuthResponse> {
  const res = await apiClient.post<AuthResponse>('/auth/register', { email, password, username })
  return res.data
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

/** 更新当前用户资料 */
export async function updateMe(data: { username?: string; avatarUrl?: string }): Promise<User> {
  const res = await apiClient.patch<User>('/auth/me', data)
  return res.data
}

/** 获取当前用户使用统计 */
export async function getMyStats(): Promise<UserStats> {
  const res = await apiClient.get<{
    conversation_count: number
    total_tokens: number
    file_count: number
  }>('/auth/me/stats')
  return {
    conversationCount: res.data.conversation_count,
    totalTokens: res.data.total_tokens,
    fileCount: res.data.file_count,
  }
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
