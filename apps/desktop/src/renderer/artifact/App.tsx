import {
  Check,
  Copy,
  Eye,
  Pause,
  Play,
  RotateCcw,
  Terminal,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent,
  type WheelEvent,
} from 'react'
import { useTranslation } from 'react-i18next'

import {
  ARTIFACT_MSG_SOURCE,
  buildRunSrcDoc,
  isDataPreviewLang,
  isRunnableLang,
} from '@yuanai/core/utils'
import type { DesktopArtifactPayload, DesktopCodeArtifactPayload } from '../../shared/ipc-contract'
import { copyText } from '../shared/clipboard'
import { CodeHighlight } from '../shared/CodeHighlight'
import '../shared/i18n'

import { DataPreview } from './DataPreview'

import './artifact.css'

const CONSOLE_MAX_ENTRIES = 200
const IMAGE_ZOOM_MIN = 0.1
const IMAGE_ZOOM_MAX = 16
const IMAGE_ZOOM_STEP = 1.12
type ConsoleLevel = 'log' | 'info' | 'warn' | 'error'

interface ConsoleEntry {
  level: ConsoleLevel
  text: string
}

interface ImageDimensions {
  width: number
  height: number
}

interface ImagePanState {
  startX: number
  startY: number
  scrollLeft: number
  scrollTop: number
}

function clampImageZoom(value: number): number {
  return Math.min(IMAGE_ZOOM_MAX, Math.max(IMAGE_ZOOM_MIN, value))
}

function formatVideoTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const minutes = Math.floor(safeSeconds / 60)
  const remainder = String(safeSeconds % 60).padStart(2, '0')
  return `${minutes}:${remainder}`
}

function isJavascriptLang(lang: string): boolean {
  const normalized = lang.trim().toLowerCase()
  return (
    normalized === 'js' ||
    normalized === 'javascript' ||
    normalized === 'mjs' ||
    normalized === 'cjs'
  )
}

function parseConsoleEntry(value: unknown): ConsoleEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  if (candidate.source !== ARTIFACT_MSG_SOURCE) return null
  const level = candidate.level
  if (level !== 'log' && level !== 'info' && level !== 'warn' && level !== 'error') return null
  return { level, text: typeof candidate.text === 'string' ? candidate.text : '' }
}

function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', theme)
}

function isFilePreviewPayload(
  payload: DesktopArtifactPayload
): payload is Extract<DesktopArtifactPayload, { kind: 'file-preview' }> {
  return payload.kind === 'file-preview'
}

