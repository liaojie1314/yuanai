import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { bg, brand, spacing, text } from '@/theme/tokens'

/**
 * 认证页统一外壳：品牌头 + 表单区。
 *
 * - SafeArea 顶/底 padding
 * - 键盘避让统一走 `react-native-keyboard-controller` 的 `KeyboardAwareScrollView`：
 *   它会在输入框获焦时自动把该输入框滚到键盘上方（`bottomOffset` 预留间距），
 *   Android/iOS 表现一致，解决「键盘遮住输入框/提交按钮」问题。
 *   （RN 原版 KeyboardAvoidingView 在 Android + adjustResize/translucent 下不推起。）
 * - ScrollView 允许小屏（如 iPhone SE）滚动查看底部
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}): React.JSX.Element {
  const insets = useSafeAreaInsets()
  return (
    <KeyboardAwareScrollView
      style={{ flex: 1, backgroundColor: bg.base }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: insets.top + spacing.xl,
        paddingBottom: insets.bottom + spacing.xl,
        paddingHorizontal: spacing.xl,
        justifyContent: 'center',
      }}
      keyboardShouldPersistTaps="handled"
      // 焦点输入框与键盘顶部之间预留的间距
      bottomOffset={24}
    >
      {/* Logo + 品牌 */}
      <View
        style={{
          alignItems: 'center',
          marginBottom: spacing.xl,
        }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: brand.solid,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: spacing.md,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 24, fontWeight: '700' }}>元</Text>
        </View>
        <Text
          style={{
            fontSize: 22,
            fontWeight: '600',
            color: text.primary,
            marginBottom: spacing.xs,
          }}
        >
          {title}
        </Text>
        {subtitle ? <Text style={{ fontSize: 14, color: text.secondary }}>{subtitle}</Text> : null}
      </View>

      <View>{children}</View>
      {footer ? <View style={{ marginTop: spacing.lg }}>{footer}</View> : null}
    </KeyboardAwareScrollView>
  )
}
