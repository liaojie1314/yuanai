'use client'

import { useEffect, useRef, type JSX } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useAuthStore } from '@yuanai/core/stores'
import { getMeWithToken } from '@yuanai/core/api'
import { useToast } from '@/hooks/useToast'

/**
 * 三方登录（GitHub / Google 等）回调页，provider 无关。
 *
 * 后端 `/api/v1/auth/{provider}/callback` 在完成 OAuth 后 302 到本页面，
 * 把 `access_token` / `refresh_token` 拼在 query 上；页面读取后：
 *   1. 用刚拿到的 token 通过 `getMeWithToken` 拉取用户信息
 *   2. 写入 auth store（`remember=true`，默认走 localStorage）
 *   3. 立刻 replace 到目标页（默认 `/chat`），并把 URL 中的 token 清掉
 *
 * 出错时后端会以 `error` / `error_description` 参数回跳；此处直接 toast 并
 * 回到 `/login`，不在 URL 里长期暴露 token。
 */
export default function OAuthCallbackPage(): JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const setAuth = useAuthStore((s) => s.setAuth)
  const toast = useToast()
  // React Strict Mode 会双执行 effect，用 ref 确保 token 只消费一次
  const consumed = useRef(false)

  useEffect(() => {
    if (consumed.current) return
    consumed.current = true

    const accessToken = searchParams.get('access_token')
    const refreshToken = searchParams.get('refresh_token')
    const error = searchParams.get('error')
    const errorDescription = searchParams.get('error_description')

    if (error) {
      toast.error(errorDescription ?? '三方登录失败，请重试')
      router.replace('/login')
      return
    }

    if (!accessToken || !refreshToken) {
      toast.error('回调参数缺失，无法完成登录')
      router.replace('/login')
      return
    }

    void (async () => {
      try {
        const user = await getMeWithToken(accessToken)
        setAuth(user, accessToken, refreshToken, true)
        router.replace('/chat')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '获取用户信息失败')
        router.replace('/login')
      }
    })()
  }, [router, searchParams, setAuth, toast])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        minHeight: '60vh',
        color: 'var(--fg2)',
        fontSize: 14,
      }}
    >
      <Loader2 size={20} className="ch-spin" />
      <span>正在完成登录…</span>
    </div>
  )
}
