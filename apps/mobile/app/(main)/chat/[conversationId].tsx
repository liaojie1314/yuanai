import type { BottomSheetModal } from '@gorhom/bottom-sheet'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { ChevronDown, ChevronLeft, Menu } from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  TABLET_MIN_WIDTH,
  useConversations,
  useMessages,
  useModels,
  useStream,
  useUpdateConversation,
} from '@yuanai/core'
import { useChatStore, usePrefsStore } from '@yuanai/core/stores'
import type { AIModel } from '@yuanai/types'

import type { FeedbackType } from '@/components/chat/AIMessageActions'
import { ChatInput } from '@/components/chat/ChatInput'
import { ArtifactSurface } from '@/components/chat/ArtifactSurface'
import { MessageList, type MessageListHandle } from '@/components/chat/MessageList'
import { ModelSelectorSheet } from '@/components/chat/ModelSelectorSheet'
import { useDialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
import { bg, border, spacing, text } from '@/theme/tokens'

/**
 * 单会话聊天页。
 *
 * 组成：
 * - 顶栏（Drawer 触发 / 平板返回 / 会话标题）
 * - MessageList：历史消息 + 流式追加（含光标）+ 消息交互
 * - ChatInput：多行输入 + 发送/停止按钮
 *
 * 数据流：
 * - `useMessages(convId)`   → 历史消息（TanStack Query）
 * - `useStream().send(...)` → SSE 触发；hook 内部会把 delta 分派到 chat store
 * - `useChatStore`          → 读 streamingConvId 判断本页是否处于流式态
 * - `useModels()`           → 取默认模型；MVP 未做手动选择
 *
 * 消息交互状态都放在本屏（对齐 web `ChatInterface`），MessageList 保持纯展示：
 * - `versionIdxs`          → 每个 pair 当前展示第几个回答版本
 * - `regeneratingPairKey`  → 重新生成时把流式块内联渲染到该 pair 位置
 * - `editingMsgId`         → 哪条用户消息处于内联编辑态
 * - `msgFeedback`          → 点赞/踩。**仅内存**，与 web 端行为一致
 *                            （后端无 feedback 端点，退出会话即丢）
 *
 * 键盘：统一走 `react-native-keyboard-controller` 的 `KeyboardAvoidingView`
 *      + `behavior="padding"`，双端一致；接管 root 层 `KeyboardProvider`
 *      的事件（RN 原版在 Android 上跟 `adjustResize` 冲突不推起）。
 */
export default function ChatConversationScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const isTablet = width >= TABLET_MIN_WIDTH
  const { conversationId, draft } = useLocalSearchParams<{
    conversationId: string
    draft?: string
  }>()
  const router = useRouter()
  const navigation = useNavigation()
  const dialog = useDialog()

  const { data: conversations = [] } = useConversations()
  const { data: models = [] } = useModels()
  const { data: messages = [], isLoading } = useMessages(conversationId)
  const { send, stop } = useStream()
  const streamingConvId = useChatStore((s) => s.streamingConvId)
  const isStreaming = streamingConvId === conversationId
  const updateConv = useUpdateConversation()
  const toast = useToast()

  const listRef = useRef<MessageListHandle>(null)
  const modelSheetRef = useRef<BottomSheetModal>(null)

  // ── 消息交互状态 ────────────────────────────────────────────
  const [versionIdxs, setVersionIdxs] = useState<Record<string, number>>({})
  const [regeneratingPairKey, setRegeneratingPairKey] = useState<string | null>(null)
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null)
  const [msgFeedback, setMsgFeedback] = useState<Record<string, FeedbackType>>({})

  // 切会话时清空全部交互态（版本下标以 pairKey 索引，跨会话没有意义）
  useEffect(() => {
    setVersionIdxs({})
    setRegeneratingPairKey(null)
    setEditingMsgId(null)
    setMsgFeedback({})
  }, [conversationId])

  // 流结束（正常收尾 / 停止 / 出错）后解除重新生成态，让该 pair 回到静态渲染
  useEffect(() => {
    if (!isStreaming && regeneratingPairKey !== null) setRegeneratingPairKey(null)
  }, [isStreaming, regeneratingPairKey])

  const conv = conversations.find((c) => c.id === conversationId)
  const currentModel = useMemo(() => {
    // 优先复用会话已有 model；其次取标为 isDefault 的模型；再退化到列表首个
    if (conv?.model) return conv.model
    const def = models.find((m) => m.isDefault)
    return def?.id ?? models[0]?.id ?? 'deepseek-v4-flash'
  }, [conv, models])
  const currentModelInfo = useMemo(
    () => models.find((m) => m.id === currentModel),
    [models, currentModel]
  )

  const openModelSheet = useCallback(() => {
    if (models.length === 0) return
    modelSheetRef.current?.present()
  }, [models.length])

  // 选择模型：立刻 dismiss（不等 PATCH 回来避免卡顿感）→ 后端更新会话绑定 →
  // 失败回退（Query onError 会自动回滚 cache，这里补 toast + 提示重试）。
  // ⚠️ 只在 currentModel 是「已绑定值」时才 PATCH：新会话在首次发送前 conv.model
  // 已存在（chat/index.tsx createConv 时写入）；这里再 PATCH 是覆盖用户此后的选择。
  const handleSelectModel = useCallback(
    (m: AIModel) => {
      modelSheetRef.current?.dismiss()
      if (!conversationId || conv?.model === m.id) return
      updateConv.mutate(
        { id: conversationId, model: m.id },
        {
          onSuccess: () => toast.show(`已切换到 ${m.name}`),
          onError: (err) =>
            void dialog.alert({
              title: '切换失败',
              message: err instanceof Error ? err.message : '请稍后重试',
            }),
        }
      )
    },
    [conversationId, conv?.model, updateConv, toast, dialog]
  )

  const openDrawer = useCallback(() => {
    const nav = navigation as unknown as { openDrawer?: () => void }
    nav.openDrawer?.()
  }, [navigation])

  const showSendError = useCallback(
    (err: unknown): void => {
      void dialog.alert({
        title: '发送失败',
        message: err instanceof Error ? err.message : '请稍后重试',
      })
    },
    [dialog]
  )

  const handleSend = useCallback(
    (content: string): void => {
      if (!conversationId) return
      // 发送后立即滚到底；send 是 async 但我们不 await，让 UI 立刻响应。
      // 实际的自动贴底由 MessageList 监听 rows.length 变化完成，这里再补一次兜底。
      // enableThinking 从 prefs store 现读（getState 而非订阅）：开关变化不必重渲本屏。
      void send({
        convId: conversationId,
        content,
        model: currentModel,
        enableThinking: usePrefsStore.getState().showThinking,
        onError: showSendError,
      })
      requestAnimationFrame(() => listRef.current?.scrollToEnd?.(true))
    },
    [conversationId, currentModel, send, showSendError]
  )

  // ── 版本切换 ────────────────────────────────────────────────
  const handleVersionChange = useCallback((pairKey: string, idx: number): void => {
    setVersionIdxs((prev) => ({ ...prev, [pairKey]: idx }))
  }, [])

  // ── 重新生成 ────────────────────────────────────────────────
  // 后端没有「重跑某条消息」的端点，重新生成 = 把同样的问题再发一次
  // （`skipOptimistic` 跳过乐观用户气泡，避免同一个问题重复出现两遍）。
  // 重发产生的新 assistant 会被 buildMessagePairs 折叠成同一 pair 的新版本。
  const handleRegenerate = useCallback(
    (pairKey: string, userContent: string): void => {
      if (!conversationId || isStreaming || !userContent) return
      setRegeneratingPairKey(pairKey)
      // 清掉该 pair 的版本选择，让新版本（最后一版）自动成为展示项
      setVersionIdxs((prev) => {
        const next = { ...prev }
        delete next[pairKey]
        return next
      })
      void send({
        convId: conversationId,
        content: userContent,
        model: currentModel,
        skipOptimistic: true,
        enableThinking: usePrefsStore.getState().showThinking,
        onError: (err) => {
          setRegeneratingPairKey(null)
          showSendError(err)
        },
      })
    },
    [conversationId, currentModel, isStreaming, send, showSendError]
  )

  // ── 用户消息内联编辑 ─────────────────────────────────────────
  // 与 web 一致：提交 = 以新内容再发一条，原消息保留在历史里
  // （后端没有「改写已存在消息」的端点）。
  const handleSubmitEdit = useCallback(
    (msgId: string, nextText: string): void => {
      setEditingMsgId(null)
      const original = messages.find((m) => m.id === msgId)?.content ?? ''
      if (!nextText || nextText === original || isStreaming) return
      handleSend(nextText)
    },
    [messages, isStreaming, handleSend]
  )

  const handleCancelEdit = useCallback((): void => {
    setEditingMsgId(null)
  }, [])

  // ── 点赞 / 踩 ───────────────────────────────────────────────
  // 即点即记的 toggle，无分类弹层（用户明确要求直点操作，不要弹窗）。
  // 仅存内存，与 web 端一致（后端无 feedback 端点）。
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

  // 从新会话落地屏跳转过来时带 draft（首条消息）→ 挂载后自动发送一次。
  // 用 ref 上锁避免 React 严格模式/重渲染重复触发；发送后清掉 URL 上的 draft，
  // 防止返回/刷新再次重发。
  const draftSentRef = useRef(false)
  useEffect(() => {
    if (draftSentRef.current) return
    const text = typeof draft === 'string' ? draft.trim() : ''
    if (!text || !conversationId) return
    draftSentRef.current = true
    handleSend(text)
    router.setParams({ draft: '' })
  }, [draft, conversationId, handleSend, router])

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior="padding"
      // 顶栏高度由外层 View paddingTop:insets.top 承担；避键盘时不重复偏移
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
          <View style={styles.topCenter}>
            <Text style={styles.topTitle} numberOfLines={1}>
              {conv?.title ?? '对话'}
            </Text>
            {models.length > 0 ? (
              <Pressable
                onPress={openModelSheet}
                hitSlop={4}
                style={styles.modelChip}
                accessibilityRole="button"
                accessibilityLabel={`当前模型 ${currentModelInfo?.name ?? currentModel}，点击切换`}
              >
                <Text style={styles.modelChipText} numberOfLines={1}>
                  {currentModelInfo?.name ?? currentModel}
                </Text>
                <ChevronDown size={12} color={text.secondary} />
              </Pressable>
            ) : null}
          </View>
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
            <MessageList
              ref={listRef}
              convId={conversationId ?? ''}
              messages={messages}
              versionIdxs={versionIdxs}
              regeneratingPairKey={regeneratingPairKey}
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
        </View>

        {/* 输入区 */}
        <ChatInput
          streaming={isStreaming}
          onSend={handleSend}
          onStop={stop}
          bottomInset={insets.bottom}
        />
      </View>

      {/* Artifact 面板（Modal，覆盖全屏；不受键盘影响） */}
      <ArtifactSurface />

      {/* 模型选择 BottomSheet：Portal 挂在 root，不受本页布局约束 */}
      <ModelSelectorSheet
        ref={modelSheetRef}
        models={models}
        currentId={currentModel}
        onSelect={handleSelectModel}
      />
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
  topCenter: { flex: 1, alignItems: 'center', gap: 2 },
  topTitle: { fontSize: 15, fontWeight: '600', color: text.primary, maxWidth: '90%' },
  modelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
  },
  modelChipText: { fontSize: 11, color: text.secondary },
  listArea: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyHint: { fontSize: 13, color: text.muted },
})
