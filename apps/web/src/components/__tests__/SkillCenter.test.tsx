import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { server } from '../../../tests/mocks/server'
import { API_BASE_URL } from '@yuanai/core/api'
import { useAuthStore } from '@yuanai/core/stores'
import SkillCenter from '@/components/agent/SkillCenter'
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
  createdAt: '2026-09-11T00:00:00Z',
  updatedAt: '2026-09-11T00:00:00Z',
}

const version = {
  id: 'version-1',
  skillId: 'skill-1',
  version: '1.0.0',
  manifestText: 'manifest',
  skillMd: '# Research Brief',
  contentHash: 'hash',
  requiredTools: ['calculate@^1'],
  riskCeiling: 'read',
  status: 'validated',
  validationResult: { valid: true },
  validationErrors: [],
  createdAt: '2026-09-11T00:00:00Z',
  validatedAt: '2026-09-11T00:00:00Z',
}

const skill = {
  id: 'skill-1',
  userId: 'user-1',
  slug: 'yuanai.research.brief',
  name: 'Research Brief',
  description: 'Build a cited brief',
  currentVersionId: 'version-1',
  versions: [version],
  installations: [],
  createdAt: '2026-09-11T00:00:00Z',
  updatedAt: '2026-09-11T00:00:00Z',
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
        <SkillCenter />
      </QueryClientProvider>
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  useAuthStore.getState().setAccessToken('test-token')
  server.use(
    http.get(`${API_BASE_URL}/skills`, () => HttpResponse.json([skill])),
    http.get(`${API_BASE_URL}/agent/assistants`, () => HttpResponse.json([assistant]))
  )
})

afterEach(() => {
  useAuthStore.getState().clearAuth()
  vi.restoreAllMocks()
})

describe('SkillCenter', () => {
  it('renders the bilingual management surface', async () => {
    const view = renderCenter()
    expect(screen.getByRole('heading', { name: '技能' })).toBeInTheDocument()
    expect(await screen.findByText('Research Brief')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '激活' })).toBeInTheDocument()

    view.unmount()
    renderCenter('en')
    expect(screen.getByRole('heading', { name: 'Skills' })).toBeInTheDocument()
  })

  it('creates a draft with a generated manifest and installs the active version for an assistant', async () => {
    const user = userEvent.setup()
    const createSpy = vi.fn()
    const installSpy = vi.fn()
    server.use(
      http.post(`${API_BASE_URL}/skills`, async ({ request }) => {
        createSpy(await request.json())
        return HttpResponse.json(skill, { status: 201 })
      }),
      http.put(`${API_BASE_URL}/skills/skill-1/installations`, async ({ request }) => {
        installSpy(await request.json())
        return HttpResponse.json({
          id: 'installation-1',
          skillId: 'skill-1',
          scope: 'assistant',
          assistantId: 'assistant-1',
          createdAt: '2026-09-11T00:00:00Z',
        })
      })
    )
    renderCenter()
    await user.type(screen.getByLabelText('技能 ID'), 'yuanai.research.brief')
    await user.type(screen.getByLabelText('名称'), 'Research Brief')
    await user.type(screen.getByLabelText('描述'), 'Build a cited brief')
    await user.type(screen.getByLabelText('操作说明'), '# Research Brief')
    await user.click(screen.getByRole('button', { name: '创建草稿' }))
    await waitFor(() => expect(createSpy).toHaveBeenCalled())
    expect(createSpy.mock.calls[0]?.[0]).toMatchObject({ skillMd: '# Research Brief' })
    expect(String(createSpy.mock.calls[0]?.[0]?.manifest)).toContain('required_tools:')

    await user.selectOptions(screen.getByRole('combobox', { name: '启用范围' }), 'assistant')
    await user.selectOptions(screen.getByLabelText('助理'), 'assistant-1')
    await user.click(screen.getByRole('button', { name: '启用' }))
    await waitFor(() =>
      expect(installSpy).toHaveBeenCalledWith({ scope: 'assistant', assistantId: 'assistant-1' })
    )
  })
})
