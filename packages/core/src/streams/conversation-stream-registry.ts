import type { QueryClient } from '@tanstack/react-query'
import type {
  Conversation,
  ConversationTitleSource,
  Message,
  MessageFile,
  SearchSource,
  ToolCall,
} from '@yuanai/types'
import { Role } from '@yuanai/types'

import { getApiBaseUrl, refreshAccessTokenForStream } from '../api/client.js'
import { getPlatformAdapter } from '../platform/index.js'
import type { SseMessage, StreamHandle } from '../platform/index.js'
import { useAuthStore } from '../stores/auth.store.js'
import { selectConversationStream, useChatStore } from '../stores/chat.store.js'

/** 临时对话使用的伪 conversation id，不会与后端 UUID 冲突。 */
export const TEMPORARY_CONV_ID = '__temporary__'

/** 临时对话的历史消息条目（不携带附件、不落库）。 */
export interface TemporaryChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** `sendTemporary` 的参数。 */
export interface TemporaryStreamParams {
  /** 用户新输入的内容。 */
  content: string
  /** 已有的历史消息（不包含本次 content）。 */
  history: TemporaryChatMessage[]
  /** 使用的 AI 模型 ID。 */
  model: string
  /** 是否开启思考模式。 */
  enableThinking?: boolean
  /** 是否让当前临时对话调用受限联网搜索工具。 */
  enableWebSearch?: boolean
  /** 流启动时回调。 */
  onStart?: () => void
  /** 流结束时回调。 */
  onEnd?: (result: {
    content: string
    think: string
    thinkDurationMs: number
    completed: boolean
  }) => void
  /** 流出错时回调。 */
  onError?: (err: Error) => void
}

/** `send` 的参数。 */
export interface StreamParams {
  /** 目标会话 ID。 */
  convId: string
  /** 用户发送的消息内容。 */
  content: string
  /** 使用的 AI 模型 ID。 */
  model: string
  /** 已上传的文件 ID 列表。 */
  fileIds?: string[] | undefined
  /** 上传完成后用于在 AI 回复开始前展示的文件引用。 */
  optimisticFiles?: MessageFile[] | undefined
  /** 是否开启 AI 思考模式。 */
  enableThinking?: boolean
  /** 是否让当前会话调用受限联网搜索工具。 */
  enableWebSearch?: boolean
  /** 为 true 时不显示乐观用户消息（重新生成场景）。 */
  skipOptimistic?: boolean
  /** 编辑既有用户消息时复用其记录，并截断其后的历史回复。 */
  replaceMessageId?: string
  /** 重新生成时对应的原始用户消息 ID；仅该字段决定 AI 回复版本归属。 */
  regenerateFromMessageId?: string
  /** 流启动时回调。 */
  onStart?: () => void
  /** 流结束时回调；`completed` 仅在服务器正常完成回复时为 true。 */
  onEnd?: (result: { completed: boolean }) => void
  /** 流出错时回调。 */
  onError?: (err: Error) => void
}

type StreamResult = 'completed' | 'failed' | 'auth' | 'stopped'

interface StreamMetadata {
  conversationId: string
  userMessageId: string
  assistantMessageId: string
}

interface ActiveConversationStream {
  conversationId: string
  queryClient: QueryClient
  handle: StreamHandle | null
  metadata: StreamMetadata | null
  stopped: boolean
  pendingContent: string
  pendingThinking: string
  flushTimer: ReturnType<typeof setTimeout> | null
  attemptId: number
  stop: () => void
}

/** SSE 传输层拿不到结构化 status；用错误文本识别 401/Token 失效。 */
function isAuthError(error: Error): boolean {
  return /AUTH_TOKEN_INVALID|HTTP 401|401/.test(error.message)
}

/** 解析后端 SSE 的结构化错误，向各端保留可直接展示的中文消息。 */
function parseSseError(data: string): Error {
  try {
    const payload = JSON.parse(data) as { message?: unknown }
    if (typeof payload.message === 'string' && payload.message.trim()) {
      return new Error(payload.message)
    }
  } catch {
    // 不规范的 SSE 错误仍应以安全兜底消息结束流。
  }
  return new Error('消息发送失败，请稍后重试')
}

