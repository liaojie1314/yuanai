import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { API_BASE_URL } from '@yuanai/core/api'
import { useAuthStore } from '@yuanai/core/stores'
import { server } from '../../../tests/mocks/server'
import MemoryCenter from '@/components/agent/MemoryCenter'
import en from '@/i18n/locales/en.json'
import zhCN from '@/i18n/locales/zh-CN.json'

const assistant = {
  id: 'assistant-1',
  userId: 'user-1',
  name: '测试主体1',
  description: '',
  instructions: '',
  defaultModel: 'deepseek-chat',
  autonomyLevel: 'suggest',
  isDefault: true,
  disabledMemoryTypes: null,
  createdAt: '2026-09-18T00:00:00Z',
  updatedAt: '2026-09-18T00:00:00Z',
}

const baseMemory = {
  userId: 'user-1',
  assistantId: 'assistant-1',
  workspaceId: null,
  memoryType: 'preference',
  structuredData: null,
  sourceType: 'user_input',
  sourceId: null,
  sourceExcerpt: null,
  confidence: 0.9,
  sensitivity: 'personal',
  storageLocation: 'cloud',
  nodeId: null,
  status: 'active',
  validFrom: null,
  validUntil: null,
  lastUsedAt: null,
  createdAt: '2026-09-18T00:00:00Z',
  updatedAt: '2026-09-18T00:00:00Z',
}

const firstMemory = { ...baseMemory, id: 'memory-1', content: '记忆内容A' }
const secondMemory = { ...baseMemory, id: 'memory-2', content: '记忆内容B' }
const candidateMemory = { ...baseMemory, id: 'memory-3', content: '记忆内容C', status: 'candidate' }
const localMemory = {
  ...baseMemory,
  id: 'memory-4',
  content: null,
  storageLocation: 'local_node',
  nodeId: 'node-1',
}

const memoriesCss = readFileSync(
  resolve(process.cwd(), 'src/components/agent/memories.css'),
  'utf8'
)

/** 按请求游标返回预置的分页结果，无游标时返回 `first` 页。 */
function pagedMemories(pages: Record<string, unknown>): ReturnType<typeof http.get> {
  return http.get(`${API_BASE_URL}/memories`, ({ request }) => {
    const cursor = new URL(request.url).searchParams.get('cursor') ?? 'first'
    return HttpResponse.json(pages[cursor] ?? { items: [], nextCursor: null })
  })
}

/** 读出 Blob 文本，jsdom 的 Blob 没有实现 `text()`。 */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(blob)
  })
}

function renderCenter(locale: 'zh-CN' | 'en' = 'zh-CN'): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={(locale === 'zh-CN' ? zhCN : en) as unknown as Record<string, string>}
    >
      <QueryClientProvider client={queryClient}>
        <MemoryCenter />
      </QueryClientProvider>
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  useAuthStore.getState().setAccessToken('test-token')
  // jsdom 不实现对象 URL，导出走的下载链路需要桩掉
  URL.createObjectURL = vi.fn(() => 'blob:memories')
  URL.revokeObjectURL = vi.fn()
  server.use(
    http.get(`${API_BASE_URL}/agent/assistants`, () => HttpResponse.json([assistant])),
    pagedMemories({ first: { items: [firstMemory], nextCursor: null } })
  )
})

afterEach(() => {
  useAuthStore.getState().clearAuth()
  vi.restoreAllMocks()
})

