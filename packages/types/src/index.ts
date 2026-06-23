// ============ 枚举 ============
export enum Role {
  User = 'user',
  Assistant = 'assistant',
  System = 'system',
}

// ============ 用户 ============
export interface User {
  id: string
  email: string
  username: string
  avatarUrl: string | null
  createdAt: string
}

// ============ 认证 ============
export interface AuthResponse {
  access_token: string
  refresh_token: string
  token_type: string
  user: User
}

// ============ 会话 ============
export interface Conversation {
  id: string
  title: string
  model: string
  isPinned: boolean
  lastMessageAt: string | null
  createdAt: string
}

// ============ 消息 ============
export interface MessageFile {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  url: string
}

export interface Message {
  id: string
  role: Role
  content: string
  model?: string
  tokensUsed?: number
  files: MessageFile[]
  createdAt: string
}

// ============ 模型 ============
export interface AIModel {
  id: string
  name: string
  provider: string
  description: string
  supportsVision: boolean
  supportsFiles: boolean
  contextLength: number
  isDefault: boolean
}

// ============ API 响应 ============
export interface PaginatedResponse<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
}

export interface ApiError {
  code: string
  message: string
  detail?: string | null
}

// ============ SSE 事件 ============
export interface SSEMessageStart {
  type: 'message_start'
  userMessageId: string
  assistantMessageId: string
  model: string
}

export interface SSEContentDelta {
  type: 'content_delta'
  token: string
}

export interface SSEMessageEnd {
  type: 'message_end'
  tokensUsed: number
  finishReason: string
}

export interface SSEError {
  type: 'error'
  code: string
  message: string
}

export type SSEEvent = SSEMessageStart | SSEContentDelta | SSEMessageEnd | SSEError
