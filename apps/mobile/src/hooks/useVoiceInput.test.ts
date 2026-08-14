import { createElement, useEffect } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useVoiceInput } from './useVoiceInput'
import type { VoiceInputState } from './useVoiceInput'

type SpeechListener = (event: unknown) => void

const speech = vi.hoisted(() => ({
  listeners: {} as Record<string, SpeechListener>,
  abort: vi.fn(),
  addListener: vi.fn((event: string, listener: SpeechListener) => {
    speech.listeners[event] = listener
    return { remove: vi.fn() }
  }),
  requestPermissionsAsync: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  supportsRecording: vi.fn(),
}))

const audio = vi.hoisted(() => ({
  recording: {
    getURI: vi.fn(() => 'file:///cache/fallback.m4a'),
    stopAndUnloadAsync: vi.fn().mockResolvedValue(undefined),
  },
  createAsync: vi.fn(),
}))

const transcribe = vi.hoisted(() => ({ transcribeMobileAudio: vi.fn() }))

vi.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: speech }))
vi.mock('expo-av', () => ({
  Audio: {
    Recording: { createAsync: audio.createAsync },
    RecordingOptionsPresets: { HIGH_QUALITY: { format: 'm4a' } },
  },
}))
vi.mock('./../lib/mobileVoiceTranscription', () => transcribe)

const mountedRenderers: Array<ReturnType<typeof create>> = []

function renderVoiceInput(onTranscript: (text: string) => void): {
  current: () => VoiceInputState
} {
  let current: VoiceInputState | null = null

  function VoiceInputHarness(): null {
    const state = useVoiceInput({ onTranscript })
    useEffect(() => {
      current = state
    })
    return null
  }

  act(() => {
    mountedRenderers.push(create(createElement(VoiceInputHarness)))
  })
  return {
    current: () => {
      if (!current) throw new Error('Voice input hook did not render')
      return current
    },
  }
}

describe('useVoiceInput', () => {
  beforeEach(() => {
    speech.listeners = {}
    speech.abort.mockReset()
    speech.addListener.mockClear()
    speech.requestPermissionsAsync.mockResolvedValue({ granted: true })
    speech.start.mockReset()
    speech.stop.mockReset()
    speech.supportsRecording.mockReturnValue(true)
    audio.createAsync.mockResolvedValue({ recording: audio.recording })
    audio.recording.getURI.mockReturnValue('file:///cache/fallback.m4a')
    audio.recording.stopAndUnloadAsync.mockClear()
    transcribe.transcribeMobileAudio.mockReset()
  })

  afterEach(() => {
    while (mountedRenderers.length > 0) {
      const renderer = mountedRenderers.pop()
      if (renderer) act(() => renderer.unmount())
    }
    vi.restoreAllMocks()
  })

  it('appends a final native recognition result without uploading or sending', async () => {
    const onTranscript = vi.fn()
    const hook = renderVoiceInput(onTranscript)

    await act(async () => {
      await hook.current().start()
    })
    act(() =>
      speech.listeners.result?.({
        isFinal: true,
        results: [{ transcript: '本地语音', confidence: 0.9, segments: [] }],
      })
    )

    expect(onTranscript).toHaveBeenCalledWith('本地语音')
    expect(transcribe.transcribeMobileAudio).not.toHaveBeenCalled()
    expect(hook.current().status).toBe('idle')
  })

  it('reports denied native permissions without starting recognition or fallback', async () => {
    speech.requestPermissionsAsync.mockResolvedValue({ granted: false })
    const hook = renderVoiceInput(vi.fn())

    await act(async () => {
      await hook.current().start()
    })

    expect(hook.current().status).toBe('error')
    expect(hook.current().error).toContain('麦克风')
    expect(speech.start).not.toHaveBeenCalled()
    expect(audio.createAsync).not.toHaveBeenCalled()
  })

  it('uploads the persisted native recording after a recoverable recognition failure', async () => {
    transcribe.transcribeMobileAudio.mockResolvedValue({
      text: '云端转写',
      language: 'zh',
      durationSeconds: 1.4,
    })
    const onTranscript = vi.fn()
    const hook = renderVoiceInput(onTranscript)

    await act(async () => {
      await hook.current().start()
    })
    await act(async () => {
      speech.listeners.error?.({ error: 'network', message: 'network down' })
      speech.listeners.audioend?.({ uri: 'file:///cache/native.wav' })
      await Promise.resolve()
    })

    expect(transcribe.transcribeMobileAudio).toHaveBeenCalledOnce()
    expect(transcribe.transcribeMobileAudio).toHaveBeenCalledWith(
      {
        uri: 'file:///cache/native.wav',
        mimeType: 'audio/wav',
        filename: 'voice.wav',
      },
      expect.any(Object)
    )
    expect(onTranscript).toHaveBeenCalledWith('云端转写')
    expect(hook.current().status).toBe('idle')
  })

  it('uses expo-av recording when native speech cannot persist audio', async () => {
    speech.supportsRecording.mockReturnValue(false)
    transcribe.transcribeMobileAudio.mockResolvedValue({
      text: '录音回退',
      language: 'zh',
      durationSeconds: 1,
    })
    const onTranscript = vi.fn()
    const hook = renderVoiceInput(onTranscript)

    await act(async () => {
      await hook.current().start()
    })
    await act(async () => {
      speech.listeners.error?.({ error: 'service-not-allowed', message: 'unavailable' })
      await Promise.resolve()
    })
    act(() => hook.current().stop())

    expect(transcribe.transcribeMobileAudio).toHaveBeenCalledOnce()
    expect(audio.recording.stopAndUnloadAsync).toHaveBeenCalledOnce()
    expect(onTranscript).toHaveBeenCalledWith('录音回退')
  })

  it('cancels native recognition and fallback without inserting text', async () => {
    const onTranscript = vi.fn()
    const hook = renderVoiceInput(onTranscript)

    await act(async () => {
      await hook.current().start()
    })
    act(() => hook.current().cancel())

    expect(speech.abort).toHaveBeenCalledOnce()
    expect(onTranscript).not.toHaveBeenCalled()
    expect(transcribe.transcribeMobileAudio).not.toHaveBeenCalled()
    expect(hook.current().status).toBe('idle')
  })
})
