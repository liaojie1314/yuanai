import { useEffect, useRef } from 'react'

import { useMyPreferences, useUpdateMyPreferences, usePrefsStore } from '@yuanai/core'
import type { Density, FontSize, ThemeChoice, UserPreferences } from '@yuanai/core'

import { SettingsGroup, SettingsSegmentRow } from '@/components/settings/SettingsRows'
import { SettingsShell } from '@/components/settings/SettingsShell'

/**
 * 外观屏：主题 / 字号 / 密度。
 * 本地 store 立即生效；变更同时防抖同步到后端 preferences（多端漫游）。
 */
export default function AppearanceScreen(): React.JSX.Element {
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
    <SettingsShell title="外观">
      <SettingsGroup label="主题">
        <SettingsSegmentRow
          label="外观模式"
          options={[
            { value: 'auto', label: '跟随系统' },
            { value: 'light', label: '浅色' },
            { value: 'dark', label: '深色' },
          ]}
          selected={theme}
          divider={false}
          onSelect={(v) => {
            setTheme(v as ThemeChoice)
            pushToServer({ theme: v as ThemeChoice })
          }}
        />
      </SettingsGroup>

      <SettingsGroup label="显示">
        <SettingsSegmentRow
          label="字号"
          options={[
            { value: 'small', label: '小' },
            { value: 'medium', label: '标准' },
            { value: 'large', label: '大' },
          ]}
          selected={fontSize}
          onSelect={(v) => {
            setFontSize(v as FontSize)
            pushToServer({ fontSize: v as FontSize })
          }}
        />
        <SettingsSegmentRow
          label="密度"
          options={[
            { value: 'compact', label: '紧凑' },
            { value: 'standard', label: '标准' },
            { value: 'loose', label: '宽松' },
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
