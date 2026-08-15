import { create } from 'zustand'
import type { ConversationTitleSource, MessageFile, ToolCall, ToolCallStatus } from '@yuanai/types'

/**
 * 会话分组类型，用于侧边栏按时间维度对话归类。
 */
export type ConvGroup = 'pinned' | 'today' | 'yesterday' | 'week'

/**
 * 前端展示用的会话结构（从后端 Conversation 适配而来）。
 */
export interface MockConversation {
  id: string
  title: string
  /** 首问标题的来源，供侧边栏显示短暂生成状态。 */
  titleSource?: ConversationTitleSource
  group: ConvGroup
  updatedAt: number
}

export type MessageRole = 'user' | 'assistant'

/**
 * 前端展示用的 MessagePart（简化版），用于历史消息渲染。
 *
 * 后端返回 `messageParts` 时按此结构缓存；否则由 `content` 字符串降级构造。
 */
export interface MessagePart {
  type: 'text' | 'code'
  content?: string
  lang?: string
  code?: string
}

/**
 * 前端展示用的消息结构（从后端 Message 适配而来）。
 */
export interface MockMessage {
  id: string
  role: MessageRole
  parts: MessagePart[]
  /** 结构化推理文字（chain-of-thought） */
  thinkContent?: string
  /** 消息内嵌的工具调用记录 */
  toolCalls?: ToolCall[]
  /** 思考耗时（毫秒），流结束后填充 */
  thinkDurationMs?: number
  followUps?: string[]
  /** 消息关联的已上传附件。 */
  files?: MessageFile[]
  createdAt: number
}

/**
 * 某个会话正在接收 SSE 时的瞬态展示状态。
 *
 * 后端历史仍由 TanStack Query 管理；此对象只保存尚未落库的乐观消息和增量输出。
 */
export interface ConversationStreamState {
  conversationId: string
  status: 'streaming'
  content: string
  thinking: string
  toolCalls: ToolCall[]
  thinkingStartAt: number | null
  thinkingDurationMs: number
  optimisticUserMessage: string | null
  optimisticFiles: MessageFile[]
  startedAt: number
}

const EMPTY_TOOL_CALLS: ToolCall[] = []
const EMPTY_MESSAGE_FILES: MessageFile[] = []

/** 没有活跃流时的稳定快照，供细粒度 Zustand selector 复用。 */
export const EMPTY_CONVERSATION_STREAM: Readonly<ConversationStreamState> = Object.freeze({
  conversationId: '',
  status: 'streaming',
  content: '',
  thinking: '',
  toolCalls: EMPTY_TOOL_CALLS,
  thinkingStartAt: null,
  thinkingDurationMs: 0,
  optimisticUserMessage: null,
  optimisticFiles: EMPTY_MESSAGE_FILES,
  startedAt: 0,
})

/**
 * 从聊天 Store 读取一个会话的流式快照。
 *
 * 没有流时始终返回同一对象，避免其他会话更新导致当前消息列表无意义重渲染。
 */
export function selectConversationStream(
  state: Pick<ChatStreamState, 'streams'>,
  conversationId: string | null | undefined
): ConversationStreamState | Readonly<ConversationStreamState> {
  if (!conversationId) return EMPTY_CONVERSATION_STREAM
  return state.streams[conversationId] ?? EMPTY_CONVERSATION_STREAM
}

/** 聊天流式状态 Store。 */
export interface ChatStreamState {
  /** 以会话 ID 索引的全部运行中流。 */
  streams: Record<string, ConversationStreamState>

