import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import { API_BASE_URL } from '../api/client.js'
import { useAuthStore } from '../stores/auth.store.js'
import { useChatStore } from '../stores/chat.store.js'

/** 临时对话的历史消息条目（不携带附件、不落库） */
export interface TemporaryChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** `useStream().sendTemporary` 的参数 */
export interface TemporaryStreamParams {
  /** 用户新输入的内容 */
  content: string
  /** 已有的历史消息（不包含本次 content） */
  history: TemporaryChatMessage[]
  /** 使用的 AI 模型 ID */
  model: string
  /** 是否开启思考模式 */
  enableThinking?: boolean
  /** 流启动时回调 */
  onStart?: () => void
  /** 流结束时回调，参数为累计的正文内容 */
  onEnd?: (finalContent: string) => void
  /** 流出错时回调 */
  onError?: (err: Error) => void
}

/** `useStream().send` 的参数 */
export interface StreamParams {
  /** 目标会话 ID */
  convId: string
  /** 用户发送的消息内容 */
  content: string
  /** 使用的 AI 模型 ID */
  model: string
  /** 已上传的文件 ID 列表 */
  fileIds?: string[] | undefined
  /** 是否开启 AI 思考模式（DeepSeek 系列通过 extra_body 传递，其他模型忽略） */
  enableThinking?: boolean
  /** 为 true 时不显示乐观用户消息（重新生成场景：原用户消息已存在） */
  skipOptimistic?: boolean
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
 *
 * 支持的 SSE 事件：
 * - `content_delta`：追加正文 token
 * - `thinking_delta`：追加思考文字（reasoning tokens）
 * - `tool_call_start` / `tool_call_delta` / `tool_call_end`：工具调用生命周期
 * - `message_start` / `message_end` / `error`：识别但不影响 UI
 *
 * 未知事件会被静默忽略，保证向后兼容。
 */
export function useStream() {
  const {
    startStreaming,
    appendToken,
    appendThink,
    startToolCall,
    appendToolCallArgs,
    updateToolCall,
    finalizeStream,
  } = useChatStore()
  const qc = useQueryClient()
  const abortRef = useRef<AbortController | null>(null)

  const send = useCallback(
    async ({
      convId,
      content,
      model,
      fileIds,
      enableThinking,
      skipOptimistic,
      onStart,
      onEnd,
      onError,
    }: StreamParams): Promise<void> => {
      const token = useAuthStore.getState().accessToken
      abortRef.current = new AbortController()

      startStreaming(convId, skipOptimistic ? null : content)
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
            message: { content, fileIds: fileIds ?? [] },
            enable_thinking: enableThinking ?? false,
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
                switch (currentEvent) {
                  case 'content_delta':
                    if (typeof data['token'] === 'string') {
                      appendToken(data['token'])
                    }
                    break
                  case 'thinking_delta':
                    if (typeof data['token'] === 'string') {
                      appendThink(data['token'])
                    }
                    break
                  case 'tool_call_start': {
                    const id = data['tool_call_id']
                    const name = data['name']
                    if (typeof id === 'string' && typeof name === 'string') {
                      startToolCall({
                        id,
                        name,
                        arguments: '',
                        status: 'running',
                      })
                    }
                    break
                  }
                  case 'tool_call_delta': {
                    const id = data['tool_call_id']
                    const chunk = data['args_chunk']
                    if (typeof id === 'string' && typeof chunk === 'string') {
                      appendToolCallArgs(id, chunk)
                    }
                    break
                  }
                  case 'tool_call_end': {
                    const id = data['tool_call_id']
                    if (typeof id === 'string') {
                      const status =
                        typeof data['status'] === 'string' &&
                        ['pending', 'running', 'done', 'error'].includes(data['status'])
                          ? (data['status'] as 'pending' | 'running' | 'done' | 'error')
                          : 'done'
                      updateToolCall(id, {
                        status,
                        ...(typeof data['result'] === 'string' ? { result: data['result'] } : {}),
                        ...(typeof data['error'] === 'string' ? { error: data['error'] } : {}),
                        ...(typeof data['duration_ms'] === 'number'
                          ? { durationMs: data['duration_ms'] }
                          : {}),
                      })
                    }
                    break
                  }
                  // message_start / message_end / error 识别但暂不影响 UI
                  default:
                    break
                }
              } catch {
                // 忽略无效 JSON
              }
              currentEvent = ''
            }
          }
        }

        // 先等新数据写入缓存，再清除流式 overlay，避免内容跳动
        await Promise.all([
          qc.refetchQueries({ queryKey: ['messages', convId] }),
          qc.refetchQueries({ queryKey: ['conversations'] }),
        ])
        finalizeStream()
      } catch (err) {
        finalizeStream()
        if (err instanceof Error && err.name !== 'AbortError') {
          onError?.(err)
        }
      } finally {
        onEnd?.()
      }
    },
    [
      startStreaming,
      appendToken,
      appendThink,
      startToolCall,
      appendToolCallArgs,
      updateToolCall,
      finalizeStream,
      qc,
    ]
  )

  /**
   * 临时对话流式发送：不落库、不刷新会话列表、不使用消息 Query 缓存。
   *
   * SSE 协议与 `/chat/stream` 保持一致（相同事件名），因此仍复用 chat store 的
   * `startStreaming/appendToken/appendThink/finalizeStream` 承载实时 UI 状态；
   * 用一个约定的伪 convId (`__temporary__`) 作为 streamingConvId，
   * 上层组件用同一个字符串识别是临时对话中，不与真实 UUID 冲突。
   */
  const sendTemporary = useCallback(
    async ({
      content,
      history,
      model,
      enableThinking,
      onStart,
      onEnd,
      onError,
    }: TemporaryStreamParams): Promise<void> => {
      const token = useAuthStore.getState().accessToken
      abortRef.current = new AbortController()

      startStreaming(TEMPORARY_CONV_ID, content)
      onStart?.()

      let finalContent = ''

      try {
        const response = await fetch(`${API_BASE_URL}/chat/stream/temporary`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            model,
            messages: [...history, { role: 'user', content }],
            enableThinking: enableThinking ?? false,
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
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim()
            } else if (line.startsWith('data: ') && currentEvent) {
              try {
                const data = JSON.parse(line.slice(6)) as Record<string, unknown>
                switch (currentEvent) {
                  case 'content_delta':
                    if (typeof data['token'] === 'string') {
                      finalContent += data['token']
                      appendToken(data['token'])
                    }
                    break
                  case 'thinking_delta':
                    if (typeof data['token'] === 'string') {
                      appendThink(data['token'])
                    }
                    break
                  default:
                    break
                }
              } catch {
                /* ignore malformed JSON */
              }
              currentEvent = ''
            }
          }
        }

        finalizeStream()
        onEnd?.(finalContent)
      } catch (err) {
        finalizeStream()
        if (err instanceof Error && err.name !== 'AbortError') {
          onError?.(err)
        }
        onEnd?.(finalContent)
      }
    },
    [startStreaming, appendToken, appendThink, finalizeStream]
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
    finalizeStream()
  }, [finalizeStream])

  return { send, sendTemporary, stop }
}

/**
 * 临时对话使用的伪 conversation id。
 *
 * ChatInterface 用该常量判断是否处于临时会话上下文，
 * 避免使用真实 UUID 或魔法字符串散落各处；亦不会与后端会话冲突。
 */
export const TEMPORARY_CONV_ID = '__temporary__'
