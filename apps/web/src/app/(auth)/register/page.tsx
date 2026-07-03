'use client'

import { useState, useRef, useCallback, useEffect, type JSX } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { User, Loader2, CheckCircle, XCircle, Mail, Lock, Shield } from 'lucide-react'
import AuthPanel from '@/components/auth/AuthPanel'
import StrengthBar from '@/components/auth/StrengthBar'
import { useTranslations } from '@/i18n/client'
import { useRegister, useSendVerifyCode } from '@yuanai/core/hooks'

type CheckStatus = 'idle' | 'checking' | 'ok' | 'taken'

/** 邮箱格式的基础校验（与后端 EmailStr 松耦合，仅用于按钮启用与前端提前提示） */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function RegisterPage(): JSX.Element {
  const t = useTranslations('auth')
  const router = useRouter()
  const registerMutation = useRegister()
  const sendCodeMutation = useSendVerifyCode()

  const [username, setUsername] = useState('')
  const [checkStatus, setCheckStatus] = useState<CheckStatus>('idle')
  const [unameErr, setUnameErr] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [email, setEmail] = useState('')
  const [emailErr, setEmailErr] = useState('')

  /** 6 位 OTP 分格，与忘记密码页保持一致的输入体验 */
  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', ''])
  const [codeErr, setCodeErr] = useState('')
  const [otpShake, setOtpShake] = useState(false)
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])
  /** 距离下次可发送验证码剩余秒数；0 表示可发送 */
  const [resendIn, setResendIn] = useState(0)
  const [codeSentTip, setCodeSentTip] = useState('')

  const [pwd, setPwd] = useState('')
  const [pwdErr, setPwdErr] = useState('')

  const [confirmPwd, setConfirmPwd] = useState('')
  const [confirmErr, setConfirmErr] = useState('')

  const [terms, setTerms] = useState(false)
  const [termsErr, setTermsErr] = useState(false)
  const [termsShake, setTermsShake] = useState(false)

  const [apiErr, setApiErr] = useState('')

  // 60s 倒计时；resendIn 归零时清理 interval
  useEffect(() => {
    if (resendIn <= 0) return
    const timer = window.setInterval(() => {
      setResendIn((n) => (n > 0 ? n - 1 : 0))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [resendIn])

  const handleSendCode = async (): Promise<void> => {
    setApiErr('')
    setCodeErr('')
    setCodeSentTip('')
    if (!EMAIL_RE.test(email.trim())) {
      setEmailErr(t('errors.invalidEmail'))
      return
    }
    try {
      await sendCodeMutation.mutateAsync({ email: email.trim(), scene: 'register' })
      setResendIn(60)
      setCodeSentTip('验证码已发送，请查收邮箱')
      // 发送成功后光标聚焦到第一个 OTP 格子
      requestAnimationFrame(() => otpRefs.current[0]?.focus())
    } catch (err) {
      const detail = (
        err as { response?: { data?: { detail?: { code?: string; message?: string } } } }
      )?.response?.data?.detail
      if (detail?.code === 'EMAIL_ALREADY_REGISTERED') {
        setEmailErr('该邮箱已被注册，请直接登录')
      } else if (detail?.code === 'VERIFY_CODE_THROTTLED') {
        setResendIn(60)
        setCodeSentTip(detail.message ?? '请求过于频繁，请稍后再试')
      } else {
        setApiErr(detail?.message ?? '验证码发送失败，请稍后再试')
      }
    }
  }

  /** OTP 格子：单字符输入自动跳到下一格 */
  const handleOtpInput = (idx: number, val: string): void => {
    const digit = val.replace(/\D/g, '')
    const next = [...otp]
    next[idx] = digit.charAt(0) ?? ''
    setOtp(next)
    if (codeErr) setCodeErr('')
    if (digit && idx < 5) otpRefs.current[idx + 1]?.focus()
  }

  /** OTP 格子：退格回跳上一格 */
  const handleOtpKey = (idx: number, e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) otpRefs.current[idx - 1]?.focus()
  }

  /** OTP 格子：粘贴 6 位数字自动填满 */
  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>): void => {
    e.preventDefault()
    const data = e.clipboardData.getData('text').replace(/\D/g, '')
    const next = ['', '', '', '', '', '']
    for (let i = 0; i < 6; i++) next[i] = data[i] ?? ''
    setOtp(next)
    otpRefs.current[Math.min(data.length, 5)]?.focus()
  }

  const handleUsername = useCallback((v: string): void => {
    setUsername(v)
    setCheckStatus('idle')
    setUnameErr('')
    if (!v) return
    setCheckStatus('checking')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      // 此处仅做格式校验，重复检测由注册接口的 409 响应处理
      setCheckStatus('ok')
    }, 400)
  }, [])

  const shake = (): void => {
    setTermsShake(true)
    setTimeout(() => setTermsShake(false), 350)
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setApiErr('')
    let ok = true
    if (!username.trim() || username.length < 2) {
      setUnameErr(t('errors.usernameRequired'))
      ok = false
    }
    if (!EMAIL_RE.test(email.trim())) {
      setEmailErr(t('errors.invalidEmail'))
      ok = false
    } else setEmailErr('')
    const verifyCode = otp.join('')
    if (!/^\d{6}$/.test(verifyCode)) {
      setCodeErr(t('errors.codeRequired'))
      setOtpShake(true)
      setTimeout(() => setOtpShake(false), 350)
      ok = false
    } else setCodeErr('')
    if (pwd.length < 8) {
      setPwdErr(t('errors.passwordTooShort'))
      ok = false
    } else setPwdErr('')
    if (confirmPwd !== pwd) {
      setConfirmErr(t('errors.passwordMismatch'))
      ok = false
    } else setConfirmErr('')
    if (!terms) {
      setTermsErr(true)
      shake()
      ok = false
    } else setTermsErr(false)
    if (!ok) return

    try {
      await registerMutation.mutateAsync({
        email: email.trim(),
        password: pwd,
        username: username.trim(),
        verifyCode,
      })
      router.replace('/chat')
    } catch (err) {
      const detail = (
        err as { response?: { data?: { detail?: { code?: string; message?: string } } } }
      )?.response?.data?.detail
      if (detail?.code === 'VERIFY_CODE_INVALID') {
        setCodeErr(detail.message ?? '验证码错误或已过期')
        setOtpShake(true)
        setTimeout(() => setOtpShake(false), 350)
      } else if (detail?.code === 'EMAIL_OR_USERNAME_EXISTS') {
        setApiErr('邮箱或用户名已被注册，请换一个试试')
      } else {
        setApiErr(detail?.message ?? '注册失败，请稍后重试')
      }
    }
  }

  const loading = registerMutation.isPending

  const unameInputCls = ['fi', checkStatus === 'taken' ? 'err' : checkStatus === 'ok' ? 'ok' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div className="auth-wrap">
      <AuthPanel
        bubbles={[
          t('bubbles.register1'),
          t('bubbles.register2'),
          t('bubbles.register3'),
          t('bubbles.register4'),
          t('bubbles.register5'),
        ]}
      />

      <main className="auth-right">
        <div className="form-card">
          <h1 className="page-title">{t('createAccount')}</h1>
          <p className="page-sub">{t('registerSubtitle')}</p>

          <form
            onSubmit={(e) => {
              void handleSubmit(e)
            }}
            noValidate
          >
            {apiErr && (
              <p className="ferr on" style={{ marginBottom: '12px' }}>
                {apiErr}
              </p>
            )}

            <div className="fg">
              <label className="fl" htmlFor="uname">
                {t('username')}
              </label>
              <div className="iw">
                <span className="ii">
                  <User size={16} />
                </span>
                <input
                  id="uname"
                  className={unameInputCls}
                  type="text"
                  placeholder={t('placeholders.username')}
                  maxLength={20}
                  autoComplete="username"
                  value={username}
                  onChange={(e) => handleUsername(e.target.value)}
                />
                <span className={checkStatus !== 'idle' ? 'status-ico on' : 'status-ico'}>
                  {checkStatus === 'checking' && (
                    <Loader2 size={16} style={{ animation: 'spin .7s linear infinite' }} />
                  )}
                  {checkStatus === 'ok' && <CheckCircle size={16} color="#10b981" />}
                  {checkStatus === 'taken' && <XCircle size={16} color="#ef4444" />}
                </span>
              </div>
              <p className={unameErr ? 'ferr on' : 'ferr'}>{unameErr}</p>
            </div>

            <div className="fg">
              <label className="fl" htmlFor="remail">
                {t('email')}
              </label>
              <div className="iw code-iw">
                <span className="ii">
                  <Mail size={16} />
                </span>
                <input
                  id="remail"
                  className={emailErr ? 'fi err' : 'fi'}
                  type="email"
                  placeholder={t('placeholders.email')}
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => {
                    if (email && !EMAIL_RE.test(email)) setEmailErr(t('errors.invalidEmail'))
                    else setEmailErr('')
                  }}
                />
                <button
                  type="button"
                  className="code-send-btn"
                  onClick={() => {
                    void handleSendCode()
                  }}
                  disabled={
                    resendIn > 0 || sendCodeMutation.isPending || !EMAIL_RE.test(email.trim())
                  }
                >
                  {sendCodeMutation.isPending ? (
                    <Loader2 size={14} style={{ animation: 'spin .7s linear infinite' }} />
                  ) : resendIn > 0 ? (
                    t('resendIn', { seconds: resendIn })
                  ) : (
                    t('sendCode')
                  )}
                </button>
              </div>
              <p className={emailErr ? 'ferr on' : 'ferr'}>{emailErr}</p>
            </div>

            <div className="fg">
              <label className="fl">{t('verificationCode')}</label>
              <div className={otpShake ? 'otp-row shake' : 'otp-row'}>
                {otp.map((v, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      otpRefs.current[i] = el
                    }}
                    className={codeErr ? 'otp-cell err' : 'otp-cell'}
                    type="text"
                    maxLength={1}
                    inputMode="numeric"
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    value={v}
                    onChange={(e) => handleOtpInput(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKey(i, e)}
                    onPaste={handleOtpPaste}
                  />
                ))}
              </div>
              {codeErr ? (
                <p className="ferr on">{codeErr}</p>
              ) : codeSentTip ? (
                <p className="ferr on" style={{ color: '#10b981' }}>
                  {codeSentTip}
                </p>
              ) : (
                <p className="ferr">&nbsp;</p>
              )}
            </div>

            <div className="fg">
              <label className="fl" htmlFor="rpwd">
                {t('password')}
              </label>
              <div className="iw">
                <span className="ii">
                  <Lock size={16} />
                </span>
                <input
                  id="rpwd"
                  className={pwdErr ? 'fi err' : 'fi'}
                  type="password"
                  placeholder={t('placeholders.password')}
                  autoComplete="new-password"
                  value={pwd}
                  onChange={(e) => setPwd(e.target.value)}
                />
              </div>
              <StrengthBar password={pwd} />
              <p className={pwdErr ? 'ferr on' : 'ferr'}>{pwdErr}</p>
            </div>

            <div className="fg">
              <label className="fl" htmlFor="conf">
                {t('confirmPassword')}
              </label>
              <div className="iw">
                <span className="ii">
                  <Shield size={16} />
                </span>
                <input
                  id="conf"
                  className={confirmErr ? 'fi err' : 'fi'}
                  type="password"
                  placeholder={t('placeholders.confirmPassword')}
                  autoComplete="new-password"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  onBlur={() => {
                    if (confirmPwd && confirmPwd !== pwd)
                      setConfirmErr(t('errors.passwordMismatch'))
                    else setConfirmErr('')
                  }}
                />
              </div>
              <p className={confirmErr ? 'ferr on' : 'ferr'}>{confirmErr}</p>
            </div>

            <div
              className="terms-row"
              style={termsShake ? { animation: 'shake 300ms ease' } : undefined}
            >
              <input
                type="checkbox"
                id="terms"
                checked={terms}
                onChange={(e) => {
                  setTerms(e.target.checked)
                  if (e.target.checked) setTermsErr(false)
                }}
              />
              <label htmlFor="terms" className="terms-txt">
                {t('termsAgree')}
                <a href="#" onClick={(e) => e.preventDefault()}>
                  {t('termsService')}
                </a>
                {t('and')}
                <a href="#" onClick={(e) => e.preventDefault()}>
                  {t('termsPrivacy')}
                </a>
              </label>
            </div>
            <p
              className={termsErr ? 'ferr on' : 'ferr'}
              style={{ marginTop: '-12px', marginBottom: '14px' }}
            >
              {t('errors.termsRequired')}
            </p>

            <button type="submit" className="btn" disabled={loading}>
              {loading ? (
                <>
                  <span className="spin" />
                  {t('registering')}
                </>
              ) : (
                t('register')
              )}
            </button>
          </form>

          <p className="login-cta">
            {t('hasAccount')}
            <Link href="/login" replace>
              {t('loginNow')}
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
