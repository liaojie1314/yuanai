import { apiClient } from './client.js'
import type { FilePreview } from '@yuanai/types'

/** 单个已上传文件的服务端元数据。 */
export interface FileRef {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  url: string
  fileHash?: string | null
  createdAt: string
}

/** 分片上传会话（创建 / 查询 / 进度共用）。 */
export interface UploadSession {
  sessionId: string
  /** 已完成上传的分片索引列表（0-based）。 */
  uploadedChunks: number[]
  /** 服务端约定的总分片数。 */
  totalChunks: number
  /** 服务端约定的分片大小（字节）。前后端必须一致，以此为准。 */
  chunkSize: number
  expiresAt: string
}

/**
 * 秒传检查：若服务端已有相同 hash 的文件，直接返回引用；否则返回 null。
 * @param fileHash 文件 SHA-256 哈希（十六进制）
 */
export async function checkFileHash(fileHash: string): Promise<FileRef | null> {
  try {
    const res = await apiClient.post<FileRef>('/files/check-hash', { fileHash })
    return res.data
  } catch {
    return null
  }
}

/**
 * 直接上传（≤ 10 MB）。文件走 multipart/form-data 表单。
 * @param file 待上传文件
 * @param fileHash 文件 SHA-256（可选，用于秒传去重）
 * @param onProgress 上传进度回调，参数为 0-100 的整数
 */
export async function uploadFileDirect(
  file: File,
  fileHash?: string,
  onProgress?: (pct: number) => void
): Promise<FileRef> {
  const formData = new FormData()
  formData.append('file', file)
  if (fileHash) formData.append('file_hash', fileHash)
  const res = await apiClient.post<FileRef>('/files/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (e.total && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
    },
  })
  return res.data
}

/**
 * 创建分片上传会话。
 * 同用户同 hash 的活跃会话会被后端幂等复用（断点续传的关键）。
 */
export async function createUploadSession(opts: {
  filename: string
  mimeType: string
  sizeBytes: number
  totalChunks: number
  fileHash?: string | null
}): Promise<UploadSession> {
  const res = await apiClient.post<UploadSession>('/files/upload-session', opts)
  return res.data
}

/**
 * 查询分片上传会话状态（含已上传分片列表），用于恢复中断的上传。
 * @param sessionId 上传会话 ID
 */
export async function getUploadSession(sessionId: string): Promise<UploadSession> {
  const res = await apiClient.get<UploadSession>(`/files/upload-session/${sessionId}`)
  return res.data
}

/**
 * 上传单个分片到指定会话。
 * @param sessionId 上传会话 ID
 * @param chunkIndex 分片索引（从 0 开始）
 * @param chunk 分片二进制内容
 */
export async function uploadChunk(
  sessionId: string,
  chunkIndex: number,
  chunk: Blob
): Promise<{ uploaded: number[]; chunkIndex: number }> {
  const formData = new FormData()
  formData.append('chunk', chunk)
  const res = await apiClient.put<{ uploaded: number[]; chunkIndex: number }>(
    `/files/upload-session/${sessionId}/chunk/${chunkIndex}`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  )
  return res.data
}

/**
 * 通知服务端所有分片上传完毕，触发对象存储合并并落库 File。
 */
export async function completeUpload(sessionId: string): Promise<FileRef> {
  const res = await apiClient.post<FileRef>(`/files/upload-session/${sessionId}/complete`)
  return res.data
}

/**
 * 中止分片上传（用户取消 / 前端不再需要该会话）。同时清理对象存储的已上传分片。
 */
export async function abortUpload(sessionId: string): Promise<void> {
  await apiClient.delete(`/files/upload-session/${sessionId}`)
}

/** 获取已上传文件的受限预览内容。 */
export async function getFilePreview(fileId: string): Promise<FilePreview> {
  const res = await apiClient.get<FilePreview>(`/files/${fileId}/preview`)
  return res.data
}
