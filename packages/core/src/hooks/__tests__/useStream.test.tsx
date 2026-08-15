import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '../../../tests/mocks/server.js'
import { API_BASE_URL, getApiBaseUrl, setApiBaseUrl } from '../../api/client.js'
import { useChatStore } from '../../stores/chat.store.js'
import { useStream } from '../useStream.js'

function makeStreamResponse(events: Array<{ event: string; data: unknown }>): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const evt of events) {
        controller.enqueue(enc.encode(`event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function withProvider() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  const wrapper = ({ children }: { children: any }): any => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return wrapper
}

const INITIAL_API_BASE_URL = getApiBaseUrl()

beforeEach(() => {
  useChatStore.getState().finalizeStream()
})

afterEach(() => {
  setApiBaseUrl(INITIAL_API_BASE_URL)
  vi.clearAllMocks()
})

describe('useStream — SSE 解析（端到端行为）', () => {
  it('正常流程结束后清空流式状态', async () => {
    server.use(
      http.post(`${API_BASE_URL}/chat/stream`, () =>
        makeStreamResponse([
          { event: 'message_start', data: { user_message_id: 'u', assistant_message_id: 'a' } },
          { event: 'content_delta', data: { token: 'Hello ' } },
          { event: 'content_delta', data: { token: '元AI' } },
          { event: 'message_end', data: { tokensUsed: 3, finishReason: 'stop' } },
        ])
      )
    )
    const onEnd = vi.fn()
    const { result } = renderHook(() => useStream(), { wrapper: withProvider() })
    await act(async () => {
      await result.current.send({ convId: 'c1', content: 'hi', model: 'gpt-4o', onEnd })
    })
    // 流结束应清空流式态
    const s = useChatStore.getState()
    expect(s.streamingConvId).toBeNull()
    expect(s.streamingContent).toBe('')
    expect(s.optimisticUserMsg).toBeNull()
    expect(onEnd).toHaveBeenCalledWith({ completed: true })
  })

  it('未知事件不抛错', async () => {
    server.use(
      http.post(`${API_BASE_URL}/chat/stream`, () =>
        makeStreamResponse([
          { event: 'unknown_event', data: { foo: 'bar' } },
          { event: 'content_delta', data: { token: '通过' } },
        ])
      )
    )
    const { result } = renderHook(() => useStream(), { wrapper: withProvider() })
    await act(async () => {
      await result.current.send({ convId: 'c1', content: 'hi', model: 'gpt-4o' })
    })
    expect(useChatStore.getState().streamingConvId).toBeNull()
  })

  it('将有效 conversation_title 事件精确写入对应会话缓存', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    qc.setQueryData(
      ['conversations'],
      [
        {
          id: 'c1',
          title: '新对话',
          titleSource: 'default',
          titleGeneratedAt: null,
          model: 'gpt-4o',
          isPinned: false,
          lastMessageAt: null,
          createdAt: '2026-08-15T00:00:00.000Z',
        },
        {
          id: 'c2',
          title: '保持不变',
          titleSource: 'manual',
          titleGeneratedAt: '2026-08-15T00:00:00.000Z',
          model: 'gpt-4o',
          isPinned: false,
          lastMessageAt: null,
          createdAt: '2026-08-15T00:00:00.000Z',
        },
      ]
    )
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    server.use(
      http.post(`${API_BASE_URL}/chat/stream`, () =>
        makeStreamResponse([
          { event: 'conversation_title', data: { conversation_id: 42 } },
          {
            event: 'conversation_title',
            data: {
              conversation_id: 'c1',
              title: 'SQLAlchemy 事务边界',
              title_source: 'ai',
              title_generated_at: '2026-08-15T12:00:00.000Z',
            },
          },
        ])
      )
    )
    const { result } = renderHook(() => useStream(), { wrapper })

    await act(async () => {
      await result.current.send({ convId: 'c1', content: 'hi', model: 'gpt-4o' })
    })

    const conversations = qc.getQueryData<
      Array<{ id: string; title: string; titleSource: string }>
    >(['conversations'])
    expect(conversations?.[0]).toMatchObject({
      id: 'c1',
      title: 'SQLAlchemy 事务边界',
      titleSource: 'ai',
    })
    expect(conversations?.[1]).toMatchObject({ id: 'c2', title: '保持不变' })
  })

  it('HTTP 非 2xx 时清理流式态并回调 onError', async () => {
    server.use(
      http.post(`${API_BASE_URL}/chat/stream`, () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 })
      )
    )
    const onEnd = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useStream(), { wrapper: withProvider() })
    await act(async () => {
      await result.current.send({ convId: 'c1', content: 'hi', model: 'gpt-4o', onEnd, onError })
    })
    expect(onError).toHaveBeenCalled()
    expect(onEnd).toHaveBeenCalledWith({ completed: false })
    expect(useChatStore.getState().streamingConvId).toBeNull()
  })

  it('收到后端 SSE 错误时回调用户可展示的错误消息', async () => {
    server.use(
      http.post(`${API_BASE_URL}/chat/stream`, () =>
        makeStreamResponse([
          { event: 'message_start', data: { user_message_id: 'u', assistant_message_id: 'a' } },
          {
            event: 'error',
            data: {
              code: 'MODEL_VISION_UNSUPPORTED',
              message: '当前模型不支持图片识别，请切换至支持视觉的模型后发送',
            },
          },
        ])
      )
    )
    const onEnd = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useStream(), { wrapper: withProvider() })

    await act(async () => {
      await result.current.send({
        convId: 'c1',
        content: '看图',
        model: 'deepseek-v4-flash',
        onEnd,
        onError,
      })
    })

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: '当前模型不支持图片识别，请切换至支持视觉的模型后发送' })
    )
    expect(onEnd).toHaveBeenCalledWith({ completed: false })
    expect(useChatStore.getState().streamingConvId).toBeNull()
  })

  it('在 Hook 初始化后使用最新的运行时 API 地址发起流式请求', async () => {
    const runtimeBaseUrl = 'https://desktop.example/api/v1'
    let receivedRequest = false
    server.use(
      http.post(`${runtimeBaseUrl}/chat/stream`, () => {
        receivedRequest = true
        return makeStreamResponse([])
      })
    )
    const { result } = renderHook(() => useStream(), { wrapper: withProvider() })

    setApiBaseUrl(runtimeBaseUrl)

    await act(async () => {
      await result.current.send({ convId: 'c1', content: 'hi', model: 'gpt-4o' })
    })

    expect(receivedRequest).toBe(true)
  })

  it('编辑消息时复用原消息 ID，不创建乐观用户消息', async () => {
    let body: Record<string, unknown> | null = null
    server.use(
      http.post(`${API_BASE_URL}/chat/stream`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return makeStreamResponse([])
      })
    )
    const { result } = renderHook(() => useStream(), { wrapper: withProvider() })

    await act(async () => {
      await result.current.send({
        convId: 'c1',
        content: '编辑后的问题',
        model: 'gpt-4o',
        replaceMessageId: 'original-user-message',
      })
    })

    expect(body).toMatchObject({
      conversation_id: 'c1',
      replace_message_id: 'original-user-message',
    })
    expect(useChatStore.getState().optimisticUserMsg).toBeNull()
  })

  it('stop() 把已收到的部分内容写入消息缓存（不丢已输出文本）', async () => {
    // 无限流：只发 message_start + 两个 delta，之后挂起等待被 stop 中断
    server.use(
      http.post(`${API_BASE_URL}/chat/stream`, () => {
        const enc = new TextEncoder()
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              enc.encode(
                `event: message_start\ndata: ${JSON.stringify({
                  user_message_id: 'u1',
                  assistant_message_id: 'a1',
                })}\n\n`
              )
            )
            controller.enqueue(
              enc.encode(`event: content_delta\ndata: ${JSON.stringify({ token: '1\n2\n' })}\n\n`)
            )
            controller.enqueue(
              enc.encode(`event: content_delta\ndata: ${JSON.stringify({ token: '3\n4\n' })}\n\n`)
            )
            // 不 close：模拟仍在生成
          },
        })
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
      })
    )

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const wrapper = ({ children }: { children: any }): any => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useStream(), { wrapper })

    // 不 await send：MSW 的 mock 流不响应 abort，Promise 在测试环境不会归位；
    // stop() 的缓存写入与 finalizeStream 都是同步的，断言无需等 send 落定
    await act(async () => {
      void result.current.send({ convId: 'c1', content: '数数', model: 'gpt-4o' })
      // 等两个 delta 进 store
      await vi.waitFor(() => {
        expect(useChatStore.getState().streamingContent).toBe('1\n2\n3\n4\n')
      })
    })

    act(() => {
      result.current.stop()
    })

    // 部分内容写入缓存：user + assistant 两条
    const cached = qc.getQueryData<Array<{ id: string; role: string; content: string }>>([
      'messages',
      'c1',
    ])
    expect(cached).toBeDefined()
    expect(cached?.find((m) => m.id === 'a1')?.content).toBe('1\n2\n3\n4\n')
    expect(cached?.find((m) => m.id === 'u1')?.content).toBe('数数')
    // 流式态已清空
    expect(useChatStore.getState().streamingConvId).toBeNull()
  })
})
