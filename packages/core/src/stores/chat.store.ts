import { create } from 'zustand'

export type ConvGroup = 'pinned' | 'today' | 'yesterday' | 'week'

export interface MockConversation {
  id: string
  title: string
  group: ConvGroup
  updatedAt: number
}

export type MessageRole = 'user' | 'assistant'

export interface MessagePart {
  type: 'text' | 'code'
  content?: string
  lang?: string
  code?: string
}

export interface MockMessage {
  id: string
  role: MessageRole
  parts: MessagePart[]
  thinkContent?: string
  followUps?: string[]
  createdAt: number
}

const REACT_PERF_CODE = `import React, { memo, useMemo, useCallback } from 'react'

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
}`

const INITIAL_CONVERSATIONS: MockConversation[] = [
  { id: 'arch', title: '前端架构设计讨论', group: 'pinned', updatedAt: Date.now() - 86400000 },
  {
    id: 'react-perf',
    title: 'React 组件性能优化',
    group: 'today',
    updatedAt: Date.now() - 3600000,
  },
  { id: 'quantum', title: '解释量子纠缠的原理', group: 'today', updatedAt: Date.now() - 7200000 },
  { id: 'python', title: 'Python 数据分析脚本', group: 'today', updatedAt: Date.now() - 10800000 },
  {
    id: 'ts',
    title: 'TypeScript 泛型使用技巧',
    group: 'yesterday',
    updatedAt: Date.now() - 172800000,
  },
  { id: 'sql', title: 'SQL 查询性能优化', group: 'yesterday', updatedAt: Date.now() - 180000000 },
  { id: 'prd', title: '产品需求文档撰写', group: 'week', updatedAt: Date.now() - 432000000 },
  { id: 'prompt', title: '如何写出好的提示词', group: 'week', updatedAt: Date.now() - 518400000 },
  { id: 'rust', title: 'Rust 所有权系统详解', group: 'week', updatedAt: Date.now() - 604800000 },
]

const INITIAL_MESSAGES: Record<string, MockMessage[]> = {
  'react-perf': [
    {
      id: 'rp-u1',
      role: 'user',
      parts: [
        {
          type: 'text',
          content:
            '帮我优化这段 React 组件的性能，避免不必要的重渲染。组件需要频繁响应父组件传入的 props 变化，目前每次父组件更新都会导致子组件全量重渲染。',
        },
      ],
      createdAt: Date.now() - 120000,
    },
    {
      id: 'rp-a1',
      role: 'assistant',
      thinkContent:
        '用户遇到的是 React 子组件频繁重渲染的典型问题。根本原因通常有三类：父组件更新时子组件缺少浅比较保护；内联函数每次渲染产生新引用导致 memo 失效；派生数据未缓存导致重复计算开销。\n\n最优解法路径：React.memo 做渲染防护 → useCallback 稳定函数引用 → useMemo 缓存昂贵计算。三者必须协同，单独使用 memo 效果有限。',
      parts: [
        {
          type: 'text',
          content:
            '针对这种场景，核心优化路径是三件事：**阻断不必要的渲染触发 → 缓存昂贵计算 → 稳定函数引用**。对应 React 的三个 API：\n\n**React.memo** 对子组件做浅比较，props 未变则跳过渲染；**useMemo** 缓存派生数据；**useCallback** 稳定回调引用，让 memo 真正起作用。三者配合才能完整解决问题。',
        },
        { type: 'code', lang: 'TypeScript', code: REACT_PERF_CODE },
        {
          type: 'text',
          content:
            '**关键**：`React.memo` 单独使用几乎没用——若父组件每次都传新函数引用，memo 的浅比较仍会触发渲染。必须配合 `useCallback` 才能让引用稳定下来。',
        },
      ],
      followUps: [
        '如何用 React DevTools Profiler 分析组件渲染性能？',
        'useCallback 和 useMemo 的区别是什么？',
        'React 18 并发模式对性能优化有什么影响？',
      ],
      createdAt: Date.now() - 115000,
    },
  ],
  quantum: [
    {
      id: 'qt-u1',
      role: 'user',
      parts: [{ type: 'text', content: '用简单易懂的方式解释一下量子纠缠是什么' }],
      createdAt: Date.now() - 7200000,
    },
    {
      id: 'qt-a1',
      role: 'assistant',
      parts: [
        {
          type: 'text',
          content:
            '量子纠缠是量子力学中最神秘的现象之一，用一个比喻来理解：\n\n想象你有一副扑克牌，随机抽出两张分开放。在你翻开一张之前，两张牌的花色是"叠加"的（既可能是红色也可能是黑色）。但一旦你翻开一张，另一张的花色**瞬间确定**——即使它在宇宙的另一端。\n\n量子纠缠就是这个原理，只是在量子粒子（如光子、电子）层面。两个纠缠粒子无论相隔多远，测量其中一个，另一个的状态会**立刻确定**，这个速度甚至超过光速——但无法用来传递信息。',
        },
      ],
      followUps: ['量子纠缠能用于量子计算吗？', '爱因斯坦为什么反对量子纠缠理论？'],
      createdAt: Date.now() - 7195000,
    },
  ],
  arch: [
    {
      id: 'ar-u1',
      role: 'user',
      parts: [{ type: 'text', content: '我们的前端项目应该用什么架构？Monorepo 还是多仓库？' }],
      createdAt: Date.now() - 86400000,
    },
    {
      id: 'ar-a1',
      role: 'assistant',
      parts: [
        {
          type: 'text',
          content:
            '对于中大型团队的前端项目，**Monorepo** 是更推荐的选择，原因有三：\n\n1. **代码复用简单** - 共享组件库、工具函数可以直接引用，不需要发布 npm 包\n2. **统一版本管理** - 所有包版本保持一致，避免版本漂移问题\n3. **原子化提交** - 跨包的修改可以在一个 PR 中完成，保持变更的一致性\n\n推荐工具链：**Turborepo + pnpm workspaces**，Turborepo 提供增量构建缓存，大幅提升 CI 速度。',
        },
      ],
      createdAt: Date.now() - 86395000,
    },
  ],
}

