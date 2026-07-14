import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { ChevronLeft, Menu } from 'lucide-react-native'
import { useCallback, useMemo, useRef } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { TABLET_MIN_WIDTH, useConversations, useMessages, useModels, useStream } from '@yuanai/core'
import { useChatStore } from '@yuanai/core/stores'

import { ChatInput } from '@/components/chat/ChatInput'
import { MessageList, type MessageListHandle } from '@/components/chat/MessageList'
import { bg, border, spacing, text } from '@/theme/tokens'

/**
 * 单会话聊天页（Step 7 MVP）。
 *
 * 组成：
 * - 顶栏（Drawer 触发 / 平板返回 / 会话标题）
 * - MessageList：历史消息 + 流式追加（含光标）
 * - ChatInput：多行输入 + 发送/停止按钮
 *
 * 数据流：
 * - `useMessages(convId)`   → 历史消息（TanStack Query）
 * - `useStream().send(...)` → SSE 触发；hook 内部会把 delta 分派到 chat store
 * - `useChatStore`          → 读 streamingConvId 判断本页是否处于流式态
 * - `useModels()`           → 取默认模型；MVP 未做手动选择
 *
 * 键盘：Android 用 `padding` 策略把输入区推起；iOS 用 `height` 兼容 SafeArea。
 *      MVP 不上 `KeyboardStickyView`（那需要额外配置 provider），基础方案够用。
 */
export default function ChatConversationScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const isTablet = width >= TABLET_MIN_WIDTH
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>()
  const router = useRouter()
  const navigation = useNavigation()

  const { data: conversations = [] } = useConversations()
  const { data: models = [] } = useModels()
  const { data: messages = [], isLoading } = useMessages(conversationId)
  const { send, stop } = useStream()
  const streamingConvId = useChatStore((s) => s.streamingConvId)
  const isStreaming = streamingConvId === conversationId

  const listRef = useRef<MessageListHandle>(null)

  const conv = conversations.find((c) => c.id === conversationId)
  const currentModel = useMemo(() => {
    // 优先复用会话已有 model；其次取标为 isDefault 的模型；再退化到列表首个
    if (conv?.model) return conv.model
    const def = models.find((m) => m.isDefault)
    return def?.id ?? models[0]?.id ?? 'deepseek-v4-flash'
  }, [conv, models])

  const openDrawer = useCallback(() => {
    const nav = navigation as unknown as { openDrawer?: () => void }
    nav.openDrawer?.()
  }, [navigation])

  const handleSend = useCallback(
    (content: string): void => {
      if (!conversationId) return
      // 发送后立即滚到底；send 是 async 但我们不 await，让 UI 立刻响应
      void send({
        convId: conversationId,
        content,
        model: currentModel,
        onError: (err) => {
          Alert.alert('发送失败', err instanceof Error ? err.message : '请稍后重试')
        },
      })
      requestAnimationFrame(() => listRef.current?.scrollToEnd?.(true))
    },
    [conversationId, currentModel, send]
  )

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      // iOS 顶部 SafeArea 已由外层 View 承担，避键盘时不再重复偏移
      keyboardVerticalOffset={0}
    >
      <View style={[styles.inner, { paddingTop: insets.top }]}>
        {/* 顶栏 */}
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

        {/* 消息区 */}
        <View style={styles.listArea}>
          {isLoading && messages.length === 0 ? (
            <View style={styles.center}>
              <ActivityIndicator />
            </View>
          ) : messages.length === 0 && !isStreaming ? (
            <View style={styles.center}>
              <Text style={styles.emptyHint}>还没有消息，输入你的第一个问题</Text>
            </View>
          ) : (
            <MessageList ref={listRef} convId={conversationId ?? ''} messages={messages} />
          )}
        </View>

        {/* 输入区 */}
        <ChatInput
          streaming={isStreaming}
          onSend={handleSend}
          onStop={stop}
          bottomInset={insets.bottom}
        />
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: bg.base },
  inner: { flex: 1 },
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
  topTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: text.primary,
    textAlign: 'center',
  },
  listArea: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyHint: { fontSize: 13, color: text.muted },
})
