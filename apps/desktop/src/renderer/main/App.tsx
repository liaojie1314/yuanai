import {
  Brain,
  Bot,
  Calculator,
  Check,
  CheckSquare,
  ChevronDown,
  CircleAlert,
  Code2,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Ghost,
  Globe2,
  Image,
  Languages,
  Link,
  LoaderCircle,
  LogIn,
  Lock,
  Mic,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Paperclip,
  Pin,
  SendHorizontal,
  Share2,
  Sparkles,
  Settings,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import {
  useConversations,
  useCreateConversation,
  useDeleteConversation,
  useDeleteConversations,
  useMessages,
  useModels,
  useCreateShareLink,
  useRevokeShareLink,
  useShareLink,
  useStream,
  useUpdateConversation,
  TEMPORARY_CONV_ID,
  uploadFileSmart,
} from '@yuanai/core/hooks'
import { useAuthStore, useChatStore, usePrefsStore } from '@yuanai/core/stores'
import { Role, type AIModel, type Conversation, type Message } from '@yuanai/types'

const FALLBACK_MODEL: AIModel = {
  id: 'deepseek-v4-flash',
  name: 'DeepSeek V4 Flash',
  provider: 'deepseek',
  description: '快速响应，高性价比',
  supportsVision: true,
  supportsFiles: true,
  contextLength: 64000,
  isDefault: true,
}

const DEFAULT_MODELS: AIModel[] = [
  FALLBACK_MODEL,
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    provider: 'deepseek',
    description: '中文理解强，旗舰推理',
    supportsVision: true,
    supportsFiles: true,
    contextLength: 128000,
    isDefault: false,
  },
]
const EMPTY_CONVERSATIONS: Conversation[] = []
const EMPTY_MESSAGES: Message[] = []
const SHARE_EXPIRY_OPTIONS = [
  { label: '永久有效', value: 0 },
  { label: '1 天', value: 1 },
  { label: '7 天', value: 7 },
  { label: '30 天', value: 30 },
] as const

const SUGGESTIONS = [
  {
    description: '帮我写一个关于时间旅行的科幻短篇',
    icon: Sparkles,
    prompt: '帮我写一个关于时间旅行的科幻短篇故事',
    title: '创意写作',
  },
  {
    description: '帮我排查这段代码为什么报 TypeError',
    icon: Code2,
    prompt: '帮我排查这段代码为什么报 TypeError：',
    title: '代码调试',
  },
  {
    description: '搜索今天最新的 AI 行业动态',
    icon: Globe2,
    prompt: '搜索今天最新的 AI 行业动态',
    title: '联网搜索',
  },
  {
    description: '用简单的方式解释量子纠缠是什么',
    icon: Calculator,
    prompt: '用简单方式解释量子纠缠是什么',
    title: '学习辅导',
  },
] as const

const CAPABILITIES = [
  { icon: Globe2, label: '联网搜索', prompt: '联网搜索最新 AI 行业动态' },
  { icon: Code2, label: '代码生成', prompt: '帮我写一段' },
  { icon: Image, label: '图片理解', prompt: '帮我分析这张图片中的内容' },
  { icon: FileText, label: '文件分析', prompt: '帮我总结这份文件的要点' },
  { icon: Calculator, label: '数学推导', prompt: '解一道数学题：' },
  { icon: Languages, label: '多语种翻译', prompt: '把下面内容翻译成地道英文：' },
] as const

interface ComposerAttachment {
  id: string
  file: File
  fileId?: string
  progress: number
  status: 'ready' | 'uploading' | 'done' | 'error'
}

function getModelInitial(model: AIModel): string {
  return model.provider.slice(0, 1).toLocaleUpperCase()
}

function formatContextLength(contextLength: number): string {
  return contextLength >= 1000 ? `${Math.round(contextLength / 1000)}K` : String(contextLength)
}

function formatModelProvider(provider: string): string {
  if (provider.toLocaleLowerCase() === 'deepseek') return 'DeepSeek'
  if (provider.toLocaleLowerCase() === 'openai') return 'OpenAI'
  return provider
}

function groupModelsByProvider(models: AIModel[]): Array<{ provider: string; models: AIModel[] }> {
  const grouped = new Map<string, AIModel[]>()
  for (const model of models) {
    const provider = formatModelProvider(model.provider)
    const group = grouped.get(provider) ?? []
    group.push(model)
    grouped.set(provider, group)
  }
  return Array.from(grouped, ([provider, items]) => ({ provider, models: items }))
}

function getConversationTitle(conversation: Conversation): string {
  return conversation.title.trim() || '新对话'
}

interface ConversationGroup {
  id: string
  label: string
  conversations: Conversation[]
}

function getConversationGroupId(conversation: Conversation, referenceDate: Date): string {
  if (conversation.isPinned) return 'pinned'

  const timestamp = new Date(conversation.lastMessageAt ?? conversation.createdAt)
  if (Number.isNaN(timestamp.getTime())) return 'earlier'

  const referenceDay = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  )
  const conversationDay = new Date(
    timestamp.getFullYear(),
    timestamp.getMonth(),
    timestamp.getDate()
  )
  const elapsedDays = Math.floor((referenceDay.getTime() - conversationDay.getTime()) / 86_400_000)

  if (elapsedDays <= 0) return 'today'
  if (elapsedDays === 1) return 'yesterday'
  if (elapsedDays <= 7) return 'week'
  return 'earlier'
}