const MOCK_RESPONSES = [
  '好的，我来帮你分析这个问题。\n\n根据你的描述，核心思路是：\n\n1. **明确目标** - 首先确定期望的输出结果\n2. **拆解步骤** - 将复杂问题分解为可执行的小步骤\n3. **验证方案** - 每个步骤都要有可验证的方式\n\n具体来说...',
  '这是个很好的问题！让我从几个角度来分析：\n\n**技术层面**：需要考虑性能、可维护性和扩展性三个维度的平衡。\n\n**实践层面**：建议从最小可行方案开始，快速验证核心假设，再逐步迭代完善。\n\n结论是选择方案 B 更合适，因为...',
  '明白了。基于你的需求，我有以下几点建议：\n\n首先，这个问题的关键在于理解底层原理。一旦掌握了核心机制，后续的应用就会水到渠成。\n\n其次，推荐你参考以下资料来加深理解...',
]

let msgIdCounter = 1000

function genId(): string {
  return `msg-${(++msgIdCounter).toString()}`
}

interface ChatState {
  conversations: MockConversation[]
  messages: Record<string, MockMessage[]>
  streamingConvId: string | null
  streamingContent: string
  streamingMsgId: string | null

  getMessages: (convId: string) => MockMessage[]
  createConversation: (title?: string) => string
  deleteConversation: (id: string) => void
  renameConversation: (id: string, title: string) => void
  togglePin: (id: string) => void
  addUserMessage: (convId: string, content: string) => string
  startStreaming: (convId: string) => string
  appendToken: (token: string) => void
  finalizeStream: (content: string) => void
}

export const useChatStore = create<ChatState>()((set, get) => ({
  conversations: INITIAL_CONVERSATIONS,
  messages: INITIAL_MESSAGES,
  streamingConvId: null,
  streamingContent: '',
  streamingMsgId: null,

  getMessages: (convId) => get().messages[convId] ?? [],

  createConversation: (title = '新对话') => {
    const id = `conv-${Date.now()}`
    set((s) => ({
      conversations: [{ id, title, group: 'today', updatedAt: Date.now() }, ...s.conversations],
      messages: { ...s.messages, [id]: [] },
    }))
    return id
  },

  deleteConversation: (id) => {
    set((s) => {
      const convs = s.conversations.filter((c) => c.id !== id)
      const msgs = { ...s.messages }
      delete msgs[id]
      return { conversations: convs, messages: msgs }
    })
  },

  renameConversation: (id, title) => {
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, title } : c)),
    }))
  },

  togglePin: (id) => {
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, group: c.group === 'pinned' ? 'today' : 'pinned' } : c
      ),
    }))
  },

  addUserMessage: (convId, content) => {
    const id = genId()
    const msg: MockMessage = {
      id,
      role: 'user',
      parts: [{ type: 'text', content }],
      createdAt: Date.now(),
    }
    set((s) => ({
      messages: {
        ...s.messages,
        [convId]: [...(s.messages[convId] ?? []), msg],
      },
      conversations: s.conversations.map((c) =>
        c.id === convId ? { ...c, updatedAt: Date.now() } : c
      ),
    }))
    return id
  },

  startStreaming: (convId) => {
    const msgId = genId()
    const placeholderMsg: MockMessage = {
      id: msgId,
      role: 'assistant',
      parts: [],
      createdAt: Date.now(),
    }
    set((s) => ({
      streamingConvId: convId,
      streamingContent: '',
      streamingMsgId: msgId,
      messages: {
        ...s.messages,
        [convId]: [...(s.messages[convId] ?? []), placeholderMsg],
      },
    }))
    return msgId
  },

  appendToken: (token) => {
    set((s) => ({ streamingContent: s.streamingContent + token }))
  },

  finalizeStream: (content) => {
    const { streamingConvId, streamingMsgId } = get()
    if (!streamingConvId || !streamingMsgId) return
    set((s) => ({
      streamingConvId: null,
      streamingContent: '',
      streamingMsgId: null,
      messages: {
        ...s.messages,
        [streamingConvId]: (s.messages[streamingConvId] ?? []).map((m) =>
          m.id === streamingMsgId ? { ...m, parts: [{ type: 'text' as const, content }] } : m
        ),
      },
    }))
  },
}))

export { MOCK_RESPONSES }