describe('MemoryCenter', () => {
  it('渲染当前页的记忆列表', async () => {
    renderCenter()
    expect(await screen.findByText('记忆内容A')).toBeInTheDocument()
  })

  it('点击加载更多时请求下一页并追加结果', async () => {
    const user = userEvent.setup()
    server.use(
      pagedMemories({
        first: { items: [firstMemory], nextCursor: 'cursor-2' },
        'cursor-2': { items: [secondMemory], nextCursor: null },
      })
    )
    renderCenter()
    expect(await screen.findByText('记忆内容A')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '加载更多' }))
    expect(await screen.findByText('记忆内容B')).toBeInTheDocument()
    expect(screen.getByText('记忆内容A')).toBeInTheDocument()
  })

  it('最后一页不显示加载更多按钮', async () => {
    renderCenter()
    expect(await screen.findByText('记忆内容A')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument()
  })

  it('本地记忆不可用时显示提示而不是静默少几条', async () => {
    server.use(pagedMemories({ first: { items: [firstMemory, localMemory], nextCursor: null } }))
    renderCenter()
    expect(await screen.findByText(/本机节点/)).toBeInTheDocument()
    expect(screen.getByText('记忆内容A')).toBeInTheDocument()
  })

  it('确认候选记忆会发出 active 状态更新', async () => {
    const user = userEvent.setup()
    let patched: unknown
    server.use(
      pagedMemories({ first: { items: [candidateMemory], nextCursor: null } }),
      http.patch(`${API_BASE_URL}/memories/memory-3`, async ({ request }) => {
        patched = await request.json()
        return HttpResponse.json({ ...candidateMemory, status: 'active' })
      })
    )
    renderCenter()
    await user.click(await screen.findByRole('button', { name: '确认记住' }))
    await waitFor(() => expect(patched).toEqual({ status: 'active' }))
  })

  it('关闭某个记忆类型会更新助理设置', async () => {
    const user = userEvent.setup()
    let patched: unknown
    server.use(
      http.patch(`${API_BASE_URL}/agent/assistants/assistant-1`, async ({ request }) => {
        patched = await request.json()
        return HttpResponse.json({ ...assistant, disabledMemoryTypes: ['preference'] })
      })
    )
    renderCenter()
    await user.click(await screen.findByRole('button', { name: /偏好/ }))
    await waitFor(() => expect(patched).toEqual({ disabledMemoryTypes: ['preference'] }))
  })

  it('导出按钮触发导出请求并把结果交给浏览器下载', async () => {
    const user = userEvent.setup()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')
    let exported = false
    const payload = { exportedAt: '2026-09-18T12:00:00Z', items: [firstMemory] }
    server.use(
      http.get(`${API_BASE_URL}/memories/export`, () => {
        exported = true
        return HttpResponse.json(payload)
      })
    )
    renderCenter()
    await user.click(await screen.findByRole('button', { name: '导出记忆' }))
    await waitFor(() => expect(exported).toBe(true))

    // 下载必须真的发生：由响应体建出对象 URL，并点击挂到文档上的锚点
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1))
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob
    expect(JSON.parse(await readBlob(blob))).toEqual(payload)
    expect(click).toHaveBeenCalledTimes(1)
    const anchor = click.mock.contexts[0] as HTMLAnchorElement
    expect(anchor.download).toBe('memories.json')
    expect(anchor.href).toBe('blob:memories')
  })

  it('导出失败时显示失败提示而不是静默吞掉', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(`${API_BASE_URL}/memories/export`, () => new HttpResponse(null, { status: 500 }))
    )
    renderCenter()
    await user.click(await screen.findByRole('button', { name: '导出记忆' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('操作失败，请重试')
  })

  it('记忆类型开关更新失败时显示失败提示', async () => {
    const user = userEvent.setup()
    server.use(
      http.patch(
        `${API_BASE_URL}/agent/assistants/assistant-1`,
        () => new HttpResponse(null, { status: 500 })
      )
    )
    renderCenter()
    await user.click(await screen.findByRole('button', { name: /偏好/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('操作失败，请重试')
  })

  it('英文资源下关键控件文案来自 i18n 而非硬编码', async () => {
    server.use(
      pagedMemories({
        first: { items: [firstMemory, localMemory], nextCursor: 'cursor-2' },
        'cursor-2': { items: [secondMemory], nextCursor: null },
      })
    )
    renderCenter('en')
    expect(await screen.findByRole('button', { name: 'Load more' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export memories' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Memory types' })).toBeInTheDocument()
    expect(screen.getByText(/local node/)).toBeInTheDocument()
  })

  it('状态徽标颜色取自主题 token', async () => {
    server.use(pagedMemories({ first: { items: [firstMemory, localMemory], nextCursor: null } }))
    const { container } = renderCenter()
    expect(await screen.findByText('记忆内容A')).toBeInTheDocument()
    expect(container.querySelector('.memory-badge')).toHaveTextContent('已启用')

    const themed = [...memoriesCss.matchAll(/\.(memory-badge|memory-banner)\s*\{([^}]*)\}/g)]
    expect(themed.length).toBe(2)
    for (const [, selector, body] of themed) {
      expect(body, `${selector} 未使用主题 token`).toMatch(/var\(--/)
      expect(body, `${selector} 使用了原始颜色值`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    }
  })
})