function groupConversations(conversations: Conversation[]): ConversationGroup[] {
  const labels: Record<string, string> = {
    pinned: '置顶',
    today: '今天',
    yesterday: '昨天',
    week: '最近 7 天',
    earlier: '更早',
  }
  const groupOrder = ['pinned', 'today', 'yesterday', 'week', 'earlier']
  const groups = new Map<string, Conversation[]>()
  const referenceDate = new Date()

  for (const conversation of conversations) {
    const id = getConversationGroupId(conversation, referenceDate)
    const group = groups.get(id) ?? []
    group.push(conversation)
    groups.set(id, group)
  }

  return groupOrder.flatMap((id) => {
    const group = groups.get(id)
    return group ? [{ id, label: labels[id] ?? id, conversations: group }] : []
  })
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function MarkdownContent({ content }: { content: string }): ReactElement {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
}

function MessageBubble({ message }: { message: Message }): ReactElement {
  const isUser = message.role === Role.User
  return (
    <article
      className={
        isUser ? 'desktop-chat__message desktop-chat__message--user' : 'desktop-chat__message'
      }
    >
      <div className="desktop-chat__message-avatar" aria-hidden="true">
        {isUser ? '我' : <Bot size={17} />}
      </div>
      <div className="desktop-chat__message-body">
        {message.thinkingContent ? (
          <details className="desktop-chat__thinking">
            <summary>思考过程</summary>
            <p>{message.thinkingContent}</p>
          </details>
        ) : null}
        <div className="desktop-chat__markdown">
          <MarkdownContent content={message.content} />
        </div>
        {message.files.length > 0 ? (
          <ul className="desktop-chat__files" aria-label="消息附件">
            {message.files.map((file) => (
              <li key={file.id}>
                <FileText size={14} aria-hidden="true" />
                <span>{file.filename}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  )
}

function StreamingMessage({
  content,
  thinking,
}: {
  content: string
  thinking: string
}): ReactElement {
  return (
    <article className="desktop-chat__message" aria-live="polite">
      <div className="desktop-chat__message-avatar" aria-hidden="true">
        <Bot size={17} />
      </div>
      <div className="desktop-chat__message-body">
        {thinking ? (
          <details className="desktop-chat__thinking" open>
            <summary>正在思考</summary>
            <p>{thinking}</p>
          </details>
        ) : null}
        {content ? (
          <div className="desktop-chat__markdown">
            <MarkdownContent content={content} />
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

interface ConversationItemProps {
  conversation: Conversation
  active: boolean
  renaming: boolean
  renameValue: string
  selectionMode: boolean
  selected: boolean
  onSelect(id: string): void
  onToggleSelection(id: string): void
  onOpenMenu(conversation: Conversation, x: number, y: number): void
  onRenameValueChange(value: string): void
  onRenameSave(conversation: Conversation): void
}

interface ConversationMenuState {
  conversationId: string
  x: number
  y: number
}

interface ConfirmDialogProps {
  confirmLabel?: string
  description: string
  isPending: boolean
  pendingLabel?: string
  title: string
  onCancel(): void
  onConfirm(): void
}

interface ShareDialogProps {
  conversationId: string
  webBaseUrl: string
  onClose(): void
}

/** 将分享链接有效期格式化为当前用户可读的提示。 */
function formatShareExpiry(expiresAt: string | null): string {
  if (!expiresAt) return '永久有效'
  const date = new Date(expiresAt)
  if (Number.isNaN(date.getTime())) return '有效期已更新'
  return `到期于 ${date.toLocaleString('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })}`
}

/** 使用真实分享 API 创建、更新、复制或撤销当前会话的公开只读链接。 */
function ShareDialog({ conversationId, webBaseUrl, onClose }: ShareDialogProps): ReactElement {
  const closeRef = useRef<HTMLButtonElement>(null)
  const shareQuery = useShareLink(conversationId)
  const createShareLink = useCreateShareLink()
  const revokeShareLink = useRevokeShareLink()
  const [expiresInDays, setExpiresInDays] = useState<0 | 1 | 7 | 30>(0)
  const [hasPassword, setHasPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState(false)
  const [isRevokeConfirmationOpen, setIsRevokeConfirmationOpen] = useState(false)

  const shareLink = createShareLink.data ?? shareQuery.data ?? null
  const shareUrl = shareLink ? `${webBaseUrl}/share/${shareLink.shareToken}` : ''
  const isBusy = createShareLink.isPending || revokeShareLink.isPending

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!shareQuery.data) return
    setHasPassword(shareQuery.data.hasPassword)
    if (!shareQuery.data.expiresAt) {
      setExpiresInDays(0)
      return
    }

    const daysRemaining = Math.ceil(
      (new Date(shareQuery.data.expiresAt).getTime() - Date.now()) / 86_400_000
    )
    setExpiresInDays(daysRemaining <= 1 ? 1 : daysRemaining <= 7 ? 7 : 30)
  }, [shareQuery.data])

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    if (event.key !== 'Escape' || isBusy || isRevokeConfirmationOpen) return
    event.preventDefault()
    onClose()
  }

  async function handleSave(): Promise<void> {
    const normalizedPassword = password.trim()
    if (hasPassword && normalizedPassword.length < 4) {
      setNotice('访问密码至少需要 4 位')
      return
    }

    setNotice('')
    try {
      await createShareLink.mutateAsync({
        convId: conversationId,
        opts: {
          expiresInDays: expiresInDays === 0 ? null : expiresInDays,
          password: hasPassword ? normalizedPassword : '',
        },
      })
      setNotice(shareLink ? '分享设置已更新' : '分享链接已生成')
    } catch (error: unknown) {
      setNotice(getErrorMessage(error, '无法生成分享链接，请稍后重试'))
    }
  }

  async function handleCopy(): Promise<void> {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setNotice('链接已复制到剪贴板')
    } catch (error: unknown) {
      setNotice(getErrorMessage(error, '复制失败，请手动复制链接'))
    }
  }

  async function handleRevoke(): Promise<void> {
    try {
      await revokeShareLink.mutateAsync(conversationId)
      setIsRevokeConfirmationOpen(false)
      setCopied(false)
      setNotice('分享链接已撤销')
    } catch (error: unknown) {
      setNotice(getErrorMessage(error, '撤销失败，请稍后重试'))
    }
  }

  return (
    <div
      className="desktop-chat__dialog-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <section
        className="desktop-chat__share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        aria-describedby="share-dialog-description"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="desktop-chat__share-dialog-header">
          <div>
            <h2 id="share-dialog-title">分享此对话</h2>
            <p id="share-dialog-description">生成公开只读链接，可随时撤销。</p>
          </div>
          <button
            ref={closeRef}
            className="desktop-chat__share-close"
            type="button"
            aria-label="关闭分享"
            title="关闭"
            disabled={isBusy}
            onClick={onClose}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="desktop-chat__share-dialog-body">
          {shareQuery.isLoading && !shareLink ? (
            <div className="desktop-chat__share-loading" aria-label="正在加载分享设置">
              <LoaderCircle className="desktop-chat__spin" size={19} />
            </div>
          ) : (
            <>
              <fieldset className="desktop-chat__share-fieldset" disabled={isBusy}>
                <legend>有效期</legend>
                <div className="desktop-chat__share-expiries">
                  {SHARE_EXPIRY_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      className={expiresInDays === option.value ? 'is-selected' : undefined}
                      type="button"
                      aria-pressed={expiresInDays === option.value}
                      onClick={() => setExpiresInDays(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="desktop-chat__share-password">
                <div>
                  <label htmlFor="share-password">访问密码</label>
                  <small>未启用时，获得链接的任何人都可查看。</small>
                </div>
                <button
                  className={
                    hasPassword
                      ? 'desktop-chat__share-toggle is-active'
                      : 'desktop-chat__share-toggle'
                  }
                  type="button"
                  role="switch"
                  aria-label={hasPassword ? '关闭访问密码' : '启用访问密码'}
                  aria-checked={hasPassword}
                  disabled={isBusy}
                  onClick={() => {
                    setHasPassword((value) => !value)
                    setPassword('')
                    setIsPasswordVisible(false)
                  }}
                >
                  <span aria-hidden="true" />
                </button>
              </div>
              {hasPassword ? (
                <label className="desktop-chat__share-password-input" htmlFor="share-password">
                  <Lock size={15} aria-hidden="true" />
                  <input
                    id="share-password"
                    type={isPasswordVisible ? 'text' : 'password'}
                    minLength={4}
                    maxLength={40}
                    value={password}
                    placeholder="设置 4 位以上密码"
                    disabled={isBusy}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    className="desktop-chat__share-password-visibility"
                    type="button"
                    aria-label={isPasswordVisible ? '隐藏访问密码' : '显示访问密码'}
                    title={isPasswordVisible ? '隐藏访问密码' : '显示访问密码'}
                    disabled={isBusy}
                    onClick={() => setIsPasswordVisible((value) => !value)}
                  >
                    {isPasswordVisible ? (
                      <EyeOff size={16} aria-hidden="true" />
                    ) : (
                      <Eye size={16} aria-hidden="true" />
                    )}
                  </button>
                </label>
              ) : null}

              {shareLink ? (
                <div className="desktop-chat__share-link">
                  <label htmlFor="share-link">分享链接</label>
                  <div>
                    <Link size={15} aria-hidden="true" />
                    <input
                      id="share-link"
                      value={shareUrl}
                      readOnly
                      onFocus={(event) => event.target.select()}
                    />
                    <button
                      type="button"
                      aria-label="复制分享链接"
                      title="复制链接"
                      disabled={isBusy}
                      onClick={() => void handleCopy()}
                    >
                      {copied ? (
                        <Check size={16} aria-hidden="true" />
                      ) : (
                        <Copy size={16} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  <small>{formatShareExpiry(shareLink.expiresAt)}</small>
                </div>
              ) : null}
            </>
          )}
        </div>

        {notice ? (
          <p className="desktop-chat__share-notice" role="status">
            {notice}
          </p>
        ) : null}
        <footer className="desktop-chat__share-dialog-actions">
          {shareLink ? (
            <button
              className="desktop-chat__share-revoke"
              type="button"
              disabled={isBusy}
              onClick={() => setIsRevokeConfirmationOpen(true)}
            >
              撤销分享
            </button>
          ) : null}
          <button type="button" disabled={isBusy} onClick={onClose}>
            关闭
          </button>
          <button
            className="desktop-chat__share-save"
            type="button"
            disabled={isBusy || shareQuery.isLoading}
            onClick={() => void handleSave()}
          >
            {isBusy ? '处理中...' : shareLink ? '更新设置' : '生成分享链接'}
          </button>
        </footer>
      </section>
      {isRevokeConfirmationOpen ? (
        <ConfirmDialog
          title="撤销分享链接？"
          description="撤销后，当前公开链接将立即失效。"
          confirmLabel="撤销"
          isPending={revokeShareLink.isPending}
          pendingLabel="撤销中..."
          onCancel={() => setIsRevokeConfirmationOpen(false)}
          onConfirm={() => void handleRevoke()}
        />
      ) : null}
    </div>
  )
}

function ConfirmDialog({
  confirmLabel = '删除',
  description,
  isPending,
  pendingLabel = '删除中...',
  title,
  onCancel,
  onConfirm,
}: ConfirmDialogProps): ReactElement {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
    return () => previouslyFocused?.focus()
  }, [])

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape' && !isPending) {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') return

    const first = cancelRef.current
    const last = confirmRef.current
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="desktop-chat__dialog-backdrop">
      <div
        className="desktop-chat__confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-conversation-title"
        aria-describedby="delete-conversation-description"
        onKeyDown={handleKeyDown}
      >
        <div className="desktop-chat__confirm-dialog-copy">
          <h2 id="delete-conversation-title">{title}</h2>
          <p id="delete-conversation-description">{description}</p>
        </div>
        <div className="desktop-chat__confirm-dialog-actions">
          <button ref={cancelRef} type="button" disabled={isPending} onClick={onCancel}>
            取消
          </button>
          <button
            ref={confirmRef}
            className="desktop-chat__confirm-dialog-delete"
            type="button"
            disabled={isPending}
            onClick={onConfirm}
          >
            {isPending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function ConversationItem({
  conversation,
  active,
  renaming,
  renameValue,
  selectionMode,
  selected,
  onSelect,
  onToggleSelection,
  onOpenMenu,
  onRenameValueChange,
  onRenameSave,
}: ConversationItemProps): ReactElement {
  return (
    <li
      className={
        active && selected
          ? 'desktop-chat__conversation desktop-chat__conversation--active desktop-chat__conversation--selected'
          : active
            ? 'desktop-chat__conversation desktop-chat__conversation--active'
            : selected
              ? 'desktop-chat__conversation desktop-chat__conversation--selected'
              : 'desktop-chat__conversation'
      }
      onContextMenu={
        renaming
          ? undefined
          : (event) => {
              event.preventDefault()
              onOpenMenu(conversation, event.clientX, event.clientY)
            }
      }
    >
      {renaming ? (
        <form
          className="desktop-chat__conversation-rename"
          onSubmit={(event) => {
            event.preventDefault()
            onRenameSave(conversation)
          }}
        >
          <input
            aria-label="会话标题"
            autoFocus
            value={renameValue}
            onChange={(event) => onRenameValueChange(event.target.value)}
            onBlur={() => onRenameSave(conversation)}
          />
        </form>
      ) : (
        <button
          className="desktop-chat__conversation-select"
          type="button"
          aria-current={active ? 'page' : undefined}
          aria-pressed={selectionMode ? selected : undefined}
          onClick={() => {
            if (selectionMode) {
              onToggleSelection(conversation.id)
              return
            }
            onSelect(conversation.id)
          }}
        >
          {selectionMode ? (
            <span className="desktop-chat__conversation-checkbox" aria-hidden="true">
              {selected ? <Check size={13} strokeWidth={3} /> : null}
            </span>
          ) : null}
          <span className="desktop-chat__conversation-avatar" aria-hidden="true">
            {getConversationTitle(conversation).slice(0, 1).toLocaleUpperCase()}
          </span>
          <span>{getConversationTitle(conversation)}</span>
        </button>
      )}
      {!renaming && !selectionMode ? (
        <div className="desktop-chat__conversation-actions">
          <button
            type="button"
            title="更多会话操作"
            aria-label="更多会话操作"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              onOpenMenu(conversation, rect.right, rect.bottom + 4)
            }}
          >
            <MoreVertical size={15} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </li>
  )
}

/** 提供桌面端的会话列表、消息历史和 SSE 流式聊天体验。 */
export function App(): ReactElement {
  const conversationsQuery = useConversations()
  const createConversation = useCreateConversation()
  const deleteConversation = useDeleteConversation()
  const deleteConversations = useDeleteConversations()
  const updateConversation = useUpdateConversation()
  const modelsQuery = useModels()
  const stream = useStream()
  const user = useAuthStore((state) => state.user)
  const isLoggedIn = user !== null
  const setTheme = usePrefsStore((state) => state.setTheme)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [isTemporaryConversation, setIsTemporaryConversation] = useState(false)
  const [temporaryMessages, setTemporaryMessages] = useState<Message[]>([])
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const [isWebSearchEnabled, setIsWebSearchEnabled] = useState(true)
  const [isThinkingEnabled, setIsThinkingEnabled] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState(FALLBACK_MODEL.id)
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false)
  const [search, setSearch] = useState('')
  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(
    () => new Set()
  )
  const [conversationMenu, setConversationMenu] = useState<ConversationMenuState | null>(null)
  const [conversationPendingDeletion, setConversationPendingDeletion] =
    useState<Conversation | null>(null)
  const [isBatchDeleteConfirmationOpen, setIsBatchDeleteConfirmationOpen] = useState(false)
  const [shareDialog, setShareDialog] = useState<{
    conversationId: string
    webBaseUrl: string
  } | null>(null)
  const [actionError, setActionError] = useState('')
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const [isDarkTheme, setIsDarkTheme] = useState(
    () => document.documentElement.getAttribute('data-theme') === 'dark'
  )
  const messageEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  const accountMenuRef = useRef<HTMLDivElement>(null)

  const conversations = isLoggedIn
    ? (conversationsQuery.data ?? EMPTY_CONVERSATIONS)
    : EMPTY_CONVERSATIONS
  const availableModels = modelsQuery.data?.length ? modelsQuery.data : DEFAULT_MODELS
  const modelGroups = useMemo(() => groupModelsByProvider(availableModels), [availableModels])
  const selectedModel =
    availableModels.find((model) => model.id === selectedModelId) ??
    availableModels.find((model) => model.isDefault) ??
    FALLBACK_MODEL
  const messagesQuery = useMessages(
    isLoggedIn && !isTemporaryConversation ? (activeConversationId ?? '') : ''
  )
  const messages = isTemporaryConversation
    ? temporaryMessages
    : isLoggedIn
      ? (messagesQuery.data ?? EMPTY_MESSAGES)
      : EMPTY_MESSAGES
  const streamingConversationId = useChatStore((state) => state.streamingConvId)
  const streamingContent = useChatStore((state) => state.streamingContent)
  const streamingThinking = useChatStore((state) => state.streamingThink)
  const optimisticUserMessage = useChatStore((state) => state.optimisticUserMsg)
  const isStreaming =
    streamingConversationId !== null &&
    streamingConversationId === (isTemporaryConversation ? TEMPORARY_CONV_ID : activeConversationId)
  const activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ?? null
  const visibleConversations = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    if (!normalizedSearch) return conversations
    return conversations.filter((conversation) =>
      getConversationTitle(conversation).toLocaleLowerCase().includes(normalizedSearch)
    )
  }, [conversations, search])
  const groupedConversations = useMemo(
    () => groupConversations(visibleConversations),
    [visibleConversations]
  )
  const contextMenuConversation = conversationMenu
    ? (conversations.find((conversation) => conversation.id === conversationMenu.conversationId) ??
      null)
    : null
  const userInitial = user?.username.slice(0, 1).toLocaleUpperCase() || '?'

  useEffect(() => {
    if (isLoggedIn) return
    setActiveConversationId(null)
    setRenamingConversationId(null)
    setIsSelectionMode(false)
    setSelectedConversationIds(new Set())
    setConversationMenu(null)
    setSearch('')
  }, [isLoggedIn])

  useEffect(() => {
    if (!conversationMenu) return
    const handlePointerDown = (event: PointerEvent): void => {
      if (
        event.target instanceof Element &&
        event.target.closest('.desktop-chat__conversation-menu')
      ) {
        return
      }
      setConversationMenu(null)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setConversationMenu(null)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [conversationMenu])
  const userName = user?.username ?? '登录'
  const userEmail = user?.email ?? ''

  useEffect(() => {
    if (isTemporaryConversation) return
    if (
      activeConversationId &&
      conversations.some((conversation) => conversation.id === activeConversationId)
    ) {
      return
    }
    setActiveConversationId(conversations[0]?.id ?? null)
  }, [activeConversationId, conversations, isTemporaryConversation])

  useEffect(() => {
    if (availableModels.some((model) => model.id === selectedModelId)) return
    setSelectedModelId(availableModels[0]?.id ?? FALLBACK_MODEL.id)
  }, [availableModels, selectedModelId])

  useEffect(() => {
    if (!messageEndRef.current?.scrollIntoView) return
    messageEndRef.current.scrollIntoView({ block: 'end' })
  }, [activeConversationId, messages, optimisticUserMessage, streamingContent, streamingThinking])

  useEffect(() => {
    const input = composerInputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 36), 200)}px`
  }, [draft])

  useEffect(() => {
    if (!isAccountMenuOpen) return
    const handlePointerDown = (event: MouseEvent): void => {
      if (event.target instanceof Node && accountMenuRef.current?.contains(event.target)) return
      setIsAccountMenuOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [isAccountMenuOpen])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsModelMenuOpen(false)
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'n') {
        event.preventDefault()
        void handleCreateConversation()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  })

  async function handleCreateConversation(): Promise<void> {
    if (!isLoggedIn || createConversation.isPending || isStreaming) return
    if (isTemporaryConversation) {
      setTemporaryMessages([])
      setDraft('')
      return
    }
    setActionError('')
    try {
      const conversation = await createConversation.mutateAsync({
        model: selectedModel.id,
        title: '新对话',
      })
      setActiveConversationId(conversation.id)
      setDraft('')
    } catch (error: unknown) {
      setActionError(getErrorMessage(error, '无法创建会话，请稍后重试'))
    }
  }

  /** 切换临时会话；临时消息仅在当前 renderer 的内存中存活。 */
  function handleToggleTemporaryConversation(): void {
    if (isStreaming) return
    setIsTemporaryConversation((value) => !value)
    setTemporaryMessages([])
    setAttachments([])
    setDraft('')
    setActionError('')
    setShareDialog(null)
  }

  async function handleOpenSettings(): Promise<void> {
    try {
      await window.yuanai.window.openSettings()
    } catch (error: unknown) {
      setActionError(getErrorMessage(error, '无法打开设置，请稍后重试'))
    }
  }

  async function handleOpenAccount(): Promise<void> {
    if (user) {
      await handleOpenSettings()
      return
    }
    try {
      await window.yuanai.window.openLogin()
    } catch (error: unknown) {
      setActionError(getErrorMessage(error, '无法打开登录窗口，请稍后重试'))
    }
  }

  async function handleOpenShareDialog(): Promise<void> {
    if (!activeConversation) return
    setActionError('')
    try {
      const config = await window.yuanai.runtime.getConfig()
      setShareDialog({ conversationId: activeConversation.id, webBaseUrl: config.webBaseUrl })
    } catch (error: unknown) {
      setActionError(getErrorMessage(error, '无法打开分享，请稍后重试'))
    }
  }

  function handleToggleTheme(): void {
    const nextTheme = isDarkTheme ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', nextTheme)
    setTheme(nextTheme)
    setIsDarkTheme(nextTheme === 'dark')
  }

  function handleSelectConversation(conversationId: string): void {
    if (isStreaming) return
    const conversation = conversations.find((item) => item.id === conversationId)
    setActionError('')
    if (isTemporaryConversation) {
      setIsTemporaryConversation(false)
      setTemporaryMessages([])
    }
    setActiveConversationId(conversationId)
    if (conversation && availableModels.some((model) => model.id === conversation.model)) {
      setSelectedModelId(conversation.model)
    }
  }

  function handleSelectModel(modelId: string): void {
    setSelectedModelId(modelId)
    setIsModelMenuOpen(false)
  }

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>): void {
    if (isTemporaryConversation) return
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return
    setAttachments((items) => [
      ...items,
      ...files.map((file) => ({
        id: `${file.name}-${file.lastModified}-${file.size}-${Math.random().toString(36).slice(2)}`,
        file,
        progress: 0,
        status: 'ready' as const,
      })),
    ])
    event.target.value = ''
  }

  function removeAttachment(id: string): void {
    if (isUploadingAttachments) return
    setAttachments((items) => items.filter((item) => item.id !== id))
  }

  async function resolveAttachmentIds(): Promise<string[]> {
    return Promise.all(
      attachments.map(async (attachment) => {
        if (attachment.fileId) return attachment.fileId
        setAttachments((items) =>
          items.map((item) =>
            item.id === attachment.id
              ? { ...item, progress: 0, status: 'uploading' as const }
              : item
          )
        )
        try {
          const fileRef = await uploadFileSmart(attachment.file, {
            onProgress: (snapshot) => {
              setAttachments((items) =>
                items.map((item) =>
                  item.id === attachment.id
                    ? {
                        ...item,
                        progress: snapshot.percent,
                        status: snapshot.status === 'done' ? 'done' : 'uploading',
                      }
                    : item
                )
              )
            },
          })
          setAttachments((items) =>
            items.map((item) =>
              item.id === attachment.id
                ? { ...item, fileId: fileRef.id, progress: 100, status: 'done' as const }
                : item
            )
          )
          return fileRef.id
        } catch (error: unknown) {
          setAttachments((items) =>
            items.map((item) =>
              item.id === attachment.id ? { ...item, status: 'error' as const } : item
            )
          )
          throw error
        }
      })
    )
  }

  function handleStartRename(conversation: Conversation): void {
    setConversationMenu(null)
    setRenamingConversationId(conversation.id)
    setRenameValue(getConversationTitle(conversation))
  }

  /** 打开会话操作菜单，并确保菜单不会超出当前窗口。 */
  function handleOpenConversationMenu(conversation: Conversation, x: number, y: number): void {
    const menuWidth = 184
    const menuHeight = 176
    setConversationMenu({
      conversationId: conversation.id,
      x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
    })
  }

  /** 在多选模式中切换单个会话的选择状态。 */
  function handleToggleConversationSelection(conversationId: string): void {
    setSelectedConversationIds((current) => {
      const next = new Set(current)
      if (next.has(conversationId)) next.delete(conversationId)
      else next.add(conversationId)
      return next
    })
  }

  /** 从会话菜单进入多选模式，并默认选择发起操作的会话。 */
  function handleEnterSelectionMode(conversationId: string): void {
    setConversationMenu(null)
    setIsSelectionMode(true)
    setSelectedConversationIds(new Set([conversationId]))
  }

  /** 退出多选模式并丢弃当前选择。 */
  function handleExitSelectionMode(): void {
    setIsSelectionMode(false)
    setSelectedConversationIds(new Set())
  }

  /** 全选或取消全选当前账号的全部会话。 */
  function handleToggleAllConversations(): void {
    if (selectedConversationIds.size === conversations.length) {
      setSelectedConversationIds(new Set())
      return
    }
    setSelectedConversationIds(new Set(conversations.map((conversation) => conversation.id)))
  }

  /** 通过真实会话更新 API 切换置顶状态。 */
  async function handleToggleConversationPin(conversation: Conversation): Promise<void> {
    setConversationMenu(null)
    setActionError('')
    try {
      await updateConversation.mutateAsync({
        id: conversation.id,
        isPinned: !conversation.isPinned,
      })
    } catch (error: unknown) {
      setActionError(getErrorMessage(error, '无法更新会话置顶状态，请稍后重试'))
    }
  }

  async function handleSaveRename(conversation: Conversation): Promise<void> {
    const title = renameValue.trim()
    setRenamingConversationId(null)
    if (!title || title === getConversationTitle(conversation)) return
    setActionError('')
    try {
      await updateConversation.mutateAsync({ id: conversation.id, title })
    } catch (error: unknown) {
      setActionError(getErrorMessage(error, '无法重命名会话，请稍后重试'))
    }
  }

  function handleRequestRemoveConversation(conversation: Conversation): void {
    if (isStreaming || deleteConversation.isPending) return
    setConversationPendingDeletion(conversation)
  }

  async function handleConfirmRemoveConversation(): Promise<void> {
    const conversation = conversationPendingDeletion
    if (!conversation || deleteConversation.isPending) return
    const position = conversations.findIndex((item) => item.id === conversation.id)
    const replacement = conversations[position + 1] ?? conversations[position - 1] ?? null
    setActionError('')
    try {
      await deleteConversation.mutateAsync(conversation.id)
      if (activeConversationId === conversation.id) {
        setActiveConversationId(replacement?.id ?? null)
      }
    } catch (error: unknown) {
      setActionError(getErrorMessage(error, '无法删除会话，请稍后重试'))
    } finally {
      setConversationPendingDeletion(null)
    }
  }

  /** 批量删除已选择的会话，并将活跃会话切换到仍存在的相邻项。 */
  async function handleConfirmBatchRemoveConversations(): Promise<void> {
    const selectedIds = Array.from(selectedConversationIds)
    if (!selectedIds.length || deleteConversations.isPending) return
    const selectedIdSet = new Set(selectedIds)
    const replacement = conversations.find((conversation) => !selectedIdSet.has(conversation.id))
    setActionError('')
    try {
      await deleteConversations.mutateAsync(selectedIds)
      if (activeConversationId && selectedIdSet.has(activeConversationId)) {
        setActiveConversationId(replacement?.id ?? null)
      }
      handleExitSelectionMode()
    } catch (error: unknown) {
      setActionError(getErrorMessage(error, '无法删除所选会话，请稍后重试'))
    } finally {
      setIsBatchDeleteConfirmationOpen(false)
    }
  }

  async function handleSendMessage(event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault()
    const content = draft.trim()
    if (!isLoggedIn || !content || isStreaming || isUploadingAttachments) return
    setActionError('')
    if (isTemporaryConversation) {
      const history = temporaryMessages.map((message) => ({
        role: message.role === Role.User ? ('user' as const) : ('assistant' as const),
        content: message.content,
      }))
      const createdAt = new Date().toISOString()
      setTemporaryMessages((items) => [
        ...items,
        {
          id: `temporary-user-${Date.now()}`,
          role: Role.User,
          content,
          files: [],
          createdAt,
        },
      ])
      setDraft('')
      try {
        await stream.sendTemporary({
          content,
          history,
          model: selectedModel.id,
          enableThinking: isThinkingEnabled,
          onEnd: ({ content: response, think }) => {
            if (!response && !think) return
            setTemporaryMessages((items) => [
              ...items,
              {
                id: `temporary-assistant-${Date.now()}`,
                role: Role.Assistant,
                content: response,
                ...(think ? { thinkingContent: think } : {}),
                files: [],
                createdAt: new Date().toISOString(),
              },
            ])
          },
          onError: (error) => setActionError(getErrorMessage(error, '临时消息发送失败，请重试')),
        })
      } catch (error: unknown) {
        setActionError(getErrorMessage(error, '临时消息发送失败，请重试'))
      }
      return
    }
    let conversationId = activeConversationId
    try {
      if (!conversationId) {
        const conversation = await createConversation.mutateAsync({
          model: selectedModel.id,
          title: content.slice(0, 30),
        })
        conversationId = conversation.id
        setActiveConversationId(conversationId)
      }
      setIsUploadingAttachments(true)
      const fileIds = await resolveAttachmentIds()
      await stream.send({
        convId: conversationId,
        content,
        enableThinking: isThinkingEnabled,
        fileIds,
        model: selectedModel.id,
        onError: (error) => setActionError(getErrorMessage(error, '消息发送失败，请重试')),
      })
      setAttachments([])
      setDraft('')
    } catch (error: unknown) {
      setActionError(getErrorMessage(error, '消息发送失败，请重试'))
    } finally {
      setIsUploadingAttachments(false)
    }
  }

  return (
    <main
      className={
        isSidebarCollapsed ? 'desktop-chat desktop-chat--sidebar-collapsed' : 'desktop-chat'
      }
      aria-label="元AI 聊天"
    >
      <aside className="desktop-chat__sidebar" aria-label="会话列表">
        <div className="desktop-chat__sidebar-header">
          <div className="desktop-chat__brand">
            <span aria-hidden="true">元</span>
            <strong>元AI</strong>
          </div>
          <div className="desktop-chat__quick-actions" aria-label="新建操作">
            <button
              className={isTemporaryConversation ? 'is-active' : undefined}
              type="button"
              aria-label={isTemporaryConversation ? '退出临时对话' : '开启临时对话'}
              title={isTemporaryConversation ? '退出临时对话' : '开启临时对话'}
              aria-pressed={isTemporaryConversation}
              disabled={isStreaming}
              onClick={handleToggleTemporaryConversation}
            >
              <Ghost size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="新建会话"
              title="新建会话"
              disabled={!isLoggedIn || createConversation.isPending || isStreaming}
              onClick={() => void handleCreateConversation()}
            >
              {createConversation.isPending ? (
                <LoaderCircle className="desktop-chat__spin" size={16} />
              ) : (
                <Pencil size={16} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
        <label className="desktop-chat__search">
          <span className="desktop-chat__sr-only">搜索会话</span>
          <input
            type="search"
            value={search}
            placeholder="搜索会话"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {isSelectionMode ? (
          <div className="desktop-chat__selection-toolbar" role="toolbar" aria-label="批量选择会话">
            <button
              type="button"
              disabled={conversations.length === 0}
              onClick={handleToggleAllConversations}
            >
              {selectedConversationIds.size === conversations.length ? '取消全选' : '全选'}
            </button>
            <span>已选择 {selectedConversationIds.size} 项</span>
            <button
              className="desktop-chat__selection-delete"
              type="button"
              disabled={
                selectedConversationIds.size === 0 || isStreaming || deleteConversations.isPending
              }
              onClick={() => setIsBatchDeleteConfirmationOpen(true)}
            >
              删除已选
            </button>
            <button
              type="button"
              disabled={deleteConversations.isPending}
              onClick={handleExitSelectionMode}
            >
              取消
            </button>
          </div>
        ) : null}
        <nav className="desktop-chat__conversation-nav" aria-label="最近会话">
          {isLoggedIn && conversationsQuery.isLoading ? (
            <div className="desktop-chat__sidebar-state">
              <LoaderCircle className="desktop-chat__spin" size={18} />
            </div>
          ) : groupedConversations.length > 0 ? (
            <>
              {groupedConversations.map((group) => (
                <section key={group.id} className="desktop-chat__conversation-group">
                  <h2>{group.label}</h2>
                  <ul>
                    {group.conversations.map((conversation) => (
                      <ConversationItem
                        key={conversation.id}
                        conversation={conversation}
                        active={conversation.id === activeConversationId}
                        renaming={conversation.id === renamingConversationId}
                        renameValue={renameValue}
                        selectionMode={isSelectionMode}
                        selected={selectedConversationIds.has(conversation.id)}
                        onSelect={handleSelectConversation}
                        onToggleSelection={handleToggleConversationSelection}
                        onOpenMenu={handleOpenConversationMenu}
                        onRenameValueChange={setRenameValue}
                        onRenameSave={(item) => void handleSaveRename(item)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </>
          ) : (
            <p className="desktop-chat__sidebar-state">
              {isLoggedIn ? (search ? '未找到会话' : '还没有会话') : '暂无会话'}
            </p>
          )}
        </nav>
        <div ref={accountMenuRef} className="desktop-chat__account" aria-label="当前账户">
          <button
            className="desktop-chat__account-trigger"
            type="button"
            aria-label={user ? '打开个人设置' : '打开登录窗口'}
            onClick={() => void handleOpenAccount()}
          >
            <span className="desktop-chat__account-avatar" aria-hidden="true">
              {userInitial}
            </span>
            <span className="desktop-chat__account-info">
              <strong>{userName}</strong>
              <small>{userEmail}</small>
            </span>
          </button>
          <button
            className="desktop-chat__account-settings"
            type="button"
            aria-label={user ? '打开设置' : '打开快捷设置'}
            title={user ? '打开设置' : '打开快捷设置'}
            aria-expanded={user ? undefined : isAccountMenuOpen}
            aria-haspopup={user ? undefined : 'menu'}
            onClick={() => {
              if (user) {
                void handleOpenSettings()
                return
              }
              setIsAccountMenuOpen((value) => !value)
            }}
          >
            <Settings size={15} aria-hidden="true" />
          </button>
          {!user && isAccountMenuOpen ? (
            <div className="desktop-chat__account-menu" role="menu" aria-label="快捷设置">
              <button
                className="desktop-chat__account-menu-theme"
                type="button"
                role="menuitem"
                aria-label="切换深色模式"
                aria-pressed={isDarkTheme}
                onClick={handleToggleTheme}
              >
                <span>深色模式</span>
                <span
                  className={
                    isDarkTheme
                      ? 'desktop-chat__account-theme-toggle is-active'
                      : 'desktop-chat__account-theme-toggle'
                  }
                  aria-hidden="true"
                />
              </button>
              <div className="desktop-chat__account-menu-separator" />
              <button
                className="desktop-chat__account-menu-login"
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsAccountMenuOpen(false)
                  void handleOpenAccount()
                }}
              >
                <LogIn size={16} aria-hidden="true" />
                去登录
              </button>
            </div>
          ) : null}
        </div>
      </aside>

      <section className="desktop-chat__workspace">
        <header className="desktop-chat__header">
          <div className="desktop-chat__header-side">
            <h1 className="desktop-chat__sr-only">
              {isTemporaryConversation
                ? '临时对话'
                : activeConversation
                  ? getConversationTitle(activeConversation)
                  : '开始新对话'}
            </h1>
            <button
              className="desktop-chat__header-action"
              type="button"
              aria-label={isSidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
              title={isSidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
              onClick={() => setIsSidebarCollapsed((value) => !value)}
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen size={17} aria-hidden="true" />
              ) : (
                <PanelLeftClose size={17} aria-hidden="true" />
              )}
            </button>
          </div>
          <button
            className="desktop-chat__model-trigger"
            type="button"
            aria-label={`选择模型：${selectedModel.name}`}
            aria-expanded={isModelMenuOpen}
            aria-haspopup="listbox"
            onClick={() => setIsModelMenuOpen((value) => !value)}
          >
            <span className="desktop-chat__model-mark" aria-hidden="true">
              {getModelInitial(selectedModel)}
            </span>
            <span className="desktop-chat__model-trigger-label">{selectedModel.name}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          <div className="desktop-chat__header-side desktop-chat__header-side--end">
            <button
              className="desktop-chat__header-action"
              type="button"
              aria-label="分享对话"
              title="分享对话"
              disabled={!activeConversation || isTemporaryConversation}
              onClick={() => void handleOpenShareDialog()}
            >
              <Share2 size={17} aria-hidden="true" />
            </button>
          </div>
        </header>

        {isModelMenuOpen ? (
          <>
            <button
              className="desktop-chat__model-dismiss"
              type="button"
              aria-label="关闭模型选择"
              onClick={() => setIsModelMenuOpen(false)}
            />
            <div className="desktop-chat__model-menu" role="listbox" aria-label="选择模型">
              {modelGroups.map(({ provider, models }) => (
                <section key={provider} className="desktop-chat__model-menu-group">
                  <h2>{provider}</h2>
                  {models.map((model) => {
                    const selected = model.id === selectedModel.id
                    return (
                      <button
                        key={model.id}
                        className={selected ? 'is-selected' : undefined}
                        type="button"
                        role="option"
                        aria-label={`选择 ${model.name}`}
                        aria-selected={selected}
                        onClick={() => handleSelectModel(model.id)}
                      >
                        <span className="desktop-chat__model-menu-mark" aria-hidden="true">
                          {getModelInitial(model)}
                        </span>
                        <span className="desktop-chat__model-menu-copy">
                          <strong>{model.name}</strong>
                          <small>{model.description || model.provider}</small>
                        </span>
                        <span className="desktop-chat__model-menu-context">
                          {formatContextLength(model.contextLength)}
                        </span>
                        {selected ? <Check size={16} aria-hidden="true" /> : null}
                      </button>
                    )
                  })}
                </section>
              ))}
            </div>
          </>
        ) : null}

        {actionError ? (
          <p className="desktop-chat__alert" role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            {actionError}
          </p>
        ) : null}

        {isTemporaryConversation ? (
          <div className="desktop-chat__temporary-banner" role="status">
            <Ghost size={15} aria-hidden="true" />
            <span>临时对话不会保存到历史记录。</span>
            <button
              type="button"
              aria-label="退出临时对话模式"
              disabled={isStreaming}
              onClick={handleToggleTemporaryConversation}
            >
              退出
            </button>
          </div>
        ) : null}

        <div className="desktop-chat__messages" aria-busy={messagesQuery.isLoading}>
          {messagesQuery.isLoading && activeConversationId && !isTemporaryConversation ? (
            <div className="desktop-chat__messages-loading">
              <LoaderCircle className="desktop-chat__spin" size={22} />
            </div>
          ) : messages.length || isStreaming ? (
            <div className="desktop-chat__message-list">
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              {isStreaming && optimisticUserMessage && !isTemporaryConversation ? (
                <article className="desktop-chat__message desktop-chat__message--user">
                  <div className="desktop-chat__message-avatar" aria-hidden="true">
                    我
                  </div>
                  <div className="desktop-chat__message-body">
                    <div className="desktop-chat__markdown">
                      <p>{optimisticUserMessage}</p>
                    </div>
                  </div>
                </article>
              ) : null}
              {isStreaming ? (
                <StreamingMessage content={streamingContent} thinking={streamingThinking} />
              ) : null}
              <div ref={messageEndRef} />
            </div>
          ) : (
            <section className="desktop-chat__empty-state" aria-label="开始新对话">
              <div className="desktop-chat__empty-icon" aria-hidden="true">
                元
              </div>
              <div className="desktop-chat__empty-copy">
                <h2>你好，我是元AI</h2>
                <p>集成多款顶尖 AI 模型，帮你完成任何任务</p>
              </div>
              <div className="desktop-chat__capabilities" aria-label="可用能力">
                {CAPABILITIES.map(({ icon: Icon, label, prompt }) => (
                  <button
                    key={label}
                    type="button"
                    aria-label={`快捷提示：${label}`}
                    onClick={() => setDraft(prompt)}
                  >
                    <Icon size={14} aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </div>
              <div className="desktop-chat__suggestions">
                {SUGGESTIONS.map(({ description, icon: Icon, prompt, title }) => (
                  <button
                    key={title}
                    type="button"
                    aria-label={title}
                    onClick={() => setDraft(prompt)}
                  >
                    <Icon size={17} aria-hidden="true" />
                    <span>
                      <strong>{title}</strong>
                      <small>{description}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        <form
          className="desktop-chat__composer"
          onSubmit={(event) => void handleSendMessage(event)}
        >
          {attachments.length > 0 ? (
            <ul className="desktop-chat__attachment-list" aria-label="待发送附件">
              {attachments.map((attachment) => (
                <li key={attachment.id}>
                  <FileText size={14} aria-hidden="true" />
                  <span>{attachment.file.name}</span>
                  {attachment.status === 'uploading' ? <small>{attachment.progress}%</small> : null}
                  {attachment.status === 'error' ? <small>上传失败</small> : null}
                  <button
                    type="button"
                    aria-label={`移除附件 ${attachment.file.name}`}
                    title="移除附件"
                    disabled={isUploadingAttachments}
                    onClick={() => removeAttachment(attachment.id)}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <textarea
            ref={composerInputRef}
            aria-label="输入消息"
            rows={1}
            value={draft}
            placeholder={isLoggedIn ? '发送消息' : '请先登录，开始与 AI 对话'}
            disabled={!isLoggedIn || isStreaming || isUploadingAttachments}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void handleSendMessage()
              }
            }}
          />
          <div className="desktop-chat__composer-toolbar">
            <div className="desktop-chat__composer-tools">
              <input
                ref={fileInputRef}
                className="desktop-chat__sr-only"
                data-testid="attachment-input"
                type="file"
                multiple
                disabled={isTemporaryConversation}
                onChange={handleAttachmentChange}
              />
              <button
                className={attachments.length > 0 ? 'is-active' : undefined}
                type="button"
                aria-label="添加附件"
                title={isTemporaryConversation ? '临时对话不支持附件' : '添加附件'}
                disabled={
                  !isLoggedIn || isTemporaryConversation || isStreaming || isUploadingAttachments
                }
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={18} aria-hidden="true" />
              </button>
              <button type="button" aria-label="语音输入" title="语音输入暂未开放" disabled>
                <Mic size={18} aria-hidden="true" />
              </button>
              <button
                className={isWebSearchEnabled ? 'is-active' : undefined}
                type="button"
                aria-label="联网搜索"
                title="联网搜索"
                aria-pressed={isWebSearchEnabled}
                disabled={!isLoggedIn || isStreaming || isUploadingAttachments}
                onClick={() => setIsWebSearchEnabled((value) => !value)}
              >
                <Globe2 size={18} aria-hidden="true" />
              </button>
              <button
                className={isThinkingEnabled ? 'is-active' : undefined}
                type="button"
                aria-label={isThinkingEnabled ? '关闭思考过程' : '开启思考过程'}
                title={isThinkingEnabled ? '关闭思考过程' : '开启思考过程'}
                aria-pressed={isThinkingEnabled}
                disabled={!isLoggedIn || isStreaming || isUploadingAttachments}
                onClick={() => setIsThinkingEnabled((value) => !value)}
              >
                <Brain size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="desktop-chat__composer-actions">
              <button
                className="desktop-chat__composer-model"
                type="button"
                aria-label={`切换输入模型：${selectedModel.name}`}
                aria-expanded={isModelMenuOpen}
                aria-haspopup="listbox"
                onClick={() => setIsModelMenuOpen((value) => !value)}
              >
                <span aria-hidden="true">{getModelInitial(selectedModel)}</span>
                {selectedModel.name}
                <ChevronDown size={13} aria-hidden="true" />
              </button>
              {isStreaming ? (
                <button
                  className="desktop-chat__stop"
                  type="button"
                  aria-label="停止生成"
                  title="停止生成"
                  onClick={stream.stop}
                >
                  <Square size={16} fill="currentColor" />
                </button>
              ) : (
                <button
                  className="desktop-chat__send"
                  type="submit"
                  aria-label="发送消息"
                  title="发送消息"
                  disabled={!isLoggedIn || !draft.trim() || isUploadingAttachments}
                >
                  {isUploadingAttachments ? (
                    <LoaderCircle className="desktop-chat__spin" size={17} />
                  ) : (
                    <SendHorizontal size={18} />
                  )}
                </button>
              )}
            </div>
          </div>
        </form>
      </section>
      {conversationPendingDeletion ? (
        <ConfirmDialog
          title="删除会话？"
          description={`“${getConversationTitle(conversationPendingDeletion)}”及其中的消息将被永久删除。`}
          isPending={deleteConversation.isPending}
          onCancel={() => setConversationPendingDeletion(null)}
          onConfirm={() => void handleConfirmRemoveConversation()}
        />
      ) : null}
      {isBatchDeleteConfirmationOpen ? (
        <ConfirmDialog
          title={`删除 ${selectedConversationIds.size} 个会话？`}
          description={`所选 ${selectedConversationIds.size} 个会话及其中的消息将被永久删除。`}
          isPending={deleteConversations.isPending}
          pendingLabel="删除中..."
          onCancel={() => setIsBatchDeleteConfirmationOpen(false)}
          onConfirm={() => void handleConfirmBatchRemoveConversations()}
        />
      ) : null}
      {shareDialog ? (
        <ShareDialog
          conversationId={shareDialog.conversationId}
          webBaseUrl={shareDialog.webBaseUrl}
          onClose={() => setShareDialog(null)}
        />
      ) : null}
      {conversationMenu && contextMenuConversation ? (
        <div
          className="desktop-chat__conversation-menu"
          role="menu"
          aria-label="会话操作"
          style={{ left: conversationMenu.x, top: conversationMenu.y }}
        >
          <button
            type="button"
            role="menuitem"
            disabled={isStreaming}
            onClick={() => handleStartRename(contextMenuConversation)}
          >
            <Pencil size={15} aria-hidden="true" />
            重命名
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={updateConversation.isPending}
            onClick={() => void handleToggleConversationPin(contextMenuConversation)}
          >
            <Pin size={15} aria-hidden="true" />
            {contextMenuConversation.isPinned ? '取消置顶' : '置顶'}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => handleEnterSelectionMode(contextMenuConversation.id)}
          >
            <CheckSquare size={15} aria-hidden="true" />
            多选
          </button>
          <div className="desktop-chat__conversation-menu-separator" role="separator" />
          <button
            className="desktop-chat__conversation-menu-delete"
            type="button"
            role="menuitem"
            disabled={isStreaming || deleteConversation.isPending}
            onClick={() => {
              setConversationMenu(null)
              handleRequestRemoveConversation(contextMenuConversation)
            }}
          >
            <Trash2 size={15} aria-hidden="true" />
            删除
          </button>
        </div>
      ) : null}
    </main>
  )
}
