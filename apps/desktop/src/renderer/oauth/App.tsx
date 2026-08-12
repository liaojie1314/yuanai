import { CircleAlert, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import { useDesktopOAuthExchange } from '@yuanai/core/hooks'

import '../shared/i18n'

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return fallback
  }
  const response = error.response
  if (typeof response !== 'object' || response === null || !('data' in response)) {
    return fallback
  }
  const data = response.data
  if (typeof data !== 'object' || data === null || !('detail' in data)) {
    return fallback
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
  return fallback
}

/** 处理桌面 OAuth 深链接的一次性授权码交换。 */
export function App(): ReactElement {
  const { t } = useTranslation()
  const { mutateAsync } = useDesktopOAuthExchange()
  const [error, setError] = useState<string | null>(null)
  const hasHandledResult = useRef(false)

  useEffect(() => {
    return window.yuanai.events.onOAuthResult((result) => {
      if (hasHandledResult.current) return
      hasHandledResult.current = true
      if (result.type === 'oauth-error') {
        setError(result.description || t('desktop.oauth.providerRetry'))
        return
      }
      void mutateAsync(result.code).catch((reason: unknown) => {
        setError(getErrorMessage(reason, t('desktop.oauth.retry')))
      })
    })
  }, [mutateAsync, t])

  if (error) {
    return (
      <main className="desktop-oauth" aria-label={t('desktop.oauth.incomplete')}>
        <CircleAlert aria-hidden="true" className="desktop-oauth__error-icon" size={34} />
        <h1>{t('desktop.oauth.incomplete')}</h1>
        <p role="alert">{error}</p>
        <button type="button" onClick={() => window.close()}>
          {t('desktop.oauth.backToLogin')}
        </button>
      </main>
    )
  }

  return (
    <main className="desktop-oauth" aria-label={t('desktop.oauth.completing')}>
      <LoaderCircle aria-hidden="true" className="desktop-oauth__spinner" size={34} />
      <h1>{t('desktop.oauth.completing')}</h1>
      <p role="status">{t('desktop.oauth.waiting')}</p>
    </main>
  )
}
