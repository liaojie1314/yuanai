import NetInfo from '@react-native-community/netinfo'
import { useEffect } from 'react'
import { AppState, type AppStateStatus } from 'react-native'

import { stopAllConversationStreams, useChatStore } from '@yuanai/core'
import { apiClient } from '@yuanai/core/api'
import { useAuthStore } from '@yuanai/core/stores'

/**
 * 监听「App 前后台切换」与「网络连通性变化」，两种事件都需要打断当前 SSE 流：
 *
 * - 切后台：iOS 30-60s 内会挂起 native 网络栈，SSE 长连接会静默失活；主动 stop
 *   可以避免 UI 停留在"生成中…"的假死状态，用户回到前台后可手动重新生成
 * - 断网：SSE 会先超时后报错，主动 stop 让 UI 立刻反馈；未来接续传前不做自动重发
 *
 * 回到前台时还会复用 `/auth/me` 的 401 刷新机制，避免闲置期间 access token 过期后
 * 必须先执行一次业务操作才续期。
 */
export function useAppStateStream(onNetworkDrop?: () => void): void {
  useEffect(() => {
    const handleAppState = (state: AppStateStatus): void => {
      if (state === 'active' && useAuthStore.getState().refreshToken) {
        void apiClient.get('/auth/me').catch(() => undefined)
      }
      if (state === 'background' || state === 'inactive') {
        if (Object.keys(useChatStore.getState().streams).length > 0) {
          stopAllConversationStreams()
        }
      }
    }
    const sub = AppState.addEventListener('change', handleAppState)
    return () => {
      sub.remove()
    }
  }, [])

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      if (state.isConnected === false && Object.keys(useChatStore.getState().streams).length > 0) {
        stopAllConversationStreams()
        onNetworkDrop?.()
      }
    })
    return () => {
      unsub()
    }
  }, [onNetworkDrop])
}
