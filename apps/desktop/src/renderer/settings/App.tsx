import { useEffect, useState, type ReactElement } from 'react'

import type { UserPreferences } from '@yuanai/core/api'
import {
  useChangeEmail,
  useChangePassword,
  useClearAllConversations,
  useCurrentUser,
  useDeleteMe,
  useMyPreferences,
  useMyStats,
  useSendVerifyCode,
  useUnlinkGithub,
  useUnlinkGoogle,
  useUpdateMe,
  useUpdateMyPreferences,
  useUploadAvatar,
} from '@yuanai/core/hooks'
import { usePrefsStore } from '@yuanai/core/stores'

import type { DesktopAppInfo, DesktopPreferences } from '../../shared/ipc-contract'

import { AboutSection } from './components/AboutSection'
import { AppearanceSection } from './components/AppearanceSection'
import { DesktopSection } from './components/DesktopSection'
import { LanguageSection } from './components/LanguageSection'
import { NotificationSection } from './components/NotificationSection'
import { ProfileSection } from './components/ProfileSection'
import { SecuritySection } from './components/SecuritySection'
import { SettingsDialogs, type SettingsDialogMode } from './components/SettingsDialogs'
import { SettingsShell, type SettingsSectionId } from './components/SettingsShell'
import { applyRendererPreferences } from '../shared/appearance'

const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: 'auto',
  fontSize: 'medium',
  density: 'standard',
  timeFormat: '24h',
  dateFormat: 'ymd',
  language: 'zh-CN',
}

