import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import {
  createQrLoginChallenge,
  exchangeQrLoginChallenge,
  getQrLoginStatus,
} from '@yuanai/core/api'
import { useAuthStore } from '@yuanai/core/stores'
import type { QrLoginChallenge } from '@yuanai/types'

import '../shared/i18n'

type QrPanelState = 'creating' | 'waiting' | 'exchanging' | 'denied' | 'expired' | 'error'
type QrFailureReason = 'rate-limited' | 'unavailable'

interface QrLoginPanelProps {
  onBack(): void
}

/**
 * 在 Electron 登录窗口展示二维码并等待已登录手机的显式批准。
 * @param props 返回普通账号密码登录页的回调
 */
export function QrLoginPanel({ onBack }: QrLoginPanelProps): ReactElement {
  const { t } = useTranslation()
  const setAuth = useAuthStore((state) => state.setAuth)
  const [challenge, setChallenge] = useState<QrLoginChallenge | null>(null)
  const [state, setState] = useState<QrPanelState>('creating')
  const [failureReason, setFailureReason] = useState<QrFailureReason | null>(null)
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const requestVersion = useRef(0)
  const exchangeStarted = useRef(false)

  const createChallenge = useCallback(async (keepCurrentCode = false): Promise<void> => {
    const version = ++requestVersion.current
    exchangeStarted.current = false
    if (!keepCurrentCode) setChallenge(null)
    setFailureReason(null)
    setState('creating')
    try {
      const nextChallenge = await createQrLoginChallenge({
        targetPlatform: 'desktop',
        deviceName: '元AI桌面端',
      })
      if (version !== requestVersion.current) return
      setChallenge(nextChallenge)
      setRemainingSeconds(getRemainingSeconds(nextChallenge.expiresAt))
      setState('waiting')
    } catch (error) {
      if (version === requestVersion.current) {
        setFailureReason(isQrRateLimitError(error) ? 'rate-limited' : 'unavailable')
        setState('error')
      }
    }
  }, [])

  useEffect(() => {
    void createChallenge()
    return () => {
      requestVersion.current += 1
    }
  }, [createChallenge])

  useEffect(() => {
    if (!challenge || state !== 'waiting') return undefined
    const updateRemainingSeconds = (): void => {
      const seconds = getRemainingSeconds(challenge.expiresAt)
      setRemainingSeconds(seconds)
      if (seconds === 0) setState('expired')
    }
    updateRemainingSeconds()
    const timer = window.setInterval(updateRemainingSeconds, 1000)
    return () => window.clearInterval(timer)
  }, [challenge, state])

  useEffect(() => {
    if (!challenge || state !== 'waiting') return undefined
    let polling = false
    const pollStatus = async (): Promise<void> => {
      if (polling || exchangeStarted.current) return
      polling = true
      try {
        const result = await getQrLoginStatus(challenge.challenge, challenge.pollSecret)
        if (result.status === 'pending') return
        if (result.status === 'denied' || result.status === 'consumed') {
          setState('denied')
          return
        }
        if (result.status === 'expired') {
          setState('expired')
          return
        }
        if (!result.authorizationCode) {
          setState('error')
          return
        }
        exchangeStarted.current = true
        setState('exchanging')
        const response = await exchangeQrLoginChallenge({
          challenge: challenge.challenge,
          pollSecret: challenge.pollSecret,
          authorizationCode: result.authorizationCode,
        })
        setAuth(response.user, response.access_token, response.refresh_token, true)
      } catch {
        if (!exchangeStarted.current) setState('error')
      } finally {
        polling = false
      }
    }
    const pollAfterMs = Math.min(Math.max(challenge.pollAfterMs, 250), 10_000)
    const timer = window.setInterval(() => void pollStatus(), pollAfterMs)
    return () => window.clearInterval(timer)
  }, [challenge, setAuth, state])

  function handleBack(): void {
    requestVersion.current += 1
    setChallenge(null)
    onBack()
  }

  return (
    <main className="desktop-auth" aria-label={t('auth.qrLogin')}>
      <section className="desktop-auth__content">
        <div className="desktop-auth__form">
          <header className="desktop-auth__heading">
            <div className="desktop-auth__logo" aria-hidden="true">
              元
            </div>
            <h1>{t('auth.qrLogin')}</h1>
            <p className="desktop-auth__subtitle">{t('auth.qrLoginDesc')}</p>
          </header>
          <section
            className="desktop-auth__qr-panel"
            aria-busy={state === 'creating' || state === 'exchanging'}
          >
            <div className="desktop-auth__qr-box">
              {challenge ? (
                <img src={challenge.qrDataUri} alt={t('auth.qrCodeAlt')} />
              ) : (
                <span role="status">{getQrBoxMessage(t, state, failureReason)}</span>
              )}
            </div>
            <p className="desktop-auth__qr-status" aria-live="polite">
              {getStateMessage(t, state, failureReason)}
            </p>
            {state === 'waiting' ? (
              <p className="desktop-auth__qr-expiry">
                {t('auth.qrExpires', { seconds: remainingSeconds })}
              </p>
            ) : null}
            {state !== 'creating' && state !== 'exchanging' ? (
              <button
                className="desktop-auth__qr-refresh"
                type="button"
                onClick={() => void createChallenge(true)}
              >
                <RefreshCw aria-hidden="true" size={15} />
                {t('auth.qrRefresh')}
              </button>
            ) : null}
            <button className="desktop-auth__link" type="button" onClick={handleBack}>
              {t('desktop.oauth.backToLogin')}
            </button>
          </section>
        </div>
      </section>
    </main>
  )
}

function getRemainingSeconds(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000))
}

function getStateMessage(
  translate: (key: string) => string,
  state: QrPanelState,
  failureReason: QrFailureReason | null
): string {
  switch (state) {
    case 'creating':
      return translate('auth.qrPreparing')
    case 'waiting':
      return translate('auth.qrWaitingApproval')
    case 'exchanging':
      return translate('auth.qrCompleting')
    case 'denied':
      return translate('auth.qrDenied')
    case 'expired':
      return translate('auth.qrExpired')
    case 'error':
      return failureReason === 'rate-limited'
        ? translate('auth.qrRateLimited')
        : translate('auth.qrFailed')
  }
}

function getQrBoxMessage(
  translate: (key: string) => string,
  state: QrPanelState,
  failureReason: QrFailureReason | null
): string {
  return state === 'creating'
    ? translate('auth.qrPreparing')
    : getStateMessage(translate, state, failureReason)
}

function isQrRateLimitError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('response' in error)) return false
  const response = error.response
  return (
    typeof response === 'object' &&
    response !== null &&
    'status' in response &&
    response.status === 429
  )
}
