'use client'

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
  type WheelEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  X,
  Play,
  Eye,
  Maximize2,
  Minimize2,
  RotateCcw,
  Terminal,
  Pencil,
  Table2,
  FileText,
  Image as ImageIcon,
  Download,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import CodeMirror, { type Extension } from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { html as cmHtml } from '@codemirror/lang-html'
import { css as cmCss } from '@codemirror/lang-css'
import { json as cmJson } from '@codemirror/lang-json'
import { markdown as cmMarkdown } from '@codemirror/lang-markdown'
import { useFilePreview } from '@yuanai/core/hooks'
import {
  useArtifactStore,
  type ArtifactPayload,
  type CodeArtifactPayload,
  type FileArtifactPayload,
  type MediaArtifactPayload,
} from '@yuanai/core/stores'
import type { MessageFile } from '@yuanai/types'
import { downloadSourceFile } from '@/lib/fileDownload'
import { buildRunSrcDoc, isRunnableLang, isDataPreviewLang, isDark } from './utils'
import { CodeHighlight } from './CodeHighlight'
import { ARTIFACT_MSG_SOURCE } from '@yuanai/core'

const EMPTY_PAYLOAD: CodeArtifactPayload = {
  kind: 'code',
  title: '',
  lang: '',
  code: '',
  mode: 'view',
}

/** 控制台面板最多保留的消息条数，超出则丢弃最旧的 */
const CONSOLE_MAX = 200

/** 控制台单条消息级别 */
type ConsoleLevel = 'log' | 'info' | 'warn' | 'error'

/** 控制台单条消息 */
interface ConsoleEntry {
  level: ConsoleLevel
  text: string
}

interface LightboxImageSize {
  width: number
  height: number
}

interface LightboxPanState {
  pointerId: number
  startX: number
  startY: number
  scrollLeft: number
  scrollTop: number
}

const LIGHTBOX_MIN_ZOOM = 0.25
const LIGHTBOX_MAX_ZOOM = 16

/** 管理放大图片的真实尺寸和指针平移，避免仅缩放视觉层而无法滚动查看细节。 */
function useLightboxImageCanvas(sourceUrl: string | undefined, zoomed: boolean, zoomScale: number) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const panRef = useRef<LightboxPanState | null>(null)
  const [baseSize, setBaseSize] = useState<LightboxImageSize | null>(null)
  const [isPanning, setIsPanning] = useState(false)

  useEffect(() => {
    panRef.current = null
    setBaseSize(null)
    setIsPanning(false)
    if (viewportRef.current) {
      viewportRef.current.scrollLeft = 0
      viewportRef.current.scrollTop = 0
    }
  }, [sourceUrl, zoomed])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !baseSize) return
    const frame = window.requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2)
      viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [baseSize, zoomScale])

  const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>): void => {
    const image = event.currentTarget
    const { naturalHeight, naturalWidth } = image
    if (naturalWidth <= 0 || naturalHeight <= 0) return
    const viewport = viewportRef.current
    const availableWidth = viewport?.clientWidth || naturalWidth
    const availableHeight = viewport?.clientHeight || naturalHeight
    const fitScale = Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight)
    setBaseSize({ width: naturalWidth * fitScale, height: naturalHeight * fitScale })
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const viewport = event.currentTarget
    const canPan =
      zoomScale > 1 &&
      (viewport.scrollWidth > viewport.clientWidth || viewport.scrollHeight > viewport.clientHeight)
    if (!canPan) return
    event.preventDefault()
    const startX = Number.isFinite(event.clientX) ? event.clientX : 0
    const startY = Number.isFinite(event.clientY) ? event.clientY : 0
    panRef.current = {
      pointerId: event.pointerId,
      startX,
      startY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    }
    viewport.setPointerCapture?.(event.pointerId)
    setIsPanning(true)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const pan = panRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    event.preventDefault()
    const currentX = Number.isFinite(event.clientX) ? event.clientX : 0
    const currentY = Number.isFinite(event.clientY) ? event.clientY : 0
    event.currentTarget.scrollLeft = pan.scrollLeft - (currentX - pan.startX)
    event.currentTarget.scrollTop = pan.scrollTop - (currentY - pan.startY)
  }

  const finishPan = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const pan = panRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    panRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setIsPanning(false)
  }

  const imageStyle = baseSize ? { width: `${Math.round(baseSize.width * zoomScale)}px` } : undefined
  const canvasStyle = baseSize
    ? {
        width: `max(100%, ${Math.round(baseSize.width * zoomScale)}px)`,
        height: `max(100%, ${Math.round(baseSize.height * zoomScale)}px)`,
      }
    : undefined

  return {
    viewportRef,
    handleImageLoad,
    handlePointerDown,
    handlePointerMove,
    finishPan,
    imageStyle,
    canvasStyle,
    isPannable: zoomScale > 1 && baseSize !== null,
    isPanning,
  }
}

