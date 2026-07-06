'use client'

import { useState, useRef, useEffect, useCallback, useMemo, type JSX } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import SettingsModal from '@/components/settings/SettingsModal'
import ConfirmDialog from '@/components/ConfirmDialog'
import { MessageList } from '@/components/chat/MessageList'
import { MessageOutline } from '@/components/chat/MessageOutline'
import { ArtifactPanel } from '@/components/chat/ArtifactPanel'
import { ShareDialog } from '@/components/chat/ShareDialog'
import {
  apiConvToMock,
  apiMsgToMock,
  buildPairs,
  getMsgText,
  isDark,
  type MsgPair,
} from '@/components/chat/utils'
import type { VirtuosoHandle } from 'react-virtuoso'
import { useChatStore } from '@yuanai/core/stores'
import { useAuthStore } from '@yuanai/core/stores'
import { usePrefsStore } from '@yuanai/core/stores'
import { useArtifactStore } from '@yuanai/core/stores'
import { useStream } from '@yuanai/core/hooks'
import {
  useConversations,
  useCreateConversation,
  useDeleteConversation,
  useDeleteConversations,
  useUpdateConversation,
  useMessages,
  useLogout,
  uploadFileSmart,
} from '@yuanai/core/hooks'
import type { MockMessage, MockConversation } from '@yuanai/core/stores'
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
  Check,
  Sparkles,
  Bug,
  FileText,
  Languages,
  GraduationCap,
  Paperclip,
  Mic,
  SendHorizontal,
  ArrowDown,
  Menu,
  PanelLeft,
  X,
  LogOut,
  LogIn,
  User,
  Square,
  Loader2,
  Brain,
} from 'lucide-react'

// ── Notification helpers ─────────────────────────────
function playNotificationSound(): void {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.15)
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.4)
  } catch {
    // AudioContext not available (e.g., server-side render)
  }
}

function triggerNotifications(): void {
  if (typeof window === 'undefined') return
  const soundOn = localStorage.getItem('notif_sound') === 'true'
  const aiOn = localStorage.getItem('notif_ai') === 'true'
  const browserOn = localStorage.getItem('notif_browser') === 'true'
  if (soundOn) playNotificationSound()
  if (
    aiOn &&
    browserOn &&
    document.hidden &&
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted'
  ) {
    new Notification('元AI', { body: 'AI 回复已完成', icon: '/favicon.ico' })
  }
}

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

/** 待上传附件状态 —— 覆盖秒传/直传/分片全流程。 */
type AttachStatus = 'pending' | 'uploading' | 'done' | 'error'

interface AttachFile {
  id: string
  file: File
  preview: string
  type: 'image' | 'doc'
  status: AttachStatus
  /** 上传进度 0-100。 */
  progress: number
  /** 上传成功后拿到的服务端文件 ID。 */
  fileId?: string
  /** 上传失败时的错误消息。 */
  error?: string
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

  // ── User preferences ──
  const timeFmt = usePrefsStore((s) => s.timeFmt)
  const dateFmt = usePrefsStore((s) => s.dateFmt)
  const showThinking = usePrefsStore((s) => s.showThinking)
  const setShowThinking = usePrefsStore((s) => s.setShowThinking)

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
  // isLoading（而非 isFetching）：只在这个会话从未取到过数据时为 true——
  // 切到已缓存过的会话不应出现加载态，只有切到全新会话才需要过渡占位，
  // 避免 Virtuoso 挂载时 pairs 还是空数组，之后数据到达又要二次滚动导致跳动。
  const { data: apiMessages = [], isLoading: messagesLoading } = useMessages(activeConv)
  const messages = useMemo(() => apiMessages.map(apiMsgToMock), [apiMessages])
  const filteredMsgs = useMemo(
    () =>
      messages.filter((msg) => {
        if (!isThisStreaming) return true
        if (msg.role === 'assistant' && !getMsgText(msg)) return false
        if (msg.role === 'user' && optimisticUserMsg && getMsgText(msg) === optimisticUserMsg)
          return false
        return true
      }),
    [messages, isThisStreaming, optimisticUserMsg]
  )
  const pairs = useMemo(() => buildPairs(filteredMsgs), [filteredMsgs])

  // ── Sidebar state ──
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [search, setSearch] = useState('')
  const [multiSel, setMultiSel] = useState(false)
  const [selectedConvs, setSelectedConvs] = useState<Set<string>>(new Set())

