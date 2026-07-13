import { LinearGradient as RawLinearGradient } from 'expo-linear-gradient'
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native'

import { brand, radius, spacing } from '@/theme/tokens'

// expo-linear-gradient@14 的 class 组件签名与本地 @types/react 18.3 存在细微
// ViewProps 差异（react-native 的 AccessibilityRole 补丁），走一次 as 断言
// 让 JSX 层面认它为宽松组件；运行时行为不变。
type GradientProps = React.PropsWithChildren<{
  colors: readonly [string, string]
  start?: { x: number; y: number }
  end?: { x: number; y: number }
  style?: ViewStyle | ViewStyle[] | Array<ViewStyle | false | undefined | null>
}>
const LinearGradient = RawLinearGradient as unknown as React.ComponentType<GradientProps>

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
 * - primary：品牌渐变底 + 白字，高 48
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

  // expo-linear-gradient 14 的 colors 需要 tuple 而非 string[]
  const gradientColors = [brand.from, brand.to] as readonly [string, string]

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={[isDisabled && styles.disabled, style]}
    >
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.base, styles.primary]}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text style={styles.primaryLabel}>{label}</Text>
        )}
      </LinearGradient>
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
  primary: {},
  primaryLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: brand.solid,
  },
  secondaryLabel: { color: brand.solid, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.55 },
})
