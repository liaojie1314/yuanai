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
import { useTranslations } from '@/i18n/client'
import { locales, localeNames, type Locale } from '@/i18n/config'
import { getLocaleFromCookie, setLocaleCookie } from '@/i18n/client'
import {
  useCurrentUser,
  useUpdateMe,
  useMyStats,
  useChangePassword,
  useDeleteMe,
} from '@yuanai/core/hooks'

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

function pwStrength(pw: string, labels: string[]): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: '', color: 'var(--fg3)' }
  let s = 0
  if (pw.length >= 8) s++
  if (/[A-Z]/.test(pw)) s++
  if (/[0-9]/.test(pw)) s++
  if (/[^A-Za-z0-9]/.test(pw)) s++
  const colors: Record<number, string> = { 1: '#ef4444', 2: '#f59e0b', 3: '#3b82f6', 4: '#10b981' }
  return { score: s, label: labels[s - 1] ?? '', color: colors[s] ?? '#ef4444' }
}

// ── Component ──────────────────────────────────────────────────
export default function SettingsModal({
  open,
  onClose,
  initialSection = 'profile',
}: Props): JSX.Element | null {
  const t = useTranslations('settings')
  const tc = useTranslations('common')

  // Real API data
  const { data: currentUser } = useCurrentUser()
  const { data: stats } = useMyStats()
  const updateMe = useUpdateMe()
  const changePasswordMutation = useChangePassword()
  const deleteMeMutation = useDeleteMe()

  // Navigation
  const [section, setSection] = useState<Section>(initialSection)
  const [subModal, setSubModal] = useState<SubModal>(null)

  // Theme / appearance
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>('light')
  const [fontSizeIdx, setFontSizeIdx] = useState<0 | 1 | 2>(1)
  const [density, setDensity] = useState<Density>('standard')

  // Language
  const [currentLocale, setCurrentLocale] = useState<Locale>('zh-CN')
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

  // Profile editing state (bio is local-only until backend supports it)
  const [editingUsername, setEditingUsername] = useState(false)
  const [editingBio, setEditingBio] = useState(false)
  const [usernameInput, setUsernameInput] = useState('')
  const [bio, setBio] = useState('')
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
    setTimeout(() => setToasts((prev) => prev.filter((item) => item.id !== id)), 3000)
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

  // Sync state when modal opens
  useEffect(() => {
    if (!open) return
    setSection(initialSection)
    const saved = localStorage.getItem('theme')
    if (saved === 'auto' || saved === 'light' || saved === 'dark') setThemeChoice(saved)
    else setThemeChoice('light')
    setCurrentLocale(getLocaleFromCookie())
  }, [open, initialSection])

  // Email countdown
  useEffect(() => {
    if (emailCd <= 0) return
    const timer = setTimeout(() => setEmailCd((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [emailCd])

  const applyTheme = (choice: ThemeChoice): void => {
    setThemeChoice(choice)
    const html = document.documentElement
    if (choice === 'dark') html.setAttribute('data-theme', 'dark')
    else if (choice === 'light') html.setAttribute('data-theme', 'light')
    else
      html.setAttribute(
        'data-theme',
        window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light'
      )
    localStorage.setItem('theme', choice)
    showToast(tc('success'))
  }

  const switchLocale = (locale: Locale): void => {
    setCurrentLocale(locale)
    setLocaleCookie(locale)
    // Reload to apply the new locale from the server
    window.location.reload()
  }

  const sendCode = (): void => {
    if (!newEmail) {
      showToast(t('dialogs.changeEmail.codeSent'), 'err')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      showToast(tc('error'), 'err')
      return
    }
    setEmailCd(60)
    showToast(t('dialogs.changeEmail.codeSent'))
  }

  const submitEmail = (): void => {
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) || !emailCode) {
      showToast(tc('error'), 'err')
      return
    }
    // 更换邮箱需后端邮件验证服务支持，暂不开放
    showToast('更换邮箱功能暂未开放', 'err')
  }

  const savePw = (): void => {
    if (!oldPw || !newPw || !confPw) {
      showToast(tc('error'), 'err')
      return
    }
    if (newPw !== confPw || newPw.length < 8) {
      showToast(tc('error'), 'err')
      return
    }
    changePasswordMutation.mutate(
      { oldPassword: oldPw, newPassword: newPw },
      {
        onSuccess: () => {
          setSubModal(null)
          setOldPw('')
          setNewPw('')
          setConfPw('')
          setShowOldPw(false)
          setShowNewPw(false)
          setShowConfPw(false)
          showToast(t('toast.passwordChanged'))
        },
        onError: (err: unknown) => {
          const msg =
            (err as { response?: { data?: { detail?: { message?: string } } } })?.response?.data
              ?.detail?.message ?? tc('error')
          showToast(msg, 'err')
        },
      }
    )
  }

  const doDelete = (): void => {
    if (delInput !== t('dialogs.deleteAccount.confirmText')) return
    deleteMeMutation.mutate(undefined, {
      onSuccess: () => {
        setSubModal(null)
        setDelInput('')
        onClose()
        // useDeleteMe.onSuccess already calls clearAuth() + qc.clear()
        // redirect to login
        window.location.href = '/login'
      },
      onError: () => showToast(tc('error'), 'err'),
    })
  }

  const saveUsername = (): void => {
    const trimmed = usernameInput.trim()
    if (!trimmed) {
      setEditingUsername(false)
      return
    }
    updateMe.mutate(
      { username: trimmed },
      {
        onSuccess: () => showToast(t('toast.saved')),
        onError: () => showToast(tc('error'), 'err'),
      }
    )
    setEditingUsername(false)
  }

  const saveBio = (): void => {
    setBio(bioInput.trim())
    showToast(t('toast.saved'))
    setEditingBio(false)
  }

  if (!open) return null

  const displayName = currentUser?.username ?? '—'
  const displayEmail = currentUser?.email
    ? currentUser.email.replace(/^(.{2})(.*)(@.+)$/, (_, a, _b, c) => `${a}**${c}`)
    : '—'
  const avatarLetter = displayName.charAt(0).toUpperCase()

  const pwStrengthLabels = ['弱', '中', '强', '很强']
  const str = pwStrength(newPw, pwStrengthLabels)
  const fontSize = FONT_SIZES[fontSizeIdx]

  const navItems: Array<{ id: Section; label: string; icon: JSX.Element; group: string }> = [
    {
      id: 'profile',
      label: t('sections.profile'),
      icon: <User size={16} />,
      group: t('groups.personal'),
    },
    {
      id: 'security',
      label: t('sections.security'),
      icon: <Shield size={16} />,
      group: t('groups.personal'),
    },
    {
      id: 'appearance',
      label: t('sections.appearance'),
      icon: <Sun size={16} />,
      group: t('groups.system'),
    },
    {
      id: 'notifications',
      label: t('sections.notifications'),
      icon: <Bell size={16} />,
      group: t('groups.system'),
    },
    {
      id: 'language',
      label: t('sections.language'),
      icon: <Globe size={16} />,
      group: t('groups.system'),
    },
    {
      id: 'about',
      label: t('sections.about'),
      icon: <HelpCircle size={16} />,
      group: t('groups.support'),
    },
  ]
  const navGroups = [t('groups.personal'), t('groups.system'), t('groups.support')]

  return (
    <>
      {/* ── Settings overlay ── */}
      <div className="st-overlay" onClick={onClose}>
        <div
          className="st-modal"
          role="dialog"
          aria-modal="true"
          aria-label={t('title')}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Left nav ── */}
          <aside className="st-nav">
            <div className="st-nav-hd">
              <span className="st-nav-title">{t('title')}</span>
              <button className="st-close-btn" onClick={onClose} title={`${tc('close')} (ESC)`}>
                <X size={15} />
              </button>
            </div>
            <div className="st-nav-body">
              {navGroups.map((group) => (
                <div key={group}>
                  <span className="st-nav-gt">{group}</span>
                  {navItems
                    .filter((it) => it.group === group)
                    .map((it) => (
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
            <div className="st-nav-ft">{tc('appName')} v1.0.0</div>
          </aside>

          {/* ── Right content ── */}
          <div className="st-content">
            {/* ────────── 个人资料 ────────── */}
            <section className={`st-sec ${section === 'profile' ? 'active' : ''}`}>
              <div className="st-sec-hd">
                <h2 className="st-sec-title">{t('sections.profile')}</h2>
              </div>
              <div className="st-sec-body">
                <div className="st-blk">
                  <div className="st-blk-hd">
                    <span className="st-blk-title">{t('profile.avatar')}</span>
                  </div>
                  <div className="st-avatar-row">
                    <div className="st-avatar-area">
                      <div className="st-avatar-wrap">
                        <div className="st-avatar-circle">{avatarLetter}</div>
                        <div className="st-av-ov">
                          <Camera size={16} />
                          {t('profile.changeAvatar')}
                        </div>
                      </div>
                      <button className="st-btn-sm">
                        <Upload size={12} />
                        {t('profile.uploadAvatar')}
                      </button>
                    </div>
                    <div className="st-user-meta">
                      <div className="st-user-name">{displayName}</div>
                      <div className="st-user-email">{displayEmail}</div>
                      <span className="st-badge st-badge-free" style={{ marginTop: '4px' }}>
                        Free
                      </span>
                    </div>
                  </div>
                </div>

                <div className="st-blk">
                  <div className="st-blk-hd">
                    <span className="st-blk-title">{t('profile.username')}</span>
                  </div>
                  <div className="st-row">
                    <span className="st-row-label" style={{ flexShrink: 0, width: '80px' }}>
                      {t('profile.username')}
                    </span>
                    <div className="st-row-r" style={{ flex: 1, justifyContent: 'flex-end' }}>
                      {!editingUsername ? (
                        <div className="st-ie-view">
                          <span className="st-row-val">{displayName}</span>
                          <button
                            className="st-btn-icon"
                            onClick={() => {
                              setUsernameInput(currentUser?.username ?? '')
                              setEditingUsername(true)
                            }}
                            title={tc('edit')}
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
                            placeholder="2-20"
                            autoFocus
                          />
                          <button
                            className="st-btn st-btn-ghost"
                            style={{ height: '32px', padding: '0 10px', fontSize: '12px' }}
                            onClick={() => setEditingUsername(false)}
                          >
                            {tc('cancel')}
                          </button>
                          <button
                            className="st-btn st-btn-primary"
                            style={{ height: '32px', padding: '0 10px', fontSize: '12px' }}
                            onClick={saveUsername}
                          >
                            {tc('save')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="st-row">
                    <span className="st-row-label" style={{ flexShrink: 0, width: '80px' }}>
                      {t('profile.bio')}
                    </span>
                    <div className="st-row-r" style={{ flex: 1, justifyContent: 'flex-end' }}>
                      {!editingBio ? (
                        <div className="st-ie-view">
                          <span className={bio ? 'st-row-val' : 'st-row-muted'}>
                            {bio || t('profile.bioPlaceholder')}
                          </span>
                          <button
                            className="st-btn-icon"
                            onClick={() => {
                              setBioInput(bio)
                              setEditingBio(true)
                            }}
                            title={tc('edit')}
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
                            placeholder={t('profile.bioPlaceholder')}
                            autoFocus
                          />
                          <button
                            className="st-btn st-btn-ghost"
                            style={{ height: '32px', padding: '0 10px', fontSize: '12px' }}
                            onClick={() => setEditingBio(false)}
                          >
                            {tc('cancel')}
                          </button>
                          <button
                            className="st-btn st-btn-primary"
                            style={{ height: '32px', padding: '0 10px', fontSize: '12px' }}
                            onClick={saveBio}
                          >
                            {tc('save')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="st-blk">
                  <div className="st-blk-hd">
                    <span className="st-blk-title">使用统计</span>
                  </div>
                  <div className="st-stats-grid">
                    <div className="st-stat-it">
                      <MessageSquare size={18} color="var(--brand)" />
                      <span className="st-stat-val">{stats?.conversationCount ?? '—'}</span>
                      <span className="st-stat-label">次对话</span>
                    </div>
                    <div className="st-stat-it">
                      <Zap size={18} color="var(--brand)" />
                      <span className="st-stat-val">
                        {stats
                          ? stats.totalTokens >= 1000
                            ? `${(stats.totalTokens / 1000).toFixed(1)}k`
                            : String(stats.totalTokens)
                          : '—'}
                      </span>
                      <span className="st-stat-label">Token</span>
                    </div>
                    <div className="st-stat-it">
                      <Paperclip size={18} color="var(--brand)" />
                      <span className="st-stat-val">{stats?.fileCount ?? '—'}</span>
                      <span className="st-stat-label">文件</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* ────────── 账号安全 ────────── */}
            <section className={`st-sec ${section === 'security' ? 'active' : ''}`}>
              <div className="st-sec-hd">
                <h2 className="st-sec-title">{t('sections.security')}</h2>
              </div>
              <div className="st-sec-body">
                <div className="st-blk">
                  <div className="st-blk-hd">
                    <span className="st-blk-title">{t('security.email')}</span>
                  </div>
                  <div className="st-row">
                    <div className="st-row-l">
                      <span className="st-row-label">{t('security.email')}</span>
                    </div>
                    <div className="st-row-r">
                      <span className="st-row-val">{displayEmail}</span>
                      <button className="st-btn-link" onClick={() => setSubModal('change-email')}>
                        {t('security.changeEmail')}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="st-blk">
                  <div className="st-blk-hd">
                    <span className="st-blk-title">{t('security.password')}</span>
                  </div>
                  <div className="st-row">
                    <div className="st-row-l">
                      <span className="st-row-label">{t('security.password')}</span>
                    </div>
                    <div className="st-row-r">
                      <span className="st-row-muted">••••••••</span>
                      <button className="st-btn-link" onClick={() => setSubModal('change-pw')}>
                        {t('security.changePassword')}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="st-blk">
                  <div className="st-blk-hd">
                    <span className="st-blk-title">{t('security.thirdPartyLogin')}</span>
                  </div>
                  {[
                    {
                      key: 'wechat',
                      label: '微信',
                      cls: 'st-sl-wechat',
                      icon: '/icons/wechat.svg',
                      linked: true,
                    },
                    {
                      key: 'google',
                      label: 'Google',
                      cls: 'st-sl-google',
                      icon: '/icons/google.svg',
                      linked: false,
                    },
                    {
                      key: 'github',
                      label: 'GitHub',
                      cls: 'st-sl-github',
                      icon: '/icons/github.svg',
                      linked: false,
                    },
                  ].map(({ key, label, cls, icon, linked }) => (
                    <div className="st-row" key={key}>
                      <div
                        className="st-row-r"
                        style={{ flex: 1, justifyContent: 'flex-start', gap: '10px' }}
                      >
                        <div className={`st-sl ${cls}`}>
                          <img src={icon} width={14} height={14} alt="" />
                        </div>
                        <span className="st-row-val">{label}</span>
                      </div>
                      <div className="st-row-r">
                        <span className={`st-badge ${linked ? 'st-badge-ok' : 'st-badge-muted'}`}>
                          {linked ? t('security.bound') : t('security.notBound')}
                        </span>
                        {linked ? (
                          <button
                            className="st-btn-err-link"
                            onClick={() => key === 'wechat' && setSubModal('unlink-wechat')}
                          >
                            {t('security.unbindWechat')}
                          </button>
                        ) : (
                          <button className="st-btn-link" onClick={() => showToast(tc('success'))}>
                            {t('security.bindWechat')}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="st-blk danger">
                  <div className="st-blk-hd">
                    <span className="st-blk-title" style={{ color: '#ef4444' }}>
                      {t('security.dangerousOps')}
                    </span>
                  </div>
                  <div className="st-row">
                    <div className="st-row-l">
                      <span className="st-row-label">{t('security.deleteAccount')}</span>
                    </div>
                    <button className="st-btn-danger" onClick={() => setSubModal('delete-account')}>
                      {t('security.deleteAccount')}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* ────────── 外观与主题 ────────── */}
            <section className={`st-sec ${section === 'appearance' ? 'active' : ''}`}>
              <div className="st-sec-hd">
                <h2 className="st-sec-title">{t('sections.appearance')}</h2>
              </div>
              <div className="st-sec-body">
                <div className="st-blk">
                  <div className="st-blk-hd">
                    <span className="st-blk-title">{t('appearance.theme')}</span>
                  </div>
                  <div className="st-theme-cards">
                    {(
                      [
                        { key: 'auto', label: t('appearance.themeAuto'), cls: 'st-tp-auto' },
                        { key: 'light', label: t('appearance.themeLight'), cls: 'st-tp-light' },
                        { key: 'dark', label: t('appearance.themeDark'), cls: 'st-tp-dark' },
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
                    <span className="st-blk-title">{t('appearance.fontSize')}</span>
                  </div>
                  <div className="st-slider-wrap">
                    <div className="st-slider-labels">
                      <span>{t('appearance.fontSmall')}</span>
                      <span>{t('appearance.fontMedium')}</span>
                      <span>{t('appearance.fontLarge')}</span>
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
                      {tc('appName')}
                    </div>
                  </div>
                </div>

                <div className="st-blk">
                  <div className="st-blk-hd">
                    <span className="st-blk-title">{t('appearance.density')}</span>
                  </div>
                  <div className="st-radio-grp">
                    {(
                      [
                        { key: 'compact', label: t('appearance.densityCompact') },
                        { key: 'standard', label: t('appearance.densityStandard') },
                        { key: 'loose', label: t('appearance.densityLoose') },
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
              </div>
            </section>

            {/* ────────── 通知设置 ────────── */}
            <section className={`st-sec ${section === 'notifications' ? 'active' : ''}`}>
              <div className="st-sec-hd">
                <h2 className="st-sec-title">{t('sections.notifications')}</h2>
              </div>
              <div className="st-sec-body">
                {[
                  {
                    key: 'browser',
                    label: t('notifications.browser'),
                    value: notifBrowser,
                    set: setNotifBrowser,
                  },
                  {
                    key: 'sound',
                    label: t('notifications.sound'),
                    value: notifSound,
                    set: setNotifSound,
                  },
                  {
                    key: 'ai',
                    label: t('notifications.aiResponse'),
                    value: notifAI,
                    set: setNotifAI,
                  },
                  {
                    key: 'feature',
                    label: t('notifications.newFeatures'),
                    value: notifFeature,
                    set: setNotifFeature,
                  },
                  {
                    key: 'maint',
                    label: t('notifications.maintenance'),
                    value: notifMaint,
                    set: setNotifMaint,
                  },
                  {
                    key: 'weekly',
                    label: t('notifications.weeklyReport'),
                    value: notifWeekly,
                    set: setNotifWeekly,
                  },
                  {
                    key: 'update',
                    label: t('notifications.updates'),
                    value: notifUpdate,
                    set: setNotifUpdate,
                  },
                  {
                    key: 'security',
                    label: t('notifications.security'),
                    value: notifSecurity,
                    set: setNotifSecurity,
                  },
                ].map(({ key, label, value, set }) => (
                  <div className="st-blk" key={key} style={{ padding: '0' }}>
                    <div className="st-row">
                      <div className="st-row-l">
                        <span className="st-row-label">{label}</span>
                      </div>
                      <button
                        className={`st-toggle ${value ? 'on' : ''}`}
                        onClick={() => set((v) => !v)}
                        role="switch"
                        aria-checked={value}
                        aria-label={label}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* ────────── 语言与地区 ────────── */}
            <section className={`st-sec ${section === 'language' ? 'active' : ''}`}>
              <div className="st-sec-hd">
                <h2 className="st-sec-title">{t('sections.language')}</h2>
              </div>
              <div className="st-sec-body">
                <div className="st-blk">
                  <div className="st-blk-hd">
                    <span className="st-blk-title">{t('language.interface')}</span>
                  </div>
                  <div
                    className="st-lang-grid"
                    role="radiogroup"
                    aria-label={t('language.interface')}
                  >
                    {locales.map((locale) => (
                      <button
                        key={locale}
                        className={`st-lang-btn ${currentLocale === locale ? 'sel' : ''}`}
                        role="radio"
                        aria-checked={currentLocale === locale}
                        onClick={() => switchLocale(locale)}
                      >
                        {localeNames[locale]}
                        {currentLocale === locale && <Check size={13} color="var(--brand)" />}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="st-blk">
                  <div className="st-blk-hd">
                    <span className="st-blk-title">{t('language.timeFormat')}</span>
                  </div>
                  <div className="st-radio-grp">
                    <button
                      className={`st-radio-btn ${timeFmt === '24h' ? 'sel' : ''}`}
                      onClick={() => setTimeFmt('24h')}
                    >
                      {t('language.time24h')}
                    </button>
                    <button
                      className={`st-radio-btn ${timeFmt === '12h' ? 'sel' : ''}`}
                      onClick={() => setTimeFmt('12h')}
                    >
                      {t('language.time12h')}
                    </button>
                  </div>
                </div>

                <div className="st-blk">
                  <div className="st-blk-hd">
                    <span className="st-blk-title">{t('language.dateFormat')}</span>
                  </div>
                  <div className="st-radio-grp">
                    <button
                      className={`st-radio-btn ${dateFmt === 'ymd' ? 'sel' : ''}`}
                      onClick={() => setDateFmt('ymd')}
                    >
                      {t('language.dateYMD')}
                    </button>
                    <button
                      className={`st-radio-btn ${dateFmt === 'mdy' ? 'sel' : ''}`}
                      onClick={() => setDateFmt('mdy')}
                    >
                      {t('language.dateMDY')}
                    </button>
                    <button
                      className={`st-radio-btn ${dateFmt === 'dmy' ? 'sel' : ''}`}
                      onClick={() => setDateFmt('dmy')}
                    >
                      {t('language.dateDMY')}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* ────────── 关于与帮助 ────────── */}
            <section className={`st-sec ${section === 'about' ? 'active' : ''}`}>
              <div className="st-sec-body">
                <div className="st-about-brand">
                  <div className="st-about-logo">元</div>
                  <div className="st-about-name">{tc('appName')}</div>
                  <div className="st-about-ver">v1.0.0</div>
                </div>

                <div className="st-blk">
                  <div className="st-blk-hd">
                    <span className="st-blk-title">{t('about.documentation')}</span>
                  </div>
                  {[
                    { key: 'documentation', label: t('about.documentation') },
                    { key: 'changelog', label: t('about.changelog') },
                    { key: 'termsOfService', label: t('about.termsOfService') },
                    { key: 'privacyPolicy', label: t('about.privacyPolicy') },
                    { key: 'feedback', label: t('about.feedback') },
                  ].map(({ key, label }) => (
                    <div key={key} className="st-link-row">
                      <div>
                        <div className="st-link-name">{label}</div>
                      </div>
                      <ExternalLink size={13} color="var(--fg3)" />
                    </div>
                  ))}
                </div>

                <div className="st-about-credit">
                  Powered by Anthropic Claude · OpenAI · DeepSeek
                  <br />© 2026 {tc('appName')}. All rights reserved.
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* ── Sub-modal: Change Email ── */}
      {subModal === 'change-email' && (
        <div className="st-sub-ov" onClick={() => setSubModal(null)}>
          <div className="st-sub-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-sub-hd">
              <span className="st-sub-title">{t('dialogs.changeEmail.title')}</span>
              <button className="st-close-btn" onClick={() => setSubModal(null)}>
                <X size={15} />
              </button>
            </div>
            <div className="st-sub-body">
              <div className="st-field">
                <label className="st-field-label">{t('dialogs.changeEmail.newEmail')}</label>
                <input
                  className="st-field-inp"
                  type="email"
                  placeholder="your@email.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </div>
              <div className="st-field">
                <label className="st-field-label">{t('dialogs.changeEmail.code')}</label>
                <div className="st-field-row">
                  <input
                    className="st-field-inp"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={emailCode}
                    onChange={(e) => setEmailCode(e.target.value)}
                  />
                  <button
                    className="st-btn st-btn-ghost"
                    style={{ flexShrink: 0, height: '44px', fontSize: '12px' }}
                    disabled={emailCd > 0}
                    onClick={sendCode}
                  >
                    {emailCd > 0 ? `${emailCd}s` : t('dialogs.changeEmail.sendCode')}
                  </button>
                </div>
              </div>
            </div>
            <div className="st-sub-ft">
              <button className="st-btn st-btn-ghost" onClick={() => setSubModal(null)}>
                {tc('cancel')}
              </button>
              <button className="st-btn st-btn-primary" onClick={submitEmail}>
                {tc('confirm')}
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
              <span className="st-sub-title">{t('dialogs.changePassword.title')}</span>
              <button className="st-close-btn" onClick={() => setSubModal(null)}>
                <X size={15} />
              </button>
            </div>
            <div className="st-sub-body">
              {[
                {
                  label: t('dialogs.changePassword.oldPassword'),
                  val: oldPw,
                  setVal: setOldPw,
                  show: showOldPw,
                  setShow: setShowOldPw,
                },
                {
                  label: t('dialogs.changePassword.newPassword'),
                  val: newPw,
                  setVal: setNewPw,
                  show: showNewPw,
                  setShow: setShowNewPw,
                },
                {
                  label: t('dialogs.changePassword.confirmPassword'),
                  val: confPw,
                  setVal: setConfPw,
                  show: showConfPw,
                  setShow: setShowConfPw,
                },
              ].map(({ label, val, setVal, show, setShow }) => (
                <div className="st-field" key={label}>
                  <label className="st-field-label">{label}</label>
                  <div className="st-inp-wrap">
                    <input
                      className="st-field-inp pw"
                      type={show ? 'text' : 'password'}
                      value={val}
                      onChange={(e) => setVal(e.target.value)}
                    />
                    <button className="st-inp-eye" onClick={() => setShow((v) => !v)}>
                      {show ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              ))}
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
            <div className="st-sub-ft">
              <button
                className="st-btn st-btn-ghost"
                onClick={() => {
                  setSubModal(null)
                  setOldPw('')
                  setNewPw('')
                  setConfPw('')
                }}
              >
                {tc('cancel')}
              </button>
              <button className="st-btn st-btn-primary" onClick={savePw}>
                {tc('save')}
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
              <span className="st-sub-title">{t('dialogs.unbindWechat.title')}</span>
              <button className="st-close-btn" onClick={() => setSubModal(null)}>
                <X size={15} />
              </button>
            </div>
            <div className="st-sub-body">
              <p style={{ fontSize: '14px', color: 'var(--fg2)', lineHeight: '1.7' }}>
                {t('dialogs.unbindWechat.warning')}
              </p>
            </div>
            <div className="st-sub-ft">
              <button className="st-btn st-btn-ghost" onClick={() => setSubModal(null)}>
                {tc('cancel')}
              </button>
              <button
                className="st-btn-danger"
                onClick={() => {
                  setSubModal(null)
                  showToast(t('toast.wechatUnbound'))
                }}
              >
                {tc('confirm')}
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
                {t('dialogs.deleteAccount.title')}
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
                {t('dialogs.deleteAccount.warning')}
              </p>
              <label className="st-field-label">
                {t('dialogs.deleteAccount.confirmPrompt')}{' '}
                <strong>{t('dialogs.deleteAccount.confirmText')}</strong>
              </label>
              <input
                className="st-del-confirm"
                type="text"
                placeholder={t('dialogs.deleteAccount.placeholder')}
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
                {tc('cancel')}
              </button>
              <button
                className="st-btn-danger"
                disabled={delInput !== t('dialogs.deleteAccount.confirmText')}
                onClick={doDelete}
              >
                {tc('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toasts ── */}
      <div className="st-toast-wrap" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`st-toast ${toast.type} show`}>
            {toast.type === 'ok' ? <Check size={14} /> : <X size={14} />}
            {toast.msg}
          </div>
        ))}
      </div>
    </>
  )
}
