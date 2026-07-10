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
 * `react-native-sse` 会派发 open / message / error / close 四类事件；
 * 官方 TS 类型未详细区分自定义 event，这里用一个宽松签名承接。
 */
interface RNEventSource {
  addEventListener: (
    type: 'open' | 'message' | 'error' | 'close',
    handler: (event: { type: string; data?: string | null; message?: string }) => void
  ) => void
  close: () => void
}

/**
 * Mobile 侧 SSE 传输：走 `react-native-sse`。
 *
 * 关键点：
 * - RN 内置 fetch 不支持 `ReadableStream`，因此不能直接复用 Web 的 fetch 解析
 * - `react-native-sse` 允许 POST body + 自定义 headers，自身负责按 SSE 语法拆事件
 * - 主动 close 不视作 error，通过手动 `closedByUser` 标记桥接给上层 `onClose`
 */
function mobileStream(req: StreamRequest, handlers: StreamHandlers): StreamHandle {
  let closedByUser = false

  const es = new EventSource(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    // 一次性长连接：关闭后不自动重试
    pollingInterval: 0,
    // 关闭内置心跳，交给业务层控制
    timeout: 0,
  }) as unknown as RNEventSource

  es.addEventListener('open', () => {
    handlers.onOpen?.()
  })

  es.addEventListener('message', (event) => {
    // react-native-sse 会把「无 event 字段」的默认消息以 type='message' 派发
    const eventName = event.type === 'message' ? 'message' : event.type
    handlers.onMessage({ event: eventName, data: event.data ?? '' })
  })

  es.addEventListener('error', (event) => {
    if (closedByUser) return
    const msg =
      typeof event.message === 'string' && event.message.length > 0 ? event.message : 'SSE error'
    handlers.onError(new Error(msg))
  })

  es.addEventListener('close', () => {
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
