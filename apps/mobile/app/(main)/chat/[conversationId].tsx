import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { ChevronLeft, Menu } from 'lucide-react-native'
import { useCallback } from 'react'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { TABLET_MIN_WIDTH, useConversations } from '@yuanai/core'

import { bg, spacing, text } from '@/theme/tokens'

/**
 * 单会话聊天页占位。Step 7 会替换为完整的 MessageList + ChatInput + Artifact 面板。
 *
 * 当前只承担：
 * - 顶部标题（会话名 / 默认 "对话"）
 * - 手机端：左侧 Menu 按钮打开抽屉；平板：显示返回按钮回到空状态
 * - 中部占位说明「聊天主界面 Step 7」
 */
export default function ChatConversationScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const isTablet = width >= TABLET_MIN_WIDTH
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>()
  const router = useRouter()
  const navigation = useNavigation()

  const { data: conversations = [] } = useConversations()
  const conv = conversations.find((c) => c.id === conversationId)

  const openDrawer = useCallback(() => {
    const nav = navigation as unknown as { openDrawer?: () => void }
    nav.openDrawer?.()
  }, [navigation])

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.topBar}>
        {isTablet ? (
          <Pressable
            onPress={() => router.replace('/(main)/chat')}
            hitSlop={8}
            style={styles.topBtn}
            accessibilityLabel="回到空状态"
          >
            <ChevronLeft size={22} color={text.primary} />
          </Pressable>
        ) : (
          <Pressable
            onPress={openDrawer}
            hitSlop={8}
            style={styles.topBtn}
            accessibilityLabel="打开侧边栏"
          >
            <Menu size={20} color={text.primary} />
          </Pressable>
        )}
        <Text style={styles.topTitle} numberOfLines={1}>
          {conv?.title ?? '对话'}
        </Text>
        <View style={styles.topBtn} />
      </View>

      <View style={styles.body}>
        <Text style={styles.hint}>会话 {conversationId}</Text>
        <Text style={styles.subhint}>聊天主界面待实现 (Step 7)</Text>
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
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  hint: { fontSize: 14, color: text.secondary },
  subhint: { fontSize: 12, color: text.muted },
})
