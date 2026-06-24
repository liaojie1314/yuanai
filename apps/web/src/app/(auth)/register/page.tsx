'use client'

import { useState, useEffect, useRef, type JSX } from 'react'
import Link from 'next/link'
import AuthPanel from '@/components/auth/AuthPanel'
import PasswordInput from '@/components/auth/PasswordInput'
import StrengthBar from '@/components/auth/StrengthBar'

const TAKEN_NAMES = ['admin', 'yuanai', 'test', 'user123']

type CheckStatus = 'idle' | 'checking' | 'ok' | 'taken'

export default function RegisterPage(): JSX.Element {
  /* ─── 字段状态 ─── */
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [terms, setTerms] = useState(false)

  /* ─── 错误状态 ─── */
  const [usernameErr, setUsernameErr] = useState('')
  const [emailErr, setEmailErr] = useState('')
  const [pwdErr, setPwdErr] = useState('')
  const [confirmErr, setConfirmErr] = useState('')
  const [termsErr, setTermsErr] = useState(false)

  /* ─── 用户名可用性检测 ─── */
  const [checkStatus, setCheckStatus] = useState<CheckStatus>('idle')
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* ─── 提交状态 ─── */
  const [loading, setLoading] = useState(false)

  /* ─── Terms shake 动画 ─── */
  const [termsShake, setTermsShake] = useState(false)

  /* ─── 用户名输入 debounce 检测 ─── */
  useEffect(() => {
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current)
    if (!username) {
      setCheckStatus('idle')
      return
    }
    setCheckStatus('checking')
    checkTimerRef.current = setTimeout(() => {
      const taken = TAKEN_NAMES.includes(username.toLowerCase())
      setCheckStatus(taken ? 'taken' : 'ok')
      if (taken) setUsernameErr('该用户名已被注册')
      else setUsernameErr('')
    }, 600)
  }, [username])

  const isValidEmail = (v: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    let ok = true

    if (!username || username.length < 2) {
      setUsernameErr('请输入 2-20 位用户名（支持中英文、数字和下划线）')
      ok = false
    } else if (checkStatus === 'taken') {
      ok = false
    } else setUsernameErr('')

    if (!isValidEmail(email)) {
      setEmailErr('请输入正确的邮箱地址')
      ok = false
    } else setEmailErr('')

    if (password.length < 8) {
      setPwdErr('密码至少 8 位')
      ok = false
    } else setPwdErr('')

    if (confirmPwd !== password) {
      setConfirmErr('两次输入的密码不一致')
      ok = false
    } else setConfirmErr('')

    if (!terms) {
      setTermsErr(true)
      setTermsShake(true)
      setTimeout(() => setTermsShake(false), 350)
      ok = false
    } else setTermsErr(false)

    if (!ok) return
    setLoading(true)
    // TODO: 调用注册 API
    setTimeout(() => setLoading(false), 1600)
  }

  /* ─── 用户名状态图标 ─── */
  function UsernameStatusIcon(): JSX.Element | null {
    if (checkStatus === 'checking') {
      return (
        <span className="absolute right-3.5 flex" style={{ width: 18, height: 18 }}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--fg3)"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{ animation: 'spin .7s linear infinite', transformOrigin: 'center' }}
          >
            <path d="M21 12a9 9 0 1 1-6.22-8.56" />
          </svg>
        </span>
      )
    }
    if (checkStatus === 'ok') {
      return (
        <span className="absolute right-3.5 flex" style={{ width: 18, height: 18 }}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="#10B981"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <circle cx="12" cy="12" r="9" />
            <polyline points="9 12 11 14 15 10" />
          </svg>
        </span>
      )
    }
    if (checkStatus === 'taken') {
      return (
        <span className="absolute right-3.5 flex" style={{ width: 18, height: 18 }}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="#EF4444"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <circle cx="12" cy="12" r="9" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </span>
      )
    }
    return null
  }

  return (
    <div className="auth-layout">
      <AuthPanel
        bubbles={[
          '创建账号，解锁所有 AI 功能',
          '支持 GPT-4o · Claude · DeepSeek',
          '多设备无缝同步对话记录',
        ]}
      />

      <main className="auth-right">
        <div className="form-card">
          <h1 className="auth-title">创建账号</h1>
          <p className="auth-sub">注册元AI账号，开启 AI 对话之旅</p>

          <form onSubmit={handleSubmit} noValidate>
            {/* 用户名 */}
            <div className="form-group">
              <label className="form-label" htmlFor="username">
                用户名
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
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </span>
                <input
                  id="username"
                  type="text"
                  placeholder="2-20 位，支持中英文和数字"
                  maxLength={20}
                  autoComplete="username"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value)
                    setUsernameErr('')
                  }}
                  className={`auth-input w-full ${
                    usernameErr || checkStatus === 'taken'
                      ? 'auth-input-error'
                      : checkStatus === 'ok'
                        ? 'auth-input-ok'
                        : ''
                  }`}
                  style={{ paddingLeft: 42, paddingRight: 36 }}
                />
                <UsernameStatusIcon />
              </div>
              {usernameErr && <p className="form-error">{usernameErr}</p>}
            </div>

            {/* 邮箱 */}
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

            {/* 密码 */}
            <div className="form-group">
              <label className="form-label" htmlFor="password">
                密码
              </label>
              <PasswordInput
                id="password"
                placeholder="至少 8 位，含大写、数字、特殊字符"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => {
                  if (password && password.length < 8) setPwdErr('密码至少 8 位')
                  else setPwdErr('')
                }}
                hasError={!!pwdErr}
              />
              <StrengthBar password={password} />
              {pwdErr && <p className="form-error">{pwdErr}</p>}
            </div>

            {/* 确认密码 */}
            <div className="form-group">
              <label className="form-label" htmlFor="confirmPwd">
                确认密码
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
                  id="confirmPwd"
                  type="password"
                  placeholder="再次输入密码"
                  autoComplete="new-password"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  onBlur={() => {
                    if (confirmPwd && confirmPwd !== password) setConfirmErr('两次输入的密码不一致')
                    else setConfirmErr('')
                  }}
                  className={`auth-input w-full ${confirmErr ? 'auth-input-error' : ''}`}
                  style={{ paddingLeft: 42 }}
                />
              </div>
              {confirmErr && <p className="form-error">{confirmErr}</p>}
            </div>

            {/* 服务协议 */}
            <div
              className={`mb-5 flex items-start gap-2 ${termsShake ? 'shake' : ''}`}
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
                className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer"
                style={{ accentColor: 'var(--brand)' }}
              />
              <label
                htmlFor="terms"
                className="cursor-pointer text-[13px] leading-relaxed"
                style={{ color: 'var(--fg2)' }}
              >
                我已阅读并同意{' '}
                <a
                  href="#"
                  className="hover:underline"
                  style={{ color: 'var(--brand)' }}
                  onClick={(e) => e.preventDefault()}
                >
                  《服务协议》
                </a>{' '}
                和{' '}
                <a
                  href="#"
                  className="hover:underline"
                  style={{ color: 'var(--brand)' }}
                  onClick={(e) => e.preventDefault()}
                >
                  《隐私政策》
                </a>
              </label>
            </div>
            {termsErr && <p className="form-error -mt-3 mb-3.5">请先阅读并同意服务协议</p>}

            <button type="submit" disabled={loading} className="auth-btn">
              {loading ? (
                <>
                  <span className="btn-spinner" />
                  <span>创建中...</span>
                </>
              ) : (
                '创建账号'
              )}
            </button>
          </form>

          <p className="mt-5 text-center text-[13px]" style={{ color: 'var(--fg2)' }}>
            已有账号？{' '}
            <Link
              href="/login"
              className="font-semibold hover:underline"
              style={{ color: 'var(--brand)' }}
            >
              立即登录
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
