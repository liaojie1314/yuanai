import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react-native'
import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { useMyPreferences, useUpdateMyPreferences, type UserPreferences } from '@yuanai/core'
import { usePrefsStore } from '@yuanai/core/stores'
import type { DateFmt, TimeFmt } from '@yuanai/core/stores'

import { SettingsGroup } from '@/components/settings/SettingsRows'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { changeAppLocale, i18n } from '@/i18n'
import type { AppLocale } from '@/i18n'
import { brand, radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

const LOCALES: { value: AppLocale; label: string; native: string }[] = [
  { value: 'zh-CN', label: '简体中文', native: '简体中文' },
  { value: 'en-US', label: 'English', native: 'English (US)' },
]

/**
 * 语言屏：界面语言（i18next + AsyncStorage）+ 时间/日期格式（prefs store + 后端漫游）。
 * 与 web SettingsModal 语言区块对齐：timeFormat 24h/12h、dateFormat ymd/mdy/dmy。
 */
export default function LanguageScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const theme = useTheme()
  const [current, setCurrent] = useState(i18n.language)

  const timeFmt = usePrefsStore((s) => s.timeFmt)
  const dateFmt = usePrefsStore((s) => s.dateFmt)
  const setTimeFmt = usePrefsStore((s) => s.setTimeFmt)
  const setDateFmt = usePrefsStore((s) => s.setDateFmt)

  const { data: serverPrefs } = useMyPreferences()
  const updatePrefs = useUpdateMyPreferences()

  // 首次拉到后端偏好时同步到本地（与外观页同一策略：之后本地即权威）
  const syncedRef = useRef(false)
  useEffect(() => {
    if (!serverPrefs || syncedRef.current) return
    syncedRef.current = true
    if (serverPrefs.timeFormat) setTimeFmt(serverPrefs.timeFormat as TimeFmt)
    if (serverPrefs.dateFormat) setDateFmt(serverPrefs.dateFormat as DateFmt)
  }, [serverPrefs, setTimeFmt, setDateFmt])

  const pushToServer = (patch: Partial<UserPreferences>): void => {
    updatePrefs.mutate(patch, {
      onError: () => {
        /* 后端同步失败不打断本地体验，下次进入会重试 */
      },
    })
  }

  const applyTimeFmt = (fmt: TimeFmt): void => {
    setTimeFmt(fmt)
    pushToServer({ timeFormat: fmt })
  }
  const applyDateFmt = (fmt: DateFmt): void => {
    setDateFmt(fmt)
    pushToServer({ dateFormat: fmt })
  }

  const onPick = (locale: AppLocale): void => {
    setCurrent(locale)
    void changeAppLocale(locale)
  }

  const chipStyle = (active: boolean): object[] => [
    styles.chip,
    {
      borderColor: active ? theme.brand.solid : theme.border.default,
      backgroundColor: active ? theme.brand.selected : theme.bg.base,
    },
  ]
  const chipTextStyle = (active: boolean): object => ({
    color: active ? theme.brand.selectedFg : theme.text.secondary,
    fontSize: 13,
    fontWeight: active ? ('600' as const) : ('400' as const),
  })

  return (
    <SettingsShell title={t('settings.language')}>
      <SettingsGroup>
        {LOCALES.map((l, i) => {
          const active = current === l.value
          return (
            <Pressable
              key={l.value}
              onPress={() => onPick(l.value)}
              android_ripple={{
                color: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
              }}
              style={[
                styles.row,
                i < LOCALES.length - 1 && styles.rowDivider,
                i < LOCALES.length - 1 && { borderBottomColor: theme.border.default },
              ]}
            >
              <View style={styles.labelWrap}>
                <Text style={[styles.label, { color: theme.text.primary }]}>{l.label}</Text>
                <Text style={[styles.sublabel, { color: theme.text.muted }]}>{l.native}</Text>
              </View>
              {active ? <Check size={18} color={brand.solid} /> : null}
            </Pressable>
          )
        })}
      </SettingsGroup>
      <Text style={[styles.hint, { color: theme.text.muted }]}>{t('settings.languageHint')}</Text>

      <Text style={[styles.sectionTitle, { color: theme.text.secondary }]}>
        {t('settings.timeFormat')}
      </Text>
      <View style={styles.chipRow}>
        {(
          [
            { value: '24h', label: t('settings.time24h') },
            { value: '12h', label: t('settings.time12h') },
          ] as const
        ).map((opt) => (
          <Pressable
            key={opt.value}
            onPress={() => applyTimeFmt(opt.value)}
            style={chipStyle(timeFmt === opt.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: timeFmt === opt.value }}
          >
            <Text style={chipTextStyle(timeFmt === opt.value)}>{opt.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.sectionTitle, { color: theme.text.secondary }]}>
        {t('settings.dateFormat')}
      </Text>
      <View style={styles.chipRow}>
        {(
          [
            { value: 'ymd', label: t('settings.dateYMD') },
            { value: 'mdy', label: t('settings.dateMDY') },
            { value: 'dmy', label: t('settings.dateDMY') },
          ] as const
        ).map((opt) => (
          <Pressable
            key={opt.value}
            onPress={() => applyDateFmt(opt.value)}
            style={chipStyle(dateFmt === opt.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: dateFmt === opt.value }}
          >
            <Text style={chipTextStyle(dateFmt === opt.value)}>{opt.label}</Text>
          </Pressable>
        ))}
      </View>
    </SettingsShell>
  )
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  labelWrap: { flex: 1, gap: 2 },
  label: { fontSize: 15 },
  sublabel: { fontSize: 12 },
  hint: { fontSize: 12, marginTop: spacing.xs, marginLeft: spacing.xs },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
})
