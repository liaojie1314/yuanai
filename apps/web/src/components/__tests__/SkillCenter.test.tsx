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
  latestEvaluation: null,
}

const failedEvaluation = {
  id: 'evaluation-1',
  skillId: 'skill-1',
  versionId: 'version-1',
  status: 'failed',
  mode: 'static_contract',
  caseResults: [
    { name: 'manifest_contract', status: 'passed', detail: 'manifest 字段与版本号一致' },
    {
      name: 'risk_ceiling_not_escalated',
      status: 'failed',
      detail: '风险上限由 read 抬高到 privileged',
    },
  ],
  totalCases: 6,
  passedCases: 5,
  passRate: '0.8333',
  estimatedCostUsd: null,
  avgSteps: null,
  durationMs: 2,
  createdAt: '2026-09-11T00:00:00Z',
}

const suggestion = {
  slug: 'experience.calculate.1a2b3c4d',
  name: '统计每周销售额',
  description: '由 3 次成功任务归纳：calculate',
  occurrences: 3,
  runIds: ['run-1', 'run-2', 'run-3'],
  steps: ['calculate'],
  parameters: ['calculate.expression'],
  requiredTools: ['calculate@^1'],
  riskCeiling: 'read',
  manifest: 'id: experience.calculate.1a2b3c4d',
  skillMd: '# 统计每周销售额',
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
    http.get(`${API_BASE_URL}/skills/suggestions`, () => HttpResponse.json([])),
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

  it('exposes an evaluate action and surfaces the failing gate case', async () => {
    const user = userEvent.setup()
    const evaluateSpy = vi.fn()
    server.use(
      http.post(`${API_BASE_URL}/skills/skill-1/versions/version-1/evaluate`, () => {
        evaluateSpy()
        return HttpResponse.json(failedEvaluation)
      }),
      http.get(`${API_BASE_URL}/skills`, () =>
        HttpResponse.json([
          {
            ...skill,
            versions: [
              {
                ...version,
                latestEvaluation: evaluateSpy.mock.calls.length ? failedEvaluation : null,
              },
            ],
          },
        ])
      )
    )
    renderCenter()
    await user.click(await screen.findByRole('button', { name: '评测' }))
    await waitFor(() => expect(evaluateSpy).toHaveBeenCalled())
    expect(await screen.findByText('评测未通过（5/6 条用例）')).toBeInTheDocument()
    expect(screen.getByText(/风险上限由 read 抬高到 privileged/)).toBeInTheDocument()
    // 静态契约评测没有执行面，界面必须说明而不是显示 0 成本。
    expect(screen.getByText('静态契约评测，未真实执行，无成本与平均 Step 数据')).toBeInTheDocument()
  })

  it('submits an experience-derived suggestion verbatim as a draft', async () => {
    const user = userEvent.setup()
    const createSpy = vi.fn()
    server.use(
      http.get(`${API_BASE_URL}/skills/suggestions`, () => HttpResponse.json([suggestion])),
      http.post(`${API_BASE_URL}/skills`, async ({ request }) => {
        createSpy(await request.json())
        return HttpResponse.json(skill, { status: 201 })
      })
    )
    renderCenter()
    expect(await screen.findByText('统计每周销售额')).toBeInTheDocument()
    expect(screen.getByText('已成功完成 3 次')).toBeInTheDocument()
    expect(screen.getByText(/calculate.expression/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '保存为草稿' }))
    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith({
        manifest: suggestion.manifest,
        skillMd: suggestion.skillMd,
      })
    )
  })
})
