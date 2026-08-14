import type { VoiceTranscriptionResponse } from '@yuanai/types'

import { apiClient } from './client.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getVoiceErrorMessage(error: unknown): string | null {
  if (!isRecord(error) || !isRecord(error['response'])) return null
  const response = error['response']
  if (!isRecord(response['data'])) return null
  const detail = response['data']['detail']
  if (typeof detail === 'string' && detail.trim()) return detail
  if (isRecord(detail) && typeof detail['message'] === 'string' && detail['message'].trim()) {
    return detail['message']
  }
  if (
    Array.isArray(detail) &&
    detail.some(
      (item) =>
        isRecord(item) &&
        Array.isArray(item['loc']) &&
        item['loc'].includes('file') &&
        item['type'] === 'missing'
    )
  ) {
    return '录音文件上传失败，请重新录制后重试'
  }
  return null
}

/** 语音转写请求的可取消配置。 */
export interface TranscribeAudioOptions {
  /** 取消正在进行的上传或转写请求。 */
  signal?: AbortSignal
}

/**
 * 上传浏览器或 Electron renderer 录制的音频，返回后端 Whisper 转写结果。
 *
 * @param file 已结束录制的音频文件，名称与 MIME 类型将原样传给服务端白名单校验。
 * @param options 可选的请求取消信号。
 * @returns 后端验证后的转写文本、语言和时长。
 */
export async function transcribeAudio(
  file: File,
  options: TranscribeAudioOptions = {}
): Promise<VoiceTranscriptionResponse> {
  const formData = new FormData()
  formData.append('file', file)
  const requestOptions = options.signal ? { signal: options.signal } : undefined
  try {
    const response = await apiClient.post<VoiceTranscriptionResponse>(
      '/voice/transcriptions',
      formData,
      requestOptions
    )
    const { data } = response
    if (
      typeof data.text !== 'string' ||
      !data.text.trim() ||
      (data.language !== null && typeof data.language !== 'string') ||
      typeof data.durationSeconds !== 'number' ||
      !Number.isFinite(data.durationSeconds)
    ) {
      throw new Error('Invalid voice transcription response')
    }
    return data
  } catch (error: unknown) {
    const message = getVoiceErrorMessage(error)
    if (message) throw new Error(message)
    throw error
  }
}
