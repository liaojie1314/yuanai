import { Check, ChevronDown, ChevronRight, Clock, Loader, Wrench, X } from 'lucide-react-native'
import { memo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import type { ToolCall, ToolCallStatus } from '@yuanai/types'
import { useTranslation } from 'react-i18next'

import { border, brand, radius, spacing } from '@/theme/tokens'
import type { ThemeTokens } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

interface StatusMeta {
  label: string
  color: string
  icon: React.JSX.Element
}

/** 工具调用状态 → 文案 / 配色 / 图标（与 web `ToolCallRow` 的语义一一对应） */
function statusMeta(
  status: ToolCallStatus,
  label: (key: 'toolRunning' | 'toolDone' | 'toolFailed' | 'toolPending') => string
): StatusMeta {
  switch (status) {
    case 'running':
      return {
        label: label('toolRunning'),
        color: brand.solid,
        icon: <Loader size={11} color={brand.solid} />,
      }
    case 'done':
      return {
        label: label('toolDone'),
        color: '#16A34A',
        icon: <Check size={11} color="#16A34A" />,
      }
    case 'error':
      return {
        label: label('toolFailed'),
        color: border.danger,
        icon: <X size={11} color={border.danger} />,
      }
    case 'pending':
    default:
      return {
        label: label('toolPending'),
        color: '#9CA3AF',
        icon: <Clock size={11} color="#9CA3AF" />,
      }
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
  const theme = useTheme()
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const meta = statusMeta(toolCall.status, (k) => t(`chat.${k}`))
  const argsPreview = toolCall.arguments.replace(/\s+/g, ' ').slice(0, 40)
  const durationLabel =
    toolCall.durationMs !== undefined
      ? t('chat.toolDuration', { seconds: (toolCall.durationMs / 1000).toFixed(1) })
      : null

  return (
    <View
      style={[
        styles.card,
        { borderColor: theme.border.default, backgroundColor: theme.bg.surface },
      ]}
    >
      <Pressable
        onPress={() => setOpen((o) => !o)}
        android_ripple={{
          color: theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
        }}
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={`工具调用 ${toolCall.name}，${meta.label}`}
        accessibilityState={{ expanded: open }}
      >
        <Wrench size={12} color={theme.text.secondary} />
        <Text style={[styles.name, { color: theme.text.primary }]} numberOfLines={1}>
          {toolCall.name}
          {argsPreview ? (
            <Text style={[styles.args, { color: theme.text.muted }]}>({argsPreview})</Text>
          ) : null}
        </Text>
        {durationLabel ? (
          <Text style={[styles.duration, { color: theme.text.muted }]}>{durationLabel}</Text>
        ) : null}
        <View style={styles.status}>
          {meta.icon}
          <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
        </View>
        {open ? (
          <ChevronDown size={12} color={theme.text.muted} />
        ) : (
          <ChevronRight size={12} color={theme.text.muted} />
        )}
      </Pressable>

      {open ? (
        <View style={[styles.body, { borderTopColor: theme.border.default }]}>
          {toolCall.arguments ? (
            <Section
              label={t('chat.toolArgs')}
              content={tryFormatJson(toolCall.arguments)}
              t={theme}
            />
          ) : null}
          {toolCall.status === 'done' && toolCall.result ? (
            <Section label={t('chat.toolResult')} content={toolCall.result} t={theme} />
          ) : null}
          {toolCall.status === 'error' && toolCall.error ? (
            <Section label={t('chat.toolError')} content={toolCall.error} danger t={theme} />
          ) : null}
          {toolCall.status === 'running' ? (
            <Text style={[styles.runningHint, { color: theme.text.muted }]}>
              {t('common.loading')}
            </Text>
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
  t,
}: {
  label: string
  content: string
  danger?: boolean
  t: ThemeTokens
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text
        style={[
          styles.sectionLabel,
          { color: t.text.secondary },
          danger && { color: t.border.danger },
        ]}
      >
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[
          styles.sectionScroll,
          { backgroundColor: t.colorScheme === 'dark' ? t.bg.elevated : '#F7F7F5' },
        ]}
      >
        <Text
          selectable
          style={[
            styles.sectionCode,
            { color: t.text.primary },
            danger && { color: t.border.danger },
          ]}
        >
          {content}
        </Text>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    minHeight: 34,
  },
  name: { flex: 1, fontSize: 12, fontWeight: '600' },
  args: { fontWeight: '400', fontFamily: 'monospace' },
  duration: { fontSize: 10 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  statusText: { fontSize: 10, fontWeight: '600' },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  section: { gap: 2 },
  sectionLabel: { fontSize: 10, fontWeight: '600' },
  sectionScroll: { borderRadius: radius.sm, padding: spacing.xs },
  sectionCode: { fontFamily: 'monospace', fontSize: 11, lineHeight: 16 },
  runningHint: { fontSize: 11, fontStyle: 'italic' },
})
