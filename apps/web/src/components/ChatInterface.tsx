'use client'

import { useState, useRef, useEffect, useCallback, type JSX } from 'react'
import { useRouter } from 'next/navigation'
import SettingsModal from '@/components/settings/SettingsModal'
import { useChatStore } from '@yuanai/core/stores'
import { useAuthStore } from '@yuanai/core/stores'
import { useStream } from '@yuanai/core/hooks'
import {
  useConversations,
  useCreateConversation,
  useDeleteConversation,
  useDeleteConversations,
  useUpdateConversation,
  useMessages,
  useLogout,
} from '@yuanai/core/hooks'
import type { Conversation, Message } from '@yuanai/types'
import type { MockConversation, MockMessage, MessagePart, ConvGroup } from '@yuanai/core/stores'
import {
  SquarePen,
  Search,
  MoreVertical,
  Pin,
  Pencil,
  Trash2,
  CheckSquare,
  Settings,
  Globe,
  PanelRight,
  Share2,
  MoreHorizontal,
  ChevronDown,
  Check,
  Sparkles,
  Bug,
  FileText,
  Languages,
  GraduationCap,
  Paperclip,
  Mic,
  SendHorizontal,
  Copy,
  RotateCcw,
  ThumbsUp,
  ThumbsDown,
  ArrowDown,
  Brain,
  Menu,
  PanelLeft,
  X,
  LogOut,
  User,
  Square,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────
interface Model {
  id: string
  name: string
  desc: string
  provider: string
  ctx: string
  color: string
  letter: string
  gradient?: string
}

interface AttachFile {
  id: string
  file: File
  preview: string
  type: 'image' | 'doc'
}

// ── Static constants ─────────────────────────────────
const MODELS: Model[] = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    desc: '最强大的多模态模型',
    provider: 'OpenAI',
    ctx: '128K',
    color: '#10B981',
    letter: 'G',
    gradient: 'linear-gradient(135deg,#10B981,#3B82F6)',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    desc: '快速轻量，日常任务',
    provider: 'OpenAI',
    ctx: '128K',
    color: '#3B82F6',
    letter: 'G',
    gradient: 'linear-gradient(135deg,#3B82F6,#60A5FA)',
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    desc: '代码与分析专家',
    provider: 'Anthropic',
    ctx: '200K',
    color: '#8B5CF6',
    letter: 'C',
    gradient: 'linear-gradient(135deg,#7C3AED,#8B5CF6)',
  },
  {
    id: 'deepseek-chat',
    name: 'DeepSeek-V3',
    desc: '中文理解强，高性价比',
    provider: '国内模型',
    ctx: '64K',
    color: '#3B82F6',
    letter: 'D',
    gradient: 'linear-gradient(135deg,#1D4ED8,#3B82F6)',
  },
]

const SUGGESTION_CARDS = [
  {
    icon: 'sparkles',
    title: '创意写作',
    desc: '帮我写一个关于时间旅行的科幻短篇',
    prompt: '帮我写一个关于时间旅行的科幻短篇故事',
  },
  {
    icon: 'bug',
    title: '代码调试',
    desc: '帮我排查这段代码为什么报 TypeError',
    prompt: '帮我排查这段代码为什么报 TypeError：',
  },
  {
    icon: 'globe',
    title: '联网搜索',
    desc: '搜索今天最新的 AI 行业动态',
    prompt: '搜索今天最新的 AI 行业动态',
  },
  {
    icon: 'graduation',
    title: '学习辅导',
    desc: '用简单的方式解释量子纠缠是什么',
    prompt: '用简单方式解释量子纠缠是什么',
  },
]

// ── Adapters — 将后端类型转换为前端展示结构 ─────────────────
function convGroup(conv: Conversation): ConvGroup {
  if (conv.isPinned) return 'pinned'
  const ts = conv.lastMessageAt ?? conv.createdAt
  const age = Date.now() - new Date(ts).getTime()
  if (age < 86_400_000) return 'today'
  if (age < 172_800_000) return 'yesterday'
  return 'week'
}

function apiConvToMock(conv: Conversation): MockConversation {
  const ts = conv.lastMessageAt ?? conv.createdAt
  return {
    id: conv.id,
    title: conv.title,
    group: convGroup(conv),
    updatedAt: new Date(ts).getTime(),
  }
}

function apiMsgToMock(msg: Message): MockMessage {
  return {
    id: msg.id,
    role: msg.role as 'user' | 'assistant',
    parts: [{ type: 'text' as const, content: msg.content }],
    createdAt: new Date(msg.createdAt).getTime(),
  }
}

function isDark(): boolean {
  const t = document.documentElement.getAttribute('data-theme')
  return t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme:dark)').matches)
}

