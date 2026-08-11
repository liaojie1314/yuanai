import {
  setOnAuthFailure,
  setOnTokenRefreshed,
  setRefreshTokenGetter,
  setTokenGetter,
} from '@yuanai/core/api'
import { useAuthStore } from '@yuanai/core/stores'

/**
 * 将桌面端加密会话状态连接到共享 API 客户端。
 *
 * Getter 在每次请求时读取 Zustand 当前状态，保证登录、冷启动恢复和 token 刷新后
 * 都会使用最新凭据；认证失效时则清理安全存储并由主进程返回登录窗口。
 */
export function configureDesktopAuthClient(): void {
  setTokenGetter(() => useAuthStore.getState().accessToken)
  setRefreshTokenGetter(() => useAuthStore.getState().refreshToken)
  setOnTokenRefreshed((accessToken) => useAuthStore.getState().setAccessToken(accessToken))
  setOnAuthFailure(() => useAuthStore.getState().clearAuth())
}

/** 重新读取主进程已加密保存的认证状态，以同步其他登录窗口的结果。 */
export async function synchronizeDesktopAuthState(): Promise<void> {
  await useAuthStore.persist.rehydrate()
}
