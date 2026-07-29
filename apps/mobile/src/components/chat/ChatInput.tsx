import { Globe, Mic, Paperclip, Send, Sparkles, Square } from 'lucide-react-native'
import { useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native'

import { usePrefsStore } from '@yuanai/core/stores'

import { AttachmentTray } from '@/components/chat/AttachmentTray'
import { radius, spacing } from '@/theme/tokens'
import { useDialog } from '@/components/ui/Dialog'
import { useTheme } from '@/theme/useTheme'
import { useTranslation } from 'react-i18next'
import { useAttachments } from '@/hooks/useAttachments'

interface ChatInputProps {
  disabled?: boolean
  streaming?: boolean
  bottomInset?: number
  /**
   * 附件功能是否禁用（临时对话不支持附件，传 true 以禁掉 Paperclip 按钮）
   */
  disableAttachments?: boolean
  /**
   * 发送回调：收到文本内容和（若有）已上传文件 ID 列表
   */
  onSend: (content: string, fileIds?: string[]) => void
  onStop?: () => void
}

/**
 * 底部输入区（附件版）。
 *
 * 结构（从外到内）：
 *   wrap（安全区背景带）
 *     card（白底大圆角 + 轻投影，视觉主体）
 *       AttachmentTray — 横向附件预览条（有附件时显示）
 *       tools 行：📎 附件 / 🎙 语音 / Globe 联网 / Sparkles 思考
 *       input 行：多行 TextInput + 发送/停止 pill 按钮
 *
 * 附件状态由内部 useAttachments hook 管理：
 * - Paperclip 点击 → openAttachSheet (相册/拍照/文件)
 * - 上传中显示进度圈；出错显示红色感叹号
 * - 发送时把已上传 fileId 数组透传给 onSend，然后 clear()
 * - disableAttachments=true 时（临时对话）Paperclip 弹「稍后」提示
 *
 * 非附件占位按钮说明：语音/联网/思考 的真实实现依赖额外后端能力，当前仍为占位。
 */
export function ChatInput({
  disabled = false,
  streaming = false,
  bottomInset = 0,
  disableAttachments = false,
  onSend,
  onStop,
}: ChatInputProps): React.JSX.Element {
  const theme = useTheme()
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const inputRef = useRef<TextInput>(null)
  const dialog = useDialog()

  const showThinking = usePrefsStore((s) => s.showThinking)
  const setShowThinking = usePrefsStore((s) => s.setShowThinking)

  const { attachments, openAttachSheet, remove, clear, getFileIds, isUploading } = useAttachments(
    disabled || disableAttachments
  )

  // 发送条件：有文本或有已上传完成的附件；且不在流式中、不在禁用状态、不在上传中
  const hasReadyAttachment = attachments.some((a) => a.fileId !== null)
  const canSend =
    (value.trim().length > 0 || hasReadyAttachment) && !streaming && !disabled && !isUploading

  const handleSend = (): void => {
    const content = value.trim()
    if ((!content && !hasReadyAttachment) || streaming || disabled || isUploading) return
    const fileIds = getFileIds()
    setValue('')
    clear()
    onSend(content, fileIds.length > 0 ? fileIds : undefined)
  }

  const notReady = (label: string) => (): void => {
    void dialog.alert({ title: label, message: t('chat.comingSoonTitle') })
  }

  const handlePaperclip = (): void => {
    if (disableAttachments) {
      void dialog.alert({ title: t('chat.attach'), message: t('chat.tempNoAttach') })
      return
    }
    void openAttachSheet()
  }

  return (
    <View
      style={[
        styles.wrap,
        { paddingBottom: Math.max(bottomInset, spacing.sm), backgroundColor: theme.bg.base },
      ]}
    >
      <View
        style={[
          styles.card,
          { backgroundColor: theme.bg.surface, borderColor: theme.border.default },
        ]}
      >
        {/* 附件预览条 */}
        <AttachmentTray attachments={attachments} onRemove={remove} />

        {/* 工具行 */}
        <View style={styles.tools}>
          <Pressable
            onPress={handlePaperclip}
            hitSlop={6}
            style={[
              styles.toolBtn,
              {
                backgroundColor: attachments.length > 0 ? theme.brand.selected : theme.bg.elevated,
              },
            ]}
            accessibilityLabel={t('chat.attach')}
          >
            <Paperclip
              size={17}
              color={attachments.length > 0 ? theme.brand.selectedFg : theme.text.secondary}
            />
          </Pressable>
          <Pressable
            onPress={notReady(t('chat.voice'))}
            hitSlop={6}
            style={[styles.toolBtn, { backgroundColor: theme.bg.elevated }]}
            accessibilityLabel={t('chat.voiceSoon')}
          >
            <Mic size={17} color={theme.text.secondary} />
          </Pressable>
          <Pressable
            onPress={notReady(t('chat.webSearch'))}
            hitSlop={6}
            style={[styles.toolBtn, { backgroundColor: theme.bg.elevated }]}
            accessibilityLabel={t('chat.webSearchSoon')}
          >
            <Globe size={17} color={theme.text.secondary} />
          </Pressable>
          <Pressable
            onPress={() => setShowThinking(!showThinking)}
            hitSlop={6}
            style={[
              styles.toolBtn,
              { backgroundColor: showThinking ? theme.brand.selected : theme.bg.elevated },
            ]}
            accessibilityLabel={showThinking ? t('chat.deepThinkOff') : t('chat.deepThinkOn')}
            accessibilityState={{ selected: showThinking }}
          >
            <Sparkles
              size={17}
              color={showThinking ? theme.brand.selectedFg : theme.text.secondary}
            />
          </Pressable>
        </View>

        {/* 输入行 */}
        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={setValue}
            placeholder={t('chat.inputPlaceholder')}
            placeholderTextColor={theme.text.muted}
            style={[
              styles.input,
              {
                color: theme.text.primary,
                fontSize: theme.typography.body,
                lineHeight: theme.typography.bodyLineHeight,
                minHeight: Math.max(32, theme.density.inputMinH - 16),
                paddingVertical: Math.max(4, Math.round(theme.density.inputPy / 2)),
              },
            ]}
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
                ? { backgroundColor: theme.text.primary }
                : canSend
                  ? { backgroundColor: theme.brand.solid }
                  : styles.sendBtnDisabled,
            ]}
            hitSlop={4}
            accessibilityLabel={streaming ? t('chat.stop') : t('chat.send')}
          >
            {streaming ? (
              <Square size={15} color={theme.text.inverse} fill={theme.text.inverse} />
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
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  card: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
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
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    paddingHorizontal: 4,
  },
  sendBtn: {
    height: 34,
    minWidth: 34,
    paddingHorizontal: spacing.sm,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#9CA3AF', opacity: 0.4 },
})
