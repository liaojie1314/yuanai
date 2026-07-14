import { StyleSheet, Text, View } from 'react-native'

import { brand, radius, spacing } from '@/theme/tokens'

interface UserMessageProps {
  content: string
}

/**
 * 用户消息气泡：右对齐 + 品牌纯色底 + 白字。
 *
 * - 不做 Markdown 渲染（用户输入是纯文本，避免 XSS-like 注入错觉）
 * - `selectable` 让长按 → 系统选中/复制生效，无需自建 ActionSheet（MVP 够用）
 * - 宽度 max 78% —— 与 iOS iMessage / Web 版视觉一致，超长会自动换行
 */
export function UserMessage({ content }: UserMessageProps): React.JSX.Element {
  return (
    <View style={styles.row}>
      <View style={styles.bubble}>
        <Text selectable style={styles.text}>
          {content}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  bubble: {
    maxWidth: '78%',
    backgroundColor: brand.solid,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.chat,
    borderBottomRightRadius: 4, // "尾巴"缺角，视觉指向发言人一侧
  },
  text: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 22,
  },
})
