'use client'

import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type JSX } from 'react'

import {
  createQrLoginChallenge,
  exchangeQrLoginChallenge,
  getQrLoginStatus,
} from '@yuanai/core/api'
import type { QrLoginChallenge } from '@yuanai/types'
import { useAuthStore } from '@yuanai/core/stores'
import { useTranslations } from '@/i18n/client'

type QrPanelState = 'creating' | 'waiting' | 'exchanging' | 'denied' | 'expired' | 'error'
type QrFailureReason = 'rate-limited' | 'unavailable'

interface QrLoginPanelProps {
  deviceName: string
  onBack(): void
  onAuthenticated(): void
}

/**
 * 展示 Web 目标端二维码并以独立轮询凭据等待手机显式批准。
 * @param props 目标设备名称以及登录完成、返回的页面回调
 */
export function QrLoginPanel({
  deviceName,
  onBack,
  onAuthenticated,
}: QrLoginPanelProps): JSX.Element {
  const t = useTranslations('auth')
  const setAuth = useAuthStore((state) => state.setAuth)
  const [challenge, setChallenge] = useState<QrLoginChallenge | null>(null)
  const [state, setState] = useState<QrPanelState>('creating')
  const [failureReason, setFailureReason] = useState<QrFailureReason | null>(null)
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const requestVersion = useRef(0)
  const exchangeStarted = useRef(false)

  const createChallenge = useCallback(
    async (keepCurrentCode = false): Promise<void> => {
      const version = ++requestVersion.current
      exchangeStarted.current = false
      if (!keepCurrentCode) setChallenge(null)
      setFailureReason(null)
      setState('creating')
      try {
        const nextChallenge = await createQrLoginChallenge({ targetPlatform: 'web', deviceName })
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
    },
    [deviceName]
  )

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
        onAuthenticated()
      } catch {
        if (!exchangeStarted.current) setState('error')
      } finally {
        polling = false
      }
    }
    const pollAfterMs = Math.min(Math.max(challenge.pollAfterMs, 250), 10_000)
    const timer = window.setInterval(() => void pollStatus(), pollAfterMs)
    return () => window.clearInterval(timer)
  }, [challenge, onAuthenticated, setAuth, state])

  function handleBack(): void {
    requestVersion.current += 1
    setChallenge(null)
    onBack()
  }

  return (
    <section className="qr-view" aria-busy={state === 'creating' || state === 'exchanging'}>
      <div className="qr-box">
        {challenge ? (
          <img src={challenge.qrDataUri} alt={t('qrCodeAlt')} />
        ) : (
          <span className="qr-loading" role="status">
            {getQrBoxMessage(t, state, failureReason)}
          </span>
        )}
      </div>
      <h3>{t('qrLogin')}</h3>
      <p>{t('qrLoginDesc')}</p>
      <p className="qr-status" aria-live="polite">
        {getStateMessage(t, state, failureReason)}
      </p>
      {state === 'waiting' ? (
        <p className="qr-exp">{t('qrExpires', { seconds: remainingSeconds })}</p>
      ) : null}
      <div className="qr-actions">
        {state !== 'creating' && state !== 'exchanging' ? (
          <button className="qr-refresh" type="button" onClick={() => void createChallenge(true)}>
            <RefreshCw aria-hidden="true" size={15} />
            {t('qrRefresh')}
          </button>
        ) : null}
        <button className="qr-back" type="button" onClick={handleBack}>
          {t('backToPassword')}
        </button>
      </div>
    </section>
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
      return translate('qrPreparing')
    case 'waiting':
      return translate('qrWaitingApproval')
    case 'exchanging':
      return translate('qrCompleting')
    case 'denied':
      return translate('qrDenied')
    case 'expired':
      return translate('qrExpired')
    case 'error':
      return failureReason === 'rate-limited' ? translate('qrRateLimited') : translate('qrFailed')
  }
}

function getQrBoxMessage(
  translate: (key: string) => string,
  state: QrPanelState,
  failureReason: QrFailureReason | null
): string {
  return state === 'creating'
    ? translate('qrPreparing')
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
