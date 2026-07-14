import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import EventSource from 'react-native-sse'

import type {
  PlatformAdapter,
  StreamHandle,
  StreamHandlers,
  StreamRequest,
} from '@yuanai/core/platform'

/**
 * `react-native-sse` 会派发 open / message / error / close 四类内置事件 +
 * 任意用户声明的自定义事件类型。官方 TS 类型未详细区分，这里用一个宽松签名承接。
 */
interface RNEventSource {
  addEventListener: (
    type: string,
    handler: (event: { type: string; data?: string | null; message?: string }) => void
  ) => void
  close: () => void
}

/**
 * 后端 SSE 帧携带的自定义 event 名（与 `useStream.dispatchMessage` 中 switch case
 * 完全对齐，另外补一个 `message_start` 记录）。
 *
 * ⚠️ 关键：`react-native-sse` 只对**显式 `addEventListener` 过**的 event name 派发。
 * `addEventListener('message', ...)` 只接住「无 `event:` 前缀」的默认帧；而后端
 * 所有帧都是 `event: content_delta\ndata: ...` 这样带前缀的形态，因此必须逐个订阅。
 * 少订一个 = 这类事件在移动端完全丢失（Step 7 首次真机验证时表现为 UI 永远停在光标）。
 */
const SSE_EVENT_NAMES = [
  'message_start',
  'content_delta',
  'thinking_delta',
  'tool_call_start',
  'tool_call_delta',
  'tool_call_end',
  'message_end',
  'error',
] as const

/**
 * Mobile 侧 SSE 传输：走 `react-native-sse`。
 *
 * 关键点：
 * - RN 内置 fetch 不支持 `ReadableStream`，因此不能直接复用 Web 的 fetch 解析
 * - `react-native-sse` 允许 POST body + 自定义 headers，自身负责按 SSE 语法拆事件
 * - 后端所有帧都带 `event:` 前缀 → 需要逐个 `addEventListener`（见 `SSE_EVENT_NAMES`）
 *
 * ⚠️ Stream 结束的判定：
 * `react-native-sse` **不会在 server 关闭连接时主动派发 `close`** —— server 关连接
 * 时（xhr.readyState=DONE, xhr.status=200）只会调用内部 `_pollAgain`，而我们把
 * `pollingInterval:0` 且 `allowZero:false`，因此**什么事件都不发**。上层永远等不到
 * `onClose`。用后端 `message_end`（chat.py 里流的正常结束帧）来触发 `onClose`：
 * 每条流保证以 `message_end` 收尾，收到即等价于 Web fetch 的 `reader.done`。
 */
function mobileStream(req: StreamRequest, handlers: StreamHandlers): StreamHandle {
  let closedByUser = false
  let closedByStream = false

  const es = new EventSource(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    // 一次性长连接：关闭后不自动重试
    pollingInterval: 0,
    // 关闭内置心跳，交给业务层控制
    timeout: 0,
  }) as unknown as RNEventSource

  const finishNormally = (): void => {
    if (closedByStream || closedByUser) return
    closedByStream = true
    es.close()
    handlers.onClose?.()
  }

  es.addEventListener('open', () => {
    handlers.onOpen?.()
  })

  // 默认 message（无 `event:` 前缀）也保留一路，兜底任何未列出的旧格式
  es.addEventListener('message', (event) => {
    handlers.onMessage({ event: 'message', data: event.data ?? '' })
  })

  // 后端所有自定义事件：显式逐个订阅
  for (const name of SSE_EVENT_NAMES) {
    es.addEventListener(name, (event) => {
      // 后端语义的 `error`：带 data payload（JSON） → 走 onMessage 让上层 dispatch
      // 传输层 `error`（rn-sse 内置，xhr 状态异常时）：无 data → 走 onError
      if (name === 'error' && (!event.data || event.data.length === 0)) {
        if (closedByUser || closedByStream) return
        const msg =
          typeof event.message === 'string' && event.message.length > 0
            ? event.message
            : 'SSE error'
        handlers.onError(new Error(msg))
        return
      }
      handlers.onMessage({ event: name, data: event.data ?? '' })
      // 流的正常终止帧：dispatch 完 message 再 fire onClose，语义与 Web reader.done 对齐
      if (name === 'message_end') {
        finishNormally()
      }
    })
  }

  // 主动 close() 走 rn-sse 内置 close 事件路径；被动关闭由 finishNormally 兜底
  es.addEventListener('close', () => {
    if (closedByStream) return
    handlers.onClose?.()
  })

  return {
    close: () => {
      closedByUser = true
      es.close()
    },
  }
}

/**
 * `expo-secure-store` 的 API 是 `getItemAsync` / `setItemAsync` / `deleteItemAsync`，
 * 需要包装成 zustand `StateStorage` 期望的签名。
 */
const secureStoreBacked = {
  getItem: (key: string): Promise<string | null> => SecureStore.getItemAsync(key),
  setItem: async (key: string, value: string): Promise<void> => {
    await SecureStore.setItemAsync(key, value)
  },
  removeItem: async (key: string): Promise<void> => {
    await SecureStore.deleteItemAsync(key)
  },
}

/**
 * AsyncStorage 已符合 `StateStorage` 的形状，但显式包一层便于统一错误吞掉。
 * 隐私模式 / 极端存储错误下静默降级，行为与 Web 侧一致。
 */
const asyncStorageBacked = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      return await AsyncStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      await AsyncStorage.setItem(key, value)
    } catch {
      /* ignore */
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      await AsyncStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  },
}

/**
 * Mobile 平台适配器。
 *
 * - `stream` → react-native-sse
 * - `storage` → AsyncStorage（偏好、TanStack Query cache 等）
 * - `secureStorage` / `authStorage` → SecureStore（access/refresh token）
 * - `isAuthRemembered` 恒 true：移动端 token 一直落 SecureStore，
 *   无 Web 端「关标签清空」语义
 * - `writeAuthCookie` / `clearAuthCookie` 空实现：Native 无 cookie 概念
 */
export const mobileAdapter: PlatformAdapter = {
  stream: mobileStream,
  storage: asyncStorageBacked,
  secureStorage: secureStoreBacked,
  authStorage: secureStoreBacked,
  isAuthRemembered: () => true,
  setAuthRemembered: () => undefined,
  writeAuthCookie: () => undefined,
  clearAuthCookie: () => undefined,
}
