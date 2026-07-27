import { Globe, Mic, Paperclip, Send, Sparkles, Square } from 'lucide-react-native'
import { useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native'

import { usePrefsStore } from '@yuanai/core/stores'

import { bg, border, brand, radius, spacing, text } from '@/theme/tokens'
import { useDialog } from '@/components/ui/Dialog'

interface ChatInputProps {
  disabled?: boolean
  streaming?: boolean
  bottomInset?: number
  onSend: (content: string) => void
  onStop?: () => void
}

/**
 * 底部输入区（Step 7 视觉美化版）。
 *
 * 结构（从外到内）：
 *   wrap（安全区背景带）
 *     card（白底大圆角 + 轻投影，视觉主体）
 *       tools 行：📎 附件 / 🎙 语音 / Globe 联网 / Sparkles 思考（**占位**，弹「稍后」）
 *       input 行：多行 TextInput + 发送/停止 pill 按钮
 *
 * 交互：
 * - iOS 键盘"发送"键：`onSubmitEditing` 触发 handleSend；Android 保留换行（IM 惯例）
 * - streaming 中：pill 变深色 + Square 图标 = 停止
 * - 空文本：pill 半透明 disabled
 *
 * 占位按钮说明：MVP 有意保留视觉密度但不落功能。
 * 附件/语音/联网/思考 的真实实现分别依赖：
 *   - expo-image-picker / expo-document-picker + /files 上传接口
 *   - expo-av + Whisper 或 /audio 接口
 *   - 后端 online-search tool + 流式协议扩展
 *   - 后端 reasoning-mode 标记 + 模型侧支持
 * 一次落 UI + 后端接线较重，Step 7 只做视觉；点击弹自定义 Dialog 表明"稍后"。
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
  const dialog = useDialog()
  // 深度思考开关：直接复用两端共享的 prefs store（web 端同一字段），
  // 发送时聊天页从 store 读取 showThinking 组装 enableThinking。
  const showThinking = usePrefsStore((s) => s.showThinking)
  const setShowThinking = usePrefsStore((s) => s.setShowThinking)

  const canSend = value.trim().length > 0 && !streaming && !disabled

  const handleSend = (): void => {
    const content = value.trim()
    if (!content || streaming || disabled) return
    setValue('')
    onSend(content)
  }

  const notReady = (label: string) => (): void => {
    void dialog.alert({ title: label, message: '此功能稍后开放，敬请期待。' })
  }

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(bottomInset, spacing.sm) }]}>
      <View style={styles.card}>
        {/* 工具行：占位按钮，视觉密度对齐 web */}
        <View style={styles.tools}>
          <Pressable
            onPress={notReady('附件')}
            hitSlop={6}
            style={styles.toolBtn}
            accessibilityLabel="附件（稍后开放）"
          >
            <Paperclip size={17} color={text.secondary} />
          </Pressable>
          <Pressable
            onPress={notReady('语音')}
            hitSlop={6}
            style={styles.toolBtn}
            accessibilityLabel="语音输入（稍后开放）"
          >
            <Mic size={17} color={text.secondary} />
          </Pressable>
          <Pressable
            onPress={notReady('联网搜索')}
            hitSlop={6}
            style={styles.toolBtn}
            accessibilityLabel="联网搜索（稍后开放）"
          >
            <Globe size={17} color={text.secondary} />
          </Pressable>
          <Pressable
            onPress={() => setShowThinking(!showThinking)}
            hitSlop={6}
            style={[styles.toolBtn, showThinking && styles.toolBtnActive]}
            accessibilityLabel={showThinking ? '关闭深度思考' : '开启深度思考'}
            accessibilityState={{ selected: showThinking }}
          >
            <Sparkles size={17} color={showThinking ? brand.solid : text.secondary} />
          </Pressable>
        </View>

        {/* 输入行 */}
        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={setValue}
            placeholder="问点什么…"
            placeholderTextColor={text.muted}
            style={styles.input}
            multiline
            onSubmitEditing={Platform.OS === 'ios' ? handleSend : undefined}
            blurOnSubmit={Platform.OS === 'ios'}
            editable={!disabled}
            maxLength={4000}
            textAlignVertical="top"
          />
          <Pressable
            onPress={streaming ? onStop : handleSend}
            disabled={!streaming && !canSend}
            style={[
              styles.sendBtn,
              streaming
                ? styles.sendBtnStop
                : canSend
                  ? styles.sendBtnActive
                  : styles.sendBtnDisabled,
            ]}
            hitSlop={4}
            accessibilityLabel={streaming ? '停止生成' : '发送'}
          >
            {streaming ? (
              <Square size={15} color="#FFFFFF" fill="#FFFFFF" />
            ) : (
              <Send size={15} color="#FFFFFF" />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: bg.base,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  card: {
    backgroundColor: bg.surface,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: border.default,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    // 轻投影，iOS/Android 分别调
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  tools: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingBottom: spacing.xs,
  },
  toolBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: bg.elevated,
  },
  toolBtnActive: { backgroundColor: brand.light },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  input: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: text.primary,
    minHeight: 32,
    maxHeight: 120,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  sendBtn: {
    height: 34,
    minWidth: 34,
    paddingHorizontal: spacing.sm,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnActive: { backgroundColor: brand.solid },
  sendBtnStop: { backgroundColor: text.primary },
  sendBtnDisabled: { backgroundColor: text.muted, opacity: 0.4 },
})
