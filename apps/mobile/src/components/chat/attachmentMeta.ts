/**
 * 附件展示共用元数据：mime → 图标字符 / 图片判定 / 字节数格式化。
 * AttachmentTray（输入区预览条）与 UserMessage（消息内附件）共用。
 */

/** 根据 mimeType 返回代表字符（文档图标占位） */
export function mimeIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼'
  if (mimeType.startsWith('video/')) return '🎬'
  if (mimeType.startsWith('audio/')) return '🎵'
  if (mimeType === 'application/pdf') return '📄'
  if (
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel') ||
    mimeType.endsWith('.xlsx') ||
    mimeType.endsWith('.xls')
  )
    return '📊'
  if (
    mimeType.includes('presentation') ||
    mimeType.includes('powerpoint') ||
    mimeType.endsWith('.pptx')
  )
    return '📋'
  if (mimeType.includes('word') || mimeType.endsWith('.docx') || mimeType.endsWith('.doc'))
    return '📝'
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive'))
    return '🗜'
  if (mimeType.includes('text/')) return '📃'
  return '📎'
}

export function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

/** 1234567 → "1.2 MB"；小于 1KB 显示字节数 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
