import { apiClient } from '@yuanai/core'

/**
 * 把内存中的 Blob 交给浏览器下载。
 *
 * 锚点必须真正挂到文档上再点击，Safari 对游离节点的点击不触发下载；Firefox 需要在
 * 下载任务进入浏览器队列后再释放 Blob URL，否则可能退化为预览页。
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.setAttribute('aria-hidden', 'true')
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

/**
 * 下载需要鉴权的原始附件。
 *
 * 直接给跨源 MinIO URL 加 `download` 在 Firefox 中可能退化为导航；通过后端
 * attachment 响应取回 Blob，再由浏览器创建本地下载链接，确保不会打开预览窗口。
 */
export async function downloadSourceFile(fileId: string, filename: string): Promise<void> {
  const response = await apiClient.get<Blob>(`/files/${encodeURIComponent(fileId)}/download`, {
    responseType: 'blob',
  })
  downloadBlob(response.data, filename)
}
