import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '../../../tests/mocks/server'
import { useAuthStore } from '@yuanai/core/stores'
import ToolControlCenter from '@/components/agent/ToolControlCenter'
import zhCN from '@/i18n/locales/zh-CN.json'
import en from '@/i18n/locales/en.json'

const API = 'http://localhost:8000/api/v1'

const catalogItem = {
  name: 'yuanai.web.search',
  version: '1.0.0',
  description: '搜索公开网页并返回结构化结果',
  riskLevel: 'read',
  executionLocation: 'cloud',
  requiredScopes: [],
  tags: ['web'],
}

const connection = {
  id: 'conn-1',
  userId: 'user-1',
  kind: 'api_key',
  provider: 'test',
  displayName: 'Test Connection',
  scopes: ['files.read'],
  status: 'active',
  metadata: {},
  lastVerifiedAt: null,
  createdAt: '2026-08-30T00:00:00Z',
  updatedAt: '2026-08-30T00:00:00Z',
}

const node = {
  id: 'node-1',
  userId: 'user-1',
  name: 'My Desktop',
  platform: 'linux',
  appVersion: '0.1.0',
  capabilities: ['browser_open_url'],
  status: 'online',
  lastSeenAt: '2026-08-30T00:00:00Z',
  policy: { allowed_tools: ['browser_open_url'], allowed_resource_ids: [] },
  createdAt: '2026-08-30T00:00:00Z',
  updatedAt: '2026-08-30T00:00:00Z',
}

const execution = {
  id: 'exec-1',
  userId: 'user-1',
  runId: null,
  stepId: null,
  toolName: 'yuanai.web.search',
  toolVersion: '1.0.0',
  executionLocation: 'cloud',
  riskLevel: 'read',
  sideEffect: 'none',
  argumentsPreview: { query: 'test' },
  argumentsHash: 'hash',
  idempotencyKey: null,
  nodeId: null,
  status: 'queued',
  resultJson: null,
  artifactIds: [],
  nodeDeliveryStatus: null,
  nodeProgress: null,
  nodeLastDeliveredAt: null,
  nodeAcknowledgedAt: null,
  errorCode: null,
  errorMessage: null,
  startedAt: null,
  finishedAt: null,
  createdAt: '2026-08-30T00:00:00Z',
  updatedAt: '2026-08-30T00:00:00Z',
}

const approval = {
  id: 'appr-1',
  runId: null,
  stepId: null,
  userId: 'user-1',
  toolName: 'files_write',
  executionLocation: 'cloud',
  riskLevel: 'high',
  actionSummary: '执行工具 files_write',
  argumentsPreview: { path: 'a.txt' },
  payloadHash: 'hash',
  status: 'pending',
  expiresAt: '2026-08-31T00:00:00Z',
  decidedAt: null,
  decisionNote: null,
  createdAt: '2026-08-30T00:00:00Z',
}

const artifact = {
  id: 'art-1',
  userId: 'user-1',
  runId: null,
  toolExecutionId: null,
  kind: 'document',
  name: 'report.md',
  mimeType: 'text/markdown',
  sizeBytes: 2048,
  sha256: 'abc',
  sensitivity: 'personal',
  retentionPolicy: 'default',
  expiresAt: '2026-09-30T00:00:00Z',
  preview: null,
  downloadUrl: '/api/v1/artifacts/art-1/content?expires=1&token=abc',
  createdAt: '2026-08-30T00:00:00Z',
}

function renderCenter(locale: 'zh-CN' | 'en' = 'zh-CN'): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const messages = (locale === 'zh-CN' ? zhCN : en) as unknown as Record<string, string>
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <QueryClientProvider client={queryClient}>
        <ToolControlCenter />
      </QueryClientProvider>
    </NextIntlClientProvider>
  )
}

function withProvider(children: ReactNode): ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <NextIntlClientProvider locale="zh-CN" messages={zhCN as unknown as Record<string, string>}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  useAuthStore.getState().setAccessToken('test-token')
  server.use(
    http.get(`${API}/tools/catalog`, () => HttpResponse.json([catalogItem])),
    http.get(`${API}/tool-connections`, () => HttpResponse.json([connection])),
    http.get(`${API}/execution-nodes`, () => HttpResponse.json([node])),
    http.get(`${API}/resource-grants`, () => HttpResponse.json([])),
    http.get(`${API}/mcp-servers`, () => HttpResponse.json([])),
    http.get(`${API}/tool-executions`, () => HttpResponse.json([execution])),
    http.get(`${API}/artifacts`, () => HttpResponse.json([artifact])),
    http.get(`${API}/agent/approvals`, () => HttpResponse.json([approval]))
  )
})

