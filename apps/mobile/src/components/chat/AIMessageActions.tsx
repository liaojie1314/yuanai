import * as Clipboard from 'expo-clipboard'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react-native'
import { memo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { useToast } from '@/components/ui/Toast'
import { border, brand, spacing, text } from '@/theme/tokens'

export type FeedbackType = 'like' | 'dislike'

interface AIMessageActionsProps {
  /** 复制按钮要写入剪贴板的原文（Markdown 原样） */
  content: string
  /** 该问题下的回答版本总数；> 1 时显示 `‹ 2/3 ›` 切换条 */
  versionCount: number
  /** 当前展示的版本下标（0-based） */
  versionIdx: number
  onVersionChange: (idx: number) => void
  onRegenerate: () => void
  onFeedback: (type: FeedbackType) => void
  /** 已给出的反馈；用于高亮按钮 */
  feedback: FeedbackType | undefined
  /** 流式进行中：重新生成置灰 */
  busy: boolean
}

/**
 * AI 消息底部操作行：版本切换 + 复制 / 重新生成 / 点赞 / 踩。
 *
 * 纯图标直点（对齐 DeepSeek 移动端），**没有长按菜单也没有弹层**——
 * 用户明确要求所有操作一击直达；点赞/踩就是即点即记的 toggle。
 *
 * 版本切换用 `‹ 2/3 ›` 箭头条而不是 PagerView：后者要求整条回复收回单个容器，
 * 会直接回归「超长条目撑爆渲染窗口 → 整屏空白」的老问题（docs-internal 第 9 条）。
 */
export const AIMessageActions = memo(function AIMessageActions({
  content,
  versionCount,
  versionIdx,
  onVersionChange,
  onRegenerate,
  onFeedback,
  feedback,
  busy,
}: AIMessageActionsProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const toast = useToast()

  const handleCopy = (): void => {
    void Clipboard.setStringAsync(content)
    setCopied(true)
    toast.show('已复制到剪贴板')
    setTimeout(() => setCopied(false), 1500)
  }

  const handleFeedback = (type: FeedbackType): void => {
    const removing = feedback === type
    onFeedback(type)
    if (removing) toast.show('已取消反馈')
    else toast.show(type === 'like' ? '感谢反馈' : '感谢反馈，我们会改进')
  }

  const canPrev = versionIdx > 0
  const canNext = versionIdx < versionCount - 1

  return (
    <View style={styles.row}>
      {versionCount > 1 ? (
        <View style={styles.verNav}>
          <Pressable
            onPress={() => onVersionChange(versionIdx - 1)}
            disabled={!canPrev}
            hitSlop={8}
            style={styles.verBtn}
            accessibilityRole="button"
            accessibilityLabel="上一个版本"
            accessibilityState={{ disabled: !canPrev }}
          >
            <ChevronLeft size={13} color={canPrev ? text.secondary : text.muted} />
          </Pressable>
          <Text style={styles.verLabel}>
            {versionIdx + 1} / {versionCount}
          </Text>
          <Pressable
            onPress={() => onVersionChange(versionIdx + 1)}
            disabled={!canNext}
            hitSlop={8}
            style={styles.verBtn}
            accessibilityRole="button"
            accessibilityLabel="下一个版本"
            accessibilityState={{ disabled: !canNext }}
          >
            <ChevronRight size={13} color={canNext ? text.secondary : text.muted} />
          </Pressable>
        </View>
      ) : null}

      <Pressable
        onPress={handleCopy}
        hitSlop={8}
        style={styles.iconBtn}
        accessibilityRole="button"
        accessibilityLabel="复制回复"
      >
        {copied ? <Check size={15} color={brand.solid} /> : <Copy size={15} color={text.muted} />}
      </Pressable>

      <Pressable
        onPress={onRegenerate}
        disabled={busy}
        hitSlop={8}
        style={styles.iconBtn}
        accessibilityRole="button"
        accessibilityLabel="重新生成"
        accessibilityState={{ disabled: busy }}
      >
        <RotateCcw size={15} color={busy ? border.default : text.muted} />
      </Pressable>

      <Pressable
        onPress={() => handleFeedback('like')}
        hitSlop={8}
        style={styles.iconBtn}
        accessibilityRole="button"
        accessibilityLabel="有帮助"
        accessibilityState={{ selected: feedback === 'like' }}
      >
        <ThumbsUp
          size={15}
          color={feedback === 'like' ? brand.solid : text.muted}
          // 选中态：用同色填充（lucide 图标默认 fill="none"，传色值即变实心）。
          fill={feedback === 'like' ? brand.solid : 'none'}
        />
      </Pressable>
      <Pressable
        onPress={() => handleFeedback('dislike')}
        hitSlop={8}
        style={styles.iconBtn}
        accessibilityRole="button"
        accessibilityLabel="有问题"
        accessibilityState={{ selected: feedback === 'dislike' }}
      >
        <ThumbsDown
          size={15}
          color={feedback === 'dislike' ? border.danger : text.muted}
          fill={feedback === 'dislike' ? border.danger : 'none'}
        />
      </Pressable>
    </View>
  )
})

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: 2,
    paddingBottom: spacing.sm,
  },
  iconBtn: { width: 28, height: 26, alignItems: 'center', justifyContent: 'center' },
  // 版本条排在最前，视觉上作次一级信息（无边框，仅箭头 + 计数）。
  verNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginRight: spacing.xs,
  },
  verBtn: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  verLabel: { fontSize: 11, color: text.secondary, minWidth: 26, textAlign: 'center' },
})
