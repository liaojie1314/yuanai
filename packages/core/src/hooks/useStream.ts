import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import { API_BASE_URL } from '../api/client.js'
import { getPlatformAdapter } from '../platform/index.js'
import type { SseMessage, StreamHandle } from '../platform/index.js'
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
 * 通过 `getPlatformAdapter().stream(...)` 屏蔽 Web (`fetch + ReadableStream`) 与
 * Mobile (`react-native-sse`) 的传输差异，本 hook 只负责根据事件名调度到 chat store。
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
  const streamRef = useRef<StreamHandle | null>(null)

  const dispatchMessage = useCallback(
    (msg: SseMessage): void => {
      let data: Record<string, unknown>
      try {
        data = JSON.parse(msg.data) as Record<string, unknown>
      } catch {
        return
      }
      switch (msg.event) {
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
        default:
          break
      }
    },
    [appendToken, appendThink, startToolCall, appendToolCallArgs, updateToolCall]
  )

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

      startStreaming(convId, skipOptimistic ? null : content)
      onStart?.()

      await new Promise<void>((resolve) => {
        const handle = getPlatformAdapter().stream(
          {
            url: `${API_BASE_URL}/chat/stream`,
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
          },
          {
            onMessage: dispatchMessage,
            onError: (err) => {
              finalizeStream()
              onError?.(err)
              resolve()
            },
            onClose: () => {
              void Promise.all([
                qc.refetchQueries({ queryKey: ['messages', convId] }),
                qc.refetchQueries({ queryKey: ['conversations'] }),
              ]).finally(() => {
                finalizeStream()
                resolve()
              })
            },
          }
        )
        streamRef.current = handle
      })

      streamRef.current = null
      onEnd?.()
    },
    [startStreaming, finalizeStream, qc, dispatchMessage]
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

      startStreaming(TEMPORARY_CONV_ID, content)
      onStart?.()

      let finalContent = ''

      await new Promise<void>((resolve) => {
        const handle = getPlatformAdapter().stream(
          {
            url: `${API_BASE_URL}/chat/stream/temporary`,
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
          },
          {
            onMessage: (msg) => {
              // 单独处理 content_delta 以累积 finalContent
              if (msg.event === 'content_delta') {
                try {
                  const data = JSON.parse(msg.data) as { token?: unknown }
                  if (typeof data.token === 'string') {
                    finalContent += data.token
                    appendToken(data.token)
                    return
                  }
                } catch {
                  return
                }
              }
              dispatchMessage(msg)
            },
            onError: (err) => {
              finalizeStream()
              onError?.(err)
              onEnd?.(finalContent)
              resolve()
            },
            onClose: () => {
              finalizeStream()
              onEnd?.(finalContent)
              resolve()
            },
          }
        )
        streamRef.current = handle
      })

      streamRef.current = null
    },
    [startStreaming, finalizeStream, appendToken, dispatchMessage]
  )

  const stop = useCallback(() => {
    streamRef.current?.close()
    streamRef.current = null
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
