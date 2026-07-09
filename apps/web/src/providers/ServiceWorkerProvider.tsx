'use client'

import { useEffect, type JSX } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@yuanai/core/stores'
import { registerNotificationServiceWorker } from '@/lib/notifications'
import { ensurePushSubscribed } from '@/lib/push'

/**
 * 客户端组件：应用挂载后异步注册通知用 Service Worker。
 *
 * 同时监听 SW 广播的 `NAVIGATE` 消息——用户点击系统通知回到页面时，
 * 自动切换到目标路由（默认 `/`，push payload 可指定具体会话链接）。
 *
 * 登录状态下，若用户已开启「AI 回复通知」且授予了通知权限，则确保当前浏览器
 * 已向后端登记 Web Push 订阅（幂等），从而标签页关闭时也能收到服务端推送。
 *
 * 该组件不渲染任何 DOM，仅承担副作用注册。
 */
export function ServiceWorkerProvider(): JSX.Element | null {
  const router = useRouter()
  const accessToken = useAuthStore((s) => s.accessToken)

  useEffect(() => {
    registerNotificationServiceWorker()
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { type?: string; url?: string } | undefined
      if (data?.type === 'NAVIGATE' && typeof data.url === 'string') {
        router.push(data.url)
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [router])

  // 登录后，若通知开关开启且权限已授予，确保 Web Push 订阅已登记到后端
  useEffect(() => {
    if (!accessToken) return
    if (typeof window === 'undefined') return
    if (localStorage.getItem('notif_ai') !== 'true') return
    void ensurePushSubscribed()
  }, [accessToken])

  return null
}
