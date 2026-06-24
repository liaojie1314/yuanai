'use client'

import { useState, useEffect, useRef, useCallback, type JSX } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import AuthPanel from '@/components/auth/AuthPanel'
import PasswordInput from '@/components/auth/PasswordInput'
import StrengthBar from '@/components/auth/StrengthBar'

type Step = 1 | 2 | 'success'

export default function ForgotPasswordPage(): JSX.Element {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)

  /* ─── Step 1 ─── */
  const [email, setEmail] = useState('')
  const [emailErr, setEmailErr] = useState('')
  const [sendLoading, setSendLoading] = useState(false)

  /* ─── Step 2 ─── */
  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', ''])
  const [otpErr, setOtpErr] = useState(false)
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [newPwdErr, setNewPwdErr] = useState('')
  const [confirmPwdErr, setConfirmPwdErr] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [otpShake, setOtpShake] = useState(false)

  /* ─── 重发倒计时 ─── */
  const [resendCount, setResendCount] = useState(0)
  const resendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /* ─── 成功后自动跳转 ─── */
  const [autoCount, setAutoCount] = useState(3)
  const autoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /* ─── OTP 单元格 refs ─── */
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])

  const isValidEmail = (v: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)

  const maskEmail = (e: string): string => {
    const parts = e.split('@')
    const local = parts[0] ?? ''
    const domain = parts[1] ?? ''
    return `${local.slice(0, 4)}**@${domain}`
  }

  const startResend = useCallback((seconds = 60): void => {
    if (resendTimerRef.current) clearInterval(resendTimerRef.current)
    setResendCount(seconds)
    resendTimerRef.current = setInterval(() => {
      setResendCount((c) => {
        if (c <= 1) {
          if (resendTimerRef.current) clearInterval(resendTimerRef.current)
          return 0
        }
        return c - 1
      })
    }, 1000)
  }, [])

  /* ─── Step 1 提交 ─── */
  const handleStep1 = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!isValidEmail(email)) {
      setEmailErr('请输入正确的邮箱地址')
      return
    }
    setEmailErr('')
    setSendLoading(true)
    // TODO: 调用发送验证码 API
    setTimeout(() => {
      setSendLoading(false)
      setStep(2)
      otpRefs.current[0]?.focus()
      startResend()
    }, 1200)
  }

  /* ─── OTP 输入自动跳转 ─── */
  const handleOtpInput = (idx: number, value: string): void => {
    const digit = value.replace(/\D/g, '')
    const next = [...otp]
    next[idx] = digit.charAt(0)
    setOtp(next)
    if (digit && idx < 5) otpRefs.current[idx + 1]?.focus()
  }

  const handleOtpKeyDown = (idx: number, e: React.KeyboardEvent): void => {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) {
      otpRefs.current[idx - 1]?.focus()
    }
  }

  const handleOtpPaste = (e: React.ClipboardEvent): void => {
    e.preventDefault()
    const data = e.clipboardData.getData('text').replace(/\D/g, '')
    const next = ['', '', '', '', '', '']
    for (let i = 0; i < 6; i++) next[i] = data[i] ?? ''
    setOtp(next)
    otpRefs.current[Math.min(data.length, 5)]?.focus()
  }

  /* ─── Step 2 提交 ─── */
  const handleStep2 = (e: React.FormEvent): void => {
    e.preventDefault()
    let ok = true
    const otpValue = otp.join('')

    if (otpValue.length < 6) {
      setOtpErr(true)
      setOtpShake(true)
      setTimeout(() => setOtpShake(false), 350)
      ok = false
    } else setOtpErr(false)

    if (newPwd.length < 8) {
      setNewPwdErr('密码至少 8 位')
      ok = false
    } else setNewPwdErr('')

    if (confirmPwd !== newPwd) {
      setConfirmPwdErr('两次输入的密码不一致')
      ok = false
    } else setConfirmPwdErr('')

    if (!ok) return
    setResetLoading(true)
    // TODO: 调用重置密码 API
    setTimeout(() => {
      setResetLoading(false)
      setStep('success')
      if (resendTimerRef.current) clearInterval(resendTimerRef.current)
      // 3s 后自动跳转
      let s = 3
      setAutoCount(s)
      autoTimerRef.current = setInterval(() => {
        s--
        setAutoCount(s)
        if (s <= 0) {
          if (autoTimerRef.current) clearInterval(autoTimerRef.current)
          router.push('/login')
        }
      }, 1000)
    }, 1400)
  }

  useEffect(() => {
    return () => {
      if (resendTimerRef.current) clearInterval(resendTimerRef.current)
      if (autoTimerRef.current) clearInterval(autoTimerRef.current)
    }
  }, [])

  /* ─── 步骤指示器 ─── */
  function StepDots({ current }: { current: 1 | 2 }): JSX.Element {
    return (
      <div className="mb-7 flex items-center gap-2">
        <div
          className="h-2 w-2 rounded-full transition-all duration-300"
          style={{
            background: current === 1 ? 'var(--brand)' : 'var(--brand-b)',
            transform: current === 1 ? 'scale(1.25)' : 'none',
          }}
        />
        <div className="h-px w-8" style={{ background: 'var(--brand-b)' }} />
        <div
          className="h-2 w-2 rounded-full transition-all duration-300"
          style={{
            background: current === 2 ? 'var(--brand)' : 'var(--brand-b)',
            transform: current === 2 ? 'scale(1.25)' : 'none',
          }}
        />
      </div>
    )
  }

  return (
    <div className="auth-layout">
      <AuthPanel
        bubbles={['验证码已发送到你的邮箱', '请在 10 分钟内完成验证', '若未收到，请检查垃圾邮件']}
      />

      <main className="auth-right">
        <div className="form-card">
          {/* ── Step 1: 发送验证码 ── */}
          {step === 1 && (
            <>
              <Link
                href="/login"
                className="mb-5 inline-flex items-center gap-1 text-[13px] transition-colors"
                style={{ color: 'var(--fg2)' }}
              >
                <ChevronLeft size={14} />
                返回登录
              </Link>

              <StepDots current={1} />

              <h1 className="auth-title">重置密码</h1>
              <p className="auth-sub">输入注册邮箱，我们将发送验证码</p>

              <form onSubmit={handleStep1} noValidate>
                <div className="form-group">
                  <label className="form-label" htmlFor="femail">
                    注册邮箱
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
                      id="femail"
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

                <button type="submit" disabled={sendLoading} className="auth-btn">
                  {sendLoading ? (
                    <>
                      <span className="btn-spinner" />
                      <span>发送中...</span>
                    </>
                  ) : (
                    '发送验证码'
                  )}
                </button>
              </form>
            </>
          )}

          {/* ── Step 2: OTP + 新密码 ── */}
          {step === 2 && (
            <>
              <StepDots current={2} />

              <h1 className="auth-title">设置新密码</h1>
              <p className="auth-sub" style={{ color: 'var(--fg2)' }}>
                验证码已发送至 {maskEmail(email)}
              </p>

              <form onSubmit={handleStep2} noValidate>
                {/* OTP */}
                <div className="form-group">
                  <label className="form-label">验证码</label>
                  <div
                    className="flex gap-2"
                    style={otpShake ? { animation: 'otpShake 300ms ease' } : undefined}
                  >
                    {otp.map((digit, idx) => (
                      <input
                        key={idx}
                        ref={(el) => {
                          otpRefs.current[idx] = el
                        }}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleOtpInput(idx, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                        onPaste={idx === 0 ? handleOtpPaste : undefined}
                        className={`otp-cell ${otpErr ? 'otp-cell-error' : ''}`}
                        aria-label={`验证码第 ${idx + 1} 位`}
                      />
                    ))}
                  </div>
                  {otpErr && <p className="form-error">请输入 6 位验证码</p>}

                  <div className="mt-2.5 flex items-center justify-between">
                    <span className="text-[13px]" style={{ color: 'var(--fg3)' }}>
                      {resendCount > 0 ? `重新发送 (${resendCount}s)` : '未收到验证码？'}
                    </span>
                    <button
                      type="button"
                      disabled={resendCount > 0}
                      onClick={() => startResend()}
                      className="text-[13px] transition-colors"
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: resendCount > 0 ? 'not-allowed' : 'pointer',
                        color: resendCount > 0 ? 'var(--fg3)' : 'var(--brand)',
                      }}
                    >
                      重新发送
                    </button>
                  </div>
                </div>

                {/* 新密码 */}
                <div className="form-group">
                  <label className="form-label" htmlFor="newPwd">
                    新密码
                  </label>
                  <PasswordInput
                    id="newPwd"
                    placeholder="至少 8 位，含大写、数字和特殊字符"
                    autoComplete="new-password"
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                    onBlur={() => {
                      if (newPwd && newPwd.length < 8) setNewPwdErr('密码至少 8 位')
                      else setNewPwdErr('')
                    }}
                    hasError={!!newPwdErr}
                  />
                  <StrengthBar password={newPwd} />
                  {newPwdErr && <p className="form-error">{newPwdErr}</p>}
                </div>

                {/* 确认新密码 */}
                <div className="form-group">
                  <label className="form-label" htmlFor="confirmNewPwd">
                    确认新密码
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
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                    </span>
                    <input
                      id="confirmNewPwd"
                      type="password"
                      placeholder="再次输入新密码"
                      autoComplete="new-password"
                      value={confirmPwd}
                      onChange={(e) => setConfirmPwd(e.target.value)}
                      onBlur={() => {
                        if (confirmPwd && confirmPwd !== newPwd)
                          setConfirmPwdErr('两次输入的密码不一致')
                        else setConfirmPwdErr('')
                      }}
                      className={`auth-input w-full ${confirmPwdErr ? 'auth-input-error' : ''}`}
                      style={{ paddingLeft: 42 }}
                    />
                  </div>
                  {confirmPwdErr && <p className="form-error">{confirmPwdErr}</p>}
                </div>

                <button type="submit" disabled={resetLoading} className="auth-btn">
                  {resetLoading ? (
                    <>
                      <span className="btn-spinner" />
                      <span>重置中...</span>
                    </>
                  ) : (
                    '重置密码'
                  )}
                </button>
              </form>

              <Link
                href="/login"
                className="mt-4 block text-center text-[13px] transition-colors hover:underline"
                style={{ color: 'var(--brand)' }}
              >
                返回登录
              </Link>
            </>
          )}

          {/* ── 成功状态 ── */}
          {step === 'success' && (
            <div className="py-6 text-center">
              <div
                className="mx-auto mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-full"
                style={{
                  background: 'linear-gradient(135deg,rgba(16,185,129,.12),rgba(16,185,129,.08))',
                  border: '2px solid rgba(16,185,129,.25)',
                  animation: 'pop .5s cubic-bezier(0.34,1.56,0.64,1) both',
                }}
              >
                <svg
                  width="36"
                  height="36"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>

              <p className="mb-2 text-2xl font-bold" style={{ color: 'var(--fg)' }}>
                密码已重置
              </p>
              <p className="mb-7 text-sm" style={{ color: 'var(--fg2)' }}>
                你的密码已成功更新，请使用新密码登录
              </p>
              <p className="mb-5 text-[13px]" style={{ color: 'var(--fg3)' }}>
                <span
                  style={{
                    color: autoCount <= 1 ? 'var(--brand)' : 'inherit',
                    fontWeight: autoCount <= 1 ? 600 : 'normal',
                  }}
                >
                  {autoCount}
                </span>{' '}
                秒后自动跳转登录页…
              </p>

              <Link
                href="/login"
                className="flex h-12 w-full items-center justify-center rounded-[var(--r)] text-[15px] font-semibold transition-colors hover:bg-[var(--brand-light)]"
                style={{
                  border: '1px solid var(--brand)',
                  color: 'var(--brand)',
                }}
              >
                立即登录
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
