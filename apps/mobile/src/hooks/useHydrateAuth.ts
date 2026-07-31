import { useEffect, useState } from 'react'

import { useAuthStore } from '@yuanai/core'

/**
 * 应用启动时把持久化的 auth 状态（access/refresh token + user）从 SecureStore
 * 恢复到 store，恢复完成前返回 `false`——由 `_layout` 用来延迟隐藏 Splash 屏，
 * 避免"用户已登录却先闪一下未登录界面再跳回"的抖动。
 *
 * zustand persist 内部本身就是异步 rehydrate（因为 SecureStore.getItemAsync 是异步）；
 * 通过 `onFinishHydration` 监听最终状态即可，同步一次即可完成。
 */
export function useHydrateAuth(): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // hasHydrated() 是 zustand v5 提供的同步查询接口
    const persist = useAuthStore.persist
    if (persist.hasHydrated()) {
      setReady(true)
      return
    }
    const unsub = persist.onFinishHydration(() => setReady(true))
    return () => {
      unsub()
    }
  }, [])

  return ready
}
