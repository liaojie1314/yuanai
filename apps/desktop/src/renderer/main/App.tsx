import {
  ArrowDown,
  Brain,
  Calculator,
  Camera,
  Check,
  CheckSquare,
  ChevronDown,
  CircleAlert,
  Code2,
  Copy,
  Eye,
  EyeOff,
  FileUp,
  FileText,
  Ghost,
  Globe2,
  Image,
  Languages,
  Link,
  LoaderCircle,
  LogIn,
  LogOut,
  Lock,
  Mic,
  MoreVertical,
  Monitor,
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
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import { useTranslation } from 'react-i18next'
import {
  useConversations,
  useCreateConversation,
  useDeleteConversation,
  useDeleteConversations,
  useLogout,
  useMessages,
  useModels,
  useCreateShareLink,
  useRevokeShareLink,
  useShareLink,
  useStream,
  useUpdateConversation,
  useUpdateMyPreferences,
  TEMPORARY_CONV_ID,
  uploadFileSmart,
} from '@yuanai/core/hooks'
import { useAuthStore, useChatStore, usePrefsStore } from '@yuanai/core/stores'
import { buildMessagePairs, filterChatModels } from '@yuanai/core/utils'
import { Role } from '@yuanai/types'
import type { AIModel, Conversation, Message } from '@yuanai/types'

import type {
  DesktopArtifactPayload,
  DesktopMediaPermissionRequest,
  DesktopScreenSource,
  DesktopSelectedFile,
} from '../../shared/ipc-contract'
import { copyText } from '../shared/clipboard'
import { MessageList } from './MessageList'
import { useVoiceInput } from './useVoiceInput'
import '../shared/i18n'

const FALLBACK_MODEL: AIModel = {
  id: 'deepseek-v4-flash',
  name: 'DeepSeek V4 Flash-0731',
  provider: 'deepseek',
  description: '纯文本聊天，快速响应，高性价比',
  supportsVision: false,
  supportsFiles: false,
  contextLength: 1_000_000,
  isDefault: true,
}

const DEFAULT_MODELS: AIModel[] = [
  FALLBACK_MODEL,
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro-0813',
    provider: 'deepseek',
    description: '纯文本聊天，中文理解强，旗舰推理',
    supportsVision: false,
    supportsFiles: false,
    contextLength: 1_000_000,
    isDefault: false,
  },
  {
    id: 'agnes-2.5-flash',
    name: 'Agnes 2.5 Flash',
    provider: 'agnes',
    description: '支持推理、工具调用、多轮对话和图像理解',
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
const LIKE_FEEDBACK_CATEGORIES = ['有帮助', '解释清晰', '创意出色', '回答详细', '思路新颖']
const DISLIKE_FEEDBACK_CATEGORIES = ['信息有误', '答非所问', '内容冗余', '语言不自然', '缺乏细节']
const SUGGESTIONS = [
  {
    description: '帮我写一个关于时间旅行的科幻短篇',
    enablesWebSearch: false,
    icon: Sparkles,
    prompt: '帮我写一个关于时间旅行的科幻短篇故事',
    title: '创意写作',
  },
  {
    description: '帮我排查这段代码为什么报 TypeError',
    enablesWebSearch: false,
    icon: Code2,
    prompt: '帮我排查这段代码为什么报 TypeError：',
    title: '代码调试',
  },
  {
    description: '搜索今天最新的 AI 行业动态',
    enablesWebSearch: true,
    icon: Globe2,
    prompt: '搜索今天最新的 AI 行业动态',
    title: '联网搜索',
  },
  {
    description: '用简单的方式解释量子纠缠是什么',
    enablesWebSearch: false,
    icon: Calculator,
    prompt: '用简单方式解释量子纠缠是什么',
    title: '学习辅导',
  },
] as const

const CAPABILITIES = [
  { enablesWebSearch: true, icon: Globe2, label: '联网搜索', prompt: '联网搜索最新 AI 行业动态' },
  { enablesWebSearch: false, icon: Code2, label: '代码生成', prompt: '帮我写一段' },
  { enablesWebSearch: false, icon: Image, label: '图片理解', prompt: '帮我分析这张图片中的内容' },
  { enablesWebSearch: false, icon: FileText, label: '文件分析', prompt: '帮我总结这份文件的要点' },
  { enablesWebSearch: false, icon: Calculator, label: '数学推导', prompt: '解一道数学题：' },
  {
    enablesWebSearch: false,
    icon: Languages,
    label: '多语种翻译',
    prompt: '把下面内容翻译成地道英文：',
  },
] as const

interface ComposerAttachment {
  id: string
  file: File
  fileId?: string
  previewUrl?: string
  progress: number
  status: 'ready' | 'uploading' | 'done' | 'error'
}

function createAttachmentPreviewUrl(file: File): string | null {
  if (!file.type.startsWith('image/') || typeof URL.createObjectURL !== 'function') return null
  return URL.createObjectURL(file)
}

function createComposerAttachments(files: readonly File[]): ComposerAttachment[] {
  return files.map((file) => {
    const previewUrl = createAttachmentPreviewUrl(file)
    return {
      id: `${file.name}-${file.lastModified}-${file.size}-${Math.random().toString(36).slice(2)}`,
      file,
      ...(previewUrl ? { previewUrl } : {}),
      progress: 0,
      status: 'ready',
    }
  })
}

function revokeAttachmentPreview(attachment: ComposerAttachment): void {
  if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
}

function revokeAttachmentPreviews(attachments: readonly ComposerAttachment[]): void {
  attachments.forEach(revokeAttachmentPreview)
}

async function readSystemSelectedFiles(selectedFiles: DesktopSelectedFile[]): Promise<File[]> {
  return Promise.all(
    selectedFiles.map(async (selectedFile) => {
      const response = await fetch(selectedFile.url)
      if (!response.ok) throw new Error('系统选择的文件已不可用，请重新选择')
      const blob = await response.blob()
      return new File([blob], selectedFile.name, { type: blob.type || 'application/octet-stream' })
    })
  )
}

async function createImageFileFromDataUrl(dataUrl: string, filename: string): Promise<File> {
  const response = await fetch(dataUrl)
  if (!response.ok) throw new Error('无法读取截屏，请重新选择')
  const blob = await response.blob()
  return new File([blob], filename, { type: blob.type || 'image/png' })
}

async function createImageFileFromVideo(video: HTMLVideoElement): Promise<File> {
  const width = video.videoWidth || 1280
  const height = video.videoHeight || 720
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建拍照画布')
  context.drawImage(video, 0, 0, width, height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('拍照失败，请重试')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return new File([blob], `camera-${timestamp}.png`, { type: 'image/png' })
}

function stopMediaStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop())
}

function getModelInitial(model: AIModel): string {
  return model.provider.slice(0, 1).toLocaleUpperCase()
}

function formatContextLength(contextLength: number): string {
  if (contextLength >= 1_000_000) return `${Math.round(contextLength / 1_000_000)}M`
  return contextLength >= 1000 ? `${Math.round(contextLength / 1000)}K` : String(contextLength)
}

function formatModelProvider(provider: string): string {
  if (provider.toLocaleLowerCase() === 'deepseek') return 'DeepSeek'
  if (provider.toLocaleLowerCase() === 'openai') return 'OpenAI'
  if (provider.toLocaleLowerCase() === 'agnes') return 'Agnes AI'
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

type ConversationGroupLabels = Record<'pinned' | 'today' | 'yesterday' | 'week' | 'earlier', string>
const CONVERSATION_GROUP_ORDER: Array<keyof ConversationGroupLabels> = [
  'pinned',
  'today',
  'yesterday',
  'week',
  'earlier',
]

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

function groupConversations(
  conversations: Conversation[],
  labels: ConversationGroupLabels
): ConversationGroup[] {
  const groups = new Map<string, Conversation[]>()
  const referenceDate = new Date()

  for (const conversation of conversations) {
    const id = getConversationGroupId(conversation, referenceDate)
    const group = groups.get(id) ?? []
    group.push(conversation)
    groups.set(id, group)
  }

  return CONVERSATION_GROUP_ORDER.flatMap((id) => {
    const group = groups.get(id)
    return group ? [{ id, label: labels[id] ?? id, conversations: group }] : []
  })
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

interface ConversationItemProps {
  conversation: Conversation
  active: boolean
  renaming: boolean
  renameValue: string
  selectionMode: boolean
  sidebarCollapsed: boolean
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

interface FeedbackDialogProps {
  category: string
  reason: string
  type: 'like' | 'dislike'
  onCategoryChange(category: string): void
  onClose(): void
  onReasonChange(reason: string): void
  onSubmit(): void
}

/** 收集与 Web 端一致的本地消息反馈。 */
function FeedbackDialog({
  category,
  reason,
  type,
  onCategoryChange,
  onClose,
  onReasonChange,
  onSubmit,
}: FeedbackDialogProps): ReactElement {
  const categories = type === 'like' ? LIKE_FEEDBACK_CATEGORIES : DISLIKE_FEEDBACK_CATEGORIES
  const heading = type === 'like' ? '哪方面让你满意？' : '哪里让你不满意？'

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    onClose()
  }

  return (
    <div
      className="desktop-chat__dialog-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <section
        className="desktop-chat__feedback-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-feedback-title"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id="desktop-feedback-title">{heading}</h2>
          <button type="button" aria-label="关闭反馈" title="关闭" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="desktop-chat__feedback-categories">
          {categories.map((item) => (
            <button
              key={item}
              className={category === item ? 'is-selected' : undefined}
              type="button"
              aria-pressed={category === item}
              onClick={() => onCategoryChange(category === item ? '' : item)}
            >
              {item}
            </button>
          ))}
        </div>
        <label className="desktop-chat__sr-only" htmlFor="desktop-feedback-reason">
          反馈说明
        </label>
        <textarea
          id="desktop-feedback-reason"
          rows={3}
          placeholder="写下你的建议（可选）"
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
        />
        <footer>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="button" onClick={onSubmit}>
            提交反馈
          </button>
        </footer>
      </section>
    </div>
  )
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
    if (await copyText(shareUrl)) {
      setCopied(true)
      setNotice('链接已复制到剪贴板')
    } else {
      setNotice('复制失败，请手动复制链接')
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

interface MediaPermissionDialogProps {
  request: DesktopMediaPermissionRequest
  onRespond(granted: boolean): void
}

/** 在聊天窗口内收集麦克风或摄像头的一次性明确授权。 */
function MediaPermissionDialog({ request, onRespond }: MediaPermissionDialogProps): ReactElement {
  const rejectRef = useRef<HTMLButtonElement>(null)
  const allowRef = useRef<HTMLButtonElement>(null)
  const deviceName = request.mediaType === 'audio' ? '麦克风' : '摄像头'
  const titleId = `desktop-media-permission-title-${request.requestId}`
  const descriptionId = `desktop-media-permission-description-${request.requestId}`

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    rejectRef.current?.focus()
    return () => previouslyFocused?.focus()
  }, [])

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onRespond(false)
      return
    }
    if (event.key !== 'Tab') return

    const first = rejectRef.current
    const last = allowRef.current
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
        className="desktop-chat__media-permission-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
      >
        <div className="desktop-chat__confirm-dialog-copy">
          <h2 id={titleId}>允许使用{deviceName}？</h2>
          <p id={descriptionId}>
            元AI 将使用{deviceName}录制语音并转写为输入内容。你可以随时停止录音。
          </p>
        </div>
        <div className="desktop-chat__confirm-dialog-actions">
          <button ref={rejectRef} type="button" onClick={() => onRespond(false)}>
            拒绝
          </button>
          <button
            ref={allowRef}
            className="desktop-chat__media-permission-allow"
            type="button"
            onClick={() => onRespond(true)}
          >
            允许
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
  sidebarCollapsed,
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
      {!renaming && !selectionMode && !sidebarCollapsed ? (
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
  const { t } = useTranslation()
  const conversationsQuery = useConversations()
  const createConversation = useCreateConversation()
  const deleteConversation = useDeleteConversation()
  const deleteConversations = useDeleteConversations()
  const updateConversation = useUpdateConversation()
  const modelsQuery = useModels()
  const stream = useStream()
  const logout = useLogout()
  const updatePreferences = useUpdateMyPreferences()
  const user = useAuthStore((state) => state.user)
  const isLoggedIn = user !== null
  const timeFmt = usePrefsStore((state) => state.timeFmt)
  const dateFmt = usePrefsStore((state) => state.dateFmt)
  const theme = usePrefsStore((state) => state.theme)
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
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false)
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false)
  const [screenSources, setScreenSources] = useState<DesktopScreenSource[]>([])
  const [isScreenCaptureOpen, setIsScreenCaptureOpen] = useState(false)
  const [isScreenSourcesLoading, setIsScreenSourcesLoading] = useState(false)
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
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
  const [versionIndexes, setVersionIndexes] = useState<Record<string, number>>({})
  const [regeneratingPairKey, setRegeneratingPairKey] = useState<string | null>(null)
  const [feedbackDialog, setFeedbackDialog] = useState<{
    messageId: string
    type: 'like' | 'dislike'
  } | null>(null)
  const [feedbackCategory, setFeedbackCategory] = useState('')
  const [feedbackReason, setFeedbackReason] = useState('')
  const [messageFeedback, setMessageFeedback] = useState<Record<string, 'like' | 'dislike'>>({})
  const [actionError, setActionError] = useState('')
  const [voiceToast, setVoiceToast] = useState('')
  const [mediaPermissionRequest, setMediaPermissionRequest] =
    useState<DesktopMediaPermissionRequest | null>(null)
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const [isMessagesAtBottom, setIsMessagesAtBottom] = useState(true)
  const [isDarkTheme, setIsDarkTheme] = useState(
    () => document.documentElement.getAttribute('data-theme') === 'dark'
  )
  const messagesListRef = useRef<VirtuosoHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachmentsRef = useRef<ComposerAttachment[]>([])
  const cameraVideoRef = useRef<HTMLVideoElement>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const isMessagesAtBottomRef = useRef(true)

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkTheme(document.documentElement.dataset.theme === 'dark')
    })
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!voiceToast) return undefined
    const timeout = window.setTimeout(() => setVoiceToast(''), 4_000)
    return () => window.clearTimeout(timeout)
  }, [voiceToast])

  useEffect(() => window.yuanai.events.onMediaPermissionRequested(setMediaPermissionRequest), [])

  const conversations = isLoggedIn
    ? (conversationsQuery.data ?? EMPTY_CONVERSATIONS)
    : EMPTY_CONVERSATIONS
  const availableModels = useMemo(() => {
    const chatModels = filterChatModels(modelsQuery.data ?? [])
    return chatModels.length > 0 ? chatModels : DEFAULT_MODELS
  }, [modelsQuery.data])
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
  const messagePairs = useMemo(() => buildMessagePairs(messages), [messages])
  const streamingConversationId = useChatStore((state) => state.streamingConvId)
  const streamingContent = useChatStore((state) => state.streamingContent)
  const streamingThinking = useChatStore((state) => state.streamingThink)
  const streamingThinkingDurationMs = useChatStore((state) => state.streamingThinkDurationMs)
  const streamingToolCalls = useChatStore((state) => state.streamingToolCalls)
  const optimisticUserMessage = useChatStore((state) => state.optimisticUserMsg)
  const isStreaming =
    streamingConversationId !== null &&
    streamingConversationId === (isTemporaryConversation ? TEMPORARY_CONV_ID : activeConversationId)
  const voiceInput = useVoiceInput({
    onTranscript: (text) => {
      setDraft((previous) => {
        const needsSpace = previous && !previous.endsWith(' ') && !previous.endsWith('\n')
        return `${previous}${needsSpace ? ' ' : ''}${text}`
      })
    },
    onError: setVoiceToast,
  })
  const activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ?? null
  const visibleConversations = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    if (!normalizedSearch) return conversations
    return conversations.filter((conversation) =>
      getConversationTitle(conversation).toLocaleLowerCase().includes(normalizedSearch)
    )
  }, [conversations, search])
  const groupedConversations = useMemo(() => {
    const labels: ConversationGroupLabels = {
      pinned: t('chat.groups.pinned'),
      today: t('chat.groups.today'),
      yesterday: t('chat.groups.yesterday'),
      week: t('chat.groups.week'),
      earlier: t('desktop.chat.earlier'),
    }
    return groupConversations(visibleConversations, labels)
  }, [t, visibleConversations])
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
    setIsAttachmentMenuOpen(false)
    setScreenSources([])
    setIsScreenCaptureOpen(false)
    stopMediaStream(cameraStreamRef.current)
    cameraStreamRef.current = null
    setCameraStream(null)
    setIsCameraOpen(false)
    setCameraError('')
    setAttachments((items) => {
      revokeAttachmentPreviews(items)
      return []
    })
    setSearch('')
  }, [isLoggedIn])

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  useEffect(() => () => revokeAttachmentPreviews(attachmentsRef.current), [])

  useEffect(() => {
    const video = cameraVideoRef.current
    if (!cameraStream || !video) return
    video.srcObject = cameraStream
    void video.play().catch(() => setCameraError('摄像头预览无法启动，请检查系统权限'))
    return () => {
      if (video.srcObject === cameraStream) video.srcObject = null
    }
  }, [cameraStream])

  useEffect(
    () => () => {
      stopMediaStream(cameraStreamRef.current)
    },
    []
  )

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
  const userName = user?.username ?? t('chat.sidebar.login')
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
    setVersionIndexes({})
    setFeedbackDialog(null)
    setFeedbackCategory('')
    setFeedbackReason('')
  }, [activeConversationId, isTemporaryConversation])

  const wasStreamingRef = useRef(isStreaming)
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) setRegeneratingPairKey(null)
    wasStreamingRef.current = isStreaming
  }, [isStreaming])

  const setMessagesAtBottom = useCallback((atBottom: boolean): void => {
    if (isMessagesAtBottomRef.current === atBottom) return
    isMessagesAtBottomRef.current = atBottom
    setIsMessagesAtBottom(atBottom)
  }, [])

  const scrollMessagesToBottom = useCallback(
    (behavior: 'auto' | 'smooth'): void => {
      setMessagesAtBottom(true)
      messagesListRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior })
    },
    [setMessagesAtBottom]
  )

  useEffect(() => {
    isMessagesAtBottomRef.current = true
    setIsMessagesAtBottom(true)
    const frame = window.requestAnimationFrame(() => scrollMessagesToBottom('auto'))
    return () => window.cancelAnimationFrame(frame)
  }, [activeConversationId, isTemporaryConversation, scrollMessagesToBottom])

  useEffect(() => {
    if (!isMessagesAtBottomRef.current) return
    const frame = window.requestAnimationFrame(() => scrollMessagesToBottom('auto'))
    return () => window.cancelAnimationFrame(frame)
  }, [
    messages,
    optimisticUserMessage,
    streamingContent,
    streamingThinking,
    streamingThinkingDurationMs,
    streamingToolCalls,
    scrollMessagesToBottom,
  ])

  const showScrollToBottom =
    !isMessagesAtBottom && (messages.length > 0 || isStreaming || optimisticUserMessage !== null)

  useEffect(() => {
    const input = composerInputRef.current
    if (!input) return
    const maximumHeight = 200
    input.style.height = 'auto'
    const contentHeight = input.scrollHeight
    input.style.height = `${Math.min(Math.max(contentHeight, 40), maximumHeight)}px`
    input.style.overflowY = contentHeight > maximumHeight ? 'auto' : 'hidden'
  }, [draft])

  function handleQuickPrompt(prompt: string, enablesWebSearch = false): void {
    if (!isLoggedIn) return
    if (enablesWebSearch) setIsWebSearchEnabled(true)
    setDraft(prompt)
    window.setTimeout(() => {
      const input = composerInputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    }, 0)
  }

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
        setIsAttachmentMenuOpen(false)
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
    setAttachments((items) => {
      revokeAttachmentPreviews(items)
      return []
    })
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

  /** 退出当前账号，并由安全存储变更驱动主进程显示登录窗口。 */
  async function handleLogout(): Promise<void> {
    setIsAccountMenuOpen(false)
    setActionError('')
    try {
      await logout.mutateAsync()
    } catch (error: unknown) {
      setActionError(getErrorMessage(error, '退出登录失败，请稍后重试'))
    }
  }

  async function handleOpenArtifact(payload: DesktopArtifactPayload): Promise<void> {
    setActionError('')
    try {
      await window.yuanai.window.openArtifact({
        ...payload,
        theme: isDarkTheme ? 'dark' : 'light',
      })
    } catch (error: unknown) {
      setActionError(getErrorMessage(error, '无法打开代码面板，请稍后重试'))
    }
  }

  /** 在 AI 回复正常结束后请求主进程按已保存的通知偏好提醒用户。 */
  function notifyReplyCompleted(conversationId?: string): void {
    void window.yuanai.system
      .notify({
        title: t('desktop.notifications.replyCompleted'),
        body: t('desktop.notifications.replyBody'),
        ...(conversationId ? { conversationId } : {}),
      })
      .catch(() => undefined)
  }

  /** 覆盖用户原消息，并替换其后基于旧内容生成的回答。 */
  function handleEditMessage(messageId: string, content: string): void {
    if (!isLoggedIn || isStreaming || isTemporaryConversation || !activeConversationId) return
    setActionError('')
    void stream
      .send({
        convId: activeConversationId,
        content,
        enableThinking: isThinkingEnabled,
        model: selectedModel.id,
        replaceMessageId: messageId,
        skipOptimistic: true,
        onError: (error) => setActionError(getErrorMessage(error, '编辑消息失败，请重试')),
      })
      .catch((error: unknown) => setActionError(getErrorMessage(error, '编辑消息失败，请重试')))
  }

  /** 使用对应用户问题重新生成 AI 回复，不重复显示乐观用户消息。 */
  function handleRegenerateMessage(content: string, pairKey: string): void {
    if (!isLoggedIn || isStreaming || isTemporaryConversation || !activeConversationId) return
    setActionError('')
    setVersionIndexes((items) => {
      const next = { ...items }
      delete next[pairKey]
      return next
    })
    setRegeneratingPairKey(pairKey)
    void stream
      .send({
        convId: activeConversationId,
        content,
        enableThinking: isThinkingEnabled,
        model: selectedModel.id,
        onError: (error) => {
          setRegeneratingPairKey(null)
          setActionError(getErrorMessage(error, '重新生成失败，请重试'))
        },
        skipOptimistic: true,
      })
      .catch((error: unknown) => {
        setRegeneratingPairKey(null)
        setActionError(getErrorMessage(error, '重新生成失败，请重试'))
      })
  }

  /** 记录本地反馈；再次选择相同反馈时与 Web 一致地取消。 */
  function handleOpenFeedback(messageId: string, type: 'like' | 'dislike'): void {
    if (messageFeedback[messageId] === type) {
      setMessageFeedback((items) => {
        const next = { ...items }
        delete next[messageId]
        return next
      })
      return
    }
    setFeedbackDialog({ messageId, type })
    setFeedbackCategory('')
    setFeedbackReason('')
  }

  /** 将已确认的反馈状态绑定至具体 AI 消息。 */
  function handleSubmitFeedback(): void {
    if (!feedbackDialog) return
    setMessageFeedback((items) => ({
      ...items,
      [feedbackDialog.messageId]: feedbackDialog.type,
    }))
    setFeedbackDialog(null)
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

  async function handleToggleTheme(): Promise<void> {
    const previousTheme = theme
    const previousResolved = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
    const nextTheme = isDarkTheme ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', nextTheme)
    setTheme(nextTheme)
    setIsDarkTheme(nextTheme === 'dark')
    try {
      await window.yuanai.appearance.apply(nextTheme)
      if (isLoggedIn) {
        const saved = await updatePreferences.mutateAsync({ theme: nextTheme })
        void window.yuanai.appearance.syncPreferences(saved).catch(() => undefined)
      }
    } catch (error: unknown) {
      setTheme(previousTheme)
      document.documentElement.setAttribute('data-theme', previousResolved)
      setIsDarkTheme(previousResolved === 'dark')
      void window.yuanai.appearance.apply(previousTheme).catch(() => undefined)
      setActionError(getErrorMessage(error, '主题设置保存失败'))
    }
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

  function addAttachments(files: readonly File[]): void {
    if (!files.length || isTemporaryConversation) return
    setAttachments((items) => [...items, ...createComposerAttachments(files)])
  }

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>): void {
    addAttachments(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  async function handleOpenSystemFiles(): Promise<void> {
    if (isTemporaryConversation || isUploadingAttachments) return
    setIsAttachmentMenuOpen(false)
    setActionError('')
    try {
      const selectedFiles = await window.yuanai.dialog.openFiles()
      if (!selectedFiles.length) return
      addAttachments(await readSystemSelectedFiles(selectedFiles))
    } catch (error: unknown) {
      setActionError(getErrorMessage(error, '无法读取系统选择的文件，请重新选择'))
    }
  }

  async function handleOpenScreenCapture(): Promise<void> {
    if (isTemporaryConversation || isUploadingAttachments) return
    setIsAttachmentMenuOpen(false)
    setActionError('')
    setIsScreenSourcesLoading(true)
    try {
      const sources = await window.yuanai.dialog.listScreenSources()
      if (!sources.length) {
        setActionError('未找到可截取的屏幕或窗口')
        return
      }
      setScreenSources(sources)
      setIsScreenCaptureOpen(true)
    } catch (error: unknown) {
      setActionError(getErrorMessage(error, '无法读取屏幕，请稍后重试'))
    } finally {
      setIsScreenSourcesLoading(false)
    }
  }

  async function handleSelectScreenSource(source: DesktopScreenSource): Promise<void> {
    setActionError('')
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      addAttachments([
        await createImageFileFromDataUrl(source.thumbnailDataUrl, `screenshot-${timestamp}.png`),
      ])
      setIsScreenCaptureOpen(false)
      setScreenSources([])
    } catch (error: unknown) {
      setActionError(getErrorMessage(error, '截屏读取失败，请重新选择'))
    }
  }

  function closeCamera(): void {
    stopMediaStream(cameraStreamRef.current)
    cameraStreamRef.current = null
    setCameraStream(null)
    setCameraError('')
    setIsCameraOpen(false)
  }

  async function handleOpenCamera(): Promise<void> {
    if (isTemporaryConversation || isUploadingAttachments) return
    setIsAttachmentMenuOpen(false)
    setActionError('')
    setCameraError('')
    setIsCameraOpen(true)
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('当前系统不支持摄像头访问')
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true })
      cameraStreamRef.current = stream
      setCameraStream(stream)
    } catch (error: unknown) {
      setCameraError(getErrorMessage(error, '无法打开摄像头，请检查系统权限'))
    }
  }

  async function handleCaptureCameraPhoto(): Promise<void> {
    const video = cameraVideoRef.current
    if (!video || !cameraStream) return
    setActionError('')
    try {
      addAttachments([await createImageFileFromVideo(video)])
      closeCamera()
    } catch (error: unknown) {
      setCameraError(getErrorMessage(error, '拍照失败，请重试'))
    }
  }

  function removeAttachment(id: string): void {
    if (isUploadingAttachments) return
    setAttachments((items) => {
      const attachment = items.find((item) => item.id === id)
      if (attachment) revokeAttachmentPreview(attachment)
      return items.filter((item) => item.id !== id)
    })
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
    if (
      attachments.some((attachment) => attachment.file.type.startsWith('image/')) &&
      !selectedModel.supportsVision
    ) {
      setActionError('当前模型不支持图片识别，请切换至支持视觉的模型后发送')
      return
    }
    if (attachments.length > 0 && !selectedModel.supportsFiles) {
      setActionError('当前模型不支持文件识别，请切换至支持文件的模型后发送')
      return
    }
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
          onEnd: ({ completed, content: response, think }) => {
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
            if (completed) notifyReplyCompleted()
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
      const targetConversationId = conversationId
      await stream.send({
        convId: targetConversationId,
        content,
        enableThinking: isThinkingEnabled,
        fileIds,
        model: selectedModel.id,
        onEnd: ({ completed }) => {
          if (completed) notifyReplyCompleted(targetConversationId)
        },
        onError: (error) => setActionError(getErrorMessage(error, '消息发送失败，请重试')),
      })
      revokeAttachmentPreviews(attachments)
      setAttachments([])
      setDraft('')
    } catch (error: unknown) {
      setActionError(getErrorMessage(error, '消息发送失败，请重试'))
    } finally {
      setIsUploadingAttachments(false)
    }
  }

  function handleVoiceInput(): void {
    if (voiceInput.status === 'listening' || voiceInput.status === 'recording') {
      voiceInput.stop()
      return
    }
    if (voiceInput.status === 'transcribing') {
      voiceInput.cancel()
      return
    }
    void voiceInput.start()
  }

  function handleMediaPermissionResponse(granted: boolean): void {
    const request = mediaPermissionRequest
    if (!request) return
    setMediaPermissionRequest(null)
    void window.yuanai.permissions.respond({ requestId: request.requestId, granted }).catch(() => {
      setVoiceToast('无法提交麦克风授权结果，请重试')
    })
  }

  return (
    <main
      className={
        isSidebarCollapsed ? 'desktop-chat desktop-chat--sidebar-collapsed' : 'desktop-chat'
      }
      aria-label={`${t('common.appName')} ${t('desktop.chat.title')}`}
    >
      {voiceToast ? (
        <div className="desktop-chat__toast" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          <span>{voiceToast}</span>
          <button type="button" aria-label={t('common.close')} onClick={() => setVoiceToast('')}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <aside className="desktop-chat__sidebar" aria-label={t('desktop.chat.conversations')}>
        <div className="desktop-chat__sidebar-header">
          <div className="desktop-chat__brand">
            <span aria-hidden="true">元</span>
            <strong>{t('common.appName')}</strong>
          </div>
          <div className="desktop-chat__quick-actions" aria-label={t('desktop.chat.newActions')}>
            <button
              className={isTemporaryConversation ? 'is-active' : undefined}
              type="button"
              aria-label={
                isTemporaryConversation
                  ? t('chat.temporary.exit')
                  : t('desktop.chat.startTemporary')
              }
              title={
                isTemporaryConversation
                  ? t('chat.temporary.exit')
                  : t('desktop.chat.startTemporary')
              }
              aria-pressed={isTemporaryConversation}
              disabled={isStreaming}
              onClick={handleToggleTemporaryConversation}
            >
              <Ghost size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={t('desktop.chat.newConversation')}
              title={t('desktop.chat.newConversation')}
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
          <span className="desktop-chat__sr-only">{t('desktop.chat.searchConversations')}</span>
          <input
            type="search"
            value={search}
            placeholder={t('chat.searchPlaceholder')}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {isSelectionMode ? (
          <div
            className="desktop-chat__selection-toolbar"
            role="toolbar"
            aria-label={t('desktop.chat.selectConversations')}
          >
            <button
              type="button"
              disabled={conversations.length === 0}
              onClick={handleToggleAllConversations}
            >
              {selectedConversationIds.size === conversations.length
                ? t('chat.actions.deselectAll')
                : t('chat.actions.selectAll')}
            </button>
            <span>{t('desktop.chat.selectedCount', { count: selectedConversationIds.size })}</span>
            <button
              className="desktop-chat__selection-delete"
              type="button"
              disabled={
                selectedConversationIds.size === 0 || isStreaming || deleteConversations.isPending
              }
              onClick={() => setIsBatchDeleteConfirmationOpen(true)}
            >
              {t('desktop.chat.deleteSelected')}
            </button>
            <button
              type="button"
              disabled={deleteConversations.isPending}
              onClick={handleExitSelectionMode}
            >
              {t('common.cancel')}
            </button>
          </div>
        ) : null}
        <nav
          className="desktop-chat__conversation-nav"
          aria-label={t('desktop.chat.recentConversations')}
        >
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
                        sidebarCollapsed={isSidebarCollapsed}
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
              {isLoggedIn
                ? search
                  ? t('desktop.chat.noSearchResults')
                  : t('chat.noConversations')
                : t('chat.noConversations')}
            </p>
          )}
        </nav>
        <div
          ref={accountMenuRef}
          className="desktop-chat__account"
          aria-label={t('desktop.chat.currentAccount')}
        >
          <button
            className="desktop-chat__account-trigger"
            type="button"
            aria-label={user ? t('desktop.chat.openProfile') : t('desktop.chat.openLogin')}
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
            aria-label={t('desktop.chat.openQuickSettings')}
            title={t('desktop.chat.openQuickSettings')}
            aria-expanded={isAccountMenuOpen}
            aria-haspopup="menu"
            onClick={() => setIsAccountMenuOpen((value) => !value)}
          >
            <Settings size={15} aria-hidden="true" />
          </button>
          {isAccountMenuOpen ? (
            <div
              className="desktop-chat__account-menu"
              role="menu"
              aria-label={t('desktop.chat.quickSettings')}
            >
              <button
                className="desktop-chat__account-menu-theme"
                type="button"
                role="menuitem"
                aria-label={t('theme.toggleDark')}
                aria-pressed={isDarkTheme}
                onClick={() => void handleToggleTheme()}
              >
                <span>{t('chat.sidebar.darkMode')}</span>
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
              {user ? (
                <>
                  <button
                    className="desktop-chat__account-menu-login"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsAccountMenuOpen(false)
                      void handleOpenSettings()
                    }}
                  >
                    <Settings size={16} aria-hidden="true" />
                    {t('chat.sidebar.profile')}
                  </button>
                  <div className="desktop-chat__account-menu-separator" />
                  <button
                    className="desktop-chat__account-menu-login desktop-chat__account-menu-logout"
                    type="button"
                    role="menuitem"
                    onClick={() => void handleLogout()}
                  >
                    <LogOut size={16} aria-hidden="true" />
                    {t('chat.sidebar.logout')}
                  </button>
                </>
              ) : (
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
                  {t('chat.sidebar.login')}
                </button>
              )}
            </div>
          ) : null}
        </div>
      </aside>

      <section className="desktop-chat__workspace">
        <header className="desktop-chat__header">
          <div className="desktop-chat__header-side">
            <h1 className="desktop-chat__sr-only">
              {isTemporaryConversation
                ? t('chat.toolbar.temporaryOn')
                : activeConversation
                  ? getConversationTitle(activeConversation)
                  : t('desktop.chat.startNewConversation')}
            </h1>
            <button
              className="desktop-chat__header-action"
              type="button"
              aria-label={
                isSidebarCollapsed
                  ? t('desktop.chat.expandSidebar')
                  : t('desktop.chat.collapseSidebar')
              }
              title={
                isSidebarCollapsed
                  ? t('desktop.chat.expandSidebar')
                  : t('desktop.chat.collapseSidebar')
              }
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
            aria-label={t('desktop.chat.selectModel', { name: selectedModel.name })}
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
              aria-label={t('chat.toolbar.share')}
              title={t('chat.toolbar.share')}
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
              aria-label={t('desktop.chat.modelSelectClose')}
              onClick={() => setIsModelMenuOpen(false)}
            />
            <div
              className="desktop-chat__model-menu"
              role="listbox"
              aria-label={t('desktop.chat.modelSelect')}
            >
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
                        aria-label={t('desktop.chat.selectModelOption', { name: model.name })}
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
            <span>{t('desktop.chat.temporaryBanner')}</span>
            <button
              type="button"
              aria-label={t('desktop.chat.exitTemporaryMode')}
              disabled={isStreaming}
              onClick={handleToggleTemporaryConversation}
            >
              {t('chat.temporary.exit')}
            </button>
          </div>
        ) : null}

        <div className="desktop-chat__messages-shell">
          {messagesQuery.isLoading && activeConversationId && !isTemporaryConversation ? (
            <div className="desktop-chat__messages-loading">
              <LoaderCircle className="desktop-chat__spin" size={22} />
            </div>
          ) : messages.length || isStreaming ? (
            <MessageList
              listRef={messagesListRef}
              pairs={messagePairs}
              user={user}
              isStreaming={isStreaming}
              isTemporaryConversation={isTemporaryConversation}
              regeneratingPairKey={regeneratingPairKey}
              optimisticUserMessage={optimisticUserMessage}
              streamingContent={streamingContent}
              streamingThinking={streamingThinking}
              streamingThinkingDurationMs={streamingThinkingDurationMs}
              streamingToolCalls={streamingToolCalls}
              versionIndexes={versionIndexes}
              messageFeedback={messageFeedback}
              timeFmt={timeFmt}
              dateFmt={dateFmt}
              onAtBottomStateChange={setMessagesAtBottom}
              onEditMessage={handleEditMessage}
              onRegenerateMessage={handleRegenerateMessage}
              onOpenFeedback={handleOpenFeedback}
              onOpenArtifact={(payload) => void handleOpenArtifact(payload)}
              onVersionChange={(pairKey, index) =>
                setVersionIndexes((items) => ({ ...items, [pairKey]: index }))
              }
            />
          ) : (
            <section
              className="desktop-chat__empty-state"
              aria-label={t('desktop.chat.startNewConversation')}
            >
              <div className="desktop-chat__empty-icon" aria-hidden="true">
                元
              </div>
              <div className="desktop-chat__empty-copy">
                <h2>{t('chat.welcome.title')}</h2>
                <p>{t('chat.welcome.subtitle')}</p>
              </div>
              <div
                className="desktop-chat__capabilities"
                aria-label={t('desktop.chat.capabilities')}
              >
                {CAPABILITIES.map(({ enablesWebSearch, icon: Icon, label, prompt }) => (
                  <button
                    key={label}
                    type="button"
                    aria-label={`快捷提示：${label}`}
                    disabled={!isLoggedIn}
                    onClick={() => handleQuickPrompt(prompt, enablesWebSearch)}
                  >
                    <Icon size={14} aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </div>
              <div className="desktop-chat__suggestions">
                {SUGGESTIONS.map(({ description, enablesWebSearch, icon: Icon, prompt, title }) => (
                  <button
                    key={title}
                    type="button"
                    aria-label={title}
                    disabled={!isLoggedIn}
                    onClick={() => handleQuickPrompt(prompt, enablesWebSearch)}
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
          {showScrollToBottom ? (
            <button
              className="desktop-chat__scroll-to-bottom"
              type="button"
              aria-label={t('chat.actions.scrollToBottom')}
              title={t('chat.actions.scrollToBottom')}
              onClick={() => scrollMessagesToBottom('smooth')}
            >
              <ArrowDown size={18} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <form
          className="desktop-chat__composer"
          onSubmit={(event) => void handleSendMessage(event)}
        >
          {attachments.length > 0 ? (
            <ul className="desktop-chat__attachment-list" aria-label="待发送附件">
              {attachments.map((attachment) => {
                const isImage = Boolean(attachment.previewUrl)
                return (
                  <li
                    key={attachment.id}
                    className={
                      isImage
                        ? 'desktop-chat__attachment desktop-chat__attachment--image'
                        : 'desktop-chat__attachment'
                    }
                    title={attachment.status === 'error' ? '上传失败' : attachment.file.name}
                  >
                    {isImage ? (
                      <img src={attachment.previewUrl} alt={attachment.file.name} />
                    ) : (
                      <>
                        <FileText size={15} aria-hidden="true" />
                        <span>{attachment.file.name}</span>
                      </>
                    )}
                    {attachment.status === 'uploading' ? (
                      <>
                        {isImage ? (
                          <span className="desktop-chat__attachment-progress" aria-hidden="true">
                            <span style={{ width: `${attachment.progress}%` }} />
                          </span>
                        ) : null}
                        <small>{attachment.progress}%</small>
                      </>
                    ) : null}
                    {attachment.status === 'error' ? <small>上传失败</small> : null}
                    <button
                      type="button"
                      aria-label={`移除附件 ${attachment.file.name}`}
                      title="移除附件"
                      disabled={isUploadingAttachments}
                      onClick={() => removeAttachment(attachment.id)}
                    >
                      <X size={isImage ? 11 : 14} aria-hidden="true" />
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : null}
          <textarea
            ref={composerInputRef}
            aria-label="输入消息"
            rows={1}
            value={draft}
            placeholder={
              isLoggedIn ? t('chat.inputPlaceholder') : t('chat.inputPlaceholderLoggedOut')
            }
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
                className={attachments.length > 0 || isAttachmentMenuOpen ? 'is-active' : undefined}
                type="button"
                aria-label="添加附件"
                aria-expanded={isAttachmentMenuOpen}
                aria-haspopup="menu"
                title={isTemporaryConversation ? '临时对话不支持附件' : '添加附件'}
                disabled={
                  !isLoggedIn || isTemporaryConversation || isStreaming || isUploadingAttachments
                }
                onClick={() => setIsAttachmentMenuOpen((value) => !value)}
              >
                <Paperclip size={18} aria-hidden="true" />
              </button>
              {isAttachmentMenuOpen ? (
                <>
                  <button
                    className="desktop-chat__attachment-menu-dismiss"
                    type="button"
                    aria-label="关闭附件菜单"
                    onClick={() => setIsAttachmentMenuOpen(false)}
                  />
                  <div className="desktop-chat__attachment-menu" role="menu" aria-label="添加附件">
                    <button
                      type="button"
                      role="menuitem"
                      aria-label="上传文件"
                      onClick={() => void handleOpenSystemFiles()}
                    >
                      <FileUp size={17} aria-hidden="true" />
                      <span>
                        <strong>上传文件</strong>
                        <small>从系统选择本地图片或文档</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      aria-label="截屏"
                      disabled={isScreenSourcesLoading}
                      onClick={() => void handleOpenScreenCapture()}
                    >
                      <Monitor size={17} aria-hidden="true" />
                      <span>
                        <strong>截屏</strong>
                        <small>选择窗口或屏幕，捕获一帧</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      aria-label="摄像头拍照"
                      onClick={() => void handleOpenCamera()}
                    >
                      <Camera size={17} aria-hidden="true" />
                      <span>
                        <strong>摄像头拍照</strong>
                        <small>预览后拍照，直接添加</small>
                      </span>
                    </button>
                  </div>
                </>
              ) : null}
              <button
                className={
                  voiceInput.status === 'listening' || voiceInput.status === 'recording'
                    ? 'is-active'
                    : undefined
                }
                type="button"
                aria-label={
                  voiceInput.status === 'listening' || voiceInput.status === 'recording'
                    ? '停止语音输入'
                    : voiceInput.status === 'transcribing'
                      ? '取消语音转写'
                      : '语音输入'
                }
                aria-pressed={
                  voiceInput.status === 'listening' || voiceInput.status === 'recording'
                }
                aria-busy={voiceInput.status === 'transcribing'}
                title={
                  voiceInput.status === 'listening' || voiceInput.status === 'recording'
                    ? '停止语音输入'
                    : voiceInput.status === 'transcribing'
                      ? '取消语音转写'
                      : voiceInput.isAvailable
                        ? '语音输入'
                        : '当前桌面环境不支持录音'
                }
                disabled={
                  !isLoggedIn || !voiceInput.isAvailable || isStreaming || isUploadingAttachments
                }
                onClick={handleVoiceInput}
              >
                {voiceInput.status === 'transcribing' ? (
                  <LoaderCircle className="desktop-chat__spin" size={18} aria-hidden="true" />
                ) : voiceInput.status === 'listening' || voiceInput.status === 'recording' ? (
                  <Square size={15} fill="currentColor" aria-hidden="true" />
                ) : (
                  <Mic size={18} aria-hidden="true" />
                )}
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
      {feedbackDialog ? (
        <FeedbackDialog
          category={feedbackCategory}
          reason={feedbackReason}
          type={feedbackDialog.type}
          onCategoryChange={setFeedbackCategory}
          onClose={() => setFeedbackDialog(null)}
          onReasonChange={setFeedbackReason}
          onSubmit={handleSubmitFeedback}
        />
      ) : null}
      {mediaPermissionRequest ? (
        <MediaPermissionDialog
          request={mediaPermissionRequest}
          onRespond={handleMediaPermissionResponse}
        />
      ) : null}
      {isScreenCaptureOpen ? (
        <div className="desktop-chat__media-backdrop" role="presentation">
          <button
            className="desktop-chat__media-dismiss"
            type="button"
            aria-label="关闭截屏选择"
            onClick={() => {
              setIsScreenCaptureOpen(false)
              setScreenSources([])
            }}
          />
          <section
            className="desktop-chat__media-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="desktop-screen-capture-title"
          >
            <header>
              <div>
                <h2 id="desktop-screen-capture-title">选择截屏来源</h2>
                <p>仅会将你确认的画面添加到当前消息。</p>
              </div>
              <button
                type="button"
                aria-label="关闭截屏选择"
                title="关闭"
                onClick={() => {
                  setIsScreenCaptureOpen(false)
                  setScreenSources([])
                }}
              >
                <X size={17} aria-hidden="true" />
              </button>
            </header>
            <div className="desktop-chat__screen-source-list">
              {screenSources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  aria-label={`选择截屏来源：${source.name}`}
                  onClick={() => void handleSelectScreenSource(source)}
                >
                  <img src={source.thumbnailDataUrl} alt={`${source.name} 截屏预览`} />
                  <span>{source.name}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
      {isCameraOpen ? (
        <div className="desktop-chat__media-backdrop" role="presentation">
          <button
            className="desktop-chat__media-dismiss"
            type="button"
            aria-label="关闭摄像头"
            onClick={closeCamera}
          />
          <section
            className="desktop-chat__media-dialog desktop-chat__camera-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="desktop-camera-title"
          >
            <header>
              <div>
                <h2 id="desktop-camera-title">摄像头拍照</h2>
                <p>照片仅在你发送消息后才会上传。</p>
              </div>
              <button type="button" aria-label="关闭摄像头" title="关闭" onClick={closeCamera}>
                <X size={17} aria-hidden="true" />
              </button>
            </header>
            <div className="desktop-chat__camera-preview">
              {cameraStream ? <video ref={cameraVideoRef} autoPlay muted playsInline /> : null}
              {!cameraStream && !cameraError ? (
                <LoaderCircle
                  className="desktop-chat__spin"
                  size={24}
                  aria-label="正在打开摄像头"
                />
              ) : null}
              {cameraError ? <p role="alert">{cameraError}</p> : null}
            </div>
            <footer>
              <button type="button" onClick={closeCamera}>
                取消
              </button>
              <button
                className="desktop-chat__camera-capture"
                type="button"
                disabled={!cameraStream || Boolean(cameraError)}
                onClick={() => void handleCaptureCameraPhoto()}
              >
                拍照
              </button>
            </footer>
          </section>
        </div>
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
