'use client'

import { useState, useRef, useCallback, useEffect, type JSX } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Mail, Lock, Shield, Check } from 'lucide-react'
import AuthPanel from '@/components/auth/AuthPanel'
import StrengthBar from '@/components/auth/StrengthBar'

type Step = 1 | 2 | 'success'

export default function ForgotPasswordPage(): JSX.Element {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)
  const [email, setEmail] = useState('')
  const [emailErr, setEmailErr] = useState('')
  const [sendLoading, setSendLoading] = useState(false)

  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [otpErr, setOtpErr] = useState(false)
  const [otpShake, setOtpShake] = useState(false)
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])

  const [newPwd, setNewPwd] = useState('')
  const [newPwdErr, setNewPwdErr] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [confirmErr, setConfirmErr] = useState('')
  const [resetLoading, setResetLoading] = useState(false)

  const [resendCount, setResendCount] = useState(0)
  const resendRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [autoCount, setAutoCount] = useState(3)
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(
    () => () => {
      if (resendRef.current) clearInterval(resendRef.current)
      if (autoRef.current) clearInterval(autoRef.current)
    },
    []
  )

  const startResend = useCallback((s = 60): void => {
    if (resendRef.current) clearInterval(resendRef.current)
    setResendCount(s)
    resendRef.current = setInterval(() => {
      setResendCount((c) => {
        if (c <= 1) {
          if (resendRef.current) clearInterval(resendRef.current)
          return 0
        }
        return c - 1
      })
    }, 1000)
  }, [])

  const maskEmail = (e: string): string => {
    const parts = e.split('@')
    return `${(parts[0] ?? '').slice(0, 4)}**@${parts[1] ?? ''}`
  }

  const handleStep1 = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailErr('请输入正确的邮箱地址')
      return
    }
    setEmailErr('')
    setSendLoading(true)
    // TODO: 调用 API
    setTimeout(() => {
      setSendLoading(false)
      setStep(2)
      otpRefs.current[0]?.focus()
      startResend()
    }, 1200)
  }

  const handleOtpInput = (idx: number, val: string): void => {
    const digit = val.replace(/\D/g, '')
    const next = [...otp]
    next[idx] = digit.charAt(0)
    setOtp(next)
    if (digit && idx < 5) otpRefs.current[idx + 1]?.focus()
  }

  const handleOtpKey = (idx: number, e: React.KeyboardEvent): void => {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) otpRefs.current[idx - 1]?.focus()
  }

  const handleOtpPaste = (e: React.ClipboardEvent): void => {
    e.preventDefault()
    const data = e.clipboardData.getData('text').replace(/\D/g, '')
    const next = ['', '', '', '', '', '']
    for (let i = 0; i < 6; i++) next[i] = data[i] ?? ''
    setOtp(next)
    otpRefs.current[Math.min(data.length, 5)]?.focus()
  }

  const handleStep2 = (e: React.FormEvent): void => {
    e.preventDefault()
    let ok = true
    if (otp.join('').length < 6) {
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
      setConfirmErr('两次输入的密码不一致')
      ok = false
    } else setConfirmErr('')
    if (!ok) return
    setResetLoading(true)
    // TODO: 调用 API
    setTimeout(() => {
      setResetLoading(false)
      setStep('success')
      if (resendRef.current) clearInterval(resendRef.current)
      let s = 3
      setAutoCount(s)
      autoRef.current = setInterval(() => {
        s--
        setAutoCount(s)
        if (s <= 0) {
          if (autoRef.current) clearInterval(autoRef.current)
          router.replace('/login')
        }
      }, 1000)
    }, 1400)
  }

  return (
    <div className="auth-wrap">
      <AuthPanel
        bubbles={[
          '验证码已发送到你的邮箱',
          '请在 10 分钟内完成验证',
          '若未收到，请检查垃圾邮件',
          '重置后请妥善保管新密码',
          '遇到问题？联系在线客服',
        ]}
      />

      <main className="auth-right">
        <div className="form-card">
          {/* Step 1 */}
          {step === 1 && (
            <div>
              <Link href="/login" className="back-link" replace>
                <ChevronLeft size={14} />
                返回登录
              </Link>

              <div className="step-dots">
                <div className="dot on" />
                <div className="step-line" />
                <div className="dot" />
              </div>

              <h1 className="page-title">重置密码</h1>
              <p className="page-sub">输入注册邮箱，我们将发送验证码</p>

              <form onSubmit={handleStep1} noValidate>
                <div className="fg">
                  <label className="fl" htmlFor="femail">
                    注册邮箱
                  </label>
                  <div className="iw">
                    <span className="ii">
                      <Mail size={16} />
                    </span>
                    <input
                      id="femail"
                      className={emailErr ? 'fi err' : 'fi'}
                      type="email"
                      placeholder="your@email.com"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <p className={emailErr ? 'ferr on' : 'ferr'}>{emailErr}</p>
                </div>
                <button type="submit" className="btn" disabled={sendLoading}>
                  {sendLoading ? (
                    <>
                      <span className="spin" />
                      发送中...
                    </>
                  ) : (
                    '发送验证码'
                  )}
                </button>
              </form>
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <div>
              <div className="step-dots">
                <div className="dot" />
                <div className="step-line" />
                <div className="dot on" />
              </div>

              <h1 className="page-title">设置新密码</h1>
              <p className="page-sub">验证码已发送至 {maskEmail(email)}</p>

              <form onSubmit={handleStep2} noValidate>
                <div className="fg">
                  <label className="fl">验证码</label>
                  <div className={otpShake ? 'otp-row shake' : 'otp-row'}>
                    {otp.map((v, i) => (
                      <input
                        key={i}
                        ref={(el) => {
                          otpRefs.current[i] = el
                        }}
                        className={otpErr ? 'otp-cell err' : 'otp-cell'}
                        type="text"
                        maxLength={1}
                        inputMode="numeric"
                        value={v}
                        onChange={(e) => handleOtpInput(i, e.target.value)}
                        onKeyDown={(e) => handleOtpKey(i, e)}
                        onPaste={handleOtpPaste}
                      />
                    ))}
                  </div>
                  <p className={otpErr ? 'ferr on' : 'ferr'}>请输入 6 位验证码</p>
                  <div
                    style={{
                      marginTop: '10px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ fontSize: '13px', color: 'var(--fg3)' }}>
                      {resendCount > 0 ? `重新发送 (${resendCount}s)` : '未收到验证码？'}
                    </span>
                    <button
                      type="button"
                      style={{
                        fontSize: '13px',
                        color: resendCount > 0 ? 'var(--fg3)' : 'var(--brand)',
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: resendCount > 0 ? 'not-allowed' : 'pointer',
                        fontFamily: 'inherit',
                      }}
                      disabled={resendCount > 0}
                      onClick={() => startResend()}
                    >
                      重新发送
                    </button>
                  </div>
                </div>

                <div className="fg">
                  <label className="fl" htmlFor="npwd">
                    新密码
                  </label>
                  <div className="iw">
                    <span className="ii">
                      <Lock size={16} />
                    </span>
                    <input
                      id="npwd"
                      className={newPwdErr ? 'fi err' : 'fi'}
                      type="password"
                      placeholder="至少 8 位，含大写、数字和特殊字符"
                      autoComplete="new-password"
                      value={newPwd}
                      onChange={(e) => setNewPwd(e.target.value)}
                    />
                  </div>
                  <StrengthBar password={newPwd} />
                  <p className={newPwdErr ? 'ferr on' : 'ferr'}>{newPwdErr}</p>
                </div>

                <div className="fg">
                  <label className="fl" htmlFor="ncpwd">
                    确认新密码
                  </label>
                  <div className="iw">
                    <span className="ii">
                      <Shield size={16} />
                    </span>
                    <input
                      id="ncpwd"
                      className={confirmErr ? 'fi err' : 'fi'}
                      type="password"
                      placeholder="再次输入新密码"
                      autoComplete="new-password"
                      value={confirmPwd}
                      onChange={(e) => setConfirmPwd(e.target.value)}
                    />
                  </div>
                  <p className={confirmErr ? 'ferr on' : 'ferr'}>{confirmErr}</p>
                </div>

                <button type="submit" className="btn" disabled={resetLoading}>
                  {resetLoading ? (
                    <>
                      <span className="spin" />
                      重置中...
                    </>
                  ) : (
                    '重置密码'
                  )}
                </button>
              </form>
            </div>
          )}

          {/* Success */}
          {step === 'success' && (
            <div className="success-view">
              <div className="check-ring">
                <Check size={36} color="#10b981" strokeWidth={2.5} />
              </div>
              <p className="success-title">密码已重置</p>
              <p className="success-sub">你的密码已成功更新，请使用新密码登录</p>
              <p className="countdown-note">
                <span>{autoCount}</span> 秒后自动跳转登录页…
              </p>
              <Link href="/login" className="btn-outline" replace>
                立即登录
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
