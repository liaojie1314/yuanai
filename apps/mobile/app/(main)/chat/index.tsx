import type { BottomSheetModal } from '@gorhom/bottom-sheet'
import { useNavigation, useRouter } from 'expo-router'
import { ChevronDown, Menu } from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Pressable, Text, useWindowDimensions, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { TABLET_MIN_WIDTH, useCreateConversation, useModels } from '@yuanai/core'
import type { AIModel } from '@yuanai/types'

import { ChatInput } from '@/components/chat/ChatInput'
import { ModelSelectorSheet } from '@/components/chat/ModelSelectorSheet'
import { useDialog } from '@/components/ui/Dialog'
import { brand, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

/**
 * `/chat` 新会话落地屏：登录后的默认页，直接可聊天。
 *
 * - 顶栏：手机端渲染打开抽屉按钮（平板侧栏固定展开，不显示）
 * - 中部：品牌 logo + 欢迎语（空态视觉）
 * - 底部：ChatInput —— 用户直接输入即可开始
 *
 * 首次发送流程（对齐 web `ChatInterface`）：
 * 1. 用输入内容前 30 字作为标题创建会话
 * 2. `router.replace` 到 `/(main)/chat/[id]`，并把这条消息作为 `draft` 参数带过去
 * 3. 目标会话页在挂载时检测到 `draft` → 自动发送并触发流式
 *
 * 用 `replace` 而非 `push`：避免返回键回到空的新会话页。
 */
export default function ChatNewScreen(): React.JSX.Element {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const isTablet = width >= TABLET_MIN_WIDTH
  const navigation = useNavigation()
  const router = useRouter()
  const dialog = useDialog()

  const createConv = useCreateConversation()
  const { data: models = [] } = useModels()
  const [submitting, setSubmitting] = useState(false)
  // 用户在空态屏选的模型（会话尚未创建，暂存本地；创建时作为 model 参数带出）
  const [pickedModelId, setPickedModelId] = useState<string | null>(null)
  const modelSheetRef = useRef<BottomSheetModal>(null)
  // 防抖：创建 + 跳转有异步窗口，避免连点发送创建多个会话
  const busyRef = useRef(false)

  // 已选或默认或列表首个（后两个是 fallback；本屏一定有 models 之后再展示）
  const activeModelId = useMemo(() => {
    if (pickedModelId && models.some((m) => m.id === pickedModelId)) return pickedModelId
    const def = models.find((m) => m.isDefault)
    return def?.id ?? models[0]?.id ?? 'deepseek-v4-flash'
  }, [pickedModelId, models])
  const activeModel = useMemo(
    () => models.find((m) => m.id === activeModelId),
    [models, activeModelId]
  )

  // models 首次到达时若用户还没手动选过，同步一次默认到 pickedModelId，
  // 保证 chip 显示与实际发送的一致；后续手动切换不再被覆盖。
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

  const handleSend = useCallback(
    (content: string, fileIds?: string[]): void => {
      if (busyRef.current) return
      busyRef.current = true
      setSubmitting(true)
      void (async () => {
        try {
          const title = content.slice(0, 30) + (content.length > 30 ? '…' : '')
          const conv = await createConv.mutateAsync({ model: activeModelId, title })
          // 首条消息和附件 fileIds 作为 params 带到会话页，由其自动发送
          router.replace({
            pathname: '/(main)/chat/[conversationId]',
            params: {
              conversationId: conv.id,
              draft: content,
              ...(fileIds && fileIds.length > 0 ? { draftFileIds: JSON.stringify(fileIds) } : {}),
            },
          })
        } catch (err) {
          void dialog.alert({
            title: '发送失败',
            message: err instanceof Error ? err.message : '创建会话失败，请稍后重试',
          })
          busyRef.current = false
          setSubmitting(false)
        }
        // 成功后不复位 busyRef：本屏即将被 replace 卸载
      })()
    },
    [createConv, activeModelId, router, dialog]
  )

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: t.bg.base }]}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <View style={[styles.inner, { paddingTop: insets.top }]}>
        {!isTablet ? (
          <View style={styles.topBar}>
            <Pressable
              onPress={openDrawer}
              hitSlop={8}
              style={styles.topBtn}
              accessibilityLabel="打开侧边栏"
            >
              <Menu size={20} color={t.text.primary} />
            </Pressable>
            <View style={styles.topCenter}>
              <Text style={[styles.topTitle, { color: t.text.primary }]}>元AI</Text>
              {models.length > 0 ? (
                <Pressable
                  onPress={openModelSheet}
                  hitSlop={4}
                  style={styles.modelChip}
                  accessibilityRole="button"
                  accessibilityLabel={`当前模型 ${activeModel?.name ?? activeModelId}，点击切换`}
                >
                  <Text
                    style={[styles.modelChipText, { color: t.text.secondary }]}
                    numberOfLines={1}
                  >
                    {activeModel?.name ?? activeModelId}
                  </Text>
                  <ChevronDown size={12} color={t.text.secondary} />
                </Pressable>
              ) : null}
            </View>
            <View style={styles.topBtn} />
          </View>
        ) : null}

        <View style={styles.body}>
          <View style={styles.brandBadge}>
            <Text style={styles.brandBadgeText}>元</Text>
          </View>
          <Text style={[styles.title, { color: t.text.primary }]}>你好，我是元AI</Text>
          <Text style={[styles.subtitle, { color: t.text.secondary }]}>
            有什么可以帮你的？在下面直接输入开始对话吧
          </Text>
        </View>

        <ChatInput streaming={submitting} onSend={handleSend} bottomInset={insets.bottom} />
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
  },
  topBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topCenter: { flex: 1, alignItems: 'center', gap: 2 },
  topTitle: { fontSize: 15, fontWeight: '600' },
  modelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
  },
  modelChipText: { fontSize: 11 },
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
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 14, textAlign: 'center' },
})
