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

/** 文件预览内容，均由后端按大小上限裁剪。 */
export interface FilePreview {
  id: string
  filename: string
  mimeType: string
  url: string
  kind: 'image' | 'pdf' | 'text' | 'table' | 'unsupported'
  supported: boolean
  text?: string
  rows?: string[][]
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

/** 可以作为扫码登录目标的客户端平台。 */
export type QrLoginTargetPlatform = 'web' | 'desktop'

/** 扫码登录挑战在其生命周期中暴露的状态。 */
export type QrLoginStatus = 'pending' | 'approved' | 'denied' | 'consumed' | 'expired'

/** 目标端创建二维码挑战时发送的公开设备信息。 */
export interface CreateQrLoginChallengeInput {
  targetPlatform: QrLoginTargetPlatform
  deviceName: string
  /** 仅限与服务端预配置地址相同的开发环境覆盖值。 */
  apiBaseUrl?: string
}

/** 目标端持有的短时挑战和独立轮询凭据。 */
export interface QrLoginChallenge {
  challenge: string
  /** 绝不能进入二维码、日志、持久化存储或 URL。 */
  pollSecret: string
  qrDataUri: string
  expiresAt: string
  pollAfterMs: number
}

/** 目标端轮询挑战时收到的最小状态响应。 */
export interface QrLoginStatusResponse {
  status: QrLoginStatus
  expiresAt: string
  /** 仅在挑战获批后出现，且只能成功交换一次。 */
  authorizationCode: string | null
}

/** 已登录手机在确认前可见的目标设备摘要。 */
export interface QrLoginInspection {
  targetPlatform: QrLoginTargetPlatform
  deviceName: string
  expiresAt: string
  status: QrLoginStatus
}

/** 目标端使用批准结果兑换常规认证会话的请求。 */
export interface ExchangeQrLoginChallengeInput {
  challenge: string
  pollSecret: string
  authorizationCode: string
}

/** 从相机数据解析出的无敏感令牌扫码地址。 */
export interface ParsedQrLoginPayload {
  challenge: string
  apiBaseUrl: string
}

/** 仅为单个扫码请求指定的 API 地址，不会改变应用全局运行时配置。 */
export interface QrLoginRequestScope {
  apiBaseUrl?: string
}

// ============ 会话 ============

/** 会话标题的最终来源。 */
export type ConversationTitleSource = 'default' | 'fallback' | 'ai' | 'manual'

/** 对话会话（侧边栏列表项） */
export interface Conversation {
  id: string
  title: string
  /** 标题是否由首问回退、Agnes 或用户手动改名得到。 */
  titleSource: ConversationTitleSource
  /** 标题最近一次确定的时间；新建空会话为 null。 */
  titleGeneratedAt: string | null
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

/** 可恢复媒体生成任务的类型。 */
export type MediaGenerationType = 'image' | 'video' | 'music'

/** 可恢复媒体生成任务的稳定生命周期状态。 */
export type MediaGenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'

/** Agnes Image 2.1 Flash 的受支持清晰度档位。 */
export type MediaImageSize = '1K' | '2K' | '3K' | '4K'

/** Agnes Image 2.1 Flash 的受支持画幅比例。 */
export type MediaImageRatio = '1:1' | '3:4' | '4:3' | '16:9' | '9:16' | '2:3' | '3:2' | '21:9'

/** Agnes Video V2.0 在本应用暴露的画幅比例。 */
export type MediaVideoAspectRatio = '3:2' | '16:9' | '9:16' | '1:1' | '4:3' | '3:4'

/** Agnes Video V2.0 在本应用暴露的分辨率档位。 */
export type MediaVideoResolution = '480p' | '720p' | '1080p'

/** Agnes Video V2.0 的受限时长预设，后端会转换为有效的 `8n + 1` 帧数。 */
export type MediaVideoDurationSeconds = 3 | 5 | 10 | 18

/** 本应用音乐生成的固定时长；歌词模式由本机 ACE-Step 负责演唱。 */
export const MediaMusicDurationSeconds = 30 as const

/** 媒体任务的已校验规格，字段由任务类型决定。 */
export interface MediaGenerationOptions {
  size?: MediaImageSize
  ratio?: MediaImageRatio
  aspectRatio?: MediaVideoAspectRatio
  resolution?: MediaVideoResolution
  durationSeconds?: MediaVideoDurationSeconds | typeof MediaMusicDurationSeconds
  /** 音乐模式的歌词；为空时使用纯音乐 provider。 */
  lyrics?: string
}

/** 创建媒体任务所需的跨端输入，不包含任何 provider URL 或本地路径。 */
export interface CreateMediaGenerationTaskInput {
  conversationId: string
  type: MediaGenerationType
  prompt: string
  options?: MediaGenerationOptions
  /** 仅接受当前用户已经上传的图片文件 ID。 */
  sourceFileIds?: string[]
}

/** 后端持久化并关联到 assistant 消息卡的媒体生成任务。 */
export interface MediaGenerationTask {
  id: string
  conversationId: string
  messageId: string
  /** 发起此任务的用户消息；旧任务迁移失败时可为空。 */
  sourceMessageId: string | null
  type: MediaGenerationType
  model:
    'agnes-image-2.1-flash' | 'agnes-video-v2.0' | 'musicgen-small-local' | 'ace-step-v15-local'
  prompt: string
  options: MediaGenerationOptions
  /** 仅用于恢复任务的引用标识，不包含对象存储路径。 */
  sourceFileIds: string[]
  status: MediaGenerationStatus
  progress: number
  resultUrl: string | null
  /** 视频首帧封面；图片和旧任务可以为空。 */
  resultPosterUrl: string | null
  resultMimeType: string | null
  resultWidth: number | null
  resultHeight: number | null
  resultDurationSeconds: number | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

/** 工具调用的执行状态 */
export type ToolCallStatus = 'pending' | 'running' | 'done' | 'error'

/** 联网搜索工具向用户展示的安全来源。 */
export interface SearchSource {
  title: string
  url: string
  snippet: string
  provider: 'searxng' | 'brave' | 'tavily'
}

/** 当前会话可用的联网搜索配置，不包含 endpoint 和任何密钥。 */
export interface SearchCapability {
  enabled: boolean
  provider: 'searxng' | 'brave' | 'tavily' | null
  reason: 'disabled' | 'unavailable' | null
}

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
  /** 搜索成功后的来源列表，仅由后端净化后返回。 */
  sources?: SearchSource[]
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
   * 仅重新生成产生的用户消息会指向原始用户问题。
   * 普通重复提问始终为 null/undefined，不能据内容相同推断为一个版本。
   */
  regeneratedFromMessageId?: string | null
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
  /** 已完成工具调用；用于会话重载后恢复来源链接。 */
  toolCalls?: ToolCall[]
  /** 持久化媒体任务卡；普通 assistant 消息为 null 或未提供。 */
  mediaTask?: MediaGenerationTask | null
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

/** 后端成功转写一段音频后的统一响应。 */
export interface VoiceTranscriptionResponse {
  /** 已清理首尾空白的最终转写文本。 */
  text: string
  /** Provider 返回的语言标识；当前无法判断时为 null。 */
  language: string | null
  /** 后端通过受限媒体探测得到的音频时长，单位为秒。 */
  durationSeconds: number
}

/** 语音输入控件的互斥生命周期状态。 */
export type VoiceInputStatus = 'idle' | 'listening' | 'recording' | 'transcribing' | 'error'

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
  /** 搜索成功后的安全来源。 */
  sources?: SearchSource[]
}

/** SSE 流结束事件 */
export interface SSEMessageEnd {
  type: 'message_end'
  tokensUsed: number
  finishReason: string
}

/** 会话标题更新事件，首问回退与 Agnes 生成均通过此事件同步侧栏缓存。 */
export interface SSEConversationTitle {
  type: 'conversation_title'
  conversationId: string
  title: string
  titleSource: ConversationTitleSource
  titleGeneratedAt: string
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
  | SSEConversationTitle
  | SSEMessageEnd
  | SSEError

/** Agent Run 生命周期状态。 */
export type AgentRunStatus =
  'queued' | 'running' | 'waiting_approval' | 'waiting_input' | 'succeeded' | 'failed' | 'cancelled'
/** 用户拥有的 Agent 助理。 */
export interface Assistant {
  id: string
  userId: string
  name: string
  description: string
  instructions: string
  defaultModel: string
  autonomyLevel: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}
/** Agent Run 摘要。 */
export interface AgentRun {
  id: string
  userId: string
  assistantId: string
  conversationId: string | null
  parentRunId: string | null
  goal: string
  status: AgentRunStatus
  model: string
  maxSteps: number
  currentStep: number
  idempotencyKey: string | null
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: string
  errorCode: string | null
  errorMessage: string | null
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}
/** 运营侧脱敏 Agent Run 摘要。 */
export interface AdminAgentRun {
  id: string
  status: AgentRunStatus
  model: string
  currentStep: number
  errorCode: string | null
  createdAt: string
  updatedAt?: string
}
/** Agent Run 内的一步执行记录。 */
export interface AgentStep {
  id: string
  runId: string
  sequence: number
  kind: string
  status: string
  inputJson: Record<string, unknown> | null
  outputJson: Record<string, unknown> | null
  errorCode: string | null
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
}
/** 可通过 SSE 重放的 Agent 事件。 */
export interface AgentEvent {
  id: number
  runId: string
  sequence: number
  eventType: string
  payload: Record<string, unknown>
  createdAt: string
}
/** 脱敏审批请求。 */
export interface ApprovalRequest {
  id: string
  /** 绑定 Agent Run 的审批有值；独立工具审批为 null。 */
  runId: string | null
  /** 绑定 Agent Step 的审批有值；独立工具审批为 null。 */
  stepId: string | null
  userId: string
  toolName: string
  executionLocation: string
  riskLevel: string
  actionSummary: string
  argumentsPreview: Record<string, unknown>
  payloadHash: string
  status: string
  expiresAt: string
  decidedAt: string | null
  decisionNote: string | null
  createdAt: string
}

// ============ 工具运行时（Tool Runtime） ============

/** 工具风险等级（后端 ToolRisk 枚举）。 */
export type ToolRiskLevel =
  | 'read'
  | 'local_write'
  | 'reversible_write'
  | 'external_side_effect'
  | 'destructive'
  | 'financial'
  | 'privileged'

/** 工具执行请求允许的位置；目录展示还可能出现 `either`（两端皆可）。 */
export type ToolExecutionLocation = 'cloud' | 'desktop'

/** 工具执行生命周期状态（后端 ToolExecutionStatus 枚举）。 */
export type ToolExecutionStatus =
  'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'

/** 桌面执行节点状态（后端 ExecutionNodeStatus 枚举）。 */
export type ExecutionNodeStatus = 'offline' | 'online' | 'revoked' | 'update_required'

/** 工具连接的凭证或服务类型（后端 ToolConnectionKind 枚举）。 */
export type ToolConnectionKind = 'oauth' | 'api_key' | 'mcp_http' | 'mcp_stdio' | 'desktop_local'

/** 客户端工具目录项（GET /tools/catalog），不含任何密钥。 */
export interface ToolCatalogItem {
  name: string
  version: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown> | null
  riskLevel: ToolRiskLevel
  sideEffect: string
  executionLocation: ToolExecutionLocation | 'either'
  executionLocations: string[]
  requiredScopes: string[]
  timeoutSeconds: number
  maxOutputBytes: number
  idempotent: boolean
  supportsCancel: boolean
  tags: string[]
}

/** 用户连接的安全响应（POST/GET /tool-connections），永不包含明文凭证。 */
export interface ToolConnection {
  id: string
  userId: string
  kind: ToolConnectionKind
  provider: string
  displayName: string
  secretRef: string | null
  scopes: string[]
  status: string
  metadata: Record<string, unknown>
  lastVerifiedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 工具结果引用的外置 Artifact；字段由后端 ToolResult 契约按 snake_case 原样返回。 */
export interface ToolResultArtifactRef {
  id: string
  name: string
  kind: string
  mime_type: string
  size_bytes: number
  sha256: string
}

/** 工具结果中的可信来源引用。 */
export interface ToolResultCitation {
  title: string
  url: string
  snippet: string
}

/** 一次工具执行的非敏感性能指标；字段由后端契约按 snake_case 原样返回。 */
export interface ToolResultMetrics {
  duration_ms: number
  output_bytes: number
}

/** 可安全序列化到工具结果中的错误信息。 */
export interface ToolResultError {
  code: string
  message: string
}

/**
 * 受控工具的统一结果载荷（后端 ToolResult 契约，JSON 字段为 snake_case）。
 * 注意：`ToolExecution.resultJson` 标准形状是本类型，但部分原始工具/MCP 结果
 * 可能未经统一包装直接写入，消费前请先判别。
 */
export interface ToolResultPayload {
  status: 'succeeded' | 'failed' | 'cancelled' | 'partial'
  summary: string
  data: Record<string, unknown> | unknown[] | null
  artifacts: ToolResultArtifactRef[]
  citations: ToolResultCitation[]
  metrics: ToolResultMetrics
  error: ToolResultError | null
}

/** 工具执行审计快照（POST/GET /tool-executions、POST /mcp-servers/:id/execute）。 */
export interface ToolExecution {
  id: string
  userId: string
  runId: string | null
  stepId: string | null
  toolName: string
  toolVersion: string
  connectionId: string | null
  mcpServerId: string | null
  /** 执行位置：`cloud` / `desktop`，MCP 远程执行为 `mcp_remote`。 */
  executionLocation: string
  nodeId: string | null
  /** 后端 schema 为自由字符串：目录枚举见 {@link ToolRiskLevel}，MCP 工具还可能是 `high`。 */
  riskLevel: string
  sideEffect: string
  argumentsPreview: Record<string, unknown>
  argumentsHash: string
  idempotencyKey: string | null
  status: ToolExecutionStatus
  resultSummary: string | null
  resultJson: ToolResultPayload | Record<string, unknown> | null
  artifactIds: string[]
  errorCode: string | null
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
  nodeDeliveryStatus: string | null
  nodeProgress: number | null
  nodeLastDeliveredAt: string | null
  nodeAcknowledgedAt: string | null
  createdAt: string
}

/** Artifact 元数据和短期访问地址（GET/DELETE /artifacts）。 */
export interface ArtifactMeta {
  id: string
  userId: string
  runId: string | null
  toolExecutionId: string | null
  kind: string
  name: string
  mimeType: string
  sizeBytes: number
  sha256: string
  sensitivity: string
  retentionPolicy: string
  expiresAt: string | null
  preview: Record<string, unknown> | null
  downloadUrl: string
  createdAt: string
}

/**
 * 桌面执行节点的云端策略；后端 JSONB 里以 snake_case 键原样存储并返回。
 * `allowed_tools` 与节点 capabilities 取交集生效，`allowed_resource_ids` 对应本机资源授权。
 */
export interface ExecutionNodePolicy {
  allowed_tools: string[]
  allowed_resource_ids: string[]
}

/** 桌面执行节点的安全响应（GET /execution-nodes、POST .../revoke）。 */
export interface ExecutionNode {
  id: string
  userId: string
  name: string
  platform: string
  appVersion: string
  capabilities: string[]
  status: ExecutionNodeStatus
  lastSeenAt: string | null
  policy: ExecutionNodePolicy
  createdAt: string
  updatedAt: string
}

/** 创建配对挑战的响应：节点信息附加仅显示一次的配对码与过期时间。 */
export interface ExecutionNodePairing extends ExecutionNode {
  pairingCode: string
  expiresAt: string
}

/** 节点登记成功后获得的短期会话凭证（POST /execution-nodes/register）。 */
export interface ExecutionNodeRegistration {
  nodeId: string
  userId: string
  nodeToken: string
  expiresAt: string
  protocolVersion: string
}

/** 节点令牌续期结果（POST /execution-nodes/token）。 */
export interface ExecutionNodeTokenRenewal {
  nodeId: string
  nodeToken: string
  expiresAt: string
  protocolVersion: string
}

/** 本机资源授权元数据（POST/GET /resource-grants），不含真实本地路径。 */
export interface ResourceGrant {
  id: string
  userId: string
  nodeId: string
  kind: string
  resourceId: string
  displayName: string
  scopes: string[]
  revokedAt: string | null
  createdAt: string
}

/** MCP schema 快照中单个工具的摘要（由 POST /mcp-servers/:id/discover 生成）。 */
export interface McpToolSummary {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** MCP 协议注解，键名按协议原样保存。 */
  annotations: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
  }
}

/** 远程 MCP Server 的 schema 快照与明确启用的工具集合。 */
export interface McpServer {
  id: string
  userId: string
  connectionId: string | null
  name: string
  endpointUrl: string | null
  command: string | null
  commandArgs: string[]
  transport: 'streamable_http' | 'stdio'
  status: string
  /** 发现得到的 schema 快照，标准形状为 `{ tools: McpToolSummary[] }`。 */
  schemaSnapshot: ({ tools?: McpToolSummary[] } & Record<string, unknown>) | null
  schemaHash: string | null
  enabledTools: string[]
  metadata: Record<string, unknown>
  lastVerifiedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 记忆的生命周期状态。 */
export type MemoryStatus = 'candidate' | 'active' | 'rejected' | 'superseded' | 'expired'

/** 记忆的敏感级别。 */
export type MemorySensitivity = 'public' | 'personal' | 'sensitive' | 'restricted'

/** 记忆的类型。 */
export type MemoryType = 'profile' | 'preference' | 'semantic' | 'episodic'

/** 记忆候选的创建参数。 */
export interface MemoryCreateCandidate {
  content: string
  memoryType: MemoryType
  assistantId: string
  sensitivity?: MemorySensitivity
  workspaceId?: string | null
  sourceType?: string
  sourceId?: string | null
  sourceExcerpt?: string | null
  confidence?: number
  storageLocation?: 'cloud' | 'local_node'
  structuredData?: Record<string, unknown> | null
  validUntil?: string | null
}

/** 记忆资源及其来源和生命周期信息。 */
export interface Memory {
  id: string
  userId: string
  assistantId: string
  workspaceId: string | null
  memoryType: MemoryType
  content: string
  structuredData: Record<string, unknown> | null
  sourceType: string
  sourceId: string | null
  sourceExcerpt: string | null
  confidence: number
  sensitivity: MemorySensitivity
  storageLocation: 'cloud' | 'local_node'
  status: MemoryStatus
  validFrom: string | null
  validUntil: string | null
  lastUsedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 更新记忆内容或生命周期状态的参数。 */
export interface MemoryUpdate {
  content?: string
  structuredData?: Record<string, unknown> | null
  confidence?: number
  sensitivity?: MemorySensitivity
  status?: MemoryStatus
  validFrom?: string | null
  validUntil?: string | null
}

/** 记忆检索结果，保留排序分数和来源信息。 */
export interface MemorySearchResult {
  id: string
  assistantId: string
  workspaceId: string | null
  memoryType: MemoryType
  content: string
  sourceType: string
  sourceId: string | null
  sourceExcerpt: string | null
  confidence: number
  sensitivity: MemorySensitivity
  status: MemoryStatus
  score: number
}

/** 注入 Agent 上下文的记忆条目。 */
export interface MemoryContextItem {
  memoryId: string
  content: string
  sourceType: string
  sourceId: string | null
  score: number
}

/** Skill 版本从草稿到活动的生命周期状态。 */
export type SkillVersionStatus =
  'draft' | 'validating' | 'validated' | 'active' | 'rejected' | 'deprecated'

/** Skill 只能声明且收紧现有工具的风险上限。 */
export type SkillRiskCeiling =
  | 'read'
  | 'local_write'
  | 'reversible_write'
  | 'external_side_effect'
  | 'destructive'
  | 'financial'
  | 'privileged'

/** 已安装 Skill 的用户可见范围。 */
export type SkillInstallationScope = 'global' | 'assistant'

/** 不可变 Skill 版本的 manifest、指令和验证记录。 */
export interface SkillVersion {
  id: string
  skillId: string
  version: string
  manifestText: string
  skillMd: string
  contentHash: string
  requiredTools: string[]
  riskCeiling: SkillRiskCeiling
  status: SkillVersionStatus
  validationResult: Record<string, unknown> | null
  validationErrors: string[]
  createdAt: string
  validatedAt: string | null
}

/** 用户为活动 Skill 选择的安装范围。 */
export interface SkillInstallation {
  id: string
  skillId: string
  scope: SkillInstallationScope
  assistantId: string | null
  createdAt: string
}

/** 一个稳定 Skill 身份及其可审计版本列表。 */
export interface Skill {
  id: string
  userId: string
  slug: string
  name: string
  description: string
  currentVersionId: string | null
  versions: SkillVersion[]
  installations: SkillInstallation[]
  createdAt: string
  updatedAt: string
}

/** 创建 Skill 首个草稿版本所需的声明内容。 */
export interface SkillDraft {
  manifest: string
  skillMd: string
}

/** 更新 Skill 安装范围所需的输入。 */
export interface SkillInstallationUpdate {
  scope: SkillInstallationScope
  assistantId?: string
}

export * from './knowledge'
