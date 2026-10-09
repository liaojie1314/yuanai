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
  activeAssistantId: string | null,
  /** 传 false 模拟「当前没有可绑定的会话」 */
  bindable = true
): { onSelect: (assistantId: string) => void; container: HTMLElement } {
  const onSelect = vi.fn()
  const { container } = render(
    <DesktopI18nProvider>
      <AssistantSwitcher
        assistants={assistants}
        activeAssistantId={activeAssistantId}
        {...(bindable ? { onSelect } : {})}
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
    expect(screen.getByLabelText('切换助理')).toHaveValue('assistant-2')
  })

  it('会话未绑定助理时显示默认助理', () => {
    renderSwitcher([life, work], null)
    expect(screen.getByLabelText('切换助理')).toHaveValue('assistant-1')
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

  it('没有可绑定的会话时只显示标签，不给点了没反应的控件', () => {
    renderSwitcher([work, life], null, false)
    expect(screen.getByText('工作助理')).toBeTruthy()
    expect(screen.queryByLabelText('切换助理')).toBeNull()
  })

  it('切换后把新助理 ID 交给调用方', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderSwitcher([work, life], 'assistant-1')

    await user.selectOptions(screen.getByLabelText('切换助理'), 'assistant-2')
    expect(onSelect).toHaveBeenCalledWith('assistant-2')
  })

  it('选中当前助理不重复发请求', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderSwitcher([work, life], 'assistant-1')

    await user.selectOptions(screen.getByLabelText('切换助理'), 'assistant-1')
    expect(onSelect).not.toHaveBeenCalled()
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
