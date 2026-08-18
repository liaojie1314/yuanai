import { useCallback, useRef, useState } from 'react'
import {
  abortUpload,
  checkFileHash,
  completeUpload,
  createUploadSession,
  getUploadSession,
  uploadChunk,
  uploadFileDirect,
  type FileRef,
  type UploadSession,
} from '../api/files.js'

/** 直传阈值 —— 与后端 ``max_direct_upload_bytes`` 一致。 */
const DIRECT_THRESHOLD = 10 * 1024 * 1024
/** 单片大小 —— 与后端 ``upload_chunk_size_bytes`` 一致（S3 多段上传要求 ≥ 5 MB）。 */
const CHUNK_SIZE = 5 * 1024 * 1024
/** localStorage 中保存 hash → sessionId 映射的 key 前缀。 */
const RESUME_KEY_PREFIX = 'yuanai:upload-session:'

/** 上传任务生命周期状态。 */
export type UploadStatus =
  'idle' | 'hashing' | 'checking' | 'uploading' | 'finalizing' | 'done' | 'error' | 'canceled'

/** 上传过程中的进度快照（供 UI 订阅）。 */
export interface UploadProgress {
  status: UploadStatus
  /** 0-100 整数。 */
  percent: number
  /** 若命中秒传/直传结束，指向服务端 FileRef。 */
  fileRef: FileRef | null
  /** 错误消息（``status === 'error'`` 时可读）。 */
  error: string | null
}

/** ``uploadFileSmart`` 可选参数集合。 */
export interface UploadFileOptions {
  /** 每次状态变化时调用（含分片进度）。 */
  onProgress?: (snapshot: UploadProgress) => void
  /** 传入 AbortSignal 可从外部取消上传（正在传输的分片会立即中断）。 */
  signal?: AbortSignal
}

/** ``useFileUpload`` hook 返回值。 */
export interface UseFileUploadResult {
  status: UploadStatus
  /** 上传进度 0-100。 */
  progress: number
  fileRef: FileRef | null
  error: string | null
  /** 启动上传（秒传/直传/分片自动选择）。 */
  upload: (file: File) => Promise<FileRef | null>
  /** 取消当前上传（分片会话会向服务端 abort）。 */
  cancel: () => void
  /** 复位为初始状态。 */
  reset: () => void
}

/**
 * 计算文件 SHA-256 哈希（16 进制字符串）。
 *
 * ⚠️ 使用 SubtleCrypto 的一次性 digest，需将整个文件加载到内存。
 * 500 MB 以上文件在移动端可能内存吃紧；后续可切换到 streaming SHA-256 库。
 */
async function computeHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** 保存 hash → sessionId 到 localStorage，用于跨刷新断点续传。 */
function rememberSession(fileHash: string, session: UploadSession): void {
  if (typeof window === 'undefined') return
  try {
    const payload = JSON.stringify({
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
    })
    window.localStorage.setItem(RESUME_KEY_PREFIX + fileHash, payload)
  } catch {
    // localStorage 满 / 无痕模式禁用 — 忽略，不影响首次上传
  }
}

/** 读取 hash 对应的活跃会话；过期或不存在返回 null。 */
function recallSession(fileHash: string): { sessionId: string; expiresAt: string } | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(RESUME_KEY_PREFIX + fileHash)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { sessionId: string; expiresAt: string }
    if (Date.parse(parsed.expiresAt) < Date.now()) {
      window.localStorage.removeItem(RESUME_KEY_PREFIX + fileHash)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/** 上传成功/失败后清理 localStorage 中的会话记录。 */
function forgetSession(fileHash: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(RESUME_KEY_PREFIX + fileHash)
  } catch {
    // 忽略
  }
}

/**
 * 智能上传单个文件 —— 依次尝试秒传、直传、分片断点续传，返回服务端 FileRef。
 *
 * 关键流程：
 * 1. 计算 SHA-256 → ``/files/check-hash`` 尝试秒传
 * 2. 未命中且文件小于 10 MB → 走直传 ``/files/upload``
 * 3. 否则创建（或复用）分片会话；若 localStorage 有记录，先 ``GET`` 拉回已上传分片
 * 4. 逐片 ``PUT`` 上传（跳过已完成的），失败即向上抛出
 * 5. 所有分片就绪后 ``POST /complete`` 触发服务端合并
 */
