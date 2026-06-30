// ============ 枚举 ============

/** 消息角色枚举 */
export enum Role {
  /** 用户发送的消息 */
  User = 'user',
  /** AI 助手回复的消息 */
  Assistant = 'assistant',
  /** 系统消息，用于设置对话上下文 */
  System = 'system',
}

// ============ 用户 ============

/** 已登录用户的基本信息 */
export interface User {
  id: string
  email: string
  username: string
  /** 头像 URL；用户未上传时为 null */
  avatarUrl: string | null
  createdAt: string
}

// ============ 认证 ============

/** 登录/注册成功后的响应体 */
export interface AuthResponse {
  access_token: string
  refresh_token: string
  /** 固定为 "bearer" */
  token_type: string
  user: User
}

// ============ 会话 ============

/** 对话会话（侧边栏列表项） */
export interface Conversation {
  id: string
  title: string
  /** 当前会话绑定的 AI 模型 ID */
  model: string
  isPinned: boolean
  /** 最后一条消息的时间；尚无消息时为 null */
  lastMessageAt: string | null
  createdAt: string
}

// ============ 消息 ============

/** 消息中携带的附件文件 */
export interface MessageFile {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  /** 文件的可访问 URL */
  url: string
}

/** 单条聊天消息 */
export interface Message {
  id: string
  role: Role
  content: string
  /** 生成该消息使用的模型；用户消息无此字段 */
  model?: string
  /** 本次响应消耗的 token 总量；用户消息无此字段 */
  tokensUsed?: number
  files: MessageFile[]
  createdAt: string
}

// ============ 模型 ============

/** 可选 AI 模型的配置信息 */
export interface AIModel {
  id: string
  name: string
  provider: string
  description: string
  /** 是否支持图片/视觉输入 */
  supportsVision: boolean
  /** 是否支持文件上传（PDF、文档等） */
  supportsFiles: boolean
  /** 最大上下文窗口（token 数） */
  contextLength: number
  /** 是否为新用户的默认选中模型 */
  isDefault: boolean
}

// ============ API 响应 ============

/** 通用分页列表响应体 */
export interface PaginatedResponse<T> {
  items: T[]
  /** 下一页游标；已到末尾时为 null */
  nextCursor: string | null
  hasMore: boolean
}

/** 后端统一错误响应体 */
export interface ApiError {
  code: string
  message: string
  /** 可选的详细错误描述 */
  detail?: string | null
}

// ============ SSE 事件 ============

/** SSE 流启动事件 —— 返回本轮生成的消息 ID */
export interface SSEMessageStart {
  type: 'message_start'
  userMessageId: string
  assistantMessageId: string
  model: string
}

/** SSE 内容增量事件 —— 每次推送一个 token 片段 */
export interface SSEContentDelta {
  type: 'content_delta'
  token: string
}

/** SSE 流结束事件 */
export interface SSEMessageEnd {
  type: 'message_end'
  tokensUsed: number
  finishReason: string
}

/** SSE 错误事件 */
export interface SSEError {
  type: 'error'
  code: string
  message: string
}

/** SSE 事件联合类型，用于前端 SSE 解析 */
export type SSEEvent = SSEMessageStart | SSEContentDelta | SSEMessageEnd | SSEError
