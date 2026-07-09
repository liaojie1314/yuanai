'use client'

import { useEffect, useRef, useState, type JSX } from 'react'
import { X, Camera as CameraIcon, RefreshCw } from 'lucide-react'
import { openCameraStream, capturePhoto, releaseStream } from '@/lib/mediaCapture'

interface CameraModalProps {
  /** 是否显示浮层 */
  open: boolean
  /** 关闭浮层（用户按 X 或 ESC） */
  onClose: () => void
  /** 拍照成功回调，参数为导出的 PNG File */
  onCapture: (file: File) => void
  /** 打开 / 采集失败回调，用于上抛给 toast */
  onError?: (message: string) => void
}

/**
 * 摄像头拍照浮层。
 *
 * - `open=true` 时申请 `getUserMedia`，视频挂载到内部 `<video>` 预览
 * - 用户点击「拍照」调用 `capturePhoto`，成功后立刻关闭流 + 触发 `onCapture`
 * - 关闭浮层（`open=false` / ESC / X 按钮）会释放摄像头资源
 */
export function CameraModal({
  open,
  onClose,
  onCapture,
  onError,
}: CameraModalProps): JSX.Element | null {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setReady(false)
    ;(async () => {
      try {
        const stream = await openCameraStream()
        if (cancelled) {
          releaseStream(stream)
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play()
          setReady(true)
        }
      } catch (err) {
        if (cancelled) return
        onError?.(err instanceof Error ? err.message : '摄像头不可用')
        onClose()
      }
    })()

    return () => {
      cancelled = true
      releaseStream(streamRef.current)
      streamRef.current = null
      setReady(false)
    }
  }, [open, onClose, onError])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const shoot = async (): Promise<void> => {
    const video = videoRef.current
    if (!video || !ready || busy) return
    setBusy(true)
    try {
      const file = await capturePhoto(video)
      onCapture(file)
      onClose()
    } catch (err) {
      onError?.(err instanceof Error ? err.message : '拍照失败')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="ch-cam-backdrop" role="dialog" aria-modal="true" aria-label="摄像头拍照">
      <div className="ch-cam-modal">
        <div className="ch-cam-head">
          <span className="ch-cam-title">摄像头拍照</span>
          <button className="ch-ib" onClick={onClose} title="关闭" aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="ch-cam-body">
          {!ready && (
            <div className="ch-cam-loading">
              <RefreshCw size={20} className="ch-spin" />
              <span>正在启动摄像头…</span>
            </div>
          )}
          <video
            ref={videoRef}
            className="ch-cam-video"
            playsInline
            muted
            style={{ visibility: ready ? 'visible' : 'hidden' }}
          />
        </div>
        <div className="ch-cam-footer">
          <button
            className="ch-cam-shoot"
            onClick={() => {
              void shoot()
            }}
            disabled={!ready || busy}
          >
            <CameraIcon size={16} />
            {busy ? '处理中…' : '拍照'}
          </button>
        </div>
      </div>
    </div>
  )
}
