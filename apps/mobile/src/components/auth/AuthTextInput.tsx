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
  const [focused, setFocused] = useState(false)
  const borderColor = error ? border.danger : focused ? border.focus : border.default

  return (
    <View style={{ marginBottom: spacing.sm }}>
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
        {/* adornment 用 48pt 高居中容器包裹，保证图标/按钮垂直居中 */}
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

      {/* 固定高度错误槽：有错误显示红字，无错误留白，杜绝布局位移 */}
      <View style={{ height: ERROR_SLOT_HEIGHT, justifyContent: 'center' }}>
        {error ? (
          <Text style={{ fontSize: 12, color: border.danger }} numberOfLines={1}>
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  )
})
