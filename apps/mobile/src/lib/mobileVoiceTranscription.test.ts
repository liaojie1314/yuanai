import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { transcribeMobileAudio } from './mobileVoiceTranscription'

const auth = vi.hoisted(() => ({ accessToken: 'mobile-token' as string | null }))

vi.mock('@yuanai/core', () => ({ API_BASE_URL: 'http://api.example/api/v1' }))
vi.mock('@yuanai/core/stores', () => ({
  useAuthStore: { getState: () => auth },
}))

describe('transcribeMobileAudio', () => {
  beforeEach(() => {
    auth.accessToken = 'mobile-token'
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('uploads a recorded native URI with the authenticated multipart contract', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ text: '移动端语音', language: 'zh', durationSeconds: 1.8 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await expect(
      transcribeMobileAudio({ uri: 'file:///cache/voice.m4a', mimeType: 'audio/mp4' })
    ).resolves.toEqual({ text: '移动端语音', language: 'zh', durationSeconds: 1.8 })

    expect(fetch).toHaveBeenCalledWith(
      'http://api.example/api/v1/voice/transcriptions',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer mobile-token' },
      })
    )
  })

  it('requires an authenticated user before attempting an upload', async () => {
    auth.accessToken = null

    await expect(
      transcribeMobileAudio({ uri: 'file:///cache/voice.m4a', mimeType: 'audio/mp4' })
    ).rejects.toThrow('请先登录后再使用语音输入')

    expect(fetch).not.toHaveBeenCalled()
  })

  it('surfaces the backend-safe error message', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: { code: 'VOICE_TRANSCRIPTION_UNAVAILABLE', message: '语音转写暂不可用' },
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )
    )

    await expect(
      transcribeMobileAudio({ uri: 'file:///cache/voice.m4a', mimeType: 'audio/mp4' })
    ).rejects.toThrow('语音转写暂不可用')
  })
})
