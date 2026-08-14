'use client'

import { transcribeAudio } from '@yuanai/core'
import type { VoiceInputStatus } from '@yuanai/types'
import { useCallback, useEffect, useRef, useState } from 'react'

interface SpeechResultEventLike {
  resultIndex: number
  results: {
    length: number
    [index: number]: {
      isFinal: boolean
      0: { transcript: string }
    }
  }
}

interface SpeechErrorEventLike {
  error: string
}

interface SpeechRecognitionInstance {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechResultEventLike) => void) | null
  onerror: ((event: SpeechErrorEventLike) => void) | null
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

/** 浏览器语音输入 Hook 的配置。 */
export interface UseVoiceInputOptions {
  /** 识别完成的文本；调用方只应把它插入草稿，不得自动发送。 */
  onTranscript: (text: string) => void
  /** 发生可展示错误时的回调，通常接入应用 Toast。 */
  onError?: (message: string) => void
  /** 可选的语言代码；默认使用浏览器首选语言。 */
  language?: string
}

/** 浏览器语音输入的状态和操作。 */
export interface VoiceInputState {
  /** 当前互斥生命周期状态。 */
  status: VoiceInputStatus
  /** 最近一次错误；开始新一轮输入后自动清空。 */
  error: string | null
  /** 浏览器是否同时提供麦克风录音能力。 */
  isAvailable: boolean
  /** 请求麦克风并开始本地识别或录音回退。 */
  start: () => Promise<void>
  /** 结束当前输入；本地结果优先，否则上传已录录音。 */
  stop: () => void
  /** 放弃当前录音或正在进行的转写，不插入任何文本。 */
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
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
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
 * 在 Web renderer 内优先使用浏览器语音识别，必要时将同一段录音上传 Whisper。
 *
 * 录音和识别都只在当前页面内运行。结束、取消、卸载时会停止所有媒体轨道，
 * 并且本 Hook 从不调用聊天发送方法。
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
        // 已结束的浏览器识别器会抛 InvalidStateError，无需影响本地结果。
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
        if (!cancelledRef.current) updateStatus('idle')
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
      // 识别已结束时无需处理。
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
      reportError('当前浏览器不支持录音，无法使用语音输入')
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
          ? '未授权使用麦克风，请在浏览器地址栏检查权限'
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
      // 已完成的识别器不影响录音转写。
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
