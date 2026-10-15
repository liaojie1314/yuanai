import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet'
import { Bot, Check } from 'lucide-react-native'
import { forwardRef, useCallback } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import type { Assistant } from '@yuanai/types'

import { brand, radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

interface AssistantSelectorSheetProps {
  /** 当前用户的全部助理 */
  assistants: readonly Assistant[]
  /** 当前生效的助理 ID（行尾打勾） */
  currentId: string
  /** 选中某个助理；由父级负责 dismiss 与后续动作 */
  onSelect: (assistant: Assistant) => void
}

/**
 * 助理选择 BottomSheet，与模型选择器 `ModelSelectorSheet` 同款控件。
 *
 * - 之前用 `Dialog` 的居中 ActionSheet：同一条头部里两个同类选择器用两种控件，
 *   而且那张卡片既无 `maxHeight` 也不可滚，助理一多底部选项连「取消」一起被挤出屏幕。
 * - 助理数量无上限，所以这里用 `BottomSheetScrollView` 而不是 `BottomSheetView`：
 *   内容超过 sheet 最大高度时能滚，不会被裁掉。
 */
export const AssistantSelectorSheet = forwardRef<BottomSheetModal, AssistantSelectorSheetProps>(
  function AssistantSelectorSheet({ assistants, currentId, onSelect }, ref) {
    const theme = useTheme()
    const { t } = useTranslation()
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
        backgroundStyle={[styles.sheetBg, { backgroundColor: theme.bg.surface }]}
        handleIndicatorStyle={[styles.handle, { backgroundColor: theme.border.default }]}
      >
        <BottomSheetScrollView
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.md }]}
        >
          <Text style={[styles.title, { color: theme.text.primary }]}>
            {t('chat.assistant.switch')}
          </Text>
          {assistants.map((item) => {
            const selected = item.id === currentId
            return (
              <Pressable
                key={item.id}
                onPress={() => onSelect(item)}
                android_ripple={{
                  color:
                    theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
                }}
                style={[styles.row, selected && { backgroundColor: theme.brand.selected }]}
                accessibilityRole="button"
                accessibilityLabel={`${t('chat.assistant.switch')} ${item.name}`}
                accessibilityState={{ selected }}
              >
                <View style={[styles.avatar, { backgroundColor: brand.solid }]}>
                  <Bot size={18} color="#FFFFFF" />
                </View>
                <View style={styles.info}>
                  <View style={styles.nameRow}>
                    <Text style={[styles.name, { color: theme.text.primary }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {item.isDefault ? (
                      <Text
                        style={[
                          styles.defaultBadge,
                          { color: theme.brand.selectedFg, backgroundColor: theme.brand.selected },
                        ]}
                      >
                        {t('chat.assistant.default')}
                      </Text>
                    ) : null}
                  </View>
                  {item.description ? (
                    <Text style={[styles.desc, { color: theme.text.secondary }]} numberOfLines={1}>
                      {item.description}
                    </Text>
                  ) : null}
                </View>
                {selected ? <Check size={18} color={brand.solid} /> : null}
              </Pressable>
            )
          })}
        </BottomSheetScrollView>
      </BottomSheetModal>
    )
  }
)

const styles = StyleSheet.create({
  sheetBg: { borderRadius: radius.lg },
  handle: { width: 40 },
  body: { paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  title: {
    fontSize: 15,
    fontWeight: '700',
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
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  name: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  // 选中态与默认徽章的底色必须走主题：brand.light 是明色专用的近白色，
  // 暗色下会铺成白块，再叠上同样接近白色的 text.primary，标题直接读不出来。
  defaultBadge: {
    fontSize: 10,
    fontWeight: '600',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  desc: { fontSize: 12 },
})
