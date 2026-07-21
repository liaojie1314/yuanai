import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { bg, spacing, text } from '@/theme/tokens'

/**
 * 设置屏占位。Step 8 会替换为完整的 6 子屏（个人资料 / 安全 / 外观 / 通知 /
 * 语言 / 关于）。
 */
export default function SettingsScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  // Drawer 场景下设置页可能是历史里的第一屏（冷启动恢复 / 深链），
  // 直接 back() 会触发 GO_BACK not handled 警告，无历史时退回聊天首页。
  const goBack = (): void => {
    if (router.canGoBack()) router.back()
    else router.replace('/(main)/chat')
  }
  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.topBar}>
        <Pressable onPress={goBack} hitSlop={8} style={styles.topBtn}>
          <ChevronLeft size={22} color={text.primary} />
        </Pressable>
        <Text style={styles.topTitle}>设置</Text>
        <View style={styles.topBtn} />
      </View>

      <View style={styles.body}>
        <Text style={styles.hint}>设置界面待实现 (Step 8)</Text>
      </View>
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
    borderBottomColor: '#E5E7EB',
  },
  topBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: text.primary, textAlign: 'center' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 14, color: text.secondary },
})
