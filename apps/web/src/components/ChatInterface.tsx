'use client'

import { useState, useRef, useEffect, useLayoutEffect, useCallback, type JSX } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import MarkdownContent from '@/components/MarkdownContent'
import SettingsModal from '@/components/settings/SettingsModal'
import ConfirmDialog from '@/components/ConfirmDialog'
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
import type { MockConversation, MockMessage, ConvGroup } from '@yuanai/core/stores'
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
  Share2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
  LogIn,
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

/** 消息对：一条用户消息 + 对应的多个 AI 回复（重新生成产生多版本） */
interface MsgPair {
  pairKey: string
  userMsg: MockMessage
  assistants: MockMessage[]
}

// ── Static constants ─────────────────────────────────
const MODELS: Model[] = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    desc: '快速响应，高性价比',
    provider: 'DeepSeek',
    ctx: '64K',
    color: '#3B82F6',
    letter: 'D',
    gradient: 'linear-gradient(135deg,#1D4ED8,#3B82F6)',
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    desc: '中文理解强，旗舰推理',
    provider: 'DeepSeek',
    ctx: '128K',
    color: '#1D4ED8',
    letter: 'D',
    gradient: 'linear-gradient(135deg,#1e3a8a,#1D4ED8)',
  },
]

const LIKE_CATEGORIES = ['有帮助', '解释清晰', '创意出色', '回答详细', '思路新颖']
const DISLIKE_CATEGORIES = ['信息有误', '答非所问', '内容冗余', '语言不自然', '缺乏细节']

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

// ── Helpers ───────────────────────────────────────────
/** Extract the raw text content from a MockMessage's parts array */
function getMsgText(msg: MockMessage): string {
  return msg.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.content ?? '')
    .join('\n')
}

/** Strip common Markdown syntax to produce plain readable text */
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^>\s+/gm, '')
    .trim()
}

/**
 * 将消息列表分组为 (用户消息, AI回复[]) 对。
 * 用户内容相同的相邻对合并（用于版本切换：重新生成会产生重复用户消息）。
 */
