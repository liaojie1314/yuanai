import { http, HttpResponse } from 'msw'

const BASE = 'http://localhost:8000/api/v1'

// ── 内存状态（跨请求持久化） ─────────────────────────────────────────
const mockUser = {
  id: 'user-mock-001',
  email: 'demo@yuanai.dev',
  username: 'demo',
  avatarUrl: null,
  createdAt: '2026-01-01T00:00:00Z',
}

const mockModels = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    description: 'OpenAI 最强多模态模型',
    supportsVision: true,
    supportsFiles: true,
    contextLength: 128000,
    isDefault: true,
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    description: 'Anthropic 旗舰推理模型',
    supportsVision: true,
    supportsFiles: true,
    contextLength: 200000,
    isDefault: false,
  },
  {
    id: 'deepseek-chat',
    name: 'DeepSeek V3',
    provider: 'deepseek',
    description: '高性价比国产大模型',
    supportsVision: false,
    supportsFiles: false,
    contextLength: 64000,
    isDefault: false,
  },
]

// 初始会话数据（含今天、昨天、本周分组）
const conversations: Record<
  string,
  {
    id: string
    title: string
    model: string
    isPinned: boolean
    lastMessageAt: string | null
    createdAt: string
  }
> = {
  'conv-001': {
    id: 'conv-001',
    title: 'React 组件性能优化',
    model: 'gpt-4o',
    isPinned: true,
    lastMessageAt: new Date(Date.now() - 3_600_000).toISOString(),
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
  },
  'conv-002': {
    id: 'conv-002',
    title: '解释量子纠缠的原理',
    model: 'gpt-4o',
    isPinned: false,
    lastMessageAt: new Date(Date.now() - 7_200_000).toISOString(),
    createdAt: new Date(Date.now() - 7_200_000).toISOString(),
  },
  'conv-003': {
    id: 'conv-003',
    title: 'TypeScript 泛型使用技巧',
    model: 'claude-3-5-sonnet-20241022',
    isPinned: false,
    lastMessageAt: new Date(Date.now() - 86_400_000 - 3_600_000).toISOString(),
    createdAt: new Date(Date.now() - 86_400_000 - 3_600_000).toISOString(),
  },
  'conv-004': {
    id: 'conv-004',
    title: 'SQL 查询性能优化',
    model: 'deepseek-chat',
    isPinned: false,
    lastMessageAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  },
}

// 初始消息数据
const messages: Record<
  string,
  Array<{
    id: string
    role: string
    content: string
    model?: string
    tokensUsed?: number
    files: unknown[]
    createdAt: string
  }>
> = {
  'conv-001': [
    {
      id: 'msg-001-1',
      role: 'user',
      content: '帮我优化这段 React 组件的性能，避免不必要的重渲染',
      files: [],
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    },
    {
      id: 'msg-001-2',
      role: 'assistant',
      model: 'gpt-4o',
      tokensUsed: 312,
      content:
        '针对这种场景，核心优化路径是三件事：\n\n**阻断不必要的渲染触发 → 缓存昂贵计算 → 稳定函数引用**。\n\n对应 React 的三个 API：\n\n- `React.memo` 对子组件做浅比较\n- `useMemo` 缓存派生数据\n- `useCallback` 稳定回调引用\n\n三者配合才能完整解决问题。',
      files: [],
      createdAt: new Date(Date.now() - 3_595_000).toISOString(),
    },
  ],
  'conv-002': [
    {
      id: 'msg-002-1',
      role: 'user',
      content: '用简单易懂的方式解释一下量子纠缠是什么',
      files: [],
      createdAt: new Date(Date.now() - 7_200_000).toISOString(),
    },
    {
      id: 'msg-002-2',
      role: 'assistant',
      model: 'gpt-4o',
      tokensUsed: 156,
      content:
        '量子纠缠是量子力学中最神秘的现象之一。\n\n想象你有一副扑克牌，随机抽出两张分开放。在你翻开一张之前，两张牌的花色是"叠加"的。但一旦你翻开一张，另一张的花色**瞬间确定**——即使它在宇宙的另一端。\n\n量子纠缠就是这个原理，只是在量子粒子层面。',
      files: [],
      createdAt: new Date(Date.now() - 7_195_000).toISOString(),
    },
  ],
}

// ── 工具 ─────────────────────────────────────────────────────
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

const MOCK_RESPONSES = [
  '好的，我来帮你分析这个问题。\n\n根据你的描述，核心思路是：\n\n1. **明确目标** - 首先确定期望的输出结果\n2. **拆解步骤** - 将复杂问题分解为可执行的小步骤\n3. **验证方案** - 每个步骤都要有可验证的方式',
  '这是个很好的问题！让我从几个角度来分析：\n\n**技术层面**：需要考虑性能、可维护性和扩展性三个维度的平衡。\n\n**实践层面**：建议从最小可行方案开始，快速验证核心假设，再逐步迭代完善。',
  '明白了。基于你的需求，我有以下几点建议：\n\n首先，这个问题的关键在于理解底层原理。一旦掌握了核心机制，后续的应用就会水到渠成。\n\n其次，推荐你参考官方文档来加深理解。',
]

