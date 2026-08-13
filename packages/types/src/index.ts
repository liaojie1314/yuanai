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
  /** 个人简介，未填写时为 null */
  bio?: string | null
  /** 上次修改密码时间；从未修改时为 null */
  passwordChangedAt?: string | null
  /** 已关联的 GitHub 用户 ID；未绑定为 null */
  githubId?: string | null
  /** 已关联的 Google 用户 ID（OpenID sub）；未绑定为 null */
  googleId?: string | null
  createdAt: string
}

/** 浏览器 Web Push 订阅（`PushSubscription.toJSON()` 的结构） */
export interface PushSubscriptionPayload {
  /** 推送服务分配的端点 URL */
  endpoint: string
  /** 客户端加密公钥对 */
  keys: {
    /** ECDH 公钥（base64url） */
    p256dh: string
    /** auth secret（base64url） */
    auth: string
  }
}

/** 移动端 Expo Push token 上报体（POST /notifications/expo） */
export interface ExpoPushTokenPayload {
  /** Expo Push Service 分配的 token，形如 `ExponentPushToken[xxxx]` */
  token: string
  /** RN Platform.OS：'ios' | 'android' */
  platform: string
}

/** 服务端文件引用 */
export interface FileRef {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  url: string
  fileHash?: string | null
  createdAt: string
}

/** 用户使用统计 */
export interface UserStats {
  conversationCount: number
  totalTokens: number
  fileCount: number
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

/** 工具调用的执行状态 */
export type ToolCallStatus = 'pending' | 'running' | 'done' | 'error'

/**
 * AI 一次工具调用的完整生命周期数据。
 *
 * 用于在思考块中展示"调用了什么工具、传了什么参数、执行状态、返回结果"。
 */
export interface ToolCall {
  /** 工具调用 ID（由后端分配） */
  id: string
  /** 工具名，例如 `search_web`、`read_docs` */
  name: string
  /**
   * 调用参数（原始 JSON 字符串）。
   * 使用字符串是因为参数在流式过程中会分片写入，最终解析在渲染层完成。
   */
  arguments: string
  /** 当前执行状态 */
  status: ToolCallStatus
  /** 执行结果摘要，`status === 'done'` 时提供 */
  result?: string
  /** 出错时的错误提示 */
  error?: string
  /** 执行耗时（毫秒） */
  durationMs?: number
}

/** 文本片段 part */
export interface TextPart {
  type: 'text'
  content: string
}

/** 代码片段 part */
export interface CodePart {
  type: 'code'
  /** 语言，例如 `typescript`、`html`、`css`、`javascript` */
  lang: string
  code: string
  /** 可选标题，展示在 artifact 面板顶部 */
  title?: string
}

/** 推理/思考 part（chain-of-thought 或 reasoning tokens） */
export interface ThinkingPart {
  type: 'thinking'
  content: string
  /** 思考耗时（毫秒），流结束后填充 */
  durationMs?: number
}

/** 工具调用 part（引用一个 ToolCall） */
export interface ToolCallPart {
  type: 'tool_call'
  toolCall: ToolCall
}

/** 多模态资源 part（图片/音频/视频） */
export interface MediaPart {
  type: 'media'
  mediaType: 'image' | 'audio' | 'video'
  url: string
  /** 描述文案 / caption */
  caption?: string
  /** 图片/视频的宽（像素），可选 */
  width?: number
  /** 图片/视频的高（像素），可选 */
  height?: number
  /** 音频/视频时长（秒），可选 */
  durationSec?: number
}

/**
 * 消息 part 判别联合：一条消息可以由多种 part 组成
 * （文字 / 代码 / 思考 / 工具调用 / 多媒体）。
 */
export type MessagePart = TextPart | CodePart | ThinkingPart | ToolCallPart | MediaPart

/** 单条聊天消息 */
export interface Message {
  id: string
  role: Role
  content: string
  /**
   * 结构化 parts 列表；后端未提供时前端降级为 `[{ type: 'text', content }]`。
   * 后端支持工具调用/多模态后填充此字段。
   */
  messageParts?: MessagePart[]
  /** AI 思考/推理过程文字（仅 assistant 消息，模型不支持时为 null） */
  thinkingContent?: string | null
  /** AI 思考耗时（毫秒）— 首个 reasoning token → 首个 content token 的间隔 */
  thinkingDurationMs?: number | null
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
  /** 模型用途；默认 chat，媒体模型由专用任务 API 调用。 */
  capability?: 'chat' | 'image_generation' | 'video_generation'
  /** 官方公布的价格，单位为每百万 token 的人民币元。 */
  pricing?: {
    inputCachedCnyPerMillion?: number
    inputUncachedCnyPerMillion?: number
    outputCnyPerMillion?: number
  }
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

/** SSE 思考/推理增量事件 —— 每次推送一段思考文字 */
export interface SSEThinkingDelta {
  type: 'thinking_delta'
  token: string
}

/** SSE 工具调用开始事件 */
export interface SSEToolCallStart {
  type: 'tool_call_start'
  toolCallId: string
  name: string
}

/** SSE 工具调用参数增量事件 —— 每次追加一段参数片段 */
export interface SSEToolCallDelta {
  type: 'tool_call_delta'
  toolCallId: string
  /** 参数分片；组件将其拼接到 arguments 后 */
  argsChunk: string
}

/** SSE 工具调用结束事件 */
export interface SSEToolCallEnd {
  type: 'tool_call_end'
  toolCallId: string
  status: ToolCallStatus
  /** 完整执行结果摘要（`status === 'done'`） */
  result?: string
  /** 出错原因（`status === 'error'`） */
  error?: string
  durationMs?: number
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
export type SSEEvent =
  | SSEMessageStart
  | SSEContentDelta
  | SSEThinkingDelta
  | SSEToolCallStart
  | SSEToolCallDelta
  | SSEToolCallEnd
  | SSEMessageEnd
  | SSEError