const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  closeToTray: true,
  globalShortcut: 'CommandOrControl+Alt+Y',
  autoLaunch: false,
  updateChannel: 'stable',
  checkUpdatesAutomatically: true,
  nativeNotifications: true,
  notificationSound: true,
  aiReplyNotifications: true,
}
function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** 提供七个已确认分区的桌面设置窗口。 */
export function App(): ReactElement {
  const [section, setSection] = useState<SettingsSectionId>('profile')
  const [dialog, setDialog] = useState<SettingsDialogMode | null>(null)
  const [desktopPreferences, setDesktopPreferences] = useState<DesktopPreferences>(
    DEFAULT_DESKTOP_PREFERENCES
  )
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_USER_PREFERENCES)
  const [appInfo, setAppInfo] = useState<DesktopAppInfo>()
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')
  const userQuery = useCurrentUser()
  const statsQuery = useMyStats()
  const preferenceQuery = useMyPreferences()
  const updateMe = useUpdateMe()
  const uploadAvatar = useUploadAvatar()
  const updatePreferences = useUpdateMyPreferences()
  const changeEmail = useChangeEmail()
  const changePassword = useChangePassword()
  const sendVerifyCode = useSendVerifyCode()
  const clearConversations = useClearAllConversations()
  const deleteMe = useDeleteMe()
  const unlinkGithub = useUnlinkGithub()
  const unlinkGoogle = useUnlinkGoogle()
  const setTheme = usePrefsStore((state) => state.setTheme)
  const setFontSize = usePrefsStore((state) => state.setFontSize)
  const setDensity = usePrefsStore((state) => state.setDensity)
  const setTimeFmt = usePrefsStore((state) => state.setTimeFmt)
  const setDateFmt = usePrefsStore((state) => state.setDateFmt)

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 3_000)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    if (!preferenceQuery.data) return
    setPreferences(preferenceQuery.data)
    applyRendererPreferences(preferenceQuery.data)
    setTheme(preferenceQuery.data.theme)
    setFontSize(preferenceQuery.data.fontSize)
    setDensity(preferenceQuery.data.density)
    setTimeFmt(preferenceQuery.data.timeFormat)
    setDateFmt(preferenceQuery.data.dateFormat)
  }, [preferenceQuery.data, setDateFmt, setDensity, setFontSize, setTheme, setTimeFmt])

  useEffect(() => {
    void window.yuanai.prefs
      .get()
      .then(setDesktopPreferences)
      .catch(() => setActionError('无法读取桌面设置'))
    void window.yuanai.system
      .getInfo()
      .then(setAppInfo)
      .catch(() => setActionError('无法读取应用信息'))
  }, [])

  async function saveProfile(values: { username: string; bio: string }): Promise<void> {
    setActionError('')
    await updateMe.mutateAsync(values)
    setNotice('资料已保存')
  }

  async function saveAvatar(file: File): Promise<void> {
    setActionError('')
    await uploadAvatar.mutateAsync(file)
    setNotice('头像已更新')
  }

  async function saveUserPreferences(patch: Partial<UserPreferences>): Promise<void> {
    const previous = preferences
    const next = { ...previous, ...patch }
    setActionError('')
    setPreferences(next)
    applyRendererPreferences(next)
    try {
      if (patch.theme) await window.yuanai.appearance.apply(patch.theme)
      const saved = await updatePreferences.mutateAsync(patch)
      setPreferences(saved)
      applyRendererPreferences(saved)
      setTheme(saved.theme)
      setFontSize(saved.fontSize)
      setDensity(saved.density)
      setTimeFmt(saved.timeFormat)
      setDateFmt(saved.dateFormat)
      void window.yuanai.appearance.syncPreferences(saved).catch(() => undefined)
      setNotice('偏好设置已保存')
    } catch (error: unknown) {
      setPreferences(previous)
      applyRendererPreferences(previous)
      if (patch.theme) void window.yuanai.appearance.apply(previous.theme).catch(() => undefined)
      setActionError(getErrorMessage(error, '偏好设置保存失败'))
      throw error
    }
  }

  async function saveDesktopPreferences(patch: Partial<DesktopPreferences>): Promise<void> {
    const previous = desktopPreferences
    setDesktopPreferences({ ...previous, ...patch })
    setActionError('')
    try {
      setDesktopPreferences(await window.yuanai.prefs.update(patch))
      setNotice('桌面设置已保存')
    } catch (error: unknown) {
      setDesktopPreferences(previous)
      setActionError(getErrorMessage(error, '桌面设置保存失败'))
      throw error
    }
  }

  function renderSection(): ReactElement {
    switch (section) {
      case 'profile':
        return (
          <ProfileSection
            user={userQuery.data}
            stats={statsQuery.data}
            isSaving={updateMe.isPending || uploadAvatar.isPending}
            onSave={saveProfile}
            onUploadAvatar={saveAvatar}
          />
        )
      case 'security':
        return <SecuritySection user={userQuery.data} onOpenDialog={setDialog} />
      case 'appearance':
        return (
          <AppearanceSection preferences={preferences} onPreferencesChanged={saveUserPreferences} />
        )
      case 'notifications':
        return (
          <NotificationSection
            preferences={desktopPreferences}
            onPreferencesChanged={saveDesktopPreferences}
          />
        )
      case 'language':
        return (
          <LanguageSection preferences={preferences} onPreferencesChanged={saveUserPreferences} />
        )
      case 'desktop':
        return (
          <DesktopSection
            preferences={desktopPreferences}
            onPreferencesChanged={saveDesktopPreferences}
            onAutoLaunchChanged={setDesktopPreferences}
            onShortcutApplied={(globalShortcut) =>
              setDesktopPreferences((current) => ({ ...current, globalShortcut }))
            }
          />
        )
      case 'about':
        return (
          <AboutSection
            appInfo={appInfo}
            onOpenExternal={(link) => window.yuanai.shell.openExternal(link)}
          />
        )
    }
  }

  return (
    <>
      <SettingsShell activeSection={section} onSectionChange={setSection}>
        {actionError ? (
          <p className="settings-alert" role="alert">
            {actionError}
          </p>
        ) : null}
        {notice ? (
          <p className="settings-notice" role="status">
            {notice}
          </p>
        ) : null}
        {renderSection()}
      </SettingsShell>
      <SettingsDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        onSendVerifyCode={async (email) => {
          await sendVerifyCode.mutateAsync({ email, scene: 'change_email' })
        }}
        onChangeEmail={async (values) => {
          await changeEmail.mutateAsync(values)
        }}
        onChangePassword={async (values) => {
          await changePassword.mutateAsync(values)
        }}
        onClearConversations={async () => {
          await clearConversations.mutateAsync()
        }}
        onDeleteAccount={async () => {
          await deleteMe.mutateAsync()
        }}
        onUnlinkGithub={async () => {
          await unlinkGithub.mutateAsync()
        }}
        onUnlinkGoogle={async () => {
          await unlinkGoogle.mutateAsync()
        }}
      />
    </>
  )
}
