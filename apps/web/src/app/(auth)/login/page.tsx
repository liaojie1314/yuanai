'use client'

import { useState, useRef, useEffect, type JSX } from 'react'
import Link from 'next/link'
import { QrCode, ChevronDown, Smartphone, Mail, Lock, Eye, EyeOff } from 'lucide-react'
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
        bubbles={[
          '你好，今天想聊什么？',
          '帮我写一段 Python 排序算法',
          '解释一下量子纠缠',
          '帮我分析这段代码的问题',
          '翻译并润色这篇英文邮件',
        ]}
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
            <QrCode size={18} />
          </button>

          {showQr ? (
            /* QR view */
            <div className="qr-view">
              <div className="qr-box">
                <img
                  src="/icons/qr-demo.svg"
                  alt="扫码登录"
                  style={{ width: '100%', height: '100%' }}
                />
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
                        <ChevronDown size={12} />
                      </button>
                      <input
                        id="phone"
                        className={phoneErr ? 'fi phone-fi err' : 'fi phone-fi'}
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
                    <p className={phoneErr ? 'ferr on' : 'ferr'}>{phoneErr}</p>
                  </div>

                  <div className="fg">
                    <label className="fl" htmlFor="sms">
                      验证码
                    </label>
                    <div className="sms-row">
                      <div className="iw sms-fi">
                        <span className="ii">
                          <Smartphone size={16} />
                        </span>
                        <input
                          id="sms"
                          className={smsErr ? 'fi err' : 'fi'}
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
                    <p className={smsErr ? 'ferr on' : 'ferr'}>{smsErr}</p>
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
                        <Mail size={16} />
                      </span>
                      <input
                        id="email"
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

                  <div className="fg">
                    <label className="fl" htmlFor="pwd">
                      密码
                    </label>
                    <div className="iw">
                      <span className="ii">
                        <Lock size={16} />
                      </span>
                      <input
                        id="pwd"
                        className={pwdErr ? 'fi err' : 'fi'}
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
                        {showPwd ? <Eye size={18} /> : <EyeOff size={18} />}
                      </button>
                    </div>
                    <p className={pwdErr ? 'ferr on' : 'ferr'}>{pwdErr}</p>
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
                    <Link href="/forgot-password" className="fl-link" replace>
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
              <img src="/icons/wechat.svg" alt="" className="soc-icon" />
              <span>微信</span>
            </button>
            <button className="soc-btn" aria-label="Google 登录">
              <img src="/icons/google.svg" alt="" className="soc-icon" />
              <span>Google</span>
            </button>
            <button className="soc-btn" aria-label="Apple 登录">
              <img src="/icons/apple.svg" alt="" className="soc-icon" />
              <span>Apple</span>
            </button>
          </div>

          <p className="signup-cta">
            还没有账号？
            <Link href="/register" replace>
              立即注册
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
