'use client'

/**
 * 屏幕 / 摄像头媒体采集工具。
 *
 * 两个入口都需要浏览器满足以下条件：
 * - 站点为 HTTPS 或 `localhost`
 * - 浏览器实现 `navigator.mediaDevices`
 * - 用户在权限提示中允许
 *
 * 采集完成后统一返回 `File`（`image/png`），
 * 供 `ChatInterface` 的附件队列复用 `useFileUpload` 上传链路。
 */

/**
 * 检测 getDisplayMedia 是否可用（屏幕截取）。
 */
export function isScreenCaptureSupported(): boolean {
  if (typeof navigator === 'undefined') return false
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function'
}

/**
 * 检测 getUserMedia 是否可用（摄像头）。
 */
export function isCameraSupported(): boolean {
  if (typeof navigator === 'undefined') return false
  return typeof navigator.mediaDevices?.getUserMedia === 'function'
}

/**
 * 把 `<video>` 当前画面画到 canvas，导出为 PNG File。
 * 私有工具函数，供截屏 / 拍照复用。
 */
async function videoFrameToFile(video: HTMLVideoElement, filenamePrefix: string): Promise<File> {
  const width = video.videoWidth || 1280
  const height = video.videoHeight || 720
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 canvas 上下文')
  ctx.drawImage(video, 0, 0, width, height)
  const blob: Blob | null = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png')
  })
  if (!blob) throw new Error('画面导出失败')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return new File([blob], `${filenamePrefix}-${stamp}.png`, { type: 'image/png' })
}

/**
 * 立即停止流上所有 track，释放摄像头 / 屏幕采集权限。
 */
function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach((t) => {
    try {
      t.stop()
    } catch {
      /* ignore */
    }
  })
}

/**
 * 触发浏览器的「选择要共享的窗口 / 屏幕」提示，
 * 用户选定后立刻截取一帧、关闭流并返回 PNG File。
 *
 * @returns 用户取消对话框时返回 `null`；成功时返回 PNG File
 * @throws 当浏览器不支持或采集失败时抛出可读错误
 */
export async function captureScreenshot(): Promise<File | null> {
  if (!isScreenCaptureSupported()) {
    throw new Error('当前浏览器不支持屏幕截取（需 HTTPS 或 localhost）')
  }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
  } catch (err) {
    // 用户按了取消 → DOMException NotAllowedError；把它当成正常路径返回 null
    if (err instanceof DOMException && err.name === 'NotAllowedError') return null
    throw new Error('无法获取屏幕画面：' + (err instanceof Error ? err.message : String(err)))
  }

  try {
    const video = document.createElement('video')
    video.muted = true
    video.autoplay = true
    video.playsInline = true
    video.srcObject = stream
    await video.play()
    // 等待一帧，避免首帧黑屏
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    return await videoFrameToFile(video, 'screenshot')
  } finally {
    stopStream(stream)
  }
}

/**
 * 打开摄像头并返回 `MediaStream`，
 * 由调用方在 `<video>` 上预览、按需触发 `capturePhotoFromStream`。
 * 用完必须调用 `stopStream(stream)`（导出为公共 API 便于组件复用）。
 */
export async function openCameraStream(): Promise<MediaStream> {
  if (!isCameraSupported()) {
    throw new Error('当前浏览器不支持摄像头访问（需 HTTPS 或 localhost）')
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: false,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      throw new Error('未授权访问摄像头，请在浏览器地址栏检查权限')
    }
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      throw new Error('未找到可用的摄像头设备')
    }
    throw new Error('无法打开摄像头：' + (err instanceof Error ? err.message : String(err)))
  }
}

/**
 * 从 `<video>` 元素捕获一帧、导出为 PNG File；调用方负责关闭流。
 */
export async function capturePhoto(video: HTMLVideoElement): Promise<File> {
  return videoFrameToFile(video, 'camera')
}

/**
 * 停止 stream（对外暴露给 `CameraModal` 使用）。
 */
export function releaseStream(stream: MediaStream | null): void {
  if (stream) stopStream(stream)
}
