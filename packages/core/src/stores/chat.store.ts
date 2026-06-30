import { create } from 'zustand'

/**
 * 会话分组类型，用于侧边栏按时间维度对话归类。
 * - `pinned`：用户手动置顶的会话
 * - `today`：今日创建或更新的会话
 * - `yesterday`：昨日更新的会话
 * - `week`：本周（7 天内）更新的会话
 */
export type ConvGroup = 'pinned' | 'today' | 'yesterday' | 'week'

/**
 * 单条会话的元数据结构（模拟数据阶段）。
 * 对接真实后端后，该接口应与后端 `/conversations` 接口返回字段保持一致。
 */
export interface MockConversation {
  /** 会话唯一标识符 */
  id: string
  /** 会话标题，默认为"新对话" */
  title: string
  /** 会话所属的侧边栏分组 */
  group: ConvGroup
  /** 最近更新时间（Unix 毫秒时间戳） */
  updatedAt: number
}

/**
 * 消息发送方角色类型。
 * - `user`：用户发送的消息
 * - `assistant`：AI 助手回复的消息
 */
export type MessageRole = 'user' | 'assistant'

/**
 * 消息内容块，支持纯文本与代码块两种形式。
 * 一条消息的 `parts` 数组可包含多个内容块，以支持文本与代码混排。
 */
export interface MessagePart {
  /** 内容块类型：`text` 为普通文本，`code` 为代码块 */
  type: 'text' | 'code'
  /** 纯文本内容，`type === 'text'` 时使用 */
  content?: string
  /** 代码语言标识（如 `TypeScript`、`Python`），`type === 'code'` 时使用 */
  lang?: string
  /** 代码正文，`type === 'code'` 时使用 */
  code?: string
}

/**
 * 单条消息的完整结构（模拟数据阶段）。
 * 对接真实后端后，该接口应与后端 `/messages` 接口返回字段保持一致。
 */
export interface MockMessage {
  /** 消息唯一标识符 */
  id: string
  /** 消息发送方角色 */
  role: MessageRole
  /** 消息内容块列表，支持文本与代码混排 */
  parts: MessagePart[]
  /** AI 助手的推理过程（思维链内容），仅 `role === 'assistant'` 时可能存在 */
  thinkContent?: string
  /** AI 助手推荐的追问列表，用于引导用户继续对话 */
  followUps?: string[]
  /** 消息创建时间（Unix 毫秒时间戳） */
  createdAt: number
}

// 用于演示代码块渲染效果的 React 性能优化示例代码，嵌入 `INITIAL_MESSAGES` 中的 'react-perf' 会话。
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

// 初始会话列表，用于在真实后端接入前填充侧边栏，覆盖置顶、今日、昨日、本周等分组场景。
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

// 初始消息映射表，key 为会话 ID，value 为该会话的历史消息列表。
// 仅预填了部分会话（react-perf、quantum、arch）用于 UI 演示，
// 对接真实后端后应移除此常量，改为通过 API 按需加载历史消息。
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

// 模拟 AI 流式回复使用的候选回复池，在用户发送新消息时随机抽取一条进行逐字符流式输出。
// 对接真实后端 SSE 流式接口后，此常量应移除，改为消费后端推送的 token 事件。
const MOCK_RESPONSES = [
  '好的，我来帮你分析这个问题。\n\n根据你的描述，核心思路是：\n\n1. **明确目标** - 首先确定期望的输出结果\n2. **拆解步骤** - 将复杂问题分解为可执行的小步骤\n3. **验证方案** - 每个步骤都要有可验证的方式\n\n具体来说...',
  '这是个很好的问题！让我从几个角度来分析：\n\n**技术层面**：需要考虑性能、可维护性和扩展性三个维度的平衡。\n\n**实践层面**：建议从最小可行方案开始，快速验证核心假设，再逐步迭代完善。\n\n结论是选择方案 B 更合适，因为...',
  '明白了。基于你的需求，我有以下几点建议：\n\n首先，这个问题的关键在于理解底层原理。一旦掌握了核心机制，后续的应用就会水到渠成。\n\n其次，推荐你参考以下资料来加深理解...',
]

// 用于生成唯一消息 ID 的自增计数器，确保每条新消息的 ID 不重复。
let msgIdCounter = 1000

/**
 * 生成一个自增的唯一消息 ID。
 * @returns 格式为 `msg-{n}` 的字符串 ID
 */
function genId(): string {
  return `msg-${(++msgIdCounter).toString()}`
}

/**
 * 聊天 Store 的完整状态与 Action 类型定义。
 * 包含会话列表、消息映射、流式输出状态，以及对应的操作方法。
 */
