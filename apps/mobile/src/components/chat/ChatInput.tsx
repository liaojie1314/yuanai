import {
  Globe,
  Image as ImageIcon,
  Mic,
  Music,
  Paperclip,
  Send,
  Sparkles,
  Square,
  Video,
} from 'lucide-react-native'
import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import { usePrefsStore } from '@yuanai/core/stores'
import { MediaMusicDurationSeconds } from '@yuanai/types'
import type {
  MediaGenerationOptions,
  MediaGenerationType,
  MediaImageRatio,
  MediaImageSize,
  MediaVideoAspectRatio,
  MediaVideoDurationSeconds,
  MediaVideoResolution,
} from '@yuanai/types'

import { AttachmentTray } from '@/components/chat/AttachmentTray'
import { radius, spacing } from '@/theme/tokens'
import { useDialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
import { useVoiceInput } from '@/hooks/useVoiceInput'
import { useTheme } from '@/theme/useTheme'
import { useTranslation } from 'react-i18next'
import { useAttachments } from '@/hooks/useAttachments'

type ComposerMode = 'chat' | 'image' | 'video' | 'music'

const IMAGE_SIZES: readonly MediaImageSize[] = ['1K', '2K', '3K', '4K']
const IMAGE_RATIOS: readonly MediaImageRatio[] = [
  '1:1',
  '3:4',
  '4:3',
  '16:9',
  '9:16',
  '2:3',
  '3:2',
  '21:9',
]
const VIDEO_RATIOS: readonly MediaVideoAspectRatio[] = ['3:2', '16:9', '9:16', '1:1', '4:3', '3:4']
const VIDEO_RESOLUTIONS: readonly MediaVideoResolution[] = ['480p', '720p', '1080p']
const VIDEO_DURATIONS: readonly MediaVideoDurationSeconds[] = [3, 5, 10, 18]

interface MediaTaskSubmission {
  content: string
  fileIds?: string[]
  type: MediaGenerationType
  options: MediaGenerationOptions
}

interface ChatSendOptions {
  enableWebSearch: boolean
}

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
  onSend: (content: string, fileIds?: string[], options?: ChatSendOptions) => void
  onStop?: () => void
  /** 后端返回的联网搜索能力；不可用时 Globe 保持禁用。 */
  webSearchAvailable?: boolean
  /** 当前页面是否有持久化会话，只有这时显示图片/视频生成入口。 */
  mediaGenerationEnabled?: boolean
  /** 创建任务请求进行中，防止重复提交。 */
  mediaTaskCreating?: boolean
  /** 媒体任务创建成功时返回 true；失败时保留草稿和附件。 */
  onCreateMediaTask?: (submission: MediaTaskSubmission) => Promise<boolean>
}

