import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'

import type { Assistant } from '@yuanai/types'

import { AssistantSwitcher } from '../AssistantSwitcher'
import en from '@/i18n/locales/en.json'
import zhCN from '@/i18n/locales/zh-CN.json'

const base = {
  userId: 'user-1',
  description: '',
  instructions: '',
  defaultModel: 'deepseek-chat',
  autonomyLevel: 'suggest',
  disabledMemoryTypes: null,
  createdAt: '2026-10-07T00:00:00Z',
  updatedAt: '2026-10-07T00:00:00Z',
} satisfies Omit<Assistant, 'id' | 'name' | 'isDefault'>

const work: Assistant = { ...base, id: 'assistant-1', name: '工作助理', isDefault: true }
const life: Assistant = { ...base, id: 'assistant-2', name: '生活助理', isDefault: false }

function renderSwitcher(
  props: {
    assistants: readonly Assistant[]
    activeAssistantId: string | null
    /** 传 false 模拟「当前没有可绑定的会话」 */
    bindable?: boolean
  },
  locale: 'zh-CN' | 'en' = 'zh-CN'
): { onSelect: (assistantId: string) => void } {
  const onSelect = vi.fn()
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={(locale === 'zh-CN' ? zhCN : en) as unknown as Record<string, string>}
    >
      <AssistantSwitcher
        assistants={props.assistants}
        activeAssistantId={props.activeAssistantId}
        {...(props.bindable === false ? {} : { onSelect })}
      />
    </NextIntlClientProvider>
  )
  return { onSelect }
}

describe('AssistantSwitcher', () => {
  it('显示会话当前绑定的助理名', () => {
    renderSwitcher({ assistants: [work, life], activeAssistantId: 'assistant-2' })
    expect(screen.getByLabelText('切换助理')).toHaveValue('assistant-2')
  })

  it('会话未绑定助理时显示默认助理，与后端的解析顺序一致', () => {
    renderSwitcher({ assistants: [life, work], activeAssistantId: null })
    expect(screen.getByLabelText('切换助理')).toHaveValue('assistant-1')
  })

  it('只有一个助理时不渲染切换控件', () => {
    renderSwitcher({ assistants: [work], activeAssistantId: 'assistant-1' })
    expect(screen.getByText('工作助理')).toBeInTheDocument()
    expect(screen.queryByLabelText('切换助理')).not.toBeInTheDocument()
  })

  it('一个助理都没有时整块不渲染', () => {
    const { container } = render(
      <NextIntlClientProvider locale="zh-CN" messages={zhCN as unknown as Record<string, string>}>
        <AssistantSwitcher assistants={[]} activeAssistantId={null} onSelect={vi.fn()} />
      </NextIntlClientProvider>
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('没有可绑定的会话时只显示标签，不给点了没反应的控件', () => {
    renderSwitcher({ assistants: [work, life], activeAssistantId: null, bindable: false })
    expect(screen.getByText('工作助理')).toBeInTheDocument()
    expect(screen.queryByLabelText('切换助理')).not.toBeInTheDocument()
  })

  it('切换后把新助理 ID 交给调用方', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderSwitcher({
      assistants: [work, life],
      activeAssistantId: 'assistant-1',
    })

    await user.selectOptions(screen.getByLabelText('切换助理'), 'assistant-2')
    expect(onSelect).toHaveBeenCalledWith('assistant-2')
  })

  it('选中当前助理不重复发请求', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderSwitcher({
      assistants: [work, life],
      activeAssistantId: 'assistant-1',
    })

    await user.selectOptions(screen.getByLabelText('切换助理'), 'assistant-1')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('提供通往助理管理页的入口，否则控制面对新用户不可达', () => {
    renderSwitcher({ assistants: [work], activeAssistantId: 'assistant-1' })
    expect(screen.getByRole('link', { name: '管理助理' })).toHaveAttribute(
      'href',
      '/agent/assistants'
    )
  })

  it('英文资源下文案来自 i18n 而非硬编码', () => {
    renderSwitcher({ assistants: [work, life], activeAssistantId: 'assistant-1' }, 'en')
    expect(screen.getByLabelText('Switch assistant')).toBeInTheDocument()
  })
})
