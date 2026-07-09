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
  Loader2,
  MessageSquare,
  Zap,
  Paperclip,
  ExternalLink,
} from 'lucide-react'
import { useTranslations } from '@/i18n/client'
import { locales, localeNames, type Locale } from '@/i18n/config'
import { getLocaleFromCookie, setLocaleCookie } from '@/i18n/client'
import {
  useCurrentUser,
  useUpdateMe,
  useMyStats,
  useMyPreferences,
  useUpdateMyPreferences,
  useChangePassword,
  useChangeEmail,
  useSendVerifyCode,
  useDeleteMe,
  useClearAllConversations,
  useUploadAvatar,
  useUnlinkGithub,
  useUnlinkGoogle,
} from '@yuanai/core/hooks'
import { API_BASE_URL } from '@yuanai/core/api'
import { usePrefsStore } from '@yuanai/core/stores'
import type { FontSize, Density, ThemeChoice } from '@yuanai/core/stores'
import type { UserPreferences } from '@yuanai/core/api'
import { requestNotificationPermission } from '@/lib/notifications'

// ── Types ──────────────────────────────────────────────────────
type Section = 'profile' | 'security' | 'appearance' | 'notifications' | 'language' | 'about'
type SubModal =
  | 'change-email'
  | 'change-pw'
  | 'delete-account'
  | 'clear-conversations'
  | 'unlink-third'
  | null

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

const FONT_SIZE_PX: Record<FontSize, number> = { small: 12, medium: 16, large: 20 }
const FONT_SIZE_ORDER: FontSize[] = ['small', 'medium', 'large']

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

/**
 * 按用户 dateFmt / timeFmt 偏好格式化时间戳，用于展示密码上次修改时间等审计信息。
 * 无效或空输入返回空串。
 */
