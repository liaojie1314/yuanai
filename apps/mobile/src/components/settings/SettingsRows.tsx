import { ChevronRight } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native'

import { bg, border, brand, radius, spacing, text } from '@/theme/tokens'

/** 设置分组卡片：白底圆角，内部行之间 hairline 分隔 */
export function SettingsGroup({
  label,
  children,
}: {
  label?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <View style={styles.groupWrap}>
      {label ? <Text style={styles.groupLabel}>{label}</Text> : null}
      <View style={styles.groupCard}>{children}</View>
    </View>
  )
}

interface RowBaseProps {
  label: string
  /** 行首图标（16-20pt） */
  icon?: ReactNode
  /** label 下方的次要说明文字 */
  sublabel?: string | undefined
  /** 红色文字（危险操作） */
  destructive?: boolean
  /** 是否显示行底部分隔线（组内最后一行传 false） */
  divider?: boolean
}

/** 点按行：右侧 chevron + 可选 value 文本 */
export function SettingsRow({
  label,
  icon,
  sublabel,
  value,
  destructive,
  divider = true,
  disabled,
  onPress,
}: RowBaseProps & {
  value?: string
  disabled?: boolean
  onPress: () => void
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: 'rgba(0,0,0,0.05)' }}
      style={[styles.row, divider && styles.rowDivider, disabled && { opacity: 0.5 }]}
    >
      {icon ? <View style={styles.rowIcon}>{icon}</View> : null}
      <View style={styles.rowLabelWrap}>
        <Text style={[styles.rowLabel, destructive && { color: border.danger }]}>{label}</Text>
        {sublabel ? <Text style={styles.rowSublabel}>{sublabel}</Text> : null}
      </View>
      {value ? (
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      <ChevronRight size={16} color={text.muted} />
    </Pressable>
  )
}

/** 开关行 */
export function SettingsSwitchRow({
  label,
  icon,
  sublabel,
  divider = true,
  value,
  onValueChange,
}: RowBaseProps & {
  value: boolean
  onValueChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <View style={[styles.row, divider && styles.rowDivider]}>
      {icon ? <View style={styles.rowIcon}>{icon}</View> : null}
      <View style={styles.rowLabelWrap}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sublabel ? <Text style={styles.rowSublabel}>{sublabel}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: border.default, true: brand.solid }}
        thumbColor="#FFFFFF"
      />
    </View>
  )
}

/** 单选段：一行内的多个互斥选项（外观屏 theme/fontSize/density 用） */
export function SettingsSegmentRow({
  label,
  options,
  selected,
  divider = true,
  onSelect,
}: {
  label: string
  options: { value: string; label: string }[]
  selected: string
  divider?: boolean
  onSelect: (value: string) => void
}): React.JSX.Element {
  return (
    <View style={[styles.segmentRow, divider && styles.rowDivider]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.segmentWrap}>
        {options.map((opt) => {
          const active = opt.value === selected
          return (
            <Pressable
              key={opt.value}
              onPress={() => onSelect(opt.value)}
              style={[styles.segmentItem, active && styles.segmentItemActive]}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {opt.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  groupWrap: { marginBottom: spacing.lg },
  groupLabel: {
    fontSize: 13,
    color: text.secondary,
    marginBottom: spacing.xs,
    marginLeft: spacing.xs,
  },
  groupCard: {
    backgroundColor: bg.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: border.default,
  },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: border.default,
  },
  rowIcon: { width: 22, alignItems: 'center' },
  rowLabelWrap: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15, color: text.primary },
  rowSublabel: { fontSize: 12, color: text.muted },
  rowValue: { fontSize: 14, color: text.secondary, maxWidth: 150 },
  segmentRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  segmentWrap: { flexDirection: 'row', gap: spacing.sm },
  segmentItem: {
    flex: 1,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: border.default,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: bg.base,
  },
  segmentItemActive: { borderColor: brand.solid, backgroundColor: brand.light },
  segmentText: { fontSize: 13, color: text.secondary },
  segmentTextActive: { color: brand.solid, fontWeight: '600' },
})