function buildPairs(msgs: MockMessage[]): MsgPair[] {
  const pairs: MsgPair[] = []
  let i = 0
  while (i < msgs.length) {
    const msg = msgs[i]
    if (!msg) {
      i++
      continue
    }
    if (msg.role === 'user') {
      const assistants: MockMessage[] = []
      let j = i + 1
      while (j < msgs.length && msgs[j]?.role === 'assistant') {
        assistants.push(msgs[j] as MockMessage)
        j++
      }
      pairs.push({ pairKey: msg.id, userMsg: msg, assistants })
      i = j
    } else {
      i++
    }
  }
  // 合并相邻的相同用户内容对（重新生成场景）
  const merged: MsgPair[] = []
  for (const pair of pairs) {
    const last = merged[merged.length - 1]
    if (last && getMsgText(last.userMsg) === getMsgText(pair.userMsg)) {
      last.assistants.push(...pair.assistants)
    } else {
      merged.push(pair)
    }
  }
  return merged
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
function UserMessage({
  msg,
  editing,
  onStartEdit,
  onSubmitEdit,
  onCancelEdit,
}: {
  msg: MockMessage
  editing: boolean
  onStartEdit: () => void
  onSubmitEdit: (text: string) => void
  onCancelEdit: () => void
}): JSX.Element {
  const text = getMsgText(msg)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const [localEdit, setLocalEdit] = useState(text)

  useEffect(() => {
    if (editing) {
      setLocalEdit(text)
      // Focus + cursor to end after textarea mounts
      requestAnimationFrame(() => {
        const ta = editRef.current
        if (!ta) return
        ta.style.height = 'auto'
        ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
        ta.focus()
        ta.setSelectionRange(ta.value.length, ta.value.length)
      })
    }
  }, [editing, text])

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const trimmed = localEdit.trim()
      if (trimmed) onSubmitEdit(trimmed)
      else onCancelEdit()
    }
    if (e.key === 'Escape') onCancelEdit()
  }

  if (editing) {
    return (
      <div className="ch-msg ch-msg-user">
        <div className="ch-msg-body ch-msg-body-edit">
          <textarea
            ref={editRef}
            className="ch-edit-ta"
            value={localEdit}
            onChange={(e) => {
              setLocalEdit(e.target.value)
              const ta = e.currentTarget
              ta.style.height = 'auto'
              ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
            }}
            onKeyDown={handleKey}
          />
          <div className="ch-edit-acts">
            <span className="ch-edit-hint">Shift+Enter 换行 · Enter 提交</span>
            <button className="ch-edit-cancel" onClick={onCancelEdit}>
              取消
            </button>
            <button
              className="ch-edit-submit"
              onClick={() => {
                const t = localEdit.trim()
                if (t) onSubmitEdit(t)
              }}
            >
              提交
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="ch-msg ch-msg-user">
      <div className="ch-msg-body">
        <div className="ch-msg-bubble">{text}</div>
        <div className="ch-msg-acts">
          <button className="ch-msg-act" onClick={onStartEdit}>
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
  versionCount = 1,
  versionIdx = 0,
  onVersionChange,
  onRegenerate,
  onFeedback,
  feedbackGiven,
}: {
  msg: MockMessage
  isStreaming: boolean
  streamingContent: string
  onFill: (text: string) => void
  versionCount?: number
  versionIdx?: number
  onVersionChange?: (idx: number) => void
  onRegenerate?: () => void
  onFeedback?: (type: 'like' | 'dislike') => void
  feedbackGiven?: 'like' | 'dislike' | undefined
}): JSX.Element {
  const displayContent = isStreaming ? streamingContent : getMsgText(msg)
  const [copyState, setCopyState] = useState<'idle' | 'md' | 'txt'>('idle')

  const copyMd = (): void => {
    void navigator.clipboard.writeText(displayContent)
    setCopyState('md')
    setTimeout(() => setCopyState('idle'), 2000)
  }

  const copyTxt = (): void => {
    void navigator.clipboard.writeText(stripMarkdown(displayContent))
    setCopyState('txt')
    setTimeout(() => setCopyState('idle'), 2000)
  }

  return (
    <div className="ch-msg ch-msg-ai">
      <div className="ch-msg-ai-av">元</div>
      <div className="ch-msg-body">
        {msg.thinkContent && <ThinkBlock content={msg.thinkContent} />}
        <MarkdownContent content={displayContent} streaming={isStreaming} />
        {!isStreaming && (
          <>
            {versionCount > 1 && onVersionChange && (
              <div className="ch-ver-nav">
                <button
                  className="ch-ver-btn"
                  disabled={versionIdx === 0}
                  onClick={() => onVersionChange(versionIdx - 1)}
                  title="上一个版本"
                >
                  <ChevronLeft size={12} />
                </button>
                <span className="ch-ver-label">
                  {versionIdx + 1} / {versionCount}
                </span>
                <button
                  className="ch-ver-btn"
                  disabled={versionIdx === versionCount - 1}
                  onClick={() => onVersionChange(versionIdx + 1)}
                  title="下一个版本"
                >
                  <ChevronRight size={12} />
                </button>
              </div>
            )}
            <div className="ch-msg-acts">
              <button
                className={`ch-msg-act ${copyState === 'md' ? 'copied' : ''}`}
                onClick={copyMd}
                title="复制 Markdown 原文"
              >
                {copyState === 'md' ? <Check size={12} /> : <Copy size={12} />}
                {copyState === 'md' ? '已复制' : 'MD'}
              </button>
              <button
                className={`ch-msg-act ${copyState === 'txt' ? 'copied' : ''}`}
                onClick={copyTxt}
                title="复制纯文本"
              >
                {copyState === 'txt' ? <Check size={12} /> : <Copy size={12} />}
                {copyState === 'txt' ? '已复制' : '纯文本'}
              </button>
              <div className="ch-msg-act-sep" />
              {onRegenerate && (
                <button className="ch-msg-act" onClick={onRegenerate} title="重新生成回答">
                  <RotateCcw size={12} /> 重新生成
                </button>
              )}
              {onFeedback && (
                <>
                  <button
                    className={`ch-msg-act ${feedbackGiven === 'like' ? 'active-fb' : ''}`}
                    onClick={() => onFeedback('like')}
                    title="有帮助"
                  >
                    <ThumbsUp size={12} />
                  </button>
                  <button
                    className={`ch-msg-act ${feedbackGiven === 'dislike' ? 'active-fb' : ''}`}
                    onClick={() => onFeedback('dislike')}
                    title="有问题"
                  >
                    <ThumbsDown size={12} />
                  </button>
                </>
              )}
            </div>
          </>
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
  const t = useTranslations('chat')
  const tCommon = useTranslations('common')

  // ── Auth ──
  const user = useAuthStore((s) => s.user)
  const accessToken = useAuthStore((s) => s.accessToken)
  const isLoggedIn = !!accessToken
  const { mutate: doLogout } = useLogout()

  // ── Streaming state (store) ──
  const streamingConvId = useChatStore((s) => s.streamingConvId)
  const streamingContent = useChatStore((s) => s.streamingContent)
  const optimisticUserMsg = useChatStore((s) => s.optimisticUserMsg)

  // ── View state ── (declared early so isThisStreaming can use activeConv)
  const [view, setView] = useState<'empty' | 'chat'>(() => (initialConvId ? 'chat' : 'empty'))
  const [activeConv, setActiveConv] = useState<string>(() => initialConvId ?? '')

  /**
   * 当前会话是否正在流式输出。
   * 来源：Zustand store（持久跨 re-mount），比本地 useState 更可靠：
   * router.push() 重新挂载组件时，本地 state 会被重置为 false，导致 Stop 按钮丢失。
   */
  const isThisStreaming = streamingConvId === activeConv

  // ── Server state (TanStack Query) ──
  const { data: apiConversations = [] } = useConversations()
  const conversations = apiConversations.map(apiConvToMock)

  const { mutateAsync: createConvAsync } = useCreateConversation()
  const { mutate: deleteConv } = useDeleteConversation()
  const { mutate: deleteConvs } = useDeleteConversations()
  const { mutate: updateConv } = useUpdateConversation()

  const stream = useStream()

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
  // SSR-safe: start with deterministic default, hydrate from sessionStorage on mount
  const [activeModel, setActiveModel] = useState<Model>(MODELS[0] as Model)
  const [modelDropOpen, setModelDropOpen] = useState(false)
  const [userPanelOpen, setUserPanelOpen] = useState(false)
  const [cvMenuOpen, setCvMenuOpen] = useState<string | null>(null)
  const [cvMenuPos, setCvMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [dark, setDark] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string
    message: string
    onConfirm: () => void
  } | null>(null)

  // ── Input state ──
  const [inputValue, setInputValue] = useState('')

  // ── Attachment state ──
  const [files, setFiles] = useState<AttachFile[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Scroll FAB ──
  const [showScrollFab, setShowScrollFab] = useState(false)

  // ── User message inline edit ──
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null)

  // ── Toolbar title inline rename ──
  const [renamingTitle, setRenamingTitle] = useState(false)
  const [renamingTitleInput, setRenamingTitleInput] = useState('')

  // ── Sidebar conv inline rename ──
  const [renamingConvId, setRenamingConvId] = useState<string | null>(null)
  const [renamingConvInput, setRenamingConvInput] = useState('')

  // ── Version navigation (local per pairKey) ──
  const [versionIdxs, setVersionIdxs] = useState<Record<string, number>>({})

  // ── Feedback dialog ──
  const [feedbackDialog, setFeedbackDialog] = useState<{
    msgId: string
    type: 'like' | 'dislike'
  } | null>(null)
  const [feedbackCategory, setFeedbackCategory] = useState('')
  const [feedbackReason, setFeedbackReason] = useState('')
  const [msgFeedback, setMsgFeedback] = useState<Record<string, 'like' | 'dislike'>>({})

  // ── Refs ──
  const modelBtnRef = useRef<HTMLButtonElement>(null)
  const userTriggerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const msgsEndRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [sidebarWidth, setSidebarWidth] = useState(260)

  useEffect(() => {
    setDark(isDark())
    const observer = new MutationObserver(() => setDark(isDark()))
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  // Hydrate active model from sessionStorage after mount (avoids SSR/client mismatch)
  useEffect(() => {
    const saved = sessionStorage.getItem('yuanai-active-model')
    if (saved) {
      const found = MODELS.find((m) => m.id === saved)
      if (found) setActiveModel(found)
    }
  }, [])

  useEffect(() => {
    const MIN = 200,
      MAX = 360
    let dragging = false
    const onMouseDown = (e: MouseEvent): void => {
      e.preventDefault()
      dragging = true
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }
    const onMouseMove = (e: MouseEvent): void => {
      if (!dragging) return
      const w = Math.min(MAX, Math.max(MIN, e.clientX))
      setSidebarWidth(w)
    }
    const onMouseUp = (): void => {
      dragging = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    const handle = sidebarRef.current?.querySelector('.ch-sb-resize') as HTMLElement | null
    handle?.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      handle?.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
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

  // 流式输出时自动跟随到底部（新消息到达时滚动）
  useEffect(() => {
    if (streamingConvId !== activeConv || !contentRef.current) return
    contentRef.current.scrollTop = contentRef.current.scrollHeight
  }, [streamingContent, streamingConvId, activeConv])

  // 切换会话时同步滚动到底部，消除内容抖动
  useLayoutEffect(() => {
    if (!contentRef.current) return
    contentRef.current.scrollTop = contentRef.current.scrollHeight
  }, [activeConv])

  // 标题重命名输入框挂载后聚焦并将光标移到末尾
  useEffect(() => {
    if (!renamingTitle || !titleInputRef.current) return
    const el = titleInputRef.current
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [renamingTitle])

  // 切换会话时同步该会话绑定的模型
  useEffect(() => {
    if (!activeConv) return
    const apiConv = apiConversations.find((c) => c.id === activeConv)
    if (apiConv?.model) {
      const model = MODELS.find((m) => m.id === apiConv.model)
      if (model) {
        setActiveModel(model)
        sessionStorage.setItem('yuanai-active-model', model.id)
      }
    }
  }, [activeConv, apiConversations])

  const closeAllPanels = (): void => {
    setModelDropOpen(false)
    setUserPanelOpen(false)
    setCvMenuOpen(null)
  }

  const toggleTheme = (): void => {
    const current = document.documentElement.getAttribute('data-theme')
    const next = current === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('theme', next)
    setDark(next === 'dark')
  }

  const newChat = (): void => {
    setInputValue('')
    setSidebarOpen(false)
    router.push('/chat')
  }

  const pickConv = (id: string): void => {
    setActiveConv(id)
    setView('chat')
    setSidebarOpen(false)
    router.push('/chat/' + id)
  }

  const showConfirm = (title: string, message: string, onConfirm: () => void): void => {
    setConfirmDialog({ title, message, onConfirm })
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
    sessionStorage.setItem('yuanai-active-model', m.id)
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

  const _toggleArtifact = (): void => setArtifactOpen((o) => !o)

  const onInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setInputValue(e.target.value)
    const ta = e.target
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
  }

  const onInputKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (inputValue.trim() && !isThisStreaming) void sendMessage()
    }
  }

  const sendMessage = async (): Promise<void> => {
    if (!inputValue.trim() || isThisStreaming) return

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

    void stream.send({
      convId,
      content: text,
      model: activeModel.id,
    })
  }

  const stopStreaming = (): void => {
    stream.stop()
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

  // ── Inline rename helpers ─────────────────────────────────
  const saveTitleRename = (): void => {
    const trimmed = renamingTitleInput.trim()
    if (trimmed && activeConv) updateConv({ id: activeConv, title: trimmed })
    setRenamingTitle(false)
  }

  const saveConvRename = (): void => {
    const trimmed = renamingConvInput.trim()
    if (trimmed && renamingConvId) updateConv({ id: renamingConvId, title: trimmed })
    setRenamingConvId(null)
    setRenamingConvInput('')
  }

  // ── User message edit ────────────────────────────────────
  const startEditMsg = (msg: MockMessage): void => {
    setEditingMsgId(msg.id)
  }

  const submitEditMsg = (msg: MockMessage, newText: string): void => {
    setEditingMsgId(null)
    if (!activeConv || newText === getMsgText(msg) || isThisStreaming) return
    void stream.send({
      convId: activeConv,
      content: newText,
      model: activeModel.id,
    })
  }

  // ── Regenerate ───────────────────────────────────────────
  const handleRegenerate = (pair: MsgPair): void => {
    if (isThisStreaming || !activeConv) return
    const userText = getMsgText(pair.userMsg)
    void stream.send({
      convId: activeConv,
      content: userText,
      model: activeModel.id,
      skipOptimistic: true,
    })
  }

  // ── Feedback ─────────────────────────────────────────────
  const openFeedback = (msgId: string, type: 'like' | 'dislike'): void => {
    // Toggle off if already selected
    if (msgFeedback[msgId] === type) {
      setMsgFeedback((prev) => {
        const next = { ...prev }
        delete next[msgId]
        return next
      })
      return
    }
    setFeedbackDialog({ msgId, type })
    setFeedbackCategory('')
    setFeedbackReason('')
  }

  const submitFeedback = (): void => {
    if (!feedbackDialog) return
    setMsgFeedback((prev) => ({ ...prev, [feedbackDialog.msgId]: feedbackDialog.type }))
    setFeedbackDialog(null)
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

  const convTitle =
    conversations.find((c) => c.id === activeConv)?.title ?? t('actions.newDefaultTitle')

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
      <aside
        ref={sidebarRef}
        className={`ch-sidebar ${sidebarOpen ? 'open' : ''}`}
        id="sidebar"
        style={{ width: sidebarCollapsed ? undefined : sidebarWidth }}
      >
        {/* Header */}
        <div className="ch-sb-head">
          <div className="ch-brand">
            <div className="ch-brand-logo">元</div>
            <span className="ch-sb-lbl">元AI</span>
          </div>
          <button
            className="ch-sb-new"
            title={t('newChatTitle')}
            onClick={newChat}
            aria-label={t('newChatTitle')}
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
              placeholder={t('searchPlaceholder')}
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
              {selectedConvs.size === conversations.length
                ? t('actions.deselectAll')
                : t('actions.selectAll')}
            </span>
            <span className="ch-multi-c">
              {t('actions.selectedCount').replace('{count}', String(selectedConvs.size))}
            </span>
            <button
              className="ch-multi-del"
              disabled={selectedConvs.size === 0}
              onClick={() => {
                showConfirm(
                  t('delete.batchTitle'),
                  t('delete.batchMessage').replace('{count}', String(selectedConvs.size)),
                  () => {
                    deleteConvs([...selectedConvs])
                    setSelectedConvs(new Set())
                    setMultiSel(false)
                  }
                )
              }}
            >
              {t('actions.deleteSelected')}
            </button>
            <span
              className="ch-multi-cancel"
              onClick={() => {
                setMultiSel(false)
                setSelectedConvs(new Set())
              }}
            >
              {tCommon('cancel')}
            </span>
          </div>
        )}

        {/* Conversation list */}
        <div className="ch-sb-convs">
          {groupedConvs.pinned.length > 0 && (
            <div className="ch-conv-group">
              <div className="ch-cg-lbl">{t('groups.pinned')}</div>
              {groupedConvs.pinned.map((conv) => (
                <ConvItem
                  key={conv.id}
                  conv={conv}
                  active={activeConv === conv.id}
                  pinned
                  menuOpen={cvMenuOpen === conv.id}
                  multiSel={multiSel}
                  selected={selectedConvs.has(conv.id)}
                  isRenaming={renamingConvId === conv.id}
                  renameValue={renamingConvInput}
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
                  onRenameChange={setRenamingConvInput}
                  onRenameCommit={saveConvRename}
                  onRenameCancel={() => {
                    setRenamingConvId(null)
                    setRenamingConvInput('')
                  }}
                />
              ))}
            </div>
          )}
          {groupedConvs.today.length > 0 && (
            <div className="ch-conv-group">
              <div className="ch-cg-lbl">{t('groups.today')}</div>
              {groupedConvs.today.map((conv) => (
                <ConvItem
                  key={conv.id}
                  conv={conv}
                  active={activeConv === conv.id}
                  menuOpen={cvMenuOpen === conv.id}
                  multiSel={multiSel}
                  selected={selectedConvs.has(conv.id)}
                  isRenaming={renamingConvId === conv.id}
                  renameValue={renamingConvInput}
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
                  onRenameChange={setRenamingConvInput}
                  onRenameCommit={saveConvRename}
                  onRenameCancel={() => {
                    setRenamingConvId(null)
                    setRenamingConvInput('')
                  }}
                />
              ))}
            </div>
          )}
          {groupedConvs.yesterday.length > 0 && (
            <div className="ch-conv-group">
              <div className="ch-cg-lbl">{t('groups.yesterday')}</div>
              {groupedConvs.yesterday.map((conv) => (
                <ConvItem
                  key={conv.id}
                  conv={conv}
                  active={activeConv === conv.id}
                  menuOpen={cvMenuOpen === conv.id}
                  multiSel={multiSel}
                  selected={selectedConvs.has(conv.id)}
                  isRenaming={renamingConvId === conv.id}
                  renameValue={renamingConvInput}
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
                  onRenameChange={setRenamingConvInput}
                  onRenameCommit={saveConvRename}
                  onRenameCancel={() => {
                    setRenamingConvId(null)
                    setRenamingConvInput('')
                  }}
                />
              ))}
            </div>
          )}
          {groupedConvs.week.length > 0 && (
            <div className="ch-conv-group">
              <div className="ch-cg-lbl">{t('groups.week')}</div>
              {groupedConvs.week.map((conv) => (
                <ConvItem
                  key={conv.id}
                  conv={conv}
                  active={activeConv === conv.id}
                  menuOpen={cvMenuOpen === conv.id}
                  multiSel={multiSel}
                  selected={selectedConvs.has(conv.id)}
                  isRenaming={renamingConvId === conv.id}
                  renameValue={renamingConvInput}
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
                  onRenameChange={setRenamingConvInput}
                  onRenameCommit={saveConvRename}
                  onRenameCancel={() => {
                    setRenamingConvId(null)
                    setRenamingConvInput('')
                  }}
                />
              ))}
            </div>
          )}
          {filteredConvs.length === 0 && <div className="ch-sb-empty">{t('noConversations')}</div>}
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
            title={t('sidebar.settings')}
            onClick={(e) => {
              e.stopPropagation()
              setUserPanelOpen((o) => !o)
              setModelDropOpen(false)
            }}
          >
            <Settings size={15} />
          </button>
        </div>
        <div className="ch-sb-resize" />
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
            {view === 'chat' &&
              (renamingTitle ? (
                <input
                  ref={titleInputRef}
                  className="ch-conv-name-input"
                  value={renamingTitleInput}
                  maxLength={60}
                  onChange={(e) => setRenamingTitleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveTitleRename()
                    if (e.key === 'Escape') setRenamingTitle(false)
                  }}
                  onBlur={saveTitleRename}
                />
              ) : (
                <button
                  className="ch-conv-name"
                  title="点击重命名"
                  onClick={() => {
                    setRenamingTitleInput(convTitle)
                    setRenamingTitle(true)
                  }}
                >
                  {convTitle}
                </button>
              ))}
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
            <button className="ch-ib" title={t('toolbar.share')}>
              <Share2 size={16} />
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="ch-content" ref={contentRef} onScroll={onScroll}>
          {/* Empty state */}
          <div className="ch-empty-state">
            <div className="ch-ai-av">元</div>
            <h1 className="ch-e-title">{t('welcome.title')}</h1>
            <p className="ch-e-sub">{t('welcome.subtitle')}</p>
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
              {(() => {
                // Filter out streaming-time placeholders
                const filteredMsgs = messages.filter((msg) => {
                  if (!isThisStreaming) return true
                  if (msg.role === 'assistant' && !getMsgText(msg)) return false
                  if (
                    msg.role === 'user' &&
                    optimisticUserMsg &&
                    getMsgText(msg) === optimisticUserMsg
                  )
                    return false
                  return true
                })
                const pairs = buildPairs(filteredMsgs)

                return (
                  <>
                    {pairs.flatMap((pair) => {
                      const rawIdx = versionIdxs[pair.pairKey] ?? pair.assistants.length - 1
                      const vIdx = Math.max(0, Math.min(rawIdx, pair.assistants.length - 1))
                      const currentAsst = pair.assistants[vIdx]
                      const elems: JSX.Element[] = [
                        <UserMessage
                          key={`u-${pair.pairKey}`}
                          msg={pair.userMsg}
                          editing={editingMsgId === pair.userMsg.id}
                          onStartEdit={() => startEditMsg(pair.userMsg)}
                          onSubmitEdit={(text) => submitEditMsg(pair.userMsg, text)}
                          onCancelEdit={() => setEditingMsgId(null)}
                        />,
                      ]
                      if (currentAsst) {
                        elems.push(
                          <AIMessage
                            key={`a-${currentAsst.id}-v${vIdx}`}
                            msg={currentAsst}
                            isStreaming={false}
                            streamingContent=""
                            onFill={fill}
                            versionCount={pair.assistants.length}
                            versionIdx={vIdx}
                            onVersionChange={(i) =>
                              setVersionIdxs((prev) => ({ ...prev, [pair.pairKey]: i }))
                            }
                            onRegenerate={() => handleRegenerate(pair)}
                            onFeedback={(type) => openFeedback(currentAsst.id, type)}
                            feedbackGiven={msgFeedback[currentAsst.id]}
                          />
                        )
                      }
                      return elems
                    })}

                    {/* Optimistic user message (new send, not regeneration) */}
                    {isThisStreaming && optimisticUserMsg && (
                      <UserMessage
                        msg={{
                          id: '__opt_user__',
                          role: 'user',
                          parts: [{ type: 'text', content: optimisticUserMsg }],
                          createdAt: Date.now(),
                        }}
                        editing={false}
                        onStartEdit={() => {}}
                        onSubmitEdit={() => {}}
                        onCancelEdit={() => {}}
                      />
                    )}

                    {/* Streaming AI response */}
                    {isThisStreaming && (
                      <AIMessage
                        msg={{
                          id: '__streaming__',
                          role: 'assistant',
                          parts: [],
                          createdAt: Date.now(),
                        }}
                        isStreaming={true}
                        streamingContent={streamingContent}
                        onFill={fill}
                      />
                    )}
                  </>
                )
              })()}

              <div ref={msgsEndRef} style={{ height: '20px' }} />
            </div>

            {/* Scroll FAB */}
            <div className={`ch-scroll-fab ${showScrollFab ? '' : 'hide'}`}>
              <button onClick={toBottom} title={t('actions.scrollToBottom')}>
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
              placeholder={isLoggedIn ? t('inputPlaceholder') : t('inputPlaceholderLoggedOut')}
              rows={1}
              value={inputValue}
              onChange={onInputChange}
              onKeyDown={onInputKey}
              disabled={!isLoggedIn}
            />
            <div className="ch-input-tb">
              <button
                className="ch-in-btn"
                title="添加附件"
                disabled={!isLoggedIn}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={18} />
              </button>
              <button className="ch-in-btn" title="语音输入" disabled={!isLoggedIn}>
                <Mic size={18} />
              </button>
              <button
                className={`ch-in-btn ${webSearch ? 'on' : ''}`}
                title="联网搜索"
                disabled={!isLoggedIn}
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
                {isThisStreaming ? (
                  <button
                    className="ch-send-btn streaming on"
                    onClick={stopStreaming}
                    title={t('actions.stopGeneration')}
                  >
                    <Square size={16} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    className={`ch-send-btn ${inputValue.trim() && isLoggedIn ? 'on' : ''}`}
                    onClick={() => {
                      void sendMessage()
                    }}
                    disabled={!inputValue.trim() || !isLoggedIn}
                    title="发送 (Enter)"
                  >
                    <SendHorizontal size={20} />
                  </button>
                )}
              </div>
            </div>
          </div>
          <p className="ch-input-hint">{t('disclaimer')}</p>
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
          {['DeepSeek'].map((provider) => {
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
            <span className="ch-up-tlbl">{t('sidebar.darkMode')}</span>
            <div className={`ch-toggle ${dark ? 'on' : ''}`} />
          </div>
          <div className="ch-up-sep" />
          {isLoggedIn ? (
            <>
              <div
                className="ch-up-row"
                onClick={() => {
                  setUserPanelOpen(false)
                  setSettingsOpen(true)
                }}
              >
                <User size={16} /> {t('sidebar.profile')}
              </div>
              <div className="ch-up-sep" />
              <div
                className="ch-up-row danger"
                onClick={() => {
                  setUserPanelOpen(false)
                  doLogout()
                }}
              >
                <LogOut size={16} /> {t('sidebar.logout')}
              </div>
            </>
          ) : (
            <div
              className="ch-up-row"
              onClick={() => {
                setUserPanelOpen(false)
                router.push('/login')
              }}
            >
              <LogIn size={16} /> {t('sidebar.login')}
            </div>
          )}
        </div>
      )}

      {/* ── Settings modal ───────────────────────── */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* ── Confirm dialog ───────────────────────── */}
      <ConfirmDialog
        open={!!confirmDialog}
        title={confirmDialog?.title ?? ''}
        message={confirmDialog?.message ?? ''}
        confirmText={t('actions.delete')}
        cancelText={tCommon('cancel')}
        danger
        onConfirm={() => {
          confirmDialog?.onConfirm()
          setConfirmDialog(null)
        }}
        onCancel={() => setConfirmDialog(null)}
      />

      {/* ── Feedback dialog ──────────────────────── */}
      {feedbackDialog && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 299 }}
            onClick={() => setFeedbackDialog(null)}
          />
          <div className="ch-feedback-dialog">
            <div className="ch-fd-head">
              <span>
                {feedbackDialog.type === 'like' ? '👍 哪方面让你满意？' : '👎 哪里让你不满意？'}
              </span>
              <button className="ch-fd-close" onClick={() => setFeedbackDialog(null)}>
                <X size={14} />
              </button>
            </div>
            <div className="ch-fd-cats">
              {(feedbackDialog.type === 'like' ? LIKE_CATEGORIES : DISLIKE_CATEGORIES).map(
                (cat) => (
                  <button
                    key={cat}
                    className={`ch-fd-cat ${feedbackCategory === cat ? 'sel' : ''}`}
                    onClick={() => setFeedbackCategory((p) => (p === cat ? '' : cat))}
                  >
                    {cat}
                  </button>
                )
              )}
            </div>
            <textarea
              className="ch-fd-reason"
              placeholder="写下你的建议（可选）"
              value={feedbackReason}
              rows={3}
              onChange={(e) => setFeedbackReason(e.target.value)}
            />
            <div className="ch-fd-ft">
              <button className="ch-fd-skip" onClick={() => setFeedbackDialog(null)}>
                跳过
              </button>
              <button className="ch-fd-submit" onClick={submitFeedback}>
                提交反馈
              </button>
            </div>
          </div>
        </>
      )}

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
                  setCvMenuOpen(null)
                  setRenamingConvId(conv.id)
                  setRenamingConvInput(conv.title)
                }}
              >
                <Pencil size={14} /> {t('actions.rename')}
              </div>
              <div
                className="ch-cvm-row"
                onClick={() => {
                  updateConv({ id: conv.id, isPinned: !(apiConv?.isPinned ?? false) })
                  setCvMenuOpen(null)
                }}
              >
                <Pin size={14} /> {apiConv?.isPinned ? t('actions.unpin') : t('actions.pin')}
              </div>
              <div
                className="ch-cvm-row"
                onClick={() => {
                  setMultiSel(true)
                  setSelectedConvs(new Set([conv.id]))
                  setCvMenuOpen(null)
                }}
              >
                <CheckSquare size={14} /> {t('actions.multiSelect')}
              </div>
              <div className="ch-cvm-sep" />
              <div
                className="ch-cvm-row danger"
                onClick={() => {
                  const targetId = conv.id
                  setCvMenuOpen(null)
                  showConfirm(t('delete.title'), t('delete.message'), () => {
                    deleteConv(targetId)
                    if (activeConv === targetId) {
                      setActiveConv('')
                      setView('empty')
                      router.push('/chat')
                    }
                  })
                }}
              >
                <Trash2 size={14} /> {t('actions.delete')}
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
  isRenaming = false,
  renameValue = '',
  onPick,
  onToggle,
  onMenuOpen,
  onContextMenu,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
}: {
  conv: MockConversation
  active: boolean
  pinned?: boolean
  menuOpen: boolean
  multiSel?: boolean
  selected?: boolean
  isRenaming?: boolean
  renameValue?: string
  onPick: () => void
  onToggle?: () => void
  onMenuOpen: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
  onRenameChange?: (v: string) => void
  onRenameCommit?: () => void
  onRenameCancel?: () => void
}): JSX.Element {
  const renameRef = useRef<HTMLInputElement>(null)
  const initials = conv.title.slice(0, 2)

  useEffect(() => {
    if (isRenaming && renameRef.current) {
      renameRef.current.focus()
      renameRef.current.select()
    }
  }, [isRenaming])

  return (
    <div
      className={`ch-cv-item ${active ? 'active' : ''} ${selected ? 'sel' : ''} ${isRenaming ? 'renaming' : ''}`}
      onClick={multiSel ? onToggle : isRenaming ? undefined : onPick}
      onContextMenu={isRenaming ? undefined : onContextMenu}
      title={isRenaming ? undefined : conv.title}
    >
      <span className="ch-cv-chk">{selected && <Check size={10} strokeWidth={3} />}</span>
      <span className="ch-cv-av">{initials}</span>
      {pinned && !isRenaming && (
        <span className="ch-cv-pin">
          <Pin size={11} fill="currentColor" />
        </span>
      )}
      {isRenaming ? (
        <input
          ref={renameRef}
          className="ch-cv-rename-input"
          value={renameValue}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onRenameChange?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onRenameCommit?.()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              onRenameCancel?.()
            }
            e.stopPropagation()
          }}
          onBlur={onRenameCommit}
        />
      ) : (
        <span className="ch-cv-title">{conv.title}</span>
      )}
      {!isRenaming && (
        <button className="ch-cv-more" onClick={onMenuOpen} aria-label="更多操作">
          <MoreVertical size={14} />
        </button>
      )}
    </div>
  )
}
