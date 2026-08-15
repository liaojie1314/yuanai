import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import {
  conversationStreamRegistry,
  TEMPORARY_CONV_ID,
  type StreamParams,
  type TemporaryStreamParams,
} from '../streams/conversation-stream-registry.js'

export { TEMPORARY_CONV_ID }
export type {
  StreamParams,
  TemporaryChatMessage,
  TemporaryStreamParams,
} from '../streams/conversation-stream-registry.js'

/** `useStream` 暴露的会话流控制能力。 */
export interface UseStreamResult {
  /** 启动一个会话的后台 SSE 流。 */
  send(params: StreamParams): Promise<void>
  /** 启动不落库的临时会话 SSE 流。 */
  sendTemporary(params: TemporaryStreamParams): Promise<void>
  /** 停止指定会话的 SSE 流，不影响其它会话。 */
  stop(conversationId: string): void
  /** 判断指定会话是否仍在生成。 */
  isStreaming(conversationId: string): boolean
  /** 获取当前所有运行中的会话 ID。 */
  activeConversationIds(): readonly string[]
}

/**
 * 停止当前 renderer 中的全部会话流。
 *
 * 供移动端前后台和断网边界调用；每个流仍会分别保留已生成的局部内容。
 */
export function stopAllConversationStreams(): void {
  for (const conversationId of conversationStreamRegistry.activeConversationIds()) {
    conversationStreamRegistry.stop(conversationId)
  }
}

/**
 * 会话流 React 适配器。
 *
 * 浏览器、Electron 与 React Native 的路由会反复挂载；真实传输、缓冲区和停止动作由
 * 模块级 `conversationStreamRegistry` 按会话保存，Hook 仅为本 renderer 注入 QueryClient。
 */
export function useStream(): UseStreamResult {
  const queryClient = useQueryClient()

  const send = useCallback(
    (params: StreamParams): Promise<void> => conversationStreamRegistry.send(queryClient, params),
    [queryClient]
  )
  const sendTemporary = useCallback(
    (params: TemporaryStreamParams): Promise<void> =>
      conversationStreamRegistry.sendTemporary(queryClient, params),
    [queryClient]
  )
  const stop = useCallback((conversationId: string): void => {
    conversationStreamRegistry.stop(conversationId)
  }, [])
  const isStreaming = useCallback(
    (conversationId: string): boolean => conversationStreamRegistry.isStreaming(conversationId),
    []
  )
  const activeConversationIds = useCallback(
    (): readonly string[] => conversationStreamRegistry.activeConversationIds(),
    []
  )

  return { send, sendTemporary, stop, isStreaming, activeConversationIds }
}
