import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  setOnAuthFailure: vi.fn(),
  setOnTokenRefreshed: vi.fn(),
  setRefreshTokenGetter: vi.fn(),
  setTokenGetter: vi.fn(),
}))

const auth = vi.hoisted(() => ({
  clearAuth: vi.fn(),
  accessToken: 'desktop-access-token' as string | null,
  refreshToken: 'desktop-refresh-token' as string | null,
  setAccessToken: vi.fn(),
}))

vi.mock('@yuanai/core/api', () => api)
vi.mock('@yuanai/core/stores', () => ({
  useAuthStore: { getState: () => auth },
}))

import { configureDesktopAuthClient } from './auth-client'

beforeEach(() => {
  auth.accessToken = 'desktop-access-token'
  auth.refreshToken = 'desktop-refresh-token'
  vi.clearAllMocks()
})

describe('configureDesktopAuthClient', () => {
  it('binds the current token state and clears encrypted auth after API authentication failure', () => {
    configureDesktopAuthClient()

    const tokenGetter = api.setTokenGetter.mock.calls[0]?.[0]
    const refreshTokenGetter = api.setRefreshTokenGetter.mock.calls[0]?.[0]
    const tokenRefreshed = api.setOnTokenRefreshed.mock.calls[0]?.[0]
    const authFailure = api.setOnAuthFailure.mock.calls[0]?.[0]

    expect(tokenGetter?.()).toBe('desktop-access-token')
    expect(refreshTokenGetter?.()).toBe('desktop-refresh-token')

    auth.accessToken = 'updated-access-token'
    auth.refreshToken = 'updated-refresh-token'
    expect(tokenGetter?.()).toBe('updated-access-token')
    expect(refreshTokenGetter?.()).toBe('updated-refresh-token')

    tokenRefreshed?.('refreshed-access-token')
    authFailure?.()

    expect(auth.setAccessToken).toHaveBeenCalledWith('refreshed-access-token')
    expect(auth.clearAuth).toHaveBeenCalledOnce()
  })
})
