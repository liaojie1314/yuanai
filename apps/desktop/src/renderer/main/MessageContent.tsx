import {
  Check,
  ChevronDown,
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
import { useState, type KeyboardEvent, type ReactElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { isRunnableLang, stripMarkdown } from '@yuanai/core/utils'
import { Role } from '@yuanai/types'
import type { DesktopArtifactPayload } from '../../shared/ipc-contract'
import type { Message, ToolCall, User } from '@yuanai/types'

/** 聊天消息区的交互回调。 */
export interface ChatMessageActions {
  /** 将编辑后的用户内容作为新一轮消息发送。 */
  onResubmit(content: string): void
  /** 以对应的用户问题重新生成 AI 回复。 */
  onRegenerate(): void
  /** 在独立 Artifact 窗口中查看或运行代码。 */
  onOpenArtifact(payload: DesktopArtifactPayload): void
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

function fileExtension(lang: string): string {
  return LANGUAGE_EXTENSIONS[lang.trim().toLocaleLowerCase()] ?? 'txt'
}

function copyToClipboard(value: string): Promise<void> {
  return navigator.clipboard.writeText(value).catch(() => undefined)
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

  function copy(): void {
    void copyToClipboard(code).then(() => {
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
          {runnable ? (
            <button
              type="button"
              aria-label="运行预览"
              title="运行预览"
              onClick={() => openArtifact('run')}
            >
              <Play size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>
      <pre>
        <code>{code}</code>
      </pre>
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
  isStreaming,
  onResubmit,
}: {
  content: string
  isStreaming: boolean
  onResubmit(content: string): void
}): ReactElement {
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(content)

  function copy(): void {
    void copyToClipboard(content).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    })
  }

  function submit(): void {
    const value = draft.trim()
    setEditing(false)
    if (value && value !== content) onResubmit(value)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Escape') setEditing(false)
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  if (editing) {
    return (
      <div className="desktop-chat__message-editor">
        <textarea
          aria-label="编辑消息"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div>
          <button type="button" onClick={() => setEditing(false)}>
            取消
          </button>
          <button type="button" onClick={submit}>
            发送
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="desktop-chat__message-actions">
      <button type="button" aria-label="复制消息" title="复制消息" onClick={copy}>
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
      <button
        type="button"
        aria-label="编辑消息"
        title="编辑消息"
        disabled={isStreaming}
        onClick={() => {
          setDraft(content)
          setEditing(true)
        }}
      >
        <Pencil size={14} aria-hidden="true" />
      </button>
    </div>
  )
}

function AssistantMessageActions({
  content,
  canRegenerate,
  isStreaming,
  onRegenerate,
}: {
  content: string
  canRegenerate: boolean
  isStreaming: boolean
  onRegenerate(): void
}): ReactElement {
  const [copied, setCopied] = useState<'markdown' | 'text' | null>(null)
  const [feedback, setFeedback] = useState<'like' | 'dislike' | null>(null)

  function copy(kind: 'markdown' | 'text'): void {
    const value = kind === 'markdown' ? content : stripMarkdown(content)
    void copyToClipboard(value).then(() => {
      setCopied(kind)
      window.setTimeout(() => setCopied(null), 2000)
    })
  }

  return (
    <div className="desktop-chat__message-actions">
      <button
        type="button"
        aria-label="复制 Markdown"
        title="复制 Markdown"
        onClick={() => copy('markdown')}
      >
        {copied === 'markdown' ? (
          <Check size={14} aria-hidden="true" />
        ) : (
          <Copy size={14} aria-hidden="true" />
        )}
      </button>
      <button type="button" aria-label="复制纯文本" title="复制纯文本" onClick={() => copy('text')}>
        {copied === 'text' ? (
          <Check size={14} aria-hidden="true" />
        ) : (
          <Copy size={14} aria-hidden="true" />
        )}
      </button>
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
        onClick={() => setFeedback((value) => (value === 'like' ? null : 'like'))}
      >
        <ThumbsUp size={14} aria-hidden="true" />
      </button>
      <button
        className={feedback === 'dislike' ? 'is-active' : undefined}
        type="button"
        aria-label="回答有问题"
        title="回答有问题"
        onClick={() => setFeedback((value) => (value === 'dislike' ? null : 'dislike'))}
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
  onOpenArtifact,
  onRegenerate,
  onResubmit,
}: ChatMessageProps): ReactElement {
  const isUser = message.role === Role.User
  const codeParts = (message.messageParts ?? []).filter((part) => part.type === 'code')

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
        {isUser ? (
          <div className="desktop-chat__markdown desktop-chat__message-bubble">
            <MarkdownContent content={message.content} onOpenArtifact={onOpenArtifact} />
          </div>
        ) : (
          <div className="desktop-chat__markdown">
            <MarkdownContent content={message.content} onOpenArtifact={onOpenArtifact} />
          </div>
        )}
        {codeParts.map((part, index) => (
          <DesktopCodeBlock
            key={`${message.id}-code-${index}`}
            code={part.code}
            lang={part.lang}
            title={part.title ?? ''}
            onOpenArtifact={onOpenArtifact}
          />
        ))}
        {message.files.length > 0 ? (
          <ul className="desktop-chat__files" aria-label="消息附件">
            {message.files.map((file) => (
              <MessageAttachment key={file.id} file={file} />
            ))}
          </ul>
        ) : null}
        {isUser ? (
          <UserMessageActions
            content={message.content}
            isStreaming={isStreaming}
            onResubmit={onResubmit}
          />
        ) : (
          <AssistantMessageActions
            content={message.content}
            canRegenerate={canRegenerate}
            isStreaming={isStreaming}
            onRegenerate={onRegenerate}
          />
        )}
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