afterEach(() => {
  useAuthStore.getState().clearAuth()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ToolControlCenter', () => {
  it('渲染工具目录与风险标签', async () => {
    renderCenter()
    expect(screen.getByRole('heading', { name: '工具控制中心' })).toBeInTheDocument()
    expect(await screen.findByText('yuanai.web.search')).toBeInTheDocument()
    expect(screen.getByText('只读')).toBeInTheDocument()
  })

  it('英文资源下渲染关键控件文案', async () => {
    renderCenter('en')
    expect(screen.getByRole('heading', { name: 'Tool Control Center' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Catalog/ })).toBeInTheDocument()
    expect(await screen.findByText('yuanai.web.search')).toBeInTheDocument()
    expect(screen.getByText('Read')).toBeInTheDocument()
  })

  it('连接页签展示连接并支持撤销', async () => {
    const user = userEvent.setup()
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    const deleteSpy = vi.fn(() => new HttpResponse(null, { status: 204 }))
    server.use(http.delete(`${API}/tool-connections/conn-1`, () => deleteSpy()))
    renderCenter()
    await user.click(screen.getByRole('button', { name: /连接/ }))
    expect(await screen.findByText('Test Connection')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /撤销/ }))
    expect(confirm).toHaveBeenCalled()
    await waitFor(() => expect(deleteSpy).toHaveBeenCalled())
  })

  it('执行页签展示执行记录且可取消', async () => {
    const user = userEvent.setup()
    const cancelSpy = vi.fn(() => HttpResponse.json({ ...execution, status: 'cancelled' }))
    server.use(http.post(`${API}/tool-executions/exec-1/cancel`, () => cancelSpy()))
    renderCenter()
    await user.click(screen.getByRole('button', { name: /执行记录/ }))
    expect(await screen.findByText('yuanai.web.search')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /取消/ }))
    await waitFor(() => expect(cancelSpy).toHaveBeenCalled())
  })

  it('节点页签生成仅显示一次的配对码并展示资源授权', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(`${API}/execution-nodes/pair`, () =>
        HttpResponse.json(
          {
            ...node,
            id: 'node-2',
            status: 'offline',
            pairingCode: 'pair-me-once',
            expiresAt: '2026-08-30T00:10:00Z',
          },
          { status: 201 }
        )
      )
    )
    render(withProvider(<ToolControlCenter />))
    await user.click(screen.getByRole('button', { name: /执行节点/ }))
    await screen.findByText('My Desktop')
    await user.click(screen.getByRole('button', { name: '生成配对码' }))
    await user.type(await screen.findByLabelText('显示名称'), 'Office Desktop')
    await user.type(screen.getByLabelText('版本'), '0.1.0')
    await user.click(screen.getByRole('button', { name: '生成配对码' }))
    expect(await screen.findByText('pair-me-once')).toBeInTheDocument()
    expect(screen.getByText(/10 分钟内有效/)).toBeInTheDocument()
  })

  it('Artifact 页签提供下载链接与删除确认', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false)
    )
    const deleteSpy = vi.fn(() => new HttpResponse(null, { status: 204 }))
    server.use(http.delete(`${API}/artifacts/art-1`, () => deleteSpy()))
    renderCenter()
    await user.click(screen.getByRole('button', { name: /Artifact/ }))
    const link = await screen.findByRole('link', { name: /下载/ })
    expect(link).toHaveAttribute('href', artifact.downloadUrl)
    await user.click(screen.getByRole('button', { name: /删除/ }))
    expect(deleteSpy).not.toHaveBeenCalled()
  })

  it('Artifact 预览内容被渲染', async () => {
    server.use(
      http.get(`${API}/artifacts`, () =>
        HttpResponse.json([{ ...artifact, preview: { lines: ['第一行'] } }])
      )
    )
    renderCenter()
    await userEvent.setup().click(screen.getByRole('button', { name: /Artifact/ }))
    expect(await screen.findByText(/预览: /)).toBeInTheDocument()
  })

  it('审批页签展示待处理审批并支持批准', async () => {
    const user = userEvent.setup()
    const decideSpy = vi.fn(() => HttpResponse.json({ ...approval, status: 'approved' }))
    server.use(http.post(`${API}/agent/approvals/appr-1`, () => decideSpy()))
    renderCenter()
    await user.click(screen.getByRole('button', { name: /审批/ }))
    expect(await screen.findByText('执行工具 files_write')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '批准' }))
    await waitFor(() => expect(decideSpy).toHaveBeenCalled())
  })
})
