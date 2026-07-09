/* eslint-disable no-restricted-globals */
/**
 * yuanai Service Worker — 通知能力后台化
 *
 * 目前承担两件事：
 * 1. `push` 事件：解析服务端 payload 后调用 `showNotification`，
 *    让页面处于后台/最小化状态时依然能弹出系统通知。后端 push 端点尚未实现，
 *    该事件当前是「预留链路」——保留代码以便下游服务上线后立即生效。
 * 2. `notificationclick` 事件：点击系统通知后 focus 已打开的元AI 标签，
 *    没有则新开一个；同时向所有客户端广播 `PLAY_NOTIFICATION_SOUND`，
 *    由主线程复用 lib/notifications.ts 中的 playNotificationSound。
 *
 * SW 不缓存业务资源——只做通知代理，不参与静态资源缓存策略。
 */

const NOTIFICATION_TAG = 'yuanai-ai-reply'
const CLIENT_URL_PATTERN = /^\/(chat|share|$)/

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

/**
 * push payload 契约（当后端接入 Web Push 时按此发送）：
 * {
 *   title?: string,
 *   body?: string,
 *   icon?: string,
 *   url?: string,        // 点击通知打开的目标路径，默认 "/"
 *   tag?: string
 * }
 */
self.addEventListener('push', (event) => {
  let payload = {}
  if (event.data) {
    try {
      payload = event.data.json()
    } catch {
      payload = { body: event.data.text() }
    }
  }
  const title = payload.title || '元AI'
  const options = {
    body: payload.body || 'AI 回复已完成',
    icon: payload.icon || '/favicon.ico',
    tag: payload.tag || NOTIFICATION_TAG,
    data: { url: payload.url || '/' },
  }
  event.waitUntil(
    (async () => {
      // 若已有前台可见/聚焦的标签，用户正在看，无需再弹系统通知打扰；
      // 前台的声音/角标由主线程 triggerAIReplyNotification 处理。
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      const foreground = clientList.some(
        (c) => c.focused || c.visibilityState === 'visible'
      )
      if (foreground) return
      await self.registration.showNotification(title, options)
    })()
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // 广播播音请求：主线程收到后调用 playNotificationSound
      for (const client of allClients) {
        client.postMessage({ type: 'PLAY_NOTIFICATION_SOUND' })
      }
      const existing = allClients.find((c) => CLIENT_URL_PATTERN.test(new URL(c.url).pathname))
      if (existing) {
        existing.postMessage({ type: 'NAVIGATE', url: targetUrl })
        return existing.focus()
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }
      return null
    })()
  )
})
