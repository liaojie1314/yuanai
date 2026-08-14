import { transcribeAudio } from '@yuanai/core'
import type { VoiceInputStatus } from '@yuanai/types'
import { useCallback, useEffect, useRef, useState } from 'react'

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: {
    length: number
    [index: number]: {
      isFinal: boolean
      0: { transcript: string }
    }
  }
}

interface SpeechRecognitionErrorEventLike {
  error: string
}

interface SpeechRecognitionInstance {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance

interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

/** 桌面端语音输入 Hook 的配置。 */
export interface UseVoiceInputOptions {
  /** 已完成的转写文本；调用方只可写入草稿，不可自动发送。 */
  onTranscript: (text: string) => void
  /** 可展示的错误回调，通常接入桌面端顶部提示。 */
  onError?: (message: string) => void
  /** 可选的识别语言，默认使用 Chromium 当前语言。 */
  language?: string
}

/** 桌面端语音输入的状态和操作。 */
export interface VoiceInputState {
  /** 当前互斥生命周期状态。 */
  status: VoiceInputStatus
  /** 最近一次错误；下一轮开始时自动清空。 */
  error: string | null
  /** Chromium renderer 是否支持麦克风录音。 */
  isAvailable: boolean
  /** 请求麦克风并开始本地识别或录音回退。 */
  start: () => Promise<void>
  /** 结束当前输入；本地结果优先，否则上传录音。 */
  stop: () => void
  /** 放弃录音或正在进行的转写，不插入任何文本。 */
  cancel: () => void
}

const LOCAL_RESULT_GRACE_MS = 300

function getSpeechConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const speechWindow = window as SpeechRecognitionWindow
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

function selectAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg']
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate))
}

function extensionForMimeType(mimeType: string): string {
  return mimeType.includes('ogg') ? 'ogg' : 'webm'
}

function messageForSpeechError(code: string): { message: string; canFallback: boolean } {
  switch (code) {
    case 'network':
    case 'service-not-allowed':
    case 'language-not-supported':
      return { message: '本地语音识别不可用，已切换为云端转写', canFallback: true }
    case 'not-allowed':
      return { message: '未授权使用麦克风，请在浏览器地址栏检查权限', canFallback: false }
    case 'audio-capture':
      return { message: '找不到可用的麦克风设备', canFallback: false }
    case 'no-speech':
      return { message: '未检测到语音，请再试一次', canFallback: false }
    default:
      return { message: '语音识别失败，请重试', canFallback: false }
  }
}

/**
 * 在 Electron Chromium renderer 中优先使用本地识别，失败时上传已录音至 Whisper。
 *
 * 此 hook 不依赖 Electron Node API，且只通过回调交付草稿文本，永不发送聊天消息。
 */
