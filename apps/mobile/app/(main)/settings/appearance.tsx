import { useEffect, useRef } from 'react'

import { useMyPreferences, useUpdateMyPreferences, usePrefsStore } from '@yuanai/core'
import type { Density, FontSize, ThemeChoice, UserPreferences } from '@yuanai/core'

import { useTranslation } from 'react-i18next'

import { SettingsGroup, SettingsSegmentRow } from '@/components/settings/SettingsRows'
import { SettingsShell } from '@/components/settings/SettingsShell'

/**
 * 外观屏：主题 / 字号 / 密度。
 * 本地 store 立即生效；变更同时防抖同步到后端 preferences（多端漫游）。
 */
export default function AppearanceScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const theme = usePrefsStore((s) => s.theme)
  const fontSize = usePrefsStore((s) => s.fontSize)
  const density = usePrefsStore((s) => s.density)
  const setTheme = usePrefsStore((s) => s.setTheme)
  const setFontSize = usePrefsStore((s) => s.setFontSize)
  const setDensity = usePrefsStore((s) => s.setDensity)

  const { data: serverPrefs } = useMyPreferences()
  const updatePrefs = useUpdateMyPreferences()

  // 首次拉到后端偏好时同步到本地（之后本地即权威）
  const syncedRef = useRef(false)
  useEffect(() => {
    if (!serverPrefs || syncedRef.current) return
    syncedRef.current = true
    usePrefsStore.getState().replaceAll({
      theme: serverPrefs.theme as ThemeChoice,
      fontSize: serverPrefs.fontSize as FontSize,
      density: serverPrefs.density as Density,
    })
  }, [serverPrefs])

  const pushToServer = (patch: Partial<UserPreferences>): void => {
    updatePrefs.mutate(patch, {
      onError: () => {
        /* 后端同步失败不打断本地体验，下次进入会重试 */
      },
    })
  }

  return (
    <SettingsShell title={t('settings.appearance')}>
      <SettingsGroup label={t('settings.themeGroup')}>
        <SettingsSegmentRow
          label={t('settings.themeMode')}
          options={[
            { value: 'auto', label: t('settings.themeAuto') },
            { value: 'light', label: t('settings.themeLight') },
            { value: 'dark', label: t('settings.themeDark') },
          ]}
          selected={theme}
          divider={false}
          onSelect={(v) => {
            setTheme(v as ThemeChoice)
            pushToServer({ theme: v as ThemeChoice })
          }}
        />
      </SettingsGroup>

      <SettingsGroup label={t('settings.displayGroup')}>
        <SettingsSegmentRow
          label={t('settings.fontSize')}
          options={[
            { value: 'small', label: t('settings.fontSmall') },
            { value: 'medium', label: t('settings.fontMedium') },
            { value: 'large', label: t('settings.fontLarge') },
          ]}
          selected={fontSize}
          onSelect={(v) => {
            setFontSize(v as FontSize)
            pushToServer({ fontSize: v as FontSize })
          }}
        />
        <SettingsSegmentRow
          label={t('settings.density')}
          options={[
            { value: 'compact', label: t('settings.densityCompact') },
            { value: 'standard', label: t('settings.densityStandard') },
            { value: 'loose', label: t('settings.densityLoose') },
          ]}
          selected={density}
          divider={false}
          onSelect={(v) => {
            setDensity(v as Density)
            pushToServer({ density: v as Density })
          }}
        />
      </SettingsGroup>
    </SettingsShell>
  )
}
