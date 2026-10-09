import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { API_BASE_URL } from '@yuanai/core/api'
import { useAuthStore } from '@yuanai/core/stores'

import { server } from '../../../../tests/mocks/server'
import AssistantCenter from '@/components/agent/AssistantCenter'
import en from '@/i18n/locales/en.json'
import zhCN from '@/i18n/locales/zh-CN.json'

const workAssistant = {
  id: 'assistant-1',
  userId: 'user-1',
  name: '工作助理',
  description: '',
  instructions: '',
  defaultModel: 'deepseek-chat',
  autonomyLevel: 'suggest',
  isDefault: true,
  disabledMemoryTypes: null,
  createdAt: '2026-10-07T00:00:00Z',
  updatedAt: '2026-10-07T00:00:00Z',
}

const lifeAssistant = { ...workAssistant, id: 'assistant-2', name: '生活助理', isDefault: false }

const persona = {
  assistantId: 'assistant-1',
  addressUser: '老板',
  selfName: '小元',
  tone: 'concise',
  verbosity: 'balanced',
  greeting: '',
  refusalStyle: '',
  forbiddenTopics: [],
  language: 'zh-CN',
  version: 1,
  updatedAt: '2026-10-07T00:00:00Z',
}

/** 人格编辑器挂在助理列表里，列表用例也会打到它的四个查询。 */
function personaHandlers(): ReturnType<typeof http.get>[] {
  return [
    http.get(`${API_BASE_URL}/agent/assistants/:id/persona`, ({ params }) =>
      HttpResponse.json({ ...persona, assistantId: String(params['id']) })
    ),
    http.get(`${API_BASE_URL}/agent/assistants/:id/persona/versions`, () => HttpResponse.json([])),
    http.post(`${API_BASE_URL}/agent/assistants/:id/persona/preview`, () =>
      HttpResponse.json({ fragment: '语气：简洁直接', truncated: false, characterBudget: 1200 })
    ),
    http.get(`${API_BASE_URL}/agent/persona-candidates`, () => HttpResponse.json([])),
  ]
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
        <AssistantCenter />
      </QueryClientProvider>
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  useAuthStore.getState().setAccessToken('test-token')
  server.use(
    http.get(`${API_BASE_URL}/agent/assistants`, () => HttpResponse.json([workAssistant])),
    http.get(`${API_BASE_URL}/models`, () =>
      HttpResponse.json({
        models: [
          {
            id: 'deepseek-chat',
            name: 'DeepSeek Chat',
            provider: 'deepseek',
            description: '',
            supportsVision: false,
            supportsFiles: true,
            contextLength: 64000,
            isDefault: true,
          },
        ],
      })
    ),
    ...personaHandlers()
  )
})

afterEach(() => {
  useAuthStore.getState().clearAuth()
})

describe('AssistantCenter', () => {
  it('渲染助理列表并标出默认助理', async () => {
    server.use(
      http.get(`${API_BASE_URL}/agent/assistants`, () =>
        HttpResponse.json([workAssistant, lifeAssistant])
      )
    )
    renderCenter()

    expect(await screen.findByText('工作助理')).toBeInTheDocument()
    expect(screen.getByText('生活助理')).toBeInTheDocument()
    expect(screen.getAllByText('默认')).toHaveLength(1)
  })

  it('提交创建表单时带上名称与默认模型', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | null = null
    server.use(
      http.post(`${API_BASE_URL}/agent/assistants`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(lifeAssistant, { status: 201 })
      })
    )
    renderCenter()

    await user.type(await screen.findByLabelText('助理名称'), '生活助理')
    await user.click(screen.getByRole('button', { name: '创建助理' }))

    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toEqual({ name: '生活助理', defaultModel: 'deepseek-chat' })
  })

  it('名称为空时创建按钮不可点', async () => {
    renderCenter()
    expect(await screen.findByRole('button', { name: '创建助理' })).toBeDisabled()
  })

  it('设为默认把 isDefault 发给后端', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | null = null
    server.use(
      http.get(`${API_BASE_URL}/agent/assistants`, () =>
        HttpResponse.json([workAssistant, lifeAssistant])
      ),
      http.patch(`${API_BASE_URL}/agent/assistants/assistant-2`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...lifeAssistant, isDefault: true })
      })
    )
    renderCenter()

    await user.click(await screen.findByRole('button', { name: '把生活助理设为默认' }))
    await waitFor(() => expect(body).toEqual({ isDefault: true }))
  })

  it('删除助理先弹确认框，确认后才发删除请求', async () => {
    const user = userEvent.setup()
    let deleted: string | null = null
    server.use(
      http.get(`${API_BASE_URL}/agent/assistants`, () =>
        HttpResponse.json([workAssistant, lifeAssistant])
      ),
      http.delete(`${API_BASE_URL}/agent/assistants/:id`, ({ params }) => {
        deleted = String(params['id'])
        return new HttpResponse(null, { status: 204 })
      })
    )
    renderCenter()

    await user.click(await screen.findByRole('button', { name: '删除生活助理' }))
    expect(deleted).toBeNull()

    await user.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(deleted).toBe('assistant-2'))
  })

  it('创建失败时显示后端给出的具体原因', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(`${API_BASE_URL}/agent/assistants`, () =>
        HttpResponse.json({ detail: 'ASSISTANT_NOT_FOUND' }, { status: 404 })
      )
    )
    renderCenter()

    await user.type(await screen.findByLabelText('助理名称'), '生活助理')
    await user.click(screen.getByRole('button', { name: '创建助理' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('助理不存在或已被删除')
  })

  it('一个助理都没有时渲染空态而不是一直停在加载中', async () => {
    server.use(http.get(`${API_BASE_URL}/agent/assistants`, () => HttpResponse.json([])))
    renderCenter()

    expect(await screen.findByText('还没有助理')).toBeInTheDocument()
    expect(screen.queryByText('正在加载助理…')).not.toBeInTheDocument()
  })

  it('默认选中默认助理，使人格编辑器对新用户开箱可达', async () => {
    renderCenter()
    expect(await screen.findByRole('heading', { name: '人格' })).toBeInTheDocument()
    expect(await screen.findByDisplayValue('老板')).toBeInTheDocument()
  })

  it('英文资源下关键控件文案来自 i18n 而非硬编码', async () => {
    renderCenter('en')
    expect(await screen.findByRole('button', { name: 'Create assistant' })).toBeInTheDocument()
    expect(screen.getByLabelText('Assistant name')).toBeInTheDocument()
  })
})
