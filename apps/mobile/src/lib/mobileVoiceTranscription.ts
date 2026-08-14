import { API_BASE_URL } from '@yuanai/core'
import { useAuthStore } from '@yuanai/core/stores'
import type { VoiceTranscriptionResponse } from '@yuanai/types'

/** 移动端缓存录音的本地文件引用。 */
export interface MobileVoiceAudio {
  /** Expo 或原生模块提供的本地文件 URI。 */
  uri: string
  /** 服务端允许的音频 MIME 类型。 */
  mimeType: string
  /** 可选的上传文件名；未提供时按 MIME 生成安全默认名。 */
  filename?: string
}

/** 移动端转写请求的可取消配置。 */
export interface TranscribeMobileAudioOptions {
  /** 取消正在上传的音频。 */
  signal?: AbortSignal
}

interface NativeFilePart {
  uri: string
  name: string
  type: string
}

function defaultFilename(mimeType: string): string {
  if (mimeType.includes('wav')) return 'voice.wav'
  if (mimeType.includes('mpeg')) return 'voice.mp3'
  return 'voice.m4a'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function responseMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback
  const detail = payload['detail']
  if (typeof detail === 'string' && detail.trim()) return detail
  if (isRecord(detail) && typeof detail['message'] === 'string' && detail['message'].trim()) {
    return detail['message']
  }
  return fallback
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    return responseMessage((await response.json()) as unknown, fallback)
  } catch {
    return fallback
  }
}

function parseResponse(payload: unknown): VoiceTranscriptionResponse {
  if (!isRecord(payload)) throw new Error('语音转写响应格式无效，请重试')
  const text = payload['text']
  const language = payload['language']
  const durationSeconds = payload['durationSeconds']
  if (
    typeof text !== 'string' ||
    !text.trim() ||
    (language !== null && typeof language !== 'string') ||
    typeof durationSeconds !== 'number' ||
    !Number.isFinite(durationSeconds)
  ) {
    throw new Error('语音转写响应格式无效，请重试')
  }
  return { text, language, durationSeconds }
}

/**
 * 将移动端原生录音上传到受保护的 Whisper 转写接口。
 *
 * React Native 会根据 `{ uri, name, type }` 文件 part 自动生成 multipart boundary，
 * 因此请求头仅携带认证信息，不能手动设置 `Content-Type`。
 *
 * @param audio 已停止录制的本地音频文件。
 * @param options 可选的请求取消信号。
 * @returns 后端验证后的转写文本、语言和录音时长。
 */
export async function transcribeMobileAudio(
  audio: MobileVoiceAudio,
  options: TranscribeMobileAudioOptions = {}
): Promise<VoiceTranscriptionResponse> {
  const accessToken = useAuthStore.getState().accessToken
  if (!accessToken) throw new Error('请先登录后再使用语音输入')

  const filePart: NativeFilePart = {
    uri: audio.uri,
    name: audio.filename ?? defaultFilename(audio.mimeType),
    type: audio.mimeType,
  }
  const formData = new FormData()
  // React Native 支持 URI 文件 part；DOM 的 FormData 声明没有该重载。
  formData.append('file', filePart as unknown as Blob)
  const request: RequestInit = {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  }
  if (options.signal) request.signal = options.signal

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/voice/transcriptions`, request)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error('语音转写网络请求失败，请检查网络后重试')
  }
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `语音转写失败 (${String(response.status)})`))
  }
  try {
    return parseResponse((await response.json()) as unknown)
  } catch (error) {
    if (error instanceof Error) throw error
    throw new Error('语音转写响应格式无效，请重试')
  }
}