interface ChatState {
  /** 所有会话的元数据列表，按 `updatedAt` 降序排列 */
  conversations: MockConversation[]
  /** 消息映射表，key 为会话 ID，value 为该会话的消息数组 */
  messages: Record<string, MockMessage[]>
  /** 当前正在流式输出的会话 ID，无流式任务时为 `null` */
  streamingConvId: string | null
  /** 当前流式输出已累积的文本内容 */
  streamingContent: string
  /** 当前流式输出占位消息的 ID，无流式任务时为 `null` */
  streamingMsgId: string | null

  /**
   * 获取指定会话的消息列表。
   * @param convId 会话 ID
   * @returns 消息数组，会话不存在时返回空数组
   */
  getMessages: (convId: string) => MockMessage[]

  /**
   * 创建一个新会话，并插入到会话列表顶部。
   * @param title 会话标题，默认为 `"新对话"`
   * @returns 新创建会话的 ID
   */
  createConversation: (title?: string) => string

  /**
   * 删除指定会话及其全部消息。
   * @param id 要删除的会话 ID
   */
  deleteConversation: (id: string) => void

  /**
   * 重命名指定会话。
   * @param id 会话 ID
   * @param title 新标题
   */
  renameConversation: (id: string, title: string) => void

  /**
   * 切换指定会话的置顶状态：
   * - 已置顶（`pinned`）→ 移回 `today` 分组
   * - 未置顶 → 移至 `pinned` 分组
   * @param id 会话 ID
   */
  togglePin: (id: string) => void

  /**
   * 向指定会话追加一条用户消息，并更新会话的 `updatedAt` 时间戳。
   * @param convId 会话 ID
   * @param content 消息文本内容
   * @returns 新消息的 ID
   */
  addUserMessage: (convId: string, content: string) => string

  /**
   * 开始流式输出：在指定会话中插入一条空的占位 AI 消息，并初始化流式状态。
   * @param convId 会话 ID
   * @returns 占位消息的 ID（用于后续 `finalizeStream` 定位并替换内容）
   */
  startStreaming: (convId: string) => string

  /**
   * 追加一个流式 token 到当前累积内容。
   * 每次 SSE 事件推送一个 token 时调用。
   * @param token 本次推送的文本片段
   */
  appendToken: (token: string) => void

  /**
   * 完成流式输出：用最终完整内容替换占位消息，并清空流式状态。
   * 若当前没有进行中的流式任务，则静默返回。
   * @param content 流式完成后的完整文本内容
   */
  finalizeStream: (content: string) => void
}

/**
 * 聊天模块的全局状态 Store（基于 Zustand）。
 *
 * **当前阶段（模拟数据）**：所有会话与消息均来自本地常量（`INITIAL_CONVERSATIONS`、
 * `INITIAL_MESSAGES`），AI 回复从 `MOCK_RESPONSES` 随机抽取并在前端模拟流式输出。
 *
 * **对接真实后端时需要做的改动**：
 * 1. 移除 `INITIAL_CONVERSATIONS`、`INITIAL_MESSAGES`、`MOCK_RESPONSES` 常量，
 *    改为通过 TanStack Query 调用后端 REST 接口加载会话列表和历史消息。
 * 2. `startStreaming` / `appendToken` / `finalizeStream` 的调用方应从本地模拟定时器
 *    改为消费后端 SSE 流式接口推送的 token 事件。
 * 3. `createConversation`、`deleteConversation`、`renameConversation`、`togglePin`
 *    等写操作需同步调用对应的后端 API，成功后再更新本地状态。
 * 4. 本 Store 的职责将收缩为仅维护 UI 层的流式状态（`streamingConvId` 等），
 *    服务端数据的缓存与同步交由 TanStack Query 负责。
 */
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
      // 同步删除该会话的所有消息，避免内存泄漏
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
        // 已置顶则取消置顶（回到 today 分组），否则置顶
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
      // 同步更新会话的最近活跃时间，确保侧边栏排序正确
      conversations: s.conversations.map((c) =>
        c.id === convId ? { ...c, updatedAt: Date.now() } : c
      ),
    }))
    return id
  },

  startStreaming: (convId) => {
    const msgId = genId()
    // 插入空 parts 的占位消息，流式完成后由 finalizeStream 替换其内容
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
    // 直接拼接到累积字符串，UI 层订阅 streamingContent 实现逐字渲染
    set((s) => ({ streamingContent: s.streamingContent + token }))
  },

  finalizeStream: (content) => {
    const { streamingConvId, streamingMsgId } = get()
    // 若无进行中的流式任务则静默退出，防止重复调用导致状态错误
    if (!streamingConvId || !streamingMsgId) return
    set((s) => ({
      streamingConvId: null,
      streamingContent: '',
      streamingMsgId: null,
      messages: {
        ...s.messages,
        // 用最终完整内容替换占位消息的 parts
        [streamingConvId]: (s.messages[streamingConvId] ?? []).map((m) =>
          m.id === streamingMsgId ? { ...m, parts: [{ type: 'text' as const, content }] } : m
        ),
      },
    }))
  },
}))

export { MOCK_RESPONSES }
