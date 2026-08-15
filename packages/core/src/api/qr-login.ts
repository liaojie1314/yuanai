import type { AxiosRequestConfig } from 'axios'

import type {
  AuthResponse,
  CreateQrLoginChallengeInput,
  ExchangeQrLoginChallengeInput,
  ParsedQrLoginPayload,
  QrLoginChallenge,
  QrLoginInspection,
  QrLoginRequestScope,
  QrLoginStatusResponse,
} from '@yuanai/types'

import { apiClient } from './client.js'

const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/

/**
 * 创建供 Web 或桌面端展示的短时扫码登录挑战。
 * @param input 目标平台和仅用于手机确认页展示的设备名称
 * @returns 目标端独占的挑战、轮询凭据和二维码图片数据
 */
export async function createQrLoginChallenge(
  input: CreateQrLoginChallengeInput
): Promise<QrLoginChallenge> {
  const body =
    input.apiBaseUrl === undefined
      ? { targetPlatform: input.targetPlatform, deviceName: input.deviceName }
      : input
  const response = await apiClient.post<QrLoginChallenge>('/auth/qr-login/challenges', body)
  return response.data
}

/**
 * 读取目标端二维码挑战的当前状态。
 * @param challenge 二维码承载的短时 challenge
 * @param pollSecret 仅目标端内存持有的独立轮询凭据
 * @returns 当前状态及获批后的短时授权码
 */
export async function getQrLoginStatus(
  challenge: string,
  pollSecret: string
): Promise<QrLoginStatusResponse> {
  const response = await apiClient.get<QrLoginStatusResponse>(
    `/auth/qr-login/challenges/${encodeURIComponent(challenge)}/status`,
    { headers: { 'X-QR-Poll-Secret': pollSecret } }
  )
  return response.data
}

/**
 * 在手机明确确认前读取扫码目标设备摘要。
 * @param challenge 二维码承载的短时 challenge
 * @param scope 仅本次扫码请求使用的 API 地址，不改变全局 API 配置
 * @returns 目标设备、平台、过期时间和挑战状态
 */
export async function inspectQrLoginChallenge(
  challenge: string,
  scope?: QrLoginRequestScope
): Promise<QrLoginInspection> {
  const response = await apiClient.get<QrLoginInspection>(
    `/auth/qr-login/challenges/${encodeURIComponent(challenge)}/inspect`,
    getScopedRequestConfig(scope)
  )
  return response.data
}

/**
 * 由已登录手机显式批准目标端登录。
 * @param challenge 二维码承载的短时 challenge
 * @param scope 仅本次扫码请求使用的 API 地址，不改变全局 API 配置
 */
export async function approveQrLoginChallenge(
  challenge: string,
  scope?: QrLoginRequestScope
): Promise<void> {
  await apiClient.post(
    `/auth/qr-login/challenges/${encodeURIComponent(challenge)}/approve`,
    undefined,
    getScopedRequestConfig(scope)
  )
}

/**
 * 由已登录手机显式拒绝目标端登录。
 * @param challenge 二维码承载的短时 challenge
 * @param scope 仅本次扫码请求使用的 API 地址，不改变全局 API 配置
 */
export async function denyQrLoginChallenge(
  challenge: string,
  scope?: QrLoginRequestScope
): Promise<void> {
  await apiClient.post(
    `/auth/qr-login/challenges/${encodeURIComponent(challenge)}/deny`,
    undefined,
    getScopedRequestConfig(scope)
  )
}

/**
 * 用获批挑战兑换一次常规认证会话。
 * @param input 目标端独占的 challenge、轮询凭据和短时授权码
 * @returns access/refresh token 及已登录用户资料
 */
export async function exchangeQrLoginChallenge(
  input: ExchangeQrLoginChallengeInput
): Promise<AuthResponse> {
  const response = await apiClient.post<AuthResponse>('/auth/qr-login/exchange', input)
  return response.data
}

/**
 * 解析并校验相机扫描到的元AI二维码载荷。
 * @param value 相机返回的原始条码文本
 * @returns 无令牌的 challenge 与 API 地址
 * @throws 当协议、challenge 或 API 地址不符合安全契约时抛出 `QR_LOGIN_INVALID_PAYLOAD`
 */
export function parseQrLoginPayload(value: string): ParsedQrLoginPayload {
  let payload: URL
  try {
    payload = new URL(value)
  } catch {
    throw new Error('QR_LOGIN_INVALID_PAYLOAD')
  }
  if (
    payload.protocol !== 'yuanai:' ||
    payload.hostname !== 'qr-login' ||
    payload.username ||
    payload.password ||
    payload.port ||
    (payload.pathname !== '' && payload.pathname !== '/') ||
    payload.hash
  ) {
    throw new Error('QR_LOGIN_INVALID_PAYLOAD')
  }

  const entries = Array.from(payload.searchParams.entries())
  const challenge = payload.searchParams.get('challenge')
  const apiBaseUrl = payload.searchParams.get('api')
  if (
    entries.length !== 2 ||
    !challenge ||
    !apiBaseUrl ||
    !CHALLENGE_PATTERN.test(challenge) ||
    entries.some(([key]) => key !== 'challenge' && key !== 'api')
  ) {
    throw new Error('QR_LOGIN_INVALID_PAYLOAD')
  }

  try {
    return { challenge, apiBaseUrl: normalizeQrLoginApiBaseUrl(apiBaseUrl) }
  } catch {
    throw new Error('QR_LOGIN_INVALID_PAYLOAD')
  }
}

function getScopedRequestConfig(scope?: QrLoginRequestScope): AxiosRequestConfig | undefined {
  if (scope?.apiBaseUrl === undefined) return undefined
  return { baseURL: normalizeQrLoginApiBaseUrl(scope.apiBaseUrl) }
}

function normalizeQrLoginApiBaseUrl(value: string): string {
  const url = new URL(value)
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/api/v1'
  ) {
    throw new Error('Invalid QR login API URL')
  }
  if (url.protocol === 'http:' && !isLoopbackOrPrivateHost(url.hostname)) {
    throw new Error('Invalid QR login API URL')
  }
  return url.toString().replace(/\/$/, '')
}

function isLoopbackOrPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === 'localhost' || normalized === '::1') return true
  if (/^(?:fc|fd)[0-9a-f:]*$/i.test(normalized)) return true

  const octets = normalized.split('.').map((part) => Number(part))
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false
  }
  const [first, second] = octets
  if (first === undefined || second === undefined) return false
  return (
    first === 127 ||
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}
