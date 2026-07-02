import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
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

  it('折叠态色块数量有上限，不会随 pair 数量无限增长', () => {
    const ref = { current: null } as RefObject<VirtuosoHandle | null>
    const { container } = render(<MessageOutline pairs={makePairs(30)} virtuosoRef={ref} />)
    const items = container.querySelectorAll('.ch-outline-item')
    expect(items.length).toBeLessThan(30)
  })

  it('折叠态色块数量上限为 10', () => {
    const ref = { current: null } as RefObject<VirtuosoHandle | null>
    const { container } = render(<MessageOutline pairs={makePairs(30)} virtuosoRef={ref} />)
    const items = container.querySelectorAll('.ch-outline-item')
    expect(items.length).toBe(10)
  })

  it('默认不展示悬浮浮层', () => {
    const ref = { current: null } as RefObject<VirtuosoHandle | null>
    const { container } = render(<MessageOutline pairs={makePairs(10)} virtuosoRef={ref} />)
    expect(container.querySelector('.ch-outline-flyout')).toBeNull()
  })

  it('hover 展开浮层，展示历史消息标题列表', () => {
    const ref = { current: null } as RefObject<VirtuosoHandle | null>
    const { container } = render(<MessageOutline pairs={makePairs(10)} virtuosoRef={ref} />)
    const wrap = container.querySelector('.ch-outline-wrap') as HTMLElement
    fireEvent.mouseEnter(wrap)
    const flyout = container.querySelector('.ch-outline-flyout')
    expect(flyout).not.toBeNull()
    expect(screen.getByText('问题 9 的内容')).toBeInTheDocument()
  })

  it('浮层默认按分页大小展示最新一批，而非一次性渲染全部历史', () => {
    const ref = { current: null } as RefObject<VirtuosoHandle | null>
    const { container } = render(<MessageOutline pairs={makePairs(30)} virtuosoRef={ref} />)
    const wrap = container.querySelector('.ch-outline-wrap') as HTMLElement
    fireEvent.mouseEnter(wrap)
    const rows = container.querySelectorAll('.ch-outline-flyout-row')
    expect(rows.length).toBeLessThan(30)
    // 最早的一条（问题 0）默认不在首屏内，需要向上滚动加载
    expect(screen.queryByText('问题 0 的内容')).not.toBeInTheDocument()
  })

  it('点击浮层内的历史条目也会调用 scrollToIndex', () => {
    const scrollToIndex = vi.fn()
    const ref = {
      current: { scrollToIndex } as unknown as VirtuosoHandle,
    } as RefObject<VirtuosoHandle | null>
    const { container } = render(<MessageOutline pairs={makePairs(10)} virtuosoRef={ref} />)
    const wrap = container.querySelector('.ch-outline-wrap') as HTMLElement
    fireEvent.mouseEnter(wrap)
    fireEvent.click(screen.getByText('问题 9 的内容'))
    expect(scrollToIndex).toHaveBeenCalledWith({ index: 18, align: 'start', behavior: 'smooth' })
  })

  it('浮层滚动到顶部会增量加载更早的消息（分页 / 自动加载）', () => {
    const ref = { current: null } as RefObject<VirtuosoHandle | null>
    const { container } = render(<MessageOutline pairs={makePairs(30)} virtuosoRef={ref} />)
    const wrap = container.querySelector('.ch-outline-wrap') as HTMLElement
    fireEvent.mouseEnter(wrap)
    expect(screen.queryByText('问题 0 的内容')).not.toBeInTheDocument()

    const flyout = container.querySelector('.ch-outline-flyout') as HTMLElement
    fireEvent.scroll(flyout, { target: { scrollTop: 0 } })
    expect(screen.getByText('问题 0 的内容')).toBeInTheDocument()
  })

  it('浮层条目带完整文本 title，超长内容 hover 时可看到完整提示', () => {
    const longText =
      '这是一段非常长的用户问题内容，用来验证超出宽度显示省略号后，鼠标悬浮在条目上能展示完整的提示文案而不是被截断的摘要'
    const ref = { current: null } as RefObject<VirtuosoHandle | null>
    const pairs: MsgPair[] = [
      ...makePairs(2),
      { pairKey: 'p-long', userMsg: makeUserMsg('p-long', longText), assistants: [] },
    ]
    const { container } = render(<MessageOutline pairs={pairs} virtuosoRef={ref} />)
    const wrap = container.querySelector('.ch-outline-wrap') as HTMLElement
    fireEvent.mouseEnter(wrap)
    const flyout = container.querySelector('.ch-outline-flyout') as HTMLElement
    const row = within(flyout).getByTitle(longText)
    expect(row.className).toContain('ch-outline-flyout-row')
  })

  it('鼠标移出后延迟收起浮层，短暂划过间隙重新进入不会导致浮层消失', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const ref = { current: null } as RefObject<VirtuosoHandle | null>
    const { container } = render(<MessageOutline pairs={makePairs(10)} virtuosoRef={ref} />)
    const wrap = container.querySelector('.ch-outline-wrap') as HTMLElement

    fireEvent.mouseEnter(wrap)
    expect(container.querySelector('.ch-outline-flyout')).not.toBeNull()

    // 鼠标划过折叠态与浮层之间的间隙，短暂离开命中区域
    fireEvent.mouseLeave(wrap)
    // 收起延迟内浮层仍应保留
    expect(container.querySelector('.ch-outline-flyout')).not.toBeNull()

    // 延迟结束前重新进入（命中间隙对侧的浮层），应取消收起
    fireEvent.mouseEnter(wrap)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(container.querySelector('.ch-outline-flyout')).not.toBeNull()

    // 真正离开且不再回来时，延迟结束后才收起
    fireEvent.mouseLeave(wrap)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(container.querySelector('.ch-outline-flyout')).toBeNull()

    vi.useRealTimers()
  })
})
