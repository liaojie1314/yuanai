import type { ReactNode } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { bg, brand, spacing, text } from '@/theme/tokens'

/**
 * 认证页统一外壳：品牌头 + 表单区。
 *
 * - SafeArea 顶/底 padding
 * - iOS 用 KeyboardAvoidingView padding；Android 依赖 react-native-keyboard-controller 的 windowSoftInputMode=adjustResize
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
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: bg.base }}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + spacing.xl,
          paddingBottom: insets.bottom + spacing.xl,
          paddingHorizontal: spacing.xl,
          justifyContent: 'center',
        }}
        keyboardShouldPersistTaps="handled"
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
          {subtitle ? (
            <Text style={{ fontSize: 14, color: text.secondary }}>{subtitle}</Text>
          ) : null}
        </View>

        <View>{children}</View>
        {footer ? <View style={{ marginTop: spacing.lg }}>{footer}</View> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
