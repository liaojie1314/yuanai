import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Pencil,
  Play,
  RotateCcw,
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
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { DateFmt, TimeFmt } from '@yuanai/core/stores'
import { formatMsgTime, isDataPreviewLang, isRunnableLang, stripMarkdown } from '@yuanai/core/utils'
import { Role } from '@yuanai/types'
import type { DesktopArtifactPayload } from '../../shared/ipc-contract'
import { copyText } from '../shared/clipboard'
import { CodeHighlight } from '../shared/CodeHighlight'
import type { Message, ToolCall, User } from '@yuanai/types'

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

function ToolCallDetails({ toolCall }: { toolCall: ToolCall }): ReactElement {
  const [open, setOpen] = useState(false)
  const status =
    toolCall.status === 'done'
      ? '已完成'
      : toolCall.status === 'error'
        ? '失败'
        : toolCall.status === 'running'
          ? '进行中'
          : '等待中'

  return (
    <details className="desktop-chat__tool-call" open={open}>
      <summary onClick={() => setOpen((value) => !value)}>
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
      </div>
    </details>
  )
}

function ThinkingBlock({
  message,
  active = false,
}: {
  message: Message
  active?: boolean
}): ReactElement | null {
  const [open, setOpen] = useState(active)
  const parts = message.messageParts ?? []
  const partThinking = parts
    .filter((part) => part.type === 'thinking')
    .map((part) => part.content)
    .join('\n')
  const toolCalls = parts.filter((part) => part.type === 'tool_call').map((part) => part.toolCall)
  const content = message.thinkingContent ?? partThinking
  const duration = message.thinkingDurationMs

  if (!content && toolCalls.length === 0 && !active) return null

  return (
    <section
      className={open ? 'desktop-chat__thinking is-open' : 'desktop-chat__thinking'}
      data-state={active ? 'active' : 'done'}
    >
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>
          <Sparkles size={14} aria-hidden="true" />
          {active ? '正在思考' : '已完成思考'}
        </span>
        <span>
          {!active && duration && duration > 0 ? `${(duration / 1000).toFixed(1)} 秒` : null}
          <ChevronDown size={14} aria-hidden="true" />
        </span>
      </button>
      {open ? (
        <div className="desktop-chat__thinking-body">
          {content ? <p>{content}</p> : <p>正在准备…</p>}
          {toolCalls.map((toolCall) => (
            <ToolCallDetails key={toolCall.id} toolCall={toolCall} />
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
}: {
  code: string
  lang: string
  title?: string
  onOpenArtifact(payload: DesktopArtifactPayload): void
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
      />
    </section>
  )
}

function MarkdownContent({
  content,
  onOpenArtifact,
}: {
  content: string
  onOpenArtifact(payload: DesktopArtifactPayload): void
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

function MessageAttachment({ file }: { file: Message['files'][number] }): ReactElement {
  const [imageFailed, setImageFailed] = useState(false)
  const isImage = file.mimeType.startsWith('image/') && !imageFailed

  if (isImage) {
    return (
      <li className="desktop-chat__file desktop-chat__file--image" title={file.filename}>
        <img src={file.url} alt={file.filename} onError={() => setImageFailed(true)} />
      </li>
    )
  }

  return (
    <li className="desktop-chat__file" title={file.filename}>
      <FileText size={14} aria-hidden="true" />
      <span>{file.filename}</span>
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
  versionCount = 1,
  versionIndex = 0,
}: ChatMessageProps): ReactElement {
  const isUser = message.role === Role.User
  const [isEditing, setIsEditing] = useState(false)
  const codeParts = (message.messageParts ?? []).filter((part) => part.type === 'code')
  const timestamp = formatMsgTime(message.createdAt, timeFmt, dateFmt)

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
        {!isUser ? <ThinkingBlock message={message} /> : null}
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
        ) : (
          <div className="desktop-chat__markdown">
            <MarkdownContent content={message.content} onOpenArtifact={onOpenArtifact} />
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
              />
            ))
          : null}
        {!isEditing && message.files.length > 0 ? (
          <ul className="desktop-chat__files" aria-label="消息附件">
            {message.files.map((file) => (
              <MessageAttachment key={file.id} file={file} />
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
        ) : !isEditing ? (
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
}: {
  content: string
  thinking: string
  thinkingDurationMs: number
  toolCalls: ToolCall[]
  onOpenArtifact(payload: DesktopArtifactPayload): void
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
            <MarkdownContent content={content} onOpenArtifact={onOpenArtifact} />
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
