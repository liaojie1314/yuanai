import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react-native'
import { memo, useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { useChatStore } from '@yuanai/core/stores'
import type { ToolCall } from '@yuanai/types'

import { border, brand, radius, spacing, text } from '@/theme/tokens'

import { ToolCallRow } from './ToolCallRow'

interface ThinkBlockProps {
  /** 思考过程原文；可为空（只有工具调用的场景） */
  content: string
  /** 本轮的工具调用，按发生顺序 */
  toolCalls?: readonly ToolCall[]
  /** 流式思考进行中：默认展开、头部显示「正在思考…」 */
  active?: boolean
  /** 思考耗时（毫秒），完成后显示 */
  durationMs?: number | undefined
}

/**
 * 思考块（对齐 web `apps/web/src/components/chat/ThinkBlock.tsx`）。
 *
 * - `active` → 自动展开，头部「正在思考…」
 * - 完成 → 自动折叠，头部「已完成思考」+ 耗时；用户可手动再展开
 *
 * 移动端不做 shimmer 动画：列表在流式期间本就高频重排，
 * 再叠一个常驻动画会和 12 行切块渲染抢 JS 线程（见 docs-internal 第 8 条）。
 */
export const ThinkBlock = memo(function ThinkBlock({
  content,
  toolCalls,
  active = false,
  durationMs,
}: ThinkBlockProps): React.JSX.Element {
  const [open, setOpen] = useState(active)

  // 进入思考态自动展开；思考结束自动折叠（与 web 行为一致）
  useEffect(() => {
    setOpen(active)
  }, [active])

  const label = active ? '正在思考…' : '已完成思考'
  const durationLabel =
    !active && durationMs !== undefined && durationMs > 0
      ? `${(durationMs / 1000).toFixed(1)} 秒`
      : null
  const hasToolCalls = toolCalls !== undefined && toolCalls.length > 0

  return (
    <View style={styles.block}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        android_ripple={{ color: 'rgba(0,0,0,0.05)' }}
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
      >
        <Sparkles size={13} color={brand.solid} />
        <Text style={styles.headerLabel}>{label}</Text>
        {durationLabel ? <Text style={styles.duration}>{durationLabel}</Text> : null}
        {open ? (
          <ChevronDown size={13} color={text.muted} />
        ) : (
          <ChevronRight size={13} color={text.muted} />
        )}
      </Pressable>

      {open ? (
        <View style={styles.body}>
          {content ? (
            <Text selectable style={styles.thinkText}>
              {content}
            </Text>
          ) : null}
          {hasToolCalls ? (
            <View style={styles.toolList}>
              {toolCalls.map((tc) => (
                <ToolCallRow key={tc.id} toolCall={tc} />
              ))}
            </View>
          ) : null}
          {!content && !hasToolCalls && active ? (
            <Text style={styles.emptyHint}>正在准备…</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  )
})

/**
 * 流式态的思考块：**直接订阅 chat store**，不走 MessageList 的 rows。
 *
 * ⚠️ 这是刻意为之：`streamingThink` / `streamingToolCalls` 在流式期间每 80ms 就变一次，
 * 若把它们塞进 `rows` 的 useMemo 依赖，整个 rows 数组会随之重建 → 所有行拿到新引用 →
 * `memo` 全部失效 → 回到「每个 token 全量重渲」的 ANR 老路（docs-internal 第 8 条）。
 * 只让这一个组件订阅，重渲染范围就被锁在思考块内部。
 */
export function StreamingThinkBlock(): React.JSX.Element | null {
  const think = useChatStore((s) => s.streamingThink)
  const toolCalls = useChatStore((s) => s.streamingToolCalls)
  const durationMs = useChatStore((s) => s.streamingThinkDurationMs)
  const content = useChatStore((s) => s.streamingContent)

  if (think === '' && toolCalls.length === 0) return null

  // 有工具在跑，或正文尚未开始 → 仍处于思考态
  const active = toolCalls.some((tc) => tc.status === 'running') || content === ''

  return (
    <ThinkBlock
      content={think}
      toolCalls={toolCalls}
      active={active}
      durationMs={durationMs > 0 ? durationMs : undefined}
    />
  )
}

const styles = StyleSheet.create({
  block: {
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: border.default,
    borderRadius: radius.md,
    backgroundColor: brand.light,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    minHeight: 34,
  },
  headerLabel: { flex: 1, fontSize: 12, fontWeight: '600', color: brand.hover },
  duration: { fontSize: 11, color: text.muted },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: border.default,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  thinkText: { fontSize: 12, lineHeight: 19, color: text.secondary },
  toolList: { gap: spacing.xs },
  emptyHint: { fontSize: 12, color: text.muted, fontStyle: 'italic' },
})