/** 输入卡外的媒体规格分段选项。 */
function MediaOptionGroup<T extends string | number>({
  label,
  value,
  values,
  onChange,
  suffix = '',
}: {
  label: string
  value: T
  values: readonly T[]
  onChange: (value: T) => void
  suffix?: string
}): React.JSX.Element {
  const theme = useTheme()
  return (
    <View style={styles.mediaOptionGroup}>
      <Text style={[styles.mediaOptionLabel, { color: theme.text.muted }]}>{label}</Text>
      {values.map((item) => {
        const active = item === value
        return (
          <Pressable
            key={String(item)}
            onPress={() => onChange(item)}
            style={[
              styles.mediaOption,
              { backgroundColor: active ? theme.brand.selected : theme.bg.elevated },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${label} ${String(item)}${suffix}`}
            accessibilityState={{ selected: active }}
          >
            <Text
              style={[
                styles.mediaOptionText,
                { color: active ? theme.brand.selectedFg : theme.text.secondary },
              ]}
            >
              {item}
              {suffix}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * 底部输入区（附件版）。
 *
 * 结构（从外到内）：
 *   wrap（安全区背景带）
 *     card（白底大圆角 + 轻投影，视觉主体）
 *       AttachmentTray — 横向附件预览条（有附件时显示）
 *       tools 行：📎 附件 / 🎙 语音 / Globe 联网 / Sparkles 思考 / 图片 / 视频
 *       input 行：多行 TextInput + 发送/停止 pill 按钮
 *
 * 附件状态由内部 useAttachments hook 管理：
 * - Paperclip 点击 → openAttachSheet (相册/拍照/文件)
 * - 上传中显示进度圈；出错显示红色感叹号
 * - 发送时把已上传 fileId 数组透传给 onSend，然后 clear()
 * - disableAttachments=true 时（临时对话）Paperclip 弹「稍后」提示
 *
 * 语音输入优先使用设备识别；识别服务不可用时上传同一段录音到后端 Whisper，
 * 转写结果只写入草稿，不会自动发送。
 */
export function ChatInput({
  disabled = false,
  streaming = false,
  bottomInset = 0,
  disableAttachments = false,
  onSend,
  onStop,
  webSearchAvailable = false,
  mediaGenerationEnabled = false,
  mediaTaskCreating = false,
  onCreateMediaTask,
}: ChatInputProps): React.JSX.Element {
  const theme = useTheme()
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [composerMode, setComposerMode] = useState<ComposerMode>('chat')
  const [imageSize, setImageSize] = useState<MediaImageSize>('1K')
  const [imageRatio, setImageRatio] = useState<MediaImageRatio>('1:1')
  const [videoRatio, setVideoRatio] = useState<MediaVideoAspectRatio>('3:2')
  const [videoResolution, setVideoResolution] = useState<MediaVideoResolution>('720p')
  const [videoDuration, setVideoDuration] = useState<MediaVideoDurationSeconds>(5)
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const inputRef = useRef<TextInput>(null)
  const dialog = useDialog()
  const toast = useToast()

  const showThinking = usePrefsStore((s) => s.showThinking)
  const setShowThinking = usePrefsStore((s) => s.setShowThinking)

  const { attachments, openAttachSheet, remove, clear, getFileIds, isUploading } = useAttachments(
    disabled || disableAttachments || composerMode === 'music'
  )

  const appendVoiceTranscript = useCallback((text: string): void => {
    setValue((previous) => {
      const needsSpace = previous.length > 0 && !previous.endsWith(' ') && !previous.endsWith('\n')
      return `${previous}${needsSpace ? ' ' : ''}${text}`
    })
  }, [])
  const handleVoiceError = useCallback(
    (message: string): void => {
      toast.show(message, 3200)
    },
    [toast]
  )
  const voiceInput = useVoiceInput({
    onTranscript: appendVoiceTranscript,
    onError: handleVoiceError,
  })

  // 发送条件：有文本或有已上传完成的附件；且不在流式中、不在禁用状态、不在上传中
  const hasReadyAttachment = attachments.some((a) => a.fileId !== null)
  const canSend =
    (value.trim().length > 0 || hasReadyAttachment) &&
    !disabled &&
    !isUploading &&
    (composerMode === 'chat' ? !streaming : !mediaTaskCreating)

  const handleSend = (): void => {
    const content = value.trim()
    if ((!content && !hasReadyAttachment) || disabled || isUploading) return
    const fileIds = composerMode === 'music' ? [] : getFileIds()
    if (composerMode !== 'chat') {
      if (mediaTaskCreating || !onCreateMediaTask) return
      if (
        composerMode !== 'music' &&
        attachments.some((attachment) => !attachment.mimeType.startsWith('image/'))
      ) {
        toast.show('图片和视频生成只能使用图片作为参考素材', 3200)
        return
      }
      const options: MediaGenerationOptions =
        composerMode === 'image'
          ? { size: imageSize, ratio: imageRatio }
          : composerMode === 'video'
            ? {
                aspectRatio: videoRatio,
                resolution: videoResolution,
                durationSeconds: videoDuration,
              }
            : { durationSeconds: MediaMusicDurationSeconds }
      void onCreateMediaTask({
        content,
        type: composerMode,
        options,
        ...(fileIds.length > 0 ? { fileIds } : {}),
      })
        .then((created) => {
          if (!created) return
          setValue('')
          clear()
        })
        .catch((error: unknown) => {
          toast.show(error instanceof Error ? error.message : '创建生成任务失败', 3200)
        })
      return
    }
    if (streaming) return
    setValue('')
    clear()
    onSend(content, fileIds.length > 0 ? fileIds : undefined, {
      enableWebSearch: webSearchEnabled && webSearchAvailable,
    })
  }

  const toggleMediaMode = (mode: Exclude<ComposerMode, 'chat'>): void => {
    if (mode === 'music' && composerMode !== 'music' && attachments.length > 0) clear()
    setComposerMode((previous) => (previous === mode ? 'chat' : mode))
  }

  const handlePaperclip = (): void => {
    if (disableAttachments) {
      void dialog.alert({ title: t('chat.attach'), message: t('chat.tempNoAttach') })
      return
    }
    void openAttachSheet()
  }

  const handleVoiceInput = (): void => {
    if (voiceInput.status === 'listening' || voiceInput.status === 'recording') {
      voiceInput.stop()
      return
    }
    if (voiceInput.status === 'transcribing') {
      voiceInput.cancel()
      return
    }
    void voiceInput.start()
  }

  const voiceButtonDisabled = disabled || streaming || isUploading || !voiceInput.isAvailable
  const voiceButtonLabel =
    voiceInput.status === 'listening' || voiceInput.status === 'recording'
      ? '停止语音输入'
      : voiceInput.status === 'transcribing'
        ? '取消语音转写'
        : t('chat.voice')

  const mediaControlsDisabled =
    disabled || disableAttachments || streaming || isUploading || mediaTaskCreating

  const isSending = composerMode === 'chat' && streaming

  return (
    <View
      style={[
        styles.wrap,
        { paddingBottom: Math.max(bottomInset, spacing.sm), backgroundColor: theme.bg.base },
      ]}
    >
      {mediaGenerationEnabled && composerMode !== 'chat' ? (
        <View
          style={[styles.mediaOptions, { borderColor: theme.border.default }]}
          accessibilityRole="tablist"
          accessibilityLabel={
            composerMode === 'image'
              ? '图片生成规格'
              : composerMode === 'video'
                ? '视频生成规格'
                : '音乐生成规格'
          }
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.mediaOptionsScroll}
          >
            {composerMode === 'image' ? (
              <>
                <MediaOptionGroup
                  label="清晰度"
                  value={imageSize}
                  values={IMAGE_SIZES}
                  onChange={setImageSize}
                />
                <MediaOptionGroup
                  label="比例"
                  value={imageRatio}
                  values={IMAGE_RATIOS}
                  onChange={setImageRatio}
                />
              </>
            ) : composerMode === 'video' ? (
              <>
                <MediaOptionGroup
                  label="画幅"
                  value={videoRatio}
                  values={VIDEO_RATIOS}
                  onChange={setVideoRatio}
                />
                <MediaOptionGroup
                  label="清晰度"
                  value={videoResolution}
                  values={VIDEO_RESOLUTIONS}
                  onChange={setVideoResolution}
                />
                <MediaOptionGroup
                  label="时长"
                  value={videoDuration}
                  values={VIDEO_DURATIONS}
                  onChange={setVideoDuration}
                  suffix=" 秒"
                />
              </>
            ) : (
              <View style={styles.mediaStatus} accessibilityRole="text">
                <Music size={13} color={theme.brand.selected} strokeWidth={2} />
                <Text style={[styles.mediaStatusText, { color: theme.text.muted }]}>
                  音乐生成 · {MediaMusicDurationSeconds} 秒
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      ) : null}
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
            disabled={disabled || disableAttachments || composerMode === 'music'}
            hitSlop={6}
            style={[
              styles.toolBtn,
              {
                backgroundColor: attachments.length > 0 ? theme.brand.selected : theme.bg.elevated,
                opacity: disabled || disableAttachments || composerMode === 'music' ? 0.45 : 1,
              },
            ]}
            accessibilityLabel={composerMode === 'music' ? '音乐模式不支持附件' : t('chat.attach')}
            accessibilityState={{
              disabled: disabled || disableAttachments || composerMode === 'music',
            }}
          >
            <Paperclip
              size={17}
              color={attachments.length > 0 ? theme.brand.selectedFg : theme.text.secondary}
            />
          </Pressable>
          <Pressable
            onPress={handleVoiceInput}
            disabled={voiceButtonDisabled}
            hitSlop={6}
            style={[
              styles.toolBtn,
              {
                backgroundColor:
                  voiceInput.status === 'listening' || voiceInput.status === 'recording'
                    ? theme.brand.selected
                    : theme.bg.elevated,
                opacity: voiceButtonDisabled ? 0.45 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={voiceButtonLabel}
            accessibilityHint="转写结果会追加到输入框，不会自动发送"
            accessibilityState={{
              busy: voiceInput.status === 'transcribing',
              disabled: voiceButtonDisabled,
              selected: voiceInput.status === 'listening' || voiceInput.status === 'recording',
            }}
          >
            {voiceInput.status === 'transcribing' ? (
              <ActivityIndicator size="small" color={theme.text.secondary} />
            ) : voiceInput.status === 'listening' || voiceInput.status === 'recording' ? (
              <Square size={15} color={theme.brand.selectedFg} fill={theme.brand.selectedFg} />
            ) : (
              <Mic size={17} color={theme.text.secondary} />
            )}
          </Pressable>
          {composerMode === 'chat' ? (
            <>
              <Pressable
                onPress={() => setWebSearchEnabled((value) => !value)}
                disabled={!webSearchAvailable || disabled || streaming || isUploading}
                hitSlop={6}
                style={[
                  styles.toolBtn,
                  {
                    backgroundColor: webSearchEnabled ? theme.brand.selected : theme.bg.elevated,
                    opacity: !webSearchAvailable || disabled || streaming || isUploading ? 0.45 : 1,
                  },
                ]}
                accessibilityLabel={t('chat.webSearch')}
                accessibilityHint={
                  webSearchAvailable
                    ? '让本条消息调用联网搜索'
                    : '联网搜索当前不可用，请检查搜索服务配置'
                }
                accessibilityState={{ selected: webSearchEnabled, disabled: !webSearchAvailable }}
              >
                <Globe
                  size={17}
                  color={webSearchEnabled ? theme.brand.selectedFg : theme.text.secondary}
                />
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
            </>
          ) : null}
          {mediaGenerationEnabled ? (
            <>
              <Pressable
                onPress={() => toggleMediaMode('image')}
                disabled={mediaControlsDisabled}
                hitSlop={6}
                style={[
                  styles.toolBtn,
                  {
                    backgroundColor:
                      composerMode === 'image' ? theme.brand.selected : theme.bg.elevated,
                    opacity: mediaControlsDisabled ? 0.45 : 1,
                  },
                ]}
                accessibilityRole="tab"
                accessibilityLabel={composerMode === 'image' ? '退出图片生成' : '图片生成'}
                accessibilityState={{
                  selected: composerMode === 'image',
                  disabled: mediaControlsDisabled,
                }}
              >
                <ImageIcon
                  size={17}
                  color={composerMode === 'image' ? theme.brand.selectedFg : theme.text.secondary}
                />
              </Pressable>
              <Pressable
                onPress={() => toggleMediaMode('video')}
                disabled={mediaControlsDisabled}
                hitSlop={6}
                style={[
                  styles.toolBtn,
                  {
                    backgroundColor:
                      composerMode === 'video' ? theme.brand.selected : theme.bg.elevated,
                    opacity: mediaControlsDisabled ? 0.45 : 1,
                  },
                ]}
                accessibilityRole="tab"
                accessibilityLabel={composerMode === 'video' ? '退出视频生成' : '视频生成'}
                accessibilityState={{
                  selected: composerMode === 'video',
                  disabled: mediaControlsDisabled,
                }}
              >
                <Video
                  size={17}
                  color={composerMode === 'video' ? theme.brand.selectedFg : theme.text.secondary}
                />
              </Pressable>
              <Pressable
                onPress={() => toggleMediaMode('music')}
                disabled={mediaControlsDisabled}
                hitSlop={6}
                style={[
                  styles.toolBtn,
                  {
                    backgroundColor:
                      composerMode === 'music' ? theme.brand.selected : theme.bg.elevated,
                    opacity: mediaControlsDisabled ? 0.45 : 1,
                  },
                ]}
                accessibilityRole="tab"
                accessibilityLabel={composerMode === 'music' ? '退出音乐生成' : '音乐生成'}
                accessibilityState={{
                  selected: composerMode === 'music',
                  disabled: mediaControlsDisabled,
                }}
              >
                <Music
                  size={17}
                  color={composerMode === 'music' ? theme.brand.selectedFg : theme.text.secondary}
                />
              </Pressable>
            </>
          ) : null}
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
            onPress={isSending ? onStop : handleSend}
            disabled={!isSending && !canSend}
            style={[
              styles.sendBtn,
              isSending
                ? { backgroundColor: theme.text.primary }
                : canSend
                  ? { backgroundColor: theme.brand.solid }
                  : styles.sendBtnDisabled,
            ]}
            hitSlop={4}
            accessibilityLabel={isSending ? t('chat.stop') : t('chat.send')}
          >
            {isSending ? (
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
  mediaOptions: {
    marginBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  mediaOptionsScroll: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.xs,
  },
  mediaOptionGroup: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  mediaStatus: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  mediaStatusText: { fontSize: 11 },
  mediaOptionLabel: { fontSize: 11 },
  mediaOption: {
    minHeight: 26,
    paddingHorizontal: 7,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaOptionText: { fontSize: 11, fontWeight: '600' },
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