/** 验证后端 title event，避免畸形 SSE 污染 TanStack 会话缓存。 */
function parseConversationTitle(data: Record<string, unknown>): {
  conversationId: string
  title: string
  titleSource: ConversationTitleSource
  titleGeneratedAt: string
} | null {
  const conversationId = data['conversation_id']
  const title = data['title']
  const titleSource = data['title_source']
  const titleGeneratedAt = data['title_generated_at']
  if (
    typeof conversationId !== 'string' ||
    typeof title !== 'string' ||
    typeof titleGeneratedAt !== 'string' ||
    !['default', 'fallback', 'ai', 'manual'].includes(String(titleSource))
  ) {
    return null
  }
  return {
    conversationId,
    title,
    titleSource: titleSource as ConversationTitleSource,
    titleGeneratedAt,
  }
}

/** 仅接受后端净化过的 HTTPS 搜索来源，避免畸形 SSE 渗入渲染层。 */
function parseSearchSources(value: unknown): SearchSource[] | undefined {
  if (!Array.isArray(value)) return undefined
  const sources = value.flatMap((item): SearchSource[] => {
    if (!item || typeof item !== 'object') return []
    const source = item as Record<string, unknown>
    const title = source['title']
    const url = source['url']
    const snippet = source['snippet']
    const provider = source['provider']
    if (
      typeof title !== 'string' ||
      !title.trim() ||
      typeof snippet !== 'string' ||
      !snippet.trim() ||
      typeof url !== 'string' ||
      !url.startsWith('https://') ||
      (provider !== 'searxng' && provider !== 'brave' && provider !== 'tavily')
    ) {
      return []
    }
    return [{ title, url, snippet, provider }]
  })
  return sources.length > 0 ? sources : undefined
}

/** 从 `message_start` 事件读取后端生成的两个消息 ID。 */
function readMessageMetadata(data: string, conversationId: string): StreamMetadata | null {
  try {
    const parsed = JSON.parse(data) as {
      user_message_id?: unknown
      assistant_message_id?: unknown
    }
    if (
      typeof parsed.user_message_id !== 'string' ||
      typeof parsed.assistant_message_id !== 'string'
    ) {
      return null
    }
    return {
      conversationId,
      userMessageId: parsed.user_message_id,
      assistantMessageId: parsed.assistant_message_id,
    }
  } catch {
    return null
  }
}

/**
 * 跨路由存活的会话流注册表。
 *
 * Hook 只把当前 QueryClient 与调用参数交给此单例；实际传输句柄、80ms 合并缓冲和
 * 停止状态由注册表按会话保存，因此离开聊天页不会中断另一个会话的 SSE。
 */
export class ConversationStreamRegistry {
  private readonly active = new Map<string, ActiveConversationStream>()

  /** 获取当前运行中的会话 ID。 */
  public activeConversationIds(): readonly string[] {
    return Array.from(this.active.keys())
  }

  /** 判断某个会话是否仍在接收流。 */
  public isStreaming(conversationId: string): boolean {
    return this.active.has(conversationId)
  }

  /** 启动一个持久会话流。 */
  public async send(queryClient: QueryClient, params: StreamParams): Promise<void> {
    if (this.active.has(params.convId)) {
      params.onError?.(new Error('该会话正在生成，请先停止当前回复'))
      return
    }

    if (params.replaceMessageId) {
      queryClient.setQueryData<Message[]>(['messages', params.convId], (previous) => {
        const index = previous?.findIndex((message) => message.id === params.replaceMessageId) ?? -1
        if (index < 0 || !previous) return previous
        return previous
          .slice(0, index + 1)
          .map((message) =>
            message.id === params.replaceMessageId
              ? { ...message, content: params.content }
              : message
          )
      })
    }

    const entry = this.createEntry(queryClient, params.convId)
    this.active.set(params.convId, entry)
    useChatStore
      .getState()
      .startStreaming(
        params.convId,
        params.skipOptimistic || params.replaceMessageId ? null : params.content,
        params.skipOptimistic || params.replaceMessageId ? [] : params.optimisticFiles
      )
    params.onStart?.()

    let result = await this.runPersistentAttempt(entry, params, useAuthStore.getState().accessToken)
    if (result === 'auth') {
      const refreshedToken = await refreshAccessTokenForStream()
      if (refreshedToken) {
        result = await this.runPersistentAttempt(entry, params, refreshedToken)
      }
      if (!refreshedToken || result === 'auth') {
        if (result === 'auth') useAuthStore.getState().clearAuth()
        this.finishEntry(entry)
        params.onError?.(new Error('登录已过期，请重新登录'))
        result = 'failed'
      }
    }

    this.removeEntry(entry)
    params.onEnd?.({ completed: result === 'completed' })
  }

