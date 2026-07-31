import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import type { Message } from '@yuanai/types'
import { Role } from '@yuanai/types'
import { API_BASE_URL, refreshAccessTokenForStream } from '../api/client.js'
import { getPlatformAdapter } from '../platform/index.js'
import type { SseMessage, StreamHandle } from '../platform/index.js'
import { useAuthStore } from '../stores/auth.store.js'
import { useChatStore } from '../stores/chat.store.js'

/** SSE 传输层拿不到结构化 status；用错误文本识别 401/Token 失效 */
function isAuthError(err: Error): boolean {
  return /AUTH_TOKEN_INVALID|HTTP 401|401/.test(err.message)
}

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
  /**
   * 流结束时回调（正常收尾 / 出错都会触发）。回传本轮流式累计的状态快照。
   * 快照来自 chat store 而非闭包变量：`content` 有 80ms 批量合并，闭包里 `finalContent`
   * 只保证正文部分，思考文本 / 耗时只在 store 里活着。onEnd 在 `finalizeStream` **之前**
   * 拍快照，之后 store 就被清空。
   */
  onEnd?: (result: { content: string; think: string; thinkDurationMs: number }) => void
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
  // 本轮流式的服务端消息 ID（message_start 携带）；stop() 用它把部分内容写回缓存
  const streamMetaRef = useRef<{
    convId: string
    userMsgId: string
    assistantMsgId: string
  } | null>(null)
  // 用户主动停止标记：让 close 回调跳过 refetch（此刻后端 assistant 占位可能尚未
  // 写入部分内容，refetch 会用空内容覆盖界面）
  const stoppedRef = useRef(false)

  // ── token 批量合并 ─────────────────────────────────────────────
  // 模型 token 到达频率可达每秒几十上百次；若每个 token 都 set 一次 store，
  // 订阅者（消息列表 + Markdown 渲染）会以同频率全量重渲染，长回复时 JS 线程
  // 直接被打满（真机已复现 ANR）。这里把 delta 缓冲 ~80ms 合并成一次提交。
  const pendingContentRef = useRef('')
  const pendingThinkRef = useRef('')
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushDeltas = useCallback((): void => {
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    if (pendingThinkRef.current) {
      appendThink(pendingThinkRef.current)
      pendingThinkRef.current = ''
    }
    if (pendingContentRef.current) {
      appendToken(pendingContentRef.current)
      pendingContentRef.current = ''
    }
  }, [appendThink, appendToken])

  const queueDelta = useCallback(
    (kind: 'content' | 'think', token: string): void => {
      if (kind === 'content') pendingContentRef.current += token
      else pendingThinkRef.current += token
      flushTimerRef.current ??= setTimeout(flushDeltas, 80)
    },
    [flushDeltas]
  )

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
            queueDelta('content', data['token'])
          }
          break
        case 'thinking_delta':
          if (typeof data['token'] === 'string') {
            queueDelta('think', data['token'])
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
    [queueDelta, startToolCall, appendToolCallArgs, updateToolCall]
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
      startStreaming(convId, skipOptimistic ? null : content)
      stoppedRef.current = false
      streamMetaRef.current = null
      onStart?.()

      // 单次流式尝试；resolve('auth') 表示未开流就撞上 token 失效（可刷新后重试）
      const attempt = (accessToken: string | null): Promise<'ok' | 'auth'> =>
        new Promise<'ok' | 'auth'>((resolve) => {
          const handle = getPlatformAdapter().stream(
            {
              url: `${API_BASE_URL}/chat/stream`,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
              },
              body: JSON.stringify({
                conversation_id: convId,
                model,
                message: { content, fileIds: fileIds ?? [] },
                enable_thinking: enableThinking ?? false,
              }),
            },
            {
              onMessage: (msg) => {
                // 记录本轮消息 ID：stop() 时把已收到的部分内容写回缓存要用
                if (msg.event === 'message_start') {
                  try {
                    const data = JSON.parse(msg.data) as {
                      user_message_id?: unknown
                      assistant_message_id?: unknown
                    }
                    if (
                      typeof data.user_message_id === 'string' &&
                      typeof data.assistant_message_id === 'string'
                    ) {
                      streamMetaRef.current = {
                        convId,
                        userMsgId: data.user_message_id,
                        assistantMsgId: data.assistant_message_id,
                      }
                    }
                  } catch {
                    /* 忽略解析失败，stop 时退化为 refetch */
                  }
                }
                dispatchMessage(msg)
              },
              onError: (err) => {
                flushDeltas()
                // token 过期：SSE 不经过 axios 401 拦截器，这里手动走刷新重试通道。
                // 只在流还没产出任何内容时才重试（有 meta 说明已开流，中途 401 不该发生）
                if (isAuthError(err) && streamMetaRef.current === null) {
                  resolve('auth')
                  return
                }
                finalizeStream()
                onError?.(err)
                resolve('ok')
              },
              onClose: () => {
                // 收尾前先把缓冲中的尾部 delta 刷进 store，避免短暂丢尾
                flushDeltas()
                // 用户主动停止：close 由 stop() 触发，缓存已在 stop() 内写好，
                // 不 refetch（后端占位行内容为空，会覆盖掉刚写入的部分内容）
                if (stoppedRef.current) {
                  resolve('ok')
                  return
                }
                void Promise.all([
                  qc.refetchQueries({ queryKey: ['messages', convId] }),
                  qc.refetchQueries({ queryKey: ['conversations'] }),
                ]).finally(() => {
                  finalizeStream()
                  resolve('ok')
                })
              },
            }
          )
          streamRef.current = handle
        })

      let result = await attempt(useAuthStore.getState().accessToken)
      if (result === 'auth') {
        // 刷新失败时 onAuthFailure 已 clearAuth → 路由守卫自动重定向登录页
        const newToken = await refreshAccessTokenForStream()
        if (newToken) {
          result = await attempt(newToken)
        }
        if (!newToken || result === 'auth') {
          if (result === 'auth') useAuthStore.getState().clearAuth()
          finalizeStream()
          onError?.(new Error('登录已过期，请重新登录'))
        }
      }

      streamRef.current = null
      onEnd?.()
    },
    [startStreaming, finalizeStream, qc, dispatchMessage, flushDeltas]
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
              // 单独处理 content_delta 以累积 finalContent（走同一个批量缓冲）
              if (msg.event === 'content_delta') {
                try {
                  const data = JSON.parse(msg.data) as { token?: unknown }
                  if (typeof data.token === 'string') {
                    finalContent += data.token
                    queueDelta('content', data.token)
                    return
                  }
                } catch {
                  return
                }
              }
              dispatchMessage(msg)
            },
            onError: (err) => {
              flushDeltas()
              // ⚠️ 顺序：flush → 快照 → finalize；finalizeStream 会清空 store，
              // 快照必须在它之前拿。
              const snap = useChatStore.getState()
              const result = {
                content: finalContent,
                think: snap.streamingThink,
                thinkDurationMs: snap.streamingThinkDurationMs,
              }
              finalizeStream()
              onError?.(err)
              onEnd?.(result)
              resolve()
            },
            onClose: () => {
              flushDeltas()
              const snap = useChatStore.getState()
              const result = {
                content: finalContent,
                think: snap.streamingThink,
                thinkDurationMs: snap.streamingThinkDurationMs,
              }
              finalizeStream()
              onEnd?.(result)
              resolve()
            },
          }
        )
        streamRef.current = handle
      })

      streamRef.current = null
    },
    [startStreaming, finalizeStream, queueDelta, flushDeltas, dispatchMessage]
  )

  /**
   * 停止生成。
   *
   * 关闭传输前先把「已收到的部分内容」写进消息查询缓存：占位的流式行会随
   * finalizeStream 消失，若不写缓存，已输出的文字会整段闪没（后端 assistant
   * 占位此刻还是空串，refetch 也救不回来）。服务端的部分内容落库由后端在
   * 连接断开时自行完成，两边各自兜底。
   */
  const stop = useCallback(() => {
    stoppedRef.current = true
    flushDeltas() // 把缓冲中的尾部 delta 先落进 store，写缓存才完整
    const s = useChatStore.getState()
    const meta = streamMetaRef.current

    if (meta && s.streamingConvId === meta.convId) {
      const now = new Date().toISOString()
      qc.setQueryData<Message[]>(['messages', meta.convId], (prev) => {
        const base = prev ? [...prev] : []
        if (s.optimisticUserMsg && !base.some((m) => m.id === meta.userMsgId)) {
          base.push({
            id: meta.userMsgId,
            role: Role.User,
            content: s.optimisticUserMsg,
            files: [],
            createdAt: now,
          })
        }
        if (s.streamingContent && !base.some((m) => m.id === meta.assistantMsgId)) {
          base.push({
            id: meta.assistantMsgId,
            role: Role.Assistant,
            content: s.streamingContent,
            ...(s.streamingThink ? { thinkingContent: s.streamingThink } : {}),
            files: [],
            createdAt: now,
          })
        }
        return base
      })
    }

    streamMetaRef.current = null
    finalizeStream()
    streamRef.current?.close()
    streamRef.current = null
  }, [finalizeStream, qc, flushDeltas])

  return { send, sendTemporary, stop }
}

/**
 * 临时对话使用的伪 conversation id。
 *
 * ChatInterface 用该常量判断是否处于临时会话上下文，
 * 避免使用真实 UUID 或魔法字符串散落各处；亦不会与后端会话冲突。
 */
export const TEMPORARY_CONV_ID = '__temporary__'
