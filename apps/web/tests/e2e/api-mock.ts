/**
 * Playwright route-level API mock.
 *
 * This intercepts all backend API calls at the CDP network layer — it works
 * regardless of whether the dev server has NEXT_PUBLIC_MOCK=true. Route handlers
 * take priority over the MSW service worker.
 *
 * Call `setupApiMocks(page)` in beforeEach. Each call creates fresh in-memory
 * state so tests don't share data.
 */
import type { Page } from '@playwright/test'

const BASE = 'http://localhost:8000/api/v1'

export const DEMO_EMAIL = 'demo@yuanai.dev'
export const DEMO_PASS = 'Demo1234!'
export const MOCK_TOKEN = 'e2e-mock-access-token'

const MOCK_USER = {
  id: 'user-e2e-001',
  email: DEMO_EMAIL,
  username: 'demo',
  avatarUrl: null,
  createdAt: '2026-01-01T00:00:00Z',
}

const MOCK_RESPONSE =
  '好的，我来帮你分析这个问题。\n\n根据你的描述，核心思路是：\n\n1. **明确目标** - 首先确定期望的输出结果\n2. **拆解步骤** - 将复杂问题分解为可执行的小步骤\n3. **验证方案** - 每个步骤都要有可验证的方式'

function buildSse(responseText: string, convId: string): string {
  const start = JSON.stringify({
    user_message_id: `u-${convId}-${Date.now()}`,
    assistant_message_id: `a-${convId}-${Date.now()}`,
    model: 'deepseek-v4-flash',
  })
  const deltas = [...responseText]
    .map((t) => `event: content_delta\ndata: ${JSON.stringify({ token: t })}\n\n`)
    .join('')
  const end = JSON.stringify({ tokensUsed: responseText.length, finishReason: 'stop' })
  return `event: message_start\ndata: ${start}\n\n${deltas}event: message_end\ndata: ${end}\n\n`
}

type ConvRecord = {
  id: string
  title: string
  model: string
  isPinned: boolean
  lastMessageAt: string | null
  createdAt: string
}

type MsgRecord = {
  id: string
  role: string
  content: string
  model?: string
  tokensUsed?: number
  files: unknown[]
  createdAt: string
}

function makeInitialConvs(): ConvRecord[] {
  return [
    {
      id: 'conv-001',
      title: 'React 组件性能优化',
      model: 'deepseek-v4-flash',
      isPinned: true,
      lastMessageAt: new Date(Date.now() - 3_600_000).toISOString(),
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    },
    {
      id: 'conv-002',
      title: '解释量子纠缠的原理',
      model: 'deepseek-v4-flash',
      isPinned: false,
      lastMessageAt: new Date(Date.now() - 7_200_000).toISOString(),
      createdAt: new Date(Date.now() - 7_200_000).toISOString(),
    },
    {
      id: 'conv-003',
      title: 'TypeScript 泛型使用技巧',
      model: 'deepseek-v4-pro',
      isPinned: false,
      lastMessageAt: new Date(Date.now() - 86_400_000 - 3_600_000).toISOString(),
      createdAt: new Date(Date.now() - 86_400_000 - 3_600_000).toISOString(),
    },
    {
      id: 'conv-004',
      title: 'SQL 查询性能优化',
      model: 'deepseek-v4-flash',
      isPinned: false,
      lastMessageAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    },
  ]
}

function makeInitialMsgs(): Record<string, MsgRecord[]> {
  return {
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
        model: 'deepseek-v4-flash',
        tokensUsed: 150,
        content:
          '针对这种场景，核心优化路径是三件事：\n\n**阻断不必要的渲染触发** → 缓存昂贵计算 → 稳定函数引用。\n\n对应 React 的三个 API：\n\n- `React.memo` 对子组件做浅比较\n- `useMemo` 缓存派生数据\n- `useCallback` 稳定回调引用',
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
        model: 'deepseek-v4-flash',
        tokensUsed: 100,
        content: '量子纠缠是量子力学中最神秘的现象之一。',
        files: [],
        createdAt: new Date(Date.now() - 7_195_000).toISOString(),
      },
    ],
  }
}