function formatDateTime(
  iso: string,
  dateFmt: 'ymd' | 'mdy' | 'dmy',
  timeFmt: '24h' | '12h'
): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const datePart =
    dateFmt === 'mdy'
      ? `${mm}/${dd}/${yyyy}`
      : dateFmt === 'dmy'
        ? `${dd}/${mm}/${yyyy}`
        : `${yyyy}/${mm}/${dd}`
  const hh24 = d.getHours()
  const mi = String(d.getMinutes()).padStart(2, '0')
  const timePart =
    timeFmt === '12h'
      ? `${String(((hh24 + 11) % 12) + 1).padStart(2, '0')}:${mi} ${hh24 >= 12 ? 'PM' : 'AM'}`
      : `${String(hh24).padStart(2, '0')}:${mi}`
  return `${datePart} ${timePart}`
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
  const { data: serverPrefs } = useMyPreferences()
  const updateMe = useUpdateMe()
  const changePasswordMutation = useChangePassword()
  const changeEmailMutation = useChangeEmail()
  const sendVerifyCodeMutation = useSendVerifyCode()
  const deleteMeMutation = useDeleteMe()
  const clearConvsMutation = useClearAllConversations()
  const updatePrefsMutation = useUpdateMyPreferences()
  const uploadAvatarMutation = useUploadAvatar()

  // Navigation
  const [section, setSection] = useState<Section>(initialSection)
  const [subModal, setSubModal] = useState<SubModal>(null)

  // Prefs store (本地立即生效 + 后端持久化)
  // 分别 subscribe 单个字段，避免整体订阅引起的死循环
  const theme = usePrefsStore((s) => s.theme)
  const fontSize = usePrefsStore((s) => s.fontSize)
  const density = usePrefsStore((s) => s.density)
  const timeFmt = usePrefsStore((s) => s.timeFmt)
  const dateFmt = usePrefsStore((s) => s.dateFmt)
  const setTheme = usePrefsStore((s) => s.setTheme)
  const setFontSize = usePrefsStore((s) => s.setFontSize)
  const setDensity = usePrefsStore((s) => s.setDensity)
  const setTimeFmt = usePrefsStore((s) => s.setTimeFmt)
  const setDateFmt = usePrefsStore((s) => s.setDateFmt)

  // Language
  const [currentLocale, setCurrentLocale] = useState<Locale>('zh-CN')

  // Notifications（localStorage 持久化）
  const loadNotifPref = (key: string, def: boolean): boolean => {
    if (typeof window === 'undefined') return def
    const v = localStorage.getItem(`notif_${key}`)
    return v === null ? def : v === 'true'
  }

  const [notifBrowser, setNotifBrowserRaw] = useState(() => loadNotifPref('browser', false))
  const [notifSound, setNotifSoundRaw] = useState(() => loadNotifPref('sound', false))
  const [notifAI, setNotifAIRaw] = useState(() => loadNotifPref('ai', true))

  const setNotifBrowser = (v: boolean | ((prev: boolean) => boolean)): void => {
    setNotifBrowserRaw((prev) => {
      const next = typeof v === 'function' ? v(prev) : v
      localStorage.setItem('notif_browser', String(next))
      if (next) {
        void requestNotificationPermission().then((perm) => {
          if (perm === 'denied') {
            showToast(t('notifications.permissionDenied'), 'err')
          } else if (perm === 'unsupported') {
            showToast(t('notifications.unsupported'), 'err')
          }
        })
      }
      return next
    })
  }
  const setNotifSound = (v: boolean | ((prev: boolean) => boolean)): void => {
    setNotifSoundRaw((prev) => {
      const next = typeof v === 'function' ? v(prev) : v
      localStorage.setItem('notif_sound', String(next))
      return next
    })
  }
  const setNotifAI = (v: boolean | ((prev: boolean) => boolean)): void => {
    setNotifAIRaw((prev) => {
      const next = typeof v === 'function' ? v(prev) : v
      localStorage.setItem('notif_ai', String(next))
      // 「AI 回复通知」是桌面弹窗的实际开关，打开时也要申请权限
      if (next) {
        void requestNotificationPermission().then((perm) => {
          if (perm === 'denied') {
            showToast(t('notifications.permissionDenied'), 'err')
          } else if (perm === 'unsupported') {
            showToast(t('notifications.unsupported'), 'err')
          }
        })
      }
      return next
    })
  }

  // 第三方登录待解绑目标
  const [unlinkTarget, setUnlinkTarget] = useState<'wechat' | 'google' | 'github' | null>(null)
  const unlinkGithubMutation = useUnlinkGithub()
  const unlinkGoogleMutation = useUnlinkGoogle()

  // Profile editing state
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
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok'): void => {
    const id = ++toastId.current
    // 最多同屏 3 条：新 toast 挤掉最早那条
    setToasts((prev) => {
      const next = [...prev, { id, msg, type }]
      return next.length > 3 ? next.slice(next.length - 3) : next
    })
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
    setCurrentLocale(getLocaleFromCookie())
  }, [open, initialSection])

  // 从后端拉到 preferences 时，首次同步到本地 store（之后本地即权威，避免覆盖用户改动）
  const syncedRef = useRef(false)
  useEffect(() => {
    if (!serverPrefs || syncedRef.current) return
    syncedRef.current = true
    usePrefsStore.getState().replaceAll({
      theme: serverPrefs.theme as ThemeChoice,
      fontSize: serverPrefs.fontSize as FontSize,
      density: serverPrefs.density as Density,
      timeFmt: serverPrefs.timeFormat,
      dateFmt: serverPrefs.dateFormat,
    })
  }, [serverPrefs])

  // 立即将 theme/fontSize/density 应用到 document
  useEffect(() => {
    const html = document.documentElement
    if (theme === 'dark') html.setAttribute('data-theme', 'dark')
    else if (theme === 'light') html.setAttribute('data-theme', 'light')
    else
      html.setAttribute(
        'data-theme',
        window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light'
      )
    localStorage.setItem('theme', theme)
    html.style.setProperty('--user-font-size', `${FONT_SIZE_PX[fontSize]}px`)
    html.setAttribute('data-density', density)
  }, [theme, fontSize, density])

  // Email countdown
  useEffect(() => {
    if (emailCd <= 0) return
    const timer = setTimeout(() => setEmailCd((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [emailCd])

  const persistPref = useCallback(
    (patch: Partial<UserPreferences>): void => {
      // 登录状态才需要写后端；未登录时仅本地生效
      if (currentUser) {
        updatePrefsMutation.mutate(patch)
      }
    },
    [currentUser, updatePrefsMutation]
  )

  const applyTheme = (choice: ThemeChoice): void => {
    setTheme(choice)
    persistPref({ theme: choice })
    showToast(t('toast.prefsSaved'))
  }

  const applyFontSize = (size: FontSize): void => {
    setFontSize(size)
    persistPref({ fontSize: size })
    showToast(t('toast.prefsSaved'))
  }

  const applyDensity = (d: Density): void => {
    setDensity(d)
    persistPref({ density: d })
    showToast(t('toast.prefsSaved'))
  }

  const applyTimeFmt = (fmt: '24h' | '12h'): void => {
    setTimeFmt(fmt)
    persistPref({ timeFormat: fmt })
  }

  const applyDateFmt = (fmt: 'ymd' | 'mdy' | 'dmy'): void => {
    setDateFmt(fmt)
    persistPref({ dateFormat: fmt })
  }

  const switchLocale = (locale: Locale): void => {
    setCurrentLocale(locale)
    setLocaleCookie(locale)
    persistPref({ language: locale })
    window.location.reload()
  }

  const sendCode = (): void => {
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      showToast('请输入有效的邮箱地址', 'err')
      return
    }
    sendVerifyCodeMutation.mutate(
      { email: newEmail, scene: 'change_email' },
      {
        onSuccess: () => {
          setEmailCd(60)
          showToast(t('dialogs.changeEmail.codeSent'))
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

  const submitEmail = (): void => {
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) || !emailCode) {
      showToast(tc('error'), 'err')
      return
    }
    changeEmailMutation.mutate(
      { newEmail, verifyCode: emailCode },
      {
        onSuccess: () => {
          setSubModal(null)
          setNewEmail('')
          setEmailCode('')
          showToast(t('toast.emailChanged'))
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

  const savePw = (): void => {
    if (!oldPw || !newPw || !confPw) {
      showToast(tc('error'), 'err')
      return
    }
    if (newPw !== confPw || newPw.length < 8) {
      showToast('两次密码不一致或长度不足 8 位', 'err')
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
        window.location.href = '/login'
      },
      onError: () => showToast(tc('error'), 'err'),
    })
  }

  const doClearConversations = (): void => {
    clearConvsMutation.mutate(undefined, {
      onSuccess: (data) => {
        setSubModal(null)
        showToast(t('toast.conversationsCleared', { count: data.deleted }))
        // 清空后跳到 /chat，避免用户停留在已被删除的会话页
        if (typeof window !== 'undefined' && window.location.pathname.startsWith('/chat/')) {
          window.location.href = '/chat'
        }
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
        onError: (err: unknown) => {
          const msg =
            (err as { response?: { data?: { detail?: { message?: string } } } })?.response?.data
              ?.detail?.message ?? tc('error')
          showToast(msg, 'err')
        },
      }
    )
    setEditingUsername(false)
  }

  const saveBio = (): void => {
    const trimmed = bioInput.trim()
    updateMe.mutate(
      { bio: trimmed },
      {
        onSuccess: () => showToast(t('toast.saved')),
        onError: () => showToast(tc('error'), 'err'),
      }
    )
    setEditingBio(false)
  }

  if (!open) return null

  const displayName = currentUser?.username ?? '—'
  const displayEmail = currentUser?.email
    ? currentUser.email.replace(/^(.{2})(.*)(@.+)$/, (_, a, _b, c) => `${a}**${c}`)
    : '—'
  const avatarLetter = displayName.charAt(0).toUpperCase()
  const bio = currentUser?.bio ?? ''

  const pwStrengthLabels = ['弱', '中', '强', '很强']
  const str = pwStrength(newPw, pwStrengthLabels)
  const fontSizeIdx = FONT_SIZE_ORDER.indexOf(fontSize)

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
                      <div
                        className="st-avatar-wrap"
                        title="点击上传头像"
                        style={{ cursor: 'pointer' }}
                        onClick={() => avatarInputRef.current?.click()}
                      >
                        {currentUser?.avatarUrl ? (
                          <img
                            src={currentUser.avatarUrl}
                            alt="头像"
                            style={{
                              width: '100%',
                              height: '100%',
                              borderRadius: '50%',
                              objectFit: 'cover',
                            }}
                          />
                        ) : (
                          <div className="st-avatar-circle">{avatarLetter}</div>
                        )}
                        <div className="st-av-ov">
                          {uploadAvatarMutation.isPending ? (
                            <Loader2 size={14} className="ch-spin" />
                          ) : (
                            <Pencil size={14} />
                          )}
                        </div>
                      </div>
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          uploadAvatarMutation.mutate(file, {
                            onSuccess: () => showToast('头像已更新'),
                            onError: () => showToast('头像上传失败', 'err'),
                          })
                          e.target.value = ''
                        }}
                      />
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
                            maxLength={200}
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
                  <div className="st-row">
                    <div className="st-row-l">
                      <span className="st-row-label">{t('security.lastChanged')}</span>
                    </div>
                    <div className="st-row-r">
                      <span className="st-row-muted">
                        {currentUser?.passwordChangedAt
                          ? formatDateTime(currentUser.passwordChangedAt, dateFmt, timeFmt)
                          : t('security.lastChangedNever')}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="st-blk">
                  <div className="st-blk-hd">
                    <span className="st-blk-title">{t('security.thirdPartyLogin')}</span>
                  </div>
                  {[
                    {
                      key: 'github' as const,
                      label: 'GitHub',
                      cls: 'st-sl-github',
                      icon: '/icons/github.svg',
                      linked: !!currentUser?.githubId,
                      available: true,
                    },
                    {
                      key: 'google' as const,
                      label: 'Google',
                      cls: 'st-sl-google',
                      icon: '/icons/google.svg',
                      linked: !!currentUser?.googleId,
                      available: true,
                    },
                    {
                      key: 'wechat' as const,
                      label: '微信',
                      cls: 'st-sl-wechat',
                      icon: '/icons/wechat.svg',
                      linked: false,
                      available: false,
                    },
                  ].map(({ key, label, cls, icon, linked, available }) => (
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
                            onClick={() => {
                              setUnlinkTarget(key)
                              setSubModal('unlink-third')
                            }}
                          >
                            解绑
                          </button>
                        ) : available ? (
                          <button
                            className="st-btn-link"
                            onClick={() => {
                              // 直接走后端 authorize；成功后 302 回 /oauth/callback 写入新的
                              // access_token（含更新后的 github_id），下一次 useCurrentUser 刷新
                              // 就能拿到 linked 状态
                              window.location.href = `${API_BASE_URL}/auth/${key}`
                            }}
                          >
                            绑定
                          </button>
                        ) : (
                          <button
                            className="st-btn-link"
                            disabled
                            title="第三方登录即将开放"
                            style={{ opacity: 0.5, cursor: 'not-allowed' }}
                          >
                            绑定
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
                      <span className="st-row-label">{t('security.clearConversations')}</span>
                      <p className="st-row-desc">{t('security.clearConversationsDesc')}</p>
                    </div>
                    <button
                      className="st-btn-danger"
                      onClick={() => setSubModal('clear-conversations')}
                      disabled={clearConvsMutation.isPending}
                    >
                      {t('data.clearButton')}
                    </button>
                  </div>
                  <div className="st-row">
                    <div className="st-row-l">
                      <span className="st-row-label">{t('security.deleteAccount')}</span>
                      <p className="st-row-desc">{t('security.deleteAccountDesc')}</p>
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
                        className={`st-theme-card ${theme === key ? 'sel' : ''}`}
                        onClick={() => applyTheme(key)}
                      >
                        <div className={`st-tp ${cls}`} />
                        <div className="st-tp-detail">
                          <span className="st-tp-name">{label}</span>
                          {theme === key && <Check size={13} color="var(--brand)" />}
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
                        const picked = FONT_SIZE_ORDER[v]
                        if (picked) applyFontSize(picked)
                      }}
                    />
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
                        onClick={() => applyDensity(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
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
                      onClick={() => applyTimeFmt('24h')}
                    >
                      {t('language.time24h')}
                    </button>
                    <button
                      className={`st-radio-btn ${timeFmt === '12h' ? 'sel' : ''}`}
                      onClick={() => applyTimeFmt('12h')}
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
                      onClick={() => applyDateFmt('ymd')}
                    >
                      {t('language.dateYMD')}
                    </button>
                    <button
                      className={`st-radio-btn ${dateFmt === 'mdy' ? 'sel' : ''}`}
                      onClick={() => applyDateFmt('mdy')}
                    >
                      {t('language.dateMDY')}
                    </button>
                    <button
                      className={`st-radio-btn ${dateFmt === 'dmy' ? 'sel' : ''}`}
                      onClick={() => applyDateFmt('dmy')}
                    >
                      {t('language.dateDMY')}
                    </button>
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
                <div className="st-blk">
                  <div className="st-blk-hd">
                    <span className="st-blk-title">{t('notifications.webGroup')}</span>
                  </div>
                  {[
                    {
                      key: 'browser',
                      label: t('notifications.browser'),
                      desc: t('notifications.browserDesc'),
                      value: notifBrowser,
                      set: setNotifBrowser,
                    },
                    {
                      key: 'sound',
                      label: t('notifications.sound'),
                      desc: t('notifications.soundDesc'),
                      value: notifSound,
                      set: setNotifSound,
                    },
                    {
                      key: 'ai',
                      label: t('notifications.aiResponse'),
                      desc: t('notifications.aiResponseDesc'),
                      value: notifAI,
                      set: setNotifAI,
                    },
                  ].map(({ key, label, desc, value, set }) => (
                    <div className="st-row" key={key}>
                      <div className="st-row-l">
                        <span className="st-row-label">{label}</span>
                        <p className="st-row-desc">{desc}</p>
                      </div>
                      <button
                        className={`st-toggle ${value ? 'on' : ''}`}
                        onClick={() => set((v: boolean) => !v)}
                        role="switch"
                        aria-checked={value}
                        aria-label={label}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ────────── 关于与帮助 ────────── */}
            <section className={`st-sec ${section === 'about' ? 'active' : ''}`}>
              <div className="st-sec-hd">
                <h2 className="st-sec-title">{t('sections.about')}</h2>
              </div>
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
                    disabled={emailCd > 0 || sendVerifyCodeMutation.isPending}
                    onClick={sendCode}
                  >
                    {emailCd > 0
                      ? `${emailCd}s`
                      : sendVerifyCodeMutation.isPending
                        ? '发送中'
                        : t('dialogs.changeEmail.sendCode')}
                  </button>
                </div>
              </div>
            </div>
            <div className="st-sub-ft">
              <button className="st-btn st-btn-ghost" onClick={() => setSubModal(null)}>
                {tc('cancel')}
              </button>
              <button
                className="st-btn st-btn-primary"
                onClick={submitEmail}
                disabled={changeEmailMutation.isPending}
              >
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
              <button
                className="st-btn st-btn-primary"
                onClick={savePw}
                disabled={changePasswordMutation.isPending}
              >
                {tc('save')}
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
                disabled={
                  delInput !== t('dialogs.deleteAccount.confirmText') || deleteMeMutation.isPending
                }
                onClick={doDelete}
              >
                {tc('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sub-modal: Clear Conversations ── */}
      {subModal === 'clear-conversations' && (
        <div className="st-sub-ov" onClick={() => setSubModal(null)}>
          <div className="st-sub-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-sub-hd">
              <span className="st-sub-title" style={{ color: '#ef4444' }}>
                {t('dialogs.clearConversations.title')}
              </span>
              <button className="st-close-btn" onClick={() => setSubModal(null)}>
                <X size={15} />
              </button>
            </div>
            <div className="st-sub-body">
              <p style={{ fontSize: 14, color: 'var(--fg2)', lineHeight: 1.7 }}>
                {t('dialogs.clearConversations.warning')}
              </p>
            </div>
            <div className="st-sub-ft">
              <button className="st-btn st-btn-ghost" onClick={() => setSubModal(null)}>
                {tc('cancel')}
              </button>
              <button
                className="st-btn-danger"
                onClick={doClearConversations}
                disabled={clearConvsMutation.isPending}
              >
                {t('dialogs.clearConversations.confirmText')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sub-modal: 解绑三方登录 ── */}
      {subModal === 'unlink-third' && unlinkTarget && (
        <div
          className="st-sub-ov"
          onClick={() => {
            setSubModal(null)
            setUnlinkTarget(null)
          }}
        >
          <div className="st-sub-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-sub-hd">
              <span className="st-sub-title" style={{ color: '#ef4444' }}>
                解绑{' '}
                {unlinkTarget === 'github'
                  ? 'GitHub'
                  : unlinkTarget === 'google'
                    ? 'Google'
                    : '微信'}
              </span>
              <button
                className="st-close-btn"
                onClick={() => {
                  setSubModal(null)
                  setUnlinkTarget(null)
                }}
              >
                <X size={15} />
              </button>
            </div>
            <div className="st-sub-body">
              <p style={{ fontSize: 14, color: 'var(--fg2)', lineHeight: 1.7 }}>
                解绑后将无法使用{' '}
                {unlinkTarget === 'github'
                  ? 'GitHub'
                  : unlinkTarget === 'google'
                    ? 'Google'
                    : '微信'}{' '}
                快速登录， 下次可通过邮箱密码方式登录。若你尚未设置本地密码，请先前往「账号安全 →
                修改密码」补设， 否则解绑会被拒绝。
              </p>
            </div>
            <div className="st-sub-ft">
              <button
                className="st-btn st-btn-ghost"
                onClick={() => {
                  setSubModal(null)
                  setUnlinkTarget(null)
                }}
              >
                {tc('cancel')}
              </button>
              <button
                className="st-btn-danger"
                disabled={
                  unlinkGithubMutation.isPending ||
                  unlinkGoogleMutation.isPending ||
                  (unlinkTarget !== 'github' && unlinkTarget !== 'google')
                }
                onClick={async () => {
                  // 仅 github / google 有真实解绑链路；wechat 尚未落地
                  if (unlinkTarget !== 'github' && unlinkTarget !== 'google') return
                  const mutation =
                    unlinkTarget === 'github' ? unlinkGithubMutation : unlinkGoogleMutation
                  const label = unlinkTarget === 'github' ? 'GitHub' : 'Google'
                  try {
                    await mutation.mutateAsync()
                    showToast(`已解绑 ${label}`, 'ok')
                    setSubModal(null)
                    setUnlinkTarget(null)
                  } catch (err) {
                    const detail = (
                      err as {
                        response?: { data?: { detail?: { message?: string } } }
                      }
                    )?.response?.data?.detail
                    showToast(detail?.message ?? '解绑失败', 'err')
                  }
                }}
              >
                {unlinkGithubMutation.isPending || unlinkGoogleMutation.isPending
                  ? '解绑中…'
                  : '确认解绑'}
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
