import {
  setOnAuthFailure,
  setOnTokenRefreshed,
  setRefreshTokenGetter,
  setTokenGetter,
  useAuthStore,
} from '@yuanai/core'

/**
 * 把 apiClient 的 token 提供者 / 刷新回调 / 认证失败回调注册到 auth store。
 *
 * 与 Web 端 QueryProvider 里的做法保持一致，但在 mobile 侧调用点更早——
 * 需要在挂载 QueryClientProvider 前跑一次，避免拦截器读到空 getter。
 */
export function initApiClientBridge(): void {
  setTokenGetter(() => useAuthStore.getState().accessToken)
  setRefreshTokenGetter(() => useAuthStore.getState().refreshToken)
  setOnTokenRefreshed((accessToken) => {
    useAuthStore.getState().setAccessToken(accessToken)
  })
  setOnAuthFailure(() => {
    useAuthStore.getState().clearAuth()
  })
}