  /** 启动不落库的临时会话流。 */
  public async sendTemporary(
    queryClient: QueryClient,
    params: TemporaryStreamParams
  ): Promise<void> {
    if (this.active.has(TEMPORARY_CONV_ID)) {
      params.onError?.(new Error('临时对话正在生成，请先停止当前回复'))
      return
    }

    const entry = this.createEntry(queryClient, TEMPORARY_CONV_ID)
    this.active.set(TEMPORARY_CONV_ID, entry)
    useChatStore.getState().startStreaming(TEMPORARY_CONV_ID, params.content)
    params.onStart?.()

    await this.runTemporaryAttempt(entry, params, useAuthStore.getState().accessToken)
  }

  /** 停止指定会话，不影响其他会话的传输和缓存。 */
  public stop(conversationId: string): void {
    this.active.get(conversationId)?.stop()
  }

  /** 仅测试使用：关闭并清空全部活跃连接。 */
  public reset(): void {
    for (const entry of Array.from(this.active.values())) entry.stop()
    this.active.clear()
    useChatStore.getState().finalizeStream()
  }

  private createEntry(queryClient: QueryClient, conversationId: string): ActiveConversationStream {
    return {
      conversationId,
      queryClient,
      handle: null,
      metadata: null,
      stopped: false,
      pendingContent: '',
      pendingThinking: '',
      flushTimer: null,
      attemptId: 0,
      stop: () => undefined,
    }
  }

  private flush(entry: ActiveConversationStream): void {
    if (entry.flushTimer !== null) {
      clearTimeout(entry.flushTimer)
      entry.flushTimer = null
    }
    if (entry.pendingThinking) {
      useChatStore.getState().appendThink(entry.conversationId, entry.pendingThinking)
      entry.pendingThinking = ''
    }
    if (entry.pendingContent) {
      useChatStore.getState().appendToken(entry.conversationId, entry.pendingContent)
      entry.pendingContent = ''
    }
  }

  private queueDelta(
    entry: ActiveConversationStream,
    kind: 'content' | 'thinking',
    token: string
  ): void {
    if (kind === 'content') entry.pendingContent += token
    else entry.pendingThinking += token
    entry.flushTimer ??= setTimeout(() => this.flush(entry), 80)
  }

