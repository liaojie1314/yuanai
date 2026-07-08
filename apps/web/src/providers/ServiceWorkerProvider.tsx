'use client'

import { useEffect, type JSX } from 'react'
import { useRouter } from 'next/navigation'
import { registerNotificationServiceWorker } from '@/lib/notifications'

/**
 * 客户端组件：应用挂载后异步注册通知用 Service Worker。
 *
 * 同时监听 SW 广播的 `NAVIGATE` 消息——用户点击系统通知回到页面时，
 * 自动切换到目标路由（默认 `/`，未来 push payload 可指定具体会话链接）。
 *
 * 该组件不渲染任何 DOM，仅承担副作用注册。
 */
export function ServiceWorkerProvider(): JSX.Element | null {
  const router = useRouter()

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

  return null
}
