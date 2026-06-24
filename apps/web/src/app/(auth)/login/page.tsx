'use client'

import { useState, useRef, useEffect, type JSX } from 'react'
import Link from 'next/link'
import AuthPanel from '@/components/auth/AuthPanel'

export default function LoginPage(): JSX.Element {
  const [tab, setTab] = useState<'phone' | 'email'>('phone')
  const [showQr, setShowQr] = useState(false)

  // Phone form
  const [phone, setPhone] = useState('')
  const [sms, setSms] = useState('')
  const [phoneErr, setPhoneErr] = useState('')
  const [smsErr, setSmsErr] = useState('')
  const [smsCount, setSmsCount] = useState(0)
  const smsTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const [phoneLoading, setPhoneLoading] = useState(false)

  // Email form
  const [email, setEmail] = useState('')
  const [pwd, setPwd] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [remember, setRemember] = useState(false)
  const [emailErr, setEmailErr] = useState('')
  const [pwdErr, setPwdErr] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)

  // QR countdown
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
      setPhoneErr('请输入有效的手机号码')
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
      setPhoneErr('请输入有效的手机号码')
      ok = false
    } else setPhoneErr('')
    if (sms.trim().length < 6) {
      setSmsErr('请输入 6 位验证码')
      ok = false
    } else setSmsErr('')
    if (!ok) return
    setPhoneLoading(true)
    // TODO: 调用 API
    setTimeout(() => setPhoneLoading(false), 1600)
  }

  const handleEmail = (e: React.FormEvent): void => {
    e.preventDefault()
    let ok = true
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailErr('请输入正确的邮箱地址')
      ok = false
    } else setEmailErr('')
    if (!pwd) {
      setPwdErr('密码不能为空')
      ok = false
    } else setPwdErr('')
    if (!ok) return
    setEmailLoading(true)
    // TODO: 调用 API
    setTimeout(() => setEmailLoading(false), 1600)
  }

  return (
    <div className="auth-wrap">
      <AuthPanel
        bubbles={['你好，今天想聊什么？', '帮我写一段 Python 排序算法', '解释一下量子纠缠']}
      />

      <main className="auth-right">
        <div className="form-card">
          {/* QR toggle (desktop only via CSS) */}
          <button
            className="qr-toggle"
            title="扫码登录"
            aria-label="切换扫码登录"
            onClick={startQr}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="3" height="3" />
              <rect x="7" y="14" width="3" height="3" />
              <rect x="3" y="19" width="3" height="3" />
            </svg>
          </button>

          {showQr ? (
            /* QR view */
            <div className="qr-view">
              <div className="qr-box">
                <svg
                  viewBox="0 0 21 21"
                  xmlns="http://www.w3.org/2000/svg"
                  style={{ width: '100%', height: '100%' }}
                >
                  <rect width="21" height="21" fill="white" />
                  <rect
                    x="1"
                    y="1"
                    width="7"
                    height="7"
                    fill="none"
                    stroke="#1A2540"
                    strokeWidth=".8"
                  />
                  <rect x="2.5" y="2.5" width="4" height="4" fill="#1A2540" rx=".3" />
                  <rect
                    x="13"
                    y="1"
                    width="7"
                    height="7"
                    fill="none"
                    stroke="#1A2540"
                    strokeWidth=".8"
                  />
                  <rect x="14.5" y="2.5" width="4" height="4" fill="#1A2540" rx=".3" />
                  <rect
                    x="1"
                    y="13"
                    width="7"
                    height="7"
                    fill="none"
                    stroke="#1A2540"
                    strokeWidth=".8"
                  />
                  <rect x="2.5" y="14.5" width="4" height="4" fill="#1A2540" rx=".3" />
                  <rect x="8.5" y="8.5" width="4" height="4" fill="#EFF6FF" rx=".6" />
                  <text
                    x="10.5"
                    y="11.4"
                    textAnchor="middle"
                    fontSize="2.6"
                    fontWeight="700"
                    fill="#3B82F6"
                  >
                    元
                  </text>
                </svg>
              </div>
              <h3>扫码登录</h3>
              <p>打开元AI App，扫描二维码登录</p>
              <p className="qr-exp">
                二维码将在{' '}
                <span style={{ color: qrCount <= 10 ? 'var(--error)' : undefined }}>{qrCount}</span>{' '}
                秒后失效
              </p>
              <button className="qr-back" onClick={closeQr}>
                ← 使用账号密码登录
              </button>
            </div>
          ) : (
            /* Main content */
            <div>
              <h1 className="page-title">欢迎回来</h1>
              <p className="page-sub">登录你的元AI账号继续对话</p>

              <div className="auth-tabs" role="tablist">
                <button
                  className={tab === 'phone' ? 'a-tab on' : 'a-tab'}
                  role="tab"
                  onClick={() => setTab('phone')}
                >
                  手机号
                </button>
                <button
                  className={tab === 'email' ? 'a-tab on' : 'a-tab'}
                  role="tab"
                  onClick={() => setTab('email')}
                >
                  邮箱密码
                </button>
              </div>

              {/* Phone form */}
              {tab === 'phone' && (
                <form onSubmit={handlePhone} noValidate>
                  <div className="fg">
                    <label className="fl" htmlFor="phone">
                      手机号
                    </label>
                    <div className="phone-row">
                      <button type="button" className="cc-btn">
                        +86
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                      <input
                        id="phone"
                        className={`fi phone-fi${phoneErr ? 'err' : ''}`}
                        type="tel"
                        placeholder="请输入手机号"
                        maxLength={11}
                        inputMode="numeric"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        onBlur={() => {
                          if (phone && !/^1[3-9]\d{9}$/.test(phone))
                            setPhoneErr('请输入有效的手机号码')
                          else setPhoneErr('')
                        }}
                      />
                    </div>
                    {phoneErr && <p className="ferr on">{phoneErr}</p>}
                  </div>

                  <div className="fg">
                    <label className="fl" htmlFor="sms">
                      验证码
                    </label>
                    <div className="sms-row">
                      <div className="iw sms-fi">
                        <span className="ii">
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect x="5" y="2" width="14" height="20" rx="2" />
                            <line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="3" />
                          </svg>
                        </span>
                        <input
                          id="sms"
                          className={`fi${smsErr ? 'err' : ''}`}
                          type="text"
                          placeholder="输入 6 位验证码"
                          maxLength={6}
                          inputMode="numeric"
                          value={sms}
                          onChange={(e) => setSms(e.target.value)}
                        />
                      </div>
                      <button
                        type="button"
                        className="sms-btn"
                        disabled={smsCount > 0}
                        onClick={sendSms}
                      >
                        {smsCount > 0 ? `重新发送 (${smsCount}s)` : '发送验证码'}
                      </button>
                    </div>
                    {smsErr && <p className="ferr on">{smsErr}</p>}
                  </div>

                  <button type="submit" className="btn" disabled={phoneLoading}>
                    {phoneLoading ? (
                      <>
                        <span className="spin" />
                        登录中...
                      </>
                    ) : (
                      '登录'
                    )}
                  </button>
                </form>
              )}

              {/* Email form */}
              {tab === 'email' && (
                <form onSubmit={handleEmail} noValidate>
                  <div className="fg">
                    <label className="fl" htmlFor="email">
                      邮箱
                    </label>
                    <div className="iw">
                      <span className="ii">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect width="20" height="16" x="2" y="4" rx="2" />
                          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                        </svg>
                      </span>
                      <input
                        id="email"
                        className={`fi${emailErr ? 'err' : ''}`}
                        type="email"
                        placeholder="your@email.com"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onBlur={() => {
                          if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
                            setEmailErr('请输入正确的邮箱地址')
                          else setEmailErr('')
                        }}
                      />
                    </div>
                    {emailErr && <p className="ferr on">{emailErr}</p>}
                  </div>

                  <div className="fg">
                    <label className="fl" htmlFor="pwd">
                      密码
                    </label>
                    <div className="iw">
                      <span className="ii">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect width="18" height="11" x="3" y="11" rx="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      </span>
                      <input
                        id="pwd"
                        className={`fi${pwdErr ? 'err' : ''}`}
                        type={showPwd ? 'text' : 'password'}
                        placeholder="请输入密码"
                        autoComplete="current-password"
                        value={pwd}
                        onChange={(e) => setPwd(e.target.value)}
                        onBlur={() => {
                          if (pwd && pwd.length < 8) setPwdErr('密码至少 8 位')
                          else setPwdErr('')
                        }}
                      />
                      <button
                        type="button"
                        className="eye"
                        aria-label="显示/隐藏密码"
                        onClick={() => setShowPwd((s) => !s)}
                      >
                        {showPwd ? (
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        ) : (
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                            <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                            <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                            <line x1="2" x2="22" y1="2" y2="22" />
                          </svg>
                        )}
                      </button>
                    </div>
                    {pwdErr && <p className="ferr on">{pwdErr}</p>}
                  </div>

                  <div className="helper">
                    <label className="rm-wrap">
                      <input
                        type="checkbox"
                        checked={remember}
                        onChange={(e) => setRemember(e.target.checked)}
                      />
                      <span className="rm-lbl">记住我 7 天</span>
                    </label>
                    <Link href="/forgot-password" className="fl-link">
                      忘记密码？
                    </Link>
                  </div>

                  <button type="submit" className="btn" disabled={emailLoading}>
                    {emailLoading ? (
                      <>
                        <span className="spin" />
                        登录中...
                      </>
                    ) : (
                      '登录'
                    )}
                  </button>
                </form>
              )}
            </div>
          )}

          <div className="divider">
            <span>或使用以下方式登录</span>
          </div>

          <div className="social-row">
            <button className="soc-btn" aria-label="微信登录">
              <svg className="soc-icon" viewBox="0 0 24 24">
                <path
                  d="M9.5 3C5.36 3 2 5.91 2 9.5c0 2.04.98 3.84 2.5 5.02l-.95 2.78 2.71-1.35c.85.23 1.73.35 2.74.35.27 0 .53-.01.79-.03C9.6 15.84 9.5 15.44 9.5 15c0-3.31 3.13-6 7-6 .27 0 .53.01.79.03C16.75 6.13 13.36 3 9.5 3z"
                  fill="#07C160"
                />
                <path
                  d="M16.5 10c-2.76 0-5 1.79-5 4s2.24 4 5 4c.68 0 1.33-.1 1.93-.28l2.07 1.03-.8-2c1.09-.83 1.8-2.05 1.8-3.75 0-2.21-2.24-4-5-4z"
                  fill="#07C160"
                />
              </svg>
              <span>微信</span>
            </button>
            <button className="soc-btn" aria-label="Google 登录">
              <svg className="soc-icon" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              <span>Google</span>
            </button>
            <button className="soc-btn" aria-label="Apple 登录">
              <svg className="soc-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.4c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.56-1.32 3.1-2.53 3.99zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
              </svg>
              <span>Apple</span>
            </button>
          </div>

          <p className="signup-cta">
            还没有账号？<Link href="/register">立即注册</Link>
          </p>
        </div>
      </main>
    </div>
  )
}
