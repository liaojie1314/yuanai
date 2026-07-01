import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import { API_BASE_URL } from '../api/client.js'
import { useAuthStore } from '../stores/auth.store.js'
import { useChatStore } from '../stores/chat.store.js'

/** `useStream().send` 的参数 */
export interface StreamParams {
  /** 目标会话 ID */
  convId: string
  /** 用户发送的消息内容 */
  content: string
  /** 使用的 AI 模型 ID */
  model: string
  /** 流启动时回调 */
  onStart?: () => void
  /** 流完成时回调 */
  onEnd?: () => void
  /** 流出错时回调 */
  onError?: (err: Error) => void
}

/**
 * 流式消息发送 hook
 *
 * 调用 `POST /api/v1/chat/stream` 并通过 `ReadableStream` 解析 SSE 事件，
 * 将 token 增量写入 `useChatStore`，流结束后通过 TanStack Query 刷新消息列表。
 */
export function useStream() {
  const { startStreaming, appendToken, finalizeStream } = useChatStore()
  const qc = useQueryClient()
  const abortRef = useRef<AbortController | null>(null)

  const send = useCallback(
    async ({ convId, content, model, onStart, onEnd, onError }: StreamParams): Promise<void> => {
      const token = useAuthStore.getState().accessToken
      abortRef.current = new AbortController()

      startStreaming(convId, content)
      onStart?.()

      try {
        const response = await fetch(`${API_BASE_URL}/chat/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            conversation_id: convId,
            model,
            message: { content, fileIds: [] },
          }),
          signal: abortRef.current.signal,
        })

        if (!response.ok || !response.body) {
          throw new Error(`HTTP ${String(response.status)}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let currentEvent = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          // 保留最后一段不完整的行继续等待后续数据
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim()
            } else if (line.startsWith('data: ') && currentEvent) {
              try {
                const data = JSON.parse(line.slice(6)) as Record<string, unknown>
                if (currentEvent === 'content_delta' && typeof data.token === 'string') {
                  appendToken(data.token)
                }
              } catch {
                // 忽略无效 JSON
              }
              currentEvent = ''
            }
          }
        }

        finalizeStream()
        // 流结束后刷新消息列表与会话列表（更新 lastMessageAt）
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['messages', convId] }),
          qc.invalidateQueries({ queryKey: ['conversations'] }),
        ])
      } catch (err) {
        finalizeStream()
        if (err instanceof Error && err.name !== 'AbortError') {
          onError?.(err)
        }
      } finally {
        onEnd?.()
      }
    },
    [startStreaming, appendToken, finalizeStream, qc]
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
    finalizeStream()
  }, [finalizeStream])

  return { send, stop }
}
