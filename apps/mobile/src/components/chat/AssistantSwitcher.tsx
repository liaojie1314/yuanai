import { Bot, ChevronDown } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { Assistant } from '@yuanai/types'

import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

interface AssistantSwitcherProps {
  /** 当前用户的全部助理 */
  assistants: readonly Assistant[]
  /** 会话已绑定的助理；`null` 表示未绑定，按后端顺序回落到默认助理 */
  activeAssistantId: string | null
  /** 点开选单，由调用方弹 `AssistantSelectorSheet`；新会话屏也必须能选，所以不接受省略 */
  onPress: () => void
}

/**
 * 会话头部的当前助理标签与切换入口。
 *
 * 选单用 `AssistantSelectorSheet`（BottomSheet），与模型选择器同款控件：
 * 原先复用 `Dialog` 的居中 ActionSheet，和旁边的模型选择器不是一种交互，
 * 而且那张卡片不可滚，助理一多就选不到后面的。
 * 只有一个助理时退化成纯文字标签，唯一选项的选单是纯噪音。
 */
export function AssistantSwitcher({
  assistants,
  activeAssistantId,
  onPress,
}: AssistantSwitcherProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const theme = useTheme()
  if (assistants.length === 0) return null
  // 与后端解析默认助理的顺序一致：先看会话绑定，再看 isDefault，最后退回第一个
  const active =
    assistants.find((item) => item.id === activeAssistantId) ??
    assistants.find((item) => item.isDefault) ??
    assistants[0]
  if (!active) return null

  if (assistants.length === 1) {
    return (
      <View style={styles.chip}>
        <Bot size={12} color={theme.text.secondary} />
        <Text
          numberOfLines={1}
          style={[styles.label, { color: theme.text.secondary }]}
          accessibilityLabel={t('chat.assistant.current')}
        >
          {active.name}
        </Text>
      </View>
    )
  }

  return (
    <Pressable
      accessibilityLabel={t('chat.assistant.switch')}
      accessibilityRole="button"
      hitSlop={4}
      onPress={onPress}
      style={styles.chip}
    >
      <Bot size={12} color={theme.text.secondary} />
      <Text numberOfLines={1} style={[styles.label, { color: theme.text.secondary }]}>
        {active.name}
      </Text>
      <ChevronDown size={12} color={theme.text.secondary} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    // 与模型选择器并排一行，助理名长时让它先缩，别把模型挤出屏幕
    flexShrink: 1,
    maxWidth: '100%',
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
  },
  label: { fontSize: 11, flexShrink: 1 },
})
