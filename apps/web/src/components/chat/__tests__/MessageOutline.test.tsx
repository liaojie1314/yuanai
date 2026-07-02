import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { RefObject } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import { MessageOutline } from '../MessageOutline'
import type { MsgPair } from '../utils'
import type { MockMessage } from '@yuanai/core/stores'

function makeUserMsg(id: string, text: string): MockMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', content: text }],
    createdAt: Date.now(),
  }
}

function makePairs(count: number): MsgPair[] {
  return Array.from({ length: count }, (_, i) => ({
    pairKey: `p${i}`,
    userMsg: makeUserMsg(`p${i}`, `问题 ${i} 的内容`),
    assistants: [],
  }))
}

describe('MessageOutline', () => {
  it('少于 3 个 pair 时不渲染（避免噪音）', () => {
    const ref = { current: null } as RefObject<VirtuosoHandle | null>
    const { container } = render(<MessageOutline pairs={makePairs(2)} virtuosoRef={ref} />)
    expect(container.querySelector('.ch-outline')).toBeNull()
  })

  it('渲染每个 pair 一个按钮', () => {
    const ref = { current: null } as RefObject<VirtuosoHandle | null>
    render(<MessageOutline pairs={makePairs(5)} virtuosoRef={ref} />)
    expect(screen.getAllByRole('button')).toHaveLength(5)
  })

  it('点击按钮调用 virtuosoRef.scrollToIndex 且 index 是 pairIndex*2', () => {
    const scrollToIndex = vi.fn()
    const ref = {
      current: { scrollToIndex } as unknown as VirtuosoHandle,
    } as RefObject<VirtuosoHandle | null>
    render(<MessageOutline pairs={makePairs(4)} virtuosoRef={ref} />)
    const buttons = screen.getAllByRole('button')
    const target = buttons[2]
    if (!target) throw new Error('button 缺失')
    fireEvent.click(target)
    expect(scrollToIndex).toHaveBeenCalledWith({
      index: 4, // 第 3 个 pair → 用户消息在 row index 4
      align: 'start',
      behavior: 'smooth',
    })
  })

  it('active 状态默认落在最后一个 pair', () => {
    const ref = { current: null } as RefObject<VirtuosoHandle | null>
    const { container } = render(<MessageOutline pairs={makePairs(3)} virtuosoRef={ref} />)
    const items = container.querySelectorAll('.ch-outline-item')
    expect(items[items.length - 1]?.classList.contains('active')).toBe(true)
  })
})
