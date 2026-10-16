import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Assistant } from '@yuanai/types'

import { changeDesktopLanguage, DesktopI18nProvider } from '../shared/i18n'
import { AssistantSwitcher } from './AssistantSwitcher'

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
  assistants: readonly Assistant[],
  activeAssistantId: string | null
): { onSelect: (assistantId: string) => void; container: HTMLElement } {
  const onSelect = vi.fn()
  const { container } = render(
    <DesktopI18nProvider>
      <AssistantSwitcher
        assistants={assistants}
        activeAssistantId={activeAssistantId}
        onSelect={onSelect}
      />
    </DesktopI18nProvider>
  )
  return { onSelect, container }
}

afterEach(async () => {
  cleanup()
  await changeDesktopLanguage('zh-CN')
})

describe('AssistantSwitcher', () => {
  it('会话头部显示当前助理名', () => {
    renderSwitcher([work, life], 'assistant-2')
    expect(screen.getByLabelText('切换助理')).toHaveTextContent('生活助理')
  })

  it('会话未绑定助理时显示默认助理', () => {
    renderSwitcher([life, work], null)
    expect(screen.getByLabelText('切换助理')).toHaveTextContent('工作助理')
  })

  it('只有一个助理时不渲染切换控件', () => {
    renderSwitcher([work], 'assistant-1')
    expect(screen.getByText('工作助理')).toBeTruthy()
    expect(screen.queryByLabelText('切换助理')).toBeNull()
  })

  it('一个助理都没有时整块不渲染', () => {
    const { container } = renderSwitcher([], null)
    expect(container.innerHTML).toBe('')
  })

  it('选单与模型选择器同款：点开才出面板，当前项打勾', async () => {
    const user = userEvent.setup()
    renderSwitcher([work, life], 'assistant-1')

    // 同一条头部里两个同类选择器用两种控件会让人以为是两种功能
    expect(screen.queryByRole('option')).toBeNull()
    await user.click(screen.getByLabelText('切换助理'))
    expect(screen.getByRole('option', { name: '工作助理' }).getAttribute('aria-selected')).toBe(
      'true'
    )
    expect(screen.getByRole('option', { name: '生活助理' }).getAttribute('aria-selected')).toBe(
      'false'
    )
  })

  it('切换后把新助理 ID 交给调用方并收起面板', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderSwitcher([work, life], 'assistant-1')

    await user.click(screen.getByLabelText('切换助理'))
    await user.click(screen.getByRole('option', { name: '生活助理' }))
    expect(onSelect).toHaveBeenCalledWith('assistant-2')
    expect(screen.queryByRole('option')).toBeNull()
  })

  it('选中当前助理不重复发请求', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderSwitcher([work, life], 'assistant-1')

    await user.click(screen.getByLabelText('切换助理'))
    await user.click(screen.getByRole('option', { name: '工作助理' }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('助理数量无上限，所以面板必须能滚', () => {
    // 选项多到一屏装不下时，不可滚的面板会让后面的助理永远选不到
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/main/chat.css'), 'utf8')
    const rule =
      /\.desktop-chat__assistant-menu\s*\{([^}]*)\}|,\s*\.desktop-chat__assistant-menu\s*\{([^}]*)\}/.exec(
        css
      )
    const body = (rule?.[1] ?? rule?.[2] ?? '').toString()
    expect(body).toMatch(/max-height/)
    expect(body).toMatch(/overflow-y:\s*auto/)
  })

  it('英文界面下文案来自 i18n 而非硬编码', async () => {
    await changeDesktopLanguage('en')
    renderSwitcher([work, life], 'assistant-1')
    expect(screen.getByLabelText('Switch assistant')).toBeTruthy()
  })

  it('配色取自主题 token，不用明色专用值', () => {
    // S39：明色专用的近白色在暗色下会铺成白块，把同样接近白色的文字吃掉
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/main/chat.css'), 'utf8')
    const rules = Array.from(
      css.matchAll(/\.desktop-chat__assistant[\w-]*(?:\s[^{]*)?\{([^}]*)\}/g)
    )
    expect(rules.length).toBeGreaterThanOrEqual(4)
    for (const [selector, body] of rules) {
      expect(body, `${selector} 使用了原始颜色值`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    }
  })
})
