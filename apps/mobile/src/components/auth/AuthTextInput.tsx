import { forwardRef, useState } from 'react'
import { Text, TextInput, type TextInputProps, View } from 'react-native'

import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

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
 * - 右侧支持一个 adornment（如密码显示切换、发送验证码）
 *
 * 布局稳定性：错误信息槽位**始终占据固定高度**（ERROR_SLOT_HEIGHT），
 * 无论有无错误都不改变外层高度 —— 避免错误出现/消失时输入框整列上下跳动。
 */
const ERROR_SLOT_HEIGHT = 18

export const AuthTextInput = forwardRef<TextInput, AuthTextInputProps>(function AuthTextInput(
  { label, error, rightAdornment, style, onFocus, onBlur, ...props },
  ref
) {
  const t = useTheme()
  const [focused, setFocused] = useState(false)
  const borderColor = error ? t.border.danger : focused ? t.border.focus : t.border.default

  return (
    <View style={{ marginBottom: spacing.xs }}>
      {label ? (
        <Text
          style={{
            fontSize: 13,
            fontWeight: '500',
            color: t.text.primary,
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
          backgroundColor: t.bg.surface,
        }}
      >
        <TextInput
          ref={ref}
          style={[
            {
              flex: 1,
              height: 48,
              paddingHorizontal: spacing.lg,
              paddingVertical: 0,
              fontSize: 15,
              color: t.text.primary,
            },
            style,
          ]}
          placeholderTextColor={t.text.muted}
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
        {rightAdornment ? (
          <View
            style={{
              height: 48,
              alignItems: 'center',
              justifyContent: 'center',
              paddingRight: spacing.sm,
            }}
          >
            {rightAdornment}
          </View>
        ) : null}
      </View>

      <View style={{ height: ERROR_SLOT_HEIGHT, justifyContent: 'center' }}>
        {error ? (
          <Text style={{ fontSize: 12, color: t.border.danger }} numberOfLines={1}>
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  )
})
