import axios from 'axios'

function getEnv(key: string): string | undefined {
  return typeof process !== 'undefined' ? process.env[key] : undefined
}

const API_BASE_URL =
  getEnv('NEXT_PUBLIC_API_URL') ?? getEnv('EXPO_PUBLIC_API_URL') ?? 'http://localhost:8000/api/v1'

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

// Request interceptor: 自动注入 token
apiClient.interceptors.request.use((config) => {
  const token = getStoredToken()
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`
  }
  return config
})

// Response interceptor: 401 自动刷新 token
apiClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    // TODO: Phase 1 后端完成后实现 token 刷新逻辑
    return Promise.reject(error)
  }
)

function getStoredToken(): string | null {
  return tokenGetter?.() ?? null
}

let tokenGetter: (() => string | null) | null = null

export function setTokenGetter(getter: () => string | null): void {
  tokenGetter = getter
}
