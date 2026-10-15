import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
        onSelect={onSelect}
      />
    </NextIntlClientProvider>
  )
  return { onSelect }
}

describe('AssistantSwitcher', () => {
  it('显示会话当前绑定的助理名', () => {
    renderSwitcher({ assistants: [work, life], activeAssistantId: 'assistant-2' })
    expect(screen.getByLabelText('切换助理')).toHaveTextContent('生活助理')
  })

  it('会话未绑定助理时显示默认助理，与后端的解析顺序一致', () => {
    renderSwitcher({ assistants: [life, work], activeAssistantId: null })
    expect(screen.getByLabelText('切换助理')).toHaveTextContent('工作助理')
  })

  it('只有一个助理时也能点开，面板里留着管理入口', async () => {
    // 退化成纯文字标签会把新用户堵死在默认助理上：增删改助理只有这一个入口
    const user = userEvent.setup()
    renderSwitcher({ assistants: [work], activeAssistantId: 'assistant-1' })

    await user.click(screen.getByLabelText('切换助理'))
    expect(screen.getByRole('option', { name: '工作助理' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '管理助理' })).toBeInTheDocument()
  })

  it('一个助理都没有时整块不渲染', () => {
    const { container } = render(
      <NextIntlClientProvider locale="zh-CN" messages={zhCN as unknown as Record<string, string>}>
        <AssistantSwitcher assistants={[]} activeAssistantId={null} onSelect={vi.fn()} />
      </NextIntlClientProvider>
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('选单与顶栏模型下拉同款：点开才出面板，当前项打勾', async () => {
    const user = userEvent.setup()
    renderSwitcher({ assistants: [work, life], activeAssistantId: 'assistant-1' })

    // 同一界面里两个同类选择器用两种控件会让人以为是两种功能，所以这里必须是自绘面板
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    await user.click(screen.getByLabelText('切换助理'))
    expect(screen.getByRole('option', { name: '工作助理' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('option', { name: '生活助理' })).toHaveAttribute(
      'aria-selected',
      'false'
    )
  })

  it('切换后把新助理 ID 交给调用方并收起面板', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderSwitcher({
      assistants: [work, life],
      activeAssistantId: 'assistant-1',
    })

    await user.click(screen.getByLabelText('切换助理'))
    await user.click(screen.getByRole('option', { name: '生活助理' }))
    expect(onSelect).toHaveBeenCalledWith('assistant-2')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('选中当前助理不重复发请求', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderSwitcher({
      assistants: [work, life],
      activeAssistantId: 'assistant-1',
    })

    await user.click(screen.getByLabelText('切换助理'))
    await user.click(screen.getByRole('option', { name: '工作助理' }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('助理数量无上限，所以面板必须能滚', () => {
    // 选项多到一屏装不下时，不可滚的面板会让后面的助理永远选不到
    const css = readFileSync(resolve(process.cwd(), 'src/app/(main)/chat.css'), 'utf8')
    const rule = /\.ch-asw-list\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/max-height/)
    expect(rule).toMatch(/overflow-y:\s*auto/)
  })

  it('提供通往助理管理页的入口，否则控制面对新用户不可达', async () => {
    const user = userEvent.setup()
    renderSwitcher({ assistants: [work], activeAssistantId: 'assistant-1' })

    await user.click(screen.getByLabelText('切换助理'))
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
