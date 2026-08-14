import type { InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { VoiceTranscriptionResponse } from '@yuanai/types'

import { apiClient } from '../client.js'
import { transcribeAudio } from '../voice.js'

let responseData: VoiceTranscriptionResponse
let requestConfig: InternalAxiosRequestConfig | null
let originalAdapter: typeof apiClient.defaults.adapter

const voiceAdapter = async (config: InternalAxiosRequestConfig) => {
  requestConfig = config
  return {
    data: responseData,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  }
}

describe('transcribeAudio', () => {
  beforeEach(() => {
    responseData = { text: '测试语音', language: 'zh', durationSeconds: 1.2 }
    requestConfig = null
    originalAdapter = apiClient.defaults.adapter
    apiClient.defaults.adapter = voiceAdapter
  })

  afterEach(() => {
    if (originalAdapter === undefined) delete apiClient.defaults.adapter
    else apiClient.defaults.adapter = originalAdapter
  })

  it('posts a named audio file as multipart form data', async () => {
    const file = new File(['audio'], 'voice.webm', { type: 'audio/webm' })

    await expect(transcribeAudio(file)).resolves.toEqual(responseData)
    expect(requestConfig?.url).toBe('/voice/transcriptions')
    expect(requestConfig?.data).toBeInstanceOf(FormData)
    expect(requestConfig?.headers['Content-Type']).not.toBe('application/json')
    if (!(requestConfig?.data instanceof FormData)) throw new Error('Expected multipart form data')
    const uploaded = requestConfig.data.get('file')
    expect(uploaded).toBeInstanceOf(File)
    if (!(uploaded instanceof File)) throw new Error('Expected uploaded audio file')
    expect(uploaded.name).toBe('voice.webm')
  })

  it('rejects malformed successful payloads before they reach UI state', async () => {
    responseData = { text: '', language: 'zh', durationSeconds: 1.2 }
    const file = new File(['audio'], 'voice.webm', { type: 'audio/webm' })

    await expect(transcribeAudio(file)).rejects.toThrow('Invalid voice transcription response')
  })

  it('uses the structured backend validation message instead of Axios status text', async () => {
    apiClient.defaults.adapter = async (): Promise<never> => {
      throw {
        message: 'Request failed with status code 422',
        response: {
          data: {
            detail: {
              code: 'VOICE_DURATION_UNREADABLE',
              message: '无法读取音频时长，请重新录制后重试',
            },
          },
          status: 422,
        },
      }
    }
    const file = new File(['audio'], 'voice.webm', { type: 'audio/webm' })

    await expect(transcribeAudio(file)).rejects.toThrow('无法读取音频时长，请重新录制后重试')
  })

  it('explains a missing multipart file instead of exposing an Axios 422 message', async () => {
    apiClient.defaults.adapter = async (): Promise<never> => {
      throw {
        message: 'Request failed with status code 422',
        response: {
          data: {
            detail: [
              {
                type: 'missing',
                loc: ['body', 'file'],
                msg: 'Field required',
              },
            ],
          },
          status: 422,
        },
      }
    }
    const file = new File(['audio'], 'voice.webm', { type: 'audio/webm' })

    await expect(transcribeAudio(file)).rejects.toThrow('录音文件上传失败，请重新录制后重试')
  })
})