  // ── UI state ──
  const artifactOpen = useArtifactStore((s) => s.open)
  const [webSearch, setWebSearch] = useState(true)
  // SSR-safe: start with deterministic default, hydrate from sessionStorage on mount
  const [activeModel, setActiveModel] = useState<Model>(MODELS[0] as Model)
  const [modelDropOpen, setModelDropOpen] = useState(false)
  const [userPanelOpen, setUserPanelOpen] = useState(false)
  const [cvMenuOpen, setCvMenuOpen] = useState<string | null>(null)
  const [cvMenuPos, setCvMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [dark, setDark] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string
    message: string
    onConfirm: () => void
  } | null>(null)

  // ── Input state ──
  const [inputValue, setInputValue] = useState('')

  // ── Attachment state ──
  const [files, setFiles] = useState<AttachFile[]>([])
  const [uploading, setUploading] = useState(false)
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

  // ── Regeneration tracking ──
  const [regeneratingPairKey, setRegeneratingPairKey] = useState<string | null>(null)

  // ── Outline scroll tracking ──
  const [outlineActiveIdx, setOutlineActiveIdx] = useState(0)

  // ── Refs ──
  const modelBtnRef = useRef<HTMLButtonElement>(null)
  const userTriggerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
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

  // 流结束后清除重新生成追踪
  useEffect(() => {
    if (!isThisStreaming && regeneratingPairKey) setRegeneratingPairKey(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isThisStreaming])

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
    if (!inputValue.trim() || isThisStreaming || uploading) return

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

    // 先上传附件，收集文件 ID —— 按 hash 秒传，> 10 MB 走分片
    let fileIds: string[] = []
    if (files.length > 0) {
      setUploading(true)
      try {
        const refs = await Promise.all(
          files.map(async (f) => {
            if (f.fileId) {
              return { id: f.fileId }
            }
            const ref = await uploadFileSmart(f.file, {
              onProgress: (snap) => {
                setFiles((prev) =>
                  prev.map((it) => {
                    if (it.id !== f.id) return it
                    const nextStatus: AttachStatus =
                      snap.status === 'done'
                        ? 'done'
                        : snap.status === 'error'
                          ? 'error'
                          : 'uploading'
                    const next: AttachFile = {
                      ...it,
                      status: nextStatus,
                      progress: snap.percent,
                    }
                    if (snap.error) next.error = snap.error
                    return next
                  })
                )
              },
            })
            setFiles((prev) =>
              prev.map((it) =>
                it.id === f.id ? { ...it, fileId: ref.id, status: 'done', progress: 100 } : it
              )
            )
            return ref
          })
        )
        fileIds = refs.map((r) => r.id)
      } catch (err) {
        const msg = (err as { message?: string })?.message ?? '上传失败'
        setFiles((prev) =>
          prev.map((it) =>
            it.status === 'uploading' ? { ...it, status: 'error', error: msg } : it
          )
        )
        setUploading(false)
        return
      }
      setUploading(false)
    }

    setInputValue('')
    setFiles([])
    if (inputRef.current) inputRef.current.style.height = 'auto'

    // 发送前先滚到底部，确保用户能看到流式输出
    virtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'smooth' })

    void stream.send({
      convId,
      content: text,
      model: activeModel.id,
      fileIds: fileIds.length > 0 ? fileIds : undefined,
      enableThinking: showThinking,
      onEnd: triggerNotifications,
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

  const toBottom = (): void => {
    virtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'smooth' })
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const picked = Array.from(e.target.files ?? [])
    const newFiles: AttachFile[] = picked.map((f) => ({
      id: Math.random().toString(36).slice(2),
      file: f,
      preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : f.name,
      type: f.type.startsWith('image/') ? 'image' : 'doc',
      status: 'pending',
      progress: 0,
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
      enableThinking: showThinking,
    })
  }

  // ── Regenerate ───────────────────────────────────────────
  const handleRegenerate = (pair: MsgPair): void => {
    if (isThisStreaming || !activeConv) return
    setRegeneratingPairKey(pair.pairKey)
    const userText = getMsgText(pair.userMsg)
    void stream.send({
      convId: activeConv,
      content: userText,
      model: activeModel.id,
      skipOptimistic: true,
      enableThinking: showThinking,
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
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 99 }}
          onClick={closeAllPanels}
          onContextMenu={(e) => {
            // 该遮罩层级高于侧边栏，会话菜单展开时再次右键会先命中这里；
            // 若不阻止默认行为并关闭菜单，浏览器原生右键菜单会弹出
            e.preventDefault()
            closeAllPanels()
          }}
        />
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
              {t('actions.selectedCount', { count: selectedConvs.size })}
            </span>
            <button
              className="ch-multi-del"
              disabled={selectedConvs.size === 0}
              onClick={() => {
                showConfirm(
                  t('delete.batchTitle'),
                  t('delete.batchMessage', { count: selectedConvs.size }),
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
            <button
              className="ch-ib"
              title={t('toolbar.share')}
              disabled={!isLoggedIn || !activeConv}
              onClick={() => setShareOpen(true)}
            >
              <Share2 size={16} />
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="ch-content">
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
            {messagesLoading ? (
              <div className="ch-msgs-loading">
                <Loader2 size={22} className="ch-spin" />
              </div>
            ) : (
              <MessageList
                key={activeConv}
                virtuosoRef={virtuosoRef}
                pairs={pairs}
                streamingUserMsg={isThisStreaming && optimisticUserMsg ? optimisticUserMsg : null}
                showStreamingAI={isThisStreaming && !regeneratingPairKey}
                regeneratingPairKey={regeneratingPairKey}
                streamingContent={streamingContent}
                timeFmt={timeFmt}
                dateFmt={dateFmt}
                versionIdxs={versionIdxs}
                onFill={fill}
                editingMsgId={editingMsgId}
                onStartEdit={(msg) => startEditMsg(msg)}
                onSubmitEdit={(msg, text) => submitEditMsg(msg, text)}
                onCancelEdit={() => setEditingMsgId(null)}
                onVersionChange={(pairKey, i) =>
                  setVersionIdxs((prev) => ({ ...prev, [pairKey]: i }))
                }
                onRegenerate={(pair) => handleRegenerate(pair)}
                onFeedback={(msgId, type) => openFeedback(msgId, type)}
                msgFeedback={msgFeedback}
                onAtBottomStateChange={(atBottom) => setShowScrollFab(!atBottom)}
                onRangeChanged={(idx) => setOutlineActiveIdx(idx)}
              />
            )}
            <MessageOutline
              pairs={pairs}
              virtuosoRef={virtuosoRef}
              scrollActiveIdx={outlineActiveIdx}
            />
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
                    <div key={f.id} className={`ch-attach-img${f.status === 'error' ? 'err' : ''}`}>
                      <img src={f.preview} alt={f.file.name} />
                      {f.status === 'uploading' && (
                        <div className="ch-attach-prog" aria-hidden>
                          <div className="ch-attach-prog-bar" style={{ width: `${f.progress}%` }} />
                        </div>
                      )}
                      <button
                        className="ch-attach-rm"
                        onClick={() => removeFile(f.id)}
                        aria-label="移除附件"
                      >
                        <X size={8} />
                      </button>
                    </div>
                  ) : (
                    <div
                      key={f.id}
                      className={`ch-attach-doc${f.status === 'error' ? 'err' : ''}`}
                      title={f.error ?? undefined}
                    >
                      <FileText size={14} />
                      <span>{f.preview}</span>
                      {f.status === 'uploading' && (
                        <span className="ch-attach-pct">{f.progress}%</span>
                      )}
                      {f.status === 'error' && <span className="ch-attach-pct err">上传失败</span>}
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
              <button
                className={`ch-in-btn ${showThinking ? 'on' : ''}`}
                title={showThinking ? '关闭思考过程' : '开启思考过程'}
                disabled={!isLoggedIn}
                onClick={() => setShowThinking(!showThinking)}
              >
                <Brain size={18} />
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
                ) : uploading ? (
                  <button className="ch-send-btn on" disabled title="上传中...">
                    <Loader2 size={18} className="ch-spin" />
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
      <ArtifactPanel />

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
                  doLogout(undefined, {
                    onSettled: () => {
                      router.push('/login')
                    },
                  })
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

      {/* ── Share dialog ────────────────────────── */}
      <ShareDialog
        open={shareOpen}
        convId={activeConv || null}
        onClose={() => setShareOpen(false)}
      />

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
                取消
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
