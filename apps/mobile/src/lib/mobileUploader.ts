/**
 * 移动端智能上传：秒传（SHA-256）→ 直传（≤10MB）→ 分片断点续传（>10MB）。
 *
 * 与 web `uploadFileSmart` 同一后端协议，复用 @yuanai/core 的会话 API
 * （checkFileHash / createUploadSession / getUploadSession / completeUpload）。
 * IO 层是 RN 专用：
 * - RN 无 web File/Blob.arrayBuffer，hash 用 expo-file-system 分段读 base64 +
 *   js-sha256 增量计算；
 * - multipart 直传/分片走原生 fetch + `{ uri, name, type }` FormData（axios 的
 *   transformRequest 会破坏该格式）；分片先落临时文件再以 uri 方式提交。
 * - 断点续传不依赖 localStorage：后端对同用户同 hash 的活跃会话幂等复用，
 *   createUploadSession 会带回 uploadedChunks，跳过已完成分片即可。
 */

import * as FileSystem from 'expo-file-system'
import { sha256 } from 'js-sha256'

import { API_BASE_URL } from '@yuanai/core'
import {
  checkFileHash,
  completeUpload,
  createUploadSession,
  getUploadSession,
} from '@yuanai/core/api'
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

/** 直传阈值 —— 与后端 max_direct_upload_bytes / web DIRECT_THRESHOLD 一致 */
const DIRECT_THRESHOLD = 10 * 1024 * 1024
/** 单片大小 —— 与后端 upload_chunk_size_bytes 一致（S3 要求 ≥ 5MB） */
const CHUNK_SIZE = 5 * 1024 * 1024
/** 计算哈希时每次读入的字节数（base64 解码后）；过大易触发 OOM */
const HASH_READ_BYTES = 2 * 1024 * 1024

/** base64 → 字节数组（RN 无 atob 的环境用查表实现，避免引入 polyfill） */
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_LOOKUP = new Uint8Array(128)
for (let i = 0; i < B64_CHARS.length; i++) B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i

function base64ToBytes(b64: string): Uint8Array {
  let len = b64.length
  while (len > 0 && b64[len - 1] === '=') len--
  const outLen = Math.floor((len * 3) / 4)
  const out = new Uint8Array(outLen)
  let o = 0
  for (let i = 0; i < len; i += 4) {
    const a = B64_LOOKUP[b64.charCodeAt(i)] ?? 0
    const b = B64_LOOKUP[b64.charCodeAt(i + 1)] ?? 0
    const c = B64_LOOKUP[b64.charCodeAt(i + 2)] ?? 0
    const d = B64_LOOKUP[b64.charCodeAt(i + 3)] ?? 0
    if (o < outLen) out[o++] = (a << 2) | (b >> 4)
    if (o < outLen) out[o++] = ((b & 15) << 4) | (c >> 2)
    if (o < outLen) out[o++] = ((c & 3) << 6) | d
  }
  return out
}

/** 分段读文件计算 SHA-256（hex）。position/length 按原始字节计。 */
async function computeFileHash(uri: string, sizeBytes: number): Promise<string> {
  const hasher = sha256.create()
  for (let pos = 0; pos < sizeBytes; pos += HASH_READ_BYTES) {
    const length = Math.min(HASH_READ_BYTES, sizeBytes - pos)
    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      position: pos,
      length,
    })
    hasher.update(base64ToBytes(b64))
  }
  return hasher.hex()
}

function authHeader(): { Authorization: string } {
  const token = useAuthStore.getState().accessToken
  if (!token) throw new Error('未登录，无法上传文件')
  return { Authorization: `Bearer ${token}` }
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as {
      detail?: { message?: string; code?: string } | string
    }
    if (typeof body.detail === 'object' && body.detail?.message) return body.detail.message
    if (typeof body.detail === 'string') return body.detail
  } catch {
    /* JSON 解析失败用兜底文案 */
  }
  return fallback
}

