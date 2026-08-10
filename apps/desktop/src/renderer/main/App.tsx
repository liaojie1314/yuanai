import {
  Bot,
  ChevronDown,
  CircleAlert,
  FileText,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  Plus,
  SendHorizontal,
  Settings,
  Square,
  Trash2,
  Info,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react'
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

const SUGGESTIONS = ['帮我梳理今天的工作重点', '解释这段代码的设计思路', '把下面内容改写得更清晰']

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
  const [selectedModelId, setSelectedModelId] = useState(FALLBACK_MODEL.id)
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [actionError, setActionError] = useState('')
  const messageEndRef = useRef<HTMLDivElement>(null)

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
    if (!content || isStreaming) return
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
      setDraft('')
      await stream.send({
        convId: conversationId,
        content,
        model: selectedModel.id,
        onError: (error) => setActionError(getErrorMessage(error, '消息发送失败，请重试')),
      })
    } catch (error: unknown) {
      setActionError(getErrorMessage(error, '消息发送失败，请重试'))
    }
  }

  return (
    <main className="desktop-chat" aria-label="元AI 聊天">
      <aside className="desktop-chat__sidebar" aria-label="会话列表">
        <div className="desktop-chat__brand">
          <span aria-hidden="true">元</span>
          <strong>元AI</strong>
        </div>
        <button
          className="desktop-chat__new-conversation"
          type="button"
          disabled={createConversation.isPending || isStreaming}
          onClick={() => void handleCreateConversation()}
        >
          {createConversation.isPending ? (
            <LoaderCircle className="desktop-chat__spin" size={17} />
          ) : (
            <Plus size={17} />
          )}
          新建会话
        </button>
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
          <div>
            <p className="desktop-chat__eyebrow">当前会话</p>
            <h1>{activeConversation ? getConversationTitle(activeConversation) : '开始新对话'}</h1>
          </div>
          <label className="desktop-chat__model-select">
            <span className="desktop-chat__sr-only">选择模型</span>
            <select
              value={selectedModel.id}
              onChange={(event) => setSelectedModelId(event.target.value)}
            >
              {availableModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
            <ChevronDown size={15} aria-hidden="true" />
          </label>
        </header>

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
                <Bot size={28} />
              </div>
              <h2>有什么想一起完成？</h2>
              <div className="desktop-chat__suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => setDraft(suggestion)}>
                    {suggestion}
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
          <textarea
            aria-label="输入消息"
            rows={1}
            value={draft}
            placeholder="发送消息"
            disabled={isStreaming}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void handleSendMessage()
              }
            }}
          />
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
              disabled={!draft.trim()}
            >
              <SendHorizontal size={18} />
            </button>
          )}
        </form>
      </section>
    </main>
  )
}