// ── Message part renderer ─────────────────────────────
function renderInline(text: string): JSX.Element[] {
  const parts: JSX.Element[] = []
  const re = /(\*\*(.+?)\*\*|`([^`]+)`)/g
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(<span key={key++}>{text.slice(last, match.index)}</span>)
    }
    if (match[0].startsWith('**')) {
      parts.push(<strong key={key++}>{match[2]}</strong>)
    } else {
      parts.push(<code key={key++}>{match[3]}</code>)
    }
    last = match.index + match[0].length
  }
  if (last < text.length) {
    parts.push(<span key={key++}>{text.slice(last)}</span>)
  }
  return parts
}

function TextPart({ content }: { content: string }): JSX.Element {
  const paragraphs = content.split('\n\n').filter(Boolean)
  return (
    <div className="ch-msg-content">
      {paragraphs.map((para, i) => (
        <p key={i}>{renderInline(para)}</p>
      ))}
    </div>
  )
}

function CodePart({ lang, code }: { lang?: string; code?: string }): JSX.Element {
  return (
    <div className="ch-code-block">
      <div className="ch-code-head">
        <span className="ch-code-lang">{lang ?? 'Code'}</span>
        <div className="ch-code-acts">
          <button
            className="ch-code-act"
            onClick={() => {
              void navigator.clipboard.writeText(code ?? '')
            }}
          >
            <Copy size={12} /> 复制
          </button>
        </div>
      </div>
      <pre className="ch-code-body">{code}</pre>
    </div>
  )
}

function MessagePartRenderer({ part }: { part: MessagePart }): JSX.Element {
  if (part.type === 'code') {
    return (
      <CodePart
        {...(part.lang !== undefined ? { lang: part.lang } : {})}
        {...(part.code !== undefined ? { code: part.code } : {})}
      />
    )
  }
  return <TextPart content={part.content ?? ''} />
}

// ── Think block ───────────────────────────────────────
function ThinkBlock({ content }: { content: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className={`ch-think-block ${open ? 'open' : ''}`} data-state="done">
      <div className="ch-think-hd" onClick={() => setOpen((o) => !o)}>
        <div className="ch-think-hd-l">
          <span className="ch-think-ic">
            <Brain size={14} />
          </span>
          <span className="ch-think-lbl">已完成思考</span>
        </div>
        <div className="ch-think-hd-r">
          <span className="ch-think-chev">
            <ChevronDown size={13} />
          </span>
        </div>
      </div>
      <div className="ch-think-body">
        <div className="ch-think-text">{content}</div>
      </div>
    </div>
  )
}

// ── Message components ────────────────────────────────
function UserMessage({ msg }: { msg: MockMessage }): JSX.Element {
  const text = msg.parts.find((p) => p.type === 'text')?.content ?? ''
  return (
    <div className="ch-msg ch-msg-user">
      <div className="ch-msg-body">
        <div className="ch-msg-bubble">{text}</div>
        <div className="ch-msg-acts">
          <button className="ch-msg-act">
            <Pencil size={12} /> 编辑
          </button>
        </div>
      </div>
    </div>
  )
}

function AIMessage({
  msg,
  isStreaming,
  streamingContent,
  onFill,
}: {
  msg: MockMessage
  isStreaming: boolean
  streamingContent: string
  onFill: (text: string) => void
}): JSX.Element {
  return (
    <div className="ch-msg ch-msg-ai">
      <div className="ch-msg-ai-av">元</div>
      <div className="ch-msg-body">
        {msg.thinkContent && <ThinkBlock content={msg.thinkContent} />}
        {isStreaming ? (
          <div className="ch-msg-content">
            <p>
              {renderInline(streamingContent)}
              <span className="ch-cursor" />
            </p>
          </div>
        ) : (
          msg.parts.map((part, i) => <MessagePartRenderer key={i} part={part} />)
        )}
        {!isStreaming && (
          <div className="ch-msg-acts">
            <button
              className="ch-msg-act"
              onClick={() => {
                const text = msg.parts
                  .filter((p) => p.type === 'text')
                  .map((p) => p.content ?? '')
                  .join('\n')
                void navigator.clipboard.writeText(text)
              }}
            >
              <Copy size={12} /> 复制
            </button>
            <button className="ch-msg-act">
              <RotateCcw size={12} /> 重新生成
            </button>
            <button className="ch-msg-act">
              <ThumbsUp size={12} /> 点赞
            </button>
            <button className="ch-msg-act">
              <ThumbsDown size={12} /> 点踩
            </button>
          </div>
        )}
        {!isStreaming && msg.followUps && msg.followUps.length > 0 && (
          <div className="ch-followups">
            {msg.followUps.map((fu) => (
              <button key={fu} className="ch-fu" onClick={() => onFill(fu)}>
                {fu}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Props ────────────────────────────────────────────
interface ChatInterfaceProps {
  initialConvId?: string
}

// ── Main component ────────────────────────────────────
export default function ChatInterface({ initialConvId }: ChatInterfaceProps): JSX.Element {
  const router = useRouter()

  // ── Auth ──
  const user = useAuthStore((s) => s.user)
  const { mutate: doLogout } = useLogout()

  // ── Streaming state (store) ──
  const streamingConvId = useChatStore((s) => s.streamingConvId)
  const streamingContent = useChatStore((s) => s.streamingContent)
  const optimisticUserMsg = useChatStore((s) => s.optimisticUserMsg)

  // ── Server state (TanStack Query) ──
  const { data: apiConversations = [] } = useConversations()
  const conversations = apiConversations.map(apiConvToMock)

  const { mutateAsync: createConvAsync } = useCreateConversation()
  const { mutate: deleteConv } = useDeleteConversation()
  const { mutate: deleteConvs } = useDeleteConversations()
  const { mutate: updateConv } = useUpdateConversation()

  const stream = useStream()

  // ── View state ──
  const [view, setView] = useState<'empty' | 'chat'>(() => (initialConvId ? 'chat' : 'empty'))
  const [activeConv, setActiveConv] = useState<string>(() => initialConvId ?? '')

  useEffect(() => {
    if (initialConvId) {
      setView('chat')
      setActiveConv(initialConvId)
    } else {
      setView('empty')
      setActiveConv('')
    }
  }, [initialConvId])

  // ── Messages for active conv ──
  const { data: apiMessages = [] } = useMessages(activeConv)
  const messages = apiMessages.map(apiMsgToMock)

  // ── Sidebar state ──
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [search, setSearch] = useState('')
  const [multiSel, setMultiSel] = useState(false)
  const [selectedConvs, setSelectedConvs] = useState<Set<string>>(new Set())

  // ── UI state ──
  const [artifactOpen, setArtifactOpen] = useState(false)
  const [webSearch, setWebSearch] = useState(true)
  const [activeModel, setActiveModel] = useState<Model>(MODELS[0] as Model)
  const [modelDropOpen, setModelDropOpen] = useState(false)
  const [userPanelOpen, setUserPanelOpen] = useState(false)
  const [cvMenuOpen, setCvMenuOpen] = useState<string | null>(null)
  const [cvMenuPos, setCvMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [dark, setDark] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // ── Input state ──
  const [inputValue, setInputValue] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)

  // ── Attachment state ──
  const [files, setFiles] = useState<AttachFile[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Scroll FAB ──
  const [showScrollFab, setShowScrollFab] = useState(false)

  // ── Refs ──
  const modelBtnRef = useRef<HTMLButtonElement>(null)
  const userTriggerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const msgsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setDark(isDark())
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        newChat()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 流式输出时自动滚动
  useEffect(() => {
    if (isStreaming && msgsEndRef.current) {
      msgsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [streamingContent, isStreaming])

  const closeAllPanels = (): void => {
    setModelDropOpen(false)
    setUserPanelOpen(false)
    setCvMenuOpen(null)
  }

  const toggleTheme = (): void => {
    const next = dark ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('theme', next)
    setDark(!dark)
  }

  const newChat = (): void => {
    setInputValue('')
    setSidebarOpen(false)
    router.push('/chat')
  }

  const pickConv = (id: string): void => {
    setSidebarOpen(false)
    router.push('/chat/' + id)
  }

  const toggleCollapse = (): void => setSidebarCollapsed((c) => !c)
  const openSidebar = (): void => setSidebarOpen(true)
  const closeSidebar = (): void => setSidebarOpen(false)

  const toggleModelDrop = (e: React.MouseEvent): void => {
    e.stopPropagation()
    setModelDropOpen((o) => !o)
    setUserPanelOpen(false)
  }

  const selectModel = (m: Model): void => {
    setActiveModel(m)
    setModelDropOpen(false)
  }

  const toggleUserPanel = (e: React.MouseEvent): void => {
    e.stopPropagation()
    setUserPanelOpen((o) => !o)
    setModelDropOpen(false)
  }

  const openCvMenu = (e: React.MouseEvent, id: string): void => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setCvMenuPos({
      top: rect.bottom + 4,
      left: Math.min(rect.right - 160, window.innerWidth - 170),
    })
    setCvMenuOpen((cv) => (cv === id ? null : id))
  }

  const openCvMenuOnContext = (e: React.MouseEvent, id: string): void => {
    e.stopPropagation()
    e.preventDefault()
    setCvMenuPos({
      top: e.clientY + 4,
      left: Math.min(e.clientX + 4, window.innerWidth - 170),
    })
    setCvMenuOpen(id)
  }

  const toggleArtifact = (): void => setArtifactOpen((o) => !o)

  const onInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setInputValue(e.target.value)
    const ta = e.target
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
  }

  const onInputKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (inputValue.trim() && !isStreaming) void sendMessage()
    }
  }

  const sendMessage = async (): Promise<void> => {
    if (!inputValue.trim() || isStreaming) return

    let convId = activeConv
    const text = inputValue.trim()

    if (!convId) {
      // 无当前会话时先创建，再发送消息
      try {
        const newConv = await createConvAsync({
          model: activeModel.id,
          title: text.slice(0, 30) + (text.length > 30 ? '…' : ''),
        })
        convId = newConv.id
        setActiveConv(convId)
        setView('chat')
        router.push('/chat/' + convId)
      } catch {
        return
      }
    }

    setInputValue('')
    setFiles([])
    if (inputRef.current) inputRef.current.style.height = 'auto'

    setIsStreaming(true)
    void stream.send({
      convId,
      content: text,
      model: activeModel.id,
      onEnd: () => setIsStreaming(false),
    })
  }

  const stopStreaming = (): void => {
    stream.stop()
    setIsStreaming(false)
  }

  const fill = useCallback((text: string): void => {
    setInputValue(text)
    setTimeout(() => {
      inputRef.current?.focus()
      const ta = inputRef.current
      if (ta) {
        ta.style.height = 'auto'
        ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
        ta.setSelectionRange(ta.value.length, ta.value.length)
      }
    }, 0)
  }, [])

  const onScroll = (): void => {
    if (!contentRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = contentRef.current
    setShowScrollFab(scrollHeight - scrollTop - clientHeight > 100)
  }

  const toBottom = (): void => {
    contentRef.current?.scrollTo({ top: contentRef.current.scrollHeight, behavior: 'smooth' })
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const picked = Array.from(e.target.files ?? [])
    const newFiles: AttachFile[] = picked.map((f) => ({
      id: Math.random().toString(36).slice(2),
      file: f,
      preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : f.name,
      type: f.type.startsWith('image/') ? 'image' : 'doc',
    }))
    setFiles((prev) => [...prev, ...newFiles])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeFile = (id: string): void => {
    setFiles((prev) => {
      const removed = prev.find((f) => f.id === id)
      if (removed?.type === 'image') URL.revokeObjectURL(removed.preview)
      return prev.filter((f) => f.id !== id)
    })
  }

  const appClass = [
    'ch-app',
    view === 'empty' ? 'v-empty' : 'v-chat',
    sidebarCollapsed ? 'sb-col' : '',
    multiSel ? 'multi-sel' : '',
    artifactOpen ? 'ap-open' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const convTitle = conversations.find((c) => c.id === activeConv)?.title ?? '新对话'

  const filteredConvs = search
    ? conversations.filter((c) => c.title.includes(search))
    : conversations

  const groupedConvs = {
    pinned: filteredConvs.filter((c) => c.group === 'pinned'),
    today: filteredConvs.filter((c) => c.group === 'today'),
    yesterday: filteredConvs.filter((c) => c.group === 'yesterday'),
    week: filteredConvs.filter((c) => c.group === 'week'),
  }

  const charCount = inputValue.length

  // 用于侧边栏显示的用户信息
  const userInitial = user?.username?.charAt(0).toUpperCase() ?? '?'
  const userName = user?.username ?? '未登录'
  const userEmail = user?.email ?? ''

  const isThisStreaming = streamingConvId === activeConv

  return (
    <div className={appClass} id="app">
      {/* ── Backdrop overlay ── */}
      {(modelDropOpen || userPanelOpen || !!cvMenuOpen) && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={closeAllPanels} />
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.doc,.docx,.txt"
        style={{ display: 'none' }}
        onChange={onFileChange}
      />

      {/* ── Sidebar ───────────────────────────────── */}
      <aside className={`ch-sidebar ${sidebarOpen ? 'open' : ''}`} id="sidebar">
        {/* Header */}
        <div className="ch-sb-head">
          <div className="ch-brand">
            <div className="ch-brand-logo">元</div>
            <span className="ch-sb-lbl">元AI</span>
          </div>
          <button
            className="ch-sb-new"
            title="新建对话 (Ctrl+N)"
            onClick={newChat}
            aria-label="新建对话"
          >
            <SquarePen size={17} />
          </button>
        </div>

        {/* Search */}
        <div className="ch-sb-search">
          <div className="ch-s-wrap">
            <Search size={14} color="var(--fg3)" />
            <input
              type="text"
              placeholder="搜索对话…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Multi-select bar */}
        {multiSel && (
          <div className="ch-multi-bar">
            <span
              className="ch-multi-selall"
              onClick={() => {
                if (selectedConvs.size === conversations.length) setSelectedConvs(new Set())
                else setSelectedConvs(new Set(conversations.map((c) => c.id)))
              }}
            >
              {selectedConvs.size === conversations.length ? '取消全选' : '全选'}
            </span>
            <span className="ch-multi-c">已选 {selectedConvs.size} 个</span>
            <button
              className="ch-multi-del"
              disabled={selectedConvs.size === 0}
              onClick={() => {
                deleteConvs([...selectedConvs])
                setSelectedConvs(new Set())
                setMultiSel(false)
              }}
            >
              删除选中
            </button>
            <span
              className="ch-multi-cancel"
              onClick={() => {
                setMultiSel(false)
                setSelectedConvs(new Set())
              }}
            >
              取消
            </span>
          </div>
        )}

        {/* Conversation list */}
        <div className="ch-sb-convs">
          {groupedConvs.pinned.length > 0 && (
            <div className="ch-conv-group">
              <div className="ch-cg-lbl">置顶</div>
              {groupedConvs.pinned.map((conv) => (
                <ConvItem
                  key={conv.id}
                  conv={conv}
                  active={activeConv === conv.id}
                  pinned
                  menuOpen={cvMenuOpen === conv.id}
                  multiSel={multiSel}
                  selected={selectedConvs.has(conv.id)}
                  onPick={() => pickConv(conv.id)}
                  onToggle={() =>
                    setSelectedConvs((prev) => {
                      const next = new Set(prev)
                      if (next.has(conv.id)) next.delete(conv.id)
                      else next.add(conv.id)
                      return next
                    })
                  }
                  onMenuOpen={(e) => openCvMenu(e, conv.id)}
                  onContextMenu={(e) => openCvMenuOnContext(e, conv.id)}
                />
              ))}
            </div>
          )}
          {groupedConvs.today.length > 0 && (
            <div className="ch-conv-group">
              <div className="ch-cg-lbl">今天</div>
              {groupedConvs.today.map((conv) => (
                <ConvItem
                  key={conv.id}
                  conv={conv}
                  active={activeConv === conv.id}
                  menuOpen={cvMenuOpen === conv.id}
                  multiSel={multiSel}
                  selected={selectedConvs.has(conv.id)}
                  onPick={() => pickConv(conv.id)}
                  onToggle={() =>
                    setSelectedConvs((prev) => {
                      const next = new Set(prev)
                      if (next.has(conv.id)) next.delete(conv.id)
                      else next.add(conv.id)
                      return next
                    })
                  }
                  onMenuOpen={(e) => openCvMenu(e, conv.id)}
                  onContextMenu={(e) => openCvMenuOnContext(e, conv.id)}
                />
              ))}
            </div>
          )}
          {groupedConvs.yesterday.length > 0 && (
            <div className="ch-conv-group">
              <div className="ch-cg-lbl">昨天</div>
              {groupedConvs.yesterday.map((conv) => (
                <ConvItem
                  key={conv.id}
                  conv={conv}
                  active={activeConv === conv.id}
                  menuOpen={cvMenuOpen === conv.id}
                  multiSel={multiSel}
                  selected={selectedConvs.has(conv.id)}
                  onPick={() => pickConv(conv.id)}
                  onToggle={() =>
                    setSelectedConvs((prev) => {
                      const next = new Set(prev)
                      if (next.has(conv.id)) next.delete(conv.id)
                      else next.add(conv.id)
                      return next
                    })
                  }
                  onMenuOpen={(e) => openCvMenu(e, conv.id)}
                  onContextMenu={(e) => openCvMenuOnContext(e, conv.id)}
                />
              ))}
            </div>
          )}
          {groupedConvs.week.length > 0 && (
            <div className="ch-conv-group">
              <div className="ch-cg-lbl">过去 7 天</div>
              {groupedConvs.week.map((conv) => (
                <ConvItem
                  key={conv.id}
                  conv={conv}
                  active={activeConv === conv.id}
                  menuOpen={cvMenuOpen === conv.id}
                  multiSel={multiSel}
                  selected={selectedConvs.has(conv.id)}
                  onPick={() => pickConv(conv.id)}
                  onToggle={() =>
                    setSelectedConvs((prev) => {
                      const next = new Set(prev)
                      if (next.has(conv.id)) next.delete(conv.id)
                      else next.add(conv.id)
                      return next
                    })
                  }
                  onMenuOpen={(e) => openCvMenu(e, conv.id)}
                  onContextMenu={(e) => openCvMenuOnContext(e, conv.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* User section */}
        <div className="ch-sb-user" ref={userTriggerRef} onClick={toggleUserPanel}>
          <div className="ch-avatar">{userInitial}</div>
          <div className="ch-sb-uinfo">
            <div className="ch-sb-uname">{userName}</div>
            <div className="ch-sb-uemail">{userEmail}</div>
          </div>
          <button
            className="ch-sb-uset"
            title="设置与账号"
            onClick={(e) => {
              e.stopPropagation()
              setUserPanelOpen((o) => !o)
              setModelDropOpen(false)
            }}
          >
            <Settings size={15} />
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      <div className={`ch-overlay ${sidebarOpen ? 'open' : ''}`} onClick={closeSidebar} />

      {/* ── Main ─────────────────────────────────── */}
      <main className="ch-main">
        {/* Toolbar */}
        <header className="ch-toolbar">
          <div className="ch-tb-l">
            <button
              className="ch-ib ch-hamburger"
              onClick={openSidebar}
              title="菜单"
              aria-label="打开侧边栏"
            >
              <Menu size={18} />
            </button>
            <button
              className="ch-ib ch-collapse-btn"
              onClick={toggleCollapse}
              title={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
            >
              <PanelLeft size={17} />
            </button>
            {view === 'chat' && (
              <button className="ch-conv-name" title="点击重命名">
                {convTitle}
              </button>
            )}
          </div>
          <div className="ch-tb-c">
            <button className="ch-model-btn" ref={modelBtnRef} onClick={toggleModelDrop}>
              <div
                className="ch-m-dot"
                style={{ background: activeModel.gradient ?? activeModel.color }}
              >
                {activeModel.letter}
              </div>
              <span>{activeModel.name}</span>
              <ChevronDown size={12} />
            </button>
          </div>
          <div className="ch-tb-r">
            <button
              className={`ch-ib ${webSearch ? 'on' : ''}`}
              title="联网搜索 (Ctrl+Shift+S)"
              onClick={(e) => {
                e.stopPropagation()
                setWebSearch((w) => !w)
              }}
            >
              <Globe size={16} />
            </button>
            <button
              className={`ch-ib ${artifactOpen ? 'on' : ''}`}
              title="展开内容面板"
              onClick={(e) => {
                e.stopPropagation()
                toggleArtifact()
              }}
            >
              <PanelRight size={16} />
            </button>
            <button className="ch-ib" title="分享对话">
              <Share2 size={16} />
            </button>
            <button className="ch-ib" title="更多操作">
              <MoreHorizontal size={16} />
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="ch-content" ref={contentRef} onScroll={onScroll}>
          {/* Empty state */}
          <div className="ch-empty-state">
            <div className="ch-ai-av">元</div>
            <h1 className="ch-e-title">你好，我是元AI</h1>
            <p className="ch-e-sub">集成多款顶尖 AI 模型，帮你完成任何任务</p>
            <div className="ch-caps">
              <button className="ch-cap" onClick={() => fill('联网搜索最新 AI 行业动态')}>
                <Globe size={14} /> 联网搜索
              </button>
              <button className="ch-cap" onClick={() => fill('帮我写一段')}>
                💻 代码生成
              </button>
              <button className="ch-cap" onClick={() => fill('帮我分析这张图片中的内容')}>
                🎨 图片理解
              </button>
              <button className="ch-cap" onClick={() => fill('帮我总结这份文件的要点')}>
                <FileText size={14} /> 文件分析
              </button>
              <button className="ch-cap" onClick={() => fill('解一道数学题：')}>
                🔢 数学推导
              </button>
              <button className="ch-cap" onClick={() => fill('把下面内容翻译成地道英文：')}>
                <Languages size={14} /> 多语种翻译
              </button>
            </div>
            <div className="ch-sugg-grid">
              {SUGGESTION_CARDS.map((card, i) => (
                <button
                  key={card.title}
                  className="ch-sg-card"
                  style={{ animationDelay: `${i * 60}ms` }}
                  onClick={() => fill(card.prompt)}
                >
                  <div className="ch-sg-head">
                    <span className="ch-sg-icon">
                      {card.icon === 'sparkles' && <Sparkles size={18} />}
                      {card.icon === 'bug' && <Bug size={18} />}
                      {card.icon === 'globe' && <Globe size={18} />}
                      {card.icon === 'graduation' && <GraduationCap size={18} />}
                    </span>
                    <span className="ch-sg-ttl">{card.title}</span>
                  </div>
                  <p className="ch-sg-desc">{card.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Messages */}
          <div className="ch-msgs-scroll">
            <div className="ch-msgs-inner">
              {/* Persisted messages from API */}
              {messages.map((msg) => {
                if (msg.role === 'user') {
                  return <UserMessage key={msg.id} msg={msg} />
                }
                return (
                  <AIMessage
                    key={msg.id}
                    msg={msg}
                    isStreaming={false}
                    streamingContent=""
                    onFill={fill}
                  />
                )
              })}

              {/* Optimistic user message (shown during streaming before API persists it) */}
              {isThisStreaming && optimisticUserMsg && (
                <UserMessage
                  msg={{
                    id: '__opt_user__',
                    role: 'user',
                    parts: [{ type: 'text', content: optimisticUserMsg }],
                    createdAt: Date.now(),
                  }}
                />
              )}

              {/* Streaming AI message */}
              {isThisStreaming && (
                <AIMessage
                  msg={{ id: '__streaming__', role: 'assistant', parts: [], createdAt: Date.now() }}
                  isStreaming={true}
                  streamingContent={streamingContent}
                  onFill={fill}
                />
              )}

              <div ref={msgsEndRef} style={{ height: '20px' }} />
            </div>

            {/* Scroll FAB */}
            <div className={`ch-scroll-fab ${showScrollFab ? '' : 'hide'}`}>
              <button onClick={toBottom} title="回到底部">
                <ArrowDown size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Input area */}
        <div className="ch-input-wrap">
          <div className="ch-input-inner">
            {/* Attachment preview row */}
            {files.length > 0 && (
              <div className="ch-attach-row">
                {files.map((f) =>
                  f.type === 'image' ? (
                    <div key={f.id} className="ch-attach-img">
                      <img src={f.preview} alt={f.file.name} />
                      <button
                        className="ch-attach-rm"
                        onClick={() => removeFile(f.id)}
                        aria-label="移除附件"
                      >
                        <X size={8} />
                      </button>
                    </div>
                  ) : (
                    <div key={f.id} className="ch-attach-doc">
                      <FileText size={14} />
                      <span>{f.preview}</span>
                      <button
                        className="ch-attach-rm-doc"
                        onClick={() => removeFile(f.id)}
                        aria-label="移除附件"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )
                )}
              </div>
            )}
            <textarea
              ref={inputRef}
              className="ch-input-ta"
              placeholder="发送消息…（Enter 发送，Shift+Enter 换行）"
              rows={1}
              value={inputValue}
              onChange={onInputChange}
              onKeyDown={onInputKey}
            />
            <div className="ch-input-tb">
              <button
                className="ch-in-btn"
                title="添加附件"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={18} />
              </button>
              <button className="ch-in-btn" title="语音输入">
                <Mic size={18} />
              </button>
              <button
                className={`ch-in-btn ${webSearch ? 'on' : ''}`}
                title="联网搜索"
                onClick={() => setWebSearch((w) => !w)}
              >
                <Globe size={18} />
              </button>
              <div className="ch-in-sep" />
              <div className="ch-in-r">
                <button className="ch-m-tag" onClick={toggleModelDrop}>
                  <div
                    className="ch-m-dot-sm"
                    style={{ background: activeModel.gradient ?? activeModel.color }}
                  >
                    {activeModel.letter}
                  </div>
                  {activeModel.name}
                </button>
                {charCount > 0 && (
                  <span className={`ch-char-c ${charCount > 3800 ? 'over' : ''}`}>
                    {charCount} / 4000
                  </span>
                )}
                {isStreaming ? (
                  <button
                    className="ch-send-btn streaming on"
                    onClick={stopStreaming}
                    title="停止生成"
                  >
                    <Square size={16} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    className={`ch-send-btn ${inputValue.trim() ? 'on' : ''}`}
                    onClick={() => {
                      void sendMessage()
                    }}
                    disabled={!inputValue.trim()}
                    title="发送 (Enter)"
                  >
                    <SendHorizontal size={20} />
                  </button>
                )}
              </div>
            </div>
          </div>
          <p className="ch-input-hint">元AI 可能犯错，请核实重要信息</p>
        </div>
      </main>

      {/* ── Artifact panel ───────────────────────── */}
      <div className="ch-artifact-panel">
        <div className="ch-ap-head">
          <span className="ch-ap-lang">TypeScript</span>
          <span className="ch-ap-title">ListItem 性能优化示例</span>
          <div style={{ display: 'flex', gap: '4px', marginLeft: 'auto' }}>
            <button className="ch-ib" title="复制全部">
              <Copy size={18} />
            </button>
            <button className="ch-ib" title="关闭" onClick={() => setArtifactOpen(false)}>
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="ch-ap-body">
          <pre>{`import React, { memo, useMemo, useCallback } from 'react'

