'use client'

import { useState, useRef, useEffect, type JSX } from 'react'
import Link from 'next/link'
import { QrCode, Smartphone, Mail, Lock, Eye, EyeOff } from 'lucide-react'
import AuthPanel from '@/components/auth/AuthPanel'
import { useTranslations } from '@/i18n/client'

export default function LoginPage(): JSX.Element {
  const t = useTranslations('auth')

  const [tab, setTab] = useState<'phone' | 'email'>('phone')
  const [showQr, setShowQr] = useState(false)

  const [phone, setPhone] = useState('')
  const [sms, setSms] = useState('')
  const [phoneErr, setPhoneErr] = useState('')
  const [smsErr, setSmsErr] = useState('')
  const [smsCount, setSmsCount] = useState(0)
  const smsTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const [phoneLoading, setPhoneLoading] = useState(false)

  const [email, setEmail] = useState('')
  const [pwd, setPwd] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [remember, setRemember] = useState(false)
  const [emailErr, setEmailErr] = useState('')
  const [pwdErr, setPwdErr] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)

  const [qrCount, setQrCount] = useState(60)
  const qrTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(
    () => () => {
      if (smsTimer.current) clearInterval(smsTimer.current)
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

  const sendSms = (): void => {
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) {
      setPhoneErr(t('errors.invalidPhone'))
      return
    }
    setPhoneErr('')
    let s = 60
    setSmsCount(s)
    if (smsTimer.current) clearInterval(smsTimer.current)
    smsTimer.current = setInterval(() => {
      s--
      setSmsCount(s)
      if (s <= 0) {
        if (smsTimer.current) clearInterval(smsTimer.current)
        setSmsCount(0)
      }
    }, 1000)
  }

  const handlePhone = (e: React.FormEvent): void => {
    e.preventDefault()
    let ok = true
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) {
      setPhoneErr(t('errors.invalidPhone'))
      ok = false
    } else setPhoneErr('')
    if (sms.trim().length < 6) {
      setSmsErr(t('errors.codeRequired'))
      ok = false
    } else setSmsErr('')
    if (!ok) return
    setPhoneLoading(true)
    setTimeout(() => setPhoneLoading(false), 1600)
  }

  const handleEmail = (e: React.FormEvent): void => {
    e.preventDefault()
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
    setEmailLoading(true)
    setTimeout(() => setEmailLoading(false), 1600)
  }

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
                  className={tab === 'phone' ? 'a-tab on' : 'a-tab'}
                  role="tab"
                  onClick={() => setTab('phone')}
                >
                  {t('phone')}
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

              {tab === 'phone' ? (
                <form onSubmit={handlePhone} noValidate>
                  <div className="fg">
                    <label className="fl" htmlFor="ph">
                      {t('phone')}
                    </label>
                    <div className="iw">
                      <span className="ii">
                        <Smartphone size={16} />
                      </span>
                      <input
                        id="ph"
                        className={phoneErr ? 'fi err' : 'fi'}
                        type="tel"
                        placeholder={t('placeholders.phone')}
                        maxLength={11}
                        autoComplete="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </div>
                    <p className={phoneErr ? 'ferr on' : 'ferr'}>{phoneErr}</p>
                  </div>

                  <div className="fg">
                    <label className="fl" htmlFor="code">
                      {t('verificationCode')}
                    </label>
                    <div className="code-row">
                      <div className="iw" style={{ flex: 1 }}>
                        <input
                          id="code"
                          className={smsErr ? 'fi err' : 'fi'}
                          type="text"
                          inputMode="numeric"
                          placeholder={t('placeholders.code')}
                          maxLength={6}
                          autoComplete="one-time-code"
                          value={sms}
                          onChange={(e) => setSms(e.target.value.replace(/\D/g, ''))}
                        />
                      </div>
                      <button
                        type="button"
                        className="code-btn"
                        disabled={smsCount > 0}
                        onClick={sendSms}
                      >
                        {smsCount > 0 ? t('resendIn', { seconds: smsCount }) : t('sendCode')}
                      </button>
                    </div>
                    <p className={smsErr ? 'ferr on' : 'ferr'}>{smsErr}</p>
                  </div>

                  <button type="submit" className="btn" disabled={phoneLoading}>
                    {phoneLoading ? (
                      <>
                        <span className="spin" />
                        {t('loggingIn')}
                      </>
                    ) : (
                      t('login')
                    )}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleEmail} noValidate>
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

                  <button type="submit" className="btn" disabled={emailLoading}>
                    {emailLoading ? (
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
