import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  ExternalLink,
  FileText,
  Pencil,
  Play,
  RotateCcw,
  Square,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Wrench,
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { getFilePreview } from '@yuanai/core'
import { useCancelMediaTask, useCreateMediaTask } from '@yuanai/core/hooks'
import type { DateFmt, TimeFmt } from '@yuanai/core/stores'
import { formatMsgTime, isDataPreviewLang, isRunnableLang, stripMarkdown } from '@yuanai/core/utils'
import { Role } from '@yuanai/types'
import type { DesktopArtifactPayload } from '../../shared/ipc-contract'
import { copyText } from '../shared/clipboard'
import { CodeHighlight } from '../shared/CodeHighlight'
import type { MediaGenerationTask, Message, ToolCall, User } from '@yuanai/types'

/** 聊天消息区的交互回调。 */
export interface ChatMessageActions {
  /** 覆盖既有用户消息并生成对应的新回复。 */
  onEditMessage(messageId: string, content: string): void
  /** 以对应的用户问题重新生成 AI 回复。 */
  onRegenerate(): void
  /** 在独立 Artifact 窗口中查看或运行代码。 */
  onOpenArtifact(payload: DesktopArtifactPayload): void
  /** 提交 AI 回复的有用或无用反馈。 */
  onFeedback(messageId: string, type: 'like' | 'dislike'): void
}

/** 单条聊天消息的渲染输入。 */
export interface ChatMessageProps extends ChatMessageActions {
  /** 当前登录用户，用于用户消息头像。 */
  user: User | null
  /** 服务端消息。 */
  message: Message
  /** 正在流式返回时禁用可能重入发送的操作。 */
  isStreaming: boolean
  /** 当前 AI 消息是否存在对应的用户问题可重新生成。 */
  canRegenerate: boolean
  /** 当前 AI 回复在同一问题下的版本总数。 */
  versionCount?: number
  /** 当前显示的 AI 回复版本下标。 */
  versionIndex?: number
  /** 切换 AI 回复版本。 */
  onVersionChange?(index: number): void
  /** 当前 AI 回复已提交的反馈。 */
  feedback?: 'like' | 'dislike'
  /** 用户偏好的消息时间格式。 */
  timeFmt: TimeFmt
  /** 用户偏好的消息日期格式。 */
  dateFmt: DateFmt
  /** 列表滚动期间延后代码语法高亮。 */
  deferCodeHighlight?: boolean
  /** 历史消息思考块的受控展开状态；由虚拟列表按消息 ID 保存。 */
  thinkingOpen?: boolean
  /** 用户切换历史消息思考块时通知虚拟列表持久化状态。 */
  onThinkingOpenChange?(open: boolean): void
  /** 按工具调用 ID 保存历史消息中的工具详情展开状态。 */
  toolCallOpenById?: Readonly<Record<string, boolean>>
  /** 用户切换工具详情时通知虚拟列表持久化状态。 */
  onToolCallOpenChange?(toolCallId: string, open: boolean): void
}

const LANGUAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  css: 'css',
  html: 'html',
  javascript: 'js',
  js: 'js',
  json: 'json',
  markdown: 'md',
  md: 'md',
  python: 'py',
  ts: 'ts',
  typescript: 'ts',
}
const MESSAGE_EDITOR_MAX_HEIGHT = 160

function fileExtension(lang: string): string {
  return LANGUAGE_EXTENSIONS[lang.trim().toLocaleLowerCase()] ?? 'txt'
}

function resizeMessageEditor(editor: HTMLTextAreaElement): void {
  editor.style.height = 'auto'
  const height = Math.min(editor.scrollHeight, MESSAGE_EDITOR_MAX_HEIGHT)
  editor.style.height = `${height}px`
  editor.style.overflowY = editor.scrollHeight > MESSAGE_EDITOR_MAX_HEIGHT ? 'auto' : 'hidden'
}

