'use client'

import { useState, useRef, useCallback, type JSX } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { User, Loader2, CheckCircle, XCircle, Mail, Lock, Shield } from 'lucide-react'
import AuthPanel from '@/components/auth/AuthPanel'
import StrengthBar from '@/components/auth/StrengthBar'
import { useTranslations } from '@/i18n/client'
import { useRegister } from '@yuanai/core/hooks'

type CheckStatus = 'idle' | 'checking' | 'ok' | 'taken'

export default function RegisterPage(): JSX.Element {
  const t = useTranslations('auth')
  const router = useRouter()
  const registerMutation = useRegister()

  const [username, setUsername] = useState('')
  const [checkStatus, setCheckStatus] = useState<CheckStatus>('idle')
  const [unameErr, setUnameErr] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [email, setEmail] = useState('')
  const [emailErr, setEmailErr] = useState('')

  const [pwd, setPwd] = useState('')
  const [pwdErr, setPwdErr] = useState('')

  const [confirmPwd, setConfirmPwd] = useState('')
  const [confirmErr, setConfirmErr] = useState('')

  const [terms, setTerms] = useState(false)
  const [termsErr, setTermsErr] = useState(false)
  const [termsShake, setTermsShake] = useState(false)

  const [apiErr, setApiErr] = useState('')

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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailErr(t('errors.invalidEmail'))
      ok = false
    } else setEmailErr('')
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
      })
      router.replace('/chat')
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: { message?: string } } } })?.response
        ?.data?.detail
      if (detail?.message?.includes('already') || detail?.message?.includes('exists')) {
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
              <div className="iw">
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
                    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
                      setEmailErr(t('errors.invalidEmail'))
                    else setEmailErr('')
                  }}
                />
              </div>
              <p className={emailErr ? 'ferr on' : 'ferr'}>{emailErr}</p>
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
