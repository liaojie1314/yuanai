import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { API_BASE_URL } from '@yuanai/core/api'
import { useAuthStore } from '@yuanai/core/stores'

import { server } from '../../../../tests/mocks/server'
import PersonaEditor from '@/components/agent/PersonaEditor'
import en from '@/i18n/locales/en.json'
import zhCN from '@/i18n/locales/zh-CN.json'

const persona = {
  assistantId: 'assistant-1',
  addressUser: '老板',
  selfName: '小元',
  tone: 'concise',
  verbosity: 'balanced',
  greeting: '',
  refusalStyle: '直接说明原因',
  forbiddenTopics: ['赌博'],
  language: 'zh-CN',
  version: 2,
  updatedAt: '2026-10-07T00:00:00Z',
}

const candidate = {
  id: 'candidate-1',
  assistantId: 'assistant-1',
  field: 'tone',
  suggestedValue: 'lively',
  evidence: '你能不能活泼一点',
  sourceType: 'chat',
  status: 'pending',
  createdAt: '2026-10-07T00:00:00Z',
}

function renderEditor(locale: 'zh-CN' | 'en' = 'zh-CN'): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={(locale === 'zh-CN' ? zhCN : en) as unknown as Record<string, string>}
    >
      <QueryClientProvider client={queryClient}>
        <PersonaEditor assistantId="assistant-1" />
      </QueryClientProvider>
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  useAuthStore.getState().setAccessToken('test-token')
  server.use(
    http.get(`${API_BASE_URL}/agent/assistants/assistant-1/persona`, () =>
      HttpResponse.json(persona)
    ),
    http.get(`${API_BASE_URL}/agent/assistants/assistant-1/persona/versions`, () =>
      HttpResponse.json([
        {
          version: 1,
          changeReason: 'manual',
          payload: { tone: 'patient' },
          createdAt: '2026-10-07T00:00:00Z',
        },
        {
          version: 2,
          changeReason: 'manual',
          payload: { tone: 'concise' },
          createdAt: '2026-10-07T01:00:00Z',
        },
      ])
    ),
    http.post(
      `${API_BASE_URL}/agent/assistants/assistant-1/persona/preview`,
      async ({ request }) => {
        const draft = (await request.json()) as { tone?: string }
        return HttpResponse.json({
          fragment: draft.tone === 'lively' ? '语气：轻松活泼，可以用口语' : '语气：简洁直接',
          truncated: false,
          characterBudget: 1200,
        })
      }
    ),
    http.get(`${API_BASE_URL}/agent/persona-candidates`, () => HttpResponse.json([candidate]))
  )
})

afterEach(() => {
  useAuthStore.getState().clearAuth()
})

