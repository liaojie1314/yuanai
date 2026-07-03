'use client'

import { useState, useRef, useCallback, useEffect, type JSX } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Mail, Lock, Shield, Check } from 'lucide-react'
import AuthPanel from '@/components/auth/AuthPanel'
import StrengthBar from '@/components/auth/StrengthBar'
import { useResetPassword, useSendVerifyCode } from '@yuanai/core/hooks'

/** 从后端错误中解析 detail.code 和 detail.message */
function parseApiError(err: unknown): { code?: string; message?: string } {
  return (
    (err as { response?: { data?: { detail?: { code?: string; message?: string } } } })?.response
      ?.data?.detail ?? {}
  )
}

type Step = 1 | 2 | 'success'

export default function ForgotPasswordPage(): JSX.Element {
  const router = useRouter()
  const sendCodeMutation = useSendVerifyCode()
  const resetPasswordMutation = useResetPassword()

  const [step, setStep] = useState<Step>(1)
  const [email, setEmail] = useState('')
  const [emailErr, setEmailErr] = useState('')

  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [otpErr, setOtpErr] = useState('')
  const [otpShake, setOtpShake] = useState(false)
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])

  const [newPwd, setNewPwd] = useState('')
  const [newPwdErr, setNewPwdErr] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [confirmErr, setConfirmErr] = useState('')

  const [resendCount, setResendCount] = useState(0)
  const resendRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [autoCount, setAutoCount] = useState(3)
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const sendLoading = sendCodeMutation.isPending
  const resetLoading = resetPasswordMutation.isPending

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

  const handleStep1 = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailErr('请输入正确的邮箱地址')
      return
    }
    setEmailErr('')
    try {
      await sendCodeMutation.mutateAsync({ email: email.trim(), scene: 'reset_password' })
      setStep(2)
      requestAnimationFrame(() => otpRefs.current[0]?.focus())
      startResend()
    } catch (err) {
      const detail = parseApiError(err)
      if (detail.code === 'EMAIL_NOT_FOUND') {
        setEmailErr('该邮箱尚未注册，请核对后重试')
      } else if (detail.code === 'VERIFY_CODE_THROTTLED') {
        // 已在冷却期，直接进入 Step 2 让用户输入之前收到的验证码
        setStep(2)
        requestAnimationFrame(() => otpRefs.current[0]?.focus())
        startResend()
      } else {
        setEmailErr(detail.message ?? '发送失败，请稍后再试')
      }
    }
  }

  const handleResend = async (): Promise<void> => {
    if (resendCount > 0) return
    setOtpErr('')
    try {
      await sendCodeMutation.mutateAsync({ email: email.trim(), scene: 'reset_password' })
      startResend()
    } catch (err) {
      const detail = parseApiError(err)
      if (detail.code === 'VERIFY_CODE_THROTTLED') {
        // 服务端节流；同步启动前端倒计时避免继续点击
        startResend()
      } else {
        setOtpErr(detail.message ?? '重发失败，请稍后再试')
      }
    }
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

  const handleStep2 = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    let ok = true
    const code = otp.join('')
    if (code.length < 6) {
      setOtpErr('请输入 6 位验证码')
      setOtpShake(true)
      setTimeout(() => setOtpShake(false), 350)
      ok = false
    } else setOtpErr('')
    if (newPwd.length < 8) {
      setNewPwdErr('密码至少 8 位')
      ok = false
    } else if (!/[A-Za-z]/.test(newPwd) || !/\d/.test(newPwd)) {
      setNewPwdErr('密码须包含字母和数字')
      ok = false
    } else setNewPwdErr('')
    if (confirmPwd !== newPwd) {
      setConfirmErr('两次输入的密码不一致')
      ok = false
    } else setConfirmErr('')
    if (!ok) return

    try {
      await resetPasswordMutation.mutateAsync({
        email: email.trim(),
        verifyCode: code,
        newPassword: newPwd,
      })
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
    } catch (err) {
      const detail = parseApiError(err)
      if (detail.code === 'VERIFY_CODE_INVALID') {
        setOtpErr(detail.message ?? '验证码错误或已过期')
        setOtpShake(true)
        setTimeout(() => setOtpShake(false), 350)
      } else if (detail.code === 'EMAIL_NOT_FOUND') {
        setOtpErr('该邮箱尚未注册，请返回上一步核对')
      } else {
        setOtpErr(detail.message ?? '密码重置失败，请稍后再试')
      }
    }
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

              <form
                onSubmit={(e) => {
                  void handleStep1(e)
                }}
                noValidate
              >
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

              <form
                onSubmit={(e) => {
                  void handleStep2(e)
                }}
                noValidate
              >
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
                        autoComplete={i === 0 ? 'one-time-code' : 'off'}
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
                  <p className={otpErr ? 'ferr on' : 'ferr'}>{otpErr || '请输入 6 位验证码'}</p>
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
                        color: resendCount > 0 || sendLoading ? 'var(--fg3)' : 'var(--brand)',
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: resendCount > 0 || sendLoading ? 'not-allowed' : 'pointer',
                        fontFamily: 'inherit',
                      }}
                      disabled={resendCount > 0 || sendLoading}
                      onClick={() => {
                        void handleResend()
                      }}
                    >
                      {sendLoading ? '发送中…' : '重新发送'}
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
