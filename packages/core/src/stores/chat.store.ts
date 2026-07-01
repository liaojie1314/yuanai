import { create } from 'zustand'

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
  group: ConvGroup
  updatedAt: number
}

export type MessageRole = 'user' | 'assistant'

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
  thinkContent?: string
  followUps?: string[]
  createdAt: number
}

/**
 * 聊天流式状态 Store（Zustand）。
 *
 * 仅维护实时流式输出所需的瞬态 UI 状态；
 * 会话列表与历史消息由 TanStack Query 缓存管理。
 */
interface ChatStreamState {
  /** 当前正在流式输出的会话 ID */
  streamingConvId: string | null
  /** 已累积的流式输出文本 */
  streamingContent: string
  /** 发送中用户消息的内容（乐观展示，流结束后由查询结果替换） */
  optimisticUserMsg: string | null

  /**
   * 开始流式输出：记录目标会话 ID 并保存乐观用户消息。
   * @param convId - 目标会话 ID
   * @param userContent - 用户发送的消息内容
   */
  startStreaming: (convId: string, userContent: string) => void

  /**
   * 追加一个流式 token 到累积内容。
   * @param token - SSE content_delta 事件中的文本片段
   */
  appendToken: (token: string) => void

  /** 完成流式输出：清空所有流式状态 */
  finalizeStream: () => void
}

export const useChatStore = create<ChatStreamState>()((set) => ({
  streamingConvId: null,
  streamingContent: '',
  optimisticUserMsg: null,

  startStreaming: (convId, userContent) =>
    set({ streamingConvId: convId, streamingContent: '', optimisticUserMsg: userContent }),

  appendToken: (token) => set((s) => ({ streamingContent: s.streamingContent + token })),

  finalizeStream: () =>
    set({ streamingConvId: null, streamingContent: '', optimisticUserMsg: null }),
}))
