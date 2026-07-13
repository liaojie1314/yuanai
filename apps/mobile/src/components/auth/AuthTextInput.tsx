import { forwardRef, useState } from 'react'
import { Text, TextInput, type TextInputProps, View } from 'react-native'

import { bg, border, radius, spacing, text } from '@/theme/tokens'

export interface AuthTextInputProps extends TextInputProps {
  /** label 文本；不传则不渲染上方 label */
  label?: string
  /** 校验错误文本；非空时输入框变红边、下方显示 */
  error?: string | undefined
  /** 右侧内嵌按钮（如密码显示切换、发送验证码） */
  rightAdornment?: React.ReactNode
}

/**
 * 认证页统一 TextInput。
 *
 * 视觉规范：
 * - 高 48pt，圆角 10，focus 时边框变品牌色
 * - error 时边框变红 + 下方红字提示
 * - placeholder 用 text.muted
 * - 右侧支持一个 adornment（如密码眼睛、验证码按钮）
 */
export const AuthTextInput = forwardRef<TextInput, AuthTextInputProps>(function AuthTextInput(
  { label, error, rightAdornment, style, onFocus, onBlur, ...props },
  ref
) {
  const [focused, setFocused] = useState(false)
  const borderColor = error ? border.danger : focused ? border.focus : border.default

  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? (
        <Text
          style={{
            fontSize: 13,
            fontWeight: '500',
            color: text.primary,
            marginBottom: spacing.xs,
          }}
        >
          {label}
        </Text>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor,
          borderRadius: radius.md,
          backgroundColor: bg.surface,
          paddingRight: rightAdornment ? spacing.sm : 0,
        }}
      >
        <TextInput
          ref={ref}
          style={[
            {
              flex: 1,
              height: 48,
              paddingHorizontal: spacing.lg,
              fontSize: 15,
              color: text.primary,
            },
            style,
          ]}
          placeholderTextColor={text.muted}
          onFocus={(e) => {
            setFocused(true)
            onFocus?.(e)
          }}
          onBlur={(e) => {
            setFocused(false)
            onBlur?.(e)
          }}
          {...props}
        />
        {rightAdornment}
      </View>

      {error ? (
        <Text style={{ marginTop: spacing.xs, fontSize: 12, color: border.danger }}>{error}</Text>
      ) : null}
    </View>
  )
})