export async function uploadFileSmart(file: File, opts: UploadFileOptions = {}): Promise<FileRef> {
  const { onProgress, signal } = opts
  const emit = (patch: Partial<UploadProgress>): void => {
    onProgress?.({
      status: 'idle',
      percent: 0,
      fileRef: null,
      error: null,
      ...patch,
    })
  }
  const throwIfAborted = (): void => {
    if (signal?.aborted) {
      const err = new Error('canceled')
      err.name = 'AbortError'
      throw err
    }
  }

  emit({ status: 'hashing', percent: 0 })
  const fileHash = await computeHash(file)
  throwIfAborted()

  emit({ status: 'checking', percent: 5 })
  const existing = await checkFileHash(fileHash)
  if (existing) {
    emit({ status: 'done', percent: 100, fileRef: existing })
    return existing
  }
  throwIfAborted()

  // 小文件 —— 直传路径
  if (file.size <= DIRECT_THRESHOLD) {
    emit({ status: 'uploading', percent: 10 })
    const ref = await uploadFileDirect(file, fileHash, (pct) => {
      emit({ status: 'uploading', percent: Math.max(10, pct) })
    })
    forgetSession(fileHash)
    emit({ status: 'done', percent: 100, fileRef: ref })
    return ref
  }

  // 大文件 —— 分片路径，先尝试复用 localStorage 中的活跃会话
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
  let session: UploadSession | null = null
  const remembered = recallSession(fileHash)
  if (remembered) {
    try {
      session = await getUploadSession(remembered.sessionId)
      if (session.totalChunks !== totalChunks) {
        // 元数据不一致 —— 放弃恢复，走新建流程
        session = null
        forgetSession(fileHash)
      }
    } catch {
      // 会话已被清理或权限失效 —— 放弃恢复
      session = null
      forgetSession(fileHash)
    }
  }
  if (!session) {
    session = await createUploadSession({
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      totalChunks,
      fileHash,
    })
    rememberSession(fileHash, session)
  }
  throwIfAborted()

  const uploaded = new Set<number>(session.uploadedChunks)
  const chunkSize = session.chunkSize || CHUNK_SIZE
  emit({
    status: 'uploading',
    percent: Math.round((uploaded.size / totalChunks) * 90),
  })

  for (let i = 0; i < totalChunks; i++) {
    throwIfAborted()
    if (uploaded.has(i)) continue
    const start = i * chunkSize
    const end = Math.min(start + chunkSize, file.size)
    const slice = file.slice(start, end)
    const result = await uploadChunk(session.sessionId, i, slice)
    result.uploaded.forEach((idx) => uploaded.add(idx))
    emit({
      status: 'uploading',
      percent: Math.round((uploaded.size / totalChunks) * 90),
    })
  }
  throwIfAborted()

  emit({ status: 'finalizing', percent: 95 })
  const ref = await completeUpload(session.sessionId)
  forgetSession(fileHash)
  emit({ status: 'done', percent: 100, fileRef: ref })
  return ref
}

/**
 * 文件上传 hook：包装 ``uploadFileSmart``，暴露状态供 React 组件订阅。
 * 内部用 AbortController 管理取消；重复调用 ``upload`` 会取消上一次任务。
 */
export function useFileUpload(): UseFileUploadResult {
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [fileRef, setFileRef] = useState<FileRef | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const sessionIdRef = useRef<string | null>(null)

  const reset = useCallback((): void => {
    abortRef.current?.abort()
    abortRef.current = null
    sessionIdRef.current = null
    setStatus('idle')
    setProgress(0)
    setFileRef(null)
    setError(null)
  }, [])

  const cancel = useCallback((): void => {
    abortRef.current?.abort()
    setStatus('canceled')
    if (sessionIdRef.current) {
      void abortUpload(sessionIdRef.current).catch(() => {
        /* 服务端已清理即可 */
      })
      sessionIdRef.current = null
    }
  }, [])

  const upload = useCallback(async (file: File): Promise<FileRef | null> => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    sessionIdRef.current = null
    setError(null)
    setFileRef(null)
    setProgress(0)
    setStatus('hashing')

    try {
      const ref = await uploadFileSmart(file, {
        signal: controller.signal,
        onProgress: (snap) => {
          setStatus(snap.status)
          setProgress(snap.percent)
          if (snap.fileRef) setFileRef(snap.fileRef)
        },
      })
      return ref
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setStatus('canceled')
        return null
      }
      const msg = (err as { message?: string })?.message ?? '上传失败'
      setError(msg)
      setStatus('error')
      return null
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [])

  return { status, progress, fileRef, error, upload, cancel, reset }
}
