import { useCallback, useRef } from 'react'
import { useChatStore, MOCK_RESPONSES } from '../stores/chat.store'

/** `useStream().send` 的参数 */
export interface StreamParams {
  /** 目标会话 ID */
  convId: string
  /** 用户发送的消息内容 */
  content: string
  /**
   * 流启动时回调
   * @param msgId - 占位 AI 消息的 ID（可用于滚动定位）
   */
  onStart?: (msgId: string) => void
  /** 流完成时回调 */
  onEnd?: () => void
}

/**
 * 流式消息发送 hook
 *
 * **当前实现（mock）**：以 18ms/字符 的固定速率追加随机预设回复，
 * 模拟 SSE token-by-token 推送效果。
 *
 * **后端接入后替换**：改为调用 `POST /api/v1/chat/stream`，
 * 通过 `ReadableStream` 解析 SSE 事件并调用 store 的 `appendToken`。
 *
 * @example
 * ```tsx
 * const { send, stop } = useStream()
 * send({ convId, content: '你好', onStart: () => setStreaming(true), onEnd: () => setStreaming(false) })
 * ```
 *
 * @returns
 * - `send` — 写入用户消息并启动流式输出
 * - `stop` — 中断流，保留已生成内容并写入 store
 */
export function useStream() {
  const { addUserMessage, startStreaming, appendToken, finalizeStream } = useChatStore()
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const send = useCallback(
    ({ convId, content, onStart, onEnd }: StreamParams) => {
      addUserMessage(convId, content)

      const msgId = startStreaming(convId)
      onStart?.(msgId)

      const response = MOCK_RESPONSES[Math.floor(Math.random() * MOCK_RESPONSES.length)] ?? ''
      let index = 0

      if (timerRef.current) clearInterval(timerRef.current)

      timerRef.current = setInterval(() => {
        if (index < response.length) {
          appendToken(response[index] ?? '')
          index++
        } else {
          if (timerRef.current) clearInterval(timerRef.current)
          finalizeStream(response)
          onEnd?.()
        }
      }, 18)
    },
    [addUserMessage, startStreaming, appendToken, finalizeStream]
  )

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    // 保留已生成的内容写入 store
    const { streamingContent } = useChatStore.getState()
    finalizeStream(streamingContent)
  }, [finalizeStream])

  return { send, stop }
}
