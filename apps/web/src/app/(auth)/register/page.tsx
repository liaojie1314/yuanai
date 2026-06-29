'use client'

import { useState, useRef, useCallback, type JSX } from 'react'
import Link from 'next/link'
import { User, Loader2, CheckCircle, XCircle, Mail, Lock, Shield } from 'lucide-react'
import AuthPanel from '@/components/auth/AuthPanel'
import StrengthBar from '@/components/auth/StrengthBar'

type CheckStatus = 'idle' | 'checking' | 'ok' | 'taken'

const TAKEN = ['admin', 'yuanai', 'test', 'user123']

export default function RegisterPage(): JSX.Element {
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

  const [loading, setLoading] = useState(false)

  const handleUsername = useCallback((v: string): void => {
    setUsername(v)
    setCheckStatus('idle')
    setUnameErr('')
    if (!v) return
    setCheckStatus('checking')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const taken = TAKEN.includes(v.toLowerCase())
      setCheckStatus(taken ? 'taken' : 'ok')
      if (taken) setUnameErr('该用户名已被注册')
    }, 600)
  }, [])

  const shake = (): void => {
    setTermsShake(true)
    setTimeout(() => setTermsShake(false), 350)
  }

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    let ok = true
    if (!username.trim() || username.length < 2) {
      setUnameErr('请输入 2-20 位用户名')
      ok = false
    } else if (checkStatus === 'taken') ok = false
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailErr('请输入正确的邮箱地址')
      ok = false
    } else setEmailErr('')
    if (pwd.length < 8) {
      setPwdErr('密码至少 8 位')
      ok = false
    } else setPwdErr('')
    if (confirmPwd !== pwd) {
      setConfirmErr('两次输入的密码不一致')
      ok = false
    } else setConfirmErr('')
    if (!terms) {
      setTermsErr(true)
      shake()
      ok = false
    } else setTermsErr(false)
    if (!ok) return
    setLoading(true)
    // TODO: 调用 API
    setTimeout(() => setLoading(false), 1600)
  }

  const unameInputCls = ['fi', checkStatus === 'taken' ? 'err' : checkStatus === 'ok' ? 'ok' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div className="auth-wrap">
      <AuthPanel
        bubbles={[
          '创建账号，解锁所有 AI 功能',
          '支持 GPT-4o · Claude · DeepSeek',
          '多设备无缝同步对话记录',
          '每月免费额度，随时按需升级',
          '支持图片与文件多模态输入',
        ]}
      />

      <main className="auth-right">
        <div className="form-card">
          <h1 className="page-title">创建账号</h1>
          <p className="page-sub">注册元AI账号，开启 AI 对话之旅</p>

          <form onSubmit={handleSubmit} noValidate>
            {/* Username */}
            <div className="fg">
              <label className="fl" htmlFor="uname">
                用户名
              </label>
              <div className="iw">
                <span className="ii">
                  <User size={16} />
                </span>
                <input
                  id="uname"
                  className={unameInputCls}
                  type="text"
                  placeholder="2-20 位，支持中英文和数字"
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

            {/* Email */}
            <div className="fg">
              <label className="fl" htmlFor="remail">
                邮箱
              </label>
              <div className="iw">
                <span className="ii">
                  <Mail size={16} />
                </span>
                <input
                  id="remail"
                  className={emailErr ? 'fi err' : 'fi'}
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
              <p className={emailErr ? 'ferr on' : 'ferr'}>{emailErr}</p>
            </div>

            {/* Password */}
            <div className="fg">
              <label className="fl" htmlFor="rpwd">
                密码
              </label>
              <div className="iw">
                <span className="ii">
                  <Lock size={16} />
                </span>
                <input
                  id="rpwd"
                  className={pwdErr ? 'fi err' : 'fi'}
                  type="password"
                  placeholder="至少 8 位，含大写、数字、特殊字符"
                  autoComplete="new-password"
                  value={pwd}
                  onChange={(e) => setPwd(e.target.value)}
                  onBlur={() => {
                    if (pwd && pwd.length < 8) setPwdErr('密码至少 8 位')
                    else setPwdErr('')
                  }}
                />
              </div>
              <StrengthBar password={pwd} />
              <p className={pwdErr ? 'ferr on' : 'ferr'}>{pwdErr}</p>
            </div>

            {/* Confirm password */}
            <div className="fg">
              <label className="fl" htmlFor="cpwd">
                确认密码
              </label>
              <div className="iw">
                <span className="ii">
                  <Shield size={16} />
                </span>
                <input
                  id="cpwd"
                  className={confirmErr ? 'fi err' : 'fi'}
                  type="password"
                  placeholder="再次输入密码"
                  autoComplete="new-password"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  onBlur={() => {
                    if (confirmPwd && confirmPwd !== pwd) setConfirmErr('两次输入的密码不一致')
                    else setConfirmErr('')
                  }}
                />
              </div>
              <p className={confirmErr ? 'ferr on' : 'ferr'}>{confirmErr}</p>
            </div>

            {/* Terms */}
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
                我已阅读并同意
                <a href="#" onClick={(e) => e.preventDefault()}>
                  《服务协议》
                </a>
                和
                <a href="#" onClick={(e) => e.preventDefault()}>
                  《隐私政策》
                </a>
              </label>
            </div>
            <p
              className={termsErr ? 'ferr on' : 'ferr'}
              style={{ marginTop: '-12px', marginBottom: '14px' }}
            >
              请先阅读并同意服务协议
            </p>

            <button type="submit" className="btn" disabled={loading}>
              {loading ? (
                <>
                  <span className="spin" />
                  创建中...
                </>
              ) : (
                '创建账号'
              )}
            </button>
          </form>

          <p className="login-cta">
            已有账号？
            <Link href="/login" replace>
              立即登录
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