// ── 处理器 ───────────────────────────────────────────────────
export const handlers = [
  // ── Auth ──
  http.post(`${BASE}/auth/login`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string }
    if (body.email === 'demo@yuanai.dev' && body.password === 'Demo1234!') {
      return HttpResponse.json({
        access_token: 'mock-access-token-' + Date.now(),
        refresh_token: 'mock-refresh-token-' + Date.now(),
        token_type: 'bearer',
        user: mockUser,
      })
    }
    return HttpResponse.json(
      { detail: { code: 'AUTH_INVALID_CREDENTIALS', message: '邮箱或密码错误' } },
      { status: 401 }
    )
  }),

  http.post(`${BASE}/auth/register`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string; username: string }
    return HttpResponse.json(
      {
        access_token: 'mock-access-token-' + Date.now(),
        refresh_token: 'mock-refresh-token-' + Date.now(),
        token_type: 'bearer',
        user: { ...mockUser, email: body.email, username: body.username },
      },
      { status: 201 }
    )
  }),

  http.post(`${BASE}/auth/logout`, () => HttpResponse.json({ message: '已退出登录' })),

  http.get(`${BASE}/auth/me`, () => HttpResponse.json(mockUser)),

  http.patch(`${BASE}/auth/me`, async ({ request }) => {
    const body = (await request.json()) as { username?: string; avatarUrl?: string }
    return HttpResponse.json({ ...mockUser, ...body })
  }),

  // ── Conversations ──
  http.get(`${BASE}/chat/conversations`, () =>
    HttpResponse.json({
      conversations: Object.values(conversations),
      nextCursor: null,
      hasMore: false,
    })
  ),

  http.post(`${BASE}/chat/conversations`, async ({ request }) => {
    const body = (await request.json()) as { model: string; title?: string }
    const id = 'conv-' + uuid().slice(0, 8)
    const now = new Date().toISOString()
    const conv = {
      id,
      title: body.title ?? '新对话',
      model: body.model,
      isPinned: false,
      lastMessageAt: null,
      createdAt: now,
    }
    conversations[id] = conv
    messages[id] = []
    return HttpResponse.json(conv, { status: 201 })
  }),

  http.patch(`${BASE}/chat/conversations/:id`, async ({ params, request }) => {
    const id = params['id'] as string
    const body = (await request.json()) as { title?: string; model?: string; isPinned?: boolean }
    const existing = conversations[id]
    if (!existing) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    conversations[id] = { ...existing, ...body }
    return HttpResponse.json(conversations[id])
  }),

  http.delete(`${BASE}/chat/conversations/:id`, ({ params }) => {
    const id = params['id'] as string

    delete conversations[id]

    delete messages[id]
    return new HttpResponse(null, { status: 204 })
  }),

  // ── Messages ──
  http.get(`${BASE}/chat/conversations/:id/messages`, ({ params }) => {
    const id = params['id'] as string
    return HttpResponse.json({
      messages: messages[id] ?? [],
      nextCursor: null,
      hasMore: false,
    })
  }),

  // ── Stream (SSE) ──
  http.post(`${BASE}/chat/stream`, async ({ request }) => {
    const body = (await request.json()) as {
      conversation_id: string
      model: string
      message: { content: string }
    }

    const convId = body.conversation_id
    const userMsgId = uuid()
    const assistantMsgId = uuid()
    const now = new Date().toISOString()

    // 持久化用户消息
    if (!messages[convId]) messages[convId] = []
    messages[convId].push({
      id: userMsgId,
      role: 'user',
      content: body.message.content,
      files: [],
      createdAt: now,
    })

    // 选择 mock 回复
    const idx = Math.floor(Math.random() * MOCK_RESPONSES.length)
    const responseText = MOCK_RESPONSES[idx] ?? MOCK_RESPONSES[0] ?? ''
    const tokens = responseText.split('')

    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder()

        // message_start
        const startPayload = JSON.stringify({
          user_message_id: userMsgId,
          assistant_message_id: assistantMsgId,
          model: body.model,
        })
        controller.enqueue(enc.encode(`event: message_start\ndata: ${startPayload}\n\n`))

        // content_delta — 每 30ms 发一个 token
        let i = 0
        let full = ''
        const timer = setInterval(() => {
          if (i < tokens.length) {
            const token = tokens[i] ?? ''
            i++
            full += token
            const delta = JSON.stringify({ token })
            controller.enqueue(enc.encode(`event: content_delta\ndata: ${delta}\n\n`))
          } else {
            clearInterval(timer)

            // 持久化助手消息
            const convMsgs = messages[convId]
            if (convMsgs) {
              convMsgs.push({
                id: assistantMsgId,
                role: 'assistant',
                model: body.model,
                tokensUsed: full.length,
                content: full,
                files: [],
                createdAt: new Date().toISOString(),
              })
            }
            const conv = conversations[convId]
            if (conv) {
              conv.lastMessageAt = new Date().toISOString()
            }

            const endPayload = JSON.stringify({ tokensUsed: full.length, finishReason: 'stop' })
            controller.enqueue(enc.encode(`event: message_end\ndata: ${endPayload}\n\n`))
            controller.close()
          }
        }, 30)
      },
    })

    return new HttpResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    })
  }),

  // ── Models ──
  http.get(`${BASE}/models`, () => HttpResponse.json({ models: mockModels })),
]
