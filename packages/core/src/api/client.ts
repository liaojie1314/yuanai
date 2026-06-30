import axios from 'axios'

/**
 * 跨环境读取环境变量
 * Next.js 和 Expo 在编译时将 NEXT_PUBLIC_* / EXPO_PUBLIC_* 注入到 `process.env`，
 * 故在浏览器端依然可通过 `process.env` 访问。
 */
function getEnv(key: string): string | undefined {
  return typeof process !== 'undefined' ? process.env[key] : undefined
}

const API_BASE_URL =
  getEnv('NEXT_PUBLIC_API_URL') ?? getEnv('EXPO_PUBLIC_API_URL') ?? 'http://localhost:8000/api/v1'

/**
 * 项目统一 HTTP 客户端（axios 实例）
 *
 * 配置：
 * - `baseURL`: 优先读 `NEXT_PUBLIC_API_URL` / `EXPO_PUBLIC_API_URL`，开发时回退到 `localhost:8000`
 * - `timeout`: 30 秒
 * - 请求拦截器：自动注入 Bearer token（需先调用 {@link setTokenGetter} 注册）
 * - 响应拦截器：预留 401 token 刷新位置（TODO：Phase 1 后端完成后实现）
 */
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

// 请求拦截器：自动注入 Bearer token
apiClient.interceptors.request.use((config) => {
  const token = getStoredToken()
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`
  }
  return config
})

// 响应拦截器：预留 token 刷新逻辑（当前仅透传错误）
apiClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    // TODO: Phase 1 后端完成后实现 refresh_token 续期逻辑
    return Promise.reject(error)
  }
)

/** 从已注册的 getter 中读取 token；未注册时返回 null */
function getStoredToken(): string | null {
  return tokenGetter?.() ?? null
}

let tokenGetter: (() => string | null) | null = null

/**
 * 注册 token 读取函数，供请求拦截器自动注入 Authorization 头。
 *
 * 应在应用入口（如 QueryProvider）调用：
 * ```ts
 * setTokenGetter(() => useAuthStore.getState().accessToken)
 * ```
 *
 * @param getter - 返回当前有效 JWT access token 的函数；无 token 时返回 null
 */
export function setTokenGetter(getter: () => string | null): void {
  tokenGetter = getter
}
