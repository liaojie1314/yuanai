import axios, { type InternalAxiosRequestConfig } from 'axios'

interface GlobalWithProcess {
  process?: {
    env?: Record<string, string | undefined>
  }
}

function getEnv(key: string): string | undefined {
  const proc = (globalThis as typeof globalThis & GlobalWithProcess).process
  return proc?.env?.[key]
}

function normalizeApiBaseUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('API base URL must use http or https')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('API base URL must not contain credentials, query, or fragment')
  }
  return url.toString().replace(/\/$/, '')
}

const DEFAULT_API_BASE_URL =
  getEnv('NEXT_PUBLIC_API_URL') ?? getEnv('EXPO_PUBLIC_API_URL') ?? 'http://localhost:8000/api/v1'

/** 当前运行时生效的 API base URL。 */
export let API_BASE_URL = normalizeApiBaseUrl(DEFAULT_API_BASE_URL)

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
})

/** 返回当前运行时生效的 API base URL。 */
export function getApiBaseUrl(): string {
  return API_BASE_URL
}

/**
 * 校验并更新运行时 API base URL 与 Axios 默认地址。
 * @param value 待设置的 API base URL，仅允许不含敏感 URL 组成部分的 HTTP(S) 地址
 */
export function setApiBaseUrl(value: string): void {
  const normalized = normalizeApiBaseUrl(value)
  API_BASE_URL = normalized
  apiClient.defaults.baseURL = normalized
}

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

/**
 * 供非 axios 通道（SSE 流）在收到 401 时手动刷新 access token。
 *
 * 与响应拦截器共用同一个 in-flight refreshPromise；刷新不可用/失败时触发
 * onAuthFailure（清 auth → 由路由守卫重定向登录页）并返回 null。
 */
export async function refreshAccessTokenForStream(): Promise<string | null> {
  const refreshToken = refreshTokenGetter?.()
  if (!refreshToken) {
    authFailureCallback?.()
    return null
  }
  try {
    return await getRefreshedAccessToken(refreshToken)
  } catch {
    authFailureCallback?.()
    return null
  }
}
