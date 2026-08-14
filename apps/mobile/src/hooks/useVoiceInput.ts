import { Audio } from 'expo-av'
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition'
import type {
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { VoiceInputStatus } from '@yuanai/types'

import { transcribeMobileAudio } from '../lib/mobileVoiceTranscription'

interface RecordingHandle {
  getURI: () => string | null
  stopAndUnloadAsync: () => Promise<unknown>
}

/** 移动端语音输入 Hook 的配置。 */
export interface UseVoiceInputOptions {
  /** 已完成的文本；调用方只能追加到草稿，禁止自动发送。 */
  onTranscript: (text: string) => void
  /** 供输入框显示的可操作错误消息。 */
  onError?: (message: string) => void
  /** 识别语言，默认使用中文。 */
  language?: string
}

/** 移动端语音输入的状态和操作。 */
export interface VoiceInputState {
  /** 当前互斥生命周期状态。 */
  status: VoiceInputStatus
  /** 最近可展示的错误；新一轮输入会清空。 */
  error: string | null
  /** 原生识别模块是否可用。 */
  isAvailable: boolean
  /** 请求权限并启动原生识别。 */
  start: () => Promise<void>
  /** 结束识别；没有本地结果时转写录音。 */
  stop: () => void
  /** 放弃识别、录音或上传，不插入文本。 */
  cancel: () => void
}

function isRecoverableSpeechError(error: ExpoSpeechRecognitionErrorEvent['error']): boolean {
  return (
    error === 'network' || error === 'service-not-allowed' || error === 'language-not-supported'
  )
}

function speechErrorMessage(error: ExpoSpeechRecognitionErrorEvent['error']): string {
  switch (error) {
    case 'not-allowed':
      return '未授权使用麦克风或语音识别，请在系统设置中检查权限'
    case 'audio-capture':
      return '找不到可用的麦克风设备'
    case 'no-speech':
    case 'speech-timeout':
      return '未检测到语音，请再试一次'
    case 'network':
    case 'service-not-allowed':
    case 'language-not-supported':
      return '本地语音识别不可用，已切换为云端转写'
    default:
      return '语音识别失败，请重试'
  }
}

function audioMetadata(uri: string): { filename: string; mimeType: string } {
  const path = uri.split(/[?#]/, 1)[0]?.toLocaleLowerCase() ?? ''
  if (path.endsWith('.wav')) return { filename: 'voice.wav', mimeType: 'audio/wav' }
  if (path.endsWith('.webm')) return { filename: 'voice.webm', mimeType: 'audio/webm' }
  if (path.endsWith('.ogg')) return { filename: 'voice.ogg', mimeType: 'audio/ogg' }
  if (path.endsWith('.mp3')) return { filename: 'voice.mp3', mimeType: 'audio/mpeg' }
  return { filename: 'voice.m4a', mimeType: 'audio/mp4' }
}

/**
 * 在 Expo 原生端优先使用系统语音识别；不可用时上传同一段或后备录音到 Whisper。
 *
 * 所有麦克风、识别器和 AbortController 都由 hook 在停止、取消和卸载时清理。
 */
export function useVoiceInput(options: UseVoiceInputOptions): VoiceInputState {
  const { language = 'zh-CN', onError, onTranscript } = options
  const [status, setStatus] = useState<VoiceInputStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [isAvailable, setIsAvailable] = useState(false)
  const statusRef = useRef<VoiceInputStatus>('idle')
  const onTranscriptRef = useRef(onTranscript)
  const onErrorRef = useRef(onError)
  const cancelledRef = useRef(false)
  const shouldTranscribeRef = useRef(false)
  const localResultRef = useRef(false)
  const transcriptionStartedRef = useRef(false)
  const persistedAudioUriRef = useRef<string | null>(null)
  const fallbackRecordingRef = useRef<RecordingHandle | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const updateStatus = useCallback((nextStatus: VoiceInputStatus): void => {
    statusRef.current = nextStatus
    setStatus(nextStatus)
  }, [])

  const reportError = useCallback(
    (message: string): void => {
      setError(message)
      updateStatus('error')
      onErrorRef.current?.(message)
    },
    [updateStatus]
  )

  const discardFallbackRecording = useCallback(async (): Promise<void> => {
    const recording = fallbackRecordingRef.current
    fallbackRecordingRef.current = null
    if (!recording) return
    try {
      await recording.stopAndUnloadAsync()
    } catch {
      // 录音已结束或原生层已经释放时无需阻塞取消流程。
    }
  }, [])

  const transcribeUri = useCallback(
    async (uri: string): Promise<void> => {
      if (cancelledRef.current || transcriptionStartedRef.current || localResultRef.current) return
      transcriptionStartedRef.current = true
      const controller = new AbortController()
      abortRef.current = controller
      updateStatus('transcribing')
      const metadata = audioMetadata(uri)
      try {
        const result = await transcribeMobileAudio(
          { uri, mimeType: metadata.mimeType, filename: metadata.filename },
          { signal: controller.signal }
        )
        const text = result.text.trim()
        if (!cancelledRef.current && text) {
          onTranscriptRef.current(text)
          updateStatus('idle')
        } else if (!cancelledRef.current) {
          reportError('未检测到可转写的音频，请再试一次')
        }
      } catch (caught) {
        if (!cancelledRef.current) {
          const message = caught instanceof Error ? caught.message : '语音转写失败，请重试'
          reportError(message)
        }
      } finally {
        abortRef.current = null
      }
    },
    [reportError, updateStatus]
  )

  const finishFallback = useCallback(async (): Promise<void> => {
    if (cancelledRef.current || !shouldTranscribeRef.current || localResultRef.current) return
    const persistedUri = persistedAudioUriRef.current
    if (persistedUri) {
      await transcribeUri(persistedUri)
      return
    }
    const recording = fallbackRecordingRef.current
    if (!recording) return
    fallbackRecordingRef.current = null
    try {
      await recording.stopAndUnloadAsync()
      const uri = recording.getURI()
      if (!uri) {
        reportError('未检测到可转写的录音，请再试一次')
        return
      }
      await transcribeUri(uri)
    } catch {
      reportError('无法读取录音，请重新录制')
    }
  }, [reportError, transcribeUri])

  const finishWithLocalResult = useCallback(
    (event: ExpoSpeechRecognitionResultEvent): void => {
      if (!event.isFinal || cancelledRef.current) return
      const text = event.results[0]?.transcript.trim() ?? ''
      if (!text) return
      localResultRef.current = true
      shouldTranscribeRef.current = false
      try {
        ExpoSpeechRecognitionModule.abort()
      } catch {
        // 已结束的识别器不影响本地文本。
      }
      void discardFallbackRecording()
      onTranscriptRef.current(text)
      updateStatus('idle')
    },
    [discardFallbackRecording, updateStatus]
  )

  useEffect(() => {
    onTranscriptRef.current = onTranscript
    onErrorRef.current = onError
  }, [onError, onTranscript])

  useEffect(() => {
    setIsAvailable(typeof ExpoSpeechRecognitionModule.requestPermissionsAsync === 'function')
  }, [])

  useEffect(() => {
    const resultSubscription = ExpoSpeechRecognitionModule.addListener(
      'result',
      finishWithLocalResult
    )
    const errorSubscription = ExpoSpeechRecognitionModule.addListener('error', (event) => {
      if (cancelledRef.current || event.error === 'aborted') return
      if (isRecoverableSpeechError(event.error)) {
        shouldTranscribeRef.current = true
        updateStatus('recording')
        onErrorRef.current?.(speechErrorMessage(event.error))
        void finishFallback()
        return
      }
      shouldTranscribeRef.current = false
      void discardFallbackRecording()
      reportError(speechErrorMessage(event.error))
    })
    const audioEndSubscription = ExpoSpeechRecognitionModule.addListener('audioend', (event) => {
      if (event.uri) persistedAudioUriRef.current = event.uri
      if (shouldTranscribeRef.current) void finishFallback()
    })
    return () => {
      resultSubscription.remove()
      errorSubscription.remove()
      audioEndSubscription.remove()
    }
  }, [discardFallbackRecording, finishFallback, finishWithLocalResult, reportError, updateStatus])

  const cancel = useCallback((): void => {
    cancelledRef.current = true
    shouldTranscribeRef.current = false
    abortRef.current?.abort()
    try {
      ExpoSpeechRecognitionModule.abort()
    } catch {
      // 原生识别已经结束时无需处理。
    }
    void discardFallbackRecording()
    persistedAudioUriRef.current = null
    setError(null)
    updateStatus('idle')
  }, [discardFallbackRecording, updateStatus])

  useEffect(
    () => () => {
      cancel()
    },
    [cancel]
  )

  const start = useCallback(async (): Promise<void> => {
    if (
      statusRef.current === 'listening' ||
      statusRef.current === 'recording' ||
      statusRef.current === 'transcribing'
    ) {
      return
    }
    setError(null)
    cancelledRef.current = false
    shouldTranscribeRef.current = false
    localResultRef.current = false
    transcriptionStartedRef.current = false
    persistedAudioUriRef.current = null

    let permissionsGranted = false
    try {
      permissionsGranted = (await ExpoSpeechRecognitionModule.requestPermissionsAsync()).granted
    } catch {
      reportError('无法请求麦克风和语音识别权限，请在系统设置中检查权限')
      return
    }
    if (!permissionsGranted) {
      reportError('未授权使用麦克风和语音识别，请在系统设置中检查权限')
      return
    }

    const canPersistNativeAudio = ExpoSpeechRecognitionModule.supportsRecording()
    if (!canPersistNativeAudio) {
      try {
        const result = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY)
        fallbackRecordingRef.current = result.recording
      } catch {
        reportError('无法开始后备录音，请检查麦克风后重试')
        return
      }
    }
    if (cancelledRef.current) {
      void discardFallbackRecording()
      return
    }

    try {
      ExpoSpeechRecognitionModule.start({
        lang: language,
        interimResults: false,
        continuous: false,
        maxAlternatives: 1,
        ...(canPersistNativeAudio
          ? { recordingOptions: { persist: true, outputFileName: 'yuanai-voice.wav' } }
          : {}),
      })
      updateStatus('listening')
    } catch {
      void discardFallbackRecording()
      reportError('无法启动语音识别，请稍后重试')
    }
  }, [discardFallbackRecording, language, reportError, updateStatus])

  const stop = useCallback((): void => {
    if (statusRef.current !== 'listening' && statusRef.current !== 'recording') return
    shouldTranscribeRef.current = true
    try {
      ExpoSpeechRecognitionModule.stop()
    } catch {
      // 识别已经结束时继续处理已录制音频。
    }
    void finishFallback()
  }, [finishFallback])

  return { status, error, isAvailable, start, stop, cancel }
}
