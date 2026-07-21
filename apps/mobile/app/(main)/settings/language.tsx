import { Check } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { SettingsGroup } from '@/components/settings/SettingsRows'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { changeAppLocale, i18n } from '@/i18n'
import type { AppLocale } from '@/i18n'
import { border, brand, spacing, text } from '@/theme/tokens'

const LOCALES: { value: AppLocale; label: string; native: string }[] = [
  { value: 'zh-CN', label: '简体中文', native: '简体中文' },
  { value: 'en-US', label: 'English', native: 'English (US)' },
]

/** 语言屏：切换 i18next 语言并持久化到 AsyncStorage */
export default function LanguageScreen(): React.JSX.Element {
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
              android_ripple={{ color: 'rgba(0,0,0,0.05)' }}
              style={[styles.row, i < LOCALES.length - 1 && styles.rowDivider]}
            >
              <View style={styles.labelWrap}>
                <Text style={styles.label}>{l.label}</Text>
                <Text style={styles.sublabel}>{l.native}</Text>
              </View>
              {active ? <Check size={18} color={brand.solid} /> : null}
            </Pressable>
          )
        })}
      </SettingsGroup>
      <Text style={styles.hint}>切换后立即生效，并在下次启动时保持。</Text>
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
    borderBottomColor: border.default,
  },
  labelWrap: { flex: 1, gap: 2 },
  label: { fontSize: 15, color: text.primary },
  sublabel: { fontSize: 12, color: text.muted },
  hint: { fontSize: 12, color: text.muted, marginTop: spacing.xs, marginLeft: spacing.xs },
})