  private dispatchMessage(entry: ActiveConversationStream, message: SseMessage): void {
    let data: Record<string, unknown>
    try {
      data = JSON.parse(message.data) as Record<string, unknown>
    } catch {
      return
    }

    switch (message.event) {
      case 'conversation_title': {
        const title = parseConversationTitle(data)
        if (!title) return
        entry.queryClient.setQueryData<Conversation[]>(['conversations'], (previous) =>
          previous?.map((conversation) =>
            conversation.id === title.conversationId
              ? {
                  ...conversation,
                  title: title.title,
                  titleSource: title.titleSource,
                  titleGeneratedAt: title.titleGeneratedAt,
                }
              : conversation
          )
        )
        return
      }
      case 'content_delta':
        if (typeof data['token'] === 'string') this.queueDelta(entry, 'content', data['token'])
        return
      case 'thinking_delta':
        if (typeof data['token'] === 'string') this.queueDelta(entry, 'thinking', data['token'])
        return
      case 'tool_call_start': {
        const id = data['tool_call_id']
        const name = data['name']
        if (typeof id === 'string' && typeof name === 'string') {
          useChatStore.getState().startToolCall(entry.conversationId, {
            id,
            name,
            arguments: '',
            status: 'running',
          })
        }
        return
      }
      case 'tool_call_delta': {
        const id = data['tool_call_id']
        const chunk = data['args_chunk']
        if (typeof id === 'string' && typeof chunk === 'string') {
          useChatStore.getState().appendToolCallArgs(entry.conversationId, id, chunk)
        }
        return
      }
      case 'tool_call_end': {
        const id = data['tool_call_id']
        if (typeof id !== 'string') return
        const status =
          typeof data['status'] === 'string' &&
          ['pending', 'running', 'done', 'error'].includes(data['status'])
            ? (data['status'] as ToolCall['status'])
            : 'done'
        const sources = parseSearchSources(data['sources'])
        useChatStore.getState().updateToolCall(entry.conversationId, id, {
          status,
          ...(typeof data['result'] === 'string' ? { result: data['result'] } : {}),
          ...(typeof data['error'] === 'string' ? { error: data['error'] } : {}),
          ...(typeof data['duration_ms'] === 'number' ? { durationMs: data['duration_ms'] } : {}),
          ...(sources ? { sources } : {}),
        })
        return
      }
      default:
        return
    }
  }

