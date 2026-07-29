import { ArrowDown } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { brand, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

interface ScrollToBottomFabProps {
  /** 是否显示（列表已贴底时应隐藏） */
  visible: boolean
  onPress: () => void
  /** 流式进行中：文案提示「有新内容」 */
  streaming?: boolean
}

/**
 * 「回到底部」悬浮按钮（对齐 web `showScrollFab`）。
 *
 * 由 MessageList 的 `onScroll` 计算距底距离驱动显隐；点击 = 强制恢复跟随并贴底。
 * 用条件渲染而非透明度动画：列表在流式期间已经很吃 JS 线程，
 * 少一个常驻动画节点更稳（docs-internal 第 8 条）。
 */
export function ScrollToBottomFab({
  visible,
  onPress,
  streaming = false,
}: ScrollToBottomFabProps): React.JSX.Element | null {
  const t = useTheme()
  if (!visible) return null
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        android_ripple={{ color: 'rgba(0,0,0,0.08)', borderless: true }}
        style={[styles.fab, { borderColor: t.border.default, backgroundColor: t.bg.surface }]}
        accessibilityRole="button"
        accessibilityLabel="回到最新消息"
      >
        <ArrowDown size={16} color={brand.solid} />
        {streaming ? <Text style={[styles.label, { color: t.text.secondary }]}>新内容</Text> : null}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.md,
    alignItems: 'flex-end',
  },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 36,
    height: 36,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 5,
  },
  label: { fontSize: 11, fontWeight: '600' },
})
