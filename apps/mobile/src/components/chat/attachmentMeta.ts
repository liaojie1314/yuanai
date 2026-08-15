/**
 * 附件展示共用元数据。
 *
 * 后端历史数据有时只有 `application/octet-stream`，不能只依赖 MIME；因此图片和
 * 文档类型还会结合文件扩展名判断。图标统一使用 Lucide，避免 Android/iOS 的 emoji
 * 字形不同而和 Web/Desktop 视觉脱节。
 */
import {
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  FileVideo,
} from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'

/** 附件卡片的视觉种类。 */
export type AttachmentKind =
  'image' | 'pdf' | 'sheet' | 'document' | 'text' | 'audio' | 'video' | 'archive' | 'file'

/** 附件卡片显示所需的统一图标与标签。 */
export interface AttachmentMeta {
  kind: AttachmentKind
  label: string
  Icon: LucideIcon
}

const IMAGE_EXTENSION = /\.(avif|gif|jpe?g|png|webp)$/i
const SPREADSHEET_EXTENSION = /\.(csv|ods|xls|xlsx)$/i
const DOCUMENT_EXTENSION = /\.(doc|docx|odt|rtf)$/i
const TEXT_EXTENSION = /\.(json|md|txt|xml|ya?ml)$/i

/**
 * 判断附件是否为可内嵌展示的图片。
 *
 * @param mimeType 上传或服务端保存的 MIME 类型
 * @param filename 原始文件名，用于兼容泛型 MIME 的历史附件
 */
export function isImageAttachment(mimeType: string, filename = ''): boolean {
  return mimeType.toLocaleLowerCase().startsWith('image/') || IMAGE_EXTENSION.test(filename)
}

/**
 * 根据 MIME 类型与文件名生成跨端一致的附件图标元数据。
 *
 * @param mimeType 上传或服务端保存的 MIME 类型
 * @param filename 原始文件名，用于泛型 MIME 的扩展名回退
 */
export function getAttachmentMeta(mimeType: string, filename = ''): AttachmentMeta {
  const normalizedMime = mimeType.toLocaleLowerCase()
  const normalizedFilename = filename.toLocaleLowerCase()

  if (isImageAttachment(normalizedMime, normalizedFilename)) {
    return { kind: 'image', label: '图片', Icon: FileImage }
  }
  if (normalizedMime === 'application/pdf' || normalizedFilename.endsWith('.pdf')) {
    return { kind: 'pdf', label: 'PDF', Icon: FileType2 }
  }
  if (
    normalizedMime.includes('spreadsheet') ||
    normalizedMime.includes('excel') ||
    normalizedMime === 'text/csv' ||
    SPREADSHEET_EXTENSION.test(normalizedFilename)
  ) {
    return { kind: 'sheet', label: '表格', Icon: FileSpreadsheet }
  }
  if (normalizedMime.includes('word') || DOCUMENT_EXTENSION.test(normalizedFilename)) {
    return { kind: 'document', label: '文档', Icon: FileText }
  }
  if (normalizedMime.startsWith('audio/')) return { kind: 'audio', label: '音频', Icon: FileAudio }
  if (normalizedMime.startsWith('video/')) return { kind: 'video', label: '视频', Icon: FileVideo }
  if (
    normalizedMime.includes('zip') ||
    normalizedMime.includes('compressed') ||
    normalizedMime.includes('archive')
  ) {
    return { kind: 'archive', label: '压缩包', Icon: FileArchive }
  }
  if (normalizedMime.startsWith('text/') || TEXT_EXTENSION.test(normalizedFilename)) {
    return { kind: 'text', label: '文本', Icon: FileText }
  }
  return { kind: 'file', label: '文件', Icon: FileText }
}

/** 1234567 → "1.2 MB"；小于 1KB 显示字节数 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