/** Set up all API mocks via Playwright route interception. */
export async function setupApiMocks(page: Page): Promise<{
  convs: ConvRecord[]
  msgs: Record<string, MsgRecord[]>
}> {
  const convs = makeInitialConvs()
  const msgs = makeInitialMsgs()

  // ── Auth ────────────────────────────────────────────────────
  await page.route(`${BASE}/auth/login`, async (route) => {
    const body = (await route.request().postDataJSON()) as { email: string; password: string }
    if (body.email === DEMO_EMAIL && body.password === DEMO_PASS) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: MOCK_TOKEN,
          refresh_token: 'e2e-mock-refresh-token',
          token_type: 'bearer',
          user: MOCK_USER,
        }),
      })
    } else {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: { code: 'AUTH_INVALID_CREDENTIALS', message: '邮箱或密码错误' },
        }),
      })
    }
  })

  await page.route(`${BASE}/auth/me`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_USER),
    })
  })

  await page.route(`${BASE}/auth/logout`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: '已退出登录' }),
    })
  })

  // ── Conversations ────────────────────────────────────────────
  await page.route(`${BASE}/chat/conversations`, async (route) => {
    const method = route.request().method()
    if (method === 'POST') {
      const body = (await route.request().postDataJSON()) as { model: string; title?: string }
      const newConv: ConvRecord = {
        id: `conv-${Date.now()}`,
        title: body.title ?? '新对话',
        model: body.model,
        isPinned: false,
        lastMessageAt: null,
        createdAt: new Date().toISOString(),
      }
      convs.push(newConv)
      msgs[newConv.id] = []
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(newConv),
      })
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ conversations: convs, nextCursor: null, hasMore: false }),
      })
    }
  })

  // Messages for a specific conversation
  await page.route(`${BASE}/chat/conversations/*/messages`, async (route) => {
    const url = route.request().url()
    const convId = url.match(/conversations\/([^/]+)\/messages/)?.[1] ?? ''
    const convMsgs = msgs[convId] ?? []
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ messages: convMsgs, nextCursor: null, hasMore: false }),
    })
  })

  // Individual conversation operations (must come AFTER /*/messages to not shadow it)
  await page.route(`${BASE}/chat/conversations/*`, async (route) => {
    const method = route.request().method()
    const url = route.request().url()
    // Skip if this is a messages sub-route (already handled above)
    if (url.includes('/messages')) {
      await route.continue()
      return
    }
    const convId = url.match(/conversations\/([^/?]+)/)?.[1] ?? ''

    if (method === 'DELETE') {
      const idx = convs.findIndex((c) => c.id === convId)
      if (idx !== -1) convs.splice(idx, 1)
      delete msgs[convId]
      await route.fulfill({ status: 204 })
    } else if (method === 'PATCH') {
      const body = (await route.request().postDataJSON()) as Partial<ConvRecord>
      const conv = convs.find((c) => c.id === convId)
      if (conv) Object.assign(conv, body)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(conv ?? {}),
      })
    } else {
      const conv = convs.find((c) => c.id === convId)
      await route.fulfill({
        status: conv ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(conv ?? {}),
      })
    }
  })

  // ── Streaming ────────────────────────────────────────────────
  await page.route(`${BASE}/chat/stream`, async (route) => {
    const body = (await route.request().postDataJSON()) as {
      conversation_id: string
      message: { content: string }
    }
    const convId = body.conversation_id
    if (!msgs[convId]) msgs[convId] = []

    const userMsgId = `u-${Date.now()}`
    const aiMsgId = `a-${Date.now()}`
    msgs[convId].push(
      {
        id: userMsgId,
        role: 'user',
        content: body.message.content,
        files: [],
        createdAt: new Date().toISOString(),
      },
      {
        id: aiMsgId,
        role: 'assistant',
        model: 'deepseek-v4-flash',
        tokensUsed: MOCK_RESPONSE.length,
        content: MOCK_RESPONSE,
        files: [],
        createdAt: new Date().toISOString(),
      }
    )

    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
      body: buildSse(MOCK_RESPONSE, convId),
    })
  })

  // ── Models ───────────────────────────────────────────────────
  await page.route(`${BASE}/models`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        models: [
          {
            id: 'deepseek-v4-flash',
            name: 'DeepSeek V4 Flash-0731',
            provider: 'deepseek',
            description: '纯文本聊天，快速响应，高性价比',
            supports_vision: false,
            supports_files: false,
            context_length: 1000000,
            is_default: true,
          },
          {
            id: 'deepseek-v4-pro',
            name: 'DeepSeek V4 Pro-0813',
            provider: 'deepseek',
            description: '纯文本聊天，中文理解强，旗舰推理',
            supports_vision: false,
            supports_files: false,
            context_length: 1000000,
            is_default: false,
          },
          {
            id: 'agnes-2.5-flash',
            name: 'Agnes 2.5 Flash',
            provider: 'agnes',
            description: '支持推理、工具调用、多轮对话和图像理解',
            supports_vision: true,
            supports_files: true,
            context_length: 128000,
            is_default: false,
          },
        ],
      }),
    })
  })

  return { convs, msgs }
}

/**
 * Log in by going through the login form with mocked API routes.
 * After success the app writes the yuanai-auth cookie (via the fixed setAuth),
 * so middleware will allow access to /chat on subsequent navigations.
 */
export async function loginViaForm(page: Page): Promise<void> {
  await page.goto('/login')
  await setupApiMocks(page)
  await page.click('.a-tab:nth-child(2)')
  await page.fill('input[type="email"]', DEMO_EMAIL)
  await page.fill('input[type="password"]', DEMO_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/chat', { timeout: 10_000 })
}
