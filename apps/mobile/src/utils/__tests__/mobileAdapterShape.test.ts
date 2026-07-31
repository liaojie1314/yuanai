import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: { type: string; data?: string | null; message?: string }) => void

interface MockES {
  listeners: Record<string, Handler[]>
  closed: boolean
  addEventListener: (type: string, handler: Handler) => void
  close: () => void
  dispatch: (type: string, event: { data?: string | null; message?: string }) => void
}

/**
 * 工厂函数：产出一个「可编程」的 MockES。用它替代 `class extends` 来避免
 * eslint 的 `no-this-alias` 报错，同时把 lastES 引用捕获在闭包里而不是 constructor 内。
 */
function createMockES(): MockES {
  const state: MockES = {
    listeners: {},
    closed: false,
    addEventListener(type, handler): void {
      ;(state.listeners[type] ||= []).push(handler)
    },
    close(): void {
      state.closed = true
    },
    dispatch(type, event): void {
      for (const h of state.listeners[type] ?? []) h({ type, ...event })
    },
  }
  return state
}

let lastES: MockES | null = null

/** 收敛非空断言：任何一次流式测试都保证 mobileAdapter.stream 已经 new 过 ES。 */
function requireES(): MockES {
  if (!lastES) throw new Error('MockES was not instantiated')
  return lastES
}

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (_: string): Promise<string | null> => null),
  setItemAsync: vi.fn(async (_k: string, _v: string): Promise<void> => undefined),
  deleteItemAsync: vi.fn(async (_k: string): Promise<void> => undefined),
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (_k: string): Promise<string | null> => null),
    setItem: vi.fn(async (_k: string, _v: string): Promise<void> => undefined),
    removeItem: vi.fn(async (_k: string): Promise<void> => undefined),
  },
}))

vi.mock('react-native-sse', () => {
  function MockEventSource(): MockES {
    lastES = createMockES()
    return lastES
  }
  return { default: MockEventSource }
})

beforeEach(() => {
  lastES = null
})

describe('mobileAdapter — shape', () => {
  it('exposes stream / storage / secureStorage / authStorage', async () => {
    const { mobileAdapter } = await import('../../lib/mobileAdapter')
    expect(typeof mobileAdapter.stream).toBe('function')
    expect(typeof mobileAdapter.storage.getItem).toBe('function')
    expect(typeof mobileAdapter.secureStorage.getItem).toBe('function')
    expect(typeof mobileAdapter.authStorage.getItem).toBe('function')
    expect(mobileAdapter.isAuthRemembered?.()).toBe(true)
  })

  it('storage.setItem returns a Promise and swallows errors', async () => {
    const { mobileAdapter } = await import('../../lib/mobileAdapter')
    await expect(mobileAdapter.storage.setItem('k', 'v')).resolves.toBeUndefined()
  })

  it('stream returns a handle with close()', async () => {
    const { mobileAdapter } = await import('../../lib/mobileAdapter')
    const handle = mobileAdapter.stream(
      { url: 'https://example.com', method: 'POST', headers: {} },
      { onMessage: () => undefined, onError: () => undefined }
    )
    expect(typeof handle.close).toBe('function')
    expect(() => handle.close()).not.toThrow()
  })
})

/**
 * Bug #1 复现：后端每帧都是 `event: content_delta\ndata: {...}` 形态。
 * `react-native-sse` 只有显式 `addEventListener(name, ...)` 才会派发对应 name，
 * 且 `addEventListener('message', ...)` 只覆盖「无 event 前缀」的默认帧。
 * 少订一个 event name → 该类型帧在移动端完全丢失。
 *
 * Bug #2 复现：server 关连接时 `react-native-sse` 走 `_pollAgain(0, false)`，
 * 静默 no-op，永远不会派发 `close` 事件。上层 `onClose` 永远等不到。
 * 解决：把 `message_end`（后端流的语义结束帧）视作等价于 `reader.done`，
 * 收到即主动 close() + fire onClose。
 */
describe('mobileStream — SSE event routing', () => {
  it('routes each backend event name to onMessage', async () => {
    const { mobileAdapter } = await import('../../lib/mobileAdapter')
    const onMessage = vi.fn()
    mobileAdapter.stream(
      { url: 'x', method: 'POST', headers: {} },
      { onMessage, onError: () => undefined }
    )
    const es = requireES()
    // 每个后端事件类型都应有独立 listener
    for (const name of [
      'message_start',
      'content_delta',
      'thinking_delta',
      'tool_call_start',
      'tool_call_delta',
      'tool_call_end',
    ]) {
      expect(es.listeners[name], `${name} 应被订阅`).toBeDefined()
    }

    es.dispatch('content_delta', { data: '{"delta":"hi"}' })
    expect(onMessage).toHaveBeenCalledWith({ event: 'content_delta', data: '{"delta":"hi"}' })
  })

  it('finalizes stream on message_end (closes ES and fires onClose exactly once)', async () => {
    const { mobileAdapter } = await import('../../lib/mobileAdapter')
    const onMessage = vi.fn()
    const onClose = vi.fn()
    mobileAdapter.stream(
      { url: 'x', method: 'POST', headers: {} },
      { onMessage, onClose, onError: () => undefined }
    )
    const es = requireES()
    es.dispatch('message_end', { data: '{"reason":"stop"}' })
    expect(onMessage).toHaveBeenCalledWith({ event: 'message_end', data: '{"reason":"stop"}' })
    expect(es.closed).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
    // 后续任何 `close` 事件都不应再 fire onClose，避免双重通知
    es.dispatch('close', {})
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('distinguishes transport error (no data) from backend error frame (has data)', async () => {
    const { mobileAdapter } = await import('../../lib/mobileAdapter')
    const onMessage = vi.fn()
    const onError = vi.fn()
    mobileAdapter.stream({ url: 'x', method: 'POST', headers: {} }, { onMessage, onError })
    const es = requireES()
    // 传输层错误：rn-sse 内置 error，无 data payload
    es.dispatch('error', { message: 'network down' })
    expect(onError).toHaveBeenCalledTimes(1)
    const firstCall = onError.mock.calls[0]
    expect(firstCall?.[0]).toBeInstanceOf(Error)
    expect(onMessage).not.toHaveBeenCalled()

    // 后端语义 error：带 data payload → 走 onMessage 让上层 dispatch
    es.dispatch('error', { data: '{"error":"rate_limit"}' })
    expect(onMessage).toHaveBeenCalledWith({ event: 'error', data: '{"error":"rate_limit"}' })
  })

  it('finalize dedupe: message_end followed by rn-sse close event fires onClose only once', async () => {
    const { mobileAdapter } = await import('../../lib/mobileAdapter')
    const onClose = vi.fn()
    mobileAdapter.stream(
      { url: 'x', method: 'POST', headers: {} },
      { onMessage: () => undefined, onError: () => undefined, onClose }
    )
    const es = requireES()
    // 场景：正常流关闭 —— message_end 先触发 finishNormally；随后 es.close() 本身
    // 会让 rn-sse 派发一次 close 事件。close 分支需要靠 closedByStream 短路。
    es.dispatch('message_end', { data: '{}' })
    es.dispatch('close', {})
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
