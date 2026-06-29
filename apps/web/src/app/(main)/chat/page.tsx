'use client'

import { useState, useRef, useEffect, useCallback, type JSX } from 'react'
import SettingsModal from '@/components/settings/SettingsModal'
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
  Loader2,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────
interface Conversation {
  id: string
  title: string
  group: 'pinned' | 'today' | 'yesterday' | 'week'
}

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

// ── Sample data ──────────────────────────────────────
const CONVERSATIONS: Conversation[] = [
  { id: 'arch', title: '前端架构设计讨论', group: 'pinned' },
  { id: 'react-perf', title: 'React 组件性能优化', group: 'today' },
  { id: 'quantum', title: '解释量子纠缠的原理', group: 'today' },
  { id: 'python', title: 'Python 数据分析脚本', group: 'today' },
  { id: 'ts', title: 'TypeScript 泛型使用技巧', group: 'yesterday' },
  { id: 'sql', title: 'SQL 查询性能优化', group: 'yesterday' },
  { id: 'prd', title: '产品需求文档撰写', group: 'week' },
  { id: 'prompt', title: '如何写出好的提示词', group: 'week' },
  { id: 'rust', title: 'Rust 所有权系统详解', group: 'week' },
]

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
    id: 'claude-3-5',
    name: 'Claude 3.5 Sonnet',
    desc: '代码与分析专家',
    provider: 'Anthropic',
    ctx: '200K',
    color: '#8B5CF6',
    letter: 'C',
    gradient: 'linear-gradient(135deg,#7C3AED,#8B5CF6)',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek-V3',
    desc: '中文理解强，高性价比',
    provider: '国内模型',
    ctx: '64K',
    color: '#3B82F6',
    letter: 'D',
    gradient: 'linear-gradient(135deg,#1D4ED8,#3B82F6)',
  },
  {
    id: 'qwen',
    name: '通义千问 Max',
    desc: '阿里大模型，多语言',
    provider: '国内模型',
    ctx: '32K',
    color: '#F59E0B',
    letter: 'Q',
    gradient: 'linear-gradient(135deg,#D97706,#F59E0B)',
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

function isDark(): boolean {
  const t = document.documentElement.getAttribute('data-theme')
  return t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme:dark)').matches)
}

