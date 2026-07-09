/**
 * Web Push 订阅编排（前端侧）。
 *
 * 负责把浏览器 `PushManager` 订阅与后端 `/notifications` 端点打通：
 * - {@link ensurePushSubscribed}：登录 + 已授权通知时确保存在订阅并上报后端
 * - {@link removePushSubscription}：退订并通知后端删除
 *
 * 仅在 HTTPS/localhost + 支持 PushManager + 已配置 VAPID 的环境下生效，
 * 其余情况静默降级（不影响纯客户端通知链路）。
 */
import { getVapidPublicKey, subscribePush, unsubscribePush } from '@yuanai/core/api'

/**
 * 把后端返回的 base64url VAPID 公钥转成 `applicationServerKey` 所需的 Uint8Array。
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  // 显式基于 ArrayBuffer 构造，满足 applicationServerKey 的 BufferSource 类型
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i)
  }
  return output
}

/** 环境是否支持 Web Push（SW + PushManager + Notification 均可用）。 */
function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/**
 * 确保当前浏览器已订阅 Web Push 并把订阅上报后端。
 *
 * 前置条件（任一不满足则静默返回）：支持 Push、通知权限已授予、后端已配置 VAPID。
 * 已存在订阅时直接复用（重复上报后端幂等）。失败静默——推送是尽力而为的增强能力。
 */
export async function ensurePushSubscribed(): Promise<void> {
  if (!isPushSupported()) return
  if (Notification.permission !== 'granted') return

  try {
    const vapidKey = await getVapidPublicKey()
    if (!vapidKey) return // 后端未配置 VAPID

    const reg = await navigator.serviceWorker.ready
    let subscription = await reg.pushManager.getSubscription()
    subscription ??= await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    })

    const json = subscription.toJSON()
    if (!json.endpoint || !json.keys?.['p256dh'] || !json.keys['auth']) return
    await subscribePush({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys['p256dh'], auth: json.keys['auth'] },
    })
  } catch (err) {
    console.warn('Web Push 订阅失败（已降级为纯客户端通知）:', err)
  }
}

/**
 * 退订当前浏览器的 Web Push，并通知后端删除该 endpoint。
 * 失败静默。
 */
export async function removePushSubscription(): Promise<void> {
  if (!isPushSupported()) return
  try {
    const reg = await navigator.serviceWorker.ready
    const subscription = await reg.pushManager.getSubscription()
    if (!subscription) return
    await unsubscribePush(subscription.endpoint)
    await subscription.unsubscribe()
  } catch (err) {
    console.warn('Web Push 退订失败:', err)
  }
}
