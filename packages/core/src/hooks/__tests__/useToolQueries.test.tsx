import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '../../../tests/mocks/server.js'
import { API_BASE_URL } from '../../api/client.js'
import { useAuthStore } from '../../stores/auth.store.js'
import {
  isTerminalToolExecution,
  useCancelToolExecution,
  useCreateToolConnection,
  useToolConnections,
  useToolExecutions,
} from '../useToolQueries.js'

function withProvider() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return wrapper
}

const connection = {
  id: 'conn-1',
  userId: 'user-1',
  kind: 'api_key',
  provider: 'test',
  displayName: 'Test Connection',
  scopes: ['files.read'],
  status: 'active',
  metadata: {},
  lastVerifiedAt: null,
  createdAt: '2026-08-30T00:00:00Z',
  updatedAt: '2026-08-30T00:00:00Z',
}

const execution = {
  id: 'exec-1',
  userId: 'user-1',
  runId: null,
  stepId: null,
  toolName: 'calculate',
  toolVersion: '1.0.0',
  executionLocation: 'cloud',
  riskLevel: 'read',
  sideEffect: 'none',
  argumentsPreview: {},
  argumentsHash: 'hash',
  idempotencyKey: null,
  nodeId: null,
  status: 'succeeded',
  resultJson: { status: 'succeeded', summary: '完成' },
  artifactIds: [],
  nodeDeliveryStatus: null,
  nodeProgress: null,
  nodeLastDeliveredAt: null,
  nodeAcknowledgedAt: null,
  errorCode: null,
  errorMessage: null,
  startedAt: '2026-08-30T00:00:01Z',
  finishedAt: '2026-08-30T00:00:02Z',
  createdAt: '2026-08-30T00:00:00Z',
  updatedAt: '2026-08-30T00:00:02Z',
}

beforeEach(() => {
  act(() => {
    useAuthStore.getState().setAccessToken('test-token')
  })
})

afterEach(() => {
  useAuthStore.getState().clearAuth()
})

describe('isTerminalToolExecution', () => {
  it.each([
    ['queued', false],
    ['running', false],
    ['waiting', false],
    ['succeeded', true],
    ['failed', true],
    ['cancelled', true],
  ] as const)('treats %s as terminal=%j', (status, expected) => {
    expect(isTerminalToolExecution(status)).toBe(expected)
  })
})

describe('useToolConnections', () => {
  it('加载连接列表并支持创建后写入缓存', async () => {
    server.use(http.get(`${API_BASE_URL}/tool-connections`, () => HttpResponse.json([connection])))
    const { result } = renderHook(() => useToolConnections(), { wrapper: withProvider() })
    await waitFor(() => expect(result.current.data).toHaveLength(1))

    server.use(
      http.post(`${API_BASE_URL}/tool-connections`, () =>
        HttpResponse.json({ ...connection, id: 'conn-2', displayName: 'Second' }, { status: 201 })
      )
    )
    const { result: createResult } = renderHook(() => useCreateToolConnection(), {
      wrapper: withProvider(),
    })
    await act(async () => {
      await createResult.current.mutateAsync({
        kind: 'api_key',
        provider: 'test',
        displayName: 'Second',
      })
    })
    await waitFor(() => {
      expect(createResult.current.data?.id).toBe('conn-2')
    })
  })
})

describe('useToolExecutions', () => {
  it('加载执行时间线并放行取消变更', async () => {
    server.use(
      http.get(`${API_BASE_URL}/tool-executions`, ({ request }) => {
        const limit = new URL(request.url).searchParams.get('limit')
        expect(limit).toBe('20')
        return HttpResponse.json([execution])
      })
    )
    const { result } = renderHook(() => useToolExecutions(20), { wrapper: withProvider() })
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(result.current.data?.[0]?.status).toBe('succeeded')

    server.use(
      http.post(`${API_BASE_URL}/tool-executions/exec-1/cancel`, () =>
        HttpResponse.json({ ...execution, status: 'cancelled' })
      )
    )
    const { result: cancelResult } = renderHook(() => useCancelToolExecution(), {
      wrapper: withProvider(),
    })
    await act(async () => {
      await cancelResult.current.mutateAsync('exec-1')
    })
    await waitFor(() => expect(cancelResult.current.data?.status).toBe('cancelled'))
  })

  it('缺少 accessToken 时不发起请求', async () => {
    useAuthStore.getState().clearAuth()
    let called = 0
    server.use(
      http.get(`${API_BASE_URL}/tool-executions`, () => {
        called += 1
        return HttpResponse.json([])
      })
    )
    renderHook(() => useToolExecutions(), { wrapper: withProvider() })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(called).toBe(0)
  })
})