function downloadCode(code: string, lang: string, title?: string): void {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${title?.trim() || 'code'}.${fileExtension(lang)}`
  anchor.click()
  URL.revokeObjectURL(url)
}

/** 显示用户头像，图片不可用时稳定回退至用户名首字。 */
export function UserAvatar({
  user,
  className,
}: {
  user: User | null
  className: string
}): ReactElement {
  const [imageFailed, setImageFailed] = useState(false)
  const initial = user?.username.slice(0, 1).toLocaleUpperCase() || '?'

  return (
    <span className={className} aria-hidden="true">
      {user?.avatarUrl && !imageFailed ? (
        <img src={user.avatarUrl} alt="" onError={() => setImageFailed(true)} />
      ) : (
        initial
      )}
    </span>
  )
}

function ToolCallDetails({
  toolCall,
  open: controlledOpen,
  onOpenChange,
}: {
  toolCall: ToolCall
  open?: boolean
  onOpenChange?(open: boolean): void
}): ReactElement {
  const { t } = useTranslation()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const status =
    toolCall.status === 'done'
      ? t('chat.toolDone')
      : toolCall.status === 'error'
        ? t('chat.toolFailed')
        : toolCall.status === 'running'
          ? t('chat.toolRunning')
          : t('chat.toolPending')

  function toggleOpen(): void {
    const nextOpen = !open
    if (controlledOpen === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  return (
    <details className="desktop-chat__tool-call" open={open}>
      <summary
        onClick={(event) => {
          // `open` is controlled when the parent is virtualized. Prevent the native
          // details toggle so an unmount/remount cannot overwrite the saved state.
          event.preventDefault()
          toggleOpen()
        }}
      >
        <span>
          <Wrench size={13} aria-hidden="true" />
          {toolCall.name}
        </span>
        <small data-status={toolCall.status}>{status}</small>
      </summary>
      <div>
        {toolCall.arguments ? <pre>{toolCall.arguments}</pre> : null}
        {toolCall.result ? <pre>{toolCall.result}</pre> : null}
        {toolCall.error ? <pre className="is-error">{toolCall.error}</pre> : null}
        {toolCall.sources && toolCall.sources.length > 0 ? (
          <ul className="desktop-chat__tool-sources" aria-label="联网来源">
            {toolCall.sources.map((source) => (
              <li key={source.url}>
                <button
                  type="button"
                  title={source.snippet}
                  onClick={() => {
                    void window.yuanai.shell.openExternalUrl(source.url).catch(() => undefined)
                  }}
                >
                  <span>{source.title}</span>
                  <ExternalLink size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  )
}

function ThinkingBlock({
  message,
  active = false,
  open: controlledOpen,
  onOpenChange,
  toolCallOpenById,
  onToolCallOpenChange,
}: {
  message: Message
  active?: boolean
  open?: boolean
  onOpenChange?(open: boolean): void
  toolCallOpenById?: Readonly<Record<string, boolean>>
  onToolCallOpenChange?(toolCallId: string, open: boolean): void
}): ReactElement | null {
  const { t } = useTranslation()
  const [internalOpen, setInternalOpen] = useState(active)
  const open = controlledOpen ?? internalOpen
  const parts = message.messageParts ?? []
  const partThinking = parts
    .filter((part) => part.type === 'thinking')
    .map((part) => part.content)
    .join('\n')
  const partToolCalls = parts
    .filter((part) => part.type === 'tool_call')
    .map((part) => part.toolCall)
  // 已完成消息从 API 的 `toolCalls` 恢复；仅流式消息把工具调用临时编码到 messageParts。
  const toolCalls = message.toolCalls?.length ? message.toolCalls : partToolCalls
  const content = message.thinkingContent ?? partThinking
  const duration = message.thinkingDurationMs

  if (!content && toolCalls.length === 0 && !active) return null

  function toggleOpen(): void {
    const nextOpen = !open
    if (controlledOpen === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  return (
    <section
      className={open ? 'desktop-chat__thinking is-open' : 'desktop-chat__thinking'}
      data-state={active ? 'active' : 'done'}
    >
      <button type="button" aria-expanded={open} onClick={toggleOpen}>
        <span>
          <Sparkles size={14} aria-hidden="true" />
          {active ? t('chat.thinking') : t('chat.thinkingDone')}
        </span>
        <span>
          {!active && duration && duration > 0
            ? t('chat.thinkingDuration', { seconds: (duration / 1000).toFixed(1) })
            : null}
          <ChevronDown size={14} aria-hidden="true" />
        </span>
      </button>
      {open ? (
        <div className="desktop-chat__thinking-body">
          {content ? <p>{content}</p> : null}
          {toolCalls.map((toolCall) => (
            <ToolCallDetails
              key={toolCall.id}
              toolCall={toolCall}
              {...(toolCallOpenById && toolCall.id in toolCallOpenById
                ? { open: toolCallOpenById[toolCall.id] }
                : {})}
              {...(onToolCallOpenChange
                ? {
                    onOpenChange: (nextOpen: boolean) =>
                      onToolCallOpenChange(toolCall.id, nextOpen),
                  }
                : {})}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function DesktopCodeBlock({
  code,
  lang,
  title,
  onOpenArtifact,
  deferCodeHighlight = false,
}: {
  code: string
  lang: string
  title?: string
  onOpenArtifact(payload: DesktopArtifactPayload): void
  deferCodeHighlight?: boolean
}): ReactElement {
  const [copied, setCopied] = useState(false)
  const displayLang = lang || 'Code'
  const runnable = isRunnableLang(lang)
  const dataPreview = isDataPreviewLang(lang)
  const previewable = runnable || dataPreview

  function copy(): void {
    void copyText(code).then((didCopy) => {
      if (!didCopy) return
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    })
  }

  function openArtifact(mode: 'view' | 'run'): void {
    onOpenArtifact({
      code,
      lang: displayLang,
      mode,
      title: title?.trim() || (mode === 'run' ? `${displayLang} 预览` : displayLang),
    })
  }

  return (
    <section className="desktop-chat__code-block">
      <header>
        <span>{displayLang}</span>
        <div>
          <button type="button" aria-label="复制代码" title="复制代码" onClick={copy}>
            {copied ? (
              <Check size={14} aria-hidden="true" />
            ) : (
              <Copy size={14} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            aria-label="下载代码"
            title="下载代码"
            onClick={() => downloadCode(code, lang, title)}
          >
            <Download size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="展示面板"
            title="展示面板"
            onClick={() => openArtifact('view')}
          >
            <ExternalLink size={14} aria-hidden="true" />
          </button>
          {previewable ? (
            <button
              type="button"
              aria-label={dataPreview ? '数据预览' : '运行预览'}
              title={dataPreview ? '数据预览' : '运行预览'}
              onClick={() => openArtifact('run')}
            >
              <Play size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>
      <CodeHighlight
        lang={lang}
        code={code}
        className="desktop-chat__code-highlight"
        padding="13px"
        fontSize="12px"
        lineHeight={1.6}
        defer={deferCodeHighlight}
      />
    </section>
  )
}

function MarkdownContent({
  content,
  onOpenArtifact,
  deferCodeHighlight = false,
}: {
  content: string
  onOpenArtifact(payload: DesktopArtifactPayload): void
  deferCodeHighlight?: boolean
}): ReactElement {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ children, className, node: _node, ...props }) {
          const lang = /language-([\w+-]+)/.exec(className ?? '')?.[1] ?? ''
          if (!lang) {
            return (
              <code className={className} {...props}>
                {children}
              </code>
            )
          }
          return (
            <DesktopCodeBlock
              code={String(children).replace(/\n$/, '')}
              lang={lang}
              onOpenArtifact={onOpenArtifact}
              deferCodeHighlight={deferCodeHighlight}
            />
          )
        },
        pre({ children }) {
          return <>{children}</>
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

function MessageAttachment({
  file,
  onOpenArtifact,
}: {
  file: Message['files'][number]
  onOpenArtifact(payload: DesktopArtifactPayload): void
}): ReactElement {
  const [imageFailed, setImageFailed] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const isSupportedImage = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(
    file.mimeType
  )
  const isImage = isSupportedImage && !imageFailed

  function openImagePreview(): void {
    onOpenArtifact({
      kind: 'file-preview',
      title: file.filename,
      sourceUrl: file.url,
      mimeType: file.mimeType,
    })
  }

  if (isImage) {
    return (
      <li className="desktop-chat__file desktop-chat__file--image" title={file.filename}>
        <button type="button" aria-label={`预览图片 ${file.filename}`} onClick={openImagePreview}>
          <img src={file.url} alt={file.filename} onError={() => setImageFailed(true)} />
        </button>
        <a
          className="desktop-chat__file-download"
          href={file.url}
          download={file.filename}
          aria-label={`下载 ${file.filename}`}
          title={`下载 ${file.filename}`}
        >
          <Download size={15} aria-hidden="true" />
        </a>
        {previewError ? <small role="status">{previewError}</small> : null}
      </li>
    )
  }

  async function openPreview(): Promise<void> {
    try {
      const preview = await getFilePreview(file.id)
      if (preview.kind === 'unsupported') {
        setPreviewError('此文件类型不支持内置预览，请下载原文件查看。')
        return
      }
      if (preview.kind === 'image' || preview.kind === 'pdf') {
        onOpenArtifact({
          kind: 'file-preview',
          title: preview.filename,
          sourceUrl: preview.url,
          mimeType: preview.kind === 'pdf' ? 'application/pdf' : preview.mimeType,
        })
        return
      }
      const code =
        preview.kind === 'text'
          ? (preview.text ?? '')
          : (preview.rows ?? []).map((row) => row.join('\t')).join('\n')
      onOpenArtifact({
        title: file.filename,
        lang: preview.kind === 'table' ? 'csv' : 'text',
        code,
        mode: 'view',
      })
    } catch {
      setPreviewError('预览加载失败，请下载原文件查看。')
    }
  }

  return (
    <li className="desktop-chat__file" title={file.filename}>
      <FileText size={14} aria-hidden="true" />
      <span>{file.filename}</span>
      <button
        type="button"
        className="desktop-chat__file-action"
        onClick={() => void openPreview()}
        aria-label={`预览 ${file.filename}`}
        title={`预览 ${file.filename}`}
      >
        <Eye size={14} aria-hidden="true" />
      </button>
      <a href={file.url} download aria-label={`下载 ${file.filename}`}>
        <Download size={13} aria-hidden="true" />
      </a>
      {previewError ? <small role="status">{previewError}</small> : null}
    </li>
  )
}

function UserMessageActions({
  content,
  timestamp,
  isStreaming,
  onStartEdit,
}: {
  content: string
  timestamp: string
  isStreaming: boolean
  onStartEdit(): void
}): ReactElement {
  const [copied, setCopied] = useState(false)

  function copy(): void {
    void copyText(content).then((didCopy) => {
      if (!didCopy) return
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="desktop-chat__message-actions">
      <time className="desktop-chat__message-time">{timestamp}</time>
      <button type="button" aria-label="复制消息" title="复制消息" onClick={copy}>
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
      <button
        type="button"
        aria-label="编辑消息"
        title="编辑消息"
        disabled={isStreaming}
        onClick={onStartEdit}
      >
        <Pencil size={14} aria-hidden="true" />
      </button>
    </div>
  )
}

/** 以 Web 端相同的就地编辑方式替换用户消息气泡。 */
function UserMessageEditor({
  content,
  onCancel,
  onSubmit,
}: {
  content: string
  onCancel(): void
  onSubmit(content: string): void
}): ReactElement {
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState(content)

  useEffect(() => {
    setDraft(content)
    window.requestAnimationFrame(() => {
      const editor = editorRef.current
      if (!editor) return
      resizeMessageEditor(editor)
      editor.focus()
      editor.setSelectionRange(editor.value.length, editor.value.length)
    })
  }, [content])

  function submit(): void {
    const value = draft.trim()
    if (value) onSubmit(value)
    else onCancel()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="desktop-chat__message-editor">
      <textarea
        ref={editorRef}
        aria-label="编辑消息"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          resizeMessageEditor(event.currentTarget)
        }}
        onKeyDown={handleKeyDown}
      />
      <div>
        <span>Shift+Enter 换行 · Enter 提交</span>
        <button type="button" onClick={onCancel}>
          取消
        </button>
        <button type="button" onClick={submit}>
          提交
        </button>
      </div>
    </div>
  )
}

function AssistantMessageActions({
  content,
  canRegenerate,
  feedback,
  isStreaming,
  onFeedback,
  onRegenerate,
  timestamp,
}: {
  content: string
  canRegenerate: boolean
  feedback?: 'like' | 'dislike'
  isStreaming: boolean
  onFeedback(type: 'like' | 'dislike'): void
  onRegenerate(): void
  timestamp: string
}): ReactElement {
  const [copyState, setCopyState] = useState<'idle' | 'open' | 'markdown' | 'text'>('idle')
  const closeTimerRef = useRef<number | null>(null)

  function copy(kind: 'markdown' | 'text'): void {
    const value = kind === 'markdown' ? content : stripMarkdown(content)
    void copyText(value).then((didCopy) => {
      if (!didCopy) return
      setCopyState(kind)
      window.setTimeout(() => setCopyState('idle'), 2000)
    })
  }

  function openCopyMenu(): void {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setCopyState((value) => (value === 'markdown' || value === 'text' ? value : 'open'))
  }

  function closeCopyMenu(): void {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(() => {
      setCopyState((value) => (value === 'open' ? 'idle' : value))
    }, 200)
  }

  function handleCopyBlur(event: FocusEvent<HTMLDivElement>): void {
    if (!event.currentTarget.contains(event.relatedTarget)) closeCopyMenu()
  }

  return (
    <div className="desktop-chat__message-actions">
      <time className="desktop-chat__message-time">{timestamp}</time>
      <div
        className="desktop-chat__copy-wrap"
        onMouseEnter={openCopyMenu}
        onMouseLeave={closeCopyMenu}
        onFocus={openCopyMenu}
        onBlur={handleCopyBlur}
      >
        <button
          type="button"
          aria-label="复制内容"
          title="复制内容"
          onClick={() => copy('markdown')}
        >
          {copyState === 'markdown' || copyState === 'text' ? (
            <Check size={14} aria-hidden="true" />
          ) : (
            <Copy size={14} aria-hidden="true" />
          )}
        </button>
        {copyState === 'open' ? (
          <div className="desktop-chat__copy-dropdown" role="menu" aria-label="复制格式">
            <button type="button" role="menuitem" onClick={() => copy('markdown')}>
              复制 Markdown
            </button>
            <button type="button" role="menuitem" onClick={() => copy('text')}>
              复制纯文本
            </button>
          </div>
        ) : null}
      </div>
      <span aria-hidden="true" />
      <button
        type="button"
        aria-label="重新生成回答"
        title="重新生成回答"
        disabled={!canRegenerate || isStreaming}
        onClick={onRegenerate}
      >
        <RotateCcw size={14} aria-hidden="true" />
      </button>
      <button
        className={feedback === 'like' ? 'is-active' : undefined}
        type="button"
        aria-label="回答有帮助"
        title="回答有帮助"
        onClick={() => onFeedback('like')}
      >
        <ThumbsUp size={14} aria-hidden="true" />
      </button>
      <button
        className={feedback === 'dislike' ? 'is-active' : undefined}
        type="button"
        aria-label="回答有问题"
        title="回答有问题"
        onClick={() => onFeedback('dislike')}
      >
        <ThumbsDown size={14} aria-hidden="true" />
      </button>
    </div>
  )
}

/** 在桌面端独立 Artifact 窗口预览、取消或重试生成任务。 */
function MediaTaskCard({
  task,
  onOpenArtifact,
}: {
  task: MediaGenerationTask
  onOpenArtifact(payload: DesktopArtifactPayload): void
}): ReactElement {
  const { t } = useTranslation()
  const cancel = useCancelMediaTask()
  const retry = useCreateMediaTask()
  const active = task.status === 'queued' || task.status === 'running'
  const label =
    task.type === 'image'
      ? t('chat.media.image')
      : task.type === 'music'
        ? t('chat.media.music')
        : t('chat.media.video')
  const outputName = `${label}-${task.id.slice(0, 8)}${
    task.type === 'image' ? '.png' : task.type === 'music' ? '.mp3' : '.mp4'
  }`
  const requestedRatio = task.type === 'image' ? task.options.ratio : task.options.aspectRatio
  const mediaStyle = {
    aspectRatio: requestedRatio
      ? requestedRatio.replace(':', ' / ')
      : task.type === 'image'
        ? '1 / 1'
        : '16 / 9',
  }
  const thumbnailUrl = task.type === 'image' ? task.resultUrl : task.resultPosterUrl

  return (
    <section className="desktop-chat__media-task" aria-label={`${label}任务`}>
      <header>
        <span>{label}</span>
        <small>
          {active
            ? `${task.progress}%`
            : task.status === 'succeeded'
              ? t('chat.media.completed')
              : t('chat.media.ended')}
        </small>
      </header>
      <p>{task.prompt}</p>
      {active ? (
        <div
          className="desktop-chat__media-progress"
          aria-label={t('chat.media.generationProgress', { progress: task.progress })}
        >
          <span style={{ width: `${Math.max(4, task.progress)}%` }} />
        </div>
      ) : null}
      {task.status === 'succeeded' && task.resultUrl && task.type === 'music' ? (
        <div className="desktop-chat__media-audio-shell">
          <audio
            className="desktop-chat__media-audio"
            controls
            preload="metadata"
            src={task.resultUrl}
            aria-label={t('chat.media.audioAria', { task: label })}
          />
          <a
            className="desktop-chat__media-audio-download"
            href={task.resultUrl}
            download={outputName}
            aria-label={t('chat.media.downloadTask', { task: label })}
            title={t('chat.media.downloadTask', { task: label })}
          >
            <Download size={16} aria-hidden="true" />
          </a>
        </div>
      ) : null}
      {task.status === 'succeeded' &&
      task.resultUrl &&
      task.resultMimeType &&
      task.type !== 'music' ? (
        <div className="desktop-chat__media-result-shell" style={mediaStyle}>
          <button
            type="button"
            className="desktop-chat__media-result"
            aria-label={t('chat.media.openPreview', { task: label })}
            title={t('chat.media.openPreview', { task: label })}
            onClick={() =>
              onOpenArtifact({
                kind: 'file-preview',
                title: `${label}-${task.id.slice(0, 8)}`,
                sourceUrl: task.resultUrl ?? '',
                mimeType: task.resultMimeType ?? '',
              })
            }
          >
            {thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                alt={task.type === 'image' ? task.prompt : ''}
                draggable={false}
              />
            ) : (
              <span className="desktop-chat__media-video-fallback" aria-hidden="true" />
            )}
            {task.type === 'video' ? (
              <span className="desktop-chat__media-play" aria-hidden="true">
                <Play size={20} fill="currentColor" />
              </span>
            ) : null}
          </button>
          <a
            className="desktop-chat__media-download"
            href={task.resultUrl}
            download
            aria-label={t('chat.media.downloadTask', { task: label })}
            title={t('chat.media.downloadTask', { task: label })}
          >
            <Download size={16} aria-hidden="true" />
          </a>
        </div>
      ) : null}
      {task.status === 'failed' ? (
        <small className="is-error">{task.errorMessage ?? t('chat.media.generationFailed')}</small>
      ) : null}
      <footer>
        {active ? (
          <button type="button" onClick={() => cancel.mutate(task.id)} disabled={cancel.isPending}>
            <Square size={13} fill="currentColor" /> {t('chat.media.stop')}
          </button>
        ) : null}
        {task.status === 'failed' ? (
          <button
            type="button"
            onClick={() =>
              retry.mutate({
                conversationId: task.conversationId,
                type: task.type,
                prompt: task.prompt,
                options: task.options,
                sourceFileIds: task.sourceFileIds,
              })
            }
            disabled={retry.isPending}
          >
            <RotateCcw size={13} /> {t('chat.media.retry')}
          </button>
        ) : null}
      </footer>
    </section>
  )
}

/** 渲染已完成消息的头像、思考块、代码工具栏和消息操作。 */
export function ChatMessage({
  user,
  message,
  isStreaming,
  canRegenerate,
  feedback,
  onOpenArtifact,
  onFeedback,
  onRegenerate,
  onEditMessage,
  onVersionChange,
  timeFmt,
  dateFmt,
  deferCodeHighlight = false,
  versionCount = 1,
  versionIndex = 0,
  thinkingOpen,
  onThinkingOpenChange,
  toolCallOpenById,
  onToolCallOpenChange,
}: ChatMessageProps): ReactElement {
  const { t } = useTranslation()
  const isUser = message.role === Role.User
  const [isEditing, setIsEditing] = useState(false)
  const codeParts = (message.messageParts ?? []).filter((part) => part.type === 'code')
  const timestamp = formatMsgTime(message.createdAt, timeFmt, dateFmt, {
    yesterdayLabel: t('chat.groups.yesterday'),
  })

  function handleSubmitEdit(content: string): void {
    setIsEditing(false)
    if (content !== message.content) onEditMessage(message.id, content)
  }

  return (
    <article
      className={
        isUser ? 'desktop-chat__message desktop-chat__message--user' : 'desktop-chat__message'
      }
    >
      {isUser ? (
        <UserAvatar
          user={user}
          className="desktop-chat__message-avatar desktop-chat__message-avatar--user"
        />
      ) : (
        <div className="desktop-chat__message-avatar" aria-hidden="true">
          元
        </div>
      )}
      <div className="desktop-chat__message-body">
        {!isUser ? (
          <ThinkingBlock
            message={message}
            {...(thinkingOpen !== undefined ? { open: thinkingOpen } : {})}
            {...(onThinkingOpenChange ? { onOpenChange: onThinkingOpenChange } : {})}
            {...(toolCallOpenById ? { toolCallOpenById } : {})}
            {...(onToolCallOpenChange ? { onToolCallOpenChange } : {})}
          />
        ) : null}
        {isUser && isEditing ? (
          <UserMessageEditor
            content={message.content}
            onCancel={() => setIsEditing(false)}
            onSubmit={handleSubmitEdit}
          />
        ) : isUser ? (
          <div className="desktop-chat__markdown desktop-chat__message-bubble">
            <p>{message.content}</p>
          </div>
        ) : message.mediaTask ? (
          <MediaTaskCard task={message.mediaTask} onOpenArtifact={onOpenArtifact} />
        ) : (
          <div className="desktop-chat__markdown">
            <MarkdownContent
              content={message.content}
              onOpenArtifact={onOpenArtifact}
              deferCodeHighlight={deferCodeHighlight}
            />
          </div>
        )}
        {!isEditing
          ? codeParts.map((part, index) => (
              <DesktopCodeBlock
                key={`${message.id}-code-${index}`}
                code={part.code}
                lang={part.lang}
                title={part.title ?? ''}
                onOpenArtifact={onOpenArtifact}
                deferCodeHighlight={deferCodeHighlight}
              />
            ))
          : null}
        {!isEditing && message.files.length > 0 ? (
          <ul className="desktop-chat__files" aria-label="消息附件">
            {message.files.map((file) => (
              <MessageAttachment key={file.id} file={file} onOpenArtifact={onOpenArtifact} />
            ))}
          </ul>
        ) : null}
        {!isEditing && !isUser && versionCount > 1 && onVersionChange ? (
          <div className="desktop-chat__version-nav" aria-label="回答版本">
            <button
              type="button"
              aria-label="上一个版本"
              title="上一个版本"
              disabled={versionIndex === 0}
              onClick={() => onVersionChange(versionIndex - 1)}
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            <span>
              {versionIndex + 1} / {versionCount}
            </span>
            <button
              type="button"
              aria-label="下一个版本"
              title="下一个版本"
              disabled={versionIndex === versionCount - 1}
              onClick={() => onVersionChange(versionIndex + 1)}
            >
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {!isEditing && isUser ? (
          <UserMessageActions
            content={message.content}
            timestamp={timestamp}
            isStreaming={isStreaming}
            onStartEdit={() => setIsEditing(true)}
          />
        ) : !isEditing && !message.mediaTask ? (
          <AssistantMessageActions
            content={message.content}
            canRegenerate={canRegenerate}
            isStreaming={isStreaming}
            onFeedback={(type) => onFeedback(message.id, type)}
            onRegenerate={onRegenerate}
            timestamp={timestamp}
            {...(feedback ? { feedback } : {})}
          />
        ) : null}
      </div>
    </article>
  )
}

/** 渲染正在返回的 AI 消息，思考与工具调用阶段默认展开。 */
export function StreamingMessage({
  content,
  thinking,
  thinkingDurationMs,
  toolCalls,
  onOpenArtifact,
  deferCodeHighlight = false,
}: {
  content: string
  thinking: string
  thinkingDurationMs: number
  toolCalls: ToolCall[]
  onOpenArtifact(payload: DesktopArtifactPayload): void
  deferCodeHighlight?: boolean
}): ReactElement {
  const message: Message = {
    id: 'streaming-message',
    role: Role.Assistant,
    content,
    ...(thinking ? { thinkingContent: thinking } : {}),
    ...(thinkingDurationMs > 0 ? { thinkingDurationMs } : {}),
    ...(toolCalls.length > 0
      ? { messageParts: toolCalls.map((toolCall) => ({ type: 'tool_call' as const, toolCall })) }
      : {}),
    files: [],
    createdAt: new Date().toISOString(),
  }

  return (
    <article className="desktop-chat__message" aria-live="polite">
      <div className="desktop-chat__message-avatar" aria-hidden="true">
        元
      </div>
      <div className="desktop-chat__message-body">
        <ThinkingBlock
          message={message}
          active={Boolean(thinking) || toolCalls.some((toolCall) => toolCall.status === 'running')}
        />
        {content ? (
          <div className="desktop-chat__markdown">
            <MarkdownContent
              content={content}
              onOpenArtifact={onOpenArtifact}
              deferCodeHighlight={deferCodeHighlight}
            />
          </div>
        ) : (
          <div className="desktop-chat__typing" aria-label="正在生成">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>
    </article>
  )
}
