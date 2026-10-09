import { Bot, ChevronDown } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { Assistant } from '@yuanai/types'

import { useDialog } from '@/components/ui/Dialog'
import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

interface AssistantSwitcherProps {
  /** 当前用户的全部助理 */
  assistants: readonly Assistant[]
  /** 会话已绑定的助理；`null` 表示未绑定，按后端顺序回落到默认助理 */
  activeAssistantId: string | null
  /** 选了另一个助理，由调用方负责把会话绑过去 */
  onSelect: (assistantId: string) => void
}

/**
 * 会话头部的当前助理标签与切换器。
 *
 * 移动端本轮只做标签与切换，助理增删改与人格编辑器仍只在 Web 端。
 * 选单复用 `components/ui/Dialog` 的 ActionSheet，不新引依赖；
 * 只有一个助理时退化成纯文字标签，唯一选项的选单是纯噪音。
 */
export function AssistantSwitcher({
  assistants,
  activeAssistantId,
  onSelect,
}: AssistantSwitcherProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const theme = useTheme()
  const dialog = useDialog()
  if (assistants.length === 0) return null
  // 与后端解析默认助理的顺序一致：先看会话绑定，再看 isDefault，最后退回第一个
  const active =
    assistants.find((item) => item.id === activeAssistantId) ??
    assistants.find((item) => item.isDefault) ??
    assistants[0]
  if (!active) return null

  const open = async (): Promise<void> => {
    const choice = await dialog.actionSheet({
      title: t('chat.assistant.switch'),
      actions: assistants.map((item) => ({ label: item.name })),
    })
    const picked = assistants[choice]
    // 取消返回 -1；选回当前助理不必白跑一次 PATCH
    if (!picked || picked.id === active.id) return
    onSelect(picked.id)
  }

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
      onPress={() => void open()}
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
    maxWidth: '100%',
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
  },
  label: { fontSize: 11, flexShrink: 1 },
})
