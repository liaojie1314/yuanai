import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { bg, border, spacing, text } from '@/theme/tokens'

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
  const insets = useSafeAreaInsets()
  const router = useRouter()

  const goBack = (): void => {
    if (router.canGoBack()) router.back()
    else router.replace('/(main)/chat')
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable onPress={goBack} hitSlop={8} style={styles.topBtn} accessibilityLabel="返回">
          <ChevronLeft size={22} color={text.primary} />
        </Pressable>
        <Text style={styles.topTitle}>{title}</Text>
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
  container: { flex: 1, backgroundColor: bg.base },
  topBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: border.default,
  },
  topBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: text.primary, textAlign: 'center' },
  scroll: { flex: 1 },
})
