'use client'

import { useState, useRef, useEffect, type JSX } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { QrCode, Mail, Lock, Eye, EyeOff } from 'lucide-react'
import AuthPanel from '@/components/auth/AuthPanel'
import { useTranslations } from '@/i18n/client'
import { useLogin } from '@yuanai/core/hooks'

export default function LoginPage(): JSX.Element {
  const t = useTranslations('auth')
  const router = useRouter()
  const searchParams = useSearchParams()

  const loginMutation = useLogin()

  const [tab, setTab] = useState<'emailCode' | 'email'>('emailCode')
  const [showQr, setShowQr] = useState(false)

  // Email code tab state
  const [codeEmail, setCodeEmail] = useState('')
  const [emailCodeVal, setEmailCodeVal] = useState('')
  const [codeEmailErr, setCodeEmailErr] = useState('')
  const [codeErr, setCodeErr] = useState('')
  const [codeCount, setCodeCount] = useState(0)
  const codeTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Email password tab state
  const [email, setEmail] = useState('')
  const [pwd, setPwd] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [remember, setRemember] = useState(false)
  const [emailErr, setEmailErr] = useState('')
  const [pwdErr, setPwdErr] = useState('')
  const [apiErr, setApiErr] = useState('')

  // QR code state
  const [qrCount, setQrCount] = useState(60)
  const qrTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(
    () => () => {
      if (codeTimer.current) clearInterval(codeTimer.current)
      if (qrTimer.current) clearInterval(qrTimer.current)
    },
    []
  )

  const startQr = (): void => {
    setShowQr(true)
    setQrCount(60)
    if (qrTimer.current) clearInterval(qrTimer.current)
    qrTimer.current = setInterval(() => {
      setQrCount((c) => {
        if (c <= 1) {
          if (qrTimer.current) clearInterval(qrTimer.current)
          return 0
        }
        return c - 1
      })
    }, 1000)
  }
  const closeQr = (): void => {
    setShowQr(false)
    if (qrTimer.current) clearInterval(qrTimer.current)
  }

  const sendEmailCode = (): void => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(codeEmail.trim())) {
      setCodeEmailErr(t('errors.invalidEmail'))
      return
    }
    setCodeEmailErr('')
    let s = 60
    setCodeCount(s)
    if (codeTimer.current) clearInterval(codeTimer.current)
    codeTimer.current = setInterval(() => {
      s--
      setCodeCount(s)
      if (s <= 0) {
        if (codeTimer.current) clearInterval(codeTimer.current)
        setCodeCount(0)
      }
    }, 1000)
  }

  const redirectAfterLogin = (): void => {
    const from = searchParams.get('from') ?? '/chat'
    router.replace(from)
  }

  const handleEmailCode = (e: React.FormEvent): void => {
    e.preventDefault()
    let ok = true
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(codeEmail.trim())) {
      setCodeEmailErr(t('errors.invalidEmail'))
      ok = false
    } else setCodeEmailErr('')
    if (emailCodeVal.trim().length < 6) {
      setCodeErr(t('errors.codeRequired'))
      ok = false
    } else setCodeErr('')
    if (!ok) return
    // 邮箱验证码登录暂未开放
    setCodeEmailErr('邮箱验证码登录暂未开放，请使用邮箱密码登录')
  }

  const handleEmail = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setApiErr('')
    let ok = true
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailErr(t('errors.invalidEmail'))
      ok = false
    } else setEmailErr('')
    if (!pwd) {
      setPwdErr(t('errors.passwordRequired'))
      ok = false
    } else setPwdErr('')
    if (!ok) return

    try {
      await loginMutation.mutateAsync({ email: email.trim(), password: pwd })
      redirectAfterLogin()
    } catch (err) {
      const msg = err instanceof Error ? err.message : '登录失败，请检查邮箱和密码'
      // axios 错误中取后端 message
      const detail = (err as { response?: { data?: { detail?: { message?: string } } } })?.response
        ?.data?.detail
      setApiErr(detail?.message ?? msg)
    }
  }

  const loading = loginMutation.isPending

  return (
    <div className="auth-wrap">
      <AuthPanel
        bubbles={[
          t('bubbles.login1'),
          t('bubbles.login2'),
          t('bubbles.login3'),
          t('bubbles.login4'),
          t('bubbles.login5'),
        ]}
      />

      <main className="auth-right">
        <div className="form-card">
          <button
            className="qr-toggle"
            title={t('qrLogin')}
            aria-label={t('qrLogin')}
            onClick={startQr}
          >
            <QrCode size={18} />
          </button>

          {showQr ? (
            <div className="qr-view">
              <div className="qr-box">
                <img
                  src="/icons/qr-demo.svg"
                  alt={t('qrLogin')}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
              <h3>{t('qrLogin')}</h3>
              <p>{t('qrLoginDesc')}</p>
              <p className="qr-exp">{t('qrExpires', { seconds: qrCount })}</p>
              <button className="qr-back" onClick={closeQr}>
                ← {t('backToPassword')}
              </button>
            </div>
          ) : (
            <div>
              <h1 className="page-title">{t('welcomeBack')}</h1>
              <p className="page-sub">{t('loginSubtitle')}</p>

              <div className="auth-tabs" role="tablist">
                <button
                  className={tab === 'emailCode' ? 'a-tab on' : 'a-tab'}
                  role="tab"
                  onClick={() => setTab('emailCode')}
                >
                  {t('emailCode')}
                </button>
                <button
                  className={tab === 'email' ? 'a-tab on' : 'a-tab'}
                  role="tab"
                  onClick={() => setTab('email')}
                >
                  {t('email')}
                  {t('password')}
                </button>
              </div>

              {tab === 'emailCode' ? (
                <form onSubmit={handleEmailCode} noValidate>
                  <div className="fg">
                    <label className="fl" htmlFor="code-email">
                      {t('email')}
                    </label>
                    <div className="iw">
                      <span className="ii">
                        <Mail size={16} />
                      </span>
                      <input
                        id="code-email"
                        className={codeEmailErr ? 'fi err' : 'fi'}
                        type="email"
                        placeholder={t('placeholders.email')}
                        autoComplete="email"
                        value={codeEmail}
                        onChange={(e) => setCodeEmail(e.target.value)}
                      />
                    </div>
                    <p className={codeEmailErr ? 'ferr on' : 'ferr'}>{codeEmailErr}</p>
                  </div>

                  <div className="fg">
                    <label className="fl" htmlFor="ecode">
                      {t('verificationCode')}
                    </label>
                    <div className="code-row">
                      <div className="iw" style={{ flex: 1 }}>
                        <input
                          id="ecode"
                          className={codeErr ? 'fi err' : 'fi'}
                          type="text"
                          inputMode="numeric"
                          placeholder={t('placeholders.code')}
                          maxLength={6}
                          autoComplete="one-time-code"
                          value={emailCodeVal}
                          onChange={(e) => setEmailCodeVal(e.target.value.replace(/\D/g, ''))}
                        />
                      </div>
                      <button
                        type="button"
                        className="code-btn"
                        disabled={codeCount > 0}
                        onClick={sendEmailCode}
                      >
                        {codeCount > 0 ? t('resendIn', { seconds: codeCount }) : t('sendCode')}
                      </button>
                    </div>
                    <p className={codeErr ? 'ferr on' : 'ferr'}>{codeErr}</p>
                  </div>

                  <button type="submit" className="btn">
                    {t('login')}
                  </button>
                </form>
              ) : (
                <form
                  onSubmit={(e) => {
                    void handleEmail(e)
                  }}
                  noValidate
                >
                  {apiErr && (
                    <p className="ferr on" style={{ marginBottom: '12px' }}>
                      {apiErr}
                    </p>
                  )}

                  <div className="fg">
                    <label className="fl" htmlFor="em">
                      {t('email')}
                    </label>
                    <div className="iw">
                      <span className="ii">
                        <Mail size={16} />
                      </span>
                      <input
                        id="em"
                        className={emailErr ? 'fi err' : 'fi'}
                        type="email"
                        placeholder={t('placeholders.email')}
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                    <p className={emailErr ? 'ferr on' : 'ferr'}>{emailErr}</p>
                  </div>

                  <div className="fg">
                    <label className="fl" htmlFor="pw">
                      {t('password')}
                    </label>
                    <div className="iw">
                      <span className="ii">
                        <Lock size={16} />
                      </span>
                      <input
                        id="pw"
                        className={pwdErr ? 'fi err' : 'fi'}
                        type={showPwd ? 'text' : 'password'}
                        placeholder={t('placeholders.password')}
                        autoComplete="current-password"
                        value={pwd}
                        onChange={(e) => setPwd(e.target.value)}
                      />
                      <button
                        type="button"
                        className="eye-btn"
                        onClick={() => setShowPwd(!showPwd)}
                        aria-label={showPwd ? 'Hide password' : 'Show password'}
                      >
                        {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <p className={pwdErr ? 'ferr on' : 'ferr'}>{pwdErr}</p>
                  </div>

                  <div className="flex-row">
                    <label className="rm-chk">
                      <input
                        type="checkbox"
                        checked={remember}
                        onChange={(e) => setRemember(e.target.checked)}
                      />
                      <span className="rm-lbl">{t('rememberMe')}</span>
                    </label>
                    <Link href="/forgot-password" className="fl-link" replace>
                      {t('forgotPassword')}
                    </Link>
                  </div>

                  <button type="submit" className="btn" disabled={loading}>
                    {loading ? (
                      <>
                        <span className="spin" />
                        {t('loggingIn')}
                      </>
                    ) : (
                      t('login')
                    )}
                  </button>
                </form>
              )}
            </div>
          )}

          <div className="divider">
            <span>{t('orLoginWith')}</span>
          </div>

          <div className="social-row">
            <button className="soc-btn" aria-label={`${t('wechat')} ${t('login')}`}>
              <img src="/icons/wechat.svg" alt="" className="soc-icon" />
              <span>{t('wechat')}</span>
            </button>
            <button className="soc-btn" aria-label={`${t('google')} ${t('login')}`}>
              <img src="/icons/google.svg" alt="" className="soc-icon" />
              <span>{t('google')}</span>
            </button>
            <button className="soc-btn" aria-label={`${t('apple')} ${t('login')}`}>
              <img src="/icons/apple.svg" alt="" className="soc-icon" />
              <span>{t('apple')}</span>
            </button>
          </div>

          <p className="signup-cta">
            {t('noAccount')}
            <Link href="/register" replace>
              {t('signUpNow')}
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