describe('PersonaEditor', () => {
  it('用后端已保存的人格填充表单', async () => {
    renderEditor()
    expect(await screen.findByDisplayValue('老板')).toBeInTheDocument()
    expect(screen.getByDisplayValue('小元')).toBeInTheDocument()
    expect(screen.getByLabelText('语气')).toHaveValue('concise')
  })

  it('改语气后预览区跟着变', async () => {
    const user = userEvent.setup()
    renderEditor()

    expect(await screen.findByText('语气：简洁直接')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('语气'), 'lively')

    expect(
      await screen.findByText('语气：轻松活泼，可以用口语', undefined, { timeout: 3000 })
    ).toBeInTheDocument()
  })

  it('新预览还在飞的时候保留上一次片段，不闪成空白', async () => {
    const user = userEvent.setup()
    renderEditor()

    expect(await screen.findByText('语气：简洁直接')).toBeInTheDocument()
    server.use(
      http.post(`${API_BASE_URL}/agent/assistants/assistant-1/persona/preview`, async () => {
        await delay(400)
        return HttpResponse.json({ fragment: '新片段', truncated: false, characterBudget: 1200 })
      })
    )
    await user.selectOptions(screen.getByLabelText('语气'), 'lively')

    // placeholderData 必须留住旧片段：防抖 300ms 之后请求才发出，
    // 这里等到请求确实在飞再断言，空一帧的预览读起来像人格被清空了
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(screen.getByText('语气：简洁直接')).toBeInTheDocument()
    expect(await screen.findByText('新片段', undefined, { timeout: 3000 })).toBeInTheDocument()
  })

  it('预览区只渲染后端返回的片段，不在前端重拼', async () => {
    server.use(
      http.post(`${API_BASE_URL}/agent/assistants/assistant-1/persona/preview`, () =>
        HttpResponse.json({ fragment: '后端说了算', truncated: true, characterBudget: 1200 })
      )
    )
    renderEditor()

    // 两边截断规则一旦漂移，前端自己拼的预览就在对用户撒谎
    expect(await screen.findByText('后端说了算')).toBeInTheDocument()
    expect(screen.queryByText(/老板/)).not.toBeInTheDocument()
    expect(await screen.findByText(/已被截断/)).toBeInTheDocument()
  })

  it('保存时把表单发给后端', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | null = null
    server.use(
      http.put(`${API_BASE_URL}/agent/assistants/assistant-1/persona`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...persona, version: 3 })
      })
    )
    renderEditor()

    await user.selectOptions(await screen.findByLabelText('语气'), 'lively')
    await user.click(screen.getByRole('button', { name: '保存人格' }))

    await waitFor(() => expect(body).not.toBeNull())
    expect(body?.['tone']).toBe('lively')
    expect(body?.['forbiddenTopics']).toEqual(['赌博'])
  })

  it('保存失败时显示后端 detail 码对应的文案', async () => {
    const user = userEvent.setup()
    server.use(
      http.put(`${API_BASE_URL}/agent/assistants/assistant-1/persona`, () =>
        HttpResponse.json({ detail: 'PERSONA_VALUE_INVALID' }, { status: 422 })
      )
    )
    renderEditor()

    await user.click(await screen.findByRole('button', { name: '保存人格' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('填写的内容不符合要求')
  })

  it('禁止话题超过 20 条时前端就拦住，不等后端 422', async () => {
    const user = userEvent.setup()
    renderEditor()

    const topics = await screen.findByLabelText('禁止话题')
    await user.clear(topics)
    await user.paste(Array.from({ length: 21 }, (_, index) => `话题${String(index)}`).join('\n'))

    expect(await screen.findByText('禁止话题最多 20 条')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存人格' })).toBeDisabled()
  })

  it('单条禁止话题超过 40 字时前端就拦住', async () => {
    const user = userEvent.setup()
    renderEditor()

    const topics = await screen.findByLabelText('禁止话题')
    await user.clear(topics)
    await user.paste('话'.repeat(41))

    expect(await screen.findByText('每条禁止话题最多 40 字')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存人格' })).toBeDisabled()
  })

  it('渲染版本历史并按版本号回滚', async () => {
    const user = userEvent.setup()
    let rolledBack: string | null = null
    server.use(
      http.post(
        `${API_BASE_URL}/agent/assistants/assistant-1/persona/versions/:version/rollback`,
        ({ params }) => {
          rolledBack = String(params['version'])
          return HttpResponse.json({ ...persona, tone: 'patient', version: 3 })
        }
      )
    )
    renderEditor()

    await user.click(await screen.findByRole('button', { name: '回滚到第 1 版' }))
    await waitFor(() => expect(rolledBack).toBe('1'))
  })

  it('回滚后表单回到那一版的内容', async () => {
    const user = userEvent.setup()
    let version = 2
    server.use(
      http.get(`${API_BASE_URL}/agent/assistants/assistant-1/persona`, () =>
        HttpResponse.json(version === 2 ? persona : { ...persona, tone: 'patient', version: 3 })
      ),
      http.post(
        `${API_BASE_URL}/agent/assistants/assistant-1/persona/versions/:version/rollback`,
        () => {
          version = 3
          return HttpResponse.json({ ...persona, tone: 'patient', version: 3 })
        }
      )
    )
    renderEditor()

    expect(await screen.findByLabelText('语气')).toHaveValue('concise')
    await user.click(screen.getByRole('button', { name: '回滚到第 1 版' }))
    await waitFor(() => expect(screen.getByLabelText('语气')).toHaveValue('patient'))
  })

  it('候选收件箱渲染本助理的 pending 建议，采用与忽略各走一条路径', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    server.use(
      http.post(`${API_BASE_URL}/agent/persona-candidates/candidate-1/accept`, () => {
        calls.push('accept')
        return HttpResponse.json({ ...candidate, status: 'accepted' })
      }),
      http.post(`${API_BASE_URL}/agent/persona-candidates/candidate-1/reject`, () => {
        calls.push('reject')
        return HttpResponse.json({ ...candidate, status: 'rejected' })
      })
    )
    renderEditor()

    expect(await screen.findByText('你能不能活泼一点')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '采用' }))
    await waitFor(() => expect(calls).toEqual(['accept']))

    await user.click(screen.getByRole('button', { name: '忽略' }))
    await waitFor(() => expect(calls).toEqual(['accept', 'reject']))
  })

  it('别的助理的候选项不出现在本助理的收件箱里', async () => {
    server.use(
      http.get(`${API_BASE_URL}/agent/persona-candidates`, () =>
        HttpResponse.json([{ ...candidate, assistantId: 'assistant-2' }])
      )
    )
    renderEditor()

    expect(await screen.findByText('暂无建议')).toBeInTheDocument()
    expect(screen.queryByText('你能不能活泼一点')).not.toBeInTheDocument()
  })

  it('语气、长度与语言的下拉选项都解析出语言包里的文案', async () => {
    // 这几项用的是嵌套键（toneOptions.concise）。写成扁平的 "tone.concise" 时
    // next-intl 解析不到，界面上会出现一排原始键名，而所有断言标签的用例照样全绿
    renderEditor()
    expect(await screen.findByRole('option', { name: '简洁直接' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '轻松活泼' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '适中' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '简体中文' })).toBeInTheDocument()
  })

  it('英文资源下关键控件文案来自 i18n 而非硬编码', async () => {
    renderEditor('en')
    expect(await screen.findByRole('button', { name: 'Save persona' })).toBeInTheDocument()
    expect(screen.getByLabelText('Tone')).toBeInTheDocument()
  })

  it('换助理后新人格到达前不渲染上一个助理的表单', async () => {
    // 换助理时 persona 查询换了 key、data 变 undefined，而 form 里还是上一个助理的值。
    // 照常渲染会让界面谎称在编辑新助理，这期间按保存就把旧助理的人格写到新助理上。
    server.use(
      http.get(`${API_BASE_URL}/agent/assistants/assistant-2/persona`, async () => {
        await delay(200)
        return HttpResponse.json({ ...persona, assistantId: 'assistant-2', selfName: '阿元' })
      }),
      http.get(`${API_BASE_URL}/agent/assistants/assistant-2/persona/versions`, () =>
        HttpResponse.json([])
      ),
      http.post(`${API_BASE_URL}/agent/assistants/assistant-2/persona/preview`, () =>
        HttpResponse.json({ fragment: '自称：阿元', truncated: false, characterBudget: 1200 })
      )
    )

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const view = render(
      <NextIntlClientProvider locale="zh-CN" messages={zhCN as unknown as Record<string, string>}>
        <QueryClientProvider client={queryClient}>
          <PersonaEditor assistantId="assistant-1" />
        </QueryClientProvider>
      </NextIntlClientProvider>
    )
    expect(await screen.findByDisplayValue('小元')).toBeInTheDocument()

    view.rerender(
      <NextIntlClientProvider locale="zh-CN" messages={zhCN as unknown as Record<string, string>}>
        <QueryClientProvider client={queryClient}>
          <PersonaEditor assistantId="assistant-2" />
        </QueryClientProvider>
      </NextIntlClientProvider>
    )

    expect(screen.getByText('正在加载人格…')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('小元')).not.toBeInTheDocument()
    expect(await screen.findByDisplayValue('阿元')).toBeInTheDocument()
  })
})
