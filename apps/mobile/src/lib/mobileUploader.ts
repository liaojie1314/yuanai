/**
 * 移动端专用直传上传工具。
 *
 * 不用 apiClient (axios) 的原因：React Native 的 FormData 要求用 `{ uri, name, type }`
 * 对象代替 Blob，axios 的 transformRequest 会破坏这个格式；原生 fetch 可以原样透传。
 * Auth token 从 useAuthStore.getState() 手动注入。
 */

import { API_BASE_URL } from '@yuanai/core'
import { useAuthStore } from '@yuanai/core/stores'

export interface UploadedFile {
  /** 后端返回的 File UUID（字符串） */
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  url: string
}

export type UploadProgressCallback = (progress: number) => void

/**
 * 上传单个文件到 POST /api/v1/files/upload（直传，≤10MB）。
 *
 * @throws 文件过大（413）、未登录、网络错误时抛出 Error，message 含可展示中文原因。
 */
export async function uploadFileMobile(params: {
  uri: string
  name: string
  mimeType: string
  onProgress?: UploadProgressCallback
}): Promise<UploadedFile> {
  const { uri, name, mimeType, onProgress } = params

  const token = useAuthStore.getState().accessToken
  if (!token) throw new Error('未登录，无法上传文件')

  // RN FormData 接受 { uri, name, type } 对象——fetch 会把它编码成 multipart
  const formData = new FormData()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formData.append('file', { uri, name, type: mimeType } as any)

  onProgress?.(10) // 标记「开始上传」

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/files/upload`, {
      method: 'POST',
      headers: {
        // 不手动设 Content-Type：fetch 会带正确的 multipart boundary
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    })
  } catch {
    throw new Error('网络请求失败，请检查网络后重试')
  }

  if (!response.ok) {
    let message = `上传失败 (${String(response.status)})`
    try {
      const body = (await response.json()) as {
        detail?: { message?: string; code?: string } | string
      }
      if (typeof body.detail === 'object' && body.detail?.message) {
        message = body.detail.message
      } else if (typeof body.detail === 'string') {
        message = body.detail
      }
    } catch {
      // ignore JSON parse error
    }
    throw new Error(message)
  }

  // 后端 FileResponse 用 to_camel alias_generator，返回 camelCase
  const data = (await response.json()) as {
    id: string
    filename: string
    mimeType: string
    sizeBytes: number
    url: string
  }

  onProgress?.(100)

  return {
    id: String(data.id),
    filename: data.filename,
    mimeType: data.mimeType,
    sizeBytes: data.sizeBytes,
    url: data.url,
  }
}