export function useVoiceInput(options: UseVoiceInputOptions): VoiceInputState {
  const { language, onError, onTranscript } = options
  const [status, setStatus] = useState<VoiceInputStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [isAvailable, setIsAvailable] = useState(false)
  const statusRef = useRef<VoiceInputStatus>('idle')
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const shouldTranscribeRef = useRef(false)
  const localResultRef = useRef(false)
  const cancelledRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const stopTimerRef = useRef<number | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  const onErrorRef = useRef(onError)

  const updateStatus = useCallback((nextStatus: VoiceInputStatus): void => {
    statusRef.current = nextStatus
    setStatus(nextStatus)
  }, [])

  const releaseMedia = useCallback((): void => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current)
      stopTimerRef.current = null
    }
    recognitionRef.current = null
    recorderRef.current = null
    chunksRef.current = []
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null
  }, [])

  const reportError = useCallback(
    (message: string): void => {
      setError(message)
      updateStatus('error')
      onErrorRef.current?.(message)
    },
    [updateStatus]
  )

  const stopRecorder = useCallback((): void => {
    const recorder = recorderRef.current
    if (recorder?.state === 'recording') recorder.stop()
  }, [])

  const finishWithLocalResult = useCallback(
    (text: string): void => {
      const normalized = text.trim()
      if (!normalized || cancelledRef.current) return
      localResultRef.current = true
      shouldTranscribeRef.current = false
      try {
        recognitionRef.current?.abort()
      } catch {
        // 已结束的识别器会抛 InvalidStateError，不影响本地结果。
      }
      stopRecorder()
      onTranscriptRef.current(normalized)
      updateStatus('idle')
    },
    [stopRecorder, updateStatus]
  )

  const transcribeRecordedAudio = useCallback(
    async (blob: Blob): Promise<void> => {
      if (cancelledRef.current || !shouldTranscribeRef.current || localResultRef.current) {
        releaseMedia()
        if (!cancelledRef.current && statusRef.current !== 'error') updateStatus('idle')
        return
      }
      if (!blob.size) {
        releaseMedia()
        reportError('未检测到可转写的音频，请再试一次')
        return
      }
      const mimeType = blob.type || 'audio/webm'
      const file = new File([blob], `voice.${extensionForMimeType(mimeType)}`, { type: mimeType })
      const controller = new AbortController()
      abortRef.current = controller
      updateStatus('transcribing')
      try {
        const result = await transcribeAudio(file, { signal: controller.signal })
        if (!cancelledRef.current && result.text.trim()) {
          onTranscriptRef.current(result.text.trim())
          updateStatus('idle')
        }
      } catch (caught) {
        if (!cancelledRef.current) {
          const message = caught instanceof Error ? caught.message : '语音转写失败，请重试'
          reportError(message)
        }
      } finally {
        abortRef.current = null
        releaseMedia()
      }
    },
    [releaseMedia, reportError, updateStatus]
  )

  useEffect(() => {
    onTranscriptRef.current = onTranscript
    onErrorRef.current = onError
  }, [onError, onTranscript])

  useEffect(() => {
    const canRecord =
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== 'undefined'
    setIsAvailable(canRecord)
  }, [])

  const cancel = useCallback((): void => {
    cancelledRef.current = true
    shouldTranscribeRef.current = false
    abortRef.current?.abort()
    try {
      recognitionRef.current?.abort()
    } catch {
      // 识别已经结束时无需处理。
    }
    stopRecorder()
    releaseMedia()
    setError(null)
    updateStatus('idle')
  }, [releaseMedia, stopRecorder, updateStatus])

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
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      reportError('当前桌面环境不支持录音，无法使用语音输入')
      return
    }
    setError(null)
    cancelledRef.current = false
    localResultRef.current = false
    shouldTranscribeRef.current = false

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (caught) {
      const message =
        caught instanceof DOMException && caught.name === 'NotAllowedError'
          ? '未授权使用麦克风，请在系统设置中检查权限'
          : '无法打开麦克风，请检查设备后重试'
      reportError(message)
      return
    }
    if (cancelledRef.current) {
      for (const track of stream.getTracks()) track.stop()
      return
    }

    streamRef.current = stream
    chunksRef.current = []
    const mimeType = selectAudioMimeType()
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    recorderRef.current = recorder
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || mimeType || 'audio/webm',
      })
      void transcribeRecordedAudio(blob)
    }
    recorder.start()

    const SpeechConstructor = getSpeechConstructor()
    if (!SpeechConstructor) {
      shouldTranscribeRef.current = true
      updateStatus('recording')
      return
    }

    const recognition = new SpeechConstructor()
    recognitionRef.current = recognition
    recognition.lang = language ?? navigator.language ?? 'zh-CN'
    recognition.continuous = false
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (result?.isFinal) finishWithLocalResult(result[0]?.transcript ?? '')
      }
    }
    recognition.onerror = (event) => {
      if (cancelledRef.current || event.error === 'aborted') return
      const failure = messageForSpeechError(event.error)
      if (failure.canFallback) {
        shouldTranscribeRef.current = true
        updateStatus('recording')
        onErrorRef.current?.(failure.message)
        return
      }
      shouldTranscribeRef.current = false
      stopRecorder()
      reportError(failure.message)
    }
    recognition.onend = () => {
      recognitionRef.current = null
    }
    try {
      recognition.start()
      updateStatus('listening')
    } catch {
      shouldTranscribeRef.current = true
      updateStatus('recording')
    }
  }, [
    finishWithLocalResult,
    language,
    reportError,
    stopRecorder,
    transcribeRecordedAudio,
    updateStatus,
  ])

  const stop = useCallback((): void => {
    if (statusRef.current !== 'listening' && statusRef.current !== 'recording') return
    shouldTranscribeRef.current = true
    const recognition = recognitionRef.current
    try {
      recognition?.stop()
    } catch {
      // 已完成的识别器不会阻止录音回退。
    }
    if (!recognition) {
      stopRecorder()
      return
    }
    stopTimerRef.current = window.setTimeout(() => {
      if (!localResultRef.current) stopRecorder()
    }, LOCAL_RESULT_GRACE_MS)
  }, [stopRecorder])

  return { status, error, isAvailable, start, stop, cancel }
}
