import {
  Brain,
  Bot,
  Calculator,
  Check,
  ChevronDown,
  CircleAlert,
  Code2,
  FileText,
  Globe2,
  Image,
  Languages,
  LoaderCircle,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Paperclip,
  SendHorizontal,
  Share2,
  Sparkles,
  Settings,
  Square,
  Trash2,
  X,
  Info,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import {
  useConversations,
  useCreateConversation,
  useDeleteConversation,
  useMessages,
  useModels,
  useStream,
  useUpdateConversation,
  uploadFileSmart,
} from '@yuanai/core/hooks'
import { useChatStore } from '@yuanai/core/stores'
import { Role, type AIModel, type Conversation, type Message } from '@yuanai/types'

const FALLBACK_MODEL: AIModel = {
  id: 'gpt-4o',
  name: 'GPT-4o',
  provider: 'openai',
  description: '通用多模态模型',
  supportsVision: true,
  supportsFiles: true,
  contextLength: 128000,
  isDefault: true,
}

const DEFAULT_MODELS: AIModel[] = [FALLBACK_MODEL]
const EMPTY_CONVERSATIONS: Conversation[] = []
const EMPTY_MESSAGES: Message[] = []

const SUGGESTIONS = [
  {
    description: '帮我写一个关于时间旅行的科幻短篇',
    icon: Sparkles,
    title: '创意写作',
  },
  {
    description: '帮我排查这段代码为什么报 TypeError',
    icon: Code2,
    title: '代码调试',
  },
  {
    description: '搜索今天最新的 AI 行业动态',
    icon: Globe2,
    title: '联网搜索',
  },
  {
    description: '用简单的方式解释量子纠缠是什么',
    icon: Calculator,
    title: '学习辅导',
  },
] as const

const CAPABILITIES = [
  { icon: Globe2, label: '联网搜索' },
  { icon: Code2, label: '代码生成' },
  { icon: Image, label: '图片理解' },
  { icon: FileText, label: '文件分析' },
  { icon: Calculator, label: '数学推导' },
  { icon: Languages, label: '多语种翻译' },
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

function formatConversationTime(value: string | null): string {
  if (!value) return ''
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(time)
}

function getConversationTitle(conversation: Conversation): string {
  return conversation.title.trim() || '新对话'
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
  onSelect(id: string): void
  onRenameValueChange(value: string): void
  onRenameStart(conversation: Conversation): void
  onRenameSave(conversation: Conversation): void
  onRemove(conversation: Conversation): void
}

function ConversationItem({
  conversation,
  active,
  renaming,
  renameValue,
  onSelect,
  onRenameValueChange,
  onRenameStart,
  onRenameSave,
  onRemove,
}: ConversationItemProps): ReactElement {
  return (
    <li
      className={
        active
          ? 'desktop-chat__conversation desktop-chat__conversation--active'
          : 'desktop-chat__conversation'
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
          onClick={() => onSelect(conversation.id)}
        >
          <MessageSquareText size={16} aria-hidden="true" />
          <span>{getConversationTitle(conversation)}</span>
          <time dateTime={conversation.lastMessageAt ?? undefined}>
            {formatConversationTime(conversation.lastMessageAt)}
          </time>
        </button>
      )}
      <div className="desktop-chat__conversation-actions">
        <button
          type="button"
          title="重命名会话"
          aria-label="重命名会话"
          onClick={() => onRenameStart(conversation)}
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          title="删除会话"
          aria-label="删除会话"
          onClick={() => onRemove(conversation)}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  )
}

/** 提供桌面端的会话列表、消息历史和 SSE 流式聊天体验。 */
export function App(): ReactElement {
  const conversationsQuery = useConversations()
  const createConversation = useCreateConversation()
  const deleteConversation = useDeleteConversation()
  const updateConversation = useUpdateConversation()
  const modelsQuery = useModels()
  const stream = useStream()
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
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
  const [actionError, setActionError] = useState('')
  const messageEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const conversations = conversationsQuery.data ?? EMPTY_CONVERSATIONS
  const availableModels = modelsQuery.data?.length ? modelsQuery.data : DEFAULT_MODELS
  const selectedModel =
    availableModels.find((model) => model.id === selectedModelId) ??
    availableModels.find((model) => model.isDefault) ??
    FALLBACK_MODEL
  const messagesQuery = useMessages(activeConversationId ?? '')
  const messages = messagesQuery.data ?? EMPTY_MESSAGES
  const streamingConversationId = useChatStore((state) => state.streamingConvId)
  const streamingContent = useChatStore((state) => state.streamingContent)
  const streamingThinking = useChatStore((state) => state.streamingThink)
  const optimisticUserMessage = useChatStore((state) => state.optimisticUserMsg)
  const isStreaming =
    activeConversationId !== null && streamingConversationId === activeConversationId
  const activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ?? null
  const visibleConversations = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    if (!normalizedSearch) return conversations
    return conversations.filter((conversation) =>
      getConversationTitle(conversation).toLocaleLowerCase().includes(normalizedSearch)
    )
  }, [conversations, search])

  useEffect(() => {
    if (
      activeConversationId &&
      conversations.some((conversation) => conversation.id === activeConversationId)
    ) {
      return
    }
    setActiveConversationId(conversations[0]?.id ?? null)
  }, [activeConversationId, conversations])

  useEffect(() => {
    if (availableModels.some((model) => model.id === selectedModelId)) return
    setSelectedModelId(availableModels[0]?.id ?? FALLBACK_MODEL.id)
  }, [availableModels, selectedModelId])

  useEffect(() => {
    if (!messageEndRef.current?.scrollIntoView) return
    messageEndRef.current.scrollIntoView({ block: 'end' })
  }, [activeConversationId, messages, optimisticUserMessage, streamingContent, streamingThinking])

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
    if (createConversation.isPending) return
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

  async function handleOpenSettings(): Promise<void> {
    try {
      await window.yuanai.window.openSettings()
    } catch (error: unknown) {
      setActionError(getErrorMessage(error, '无法打开设置，请稍后重试'))
    }
  }

  async function handleOpenAbout(): Promise<void> {
    try {
      await window.yuanai.window.openAbout()
    } catch (error: unknown) {
      setActionError(getErrorMessage(error, '无法打开关于窗口，请稍后重试'))
    }
  }

  function handleSelectConversation(conversationId: string): void {
    if (isStreaming) return
    setActionError('')
    setActiveConversationId(conversationId)
  }

  function handleSelectModel(modelId: string): void {
    setSelectedModelId(modelId)
    setIsModelMenuOpen(false)
  }

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>): void {
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
    setRenamingConversationId(conversation.id)
    setRenameValue(getConversationTitle(conversation))
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

  async function handleRemoveConversation(conversation: Conversation): Promise<void> {
    if (isStreaming || !window.confirm(`确定删除“${getConversationTitle(conversation)}”吗？`))
      return
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
    }
  }

  async function handleSendMessage(event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault()
    const content = draft.trim()
    if (!content || isStreaming || isUploadingAttachments) return
    setActionError('')
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
            <button type="button" aria-label="开启临时对话" title="开启临时对话" disabled>
              <MessageSquareText size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="新建会话"
              title="新建会话"
              disabled={createConversation.isPending || isStreaming}
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
        <nav className="desktop-chat__conversation-nav" aria-label="最近会话">
          {conversationsQuery.isLoading ? (
            <div className="desktop-chat__sidebar-state">
              <LoaderCircle className="desktop-chat__spin" size={18} />
            </div>
          ) : visibleConversations.length > 0 ? (
            <ul>
              {visibleConversations.map((conversation) => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === activeConversationId}
                  renaming={conversation.id === renamingConversationId}
                  renameValue={renameValue}
                  onSelect={handleSelectConversation}
                  onRenameValueChange={setRenameValue}
                  onRenameStart={handleStartRename}
                  onRenameSave={(item) => void handleSaveRename(item)}
                  onRemove={(item) => void handleRemoveConversation(item)}
                />
              ))}
            </ul>
          ) : (
            <p className="desktop-chat__sidebar-state">{search ? '未找到会话' : '还没有会话'}</p>
          )}
        </nav>
        <div className="desktop-chat__system-actions" aria-label="应用操作">
          <button
            type="button"
            aria-label="打开设置"
            title="打开设置"
            onClick={() => void handleOpenSettings()}
          >
            <Settings size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="关于元AI"
            title="关于元AI"
            onClick={() => void handleOpenAbout()}
          >
            <Info size={17} aria-hidden="true" />
          </button>
        </div>
      </aside>

      <section className="desktop-chat__workspace">
        <header className="desktop-chat__header">
          <div className="desktop-chat__header-side">
            <h1 className="desktop-chat__sr-only">
              {activeConversation ? getConversationTitle(activeConversation) : '开始新对话'}
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
            <span>{selectedModel.name}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          <div className="desktop-chat__header-side desktop-chat__header-side--end">
            <button
              className="desktop-chat__header-action"
              type="button"
              aria-label="分享对话"
              title="分享对话"
              disabled={!activeConversation}
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
              {availableModels.map((model) => {
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
            </div>
          </>
        ) : null}

        {actionError ? (
          <p className="desktop-chat__alert" role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            {actionError}
          </p>
        ) : null}

        <div className="desktop-chat__messages" aria-busy={messagesQuery.isLoading}>
          {messagesQuery.isLoading && activeConversationId ? (
            <div className="desktop-chat__messages-loading">
              <LoaderCircle className="desktop-chat__spin" size={22} />
            </div>
          ) : messages.length || isStreaming ? (
            <div className="desktop-chat__message-list">
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              {isStreaming && optimisticUserMessage ? (
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
                {CAPABILITIES.map(({ icon: Icon, label }) => (
                  <span key={label}>
                    <Icon size={14} aria-hidden="true" />
                    {label}
                  </span>
                ))}
              </div>
              <div className="desktop-chat__suggestions">
                {SUGGESTIONS.map(({ description, icon: Icon, title }) => (
                  <button
                    key={title}
                    type="button"
                    aria-label={title}
                    onClick={() => setDraft(description)}
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
            aria-label="输入消息"
            rows={1}
            value={draft}
            placeholder="发送消息"
            disabled={isStreaming || isUploadingAttachments}
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
                onChange={handleAttachmentChange}
              />
              <button
                className={attachments.length > 0 ? 'is-active' : undefined}
                type="button"
                aria-label="添加附件"
                title="添加附件"
                disabled={isStreaming || isUploadingAttachments}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={18} aria-hidden="true" />
              </button>
              <button
                className={isWebSearchEnabled ? 'is-active' : undefined}
                type="button"
                aria-label="联网搜索"
                title="联网搜索"
                aria-pressed={isWebSearchEnabled}
                disabled={isStreaming || isUploadingAttachments}
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
                disabled={isStreaming || isUploadingAttachments}
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
                  disabled={!draft.trim() || isUploadingAttachments}
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
    </main>
  )
}
