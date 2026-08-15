import type { InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type {
  AuthResponse,
  QrLoginChallenge,
  QrLoginInspection,
  QrLoginStatusResponse,
} from '@yuanai/types'

import { apiClient, getApiBaseUrl, setApiBaseUrl } from '../client.js'
import {
  approveQrLoginChallenge,
  createQrLoginChallenge,
  denyQrLoginChallenge,
  exchangeQrLoginChallenge,
  getQrLoginStatus,
  inspectQrLoginChallenge,
  parseQrLoginPayload,
} from '../qr-login.js'

const INITIAL_API_BASE_URL = getApiBaseUrl()

const challenge: QrLoginChallenge = {
  challenge: 'x'.repeat(43),
  pollSecret: 'y'.repeat(43),
  qrDataUri: 'data:image/png;base64,test',
  expiresAt: '2026-08-15T12:00:00Z',
  pollAfterMs: 1000,
}

const inspection: QrLoginInspection = {
  targetPlatform: 'web',
  deviceName: 'Firefox on Ubuntu',
  expiresAt: challenge.expiresAt,
  status: 'pending',
}

const targetStatus: QrLoginStatusResponse = {
  status: 'approved',
  expiresAt: challenge.expiresAt,
  authorizationCode: 'z'.repeat(43),
}

const authResponse: AuthResponse = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  token_type: 'bearer',
  user: {
    id: 'user-1',
    email: 'test@example.com',
    username: 'testuser',
    avatarUrl: null,
    createdAt: '2026-08-15T00:00:00Z',
  },
}

let responseData: unknown
let requestConfigs: InternalAxiosRequestConfig[]
let originalAdapter: typeof apiClient.defaults.adapter

const adapter = async (config: InternalAxiosRequestConfig) => {
  requestConfigs.push(config)
  return {
    data: responseData,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  }
}

describe('扫码登录 API', () => {
  beforeEach(() => {
    requestConfigs = []
    responseData = challenge
    originalAdapter = apiClient.defaults.adapter
    apiClient.defaults.adapter = adapter
    setApiBaseUrl('http://localhost:8000/api/v1')
  })

  afterEach(() => {
    if (originalAdapter === undefined) delete apiClient.defaults.adapter
    else apiClient.defaults.adapter = originalAdapter
    setApiBaseUrl(INITIAL_API_BASE_URL)
  })

  it('创建挑战时只提交设备信息，返回轮询凭据不会写入二维码', async () => {
    await expect(
      createQrLoginChallenge({ targetPlatform: 'web', deviceName: 'Firefox on Ubuntu' })
    ).resolves.toEqual(challenge)

    expect(requestConfigs[0]?.url).toBe('/auth/qr-login/challenges')
    expect(JSON.parse(String(requestConfigs[0]?.data))).toEqual({
      targetPlatform: 'web',
      deviceName: 'Firefox on Ubuntu',
    })
    expect(challenge.qrDataUri).not.toContain(challenge.pollSecret)
  })

  it('在单次移动扫码请求中使用受限 API 地址，且不修改全局地址', async () => {
    responseData = inspection

    await expect(
      inspectQrLoginChallenge(challenge.challenge, { apiBaseUrl: 'http://192.168.1.8:8000/api/v1' })
    ).resolves.toEqual(inspection)

    expect(requestConfigs[0]?.baseURL).toBe('http://192.168.1.8:8000/api/v1')
    expect(getApiBaseUrl()).toBe('http://localhost:8000/api/v1')
  })

  it('仅在状态请求中携带轮询 secret，并支持确认、拒绝和一次性交换', async () => {
    responseData = targetStatus
    await expect(getQrLoginStatus(challenge.challenge, challenge.pollSecret)).resolves.toEqual(
      targetStatus
    )
    expect(requestConfigs[0]?.headers['X-QR-Poll-Secret']).toBe(challenge.pollSecret)

    responseData = undefined
    await approveQrLoginChallenge(challenge.challenge)
    await denyQrLoginChallenge(challenge.challenge)
    expect(requestConfigs[1]?.url).toContain('/approve')
    expect(requestConfigs[2]?.url).toContain('/deny')

    responseData = authResponse
    await expect(
      exchangeQrLoginChallenge({
        challenge: challenge.challenge,
        pollSecret: challenge.pollSecret,
        authorizationCode: 'z'.repeat(43),
      })
    ).resolves.toEqual(authResponse)
  })
})

describe('扫码登录地址解析', () => {
  it('接受带私网 API 地址的精确 yuanai 二维码载荷', () => {
    expect(
      parseQrLoginPayload(
        `yuanai://qr-login?challenge=${'x'.repeat(43)}&api=${encodeURIComponent(
          'http://192.168.1.8:8000/api/v1'
        )}`
      )
    ).toEqual({
      challenge: 'x'.repeat(43),
      apiBaseUrl: 'http://192.168.1.8:8000/api/v1',
    })
  })

  it.each([
    'yuanai://qr-login?challenge=short&api=http%3A%2F%2F192.168.1.8%3A8000%2Fapi%2Fv1',
    `yuanai://qr-login?challenge=${'x'.repeat(43)}&api=http%3A%2F%2Fexample.com%2Fapi%2Fv1`,
    `yuanai://qr-login?challenge=${'x'.repeat(43)}&api=https%3A%2F%2Fexample.com%2Fwrong`,
    `https://example.com?challenge=${'x'.repeat(43)}`,
  ])('拒绝不安全或不完整的二维码载荷', (payload) => {
    expect(() => parseQrLoginPayload(payload)).toThrow('QR_LOGIN_INVALID_PAYLOAD')
  })
})
