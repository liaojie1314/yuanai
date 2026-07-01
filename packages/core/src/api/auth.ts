import type { AuthResponse, User } from '@yuanai/types'
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
