import type { StateStorage } from 'zustand/middleware'

/**
 * SSE 通道传入的一条已解析事件。
 *
 * 适配器（Web `fetch` / Mobile `react-native-sse`）自行解析原始 SSE 帧，
 * 把 `event:` + `data:` 对拼装成 {@link SseMessage} 后再交给消费方，
 * 这样上层 `useStream` 不需要关心传输层格式。
 */
export interface SseMessage {
  /** SSE `id:` 游标，用于 Agent 事件去重和断线重连。 */
  id?: string
  /** SSE event 名，例如 `content_delta`、`thinking_delta`、`tool_call_start` */
  event: string
  /** SSE data 原始字符串（通常是 JSON 序列化的 payload） */
  data: string
}

/**
 * 平台适配器提交给流式 hook 的请求描述，字段最小化以便 Web / Mobile 各自映射到自己的传输原语。
 */
export interface StreamRequest {
  /** 完整 URL，包含 `API_BASE_URL` 前缀 */
  url: string
  /** HTTP method，SSE 端点全部是 POST，仍保留字段以便未来扩展 */
  method: 'POST' | 'GET'
  /** 请求头，`Content-Type` / `Authorization` 由调用方拼好 */
  headers: Record<string, string>
  /** 请求体（JSON 字符串），GET 时为 undefined */
  body?: string
}

/** 平台适配器返回给 hook 的 SSE 生命周期回调 */
export interface StreamHandlers {
  /** 连接成功建立（HTTP 头收到）时触发；可选 */
  onOpen?: () => void
  /** 收到一条已解析的 SSE 事件；未识别事件也会转发 */
  onMessage: (msg: SseMessage) => void
  /** 传输层错误（网络断开、HTTP 非 2xx、解析失败）；主动 abort 不视作错误 */
  onError: (err: Error) => void
  /** 流正常结束或被 close 时触发；先于 Promise 完成 */
  onClose?: () => void
}

/** 平台适配器返回的流句柄，`close()` 用于主动中断 */
export interface StreamHandle {
  close: () => void
}

/**
 * 平台适配器接口。
 *
 * `@yuanai/core` 内所有会碰到浏览器 / 原生差异的原语都收敛到这里，
 * Web (`apps/web`) 与 Mobile (`apps/mobile`) 在入口分别 `setPlatformAdapter(...)`
 * 就能各自复用同一份 hooks / stores。
 */
export interface PlatformAdapter {
  /**
   * 建立 SSE 长连接。返回句柄可用于主动 close。
   *
   * 适配器需在 close 或流结束时准确调用 `onClose`；
   * 主动 close 不应触发 `onError`。
   */
  stream: (req: StreamRequest, handlers: StreamHandlers) => StreamHandle

  /**
   * 通用 KV 存储（用户偏好、缓存等）。
   * Web = localStorage，Mobile = AsyncStorage。
   */
  storage: StateStorage

  /**
   * 加密 KV 存储（access/refresh token 等敏感信息）。
   * Web = 依赖浏览器 sandbox 的 localStorage（无额外加密），Mobile = Expo SecureStore。
   */
  secureStorage: StateStorage

  /**
   * Auth store 专用存储（Web 版有「记住我」动态选择 local/session 的复杂行为，Mobile 直接落 SecureStore）。
   *
   * 与 {@link secureStorage} 分开是为了保留 Web 上「未记住我」= 会话内可用、关闭标签清空的语义。
   */
  authStorage: StateStorage

  /**
   * 标记「记住我」偏好。Web 写 localStorage，Mobile 通常无操作。
   * 传入 `true` 表示打开记住我，`false` 表示关闭。
   */
  setAuthRemembered?: (remembered: boolean) => void

  /**
   * 读取「记住我」偏好。Web 从 localStorage 读，Mobile 恒返回 true（token 一直存 SecureStore）。
   */
  isAuthRemembered?: () => boolean

  /**
   * 把 access token 同步写到 Web cookie，供 Next.js middleware 做 SSR 路由保护；
   * Mobile 无 cookie 概念，实现为空操作即可。
   *
   * @param accessToken - 新的 access token
   * @param remembered - 是否记住我；决定 cookie 是持久（7 天）还是会话
   */
  writeAuthCookie?: (accessToken: string, remembered: boolean) => void

  /** 清除 auth cookie（Mobile 无操作） */
  clearAuthCookie?: () => void
}
