import { Check, ChevronDown, ChevronRight, Clock, Loader, Wrench, X } from 'lucide-react-native'
import { memo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import type { ToolCall, ToolCallStatus } from '@yuanai/types'

import { border, brand, radius, spacing, text } from '@/theme/tokens'

interface StatusMeta {
  label: string
  color: string
  icon: React.JSX.Element
}

/** 工具调用状态 → 文案 / 配色 / 图标（与 web `ToolCallRow` 的语义一一对应） */
function statusMeta(status: ToolCallStatus): StatusMeta {
  switch (status) {
    case 'running':
      return { label: '进行中', color: brand.solid, icon: <Loader size={11} color={brand.solid} /> }
    case 'done':
      return { label: '已完成', color: '#16A34A', icon: <Check size={11} color="#16A34A" /> }
    case 'error':
      return { label: '失败', color: border.danger, icon: <X size={11} color={border.danger} /> }
    case 'pending':
    default:
      return { label: '等待中', color: text.muted, icon: <Clock size={11} color={text.muted} /> }
  }
}

/** 尽力把参数格式化成缩进 JSON；不是合法 JSON 就原样返回 */
function tryFormatJson(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return trimmed
  }
}

interface ToolCallRowProps {
  toolCall: ToolCall
}

/**
 * 工具调用卡片（对齐 web `apps/web/src/components/chat/ToolCallRow.tsx`）。
 *
 * 折叠态：`🔧 工具名(参数预览…)` + 耗时 + 状态徽标；
 * 展开态：完整参数 JSON / 执行结果 / 错误，长内容用水平 ScrollView 承载不撑破布局。
 *
 * memo：流式期间同一条思考块会随 token 高频重渲，已完成的工具行 props 不变可跳过。
 */
export const ToolCallRow = memo(function ToolCallRow({
  toolCall,
}: ToolCallRowProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const meta = statusMeta(toolCall.status)
  const argsPreview = toolCall.arguments.replace(/\s+/g, ' ').slice(0, 40)
  const durationLabel =
    toolCall.durationMs !== undefined ? `${(toolCall.durationMs / 1000).toFixed(1)}s` : null

  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        android_ripple={{ color: 'rgba(0,0,0,0.05)' }}
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={`工具调用 ${toolCall.name}，${meta.label}`}
        accessibilityState={{ expanded: open }}
      >
        <Wrench size={12} color={text.secondary} />
        <Text style={styles.name} numberOfLines={1}>
          {toolCall.name}
          {argsPreview ? <Text style={styles.args}>({argsPreview})</Text> : null}
        </Text>
        {durationLabel ? <Text style={styles.duration}>{durationLabel}</Text> : null}
        <View style={styles.status}>
          {meta.icon}
          <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
        </View>
        {open ? (
          <ChevronDown size={12} color={text.muted} />
        ) : (
          <ChevronRight size={12} color={text.muted} />
        )}
      </Pressable>

      {open ? (
        <View style={styles.body}>
          {toolCall.arguments ? (
            <Section label="调用参数" content={tryFormatJson(toolCall.arguments)} />
          ) : null}
          {toolCall.status === 'done' && toolCall.result ? (
            <Section label="执行结果" content={toolCall.result} />
          ) : null}
          {toolCall.status === 'error' && toolCall.error ? (
            <Section label="错误" content={toolCall.error} danger />
          ) : null}
          {toolCall.status === 'running' ? (
            <Text style={styles.runningHint}>正在执行工具，请稍候…</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  )
})

function Section({
  label,
  content,
  danger = false,
}: {
  label: string
  content: string
  danger?: boolean
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, danger && { color: border.danger }]}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sectionScroll}>
        <Text selectable style={[styles.sectionCode, danger && { color: border.danger }]}>
          {content}
        </Text>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: border.default,
    borderRadius: radius.sm,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    minHeight: 34,
  },
  name: { flex: 1, fontSize: 12, fontWeight: '600', color: text.primary },
  args: { fontWeight: '400', color: text.muted, fontFamily: 'monospace' },
  duration: { fontSize: 10, color: text.muted },
  status: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  statusText: { fontSize: 10, fontWeight: '600' },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: border.default,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  section: { gap: 2 },
  sectionLabel: { fontSize: 10, fontWeight: '600', color: text.secondary },
  sectionScroll: { backgroundColor: '#F7F7F5', borderRadius: radius.sm, padding: spacing.xs },
  sectionCode: { fontFamily: 'monospace', fontSize: 11, lineHeight: 16, color: text.primary },
  runningHint: { fontSize: 11, color: text.muted, fontStyle: 'italic' },
})
