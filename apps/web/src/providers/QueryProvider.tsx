'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { JSX } from 'react'
import { useEffect, useRef } from 'react'
import { setOnAuthFailure, setTokenGetter } from '@yuanai/core/api'
import { useAuthStore } from '@yuanai/core/stores'

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined

function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') {
    return makeQueryClient()
  }
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient()
  }
  return browserQueryClient
}

/**
 * 全局 QueryProvider：
 * 1. 初始化 TanStack QueryClient
 * 2. 向 apiClient 注册 token getter（从 auth store 读取 access_token）
 * 3. 注册 401 回调（清除 auth 状态并跳转登录页）
 */
export default function QueryProvider({
  children,
}: {
  readonly children: React.ReactNode
}): JSX.Element {
  const qc = getQueryClient()
  const registered = useRef(false)

  useEffect(() => {
    if (registered.current) return
    registered.current = true

    setTokenGetter(() => useAuthStore.getState().accessToken)

    setOnAuthFailure(() => {
      useAuthStore.getState().clearAuth()
      if (
        typeof window !== 'undefined' &&
        !window.location.pathname.startsWith('/login') &&
        !window.location.pathname.startsWith('/register')
      ) {
        window.location.href = '/login'
      }
    })
  }, [])

  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}
