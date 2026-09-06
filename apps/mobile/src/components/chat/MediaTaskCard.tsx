import { Audio, Video as ExpoVideo, ResizeMode } from 'expo-av'
import type { AVPlaybackStatus } from 'expo-av'
import {
  Download,
  Image as ImageIcon,
  Music,
  Pause,
  Play,
  RotateCcw,
  Square,
  X,
  XCircle,
} from 'lucide-react-native'
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Image,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'

import { useCancelMediaTask, useCreateMediaTask } from '@yuanai/core'
import type { MediaGenerationTask } from '@yuanai/types'

import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/useTheme'

interface MediaTaskCardProps {
  /** 来自服务端消息的可恢复媒体任务。 */
  task: MediaGenerationTask
}

const NativeVideo = ExpoVideo as unknown as ComponentType<{
  source: { uri: string }
  style: StyleProp<ViewStyle>
  resizeMode: ResizeMode
  isMuted?: boolean
  shouldPlay?: boolean
  useNativeControls?: boolean
}>

/** 在移动端时间线中渲染持久化图片或视频生成任务。 */
export function MediaTaskCard({ task }: MediaTaskCardProps): React.JSX.Element {
  const theme = useTheme()
  const { t } = useTranslation()
  const cancel = useCancelMediaTask()
  const retry = useCreateMediaTask()
  const [previewOpen, setPreviewOpen] = useState(false)
  const [audioLoading, setAudioLoading] = useState(false)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [audioPositionMillis, setAudioPositionMillis] = useState(0)
  const [audioDurationMillis, setAudioDurationMillis] = useState(
    task.resultDurationSeconds ? task.resultDurationSeconds * 1000 : 0
  )
  const [audioRetryKey, setAudioRetryKey] = useState(0)
  const soundRef = useRef<Audio.Sound | null>(null)
  const active = task.status === 'queued' || task.status === 'running'
  const isImage = task.type === 'image'
  const isMusic = task.type === 'music'
  const resultUrl = task.status === 'succeeded' ? task.resultUrl : null
  const resultPosterUrl = task.status === 'succeeded' ? task.resultPosterUrl : null
  const hasResult = resultUrl !== null
  const musicUrl = task.type === 'music' && task.status === 'succeeded' ? resultUrl : null
  const statusLabel =
    task.status === 'queued'
      ? t('chat.media.queued')
      : task.status === 'running'
        ? t('chat.media.running', { progress: task.progress })
        : task.status === 'succeeded'
          ? t('chat.media.succeeded')
          : task.status === 'canceled'
            ? t('chat.media.canceled')
            : t('chat.media.failed')

  const retryTask = (): void => {
    retry.mutate({
      conversationId: task.conversationId,
      type: task.type,
      prompt: task.prompt,
      options: task.options,
      ...(task.sourceFileIds.length > 0 ? { sourceFileIds: task.sourceFileIds } : {}),
    })
  }

  const openDownload = (): void => {
    if (!resultUrl) return
    void Linking.openURL(resultUrl)
  }

  useEffect(() => {
    let disposed = false

    if (!musicUrl) {
      setAudioLoading(false)
      return undefined
    }

    setAudioError(null)
    setAudioPlaying(false)
    setAudioPositionMillis(0)
    setAudioDurationMillis(task.resultDurationSeconds ? task.resultDurationSeconds * 1000 : 0)
    setAudioLoading(true)
    void Audio.Sound.createAsync(
      { uri: musicUrl },
      { shouldPlay: false, progressUpdateIntervalMillis: 250 },
      (status: AVPlaybackStatus) => {
        if (disposed) return
        if (!status.isLoaded) {
          if (status.error) setAudioError(t('chat.media.audioPlaybackFailed'))
          return
        }
        setAudioPlaying(status.isPlaying)
        setAudioPositionMillis(status.positionMillis)
        setAudioDurationMillis(status.durationMillis ?? 0)
      }
    )
      .then(({ sound }) => {
        if (disposed) {
          void sound.unloadAsync()
          return
        }
        soundRef.current = sound
        setAudioLoading(false)
      })
      .catch(() => {
        if (disposed) return
        setAudioLoading(false)
        setAudioError(t('chat.media.audioLoadFailed'))
      })

    return () => {
      disposed = true
      const sound = soundRef.current
      soundRef.current = null
      if (sound) void sound.unloadAsync()
    }
  }, [audioRetryKey, musicUrl, t, task.resultDurationSeconds])

  const toggleAudio = (): void => {
    const sound = soundRef.current
    if (!sound || audioLoading) return
    if (audioPlaying) {
      void sound
        .pauseAsync()
        .then(() => setAudioPlaying(false))
        .catch(() => setAudioError(t('chat.media.audioPlaybackFailed')))
      return
    }
    void sound
      .playAsync()
      .then(() => setAudioPlaying(true))
      .catch(() => setAudioError(t('chat.media.audioPlaybackFailed')))
  }

  const formatTime = (milliseconds: number): string => {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000))
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  }

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.bg.surface, borderColor: theme.border.default },
      ]}
      accessibilityLabel={t('chat.media.taskAria', {
        type: isImage
          ? t('chat.media.image')
          : isMusic
            ? t('chat.media.music')
            : t('chat.media.video'),
        status: statusLabel,
      })}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: theme.brand.selected }]}>
          {isImage ? (
            <ImageIcon size={18} color={theme.brand.selectedFg} />
          ) : isMusic ? (
            <Music size={18} color={theme.brand.selectedFg} />
          ) : (
            <Play size={18} color={theme.brand.selectedFg} />
          )}
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.text.primary }]}>
            {isImage
              ? t('chat.media.imageGeneration')
              : isMusic
                ? t('chat.media.musicGenerationTitle')
                : t('chat.media.videoGeneration')}
          </Text>
          <Text style={[styles.status, { color: theme.text.muted }]}>{statusLabel}</Text>
        </View>
      </View>

      <Text style={[styles.prompt, { color: theme.text.secondary }]} numberOfLines={2}>
        {task.prompt}
      </Text>

      {active ? (
        <View style={[styles.progressTrack, { backgroundColor: theme.bg.elevated }]}>
          <View
            style={[
              styles.progressValue,
              { width: `${Math.max(2, task.progress)}%`, backgroundColor: theme.brand.solid },
            ]}
          />
        </View>
      ) : null}

      {hasResult && task.type === 'music' ? (
        <View style={[styles.musicPlayer, { backgroundColor: theme.bg.elevated }]}>
          {audioError ? (
            <View style={styles.error}>
              <XCircle size={16} color={theme.border.danger} />
              <Text style={[styles.errorText, { color: theme.border.danger }]}>{audioError}</Text>
              <TaskAction
                icon={<RotateCcw size={14} color={theme.text.secondary} />}
                label={t('chat.media.retryPlayback')}
                onPress={() => setAudioRetryKey((value) => value + 1)}
                textColor={theme.text.secondary}
              />
            </View>
          ) : (
            <>
              <View style={styles.musicHeader}>
                <View style={[styles.icon, { backgroundColor: theme.brand.selected }]}>
                  <Music size={18} color={theme.brand.selectedFg} />
                </View>
                <Text style={[styles.musicTitle, { color: theme.text.primary }]}>
                  {t('chat.media.musicPlayback')}
                </Text>
                <Text style={[styles.musicTime, { color: theme.text.muted }]}>
                  {formatTime(audioPositionMillis)} / {formatTime(audioDurationMillis)}
                </Text>
              </View>
              <View style={[styles.musicProgressTrack, { backgroundColor: theme.border.default }]}>
                <View
                  style={[
                    styles.musicProgressValue,
                    {
                      width:
                        audioDurationMillis > 0
                          ? `${Math.min(100, (audioPositionMillis / audioDurationMillis) * 100)}%`
                          : '0%',
                      backgroundColor: theme.brand.solid,
                    },
                  ]}
                />
              </View>
              <TaskAction
                icon={
                  audioPlaying ? (
                    <Pause size={15} color={theme.text.secondary} />
                  ) : (
                    <Play size={15} color={theme.text.secondary} />
                  )
                }
                label={
                  audioLoading
                    ? t('chat.media.loadingMusic')
                    : audioPlaying
                      ? t('chat.media.pauseMusic')
                      : t('chat.media.playMusic')
                }
                disabled={audioLoading}
                onPress={toggleAudio}
                textColor={theme.text.secondary}
              />
            </>
          )}
        </View>
      ) : hasResult ? (
        <Pressable
          onPress={() => setPreviewOpen(true)}
          style={[styles.result, { backgroundColor: theme.bg.elevated }]}
          accessibilityRole="button"
          accessibilityLabel={t('chat.media.previewGenerated', {
            type: isImage ? t('chat.media.image') : t('chat.media.video'),
          })}
        >
          {isImage || resultPosterUrl ? (
            <Image
              source={{ uri: resultPosterUrl ?? resultUrl }}
              style={styles.resultMedia}
              resizeMode="contain"
            />
          ) : (
            <View style={[styles.resultMedia, { backgroundColor: theme.bg.elevated }]} />
          )}
          <View style={styles.previewBadge} pointerEvents="none">
            <Text style={styles.previewBadgeText}>{t('chat.media.preview')}</Text>
          </View>
          {!isImage ? (
            <View style={styles.videoPlay} pointerEvents="none">
              <Play size={24} color="#FFFFFF" fill="#FFFFFF" />
            </View>
          ) : null}
        </Pressable>
      ) : null}

      {task.status === 'failed' ? (
        <View style={styles.error}>
          <XCircle size={16} color={theme.border.danger} />
          <Text style={[styles.errorText, { color: theme.border.danger }]}>
            {task.errorMessage ?? t('chat.media.generationFailed')}
          </Text>
        </View>
      ) : null}

      <View style={[styles.actions, { borderTopColor: theme.border.default }]}>
        {active ? (
          <TaskAction
            icon={<Square size={14} color={theme.text.secondary} fill={theme.text.secondary} />}
            label={t('chat.media.stopGeneration')}
            disabled={cancel.isPending}
            onPress={() => cancel.mutate(task.id)}
            textColor={theme.text.secondary}
          />
        ) : null}
        {task.status === 'failed' || task.status === 'canceled' ? (
          <TaskAction
            icon={<RotateCcw size={14} color={theme.text.secondary} />}
            label={t('chat.media.retry')}
            disabled={retry.isPending}
            onPress={retryTask}
            textColor={theme.text.secondary}
          />
        ) : null}
        {hasResult ? (
          <TaskAction
            icon={<Download size={14} color={theme.text.secondary} />}
            label={t('chat.media.download')}
            onPress={openDownload}
            textColor={theme.text.secondary}
          />
        ) : null}
      </View>

      {hasResult && task.type !== 'music' ? (
        <Modal
          visible={previewOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setPreviewOpen(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { backgroundColor: theme.bg.base }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: theme.text.primary }]}>
                  {isImage ? t('chat.media.imagePreview') : t('chat.media.videoPreview')}
                </Text>
                <Pressable
                  onPress={() => setPreviewOpen(false)}
                  style={styles.closeButton}
                  accessibilityRole="button"
                  accessibilityLabel={t('chat.media.closePreview')}
                >
                  <X size={20} color={theme.text.primary} />
                </Pressable>
              </View>
              {isImage ? (
                <Image source={{ uri: resultUrl }} style={styles.modalMedia} resizeMode="contain" />
              ) : (
                <NativeVideo
                  source={{ uri: resultUrl }}
                  style={styles.modalMedia}
                  resizeMode={ResizeMode.CONTAIN}
                  useNativeControls
                  shouldPlay
                />
              )}
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  )
}