/** multipart 直传整文件（RN FormData { uri } 形态） */
async function uploadDirect(params: {
  uri: string
  name: string
  mimeType: string
  fileHash: string
}): Promise<UploadedFile> {
  const formData = new FormData()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formData.append('file', { uri: params.uri, name: params.name, type: params.mimeType } as any)
  formData.append('file_hash', params.fileHash)

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/files/upload`, {
      method: 'POST',
      headers: authHeader(),
      body: formData,
    })
  } catch {
    throw new Error('网络请求失败，请检查网络后重试')
  }
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `上传失败 (${String(response.status)})`))
  }
  const data = (await response.json()) as UploadedFile
  return {
    id: String(data.id),
    filename: data.filename,
    mimeType: data.mimeType,
    sizeBytes: data.sizeBytes,
    url: data.url,
  }
}

/** 上传单个分片：切片落临时文件 → PUT multipart → 清理 */
async function uploadChunkMobile(params: {
  sessionId: string
  chunkIndex: number
  sourceUri: string
  position: number
  length: number
}): Promise<number[]> {
  const { sessionId, chunkIndex, sourceUri, position, length } = params
  const b64 = await FileSystem.readAsStringAsync(sourceUri, {
    encoding: FileSystem.EncodingType.Base64,
    position,
    length,
  })
  const tmpUri = `${FileSystem.cacheDirectory ?? ''}yuanai-chunk-${sessionId}-${String(chunkIndex)}`
  await FileSystem.writeAsStringAsync(tmpUri, b64, {
    encoding: FileSystem.EncodingType.Base64,
  })
  try {
    const formData = new FormData()
    formData.append('chunk', {
      uri: tmpUri,
      name: `chunk-${String(chunkIndex)}`,
      type: 'application/octet-stream',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    let response: Response
    try {
      response = await fetch(
        `${API_BASE_URL}/files/upload-session/${sessionId}/chunk/${String(chunkIndex)}`,
        { method: 'PUT', headers: authHeader(), body: formData }
      )
    } catch {
      throw new Error('网络请求失败，请检查网络后重试')
    }
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, `分片上传失败 (${String(response.status)})`))
    }
    const data = (await response.json()) as { uploaded: number[] }
    return data.uploaded
  } finally {
    await FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {
      /* 临时文件清理失败可忽略 */
    })
  }
}

/**
 * 智能上传：秒传 → 直传 → 分片，进度回调为真实进度。
 *
 * 进度分配：hash 0-5、秒传检查 5-10、传输 10-95、收尾 95-100。
 *
 * @throws 文件读取失败 / 未登录 / 网络错误 / 服务端错误，message 为可展示中文。
 */
export async function uploadFileMobile(params: {
  uri: string
  name: string
  mimeType: string
  onProgress?: UploadProgressCallback
}): Promise<UploadedFile> {
  const { uri, name, mimeType, onProgress } = params

  const info = await FileSystem.getInfoAsync(uri, { size: true })
  if (!info.exists) throw new Error('文件不存在或已被移动')
  const sizeBytes = 'size' in info && typeof info.size === 'number' ? info.size : 0

  // 1) hash + 秒传
  onProgress?.(1)
  const fileHash = await computeFileHash(uri, sizeBytes)
  onProgress?.(5)
  const existing = await checkFileHash(fileHash)
  if (existing) {
    onProgress?.(100)
    return {
      id: String(existing.id),
      filename: existing.filename,
      mimeType: existing.mimeType,
      sizeBytes: existing.sizeBytes,
      url: existing.url,
    }
  }
  onProgress?.(10)

  // 2) 小文件直传
  if (sizeBytes <= DIRECT_THRESHOLD) {
    const ref = await uploadDirect({ uri, name, mimeType, fileHash })
    onProgress?.(100)
    return ref
  }

  // 3) 大文件分片；后端按（user, hash）幂等复用活跃会话 → 天然断点续传
  const totalChunks = Math.ceil(sizeBytes / CHUNK_SIZE)
  let session = await createUploadSession({
    filename: name,
    mimeType: mimeType || 'application/octet-stream',
    sizeBytes,
    totalChunks,
    fileHash,
  })
  if (session.totalChunks !== totalChunks) {
    // 会话与本地元数据不一致（如同 hash 不同分片数的旧会话）→ 重新查询兜底
    session = await getUploadSession(session.sessionId)
  }
  const chunkSize = session.chunkSize || CHUNK_SIZE
  const uploaded = new Set<number>(session.uploadedChunks)
  const emitChunkProgress = (): void => {
    onProgress?.(10 + Math.round((uploaded.size / totalChunks) * 85))
  }
  emitChunkProgress()

  for (let i = 0; i < totalChunks; i++) {
    if (uploaded.has(i)) continue
    const position = i * chunkSize
    const length = Math.min(chunkSize, sizeBytes - position)
    const done = await uploadChunkMobile({
      sessionId: session.sessionId,
      chunkIndex: i,
      sourceUri: uri,
      position,
      length,
    })
    done.forEach((idx) => uploaded.add(idx))
    emitChunkProgress()
  }

  const ref = await completeUpload(session.sessionId)
  onProgress?.(100)
  return {
    id: String(ref.id),
    filename: ref.filename,
    mimeType: ref.mimeType,
    sizeBytes: ref.sizeBytes,
    url: ref.url,
  }
}
