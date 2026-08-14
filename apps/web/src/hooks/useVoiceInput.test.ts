import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useVoiceInput } from './useVoiceInput'

const core = vi.hoisted(() => ({ transcribeAudio: vi.fn() }))

vi.mock('@yuanai/core', () => core)

let stopTrack: ReturnType<typeof vi.fn>
let nextAudioBlob: Blob | null

class MockMediaRecorder {
  static latest: MockMediaRecorder | null = null

  static isTypeSupported(): boolean {
    return true
  }

  state: 'inactive' | 'recording' = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null

  constructor(_stream: MediaStream) {
    MockMediaRecorder.latest = this
  }

  start(): void {
    this.state = 'recording'
  }

  stop(): void {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    if (nextAudioBlob) this.ondataavailable?.({ data: nextAudioBlob })
    this.onstop?.()
  }
}

function removeSpeechRecognition(): void {
  delete (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition
  delete (window as Window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })

  return {
    promise,
    resolve(value: T): void {
      if (!settle) throw new Error('Deferred promise resolver was not initialized')
      settle(value)
    },
  }
}

describe('useVoiceInput', () => {
  beforeEach(() => {
    MockMediaRecorder.latest = null
    nextAudioBlob = new Blob(['audio'], { type: 'audio/webm' })
    stopTrack = vi.fn()
    core.transcribeAudio.mockReset()
    removeSpeechRecognition()
    vi.stubGlobal('MediaRecorder', MockMediaRecorder)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('falls back to Whisper when browser speech recognition is unavailable', async () => {
    core.transcribeAudio.mockResolvedValue({ text: '稍后发送', language: 'zh', durationSeconds: 1 })
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useVoiceInput({ onTranscript }))

    await act(async () => {
      await result.current.start()
    })
    expect(result.current.status).toBe('recording')

    act(() => result.current.stop())

    await waitFor(() => expect(core.transcribeAudio).toHaveBeenCalledOnce())
    expect(onTranscript).toHaveBeenCalledWith('稍后发送')
    expect(stopTrack).toHaveBeenCalledOnce()
  })

  it('uses a final browser transcript without uploading the retained recording', async () => {
    const onTranscript = vi.fn()
    class MockSpeechRecognition {
      static latest: MockSpeechRecognition | null = null

      lang = ''
      continuous = false
      interimResults = false
      maxAlternatives = 1
      onresult:
        | ((event: {
            resultIndex: number
            results: { 0: { isFinal: boolean; 0: { transcript: string } }; length: number }
          }) => void)
        | null = null
      onerror = null
      onend = null

      constructor() {
        MockSpeechRecognition.latest = this
      }

      start(): void {}
      stop(): void {}
      abort(): void {}
    }
    Object.assign(window, { SpeechRecognition: MockSpeechRecognition })
    const { result } = renderHook(() => useVoiceInput({ onTranscript }))

    await act(async () => {
      await result.current.start()
    })
    expect(result.current.status).toBe('listening')
    const recognition = MockSpeechRecognition.latest
    const onresult = recognition?.onresult
    if (!onresult) throw new Error('Expected recognition result handler')

    act(() => {
      onresult({
        resultIndex: 0,
        results: { 0: { isFinal: true, 0: { transcript: '本地识别' } }, length: 1 },
      })
    })

    expect(onTranscript).toHaveBeenCalledWith('本地识别')
    expect(core.transcribeAudio).not.toHaveBeenCalled()
    expect(MockMediaRecorder.latest?.state).toBe('inactive')
  })

  it('keeps an unrecoverable recognition failure visible instead of attempting transcription', async () => {
    const onTranscript = vi.fn()
    class MockSpeechRecognition {
      static latest: MockSpeechRecognition | null = null

      lang = ''
      continuous = false
      interimResults = false
      maxAlternatives = 1
      onresult = null
      onerror: ((event: { error: string }) => void) | null = null
      onend = null

      constructor() {
        MockSpeechRecognition.latest = this
      }

      start(): void {}
      stop(): void {}
      abort(): void {}
    }
    Object.assign(window, { SpeechRecognition: MockSpeechRecognition })
    const { result } = renderHook(() => useVoiceInput({ onTranscript }))

    await act(async () => {
      await result.current.start()
    })
    const onerror = MockSpeechRecognition.latest?.onerror
    if (!onerror) throw new Error('Expected recognition error handler')

    act(() => onerror({ error: 'not-allowed' }))

    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('未授权使用麦克风，请在浏览器地址栏检查权限')
    expect(core.transcribeAudio).not.toHaveBeenCalled()
    expect(onTranscript).not.toHaveBeenCalled()
  })

  it('reports denied microphone permission without starting a recording', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(new DOMException('', 'NotAllowedError')),
      },
    })
    const { result } = renderHook(() => useVoiceInput({ onTranscript: vi.fn() }))

    await act(async () => {
      await result.current.start()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('未授权使用麦克风，请在浏览器地址栏检查权限')
    expect(core.transcribeAudio).not.toHaveBeenCalled()
  })

  it('reports empty recorded audio without inserting text', async () => {
    nextAudioBlob = new Blob([], { type: 'audio/webm' })
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useVoiceInput({ onTranscript }))

    await act(async () => {
      await result.current.start()
    })
    act(() => result.current.stop())

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe('未检测到可转写的音频，请再试一次')
    expect(core.transcribeAudio).not.toHaveBeenCalled()
    expect(onTranscript).not.toHaveBeenCalled()
  })

  it('cancels recording without inserting or uploading text', async () => {
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useVoiceInput({ onTranscript }))

    await act(async () => {
      await result.current.start()
    })
    act(() => result.current.cancel())

    expect(result.current.status).toBe('idle')
    expect(onTranscript).not.toHaveBeenCalled()
    expect(core.transcribeAudio).not.toHaveBeenCalled()
    expect(stopTrack).toHaveBeenCalledOnce()
  })

  it('cancels an in-flight transcription without inserting text', async () => {
    const transcription = createDeferred<{
      text: string
      language: string
      durationSeconds: number
    }>()
    core.transcribeAudio.mockReturnValue(transcription.promise)
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useVoiceInput({ onTranscript }))

    await act(async () => {
      await result.current.start()
    })
    act(() => result.current.stop())
    await waitFor(() => expect(core.transcribeAudio).toHaveBeenCalledOnce())
    act(() => result.current.cancel())
    await act(async () => {
      transcription.resolve({ text: '不得插入', language: 'zh', durationSeconds: 1 })
    })

    expect(result.current.status).toBe('idle')
    expect(onTranscript).not.toHaveBeenCalled()
  })
})
