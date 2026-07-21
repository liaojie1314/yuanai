import * as Application from 'expo-application'
import { StyleSheet, Text, View } from 'react-native'

import { SettingsGroup, SettingsRow } from '@/components/settings/SettingsRows'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { useDialog } from '@/components/ui/Dialog'
import { brand, spacing, text } from '@/theme/tokens'

/** 关于屏：logo + 版本号 + 协议/隐私入口（v1 文案先内置弹窗展示） */
export default function AboutScreen(): React.JSX.Element {
  const dialog = useDialog()
  const version = Application.nativeApplicationVersion ?? '—'
  const build = Application.nativeBuildVersion ?? '—'

  return (
    <SettingsShell title="关于">
      <View style={styles.hero}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>元</Text>
        </View>
        <Text style={styles.appName}>元AI</Text>
        <Text style={styles.version}>
          版本 {version} (build {build})
        </Text>
      </View>

      <SettingsGroup>
        <SettingsRow
          label="用户协议"
          onPress={() => {
            void dialog.alert({
              title: '用户协议',
              message: '正式协议文本将在发布前由运营提供；当前为开发版本。',
            })
          }}
        />
        <SettingsRow
          label="隐私政策"
          divider={false}
          onPress={() => {
            void dialog.alert({
              title: '隐私政策',
              message: '正式隐私政策将在发布前由运营提供；当前为开发版本。',
            })
          }}
        />
      </SettingsGroup>

      <Text style={styles.copyright}>© 2026 yuanai</Text>
    </SettingsShell>
  )
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: spacing.xxl },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: brand.solid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { fontSize: 30, fontWeight: '700', color: '#FFFFFF' },
  appName: { fontSize: 18, fontWeight: '700', color: text.primary, marginTop: spacing.md },
  version: { fontSize: 13, color: text.secondary, marginTop: 4 },
  copyright: {
    fontSize: 12,
    color: text.muted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
})
