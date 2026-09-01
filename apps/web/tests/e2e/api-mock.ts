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
  return `event: message_start\ndata: ${start}\n\n${deltas}event: message_end\ndata: ${end}\n\ndata: [DONE]\n\n`
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

type ToolCenterState = 'populated' | 'empty' | 'failure'

interface ApiMockOptions {
  toolCenterState?: ToolCenterState
}

type ToolConnectionFixture = Record<string, unknown> & {
  id: string
  kind: string
  provider: string
  displayName: string
  secretRef: string | null
}

type McpServerFixture = Record<string, unknown> & {
  id: string
  schemaSnapshot: Record<string, unknown> | null
  enabledTools: string[]
}

type ExecutionNodeFixture = Record<string, unknown> & {
  id: string
  status: string
}

type ToolExecutionFixture = Record<string, unknown> & {
  id: string
  status: 'queued' | 'cancelled' | 'succeeded'
  finishedAt: string | null
}

type ApprovalFixture = Record<string, unknown> & {
  id: string
  status: string
  decidedAt: string | null
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
export async function setupApiMocks(
  page: Page,
  options: ApiMockOptions = {}
): Promise<{
  convs: ConvRecord[]
  msgs: Record<string, MsgRecord[]>
}> {
  const convs = makeInitialConvs()
  const msgs = makeInitialMsgs()
  const toolCenterState = options.toolCenterState ?? 'populated'

  const toolCatalog = [
    {
      name: 'yuanai.web.search',
      version: '1.0.0',
      description: '搜索公开网页并返回结构化结果',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      riskLevel: 'read',
      sideEffect: 'none',
      executionLocation: 'cloud',
      executionLocations: ['cloud'],
      requiredScopes: [],
      timeoutSeconds: 60,
      maxOutputBytes: 100000,
      idempotent: true,
      supportsCancel: true,
      tags: ['web', 'search'],
    },
    {
      name: 'yuanai.files.write',
      version: '1.0.0',
      description: '在 Agent 工作区生成文件',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      riskLevel: 'local_write',
      sideEffect: 'write',
      executionLocation: 'cloud',
      executionLocations: ['cloud'],
      requiredScopes: ['workspace.write'],
      timeoutSeconds: 60,
      maxOutputBytes: 100000,
      idempotent: true,
      supportsCancel: true,
      tags: ['files'],
    },
  ]
  const toolConnections: ToolConnectionFixture[] = [
    {
      id: 'tool-conn-1',
      userId: 'user-e2e-001',
      kind: 'mcp_http',
      provider: 'docs',
      displayName: 'Docs MCP HTTP',
      secretRef: 'db://secret-ref',
      scopes: ['docs.read'],
      status: 'active',
      metadata: {},
      lastVerifiedAt: '2026-08-31T08:00:00Z',
      createdAt: '2026-08-30T08:00:00Z',
      updatedAt: '2026-08-31T08:00:00Z',
    },
    {
      id: 'tool-conn-2',
      userId: 'user-e2e-001',
      kind: 'mcp_stdio',
      provider: 'local-tools',
      displayName: 'Local stdio',
      secretRef: null,
      scopes: [],
      status: 'active',
      metadata: {},
      lastVerifiedAt: null,
      createdAt: '2026-08-30T08:00:00Z',
      updatedAt: '2026-08-30T08:00:00Z',
    },
  ]
  const mcpServers: McpServerFixture[] = [
    {
      id: 'mcp-1',
      userId: 'user-e2e-001',
      connectionId: 'tool-conn-1',
      name: 'Docs MCP',
      endpointUrl: 'https://mcp.example.com/mcp',
      command: null,
      commandArgs: [],
      transport: 'streamable_http',
      status: 'active',
      schemaSnapshot: null,
      schemaHash: null,
      enabledTools: [],
      metadata: {},
      lastVerifiedAt: null,
      createdAt: '2026-08-30T08:00:00Z',
      updatedAt: '2026-08-30T08:00:00Z',
    },
  ]
  const executionNodes: ExecutionNodeFixture[] = [
    {
      id: 'node-1',
      userId: 'user-e2e-001',
      name: 'Office Desktop',
      platform: 'linux',
      appVersion: '0.1.0',
      capabilities: ['browser_open_url'],
      status: 'offline',
      lastSeenAt: '2026-08-30T08:00:00Z',
      policy: { allowed_tools: ['browser_open_url'], allowed_resource_ids: ['grant-1'] },
      createdAt: '2026-08-30T08:00:00Z',
      updatedAt: '2026-08-30T08:00:00Z',
    },
  ]
  const resourceGrants = [
    {
      id: 'grant-1',
      userId: 'user-e2e-001',
      nodeId: 'node-1',
      kind: 'directory',
      resourceId: 'workspace://agent',
      displayName: 'Agent workspace',
      scopes: ['read', 'write'],
      revokedAt: null,
      createdAt: '2026-08-30T08:00:00Z',
    },
  ]
  const toolExecutions: ToolExecutionFixture[] = [
    {
      id: 'exec-1',
      userId: 'user-e2e-001',
      runId: null,
      stepId: null,
      toolName: 'yuanai.web.search',
      toolVersion: '1.0.0',
      connectionId: null,
      mcpServerId: null,
      executionLocation: 'cloud',
      nodeId: null,
      riskLevel: 'read',
      sideEffect: 'none',
      argumentsPreview: { query: 'Phase 6' },
      argumentsHash: 'hash-1',
      idempotencyKey: null,
      status: 'succeeded',
      resultSummary: '找到 3 条结果',
      resultJson: { status: 'succeeded', summary: '找到 3 条结果', data: { count: 3 } },
      artifactIds: ['artifact-1'],
      errorCode: null,
      errorMessage: null,
      startedAt: '2026-08-31T08:10:00Z',
      finishedAt: '2026-08-31T08:10:03Z',
      createdAt: '2026-08-31T08:10:00Z',
    },
    {
      id: 'exec-2',
      userId: 'user-e2e-001',
      runId: null,
      stepId: null,
      toolName: 'yuanai.files.write',
      toolVersion: '1.0.0',
      connectionId: null,
      mcpServerId: null,
      executionLocation: 'cloud',
      nodeId: null,
      riskLevel: 'local_write',
      sideEffect: 'write',
      argumentsPreview: { name: 'report.md' },
      argumentsHash: 'hash-2',
      idempotencyKey: null,
      status: 'queued',
      resultSummary: null,
      resultJson: null,
      artifactIds: [],
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      createdAt: '2026-08-31T08:11:00Z',
    },
  ]
  const artifacts = [
    {
      id: 'artifact-1',
      userId: 'user-e2e-001',
      runId: null,
      toolExecutionId: 'exec-1',
      kind: 'document',
      name: 'report.md',
      mimeType: 'text/markdown',
      sizeBytes: 2048,
      sha256: 'sha256-report',
      sensitivity: 'personal',
      retentionPolicy: 'default',
      expiresAt: '2026-09-30T08:00:00Z',
      preview: { lines: ['# Report', 'Generated by tool runtime'] },
      downloadUrl: `${BASE}/artifacts/artifact-1/content?expires=1&token=e2e`,
      createdAt: '2026-08-31T08:10:03Z',
    },
  ]
  const approvals: ApprovalFixture[] = [
    {
      id: 'approval-1',
      runId: null,
      stepId: null,
      userId: 'user-e2e-001',
      toolName: 'yuanai.files.write',
      executionLocation: 'cloud',
      riskLevel: 'local_write',
      actionSummary: '在 Agent 工作区生成 report.md',
      argumentsPreview: { name: 'report.md' },
      payloadHash: 'approval-hash',
      status: 'pending',
      expiresAt: '2026-09-01T08:20:00Z',
      decidedAt: null,
      decisionNote: null,
      createdAt: '2026-08-31T08:12:00Z',
    },
  ]

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

  // ── Tool Control Center ──────────────────────────────────────
  const toolCenterFailure = toolCenterState === 'failure'
  const toolCenterEmpty = toolCenterState === 'empty'
  const toolCenterResponse = <T>(data: T): T | { detail: string } =>
    toolCenterFailure ? { detail: 'Tool Control Center fixture failure' } : data
  const toolCenterStatus = toolCenterFailure ? 500 : 200

  await page.route(`${BASE}/tools/catalog`, async (route) => {
    await route.fulfill({
      status: toolCenterStatus,
      contentType: 'application/json',
      body: JSON.stringify(toolCenterResponse(toolCenterEmpty ? [] : toolCatalog)),
    })
  })

  await page.route(`${BASE}/tool-connections`, async (route) => {
    if (route.request().method() === 'POST') {
      const input = (await route.request().postDataJSON()) as Record<string, unknown>
      const created = {
        ...toolConnections[0],
        id: `tool-conn-${Date.now()}`,
        kind: String(input['kind'] ?? 'api_key'),
        provider: String(input['provider'] ?? ''),
        displayName: String(input['displayName'] ?? ''),
        secretRef: typeof input['secretRef'] === 'string' ? input['secretRef'] : null,
      }
      toolConnections.unshift(created)
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(created),
      })
      return
    }
    await route.fulfill({
      status: toolCenterStatus,
      contentType: 'application/json',
      body: JSON.stringify(toolCenterResponse(toolCenterEmpty ? [] : toolConnections)),
    })
  })

  await page.route(`${BASE}/tool-connections/*`, async (route) => {
    const id = route.request().url().split('/').pop()
    const index = toolConnections.findIndex((connection) => connection.id === id)
    if (index >= 0) toolConnections.splice(index, 1)
    await route.fulfill({ status: 204 })
  })

  await page.route(`${BASE}/mcp-servers`, async (route) => {
    if (route.request().method() === 'POST') {
      const input = (await route.request().postDataJSON()) as Record<string, unknown>
      const created = {
        ...mcpServers[0],
        id: `mcp-${Date.now()}`,
        name: input['name'],
        transport: input['transport'],
        connectionId: input['connectionId'],
        endpointUrl: input['endpointUrl'] ?? null,
        command: input['command'] ?? null,
        commandArgs: input['commandArgs'] ?? [],
        schemaSnapshot: null,
        enabledTools: [],
      }
      mcpServers.unshift(created)
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(created),
      })
      return
    }
    await route.fulfill({
      status: toolCenterStatus,
      contentType: 'application/json',
      body: JSON.stringify(toolCenterResponse(toolCenterEmpty ? [] : mcpServers)),
    })
  })

  await page.route(`${BASE}/mcp-servers/*/discover`, async (route) => {
    const server = mcpServers.find((item) => route.request().url().includes(item.id))
    if (!server) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Not found' }),
      })
      return
    }
    server.schemaSnapshot = {
      tools: [
        {
          name: 'search_docs',
          description: 'Search documentation',
          inputSchema: { type: 'object' },
          annotations: { readOnlyHint: true },
        },
      ],
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(server),
    })
  })

  await page.route(`${BASE}/mcp-servers/*/tools`, async (route) => {
    const server = mcpServers.find((item) => route.request().url().includes(item.id))
    const input = (await route.request().postDataJSON()) as { enabledTools: string[] }
    if (server) server.enabledTools = input.enabledTools
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(server),
    })
  })

  await page.route(`${BASE}/execution-nodes`, async (route) => {
    await route.fulfill({
      status: toolCenterStatus,
      contentType: 'application/json',
      body: JSON.stringify(toolCenterResponse(toolCenterEmpty ? [] : executionNodes)),
    })
  })

  await page.route(`${BASE}/execution-nodes/pair`, async (route) => {
    const input = (await route.request().postDataJSON()) as Record<string, string>
    const pairing = {
      ...executionNodes[0],
      id: `node-${Date.now()}`,
      name: input['name'],
      platform: input['platform'],
      appVersion: input['appVersion'],
      pairingCode: 'pairing-code-e2e',
      expiresAt: '2026-09-01T08:30:00Z',
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(pairing),
    })
  })

  await page.route(`${BASE}/execution-nodes/*/revoke`, async (route) => {
    const node = executionNodes.find((item) => route.request().url().includes(item.id))
    if (node) node.status = 'revoked'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(node),
    })
  })

  await page.route(`${BASE}/resource-grants`, async (route) => {
    await route.fulfill({
      status: toolCenterStatus,
      contentType: 'application/json',
      body: JSON.stringify(toolCenterResponse(toolCenterEmpty ? [] : resourceGrants)),
    })
  })

  await page.route(`${BASE}/tool-executions**`, async (route) => {
    await route.fulfill({
      status: toolCenterStatus,
      contentType: 'application/json',
      body: JSON.stringify(toolCenterResponse(toolCenterEmpty ? [] : toolExecutions)),
    })
  })

  await page.route(`${BASE}/tool-executions/*/cancel`, async (route) => {
    const execution = toolExecutions.find((item) => route.request().url().includes(item.id))
    if (execution) {
      execution.status = 'cancelled'
      execution.finishedAt = '2026-09-01T08:15:00Z'
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(execution),
    })
  })

  await page.route(`${BASE}/artifacts`, async (route) => {
    await route.fulfill({
      status: toolCenterStatus,
      contentType: 'application/json',
      body: JSON.stringify(toolCenterResponse(toolCenterEmpty ? [] : artifacts)),
    })
  })

  await page.route(`${BASE}/artifacts/*/content**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/markdown',
      headers: { 'Content-Disposition': 'attachment; filename="report.md"' },
      body: '# Report\nGenerated by tool runtime',
    })
  })

  await page.route(`${BASE}/artifacts/*`, async (route) => {
    const id = route.request().url().split('/').pop()
    const index = artifacts.findIndex((artifact) => artifact.id === id)
    if (index >= 0) artifacts.splice(index, 1)
    await route.fulfill({ status: 204 })
  })

  await page.route(`${BASE}/agent/approvals`, async (route) => {
    await route.fulfill({
      status: toolCenterStatus,
      contentType: 'application/json',
      body: JSON.stringify(toolCenterResponse(toolCenterEmpty ? [] : approvals)),
    })
  })

  await page.route(`${BASE}/agent/approvals/*`, async (route) => {
    const approval = approvals.find((item) => route.request().url().includes(item.id))
    const input = (await route.request().postDataJSON()) as { decision: 'approve' | 'deny' }
    if (approval) {
      approval.status = input.decision === 'approve' ? 'approved' : 'denied'
      approval.decidedAt = '2026-09-01T08:15:00Z'
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(approval),
    })
  })

  // ── Chat capabilities ───────────────────────────────────────
  await page.route(`${BASE}/chat/capabilities**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        webSearch: { enabled: true, provider: 'searxng', reason: null },
      }),
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
  await setupApiMocks(page)
  await page.goto('/login')
  await page.click('.a-tab:nth-child(2)')
  await page.fill('input[type="email"]', DEMO_EMAIL)
  await page.fill('input[type="password"]', DEMO_PASS)
  const loginResponse = page.waitForResponse(
    (response) => response.url().endsWith('/auth/login') && response.status() === 200,
    { timeout: 20_000 }
  )
  const cookieReady = page.waitForFunction(
    () => document.cookie.split('; ').some((cookie) => cookie.startsWith('yuanai-auth=')),
    undefined,
    { timeout: 20_000 }
  )
  const chatNavigation = page.waitForURL(
    (url) => url.pathname === '/chat' || url.pathname.startsWith('/chat/'),
    { timeout: 20_000 }
  )
  await page.click('button[type="submit"]')
  await Promise.all([loginResponse, cookieReady, chatNavigation])
}
