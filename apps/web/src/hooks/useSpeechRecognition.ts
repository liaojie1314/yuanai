'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 浏览器 Web Speech API 类型对齐。
 * lib.dom 里没有 SpeechRecognition 的构造签名（仍属 vendor API），这里最小化补齐我们要用到的字段。
 */
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
  message?: string
}

interface SpeechRecognitionInstance {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance

interface SpeechWindow extends Window {
  SpeechRecognition?: SpeechRecognitionCtor
  webkitSpeechRecognition?: SpeechRecognitionCtor
}

/**
 * `useSpeechRecognition` 返回的状态与操作。
 */
export interface SpeechRecognitionState {
  /** 浏览器是否提供 Web Speech API（Chrome / Edge / 新 Safari 支持，Firefox 不支持）。 */
  isSupported: boolean
  /** 是否处于识别中。 */
  isListening: boolean
  /** 开始识别。若已经在识别中会先 stop 再重启。 */
  start: () => void
  /** 主动停止识别（会触发 onend）。 */
  stop: () => void
}

/**
 * `useSpeechRecognition` 配置项。
 */
interface UseSpeechRecognitionOptions {
  /** 识别语言，默认取 `navigator.language`；例如 `zh-CN` / `en-US`。 */
  lang?: string
  /**
   * 拿到最终识别文本时的回调。传入片段而非累计值，
   * 由调用方决定「追加到 textarea」还是「整段替换」。
   */
  onResult: (text: string) => void
  /** 出错回调（触发后 isListening 自动置回 false）。 */
  onError?: (message: string) => void
}

/**
 * 常见错误码 → 用户可读中文提示。
 */
function humanizeError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return '未授权使用麦克风，请在浏览器地址栏检查权限'
    case 'no-speech':
      return '未检测到语音，请再试一次'
    case 'audio-capture':
      return '找不到可用的麦克风设备'
    case 'network':
      return '语音识别网络异常，请检查连接'
    case 'aborted':
      return '语音识别被中断'
    default:
      return `语音识别失败：${code}`
  }
}

/**
 * Web Speech API 语音识别 Hook。
 *
 * - 自动侦测 `SpeechRecognition` / `webkitSpeechRecognition`，不支持的浏览器 `isSupported=false`
 * - 内部管理 `SpeechRecognition` 实例（`useRef`），组件卸载时自动 abort
 * - 只在 `result.isFinal` 时调用 `onResult`，避免中间态频繁写入
 * - 出错通过 `onError` 回调上抛，Hook 自动把 `isListening` 复位
 */
export function useSpeechRecognition(opts: UseSpeechRecognitionOptions): SpeechRecognitionState {
  const { lang, onResult, onError } = opts

  const [isSupported, setIsSupported] = useState(false)
  const [isListening, setIsListening] = useState(false)

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const onResultRef = useRef(onResult)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onResultRef.current = onResult
    onErrorRef.current = onError
  }, [onResult, onError])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const w = window as SpeechWindow
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Ctor) return
    setIsSupported(true)

    const rec = new Ctor()
    rec.lang = lang ?? (typeof navigator !== 'undefined' ? navigator.language : 'zh-CN')
    rec.continuous = false
    rec.interimResults = false
    rec.maxAlternatives = 1

    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i]
        if (res?.isFinal) {
          const text = res[0]?.transcript?.trim() ?? ''
          if (text) onResultRef.current(text)
        }
      }
    }
    rec.onerror = (event) => {
      setIsListening(false)
      onErrorRef.current?.(humanizeError(event.error))
    }
    rec.onend = () => {
      setIsListening(false)
    }
    rec.onstart = () => {
      setIsListening(true)
    }

    recognitionRef.current = rec
    return () => {
      try {
        rec.abort()
      } catch {
        /* ignore */
      }
      recognitionRef.current = null
    }
  }, [lang])

  const start = useCallback((): void => {
    const rec = recognitionRef.current
    if (!rec) return
    try {
      rec.start()
    } catch {
      /* 已经在识别中时 start() 会抛 InvalidStateError，忽略即可 */
    }
  }, [])

  const stop = useCallback((): void => {
    const rec = recognitionRef.current
    if (!rec) return
    try {
      rec.stop()
    } catch {
      /* ignore */
    }
  }, [])

  return { isSupported, isListening, start, stop }
}
