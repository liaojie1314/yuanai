import NetInfo from '@react-native-community/netinfo'
import { useEffect } from 'react'
import { AppState, type AppStateStatus } from 'react-native'

import { useChatStore } from '@yuanai/core'

/**
 * 监听「App 前后台切换」与「网络连通性变化」，两种事件都需要打断当前 SSE 流：
 *
 * - 切后台：iOS 30-60s 内会挂起 native 网络栈，SSE 长连接会静默失活；主动 stop
 *   可以避免 UI 停留在"生成中…"的假死状态，用户回到前台后可手动重新生成
 * - 断网：SSE 会先超时后报错，主动 stop 让 UI 立刻反馈；未来接续传前不做自动重发
 *
 * 都只影响流式态；已落库的消息不受影响。
 */
export function useAppStateStream(onNetworkDrop?: () => void): void {
  useEffect(() => {
    const finalizeStream = useChatStore.getState().finalizeStream
    const handleAppState = (state: AppStateStatus): void => {
      if (state === 'background' || state === 'inactive') {
        // streamingConvId 存在时才是"生成中"
        if (useChatStore.getState().streamingConvId !== null) {
          finalizeStream()
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
      if (state.isConnected === false && useChatStore.getState().streamingConvId !== null) {
        useChatStore.getState().finalizeStream()
        onNetworkDrop?.()
      }
    })
    return () => {
      unsub()
    }
  }, [onNetworkDrop])
}