  /** 创建或重置指定会话的流式快照。 */
  startStreaming(
    conversationId: string,
    userContent: string | null,
    files?: readonly MessageFile[]
  ): void
  /** 追加指定会话的正文增量。 */
  appendToken(conversationId: string, token: string): void
  /** 追加指定会话的思考增量。 */
  appendThink(conversationId: string, token: string): void
  /** 记录指定会话的一次工具调用开始。 */
  startToolCall(conversationId: string, toolCall: ToolCall): void
  /** 合并指定会话内工具调用的字段。 */
  updateToolCall(conversationId: string, id: string, patch: Partial<ToolCall>): void
  /** 向指定会话内工具调用的参数追加片段。 */
  appendToolCallArgs(conversationId: string, id: string, chunk: string): void
  /** 修改指定会话内工具调用的状态。 */
  setToolCallStatus(conversationId: string, id: string, status: ToolCallStatus): void
  /** 移除指定会话的流式快照。省略 ID 时用于测试环境重置全部状态。 */
  finalizeStream(conversationId?: string): void
}

/**
 * 基于当前快照更新一个会话，不存在的会话会被安全忽略。
 */
function updateConversationStream(
  state: ChatStreamState,
  conversationId: string,
  update: (stream: ConversationStreamState) => ConversationStreamState
): Pick<ChatStreamState, 'streams'> | Record<string, never> {
  const current = state.streams[conversationId]
  if (!current) return {}
  return { streams: { ...state.streams, [conversationId]: update(current) } }
}

export const useChatStore = create<ChatStreamState>()((set) => ({
  streams: {},

  startStreaming: (conversationId, userContent, files = []) =>
    set((state) => ({
      streams: {
        ...state.streams,
        [conversationId]: {
          conversationId,
          status: 'streaming',
          content: '',
          thinking: '',
          toolCalls: [],
          thinkingStartAt: null,
          thinkingDurationMs: 0,
          optimisticUserMessage: userContent,
          optimisticFiles: [...files],
          startedAt: Date.now(),
        },
      },
    })),

  appendToken: (conversationId, token) =>
    set((state) =>
      updateConversationStream(state, conversationId, (stream) => {
        const shouldClose = stream.thinkingStartAt !== null && stream.thinkingDurationMs === 0
        return {
          ...stream,
          content: stream.content + token,
          ...(shouldClose
            ? { thinkingDurationMs: Date.now() - (stream.thinkingStartAt ?? Date.now()) }
            : {}),
        }
      })
    ),

  appendThink: (conversationId, token) =>
    set((state) =>
      updateConversationStream(state, conversationId, (stream) => ({
        ...stream,
        thinking: stream.thinking + token,
        thinkingStartAt: stream.thinkingStartAt ?? Date.now(),
      }))
    ),

  startToolCall: (conversationId, toolCall) =>
    set((state) =>
      updateConversationStream(state, conversationId, (stream) => ({
        ...stream,
        toolCalls: [...stream.toolCalls, toolCall],
      }))
    ),

  updateToolCall: (conversationId, id, patch) =>
    set((state) =>
      updateConversationStream(state, conversationId, (stream) => ({
        ...stream,
        toolCalls: stream.toolCalls.map((toolCall) =>
          toolCall.id === id ? { ...toolCall, ...patch } : toolCall
        ),
      }))
    ),

  appendToolCallArgs: (conversationId, id, chunk) =>
    set((state) =>
      updateConversationStream(state, conversationId, (stream) => ({
        ...stream,
        toolCalls: stream.toolCalls.map((toolCall) =>
          toolCall.id === id ? { ...toolCall, arguments: toolCall.arguments + chunk } : toolCall
        ),
      }))
    ),

  setToolCallStatus: (conversationId, id, status) =>
    set((state) =>
      updateConversationStream(state, conversationId, (stream) => ({
        ...stream,
        toolCalls: stream.toolCalls.map((toolCall) =>
          toolCall.id === id ? { ...toolCall, status } : toolCall
        ),
      }))
    ),

  finalizeStream: (conversationId) =>
    set((state) => {
      if (!conversationId) return { streams: {} }
      if (!(conversationId in state.streams)) return {}
      const { [conversationId]: _removed, ...streams } = state.streams
      return { streams }
    }),
}))