/** 在现有 Artifact 工作区中展示一个已上传文件的后端受限预览。 */
function FileArtifactPreview({ payload }: { payload: FileArtifactPayload }): JSX.Element {
  const { data, isError, isLoading } = useFilePreview(payload.fileId)
  const close = useArtifactStore((state) => state.close)
  const openFilePreview = useArtifactStore((state) => state.openFilePreview)
  const [zoomed, setZoomed] = useState(false)
  const [zoomScale, setZoomScale] = useState(1)
  const fallbackFile = useMemo<MessageFile>(
    () => ({
      id: payload.fileId,
      filename: payload.title,
      mimeType: payload.mimeType,
      sizeBytes: 0,
      url: payload.url,
    }),
    [payload.fileId, payload.mimeType, payload.title, payload.url]
  )
  const previewFiles = useMemo<readonly MessageFile[]>(
    () => (payload.files && payload.files.length > 0 ? payload.files : [fallbackFile]),
    [fallbackFile, payload.files]
  )
  const currentIndex = Math.min(
    Math.max(payload.index ?? previewFiles.findIndex((file) => file.id === payload.fileId), 0),
    previewFiles.length - 1
  )
  const currentFile = previewFiles[currentIndex] ?? fallbackFile
  const kind = data?.kind ?? 'unsupported'
  const icon = kind === 'image' ? <ImageIcon size={15} /> : <FileText size={15} />
  const imageIndexes = useMemo(
    () =>
      previewFiles.reduce<number[]>((indexes, file, index) => {
        if (file.mimeType.startsWith('image/')) indexes.push(index)
        return indexes
      }, []),
    [previewFiles]
  )
  const currentImagePosition = imageIndexes.indexOf(currentIndex)
  const imageCanvas = useLightboxImageCanvas(
    data?.kind === 'image' ? data.url : undefined,
    zoomed,
    zoomScale
  )

  const selectFile = (index: number): void => {
    const next = previewFiles[index]
    if (!next) return
    if (imageCanvas.viewportRef.current) {
      imageCanvas.viewportRef.current.scrollLeft = 0
      imageCanvas.viewportRef.current.scrollTop = 0
    }
    setZoomed(false)
    setZoomScale(1)
    openFilePreview({
      fileId: next.id,
      title: next.filename,
      mimeType: next.mimeType,
      url: next.url,
      files: previewFiles,
      index,
    })
  }

  const moveFile = (delta: number): void => {
    const nextIndex = currentIndex + delta
    if (nextIndex < 0 || nextIndex >= previewFiles.length) return
    selectFile(nextIndex)
  }

  const moveImage = (delta: number): void => {
    const nextPosition = currentImagePosition + delta
    const nextIndex = imageIndexes[nextPosition]
    if (nextIndex === undefined) return
    selectFile(nextIndex)
    setZoomed(true)
  }

  const changeZoom = (delta: number): void => {
    setZoomScale((current) =>
      Math.min(
        LIGHTBOX_MAX_ZOOM,
        Math.max(LIGHTBOX_MIN_ZOOM, Math.round((current + delta) * 100) / 100)
      )
    )
  }

  const handleLightboxWheel = (event: WheelEvent<HTMLDivElement>): void => {
    event.preventDefault()
    changeZoom(event.deltaY < 0 ? 0.25 : -0.25)
  }

  const closeLightbox = (): void => {
    setZoomed(false)
    setZoomScale(1)
  }

  const lightbox =
    zoomed && data?.kind === 'image'
      ? createPortal(
          <div
            className="ch-ap-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={`放大预览 ${currentFile.filename}`}
            onClick={(event) => {
              if (event.target === event.currentTarget) closeLightbox()
            }}
          >
            <button
              type="button"
              className="ch-ap-lightbox-close"
              onClick={closeLightbox}
              aria-label="关闭放大预览"
              title="关闭放大预览"
            >
              <X size={20} aria-hidden="true" />
            </button>
            <div className="ch-ap-lightbox-tools" aria-label="图片缩放">
              <button
                type="button"
                className="ch-ap-lightbox-tool"
                onClick={() => changeZoom(-0.25)}
                disabled={zoomScale <= LIGHTBOX_MIN_ZOOM}
                aria-label="缩小图片"
                title="缩小图片"
              >
                <ZoomOut size={17} aria-hidden="true" />
              </button>
              <span aria-live="polite">{Math.round(zoomScale * 100)}%</span>
              <button
                type="button"
                className="ch-ap-lightbox-tool"
                onClick={() => changeZoom(0.25)}
                disabled={zoomScale >= LIGHTBOX_MAX_ZOOM}
                aria-label="放大图片"
                title="放大图片"
              >
                <ZoomIn size={17} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ch-ap-lightbox-tool"
                onClick={() => setZoomScale(1)}
                disabled={zoomScale === 1}
                aria-label="重置图片缩放"
                title="重置图片缩放"
              >
                <RotateCcw size={16} aria-hidden="true" />
              </button>
            </div>
            {imageIndexes.length > 1 && currentImagePosition > 0 ? (
              <button
                type="button"
                className="ch-ap-lightbox-nav ch-ap-lightbox-nav--prev"
                onClick={() => moveImage(-1)}
                aria-label="上一个图片"
                title="上一个图片"
              >
                <ChevronLeft size={26} aria-hidden="true" />
              </button>
            ) : null}
            <div
              ref={imageCanvas.viewportRef}
              className={`ch-ap-lightbox-viewport${
                imageCanvas.isPannable ? 'is-pannable' : ''
              }${imageCanvas.isPanning ? 'is-panning' : ''}`}
              onWheel={handleLightboxWheel}
              onPointerCancel={imageCanvas.finishPan}
              onPointerDown={imageCanvas.handlePointerDown}
              onPointerMove={imageCanvas.handlePointerMove}
              onPointerUp={imageCanvas.finishPan}
            >
              <div className="ch-ap-lightbox-canvas" style={imageCanvas.canvasStyle}>
                <img
                  className={`ch-ap-lightbox-image${zoomScale > 1 ? 'is-zoomed' : ''}`}
                  src={data.url}
                  alt={currentFile.filename}
                  draggable={false}
                  style={imageCanvas.imageStyle}
                  onDragStart={(event) => event.preventDefault()}
                  onLoad={imageCanvas.handleImageLoad}
                />
              </div>
            </div>
            {imageIndexes.length > 1 && currentImagePosition < imageIndexes.length - 1 ? (
              <button
                type="button"
                className="ch-ap-lightbox-nav ch-ap-lightbox-nav--next"
                onClick={() => moveImage(1)}
                aria-label="下一个图片"
                title="下一个图片"
              >
                <ChevronRight size={26} aria-hidden="true" />
              </button>
            ) : null}
          </div>,
          document.body
        )
      : null

  return (
    <>
      <div className="ch-ap-head">
        <span className="ch-ap-lang">文件</span>
        <span className="ch-ap-title" title={currentFile.filename}>
          {currentFile.filename}
        </span>
        {previewFiles.length > 1 ? (
          <div className="ch-ap-file-nav" aria-label="附件切换">
            <button
              className="ch-ib"
              type="button"
              onClick={() => moveFile(-1)}
              disabled={currentIndex === 0}
              title="上一个附件"
              aria-label="上一个附件"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span className="ch-ap-file-count" aria-live="polite">
              {currentIndex + 1} / {previewFiles.length}
            </span>
            <button
              className="ch-ib"
              type="button"
              onClick={() => moveFile(1)}
              disabled={currentIndex === previewFiles.length - 1}
              title="下一个附件"
              aria-label="下一个附件"
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        <button
          className="ch-ib"
          type="button"
          onClick={close}
          title="关闭面板"
          aria-label="关闭面板"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <section className="ch-ap-body ch-ap-file" aria-live="polite">
        {isLoading ? <div className="ch-ap-file-state">正在加载预览...</div> : null}
        {isError ? <div className="ch-ap-file-state">预览加载失败，可下载原文件查看。</div> : null}
        {!isLoading && !isError && data?.kind === 'image' ? (
          <button
            className="ch-ap-file-image-trigger"
            type="button"
            onClick={() => {
              setZoomScale(1)
              setZoomed(true)
            }}
            aria-label={`放大 ${currentFile.filename}`}
            title="放大图片"
          >
            <img className="ch-ap-file-image" src={data.url} alt={currentFile.filename} />
            <span className="ch-ap-file-image-hint" aria-hidden="true">
              <Maximize2 size={18} />
              放大
            </span>
          </button>
        ) : null}
        {!isLoading && !isError && data?.kind === 'pdf' ? (
          <iframe
            className="ch-ap-file-pdf"
            src={data.url}
            title={`预览 ${currentFile.filename}`}
            sandbox="allow-downloads"
          />
        ) : null}
        {!isLoading && !isError && data?.kind === 'text' ? (
          <pre className="ch-ap-file-text">{data.text ?? ''}</pre>
        ) : null}
        {!isLoading && !isError && data?.kind === 'table' ? (
          <div className="ch-ap-file-table-wrap">
            <div className="ch-ap-file-table-label">
              {icon}
              <span>{currentFile.filename}</span>
            </div>
            <table className="ch-ap-file-table">
              <tbody>
                {data.rows?.slice(0, 100).map((row, rowIndex) => (
                  <tr key={`${payload.fileId}-${rowIndex}`}>
                    {row.map((cell, columnIndex) =>
                      rowIndex === 0 ? (
                        <th key={`${payload.fileId}-${rowIndex}-${columnIndex}`}>{cell}</th>
                      ) : (
                        <td key={`${payload.fileId}-${rowIndex}-${columnIndex}`}>{cell}</td>
                      )
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {!isLoading && !isError && kind === 'unsupported' ? (
          <div className="ch-ap-file-state">此文件类型不支持内置预览，可下载原文件查看。</div>
        ) : null}
      </section>
      <footer className="ch-ap-footer">
        <span className="ch-ap-finfo">{data?.mimeType ?? currentFile.mimeType}</span>
        <button
          type="button"
          className="ch-ap-copy-btn"
          onClick={() => {
            void downloadSourceFile(currentFile.id, currentFile.filename)
          }}
        >
          <Download size={13} aria-hidden="true" /> 下载原文件
        </button>
      </footer>
      {lightbox}
    </>
  )
}

/** 直接展示生成任务的结果，避免将媒体任务误当作已上传文件请求预览接口。 */
function MediaArtifactPreview({
  payload,
  active,
}: {
  payload: MediaArtifactPayload
  active: boolean
}): JSX.Element {
  const close = useArtifactStore((state) => state.close)
  const [zoomed, setZoomed] = useState(false)
  const [zoomScale, setZoomScale] = useState(1)
  const isImage = payload.mimeType.startsWith('image/')
  const videoRef = useRef<HTMLVideoElement>(null)
  const imageCanvas = useLightboxImageCanvas(isImage ? payload.url : undefined, zoomed, zoomScale)

  useEffect(() => {
    if (active) return
    const video = videoRef.current
    if (!video) return
    video.pause()
    video.currentTime = 0
  }, [active])

  const changeZoom = (delta: number): void => {
    setZoomScale((current) =>
      Math.min(
        LIGHTBOX_MAX_ZOOM,
        Math.max(LIGHTBOX_MIN_ZOOM, Math.round((current + delta) * 100) / 100)
      )
    )
  }

  const closeLightbox = (): void => {
    setZoomed(false)
    setZoomScale(1)
  }

  const closePreview = (): void => {
    const video = videoRef.current
    if (video) {
      video.pause()
      video.currentTime = 0
    }
    close()
  }

  const lightbox =
    zoomed && isImage
      ? createPortal(
          <div
            className="ch-ap-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={`放大预览 ${payload.title}`}
            onClick={(event) => {
              if (event.target === event.currentTarget) closeLightbox()
            }}
          >
            <button
              type="button"
              className="ch-ap-lightbox-close"
              onClick={closeLightbox}
              aria-label="关闭放大预览"
              title="关闭放大预览"
            >
              <X size={20} aria-hidden="true" />
            </button>
            <div className="ch-ap-lightbox-tools" aria-label="图片缩放">
              <button
                type="button"
                className="ch-ap-lightbox-tool"
                onClick={() => changeZoom(-0.25)}
                disabled={zoomScale <= LIGHTBOX_MIN_ZOOM}
                aria-label="缩小图片"
                title="缩小图片"
              >
                <ZoomOut size={17} aria-hidden="true" />
              </button>
              <span aria-live="polite">{Math.round(zoomScale * 100)}%</span>
              <button
                type="button"
                className="ch-ap-lightbox-tool"
                onClick={() => changeZoom(0.25)}
                disabled={zoomScale >= LIGHTBOX_MAX_ZOOM}
                aria-label="放大图片"
                title="放大图片"
              >
                <ZoomIn size={17} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ch-ap-lightbox-tool"
                onClick={() => setZoomScale(1)}
                disabled={zoomScale === 1}
                aria-label="重置图片缩放"
                title="重置图片缩放"
              >
                <RotateCcw size={16} aria-hidden="true" />
              </button>
            </div>
            <div
              ref={imageCanvas.viewportRef}
              className={`ch-ap-lightbox-viewport${
                imageCanvas.isPannable ? 'is-pannable' : ''
              }${imageCanvas.isPanning ? 'is-panning' : ''}`}
              onWheel={(event) => {
                event.preventDefault()
                changeZoom(event.deltaY < 0 ? 0.25 : -0.25)
              }}
              onPointerCancel={imageCanvas.finishPan}
              onPointerDown={imageCanvas.handlePointerDown}
              onPointerMove={imageCanvas.handlePointerMove}
              onPointerUp={imageCanvas.finishPan}
            >
              <div className="ch-ap-lightbox-canvas" style={imageCanvas.canvasStyle}>
                <img
                  className={`ch-ap-lightbox-image${zoomScale > 1 ? 'is-zoomed' : ''}`}
                  src={payload.url}
                  alt={payload.title}
                  draggable={false}
                  style={imageCanvas.imageStyle}
                  onDragStart={(event) => event.preventDefault()}
                  onLoad={imageCanvas.handleImageLoad}
                />
              </div>
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <>
      <div className="ch-ap-head">
        <span className="ch-ap-lang">{isImage ? '图片' : '视频'}</span>
        <span className="ch-ap-title" title={payload.title}>
          {payload.title}
        </span>
        <button
          className="ch-ib"
          type="button"
          onClick={closePreview}
          title="关闭面板"
          aria-label="关闭面板"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <section className="ch-ap-body ch-ap-file ch-ap-media" aria-live="polite">
        {isImage ? (
          <button
            className="ch-ap-file-image-trigger"
            type="button"
            onClick={() => {
              setZoomScale(1)
              setZoomed(true)
            }}
            aria-label={`放大 ${payload.title}`}
            title="放大图片"
          >
            <img className="ch-ap-file-image" src={payload.url} alt={payload.title} />
            <span className="ch-ap-file-image-hint" aria-hidden="true">
              <Maximize2 size={18} />
              放大
            </span>
          </button>
        ) : active ? (
          <video
            ref={videoRef}
            className="ch-ap-media-video"
            src={payload.url}
            controls
            playsInline
            preload="metadata"
            aria-label={`播放 ${payload.title}`}
          />
        ) : null}
      </section>
      <footer className="ch-ap-footer">
        <span className="ch-ap-finfo">{payload.mimeType}</span>
        <a className="ch-ap-copy-btn" href={payload.url} download={payload.title}>
          <Download size={13} aria-hidden="true" /> 下载
        </a>
      </footer>
      {lightbox}
    </>
  )
}

/**
 * 校验来自 iframe 的 postMessage 是否为可信的控制台桥消息。
 *
 * 入站消息一律视为不可信，需逐字段校验 source/level/text 的形状。
 */
function parseConsoleMessage(data: unknown): ConsoleEntry | null {
  if (typeof data !== 'object' || data === null) return null
  const obj = data as Record<string, unknown>
  if (obj.source !== ARTIFACT_MSG_SOURCE) return null
  const level = obj.level
  if (level !== 'log' && level !== 'info' && level !== 'warn' && level !== 'error') return null
  const text = typeof obj.text === 'string' ? obj.text : ''
  return { level, text }
}

/** 依据代码语言返回 CodeMirror 语言扩展，未识别则不加语言扩展 */
function langExtensions(lang: string): Extension[] {
  const l = lang.trim().toLowerCase()
  if (l === 'js' || l === 'javascript' || l === 'mjs' || l === 'cjs') return [javascript()]
  if (l === 'jsx') return [javascript({ jsx: true })]
  if (l === 'ts' || l === 'typescript') return [javascript({ typescript: true })]
  if (l === 'tsx') return [javascript({ jsx: true, typescript: true })]
  if (l === 'html' || l === 'htm' || l === 'vue' || l === 'svelte') return [cmHtml()]
  if (l === 'css' || l === 'scss' || l === 'less') return [cmCss()]
  if (l === 'json') return [cmJson()]
  if (l === 'markdown' || l === 'md') return [cmMarkdown()]
  return []
}

/** 极简 CSV 解析：按行拆分，字段以逗号分隔，支持基础的双引号包裹与 `""` 转义 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.length > 1 || (r[0] ?? '') !== '')
}

/**
 * JSON 树节点（递归渲染）。
 *
 * 对象/数组默认展开，可点击折叠；标量按类型着色。纯自实现，无外部依赖，SSR 安全。
 */
function JsonNode({ name, value }: { name?: string; value: unknown }): JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const isObject = typeof value === 'object' && value !== null
  const keyLabel = name === undefined ? null : <span className="ch-ap-data-key">{name}: </span>

  if (!isObject) {
    let cls = 'ch-ap-data-val'
    if (typeof value === 'string') cls += ' ch-ap-data-str'
    else if (typeof value === 'number') cls += ' ch-ap-data-num'
    else if (typeof value === 'boolean') cls += ' ch-ap-data-bool'
    else if (value === null) cls += ' ch-ap-data-null'
    const text = typeof value === 'string' ? `"${value}"` : String(value)
    return (
      <div className="ch-ap-data-row">
        {keyLabel}
        <span className={cls}>{text}</span>
      </div>
    )
  }

  const isArray = Array.isArray(value)
  const entries: [string, unknown][] = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>)
  const open = isArray ? '[' : '{'
  const close = isArray ? ']' : '}'

  return (
    <div className="ch-ap-data-node">
      <div
        className="ch-ap-data-row ch-ap-data-branch"
        onClick={() => setCollapsed((c) => !c)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setCollapsed((c) => !c)
        }}
      >
        <span className="ch-ap-data-caret">{collapsed ? '▸' : '▾'}</span>
        {keyLabel}
        <span className="ch-ap-data-brace">
          {open}
          {collapsed ? `…${close} (${entries.length})` : ''}
        </span>
      </div>
      {!collapsed && (
        <div className="ch-ap-data-children">
          {entries.map(([k, v]) => (
            <JsonNode key={k} name={k} value={v} />
          ))}
          <div className="ch-ap-data-row ch-ap-data-brace">{close}</div>
        </div>
      )}
    </div>
  )
}

/**
 * 数据预览：JSON → 可折叠树，CSV → 表格；解析失败时展示错误文本。
 */
function DataPreview({ lang, code }: { lang: string; code: string }): JSX.Element {
  const l = lang.toLowerCase()
  if (l === 'csv') {
    const rows = parseCsv(code)
    if (rows.length === 0) return <div className="ch-ap-data-empty">（空 CSV）</div>
    const [head, ...body] = rows
    return (
      <div className="ch-ap-data-wrap">
        <table className="ch-ap-data-table">
          <thead>
            <tr>
              {(head ?? []).map((cell, i) => (
                <th key={i}>{cell}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri}>
                {r.map((cell, ci) => (
                  <td key={ci}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  try {
    const parsed: unknown = JSON.parse(code)
    return (
      <div className="ch-ap-data-wrap ch-ap-data-json">
        <JsonNode value={parsed} />
      </div>
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return <div className="ch-ap-data-error">JSON 解析失败：{msg}</div>
  }
}

/**
 * 监听 `data-theme` 变化，驱动 CodeMirror 明暗主题切换。
 */
function useIsDarkTheme(): boolean {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    setDark(isDark())
    const observer = new MutationObserver(() => setDark(isDark()))
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

/**
 * Artifact 面板（右侧滑出）。
 *
 * 面板容器始终挂载（哪怕从未打开过），只有内容随 store 的 payload 变化而更新。
 * 若改成"仅 open 时才挂载"，首次打开会因为 DOM 节点创建与祖先 `.ap-open` 类的应用
 * 发生在同一次 React commit 里，浏览器没有"关闭态"的前一帧可供过渡，滑入动画会直接跳变；
 * 关闭时同理会立刻卸载导致滑出动画被打断。保持常驻挂载 + 记住最后一次 payload，
 * 才能让每次打开/关闭都成为已存在节点上的一次真实样式变化，交给 CSS transition 处理。
 *
 * 全部新增状态（控制台消息、全屏、编辑中的代码）均为组件本地 state，绝不写回 store。
 * 订阅 `useArtifactStore`：
 * - `mode === 'view'`：只读代码展示，可切换 CodeMirror 编辑
 * - `mode === 'run'`：数据语言走面板内数据预览，其余走 iframe `srcdoc` 沙箱
 */
export function ArtifactPanel(): JSX.Element {
  const open = useArtifactStore((s) => s.open)
  const payload = useArtifactStore((s) => s.payload)
  const openView = useArtifactStore((s) => s.openView)
  const openRun = useArtifactStore((s) => s.openRun)
  const close = useArtifactStore((s) => s.close)
  const [copied, setCopied] = useState(false)
  const [shown, setShown] = useState<ArtifactPayload>(EMPTY_PAYLOAD)
  const [fullscreen, setFullscreen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editedCode, setEditedCode] = useState('')
  const [consoleMsgs, setConsoleMsgs] = useState<ConsoleEntry[]>([])
  const [consoleOpen, setConsoleOpen] = useState(false)
  const dark = useIsDarkTheme()

  // payload 变化：同步展示内容，并重置编辑态（新内容不应残留上一次的编辑草稿）
  useEffect(() => {
    if (payload) {
      setShown(payload)
      setEditedCode(payload.kind === 'code' ? payload.code : '')
      setEditing(false)
    }
  }, [payload])

  const codeShown = shown.kind === 'code' ? shown : EMPTY_PAYLOAD
  const isData = isDataPreviewLang(codeShown.lang)
  const runnable = isRunnableLang(codeShown.lang)

  const srcdoc = useMemo(() => {
    if (codeShown.mode !== 'run' || isData) return ''
    return buildRunSrcDoc(codeShown.lang, codeShown.code)
  }, [codeShown, isData])

  // 每次运行（srcdoc 变化）都清空控制台，避免上一次运行的日志串档
  useEffect(() => {
    setConsoleMsgs([])
  }, [srcdoc])

  // 监听 iframe 控制台桥消息；入站数据一律不可信，校验后入列并限长
  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      const entry = parseConsoleMessage(e.data)
      if (!entry) return
      setConsoleMsgs((prev) => {
        const next = [...prev, entry]
        return next.length > CONSOLE_MAX ? next.slice(next.length - CONSOLE_MAX) : next
      })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const currentCode = editing ? editedCode : codeShown.code
  const lineCount = currentCode.split('\n').length

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(currentCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* 忽略权限失败 */
    }
  }

  const errorCount = consoleMsgs.filter((m) => m.level === 'error').length

  if (shown.kind === 'file' || shown.kind === 'media') {
    return (
      <div
        className="ch-artifact-panel"
        role="complementary"
        aria-label={shown.kind === 'file' ? '文件预览面板' : '媒体预览面板'}
        aria-hidden={!open}
      >
        {shown.kind === 'file' ? (
          <FileArtifactPreview payload={shown} />
        ) : (
          <MediaArtifactPreview payload={shown} active={open} />
        )}
      </div>
    )
  }

  return (
    <div
      className={`ch-artifact-panel${fullscreen ? 'ch-ap-fullscreen' : ''}`}
      role="complementary"
      aria-label="代码面板"
      aria-hidden={!open}
    >
      <div className="ch-ap-head">
        <span className="ch-ap-lang">{codeShown.lang}</span>
        <span className="ch-ap-title" title={codeShown.title}>
          {codeShown.title}
        </span>
        <div className="ch-ap-head-acts">
          {runnable && codeShown.mode === 'view' && (
            <button
              className="ch-ib"
              onClick={() =>
                openRun({ title: codeShown.title, lang: codeShown.lang, code: currentCode })
              }
              title="运行代码"
              aria-label="运行代码"
            >
              <Play size={16} />
            </button>
          )}
          {isData && codeShown.mode === 'view' && (
            <button
              className="ch-ib"
              onClick={() =>
                openRun({ title: codeShown.title, lang: codeShown.lang, code: currentCode })
              }
              title="数据预览"
              aria-label="数据预览"
            >
              <Table2 size={16} />
            </button>
          )}
          {codeShown.mode === 'run' && (
            <button
              className="ch-ib"
              onClick={() =>
                openView({ title: codeShown.title, lang: codeShown.lang, code: codeShown.code })
              }
              title="查看源码"
              aria-label="查看源码"
            >
              <Eye size={16} />
            </button>
          )}
          {codeShown.mode === 'view' && (
            <button
              className={`ch-ib${editing ? 'active' : ''}`}
              onClick={() => setEditing((v) => !v)}
              title={editing ? '结束编辑' : '编辑代码'}
              aria-label={editing ? '结束编辑' : '编辑代码'}
            >
              <Pencil size={16} />
            </button>
          )}
          {editing && runnable && (
            <button
              className="ch-ib"
              onClick={() =>
                openRun({ title: codeShown.title, lang: codeShown.lang, code: editedCode })
              }
              title="重新运行"
              aria-label="重新运行"
            >
              <Play size={16} />
            </button>
          )}
          <button
            className={`ch-ib${consoleOpen ? 'active' : ''}`}
            onClick={() => setConsoleOpen((v) => !v)}
            title="控制台"
            aria-label="控制台"
          >
            <Terminal size={16} />
          </button>
          <button
            className="ch-ib"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? '退出全屏' : '全屏'}
            aria-label={fullscreen ? '退出全屏' : '全屏'}
          >
            {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button className="ch-ib" onClick={close} title="关闭面板" aria-label="关闭面板">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="ch-ap-body">
        {codeShown.mode === 'view' ? (
          editing ? (
            <CodeMirror
              className="ch-ap-cm"
              value={editedCode}
              extensions={langExtensions(codeShown.lang)}
              theme={dark ? 'dark' : 'light'}
              onChange={(v: string) => setEditedCode(v)}
              height="100%"
            />
          ) : (
            <CodeHighlight
              lang={codeShown.lang}
              code={codeShown.code}
              fontSize="12px"
              lineHeight={1.6}
            />
          )
        ) : isData ? (
          <DataPreview lang={codeShown.lang} code={codeShown.code} />
        ) : (
          <iframe
            key={srcdoc}
            className="ch-ap-iframe"
            title="沙箱预览"
            sandbox="allow-scripts allow-forms"
            srcDoc={srcdoc}
          />
        )}
      </div>
      {consoleOpen && (
        <div className="ch-ap-console">
          <div className="ch-ap-console-head">
            <span className="ch-ap-console-title">
              控制台{errorCount > 0 ? ` · ${errorCount} 错误` : ''}
            </span>
            <button
              className="ch-ap-console-clear"
              onClick={() => setConsoleMsgs([])}
              aria-label="清空控制台"
            >
              清空
            </button>
          </div>
          <div className="ch-ap-console-body">
            {consoleMsgs.length === 0 ? (
              <div className="ch-ap-console-empty">暂无输出</div>
            ) : (
              consoleMsgs.map((m, i) => (
                <div key={i} className={`ch-ap-console-row ch-ap-console-${m.level}`}>
                  {m.text}
                </div>
              ))
            )}
          </div>
        </div>
      )}
      <div className="ch-ap-footer">
        <button
          className="ch-ap-copy-btn"
          onClick={() => {
            void copy()
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? '已复制' : '复制代码'}
        </button>
        <span className="ch-ap-finfo">
          {codeShown.lang} · {lineCount} 行
        </span>
      </div>
    </div>
  )
}
