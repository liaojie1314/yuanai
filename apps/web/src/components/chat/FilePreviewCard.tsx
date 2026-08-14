'use client'

import {
  Download,
  FileSpreadsheet,
  FileText,
  FileType2,
  Image as ImageIcon,
  Maximize2,
} from 'lucide-react'
import { type JSX } from 'react'
import { downloadSourceFile } from '@/lib/fileDownload'
import type { MessageFile } from '@yuanai/types'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type FileCardKind = 'image' | 'pdf' | 'sheet' | 'document' | 'text'

interface FileCardMeta {
  kind: FileCardKind
  label: string
  icon: JSX.Element
}

function getFileCardMeta(file: MessageFile): FileCardMeta {
  const filename = file.filename.toLowerCase()
  if (file.mimeType.startsWith('image/')) {
    return { kind: 'image', label: '图片', icon: <ImageIcon size={18} aria-hidden="true" /> }
  }
  if (file.mimeType === 'application/pdf' || filename.endsWith('.pdf')) {
    return { kind: 'pdf', label: 'PDF', icon: <FileType2 size={22} aria-hidden="true" /> }
  }
  if (
    file.mimeType.includes('spreadsheet') ||
    filename.endsWith('.csv') ||
    filename.endsWith('.xlsx')
  ) {
    return { kind: 'sheet', label: '表格', icon: <FileSpreadsheet size={22} aria-hidden="true" /> }
  }
  if (file.mimeType.includes('wordprocessingml') || filename.endsWith('.docx')) {
    return { kind: 'document', label: '文档', icon: <FileText size={22} aria-hidden="true" /> }
  }
  return { kind: 'text', label: '文件', icon: <FileText size={22} aria-hidden="true" /> }
}

/**
 * 历史消息附件卡。
 *
 * 图片在消息中提供可见缩略图；文档使用类型封面。点击卡片统一进入右侧 Artifact
 * 面板，保持聊天记录紧凑且避免在消息流中嵌入大型预览器。
 */
export function FilePreviewCard({
  file,
  files,
  onPreview,
}: {
  file: MessageFile
  files?: readonly MessageFile[] | undefined
  onPreview(file: MessageFile, files?: readonly MessageFile[]): void
}): JSX.Element {
  const meta = getFileCardMeta(file)
  const isImage = meta.kind === 'image'

  return (
    <article
      className={`ch-file-preview-card ch-file-preview-card--${meta.kind}`}
      aria-label={`附件 ${file.filename}`}
    >
      <button
        type="button"
        className="ch-file-preview-card__open"
        onClick={() => onPreview(file, files)}
        aria-label={`打开 ${file.filename} 的预览`}
        title={`预览 ${file.filename}`}
      >
        {isImage ? (
          <span className="ch-file-preview-card__image-wrap">
            <img src={file.url} alt={file.filename} className="ch-file-preview-card__image" />
            <span className="ch-file-preview-card__image-overlay" aria-hidden="true">
              <Maximize2 size={18} />
            </span>
          </span>
        ) : (
          <span className="ch-file-preview-card__document-cover" aria-hidden="true">
            {meta.icon}
            <span>{meta.label}</span>
          </span>
        )}
        <span className="ch-file-preview-card__details">
          <span className="ch-file-preview-card__name" title={file.filename}>
            {file.filename}
          </span>
          <span className="ch-file-preview-card__size">
            {meta.label} · {formatBytes(file.sizeBytes)}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="ch-file-preview-card__download"
        onClick={() => {
          void downloadSourceFile(file.id, file.filename)
        }}
        aria-label={`下载 ${file.filename}`}
        title="下载原文件"
      >
        <Download size={16} aria-hidden="true" />
      </button>
    </article>
  )
}
