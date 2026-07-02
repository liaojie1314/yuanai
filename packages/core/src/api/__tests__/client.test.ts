import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../../tests/mocks/server.js'
import {
  apiClient,
  API_BASE_URL,
  setTokenGetter,
  setRefreshTokenGetter,
  setOnAuthFailure,
  setOnTokenRefreshed,
} from '../client.js'

// 模拟 auth store 里 tokenGetter 与 onTokenRefreshed 通过同一份状态联动的关系：
// 刷新成功后 currentToken 更新，重试请求的请求拦截器会读到新 token。
let currentToken = 'expired-token'

beforeEach(() => {
  currentToken = 'expired-token'
  setTokenGetter(() => currentToken)
  setRefreshTokenGetter(() => 'valid-refresh-token')
  setOnAuthFailure(() => {})
  setOnTokenRefreshed((t) => {
    currentToken = t
  })
})

afterEach(() => {
  vi.clearAllMocks()
  setTokenGetter(() => null)
  setRefreshTokenGetter(() => null)
  setOnAuthFailure(() => {})
  setOnTokenRefreshed(() => {})
})

describe('apiClient — 401 自动刷新并重试', () => {
  it('access token 过期时刷新并用新 token 重试原请求，最终成功', async () => {
    let calls = 0
    server.use(
      http.get(`${API_BASE_URL}/me/stats`, ({ request }) => {
        calls++
        return request.headers.get('authorization') === 'Bearer new-token'
          ? HttpResponse.json({ ok: true })
          : new HttpResponse(null, { status: 401 })
      }),
      http.post(`${API_BASE_URL}/auth/refresh`, () =>
        HttpResponse.json({ access_token: 'new-token' })
      )
    )
    const onRefreshed = vi.fn()
    setOnTokenRefreshed((t) => {
      currentToken = t
      onRefreshed(t)
    })

    const res = await apiClient.get('/me/stats')

    expect(res.data).toEqual({ ok: true })
    expect(calls).toBe(2)
    expect(onRefreshed).toHaveBeenCalledWith('new-token')
  })

  it('并发多个 401 只触发一次刷新请求（去重）', async () => {
    let refreshCalls = 0
    const respond = (request: Request): Response =>
      request.headers.get('authorization') === 'Bearer new-token'
        ? HttpResponse.json({ ok: true })
        : new HttpResponse(null, { status: 401 })
    server.use(
      http.get(`${API_BASE_URL}/a`, ({ request }) => respond(request)),
      http.get(`${API_BASE_URL}/b`, ({ request }) => respond(request)),
      http.post(`${API_BASE_URL}/auth/refresh`, () => {
        refreshCalls++
        return HttpResponse.json({ access_token: 'new-token' })
      })
    )

    const [resA, resB] = await Promise.all([apiClient.get('/a'), apiClient.get('/b')])

    expect(resA.data).toEqual({ ok: true })
    expect(resB.data).toEqual({ ok: true })
    expect(refreshCalls).toBe(1)
  })

  it('刷新成功但重试仍 401：不会无限重试，直接判定鉴权失败', async () => {
    let calls = 0
    server.use(
      http.get(`${API_BASE_URL}/me/stats`, () => {
        calls++
        return new HttpResponse(null, { status: 401 })
      }),
      http.post(`${API_BASE_URL}/auth/refresh`, () =>
        HttpResponse.json({ access_token: 'new-token' })
      )
    )
    const onFailure = vi.fn()
    setOnAuthFailure(onFailure)

    await expect(apiClient.get('/me/stats')).rejects.toBeTruthy()

    expect(calls).toBe(2)
    expect(onFailure).toHaveBeenCalledTimes(1)
  })

  it('刷新接口自身失败：触发一次鉴权失败回调，原请求 reject', async () => {
    server.use(
      http.get(`${API_BASE_URL}/me/stats`, () => new HttpResponse(null, { status: 401 })),
      http.post(`${API_BASE_URL}/auth/refresh`, () => new HttpResponse(null, { status: 401 }))
    )
    const onFailure = vi.fn()
    setOnAuthFailure(onFailure)

    await expect(apiClient.get('/me/stats')).rejects.toBeTruthy()

    expect(onFailure).toHaveBeenCalledTimes(1)
  })

  it('无 refresh token 时直接判定鉴权失败，不调用刷新接口', async () => {
    setRefreshTokenGetter(() => null)
    let refreshCalls = 0
    server.use(
      http.get(`${API_BASE_URL}/me/stats`, () => new HttpResponse(null, { status: 401 })),
      http.post(`${API_BASE_URL}/auth/refresh`, () => {
        refreshCalls++
        return HttpResponse.json({ access_token: 'x' })
      })
    )
    const onFailure = vi.fn()
    setOnAuthFailure(onFailure)

    await expect(apiClient.get('/me/stats')).rejects.toBeTruthy()

    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(refreshCalls).toBe(0)
  })

  it('登录接口 401（凭据错误）不触发刷新流程或鉴权失败回调', async () => {
    let refreshCalls = 0
    server.use(
      http.post(`${API_BASE_URL}/auth/login`, () => new HttpResponse(null, { status: 401 })),
      http.post(`${API_BASE_URL}/auth/refresh`, () => {
        refreshCalls++
        return HttpResponse.json({ access_token: 'x' })
      })
    )
    const onFailure = vi.fn()
    setOnAuthFailure(onFailure)

    await expect(apiClient.post('/auth/login', {})).rejects.toBeTruthy()

    expect(refreshCalls).toBe(0)
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('非 401 错误直接透传，不触发刷新或鉴权失败回调', async () => {
    let refreshCalls = 0
    server.use(
      http.get(`${API_BASE_URL}/me/stats`, () => new HttpResponse(null, { status: 500 })),
      http.post(`${API_BASE_URL}/auth/refresh`, () => {
        refreshCalls++
        return HttpResponse.json({ access_token: 'x' })
      })
    )
    const onFailure = vi.fn()
    setOnAuthFailure(onFailure)

    await expect(apiClient.get('/me/stats')).rejects.toBeTruthy()

    expect(refreshCalls).toBe(0)
    expect(onFailure).not.toHaveBeenCalled()
  })
})
