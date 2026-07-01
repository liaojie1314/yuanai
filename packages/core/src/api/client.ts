import axios from 'axios'

function getEnv(key: string): string | undefined {
  return typeof process !== 'undefined' ? process.env[key] : undefined
}

export const API_BASE_URL =
  getEnv('NEXT_PUBLIC_API_URL') ?? getEnv('EXPO_PUBLIC_API_URL') ?? 'http://localhost:8000/api/v1'

/**
 * 项目统一 HTTP 客户端（axios 实例）
 *
 * - 请求拦截器：自动注入 Bearer token（需先调用 {@link setTokenGetter} 注册）
 * - 响应拦截器：401 时调用 {@link setOnAuthFailure} 注册的回调（清除 auth 状态并跳转登录）
 */
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

apiClient.interceptors.request.use((config) => {
  const token = tokenGetter?.()
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`
  }
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      authFailureCallback?.()
    }
    return Promise.reject(error)
  }
)

let tokenGetter: (() => string | null) | null = null
let authFailureCallback: (() => void) | null = null

/**
 * 注册 token 读取函数，供请求拦截器自动注入 Authorization 头。
 * @param getter - 返回当前有效 JWT access token 的函数；无 token 时返回 null
 */
export function setTokenGetter(getter: () => string | null): void {
  tokenGetter = getter
}

/**
 * 注册 401 回调，通常用于清除 auth 状态并重定向到登录页。
 * @param fn - 认证失败时调用的函数
 */
export function setOnAuthFailure(fn: () => void): void {
  authFailureCallback = fn
}
