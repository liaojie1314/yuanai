import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { parseCsv } from '@yuanai/core'

import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'
import type { ThemeTokens } from '@/theme/tokens'
import { useTranslation } from 'react-i18next'

interface ArtifactDataPreviewProps {
  lang: string
  code: string
}

/**
 * JSON/CSV 数据预览（对齐 web ArtifactPanel DataPreview）：
 * - CSV：表头 + 行的表格（横向可滚）
 * - JSON：可折叠树，标量按类型着色；解析失败显示错误
 */
export function ArtifactDataPreview({ lang, code }: ArtifactDataPreviewProps): React.JSX.Element {
  const theme = useTheme()
  const { t } = useTranslation()
  const l = lang.toLowerCase()

  if (l === 'csv') {
    const rows = parseCsv(code)
    if (rows.length === 0) {
      return (
        <View style={styles.center}>
          <Text style={{ color: theme.text.muted }}>{t('chat.dataEmptyCsv')}</Text>
        </View>
      )
    }
    const [head, ...body] = rows
    return (
      <ScrollView style={styles.fill} contentContainerStyle={{ padding: spacing.lg }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={[styles.table, { borderColor: theme.border.default }]}>
            <View style={[styles.tr, { backgroundColor: theme.bg.elevated }]}>
              {(head ?? []).map((cell, i) => (
                <Text
                  key={i}
                  style={[
                    styles.th,
                    { color: theme.text.primary, borderColor: theme.border.default },
                  ]}
                  numberOfLines={1}
                >
                  {cell}
                </Text>
              ))}
            </View>
            {body.map((r, ri) => (
              <View key={ri} style={styles.tr}>
                {r.map((cell, ci) => (
                  <Text
                    key={ci}
                    style={[
                      styles.td,
                      { color: theme.text.secondary, borderColor: theme.border.default },
                    ]}
                    numberOfLines={2}
                  >
                    {cell}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      </ScrollView>
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(code)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return (
      <View style={styles.center}>
        <Text style={{ color: theme.border.danger }}>{t('chat.dataJsonError', { msg })}</Text>
      </View>
    )
  }
  return (
    <ScrollView style={styles.fill} contentContainerStyle={{ padding: spacing.lg }}>
      <JsonNode value={parsed} theme={theme} />
    </ScrollView>
  )
}

/** JSON 树节点（递归渲染，对象/数组可折叠，标量按类型着色） */
function JsonNode({
  name,
  value,
  theme,
}: {
  name?: string
  value: unknown
  theme: ThemeTokens
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const isObject = typeof value === 'object' && value !== null
  const keyLabel =
    name === undefined ? null : (
      <Text style={[styles.jsonKey, { color: theme.brand.selectedFg }]}>{name}: </Text>
    )

  if (!isObject) {
    let color = theme.text.primary
    if (typeof value === 'string') color = '#4CAF50'
    else if (typeof value === 'number') color = '#E5A158'
    else if (typeof value === 'boolean') color = '#C678DD'
    else if (value === null) color = theme.text.muted
    const text = typeof value === 'string' ? `"${value}"` : String(value)
    return (
      <View style={styles.jsonRow}>
        {keyLabel}
        <Text style={[styles.jsonVal, { color }]}>{text}</Text>
      </View>
    )
  }

  const isArray = Array.isArray(value)
  const entries: [string, unknown][] = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(value as Record<string, unknown>)
  const open = isArray ? '[' : '{'
  const close = isArray ? ']' : '}'

  return (
    <View>
      <Pressable onPress={() => setCollapsed((c) => !c)} style={styles.jsonRow} hitSlop={4}>
        {collapsed ? (
          <ChevronRight size={12} color={theme.text.muted} />
        ) : (
          <ChevronDown size={12} color={theme.text.muted} />
        )}
        {keyLabel}
        <Text style={[styles.jsonVal, { color: theme.text.secondary }]}>
          {open}
          {collapsed ? ` … ${String(entries.length)} ${close}` : ''}
        </Text>
      </Pressable>
      {!collapsed ? (
        <View style={styles.jsonChildren}>
          {entries.map(([k, v]) => (
            <JsonNode key={k} name={k} value={v} theme={theme} />
          ))}
          <Text style={[styles.jsonVal, { color: theme.text.secondary }]}>{close}</Text>
        </View>
      ) : null}
    </View>
  )
}

const CELL_W = 120

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  tr: { flexDirection: 'row' },
  th: {
    width: CELL_W,
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  td: {
    width: CELL_W,
    fontSize: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  jsonRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 1 },
  jsonKey: { fontSize: 12, fontFamily: 'monospace' },
  jsonVal: { fontSize: 12, fontFamily: 'monospace' },
  jsonChildren: { paddingLeft: spacing.lg },
})
