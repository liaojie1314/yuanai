import type { BottomSheetModal } from '@gorhom/bottom-sheet'
import { useFocusEffect, useNavigation, useRouter } from 'expo-router'
import { ChevronDown, ChevronLeft, Ghost, Menu } from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Keyboard, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { TABLET_MIN_WIDTH, TEMPORARY_CONV_ID, useModels, useStream } from '@yuanai/core'
import { useChatStore, usePrefsStore } from '@yuanai/core/stores'
import type { AIModel, Message } from '@yuanai/types'
import { Role } from '@yuanai/types'

import { ChatInput } from '@/components/chat/ChatInput'
import type { FeedbackType } from '@/components/chat/AIMessageActions'
import { MessageList, type MessageListHandle } from '@/components/chat/MessageList'
import { ModelSelectorSheet } from '@/components/chat/ModelSelectorSheet'
import { useDialog } from '@/components/ui/Dialog'
import { brand, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

/**
 * 临时对话屏（对齐 web `ChatInterface` 的 temporary 模式）。
 *
 * - 不落库、不进会话列表：消息只存本屏 state，离开页面即遗忘
 * - 走 `useStream().sendTemporary` → `/chat/stream/temporary`（无状态接口，
 *   每次带全量 history）；流式 UI 复用 chat store（伪 convId = TEMPORARY_CONV_ID）
 * - 「重新生成 / 编辑重发」都等价于再发一条：相邻同内容用户消息会被
 *   `buildMessagePairs` 折叠成同一 pair 的多版本，交互与正式会话一致
 * - 模型选择存本地（无会话可 PATCH），换模型只影响后续发送
 */
export default function TemporaryChatScreen(): React.JSX.Element {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const isTablet = width >= TABLET_MIN_WIDTH
  const router = useRouter()
  const navigation = useNavigation()
  const dialog = useDialog()

  const { data: models = [] } = useModels()
  const { sendTemporary, stop } = useStream()
  const streamingConvId = useChatStore((s) => s.streamingConvId)
  const isStreaming = streamingConvId === TEMPORARY_CONV_ID

  const listRef = useRef<MessageListHandle>(null)
  const modelSheetRef = useRef<BottomSheetModal>(null)

  // 本地消息（含用户与 AI）；卸载即弃
  const [messages, setMessages] = useState<Message[]>([])
  // 供异步回调读取最新列表（sendTemporary 的 history 需要发送前快照）
  const messagesRef = useRef<Message[]>(messages)
  messagesRef.current = messages

  // ── 交互状态（与正式会话屏同构）───────────────────────────────
  const [versionIdxs, setVersionIdxs] = useState<Record<string, number>>({})
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null)
  const [msgFeedback, setMsgFeedback] = useState<Record<string, FeedbackType>>({})

  // ── 模型（本地选择，同空态屏）─────────────────────────────────
  const [pickedModelId, setPickedModelId] = useState<string | null>(null)
  const activeModelId = useMemo(() => {
    if (pickedModelId && models.some((m) => m.id === pickedModelId)) return pickedModelId
    const def = models.find((m) => m.isDefault)
    return def?.id ?? models[0]?.id ?? 'deepseek-v4-flash'
  }, [pickedModelId, models])
  const activeModel = useMemo(
    () => models.find((m) => m.id === activeModelId),
    [models, activeModelId]
  )
  useEffect(() => {
    if (pickedModelId === null && models.length > 0) {
      const def = models.find((m) => m.isDefault) ?? models[0]
      if (def) setPickedModelId(def.id)
    }
  }, [models, pickedModelId])

  const openModelSheet = useCallback(() => {
    if (models.length === 0) return
    modelSheetRef.current?.present()
  }, [models.length])

  const handleSelectModel = useCallback((m: AIModel) => {
    setPickedModelId(m.id)
    modelSheetRef.current?.dismiss()
  }, [])

  const openDrawer = useCallback(() => {
    const nav = navigation as unknown as { openDrawer?: () => void }
    nav.openDrawer?.()
  }, [navigation])

  // 「离场即忘」：屏幕失焦时清空 state 并中断进行中的流（对齐 web 端「切走
  // 即丢弃」，phase-3 §0.1 也是这样规定）。用 useFocusEffect 的 cleanup —— 无论
  // 是抽屉切正式会话、返回、还是新建对话都会触发。切回临时对话会重新聚焦并渲染
  // 一个空的对话。
  useFocusEffect(
    useCallback(
      () => () => {
        if (useChatStore.getState().streamingConvId === TEMPORARY_CONV_ID) {
          stop()
        }
        setMessages([])
        setVersionIdxs({})
        setEditingMsgId(null)
        setMsgFeedback({})
      },
      [stop]
    )
  )

  // ── 发送（临时流）────────────────────────────────────────────
  // ⚠️ 用户消息不在这里立刻 push：sendTemporary 内部 startStreaming 已设
  // optimisticUserMsg，MessageList 会渲染乐观气泡；本地若同时 push 一条，
  // 流式期间会出现两个相同的用户气泡。统一在 onEnd（出错时也会触发，
  // finalContent 为空）里把 user +（非空时）assistant 一起落进本地列表。
  const handleSend = useCallback(
    // fileIds 参数签名与 ChatInput.onSend 对齐，临时对话忽略附件（后端不支持）
    (content: string, _fileIds?: string[]): void => {
      if (isStreaming) return
      const history = messagesRef.current.map((m) => ({
        role: m.role === Role.User ? ('user' as const) : ('assistant' as const),
        content: m.content,
      }))
      void sendTemporary({
        content,
        history,
        model: activeModelId,
        enableThinking: usePrefsStore.getState().showThinking,
        onEnd: ({ content: finalContent, think, thinkDurationMs }) => {
          const now = Date.now()
          setMessages((prev) => {
            const next: Message[] = [
              ...prev,
              {
                id: `temp-user-${String(now)}`,
                role: Role.User,
                content,
                files: [],
                createdAt: new Date(now).toISOString(),
              },
            ]
            if (finalContent) {
              // 保留思考文本/耗时（对齐正式会话，流结束后仍可展开查看）
              next.push({
                id: `temp-assistant-${String(now)}`,
                role: Role.Assistant,
                content: finalContent,
                ...(think ? { thinkingContent: think } : {}),
                ...(thinkDurationMs > 0 ? { thinkingDurationMs: thinkDurationMs } : {}),
                files: [],
                createdAt: new Date(now + 1).toISOString(),
              })
            }
            return next
          })
        },
        onError: (err) => {
          void dialog.alert({
            title: '发送失败',
            message: err instanceof Error ? err.message : '请稍后重试',
          })
        },
      })
      requestAnimationFrame(() => listRef.current?.scrollToEnd?.(true))
    },
    [isStreaming, sendTemporary, activeModelId, dialog]
  )

  // ── 交互 handlers（复用正式会话屏语义）───────────────────────
  const handleVersionChange = useCallback((pairKey: string, idx: number): void => {
    setVersionIdxs((prev) => ({ ...prev, [pairKey]: idx }))
  }, [])

  // 重新生成 = 同一问题再发一次；相邻同内容用户消息折叠成同 pair 多版本
  const handleRegenerate = useCallback(
    (_pairKey: string, userContent: string): void => {
      if (!userContent || isStreaming) return
      handleSend(userContent)
    },
    [handleSend, isStreaming]
  )

  const handleFeedback = useCallback((msgId: string, type: FeedbackType): void => {
    setMsgFeedback((prev) => {
      if (prev[msgId] === type) {
        const next = { ...prev }
        delete next[msgId]
        return next
      }
      return { ...prev, [msgId]: type }
    })
  }, [])

  const handleStartEdit = useCallback((msgId: string): void => {
    setEditingMsgId(msgId)
  }, [])

  const handleSubmitEdit = useCallback(
    (msgId: string, nextText: string): void => {
      setEditingMsgId(null)
      const original = messagesRef.current.find((m) => m.id === msgId)?.content ?? ''
      if (!nextText || nextText === original || isStreaming) return
      handleSend(nextText)
    },
    [isStreaming, handleSend]
  )

  const handleCancelEdit = useCallback((): void => {
    setEditingMsgId(null)
  }, [])

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: t.bg.base }]}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <View style={[styles.inner, { paddingTop: insets.top }]}>
        {/* 顶栏：Ghost 标识 + 模型 chip */}
        <View style={[styles.topBar, { borderBottomColor: t.border.default }]}>
          {isTablet ? (
            <Pressable
              onPress={() => router.replace('/(main)/chat')}
              hitSlop={8}
              style={styles.topBtn}
              accessibilityLabel="退出临时对话"
            >
              <ChevronLeft size={22} color={t.text.primary} />
            </Pressable>
          ) : (
            <Pressable
              onPress={openDrawer}
              hitSlop={8}
              style={styles.topBtn}
              accessibilityLabel="打开侧边栏"
            >
              <Menu size={20} color={t.text.primary} />
            </Pressable>
          )}
          <View style={styles.topCenter}>
            <View style={styles.titleRow}>
              <Ghost size={14} color={brand.solid} />
              <Text style={[styles.topTitle, { color: t.text.primary }]} numberOfLines={1}>
                临时对话
              </Text>
            </View>
            {models.length > 0 ? (
              <Pressable
                onPress={openModelSheet}
                hitSlop={4}
                style={styles.modelChip}
                accessibilityRole="button"
                accessibilityLabel={`当前模型 ${activeModel?.name ?? activeModelId}，点击切换`}
              >
                <Text style={[styles.modelChipText, { color: t.text.secondary }]} numberOfLines={1}>
                  {activeModel?.name ?? activeModelId}
                </Text>
                <ChevronDown size={12} color={t.text.secondary} />
              </Pressable>
            ) : null}
          </View>
          <View style={styles.topBtn} />
        </View>

        {/* 消息区：Pressable 包一层，tap 空白区域关键盘（对齐 [conversationId].tsx） */}
        <Pressable style={styles.listArea} onPress={Keyboard.dismiss}>
          {messages.length === 0 && !isStreaming ? (
            <View style={styles.center}>
              <Ghost size={40} color={t.text.muted} />
              <Text style={[styles.emptyTitle, { color: t.text.primary }]}>临时对话</Text>
              <Text style={[styles.emptyHint, { color: t.text.muted }]}>
                此对话不会保存，也不会出现在历史列表中；{'\n'}离开本页即被遗忘
              </Text>
            </View>
          ) : (
            <MessageList
              ref={listRef}
              convId={TEMPORARY_CONV_ID}
              messages={messages}
              versionIdxs={versionIdxs}
              regeneratingPairKey={null}
              editingMsgId={editingMsgId}
              msgFeedback={msgFeedback}
              onVersionChange={handleVersionChange}
              onRegenerate={handleRegenerate}
              onFeedback={handleFeedback}
              onStartEdit={handleStartEdit}
              onSubmitEdit={handleSubmitEdit}
              onCancelEdit={handleCancelEdit}
            />
          )}
        </Pressable>

        {/* 输入区 */}
        <ChatInput
          streaming={isStreaming}
          onSend={handleSend}
          onStop={stop}
          bottomInset={insets.bottom}
          disableAttachments
        />
      </View>

      <ModelSelectorSheet
        ref={modelSheetRef}
        models={models}
        currentId={activeModelId}
        onSelect={handleSelectModel}
      />
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1 },
  topBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topCenter: { flex: 1, alignItems: 'center', gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  topTitle: { fontSize: 15, fontWeight: '600' },
  modelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
  },
  modelChipText: { fontSize: 11 },
  listArea: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: { fontSize: 17, fontWeight: '600' },
  emptyHint: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
})
