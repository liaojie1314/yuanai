import { Send, Square } from 'lucide-react-native'
import { useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native'

import { bg, border, brand, radius, spacing, text } from '@/theme/tokens'

interface ChatInputProps {
  disabled?: boolean
  streaming?: boolean
  bottomInset?: number
  onSend: (content: string) => void
  onStop?: () => void
}

/**
 * 底部输入区（MVP 版）：多行 TextInput + 发送/停止按钮。
 *
 * 覆盖点：
 * - Enter/Return：iOS 键盘"发送"按钮走 `onSubmitEditing`；Android 上仍作为换行
 *   （这与主流 IM 一致，避免 Android 用户误发）
 * - 按钮态：streaming → 停止 (Square)；空文本 → 半透明 disabled；有文本 → 品牌色 Send
 * - `paddingBottom = bottomInset` 兜住 Home Indicator；键盘弹起时上层已用
 *   `KeyboardStickyView`/`KeyboardAvoidingView` 处理，本组件不管
 *
 * 不含（待后续 Step）：附件按钮 / 模型切换 / 语音 / 联网 & 思考 toggle
 */
export function ChatInput({
  disabled = false,
  streaming = false,
  bottomInset = 0,
  onSend,
  onStop,
}: ChatInputProps): React.JSX.Element {
  const [value, setValue] = useState('')
  const inputRef = useRef<TextInput>(null)

  const canSend = value.trim().length > 0 && !streaming && !disabled

  const handleSend = (): void => {
    const content = value.trim()
    if (!content || streaming || disabled) return
    setValue('')
    onSend(content)
  }

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(bottomInset, spacing.sm) }]}>
      <View style={styles.inner}>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={setValue}
          placeholder="输入你的问题…"
          placeholderTextColor={text.muted}
          style={styles.input}
          multiline
          // iOS 键盘"发送"键触发；Android 上换行走系统默认
          onSubmitEditing={Platform.OS === 'ios' ? handleSend : undefined}
          blurOnSubmit={Platform.OS === 'ios'}
          editable={!disabled}
          maxLength={4000}
        />
        <Pressable
          onPress={streaming ? onStop : handleSend}
          disabled={!streaming && !canSend}
          style={[
            styles.btn,
            streaming
              ? styles.btnStop
              : canSend
                ? styles.btnSend
                : [styles.btnSend, styles.btnDisabled],
          ]}
          hitSlop={4}
          accessibilityLabel={streaming ? '停止生成' : '发送'}
        >
          {streaming ? (
            <Square size={16} color="#FFFFFF" fill="#FFFFFF" />
          ) : (
            <Send size={16} color="#FFFFFF" />
          )}
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: bg.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: border.default,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    backgroundColor: bg.elevated,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    color: text.primary,
    minHeight: 24,
    maxHeight: 140,
    paddingVertical: 4,
  },
  btn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSend: { backgroundColor: brand.solid },
  btnStop: { backgroundColor: text.primary },
  btnDisabled: { opacity: 0.35 },
})
