import { useNavigation } from 'expo-router'
import { Menu, MessageSquarePlus } from 'lucide-react-native'
import { useCallback } from 'react'
import { Alert, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { TABLET_MIN_WIDTH, useCreateConversation } from '@yuanai/core'

import { bg, brand, radius, spacing, text } from '@/theme/tokens'

/**
 * `/chat` 空状态页：登录后的默认落地屏。
 *
 * - 顶部左侧：手机端渲染打开抽屉按钮（平板不显示，因为侧栏本就固定展开）
 * - 中部：品牌 logo + 引导文案 + 「新建对话」快捷按钮
 * - Step 7 会把这里换成"含输入框的欢迎页"（用户直接输入即触发 conv 创建）
 */
export default function ChatEmptyScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const isTablet = width >= TABLET_MIN_WIDTH
  const navigation = useNavigation()
  const createConv = useCreateConversation()

  const openDrawer = useCallback(() => {
    // expo-router Drawer 挂在 navigation 上；非 Drawer（如平板双栏）不存在此方法
    const nav = navigation as unknown as { openDrawer?: () => void }
    nav.openDrawer?.()
  }, [navigation])

  const handleNew = useCallback(async (): Promise<void> => {
    try {
      await createConv.mutateAsync({ model: 'deepseek-v4-flash' })
      // 新会话创建后 useConversations 缓存会更新；用户从侧边栏点开即可
      // Step 7 会改成直接 router.push 到新会话
    } catch (err) {
      Alert.alert('新建对话失败', err instanceof Error ? err.message : '请稍后重试')
    }
  }, [createConv])

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Top bar：只在手机端渲染 Drawer 按钮 */}
      {!isTablet ? (
        <View style={styles.topBar}>
          <Pressable
            onPress={openDrawer}
            hitSlop={8}
            style={styles.topBtn}
            accessibilityLabel="打开侧边栏"
          >
            <Menu size={20} color={text.primary} />
          </Pressable>
          <Text style={styles.topTitle}>元AI</Text>
          <View style={styles.topBtn} />
        </View>
      ) : null}

      {/* 空状态内容 */}
      <View style={styles.body}>
        <View style={styles.brandBadge}>
          <Text style={styles.brandBadgeText}>元</Text>
        </View>
        <Text style={styles.title}>你好，我是元AI</Text>
        <Text style={styles.subtitle}>选择左侧对话继续，或开启一个新话题</Text>

        <Pressable
          onPress={() => {
            void handleNew()
          }}
          style={({ pressed }) => [styles.newBtn, pressed && { opacity: 0.85 }]}
          disabled={createConv.isPending}
        >
          <MessageSquarePlus size={16} color="#FFFFFF" />
          <Text style={styles.newBtnLabel}>{createConv.isPending ? '创建中…' : '开始新对话'}</Text>
        </Pressable>
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
  },
  topBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontSize: 16, fontWeight: '600', color: text.primary },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  brandBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: brand.solid,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  brandBadgeText: { color: '#FFFFFF', fontSize: 28, fontWeight: '700' },
  title: { fontSize: 20, fontWeight: '600', color: text.primary },
  subtitle: { fontSize: 14, color: text.secondary, textAlign: 'center', marginBottom: spacing.lg },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: brand.solid,
  },
  newBtnLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
})
