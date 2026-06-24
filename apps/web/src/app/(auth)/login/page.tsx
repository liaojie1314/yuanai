'use client'

import { useState, useRef, useCallback, type JSX } from 'react'
import Link from 'next/link'
import AuthPanel from '@/components/auth/AuthPanel'
import PasswordInput from '@/components/auth/PasswordInput'

/* ─── 社交登录图标 ─── */
function WeChatIcon(): JSX.Element {
  return (
    <svg className="h-5 w-5 flex-shrink-0" viewBox="0 0 24 24">
      <path
        d="M9.5 3C5.36 3 2 5.91 2 9.5c0 2.04.98 3.84 2.5 5.02l-.95 2.78 2.71-1.35c.85.23 1.73.35 2.74.35.27 0 .53-.01.79-.03C9.6 15.84 9.5 15.44 9.5 15c0-3.31 3.13-6 7-6 .27 0 .53.01.79.03C16.75 6.13 13.36 3 9.5 3z"
        fill="#07C160"
      />
      <path
        d="M16.5 10c-2.76 0-5 1.79-5 4s2.24 4 5 4c.68 0 1.33-.1 1.93-.28l2.07 1.03-.8-2c1.09-.83 1.8-2.05 1.8-3.75 0-2.21-2.24-4-5-4z"
        fill="#07C160"
      />
    </svg>
  )
}

function GoogleIcon(): JSX.Element {
  return (
    <svg className="h-5 w-5 flex-shrink-0" viewBox="0 0 24 24">
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
  )
}

function AppleIcon(): JSX.Element {
  return (
    <svg className="h-5 w-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.4c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.56-1.32 3.1-2.53 3.99zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  )
}

/* ─── QR 码占位 SVG ─── */
function QrPlaceholder(): JSX.Element {
  return (
    <svg
      viewBox="0 0 21 21"
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: '100%', height: '100%' }}
    >
      <rect width="21" height="21" fill="white" />
      <rect x="1" y="1" width="7" height="7" fill="none" stroke="#1A2540" strokeWidth=".8" />
      <rect x="2.5" y="2.5" width="4" height="4" fill="#1A2540" rx=".3" />
      <rect x="13" y="1" width="7" height="7" fill="none" stroke="#1A2540" strokeWidth=".8" />
      <rect x="14.5" y="2.5" width="4" height="4" fill="#1A2540" rx=".3" />
      <rect x="1" y="13" width="7" height="7" fill="none" stroke="#1A2540" strokeWidth=".8" />
      <rect x="2.5" y="14.5" width="4" height="4" fill="#1A2540" rx=".3" />
      <rect x="9" y="1" width="1" height="1" fill="#1A2540" />
      <rect x="11" y="1" width="1" height="1" fill="#1A2540" />
      <rect x="10" y="2" width="1" height="1" fill="#1A2540" />
      <rect x="9" y="3" width="2" height="1" fill="#1A2540" />
      <rect x="11" y="3" width="1" height="1" fill="#1A2540" />
      <rect x="9" y="5" width="1" height="1" fill="#1A2540" />
      <rect x="11" y="5" width="1" height="1" fill="#1A2540" />
      <rect x="10" y="6" width="2" height="1" fill="#1A2540" />
      <rect x="8.5" y="8.5" width="4" height="4" fill="#EFF6FF" rx=".6" />
      <text x="10.5" y="11.4" textAnchor="middle" fontSize="2.6" fontWeight="700" fill="#3B82F6">
        元
      </text>
      <rect x="9" y="13" width="1" height="1" fill="#1A2540" />
      <rect x="11" y="13" width="1" height="1" fill="#1A2540" />
      <rect x="9" y="14" width="2" height="1" fill="#1A2540" />
      <rect x="12" y="14" width="1" height="1" fill="#1A2540" />
      <rect x="10" y="15" width="1" height="1" fill="#1A2540" />
      <rect x="9" y="16" width="1" height="1" fill="#1A2540" />
      <rect x="11" y="16" width="2" height="1" fill="#1A2540" />
      <rect x="9" y="17" width="2" height="1" fill="#1A2540" />
      <rect x="12" y="17" width="1" height="1" fill="#1A2540" />
      <rect x="10" y="18" width="1" height="1" fill="#1A2540" />
      <rect x="12" y="18" width="1" height="1" fill="#1A2540" />
    </svg>
  )
}

