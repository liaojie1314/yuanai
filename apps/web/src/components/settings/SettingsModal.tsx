'use client'

import { useState, useRef, useEffect, useCallback, type JSX } from 'react'
import {
  X,
  User,
  Shield,
  Sun,
  Bell,
  Globe,
  HelpCircle,
  Pencil,
  Check,
  Eye,
  EyeOff,
  Camera,
  Upload,
  ExternalLink,
  MessageSquare,
  Zap,
  Paperclip,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────
type Section = 'profile' | 'security' | 'appearance' | 'notifications' | 'language' | 'about'
type SubModal = 'change-email' | 'change-pw' | 'unlink-wechat' | 'delete-account' | null
type ThemeChoice = 'auto' | 'light' | 'dark'
type Density = 'compact' | 'standard' | 'loose'
type TimeFmt = '24h' | '12h'
type DateFmt = 'ymd' | 'mdy' | 'dmy'

interface Toast {
  id: number
  msg: string
  type: 'ok' | 'err'
}

interface Props {
  open: boolean
  onClose: () => void
  initialSection?: Section
}

const FONT_SIZES: [number, number, number] = [13, 15, 17]

function pwStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: '输入密码后显示强度', color: 'var(--fg3)' }
  let s = 0
  if (pw.length >= 8) s++
  if (/[A-Z]/.test(pw)) s++
  if (/[0-9]/.test(pw)) s++
  if (/[^A-Za-z0-9]/.test(pw)) s++
  const colors: Record<number, string> = { 1: '#ef4444', 2: '#f59e0b', 3: '#3b82f6', 4: '#10b981' }
  const labels: Record<number, string> = {
    1: '弱 — 建议包含大小写、数字、特殊字符',
    2: '中 — 可以更强',
    3: '强 — 不错',
    4: '很强 — 安全密码',
  }
  return { score: s, label: labels[s] ?? '', color: colors[s] ?? '#ef4444' }
}

const NAV_ITEMS: Array<{ id: Section; label: string; icon: JSX.Element; group: string }> = [
  { id: 'profile', label: '个人资料', icon: <User size={16} />, group: '个人中心' },
  { id: 'security', label: '账号安全', icon: <Shield size={16} />, group: '个人中心' },
  { id: 'appearance', label: '外观与主题', icon: <Sun size={16} />, group: '系统偏好' },
  { id: 'notifications', label: '通知设置', icon: <Bell size={16} />, group: '系统偏好' },
  { id: 'language', label: '语言与地区', icon: <Globe size={16} />, group: '系统偏好' },
  { id: 'about', label: '关于与帮助', icon: <HelpCircle size={16} />, group: '支持' },
]
const NAV_GROUPS = ['个人中心', '系统偏好', '支持']

