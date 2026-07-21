import type { ExpoPushTokenPayload, PushSubscriptionPayload } from '@yuanai/types'
import { apiClient } from './client.js'

/**
 * 获取后端 VAPID 公钥，作为浏览器 `pushManager.subscribe` 的 applicationServerKey。
 * 未配置时后端返回空串，前端据此跳过订阅。
 */
export async function getVapidPublicKey(): Promise<string> {
  const res = await apiClient.get<{ publicKey: string }>('/notifications/vapid-public-key')
  return res.data.publicKey
}

/** 上报当前浏览器的 Web Push 订阅到后端（需已登录） */
export async function subscribePush(subscription: PushSubscriptionPayload): Promise<void> {
  await apiClient.post('/notifications/subscribe', subscription)
}

/** 按 endpoint 退订当前浏览器的 Web Push 订阅（需已登录） */
export async function unsubscribePush(endpoint: string): Promise<void> {
  await apiClient.post('/notifications/unsubscribe', { endpoint })
}

/** 上报移动端 Expo Push token 到后端（需已登录；同 token 重复上报幂等） */
export async function registerExpoPush(payload: ExpoPushTokenPayload): Promise<void> {
  await apiClient.post('/notifications/expo', payload)
}

/** 移除移动端 Expo Push token（需已登录；仅能删自己的） */
export async function unregisterExpoPush(token: string): Promise<void> {
  await apiClient.delete(`/notifications/expo/${encodeURIComponent(token)}`)
}