  private runPersistentAttempt(
    entry: ActiveConversationStream,
    params: StreamParams,
    accessToken: string | null
  ): Promise<StreamResult> {
    const attemptId = entry.attemptId + 1
    entry.attemptId = attemptId
    entry.metadata = null
    entry.stopped = false

    return new Promise<StreamResult>((resolve) => {
      let settled = false
      let serverError: Error | null = null
      const settle = (result: StreamResult): void => {
        if (settled) return
        settled = true
        entry.handle = null
        resolve(result)
      }
      const isCurrentAttempt = (): boolean => entry.attemptId === attemptId && !settled

      entry.stop = () => {
        if (!isCurrentAttempt()) return
        entry.stopped = true
        this.flush(entry)
        this.persistPartial(entry)
        this.finishEntry(entry)
        entry.handle?.close()
        settle('stopped')
      }

      let handle: StreamHandle | null = null
      handle = getPlatformAdapter().stream(
        {
          url: `${getApiBaseUrl()}/chat/stream`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            conversation_id: params.convId,
            model: params.model,
            message: { content: params.content, fileIds: params.fileIds ?? [] },
            enable_thinking: params.enableThinking ?? false,
            enable_web_search: params.enableWebSearch ?? false,
            ...(params.replaceMessageId ? { replace_message_id: params.replaceMessageId } : {}),
            ...(params.regenerateFromMessageId
              ? { regenerate_from_message_id: params.regenerateFromMessageId }
              : {}),
          }),
        },
        {
          onMessage: (message) => {
            if (!isCurrentAttempt()) return
            if (message.event === 'error') {
              serverError = parseSseError(message.data)
              handle?.close()
              return
            }
            if (message.event === 'message_start') {
              entry.metadata = readMessageMetadata(message.data, entry.conversationId)
            }
            this.dispatchMessage(entry, message)
          },
          onError: (error) => {
            if (!isCurrentAttempt()) return
            this.flush(entry)
            if (isAuthError(error) && entry.metadata === null) {
              settle('auth')
              return
            }
            this.finishEntry(entry)
            params.onError?.(error)
            settle('failed')
          },
          onClose: () => {
            if (!isCurrentAttempt()) return
            this.flush(entry)
            if (serverError) {
              this.finishEntry(entry)
              params.onError?.(serverError)
              settle('failed')
              return
            }
            if (entry.stopped) {
              settle('stopped')
              return
            }
            // 先把已完成流的正文、思考和工具来源写入缓存，再用后端历史刷新确认最终状态。
            // 这样网络刷新存在短暂延迟时，来源仍会立即留在思考区。
            this.persistPartial(entry)
            void Promise.all([
              entry.queryClient.refetchQueries({ queryKey: ['messages', entry.conversationId] }),
              entry.queryClient.refetchQueries({ queryKey: ['conversations'] }),
            ]).finally(() => {
              if (!isCurrentAttempt()) return
              this.finishEntry(entry)
              settle('completed')
            })
          },
        }
      )
      entry.handle = handle
    })
  }

  private runTemporaryAttempt(
    entry: ActiveConversationStream,
    params: TemporaryStreamParams,
    accessToken: string | null
  ): Promise<void> {
    const attemptId = entry.attemptId + 1
    entry.attemptId = attemptId
    entry.stopped = false
    let finalContent = ''

    return new Promise<void>((resolve) => {
      let settled = false
      let serverError: Error | null = null
      const finish = (completed: boolean, error?: Error): void => {
        if (settled) return
        settled = true
        this.flush(entry)
        const snapshot = selectConversationStream(useChatStore.getState(), TEMPORARY_CONV_ID)
        this.finishEntry(entry)
        this.removeEntry(entry)
        if (error) params.onError?.(error)
        params.onEnd?.({
          content: finalContent,
          think: snapshot.thinking,
          thinkDurationMs: snapshot.thinkingDurationMs,
          completed,
        })
        resolve()
      }
      const isCurrentAttempt = (): boolean => entry.attemptId === attemptId && !settled

      entry.stop = () => {
        if (!isCurrentAttempt()) return
        entry.stopped = true
        entry.handle?.close()
        finish(false)
      }

      let handle: StreamHandle | null = null
      handle = getPlatformAdapter().stream(
        {
          url: `${getApiBaseUrl()}/chat/stream/temporary`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            model: params.model,
            messages: [...params.history, { role: 'user', content: params.content }],
            enableThinking: params.enableThinking ?? false,
            enableWebSearch: params.enableWebSearch ?? false,
          }),
        },
        {
          onMessage: (message) => {
            if (!isCurrentAttempt()) return
            if (message.event === 'error') {
              serverError = parseSseError(message.data)
              handle?.close()
              return
            }
            if (message.event === 'content_delta') {
              try {
                const payload = JSON.parse(message.data) as { token?: unknown }
                if (typeof payload.token === 'string') {
                  finalContent += payload.token
                  this.queueDelta(entry, 'content', payload.token)
                }
              } catch {
                // 畸形增量不应中断其它有效事件。
              }
              return
            }
            this.dispatchMessage(entry, message)
          },
          onError: (error) => {
            if (isCurrentAttempt()) finish(false, error)
          },
          onClose: () => {
            if (!isCurrentAttempt()) return
            finish(!entry.stopped && serverError === null, serverError ?? undefined)
          },
        }
      )
      entry.handle = handle
    })
  }

  private persistPartial(entry: ActiveConversationStream): void {
    const metadata = entry.metadata
    if (!metadata) return
    const stream = selectConversationStream(useChatStore.getState(), entry.conversationId)
    const now = new Date().toISOString()
    entry.queryClient.setQueryData<Message[]>(['messages', entry.conversationId], (previous) => {
      const messages = previous ? [...previous] : []
      if (
        stream.optimisticUserMessage &&
        !messages.some((message) => message.id === metadata.userMessageId)
      ) {
        messages.push({
          id: metadata.userMessageId,
          role: Role.User,
          content: stream.optimisticUserMessage,
          files: stream.optimisticFiles,
          createdAt: now,
        })
      }
      if (
        stream.content &&
        !messages.some((message) => message.id === metadata.assistantMessageId)
      ) {
        messages.push({
          id: metadata.assistantMessageId,
          role: Role.Assistant,
          content: stream.content,
          ...(stream.thinking ? { thinkingContent: stream.thinking } : {}),
          ...(stream.toolCalls.length > 0 ? { toolCalls: stream.toolCalls } : {}),
          files: [],
          createdAt: now,
        })
      }
      return messages
    })
  }

  private finishEntry(entry: ActiveConversationStream): void {
    this.flush(entry)
    useChatStore.getState().finalizeStream(entry.conversationId)
  }

  private removeEntry(entry: ActiveConversationStream): void {
    if (this.active.get(entry.conversationId) === entry) {
      this.active.delete(entry.conversationId)
    }
  }
}

/** 全部 renderer 共享的流注册表实例。 */
export const conversationStreamRegistry = new ConversationStreamRegistry()
