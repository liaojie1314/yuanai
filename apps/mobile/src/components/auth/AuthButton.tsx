import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native'

import { brand, radius, spacing } from '@/theme/tokens'

interface AuthButtonProps {
  label: string
  onPress: () => void
  loading?: boolean
  disabled?: boolean
  variant?: 'primary' | 'secondary'
  style?: ViewStyle
}

/**
 * 认证页主按钮。
 * - primary：品牌纯色底 + 白字，高 48（对齐 web `.btn` — flat solid #3b82f6）
 * - secondary：透明底 + 品牌色描边 + 品牌色字，用于三方登录 / 次要 action
 * - loading：显示 ActivityIndicator 替代文字，disabled 状态
 */
export function AuthButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
  style,
}: AuthButtonProps): React.JSX.Element {
  const isDisabled = disabled || loading

  if (variant === 'secondary') {
    return (
      <Pressable
        onPress={onPress}
        disabled={isDisabled}
        style={[styles.base, styles.secondary, isDisabled && styles.disabled, style]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={brand.solid} />
        ) : (
          <Text style={styles.secondaryLabel}>{label}</Text>
        )}
      </Pressable>
    )
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      // 用 android_ripple + opacity 提供按压反馈；不用 style 函数（会被
      // NativeWind css-interop 的 jsx-runtime 忽略）
      android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
      style={[styles.base, styles.primary, isDisabled && styles.disabled, style]}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#FFFFFF" />
      ) : (
        <Text style={styles.primaryLabel}>{label}</Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primary: {
    backgroundColor: brand.solid,
  },
  primaryLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: brand.solid,
  },
  secondaryLabel: { color: brand.solid, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.55 },
})