// ── Component ──────────────────────────────────────────────────
export default function SettingsModal({
  open,
  onClose,
  initialSection = 'profile',
}: Props): JSX.Element | null {
  // Navigation
  const [section, setSection] = useState<Section>(initialSection)
  const [subModal, setSubModal] = useState<SubModal>(null)

  // Theme / appearance
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>('light')
  const [fontSizeIdx, setFontSizeIdx] = useState<0 | 1 | 2>(1)
  const [density, setDensity] = useState<Density>('standard')

  // Language
  const [timeFmt, setTimeFmt] = useState<TimeFmt>('24h')
  const [dateFmt, setDateFmt] = useState<DateFmt>('ymd')

  // Notifications
  const [notifBrowser, setNotifBrowser] = useState(true)
  const [notifSound, setNotifSound] = useState(false)
  const [notifAI, setNotifAI] = useState(true)
  const [notifFeature, setNotifFeature] = useState(true)
  const [notifMaint, setNotifMaint] = useState(false)
  const [notifWeekly, setNotifWeekly] = useState(false)
  const [notifUpdate, setNotifUpdate] = useState(true)
  const [notifSecurity, setNotifSecurity] = useState(true)

  // Profile
  const [username, setUsername] = useState('李建明')
  const [bio, setBio] = useState('')
  const [editingUsername, setEditingUsername] = useState(false)
  const [editingBio, setEditingBio] = useState(false)
  const [usernameInput, setUsernameInput] = useState('')
  const [bioInput, setBioInput] = useState('')

  // Security sub-modal state
  const [newEmail, setNewEmail] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [emailCd, setEmailCd] = useState(0)
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confPw, setConfPw] = useState('')
  const [showOldPw, setShowOldPw] = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)
  const [showConfPw, setShowConfPw] = useState(false)
  const [delInput, setDelInput] = useState('')

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)

  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok'): void => {
    const id = ++toastId.current
    setToasts((prev) => [...prev, { id, msg, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000)
  }, [])

  // ESC handler
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (subModal) setSubModal(null)
        else onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, subModal, onClose])

  // Read stored theme when settings opens
  useEffect(() => {
    if (!open) return
    setSection(initialSection)
    const saved = localStorage.getItem('theme')
    if (saved === 'auto' || saved === 'light' || saved === 'dark') setThemeChoice(saved)
    else setThemeChoice('light')
  }, [open, initialSection])

  // Email countdown tick
  useEffect(() => {
    if (emailCd <= 0) return
    const t = setTimeout(() => setEmailCd((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [emailCd])

  const applyTheme = (t: ThemeChoice): void => {
    setThemeChoice(t)
    const html = document.documentElement
    if (t === 'dark') html.setAttribute('data-theme', 'dark')
    else if (t === 'light') html.setAttribute('data-theme', 'light')
    else
      html.setAttribute(
        'data-theme',
        window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light'
      )
    localStorage.setItem('theme', t)
    showToast('主题已切换', 'ok')
  }

  const sendCode = (): void => {
    if (!newEmail) {
      showToast('请先填写新邮箱', 'err')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      showToast('邮箱格式不正确', 'err')
      return
    }
    setEmailCd(60)
    showToast('验证码已发送', 'ok')
  }

  const submitEmail = (): void => {
    if (!newEmail) {
      showToast('请填写新邮箱', 'err')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      showToast('邮箱格式不正确', 'err')
      return
    }
    if (!emailCode) {
      showToast('请输入验证码', 'err')
      return
    }
    setSubModal(null)
    setNewEmail('')
    setEmailCode('')
    showToast('邮箱更新成功', 'ok')
  }

  const savePw = (): void => {
    if (!oldPw || !newPw || !confPw) {
      showToast('请填写所有字段', 'err')
      return
    }
    if (newPw !== confPw) {
      showToast('两次密码不一致', 'err')
      return
    }
    if (newPw.length < 8) {
      showToast('新密码至少 8 位', 'err')
      return
    }
    setSubModal(null)
    setOldPw('')
    setNewPw('')
    setConfPw('')
    setShowOldPw(false)
    setShowNewPw(false)
    setShowConfPw(false)
    showToast('密码已更新', 'ok')
  }

  const doDelete = (): void => {
    if (delInput !== '删除账号') return
    setSubModal(null)
    setDelInput('')
    showToast('账号注销请求已提交', 'ok')
  }

  const saveUsername = (): void => {
    if (usernameInput.trim()) {
      setUsername(usernameInput.trim())
      showToast('保存成功', 'ok')
    }
    setEditingUsername(false)
  }

  const saveBio = (): void => {
    setBio(bioInput.trim())
    showToast('保存成功', 'ok')
    setEditingBio(false)
  }

  if (!open) return null

  const str = pwStrength(newPw)
  const fontSize = FONT_SIZES[fontSizeIdx]

  return (
    <>
      {/* ── Settings overlay ── */}
      <div className="st-overlay" onClick={onClose}>
        <div
          className="st-modal"
          role="dialog"
          aria-modal="true"
          aria-label="设置"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Left nav ── */}
          <aside className="st-nav">
            <div className="st-nav-hd">
              <span className="st-nav-title">设置</span>
              <button className="st-close-btn" onClick={onClose} title="关闭 (ESC)">
                <X size={15} />
              </button>
            </div>
            <div className="st-nav-body">
              {NAV_GROUPS.map((group) => (
                <div key={group}>
                  <span className="st-nav-gt">{group}</span>
                  {NAV_ITEMS.filter((it) => it.group === group).map((it) => (
                    <button
                      key={it.id}
                      className={`st-nav-it ${section === it.id ? 'active' : ''}`}
                      onClick={() => setSection(it.id)}
                    >
                      {it.icon}
                      {it.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="st-nav-ft">元AI v1.0.0</div>
          </aside>

          {/* ── Right content ── */}
          <div className="st-content">
            {/* ────────── 个人资料 ────────── */}
            <section className={`st-sec ${section === 'profile' ? 'active' : ''}`}>
              <div className="st-sec-hd">
                <h2 className="st-sec-title">个人资料</h2>
                <p className="st-sec-sub">管理你的基本信息和公开展示内容</p>
              </div>

              <div className="st-blk">
                <div className="st-blk-hd">
                  <span className="st-blk-title">头像与昵称</span>
                </div>
                <div className="st-avatar-row">
                  <div className="st-avatar-area">
                    <div className="st-avatar-wrap">
                      <div className="st-avatar-circle">{username.charAt(0)}</div>
                      <div className="st-av-ov">
                        <Camera size={16} />
                        更换
                      </div>
                    </div>
                    <button className="st-btn-sm">
                      <Upload size={12} />
                      上传头像
                    </button>
                  </div>
                  <div className="st-user-meta">
                    <div className="st-user-name">{username}</div>
                    <div className="st-user-email">zh**@gmail.com</div>
                    <span className="st-badge st-badge-free" style={{ marginTop: '4px' }}>
                      免费版
                    </span>
                  </div>
                </div>
              </div>

              <div className="st-blk">
                <div className="st-blk-hd">
                  <span className="st-blk-title">基本信息</span>
                </div>
                <div className="st-row">
                  <span className="st-row-label" style={{ flexShrink: 0, width: '80px' }}>
                    用户名
                  </span>
                  <div className="st-row-r" style={{ flex: 1, justifyContent: 'flex-end' }}>
                    {!editingUsername ? (
                      <div className="st-ie-view">
                        <span className="st-row-val">{username}</span>
                        <button
                          className="st-btn-icon"
                          onClick={() => {
                            setUsernameInput(username)
                            setEditingUsername(true)
                          }}
                          title="编辑"
                        >
                          <Pencil size={13} />
                        </button>
                      </div>
                    ) : (
                      <div className="st-ie-edit">
                        <input
                          className="st-ie-input"
                          value={usernameInput}
                          onChange={(e) => setUsernameInput(e.target.value)}
                          maxLength={20}
                          placeholder="2-20 位"
                          autoFocus
                        />
                        <button
                          className="st-btn st-btn-ghost"
                          style={{ height: '32px', padding: '0 10px', fontSize: '12px' }}
                          onClick={() => setEditingUsername(false)}
                        >
                          取消
                        </button>
                        <button
                          className="st-btn st-btn-primary"
                          style={{ height: '32px', padding: '0 10px', fontSize: '12px' }}
                          onClick={saveUsername}
                        >
                          保存
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="st-row">
                  <span className="st-row-label" style={{ flexShrink: 0, width: '80px' }}>
                    个性签名
                  </span>
                  <div className="st-row-r" style={{ flex: 1, justifyContent: 'flex-end' }}>
                    {!editingBio ? (
                      <div className="st-ie-view">
                        <span className={bio ? 'st-row-val' : 'st-row-muted'}>
                          {bio || '未填写'}
                        </span>
                        <button
                          className="st-btn-icon"
                          onClick={() => {
                            setBioInput(bio)
                            setEditingBio(true)
                          }}
                          title="编辑"
                        >
                          <Pencil size={13} />
                        </button>
                      </div>
                    ) : (
                      <div className="st-ie-edit">
                        <input
                          className="st-ie-input"
                          value={bioInput}
                          onChange={(e) => setBioInput(e.target.value)}
                          maxLength={100}
                          placeholder="最多 100 字"
                          autoFocus
                        />
                        <button
                          className="st-btn st-btn-ghost"
                          style={{ height: '32px', padding: '0 10px', fontSize: '12px' }}
                          onClick={() => setEditingBio(false)}
                        >
                          取消
                        </button>
                        <button
                          className="st-btn st-btn-primary"
                          style={{ height: '32px', padding: '0 10px', fontSize: '12px' }}
                          onClick={saveBio}
                        >
                          保存
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="st-row">
                  <span className="st-row-label">注册时间</span>
                  <span className="st-row-muted">2025 年 8 月 15 日</span>
                </div>
              </div>

              <div className="st-blk">
                <div className="st-blk-hd">
                  <span className="st-blk-title">本月使用情况</span>
                  <span className="st-blk-sub">每月 1 日重置</span>
                </div>
                <div className="st-stats-grid">
                  <div className="st-stat-it">
                    <MessageSquare size={18} color="var(--brand)" />
                    <span className="st-stat-val">128</span>
                    <span className="st-stat-label">次对话</span>
                  </div>
                  <div className="st-stat-it">
                    <Zap size={18} color="var(--brand)" />
                    <span className="st-stat-val">42.3k</span>
                    <span className="st-stat-label">Token 消耗</span>
                  </div>
                  <div className="st-stat-it">
                    <Paperclip size={18} color="var(--brand)" />
                    <span className="st-stat-val">17</span>
                    <span className="st-stat-label">上传文件</span>
                  </div>
                </div>
                <div className="st-usage-area">
                  <div className="st-usage-hd">
                    <span>本月免费额度</span>
                    <button className="st-btn-link">升级 Pro 解锁无限制 →</button>
                  </div>
                  <div className="st-prog-track">
                    <div className="st-prog-fill" style={{ width: '42%' }} />
                  </div>
                  <span className="st-usage-text">已用 42,312 / 100,000 Token</span>
                </div>
              </div>
            </section>

            {/* ────────── 账号安全 ────────── */}
            <section className={`st-sec ${section === 'security' ? 'active' : ''}`}>
              <div className="st-sec-hd">
                <h2 className="st-sec-title">账号安全</h2>
                <p className="st-sec-sub">管理你的登录凭证和账号保护设置</p>
              </div>

              <div className="st-blk">
                <div className="st-blk-hd">
                  <span className="st-blk-title">登录邮箱</span>
                </div>
                <div className="st-row">
                  <div className="st-row-l">
                    <span className="st-row-label">当前邮箱</span>
                  </div>
                  <div className="st-row-r">
                    <span className="st-row-val">zh**@gmail.com</span>
                    <button className="st-btn-link" onClick={() => setSubModal('change-email')}>
                      更换邮箱
                    </button>
                  </div>
                </div>
              </div>

              <div className="st-blk">
                <div className="st-blk-hd">
                  <span className="st-blk-title">登录密码</span>
                </div>
                <div className="st-row">
                  <div className="st-row-l">
                    <span className="st-row-label">当前密码</span>
                  </div>
                  <div className="st-row-r">
                    <span className="st-row-muted">••••••••</span>
                    <button className="st-btn-link" onClick={() => setSubModal('change-pw')}>
                      修改密码
                    </button>
                  </div>
                </div>
              </div>

              <div className="st-blk">
                <div className="st-blk-hd">
                  <span className="st-blk-title">关联登录方式</span>
                  <span className="st-blk-sub">通过第三方账号快速登录</span>
                </div>
                <div className="st-row">
                  <div
                    className="st-row-r"
                    style={{ flex: 1, justifyContent: 'flex-start', gap: '10px' }}
                  >
                    <div className="st-sl st-sl-wechat">
                      <img src="/icons/wechat.svg" width={14} height={14} alt="" />
                    </div>
                    <span className="st-row-val">微信</span>
                  </div>
                  <div className="st-row-r">
                    <span className="st-badge st-badge-ok">已关联</span>
                    <button
                      className="st-btn-err-link"
                      onClick={() => setSubModal('unlink-wechat')}
                    >
                      解除关联
                    </button>
                  </div>
                </div>
                <div className="st-row">
                  <div
                    className="st-row-r"
                    style={{ flex: 1, justifyContent: 'flex-start', gap: '10px' }}
                  >
                    <div className="st-sl st-sl-google">
                      <img src="/icons/google.svg" width={14} height={14} alt="" />
                    </div>
                    <span className="st-row-val">Google</span>
                  </div>
                  <div className="st-row-r">
                    <span className="st-badge st-badge-muted">未关联</span>
                    <button
                      className="st-btn-link"
                      onClick={() => showToast('Google 授权功能即将上线', 'ok')}
                    >
                      立即关联
                    </button>
                  </div>
                </div>
                <div className="st-row">
                  <div
                    className="st-row-r"
                    style={{ flex: 1, justifyContent: 'flex-start', gap: '10px' }}
                  >
                    <div className="st-sl st-sl-github">
                      <img src="/icons/github.svg" width={14} height={14} alt="" />
                    </div>
                    <span className="st-row-val">GitHub</span>
                  </div>
                  <div className="st-row-r">
                    <span className="st-badge st-badge-muted">未关联</span>
                    <button
                      className="st-btn-link"
                      onClick={() => showToast('GitHub 授权功能即将上线', 'ok')}
                    >
                      立即关联
                    </button>
                  </div>
                </div>
              </div>

              <div className="st-blk danger">
                <div className="st-blk-hd">
                  <span className="st-blk-title" style={{ color: '#ef4444' }}>
                    危险操作
                  </span>
                </div>
                <div className="st-row">
                  <div className="st-row-l">
                    <span className="st-row-label">注销账号</span>
                    <span className="st-row-desc">永久删除账号及所有对话数据，不可恢复</span>
                  </div>
                  <button className="st-btn-danger" onClick={() => setSubModal('delete-account')}>
                    注销账号
                  </button>
                </div>
              </div>
            </section>

            {/* ────────── 外观与主题 ────────── */}
            <section className={`st-sec ${section === 'appearance' ? 'active' : ''}`}>
              <div className="st-sec-hd">
                <h2 className="st-sec-title">外观与主题</h2>
                <p className="st-sec-sub">调整界面的视觉风格和阅读体验</p>
              </div>

              <div className="st-blk">
                <div className="st-blk-hd">
                  <span className="st-blk-title">主题</span>
                </div>
                <div className="st-theme-cards">
                  {(
                    [
                      { key: 'auto', label: '跟随系统', cls: 'st-tp-auto' },
                      { key: 'light', label: '浅色模式', cls: 'st-tp-light' },
                      { key: 'dark', label: '深色模式', cls: 'st-tp-dark' },
                    ] as Array<{ key: ThemeChoice; label: string; cls: string }>
                  ).map(({ key, label, cls }) => (
                    <div
                      key={key}
                      className={`st-theme-card ${themeChoice === key ? 'sel' : ''}`}
                      onClick={() => applyTheme(key)}
                    >
                      <div className={`st-tp ${cls}`} />
                      <div className="st-tp-detail">
                        <span className="st-tp-name">{label}</span>
                        {themeChoice === key && <Check size={13} color="var(--brand)" />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="st-blk">
                <div className="st-blk-hd">
                  <span className="st-blk-title">字体大小</span>
                  <span className="st-blk-sub">影响对话内容的文字大小</span>
                </div>
                <div className="st-slider-wrap">
                  <div className="st-slider-labels">
                    <span>小 A</span>
                    <span>A</span>
                    <span>大 A</span>
                  </div>
                  <input
                    type="range"
                    className="st-slider"
                    min={0}
                    max={2}
                    step={1}
                    value={fontSizeIdx}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (v === 0 || v === 1 || v === 2) setFontSizeIdx(v)
                    }}
                  />
                  <div className="st-slider-preview" style={{ fontSize: `${fontSize}px` }}>
                    预览效果：今天帮我分析一下这份财务报告，找出关键数据和异常趋势。
                  </div>
                </div>
              </div>

              <div className="st-blk">
                <div className="st-blk-hd">
                  <span className="st-blk-title">消息密度</span>
                  <span className="st-blk-sub">控制消息之间的间距</span>
                </div>
                <div className="st-radio-grp">
                  {(
                    [
                      { key: 'compact', label: '紧凑' },
                      { key: 'standard', label: '标准' },
                      { key: 'loose', label: '宽松' },
                    ] as Array<{ key: Density; label: string }>
                  ).map(({ key, label }) => (
                    <button
                      key={key}
                      className={`st-radio-btn ${density === key ? 'sel' : ''}`}
                      onClick={() => setDensity(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* ────────── 通知设置 ────────── */}
            <section className={`st-sec ${section === 'notifications' ? 'active' : ''}`}>
              <div className="st-sec-hd">
                <h2 className="st-sec-title">通知设置</h2>
                <p className="st-sec-sub">管理元AI 向你发送通知的方式</p>
              </div>

              <div className="st-blk">
                <div className="st-blk-hd">
                  <span className="st-blk-title">推送通知</span>
                </div>
                <div className="st-row">
                  <div className="st-row-l">
                    <span className="st-row-label">浏览器通知</span>
                    <span className="st-row-desc">允许在桌面收到 AI 回复提醒</span>
                  </div>
                  <button
                    className={`st-toggle ${notifBrowser ? 'on' : ''}`}
                    onClick={() => {
                      setNotifBrowser((v) => !v)
                      showToast(notifBrowser ? '浏览器通知已关闭' : '浏览器通知已开启', 'ok')
                    }}
                  />
                </div>
                <div className="st-row">
                  <div className="st-row-l">
                    <span className="st-row-label">声音提示</span>
                    <span className="st-row-desc">收到回复时播放提示音</span>
                  </div>
                  <button
                    className={`st-toggle ${notifSound ? 'on' : ''}`}
                    onClick={() => setNotifSound((v) => !v)}
                  />
                </div>
              </div>

              <div className="st-blk">
                <div className="st-blk-hd">
                  <span className="st-blk-title">消息通知</span>
                </div>
                <div className="st-row">
                  <div className="st-row-l">
                    <span className="st-row-label">AI 回复提醒</span>
                    <span className="st-row-desc">长任务完成后发送通知</span>
                  </div>
                  <button
                    className={`st-toggle ${notifAI ? 'on' : ''}`}
                    onClick={() => setNotifAI((v) => !v)}
                  />
                </div>
                <div className="st-row">
                  <div className="st-row-l">
                    <span className="st-row-label">新功能公告</span>
                    <span className="st-row-desc">重大功能上线时提醒</span>
                  </div>
                  <button
                    className={`st-toggle ${notifFeature ? 'on' : ''}`}
                    onClick={() => setNotifFeature((v) => !v)}
                  />
                </div>
                <div className="st-row">
                  <div className="st-row-l">
                    <span className="st-row-label">系统维护提醒</span>
                    <span className="st-row-desc">计划维护前 24 小时通知</span>
                  </div>
                  <button
                    className={`st-toggle ${notifMaint ? 'on' : ''}`}
                    onClick={() => setNotifMaint((v) => !v)}
                  />
                </div>
              </div>

              <div className="st-blk">
                <div className="st-blk-hd">
                  <span className="st-blk-title">邮件通知</span>
                </div>
                <div className="st-row">
                  <div className="st-row-l">
                    <span className="st-row-label">每周使用摘要</span>
                    <span className="st-row-desc">每周一发送本周使用报告</span>
                  </div>
                  <button
                    className={`st-toggle ${notifWeekly ? 'on' : ''}`}
                    onClick={() => setNotifWeekly((v) => !v)}
                  />
                </div>
                <div className="st-row">
                  <div className="st-row-l">
                    <span className="st-row-label">产品更新通知</span>
                    <span className="st-row-desc">新版本发布时邮件告知</span>
                  </div>
                  <button
                    className={`st-toggle ${notifUpdate ? 'on' : ''}`}
                    onClick={() => setNotifUpdate((v) => !v)}
                  />
                </div>
                <div className="st-row">
                  <div className="st-row-l">
                    <span className="st-row-label">安全警报</span>
                    <span className="st-row-desc">账号异常登录时立即通知</span>
                  </div>
                  <button
                    className={`st-toggle ${notifSecurity ? 'on' : ''}`}
                    onClick={() => setNotifSecurity((v) => !v)}
                  />
                </div>
              </div>
            </section>

            {/* ────────── 语言与地区 ────────── */}
            <section className={`st-sec ${section === 'language' ? 'active' : ''}`}>
              <div className="st-sec-hd">
                <h2 className="st-sec-title">语言与地区</h2>
                <p className="st-sec-sub">设置界面语言、时区和时间格式</p>
              </div>

              <div className="st-blk">
                <div className="st-blk-hd">
                  <span className="st-blk-title">界面语言</span>
                </div>
                <div className="st-row">
                  <div className="st-row-l">
                    <span className="st-row-label">显示语言</span>
                  </div>
                  <div className="st-row-r">
                    <select
                      className="st-select"
                      onChange={() => showToast('语言已切换，刷新后生效', 'ok')}
                    >
                      <option>简体中文</option>
                      <option>繁體中文</option>
                      <option>English</option>
                      <option>日本語</option>
                      <option>한국어</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="st-blk">
                <div className="st-blk-hd">
                  <span className="st-blk-title">地区与时区</span>
                </div>
                <div className="st-row">
                  <div className="st-row-l">
                    <span className="st-row-label">地区</span>
                  </div>
                  <div className="st-row-r">
                    <select className="st-select">
                      <option>中国大陆</option>
                      <option>港澳台地区</option>
                      <option>日本</option>
                      <option>美国</option>
                      <option>其他</option>
                    </select>
                  </div>
                </div>
                <div className="st-row">
                  <div className="st-row-l">
                    <span className="st-row-label">时区</span>
                  </div>
                  <div className="st-row-r">
                    <select className="st-select">
                      <option>UTC+8 亚洲/上海</option>
                      <option>UTC+9 亚洲/东京</option>
                      <option>UTC+0 格林威治</option>
                      <option>UTC-5 美国东部</option>
                      <option>UTC-8 美国西部</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="st-blk">
                <div className="st-blk-hd">
                  <span className="st-blk-title">时间与日期格式</span>
                </div>
                <div className="st-row">
                  <span className="st-row-label" style={{ flexShrink: 0, width: '60px' }}>
                    时间制
                  </span>
                  <div className="st-radio-grp" style={{ padding: 0, flex: 1 }}>
                    <button
                      className={`st-radio-btn ${timeFmt === '24h' ? 'sel' : ''}`}
                      onClick={() => setTimeFmt('24h')}
                    >
                      24 小时制
                    </button>
                    <button
                      className={`st-radio-btn ${timeFmt === '12h' ? 'sel' : ''}`}
                      onClick={() => setTimeFmt('12h')}
                    >
                      12 小时制
                    </button>
                  </div>
                </div>
                <div className="st-row">
                  <span className="st-row-label" style={{ flexShrink: 0, width: '60px' }}>
                    日期格式
                  </span>
                  <div className="st-radio-grp" style={{ padding: 0, flex: 1 }}>
                    <button
                      className={`st-radio-btn ${dateFmt === 'ymd' ? 'sel' : ''}`}
                      onClick={() => setDateFmt('ymd')}
                    >
                      2026/06/28
                    </button>
                    <button
                      className={`st-radio-btn ${dateFmt === 'mdy' ? 'sel' : ''}`}
                      onClick={() => setDateFmt('mdy')}
                    >
                      06/28/2026
                    </button>
                    <button
                      className={`st-radio-btn ${dateFmt === 'dmy' ? 'sel' : ''}`}
                      onClick={() => setDateFmt('dmy')}
                    >
                      28/06/2026
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* ────────── 关于与帮助 ────────── */}
            <section className={`st-sec ${section === 'about' ? 'active' : ''}`}>
              <div className="st-about-brand">
                <div className="st-about-logo">元</div>
                <div className="st-about-name">元AI</div>
                <div className="st-about-ver">v1.0.0（构建 2026.06.28）</div>
              </div>

              <div className="st-blk">
                <div className="st-blk-hd">
                  <span className="st-blk-title">帮助与文档</span>
                </div>
                {[
                  { label: '使用说明', desc: '新手入门指南' },
                  { label: '更新日志', desc: '查看最新功能与修复' },
                  { label: '服务协议', desc: '查看完整用户协议' },
                  { label: '隐私政策', desc: '了解数据处理方式' },
                  { label: '问题反馈', desc: '提交 Bug 或功能建议' },
                ].map(({ label, desc }) => (
                  <div key={label} className="st-link-row">
                    <div>
                      <div className="st-link-name">{label}</div>
                      <div className="st-link-desc">{desc}</div>
                    </div>
                    <ExternalLink size={13} color="var(--fg3)" />
                  </div>
                ))}
              </div>

              <div className="st-about-credit">
                由 Anthropic Claude · OpenAI · DeepSeek 提供 AI 能力
                <br />© 2026 元AI. All rights reserved.
              </div>
            </section>
          </div>
          {/* end .st-content */}
        </div>
        {/* end .st-modal */}
      </div>
      {/* end .st-overlay */}

      {/* ── Sub-modal: Change Email ── */}
      {subModal === 'change-email' && (
        <div className="st-sub-ov" onClick={() => setSubModal(null)}>
          <div className="st-sub-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-sub-hd">
              <span className="st-sub-title">更换邮箱</span>
              <button className="st-close-btn" onClick={() => setSubModal(null)}>
                <X size={15} />
              </button>
            </div>
            <div className="st-sub-body">
              <div className="st-field">
                <label className="st-field-label">新邮箱地址</label>
                <input
                  className="st-field-inp"
                  type="email"
                  placeholder="your@email.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </div>
              <div className="st-field">
                <label className="st-field-label">验证码</label>
                <div className="st-field-row">
                  <input
                    className="st-field-inp"
                    type="text"
                    placeholder="输入 6 位验证码"
                    value={emailCode}
                    onChange={(e) => setEmailCode(e.target.value)}
                    maxLength={6}
                  />
                  <button
                    className="st-btn st-btn-ghost"
                    style={{ flexShrink: 0, height: '44px', fontSize: '12px' }}
                    disabled={emailCd > 0}
                    onClick={sendCode}
                  >
                    {emailCd > 0 ? `重发 (${emailCd}s)` : '发送验证码'}
                  </button>
                </div>
              </div>
            </div>
            <div className="st-sub-ft">
              <button className="st-btn st-btn-ghost" onClick={() => setSubModal(null)}>
                取消
              </button>
              <button className="st-btn st-btn-primary" onClick={submitEmail}>
                确认更换
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sub-modal: Change Password ── */}
      {subModal === 'change-pw' && (
        <div className="st-sub-ov" onClick={() => setSubModal(null)}>
          <div className="st-sub-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-sub-hd">
              <span className="st-sub-title">修改密码</span>
              <button className="st-close-btn" onClick={() => setSubModal(null)}>
                <X size={15} />
              </button>
            </div>
            <div className="st-sub-body">
              <div className="st-field">
                <label className="st-field-label">当前密码</label>
                <div className="st-inp-wrap">
                  <input
                    className="st-field-inp pw"
                    type={showOldPw ? 'text' : 'password'}
                    placeholder="请输入当前密码"
                    value={oldPw}
                    onChange={(e) => setOldPw(e.target.value)}
                  />
                  <button className="st-inp-eye" onClick={() => setShowOldPw((v) => !v)}>
                    {showOldPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <div className="st-field">
                <label className="st-field-label">新密码</label>
                <div className="st-inp-wrap">
                  <input
                    className="st-field-inp pw"
                    type={showNewPw ? 'text' : 'password'}
                    placeholder="至少 8 位，含大小写和数字"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                  />
                  <button className="st-inp-eye" onClick={() => setShowNewPw((v) => !v)}>
                    {showNewPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {newPw && (
                  <>
                    <div className="st-str-bar">
                      {[0, 1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className="st-str-seg"
                          style={{ background: i < str.score ? str.color : undefined }}
                        />
                      ))}
                    </div>
                    <p className="st-str-lbl" style={{ color: str.color }}>
                      {str.label}
                    </p>
                  </>
                )}
              </div>
              <div className="st-field">
                <label className="st-field-label">确认新密码</label>
                <div className="st-inp-wrap">
                  <input
                    className="st-field-inp pw"
                    type={showConfPw ? 'text' : 'password'}
                    placeholder="再次输入新密码"
                    value={confPw}
                    onChange={(e) => setConfPw(e.target.value)}
                  />
                  <button className="st-inp-eye" onClick={() => setShowConfPw((v) => !v)}>
                    {showConfPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </div>
            <div className="st-sub-ft">
              <button
                className="st-btn st-btn-ghost"
                onClick={() => {
                  setSubModal(null)
                  setOldPw('')
                  setNewPw('')
                  setConfPw('')
                  setShowOldPw(false)
                  setShowNewPw(false)
                  setShowConfPw(false)
                }}
              >
                取消
              </button>
              <button className="st-btn st-btn-primary" onClick={savePw}>
                保存修改
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sub-modal: Unlink WeChat ── */}
      {subModal === 'unlink-wechat' && (
        <div className="st-sub-ov" onClick={() => setSubModal(null)}>
          <div className="st-sub-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-sub-hd">
              <span className="st-sub-title">解除微信关联</span>
              <button className="st-close-btn" onClick={() => setSubModal(null)}>
                <X size={15} />
              </button>
            </div>
            <div className="st-sub-body">
              <p style={{ fontSize: '14px', color: 'var(--fg2)', lineHeight: '1.7' }}>
                解除后将无法通过微信直接登录元AI。请确认已设置邮箱密码，否则可能无法登录。
              </p>
            </div>
            <div className="st-sub-ft">
              <button className="st-btn st-btn-ghost" onClick={() => setSubModal(null)}>
                取消
              </button>
              <button
                className="st-btn-danger"
                onClick={() => {
                  setSubModal(null)
                  showToast('微信关联已解除', 'ok')
                }}
              >
                确认解除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sub-modal: Delete Account ── */}
      {subModal === 'delete-account' && (
        <div className="st-sub-ov" onClick={() => setSubModal(null)}>
          <div className="st-sub-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-sub-hd">
              <span className="st-sub-title" style={{ color: '#ef4444' }}>
                注销账号
              </span>
              <button className="st-close-btn" onClick={() => setSubModal(null)}>
                <X size={15} />
              </button>
            </div>
            <div className="st-sub-body">
              <p
                style={{
                  fontSize: '14px',
                  color: 'var(--fg2)',
                  lineHeight: '1.7',
                  marginBottom: '16px',
                }}
              >
                此操作将永久删除你的账号和所有对话记录，
                <strong style={{ color: '#ef4444' }}>不可恢复</strong>。是否确认注销？
              </p>
              <label className="st-field-label">
                请输入 <strong>删除账号</strong> 以确认
              </label>
              <input
                className="st-del-confirm"
                type="text"
                placeholder='请输入"删除账号"'
                value={delInput}
                onChange={(e) => setDelInput(e.target.value)}
              />
            </div>
            <div className="st-sub-ft">
              <button
                className="st-btn st-btn-ghost"
                onClick={() => {
                  setSubModal(null)
                  setDelInput('')
                }}
              >
                取消
              </button>
              <button
                className="st-btn-danger"
                disabled={delInput !== '删除账号'}
                onClick={doDelete}
              >
                确认注销
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toasts ── */}
      <div className="st-toast-wrap" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`st-toast ${t.type} show`}>
            {t.type === 'ok' ? <Check size={14} /> : <X size={14} />}
            {t.msg}
          </div>
        ))}
      </div>
    </>
  )
}
