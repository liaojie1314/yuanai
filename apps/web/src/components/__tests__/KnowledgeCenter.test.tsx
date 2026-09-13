import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { API_BASE_URL } from '@yuanai/core/api'
import { useAuthStore } from '@yuanai/core/stores'
import { server } from '../../../tests/mocks/server'
import KnowledgeCenter from '@/components/agent/KnowledgeCenter'
import en from '@/i18n/locales/en.json'
import zhCN from '@/i18n/locales/zh-CN.json'

const base = {
  id: 'base-1',
  ownerId: 'user-1',
  name: 'Research notes',
  spaceId: null,
  createdAt: '2026-09-13T00:00:00Z',
  updatedAt: '2026-09-13T00:00:00Z',
}

const document = {
  id: 'document-1',
  sourceId: 'source-1',
  version: 1,
  contentHash: 'hash',
  status: 'staged',
  createdAt: '2026-09-13T00:00:00Z',
  publishedAt: null,
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
        <KnowledgeCenter />
      </QueryClientProvider>
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  useAuthStore.getState().setAccessToken('test-token')
  server.use(http.get(`${API_BASE_URL}/knowledge-bases`, () => HttpResponse.json([base])))
  server.use(
    http.get(`${API_BASE_URL}/knowledge-bases/:baseId/sources`, () => HttpResponse.json([]))
  )
})

afterEach(() => {
  useAuthStore.getState().clearAuth()
})

describe('KnowledgeCenter', () => {
  it('renders the bilingual knowledge management surface', async () => {
    const view = renderCenter()
    expect(screen.getByRole('heading', { name: '知识中心' })).toBeInTheDocument()
    expect(await screen.findByText('Research notes')).toBeInTheDocument()

    view.unmount()
    renderCenter('en')
    expect(screen.getByRole('heading', { name: 'Knowledge Center' })).toBeInTheDocument()
    expect(await screen.findByText('Research notes')).toBeInTheDocument()
  })

  it('stages, publishes, and searches a text source in the selected base', async () => {
    const user = userEvent.setup()
    let searchRequest: unknown
    server.use(
      http.post(`${API_BASE_URL}/knowledge-bases/base-1/sources/text`, () =>
        HttpResponse.json(document, { status: 201 })
      ),
      http.post(
        `${API_BASE_URL}/knowledge-bases/base-1/sources/source-1/documents/document-1/publish`,
        () =>
          HttpResponse.json({
            ...document,
            status: 'published',
            publishedAt: '2026-09-13T00:01:00Z',
          })
      ),
      http.post(`${API_BASE_URL}/knowledge-bases/base-1/search`, async ({ request }) => {
        searchRequest = await request.json()
        return HttpResponse.json([
          {
            knowledgeBaseId: 'base-1',
            sourceId: 'source-1',
            documentId: 'document-1',
            sourceName: 'Notes',
            sourceUri: null,
            documentVersion: 1,
            chunkIndex: 0,
            section: 'Summary',
            charStart: 0,
            charEnd: 18,
            content: 'Published material',
            score: 0.9,
          },
        ])
      })
    )
    renderCenter()
    await user.click(await screen.findByRole('button', { name: /Research notes/ }))
    await user.type(screen.getByLabelText('来源名称'), 'Notes')
    await user.type(screen.getByLabelText('文本内容'), 'Published material')
    await user.click(screen.getByRole('button', { name: '构建暂存版本' }))
    expect(await screen.findByText('待发布')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '发布版本' }))
    expect(await screen.findByText('已发布')).toBeInTheDocument()

    await user.type(screen.getByLabelText('输入一个问题'), 'What was published?')
    await user.click(screen.getByRole('button', { name: '检索' }))
    expect(await screen.findByText('Published material')).toBeInTheDocument()
    await waitFor(() => expect(searchRequest).toEqual({ query: 'What was published?' }))
  })

  it('publishes a staged version loaded after a page refresh', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(`${API_BASE_URL}/knowledge-bases/base-1/sources`, () =>
        HttpResponse.json([
          {
            id: 'source-1',
            knowledgeBaseId: 'base-1',
            name: 'Existing notes',
            sourceType: 'text',
            sourceUri: null,
            createdAt: '2026-09-13T00:00:00Z',
            documents: [document],
          },
        ])
      ),
      http.post(
        `${API_BASE_URL}/knowledge-bases/base-1/sources/source-1/documents/document-1/publish`,
        () => HttpResponse.json({ ...document, status: 'published' })
      )
    )
    renderCenter()
    await user.click(await screen.findByRole('button', { name: /Research notes/ }))
    await user.click(await screen.findByRole('button', { name: /Existing notes/ }))
    await user.click(screen.getByRole('button', { name: '发布版本' }))
    expect(await screen.findByText('已发布')).toBeInTheDocument()
  })
})
