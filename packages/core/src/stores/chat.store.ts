import { create } from 'zustand'
import type { ToolCall, ToolCallStatus } from '@yuanai/types'

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
  /** 已累积的流式思考文本（reasoning tokens） */
  streamingThink: string
  /** 本轮流式产生的工具调用（有序） */
  streamingToolCalls: ToolCall[]
  /** 思考开始时的时间戳，用于计算耗时 */
  streamingThinkStartAt: number | null
  /** 思考完成时累计的耗时（毫秒） */
  streamingThinkDurationMs: number
  /** 发送中用户消息的内容（乐观展示，流结束后由查询结果替换） */
  optimisticUserMsg: string | null

  /**
   * 开始流式输出：记录目标会话 ID 并保存乐观用户消息。
   * @param convId - 目标会话 ID
   * @param userContent - 用户发送的消息内容；传 null 表示跳过乐观占位（重新生成场景）
   */
  startStreaming: (convId: string, userContent: string | null) => void

  /**
   * 追加一个流式 token 到累积内容。
   * @param token - SSE content_delta 事件中的文本片段
   */
  appendToken: (token: string) => void

  /**
   * 追加一段思考文字。
   * @param token - SSE thinking_delta 事件中的文本片段
   */
  appendThink: (token: string) => void

  /**
   * 记录一次工具调用开始。
   * @param toolCall - 工具调用初始信息
   */
  startToolCall: (toolCall: ToolCall) => void

  /**
   * 更新指定工具调用的字段（例如追加参数、切换状态、写入结果）。
   * @param id - 工具调用 ID
   * @param patch - 需要合并的字段
   */
  updateToolCall: (id: string, patch: Partial<ToolCall>) => void

  /**
   * 向指定工具调用的 `arguments` 追加一段字符串片段。
   * @param id - 工具调用 ID
   * @param chunk - 参数分片
   */
  appendToolCallArgs: (id: string, chunk: string) => void

  /**
   * 修改工具调用状态。
   * @param id - 工具调用 ID
   * @param status - 新状态
   */
  setToolCallStatus: (id: string, status: ToolCallStatus) => void

  /** 完成流式输出：清空所有流式状态 */
  finalizeStream: () => void
}

export const useChatStore = create<ChatStreamState>()((set) => ({
  streamingConvId: null,
  streamingContent: '',
  streamingThink: '',
  streamingToolCalls: [],
  streamingThinkStartAt: null,
  streamingThinkDurationMs: 0,
  optimisticUserMsg: null,

  startStreaming: (convId, userContent) =>
    set({
      streamingConvId: convId,
      streamingContent: '',
      streamingThink: '',
      streamingToolCalls: [],
      streamingThinkStartAt: null,
      streamingThinkDurationMs: 0,
      optimisticUserMsg: userContent,
    }),

  appendToken: (token) =>
    set((s) => {
      // 首次收到正文 token 时，若曾进入思考态则记录耗时（防止无 thinking_delta 场景 NaN）
      const shouldClose = s.streamingThinkStartAt !== null && s.streamingThinkDurationMs === 0
      return {
        streamingContent: s.streamingContent + token,
        ...(shouldClose
          ? { streamingThinkDurationMs: Date.now() - (s.streamingThinkStartAt ?? Date.now()) }
          : {}),
      }
    }),

  appendThink: (token) =>
    set((s) => ({
      streamingThink: s.streamingThink + token,
      streamingThinkStartAt: s.streamingThinkStartAt ?? Date.now(),
    })),

  startToolCall: (toolCall) =>
    set((s) => ({ streamingToolCalls: [...s.streamingToolCalls, toolCall] })),

  updateToolCall: (id, patch) =>
    set((s) => ({
      streamingToolCalls: s.streamingToolCalls.map((tc) =>
        tc.id === id ? { ...tc, ...patch } : tc
      ),
    })),

  appendToolCallArgs: (id, chunk) =>
    set((s) => ({
      streamingToolCalls: s.streamingToolCalls.map((tc) =>
        tc.id === id ? { ...tc, arguments: tc.arguments + chunk } : tc
      ),
    })),

  setToolCallStatus: (id, status) =>
    set((s) => ({
      streamingToolCalls: s.streamingToolCalls.map((tc) => (tc.id === id ? { ...tc, status } : tc)),
    })),

  finalizeStream: () =>
    set({
      streamingConvId: null,
      streamingContent: '',
      streamingThink: '',
      streamingToolCalls: [],
      streamingThinkStartAt: null,
      streamingThinkDurationMs: 0,
      optimisticUserMsg: null,
    }),
}))
