import { createElement } from 'react'
import * as React from 'react'
import { act, create } from 'react-test-renderer'
import type { ReactTestInstance } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Assistant } from '@yuanai/types'

import { zhCN } from '@/i18n/messages/zh-CN'

const dialog = vi.hoisted(() => ({ actionSheet: vi.fn() }))

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
}))
vi.mock('lucide-react-native', () => ({ Bot: 'Bot', ChevronDown: 'ChevronDown' }))
vi.mock('@/components/ui/Dialog', () => ({ useDialog: () => dialog }))
vi.mock('@/theme/tokens', () => ({ radius: { sm: 6 }, spacing: { xs: 4, sm: 8, md: 12 } }))
vi.mock('@/theme/useTheme', () => ({
  useTheme: () => ({ text: { primary: '#111827', secondary: '#6b7280' } }),
}))
// 用真实语言包解析，组件引用了语言包里不存在的键时断言会拿到原始键名而立刻红
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string): string => {
      const value = key
        .split('.')
        .reduce<unknown>(
          (node, part) =>
            typeof node === 'object' && node !== null
              ? (node as Record<string, unknown>)[part]
              : undefined,
          zhCN
        )
      return typeof value === 'string' ? value : key
    },
  }),
}))

// 本仓 mobile 的 vitest 走经典 JSX 转换，组件里的 JSX 需要全局 React
vi.stubGlobal('React', React)

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

/** 渲染切换器并返回根实例与 onSelect 替身。 */
function renderSwitcher(
  assistants: readonly Assistant[],
  activeAssistantId: string | null
): { root: ReactTestInstance; onSelect: ReturnType<typeof vi.fn>; json: unknown } {
  const onSelect = vi.fn()
  const renderer = create(
    createElement(AssistantSwitcher, { assistants, activeAssistantId, onSelect })
  )
  return { root: renderer.root, onSelect, json: renderer.toJSON() }
}

/** 取出渲染树里的全部文本节点。 */
function texts(root: ReactTestInstance): string[] {
  return root
    .findAllByType('Text' as never)
    .flatMap((node) => node.children.filter((child): child is string => typeof child === 'string'))
}

const SWITCH_LABEL = zhCN.chat.assistant.switch

describe('AssistantSwitcher', () => {
  beforeEach(() => {
    dialog.actionSheet.mockReset()
  })

  it('会话头部显示当前助理名', () => {
    const { root } = renderSwitcher([work, life], 'assistant-2')
    expect(texts(root)).toContain('生活助理')
  })

  it('会话未绑定助理时显示默认助理', () => {
    const { root } = renderSwitcher([life, work], null)
    expect(texts(root)).toContain('工作助理')
  })

  it('只有一个助理时不渲染切换控件', () => {
    const { root } = renderSwitcher([work], 'assistant-1')
    expect(texts(root)).toContain('工作助理')
    expect(root.findAllByProps({ accessibilityLabel: SWITCH_LABEL })).toHaveLength(0)
  })

  it('一个助理都没有时整块不渲染', () => {
    const { json } = renderSwitcher([], null)
    expect(json).toBeNull()
  })

  it('从选单里选另一个助理后把它的 ID 交给调用方', async () => {
    dialog.actionSheet.mockResolvedValue(1)
    const { root, onSelect } = renderSwitcher([work, life], 'assistant-1')

    const press = root.findByProps({ accessibilityLabel: SWITCH_LABEL }).props['onPress']
    if (typeof press !== 'function') throw new Error('切换器没有挂 onPress')
    await act(async () => {
      await (press as () => Promise<void>)()
    })

    expect(dialog.actionSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [{ label: '工作助理' }, { label: '生活助理' }],
      })
    )
    expect(onSelect).toHaveBeenCalledWith('assistant-2')
  })

  it('取消选单或选回当前助理都不发请求', async () => {
    dialog.actionSheet.mockResolvedValueOnce(-1).mockResolvedValueOnce(0)
    const { root, onSelect } = renderSwitcher([work, life], 'assistant-1')
    const press = root.findByProps({ accessibilityLabel: SWITCH_LABEL }).props['onPress'] as
      (() => Promise<void>) | undefined
    if (!press) throw new Error('切换器没有挂 onPress')

    await act(async () => {
      await press()
    })
    await act(async () => {
      await press()
    })

    expect(onSelect).not.toHaveBeenCalled()
  })
})
