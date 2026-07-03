import axios, { type InternalAxiosRequestConfig } from 'axios'

function getEnv(key: string): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proc = (globalThis as any).process as
    | { env?: Record<string, string | undefined> }
    | undefined
  return proc?.env?.[key]
}

export const API_BASE_URL =
  getEnv('NEXT_PUBLIC_API_URL') ?? getEnv('EXPO_PUBLIC_API_URL') ?? 'http://localhost:8000/api/v1'

/** 401 时不应触发刷新流程的接口：登录/注册失败是正常凭据错误，刷新接口自身失败需直接判定为鉴权失败 */
const AUTH_EXEMPT_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/send-verify-code',
  '/auth/reset-password',
]

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean
}

function isAuthExempt(url: string | undefined): boolean {
  if (!url) return false
  return AUTH_EXEMPT_PATHS.some((p) => url.includes(p))
}

/**
 * 项目统一 HTTP 客户端（axios 实例）
 *
 * - 请求拦截器：自动注入 Bearer token（需先调用 {@link setTokenGetter} 注册）
 * - 响应拦截器：401 时尝试用 refresh token 换取新 access token 并重试原请求一次；
 *   并发的多个 401 共用同一次刷新请求（见 {@link getRefreshedAccessToken}）。
 *   刷新失败、无 refresh token、或重试后仍 401 时，调用 {@link setOnAuthFailure} 注册的回调。
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
  async (error: unknown) => {
    if (!axios.isAxiosError(error) || error.response?.status !== 401) {
      return Promise.reject(error)
    }

    const config = error.config as RetriableConfig | undefined
    if (!config || isAuthExempt(config.url)) {
      return Promise.reject(error)
    }

    if (config._retried) {
      authFailureCallback?.()
      return Promise.reject(error)
    }

    const refreshToken = refreshTokenGetter?.()
    if (!refreshToken) {
      authFailureCallback?.()
      return Promise.reject(error)
    }

    try {
      const newAccessToken = await getRefreshedAccessToken(refreshToken)
      config._retried = true
      config.headers['Authorization'] = `Bearer ${newAccessToken}`
      return apiClient(config)
    } catch (refreshError) {
      authFailureCallback?.()
      return Promise.reject(refreshError)
    }
  }
)

let tokenGetter: (() => string | null) | null = null
let refreshTokenGetter: (() => string | null) | null = null
let authFailureCallback: (() => void) | null = null
let onTokenRefreshed: ((accessToken: string) => void) | null = null
let refreshPromise: Promise<string> | null = null

/** 调用 /auth/refresh 换取新 access token；进行中的刷新请求会被并发的 401 复用，避免重复调用 */
function getRefreshedAccessToken(refreshToken: string): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = apiClient
      .post<{ access_token: string }>('/auth/refresh', { refresh_token: refreshToken })
      .then((res) => {
        const accessToken = res.data.access_token
        onTokenRefreshed?.(accessToken)
        return accessToken
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

/**
 * 注册 token 读取函数，供请求拦截器自动注入 Authorization 头。
 * @param getter - 返回当前有效 JWT access token 的函数；无 token 时返回 null
 */
export function setTokenGetter(getter: () => string | null): void {
  tokenGetter = getter
}

/**
 * 注册 refresh token 读取函数，供响应拦截器在 access token 过期（401）时换取新 token。
 * @param getter - 返回当前 refresh token 的函数；无 token 时返回 null
 */
export function setRefreshTokenGetter(getter: () => string | null): void {
  refreshTokenGetter = getter
}

/**
 * 注册 401 回调，通常用于清除 auth 状态并重定向到登录页。
 * @param fn - 认证失败时调用的函数
 */
export function setOnAuthFailure(fn: () => void): void {
  authFailureCallback = fn
}

/**
 * 注册 token 刷新成功回调，用于把新 access token 写回状态存储（如 auth store + cookie）。
 * @param fn - 刷新成功后调用的函数，参数为新 access token
 */
export function setOnTokenRefreshed(fn: (accessToken: string) => void): void {
  onTokenRefreshed = fn
}
