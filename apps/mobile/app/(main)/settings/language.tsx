import { Check } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { SettingsGroup } from '@/components/settings/SettingsRows'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { changeAppLocale, i18n } from '@/i18n'
import type { AppLocale } from '@/i18n'
import { brand, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

const LOCALES: { value: AppLocale; label: string; native: string }[] = [
  { value: 'zh-CN', label: '简体中文', native: '简体中文' },
  { value: 'en-US', label: 'English', native: 'English (US)' },
]

/** 语言屏：切换 i18next 语言并持久化到 AsyncStorage */
export default function LanguageScreen(): React.JSX.Element {
  const t = useTheme()
  const [current, setCurrent] = useState(i18n.language)

  const onPick = (locale: AppLocale): void => {
    setCurrent(locale)
    void changeAppLocale(locale)
  }

  return (
    <SettingsShell title="语言">
      <SettingsGroup>
        {LOCALES.map((l, i) => {
          const active = current === l.value
          return (
            <Pressable
              key={l.value}
              onPress={() => onPick(l.value)}
              android_ripple={{
                color: t.colorScheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
              }}
              style={[
                styles.row,
                i < LOCALES.length - 1 && styles.rowDivider,
                i < LOCALES.length - 1 && { borderBottomColor: t.border.default },
              ]}
            >
              <View style={styles.labelWrap}>
                <Text style={[styles.label, { color: t.text.primary }]}>{l.label}</Text>
                <Text style={[styles.sublabel, { color: t.text.muted }]}>{l.native}</Text>
              </View>
              {active ? <Check size={18} color={brand.solid} /> : null}
            </Pressable>
          )
        })}
      </SettingsGroup>
      <Text style={[styles.hint, { color: t.text.muted }]}>
        切换后立即生效，并在下次启动时保持。
      </Text>
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
})
