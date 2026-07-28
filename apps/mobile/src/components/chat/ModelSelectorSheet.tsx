import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet'
import { Check } from 'lucide-react-native'
import { forwardRef, useCallback } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { AIModel } from '@yuanai/types'

import { bg, border, brand, radius, spacing, text } from '@/theme/tokens'

interface ModelSelectorSheetProps {
  models: readonly AIModel[]
  /** 当前生效的模型 ID（行尾打勾） */
  currentId: string
  /** 选中某个模型；由父级负责 dismiss 与后续动作 */
  onSelect: (model: AIModel) => void
}

/** provider → 头像底色（与 web MODELS 的配色语义对齐；未知 provider 用品牌色） */
const PROVIDER_COLORS: Record<string, string> = {
  deepseek: '#3B82F6',
  openai: '#10A37F',
  anthropic: '#D97706',
  qwen: '#8B5CF6',
}

function formatCtx(len: number): string {
  return len >= 1000 ? `${Math.round(len / 1000)}K` : String(len)
}

/**
 * 模型选择 BottomSheet（对齐 web 顶栏模型下拉，phase-3 §0.1 规定移动端用 BottomSheet）。
 *
 * - `@gorhom/bottom-sheet` v5：走 Provider portal 渲染，不经过 RN `Modal`，
 *   不触发 docs-internal 第 1 条的 Fabric 首帧后挂载 0 尺寸缺陷。
 * - v5 默认 dynamicSizing：内容自适应高度，模型列表短（2-6 项）无需 snapPoints。
 * - 行按压反馈用 android_ripple（函数式 style 会被 NativeWind 丢弃，docs-internal 第 2 条）。
 */
export const ModelSelectorSheet = forwardRef<BottomSheetModal, ModelSelectorSheetProps>(
  function ModelSelectorSheet({ models, currentId, onSelect }, ref) {
    const insets = useSafeAreaInsets()

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          pressBehavior="close"
        />
      ),
      []
    )

    return (
      <BottomSheetModal
        ref={ref}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        backgroundStyle={styles.sheetBg}
        handleIndicatorStyle={styles.handle}
      >
        <BottomSheetView style={[styles.body, { paddingBottom: insets.bottom + spacing.md }]}>
          <Text style={styles.title}>选择模型</Text>
          {models.map((m) => {
            const selected = m.id === currentId
            const avatarColor = PROVIDER_COLORS[m.provider.toLowerCase()] ?? brand.solid
            return (
              <Pressable
                key={m.id}
                onPress={() => onSelect(m)}
                android_ripple={{ color: 'rgba(0,0,0,0.05)' }}
                style={[styles.row, selected && styles.rowSelected]}
                accessibilityRole="button"
                accessibilityLabel={`选择模型 ${m.name}`}
                accessibilityState={{ selected }}
              >
                <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
                  <Text style={styles.avatarText}>{m.name.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={styles.info}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name} numberOfLines={1}>
                      {m.name}
                    </Text>
                    {m.isDefault ? <Text style={styles.defaultBadge}>默认</Text> : null}
                  </View>
                  <Text style={styles.desc} numberOfLines={1}>
                    {m.description || m.provider}
                    {' · '}
                    {formatCtx(m.contextLength)} 上下文
                  </Text>
                </View>
                {selected ? <Check size={18} color={brand.solid} /> : null}
              </Pressable>
            )
          })}
        </BottomSheetView>
      </BottomSheetModal>
    )
  }
)

const styles = StyleSheet.create({
  sheetBg: { backgroundColor: bg.surface, borderRadius: radius.lg },
  handle: { backgroundColor: border.default, width: 40 },
  body: { paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: text.primary,
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  rowSelected: { backgroundColor: brand.light },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  info: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  name: { fontSize: 15, fontWeight: '600', color: text.primary, flexShrink: 1 },
  defaultBadge: {
    fontSize: 10,
    fontWeight: '600',
    color: brand.hover,
    backgroundColor: brand.light,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  desc: { fontSize: 12, color: text.secondary },
})