type ActiveTab = 'phone' | 'email'

export default function LoginPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<ActiveTab>('phone')
  const [showQr, setShowQr] = useState(false)

  /* ── 手机号 Tab 状态 ── */
  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [phoneErr, setPhoneErr] = useState('')
  const [smsErr, setSmsErr] = useState('')
  const [smsCountdown, setSmsCountdown] = useState(0)
  const [phoneLoading, setPhoneLoading] = useState(false)
  const smsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /* ── 邮箱密码 Tab 状态 ── */
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailErr, setEmailErr] = useState('')
  const [pwdErr, setPwdErr] = useState('')
  const [remember, setRemember] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)

  /* ── QR 码倒计时 ── */
  const [qrTimer, setQrTimer] = useState(60)
  const qrTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /* ─── 工具 ─── */
  const isValidPhone = (v: string): boolean => /^1[3-9]\d{9}$/.test(v)
  const isValidEmail = (v: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)

  const startSmsCountdown = useCallback((): void => {
    setSmsCountdown(60)
    smsTimerRef.current = setInterval(() => {
      setSmsCountdown((c) => {
        if (c <= 1) {
          if (smsTimerRef.current) clearInterval(smsTimerRef.current)
          return 0
        }
        return c - 1
      })
    }, 1000)
  }, [])

  const handleSendSms = (): void => {
    if (!isValidPhone(phone)) {
      setPhoneErr('请输入有效的手机号码')
      return
    }
    setPhoneErr('')
    startSmsCountdown()
    // TODO: 调用发送验证码 API
  }

  const handleQrOpen = (): void => {
    setShowQr(true)
    setQrTimer(60)
    qrTimerRef.current = setInterval(() => {
      setQrTimer((t) => {
        if (t <= 1) {
          if (qrTimerRef.current) clearInterval(qrTimerRef.current)
          return 0
        }
        return t - 1
      })
    }, 1000)
  }

  const handleQrClose = (): void => {
    setShowQr(false)
    if (qrTimerRef.current) clearInterval(qrTimerRef.current)
    setQrTimer(60)
  }

  const handlePhoneSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    let ok = true
    if (!isValidPhone(phone)) {
      setPhoneErr('请输入有效的手机号码')
      ok = false
    } else setPhoneErr('')
    if (!smsCode || smsCode.length < 6) {
      setSmsErr('请输入 6 位验证码')
      ok = false
    } else setSmsErr('')
    if (!ok) return
    setPhoneLoading(true)
    // TODO: 调用登录 API
    setTimeout(() => setPhoneLoading(false), 1600)
  }

  const handleEmailSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    let ok = true
    if (!isValidEmail(email)) {
      setEmailErr('请输入正确的邮箱地址')
      ok = false
    } else setEmailErr('')
    if (!password) {
      setPwdErr('密码不能为空')
      ok = false
    } else setPwdErr('')
    if (!ok) return
    setEmailLoading(true)
    // TODO: 调用登录 API
    setTimeout(() => setEmailLoading(false), 1600)
  }

  return (
    <div className="auth-layout">
      <AuthPanel
        bubbles={['你好，今天想聊什么？', '帮我写一段 Python 排序算法', '解释一下量子纠缠']}
      />

      <main className="auth-right">
        <div className="form-card" style={{ position: 'relative' }}>
          {/* QR 切换按钮（仅桌面） */}
          {!showQr && (
            <button
              onClick={handleQrOpen}
              title="扫码登录"
              aria-label="切换扫码登录"
              className="absolute right-0 top-0 hidden lg:flex"
              style={{
                width: 44,
                height: 44,
                border: '1px solid var(--brand-b)',
                borderRadius: 'var(--r)',
                background: 'var(--surface)',
                color: 'var(--fg2)',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 150ms,border-color 150ms,color 150ms',
                cursor: 'pointer',
              }}
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
          )}

          {!showQr ? (
            <>
              <h1 className="auth-title">欢迎回来</h1>
              <p className="auth-sub">登录你的元AI账号继续对话</p>

              {/* Tabs */}
              <div className="auth-tabs" role="tablist">
                {(['phone', 'email'] as const).map((tab) => (
                  <button
                    key={tab}
                    role="tab"
                    aria-selected={activeTab === tab}
                    onClick={() => setActiveTab(tab)}
                    className={`auth-tab ${activeTab === tab ? 'auth-tab-active' : ''}`}
                  >
                    {tab === 'phone' ? '手机号' : '邮箱密码'}
                  </button>
                ))}
              </div>

              {/* 手机号 + 验证码 */}
              {activeTab === 'phone' && (
                <form onSubmit={handlePhoneSubmit} noValidate>
                  <div className="form-group">
                    <label className="form-label" htmlFor="phone">
                      手机号
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="flex h-12 flex-shrink-0 items-center gap-1 rounded-lg px-3 text-sm transition-colors"
                        style={{
                          border: '1px solid var(--brand-b)',
                          background: 'var(--surface)',
                          color: 'var(--fg)',
                        }}
                        aria-label="选择国家/地区代码"
                      >
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
                        type="tel"
                        inputMode="numeric"
                        placeholder="请输入手机号"
                        maxLength={11}
                        autoComplete="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        onBlur={() => {
                          if (phone && !isValidPhone(phone)) setPhoneErr('请输入有效的手机号码')
                          else setPhoneErr('')
                        }}
                        className={`auth-input flex-1 ${phoneErr ? 'auth-input-error' : ''}`}
                        style={{ paddingLeft: 14 }}
                      />
                    </div>
                    {phoneErr && <p className="form-error">{phoneErr}</p>}
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="smsCode">
                      验证码
                    </label>
                    <div className="flex gap-2.5">
                      <div className="relative flex flex-1 items-center">
                        <span
                          className="pointer-events-none absolute left-[14px] flex"
                          style={{ color: 'var(--fg3)' }}
                        >
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
                          id="smsCode"
                          type="text"
                          inputMode="numeric"
                          placeholder="输入 6 位验证码"
                          maxLength={6}
                          autoComplete="one-time-code"
                          value={smsCode}
                          onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, ''))}
                          className={`auth-input w-full ${smsErr ? 'auth-input-error' : ''}`}
                          style={{ paddingLeft: 42 }}
                        />
                      </div>
                      <button
                        type="button"
                        disabled={smsCountdown > 0}
                        onClick={handleSendSms}
                        className="sms-btn flex-shrink-0"
                      >
                        {smsCountdown > 0 ? `重新发送 (${smsCountdown}s)` : '发送验证码'}
                      </button>
                    </div>
                    {smsErr && <p className="form-error">{smsErr}</p>}
                  </div>

                  <button type="submit" disabled={phoneLoading} className="auth-btn">
                    {phoneLoading ? (
                      <>
                        <span className="btn-spinner" />
                        <span>登录中...</span>
                      </>
                    ) : (
                      '登录'
                    )}
                  </button>
                </form>
              )}

              {/* 邮箱密码 */}
              {activeTab === 'email' && (
                <form onSubmit={handleEmailSubmit} noValidate>
                  <div className="form-group">
                    <label className="form-label" htmlFor="email">
                      邮箱
                    </label>
                    <div className="relative flex items-center">
                      <span
                        className="pointer-events-none absolute left-[14px] flex transition-colors"
                        style={{ color: 'var(--fg3)' }}
                      >
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
                        type="email"
                        placeholder="your@email.com"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onBlur={() => {
                          if (email && !isValidEmail(email)) setEmailErr('请输入正确的邮箱地址')
                          else setEmailErr('')
                        }}
                        className={`auth-input w-full ${emailErr ? 'auth-input-error' : ''}`}
                        style={{ paddingLeft: 42 }}
                      />
                    </div>
                    {emailErr && <p className="form-error">{emailErr}</p>}
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="password">
                      密码
                    </label>
                    <PasswordInput
                      id="password"
                      placeholder="请输入密码"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onBlur={() => {
                        if (password && password.length < 8) setPwdErr('密码至少 8 位')
                        else setPwdErr('')
                      }}
                      hasError={!!pwdErr}
                    />
                    {pwdErr && <p className="form-error">{pwdErr}</p>}
                  </div>

                  <div className="mb-5 flex items-center justify-between">
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={remember}
                        onChange={(e) => setRemember(e.target.checked)}
                        className="h-[15px] w-[15px] cursor-pointer"
                        style={{ accentColor: 'var(--brand)' }}
                      />
                      <span className="text-[13px]" style={{ color: 'var(--fg2)' }}>
                        记住我 7 天
                      </span>
                    </label>
                    <Link
                      href="/forgot-password"
                      className="text-[13px] transition-colors hover:underline"
                      style={{ color: 'var(--brand)' }}
                    >
                      忘记密码？
                    </Link>
                  </div>

                  <button type="submit" disabled={emailLoading} className="auth-btn">
                    {emailLoading ? (
                      <>
                        <span className="btn-spinner" />
                        <span>登录中...</span>
                      </>
                    ) : (
                      '登录'
                    )}
                  </button>
                </form>
              )}
            </>
          ) : (
            /* QR 码视图 */
            <div className="py-2 text-center">
              <div
                className="mx-auto mb-4 rounded-xl p-3.5"
                style={{
                  width: 190,
                  height: 190,
                  border: '1px solid var(--brand-b)',
                  background: 'var(--surface)',
                }}
              >
                <QrPlaceholder />
              </div>
              <h3 className="mb-1.5 text-base font-semibold" style={{ color: 'var(--fg)' }}>
                扫码登录
              </h3>
              <p className="mb-1.5 text-[13px]" style={{ color: 'var(--fg2)' }}>
                打开元AI App，扫描二维码登录
              </p>
              <p className="mb-4 text-xs" style={{ color: 'var(--fg3)' }}>
                二维码将在{' '}
                <span style={{ color: qrTimer <= 10 ? 'var(--error)' : 'inherit' }}>
                  {qrTimer <= 0 ? '已失效' : qrTimer}
                </span>
                {qrTimer > 0 ? ' 秒后失效' : ''}
              </p>
              <button
                onClick={handleQrClose}
                className="text-[13px] transition-colors hover:underline"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--brand)',
                }}
              >
                ← 使用账号密码登录
              </button>
            </div>
          )}

          {/* 分隔线 + 社交登录（始终显示） */}
          <div className="auth-divider">
            <span>或使用以下方式登录</span>
          </div>

          <div className="mb-6 flex gap-2.5">
            {[
              { label: '微信登录', icon: <WeChatIcon />, name: '微信' },
              { label: 'Google 登录', icon: <GoogleIcon />, name: 'Google' },
              { label: 'Apple 登录', icon: <AppleIcon />, name: 'Apple' },
            ].map(({ label, icon, name }) => (
              <button key={name} aria-label={label} className="social-btn flex-1">
                {icon}
                <span className="hidden text-[13px] font-medium sm:inline">{name}</span>
              </button>
            ))}
          </div>

          <p className="text-center text-[13px]" style={{ color: 'var(--fg2)' }}>
            还没有账号？{' '}
            <Link
              href="/register"
              className="font-semibold hover:underline"
              style={{ color: 'var(--brand)' }}
            >
              立即注册
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
