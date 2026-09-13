import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { API_BASE_URL } from '@yuanai/core/api'
import { useAuthStore } from '@yuanai/core/stores'
import { server } from '../../../tests/mocks/server'
import AutomationCenter from '@/components/agent/AutomationCenter'
import en from '@/i18n/locales/en.json'
import zhCN from '@/i18n/locales/zh-CN.json'

const assistant = {
  id: 'assistant-1',
  userId: 'user-1',
  name: 'Research assistant',
  description: '',
  instructions: '',
  defaultModel: 'deepseek-chat',
  autonomyLevel: 'balanced',
  isDefault: true,
  createdAt: '2026-09-13T00:00:00Z',
  updatedAt: '2026-09-13T00:00:00Z',
}

const automation = {
  id: 'automation-1',
  userId: 'user-1',
  assistantId: 'assistant-1',
  name: 'Daily brief',
  goal: 'Summarize today',
  model: null,
  maxSteps: 12,
  timezone: 'UTC',
  status: 'active',
  trigger: {
    id: 'trigger-1',
    automationId: 'automation-1',
    triggerType: 'cron',
    cronExpression: '0 9 * * *',
    scheduledAt: null,
    nextRunAt: '2026-09-14T09:00:00Z',
    lastRunAt: null,
    occurrence: 0,
  },
  runs: [],
  createdAt: '2026-09-13T00:00:00Z',
  updatedAt: '2026-09-13T00:00:00Z',
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
        <AutomationCenter />
      </QueryClientProvider>
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  useAuthStore.getState().setAccessToken('test-token')
  server.use(
    http.get(`${API_BASE_URL}/automations`, () => HttpResponse.json([automation])),
    http.get(`${API_BASE_URL}/agent/assistants`, () => HttpResponse.json([assistant]))
  )
})

afterEach(() => {
  useAuthStore.getState().clearAuth()
  vi.restoreAllMocks()
})

describe('AutomationCenter', () => {
  it('renders the bilingual controls and scheduled status', async () => {
    const view = renderCenter()
    expect(screen.getByRole('heading', { name: '自动化' })).toBeInTheDocument()
    expect(await screen.findByText('Daily brief')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '立即运行' })).toBeInTheDocument()

    view.unmount()
    renderCenter('en')
    expect(screen.getByRole('heading', { name: 'Automations' })).toBeInTheDocument()
  })

  it('creates a cron automation and runs it through the standard endpoint', async () => {
    const user = userEvent.setup()
    const createSpy = vi.fn()
    const runSpy = vi.fn()
    server.use(
      http.post(`${API_BASE_URL}/automations`, async ({ request }) => {
        createSpy(await request.json())
        return HttpResponse.json(automation, { status: 201 })
      }),
      http.post(`${API_BASE_URL}/automations/automation-1/run-now`, () => {
        runSpy()
        return HttpResponse.json(
          {
            id: 'run-1',
            automationId: 'automation-1',
            userId: 'user-1',
            agentRunId: 'agent-run-1',
            occurrenceKey: 'manual:1',
            scheduledFor: '2026-09-13T00:00:00Z',
            status: 'queued',
            waitDeadline: null,
            waitReason: null,
            waitNotifiedAt: null,
            createdAt: '2026-09-13T00:00:00Z',
            updatedAt: '2026-09-13T00:00:00Z',
          },
          { status: 202 }
        )
      })
    )
    renderCenter()
    await user.type(screen.getByLabelText('名称'), 'Weekly brief')
    await user.type(screen.getByLabelText('目标'), 'Summarize the week')
    await user.click(screen.getByLabelText('Cron'))
    await user.click(screen.getByRole('button', { name: '创建自动化' }))
    await waitFor(() => expect(createSpy).toHaveBeenCalled())
    expect(createSpy.mock.calls[0]?.[0]).toMatchObject({
      trigger: { triggerType: 'cron', cronExpression: '0 9 * * 1-5' },
    })

    await user.click(await screen.findByRole('button', { name: '立即运行' }))
    await waitFor(() => expect(runSpy).toHaveBeenCalled())
  })
})