function TaskAction({
  icon,
  label,
  disabled = false,
  onPress,
  textColor,
}: {
  icon: ReactNode
  label: string
  disabled?: boolean
  onPress: () => void
  textColor: string
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.action, { opacity: disabled ? 0.45 : pressed ? 0.68 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      {icon}
      <Text style={[styles.actionText, { color: textColor }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  icon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: '700' },
  status: { fontSize: 12 },
  prompt: { marginHorizontal: spacing.md, marginBottom: spacing.sm, fontSize: 13, lineHeight: 19 },
  progressTrack: { height: 3 },
  progressValue: { height: '100%' },
  musicPlayer: { gap: spacing.sm, padding: spacing.md },
  musicHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  musicTitle: { flex: 1, fontSize: 14, fontWeight: '700' },
  musicTime: { fontSize: 12, fontVariant: ['tabular-nums'] },
  musicProgressTrack: { height: 4, overflow: 'hidden', borderRadius: 2 },
  musicProgressValue: { height: '100%', borderRadius: 2 },
  result: { position: 'relative', width: '100%', height: 220, overflow: 'hidden' },
  resultMedia: { width: '100%', height: '100%' },
  previewBadge: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
  },
  previewBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  videoPlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -26,
    marginTop: -26,
    borderColor: 'rgba(255, 255, 255, 0.68)',
    borderRadius: 26,
    borderWidth: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.68)',
  },
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  errorText: { flex: 1, fontSize: 12, lineHeight: 18 },
  actions: {
    flexDirection: 'row',
    gap: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.sm,
  },
  action: {
    flexDirection: 'row',
    minHeight: 30,
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  actionText: { fontSize: 12, fontWeight: '600' },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
    backgroundColor: 'rgba(0, 0, 0, 0.74)',
  },
  modalCard: { overflow: 'hidden', maxHeight: '88%', borderRadius: radius.lg },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  modalTitle: { fontSize: 16, fontWeight: '700' },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  modalMedia: { width: '100%', aspectRatio: 1 },
})