/** 独立 Artifact 窗口，在同一窗口内切换源码展示和隔离运行预览。 */
export function App(): ReactElement {
  const { t } = useTranslation()
  const [payload, setPayload] = useState<DesktopArtifactPayload | null>(null)
  const [copied, setCopied] = useState(false)
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([])
  const [isConsoleOpen, setIsConsoleOpen] = useState(false)
  const [isDarkTheme, setIsDarkTheme] = useState(false)
  const imageViewportRef = useRef<HTMLDivElement>(null)
  const imagePanRef = useRef<ImagePanState | null>(null)
  const [imageDimensions, setImageDimensions] = useState<ImageDimensions | null>(null)
  const [imageZoom, setImageZoom] = useState(1)
  const [isImagePanning, setIsImagePanning] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoDuration, setVideoDuration] = useState(0)
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [isVideoMuted, setIsVideoMuted] = useState(false)

  useEffect(
    () =>
      window.yuanai.events.onArtifactInit((nextPayload) => {
        setPayload(nextPayload)
        setCopied(false)
        setConsoleEntries([])
        setImageDimensions(null)
        setImageZoom(1)
        imagePanRef.current = null
        setIsImagePanning(false)
        if (imageViewportRef.current) {
          imageViewportRef.current.scrollLeft = 0
          imageViewportRef.current.scrollTop = 0
        }
        setVideoDuration(0)
        setVideoCurrentTime(0)
        setIsVideoPlaying(false)
        setIsVideoMuted(false)
        setIsConsoleOpen(
          !isFilePreviewPayload(nextPayload) &&
            nextPayload.mode === 'run' &&
            isJavascriptLang(nextPayload.lang)
        )
        const theme = nextPayload.theme ?? 'light'
        applyTheme(theme)
        setIsDarkTheme(theme === 'dark')
      }),
    []
  )

  useEffect(() => {
    const synchronizeTheme = (): void => {
      setIsDarkTheme(document.documentElement.dataset.theme === 'dark')
    }
    synchronizeTheme()
    const observer = new MutationObserver(synchronizeTheme)
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>): void => {
      const entry = parseConsoleEntry(event.data)
      if (!entry) return
      setConsoleEntries((entries) => {
        const next = [...entries, entry]
        return next.length > CONSOLE_MAX_ENTRIES ? next.slice(-CONSOLE_MAX_ENTRIES) : next
      })
      setIsConsoleOpen(true)
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const srcDoc = useMemo(() => {
    if (!payload || isFilePreviewPayload(payload)) return ''
    if (payload.mode !== 'run' || !isRunnableLang(payload.lang)) return ''
    return buildRunSrcDoc(payload.lang, payload.code, { dark: isDarkTheme })
  }, [isDarkTheme, payload])

  function fitImageToViewport(width: number, height: number): number {
    const viewport = imageViewportRef.current
    if (viewport === null) return 1
    const availableWidth = Math.max(1, viewport.clientWidth - 48)
    const availableHeight = Math.max(1, viewport.clientHeight - 48)
    return clampImageZoom(Math.min(1, availableWidth / width, availableHeight / height))
  }

  function handleFileImageLoad(event: SyntheticEvent<HTMLImageElement>): void {
    const { naturalHeight, naturalWidth } = event.currentTarget
    if (naturalWidth <= 0 || naturalHeight <= 0) return
    setImageDimensions({ width: naturalWidth, height: naturalHeight })
    setImageZoom(fitImageToViewport(naturalWidth, naturalHeight))
  }

  useEffect(() => {
    const viewport = imageViewportRef.current
    if (!viewport || !imageDimensions) return
    const frame = window.requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2)
      viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [imageDimensions, imageZoom])

  useEffect(() => {
    const handleWindowMouseMove = (event: MouseEvent): void => {
      const pan = imagePanRef.current
      const viewport = imageViewportRef.current
      if (!pan || !viewport) return
      event.preventDefault()
      viewport.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX)
      viewport.scrollTop = pan.scrollTop - (event.clientY - pan.startY)
    }
    const finishWindowPan = (): void => {
      if (!imagePanRef.current) return
      imagePanRef.current = null
      setIsImagePanning(false)
    }
    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', finishWindowPan)
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', finishWindowPan)
    }
  }, [])

  function handleImageWheel(event: WheelEvent<HTMLDivElement>): void {
    event.preventDefault()
    const factor = event.deltaY < 0 ? IMAGE_ZOOM_STEP : 1 / IMAGE_ZOOM_STEP
    setImageZoom((current) => clampImageZoom(current * factor))
  }

  function handleImageMouseDown(event: ReactMouseEvent<HTMLDivElement>): void {
    const viewport = event.currentTarget
    const canPan =
      imageDimensions !== null &&
      imageZoom > fitImageToViewport(imageDimensions.width, imageDimensions.height)
    if (!canPan) return
    event.preventDefault()
    const startX = Number.isFinite(event.clientX) ? event.clientX : 0
    const startY = Number.isFinite(event.clientY) ? event.clientY : 0
    imagePanRef.current = {
      startX,
      startY,
      scrollLeft: Number.isFinite(viewport.scrollLeft) ? viewport.scrollLeft : 0,
      scrollTop: Number.isFinite(viewport.scrollTop) ? viewport.scrollTop : 0,
    }
    setIsImagePanning(true)
  }

  function toggleVideoPlayback(): void {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      void video.play().catch(() => setIsVideoPlaying(false))
      return
    }
    video.pause()
  }

  function handleVideoKeyDown(event: ReactKeyboardEvent<HTMLVideoElement>): void {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    toggleVideoPlayback()
  }

  function updateVideoMetadata(event: SyntheticEvent<HTMLVideoElement>): void {
    const duration = event.currentTarget.duration
    setVideoDuration(Number.isFinite(duration) && duration > 0 ? duration : 0)
  }

  function updateVideoProgress(event: SyntheticEvent<HTMLVideoElement>): void {
    const currentTime = event.currentTarget.currentTime
    setVideoCurrentTime(Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0)
  }

  function seekVideo(event: ChangeEvent<HTMLInputElement>): void {
    const video = videoRef.current
    const nextTime = Number(event.target.value)
    if (!video || !Number.isFinite(nextTime)) return
    video.currentTime = nextTime
    setVideoCurrentTime(nextTime)
  }

  function toggleVideoMute(): void {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setIsVideoMuted(video.muted)
  }

  if (!payload) return <main className="artifact__empty">{t('desktop.artifact.preparing')}</main>

  const shown = payload
  if (isFilePreviewPayload(shown)) {
    const isPdf = shown.mimeType === 'application/pdf'
    const isVideo = shown.mimeType === 'video/mp4'
    const imageWidth = imageDimensions ? `${imageDimensions.width * imageZoom}px` : undefined
    const imagePannable =
      imageDimensions !== null &&
      imageZoom > fitImageToViewport(imageDimensions.width, imageDimensions.height)
    return (
      <main className="artifact" aria-label={`文件预览 ${shown.title}`} tabIndex={-1}>
        <header className="artifact__header">
          <div>
            <h1>{shown.title}</h1>
            <p>{isPdf ? 'PDF' : shown.mimeType}</p>
          </div>
          <div className="artifact__actions">
            {!isPdf && !isVideo && imageDimensions ? (
              <>
                <button
                  type="button"
                  aria-label="缩小图片"
                  title="缩小图片"
                  onClick={() =>
                    setImageZoom((current) => clampImageZoom(current / IMAGE_ZOOM_STEP))
                  }
                >
                  <ZoomOut size={16} aria-hidden="true" />
                </button>
                <span className="artifact__zoom" aria-live="polite">
                  {Math.round(imageZoom * 100)}%
                </span>
                <button
                  type="button"
                  aria-label="恢复适合窗口的缩放"
                  title="恢复适合窗口的缩放"
                  onClick={() =>
                    setImageZoom(fitImageToViewport(imageDimensions.width, imageDimensions.height))
                  }
                >
                  <RotateCcw size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="放大图片"
                  title="放大图片"
                  onClick={() =>
                    setImageZoom((current) => clampImageZoom(current * IMAGE_ZOOM_STEP))
                  }
                >
                  <ZoomIn size={16} aria-hidden="true" />
                </button>
              </>
            ) : null}
            <span className="artifact__mode">文件预览</span>
          </div>
        </header>
        <section className="artifact__content artifact__content--file">
          {isPdf ? (
            <iframe
              className="artifact__file-frame"
              sandbox="allow-downloads"
              src={shown.sourceUrl}
              title={`预览 ${shown.title}`}
            />
          ) : isVideo ? (
            <div className="artifact__video-shell">
              <video
                ref={videoRef}
                className="artifact__file-video"
                src={shown.sourceUrl}
                playsInline
                preload="metadata"
                role="button"
                tabIndex={0}
                aria-label={isVideoPlaying ? '点击暂停视频' : '点击播放视频'}
                onEnded={() => setIsVideoPlaying(false)}
                onClick={toggleVideoPlayback}
                onKeyDown={handleVideoKeyDown}
                onLoadedMetadata={updateVideoMetadata}
                onPause={() => setIsVideoPlaying(false)}
                onPlay={() => setIsVideoPlaying(true)}
                onTimeUpdate={updateVideoProgress}
              />
              <div className="artifact__video-controls" aria-label="视频控制">
                <button
                  type="button"
                  aria-label={isVideoPlaying ? '暂停视频' : '播放视频'}
                  title={isVideoPlaying ? '暂停视频' : '播放视频'}
                  onClick={toggleVideoPlayback}
                >
                  {isVideoPlaying ? (
                    <Pause size={17} aria-hidden="true" />
                  ) : (
                    <Play size={17} aria-hidden="true" />
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max={videoDuration}
                  step="0.1"
                  value={Math.min(videoCurrentTime, videoDuration)}
                  disabled={videoDuration <= 0}
                  aria-label="视频进度"
                  onChange={seekVideo}
                />
                <span aria-live="off">
                  {formatVideoTime(videoCurrentTime)} / {formatVideoTime(videoDuration)}
                </span>
                <button
                  type="button"
                  aria-label={isVideoMuted ? '取消静音' : '静音'}
                  title={isVideoMuted ? '取消静音' : '静音'}
                  onClick={toggleVideoMute}
                >
                  {isVideoMuted ? (
                    <VolumeX size={17} aria-hidden="true" />
                  ) : (
                    <Volume2 size={17} aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div
              ref={imageViewportRef}
              className={`artifact__image-viewport${
                imagePannable ? 'artifact__image-viewport--pannable' : ''
              }${isImagePanning ? 'artifact__image-viewport--panning' : ''}`}
              onWheel={handleImageWheel}
              onMouseDown={handleImageMouseDown}
              onDragStart={(event) => event.preventDefault()}
            >
              <div className="artifact__image-canvas">
                <img
                  className="artifact__file-image"
                  src={shown.sourceUrl}
                  alt={shown.title}
                  draggable={false}
                  style={imageWidth ? { width: imageWidth } : undefined}
                  onLoad={handleFileImageLoad}
                />
              </div>
            </div>
          )}
        </section>
      </main>
    )
  }

  const codeArtifact: DesktopCodeArtifactPayload = shown
  const runnable = isRunnableLang(codeArtifact.lang)
  const dataPreview = isDataPreviewLang(codeArtifact.lang)
  const previewable = runnable || dataPreview

  function switchMode(mode: DesktopCodeArtifactPayload['mode']): void {
    setPayload((current) => {
      if (!current || isFilePreviewPayload(current)) return current
      setConsoleEntries([])
      setIsConsoleOpen(mode === 'run' && isJavascriptLang(current.lang))
      return { ...current, mode }
    })
  }

  function handleCopy(): void {
    void copyText(codeArtifact.code).then((didCopy) => {
      if (!didCopy) return
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <main className="artifact" aria-label="Artifact 预览" tabIndex={-1}>
      <header className="artifact__header">
        <div>
          <h1>{codeArtifact.title}</h1>
          <p>{codeArtifact.lang || 'Code'}</p>
        </div>
        <div className="artifact__actions">
          {codeArtifact.mode === 'view' && previewable ? (
            <button
              type="button"
              aria-label={
                dataPreview ? t('desktop.artifact.dataPreview') : t('desktop.artifact.runPreview')
              }
              title={
                dataPreview ? t('desktop.artifact.dataPreview') : t('desktop.artifact.runPreview')
              }
              onClick={() => switchMode('run')}
            >
              <Play size={16} aria-hidden="true" />
            </button>
          ) : null}
          {codeArtifact.mode === 'run' ? (
            <button
              type="button"
              aria-label={t('desktop.artifact.viewSource')}
              title={t('desktop.artifact.viewSource')}
              onClick={() => switchMode('view')}
            >
              <Eye size={16} aria-hidden="true" />
            </button>
          ) : null}
          {codeArtifact.mode === 'run' && runnable ? (
            <button
              type="button"
              className={isConsoleOpen ? 'is-active' : undefined}
              aria-label={t('desktop.artifact.output')}
              title={t('desktop.artifact.output')}
              onClick={() => setIsConsoleOpen((current) => !current)}
            >
              <Terminal size={16} aria-hidden="true" />
            </button>
          ) : null}
          <span className="artifact__mode">
            {codeArtifact.mode === 'run'
              ? dataPreview
                ? t('desktop.artifact.dataPreview')
                : t('desktop.artifact.runPreview')
              : t('desktop.artifact.codeView')}
          </span>
        </div>
      </header>
      <section
        className={
          codeArtifact.mode === 'run' && runnable
            ? 'artifact__content artifact__content--run'
            : 'artifact__content'
        }
      >
        {codeArtifact.mode === 'run' && dataPreview ? (
          <DataPreview lang={codeArtifact.lang} code={codeArtifact.code} />
        ) : codeArtifact.mode === 'run' ? (
          <>
            <iframe
              className="artifact__frame"
              sandbox="allow-scripts allow-forms"
              srcDoc={srcDoc}
              title={`${codeArtifact.title} ${t('desktop.artifact.preview')}`}
            />
            {isConsoleOpen ? (
              <aside className="artifact__console" aria-label={t('desktop.artifact.output')}>
                <header>
                  <span>{t('desktop.artifact.output')}</span>
                  <button
                    type="button"
                    disabled={consoleEntries.length === 0}
                    onClick={() => setConsoleEntries([])}
                  >
                    {t('desktop.artifact.clear')}
                  </button>
                </header>
                <div className="artifact__console-body">
                  {consoleEntries.length === 0 ? (
                    <span className="artifact__console-empty">
                      {t('desktop.artifact.noOutput')}
                    </span>
                  ) : (
                    consoleEntries.map((entry, index) => (
                      <p key={`${entry.level}-${index}`} data-level={entry.level}>
                        {entry.text}
                      </p>
                    ))
                  )}
                </div>
              </aside>
            ) : null}
          </>
        ) : (
          <CodeHighlight
            lang={codeArtifact.lang}
            code={codeArtifact.code}
            className="artifact__code"
            padding="16px"
            fontSize="13px"
            lineHeight={1.65}
          />
        )}
      </section>
      <footer className="artifact__footer">
        <button type="button" onClick={handleCopy}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? t('common.copied') : t('desktop.artifact.copyCode')}
        </button>
        <span>
          {codeArtifact.lang || 'Code'} ·{' '}
          {t('desktop.artifact.lines', { count: codeArtifact.code.split('\n').length })}
        </span>
      </footer>
    </main>
  )
}
