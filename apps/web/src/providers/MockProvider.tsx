'use client'

import { useEffect, useState, type JSX } from 'react'

/**
 * 当 `NEXT_PUBLIC_MOCK=true` 时，在浏览器端启动 MSW Service Worker，
 * 拦截所有 API 请求并返回 mock 数据，无需启动后端服务。
 *
 * mock 账号：demo@yuanai.dev / Demo1234!
 */
export default function MockProvider({
  children,
}: {
  readonly children: React.ReactNode
}): JSX.Element {
  const [ready, setReady] = useState(process.env.NEXT_PUBLIC_MOCK !== 'true')

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_MOCK !== 'true') return

    async function start(): Promise<void> {
      const { worker } = await import('@/mocks/browser')
      await worker.start({
        onUnhandledRequest: 'bypass',
        serviceWorker: { url: '/mockServiceWorker.js' },
      })
      setReady(true)
    }
    void start()
  }, [])

  if (!ready) return <></>
  return <>{children}</>
}
