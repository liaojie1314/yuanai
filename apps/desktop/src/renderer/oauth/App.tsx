import { CircleAlert, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'

import { useDesktopOAuthExchange } from '@yuanai/core/hooks'

function getErrorMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return '登录未完成，请返回后重试'
  }
  const response = error.response
  if (typeof response !== 'object' || response === null || !('data' in response)) {
    return '登录未完成，请返回后重试'
  }
  const data = response.data
  if (typeof data !== 'object' || data === null || !('detail' in data)) {
    return '登录未完成，请返回后重试'
  }
  const detail = data.detail
  if (
    typeof detail === 'object' &&
    detail !== null &&
    'message' in detail &&
    typeof detail.message === 'string'
  ) {
    return detail.message
  }
  return '登录未完成，请返回后重试'
}

/** 处理桌面 OAuth 深链接的一次性授权码交换。 */
export function App(): ReactElement {
  const { mutateAsync } = useDesktopOAuthExchange()
  const [error, setError] = useState<string | null>(null)
  const hasHandledResult = useRef(false)

  useEffect(() => {
    return window.yuanai.events.onOAuthResult((result) => {
      if (hasHandledResult.current) return
      hasHandledResult.current = true
      if (result.type === 'oauth-error') {
        setError(result.description || '第三方登录未完成，请返回后重试')
        return
      }
      void mutateAsync(result.code).catch((reason: unknown) => {
        setError(getErrorMessage(reason))
      })
    })
  }, [mutateAsync])

  if (error) {
    return (
      <main className="desktop-oauth" aria-label="登录未完成">
        <CircleAlert aria-hidden="true" className="desktop-oauth__error-icon" size={34} />
        <h1>登录未完成</h1>
        <p role="alert">{error}</p>
        <button type="button" onClick={() => window.close()}>
          返回登录
        </button>
      </main>
    )
  }

  return (
    <main className="desktop-oauth" aria-label="正在完成登录">
      <LoaderCircle aria-hidden="true" className="desktop-oauth__spinner" size={34} />
      <h1>正在完成登录</h1>
      <p role="status">请稍候。</p>
    </main>
  )
}
