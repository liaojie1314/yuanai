import { ChevronRight } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native'

import { brand, radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

/** 设置分组卡片：白底圆角，内部行之间 hairline 分隔 */
export function SettingsGroup({
  label,
  children,
}: {
  label?: string
  children: ReactNode
}): React.JSX.Element {
  const t = useTheme()
  return (
    <View style={[styles.groupWrap, { marginBottom: t.density.settingsBlkMb }]}>
      {label ? (
        <Text
          style={[styles.groupLabel, { color: t.text.secondary, fontSize: t.typography.caption }]}
        >
          {label}
        </Text>
      ) : null}
      <View
        style={[styles.groupCard, { backgroundColor: t.bg.surface, borderColor: t.border.default }]}
      >
        {children}
      </View>
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
  const t = useTheme()
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={{
        color: t.colorScheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
      }}
      style={[
        styles.row,
        { paddingVertical: t.density.settingsRowPy },
        divider && styles.rowDivider,
        divider && { borderBottomColor: t.border.default },
        disabled && { opacity: 0.5 },
      ]}
    >
      {icon ? <View style={styles.rowIcon}>{icon}</View> : null}
      <View style={styles.rowLabelWrap}>
        <Text
          style={[
            styles.rowLabel,
            { color: t.text.primary, fontSize: t.typography.body },
            destructive && { color: t.border.danger },
          ]}
        >
          {label}
        </Text>
        {sublabel ? (
          <Text
            style={[styles.rowSublabel, { color: t.text.muted, fontSize: t.typography.caption }]}
          >
            {sublabel}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text
          style={[styles.rowValue, { color: t.text.secondary, fontSize: t.typography.title }]}
          numberOfLines={1}
        >
          {value}
        </Text>
      ) : null}
      <ChevronRight size={16} color={t.text.muted} />
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
  const t = useTheme()
  return (
    <View
      style={[
        styles.row,
        { paddingVertical: t.density.settingsRowPy },
        divider && styles.rowDivider,
        divider && { borderBottomColor: t.border.default },
      ]}
    >
      {icon ? <View style={styles.rowIcon}>{icon}</View> : null}
      <View style={styles.rowLabelWrap}>
        <Text style={[styles.rowLabel, { color: t.text.primary, fontSize: t.typography.body }]}>
          {label}
        </Text>
        {sublabel ? (
          <Text
            style={[styles.rowSublabel, { color: t.text.muted, fontSize: t.typography.caption }]}
          >
            {sublabel}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: t.border.default, true: brand.solid }}
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
  const t = useTheme()
  return (
    <View
      style={[
        styles.segmentRow,
        { paddingVertical: t.density.settingsRowPy },
        divider && styles.rowDivider,
        divider && { borderBottomColor: t.border.default },
      ]}
    >
      <Text style={[styles.rowLabel, { color: t.text.primary, fontSize: t.typography.body }]}>
        {label}
      </Text>
      <View style={styles.segmentWrap}>
        {options.map((opt) => {
          const active = opt.value === selected
          return (
            <Pressable
              key={opt.value}
              onPress={() => onSelect(opt.value)}
              style={[
                styles.segmentItem,
                { borderColor: t.border.default, backgroundColor: t.bg.base },
                active && { borderColor: t.brand.solid, backgroundColor: t.brand.selected },
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  {
                    color: active ? t.brand.selectedFg : t.text.secondary,
                    fontSize: t.typography.caption,
                  },
                  active && styles.segmentTextActive,
                ]}
              >
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
  groupWrap: { marginBottom: 0 },
  groupLabel: {
    marginBottom: spacing.xs,
    marginLeft: spacing.xs,
  },
  groupCard: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: { width: 22, alignItems: 'center' },
  rowLabelWrap: { flex: 1, gap: 2 },
  rowLabel: {},
  rowSublabel: {},
  rowValue: { maxWidth: 150 },
  segmentRow: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  segmentWrap: { flexDirection: 'row', gap: spacing.sm },
  segmentItem: {
    flex: 1,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: {},
  segmentTextActive: { fontWeight: '600' },
})