export default function ChatPage(): JSX.Element {
  // View state
  const [view, setView] = useState<'empty' | 'chat'>('chat')
  const [activeConv, setActiveConv] = useState('react-perf')

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [search, setSearch] = useState('')
  const [multiSel, setMultiSel] = useState(false)
  const [selectedConvs, setSelectedConvs] = useState<Set<string>>(new Set())

  // UI state
  const [artifactOpen, setArtifactOpen] = useState(false)
  const [webSearch, setWebSearch] = useState(true)
  // MODELS[0] is always defined (static constant above)
  const [activeModel, setActiveModel] = useState<Model>(MODELS[0] as Model)
  const [modelDropOpen, setModelDropOpen] = useState(false)
  const [userPanelOpen, setUserPanelOpen] = useState(false)
  const [cvMenuOpen, setCvMenuOpen] = useState<string | null>(null)
  const [cvMenuPos, setCvMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [dark, setDark] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Input state
  const [inputValue, setInputValue] = useState('')

  // Think block state
  const [thinkOpen, setThinkOpen] = useState(false)

  // Scroll FAB
  const [showScrollFab, setShowScrollFab] = useState(false)

  // Refs
  const modelBtnRef = useRef<HTMLButtonElement>(null)
  const userTriggerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

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
  }, [])

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
    setView('empty')
    setActiveConv('')
    setInputValue('')
    setSidebarOpen(false)
  }

  const pickConv = (id: string): void => {
    setActiveConv(id)
    setView('chat')
    setSidebarOpen(false)
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
      if (inputValue.trim()) sendMessage()
    }
  }

  const sendMessage = (): void => {
    if (!inputValue.trim()) return
    setView('chat')
    setInputValue('')
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
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

  const appClass = [
    'ch-app',
    view === 'empty' ? 'v-empty' : 'v-chat',
    sidebarCollapsed ? 'sb-col' : '',
    multiSel ? 'multi-sel' : '',
    artifactOpen ? 'ap-open' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const convTitle = CONVERSATIONS.find((c) => c.id === activeConv)?.title ?? '新对话'

  const filteredConvs = search
    ? CONVERSATIONS.filter((c) => c.title.includes(search))
    : CONVERSATIONS

  const groupedConvs = {
    pinned: filteredConvs.filter((c) => c.group === 'pinned'),
    today: filteredConvs.filter((c) => c.group === 'today'),
    yesterday: filteredConvs.filter((c) => c.group === 'yesterday'),
    week: filteredConvs.filter((c) => c.group === 'week'),
  }

  const charCount = inputValue.length

  return (
    <div className={appClass} id="app">
      {/* ── Backdrop overlay — closes all popups on outside click ── */}
      {(modelDropOpen || userPanelOpen || !!cvMenuOpen) && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={closeAllPanels} />
      )}
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
                if (selectedConvs.size === CONVERSATIONS.length) setSelectedConvs(new Set())
                else setSelectedConvs(new Set(CONVERSATIONS.map((c) => c.id)))
              }}
            >
              {selectedConvs.size === CONVERSATIONS.length ? '取消全选' : '全选'}
            </span>
            <span className="ch-multi-c">已选 {selectedConvs.size} 个</span>
            <button
              className="ch-multi-del"
              disabled={selectedConvs.size === 0}
              onClick={() => {
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
          <div className="ch-avatar">李</div>
          <div className="ch-sb-uinfo">
            <div className="ch-sb-uname">李建明</div>
            <div className="ch-sb-uemail">li@example.com</div>
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
              {/* User message */}
              <div className="ch-msg ch-msg-user">
                <div className="ch-msg-body">
                  <div className="ch-msg-bubble">
                    帮我优化这段 React 组件的性能，避免不必要的重渲染。组件需要频繁响应父组件传入的
                    props 变化，目前每次父组件更新都会导致子组件全量重渲染。
                  </div>
                  <div className="ch-msg-acts">
                    <button className="ch-msg-act">
                      <Pencil size={12} /> 编辑
                    </button>
                  </div>
                </div>
              </div>

              {/* AI message */}
              <div className="ch-msg ch-msg-ai">
                <div className="ch-msg-ai-av">元</div>
                <div className="ch-msg-body">
                  {/* Think block */}
                  <div className={`ch-think-block ${thinkOpen ? 'open' : ''}`} data-state="done">
                    <div className="ch-think-hd" onClick={() => setThinkOpen((o) => !o)}>
                      <div className="ch-think-hd-l">
                        <span className="ch-think-ic">
                          <Brain size={14} />
                        </span>
                        <span className="ch-think-lbl">已完成思考</span>
                      </div>
                      <div className="ch-think-hd-r">
                        <span className="ch-think-time">3.2 秒</span>
                        <span className="ch-think-chev">
                          <ChevronDown size={13} />
                        </span>
                      </div>
                    </div>
                    <div className="ch-think-body">
                      <div className="ch-think-text">
                        {`用户遇到的是 React 子组件频繁重渲染的典型问题。根本原因通常有三类：父组件更新时子组件缺少浅比较保护；内联函数每次渲染产生新引用导致 memo 失效；派生数据未缓存导致重复计算开销。\n\n最优解法路径：React.memo 做渲染防护 → useCallback 稳定函数引用 → useMemo 缓存昂贵计算。三者必须协同，单独使用 memo 效果有限。`}
                      </div>
                    </div>
                  </div>
                  <div className="ch-msg-content">
                    <p>
                      针对这种场景，核心优化路径是三件事：
                      <strong>阻断不必要的渲染触发 → 缓存昂贵计算 → 稳定函数引用</strong>。对应
                      React 的三个 API：
                    </p>
                    <p>
                      <strong>React.memo</strong> 对子组件做浅比较，props 未变则跳过渲染；
                      <strong>useMemo</strong> 缓存派生数据；<strong>useCallback</strong>{' '}
                      稳定回调引用，让 memo 真正起作用。三者配合才能完整解决问题。
                    </p>
                  </div>
                  <div className="ch-code-block">
                    <div className="ch-code-head">
                      <span className="ch-code-lang">TypeScript</span>
                      <div className="ch-code-acts">
                        <button className="ch-code-act">
                          <Copy size={12} /> 复制
                        </button>
                        <button className="ch-code-act" onClick={() => setArtifactOpen(true)}>
                          <PanelRight size={12} /> 在面板中查看
                        </button>
                      </div>
                    </div>
                    <pre className="ch-code-body">{`import React, { memo, useMemo, useCallback } from 'react'

interface ListItemProps {
  id: number
  label: string
  value: number
  onSelect: (id: number) => void
}

// memo 阻止 props 未变时的重渲染
const ListItem = memo(({ id, label, value, onSelect }: ListItemProps) => {
  const display = useMemo(
    () => \`\${label}：\${value.toLocaleString('zh-CN')} 元\`,
    [label, value]
  )
  return <div onClick={() => onSelect(id)}>{display}</div>
})

function ProductList({ items }: { items: Item[] }) {
  const [selected, setSelected] = React.useState<number | null>(null)

  const handleSelect = useCallback((id: number) => {
    setSelected(id)
  }, [])

  return (
    <ul>
      {items.map(item => (
        <ListItem key={item.id} {...item} onSelect={handleSelect} />
      ))}
    </ul>
  )
}`}</pre>
                  </div>
                  <div className="ch-msg-content" style={{ marginTop: '12px' }}>
                    <p>
                      <strong>关键：</strong>
                      <code>React.memo</code> 单独使用几乎没用——若父组件每次都传新函数引用，memo
                      的浅比较仍会触发渲染。必须配合 <code>useCallback</code> 才能让引用稳定下来。
                    </p>
                  </div>
                  <div className="ch-msg-acts">
                    <button className="ch-msg-act">
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
                  <div className="ch-followups">
                    <button
                      className="ch-fu"
                      onClick={() => fill('如何使用 React DevTools Profiler 分析组件渲染性能？')}
                    >
                      如何用 React DevTools 分析性能？
                    </button>
                    <button
                      className="ch-fu"
                      onClick={() => fill('useCallback 和 useMemo 的区别是什么？')}
                    >
                      useCallback 和 useMemo 的区别？
                    </button>
                    <button
                      className="ch-fu"
                      onClick={() => fill('React 18 并发模式对性能优化有什么影响？')}
                    >
                      React 18 并发模式影响性能？
                    </button>
                  </div>
                </div>
              </div>

              {/* User follow-up */}
              <div className="ch-msg ch-msg-user">
                <div className="ch-msg-body">
                  <div className="ch-msg-bubble">
                    如何用 React DevTools Profiler 分析组件渲染性能？
                  </div>
                  <div className="ch-msg-acts">
                    <button className="ch-msg-act">
                      <Pencil size={12} /> 编辑
                    </button>
                  </div>
                </div>
              </div>

              {/* AI: thinking */}
              <div className="ch-msg ch-msg-ai">
                <div className="ch-msg-ai-av">元</div>
                <div className="ch-msg-body">
                  <div className="ch-think-block open" data-state="active">
                    <div className="ch-think-hd">
                      <div className="ch-think-hd-l">
                        <span className="ch-think-ic">
                          <Loader2 size={14} className="ch-spin" />
                        </span>
                        <span className="ch-think-lbl">正在思考…</span>
                      </div>
                      <div className="ch-think-hd-r">
                        <span className="ch-think-chev">
                          <ChevronDown size={13} />
                        </span>
                      </div>
                    </div>
                    <div className="ch-think-body">
                      <div className="ch-think-text">
                        用户问的是 React DevTools Profiler 的使用方法。需要涵盖：开启 Profiler
                        标签、录制操作、查看 Flamegraph 和 Ranked 视图、理解「为什么渲染」信息。
                      </div>
                    </div>
                  </div>
                  <div className="ch-thinking">
                    <div className="ch-t-dot" />
                    <div className="ch-t-dot" />
                    <div className="ch-t-dot" />
                  </div>
                </div>
              </div>

              <div style={{ height: '20px' }} />
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
              <button className="ch-in-btn" title="添加附件">
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
                <button
                  className={`ch-send-btn ${inputValue.trim() ? 'on' : ''}`}
                  onClick={sendMessage}
                  disabled={!inputValue.trim()}
                  title="发送 (Enter)"
                >
                  <SendHorizontal size={20} />
                </button>
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

interface ListItemProps {
  id: number
  label: string
  value: number
  onSelect: (id: number) => void
}

const ListItem = memo(({ id, label, value, onSelect }: ListItemProps) => {
  const display = useMemo(
    () => \`\${label}：\${value.toLocaleString('zh-CN')} 元\`,
    [label, value]
  )
  return <div onClick={() => onSelect(id)}>{display}</div>
})

function ProductList({ items }: { items: Item[] }) {
  const [selected, setSelected] = React.useState<number | null>(null)

  const handleSelect = useCallback((id: number) => {
    setSelected(id)
  }, [])

  return (
    <ul>
      {items.map(item => (
        <ListItem key={item.id} {...item} onSelect={handleSelect} />
      ))}
    </ul>
  )
}`}</pre>
        </div>
        <div className="ch-ap-footer">
          <button className="ch-ap-copy-btn">
            <Copy size={14} /> 复制全部
          </button>
          <span className="ch-ap-finfo">TypeScript · 30 行</span>
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
          <div className="ch-up-row danger">
            <LogOut size={16} /> 退出登录
          </div>
        </div>
      )}

      {/* ── Settings modal ───────────────────────── */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* ── Conversation context menus ────────────── */}
      {cvMenuOpen &&
        (() => {
          const conv = CONVERSATIONS.find((c) => c.id === cvMenuOpen)
          if (!conv) return null
          return (
            <div
              className="ch-cvmenu open"
              onClick={(e) => e.stopPropagation()}
              style={{ position: 'fixed', zIndex: 300, top: cvMenuPos.top, left: cvMenuPos.left }}
            >
              <div className="ch-cvm-row">
                <Pencil size={14} /> 重命名
              </div>
              <div className="ch-cvm-row">
                <Pin size={14} /> {conv.group === 'pinned' ? '取消置顶' : '置顶'}
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
              <div className="ch-cvm-row danger">
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
  conv: Conversation
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
