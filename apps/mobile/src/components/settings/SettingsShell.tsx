import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

/**
 * 设置子屏统一外壳：安全区 + 顶栏（返回箭头 / 标题）+ 可滚动内容区。
 *
 * 返回策略与 settings/index 相同：无历史（深链/冷启动恢复）时退回聊天首页，
 * 避免 GO_BACK not handled。
 */
export function SettingsShell({
  title,
  children,
}: {
  title: string
  children: ReactNode
}): React.JSX.Element {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()

  const goBack = (): void => {
    if (router.canGoBack()) router.back()
    else router.replace('/(main)/chat')
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: t.bg.base }]}>
      <View style={[styles.topBar, { borderBottomColor: t.border.default }]}>
        <Pressable onPress={goBack} hitSlop={8} style={styles.topBtn} accessibilityLabel="返回">
          <ChevronLeft size={22} color={t.text.primary} />
        </Pressable>
        <Text style={[styles.topTitle, { color: t.text.primary }]}>{title}</Text>
        <View style={styles.topBtn} />
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  scroll: { flex: 1 },
})