const ListItem = memo(({ id, label, value, onSelect }) => {
  const display = useMemo(() => \`\${label}：\${value.toLocaleString('zh-CN')} 元\`, [label, value])
  return <div onClick={() => onSelect(id)}>{display}</div>
})`}</pre>
        </div>
        <div className="ch-ap-footer">
          <button className="ch-ap-copy-btn">
            <Copy size={14} /> 复制全部
          </button>
          <span className="ch-ap-finfo">TypeScript · 8 行</span>
        </div>
      </div>

      {/* ── Model dropdown ────────────────────────── */}
      {modelDropOpen && (
        <div
          className="ch-mdrop open"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            zIndex: 200,
            top: (() => {
              const el = modelBtnRef.current
              if (!el) return 80
              return el.getBoundingClientRect().bottom + 8
            })(),
            left: (() => {
              const el = modelBtnRef.current
              if (!el) return '50%'
              const rect = el.getBoundingClientRect()
              return Math.max(8, rect.left - 100)
            })(),
          }}
        >
          {['OpenAI', 'Anthropic', '国内模型'].map((provider) => {
            const models = MODELS.filter((m) => m.provider === provider)
            if (!models.length) return null
            return (
              <div key={provider} className="ch-mdrop-grp">
                <div className="ch-mdrop-lbl">{provider}</div>
                {models.map((m) => (
                  <div
                    key={m.id}
                    className={`ch-mdrop-row ${activeModel.id === m.id ? 'sel' : ''}`}
                    onClick={() => selectModel(m)}
                  >
                    <div className="ch-mlogo" style={{ background: m.gradient ?? m.color }}>
                      {m.letter}
                    </div>
                    <div className="ch-minfo">
                      <div className="ch-mname">{m.name}</div>
                      <div className="ch-mdesc">{m.desc}</div>
                    </div>
                    <div className="ch-mright">
                      <span className="ch-mctx">{m.ctx}</span>
                      <span className="ch-mcheck">
                        <Check size={14} />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {/* ── User panel ───────────────────────────── */}
      {userPanelOpen && (
        <div
          className="ch-upanel open"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            zIndex: 200,
            bottom: (() => {
              const el = userTriggerRef.current
              if (!el) return 72
              return window.innerHeight - el.getBoundingClientRect().top + 8
            })(),
            left: (() => {
              const el = userTriggerRef.current
              if (!el) return 8
              return el.getBoundingClientRect().left
            })(),
          }}
        >
          <div className="ch-up-theme" onClick={toggleTheme}>
            <span className="ch-up-tlbl">深色模式</span>
            <div className={`ch-toggle ${dark ? 'on' : ''}`} />
          </div>
          <div className="ch-up-sep" />
          <div
            className="ch-up-row"
            onClick={() => {
              setUserPanelOpen(false)
              setSettingsOpen(true)
            }}
          >
            <User size={16} /> 个人设置
          </div>
          <div className="ch-up-sep" />
          <div
            className="ch-up-row danger"
            onClick={() => {
              setUserPanelOpen(false)
              doLogout()
            }}
          >
            <LogOut size={16} /> 退出登录
          </div>
        </div>
      )}

      {/* ── Settings modal ───────────────────────── */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* ── Conversation context menus ────────────── */}
      {cvMenuOpen &&
        (() => {
          const conv = conversations.find((c) => c.id === cvMenuOpen)
          const apiConv = apiConversations.find((c) => c.id === cvMenuOpen)
          if (!conv) return null
          return (
            <div
              className="ch-cvmenu open"
              onClick={(e) => e.stopPropagation()}
              style={{ position: 'fixed', zIndex: 300, top: cvMenuPos.top, left: cvMenuPos.left }}
            >
              <div
                className="ch-cvm-row"
                onClick={() => {
                  const newTitle = window.prompt('请输入新名称', conv.title)
                  if (newTitle?.trim()) {
                    updateConv({ id: conv.id, title: newTitle.trim() })
                  }
                  setCvMenuOpen(null)
                }}
              >
                <Pencil size={14} /> 重命名
              </div>
              <div
                className="ch-cvm-row"
                onClick={() => {
                  updateConv({ id: conv.id, isPinned: !(apiConv?.isPinned ?? false) })
                  setCvMenuOpen(null)
                }}
              >
                <Pin size={14} /> {apiConv?.isPinned ? '取消置顶' : '置顶'}
              </div>
              <div
                className="ch-cvm-row"
                onClick={() => {
                  setMultiSel(true)
                  setSelectedConvs(new Set([conv.id]))
                  setCvMenuOpen(null)
                }}
              >
                <CheckSquare size={14} /> 多选
              </div>
              <div className="ch-cvm-sep" />
              <div
                className="ch-cvm-row danger"
                onClick={() => {
                  deleteConv(conv.id)
                  setCvMenuOpen(null)
                  if (activeConv === conv.id) {
                    router.push('/chat')
                  }
                }}
              >
                <Trash2 size={14} /> 删除
              </div>
            </div>
          )
        })()}
    </div>
  )
}

// ── ConvItem sub-component ────────────────────────────────────
function ConvItem({
  conv,
  active,
  pinned = false,
  multiSel = false,
  selected = false,
  onPick,
  onToggle,
  onMenuOpen,
  onContextMenu,
}: {
  conv: MockConversation
  active: boolean
  pinned?: boolean
  menuOpen: boolean
  multiSel?: boolean
  selected?: boolean
  onPick: () => void
  onToggle?: () => void
  onMenuOpen: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
}): JSX.Element {
  const initials = conv.title.slice(0, 2)
  return (
    <div
      className={`ch-cv-item ${active ? 'active' : ''} ${selected ? 'sel' : ''}`}
      onClick={multiSel ? onToggle : onPick}
      onContextMenu={onContextMenu}
      title={conv.title}
    >
      <span className="ch-cv-chk">{selected && <Check size={10} strokeWidth={3} />}</span>
      <span className="ch-cv-av">{initials}</span>
      {pinned && (
        <span className="ch-cv-pin">
          <Pin size={11} fill="currentColor" />
        </span>
      )}
      <span className="ch-cv-title">{conv.title}</span>
      <button className="ch-cv-more" onClick={onMenuOpen} aria-label="更多操作">
        <MoreVertical size={14} />
      </button>
    </div>
  )
}
